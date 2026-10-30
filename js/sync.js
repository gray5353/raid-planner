// 실시간 동기화 어댑터: Firebase / 웹소켓(server.js) / 로컬(BroadcastChannel)
// 모든 어댑터는 같은 모양을 가집니다:
//   { mode, set(path, value), batch([[path, value], ...]), ping(data), setPresence(info), guardPresenter(on) }
// 상태는 경로(키 배열)로 쓰고, value 가 null 이면 삭제입니다.
(function () {
  const RP = window.RP = window.RP || {};

  function applyOp(obj, path, value) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (typeof o[k] !== 'object' || o[k] === null) {
        if (value === null || value === undefined) return obj;
        o[k] = {};
      }
      o = o[k];
    }
    const last = path[path.length - 1];
    if (value === null || value === undefined) delete o[last];
    else o[last] = value;
    return obj;
  }
  RP.applyOp = applyOp;
  const clone = v => (v === null || v === undefined) ? null : JSON.parse(JSON.stringify(v));

  // ---------- 로컬: 같은 브라우저의 탭끼리만 ----------
  function localAdapter(room, h, me) {
    const key = 'rp-local-' + room;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { state = {}; }
    const seed = RP.CONFIG && RP.CONFIG.seed;
    if (!Object.keys(state).length && seed) state = clone(seed);
    let bc = null;
    try { bc = new BroadcastChannel(key); } catch (e) { bc = null; }
    let saveTimer = null;
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) { /* 용량 초과 등 */ }
      }, 300);
    };
    if (bc) {
      bc.onmessage = e => {
        const m = e.data || {};
        if (m.t === 'batch') {
          m.ops.forEach(([p, v]) => { applyOp(state, p, clone(v)); h.onOp(p, clone(v)); });
          save();
        } else if (m.t === 'ping') h.onPing(m.data);
      };
    }
    setTimeout(() => {
      h.onStatus('local', '로컬 모드 · 이 브라우저에서만 공유');
      h.onSnapshot(clone(state) || {});
      h.onPeers([me]);
    }, 0);
    const batch = ops => {
      ops.forEach(([p, v]) => applyOp(state, p, clone(v)));
      save();
      if (bc) bc.postMessage({ t: 'batch', ops });
    };
    return {
      mode: 'local',
      set: (p, v) => batch([[p, v]]),
      batch,
      ping: d => bc && bc.postMessage({ t: 'ping', data: d }),
      setPresence: () => {},
      guardPresenter: () => {}
    };
  }

  // ---------- 웹소켓: server.js ----------
  function wsAdapter(room, h, me, url, onNeverOpened) {
    let ws = null, open = false, everOpened = false, retry = 0;
    const pending = new Map();
    const send = m => {
      if (open && ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
      return false;
    };
    function connect() {
      h.onStatus('connecting', '서버 연결 중…');
      try { ws = new WebSocket(url); } catch (e) { if (onNeverOpened) onNeverOpened(); return; }
      ws.onopen = () => {
        open = true; everOpened = true; retry = 0;
        send({ t: 'join', room, me });
      };
      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'snapshot') {
          const s = m.state || {};
          // 끊겨 있던 동안의 내 변경을 서버 상태 위에 다시 얹고 전송
          const ops = [...pending.values()];
          pending.clear();
          ops.forEach(([p, v]) => applyOp(s, p, clone(v)));
          h.onSnapshot(s);
          if (ops.length) send({ t: 'batch', ops });
          h.onStatus('online', '실시간 연결됨');
        } else if (m.t === 'batch') {
          m.ops.forEach(([p, v]) => h.onOp(p, v));
        } else if (m.t === 'peers') h.onPeers(m.peers || []);
        else if (m.t === 'ping') h.onPing(m.data);
      };
      ws.onclose = () => {
        open = false;
        if (!everOpened && onNeverOpened) { onNeverOpened(); return; }
        h.onStatus('offline', '연결 끊김 · 다시 연결하는 중…');
        setTimeout(connect, Math.min(10000, 500 * Math.pow(2, retry++)));
      };
    }
    connect();
    const batch = ops => {
      if (!send({ t: 'batch', ops })) {
        ops.forEach(op => { const k = op[0].join('/'); pending.delete(k); pending.set(k, op); });
      }
    };
    return {
      mode: 'ws',
      set: (p, v) => batch([[p, v]]),
      batch,
      ping: d => send({ t: 'ping', data: d }),
      setPresence: info => { Object.assign(me, info); send({ t: 'presence', me }); },
      guardPresenter: () => {} // 서버가 발표자 연결 종료를 처리
    };
  }

  // ---------- Firebase Realtime Database ----------
  const FB_VER = '10.14.1';
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function firebaseAdapter(room, h, me, cfg) {
    h.onStatus('connecting', 'Firebase 연결 중…');
    let api = null;
    const queue = [];
    const base = `https://cdn.jsdelivr.net/npm/firebase@${FB_VER}/`;
    loadScript(base + 'firebase-app-compat.js')
      .then(() => loadScript(base + 'firebase-database-compat.js'))
      .then(() => {
        const fb = window.firebase;
        if (!fb.apps.length) fb.initializeApp(cfg);
        const db = fb.database();
        const root = db.ref('rooms/' + room);
        const stateRef = root.child('state');
        const TS = fb.database.ServerValue.TIMESTAMP;
        let offset = 0;
        db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
        stateRef.on('value', s => h.onSnapshot(s.val() || {}),
          err => h.onStatus('error', 'Firebase 권한 오류 · 규칙을 확인하세요 (' + err.code + ')'));
        const presRef = root.child('presence/' + me.id);
        db.ref('.info/connected').on('value', s => {
          if (s.val()) {
            presRef.onDisconnect().remove();
            presRef.set(Object.assign({}, me, { ts: TS }));
            h.onStatus('online', '실시간 연결됨 (Firebase)');
          } else {
            h.onStatus('offline', '연결 끊김 · 다시 연결하는 중…');
          }
        });
        root.child('presence').on('value', s => h.onPeers(Object.values(s.val() || {})));
        const pingsRef = root.child('pings');
        pingsRef.on('child_added', s => {
          const p = s.val();
          if (p && p.from !== me.id && Date.now() + offset - p.ts < 4000) h.onPing(p.data);
        });
        const presentOnRef = stateRef.child('present/on');
        const report = e => h.onStatus('error', '저장 실패 · ' + (e && e.code || e));
        api = {
          set: (p, v) => stateRef.child(p.join('/')).set(v === undefined ? null : v).catch(report),
          batch: ops => {
            const u = {};
            ops.forEach(([p, v]) => { u[p.join('/')] = v === undefined ? null : v; });
            stateRef.update(u).catch(report);
          },
          ping: d => {
            const r = pingsRef.push({ data: d, from: me.id, ts: TS });
            r.onDisconnect().remove();
            setTimeout(() => r.remove(), 5000);
          },
          setPresence: info => { Object.assign(me, info); presRef.update(info); },
          guardPresenter: on => {
            if (on) presentOnRef.onDisconnect().set(false);
            else presentOnRef.onDisconnect().cancel();
          }
        };
        queue.splice(0).forEach(([fn, args]) => api[fn].apply(null, args));
      })
      .catch(() => h.onStatus('error', 'Firebase 라이브러리를 불러오지 못했습니다'));
    const call = fn => function () { api ? api[fn].apply(null, arguments) : queue.push([fn, [...arguments]]); };
    return {
      mode: 'firebase',
      set: call('set'), batch: call('batch'), ping: call('ping'),
      setPresence: call('setPresence'), guardPresenter: call('guardPresenter')
    };
  }

  // ---------- MQTT 공개 중계 서버 (계정·서버 없이 실시간) ----------
  // 상태를 조각으로 나눠 retained 메시지로 보관하고, 움직임은 ops 로 즉시 전달합니다.
  //   s/main       : 보스를 뺀 나머지 (제목, 명단, 발표)
  //   s/b/<보스id>  : 보스 하나 (지형 이미지 제외)
  //   s/m/<보스id>  : 그 보스의 지형 이미지
  //   p/<접속자id>  : 접속 표시 (연결이 끊기면 브로커가 지움)
  // 중계 서버의 데이터가 사라져도 이 브라우저에 남은 사본으로 다시 올립니다.
  const MQTT_VER = '5.10.1';
  function mqttAdapter(room, h, me, cfg) {
    const brokers = cfg.brokers || [];
    const base = (cfg.prefix || 'wow-raid-planner/v1') + '/' + room;
    const T = { ops: base + '/ops', ping: base + '/ping', state: base + '/s/', pres: base + '/p/' };
    const myPres = T.pres + me.id;
    const cacheKey = 'rp-cache-' + room;
    let client = null, ready = false, snapTimer = 0, flushTimer = 0, cacheTimer = 0;
    let state = {};
    const mapSrc = {}, published = {}, peersMap = {}, dirty = new Set(), queue = [];

    const enc = o => JSON.stringify(Object.assign({ from: me.id }, o));
    const online = () => client && client.connected;
    const presence = () => JSON.stringify({ id: me.id, name: me.name, color: me.color });

    function chunksOf(path) {
      if (path[0] !== 'bosses') return ['main'];
      const ids = path.length === 1 ? Object.keys(state.bosses || {}).concat(Object.keys(published).filter(k => k.startsWith('b/')).map(k => k.slice(2))) : [path[1]];
      const out = [];
      ids.forEach(id => {
        out.push('b/' + id);
        if (path.length <= 3 || path[2] !== 'phases') out.push('m/' + id);
      });
      return out;
    }
    function chunkPayload(c) {
      if (c === 'main') {
        const o = Object.assign({}, state);
        delete o.bosses;
        return Object.keys(o).length ? enc({ data: o }) : '';
      }
      const id = c.slice(2), b = state.bosses && state.bosses[id];
      if (c.startsWith('b/')) {
        if (!b) return '';
        const o = clone(b);
        if (o.map && o.map.kind === 'image') delete o.map.src;
        return enc({ data: o });
      }
      const src = b && b.map && b.map.kind === 'image' ? b.map.src : '';
      return src ? enc({ data: src }) : '';
    }
    function flush() {
      if (!online()) return;
      dirty.forEach(c => {
        const payload = chunkPayload(c);
        const key = payload ? payload.slice(payload.indexOf(',') + 1) : '';
        if (published[c] === key) return;
        if (!payload && published[c] === undefined) return;
        client.publish(T.state + c, payload, { qos: 1, retain: true });
        if (payload) published[c] = key; else delete published[c];
      });
      dirty.clear();
    }
    function markDirty(path) {
      chunksOf(path).forEach(c => dirty.add(c));
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 500);
      saveCache();
    }
    function saveCache() {
      clearTimeout(cacheTimer);
      cacheTimer = setTimeout(() => {
        try { localStorage.setItem(cacheKey, JSON.stringify(withMaps(clone(state) || {}))); } catch (e) { /* 용량 초과 등 */ }
      }, 1500);
    }
    function withMaps(s) {
      Object.keys(mapSrc).forEach(id => {
        const b = s.bosses && s.bosses[id];
        if (b && b.map && b.map.kind === 'image' && !b.map.src) b.map.src = mapSrc[id];
      });
      return s;
    }
    function noteMaps(p, v) {
      if (p[0] !== 'bosses') return;
      const take = (id, map) => { if (map && map.kind === 'image' && typeof map.src === 'string') mapSrc[id] = map.src; };
      if (p.length === 1 && v) Object.keys(v).forEach(id => take(id, v[id] && v[id].map));
      else if (p.length === 2 && v) take(p[1], v.map);
      else if (p.length === 3 && p[2] === 'map') take(p[1], v);
      else if (p.length === 4 && p[2] === 'map' && p[3] === 'src' && typeof v === 'string') mapSrc[p[1]] = v;
    }
    function onChunk(c, msg) {
      if (c === 'main') {
        Object.keys(state).forEach(k => { if (k !== 'bosses') delete state[k]; });
        if (msg && msg.data) Object.assign(state, clone(msg.data));
      } else if (c.startsWith('b/')) {
        applyOp(state, ['bosses', c.slice(2)], msg ? clone(msg.data) : null);
      } else if (c.startsWith('m/')) {
        if (msg && typeof msg.data === 'string') mapSrc[c.slice(2)] = msg.data; else delete mapSrc[c.slice(2)];
      }
      published[c] = msg ? JSON.stringify(msg).slice(JSON.stringify(msg).indexOf(',') + 1) : undefined;
      if (!msg) delete published[c];
    }
    const emit = () => { h.onSnapshot(withMaps(clone(state) || {})); saveCache(); };

    function firstLoad() {
      if (!Object.keys(state).length) {
        let cached = null;
        try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch (e) { cached = null; }
        if (cached && Object.keys(cached).length) {
          // 중계 서버에 남은 것이 없으면 이 브라우저의 사본으로 복구
          state = cached;
          ['main'].concat(Object.keys(state.bosses || {}).flatMap(id => ['b/' + id, 'm/' + id])).forEach(c => dirty.add(c));
        }
      }
      ready = true;
      drainQueue();
      emit();
      flush();
    }
    // 연결이 끊겨 있던 동안의 내 변경을 받아 둔 상태 위에 다시 얹고 전송
    function drainQueue() {
      const q = queue.splice(0);
      if (!q.length) return;
      q.forEach(([p, v]) => { applyOp(state, p, clone(v)); chunksOf(p).forEach(c => dirty.add(c)); });
      client.publish(T.ops, enc({ ops: q }));
    }

    function connect(i) {
      if (!brokers[i]) { h.onStatus('error', '실시간 중계 서버에 연결하지 못했습니다 · 새로고침 해보세요'); return; }
      h.onStatus('connecting', '실시간 서버 연결 중…');
      let ok = false;
      const c = window.mqtt.connect(brokers[i], {
        clientId: 'rp_' + me.id + '_' + Math.random().toString(36).slice(2, 8),
        clean: true, keepalive: 30, connectTimeout: 8000, reconnectPeriod: 3000,
        will: { topic: myPres, payload: '', retain: true, qos: 0 }
      });
      client = c;
      const next = () => { if (ok) return; ok = true; clearTimeout(giveUp); c.end(true); connect(i + 1); };
      const giveUp = setTimeout(next, 10000);
      c.on('connect', () => {
        if (!ok) { ok = true; clearTimeout(giveUp); }
        c.subscribe([T.state + '#', T.ops, T.ping, T.pres + '+'], { qos: 1 }, () => {
          c.publish(myPres, presence(), { retain: true, qos: 0 });
          clearTimeout(snapTimer);
          // retained 조각들이 다 들어올 시간을 잠깐 준 뒤 화면을 그림
          snapTimer = setTimeout(() => {
            if (!ready) firstLoad(); else { drainQueue(); emit(); flush(); }
            h.onStatus('online', '실시간 연결됨');
          }, ready ? 300 : 1200);
        });
      });
      c.on('message', (topic, buf, packet) => {
        const text = buf.toString();
        let msg = null;
        if (text) { try { msg = JSON.parse(text); } catch (e) { return; } }
        if (topic.startsWith(T.pres)) {
          const id = topic.slice(T.pres.length);
          if (msg && msg.id) peersMap[id] = { id: String(msg.id).slice(0, 20), name: String(msg.name || '').slice(0, 20), color: msg.color };
          else delete peersMap[id];
          h.onPeers(Object.values(peersMap));
          return;
        }
        // 내가 보낸 실시간 메시지의 메아리는 무시 (처음 받는 보관본 retained 는 반영)
        if (msg && msg.from === me.id && !packet.retain) return;
        if (topic === T.ops) {
          if (!msg || !Array.isArray(msg.ops)) return;
          const ops = msg.ops.filter(op => Array.isArray(op) && Array.isArray(op[0]) && op[0].length);
          ops.forEach(([p, v]) => { applyOp(state, p, clone(v)); noteMaps(p, v); });
          if (ready) { ops.forEach(([p, v]) => h.onOp(p, clone(v))); saveCache(); }
        } else if (topic === T.ping) {
          if (msg) h.onPing(msg.data);
        } else if (topic.startsWith(T.state)) {
          onChunk(topic.slice(T.state.length), msg);
          if (ready) emit();
        }
      });
      c.on('offline', () => h.onStatus('offline', '연결 끊김 · 다시 연결하는 중…'));
      c.on('error', next);
    }
    window.addEventListener('pagehide', () => { if (online()) client.publish(myPres, '', { retain: true }); });

    h.onStatus('connecting', '실시간 서버 연결 중…');
    (window.mqtt ? Promise.resolve() : loadScript(cfg.lib || `https://cdn.jsdelivr.net/npm/mqtt@${MQTT_VER}/dist/mqtt.min.js`))
      .then(() => connect(0))
      .catch(() => h.onStatus('error', '실시간 연결 라이브러리를 불러오지 못했습니다'));

    const batch = ops => {
      if (!ready || !online()) {
        queue.push(...ops);
        return;
      }
      ops.forEach(([p, v]) => { applyOp(state, p, clone(v)); markDirty(p); });
      client.publish(T.ops, enc({ ops }));
    };
    return {
      mode: 'mqtt',
      set: (p, v) => batch([[p, v]]),
      batch,
      ping: d => online() && client.publish(T.ping, enc({ data: d })),
      setPresence: info => { Object.assign(me, info); if (online()) client.publish(myPres, presence(), { retain: true }); },
      guardPresenter: () => {} // 발표자가 나가면 접속 목록에서 빠지고, 화면은 발표 표시를 끔
    };
  }

  RP.connect = function (room, handlers, me) {
    const cfg = RP.CONFIG || {};
    const mode = cfg.mode || 'auto';
    const fbCfg = cfg.firebase || {};
    const mq = cfg.mqtt || {};
    if (mode === 'firebase' || (mode === 'auto' && fbCfg.databaseURL)) return firebaseAdapter(room, handlers, me, fbCfg);
    if (mode === 'mqtt' || (mode === 'auto' && mq.brokers && mq.brokers.length)) return mqttAdapter(room, handlers, me, mq);
    if (mode === 'local' || (mode === 'auto' && !/^https?:$/.test(location.protocol))) return localAdapter(room, handlers, me);

    const url = cfg.wsUrl || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    // auto: 서버에 한 번도 연결되지 않으면 로컬 모드로 전환
    let inner;
    const proxy = {
      mode: 'ws',
      set: (p, v) => inner.set(p, v),
      batch: ops => inner.batch(ops),
      ping: d => inner.ping(d),
      setPresence: i => inner.setPresence(i),
      guardPresenter: on => inner.guardPresenter(on)
    };
    inner = wsAdapter(room, handlers, me, url, mode === 'auto' ? () => {
      inner = localAdapter(room, handlers, me);
      proxy.mode = 'local';
    } : null);
    return proxy;
  };
})();
