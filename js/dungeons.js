// 던전 도감: 던전 선택, 지도와 보스 위치, 공략, 획득 아이템, 그리기, 실시간 공유(편집·보기 링크)
// 기본 자료는 js/dungeon-data.js, 작전판(room)마다 고친 내용은 state.edits 에 저장합니다.
(function () {
  'use strict';
  const RP = window.RP;
  const $ = s => document.querySelector(s);
  const tr = (k, v) => RP.t(k, v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = v => (v === null || v === undefined) ? null : JSON.parse(JSON.stringify(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = v => Math.round(v * 10000) / 10000;
  const storage = area => ({
    get: k => { try { return window[area].getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { window[area].setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } }
  });
  const local = storage('localStorage'), session = storage('sessionStorage');
  // 자료의 [한국어, 영어] 중 지금 언어
  const L = v => (Array.isArray(v) ? (RP.lang() === 'en' ? (v[1] || v[0]) : v[0]) : (v || ''));
  const dunName = d => (RP.lang() === 'en' ? d.en : d.ko);
  const bossName = b => (RP.lang() === 'en' ? b.en : (b.ko || b.en));

  // ---------- 작전판 / 모드 ----------
  const params = new URLSearchParams(location.search);
  const VIEW_ONLY = params.get('mode') === 'view';
  let room = (params.get('room') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!room) {
    room = 'd' + RP.uid(9);
    params.set('room', room);
    try { history.replaceState(null, '', location.pathname + '?' + params + location.hash); } catch (e) { /* 샌드박스 */ }
  }
  if (VIEW_ONLY) document.body.classList.add('view-mode');
  const myId = session.get('rp-client') || RP.uid(8);
  session.set('rp-client', myId);
  const me = { id: myId, name: local.get('rp-name') || '', color: '#e2b356' };

  // ---------- 상태 ----------
  const DUNS = RP.DUNGEONS;
  const dunById = id => DUNS.find(d => d.id === id);
  const COLORS = ['#ff5a4f', '#ffd23f', '#4fc36b', '#4fa8ff', '#b98cff'];
  const TOOLS = [['move', '이동 / 보스 선택'], ['pen', '펜'], ['hl', '형광펜'], ['arrow', '화살표'], ['rect', '사각형'], ['text', '글자'], ['erase', '지우개']];
  let state = {}, ready = false, peers = [], lastStatus = null;
  const ui = { tool: 'move', color: COLORS[0], width: 4, zoom: 1, panX: 0, panY: 0, level: Number(local.get('rp-atlas-level')) || null, q: '',
    legend: { 1: true, 0: false }[local.get('rp-atlas-legend')] ?? null };
  let localSel = { d: dunById(params.get('d')) ? params.get('d') : (local.get('rp-atlas-dun') || DUNS[0].id), b: 0 };
  let follow = true, lastSelKey = '';

  const canEdit = () => !VIEW_ONLY && ready;
  // 공대원(보기 링크)은 공대장이 고른 던전·보스를 따라감. 직접 고르면 다음 변경 때까지는 자기 선택
  function current() {
    const key = JSON.stringify(state.sel || null);
    if (key !== lastSelKey) { lastSelKey = key; if (state.sel) follow = true; }
    const s = follow && state.sel && dunById(state.sel.d) ? state.sel : localSel;
    const d = dunById(s.d) || DUNS[0];
    const b = clamp(Number(s.b) || 0, 0, Math.max(0, d.bosses.length - 1));
    const p = pinOf(d, b);
    const f = clamp(Number.isInteger(s.f) ? s.f : (p ? p.f : 0), 0, floorCount(d) - 1);
    return { d, b, f };
  }
  // 층을 정하지 않으면 그 보스가 있는 층으로 (위치가 없으면 지금 층 그대로)
  function select(dId, b, f) {
    b = b || 0;
    if (f === undefined) {
      const d = dunById(dId), cur = current(), p = d && pinOf(d, b);
      f = p ? p.f : (cur.d.id === dId ? cur.f : 0);
    }
    localSel = { d: dId, b, f };
    local.set('rp-atlas-dun', dId);
    if (canEdit()) set(['sel'], localSel);
    else { follow = false; scheduleRender(); }
  }

  // 작전판에서 고친 내용 (지도, 보스 위치, 공략, 추가 아이템)
  // 층(f): 기본 지도는 d.maps[f], 올린 지도는 1층이 edits.map, 그 위 층은 edits.maps.f<번호>
  const edits = d => (state.edits && state.edits[d.id]) || {};
  const floorCount = d => Math.max(1, (d.maps || []).length);
  const mapEdit = (d, f) => (f ? (edits(d).maps || {})['f' + f] : edits(d).map) || '';
  const mapPath = (d, f) => (f ? ['edits', d.id, 'maps', 'f' + f] : ['edits', d.id, 'map']);
  const mapOf = (d, f) => mapEdit(d, f) || ((d.maps || [])[f] || {}).src || (f ? '' : d.map || '');
  const floorName = (d, f) => { const m = (d.maps || [])[f]; return m && m.name ? L(m.name) : tr('{n}층', { n: f + 1 }); };
  const drawKey = (d, f) => (f ? `${d.id}-f${f}` : d.id);
  function pinOf(d, i) {
    const p = (edits(d).pins || {})['b' + i];
    if (p && typeof p.x === 'number') return { x: p.x, y: p.y, f: clamp(Number(p.f) || 0, 0, floorCount(d) - 1), edited: true };
    const pos = d.bosses[i] && d.bosses[i].pos;
    return pos ? { x: pos[0], y: pos[1], f: clamp(pos[2] || 0, 0, floorCount(d) - 1) } : null;
  }
  function tipsOf(d, i) {
    const t = (edits(d).tips || {})['b' + i];
    return typeof t === 'string' ? t : L(d.bosses[i] && d.bosses[i].tips);
  }
  function lootOf(d, i) {
    const base = ((d.bosses[i] && d.bosses[i].loot) || []).map(it => ({
      name: RP.lang() === 'en' ? it.en : (it.ko || it.en), slot: L(it.slot), lvl: it.lvl || '', stats: L(it.stats)
    }));
    const added = Object.entries((edits(d).loot || {})['b' + i] || {})
      .filter(([, it]) => it && typeof it === 'object')
      .sort((a, b) => (a[1].o || 0) - (b[1].o || 0))
      .map(([id, it]) => ({ id, name: it.name, slot: it.slot || '', lvl: it.lvl || '', stats: it.stats || '' }));
    return base.concat(added);
  }

  // ---------- 동기화 ----------
  const sync = RP.connect(room, {
    onSnapshot(s) { state = s || {}; if (drawing) RP.applyOp(state, drawing.path, clone(drawing.shape)); ready = true; scheduleRender(); },
    onOp(p, v) { if (Array.isArray(p) && p.length) { RP.applyOp(state, p, clone(v)); scheduleRender(); } },
    onStatus(kind, text, vars) {
      lastStatus = [kind, text, vars];
      $('#connDot').className = 'dot ' + kind;
      $('#connText').textContent = tr(text, vars);
    },
    onPeers(ps) { peers = Array.isArray(ps) ? ps : []; renderPeers(); },
    onPing() {}
  }, me);

  function commit(ops) {
    if (!canEdit()) return;
    ops.forEach(([p, v]) => RP.applyOp(state, p, clone(v)));
    sync.batch(ops);
    scheduleRender();
  }
  const set = (path, value) => commit([[path, value]]);
  const throttles = new Map();
  function setThrottled(path, value) {
    RP.applyOp(state, path, clone(value));
    const key = path.join('/');
    let t = throttles.get(key);
    if (!t) { t = { last: 0, timer: 0, path, value }; throttles.set(key, t); }
    t.value = value;
    const wait = 70 - (performance.now() - t.last);
    if (wait <= 0) { t.last = performance.now(); sync.set(path, value); }
    else if (!t.timer) t.timer = setTimeout(() => { t.timer = 0; t.last = performance.now(); sync.set(t.path, t.value); }, wait);
  }
  function endThrottle(path) {
    const t = throttles.get(path.join('/'));
    if (t) { clearTimeout(t.timer); throttles.delete(path.join('/')); }
  }

  // ---------- 화면 갱신 ----------
  let rafId = 0;
  function scheduleRender() { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(); }); }
  const sigs = {};
  const changed = (k, s) => (sigs[k] === s ? false : (sigs[k] = s, true));

  function render() {
    const cur = current();
    renderHeader(cur);
    renderPicker(cur);
    renderMap(cur);
    renderFloors(cur);
    renderPins(cur);
    renderDrawings(cur);
    renderLegend(cur);
    renderTabs(cur);
    renderSide(cur);
  }

  function levelText(d) { return d.max ? `${d.min}–${d.max}` : `${d.min}+`; }

  function renderHeader({ d }) {
    if (!changed('head', JSON.stringify([d.id, RP.lang()]))) return;
    $('#dunTitle').textContent = `${dunName(d)} · ${tr('던전 지도')}`;
    $('#dunMeta').innerHTML = `${esc(L(d.zone))} · ${tr('레벨 {lv}', { lv: levelText(d) })}` +
      (d.isNew ? `<span class="badge-new">${tr('신규')}</span>` : '') +
      (d.beta ? `<span class="badge-beta">${tr('베타 자료')}</span>` : '');
    document.title = `${dunName(d)} · ${tr('던전 도감')}`;
  }

  function renderPeers() {
    $('#peers').textContent = peers.length ? '· ' + tr('접속 {n}명', { n: peers.length }) : '';
    $('#peers').title = peers.map(p => (p && p.name) || tr('이름 없음')).join(', ');
  }

  // ---------- 던전 선택 ----------
  function renderPicker({ d }) {
    if ($('#dunPicker').hidden) return;
    const q = ui.q.trim().toLowerCase(), lv = ui.level;
    if (!changed('picker', JSON.stringify([d.id, q, lv, RP.lang()]))) return;
    const rows = DUNS.filter(x => !q || x.ko.toLowerCase().includes(q) || x.en.toLowerCase().includes(q));
    $('#dpList').innerHTML = rows.length ? rows.map(x => {
      const fit = lv && lv >= x.min - 2 && lv <= (x.max || 60) + 2;
      return `<li><button type="button" data-dun="${x.id}" aria-current="${x.id === d.id}" class="${lv ? (fit ? 'fit' : 'unfit') : ''}">` +
        `<span class="dp-name">${esc(dunName(x))}${x.isNew ? `<span class="badge-new">${tr('신규')}</span>` : ''}</span>` +
        `<span class="dp-lvl">${levelText(x)}</span></button></li>`;
    }).join('') : `<li class="dp-group">${tr('찾는 던전이 없습니다')}</li>`;
  }
  function togglePicker(open) {
    const p = $('#dunPicker');
    const v = open === undefined ? p.hidden : open;
    p.hidden = !v;
    $('#dunPickBtn').setAttribute('aria-expanded', String(v));
    sigs.picker = null;
    if (v) {
      $('#dpLevel').value = ui.level || '';
      render();
      const cur = $('#dpList [aria-current="true"]');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
      $('#dpSearch').focus();
    }
  }
  $('#dunPickBtn').onclick = e => { e.stopPropagation(); togglePicker(); };
  $('#dpSearch').addEventListener('input', e => { ui.q = e.target.value; render(); });
  $('#dpLevelOk').onclick = () => {
    const v = Number($('#dpLevel').value);
    ui.level = v >= 1 && v <= 60 ? v : null;
    local.set('rp-atlas-level', ui.level ? String(ui.level) : '');
    render();
  };
  $('#dpLevel').addEventListener('keydown', e => { if (e.key === 'Enter') $('#dpLevelOk').click(); });
  $('#dpReset').onclick = () => { ui.level = null; ui.q = ''; $('#dpLevel').value = ''; $('#dpSearch').value = ''; local.set('rp-atlas-level', ''); render(); };
  $('#dpList').addEventListener('click', e => {
    const b = e.target.closest('[data-dun]');
    if (!b) return;
    select(b.dataset.dun, 0);
    togglePicker(false);
  });
  document.addEventListener('pointerdown', e => {
    if (!$('#dunPicker').hidden && !e.target.closest('#dunPicker, #dunPickBtn')) togglePicker(false);
  }, true);

  // ---------- 지도 ----------
  const viewport = $('#viewport'), stage = $('#stage'), mapImg = $('#mapImg'), drawSvg = $('#drawLayer');
  let natW = 1600, natH = 1000, baseX = 0, baseY = 0, baseW = 0, baseH = 0, zoomDun = null, svgH = 1000;
  const SVG_W = 1000;

  function renderMap({ d, f }) {
    if (zoomDun !== d.id + '/' + f) {
      if (!zoomDun || zoomDun.split('/')[0] !== d.id) { undo.length = 0; redo.length = 0; }
      zoomDun = d.id + '/' + f;
      ui.zoom = 1; ui.panX = 0; ui.panY = 0;
    }
    const src = mapOf(d, f);
    const ph = $('#mapPlaceholder');
    if (!src) {
      mapImg.hidden = true;
      mapImg.removeAttribute('src');
      mapImg.dataset.want = '';
      ph.hidden = false;
      ph.innerHTML = `<div><b>${tr('지도 준비 중')}</b>${canEdit() ? tr('오른쪽 아래 "지도"에서 이미지를 올리거나, 스크린샷을 Ctrl+V 로 붙여넣으세요.') : tr('공대장이 지도를 올리면 여기에 보입니다.')}</div>`;
      if (natW !== 1600 || natH !== 1000) { natW = 1600; natH = 1000; layoutStage(); }
    } else {
      ph.hidden = true;
      mapImg.hidden = false;
      if (mapImg.dataset.want !== src) { mapImg.dataset.want = src; mapImg.src = src; }
    }
  }
  mapImg.addEventListener('load', () => { natW = mapImg.naturalWidth || 1600; natH = mapImg.naturalHeight || 1000; layoutStage(); });
  mapImg.addEventListener('error', () => { if (mapImg.dataset.want) toast(tr('지도 이미지를 불러오지 못했습니다. 주소를 확인하세요')); });

  function layoutStage() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const pad = vw < 600 ? 6 : 14;
    const s = Math.max(0.01, Math.min((vw - pad * 2) / natW, (vh - pad * 2) / natH));
    baseW = natW * s; baseH = natH * s;
    stage.style.width = baseW + 'px';
    stage.style.height = baseH + 'px';
    baseX = (vw - baseW) / 2;
    baseY = (vh - baseH) / 2;
    const h = Math.round(SVG_W * natH / natW);
    if (h !== svgH) { svgH = h; drawSvg.setAttribute('viewBox', `0 0 ${SVG_W} ${svgH}`); sigs.draw = null; renderDrawings(current()); }
    applyTransform();
  }
  function applyTransform() {
    stage.style.transform = `translate(${baseX + ui.panX}px, ${baseY + ui.panY}px) scale(${ui.zoom})`;
    stage.style.setProperty('--inv', String(1 / ui.zoom));
    $('#zoomReset').textContent = Math.round(ui.zoom * 100) + '%';
  }
  function zoomAt(cx, cy, f) {
    const z = clamp(ui.zoom * f, 0.5, 8);
    const ux = (cx - baseX - ui.panX) / ui.zoom, uy = (cy - baseY - ui.panY) / ui.zoom;
    ui.panX = cx - baseX - ux * z;
    ui.panY = cy - baseY - uy * z;
    ui.zoom = z;
    applyTransform();
  }
  new ResizeObserver(layoutStage).observe(viewport);
  function stagePoint(cx, cy) {
    const r = stage.getBoundingClientRect();
    return r.width ? { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height } : null;
  }
  const inMap = p => p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  viewport.addEventListener('wheel', e => {
    if (e.target.closest('.boss-legend')) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  const zc = f => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, f);
  $('#zoomIn').onclick = () => zc(1.25);
  $('#zoomOut').onclick = () => zc(0.8);
  $('#zoomReset').onclick = () => { ui.zoom = 1; ui.panX = 0; ui.panY = 0; applyTransform(); };
  $('#bigBtn').onclick = () => {
    const on = document.body.classList.toggle('big');
    $('#bigBtn').textContent = on ? tr('작게 보기') : tr('크게 보기');
  };

  // ---------- 층 ----------
  function renderFloors({ d, f }) {
    const n = floorCount(d), el = $('#floorTabs');
    const sig = JSON.stringify([d.id, f, n, RP.lang(), d.bosses.map((x, i) => pinOf(d, i))]);
    if (!changed('floors', sig)) return;
    el.hidden = n < 2;
    el.innerHTML = n < 2 ? '' : Array.from({ length: n }, (_, i) => {
      const nums = d.bosses.map((x, j) => { const p = pinOf(d, j); return p && p.f === i ? j + 1 : 0; }).filter(Boolean);
      return `<button type="button" data-floor="${i}" aria-pressed="${i === f}">${esc(floorName(d, i))}` +
        (nums.length ? `<span class="fl-n">${nums.join('·')}</span>` : '') + '</button>';
    }).join('');
  }
  $('#floorTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-floor]');
    if (!t) return;
    const { d, b } = current();
    select(d.id, b, Number(t.dataset.floor));
  });

  // ---------- 보스 위치 핀 ----------
  function renderPins({ d, b, f }) {
    const sig = JSON.stringify([d.id, b, f, d.bosses.map((x, i) => pinOf(d, i))]);
    if (!changed('pins', sig)) return;
    $('#pinLayer').innerHTML = d.bosses.map((x, i) => {
      const p = pinOf(d, i);
      return p && p.f === f ? `<button type="button" class="pin${i === b ? ' active' : ''}" data-boss="${i}" style="left:${p.x * 100}%;top:${p.y * 100}%" title="${esc(bossName(x))}">${i + 1}</button>` : '';
    }).join('');
  }
  function renderLegend({ d, b, f }) {
    const lg = $('#bossLegend');
    if (!d.bosses.length) { lg.hidden = true; return; }
    lg.hidden = false;
    const pins = d.bosses.map((x, i) => pinOf(d, i));
    const missing = pins.some(p => !p), multi = floorCount(d) > 1;
    // 위치가 다 있으면 접어서 지도를 가리지 않음 (직접 펼치거나 접은 것은 기억)
    const open = ui.legend === null ? missing && canEdit() : ui.legend;
    const sig = JSON.stringify([d.id, b, f, pins.map(p => (p ? p.f : -1)), RP.lang(), canEdit(), open]);
    if (!changed('legend', sig)) return;
    lg.classList.toggle('collapsed', !open);
    const head = `<button type="button" class="lg-toggle" aria-expanded="${open}">${tr('보스 번호')} <span aria-hidden="true">${open ? '▴' : '▾'}</span></button>`;
    if (!open) { lg.innerHTML = head; return; }
    const hint = missing ? (canEdit() ? tr('위치 미확인 · 번호를 지도로 끌어다 놓기') : tr('위치 미확인 · 클릭하면 공략'))
      : multi ? tr('클릭하면 공략 · 다른 층 보스는 그 층으로') : tr('클릭하면 공략');
    lg.innerHTML = `${head}<p>${hint}</p>` +
      '<div class="legend-nums">' + d.bosses.map((x, i) => {
        const p = pins[i];
        const cls = (i === b ? 'active' : '') + (!p ? ' nopos' : p.f !== f ? ' other' : '');
        const title = bossName(x) + (p && multi ? ' · ' + floorName(d, p.f) : '');
        return `<button type="button" data-boss="${i}" class="${cls}" title="${esc(title)}">${i + 1}</button>`;
      }).join('') + '</div>';
  }
  function renderTabs({ d, b }) {
    const sig = JSON.stringify([d.id, b, RP.lang()]);
    if (!changed('tabs', sig)) return;
    $('#bossTabs').innerHTML = d.bosses.map((x, i) =>
      `<button type="button" data-boss="${i}" aria-current="${i === b}"><span class="n">${i + 1}</span><span>${esc(bossName(x))}</span>${x.opt ? `<span class="opt">${tr('선택')}</span>` : ''}</button>`).join('');
  }
  $('#bossTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-boss]');
    if (t) select(current().d.id, Number(t.dataset.boss));
  });

  // 핀: 클릭하면 공략, 편집 링크에서는 끌어서 위치 옮기기
  // 범례 번호: 클릭하면 공략, 편집 링크에서는 지도로 끌어다 놓아 위치 지정
  function beginPinDrag(e, i, fromLegend) {
    const { d, f } = current();
    const sx = e.clientX, sy = e.clientY;
    let moved = false, ghost = null;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      if (!canEdit()) return;
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'pin active';
        ghost.textContent = String(i + 1);
        ghost.style.position = 'fixed';
        ghost.style.zIndex = '2000';
        ghost.style.pointerEvents = 'none';
        document.body.appendChild(ghost);
      }
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (ghost) ghost.remove();
      if (!moved) { select(d.id, i); return; }
      if (!canEdit() || ev.type === 'pointercancel') return;
      const p = stagePoint(ev.clientX, ev.clientY);
      if (inMap(p)) set(['edits', d.id, 'pins', 'b' + i], { x: round(p.x), y: round(p.y), f });
      else if (!fromLegend) { set(['edits', d.id, 'pins', 'b' + i], null); toast(tr('보스 위치를 지웠습니다')); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  $('#pinLayer').addEventListener('pointerdown', e => {
    const p = e.target.closest('[data-boss]');
    if (!p || ui.tool !== 'move') return;
    e.stopPropagation();
    e.preventDefault();
    beginPinDrag(e, Number(p.dataset.boss), false);
  });
  $('#bossLegend').addEventListener('click', e => {
    const t = e.target.closest('.lg-toggle');
    if (!t) return;
    ui.legend = t.getAttribute('aria-expanded') !== 'true';
    local.set('rp-atlas-legend', ui.legend ? '1' : '0');
    render();
  });
  $('#bossLegend').addEventListener('pointerdown', e => {
    const p = e.target.closest('[data-boss]');
    e.stopPropagation();
    if (!p) return;
    e.preventDefault();
    beginPinDrag(e, Number(p.dataset.boss), true);
  });

  // ---------- 그리기 ----------
  const drawEls = new Map();
  const undo = [], redo = [];
  let drawing = null;
  const validColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const P = (x, y) => `${(x * SVG_W).toFixed(1)} ${(y * svgH).toFixed(1)}`;
  const parsePts = d => String(d || '').split(' ').map(s => s.split(',').map(Number)).filter(p => p.length === 2 && isFinite(p[0]) && isFinite(p[1]));

  function shapeSVG(s) {
    const c = validColor(s.c) ? s.c : COLORS[0];
    const w = clamp(Number(s.w) || 4, 1, 40);
    const hitW = Math.max(w * (s.t === 'hl' ? 3 : 1), 18);
    if (s.t === 'pen' || s.t === 'hl') {
      const pts = parsePts(s.d);
      if (!pts.length) return '';
      let d = 'M' + P(pts[0][0], pts[0][1]);
      if (pts.length === 1) d += ' L' + P(pts[0][0] + 0.0005, pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) d += ' Q' + P(pts[i][0], pts[i][1]) + ' ' + P((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      if (pts.length > 1) d += ' L' + P(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      const look = s.t === 'hl' ? `stroke-width="${w * 3}" stroke-opacity=".38"` : `stroke-width="${w}"`;
      return `<path d="${d}" fill="none" stroke="${c}" ${look} stroke-linecap="round" stroke-linejoin="round"/><path class="hit" d="${d}" stroke-width="${hitW}"/>`;
    }
    if (s.t === 'text') {
      const fs = 16 + w * 2;
      return `<text x="${(s.x * SVG_W).toFixed(1)}" y="${(s.y * svgH).toFixed(1)}" fill="${c}" font-size="${fs}" font-weight="800" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" stroke="#000" stroke-width="${(fs / 7).toFixed(1)}" paint-order="stroke">${esc(s.s || '')}</text>`;
    }
    const x1 = Number(s.x1), y1 = Number(s.y1), x2 = Number(s.x2), y2 = Number(s.y2);
    if (![x1, y1, x2, y2].every(isFinite)) return '';
    const st = `stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
    if (s.t === 'arrow') {
      const ax = x1 * SVG_W, ay = y1 * svgH, bx = x2 * SVG_W, by = y2 * svgH;
      const a = Math.atan2(by - ay, bx - ax), len = Math.max(16, w * 3.4);
      const h1 = `${(bx - len * Math.cos(a - 0.45)).toFixed(1)} ${(by - len * Math.sin(a - 0.45)).toFixed(1)}`;
      const h2 = `${(bx - len * Math.cos(a + 0.45)).toFixed(1)} ${(by - len * Math.sin(a + 0.45)).toFixed(1)}`;
      const d = `M${P(x1, y1)} L${P(x2, y2)}`;
      return `<path d="${d}" ${st}/><path d="M${h1} L${bx.toFixed(1)} ${by.toFixed(1)} L${h2}" ${st}/><path class="hit" d="${d}" stroke-width="${hitW}"/>`;
    }
    const L0 = Math.min(x1, x2) * SVG_W, T0 = Math.min(y1, y2) * svgH, W0 = Math.abs(x2 - x1) * SVG_W, H0 = Math.abs(y2 - y1) * svgH;
    const a = `x="${L0.toFixed(1)}" y="${T0.toFixed(1)}" width="${W0.toFixed(1)}" height="${H0.toFixed(1)}" rx="3"`;
    return `<rect ${a} ${st}/><rect class="hit" ${a} stroke-width="${hitW}"/>`;
  }

  function renderDrawings({ d, f }) {
    const shapes = (state.draw && state.draw[drawKey(d, f)]) || {};
    const ids = Object.keys(shapes).filter(id => shapes[id] && typeof shapes[id] === 'object')
      .sort((a, b) => (shapes[a].o || 0) - (shapes[b].o || 0) || a.localeCompare(b));
    const seen = new Set();
    let prev = null;
    for (const id of ids) {
      const sig = JSON.stringify(shapes[id]) + '|' + svgH;
      let g = drawEls.get(id);
      if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.dataset.shape = id; drawEls.set(id, g); }
      if (g._sig !== sig) { g.innerHTML = shapeSVG(shapes[id]); g._sig = sig; }
      const want = prev ? prev.nextSibling : drawSvg.firstChild;
      if (g !== want) drawSvg.insertBefore(g, want);
      prev = g;
      seen.add(id);
    }
    for (const [id, g] of drawEls) if (!seen.has(id)) { g.remove(); drawEls.delete(id); }
  }

  function track(onMove, onEnd) {
    const up = ev => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd(ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  function record(path, before, after) {
    undo.push({ path, before: clone(before), after: clone(after) });
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  }
  function eraseAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    const g = el && el.closest && el.closest('[data-shape]');
    if (!g || !drawSvg.contains(g)) return;
    const { d, f } = current(), k = drawKey(d, f);
    const path = ['draw', k, g.dataset.shape];
    const before = state.draw && state.draw[k] && state.draw[k][g.dataset.shape];
    if (!before) return;
    record(path, before, null);
    set(path, null);
  }
  async function placeText(pt) {
    const { d, f } = current();
    const s = await ask({ title: tr('지도에 쓸 글자'), value: '' });
    if (!s || !s.trim()) return;
    const path = ['draw', drawKey(d, f), 'd' + RP.uid(7)];
    const shape = { t: 'text', s: s.trim().slice(0, 40), x: round(pt.x), y: round(pt.y), c: ui.color, w: ui.width, o: Date.now() };
    record(path, null, shape);
    set(path, shape);
  }

  viewport.addEventListener('pointerdown', e => {
    if (e.target.closest('.boss-legend, .pin')) return;
    const pt = stagePoint(e.clientX, e.clientY);
    if (ui.tool !== 'move' && canEdit() && e.button === 0) {
      e.preventDefault();
      if (ui.tool === 'erase') { eraseAt(e.clientX, e.clientY); track(ev => eraseAt(ev.clientX, ev.clientY), () => {}); return; }
      if (!inMap(pt)) return;
      if (ui.tool === 'text') { placeText(pt); return; }
      const { d, f } = current();
      const path = ['draw', drawKey(d, f), 'd' + RP.uid(7)];
      const x = round(pt.x), y = round(pt.y);
      const shape = { t: ui.tool, c: ui.color, w: ui.width, o: Date.now() };
      if (ui.tool === 'pen' || ui.tool === 'hl') shape.d = `${x},${y}`;
      else Object.assign(shape, { x1: x, y1: y, x2: x, y2: y });
      drawing = { path, shape };
      let last = [e.clientX, e.clientY];
      const update = () => { setThrottled(path, Object.assign({}, shape)); renderDrawings(current()); };
      update();
      track(ev => {
        const p = stagePoint(ev.clientX, ev.clientY);
        if (!p) return;
        const nx = round(clamp(p.x, 0, 1)), ny = round(clamp(p.y, 0, 1));
        if (shape.d !== undefined) {
          if (Math.hypot(ev.clientX - last[0], ev.clientY - last[1]) < 3 || shape.d.length > 8000) return;
          last = [ev.clientX, ev.clientY];
          shape.d += ` ${nx},${ny}`;
        } else { shape.x2 = nx; shape.y2 = ny; }
        update();
      }, () => {
        endThrottle(path);
        drawing = null;
        const tiny = shape.d === undefined && Math.abs(shape.x2 - shape.x1) < 0.004 && Math.abs(shape.y2 - shape.y1) < 0.004;
        if (tiny) set(path, null);
        else { record(path, null, shape); set(path, shape); }
      });
      return;
    }
    // 이동: 빈 곳을 끌면 지도 이동
    if (e.button !== 0 && e.button !== 1) return;
    const sx = e.clientX, sy = e.clientY, px = ui.panX, py = ui.panY;
    viewport.classList.add('panning');
    track(ev => { ui.panX = px + ev.clientX - sx; ui.panY = py + ev.clientY - sy; applyTransform(); }, () => viewport.classList.remove('panning'));
  });

  function buildTools() {
    $('#atColors').innerHTML = COLORS.map(c =>
      `<button type="button" data-color="${c}" style="background:${c}" aria-pressed="${c === ui.color}" title="${tr('색')}" aria-label="${tr('색')}"></button>`).join('');
    $('#atTools').innerHTML = TOOLS.map(([id, name]) =>
      `<button type="button" data-tool="${id}" aria-pressed="${id === ui.tool}">${tr(name)}</button>`).join('');
  }
  function setTool(t) {
    ui.tool = t;
    document.querySelectorAll('#atTools [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    viewport.classList.toggle('tool-draw', !['move', 'erase'].includes(t));
    viewport.classList.toggle('tool-erase', t === 'erase');
  }
  $('#atTools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#atColors').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    ui.color = b.dataset.color;
    document.querySelectorAll('#atColors [data-color]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (ui.tool === 'move' || ui.tool === 'erase') setTool('pen');
  });
  $('#atWidth').addEventListener('input', e => { ui.width = Number(e.target.value) || 4; });
  $('#atUndo').onclick = () => {
    const a = undo.pop();
    if (!a) return toast(tr('되돌릴 그림이 없습니다'));
    redo.push(a);
    set(a.path, a.before);
  };
  $('#atRedo').onclick = () => {
    const a = redo.pop();
    if (!a) return toast(tr('다시 실행할 그림이 없습니다'));
    undo.push(a);
    set(a.path, a.after);
  };
  $('#atClear').onclick = async () => {
    const { d, f } = current(), k = drawKey(d, f);
    const all = state.draw && state.draw[k];
    if (!all || !Object.keys(all).length) return toast(tr('지울 그림이 없습니다'));
    if (!await ask({ title: tr('이 던전 지도의 그림을 모두 지울까요?'), message: tr('실행 취소로 되돌릴 수 있습니다.'), ok: tr('지우기'), danger: true })) return;
    record(['draw', k], all, null);
    set(['draw', k], null);
  };

  // 이미지 저장: 지도 + 그림 + 보스 번호
  const loadImg = src => new Promise((res, rej) => {
    const im = new Image();
    if (/^https?:/i.test(src)) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
  $('#atSave').onclick = async () => {
    const { d, f } = current();
    const W = natW, H = natH;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, W, H);
    const src = mapOf(d, f);
    try { if (src) ctx.drawImage(await loadImg(src), 0, 0, W, H); } catch (e) { /* 그림만 저장 */ }
    const svg = drawSvg.cloneNode(true);
    svg.querySelectorAll('.hit').forEach(x => x.remove());
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try { ctx.drawImage(await loadImg(url), 0, 0, W, H); } catch (e) { /* 그림 없음 */ }
    URL.revokeObjectURL(url);
    const r = Math.max(14, W / 70);
    d.bosses.forEach((x, i) => {
      const p = pinOf(d, i);
      if (!p || p.f !== f) return;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(14,16,20,.9)';
      ctx.fill();
      ctx.lineWidth = r / 6;
      ctx.strokeStyle = '#e2b356';
      ctx.stroke();
      ctx.fillStyle = '#e2b356';
      ctx.font = `800 ${Math.round(r * 1.05)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.x * W, p.y * H + 1);
    });
    try {
      cv.toBlob(blob => {
        if (!blob) return toast(tr('이미지를 만들지 못했습니다'));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${dunName(d)}${floorCount(d) > 1 ? ' - ' + floorName(d, f) : ''}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }, 'image/png');
    } catch (e) {
      toast(tr('주소로 넣은 지도는 저장할 수 없습니다. 지도를 파일로 올리면 저장됩니다.'));
    }
  };

  // ---------- 오른쪽: 보스 공략·아이템 ----------
  let editingTips = false;
  function renderSide({ d, b }) {
    const boss = d.bosses[b];
    const sig = JSON.stringify([d.id, b, boss && pinOf(d, b), boss && tipsOf(d, b), boss && lootOf(d, b), RP.lang(), canEdit(), editingTips]);
    if (!changed('side', sig)) return;
    if (!boss) {
      $('#bossHead').innerHTML = `<h2>${esc(dunName(d))}</h2>`;
      $('#bossLoc').textContent = tr('아직 공개된 보스 정보가 없습니다.');
      $('#tipsText').textContent = '';
      $('#tipsText').className = 'tips-text';
      $('#lootTable').innerHTML = '';
      document.querySelector('.boss-tips').hidden = true;
      document.querySelector('.boss-loot').hidden = true;
    } else {
      document.querySelector('.boss-tips').hidden = false;
      document.querySelector('.boss-loot').hidden = false;
      const sub = RP.lang() === 'ko' && boss.ko && boss.ko !== boss.en ? boss.en : '';
      $('#bossHead').innerHTML = `<span class="no">${tr('보스')} ${String(b + 1).padStart(2, '0')}</span><h2>${esc(bossName(boss))}</h2>` +
        (sub || boss.opt ? `<span class="sub">${esc(sub)}${sub && boss.opt ? ' · ' : ''}${boss.opt ? tr('선택 보스') : ''}</span>` : '');
      const p = pinOf(d, b);
      $('#bossLoc').textContent = [
        p ? '' : tr('이 보스의 지도 위치는 확인 중입니다.'),
        p && floorCount(d) > 1 ? tr('위치: {f}', { f: floorName(d, p.f) }) : '',
        p && !p.edited && d.approx ? tr('지도 위 번호는 대략적인 위치입니다') : '',
        L(boss.note)
      ].filter(Boolean).join(' · ');
      const tips = tipsOf(d, b);
      $('#tipsText').textContent = tips || tr('아직 공략이 없습니다.');
      $('#tipsText').className = 'tips-text' + (tips ? '' : ' empty-tip');
      $('#tipsText').hidden = editingTips;
      $('#tipsEdit').hidden = !editingTips;
      const items = lootOf(d, b);
      const cell = (v, cls) => (v === '' || v === undefined || v === null ? `<td class="unk ${cls || ''}">—</td>` : `<td class="${cls || ''}">${esc(v)}</td>`);
      $('#lootTable').innerHTML = items.length
        ? `<thead><tr><th>${tr('아이템')}</th><th>${tr('종류 / 부위')}</th><th>${tr('요구 레벨')}</th><th>${tr('주요 능력치')}</th>${canEdit() ? '<th></th>' : ''}</tr></thead><tbody>` +
          items.map(it => `<tr>${cell(it.name, 'item')}${cell(it.slot)}${cell(it.lvl, 'lvl')}${cell(it.stats)}` +
            (canEdit() ? `<td>${it.id ? `<button type="button" class="del" data-del="${esc(it.id)}" title="${tr('삭제')}" aria-label="${tr('삭제')}">✕</button>` : ''}</td>` : '') + '</tr>').join('') + '</tbody>'
        : `<caption class="loot-empty">${tr('아직 확인된 아이템이 없습니다.')}</caption>`;
    }
    // 던전 정보·출처
    const info = [];
    info.push(`<h3>${tr('던전 정보')}</h3>`);
    info.push(`<p>${esc(L(d.zone))} · ${tr('레벨 {lv}', { lv: levelText(d) })} · ${tr('보스 {n}명', { n: d.bosses.length })}</p>`);
    if (d.note) info.push(`<p>${esc(L(d.note))}</p>`);
    if (d.maps) info.push(`<p>${tr('지도: 게임 안 던전 지도 (Blizzard Entertainment). 보스 번호는 지도의 해골 표시와 클래식 공략을 보고 찍은 대략적인 위치입니다.')}</p>`);
    if (d.mapNote) info.push(`<p>${esc(L(d.mapNote))}</p>`);
    info.push(`<p>${d.beta ? tr('신규 던전의 베타 자료라 출시 후 바뀔 수 있습니다.') : tr('클래식 기준 자료입니다. WoW: Forever 에서 달라질 수 있습니다.')}</p>`);
    if (d.sources && d.sources.length) {
      info.push(`<p>${tr('자료 출처')}</p><ul>` + d.sources.map(([n, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('') + '</ul>');
    }
    $('#dunInfo').innerHTML = info.join('');
  }

  $('#tipsEditBtn').onclick = () => {
    const { d, b } = current();
    if (!d.bosses[b]) return;
    editingTips = true;
    $('#tipsInput').value = tipsOf(d, b);
    render();
    $('#tipsInput').focus();
  };
  $('#tipsCancel').onclick = () => { editingTips = false; render(); };
  $('#tipsSave').onclick = () => {
    const { d, b } = current();
    editingTips = false;
    set(['edits', d.id, 'tips', 'b' + b], $('#tipsInput').value.trim().slice(0, 3000));
    toast(tr('공략을 저장했습니다'));
  };
  $('#lootAdd').addEventListener('submit', e => {
    e.preventDefault();
    const { d, b } = current();
    if (!d.bosses[b]) return;
    const name = $('#laName').value.trim();
    if (!name) return;
    const lvl = Number($('#laLvl').value);
    set(['edits', d.id, 'loot', 'b' + b, 'i' + RP.uid(6)], {
      name: name.slice(0, 60), slot: $('#laSlot').value.trim().slice(0, 30),
      lvl: lvl >= 1 && lvl <= 60 ? lvl : '', stats: $('#laStats').value.trim().slice(0, 120), o: Date.now()
    });
    ['#laName', '#laSlot', '#laLvl', '#laStats'].forEach(s => { $(s).value = ''; });
    $('#laName').focus();
  });
  $('#lootTable').addEventListener('click', e => {
    const x = e.target.closest('[data-del]');
    if (!x) return;
    const { d, b } = current();
    set(['edits', d.id, 'loot', 'b' + b, x.dataset.del], null);
  });

  // 지도 올리기 (파일·붙여넣기·끌어다 놓기·주소)
  function loadImageFile(file) {
    if (!canEdit()) return;
    if (!file || !/^image\//.test(file.type)) return toast(tr('이미지 파일이 아닙니다'));
    const { d: dd, f } = current();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // 실시간 서버의 메시지 크기 제한에 맞춰 약 230KB 이하로 줄임
      let cv = document.createElement('canvas');
      const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      cv.width = Math.round(img.naturalWidth * s);
      cv.height = Math.round(img.naturalHeight * s);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      let data = '';
      for (let q = 0.85; ; q -= 0.1) {
        data = cv.toDataURL('image/jpeg', Math.max(q, 0.5));
        if (data.length <= 310000) break;
        if (q <= 0.55) {
          const sm = document.createElement('canvas');
          sm.width = Math.round(cv.width * 0.8);
          sm.height = Math.round(cv.height * 0.8);
          sm.getContext('2d').drawImage(cv, 0, 0, sm.width, sm.height);
          cv = sm;
          q = 0.95;
          if (cv.width < 300) break;
        }
      }
      set(mapPath(dd, f), data);
      toast(tr('지도를 적용했습니다'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast(tr('이미지를 읽지 못했습니다')); };
    img.src = url;
  }
  $('#mapFile').addEventListener('change', e => { loadImageFile(e.target.files[0]); e.target.value = ''; });
  $('#mapUrlBtn').onclick = async () => {
    const u = await ask({ title: tr('지도 이미지 주소'), value: 'https://' });
    if (u === null) return;
    if (!/^https:\/\/\S+$/i.test(u.trim())) return toast(tr('https:// 로 시작하는 이미지 주소를 넣어주세요'));
    const { d, f } = current();
    set(mapPath(d, f), u.trim());
  };
  $('#mapClear').onclick = async () => {
    const { d, f } = current();
    if (!mapEdit(d, f)) return toast(tr('이 작전판에서 올린 지도가 없습니다'));
    if (await ask({ title: tr('올린 지도를 지울까요?'), message: d.maps ? tr('기본 게임 지도로 돌아갑니다.') : '', ok: tr('지우기'), danger: true })) set(mapPath(d, f), null);
  };
  document.addEventListener('paste', e => {
    if (!canEdit() || (e.target.closest && e.target.closest('input, textarea'))) return;
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); loadImageFile(item.getAsFile()); }
  });
  let dragDepth = 0;
  viewport.addEventListener('dragenter', e => {
    if (!canEdit() || ![...e.dataTransfer.types].includes('Files')) return;
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

  // 데이터 내보내기: 이 작전판에서 고친 지도·위치·공략·아이템 (js/dungeon-data.js 에 옮길 때 사용)
  $('#exportBtn').onclick = () => {
    const data = { app: 'briefing-forever-atlas', version: 1, exportedAt: new Date().toISOString(), edits: state.edits || {} };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = 'dungeon-edits.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------- 링크 ----------
  async function copyLink(viewOnly) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', room);
    if (viewOnly) u.searchParams.set('mode', 'view');
    const s = u.toString();
    const done = sync.mode === 'local' ? tr('링크를 복사했습니다. 다만 지금은 로컬 모드라 다른 사람에게는 보이지 않습니다')
      : viewOnly ? tr('보기 전용 링크를 복사했습니다') : tr('편집 링크를 복사했습니다');
    try { await navigator.clipboard.writeText(s); toast(done); } catch (e) { ask({ title: tr('아래 링크를 복사하세요'), value: s, ok: tr('닫기') }); }
  }
  $('#shareEditBtn').onclick = () => copyLink(false);
  $('#shareViewBtn').onclick = () => copyLink(true);

  // ---------- 대화상자 / 알림 ----------
  function ask({ title, message = '', value = null, ok = tr('확인'), cancel = tr('취소'), danger = false }) {
    return new Promise(resolve => {
      const d = $('#askDialog'), input = $('#askInput');
      $('#askTitle').textContent = title;
      $('#askMsg').textContent = message;
      $('#askMsg').hidden = !message;
      input.hidden = value === null;
      input.value = value || '';
      $('#askCancel').textContent = cancel;
      $('#askOk').textContent = ok;
      $('#askOk').className = 'btn ' + (danger ? 'danger' : 'gold');
      d.returnValue = '';
      d.onclose = () => { d.onclose = null; resolve(d.returnValue === 'ok' ? (value === null ? true : input.value) : null); };
      d.showModal();
      if (value !== null) { input.focus(); input.select(); }
    });
  }
  $('#askDialog').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); $('#askDialog').close('ok'); }
  });
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(2200, msg.length * 70));
  }

  // ---------- 키보드 ----------
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { togglePicker(false); setTool('move'); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && canEdit()) { e.preventDefault(); (e.shiftKey ? $('#atRedo') : $('#atUndo')).click(); return; }
    const { d, b } = current();
    if (e.key === 'ArrowRight' && d.bosses[b + 1]) { e.preventDefault(); select(d.id, b + 1); }
    else if (e.key === 'ArrowLeft' && b > 0) { e.preventDefault(); select(d.id, b - 1); }
  });

  // ---------- 언어 ----------
  function applyLanguage() {
    buildTools();
    setTool(ui.tool);
    Object.keys(sigs).forEach(k => { sigs[k] = null; });
    if (lastStatus) $('#connText').textContent = tr(lastStatus[1], lastStatus[2]);
    $('#bigBtn').textContent = document.body.classList.contains('big') ? tr('작게 보기') : tr('크게 보기');
    document.querySelectorAll('#langToggle [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === RP.lang())));
    renderPeers();
    render();
  }
  $('#langToggle').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) RP.setLang(b.dataset.lang); });
  RP.onLang(applyLanguage);

  buildTools();
  setTool('move');
  document.querySelectorAll('#langToggle [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === RP.lang())));
  render();
  window.RP.atlas = { get state() { return state; }, current, commit, sync };
})();
