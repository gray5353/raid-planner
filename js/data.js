// 직업, 역할, 징표, 레이드 프리셋, 기본 지형 템플릿
(function () {
  const RP = window.RP = window.RP || {};

  // WoW: Forever 는 오리지널 9직업 기준
  RP.CLASSES = [
    { id: 'warrior', en: 'Warrior', name: '전사', color: '#C69B6D', role: 'melee', aliases: ['전사', '전', 'warrior', 'war'] },
    { id: 'paladin', en: 'Paladin', name: '성기사', color: '#F48CBA', role: 'healer', aliases: ['성기사', '기사', '성기', '팔라딘', 'paladin', 'pal'] },
    { id: 'hunter', en: 'Hunter', name: '사냥꾼', color: '#AAD372', role: 'ranged', aliases: ['사냥꾼', '냥꾼', '사냥', 'hunter', 'hunt'] },
    { id: 'rogue', en: 'Rogue', name: '도적', color: '#FFF468', role: 'melee', aliases: ['도적', 'rogue'] },
    { id: 'priest', en: 'Priest', name: '사제', color: '#FFFFFF', role: 'healer', aliases: ['사제', 'priest'] },
    { id: 'shaman', en: 'Shaman', name: '주술사', color: '#0070DD', role: 'healer', aliases: ['주술사', '술사', 'shaman', 'sham'] },
    { id: 'mage', en: 'Mage', name: '마법사', color: '#3FC7EB', role: 'ranged', aliases: ['마법사', '법사', 'mage'] },
    { id: 'warlock', en: 'Warlock', name: '흑마법사', color: '#8788EE', role: 'ranged', aliases: ['흑마법사', '흑마', 'warlock', 'lock'] },
    { id: 'druid', en: 'Druid', name: '드루이드', color: '#FF7C0A', role: 'healer', aliases: ['드루이드', '드루', 'druid'] }
  ];

  RP.ROLES = [
    { id: 'tank', name: '탱커', short: '탱', en: 'Tank', enShort: 'T', aliases: ['탱', '탱커', 'tank', 't'] },
    { id: 'healer', name: '힐러', short: '힐', en: 'Healer', enShort: 'H', aliases: ['힐', '힐러', 'heal', 'healer', 'h'] },
    { id: 'melee', name: '근딜', short: '근', en: 'Melee', enShort: 'M', aliases: ['근딜', '근', '근거리', 'melee', 'm', 'mdps'] },
    { id: 'ranged', name: '원딜', short: '원', en: 'Ranged', enShort: 'R', aliases: ['원딜', '원', '원거리', 'ranged', 'r', 'rdps'] }
  ];

  RP.classById = id => RP.CLASSES.find(c => c.id === id) || { id: '', name: '?', color: '#9aa3b2', role: 'melee' };
  RP.roleById = id => RP.ROLES.find(r => r.id === id) || RP.ROLES[2];

  const norm = s => String(s || '').toLowerCase().replace(/[\s_-]/g, '');
  RP.findClass = word => RP.CLASSES.find(c => c.aliases.some(a => norm(a) === norm(word)));
  RP.findRole = word => RP.ROLES.find(r => r.aliases.some(a => norm(a) === norm(word)));

  // 공격대 징표 (게임 내 번호 순서)
  RP.MARKERS = [
    { id: 1, name: '별', en: 'Star', color: '#ffd93b' },
    { id: 2, name: '동그라미', en: 'Circle', color: '#ff8a1f' },
    { id: 3, name: '다이아', en: 'Diamond', color: '#c25cff' },
    { id: 4, name: '세모', en: 'Triangle', color: '#3ddc4a' },
    { id: 5, name: '달', en: 'Moon', color: '#c9d6e8' },
    { id: 6, name: '네모', en: 'Square', color: '#3aa0ff' },
    { id: 7, name: '엑스', en: 'Cross', color: '#ff3b3b' },
    { id: 8, name: '해골', en: 'Skull', color: '#f2f2f2' }
  ];

  const markerShapes = {
    1: c => `<path d="M12 1.8l3 6.6 7.1.7-5.4 4.8 1.6 7-6.3-3.7-6.3 3.7 1.6-7L1.9 9.1 9 8.4z" fill="${c}" stroke="#5a4300" stroke-width="1"/>`,
    2: c => `<circle cx="12" cy="12" r="9.5" fill="${c}" stroke="#6b3000" stroke-width="1.2"/><circle cx="9" cy="9" r="3" fill="#fff" opacity=".35"/>`,
    3: c => `<path d="M12 1.5L21.5 12 12 22.5 2.5 12z" fill="${c}" stroke="#3d0a5c" stroke-width="1.2"/>`,
    4: c => `<path d="M12 2.5L22 20.5H2z" fill="${c}" stroke="#0d4d12" stroke-width="1.2"/>`,
    5: c => `<path d="M15.5 2.4A10 10 0 1 0 21.6 15 7.8 7.8 0 1 1 15.5 2.4z" fill="${c}" stroke="#3b4a5e" stroke-width="1.2"/>`,
    6: c => `<rect x="3" y="3" width="18" height="18" rx="1.5" fill="${c}" stroke="#08315c" stroke-width="1.2"/>`,
    7: c => `<path d="M4.5 2.5L12 10l7.5-7.5 2 2L14 12l7.5 7.5-2 2L12 14l-7.5 7.5-2-2L10 12 2.5 4.5z" fill="${c}" stroke="#5c0808" stroke-width="1"/>`,
    8: c => `<path d="M12 2C6.8 2 3.5 5.6 3.5 10.2c0 2.9 1.4 4.9 3.3 6v3.3c0 .8.7 1.5 1.5 1.5h7.4c.8 0 1.5-.7 1.5-1.5v-3.3c1.9-1.1 3.3-3.1 3.3-6C20.5 5.6 17.2 2 12 2z" fill="${c}" stroke="#444" stroke-width="1"/><circle cx="8.6" cy="11" r="2.3" fill="#222"/><circle cx="15.4" cy="11" r="2.3" fill="#222"/><path d="M11 14.5h2l-1 2z" fill="#222"/>`
  };
  RP.markerSVG = id => {
    const m = RP.MARKERS.find(x => x.id === Number(id)) || RP.MARKERS[0];
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${markerShapes[m.id](m.color)}</svg>`;
  };

  // 레이드 프리셋 (WoW: Forever). 보스 이름/순서는 앱에서 언제든 수정할 수 있습니다.
  // 이름·설명은 한국어 문장이 번역 열쇠입니다 (js/i18n.js 의 영어 사전).
  // 신규 레이드 보스 이름은 개방(2026-12-09) 전 비공식 명칭입니다.
  RP.PRESETS = [
    {
      id: 'ony',
      name: '오닉시아의 둥지',
      sub: '40인 · 1보스',
      bosses: [{ name: '오닉시아', phases: ['1단계 · 지상', '2단계 · 비행', '3단계 · 지상'] }]
    },
    {
      id: 'bd',
      name: 'Barrow Deeps',
      sub: '10인 · 8보스 · 비공식 명칭',
      bosses: ['Deepscar Matriarch', 'Khalith the Dreadspinner', 'Amethrax', 'Ravus and Darlissa',
        'Elder Tangleclaw', 'Well of Sorrow', "Del'lynar Songwood", 'Sonya Darkhallow']
    },
    {
      id: 'hs',
      name: '하이잘 정상',
      sub: '20인 · 13보스 · 보스 이름 미정',
      bosses: Array.from({ length: 13 }, (_, i) => ({ name: '하이잘 보스 {n}', n: i + 1 }))
    },
    { id: 'blank', name: '빈 작전판', sub: '보스를 직접 추가합니다', bosses: [{ name: '보스 {n}', n: 1 }] }
  ];

  // 기본 지형 (이미지가 없을 때 쓰는 간단한 경기장)
  const svgWrap = (w, h, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><pattern id="g" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#ffffff" stroke-opacity=".06"/></pattern>` +
    `<radialGradient id="f" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#3a3428"/><stop offset="1" stop-color="#1d1a15"/></radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="#121212"/>${body}</svg>`;

  RP.MAP_TEMPLATES = {
    circle: {
      name: '원형 경기장',
      svg: svgWrap(1000, 1000,
        '<circle cx="500" cy="500" r="460" fill="url(#f)" stroke="#8a7650" stroke-width="6"/>' +
        '<circle cx="500" cy="500" r="460" fill="url(#g)"/>' +
        '<circle cx="500" cy="500" r="300" fill="none" stroke="#8a7650" stroke-opacity=".35" stroke-width="2" stroke-dasharray="10 10"/>' +
        '<circle cx="500" cy="500" r="140" fill="none" stroke="#8a7650" stroke-opacity=".35" stroke-width="2" stroke-dasharray="10 10"/>' +
        '<path d="M500 40v920M40 500h920" stroke="#8a7650" stroke-opacity=".25" stroke-width="2"/>' +
        '<text x="500" y="30" fill="#b9a57a" font-size="22" text-anchor="middle" font-family="sans-serif">N</text>')
    },
    square: {
      name: '사각 경기장',
      svg: svgWrap(1200, 900,
        '<rect x="40" y="40" width="1120" height="820" rx="12" fill="url(#f)" stroke="#8a7650" stroke-width="6"/>' +
        '<rect x="40" y="40" width="1120" height="820" rx="12" fill="url(#g)"/>' +
        '<path d="M600 40v820M40 450h1120" stroke="#8a7650" stroke-opacity=".25" stroke-width="2"/>' +
        '<circle cx="600" cy="450" r="160" fill="none" stroke="#8a7650" stroke-opacity=".35" stroke-width="2" stroke-dasharray="10 10"/>')
    },
    grid: {
      name: '빈 격자',
      svg: svgWrap(1600, 1000, '<rect width="1600" height="1000" fill="url(#g)"/>')
    }
  };
  RP.templateSrc = key => 'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent((RP.MAP_TEMPLATES[key] || RP.MAP_TEMPLATES.circle).svg);

  RP.uid = (n = 8) => {
    const a = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    const r = crypto.getRandomValues(new Uint8Array(n));
    for (let i = 0; i < n; i++) s += a[r[i] % a.length];
    return s;
  };
})();
