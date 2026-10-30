// 공격대 작전판 실시간 서버 (Node.js)
//   npm install
//   npm start            → http://localhost:8080
// 정적 파일(index.html, css, js)과 웹소켓(/ws)을 함께 제공하고,
// 작전판 내용은 data/ 폴더에 JSON 으로 저장합니다.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PUBLIC = new Set(['/index.html']);
const PUBLIC_DIRS = ['/css/', '/js/', '/assets/'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- 정적 파일 ----------
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { p = '/'; }
  if (p === '/') p = '/index.html';
  const allowed = PUBLIC.has(p) || PUBLIC_DIRS.some(d => p.startsWith(d));
  const file = path.join(ROOT, path.normalize(p));
  if (!allowed || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    // 이 서버로 열면 실시간 공유는 이 서버의 웹소켓을 사용
    if (p === '/js/config.js') buf = Buffer.concat([buf, Buffer.from("\nif (window.RP.CONFIG.mode === 'auto') window.RP.CONFIG.mode = 'ws';\n")]);
    res.end(buf);
  });
});

// ---------- 방 상태 ----------
const rooms = new Map();
const validRoom = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(id);
const validPath = p => Array.isArray(p) && p.length > 0 && p.length <= 8 &&
  p.every(k => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(k));

function getRoom(id) {
  let r = rooms.get(id);
  if (r) return r;
  let state = {};
  try { state = JSON.parse(fs.readFileSync(path.join(DATA_DIR, id + '.json'), 'utf8')); } catch (e) { state = {}; }
  r = { id, state, clients: new Set(), saveTimer: null };
  rooms.set(id, r);
  return r;
}
function saveRoom(r, now) {
  clearTimeout(r.saveTimer);
  const write = () => {
    r.saveTimer = null;
    fs.writeFile(path.join(DATA_DIR, r.id + '.json'), JSON.stringify(r.state), err => {
      if (err) console.error('저장 실패', r.id, err.message);
    });
  };
  if (now) write(); else r.saveTimer = setTimeout(write, 1000);
}
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
function send(ws, msg) { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function broadcast(r, msg, except) {
  const s = JSON.stringify(msg);
  for (const c of r.clients) if (c !== except) send(c, s);
}
function broadcastPeers(r) {
  broadcast(r, { t: 'peers', peers: [...r.clients].map(c => c.me) });
}
function cleanMe(me) {
  me = me && typeof me === 'object' ? me : {};
  return {
    id: String(me.id || '').slice(0, 20),
    name: String(me.name || '').slice(0, 20),
    color: /^#[0-9a-f]{6}$/i.test(me.color || '') ? me.color : '#e2b356'
  };
}

// ---------- 웹소켓 ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 12 * 1024 * 1024 });
wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (!validRoom(m.room) || ws.room) return;
      const r = getRoom(m.room);
      ws.room = r;
      ws.me = cleanMe(m.me);
      r.clients.add(ws);
      send(ws, { t: 'snapshot', state: r.state });
      broadcastPeers(r);
      return;
    }
    const r = ws.room;
    if (!r) return;
    if (m.t === 'batch' && Array.isArray(m.ops)) {
      const ops = m.ops.filter(op => Array.isArray(op) && validPath(op[0])).slice(0, 500);
      if (!ops.length) return;
      ops.forEach(([p, v]) => applyOp(r.state, p, v));
      saveRoom(r);
      broadcast(r, { t: 'batch', ops }, ws);
    } else if (m.t === 'ping') {
      broadcast(r, { t: 'ping', data: m.data }, ws);
    } else if (m.t === 'presence') {
      ws.me = cleanMe(Object.assign({}, ws.me, m.me, { id: ws.me.id }));
      broadcastPeers(r);
    }
  });
  ws.on('close', () => {
    const r = ws.room;
    if (!r) return;
    r.clients.delete(ws);
    // 발표자가 나가면 발표 종료
    const pr = r.state.present;
    if (pr && pr.on && ws.me && pr.clientId === ws.me.id && ![...r.clients].some(c => c.me.id === ws.me.id)) {
      pr.on = false;
      broadcast(r, { t: 'batch', ops: [[['present', 'on'], false]] });
      saveRoom(r);
    }
    broadcastPeers(r);
    if (!r.clients.size) {
      saveRoom(r, true);
      rooms.delete(r.id);
    }
  });
});

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`공격대 작전판: http://localhost:${PORT}`));
