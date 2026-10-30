// 공격대 작전판: 화면, 명단, 지도 배치, 발표 모드
(function () {
  'use strict';
  const RP = window.RP;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  const VIEW_ONLY = params.get('mode') === 'view';
  let room = (params.get('room') || (RP.CONFIG && RP.CONFIG.defaultRoom) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!room) {
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
  const view = { bossId: null, phaseId: null, follow: true, zoom: 1, panX: 0, panY: 0, pingMode: false, tool: 'select' };
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
      if (!namePromptQueued) { namePromptQueued = true; setTimeout(promptNameOnce, 500); }
      scheduleRender();
    },
    onOp(p, v) {
      if (!Array.isArray(p) || !p.length) return;
      RP.applyOp(state, p, clone(v));
      scheduleRender();
    },
    onStatus(kind, text) {
      $('#connDot').className = 'dot ' + kind;
      $('#connText').textContent = text;
      if (kind === 'local') { peers = []; renderPeers(); }
    },
    onPeers(ps) { peers = Array.isArray(ps) ? ps : []; renderPeers(); scheduleRender(); },
    onPing(p) { showPing(p); }
  }, me);

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
      toast('발표자 따라가기를 껐습니다');
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
    document.title = title ? `${title} · 공격대 작전판` : '공격대 작전판';
  }

  function renderPeers() {
    const btn = $('#peersBtn');
    btn.hidden = !peers.length;
    if (!peers.length) { closePeerPanel(); return; }
    $('#peers').textContent = `접속 ${peers.length}명`;
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
      `<div class="pp-head">접속 중 <b>${rows.length}</b>명${unnamed ? ` <span class="muted">· 이름 없음 ${unnamed}</span>` : ''}</div>` +
      '<ul class="pp-list">' + rows.map(r =>
        `<li><span class="pp-dot" style="background:${r.color}"></span>` +
        `<span class="pp-name${r.name ? '' : ' muted'}">${r.name ? esc(r.name) : '이름 없음'}</span>` +
        (r.me ? '<span class="pp-tag me">나</span>' : '') +
        (r.presenter ? '<span class="pp-tag">발표 중</span>' : '') +
        (r.name && rosterNames.has(normName(r.name)) ? '<span class="pp-tag ok" title="공대 명단에 있는 이름">명단</span>' : '') +
        '</li>').join('') + '</ul>' +
      `<button class="btn small" id="ppRename" type="button">${me.name ? '내 이름 바꾸기' : '내 이름 넣기'}</button>`;
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
  });
  const normName = n => String(n || '').trim().toLowerCase();
  const onlineNames = () => new Set(peers.filter(p => p && p.name).map(p => normName(p.id === me.id ? me.name : p.name)));

  function renderBanner() {
    const pr = state.present;
    const bn = $('#presentBanner');
    const btn = $('#presentBtn');
    btn.textContent = presenting() ? '발표 종료' : '발표 시작';
    btn.classList.toggle('gold', !presenting());
    const sig = JSON.stringify([pr, view.follow, me.id, presentOn()]);
    if (!changed('banner', sig)) return;
    if (!presentOn()) { bn.hidden = true; return; }
    bn.hidden = false;
    if (pr.clientId === me.id) {
      bn.className = 'banner me';
      bn.innerHTML = '<span>📢 발표 중입니다. 내가 보는 보스·단계를 모두가 따라봅니다.</span><button class="btn small" data-act="stop">발표 종료</button>';
    } else {
      bn.className = 'banner';
      const who = esc(pr.name || '공대장');
      bn.innerHTML = view.follow
        ? `<span>📢 <b>${who}</b>님이 발표 중 · 따라가는 중</span><button class="btn small" data-act="unfollow">따라가기 끄기</button>`
        : `<span>📢 <b>${who}</b>님이 발표 중</span><button class="btn small gold" data-act="follow">발표자 화면으로</button>`;
    }
  }

  function renderRoster() {
    const members = list(state.roster);
    const toks = tokensOf(phase());
    const online = onlineNames();
    const sig = JSON.stringify([state.roster, Object.keys(toks).filter(k => k.startsWith('m_')).sort(), [...online].sort()]);
    if (!changed('roster', sig)) return;
    $('#rosterCount').textContent = members.length ? `${members.length}명` : '';
    $('#roleCounts').innerHTML = RP.ROLES.map(r =>
      `<span>${r.short} <b>${members.filter(m => m.role === r.id).length}</b></span>`).join('');
    if (!members.length) {
      $('#rosterList').innerHTML = VIEW_ONLY ? '<p class="hint">명단이 비어 있습니다.</p>'
        : '<p class="hint">위에서 공대원을 추가하거나 <b>일괄 입력</b>으로 한 번에 넣으세요.</p>';
      return;
    }
    $('#rosterList').innerHTML = RP.ROLES.map(r => {
      const ms = members.filter(m => (RP.roleById(m.role).id) === r.id);
      if (!ms.length) return '';
      return `<div class="role-group"><h4><span>${r.name}</span><span>${ms.length}</span></h4>` + ms.map(m => {
        const c = RP.classById(m.cls);
        const placed = !!toks['m_' + m.id];
        const on = online.has(normName(m.name));
        return `<div class="member${placed ? ' placed' : ''}${on ? ' online' : ''}" data-id="${esc(m.id)}" title="${esc(m.name)} · ${esc(c.name)}${on ? ' · 접속 중' : ''}">` +
          `<span class="chip" style="background:${c.color}"></span>` +
          `<span class="m-name">${esc(m.name)}</span><span class="m-cls">${esc(c.name)}</span>` +
          `<span class="m-placed">${placed ? '✓' : ''}</span>` +
          (VIEW_ONLY ? '' : `<button class="m-edit" data-edit="${esc(m.id)}" title="수정">✎</button>`) +
          '</div>';
      }).join('') + '</div>';
    }).join('');
  }

  function renderBossTabs() {
    const bs = bosses();
    const sig = JSON.stringify([bs.map(b => [b.id, b.name]), view.bossId, VIEW_ONLY]);
    if (!changed('bossTabs', sig)) return;
    $('#bossTabs').innerHTML = bs.map((b, i) =>
      `<button class="tab${b.id === view.bossId ? ' active' : ''}" data-boss="${esc(b.id)}"><span class="num">${i + 1}</span>${esc(b.name)}</button>`
    ).join('') + (VIEW_ONLY || !bs.length ? '' : '<button class="tab add" data-add-boss>+ 보스</button>');
  }

  function renderPhaseTabs() {
    const ps = phases(boss());
    const sig = JSON.stringify([ps.map(p => [p.id, p.name]), view.phaseId, VIEW_ONLY]);
    if (!changed('phaseTabs', sig)) return;
    $('#phaseTabs').innerHTML = ps.map(p =>
      `<button class="tab${p.id === view.phaseId ? ' active' : ''}" data-phase="${esc(p.id)}">${esc(p.name)}</button>`
    ).join('') + (VIEW_ONLY || !ps.length ? '' : '<button class="tab add" data-add-phase title="현재 배치를 복사해서 새 단계를 만듭니다">+ 단계</button>');
  }

  function renderPalette() {
    const toks = tokensOf(phase());
    const sig = RP.MARKERS.map(m => toks['k_' + m.id] ? 1 : 0).join('');
    if (!changed('palette', sig)) return;
    $('#palette').innerHTML =
      RP.MARKERS.map(m =>
        `<div class="pal-item${toks['k_' + m.id] ? ' used' : ''}" data-kind="marker" data-id="${m.id}" title="${m.name} 징표 · 클릭하거나 지도로 끌어다 놓기">${RP.markerSVG(m.id)}</div>`
      ).join('') +
      '<span class="pal-sep"></span>' +
      '<div class="pal-item boss" data-kind="boss" title="보스 · 클릭할 때마다 오른쪽에 차례대로 추가, 끌면 원하는 곳에">보스</div>' +
      '<div class="pal-item add" data-kind="add" title="쫄 · 클릭할 때마다 오른쪽에 차례대로 추가, 끌면 원하는 곳에">쫄</div>';
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
    toast('지형 이미지를 불러오지 못했습니다. 주소를 확인하세요');
    mapImg.src = FALLBACK;
  });

  function layoutStage() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const pad = vw < 600 ? 8 : 24;
    const s = Math.max(0.01, Math.min((vw - pad * 2) / natW, (vh - pad * 2) / natH));
    baseW = natW * s; baseH = natH * s;
    stage.style.width = baseW + 'px';
    stage.style.height = baseH + 'px';
    baseX = (vw - baseW) / 2;
    baseY = (vh - baseH) / 2;
    stage.style.setProperty('--token', clamp(Math.min(baseW, baseH) / 22, 18, 32).toFixed(1) + 'px');
    const h = Math.round(SVG_W * natH / natW);
    if (h !== svgH) {
      svgH = h;
      drawSvg.setAttribute('viewBox', `0 0 ${SVG_W} ${svgH}`);
      renderDrawings();
    }
    applyTransform();
  }
  function applyTransform() {
    stage.style.transform = `translate(${baseX + view.panX}px, ${baseY + view.panY}px) scale(${view.zoom})`;
    stage.style.setProperty('--inv', String(1 / view.zoom));
    $('#zoomReset').textContent = Math.round(view.zoom * 100) + '%';
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
        cls: 'member', member: t.ref, title: `${m.name} · ${c.name} · ${r.name}`,
        html: `<div class="disc" style="background:${c.color}">${r.short}</div><div class="label">${esc(m.name)}</div>`
      };
    }
    if (t.type === 'marker') {
      const mk = RP.MARKERS.find(x => x.id === Number(t.ref));
      if (!mk) return null;
      return { cls: 'marker', title: mk.name + ' 징표', html: `<div class="disc">${RP.markerSVG(mk.id)}</div>` };
    }
    if (t.type === 'boss' || t.type === 'add') {
      const def = t.type === 'boss' ? '보스' : '쫄';
      const label = t.label && t.label !== def ? `<div class="label">${esc(t.label)}</div>` : '';
      return { cls: t.type, title: (t.label || def) + ' · 클릭해서 이름 바꾸기', html: `<div class="disc">${def}</div>${label}` };
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
        setTimeout(() => tokenLayer.classList.remove('animate'), 600);
      }
      lastPhaseKey = key;
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
      const cls = 'token ' + info.cls + (dragging ? ' dragging' : '') +
        (dragging && drag.out ? ' remove-hint' : '') +
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
    if (e.altKey || view.pingMode || view.tool !== 'select' || spaceHeld) return; // 핑·지우개·지도 이동은 viewport 가 처리
    e.stopPropagation();
    if (!canEdit() || e.button !== 0) return;
    const id = el.dataset.id;
    const t = tokensOf(phase())[id];
    if (!t) return;
    drag = { id, el, path: [...phasePath(), 'tokens', id], value: clone(t), sx: e.clientX, sy: e.clientY, moved: false, out: false };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    window.addEventListener('pointermove', onTokenMove);
    window.addEventListener('pointerup', onTokenUp);
    window.addEventListener('pointercancel', onTokenUp);
  });
  function onTokenMove(e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      drag.moved = true;
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
  }
  function onTokenUp(e) {
    window.removeEventListener('pointermove', onTokenMove);
    window.removeEventListener('pointerup', onTokenUp);
    window.removeEventListener('pointercancel', onTokenUp);
    if (!drag) return;
    const d = drag;
    drag = null;
    endThrottle(d.path);
    d.el.classList.remove('dragging', 'remove-hint');
    if (d.moved && e.type !== 'pointercancel') {
      if (d.out) { set(d.path, null); toast('배치를 해제했습니다'); }
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
    const title = t.type === 'boss' ? '보스 이름' : t.type === 'add' ? '쫄 이름' : '지도에 쓸 글자';
    const label = await ask({ title, value: t.label || '' });
    if (label === null || !getIn(state, path)) return;
    const v = label.trim().slice(0, 40);
    if (!v && t.type === 'text') set(path, null);
    else if (!v) set(path.concat('label'), (t.type === 'boss' ? '보스 ' : '쫄 ') + (t.n || 1));
    else set(path.concat('label'), v);
  }
  tokenLayer.addEventListener('contextmenu', e => {
    const el = e.target.closest('.token');
    if (!el || !canEdit()) return;
    e.preventDefault();
    set([...phasePath(), 'tokens', el.dataset.id], null);
  });

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
    const label = await ask({ title: '지도에 쓸 글자', value: '' });
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
    toast('되돌릴 그림이 없습니다');
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

  $('#toolBtns').innerHTML = TOOLS.map(t =>
    `<button class="tbtn" data-tool="${t.id}" title="${t.name}"><svg viewBox="0 0 24 24">${t.icon}</svg></button>`).join('');
  $('#colorBtns').innerHTML = PAINT_COLORS.map(c =>
    `<button class="swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
  $('#widthBtns').innerHTML = WIDTHS.map((w, i) =>
    `<button class="tbtn" data-w="${w}" title="${['가늘게', '보통', '굵게'][i]}"><span class="width-line" style="height:${[2, 4, 7][i]}px"></span></button>`).join('');
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
    if (!p || !p.draw) return toast('지울 그림이 없습니다');
    const path = [...phasePath(), 'draw'];
    ask({ title: '이 단계의 그림을 모두 지울까요?', message: '공대원과 징표 배치는 그대로 둡니다.', ok: '지우기', danger: true })
      .then(ok => { if (ok) set(path, null); });
  };
  setTool('select');
  renderDrawbar();

  // ---------- 팔레트 / 명단에서 지도로 끌어오기 ----------
  function beginDropDrag(e, payload, ghostHtml) {
    if (!canEdit() || e.button !== 0 || !phase()) return;
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
      if (!ghost) { if (payload.clickPlace) dropPayload(payload, viewCenterPoint(), true); return; }
      ghost.remove();
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
    else if (p.kind === 'marker') {
      if (auto && toks['k_' + p.id]) { flashToken('k_' + p.id); toast('이미 놓은 징표입니다. 지도에서 끌어서 옮기세요'); return; }
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
      const label = (p.kind === 'boss' ? '보스 ' : '쫄 ') + n;
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
    if (e.target.closest('.m-edit')) return;
    const it = e.target.closest('.member');
    if (!it) return;
    const m = state.roster && state.roster[it.dataset.id];
    if (!m) return;
    const c = RP.classById(m.cls);
    beginDropDrag(e, { kind: 'member', id: it.dataset.id },
      `<span style="color:${c.color}">●</span> ${esc(m.name)}`);
  });
  $('#rosterList').addEventListener('pointerover', e => {
    const it = e.target.closest('.member');
    if (it && !drag) setHighlight(it.dataset.id);
  });
  $('#rosterList').addEventListener('pointerleave', () => { if (!drag) setHighlight(null); });
  $('#rosterList').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) openMemberDialog(ed.dataset.edit);
  });

  // ---------- 지도 이동 / 확대 / 핑 ----------
  viewport.addEventListener('wheel', e => {
    if (!boss()) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  viewport.addEventListener('pointerdown', e => {
    if (!boss() || e.target.closest('.empty, .stage-note')) return;
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
      name: `보스 ${bs.length + 1}`, order: nextOrder(bs),
      map: { kind: 'template', template: 'circle' },
      phases: { p1: { name: '1단계', order: 0 } }
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
      name: `${ps.length + 1}단계`, order: nextOrder(ps),
      tokens: clone(cur.tokens) || null, draw: clone(cur.draw) || null
    });
    goTo(view.bossId, id);
    toast('현재 배치를 복사해서 새 단계를 만들었습니다');
  }
  function move(items, id, dir, pathOf) {
    const i = items.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    commit(items.map((x, k) => [pathOf(x.id).concat('order'), k]));
  }

  // ---------- 명단 ----------
  function fillSelects() {
    const cls = RP.CLASSES.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const roles = RP.ROLES.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    $('#mClass').innerHTML = cls; $('#eClass').innerHTML = cls;
    $('#mRole').innerHTML = roles; $('#eRole').innerHTML = roles;
    $('#mRole').value = RP.CLASSES[0].role;
  }
  $('#mClass').addEventListener('change', () => { $('#mRole').value = RP.classById($('#mClass').value).role; });

  $('#addMemberForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#mName').value.trim();
    if (!name) return;
    if (list(state.roster).some(m => m.name === name)) return toast('이미 있는 이름입니다');
    set(['roster', 'm' + RP.uid(6)], { name: name.slice(0, 24), cls: $('#mClass').value, role: $('#mRole').value, order: Date.now() });
    $('#mName').value = '';
    $('#mName').focus();
  });

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
  $('#bulkBtn').onclick = () => { $('#bulkText').value = ''; $('#bulkDialog').showModal(); };
  $('#bulkDialog').addEventListener('close', () => {
    if ($('#bulkDialog').returnValue !== 'ok') return;
    const existing = new Set(list(state.roster).map(m => m.name));
    const rows = parseBulk($('#bulkText').value).filter(r => !existing.has(r.name) && existing.add(r.name));
    if (!rows.length) return toast('추가할 새 이름이 없습니다');
    const t = Date.now();
    commit(rows.map((r, i) => [['roster', 'm' + RP.uid(6)], Object.assign(r, { order: t + i })]));
    toast(`${rows.length}명을 추가했습니다`);
  });

  let editing = null;
  function openMemberDialog(id) {
    const m = state.roster && state.roster[id];
    if (!m || !canEdit()) return;
    editing = id;
    $('#eName').value = m.name;
    $('#eClass').value = m.cls || RP.CLASSES[0].id;
    $('#eRole').value = RP.roleById(m.role).id;
    $('#memberDialog').showModal();
  }
  $('#memberDialog').addEventListener('close', async () => {
    const v = $('#memberDialog').returnValue;
    const id = editing;
    editing = null;
    if (!id || !state.roster || !state.roster[id]) return;
    if (v === 'ok') {
      const name = $('#eName').value.trim().slice(0, 24) || state.roster[id].name;
      commit([[['roster', id, 'name'], name], [['roster', id, 'cls'], $('#eClass').value], [['roster', id, 'role'], $('#eRole').value]]);
    } else if (v === 'delete') {
      const ok = await ask({ title: `${state.roster[id].name}님을 명단에서 지울까요?`, message: '모든 보스·단계의 배치도 함께 지워집니다.', ok: '삭제', danger: true });
      if (!ok || !state.roster || !state.roster[id]) return;
      const ops = [[['roster', id], null]];
      bosses().forEach(b => phases(b).forEach(p => {
        if (tokensOf(p)['m_' + id]) ops.push([['bosses', b.id, 'phases', p.id, 'tokens', 'm_' + id], null]);
      }));
      commit(ops);
    }
  });

  // 역할별 자동 배치: 보스(가운데) 기준으로 탱은 위, 근딜은 바로 아래, 힐·원딜은 바깥 호
  $('#autoPlaceBtn').onclick = () => {
    const ph = phase();
    if (!ph) return;
    const toks = tokensOf(ph);
    const members = list(state.roster).filter(m => !toks['m_' + m.id]);
    if (!members.length) return toast('배치할 인원이 없습니다');
    const base = [...phasePath(), 'tokens'];
    const by = { tank: [], melee: [], healer: [], ranged: [] };
    members.forEach(m => (by[RP.roleById(m.role).id]).push(m));
    const ops = [];
    const arc = (arr, r0, a0, a1) => {
      let i = 0, r = r0;
      const span = (a1 - a0) * Math.PI / 180;
      while (i < arr.length) {
        const cap = Math.max(2, Math.floor(r * span / 0.055) + 1);
        const row = arr.slice(i, i + cap);
        row.forEach((m, k) => {
          const a = (a0 * Math.PI / 180) + span * (row.length === 1 ? 0.5 : k / (row.length - 1));
          ops.push([[...base, 'm_' + m.id], {
            type: 'member', ref: m.id,
            x: round(clamp(0.5 + r * Math.cos(a), 0.03, 0.97)), y: round(clamp(0.5 + r * Math.sin(a), 0.03, 0.97))
          }]);
        });
        i += cap;
        r += 0.06;
      }
    };
    arc(by.tank, 0.08, 225, 315);
    arc(by.melee, 0.1, 25, 155);
    arc(by.healer, 0.24, 30, 150);
    arc(by.ranged, 0.34, 15, 165);
    if (!Object.values(toks).some(t => t && t.type === 'boss')) {
      ops.push([[...base, 'x_' + RP.uid(6)], { type: 'boss', label: '보스', x: 0.5, y: 0.5 }]);
    }
    commit(ops);
    toast(`${members.length}명을 배치했습니다. 끌어서 조정하세요`);
  };
  $('#clearPhaseBtn').onclick = async () => {
    const base = [...phasePath(), 'tokens'];
    const ids = Object.keys(tokensOf(phase())).filter(k => k.startsWith('m_'));
    if (!ids.length) return;
    if (!await ask({ title: '현재 단계의 공대원 배치를 모두 해제할까요?', ok: '해제', danger: true })) return;
    commit(ids.map(id => [base.concat(id), null]));
  };

  // ---------- 오른쪽 패널 ----------
  function renderSide() {
    const b = boss(), p = phase();
    $('#noteWhere').textContent = b && p ? `· ${b.name} · ${p.name}` : '';
    const note = (p && p.note) || '';
    const ni = $('#noteInput');
    if (document.activeElement !== ni) ni.value = note;
    ni.disabled = !p;
    $('#noteView').textContent = note;
    const bn = $('#bossName');
    if (document.activeElement !== bn) bn.value = b ? b.name : '';
    const pn = $('#phaseName');
    if (document.activeElement !== pn) pn.value = p ? p.name : '';
    const m = (b && b.map) || {};
    document.querySelectorAll('#templateBtns [data-tpl]').forEach(btn =>
      btn.classList.toggle('active', m.kind !== 'image' && (m.template || 'circle') === btn.dataset.tpl));
    const mu = $('#mapUrl');
    if (document.activeElement !== mu) mu.value = m.kind === 'image' && /^https?:/.test(m.src || '') ? m.src : '';
    const sn = $('#stageNote');
    sn.hidden = !b || !p || !note;
    if (b && p && note) sn.innerHTML = `<b>${esc(b.name)} · ${esc(p.name)}</b>${esc(note)}`;
  }

  $('#templateBtns').innerHTML = Object.keys(RP.MAP_TEMPLATES).map(k =>
    `<button class="btn small" data-tpl="${k}">${RP.MAP_TEMPLATES[k].name}</button>`).join('');
  $('#templateBtns').addEventListener('click', e => {
    const b = e.target.closest('[data-tpl]');
    if (b && boss()) set(['bosses', view.bossId, 'map'], { kind: 'template', template: b.dataset.tpl });
  });
  $('#mapUrlBtn').onclick = () => {
    const url = $('#mapUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) return toast('https:// 로 시작하는 이미지 주소를 넣어주세요');
    if (boss()) set(['bosses', view.bossId, 'map'], { kind: 'image', src: url });
  };
  $('#mapFile').addEventListener('change', e => { loadImageFile(e.target.files[0]); e.target.value = ''; });

  function loadImageFile(file) {
    if (!canEdit() || !boss()) return;
    if (!file || !/^image\//.test(file.type)) return toast('이미지 파일이 아닙니다');
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
      toast('지형 이미지를 적용했습니다');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('이미지를 읽지 못했습니다'); };
    img.src = url;
  }
  document.addEventListener('paste', e => {
    if (!canEdit() || e.target.closest && e.target.closest('input, textarea')) return;
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

  $('#noteInput').addEventListener('input', e => {
    const path = [...phasePath(), 'note'];
    const v = e.target.value.slice(0, 4000);
    debounce('note', () => set(path, v), 400);
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
    if (b && await ask({ title: `'${b.name}' 보스를 지울까요?`, message: '이 보스의 모든 단계와 배치가 지워집니다.', ok: '삭제', danger: true })) set(['bosses', id], null);
  };
  $('#phaseAdd').onclick = addPhase;
  $('#phaseLeft').onclick = () => move(phases(boss()), view.phaseId, -1, id => ['bosses', view.bossId, 'phases', id]);
  $('#phaseRight').onclick = () => move(phases(boss()), view.phaseId, 1, id => ['bosses', view.bossId, 'phases', id]);
  $('#phaseDel').onclick = () => {
    const p = phase();
    if (!p) return;
    if (phases(boss()).length < 2) return toast('단계는 하나 이상 있어야 합니다');
    const path = phasePath();
    ask({ title: `'${p.name}' 단계를 지울까요?`, ok: '삭제', danger: true }).then(ok => { if (ok) set(path, null); });
  };

  // ---------- 비어 있을 때: 레이드 선택 ----------
  function renderEmpty() {
    const el = $('#emptyState');
    const sig = JSON.stringify([ready, bosses().length > 0, VIEW_ONLY]);
    if (!changed('empty', sig)) return;
    if (ready && bosses().length) { el.hidden = true; return; }
    el.hidden = false;
    if (!ready) { el.innerHTML = '<div class="empty-card"><h2>불러오는 중…</h2></div>'; return; }
    if (VIEW_ONLY) {
      el.innerHTML = '<div class="empty-card"><h2>아직 작전판이 비어 있습니다</h2><p class="hint">공대장이 보스를 추가하면 여기에 바로 나타납니다.</p></div>';
      return;
    }
    el.innerHTML = '<div class="empty-card"><h2>어떤 레이드를 준비할까요?</h2>' +
      '<p class="hint">보스와 단계 이름은 나중에 언제든 바꿀 수 있습니다.</p><div class="preset-list">' +
      RP.PRESETS.map(p => `<button class="preset" data-preset="${p.id}"><b>${esc(p.name)}</b><span>${esc(p.sub)}</span></button>`).join('') +
      '</div></div>';
  }
  $('#emptyState').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b || !canEdit()) return;
    const p = RP.PRESETS.find(x => x.id === b.dataset.preset);
    const ops = p.bosses.map((def, i) => {
      const d = typeof def === 'string' ? { name: def } : def;
      const ph = {};
      (d.phases || ['1단계']).forEach((n, j) => { ph['p' + (j + 1)] = { name: n, order: j }; });
      return [['bosses', p.id + (i + 1)], { name: d.name, order: i, map: { kind: 'template', template: 'circle' }, phases: ph }];
    });
    if (!(state.meta && state.meta.title)) ops.push([['meta', 'title'], p.id === 'blank' ? '공격대 작전판' : p.name + ' 작전']);
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
      title: first ? '이름을 입력하세요' : '내 이름',
      message: '접속자 목록에 이 이름으로 보입니다. 게임 캐릭터 이름을 적어 주세요.',
      value: me.name || '', ok: first ? '입장' : '저장', cancel: first ? '나중에' : '취소', suggest: 'rosterNames'
    });
    if (n === null || !n.trim()) return false;
    setMyName(n.trim());
    return true;
  }
  let namePromptQueued = false;
  function promptNameOnce() {
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
    toast('발표를 시작했습니다. 보기 링크를 공대원에게 공유하세요');
  };
  $('#presentBanner').addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'stop') $('#presentBtn').click();
    else { view.follow = a.dataset.act === 'follow'; scheduleRender(); }
  });

  // ---------- 링크 / 크게 보기 / 백업 ----------
  async function copyLink(viewOnly) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', room);
    if (viewOnly) u.searchParams.set('mode', 'view');
    const s = u.toString();
    const done = sync.mode === 'local' ? '링크를 복사했습니다. 다만 지금은 로컬 모드라 다른 사람에게는 보이지 않습니다'
      : viewOnly ? '보기 전용 링크를 복사했습니다' : '편집 링크를 복사했습니다';
    try { await navigator.clipboard.writeText(s); toast(done); }
    catch (e) { ask({ title: '아래 링크를 복사하세요', value: s, ok: '닫기' }); }
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
    a.download = `작전판-${(state.meta && state.meta.title) || room}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    f.text().then(async txt => {
      const data = JSON.parse(txt);
      const s = data && data.state;
      if (!s || typeof s !== 'object') throw new Error('형식 오류');
      if (!await ask({ title: '백업 파일로 바꿀까요?', message: '현재 작전판 내용이 백업 내용으로 바뀝니다.', ok: '불러오기', danger: true })) return;
      const ops = [[['meta'], s.meta || null], [['roster'], s.roster || null], [['present'], null], [['bosses'], null]];
      Object.entries(s.bosses || {}).forEach(([id, b]) => ops.push([['bosses', id], b]));
      commit(ops);
      toast('백업을 불러왔습니다');
    }).catch(() => toast('백업 파일을 읽지 못했습니다'));
  });
  $('#newPlanBtn').onclick = async () => {
    if (await ask({ title: '새 작전판을 만들까요?', message: '지금 작전판은 지금 주소(링크)로 다시 열 수 있습니다.', ok: '만들기' })) {
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
  const typing = e => e.target.closest && e.target.closest('input, textarea, select');
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
    else if (k === 'Escape') { toggleStageOnly(false); togglePing(false); setTool('select'); }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceHeld = false; viewport.classList.remove('space-pan'); }
  });
  window.addEventListener('blur', () => { spaceHeld = false; viewport.classList.remove('space-pan'); });

  // ---------- 대화상자 / 알림 ----------
  // value 가 있으면 입력칸을 보여 주고 입력값을, 없으면 확인 여부(true)를 돌려줍니다. 취소는 null.
  function ask({ title, message = '', value = null, ok = '확인', cancel = '취소', danger = false, suggest = null }) {
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

  fillSelects();
  render();
  window.RP.debug = { get state() { return state; }, view, sync };
})();
