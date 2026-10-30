// Cloudflare Workers 실시간 서버
//   - 정적 파일(index.html, css, js)은 Workers Assets 가 제공
//   - /ws?room=작전판 : 작전판마다 Durable Object 하나가 접속자와 상태를 관리
// 클라이언트와 주고받는 메시지는 server.js 와 같습니다 (join / batch / ping / presence).
import { DurableObject } from 'cloudflare:workers';

const ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const PIECE = 40000; // 저장소 값 하나의 크기 제한 때문에 상태를 나눠서 저장

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket only', { status: 426 });
      const room = url.searchParams.get('room') || '';
      if (!ID_RE.test(room)) return new Response('Bad room', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

const validPath = p => Array.isArray(p) && p.length > 0 && p.length <= 8 && p.every(k => typeof k === 'string' && ID_RE.test(k));

function applyOp(obj, p, value) {
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) {
    if (typeof o[p[i]] !== 'object' || o[p[i]] === null) {
      if (value === null || value === undefined) return;
      o[p[i]] = {};
    }
    o = o[p[i]];
  }
  if (value === null || value === undefined) delete o[p[p.length - 1]];
  else o[p[p.length - 1]] = value;
}

function cleanMe(me) {
  me = me && typeof me === 'object' ? me : {};
  return {
    id: String(me.id || '').slice(0, 20),
    name: String(me.name || '').slice(0, 20),
    color: /^#[0-9a-f]{6}$/i.test(me.color || '') ? me.color : '#e2b356'
  };
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    this.dirty = false;
  }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async load() {
    if (this.state) return this.state;
    const n = (await this.ctx.storage.get('n')) || 0;
    let text = '';
    const keys = Array.from({ length: n }, (_, i) => 'p' + i);
    for (let i = 0; i < keys.length; i += 100) {
      const part = keys.slice(i, i + 100);
      const got = await this.ctx.storage.get(part);
      part.forEach(k => { text += got.get(k) || ''; });
    }
    try { this.state = text ? JSON.parse(text) : {}; } catch (e) { this.state = {}; }
    return this.state;
  }

  async save() {
    if (!this.state || !this.dirty) return;
    this.dirty = false;
    const text = JSON.stringify(this.state);
    const n = Math.ceil(text.length / PIECE);
    const old = (await this.ctx.storage.get('n')) || 0;
    const keys = Array.from({ length: n }, (_, i) => 'p' + i);
    for (let i = 0; i < keys.length; i += 100) {
      const part = {};
      keys.slice(i, i + 100).forEach(k => { const j = Number(k.slice(1)); part[k] = text.slice(j * PIECE, (j + 1) * PIECE); });
      await this.ctx.storage.put(part);
    }
    await this.ctx.storage.put('n', n);
    const stale = [];
    for (let i = n; i < old; i++) stale.push('p' + i);
    for (let i = 0; i < stale.length; i += 100) await this.ctx.storage.delete(stale.slice(i, i + 100));
  }

  async markDirty() {
    this.dirty = true;
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 1500);
  }

  async alarm() {
    await this.save();
  }

  sockets(except) {
    return this.ctx.getWebSockets().filter(s => s !== except && s.deserializeAttachment());
  }

  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const s of this.sockets(except)) { try { s.send(text); } catch (e) { /* 끊긴 연결 */ } }
  }

  broadcastPeers(except) {
    this.broadcast({ t: 'peers', peers: this.sockets(except).map(s => s.deserializeAttachment().me) }, except);
  }

  // 메시지 하나의 크기 제한(1MiB)에 걸리지 않도록 지형 이미지는 따로 보냄
  sendSnapshot(ws, state) {
    const copy = JSON.parse(JSON.stringify(state));
    const images = [];
    Object.entries(copy.bosses || {}).forEach(([id, b]) => {
      if (b && b.map && b.map.kind === 'image' && typeof b.map.src === 'string') {
        images.push([['bosses', id, 'map', 'src'], b.map.src]);
        delete b.map.src;
      }
    });
    ws.send(JSON.stringify({ t: 'snapshot', state: copy }));
    images.forEach(op => ws.send(JSON.stringify({ t: 'batch', ops: [op] })));
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const state = await this.load();
    if (m.t === 'join') {
      ws.serializeAttachment({ me: cleanMe(m.me) });
      this.sendSnapshot(ws, state);
      this.broadcastPeers();
      return;
    }
    const att = ws.deserializeAttachment();
    if (!att) return;
    if (m.t === 'batch' && Array.isArray(m.ops)) {
      const ops = m.ops.filter(op => Array.isArray(op) && validPath(op[0])).slice(0, 500);
      if (!ops.length) return;
      ops.forEach(([p, v]) => applyOp(state, p, v));
      this.broadcast({ t: 'batch', ops }, ws);
      await this.markDirty();
    } else if (m.t === 'ping') {
      this.broadcast({ t: 'ping', data: m.data }, ws);
    } else if (m.t === 'presence') {
      att.me = cleanMe(Object.assign({}, att.me, m.me, { id: att.me.id }));
      ws.serializeAttachment(att);
      this.broadcastPeers();
    }
  }

  async webSocketClose(ws) { await this.leave(ws); }
  async webSocketError(ws) { await this.leave(ws); }

  async leave(ws) {
    const att = ws.deserializeAttachment();
    const state = await this.load();
    const others = this.sockets(ws);
    // 발표자가 나가면 발표 종료
    const pr = state.present;
    if (att && pr && pr.on && pr.clientId === att.me.id && !others.some(s => s.deserializeAttachment().me.id === att.me.id)) {
      pr.on = false;
      this.broadcast({ t: 'batch', ops: [[['present', 'on'], false]] }, ws);
      await this.markDirty();
    }
    this.broadcastPeers(ws);
    if (!others.length) await this.save();
    try { ws.close(1000, 'bye'); } catch (e) { /* 이미 닫힘 */ }
  }
}
