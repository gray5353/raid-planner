// 언어 (KR/EN)
//   RP.t('한국어 문장', { 변수 })  : 한국어 문장을 열쇠로 현재 언어 문장을 돌려줌. {n} 같은 자리에 변수를 넣음
//   RP.nm(직업·역할·징표)          : 데이터의 영어 이름(en)이 있으면 영어일 때 사용
//   RP.setLang('ko' | 'en')         : 바꾸고 기억. index.html 의 고정 글자도 함께 바꿈
// index.html 의 한글 글자·placeholder·title 은 자동으로 찾아 번역합니다.
// 글자와 <b> 등이 섞인 문장은 요소에 data-i18n-html 을 붙여 문장 통째로 번역합니다.
(function () {
  const RP = window.RP = window.RP || {};

  const EN = window.RP_I18N_EN || {};

  let lang = document.documentElement.lang === 'en' ? 'en' : 'ko';
  const listeners = [];
  const norm = s => s.replace(/\s+/g, ' ').trim();

  RP.lang = () => lang;
  RP.t = (ko, vars) => {
    let s = String(ko == null ? '' : ko);
    if (lang === 'en') {
      const hit = EN[s] !== undefined ? EN[s] : EN[norm(s)];
      if (hit !== undefined) s = hit;
    }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : m));
    return s;
  };
  RP.nm = o => (o ? (lang === 'en' && o.en ? o.en : o.name) : '');
  RP.short = r => (r ? (lang === 'en' && r.enShort ? r.enShort : r.short) : '');
  RP.onLang = fn => listeners.push(fn);

  // ---------- index.html 고정 글자 ----------
  const HANGUL = /[가-힣]/;
  const texts = [], blocks = [], attrs = [];
  function collect(el) {
    if (el.nodeType !== 1 || el.hasAttribute('data-i18n-skip') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    ['placeholder', 'title', 'aria-label'].forEach(a => {
      const v = el.getAttribute(a);
      if (v && HANGUL.test(v)) attrs.push([el, a, v]);
    });
    if (el.hasAttribute('data-i18n-html')) { blocks.push([el, norm(el.innerHTML)]); return; }
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (HANGUL.test(n.data)) texts.push([n, n.data]); } else collect(n);
    }
  }
  function applyStatic() {
    texts.forEach(([n, orig]) => {
      const m = orig.match(/^(\s*)([\s\S]*?)(\s*)$/);
      n.data = m[1] + RP.t(norm(m[2])) + m[3];
    });
    blocks.forEach(([el, orig]) => { el.innerHTML = RP.t(orig); });
    attrs.forEach(([el, a, orig]) => el.setAttribute(a, RP.t(orig)));
  }
  collect(document.body);
  if (lang === 'en') applyStatic();

  RP.setLang = l => {
    l = l === 'en' ? 'en' : 'ko';
    if (l === lang) return;
    lang = l;
    try { localStorage.setItem('rp-lang', l); } catch (e) { /* 저장 불가 환경 */ }
    const root = document.documentElement;
    root.lang = l;
    root.classList.remove('lang-ko', 'lang-en');
    root.classList.add('lang-' + l);
    applyStatic();
    listeners.forEach(fn => fn(l));
  };
})();
