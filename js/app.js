// 브리핑 포에버: 화면, 명단, 지도 배치, 발표 모드
(function () {
  'use strict';
  const RP = window.RP;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tr = (k, v) => RP.t(k, v); // 한국어 문장을 열쇠로 현재 언어 문장을 돌려줌 (js/i18n.js)
  const LONG_PRESS_MS = 500; // 공대원을 이만큼 누르고 있으면 공격·탱·힐·차단 메뉴
  const clone = v => (v === null || v === undefined) ? null : JSON.parse(JSON.stringify(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = v => Math.round(v * 10000) / 10000;
  const storage = (area) => ({
    get: k => { try { return window[area].getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { window[area].setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } }
  });
  const local = storage('localStorage');
  const session = storage('sessionStorage');

  // ---------- 방 / 모드 ----------
  const params = new URLSearchParams(location.search);
  // 보기 링크: ?view=보기코드 (실시간 서버가 수정을 막음). ?room=…&mode=view 는 서버가 없는 방식용 예전 형식
  const VIEW_CODE = (params.get('view') || '').replace(/[^a-z0-9]/g, '').slice(0, 20);
  const VIEW_ONLY = !!VIEW_CODE || params.get('mode') === 'view';
  let room = VIEW_CODE ? '' : (params.get('room') || (RP.CONFIG && RP.CONFIG.defaultRoom) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!room && !VIEW_CODE) {
    room = RP.uid(10);
    params.set('room', room);
    try { history.replaceState(null, '', location.pathname + '?' + params + location.hash); } catch (e) { /* 샌드박스 */ }
  }
  if (VIEW_ONLY) document.body.classList.add('view-mode');

  const PEER_COLORS = ['#e2b356', '#4fc3f7', '#81c784', '#f48fb1', '#ffb74d', '#ba68c8', '#4dd0e1', '#ff8a65'];
  const myId = session.get('rp-client') || RP.uid(8);
  session.set('rp-client', myId);
  const me = {
    id: myId,
    name: local.get('rp-name') || '',
    color: PEER_COLORS[parseInt(myId.slice(0, 4), 36) % PEER_COLORS.length]
  };

  // ---------- 상태 ----------
  let state = {};
  let ready = false;
  let peers = [];
  let drag = null; // 지도 위 토큰을 끄는 중
  let fxReady = false; // 이펙트 층이 한 번이라도 그려졌는지 (확대·축소 때 다시 그리기용)
  let lastStatus = null; // 언어를 바꿀 때 연결 상태 문구를 다시 쓰기 위해

  // ---------- 시작 화면 ----------
  // 안내 글을 읽을 시간을 주고(최소 3.5초), 불러오기가 끝나면 사라짐. 끝난 뒤에는 눌러서 바로 닫기
  const splash = $('#splash');
  const splashStart = Date.now();
  let splashOpen = !!splash;
  let namePromptPending = false;
  function hideSplash() {
    if (!splashOpen) return;
    splashOpen = false;
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 450);
    if (namePromptPending) { namePromptPending = false; promptNameOnce(); }
  }
  function splashReady() {
    if (!splashOpen) return;
    $('#splashStatus').textContent = tr('화면을 누르면 시작합니다');
    splash.classList.add('ready');
    setTimeout(hideSplash, Math.max(0, 3500 - (Date.now() - splashStart)));
  }
  if (splash) {
    splash.addEventListener('click', () => { if (ready) hideSplash(); });
    setTimeout(hideSplash, 12000); // 연결이 오래 걸려도 화면은 보이게
  }
  const view = { bossId: null, phaseId: null, follow: true, zoom: 1, panX: 0, panY: 0, pingMode: false, tool: 'select', linking: null };
  const getIn = (obj, path) => path.reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, obj);

  const list = obj => Object.keys(obj || {})
    .filter(id => obj[id] && typeof obj[id] === 'object')
    .map(id => Object.assign({ id }, obj[id]))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
  const bosses = () => list(state.bosses);
  const boss = () => state.bosses && state.bosses[view.bossId];
  const phases = b => list(b && b.phases);
  const phase = () => { const b = boss(); return b && b.phases && b.phases[view.phaseId]; };
  const tokensOf = p => (p && p.tokens) || {};
  const phasePath = () => ['bosses', view.bossId, 'phases', view.phaseId];
  const canEdit = () => !VIEW_ONLY && ready;
  const presenting = () => !!(state.present && state.present.on && state.present.clientId === me.id);
  // 발표자가 접속 목록에서 빠지면(창을 닫음 등) 발표 중이 아닌 것으로 봄
  const presentOn = () => {
    const pr = state.present;
    if (!pr || !pr.on) return false;
    return pr.clientId === me.id || !peers.length || peers.some(p => p && p.id === pr.clientId);
  };

  // ---------- 동기화 ----------
  const sync = RP.connect(room, {
    onSnapshot(s) {
      state = s || {};
      if (drag && drag.moved && !drag.out) RP.applyOp(state, drag.path, clone(drag.value));
      ready = true;
      splashReady();
      if (!namePromptQueued) { namePromptQueued = true; setTimeout(promptNameOnce, 500); }
      scheduleRender();
    },
    onOp(p, v) {
      if (!Array.isArray(p) || !p.length) return;
      RP.applyOp(state, p, clone(v));
      scheduleRender();
    },
    onStatus(kind, text, vars) {
      lastStatus = [kind, text, vars];
      $('#connDot').className = 'dot ' + kind;
      $('#connText').textContent = tr(text, vars);
      if (kind === 'local') { peers = []; renderPeers(); }
    },
    onPeers(ps) { peers = Array.isArray(ps) ? ps : []; renderPeers(); scheduleRender(); },
    onPing(p) { showPing(p); }
  }, me, { view: VIEW_CODE });

  function commit(ops) {
    if (!canEdit()) return;
    ops.forEach(([p, v]) => RP.applyOp(state, p, clone(v)));
    sync.batch(ops);
    scheduleRender();
  }
  const set = (path, value) => commit([[path, value]]);

  // 끌기 중 위치는 너무 자주 보내지 않도록 묶어서 전송
  const throttles = new Map();
  function setThrottled(path, value) {
    RP.applyOp(state, path, clone(value));
    const key = path.join('/');
    let t = throttles.get(key);
    if (!t) { t = { last: 0, timer: 0, path, value }; throttles.set(key, t); }
    t.value = value;
    const wait = 70 - (performance.now() - t.last);
    if (wait <= 0) { t.last = performance.now(); sync.set(path, value); }
    else if (!t.timer) {
      t.timer = setTimeout(() => { t.timer = 0; t.last = performance.now(); sync.set(t.path, t.value); }, wait);
    }
  }
  function endThrottle(path) {
    const key = path.join('/');
    const t = throttles.get(key);
    if (t) { clearTimeout(t.timer); throttles.delete(key); }
  }

  const debouncers = {};
  function debounce(key, fn, ms) {
    clearTimeout(debouncers[key]);
    debouncers[key] = setTimeout(fn, ms);
  }

  // ---------- 화면 갱신 ----------
  let rafId = 0;
  function scheduleRender() {
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); });
  }
  const sigs = {};
  function changed(key, sig) {
    if (sigs[key] === sig) return false;
    sigs[key] = sig;
    return true;
  }

  function render() {
    resolveView();
    renderTitle();
    renderBanner();
    renderRoster();
    renderBossTabs();
    renderPhaseTabs();
    renderPalette();
    renderMap();
    renderDrawings();
    renderTokens();
    renderEffects();
    renderSide();
    renderEmpty();
  }

  function resolveView() {
    const pr = state.present;
    if (presentOn() && pr.clientId !== me.id && view.follow && state.bosses && state.bosses[pr.bossId]) {
      view.bossId = pr.bossId;
      view.phaseId = pr.phaseId;
    }
    const bs = bosses();
    if (!state.bosses || !state.bosses[view.bossId]) view.bossId = bs.length ? bs[0].id : null;
    const b = boss();
    if (!b || !b.phases || !b.phases[view.phaseId]) {
      const ps = phases(b);
      view.phaseId = ps.length ? ps[0].id : null;
    }
  }

  function goTo(bossId, phaseId) {
    const pr = state.present;
    if (presentOn() && pr.clientId !== me.id && view.follow) {
      view.follow = false;
      toast(tr('발표자 따라가기를 껐습니다'));
    }
    view.bossId = bossId;
    view.phaseId = phaseId || null;
    resolveView();
    if (presenting()) commit([[['present', 'bossId'], view.bossId], [['present', 'phaseId'], view.phaseId]]);
    scheduleRender();
  }

  function renderTitle() {
    const title = (state.meta && state.meta.title) || '';
    const input = $('#planTitle');
    if (document.activeElement !== input) input.value = title;
    input.disabled = VIEW_ONLY;
    document.title = title ? `${title} · ${tr('브리핑 포에버')}` : tr('브리핑 포에버');
  }

  function renderPeers() {
    const btn = $('#peersBtn');
    btn.hidden = !peers.length;
    if (!peers.length) { closePeerPanel(); return; }
    $('#peers').textContent = tr('접속 {n}명', { n: peers.length });
    if (!$('#peerPanel').hidden) renderPeerPanel();
  }

  // 접속자 목록: 나 → 발표자 → 이름순, 이름 없는 사람은 뒤로
  function renderPeerPanel() {
    const pr = presentOn() ? state.present.clientId : null;
    const rosterNames = new Set(list(state.roster).map(m => normName(m.name)));
    const rows = peers.filter(p => p && p.id).map(p => ({
      id: p.id, name: p.id === me.id ? me.name : String(p.name || ''),
      color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#9aa0ab', me: p.id === me.id, presenter: p.id === pr
    })).sort((a, b) => (b.me - a.me) || (b.presenter - a.presenter) || (!a.name - !b.name) || a.name.localeCompare(b.name, 'ko'));
    const unnamed = rows.filter(r => !r.name).length;
    $('#peerPanel').innerHTML =
      `<div class="pp-head">${tr('접속 중 <b>{n}</b>명', { n: rows.length })}${unnamed ? ` <span class="muted">· ${tr('이름 없음 {n}', { n: unnamed })}</span>` : ''}</div>` +
      '<ul class="pp-list">' + rows.map(r =>
        `<li><span class="pp-dot" style="background:${r.color}"></span>` +
        `<span class="pp-name${r.name ? '' : ' muted'}">${r.name ? esc(r.name) : tr('이름 없음')}</span>` +
        (r.me ? `<span class="pp-tag me">${tr('나')}</span>` : '') +
        (r.presenter ? `<span class="pp-tag">${tr('발표 중')}</span>` : '') +
        (r.name && rosterNames.has(normName(r.name)) ? `<span class="pp-tag ok" title="${tr('공대 명단에 있는 이름')}">${tr('명단')}</span>` : '') +
        '</li>').join('') + '</ul>' +
      `<button class="btn small" id="ppRename" type="button">${me.name ? tr('내 이름 바꾸기') : tr('내 이름 넣기')}</button>`;
  }
  function closePeerPanel() {
    $('#peerPanel').hidden = true;
    $('#peersBtn').setAttribute('aria-expanded', 'false');
  }
  $('#peersBtn').addEventListener('click', e => {
    e.stopPropagation();
    const panel = $('#peerPanel');
    if (!panel.hidden) return closePeerPanel();
    renderPeerPanel();
    const r = $('#peersBtn').getBoundingClientRect();
    panel.style.top = (r.bottom + 6) + 'px';
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 268)) + 'px';
    panel.hidden = false;
    $('#peersBtn').setAttribute('aria-expanded', 'true');
  });
  $('#peerPanel').addEventListener('click', e => {
    if (e.target.closest('#ppRename')) { closePeerPanel(); askMyName(false); }
  });
  document.addEventListener('pointerdown', e => {
    if (!$('#peerPanel').hidden && !e.target.closest('#peerPanel, #peersBtn')) closePeerPanel();
  }, true);
  const normName = n => String(n || '').trim().toLowerCase();
  const onlineNames = () => new Set(peers.filter(p => p && p.name).map(p => normName(p.id === me.id ? me.name : p.name)));

  function renderBanner() {
    const pr = state.present;
    const bn = $('#presentBanner');
    const btn = $('#presentBtn');
    btn.textContent = presenting() ? tr('발표 종료') : tr('발표 시작');
    btn.classList.toggle('gold', !presenting());
    const sig = JSON.stringify([pr, view.follow, me.id, presentOn()]);
    if (!changed('banner', sig)) return;
    if (!presentOn()) { bn.hidden = true; return; }
    bn.hidden = false;
    if (pr.clientId === me.id) {
      bn.className = 'banner me';
      bn.innerHTML = `<span>📢 ${tr('발표 중입니다. 내가 보는 보스·단계를 모두가 따라봅니다.')}</span><button class="btn small" data-act="stop">${tr('발표 종료')}</button>`;
    } else {
      bn.className = 'banner';
      const who = esc(pr.name || tr('공대장'));
      bn.innerHTML = view.follow
        ? `<span>📢 ${tr('<b>{who}</b>님이 발표 중 · 따라가는 중', { who })}</span><button class="btn small" data-act="unfollow">${tr('따라가기 끄기')}</button>`
        : `<span>📢 ${tr('<b>{who}</b>님이 발표 중', { who })}</span><button class="btn small gold" data-act="follow">${tr('발표자 화면으로')}</button>`;
    }
  }

  // 공격대 표: 5명씩 파티, 2열. 공대원은 slot(0부터) 자리에 앉음
  const raidSize = () => {
    const n = state.meta && state.meta.size;
    if (RP.RAID_SIZES.includes(n)) return n;
    const count = Object.keys(state.roster || {}).length;
    return count > 20 ? 40 : count > 10 ? 20 : 20;
  };
  // 자리가 없거나 겹치는 공대원은 앞쪽 빈자리부터 채우고, 그래도 남으면 자리 밖(overflow)
  function layoutSlots(members, size) {
    const slots = new Array(size).fill(null), rest = [], assign = [], overflow = [];
    members.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(m => {
      const k = m.slot;
      if (Number.isInteger(k) && k >= 0 && k < size && !slots[k]) slots[k] = m; else rest.push(m);
    });
    rest.forEach(m => {
      const free = slots.indexOf(null);
      if (free >= 0) { slots[free] = m; assign.push([m.id, free]); } else overflow.push(m);
    });
    return { slots, assign, overflow };
  }
  const partyMembers = p => layoutSlots(list(state.roster), raidSize()).slots.slice(p * 5, p * 5 + 5).filter(Boolean);

  function memberChip(m, slot, toks, online) {
    const c = RP.classById(m.cls), r = RP.roleById(m.role);
    const placed = !!toks['m_' + m.id];
    const on = online.has(normName(m.name));
    return `<div class="${slot === null ? 'slot member loose' : 'slot member filled'}${placed ? ' placed' : ''}${on ? ' online' : ''}"` +
      `${slot === null ? '' : ` data-slot="${slot}"`} data-id="${esc(m.id)}" title="${esc(m.name)} · ${esc(RP.nm(c))} · ${esc(RP.nm(r))}${on ? ' · ' + tr('접속 중') : ''}">` +
      `<span class="chip" style="background:${c.color}"></span><span class="m-name">${esc(m.name)}</span>` +
      `<span class="s-role">${RP.short(r)}</span><span class="m-placed">${placed ? '✓' : ''}</span></div>`;
  }

  function renderRoster() {
    const members = list(state.roster);
    const size = raidSize();
    const toks = tokensOf(phase());
    const online = onlineNames();
    const sig = JSON.stringify([state.roster, size, Object.keys(toks).filter(k => k.startsWith('m_')).sort(), [...online].sort(), RP.lang()]);
    if (!changed('roster', sig)) return;
    const { slots, assign, overflow } = layoutSlots(members, size);
    if (assign.length && canEdit()) commit(assign.map(([id, k]) => [['roster', id, 'slot'], k]));
    $('#rosterCount').textContent = `${members.length}/${size}`;
    $('#roleCounts').innerHTML = RP.ROLES.map(r =>
      `<span>${RP.short(r)} <b>${members.filter(m => m.role === r.id).length}</b></span>`).join('');
    $('#sizePick').innerHTML = RP.RAID_SIZES.map(n =>
      `<button type="button" data-size="${n}" aria-pressed="${n === size}"${VIEW_ONLY ? ' disabled' : ''}>${tr('{n}인', { n })}</button>`).join('');
    let html = '<div class="party-grid">';
    for (let p = 0; p < size / 5; p++) {
      const inParty = slots.slice(p * 5, p * 5 + 5);
      html += `<div class="party"><div class="party-head" data-party-head="${p}" title="${tr('파티를 지도로 끌어다 놓으면 파티원이 함께 놓입니다')}">` +
        `<span>${tr('{n}파티', { n: p + 1 })}</span><span class="muted">${inParty.filter(Boolean).length}/5</span></div>`;
      inParty.forEach((m, i) => {
        const k = p * 5 + i;
        html += m ? memberChip(m, k, toks, online)
          : `<div class="slot vacant" data-slot="${k}">${VIEW_ONLY ? '' : '+ ' + tr('빈칸')}</div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    if (overflow.length) {
      html += `<div class="overflow"><h4>${tr('자리 밖 {n}명', { n: overflow.length })}</h4>` +
        overflow.map(m => memberChip(m, null, toks, online)).join('') + '</div>';
    }
    $('#rosterList').innerHTML = html;
  }

  function renderBossTabs() {
    const bs = bosses();
    const sig = JSON.stringify([bs.map(b => [b.id, b.name]), view.bossId, VIEW_ONLY]);
    if (!changed('bossTabs', sig)) return;
    $('#bossTabs').innerHTML = bs.map((b, i) =>
      `<button class="tab${b.id === view.bossId ? ' active' : ''}" data-boss="${esc(b.id)}"><span class="num">${i + 1}</span>${esc(b.name)}</button>`
    ).join('') + (VIEW_ONLY || !bs.length ? '' : `<button class="tab add" data-add-boss>+ ${tr('보스')}</button>`);
  }

  function renderPhaseTabs() {
    const ps = phases(boss());
    const sig = JSON.stringify([ps.map(p => [p.id, p.name]), view.phaseId, VIEW_ONLY]);
    if (!changed('phaseTabs', sig)) return;
    $('#phaseTabs').innerHTML = ps.map(p =>
      `<button class="tab${p.id === view.phaseId ? ' active' : ''}" data-phase="${esc(p.id)}">${esc(p.name)}</button>`
    ).join('') + (VIEW_ONLY || !ps.length ? '' : `<button class="tab add" data-add-phase title="${tr('현재 배치를 복사해서 새 단계를 만듭니다')}">+ ${tr('단계')}</button>`);
  }

  function renderPalette() {
    const toks = tokensOf(phase());
    const sig = RP.MARKERS.map(m => toks['k_' + m.id] ? 1 : 0).join('');
    if (!changed('palette', sig)) return;
    $('#palette').innerHTML =
      RP.MARKERS.map(m =>
        `<div class="pal-item${toks['k_' + m.id] ? ' used' : ''}" data-kind="marker" data-id="${m.id}" title="${tr('{name} 징표 · 클릭하거나 지도로 끌어다 놓기', { name: RP.nm(m) })}">${RP.markerSVG(m.id)}</div>`
      ).join('') +
      '<span class="pal-sep"></span>' +
      `<div class="pal-item boss" data-kind="boss" title="${tr('보스')} · ${tr('클릭할 때마다 오른쪽에 차례대로 추가, 끌면 원하는 곳에')}">${tr('보스')}</div>` +
      `<div class="pal-item add" data-kind="add" title="${tr('쫄')} · ${tr('클릭할 때마다 오른쪽에 차례대로 추가, 끌면 원하는 곳에')}">${tr('쫄')}</div>`;
  }

  // ---------- 지도 ----------
  const viewport = $('#viewport');
  const stage = $('#stage');
  const mapImg = $('#mapImg');
  const tokenLayer = $('#tokenLayer');
  const pingLayer = $('#pingLayer');
  let natW = 1000, natH = 1000, baseX = 0, baseY = 0, baseW = 0, baseH = 0;
  let zoomBoss = null;
  const FALLBACK = RP.templateSrc('grid');

  function mapSrc(b) {
    const m = (b && b.map) || {};
    if (m.kind === 'image' && typeof m.src === 'string' && /^(https?:|data:image\/)/i.test(m.src)) return m.src;
    return RP.templateSrc(m.template || 'circle');
  }

  function renderMap() {
    const b = boss();
    stage.hidden = !b;
    if (!b) return;
    if (zoomBoss !== view.bossId) {
      zoomBoss = view.bossId;
      view.zoom = 1; view.panX = 0; view.panY = 0;
      applyTransform();
    }
    const src = mapSrc(b);
    if (mapImg.dataset.want !== src) {
      mapImg.dataset.want = src;
      mapImg.src = src;
    }
  }
  mapImg.addEventListener('load', () => {
    natW = mapImg.naturalWidth || 1000;
    natH = mapImg.naturalHeight || 1000;
    layoutStage();
  });
  mapImg.addEventListener('error', () => {
    if (mapImg.src === FALLBACK) return;
    toast(tr('지형 이미지를 불러오지 못했습니다. 주소를 확인하세요'));
    mapImg.src = FALLBACK;
  });

  function layoutStage() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const pad = vw < 600 ? 8 : 24;
    // 작전 메모가 펼쳐져 있으면 넓은 화면에서는 오른쪽을 비워 지도를 가리지 않음
    const memoEl = document.getElementById('memo');
    const side = memoEl && !memoEl.hidden && vw >= 760 ? memoEl.offsetWidth + 12 : 0;
    const s = Math.max(0.01, Math.min((vw - side - pad * 2) / natW, (vh - pad * 2) / natH));
    baseW = natW * s; baseH = natH * s;
    stage.style.width = baseW + 'px';
    stage.style.height = baseH + 'px';
    baseX = (vw - side - baseW) / 2;
    baseY = (vh - baseH) / 2;
    stage.style.setProperty('--token', clamp(Math.min(baseW, baseH) / 22, 18, 32).toFixed(1) + 'px');
    const h = Math.round(SVG_W * natH / natW);
    if (h !== svgH) {
      svgH = h;
      drawSvg.setAttribute('viewBox', `0 0 ${SVG_W} ${svgH}`);
      fxSvg.setAttribute('viewBox', `0 0 ${SVG_W} ${svgH}`);
      renderDrawings();
    }
    applyTransform();
  }
  function applyTransform() {
    stage.style.transform = `translate(${baseX + view.panX}px, ${baseY + view.panY}px) scale(${view.zoom})`;
    stage.style.setProperty('--inv', String(1 / view.zoom));
    $('#zoomReset').textContent = Math.round(view.zoom * 100) + '%';
    if (typeof renderEffects === 'function' && fxReady) renderEffects();
  }
  function zoomAt(cx, cy, factor) {
    const z = clamp(view.zoom * factor, 0.5, 8);
    const ux = (cx - baseX - view.panX) / view.zoom;
    const uy = (cy - baseY - view.panY) / view.zoom;
    view.panX = cx - baseX - ux * z;
    view.panY = cy - baseY - uy * z;
    view.zoom = z;
    applyTransform();
  }
  new ResizeObserver(layoutStage).observe(viewport);

  function stagePoint(cx, cy) {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height };
  }
  function inViewport(cx, cy) {
    const r = viewport.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }
  function viewCenterPoint() {
    const r = viewport.getBoundingClientRect();
    return stagePoint(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ---------- 토큰 ----------
  const tokenEls = new Map();
  let hlMember = null;
  let lastPhaseKey = '';

  function tokenInfo(t) {
    if (!t || typeof t !== 'object') return null;
    if (t.type === 'member') {
      const m = state.roster && state.roster[t.ref];
      if (!m) return null;
      const c = RP.classById(m.cls), r = RP.roleById(m.role);
      return {
        cls: 'member', member: t.ref, title: `${m.name} · ${RP.nm(c)} · ${RP.nm(r)}`,
        html: `<div class="disc" style="background:${c.color}">${RP.short(r)}</div><div class="label">${esc(m.name)}</div>`
      };
    }
    if (t.type === 'marker') {
      const mk = RP.MARKERS.find(x => x.id === Number(t.ref));
      if (!mk) return null;
      return { cls: 'marker', title: tr('{name} 징표', { name: RP.nm(mk) }), html: `<div class="disc">${RP.markerSVG(mk.id)}</div>` };
    }
    if (t.type === 'boss' || t.type === 'add') {
      const def = t.type === 'boss' ? tr('보스') : tr('쫄');
      const label = t.label && t.label !== def ? `<div class="label">${esc(t.label)}</div>` : '';
      return { cls: t.type, title: (t.label || def) + ' · ' + tr('클릭해서 이름 바꾸기'), html: `<div class="disc">${def}</div>${label}` };
    }
    if (t.type === 'text') {
      const col = validColor(t.color) ? t.color : '#ffffff';
      const bg = isDark(col) ? 'background:rgba(255,255,255,.88);' : '';
      return { cls: 'text', title: t.label || '', html: `<div class="disc"></div><div class="label" style="color:${col};${bg}">${esc(t.label || '')}</div>` };
    }
    return null;
  }

  function renderTokens() {
    const key = view.bossId + '/' + view.phaseId;
    if (key !== lastPhaseKey) {
      if (lastPhaseKey.split('/')[0] === view.bossId) {
        tokenLayer.classList.add('animate');
        fxSvg.classList.add('hide');
        setTimeout(() => { tokenLayer.classList.remove('animate'); fxSvg.classList.remove('hide'); }, 600);
      }
      lastPhaseKey = key;
      if (view.linking) endLinking();
      closeActionMenu();
    }
    const toks = tokensOf(phase());
    const seen = new Set();
    for (const id of Object.keys(toks)) {
      const t = toks[id];
      const info = tokenInfo(t);
      if (!info || typeof t.x !== 'number' || typeof t.y !== 'number') continue;
      seen.add(id);
      let el = tokenEls.get(id);
      const dragging = drag && drag.id === id;
      if (!el) {
        el = document.createElement('div');
        el.dataset.id = id;
        el.style.left = (t.x * 100) + '%';
        el.style.top = (t.y * 100) + '%';
        tokenLayer.appendChild(el);
        tokenEls.set(id, el);
      }
      if (el._html !== info.html) { el.innerHTML = info.html; el._html = info.html; }
      const cls = 'token ' + info.cls + (dragging && drag.moved ? ' dragging' : '') +
        (dragging && drag.out ? ' remove-hint' : '') +
        (dragging && drag.lp && !drag.moved ? ' pressing' : '') +
        (view.linking && view.linking.from === id ? ' link-src' : '') +
        (view.linking && linkTargetOk(id) ? ' target-ok' : '') +
        (info.member && info.member === hlMember ? ' hl' : '');
      if (el.className !== cls) el.className = cls;
      el.title = info.title;
      el.dataset.member = info.member || '';
      if (!dragging) {
        el.style.left = (t.x * 100) + '%';
        el.style.top = (t.y * 100) + '%';
      }
    }
    for (const [id, el] of tokenEls) {
      if (!seen.has(id) && !(drag && drag.id === id)) { el.remove(); tokenEls.delete(id); }
    }
  }

  function setHighlight(memberId) {
    hlMember = memberId;
    document.querySelectorAll('.member.hl').forEach(e => e.classList.remove('hl'));
    for (const el of tokenEls.values()) el.classList.toggle('hl', !!memberId && el.dataset.member === memberId);
    if (memberId) {
      const m = document.querySelector(`.member[data-id="${CSS.escape(memberId)}"]`);
      if (m) m.classList.add('hl');
    }
  }

  tokenLayer.addEventListener('pointerover', e => {
    const el = e.target.closest('.token');
    if (el && el.dataset.member) setHighlight(el.dataset.member);
  });
  tokenLayer.addEventListener('pointerout', e => {
    const el = e.target.closest('.token');
    if (el && !el.contains(e.relatedTarget) && !drag) setHighlight(null);
  });

  tokenLayer.addEventListener('pointerdown', e => {
    const el = e.target.closest('.token');
    if (!el) return;
    if (view.linking) { e.stopPropagation(); e.preventDefault(); pickLinkTarget(el.dataset.id); return; }
    if (e.altKey || view.pingMode || view.tool !== 'select' || spaceHeld) return; // 핑·지우개·지도 이동은 viewport 가 처리
    e.stopPropagation();
    if (!canEdit() || e.button !== 0) return;
    const id = el.dataset.id;
    const t = tokensOf(phase())[id];
    if (!t) return;
    drag = { id, el, path: [...phasePath(), 'tokens', id], value: clone(t), sx: e.clientX, sy: e.clientY, moved: false, out: false, lp: 0 };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    window.addEventListener('pointermove', onTokenMove);
    window.addEventListener('pointerup', onTokenUp);
    window.addEventListener('pointercancel', onTokenUp);
    // 공대원을 2초 누르고 있으면 공격·탱·힐 메뉴
    if (t.type === 'member') {
      drag.lp = setTimeout(() => {
        if (!drag || drag.id !== id || drag.moved) return;
        stopTokenDrag();
        openActionMenu(id);
      }, LONG_PRESS_MS);
      scheduleRender();
    }
  });
  function stopTokenDrag() {
    window.removeEventListener('pointermove', onTokenMove);
    window.removeEventListener('pointerup', onTokenUp);
    window.removeEventListener('pointercancel', onTokenUp);
    if (!drag) return null;
    const d = drag;
    drag = null;
    clearTimeout(d.lp);
    endThrottle(d.path);
    d.el.classList.remove('dragging', 'remove-hint', 'pressing');
    scheduleRender();
    return d;
  }
  function onTokenMove(e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      clearTimeout(drag.lp);
      drag.lp = 0;
      drag.el.classList.remove('pressing');
      drag.el.classList.add('dragging');
    }
    const pt = stagePoint(e.clientX, e.clientY);
    if (!pt) return;
    const out = pt.x < -0.03 || pt.x > 1.03 || pt.y < -0.03 || pt.y > 1.03 || !inViewport(e.clientX, e.clientY);
    drag.out = out;
    drag.el.classList.toggle('remove-hint', out);
    drag.el.style.left = (pt.x * 100) + '%';
    drag.el.style.top = (pt.y * 100) + '%';
    drag.value = Object.assign({}, drag.value, { x: round(clamp(pt.x, 0, 1)), y: round(clamp(pt.y, 0, 1)) });
    if (!out) setThrottled(drag.path, drag.value);
    renderEffects();
  }
  function onTokenUp(e) {
    const d = stopTokenDrag();
    if (!d) return;
    if (d.moved && e.type !== 'pointercancel') {
      if (d.out) { commit(removeTokenOps(d.path.slice(0, 4), d.id)); toast(tr('배치를 해제했습니다')); }
      else set(d.path, d.value);
    } else if (!d.moved && e.type !== 'pointercancel') {
      renameToken(d.path);
    }
    scheduleRender();
  }

  // 보스·쫄·글자를 클릭하면 이름 바꾸기
  async function renameToken(path) {
    const t = getIn(state, path);
    if (!t || !['boss', 'add', 'text'].includes(t.type)) return;
    const title = t.type === 'boss' ? tr('보스 이름') : t.type === 'add' ? tr('쫄 이름') : tr('지도에 쓸 글자');
    const label = await ask({ title, value: t.label || '' });
    if (label === null || !getIn(state, path)) return;
    const v = label.trim().slice(0, 40);
    if (!v && t.type === 'text') set(path, null);
    else if (!v) set(path.concat('label'), tr(t.type === 'boss' ? '보스 {n}' : '쫄 {n}', { n: t.n || 1 }));
    else set(path.concat('label'), v);
  }
  // 우클릭으로 삭제 (휴대폰에서 길게 눌렀을 때 뜨는 메뉴로 지워지지 않게 마우스일 때만)
  let lastPointerType = 'mouse';
  document.addEventListener('pointerdown', e => { lastPointerType = e.pointerType; }, true);
  tokenLayer.addEventListener('contextmenu', e => {
    const el = e.target.closest('.token');
    if (!el || !canEdit()) return;
    e.preventDefault();
    if (lastPointerType !== 'mouse' || view.linking) return;
    commit(removeTokenOps(phasePath(), el.dataset.id));
  });
  // 토큰을 지울 때 그 토큰과 이어진 행동(공격·탱·힐)도 함께 지움
  function removeTokenOps(base, tokenId) {
    const ph = getIn(state, base);
    const links = (ph && ph.links) || {};
    const ops = [[base.concat('tokens', tokenId), null]];
    const gone = Object.keys(links).filter(lid => links[lid] && (links[lid].from === tokenId || links[lid].to === tokenId));
    gone.forEach(lid => ops.push([base.concat('links', lid), null]));
    return ops.concat(renumberOps(base, links, gone));
  }

  // ---------- 그리기 (그림판) ----------
  // 그림은 단계마다 draw/{id} 에 저장. 좌표는 지도 기준 0~1, 굵기는 지도 폭 1000 기준.
  const drawSvg = $('#drawLayer');
  const SVG_W = 1000;
  let svgH = 1000;
  const drawEls = new Map();
  const myShapes = []; // 되돌리기: 내가 그린 것의 경로
  let spaceHeld = false;
  const PAINT_COLORS = [
    '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
    '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'
  ];
  const WIDTHS = [3, 6, 12];
  const TOOLS = [
    { id: 'select', key: 'v', name: '선택·이동 (V)', icon: '<path d="M6 3l12 9-5.5 1.2L15 19l-2.4 1-2.4-5.6L6 18z"/>' },
    { id: 'pen', key: 'p', name: '펜 (P)', icon: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>' },
    { id: 'line', key: 'l', name: '직선 (L) · Shift: 45°', icon: '<path d="M5 19L19 5"/>' },
    { id: 'arrow', key: 'a', name: '화살표 (A) · Shift: 45°', icon: '<path d="M5 19L19 5M11 5h8v8"/>' },
    { id: 'ellipse', key: 'o', name: '원 (O) · Shift: 정원', icon: '<circle cx="12" cy="12" r="8"/>' },
    { id: 'rect', key: 'r', name: '사각형 (R) · Shift: 정사각형', icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
    { id: 'text', key: 't', name: '글자 (T)', icon: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>' },
    { id: 'eraser', key: 'e', name: '지우개 (E) · 그림과 글자를 문질러 지웁니다', icon: '<path d="M3 16l9-9 7 7-5 5H8zM10 21h11"/>' }
  ];
  const draw = {
    color: validColor(local.get('rp-draw-color')) ? local.get('rp-draw-color') : '#ed1c24',
    width: WIDTHS.includes(Number(local.get('rp-draw-width'))) ? Number(local.get('rp-draw-width')) : 6,
    fill: local.get('rp-draw-fill') === '1',
    dash: local.get('rp-draw-dash') === '1'
  };

  function validColor(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }
  function isDark(c) {
    const n = parseInt(c.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.4;
  }

  const P = (x, y) => `${(x * SVG_W).toFixed(1)} ${(y * svgH).toFixed(1)}`;
  const parsePts = d => String(d || '').split(' ')
    .map(s => s.split(',').map(Number)).filter(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1]));

  function shapeSVG(s) {
    const c = validColor(s.c) ? s.c : '#ed1c24';
    const w = clamp(Number(s.w) || 6, 1, 40);
    const line = `stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
    const st = line + (s.dash ? ` stroke-dasharray="${w * 2.2} ${w * 1.9}"` : '');
    const hitW = Math.max(w, 18);
    if (s.t === 'pen') {
      const pts = parsePts(s.d);
      if (!pts.length) return '';
      let d = 'M' + P(pts[0][0], pts[0][1]);
      if (pts.length === 1) d += ' L' + P(pts[0][0] + 0.0005, pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        d += ' Q' + P(pts[i][0], pts[i][1]) + ' ' + P((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      }
      if (pts.length > 1) d += ' L' + P(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      return `<path d="${d}" fill="none" ${st}/><path class="hit" d="${d}" stroke-width="${hitW}"/>`;
    }
    const x1 = Number(s.x1), y1 = Number(s.y1), x2 = Number(s.x2), y2 = Number(s.y2);
    if (![x1, y1, x2, y2].every(isFinite)) return '';
    if (s.t === 'line' || s.t === 'arrow') {
      const d = 'M' + P(x1, y1) + ' L' + P(x2, y2);
      let head = '';
      if (s.t === 'arrow') {
        const ax = x1 * SVG_W, ay = y1 * svgH, bx = x2 * SVG_W, by = y2 * svgH;
        const ang = Math.atan2(by - ay, bx - ax), len = Math.max(16, w * 3.4);
        const h1 = `${(bx - len * Math.cos(ang - 0.45)).toFixed(1)} ${(by - len * Math.sin(ang - 0.45)).toFixed(1)}`;
        const h2 = `${(bx - len * Math.cos(ang + 0.45)).toFixed(1)} ${(by - len * Math.sin(ang + 0.45)).toFixed(1)}`;
        head = `<path d="M${h1} L${bx.toFixed(1)} ${by.toFixed(1)} L${h2}" fill="none" ${line}/>`;
      }
      return `<path d="${d}" fill="none" ${st}/>${head}<path class="hit" d="${d}" stroke-width="${hitW}"/>`;
    }
    const fill = s.fill ? `fill="${c}" fill-opacity=".28"` : 'fill="none"';
    const L = Math.min(x1, x2) * SVG_W, T = Math.min(y1, y2) * svgH;
    const W = Math.abs(x2 - x1) * SVG_W, H = Math.abs(y2 - y1) * svgH;
    if (s.t === 'rect') {
      const a = `x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" rx="2"`;
      return `<rect ${a} ${fill} ${st}/><rect class="hit" ${a} stroke-width="${hitW}"/>`;
    }
    if (s.t === 'ellipse') {
      const a = `cx="${(L + W / 2).toFixed(1)}" cy="${(T + H / 2).toFixed(1)}" rx="${(W / 2).toFixed(1)}" ry="${(H / 2).toFixed(1)}"`;
      return `<ellipse ${a} ${fill} ${st}/><ellipse class="hit" ${a} stroke-width="${hitW}"/>`;
    }
    return '';
  }

  function renderDrawings() {
    const shapes = (phase() && phase().draw) || {};
    const ids = Object.keys(shapes).filter(id => shapes[id] && typeof shapes[id] === 'object')
      .sort((a, b) => (shapes[a].o || 0) - (shapes[b].o || 0) || a.localeCompare(b));
    const seen = new Set();
    let prev = null;
    for (const id of ids) {
      const sig = JSON.stringify(shapes[id]) + '|' + svgH;
      let g = drawEls.get(id);
      if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.dataset.shape = id;
        drawEls.set(id, g);
      }
      if (g._sig !== sig) { g.innerHTML = shapeSVG(shapes[id]); g._sig = sig; }
      const want = prev ? prev.nextSibling : drawSvg.firstChild;
      if (g !== want) drawSvg.insertBefore(g, want);
      prev = g;
      seen.add(id);
    }
    for (const [id, g] of drawEls) if (!seen.has(id)) { g.remove(); drawEls.delete(id); }
  }

  function startDraw(e) {
    const pt = stagePoint(e.clientX, e.clientY);
    if (!pt || !phase()) return;
    if (view.tool === 'text') return placeText(pt);
    if (view.tool === 'eraser') {
      eraseAt(e.clientX, e.clientY);
      return track(ev => eraseAt(ev.clientX, ev.clientY), () => {});
    }
    const path = [...phasePath(), 'draw', 'd' + RP.uid(7)];
    const x = round(clamp(pt.x, 0, 1)), y = round(clamp(pt.y, 0, 1));
    const shape = { t: view.tool, c: draw.color, w: draw.width, o: Date.now(), by: me.id };
    if (draw.dash) shape.dash = 1;
    if (draw.fill && (view.tool === 'rect' || view.tool === 'ellipse')) shape.fill = 1;
    if (view.tool === 'pen') shape.d = `${x},${y}`;
    else Object.assign(shape, { x1: x, y1: y, x2: x, y2: y });
    let last = [e.clientX, e.clientY];
    const r = stage.getBoundingClientRect();
    const update = () => { setThrottled(path, Object.assign({}, shape)); renderDrawings(); };
    update();
    track(ev => {
      const p = stagePoint(ev.clientX, ev.clientY);
      if (!p) return;
      let nx = round(clamp(p.x, 0, 1)), ny = round(clamp(p.y, 0, 1));
      if (shape.t === 'pen') {
        if (Math.hypot(ev.clientX - last[0], ev.clientY - last[1]) < 3) return;
        last = [ev.clientX, ev.clientY];
        if (shape.d.length > 8000) return;
        shape.d += ` ${nx},${ny}`;
      } else {
        if (ev.shiftKey) {
          const dx = (nx - shape.x1) * r.width, dy = (ny - shape.y1) * r.height;
          if (shape.t === 'line' || shape.t === 'arrow') {
            const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            nx = round(shape.x1 + Math.cos(ang) * len / r.width);
            ny = round(shape.y1 + Math.sin(ang) * len / r.height);
          } else {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            nx = round(shape.x1 + Math.sign(dx || 1) * m / r.width);
            ny = round(shape.y1 + Math.sign(dy || 1) * m / r.height);
          }
        }
        shape.x2 = nx; shape.y2 = ny;
      }
      update();
    }, () => {
      endThrottle(path);
      const tiny = shape.t !== 'pen' && Math.abs(shape.x2 - shape.x1) < 0.004 && Math.abs(shape.y2 - shape.y1) < 0.004;
      if (tiny) set(path, null);
      else { set(path, shape); myShapes.push(path); }
    });
  }

  function track(onMove, onEnd) {
    const up = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function eraseAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    if (!el) return;
    const g = el.closest('[data-shape]');
    if (g && drawSvg.contains(g)) return set([...phasePath(), 'draw', g.dataset.shape], null);
    const tk = el.closest('.token');
    const t = tk && tokensOf(phase())[tk.dataset.id];
    if (t && t.type === 'text') set([...phasePath(), 'tokens', tk.dataset.id], null);
  }

  async function placeText(pt) {
    const path = [...phasePath(), 'tokens', 'x_' + RP.uid(6)];
    const label = await ask({ title: tr('지도에 쓸 글자'), value: '' });
    if (!label || !label.trim()) return;
    set(path, { type: 'text', label: label.trim().slice(0, 40), color: draw.color, x: round(clamp(pt.x, 0, 1)), y: round(clamp(pt.y, 0, 1)) });
    myShapes.push(path);
  }

  function undo() {
    if (!canEdit()) return;
    while (myShapes.length) {
      const p = myShapes.pop();
      if (getIn(state, p)) { set(p, null); return; }
    }
    toast(tr('되돌릴 그림이 없습니다'));
  }

  function setTool(id) {
    view.tool = id;
    document.querySelectorAll('#toolBtns [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    viewport.classList.toggle('tool-draw', !['select', 'eraser'].includes(id));
    viewport.classList.toggle('tool-eraser', id === 'eraser');
    if (view.pingMode) togglePing(false);
  }

  function renderDrawbar() {
    document.querySelectorAll('#colorBtns .swatch').forEach(b => b.classList.toggle('active', b.dataset.color === draw.color));
    document.querySelectorAll('#widthBtns [data-w]').forEach(b => b.classList.toggle('active', Number(b.dataset.w) === draw.width));
    $('#fillBtn').classList.toggle('active', draw.fill);
    $('#dashBtn').classList.toggle('active', draw.dash);
    $('#colorCustom').value = draw.color;
    document.querySelectorAll('#widthBtns .width-line').forEach(l => { l.style.background = draw.color; });
  }
  function saveDraw() {
    local.set('rp-draw-color', draw.color);
    local.set('rp-draw-width', String(draw.width));
    local.set('rp-draw-fill', draw.fill ? '1' : '0');
    local.set('rp-draw-dash', draw.dash ? '1' : '0');
    renderDrawbar();
  }

  function buildDrawbar() {
    $('#toolBtns').innerHTML = TOOLS.map(t =>
      `<button class="tbtn" data-tool="${t.id}" title="${tr(t.name)}"><svg viewBox="0 0 24 24">${t.icon}</svg></button>`).join('');
    $('#colorBtns').innerHTML = PAINT_COLORS.map(c =>
      `<button class="swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
    $('#widthBtns').innerHTML = WIDTHS.map((w, i) =>
      `<button class="tbtn" data-w="${w}" title="${tr(['가늘게', '보통', '굵게'][i])}"><span class="width-line" style="height:${[2, 4, 7][i]}px"></span></button>`).join('');
  }
  buildDrawbar();
  $('#toolBtns').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#colorBtns').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    draw.color = b.dataset.color;
    saveDraw();
    if (view.tool === 'select' || view.tool === 'eraser') setTool('pen');
  });
  $('#colorCustom').addEventListener('input', e => { if (validColor(e.target.value)) { draw.color = e.target.value.toLowerCase(); saveDraw(); } });
  $('#widthBtns').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) { draw.width = Number(b.dataset.w); saveDraw(); } });
  $('#fillBtn').onclick = () => { draw.fill = !draw.fill; saveDraw(); };
  $('#dashBtn').onclick = () => { draw.dash = !draw.dash; saveDraw(); };
  $('#undoBtn').onclick = undo;
  $('#clearDrawBtn').onclick = () => {
    const p = phase();
    if (!p || !p.draw) return toast(tr('지울 그림이 없습니다'));
    const path = [...phasePath(), 'draw'];
    ask({ title: tr('이 단계의 그림을 모두 지울까요?'), message: tr('공대원과 징표 배치는 그대로 둡니다.'), ok: tr('지우기'), danger: true })
      .then(ok => { if (ok) set(path, null); });
  };
  setTool('select');
  renderDrawbar();

  // ---------- 행동 연결: 공격·탱·힐 이펙트 ----------
  // 단계마다 links/l_<공대원토큰> = { from, to, kind } (공대원 한 명당 공격·탱·힐 중 하나)
  //          links/i_<공대원토큰> = { from, to, kind: 'interrupt', n } (차단은 따로, 같은 대상에 순서 번호)
  //   탱: 탱커 → 보스 사이 흐르는 사슬과 방패, 보스 둘레 어그로 고리
  //   공격: 원딜·힐러는 투명한 공격 선 위로 발사체, 근딜·탱커는 대상 앞 베기 자국
  //   힐: 힐러 → 공대원 사이 투명한 힐링 선과 날아가는 + 표시, 대상 둘레 초록 고리
  //   차단: 보라색 점선과 순서 번호, 대상 모서리에 깜빡이는 ⊘
  const fxSvg = $('#fxLayer');
  const fxPreview = $('#fxPreview');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const KIND_KO = { attack: '공격', tank: '탱', heal: '힐', interrupt: '차단' };
  const kindName = k => tr(KIND_KO[k] || '');
  const HEAL_COLOR = '#5cf08a', TANK_COLOR = '#ffb347', KICK_COLOR = '#b9a0ff';
  const linkId = (kind, from) => (kind === 'interrupt' ? 'i_' : 'l_') + from;
  const fxEls = new Map();
  let menuFor = null;

  const linksOf = p => (p && p.links) || {};
  const isEnemy = t => !!t && (t.type === 'boss' || t.type === 'add' || t.type === 'marker');
  const memberOf = t => (t && t.type === 'member' && state.roster && state.roster[t.ref]) || null;

  function linkTargetOk(id) {
    const L = view.linking;
    if (!L || id === L.from) return false;
    const t = tokensOf(phase())[id];
    return L.kind === 'heal' ? !!memberOf(t) : isEnemy(t);
  }
  function tokenPos(id) {
    if (drag && drag.id === id && drag.moved) return drag.value;
    const t = tokensOf(phase())[id];
    return t && typeof t.x === 'number' ? t : null;
  }
  function fxType(l, from) {
    if (l.kind === 'heal' || l.kind === 'tank' || l.kind === 'interrupt') return l.kind;
    const role = RP.roleById(memberOf(from).role).id;
    return role === 'ranged' || role === 'healer' ? 'ranged' : 'melee';
  }
  // 대상 토큰의 화면상 반지름(px): 이펙트가 토큰 가장자리에 맞도록
  function targetRadius(t) {
    const px = parseFloat(getComputedStyle(stage).getPropertyValue('--token')) || 28;
    return px * (t.type === 'boss' ? 0.8 : t.type === 'add' ? 0.4 : t.type === 'marker' ? 0.55 : 0.5);
  }

  function fxMarkup(type, c, k, R, num) {
    const n = v => (v * k).toFixed(1);
    const a = s => (reduceMotion ? '' : s);
    if (type === 'tank') {
      return `<path data-p="line" fill="none" stroke="${c}" stroke-opacity=".2" stroke-width="${n(12)}" stroke-linecap="round"/>` +
        `<path data-p="line" fill="none" stroke="${c}" stroke-opacity=".85" stroke-width="${n(4)}" stroke-dasharray="${n(14)} ${n(9)}" stroke-linecap="round">` +
        a(`<animate attributeName="stroke-dashoffset" from="0" to="${n(-46)}" dur="0.9s" repeatCount="indefinite"/>`) + '</path>' +
        `<g data-p="target"><circle r="${n(R + 8)}" fill="none" stroke="#ff5a3c" stroke-width="${n(3)}" stroke-opacity=".8">` +
        a(`<animate attributeName="r" values="${n(R + 6)};${n(R + 20)};${n(R + 6)}" dur="1.4s" repeatCount="indefinite"/>` +
          '<animate attributeName="stroke-opacity" values=".9;.15;.9" dur="1.4s" repeatCount="indefinite"/>') + '</circle></g>' +
        `<g data-p="mid"><g transform="scale(${k.toFixed(3)})"><path d="M0 -13 L11 -8 V1 C11 8 6 12 0 15 C-6 12 -11 8 -11 1 V-8 Z" fill="${c}" stroke="#3a2200" stroke-width="2"/>` +
        '<path d="M0 -7 V9 M-5 0 H5" stroke="#3a2200" stroke-width="2" stroke-linecap="round"/></g></g>';
    }
    if (type === 'heal') {
      const plus = [0, 1, 2].map(i => `<g>${a(`<animateMotion data-p="motion" dur="1.2s" begin="-${(i * 0.4).toFixed(1)}s" repeatCount="indefinite" path="M0 0"/>`)}` +
        `<path d="M${n(-5)} 0H${n(5)}M0 ${n(-5)}V${n(5)}" stroke="#e2ffea" stroke-width="${n(3)}" stroke-linecap="round"/></g>`).join('');
      return `<path data-p="line" fill="none" stroke="${c}" stroke-opacity=".16" stroke-width="${n(12)}" stroke-linecap="round"/>` +
        `<path data-p="line" fill="none" stroke="${c}" stroke-opacity=".55" stroke-width="${n(3)}" stroke-dasharray="${n(7)} ${n(7)}" stroke-linecap="round">` +
        a(`<animate attributeName="stroke-dashoffset" from="0" to="${n(-28)}" dur="0.8s" repeatCount="indefinite"/>`) + '</path>' +
        (reduceMotion ? '' : plus) +
        `<g data-p="target"><circle r="${n(R + 6)}" fill="${c}" fill-opacity=".12" stroke="${c}" stroke-opacity=".8" stroke-width="${n(2.5)}">` +
        a(`<animate attributeName="r" values="${n(R + 4)};${n(R + 14)};${n(R + 4)}" dur="1.6s" repeatCount="indefinite"/>`) + '</circle></g>';
    }
    if (type === 'ranged') {
      const bolts = [0, 1, 2].map(i => `<g>${a(`<animateMotion data-p="motion" dur="0.9s" begin="-${(i * 0.3).toFixed(1)}s" repeatCount="indefinite" path="M0 0"/>`)}` +
        `<circle r="${n(9)}" fill="${c}" fill-opacity=".28"/><circle r="${n(4.5)}" fill="${c}"/><circle r="${n(2)}" fill="#fff"/></g>`).join('');
      return `<path data-p="line" fill="none" stroke="${c}" stroke-opacity=".3" stroke-width="${n(3)}" stroke-linecap="round"/>` +
        (reduceMotion ? '' : bolts) +
        `<g data-p="target"><circle r="${n(R + 4)}" fill="none" stroke="${c}" stroke-width="${n(3)}" stroke-opacity="${reduceMotion ? '.7' : '0'}">` +
        a(`<animate attributeName="r" values="${n(R)};${n(R + 16)}" dur="0.3s" repeatCount="indefinite"/>` +
          '<animate attributeName="stroke-opacity" values=".8;0" dur="0.3s" repeatCount="indefinite"/>') + '</circle></g>';
    }
    if (type === 'interrupt') {
      return `<path data-p="line" fill="none" stroke="${c}" stroke-opacity=".45" stroke-width="${n(2.5)}" stroke-dasharray="${n(3)} ${n(6)}" stroke-linecap="round">` +
        a(`<animate attributeName="stroke-dashoffset" from="0" to="${n(-18)}" dur="0.6s" repeatCount="indefinite"/>`) + '</path>' +
        `<g data-p="corner"><g transform="scale(${k.toFixed(3)})"><circle r="9" fill="#1b1030" stroke="${c}" stroke-width="2.5"/><path d="M-5.5 -5.5L5.5 5.5" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>` +
        a('<animate attributeName="opacity" values="1;.35;1" dur="1s" repeatCount="indefinite"/>') + '</g></g>' +
        `<g data-p="badge"><g transform="scale(${k.toFixed(3)})"><circle r="9" fill="${c}" stroke="#1b1030" stroke-width="2"/>` +
        `<text y="4" text-anchor="middle" font-size="11" font-weight="800" fill="#1b1030" font-family="sans-serif">${num}</text></g></g>`;
    }
    // 근거리: 대상 앞(공격자 쪽)에서 베기 자국이 번쩍임
    const slash = (d, col, w, begin) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${n(w)}" stroke-linecap="round" opacity="${reduceMotion ? '.9' : '0'}">` +
      a(`<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;.12;.45;1" dur="0.8s" begin="${begin}" repeatCount="indefinite"/>`) + '</path>';
    const x0 = R + 4;
    return `<path data-p="line" fill="none" stroke="${c}" stroke-opacity=".3" stroke-width="${n(3)}" stroke-linecap="round"/>` +
      `<g data-p="face">` +
      slash(`M${n(x0 + 4)} ${n(-14)} Q${n(x0 + 14)} 0 ${n(x0 + 4)} ${n(14)}`, '#ffffff', 3.5, '0s') +
      slash(`M${n(x0)} ${n(-13)} L${n(x0 + 13)} ${n(11)}`, c, 3.5, '-0.4s') +
      slash(`M${n(x0 + 13)} ${n(-11)} L${n(x0)} ${n(13)}`, c, 3.5, '-0.2s') + '</g>';
  }

  function renderEffects() {
    fxReady = true;
    const ph = phase(), toks = tokensOf(ph), links = linksOf(ph);
    const r = stage.getBoundingClientRect();
    const k = r.width ? SVG_W / r.width : 1; // 화면 1px 이 SVG 몇 단위인지 (확대해도 이펙트 크기 일정)
    const seen = new Set();
    for (const id of Object.keys(links)) {
      const l = links[id];
      if (!l || typeof l !== 'object') continue;
      const from = toks[l.from], to = toks[l.to];
      if (!memberOf(from) || !to || l.from === l.to) continue;
      if (l.kind === 'heal' ? !memberOf(to) : !isEnemy(to)) continue;
      const A = tokenPos(l.from), B = tokenPos(l.to);
      if (!A || !B) continue;
      const type = fxType(l, from);
      const color = type === 'heal' ? HEAL_COLOR : type === 'tank' ? TANK_COLOR : type === 'interrupt' ? KICK_COLOR : RP.classById(memberOf(from).cls).color;
      const R = targetRadius(to), Rs = targetRadius(from);
      const num = l.n || 1;
      const key = [type, color, k.toFixed(2), R.toFixed(1), num].join('|');
      let g = fxEls.get(id);
      if (!g) {
        g = document.createElementNS(SVGNS, 'g');
        fxSvg.insertBefore(g, fxPreview);
        fxEls.set(id, g);
      }
      if (g._key !== key) { g.innerHTML = fxMarkup(type, color, k, R, num); g._key = key; g._pos = ''; }
      const ax = A.x * SVG_W, ay = A.y * svgH, bx = B.x * SVG_W, by = B.y * svgH;
      const pos = [ax, ay, bx, by].map(v => v.toFixed(1)).join(',');
      if (g._pos !== pos) {
        g._pos = pos;
        const d = `M${ax.toFixed(1)} ${ay.toFixed(1)} L${bx.toFixed(1)} ${by.toFixed(1)}`;
        const ang = Math.atan2(ay - by, ax - bx) * 180 / Math.PI;
        g.querySelectorAll('[data-p="line"]').forEach(e => e.setAttribute('d', d));
        g.querySelectorAll('[data-p="motion"]').forEach(e => e.setAttribute('path', d));
        g.querySelectorAll('[data-p="target"]').forEach(e => e.setAttribute('transform', `translate(${bx.toFixed(1)} ${by.toFixed(1)})`));
        g.querySelectorAll('[data-p="mid"]').forEach(e => e.setAttribute('transform', `translate(${((ax + bx) / 2).toFixed(1)} ${((ay + by) / 2).toFixed(1)})`));
        g.querySelectorAll('[data-p="face"]').forEach(e => e.setAttribute('transform', `translate(${bx.toFixed(1)} ${by.toFixed(1)}) rotate(${ang.toFixed(1)})`));
        // 차단: 대상 오른쪽 위 모서리에 ⊘, 공대원 바로 앞 선 위에 순서 번호
        const off = (R * 0.72 + 6) * k;
        g.querySelectorAll('[data-p="corner"]').forEach(e => e.setAttribute('transform', `translate(${(bx + off).toFixed(1)} ${(by - off).toFixed(1)})`));
        const len = Math.hypot(bx - ax, by - ay);
        const t = len ? Math.min(0.45, (Rs + 16) * k / len) : 0;
        g.querySelectorAll('[data-p="badge"]').forEach(e => e.setAttribute('transform', `translate(${(ax + (bx - ax) * t).toFixed(1)} ${(ay + (by - ay) * t).toFixed(1)})`));
      }
      seen.add(id);
    }
    for (const [id, g] of fxEls) if (!seen.has(id)) { g.remove(); fxEls.delete(id); }
  }

  // 길게 눌렀을 때 뜨는 메뉴
  const ACT_ICON = {
    attack: '<path d="M14 4h6v6L9.5 20.5l-6-6zM4 20l3-3M7.5 12.5l4 4"/>',
    tank: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    heal: '<path d="M12 5v14M5 12h14"/>',
    interrupt: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
    clear: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  function openActionMenu(tokenId) {
    const el = tokenEls.get(tokenId);
    const m = memberOf(tokensOf(phase())[tokenId]);
    if (!el || !m || !canEdit()) return;
    menuFor = tokenId;
    const links = linksOf(phase());
    const cur = links['l_' + tokenId], kick = links['i_' + tokenId];
    const now = [cur && kindName(cur.kind), kick && tr('차단 {n}번', { n: kick.n || 1 })].filter(Boolean).join(' · ');
    const btn = (act, label, off) => `<button type="button" role="menuitem" data-act="${act}"${off ? ` disabled title="${tr('해제할 행동이 없습니다')}"` : ''}>` +
      `<svg viewBox="0 0 24 24">${ACT_ICON[act]}</svg><span>${label}</span></button>`;
    const menu = $('#actionMenu');
    menu.innerHTML = `<div class="am-title"><b>${esc(m.name)}</b>${now ? ` · ${tr('지금: {now}', { now })}` : ''}</div>` +
      '<div class="am-btns">' + btn('attack', tr('공격')) + btn('tank', tr('탱')) + btn('heal', tr('힐')) + btn('interrupt', tr('차단')) +
      btn('clear', tr('해제'), !cur && !kick) + '</div>';
    menu.hidden = false;
    const r = el.querySelector('.disc').getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let top = r.top - mh - 12;
    if (top < 8) top = r.bottom + 12;
    menu.style.left = clamp(r.left + r.width / 2 - mw / 2, 8, window.innerWidth - mw - 8) + 'px';
    menu.style.top = clamp(top, 8, window.innerHeight - mh - 8) + 'px';
    const first = menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function closeActionMenu() {
    if (!menuFor && $('#actionMenu').hidden) return;
    $('#actionMenu').hidden = true;
    menuFor = null;
  }
  $('#actionMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !menuFor) return;
    const from = menuFor;
    closeActionMenu();
    if (b.dataset.act === 'clear') {
      const base = phasePath(), links = linksOf(phase());
      const gone = ['l_' + from, 'i_' + from].filter(id => links[id]);
      commit(gone.map(id => [base.concat('links', id), null]).concat(renumberOps(base, links, gone)));
      toast(tr('행동을 해제했습니다'));
      return;
    }
    startLinking(from, b.dataset.act);
  });
  document.addEventListener('pointerdown', e => {
    if (menuFor && !e.target.closest('#actionMenu')) closeActionMenu();
  }, true);

  // 대상 고르기
  function startLinking(from, kind) {
    const toks = tokensOf(phase());
    const m = memberOf(toks[from]);
    if (!m) return;
    view.linking = { from, kind };
    const any = Object.keys(toks).some(linkTargetOk);
    if (!any) {
      view.linking = null;
      return toast(kind === 'heal' ? tr('힐할 공대원이 지도에 없습니다') : tr('대상이 없습니다. 위쪽 메뉴에서 보스나 쫄을 먼저 놓으세요'));
    }
    viewport.classList.add('linking');
    viewport.classList.toggle('heal', kind === 'heal');
    viewport.classList.toggle('interrupt', kind === 'interrupt');
    $('#linkHint').innerHTML = `<b>${esc(m.name)}</b> ` + tr(kind === 'heal' ? '{kind} 대상: 우리 공대원을 클릭하세요' : '{kind} 대상: 보스·쫄·징표를 클릭하세요', { kind: kindName(kind) }) +
      ` <span class="muted">· ${tr('Esc 취소')}</span>`;
    $('#linkHint').hidden = false;
    fxPreview.setAttribute('stroke-width', '0');
    scheduleRender();
  }
  function endLinking() {
    if (!view.linking) return;
    view.linking = null;
    viewport.classList.remove('linking', 'heal', 'interrupt');
    $('#linkHint').hidden = true;
    fxPreview.setAttribute('d', '');
    scheduleRender();
  }
  function pickLinkTarget(id) {
    const L = view.linking;
    if (!L) return;
    if (id === L.from) { endLinking(); return; }
    if (!linkTargetOk(id)) {
      toast(L.kind === 'heal' ? tr('힐은 우리 공대원만 선택할 수 있습니다') : tr('공격·탱은 보스·쫄·징표만 선택할 수 있습니다'));
      return;
    }
    endLinking();
    const base = phasePath(), links = linksOf(phase()), lid = linkId(L.kind, L.from);
    const ops = [];
    const link = { from: L.from, to: id, kind: L.kind };
    if (L.kind === 'interrupt') {
      // 같은 대상의 차단 순서: 이미 그 대상에 있으면 번호 유지, 아니면 맨 뒤 번호
      const old = links[lid];
      if (old && old.to === id) link.n = old.n || 1;
      else {
        if (old) ops.push(...renumberOps(base, links, [lid]));
        link.n = Object.entries(links).filter(([k, l]) => k !== lid && l && l.kind === 'interrupt' && l.to === id).length + 1;
      }
    }
    ops.push([base.concat('links', lid), link]);
    commit(ops);
    const type = fxType(L, tokensOf(phase())[L.from]);
    toast(tr('{what}을 연결했습니다', { what: type === 'interrupt' ? tr('차단 {n}번', { n: link.n }) : tr({ ranged: '원거리 공격', melee: '근거리 공격', tank: '탱', heal: '힐' }[type]) }));
  }
  // 차단이 빠지면 같은 대상의 남은 차단 번호를 1부터 다시 매김
  function renumberOps(base, links, removed) {
    const ops = [];
    const targets = new Set(removed.map(id => links[id]).filter(l => l && l.kind === 'interrupt').map(l => l.to));
    targets.forEach(to => {
      Object.entries(links)
        .filter(([lid, l]) => l && l.kind === 'interrupt' && l.to === to && !removed.includes(lid))
        .sort((a, b) => (a[1].n || 0) - (b[1].n || 0))
        .forEach(([lid, l], i) => { if ((l.n || 0) !== i + 1) ops.push([base.concat('links', lid, 'n'), i + 1]); });
    });
    return ops;
  }
  // 대상 고르는 동안 공대원에서 커서까지 점선
  viewport.addEventListener('pointermove', e => {
    if (!view.linking) return;
    const A = tokenPos(view.linking.from), pt = stagePoint(e.clientX, e.clientY);
    if (!A || !pt) return;
    const r = stage.getBoundingClientRect();
    const k = r.width ? SVG_W / r.width : 1;
    fxPreview.setAttribute('d', `M${(A.x * SVG_W).toFixed(1)} ${(A.y * svgH).toFixed(1)} L${(pt.x * SVG_W).toFixed(1)} ${(pt.y * svgH).toFixed(1)}`);
    fxPreview.setAttribute('stroke-width', (2.5 * k).toFixed(2));
    fxPreview.setAttribute('stroke-dasharray', `${(6 * k).toFixed(1)} ${(6 * k).toFixed(1)}`);
    fxPreview.setAttribute('stroke', view.linking.kind === 'heal' ? HEAL_COLOR : view.linking.kind === 'interrupt' ? KICK_COLOR : '#ff6b5e');
  });

  // ---------- 팔레트 / 명단에서 지도로 끌어오기 ----------
  function beginDropDrag(e, payload, ghostHtml) {
    if (!canEdit() || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;
    const move = ev => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        ghost = document.createElement('div');
        ghost.className = 'ghost';
        ghost.innerHTML = ghostHtml;
        document.body.appendChild(ghost);
      }
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (ev.type === 'pointercancel') { if (ghost) ghost.remove(); return; }
      if (!ghost) {
        if (payload.onClick) payload.onClick();
        else if (payload.clickPlace) dropPayload(payload, viewCenterPoint(), true);
        return;
      }
      ghost.remove();
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const slotEl = over && over.closest && over.closest('#rosterList [data-slot]');
      if (slotEl && payload.onSlot) { payload.onSlot(Number(slotEl.dataset.slot)); return; }
      const pt = stagePoint(ev.clientX, ev.clientY);
      if (pt && inViewport(ev.clientX, ev.clientY) && pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1) dropPayload(payload, pt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // auto: 메뉴를 클릭만 했을 때 (끌어다 놓은 게 아닐 때)
  function dropPayload(p, pt, auto) {
    if (!pt || !phase()) return;
    const base = [...phasePath(), 'tokens'];
    const toks = tokensOf(phase());
    let x = round(clamp(pt.x, 0, 1)), y = round(clamp(pt.y, 0, 1));
    if (p.kind === 'member') set([...base, 'm_' + p.id], { type: 'member', ref: p.id, x, y });
    else if (p.kind === 'party') {
      // 놓은 자리를 가운데로 파티원을 둥글게
      const ms = partyMembers(p.party);
      if (!ms.length) { toast(tr('빈 파티입니다')); return; }
      const r = stage.getBoundingClientRect();
      const px = parseFloat(getComputedStyle(stage).getPropertyValue('--token')) || 28;
      const R = ms.length === 1 ? 0 : Math.max(36, px * 1.45);
      commit(ms.map((m, i) => {
        const a = -Math.PI / 2 + i * 2 * Math.PI / ms.length;
        return [[...base, 'm_' + m.id], {
          type: 'member', ref: m.id,
          x: round(clamp(x + R * Math.cos(a) / r.width, 0.02, 0.98)), y: round(clamp(y + R * Math.sin(a) / r.height, 0.02, 0.98))
        }];
      }));
      toast(tr('{n}파티를 배치했습니다', { n: p.party + 1 }));
    }
    else if (p.kind === 'marker') {
      if (auto && toks['k_' + p.id]) { flashToken('k_' + p.id); toast(tr('이미 놓은 징표입니다. 지도에서 끌어서 옮기세요')); return; }
      set([...base, 'k_' + p.id], { type: 'marker', ref: Number(p.id), x, y });
    } else if (p.kind === 'boss' || p.kind === 'add') {
      // 같은 종류를 차례대로 번호 매기고, 클릭으로 추가하면 앞의 것 오른쪽에 놓음
      const same = Object.values(toks).filter(t => t && t.type === p.kind && typeof t.x === 'number');
      const n = same.reduce((m, t) => Math.max(m, t.n || 0), 0) + 1;
      if (auto) {
        const r = stage.getBoundingClientRect();
        const px = parseFloat(getComputedStyle(stage).getPropertyValue('--token')) || 28;
        const size = px * (p.kind === 'boss' ? 1.6 : 0.8);
        const stepX = (Math.max(size, 56) + 14) / r.width;
        const stepY = (size + 34) / r.height;
        let rowX = x;
        if (same.length) {
          const last = same.reduce((a, t) => ((t.n || 0) >= (a.n || 0) ? t : a));
          rowX = same.reduce((a, t) => ((t.n || 0) < (a.n || 0) ? t : a)).x;
          x = last.x + stepX;
          y = last.y;
        }
        // 다른 토큰과 겹치면 비켜 놓음: 첫 번째는 아래 줄로, 그다음부터는 오른쪽으로 (끝에 닿으면 다음 줄)
        const others = Object.values(toks).filter(t => t && typeof t.x === 'number');
        const busy = (cx, cy) => others.some(t => Math.hypot((t.x - cx) * r.width, (t.y - cy) * r.height) < Math.max(size, 40));
        for (let i = 0; i < 60; i++) {
          if (x > 0.97) { x = rowX; y += stepY; }
          if (y > 0.97) y = 0.06;
          if (!busy(x, y)) break;
          if (same.length) x += stepX; else y += stepY;
        }
        x = round(clamp(x, 0.03, 0.97));
        y = round(clamp(y, 0.03, 0.97));
      }
      const label = tr(p.kind === 'boss' ? '보스 {n}' : '쫄 {n}', { n });
      set([...base, 'x_' + RP.uid(6)], { type: p.kind, label, n, x, y });
    }
  }

  function flashToken(id) {
    const el = tokenEls.get(id);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1300);
  }

  $('#palette').addEventListener('pointerdown', e => {
    const it = e.target.closest('.pal-item');
    if (!it) return;
    e.preventDefault();
    if (view.tool !== 'select') setTool('select');
    const kind = it.dataset.kind;
    const ghost = kind === 'marker' ? RP.markerSVG(it.dataset.id) : esc(it.textContent);
    beginDropDrag(e, { kind, id: it.dataset.id, clickPlace: true }, ghost);
  });

  $('#rosterList').addEventListener('pointerdown', e => {
    if (!canEdit() || e.button !== 0) return;
    const head = e.target.closest('[data-party-head]');
    if (head) {
      const p = Number(head.dataset.partyHead);
      const n = partyMembers(p).length;
      beginDropDrag(e, { kind: 'party', party: p }, esc(tr('{n}파티 · {m}명', { n: p + 1, m: n })));
      return;
    }
    const it = e.target.closest('.member[data-id]');
    if (it) {
      const m = state.roster && state.roster[it.dataset.id];
      if (!m) return;
      const c = RP.classById(m.cls);
      const slot = it.dataset.slot !== undefined ? Number(it.dataset.slot) : null;
      beginDropDrag(e, {
        kind: 'member', id: it.dataset.id,
        onClick: () => { if (slot !== null) openSlotEditor(slot); },
        onSlot: k => moveToSlot(it.dataset.id, k)
      }, `<span style="color:${c.color}">●</span> ${esc(m.name)}`);
    }
  });
  $('#rosterList').addEventListener('click', e => {
    const vacant = e.target.closest('.slot.vacant');
    if (vacant && canEdit()) openSlotEditor(Number(vacant.dataset.slot));
  });
  $('#rosterList').addEventListener('pointerover', e => {
    const it = e.target.closest('.member');
    if (it && !drag) setHighlight(it.dataset.id);
  });
  $('#rosterList').addEventListener('pointerleave', () => { if (!drag) setHighlight(null); });

  // ---------- 지도 이동 / 확대 / 핑 ----------
  viewport.addEventListener('wheel', e => {
    if (!boss() || e.target.closest('.memo')) return; // 메모 위에서는 메모를 스크롤
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  viewport.addEventListener('pointerdown', e => {
    if (view.linking) { endLinking(); toast(tr('대상 선택을 취소했습니다')); return; }
    if (!boss() || e.target.closest('.empty, .memo')) return;
    if ((e.altKey || view.pingMode) && canEdit()) {
      const pt = stagePoint(e.clientX, e.clientY);
      if (pt && pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1) doPing(pt);
      if (view.pingMode) togglePing(false);
      return;
    }
    if (view.tool !== 'select' && !spaceHeld && e.button === 0 && canEdit()) {
      e.preventDefault();
      startDraw(e);
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    const sx = e.clientX, sy = e.clientY, px = view.panX, py = view.panY;
    viewport.classList.add('panning');
    try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    const move = ev => { view.panX = px + ev.clientX - sx; view.panY = py + ev.clientY - sy; applyTransform(); };
    const up = () => {
      viewport.classList.remove('panning');
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', up);
      viewport.removeEventListener('pointercancel', up);
    };
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
    viewport.addEventListener('pointercancel', up);
  });

  const zoomCenter = f => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, f);
  $('#zoomIn').onclick = () => zoomCenter(1.25);
  $('#zoomOut').onclick = () => zoomCenter(0.8);
  $('#zoomReset').onclick = () => { view.zoom = 1; view.panX = 0; view.panY = 0; applyTransform(); };

  function togglePing(on) {
    view.pingMode = on === undefined ? !view.pingMode : on;
    $('#pingBtn').classList.toggle('active', view.pingMode);
    viewport.classList.toggle('ping-mode', view.pingMode);
  }
  $('#pingBtn').onclick = () => togglePing();

  function doPing(pt) {
    const p = { x: round(pt.x), y: round(pt.y), bossId: view.bossId, name: me.name, color: me.color };
    showPing(p);
    sync.ping(p);
  }
  function showPing(p) {
    if (!p || p.bossId !== view.bossId || typeof p.x !== 'number' || typeof p.y !== 'number') return;
    const el = document.createElement('div');
    el.className = 'ping';
    el.style.left = clamp(p.x, 0, 1) * 100 + '%';
    el.style.top = clamp(p.y, 0, 1) * 100 + '%';
    if (/^#[0-9a-f]{6}$/i.test(p.color || '')) el.style.setProperty('--c', p.color);
    if (p.name) el.innerHTML = `<span>${esc(String(p.name).slice(0, 20))}</span>`;
    pingLayer.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------- 탭 ----------
  $('#bossTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-boss]');
    if (t) return goTo(t.dataset.boss, null);
    if (e.target.closest('[data-add-boss]')) addBoss();
  });
  $('#phaseTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-phase]');
    if (t) return goTo(view.bossId, t.dataset.phase);
    if (e.target.closest('[data-add-phase]')) addPhase();
  });

  function nextOrder(items) { return items.reduce((m, x) => Math.max(m, (x.order || 0) + 1), 0); }

  function addBoss() {
    const bs = bosses();
    const id = 'b' + RP.uid(6);
    set(['bosses', id], {
      name: tr('보스 {n}', { n: bs.length + 1 }), order: nextOrder(bs),
      map: { kind: 'template', template: 'circle' },
      phases: { p1: { name: tr('1단계'), order: 0 } }
    });
    goTo(id, 'p1');
    setTimeout(() => $('#bossName').select(), 50);
  }
  function addPhase() {
    const b = boss();
    if (!b) return;
    const ps = phases(b);
    const id = 'p' + RP.uid(6);
    const cur = phase() || {};
    set(['bosses', view.bossId, 'phases', id], {
      name: tr('{n}단계', { n: ps.length + 1 }), order: nextOrder(ps),
      tokens: clone(cur.tokens) || null, draw: clone(cur.draw) || null, links: clone(cur.links) || null
    });
    goTo(view.bossId, id);
    toast(tr('현재 배치를 복사해서 새 단계를 만들었습니다'));
  }
  function move(items, id, dir, pathOf) {
    const i = items.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    commit(items.map((x, k) => [pathOf(x.id).concat('order'), k]));
  }

  // ---------- 명단 ----------
  function parseBulk(text) {
    const out = [];
    text.split(/\r?\n/).forEach(line => {
      const parts = line.split(/[\s,\t/|]+/).filter(Boolean);
      if (!parts.length) return;
      let cls = null, role = null;
      parts.slice(1).forEach(p => {
        const c = RP.findClass(p), r = RP.findRole(p);
        if (c && !cls) cls = c;
        else if (r && !role) role = r;
      });
      out.push({ name: parts[0].slice(0, 24), cls: cls ? cls.id : '', role: role ? role.id : (cls ? cls.role : 'melee') });
    });
    return out;
  }
  // 공대원과 모든 보스·단계의 배치를 함께 지움
  function removeMemberOps(id) {
    const ops = [[['roster', id], null]];
    bosses().forEach(b => phases(b).forEach(p => {
      if (tokensOf(p)['m_' + id]) ops.push(...removeTokenOps(['bosses', b.id, 'phases', p.id], 'm_' + id));
    }));
    return ops;
  }

  // 인원 바꾸기: 줄일 때 자리가 모자라면 빠지는 사람을 알려 주고 확인
  $('#sizePick').addEventListener('click', async e => {
    const b = e.target.closest('[data-size]');
    if (!b || !canEdit()) return;
    const n = Number(b.dataset.size);
    if (n === raidSize()) return;
    const { assign, overflow } = layoutSlots(list(state.roster), n);
    const ops = [];
    if (overflow.length) {
      const ok = await ask({
        title: tr('공대 인원을 {n}명으로 줄일까요?', { n }),
        message: tr('자리가 모자라 {n}명이 명단에서 빠집니다: {names}', { n: overflow.length, names: overflow.map(m => m.name).join(', ') }),
        ok: tr('줄이기'), danger: true
      });
      if (!ok) return;
      overflow.forEach(m => ops.push(...removeMemberOps(m.id)));
    }
    assign.forEach(([id, k]) => ops.push([['roster', id, 'slot'], k]));
    ops.push([['meta', 'size'], n]);
    commit(ops);
  });

  // 자리 옮기기: 다른 사람 자리에 놓으면 서로 바꿈
  function moveToSlot(id, target) {
    const { slots } = layoutSlots(list(state.roster), raidSize());
    const from = slots.findIndex(m => m && m.id === id);
    if (from === target) return;
    const other = slots[target];
    const ops = [[['roster', id, 'slot'], target]];
    if (other) ops.push([['roster', other.id, 'slot'], from >= 0 ? from : null]);
    commit(ops);
  }

  // 빈칸·공대원을 누르면 뜨는 입력창 (이름, 직업, 역할)
  const se = { slot: null, id: null, cls: '', role: '', roleSet: false };
  function renderSlotEditor() {
    $('#seClasses').innerHTML = RP.CLASSES.map(c =>
      `<button type="button" data-cls="${c.id}" aria-pressed="${se.cls === c.id}"><span class="chip" style="background:${c.color}"></span>${esc(RP.nm(c))}</button>`).join('');
    $('#seRoles').innerHTML = RP.ROLES.map(r =>
      `<button type="button" data-role="${r.id}" aria-pressed="${se.role === r.id}">${esc(RP.nm(r))}</button>`).join('');
  }
  function openSlotEditor(slot) {
    if (!canEdit()) return;
    const m = layoutSlots(list(state.roster), raidSize()).slots[slot];
    Object.assign(se, { slot, id: m ? m.id : null, cls: m ? (m.cls || '') : '', role: m ? RP.roleById(m.role).id : '', roleSet: !!m });
    $('#seHead').textContent = tr('{p}파티 · {i}번', { p: Math.floor(slot / 5) + 1, i: slot % 5 + 1 });
    $('#seName').value = m ? m.name : '';
    $('#seClear').hidden = !m;
    renderSlotEditor();
    const ed = $('#slotEditor');
    ed.hidden = false;
    const cell = document.querySelector(`#rosterList [data-slot="${slot}"]`);
    const r = cell ? cell.getBoundingClientRect() : { left: 16, right: 16, top: 80, bottom: 80 };
    const w = ed.offsetWidth, h = ed.offsetHeight;
    let left = r.right + 8;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left);
    let top = left === r.right + 8 ? r.top - 10 : r.bottom + 6;
    ed.style.left = clamp(left, 8, window.innerWidth - w - 8) + 'px';
    ed.style.top = clamp(top, 8, window.innerHeight - h - 8) + 'px';
    $('#seName').focus();
  }
  function closeSlotEditor() {
    $('#slotEditor').hidden = true;
    se.slot = null;
  }
  $('#seClasses').addEventListener('click', e => {
    const b = e.target.closest('[data-cls]');
    if (!b) return;
    se.cls = b.dataset.cls;
    if (!se.roleSet) se.role = RP.classById(se.cls).role;
    renderSlotEditor();
    $('#seName').focus();
  });
  $('#seRoles').addEventListener('click', e => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    se.role = b.dataset.role;
    se.roleSet = true;
    renderSlotEditor();
    $('#seName').focus();
  });
  function saveSlotEditor() {
    if (se.slot === null) return;
    let name = $('#seName').value.trim();
    // "이름 직업 역할" 로 한 줄에 써도 알아들음
    if (/\s/.test(name)) {
      const words = name.split(/[\s,\t/|]+/).filter(Boolean);
      const row = parseBulk(name)[0];
      name = row.name;
      if (row.cls) { se.cls = row.cls; if (!se.roleSet) se.role = RP.classById(row.cls).role; }
      if (words.slice(1).some(w => RP.findRole(w) && !RP.findClass(w))) { se.role = row.role; se.roleSet = true; }
    }
    name = name.slice(0, 24);
    if (!name) { toast(tr('이름을 넣어 주세요')); $('#seName').focus(); return; }
    if (list(state.roster).some(m => m.name === name && m.id !== se.id)) { toast(tr('이미 있는 이름입니다')); $('#seName').select(); return; }
    const role = se.role || (se.cls ? RP.classById(se.cls).role : 'melee');
    if (se.id) {
      commit([[['roster', se.id, 'name'], name], [['roster', se.id, 'cls'], se.cls], [['roster', se.id, 'role'], role]]);
      closeSlotEditor();
      return;
    }
    const slot = se.slot;
    set(['roster', 'm' + RP.uid(6)], { name, cls: se.cls, role, slot, order: Date.now() });
    // 연달아 입력: 다음 빈칸으로
    const { slots } = layoutSlots(list(state.roster), raidSize());
    const next = slots.findIndex((m, k) => k > slot && !m);
    if (next >= 0) openSlotEditor(next); else closeSlotEditor();
  }
  $('#seSave').onclick = saveSlotEditor;
  $('#seCancel').onclick = closeSlotEditor;
  $('#seName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveSlotEditor(); }
  });
  $('#slotEditor').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSlotEditor(); }
  });
  $('#seClear').onclick = async () => {
    const id = se.id;
    const m = id && state.roster && state.roster[id];
    if (!m) return;
    closeSlotEditor();
    const ok = await ask({ title: tr('{name}님을 명단에서 지울까요?', { name: m.name }), message: tr('모든 보스·단계의 배치도 함께 지워집니다.'), ok: tr('삭제'), danger: true });
    if (ok && state.roster && state.roster[id]) commit(removeMemberOps(id));
  };
  document.addEventListener('pointerdown', e => {
    if (!$('#slotEditor').hidden && !e.target.closest('#slotEditor')) closeSlotEditor();
  }, true);

  // ---------- 오른쪽 패널 ----------
  function renderSide() {
    const b = boss(), p = phase();
    renderMemo();
    const bn = $('#bossName');
    if (document.activeElement !== bn) bn.value = b ? b.name : '';
    const pn = $('#phaseName');
    if (document.activeElement !== pn) pn.value = p ? p.name : '';
    const m = (b && b.map) || {};
    document.querySelectorAll('#templateBtns [data-tpl]').forEach(btn =>
      btn.classList.toggle('active', m.kind !== 'image' && (m.template || 'circle') === btn.dataset.tpl));
    const mu = $('#mapUrl');
    if (document.activeElement !== mu) mu.value = m.kind === 'image' && /^https?:/.test(m.src || '') ? m.src : '';
  }

  // ---------- 작전 메모: 지도 왼쪽 위에서 접고 펼치기, 굵게·기울임·밑줄·글자 색·목록 ----------
  // 단계마다 note 에 HTML 로 저장. 그릴 때는 허용한 서식만 남김 (다른 사람이 쓴 내용이므로)
  const memo = $('#memo'), memoEdit = $('#memoEdit');
  const MEMO_COLORS = ['#e7e4dc', '#e2b356', '#ff5a4f', '#ff9f43', '#4fc36b', '#4fa8ff', '#b98cff', '#9aa0ab'];
  const SAFE_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', BR: 'br', DIV: 'div', P: 'div', UL: 'ul', OL: 'ol', LI: 'li', SPAN: 'span', FONT: 'span' };
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'TITLE', 'HEAD']);
  const NOTE_TAG = /<\/?(b|strong|i|em|u|br|div|p|span|font|ul|ol|li)\b/i;
  const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;
  function cleanNote(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    const out = document.createElement('div');
    const walk = (src, dst) => src.childNodes.forEach(n => {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.data)); return; }
      if (n.nodeType !== 1) return;
      if (DROP_TAGS.has(n.tagName.toUpperCase())) return; // 스크립트 등은 내용째 버림
      const tag = SAFE_TAGS[n.tagName];
      if (!tag) { walk(n, dst); return; } // 모르는 태그는 벗기고 내용만
      let el = document.createElement(tag);
      const color = ((n.style && n.style.color) || n.getAttribute('color') || '').trim();
      if (tag === 'span' && (CSS_COLOR.test(color) || (/^[a-z]{3,20}$/i.test(color) && window.CSS && CSS.supports('color', color)))) el.style.color = color;
      const weight = n.style && n.style.fontWeight;
      if (tag === 'span' && (weight === 'bold' || Number(weight) >= 600)) { const bb = document.createElement('b'); el.appendChild(bb); walk(n, bb); dst.appendChild(el); return; }
      if (tag === 'span' && !el.getAttribute('style')) el = document.createDocumentFragment();
      walk(n, el);
      dst.appendChild(el);
    });
    walk(tpl.content, out);
    return out.innerHTML.slice(0, 20000);
  }
  // 서식 태그가 있으면 서식 메모, 아니면 예전 글자 메모(줄바꿈 유지)
  const noteHtml = note => (!note ? '' : NOTE_TAG.test(note) ? cleanNote(note) : esc(note).replace(/\n/g, '<br>'));

  let memoOpen = local.get('rp-memo-open') === '1';
  function setMemoOpen(v) {
    memoOpen = v;
    local.set('rp-memo-open', v ? '1' : '0');
    renderMemo();
    layoutStage();
    if (v && canEdit()) memoEdit.focus();
  }
  $('#memoToggle').onclick = () => setMemoOpen(!memoOpen);
  $('#memoClose').onclick = () => setMemoOpen(false);
  function buildMemoColors() {
    $('#memoColors').innerHTML = MEMO_COLORS.map(c =>
      `<button type="button" class="mc" data-color="${c}" aria-pressed="false" style="background:${c}" title="${tr('글자 색')}" aria-label="${tr('글자 색')}"></button>`).join('');
  }
  buildMemoColors();

  function renderMemo() {
    const b = boss(), p = phase();
    const btn = $('#memoToggle');
    const wasHidden = memo.hidden;
    btn.hidden = !b;
    memo.hidden = !b || !memoOpen;
    btn.setAttribute('aria-expanded', String(!memo.hidden));
    btn.classList.toggle('open', !memo.hidden);
    if (wasHidden !== memo.hidden) requestAnimationFrame(layoutStage);
    $('#memoWhere').textContent = b && p ? `${b.name} · ${p.name}` : '';
    const html = noteHtml(p && p.note);
    btn.classList.toggle('has-note', !!html);
    memoEdit.contentEditable = String(canEdit() && !!p);
    const key = view.bossId + '/' + view.phaseId;
    if (memoEdit.dataset.key !== key || (document.activeElement !== memoEdit && memoEdit._html !== html)) {
      memoEdit.dataset.key = key;
      memoEdit.dataset.path = JSON.stringify([...phasePath(), 'note']);
      memoEdit.innerHTML = html;
      memoEdit._html = html;
    }
  }
  function saveMemo() {
    if (!canEdit() || !memoEdit.dataset.path) return;
    const path = JSON.parse(memoEdit.dataset.path);
    if (!memoEdit.textContent.trim() && !memoEdit.querySelector('li')) memoEdit.innerHTML = '';
    const html = cleanNote(memoEdit.innerHTML);
    memoEdit._html = html;
    debounce('note:' + path.join('/'), () => set(path, html || null), 400);
  }
  memoEdit.addEventListener('input', saveMemo);
  // 붙여넣기는 글자만
  memoEdit.addEventListener('paste', e => {
    e.preventDefault();
    e.stopPropagation();
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, text);
  });
  // 도구를 눌러도 메모의 선택 영역이 유지되도록
  ['mousedown', 'pointerdown'].forEach(ev => $('#memoTools').addEventListener(ev, e => { if (e.target.closest('button')) e.preventDefault(); }));
  $('#memoTools').addEventListener('click', e => {
    const b = e.target.closest('[data-cmd], [data-color]');
    if (!b || !canEdit()) return;
    memoEdit.focus();
    document.execCommand('styleWithCSS', false, false);
    if (b.dataset.color) document.execCommand('foreColor', false, b.dataset.color);
    else document.execCommand(b.dataset.cmd, false, null);
    saveMemo();
    updateMemoTools();
  });
  // 커서가 있는 글자의 서식에 맞춰 B·I·U·목록·글자 색 버튼에 눌림 표시
  const toHex = c => {
    const m = String(c || '').match(/\d+(\.\d+)?/g);
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    return m && m.length >= 3 ? '#' + m.slice(0, 3).map(v => Math.round(Number(v)).toString(16).padStart(2, '0')).join('') : '';
  };
  function updateMemoTools() {
    if (memo.hidden || !canEdit()) return;
    const sel = document.getSelection();
    const inside = !!(sel && sel.rangeCount && memoEdit.contains(sel.anchorNode));
    ['bold', 'italic', 'underline', 'insertUnorderedList'].forEach(cmd => {
      let on = false;
      try { on = inside && document.queryCommandState(cmd); } catch (e) { on = false; }
      const b = document.querySelector(`#memoTools [data-cmd="${cmd}"]`);
      if (b) b.setAttribute('aria-pressed', String(!!on));
    });
    let color = '';
    try { color = inside ? toHex(document.queryCommandValue('foreColor')) : ''; } catch (e) { color = ''; }
    document.querySelectorAll('#memoColors .mc').forEach(m => m.setAttribute('aria-pressed', String(!!color && m.dataset.color === color)));
  }
  document.addEventListener('selectionchange', updateMemoTools);

  function buildTemplates() {
    $('#templateBtns').innerHTML = Object.keys(RP.MAP_TEMPLATES).map(k =>
      `<button class="btn small" data-tpl="${k}">${tr(RP.MAP_TEMPLATES[k].name)}</button>`).join('');
  }
  buildTemplates();
  $('#templateBtns').addEventListener('click', e => {
    const b = e.target.closest('[data-tpl]');
    if (b && boss()) set(['bosses', view.bossId, 'map'], { kind: 'template', template: b.dataset.tpl });
  });
  $('#mapUrlBtn').onclick = () => {
    const url = $('#mapUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) return toast(tr('https:// 로 시작하는 이미지 주소를 넣어주세요'));
    if (boss()) set(['bosses', view.bossId, 'map'], { kind: 'image', src: url });
  };
  $('#mapFile').addEventListener('change', e => { loadImageFile(e.target.files[0]); e.target.value = ''; });

  function loadImageFile(file) {
    if (!canEdit() || !boss()) return;
    if (!file || !/^image\//.test(file.type)) return toast(tr('이미지 파일이 아닙니다'));
    const bossId = view.bossId;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      // 실시간 중계 서버의 메시지 크기 제한에 맞춰 약 230KB 이하로 줄임
      let data = '', canvas = c;
      for (let q = 0.85; ; q -= 0.1) {
        data = canvas.toDataURL('image/jpeg', Math.max(q, 0.5));
        if (data.length <= 310000) break;
        if (q <= 0.55) {
          const small = document.createElement('canvas');
          small.width = Math.round(canvas.width * 0.8);
          small.height = Math.round(canvas.height * 0.8);
          small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
          canvas = small;
          q = 0.95;
          if (canvas.width < 300) break;
        }
      }
      set(['bosses', bossId, 'map'], { kind: 'image', src: data });
      toast(tr('지형 이미지를 적용했습니다'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast(tr('이미지를 읽지 못했습니다')); };
    img.src = url;
  }
  document.addEventListener('paste', e => {
    if (!canEdit() || e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return;
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadImageFile(item.getAsFile()); }
  });
  let dragDepth = 0;
  viewport.addEventListener('dragenter', e => {
    if (!canEdit() || !boss() || ![...e.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    $('#dropHint').hidden = false;
  });
  viewport.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').hidden = true; } });
  viewport.addEventListener('dragover', e => { if (canEdit()) e.preventDefault(); });
  viewport.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropHint').hidden = true;
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (f) loadImageFile(f);
  });

  $('#bossName').addEventListener('input', e => {
    const id = view.bossId, v = e.target.value.slice(0, 60);
    if (id && v.trim()) debounce('bossName', () => set(['bosses', id, 'name'], v), 300);
  });
  $('#phaseName').addEventListener('input', e => {
    const path = [...phasePath(), 'name'], v = e.target.value.slice(0, 40);
    if (v.trim()) debounce('phaseName', () => set(path, v), 300);
  });
  $('#planTitle').addEventListener('input', e => {
    const v = e.target.value.slice(0, 60);
    debounce('title', () => set(['meta', 'title'], v), 400);
  });

  $('#bossAdd').onclick = addBoss;
  $('#bossLeft').onclick = () => move(bosses(), view.bossId, -1, id => ['bosses', id]);
  $('#bossRight').onclick = () => move(bosses(), view.bossId, 1, id => ['bosses', id]);
  $('#bossDel').onclick = async () => {
    const b = boss(), id = view.bossId;
    if (b && await ask({ title: tr("'{name}' 보스를 지울까요?", { name: b.name }), message: tr('이 보스의 모든 단계와 배치가 지워집니다.'), ok: tr('삭제'), danger: true })) set(['bosses', id], null);
  };
  $('#phaseAdd').onclick = addPhase;
  $('#phaseLeft').onclick = () => move(phases(boss()), view.phaseId, -1, id => ['bosses', view.bossId, 'phases', id]);
  $('#phaseRight').onclick = () => move(phases(boss()), view.phaseId, 1, id => ['bosses', view.bossId, 'phases', id]);
  $('#phaseDel').onclick = () => {
    const p = phase();
    if (!p) return;
    if (phases(boss()).length < 2) return toast(tr('단계는 하나 이상 있어야 합니다'));
    const path = phasePath();
    ask({ title: tr("'{name}' 단계를 지울까요?", { name: p.name }), ok: tr('삭제'), danger: true }).then(ok => { if (ok) set(path, null); });
  };

  // ---------- 비어 있을 때: 레이드 선택 ----------
  function renderEmpty() {
    const el = $('#emptyState');
    const sig = JSON.stringify([ready, bosses().length > 0, VIEW_ONLY]);
    if (!changed('empty', sig)) return;
    if (ready && bosses().length) { el.hidden = true; return; }
    el.hidden = false;
    if (!ready) { el.innerHTML = `<div class="empty-card"><h2>${tr('불러오는 중…')}</h2></div>`; return; }
    if (VIEW_ONLY) {
      el.innerHTML = `<div class="empty-card"><h2>${tr('아직 작전판이 비어 있습니다')}</h2><p class="hint">${tr('공대장이 보스를 추가하면 여기에 바로 나타납니다.')}</p></div>`;
      return;
    }
    el.innerHTML = `<div class="empty-card"><h2>${tr('어떤 레이드를 준비할까요?')}</h2>` +
      `<p class="hint">${tr('보스와 단계 이름은 나중에 언제든 바꿀 수 있습니다.')}</p><div class="preset-list">` +
      RP.PRESETS.map(p => `<button class="preset" data-preset="${p.id}"><b>${esc(tr(p.name))}</b><span>${esc(tr(p.sub))}</span></button>`).join('') +
      '</div></div>';
  }
  $('#emptyState').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b || !canEdit()) return;
    const p = RP.PRESETS.find(x => x.id === b.dataset.preset);
    const ops = p.bosses.map((def, i) => {
      const d = typeof def === 'string' ? { name: def } : def;
      const ph = {};
      (d.phases || ['1단계']).forEach((n, j) => { ph['p' + (j + 1)] = { name: tr(n), order: j }; });
      return [['bosses', p.id + (i + 1)], { name: tr(d.name, { n: d.n }), order: i, map: { kind: 'template', template: 'circle' }, phases: ph }];
    });
    if (!(state.meta && state.meta.title)) ops.push([['meta', 'title'], p.id === 'blank' ? tr('공격대 작전판') : tr('{raid} 작전', { raid: tr(p.name) })]);
    if (!(state.meta && state.meta.size) && p.size) ops.push([['meta', 'size'], p.size]);
    commit(ops);
  });

  // ---------- 발표 ----------
  async function askName() {
    if (me.name) return true;
    return askMyName(false);
  }
  // 이름 입력 (명단에 있는 이름을 목록에서 고를 수 있음)
  async function askMyName(first) {
    $('#rosterNames').innerHTML = list(state.roster).map(m => `<option value="${esc(m.name)}"></option>`).join('');
    const n = await ask({
      title: first ? tr('이름을 입력하세요') : tr('내 이름'),
      message: tr('접속자 목록에 이 이름으로 보입니다. 게임 캐릭터 이름을 적어 주세요.'),
      value: me.name || '', ok: first ? tr('입장') : tr('저장'), cancel: first ? tr('나중에') : tr('취소'), suggest: 'rosterNames'
    });
    if (n === null || !n.trim()) return false;
    setMyName(n.trim());
    return true;
  }
  let namePromptQueued = false;
  function promptNameOnce() {
    if (splashOpen) { namePromptPending = true; return; }
    if (me.name || session.get('rp-name-asked') || document.querySelector('dialog[open]')) return;
    session.set('rp-name-asked', '1');
    askMyName(true);
  }
  function setMyName(n) {
    me.name = n.slice(0, 20);
    $('#myName').value = me.name;
    local.set('rp-name', me.name);
    sync.setPresence({ name: me.name });
    if (presenting()) set(['present', 'name'], me.name);
    sigs.roster = null;
    renderPeers();
    scheduleRender();
  }
  $('#myName').value = me.name;
  $('#myName').addEventListener('change', e => setMyName(e.target.value.trim()));

  $('#presentBtn').onclick = async () => {
    if (!canEdit()) return;
    if (presenting()) {
      set(['present', 'on'], false);
      sync.guardPresenter(false);
      return;
    }
    if (!await askName()) return;
    set(['present'], { on: true, clientId: me.id, name: me.name, bossId: view.bossId, phaseId: view.phaseId });
    sync.guardPresenter(true);
    toast(tr('발표를 시작했습니다. 보기 링크를 공대원에게 공유하세요'));
  };
  $('#presentBanner').addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'stop') $('#presentBtn').click();
    else { view.follow = a.dataset.act === 'follow'; scheduleRender(); }
  });

  // ---------- 링크 / 크게 보기 / 백업 ----------
  async function copyLink(viewOnly) {
    const u = RP.shareUrl({ room, viewOnly, viewCode: VIEW_CODE || sync.viewCode, mode: sync.mode });
    if (!u) return toast(tr('실시간 서버에 연결된 뒤 다시 눌러 주세요'));
    const s = u.toString();
    const done = sync.mode === 'local' ? tr('링크를 복사했습니다. 다만 지금은 로컬 모드라 다른 사람에게는 보이지 않습니다')
      : !viewOnly ? tr('편집 링크를 복사했습니다')
        : u.searchParams.get('view') ? tr('보기 전용 링크를 복사했습니다')
          : tr('보기 전용 링크를 복사했습니다. 지금 공유 방식에서는 주소를 고치면 편집할 수 있습니다');
    try { await navigator.clipboard.writeText(s); toast(done); }
    catch (e) { ask({ title: tr('아래 링크를 복사하세요'), value: s, ok: tr('닫기') }); }
  }
  $('#shareEditBtn').onclick = () => copyLink(false);
  $('#shareViewBtn').onclick = () => copyLink(true);

  function toggleStageOnly(on) {
    const v = on === undefined ? !document.body.classList.contains('stage-only') : on;
    document.body.classList.toggle('stage-only', v);
    $('#stageOnlyBtn').classList.toggle('active', v);
  }
  $('#stageOnlyBtn').onclick = () => toggleStageOnly();

  $('#exportBtn').onclick = () => {
    const data = { app: 'raid-planner', version: 1, exportedAt: new Date().toISOString(), state: Object.assign({}, state, { present: null }) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `${tr('작전판')}-${(state.meta && state.meta.title) || room || VIEW_CODE}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    f.text().then(async txt => {
      const data = JSON.parse(txt);
      const s = data && data.state;
      if (!s || typeof s !== 'object') throw new Error(tr('형식 오류'));
      if (!await ask({ title: tr('백업 파일로 바꿀까요?'), message: tr('현재 작전판 내용이 백업 내용으로 바뀝니다.'), ok: tr('불러오기'), danger: true })) return;
      const ops = [[['meta'], s.meta || null], [['roster'], s.roster || null], [['present'], null], [['bosses'], null]];
      Object.entries(s.bosses || {}).forEach(([id, b]) => ops.push([['bosses', id], b]));
      commit(ops);
      toast(tr('백업을 불러왔습니다'));
    }).catch(() => toast(tr('백업 파일을 읽지 못했습니다')));
  });
  $('#newPlanBtn').onclick = async () => {
    if (await ask({ title: tr('새 작전판을 만들까요?'), message: tr('지금 작전판은 지금 주소(링크)로 다시 열 수 있습니다.'), ok: tr('만들기') })) {
      location.href = location.pathname + '?room=' + RP.uid(10);
    }
  };

  // ---------- 키보드 ----------
  function stepPhase(d) {
    const bs = bosses();
    const ps = phases(boss());
    const i = ps.findIndex(p => p.id === view.phaseId);
    if (ps[i + d]) return goTo(view.bossId, ps[i + d].id);
    const bi = bs.findIndex(b => b.id === view.bossId);
    const nb = bs[bi + d];
    if (!nb) return;
    const nps = phases(nb);
    goTo(nb.id, d > 0 ? (nps[0] && nps[0].id) : (nps[nps.length - 1] && nps[nps.length - 1].id));
  }
  function stepBoss(d) {
    const bs = bosses();
    const bi = bs.findIndex(b => b.id === view.bossId);
    if (bs[bi + d]) goTo(bs[bi + d].id, null);
  }
  const typing = e => e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  document.addEventListener('keydown', e => {
    if (typing(e) || document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; viewport.classList.add('space-pan'); return; }
    const tool = canEdit() && TOOLS.find(t => t.key === e.key.toLowerCase());
    if (tool) { setTool(tool.id); return; }
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); stepPhase(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); stepPhase(-1); }
    else if (k === 'ArrowDown') { e.preventDefault(); stepBoss(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); stepBoss(-1); }
    else if (k === 'f' || k === 'F') toggleStageOnly();
    else if (k === 'Escape') {
      if (view.linking || menuFor) { endLinking(); closeActionMenu(); return; }
      toggleStageOnly(false); togglePing(false); setTool('select');
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceHeld = false; viewport.classList.remove('space-pan'); }
  });
  window.addEventListener('blur', () => { spaceHeld = false; viewport.classList.remove('space-pan'); });

  // ---------- 대화상자 / 알림 ----------
  // value 가 있으면 입력칸을 보여 주고 입력값을, 없으면 확인 여부(true)를 돌려줍니다. 취소는 null.
  function ask({ title, message = '', value = null, ok = tr('확인'), cancel = tr('취소'), danger = false, suggest = null }) {
    return new Promise(resolve => {
      const d = $('#askDialog'), input = $('#askInput');
      $('#askTitle').textContent = title;
      $('#askMsg').textContent = message;
      $('#askMsg').hidden = !message;
      input.hidden = value === null;
      input.value = value || '';
      if (suggest) input.setAttribute('list', suggest); else input.removeAttribute('list');
      $('#askCancel').textContent = cancel;
      $('#askOk').textContent = ok;
      $('#askOk').className = 'btn ' + (danger ? 'danger' : 'gold');
      d.returnValue = '';
      d.onclose = () => { d.onclose = null; resolve(d.returnValue === 'ok' ? (value === null ? true : input.value) : null); };
      d.showModal();
      if (value !== null) { input.focus(); input.select(); }
    });
  }
  // 대화상자 입력칸에서 Enter 는 '확인' (첫 번째 버튼이 취소/삭제라서 직접 처리)
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); d.close('ok'); }
  }));

  // ---------- 알림 ----------
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(2200, msg.length * 70));
  }

  // ---------- 언어 (KR/EN) ----------
  function applyLanguage() {
    buildDrawbar();
    setTool(view.tool);
    renderDrawbar();
    buildTemplates();
    buildMemoColors();
    if (!$('#slotEditor').hidden) renderSlotEditor();
    Object.keys(sigs).forEach(k => { sigs[k] = null; });
    if (lastStatus) $('#connText').textContent = tr(lastStatus[1], lastStatus[2]);
    if (splashOpen && ready) $('#splashStatus').textContent = tr('화면을 누르면 시작합니다');
    document.querySelectorAll('#langToggle [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === RP.lang())));
    renderPeers();
    render();
  }
  $('#langToggle').addEventListener('click', e => {
    const b = e.target.closest('[data-lang]');
    if (b) RP.setLang(b.dataset.lang);
  });
  RP.onLang(applyLanguage);

  document.querySelectorAll('#langToggle [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === RP.lang())));
  render();
  window.RP.debug = { get state() { return state; }, view, sync, commit };
})();
