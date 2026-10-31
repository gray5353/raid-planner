// 펫 도감: 사냥꾼이 길들일 수 있는 야수의 종류·기술·먹이, 출몰 위치(지역 지도), 3D 모델
// 자료는 js/pet-data.js (자동 생성), 3D 모델 목록은 js/pet-models.js
(function () {
  'use strict';
  const RP = window.RP;
  const $ = s => document.querySelector(s);
  const tr = (k, v) => RP.t(k, v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const local = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } }
  };
  const en = () => RP.lang() === 'en';
  const nm = o => (en() ? o.en : (o.ko || o.en));
  const other = o => (en() ? '' : (o.ko && o.ko !== o.en ? o.en : ''));

  // ---------- 자료 ----------
  const FAMS = RP.PET_FAMILIES, ZONES = RP.PET_ZONES, BEASTS = RP.PET_BEASTS, MODELS = RP.PET_MODELS || {};
  const famById = new Map(FAMS.map(f => [f.id, f]));
  const famByKey = new Map(FAMS.map(f => [f.key, f]));
  const beastById = new Map(BEASTS.map(b => [b.i, b]));
  // 와우 포에버에서 지도 범위가 바뀐 지역 (QuestieDB 의 Forever 좌표 변환 기록)
  const FOREVER_CHANGED = new Set([44, 139, 215, 1519]);
  // 기술 이름 (한국어 이름은 게임과 다를 수 있어 영어도 함께 표시)
  const SKILLS = {
    bite: ['물어뜯기', 'Bite'], claw: ['할퀴기', 'Claw'], dash: ['질주', 'Dash'], dive: ['급강하', 'Dive'],
    charge: ['돌진', 'Charge'], prowl: ['숨기', 'Prowl'], howl: ['사나운 울부짖음', 'Furious Howl'],
    lightning: ['번개 숨결', 'Lightning Breath'], scorpid: ['전갈 독', 'Scorpid Poison'], screech: ['날카로운 비명', 'Screech'],
    shell: ['등껍질 방패', 'Shell Shield'], thunderstomp: ['천둥 발구르기', 'Thunderstomp']
  };
  const DIET = { meat: ['고기', 'Meat'], fish: ['생선', 'Fish'], bread: ['빵', 'Bread'], cheese: ['치즈', 'Cheese'], fruit: ['과일', 'Fruit'], fungus: ['버섯', 'Fungus'] };
  const RANKS = { 1: ['정예', 'elite'], 2: ['희귀 정예', 'rare'], 4: ['희귀', 'rare'] };
  const SCHOOLS = { 1: '신성', 2: '화염', 3: '자연', 4: '냉기', 5: '암흑', 6: '비전' };
  const pair = (p, cls) => `<span class="chip ${cls}">${esc(en() ? p[1] : p[0])}${en() ? '' : `<small>${esc(p[1])}</small>`}</span>`;

  const zoneName = z => (ZONES[z] ? nm(ZONES[z]) : String(z));
  const lvText = b => (b.l[0] === b.l[1] ? String(b.l[0]) : `${b.l[0]}–${b.l[1]}`);
  const speed = b => (b.s || 2000) / 1000;
  const spawnCount = (b, z) => (b.z[z] || []).length / 2;
  const zonesOf = b => Object.keys(b.z).map(Number).sort((a, c) => spawnCount(b, c) - spawnCount(b, a));

  // ---------- 상태 (주소에 f, b, z 를 남겨 링크로 공유) ----------
  const params = new URLSearchParams(location.search);
  const ui = {
    fam: params.get('f') === 'all' || famByKey.has(params.get('f')) ? params.get('f') : FAMS[0].key,
    beast: beastById.has(Number(params.get('b'))) ? Number(params.get('b')) : null,
    zone: Number(params.get('z')) || null,
    zf: '', q: '', sort: 'lvl', rare: false, showFam: true,
    lv: clamp(Number(local.get('rp-pet-level')) || 0, 0, 60) || null
  };
  if (ui.beast && ui.fam !== 'all') ui.fam = famById.get(beastById.get(ui.beast).f).key;
  const curFam = () => (ui.fam === 'all' ? null : famByKey.get(ui.fam));
  const overLevel = b => ui.lv && b.l[0] > ui.lv;

  function list({ ignoreZone } = {}) {
    const f = curFam(), q = ui.q.trim().toLowerCase();
    const out = BEASTS.filter(b => (!f || b.f === f.id) && (!ui.rare || b.r === 2 || b.r === 4) &&
      (ignoreZone || !ui.zf || b.z[ui.zf]) &&
      (!q || b.en.toLowerCase().includes(q) || (b.ko || '').toLowerCase().includes(q)));
    const byName = (a, c) => nm(a).localeCompare(nm(c), en() ? 'en' : 'ko');
    const by = {
      lvl: (a, c) => a.l[0] - c.l[0] || a.l[1] - c.l[1] || byName(a, c),
      name: byName,
      speed: (a, c) => speed(a) - speed(c) || a.l[0] - c.l[0] || byName(a, c)
    }[ui.sort];
    return out.sort(by);
  }

  // ---------- 화면 ----------
  const sigs = {};
  const changed = (k, s) => (sigs[k] === s ? false : (sigs[k] = s, true));
  let rows = [];

  function render() {
    rows = list();
    if (!ui.beast || !beastById.has(ui.beast)) ui.beast = rows.length ? rows[0].i : null;
    const b = beastById.get(ui.beast) || null;
    if (b && (!ui.zone || !b.z[ui.zone])) ui.zone = (ui.zf && b.z[ui.zf]) ? Number(ui.zf) : zonesOf(b)[0];
    document.title = `${tr('펫 도감')} · ${tr('브리핑 포에버')}`;
    renderFamList();
    renderFamCard();
    renderZoneFilter();
    renderTable(b);
    renderSide(b);
    syncUrl();
  }

  function renderFamList() {
    const counts = new Map();
    BEASTS.forEach(b => { if (!ui.rare || b.r === 2 || b.r === 4) counts.set(b.f, (counts.get(b.f) || 0) + 1); });
    const total = [...counts.values()].reduce((a, c) => a + c, 0);
    if (!changed('fams', JSON.stringify([ui.fam, ui.rare, RP.lang()]))) return;
    const item = (key, ico, name, sub, n) =>
      `<button type="button" data-fam="${key}" aria-current="${ui.fam === key}">${ico}` +
      `<span class="fl-name">${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="fl-n">${n}</span></button>`;
    $('#famList').innerHTML = item('all', '<span class="all-ico" aria-hidden="true">◆</span>', tr('모든 야수'), '', total) +
      FAMS.map(f => item(f.key, `<img src="${f.icon}" alt="" width="30" height="30" loading="lazy">`, nm(f), other(f), counts.get(f.id) || 0)).join('');
  }

  function renderFamCard() {
    const f = curFam();
    if (!changed('card', JSON.stringify([ui.fam, RP.lang()]))) return;
    if (!f) {
      $('#famCard').innerHTML = `<div class="fc-ico all" aria-hidden="true">◆</div><h2>${tr('모든 야수')}<small>${tr('길들일 수 있는 야수 {n}종 · {k}가지 종류', { n: BEASTS.length, k: FAMS.length })}</small></h2>` +
        `<div class="fc-rows"><div class="fc-row">${tr('지역을 고르면 그곳에서 길들일 수 있는 야수를 모두 볼 수 있습니다. 왼쪽에서 종류를 고르면 배우는 기술과 먹이가 나옵니다.')}</div></div>`;
      return;
    }
    const mine = BEASTS.filter(b => b.f === f.id);
    const lo = Math.min(...mine.map(b => b.l[0])), hi = Math.max(...mine.map(b => b.l[1]));
    const pct = (v, label) => {
      const d = Math.round((v - 1) * 100);
      return `<span>${esc(label)} <b class="${d > 0 ? 'stat-up' : d < 0 ? 'stat-down' : ''}">${d > 0 ? '+' : ''}${d}%</b></span>`;
    };
    $('#famCard').innerHTML = `<img class="fc-ico" src="${f.icon}" alt="" width="56" height="56">` +
      `<h2>${esc(nm(f))}<small>${esc(other(f))}${other(f) ? ' · ' : ''}${tr('길들일 수 있는 야수 {n}종 · 레벨 {lv}', { n: mine.length, lv: `${lo}–${hi}` })}</small></h2>` +
      '<div class="fc-rows">' +
      `<div class="fc-row"><b>${tr('기술')}</b>${f.skills.map(k => pair(SKILLS[k], 'skill')).join('')}<span class="muted">${tr('+ 모든 종류: 으르렁거리기 · 웅크리기')}</span></div>` +
      `<div class="fc-row"><b>${tr('먹이')}</b>${f.diet.map(k => pair(DIET[k], 'food')).join('')}</div>` +
      `<div class="fc-row"><b>${tr('능력치')}</b>${pct(f.mod[0], tr('생명력'))} · ${pct(f.mod[1], tr('공격력'))} · ${pct(f.mod[2], tr('방어도'))}</div>` +
      '</div>';
  }

  function renderZoneFilter() {
    const base = list({ ignoreZone: true });
    const cnt = new Map();
    base.forEach(b => Object.keys(b.z).forEach(z => cnt.set(z, (cnt.get(z) || 0) + 1)));
    if (ui.zf && !cnt.has(ui.zf)) ui.zf = '';
    if (!changed('zf', JSON.stringify([[...cnt], ui.zf, RP.lang()]))) return;
    const zs = [...cnt.keys()].sort((a, c) => zoneName(a).localeCompare(zoneName(c), en() ? 'en' : 'ko'));
    $('#zoneFilter').innerHTML = `<option value="">${tr('모든 지역')} (${base.length})</option>` +
      zs.map(z => `<option value="${z}"${z === ui.zf ? ' selected' : ''}>${esc(zoneName(z))}${ZONES[z] && ZONES[z].dungeon ? ' · ' + tr('던전') : ''} (${cnt.get(z)})</option>`).join('');
  }

  function tags(b) {
    const t = [];
    if (RANKS[b.r]) t.push(`<span class="tag ${RANKS[b.r][1]}">${tr(RANKS[b.r][0])}</span>`);
    if (b.d) t.push(`<span class="tag school">${tr('{s} 피해', { s: tr(SCHOOLS[b.d] || '마법') })}</span>`);
    if (overLevel(b)) t.push(`<span class="tag over">${tr('레벨 {n} 필요', { n: b.l[0] })}</span>`);
    return t.join('');
  }

  function renderTable(sel) {
    const all = ui.fam === 'all';
    $('#beastCount').textContent = tr('{n}종', { n: rows.length });
    const sig = JSON.stringify([rows.map(b => b.i), sel && sel.i, ui.zf, ui.lv, RP.lang()]);
    if (!changed('table', sig)) return;
    if (!rows.length) {
      $('#beastTable').innerHTML = `<tbody><tr><td class="empty">${tr('조건에 맞는 야수가 없습니다')}</td></tr></tbody>`;
      return;
    }
    $('#beastTable').innerHTML = `<thead><tr><th>${tr('이름')}</th>${all ? `<th class="col-fam">${tr('종류')}</th>` : ''}<th>${tr('레벨')}</th><th>${tr('지역')}</th>` +
      `<th class="col-speed">${tr('공격 속도')}</th><th>${tr('특징')}</th></tr></thead><tbody>` +
      rows.map(b => {
        const f = famById.get(b.f);
        const zs = zonesOf(b);
        const z0 = ui.zf && b.z[ui.zf] ? Number(ui.zf) : zs[0];
        const sp = speed(b);
        return `<tr data-b="${b.i}" aria-selected="${!!sel && sel.i === b.i}"${overLevel(b) ? ' class="over"' : ''}>` +
          `<td><div class="b-name"><img src="${f.icon}" alt="" width="22" height="22" loading="lazy"><span>${esc(nm(b))}${other(b) ? `<small>${esc(other(b))}</small>` : ''}</span></div></td>` +
          (all ? `<td class="col-fam">${esc(nm(f))}</td>` : '') +
          `<td class="num">${lvText(b)}</td>` +
          `<td class="zone">${esc(zoneName(z0))}${zs.length > 1 ? ` <small>${tr('외 {n}곳', { n: zs.length - 1 })}</small>` : ''}</td>` +
          `<td class="num col-speed${sp < 2 ? ' fast' : ''}">${sp.toFixed(1)}</td>` +
          `<td>${tags(b)}</td></tr>`;
      }).join('') + '</tbody>';
    const cur = $('#beastTable tr[aria-selected="true"]');
    if (cur && scrollToSel) cur.scrollIntoView({ block: 'nearest' });
    scrollToSel = false;
  }
  let scrollToSel = true;

  // ---------- 오른쪽: 고른 야수 ----------
  function renderSide(b) {
    renderHead(b);
    renderModel(b);
    renderZoneTabs(b);
    renderMap(b);
    renderInfo();
  }

  function renderHead(b) {
    if (!changed('head', JSON.stringify([b && b.i, ui.lv, RP.lang()]))) return;
    if (!b) { $('#beastHead').innerHTML = `<h2>${tr('야수를 골라 주세요')}</h2>`; return; }
    const f = famById.get(b.f), sp = speed(b);
    const n = Object.values(b.z).reduce((a, c) => a + c.length / 2, 0);
    $('#beastHead').innerHTML = `<h2>${esc(nm(b))}</h2><div class="bh-sub">${esc([other(b), nm(f)].filter(Boolean).join(' · '))}</div>` +
      '<div class="bh-facts">' +
      `<span class="fact">${tr('레벨')} <b>${lvText(b)}</b></span>` +
      `<span class="fact${sp < 2 ? ' fast' : ''}">${tr('공격 속도')} <b>${tr('{s}초', { s: sp.toFixed(1) })}</b></span>` +
      (n ? `<span class="fact">${tr('출몰 지점')} <b>${n}</b></span>` : '') +
      tags(b) + '</div>';
  }

  // 3D 모델 (모델 파일이 있을 때만 three.js 를 불러옴)
  let threeP = null, viewer = null, modelSig = '';
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error(src));
      document.head.appendChild(s);
    });
  }
  function loadThree() {
    if (!threeP) {
      threeP = loadScript('js/vendor/three/three.min.js')
        .then(() => Promise.all([loadScript('js/vendor/three/GLTFLoader.js'), loadScript('js/vendor/three/OrbitControls.js')]))
        .catch(e => { threeP = null; throw e; });
    }
    return threeP;
  }
  function makeViewer(box) {
    const T = window.THREE;
    const canvas = document.createElement('canvas');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = T.sRGBEncoding;
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xfff4e0, 0x2a2a35, 1.1));
    const sun = new T.DirectionalLight(0xffffff, 1.0);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const camera = new T.PerspectiveCamera(35, 1, 0.01, 1000);
    const controls = new T.OrbitControls(camera, canvas);
    Object.assign(controls, { enableDamping: true, autoRotate: true, autoRotateSpeed: 1.6, enablePan: false });
    const clock = new T.Clock();
    let model = null, mixer = null, raf = 0, src = '';
    const size = () => {
      const w = box.clientWidth || 1, h = box.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(size).observe(box);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (mixer) mixer.update(clock.getDelta()); else clock.getDelta();
      controls.update();
      renderer.render(scene, camera);
    };
    const clear = () => {
      if (!model) return;
      scene.remove(model);
      model.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        [].concat(o.material || []).forEach(m => { Object.values(m).forEach(v => { if (v && v.isTexture) v.dispose(); }); m.dispose(); });
      });
      model = null; mixer = null;
    };
    return {
      canvas,
      load(url) {
        if (url === src && model) return Promise.resolve();
        clear();
        src = url;
        return new Promise((res, rej) => new T.GLTFLoader().load(url, g => {
          if (src !== url) return res();
          model = g.scene;
          const bb = new T.Box3().setFromObject(model);
          model.position.sub(bb.getCenter(new T.Vector3()));
          scene.add(model);
          const r = Math.max(...bb.getSize(new T.Vector3()).toArray()) || 1;
          camera.near = r / 100; camera.far = r * 100;
          camera.position.set(r * 1.1, r * 0.55, r * 1.5);
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
          if (g.animations && g.animations.length) {
            mixer = new T.AnimationMixer(model);
            mixer.clipAction(g.animations.find(a => /stand|idle/i.test(a.name)) || g.animations[0]).play();
          }
          res();
        }, undefined, e => { src = ''; rej(e); }));
      },
      start() { if (!raf) { size(); loop(); } },
      stop() { cancelAnimationFrame(raf); raf = 0; }
    };
  }
  async function renderModel(b) {
    const f = b ? famById.get(b.f) : curFam();
    const src = (b && b.m && MODELS['d' + b.m]) || (f && MODELS[f.key]) || '';
    const sig = JSON.stringify([src, f && f.key, RP.lang()]);
    if (sig === modelSig) return;
    modelSig = sig;
    const box = $('#modelBox');
    if (!src) {
      if (viewer) viewer.stop();
      box.innerHTML = `<div class="mb-empty">${f ? `<img src="${f.icon}" alt="" width="64" height="64">` : ''}<b>${tr('3D 모델 준비 중')}</b>` +
        `<span>${tr('게임 폴더에서 꺼낸 모델을 넣으면 여기서 돌려 볼 수 있습니다.')}</span></div>`;
      return;
    }
    box.innerHTML = `<div class="mb-empty"><b>${tr('3D 모델을 불러오는 중…')}</b></div>`;
    try {
      await loadThree();
      if (!viewer) viewer = makeViewer(box);
      await viewer.load(src);
      if (modelSig !== sig) return;
      box.innerHTML = '';
      box.appendChild(viewer.canvas);
      box.insertAdjacentHTML('beforeend', `<span class="mb-label">${tr('끌어서 돌리기 · 휠로 확대')}</span>`);
      viewer.start();
    } catch (e) {
      if (modelSig === sig) box.innerHTML = `<div class="mb-empty"><b>${tr('3D 모델을 불러오지 못했습니다')}</b><span>${esc(src)}</span></div>`;
    }
  }

  function renderZoneTabs(b) {
    if (!changed('ztabs', JSON.stringify([b && b.i, ui.zone, RP.lang()]))) return;
    const zs = b ? zonesOf(b) : [];
    $('#zoneTabs').innerHTML = zs.length > 1 ? zs.map(z =>
      `<button type="button" data-zone="${z}" aria-pressed="${z === ui.zone}">${esc(zoneName(z))}<span class="zt-n">${spawnCount(b, z)}</span></button>`).join('') : '';
  }

  // ---------- 지역 지도 (휠 확대, 끌어서 이동) ----------
  const zmap = $('#zmap'), zstage = $('#zstage'), zimg = $('#zimg');
  const view = { k: 1, x: 0, y: 0, key: '' };
  function applyView() {
    const w = zmap.clientWidth, h = zmap.clientHeight;
    view.k = clamp(view.k, 1, 6);
    view.x = clamp(view.x, w - w * view.k, 0);
    view.y = clamp(view.y, h - h * view.k, 0);
    zstage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    zstage.style.setProperty('--inv', String(1 / view.k));
    $('#zReset').textContent = Math.round(view.k * 100) + '%';
  }
  function zoomAt(cx, cy, f) {
    const k = clamp(view.k * f, 1, 6);
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }
  function renderMap(b) {
    const z = ui.zone, zone = ZONES[z];
    const f = b && famById.get(b.f);
    const sig = JSON.stringify([b && b.i, z, ui.showFam, RP.lang()]);
    if (!changed('map', sig)) return;
    if (view.key !== String(z)) { view.key = String(z); view.k = 1; view.x = 0; view.y = 0; applyView(); }
    const dz = $('#zdungeon');
    let note = '';
    if (!b || !zone) {
      zstage.hidden = true; dz.hidden = false;
      dz.innerHTML = `<b>${tr('야수를 골라 주세요')}</b>`;
    } else if (zone.dungeon) {
      zstage.hidden = true; dz.hidden = false;
      dz.innerHTML = `<b>${tr('{z} 안에 있습니다', { z: esc(zoneName(z)) })}</b><span>${tr('던전 안 위치는 아직 지도에 표시하지 않습니다.')}</span>` +
        (typeof zone.dungeon === 'string' ? `<a class="btn small gold" href="dungeons.html?d=${encodeURIComponent(zone.dungeon)}">${tr('던전 도감에서 지도 보기')}</a>` : '');
    } else {
      zstage.hidden = false; dz.hidden = true;
      if (zimg.getAttribute('src') !== zone.map) zimg.src = zone.map;
      zimg.alt = zoneName(z);
      const dots = [];
      if (ui.showFam && f) {
        BEASTS.forEach(o => {
          if (o.f !== b.f || o.i === b.i || !o.z[z]) return;
          const p = o.z[z];
          for (let i = 0; i < p.length; i += 2) dots.push(`<button type="button" class="zpin" data-b="${o.i}" style="left:${p[i] / 10}%;top:${p[i + 1] / 10}%" title="${esc(`${nm(o)} (${lvText(o)})`)}" aria-label="${esc(nm(o))}"></button>`);
        });
      }
      const p = b.z[z] || [];
      for (let i = 0; i < p.length; i += 2) dots.push(`<button type="button" class="zpin me" data-b="${b.i}" style="left:${p[i] / 10}%;top:${p[i + 1] / 10}%" title="${esc(`${nm(b)} (${lvText(b)})`)}" aria-label="${esc(nm(b))}"></button>`);
      $('#zpins').innerHTML = dots.join('');
      note = tr('{z} · 지점 {n}곳', { z: zoneName(z), n: p.length / 2 });
      if (FOREVER_CHANGED.has(z)) note += ' · ' + tr('포에버에서 지도가 바뀐 지역이라 위치가 조금 다를 수 있습니다');
    }
    $('#zmapNote').textContent = note;
    $('.zmap-zoom').style.display = zstage.hidden ? 'none' : '';
    zmap.style.cursor = zstage.hidden ? 'default' : '';
  }
  zmap.addEventListener('wheel', e => {
    if (zstage.hidden) return;
    e.preventDefault();
    const r = zmap.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  zmap.addEventListener('pointerdown', e => {
    if (zstage.hidden || e.button !== 0 || e.target.closest('.zmap-zoom, .zdungeon')) return;
    const sx = e.clientX, sy = e.clientY, px = view.x, py = view.y;
    const pin = e.target.closest('.zpin');
    let moved = false;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      zmap.classList.add('panning');
      view.x = px + ev.clientX - sx;
      view.y = py + ev.clientY - sy;
      applyView();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      zmap.classList.remove('panning');
      if (!moved && pin) selectBeast(Number(pin.dataset.b), { keepZone: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  const zc = f => zoomAt(zmap.clientWidth / 2, zmap.clientHeight / 2, f);
  $('#zIn').onclick = () => zc(1.4);
  $('#zOut').onclick = () => zc(1 / 1.4);
  $('#zReset').onclick = () => { view.k = 1; view.x = 0; view.y = 0; applyView(); };
  new ResizeObserver(() => applyView()).observe(zmap);

  function renderInfo() {
    if (!changed('info', RP.lang())) return;
    const src = (name, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
    $('#petsInfo').innerHTML = `<h3>${tr('자료와 알아 둘 점')}</h3>` +
      `<p>${tr('길들일 수 있는 야수·레벨·공격 속도: {a} · 출몰 위치·한국어 이름: {b}. 모두 클래식 기준이라 와우 포에버와 다를 수 있습니다.', {
        a: src('CMaNGOS classic-db', 'https://github.com/cmangos/classic-db'), b: src('QuestieDB', 'https://github.com/Questie/QuestieDB') })}</p>` +
      `<p>${tr('와우 포에버에 새로 생긴 지역의 야수는 아직 들어 있지 않습니다.')}</p>` +
      `<p>${tr('배우는 기술과 먹이는 종류별 바닐라 기준입니다. 어느 야수가 몇 단계 기술을 가르치는지는 아직 없습니다.')}</p>` +
      `<p>${tr('공격 속도는 길들인 뒤에도 그대로라, 빠른 야수(초록 숫자)가 인기가 많습니다.')}</p>` +
      `<p>${tr('지도: 게임 안 지역 지도 (Blizzard Entertainment), 탐험 지역 위치: {c}', { c: src('pfUI', 'https://github.com/shagu/pfUI') })}</p>`;
  }

  // ---------- 고르기 ----------
  function selectBeast(id, { keepZone } = {}) {
    const b = beastById.get(id);
    if (!b) return;
    if (ui.fam !== 'all' && famById.get(b.f).key !== ui.fam) { ui.fam = famById.get(b.f).key; ui.zf = ''; }
    ui.beast = id;
    if (!keepZone || !b.z[ui.zone]) ui.zone = null;
    scrollToSel = true;
    render();
  }
  $('#famList').addEventListener('click', e => {
    const t = e.target.closest('[data-fam]');
    if (!t || t.dataset.fam === ui.fam) return;
    ui.fam = t.dataset.fam;
    ui.beast = null; ui.zone = null;
    // 지역을 골라 둔 채 종류를 바꾸면 그 지역의 야수부터
    scrollToSel = true;
    render();
    $('.beast-wrap').scrollTop = 0;
  });
  $('#beastTable').addEventListener('click', e => {
    const t = e.target.closest('tr[data-b]');
    if (!t) return;
    scrollToSel = false;
    selectBeast(Number(t.dataset.b));
    // 좁은 화면에서는 오른쪽 내용이 목록 아래에 있어서 그쪽으로 내려 줌
    if (window.matchMedia('(max-width: 760px)').matches) $('.beast-side').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#zoneTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-zone]');
    if (t) { ui.zone = Number(t.dataset.zone); render(); }
  });
  const refilter = () => {
    const ids = list().map(b => b.i);
    if (!ids.includes(ui.beast)) { ui.beast = null; ui.zone = null; }
    else if (ui.zf && beastById.get(ui.beast).z[ui.zf]) ui.zone = Number(ui.zf);
    scrollToSel = true;
    render();
  };
  $('#zoneFilter').addEventListener('change', e => { ui.zf = e.target.value; refilter(); });
  $('#beastSearch').addEventListener('input', e => { ui.q = e.target.value; refilter(); });
  $('#sortBy').addEventListener('change', e => { ui.sort = e.target.value; render(); });
  $('#onlyRare').addEventListener('change', e => { ui.rare = e.target.checked; refilter(); });
  $('#showFamily').addEventListener('change', e => { ui.showFam = e.target.checked; render(); });
  $('#myLevel').value = ui.lv || '';
  $('#myLevel').addEventListener('input', e => {
    const v = Number(e.target.value);
    ui.lv = v >= 1 && v <= 60 ? v : null;
    local.set('rp-pet-level', ui.lv ? String(ui.lv) : '');
    render();
  });

  // ---------- 주소 / 링크 ----------
  function syncUrl() {
    const p = new URLSearchParams();
    p.set('f', ui.fam);
    if (ui.beast) p.set('b', ui.beast);
    if (ui.zone) p.set('z', ui.zone);
    try { history.replaceState(null, '', location.pathname + '?' + p); } catch (e) { /* 샌드박스 */ }
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(2200, msg.length * 70));
  }
  $('#copyLinkBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast(tr('링크를 복사했습니다')); }
    catch (e) { window.prompt(tr('아래 링크를 복사하세요'), location.href); }
  };

  // ---------- 키보드: ↑/↓ 로 목록 이동 ----------
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const i = rows.findIndex(b => b.i === ui.beast);
    const n = rows[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)];
    if (n && n.i !== ui.beast) { e.preventDefault(); selectBeast(n.i); }
  });

  // ---------- 언어 ----------
  const markLang = () => document.querySelectorAll('#langToggle [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === RP.lang())));
  $('#langToggle').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) RP.setLang(b.dataset.lang); });
  RP.onLang(() => { markLang(); Object.keys(sigs).forEach(k => { sigs[k] = null; }); modelSig = ''; render(); });

  markLang();
  render();
  window.RP.pets = { ui, render, selectBeast };
})();
