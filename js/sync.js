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

  RP.connect = function (room, handlers, me) {
    const cfg = RP.CONFIG || {};
    const mode = cfg.mode || 'auto';
    const fbCfg = cfg.firebase || {};
    if (mode === 'firebase' || (mode === 'auto' && fbCfg.databaseURL)) return firebaseAdapter(room, handlers, me, fbCfg);
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
