// Bird eye study, market view, variant B: TF 신호 보드.
// By timeframe, WHICH coins signalled or are about to, with their tickers written out. A board of 20 timeframe
// columns: the timeframe row sits in the middle like a zero line, the sell side bands above it and the buy side
// bands below it, mirrored, the strongest farthest from the middle (13 완성, then 13 임박, then 9). Every cell lists
// the coins as small links. Everything shown comes from BE.side: the labels of the build summary and the next-bar
// triggers with their distances (td-view.js fire). Nothing here counts anything.
(() => {
  const { BUY, SELL, SIDE, ARROW, TFS, FAM_NAME, el, esc, iso, fmtPrice, fmtPct } = BE;
  const ID = 'market-b', EXS = ['U', 'B', 'N'], EX = { U: '업비트', B: '빗썸', N: '바이낸스' };
  const GROUP_START = new Set([TFS.indexOf('8D'), TFS.indexOf('1M')]); // as the screener: 1D…1W | 8D…3W | 1M…12M
  const TIP_LABELS = 6, TIP_TRIGS = 3;
  const FULL_COUNT = 10; // a cell that shows all of a longer list than this says how many names it holds

  // ---------- settings ----------
  // st is this variant's own. G is what the two market variants share (the period, the 임박 threshold, the exchanges),
  // so that switching between A and B shows the same market; both are read again each time the variant is mounted.
  // Q is the search text, which is not kept over a reload (as on the screener).
  const DEF = { n: 5, nines: 1 }, SHARED = { win: 3, thr: 5, ex: [] };
  let st = null, G = null, Q = '';
  function readSettings() {
    st = BE.vstate(ID, DEF); G = BE.vstate('market', SHARED);
    if (![5, 10, 0].includes(st.n)) st.n = DEF.n;
    st.nines = st.nines ? 1 : 0;
    if (![0, 3].includes(G.win)) G.win = SHARED.win;
    if (![3, 5, 10].includes(G.thr)) G.thr = SHARED.thr;
    G.ex = EXS.filter((x) => Array.isArray(G.ex) && G.ex.includes(x));
  }

  // the bands from top to bottom; the timeframe row goes between the two sides
  const BANDS = [
    { id: 's13', dir: SELL, kind: 'done', name: '13 완성' },
    { id: 's12', dir: SELL, kind: 'near', name: '13 임박' },
    { id: 's9', dir: SELL, kind: 'nine', name: '9' },
    { id: 'b9', dir: BUY, kind: 'nine', name: '9' },
    { id: 'b12', dir: BUY, kind: 'near', name: '13 임박' },
    { id: 'b13', dir: BUY, kind: 'done', name: '13 완성' },
  ];
  const bandOf = (dir, kind) => (dir === SELL ? 's' : 'b') + (kind === 'done' ? '13' : kind === 'near' ? '12' : '9');

  // The last confirmed bar of each timeframe: the one most coins have. A coin TradingView stopped serving has an
  // older last bar; its names are marked and its tooltip says so.
  const REF = TFS.map((tf, j) => {
    const seen = new Map(); let coins = 0, best = null;
    for (const c of BE.WITH_DATA) {
      const T = c.t[j]; if (!T) continue;
      coins++;
      let r = seen.get(T.ls); if (!r) seen.set(T.ls, r = { ls: T.ls, le: T.le, n: 0 });
      r.n++;
      if (!best || r.n > best.n || (r.n === best.n && r.ls > best.ls)) best = r;
    }
    return best && { ls: best.ls, le: best.le, coins };
  });

  // ---------- the board's content under the current settings ----------
  // cells[band][j] = entries, in the order they are shown:
  //   done { c, j, dir, f, more, text, ago }   the newest 13 on the bars of the chosen period; f its family, more the
  //                                            other families with a 13 there
  //   near { c, j, dir, f, more, fire, now, a } the 13 trigger nearest to the current price, within the threshold
  //                                            (fire.now first); a = |fire.pct|
  //   nine { c, j, dir, text, rep, ago }       the newest 9 on the bars of the chosen period
  function build() {
    const thr = G.thr / 100, win = G.win;
    const coins = BE.WITH_DATA.filter((c) => G.ex.every((x) => c.x.includes(x)));
    const cells = {}; for (const b of BANDS) cells[b.id] = TFS.map(() => []);
    const sideCoins = { [SELL]: TFS.map(() => 0), [BUY]: TFS.map(() => 0) }, onBoard = new Map(); // slug -> the timeframes the coin is on
    const nearKey = (e) => (e.now ? -1 : e.a);
    for (const c of coins) {
      for (let j = 0; j < TFS.length; j++) {
        const T = c.t[j]; if (!T) continue;
        const lag = T.ls !== REF[j].ls;
        for (const dir of [SELL, BUY]) {
          const s = BE.side(c, j, dir); if (!s) continue;
          const done = new Map(), near = new Map(); let nine = null, any = false;
          for (const L of s.labels) {
            if (L.ago > win) continue;
            if (L.kind === 'C') { if (BE.famOn(L.f) && (!done.has(L.f) || L.ago < done.get(L.f).ago)) done.set(L.f, L); }
            else if (L.kind === 'S' && st.nines && (!nine || L.ago < nine.ago)) nine = L;
          }
          for (const x of s.trigs) {
            if (x.k !== 'C13' || !x.fire || !BE.famOn(x.f)) continue;
            const e = { now: x.fire.now, a: Math.abs(x.fire.pct), fire: x.fire };
            if (!e.now && e.a > thr) continue;
            const o = near.get(x.f); if (!o || nearKey(e) < nearKey(o)) near.set(x.f, e);
          }
          if (done.size) {
            const fams = [...done.keys()].sort((f, g) => done.get(f).ago - done.get(g).ago || f - g), L = done.get(fams[0]);
            cells[bandOf(dir, 'done')][j].push({ kind: 'done', c, j, dir, f: fams[0], more: fams.slice(1).sort((f, g) => f - g), text: L.text, ago: L.ago, lag });
            any = true;
          }
          if (near.size) {
            const fams = [...near.keys()].sort((f, g) => nearKey(near.get(f)) - nearKey(near.get(g)) || f - g), m = near.get(fams[0]);
            cells[bandOf(dir, 'near')][j].push({ kind: 'near', c, j, dir, f: fams[0], more: fams.slice(1).sort((f, g) => f - g), fire: m.fire, now: m.now, a: m.a, lag });
            any = true;
          }
          if (nine) { cells[bandOf(dir, 'nine')][j].push({ kind: 'nine', c, j, dir, text: nine.text, rep: nine.rep, ago: nine.ago, lag }); any = true; }
          if (any) { sideCoins[dir][j]++; let l = onBoard.get(c.slug); if (!l) onBoard.set(c.slug, l = new Set()); l.add(j); }
        }
      }
    }
    // 13 완성 and 9 stay in market-cap order (the coins come in that order); 13 임박 goes by distance
    for (const b of BANDS) if (b.kind === 'near') for (const list of cells[b.id]) list.sort((x, y) => nearKey(x) - nearKey(y) || x.c.r - y.c.r);
    return { coins, cells, sideCoins, onBoard };
  }
  // the coins a search text means: the coin of that symbol or name when there is one, otherwise the coins whose
  // symbol starts with it, otherwise the coins whose name holds it
  function searchCoins(text) {
    const q = text.trim().toLowerCase(); if (!q) return null;
    const low = (s) => String(s || '').toLowerCase();
    const exact = BE.WITH_DATA.filter((c) => low(c.s) === q || low(c.k) === q || low(c.n) === q);
    if (exact.length) return exact;
    const bySymbol = BE.WITH_DATA.filter((c) => low(c.s).startsWith(q));
    return bySymbol.length ? bySymbol : BE.WITH_DATA.filter((c) => low(c.k).includes(q) || low(c.n).includes(q));
  }

  // ---------- next-bar triggers in words ----------
  const SRC = { o: '시가', h: '고가', l: '저가', c: '종가', hl: '고가와 저가의 차이' };
  const OP = { '<': '미만', '<=': '이하', '>': '초과', '>=': '이상' };
  const condText = ([s, op, v]) => `${SRC[s] || s}가 ${fmtPrice(v)} ${OP[op] || op}`;
  const groupText = (g) => g.map(condText).join('이고 ');
  function anyText(any) {
    const first = any[0][0];
    if (any.every((g) => g.length === 1 && g[0][1] === first[1] && g[0][2] === first[2])) return `${any.map((g) => SRC[g[0][0]] || g[0][0]).join('나 ')}가 ${fmtPrice(first[2])} ${OP[first[1]] || first[1]}`;
    return any.map(groupText).join('이거나 ');
  }
  // an empty group always holds: in `any` it makes that part hold, in `unless` it cancels the label
  function trigText(t) {
    const what = t.k === 'C13' ? '13이' : '9가', parts = [];
    if (t.all && t.all.length) parts.push(groupText(t.all));
    if (t.any && t.any.length && !t.any.some((g) => !g.length)) parts.push(anyText(t.any));
    let s = parts.length ? `진행 중인 봉의 ${parts.join('이고, ')}이면 ${what} 나옵니다.` : `진행 중인 봉이 마감하면 가격과 상관없이 ${what} 나옵니다.`;
    if (t.unless && t.unless.some((g) => !g.length)) s += ' 다만 이번 봉에서는 나오지 않습니다.';
    else if (t.unless && t.unless.length) s += ` 다만 ${t.unless.map(groupText).join('이거나 ')}이면 나오지 않습니다.`;
    return s;
  }
  // where the bar in progress stands against one trigger (td-view.js fire). A strict level (fire's pc / qc: the label
  // appears only beyond it, as for a waiting 9) is named with 초과 or 미만, never as a price at which the bar may close.
  function fireText(f) {
    if (!f) return '가격이 한 번 움직여서는 충족되지 않음';
    if (f.now) return '지금 값으로 충족';
    const strict = (c) => !!(c && c.strict);
    const at = (c, p, pct) => `${strict(c) ? `${fmtPrice(c.v)} ${c.op === '>' ? '초과' : '미만'}` : fmtPrice(p)} (${fmtPct(pct)})`;
    const s = `조건가 ${at(f.pc, f.p, f.pct)}`;
    if (f.q === f.p) return s + (strict(f.pc) ? ` · 이 값보다 ${f.pc.op === '>' ? '높게' : '낮게'} 마감하면 충족` : ' · 이 값에서 마감하면 충족');
    return s + (f.qpct === 0 ? ' · 닿은 뒤 지금 가격에서 마감해도 충족' : ` · 닿은 뒤 ${at(f.qc, f.q, f.qpct)}에서 마감해도 충족`);
  }

  // ---------- tooltips ----------
  const tipRow = (...parts) => { const r = el('div', 'row'); for (const p of parts) r.append(typeof p === 'string' ? el('span', null, p) : p); return r; };
  const muted = (t) => el('span', 'm', t);
  const fireKey = (x) => (!x.fire ? Infinity : x.fire.now ? -1 : Math.abs(x.fire.pct));
  function tipChip(e, touch) {
    const c = e.c, j = e.j, dir = e.dir, T = c.t[j], s = BE.side(c, j, dir), out = [];
    out.push(el('div', 'h1', `${c.r}위 · ${c.s} · ${TFS[j]} ${SIDE[dir]} 쪽 ${ARROW[dir]}`));
    out.push(el('div', null, c.k ? `${c.k} · ${c.n}` : c.n));
    out.push(el('div', 'm', `시가총액 ${BE.fmtCap(c.mc)} · ${BE.exNames(c)}`));
    out.push(el('div', 'm', `마지막 확정 봉 ${iso(T.ls)}${T.le !== T.ls ? ` ~ ${iso(T.le)}` : ''} · 최근 종가 ${fmtPrice(c.lc)}`));
    if (e.lag) out.push(el('div', 'bmb-warn', `이 종목은 TradingView에 ${iso(T.le)} 뒤의 봉이 없습니다. 다른 종목의 마지막 확정 봉은 ${iso(REF[j].ls)}에 시작합니다.`));
    const also = [...(M.onBoard.get(c.slug) || [])].sort((a, b) => a - b);
    if (also.length > 1) out.push(el('div', 'm', `보드에 이 종목이 있는 타임프레임: ${also.map((k) => TFS[k]).join(', ')}`));

    const labels = s.labels.filter((L) => (L.kind === 'S' ? st.nines : BE.famOn(L.f))).sort((a, b) => a.ago - b.ago);
    const sec1 = el('div', 'sec'); sec1.append(el('b', null, '최근 13봉의 신호'));
    if (!labels.length) sec1.append(muted('신호가 없습니다.'));
    for (const L of labels.slice(0, TIP_LABELS)) {
      const what = L.kind === 'C' ? `${FAM_NAME[L.f]} 13 완성` : L.kind === 'S' ? (L.rep ? '반복 9' : L.text === '9*' ? '셋업 9 (퍼펙트)' : '셋업 9') : `${FAM_NAME[L.f]} 13 미뤄짐`;
      sec1.append(tipRow(BE.chipEl(L.kind, L.text, L.f), what, muted(BE.agoText(L.ago))));
    }
    if (labels.length > TIP_LABELS) sec1.append(muted(`외 ${labels.length - TIP_LABELS}개`));
    out.push(sec1);

    const sec2 = el('div', 'sec'); sec2.append(el('b', null, '진행 중인 카운트'));
    const runs = s.runs.filter((r) => BE.famOn(r.f));
    for (const r of runs) sec2.append(tipRow(el('span', 'bmb-fam f' + r.f, FAM_NAME[r.f]), `카운트다운 ${r.count}개, 가장 높은 카운트 ${r.hi}`));
    if (!runs.length) sec2.append(muted('진행 중인 카운트다운이 없습니다.'));
    if (st.nines) sec2.append(muted(`셋업 카운트 ${s.raw}${s.raw > 0 && s.to9 != null ? ` · 다음 9까지 ${s.to9}봉` : ''}`));
    out.push(sec2);

    const trigs = s.trigs.filter((x) => (x.k === 'C13' ? BE.famOn(x.f) : st.nines)).sort((a, b) => fireKey(a) - fireKey(b));
    if (trigs.length) {
      const sec3 = el('div', 'sec'); sec3.append(el('b', null, '다음 봉 조건'));
      for (const x of trigs.slice(0, TIP_TRIGS)) {
        const is13 = x.k === 'C13', head = is13 ? `${FAM_NAME[x.f]}${x.o != null ? ` · 출발 봉 ${iso(x.o)}` : ''}` : x.k === 'S9r' ? '반복 9' : '셋업 9';
        sec3.append(tipRow(el('b', 'bmb-pc' + (is13 ? ' f' + x.f : ' p9'), is13 ? '13' : '9'), head, el('span', x.fire && x.fire.now ? 'bmb-ok' : 'bmb-dist', fireText(x.fire))));
        sec3.append(el('div', 'm', trigText(x.t)));
      }
      if (trigs.length > TIP_TRIGS) sec3.append(muted(`외 ${trigs.length - TIP_TRIGS}개`));
      out.push(sec3);
    }
    out.push(el('div', 'bmb-foot', touch ? '한 번 더 누르면 이 종목의 화면이 열립니다.' : '누르거나 Enter를 치면 이 종목의 화면이 열립니다.'));
    return out;
  }
  function tipTf(j) {
    const R = REF[j], out = [el('div', 'h1', TFS[j])];
    if (!R) { out.push(el('div', 'm', '확정 봉이 있는 종목이 없습니다.')); return out; }
    out.push(el('div', 'm', `마지막 확정 봉 ${iso(R.ls)}${R.le !== R.ls ? ` ~ ${iso(R.le)}` : ''}`));
    out.push(el('div', 'm', `진행 중인 봉 ${iso(R.le + 1)} 시작 · 확정 봉이 있는 ${R.coins}종목`));
    for (const dir of [SELL, BUY]) {
      const sec = el('div', 'sec'); sec.append(el('b', null, `${SIDE[dir]} 쪽 ${ARROW[dir]} ${M.sideCoins[dir][j]}종목`));
      const order = dir === SELL ? ['done', 'near', 'nine'] : ['nine', 'near', 'done'];
      for (const kind of order) {
        if (kind === 'nine' && !st.nines) continue;
        const list = M.cells[bandOf(dir, kind)][j], b = BANDS.find((x) => x.id === bandOf(dir, kind));
        let t = `${list.length}종목`;
        const now = kind === 'near' ? list.filter((e) => e.now).length : 0;
        if (now) t += ` (지금 값으로 충족 ${now}종목)`;
        sec.append(tipRow(el('span', 'bmb-key', b.name), t));
      }
      out.push(sec);
    }
    return out;
  }

  // ---------- drawing ----------
  let root = null, box = null, statusEl = null, legendEl = null, hintEl = null, useEl = null, qInput = null, qTimer = 0;
  let M = null, ITEMS = [], HITS = null, NAV = [], POS = new Map(), BY_SLUG = new Map(), STOP = null, STOP_KEY = null;
  let HOT = null, ARMED = null, POINTER = '', TIP_FOR = null, TIP_NODES = null, focusRaf = 0;
  const OPEN = new Set(); // bands shown in full
  const TOUCH = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

  function chipHTML(e, band) {
    const c = e.c, cls = ['bmb-c'], right = [];
    let say;
    if (e.kind === 'done') {
      cls.push('d', 'f' + e.f);
      if (e.text !== '13') right.push(`<span class="x">${esc(e.text)}</span>`);
      say = e.text;
    } else if (e.kind === 'near') {
      cls.push('n', 'f' + e.f, e.now ? 'now' : e.a <= 0.01 ? 'l1' : e.a <= 0.03 ? 'l2' : e.a <= 0.05 ? 'l3' : 'l4');
      right.push(e.now ? '<i class="dot"></i>' : `<span class="p">${fmtPct(e.fire.pct)}</span>`);
      say = e.now ? '지금 값으로 충족' : fmtPct(e.fire.pct);
    } else {
      cls.push('s'); if (e.rep) cls.push('rep');
      if (e.text !== '9') right.push(`<span class="x">${esc(e.text)}</span>`); // 9* is written out; a plain 9 is what the band says
      say = e.rep ? '반복 9' : e.text;
    }
    if (e.ago) { right.push(`<span class="g">${e.ago}</span>`); say += `, ${e.ago}봉 전`; }
    if (e.more && e.more.length) cls.push('m' + (e.more.length + 1), 'e' + e.more[0], ...(e.more.length > 1 ? ['t' + e.more[1]] : []));
    if (e.lag) cls.push('lag');
    if (c.s.length > 7) cls.push('long');
    if (HITS && HITS.has(c.slug)) cls.push('hit');
    const i = ITEMS.push(e) - 1;
    return `<a class="${cls.join(' ')}" href="#sheet-${BE.state.keys.sheet}-${c.slug}" data-i="${i}" tabindex="-1" aria-label="${esc(`${c.s}, ${TFS[e.j]} ${SIDE[e.dir]} ${band.name}, ${say}`)}">` +
      `<span class="t">${esc(c.s)}</span>${right.length ? `<span class="r">${right.join('')}</span>` : ''}</a>`;
  }
  function draw() {
    M = build();
    const found = searchCoins(Q);
    HITS = found && new Set(found.map((c) => c.slug));
    ITEMS = [];
    const rows = [];
    const bandRow = (b) => {
      const lim = st.n === 0 || OPEN.has(b.id) ? Infinity : st.n;
      let over = false;
      const tds = TFS.map((tf, j) => {
        const list = M.cells[b.id][j]; let html = '', shown = 0;
        for (let k = 0; k < list.length; k++) if (k < lim || (HITS && HITS.has(list[k].c.slug))) { html += chipHTML(list[k], b); shown++; }
        const rest = list.length - shown;
        if (!rest && list.length > FULL_COUNT) html = `<span class="bmb-cnt">${list.length}</span>` + html;
        if (rest > 0) { over = true; html += `<button type="button" class="bmb-more" data-b="${b.id}" tabindex="-1" aria-label="${esc(`${TFS[j]} ${SIDE[b.dir]} ${b.name}에 ${rest}종목 더 있음. 이 줄 모두 펼치기`)}">+${rest}</button>`; }
        return `<td class="${GROUP_START.has(j) ? 'gs' : ''}">${html ? `<div class="bmb-cell">${html}</div>` : ''}</td>`;
      });
      const open = OPEN.has(b.id) && st.n !== 0;
      const tg = over || open ? `<button type="button" class="bmb-tg" data-b="${b.id}" aria-expanded="${open}" aria-label="${esc(`${SIDE[b.dir]} ${b.name} 줄 ${open ? '접기' : '모두 펼치기'}`)}">${open ? '접기' : '펼치기'}</button>` : '';
      // what the band holds under the settings, so the board reads on its own: the threshold, and a period other than the last bar
      const note = b.kind === 'near' ? `${G.thr}% 이내` : G.win ? `최근 ${G.win + 1}봉` : '';
      return `<tr class="bmb-band ${b.dir === SELL ? 'sell' : 'buy'} ${b.kind}" data-b="${b.id}"><th scope="row" class="bmb-l"><div class="bmb-ln"><span class="sd">${SIDE[b.dir]} ${ARROW[b.dir]}</span><b>${b.name}</b>${note ? `<span class="nt">${note}</span>` : ''}${tg}</div></th>${tds.join('')}</tr>`;
    };
    const bands = BANDS.filter((b) => st.nines || b.kind !== 'nine');
    for (const b of bands) if (b.dir === SELL) rows.push(bandRow(b));
    rows.push(`<tr class="bmb-h"><th class="bmb-l bmb-corner"><span>타임프레임</span><span>봉 시작일</span><span>종목 수</span></th>${TFS.map((tf, j) => {
      const R = REF[j], sell = M.sideCoins[SELL][j], buy = M.sideCoins[BUY][j];
      return `<th scope="col" class="bmb-tf${GROUP_START.has(j) ? ' gs' : ''}" data-j="${j}" tabindex="-1" aria-label="${esc(`${tf}, 마지막 확정 봉 ${R ? iso(R.ls) : '없음'} 시작, 매도 쪽 ${sell}종목, 매수 쪽 ${buy}종목`)}">` +
        `<b>${tf}</b><span class="dt">${R ? iso(R.ls) : '–'}</span><span class="ct"><span class="${sell ? '' : 'z'}">▲${sell}</span> <span class="${buy ? '' : 'z'}">▼${buy}</span></span></th>`;
    }).join('')}</tr>`);
    for (const b of bands) if (b.dir === BUY) rows.push(bandRow(b));

    const keep = box.contains(document.activeElement) ? keyOf(document.activeElement) : null;
    box.innerHTML = `<table class="bmb-t${HITS ? ' q' : ''}"><caption class="sr-only">타임프레임별 신호 보드입니다. 가운데 줄이 타임프레임이고, 위쪽은 매도 쪽, 아래쪽은 매수 쪽입니다. 방향키로 옮기고 Enter로 종목 화면을 엽니다.</caption>` +
      `<colgroup><col class="bmb-cl"><col span="${TFS.length}"></colgroup><tbody>${rows.join('')}</tbody></table>`;

    // the grid the arrow keys walk: per row and timeframe the names and the "+n" button, in the header row the cell itself
    NAV = []; POS = new Map(); BY_SLUG = new Map(); STOP = null; HOT = null; ARMED = null;
    const table = box.firstElementChild;
    Array.from(table.rows).forEach((tr, r) => {
      const head = tr.classList.contains('bmb-h'), sell = tr.classList.contains('sell'), line = [];
      for (let j = 0; j < TFS.length; j++) {
        const cell = tr.cells[j + 1], items = head ? [cell] : Array.from(cell.querySelectorAll('.bmb-c, .bmb-more'));
        if (sell) items.reverse();
        items.forEach((x, i) => POS.set(x, [r, j, i]));
        line.push(items);
      }
      line.fromEnd = sell;
      NAV.push(line);
    });
    for (const a of table.querySelectorAll('a.bmb-c')) { const s = ITEMS[a.dataset.i].c.slug; let l = BY_SLUG.get(s); if (!l) BY_SLUG.set(s, l = []); l.push(a); }
    BE.tip.hide(); TIP_FOR = null;
    // the one tab stop of the grid stays where it was when that is still there; so does the keyboard focus
    const focused = keep && findKey(keep);
    setStop((focused && POS.has(focused) ? focused : STOP_KEY && findKey(STOP_KEY)) || table.querySelector('a.bmb-c') || table.querySelector('.bmb-tf'));
    if (focused) focused.focus({ preventScroll: true });
    drawStatus(found);
    drawLegend();
  }
  // what a focused element is, to find it again after the board is drawn anew
  function keyOf(x) {
    if (x.classList.contains('bmb-tg')) return 'tg:' + x.dataset.b;
    const p = POS.get(x); if (!p) return null;
    if (x.classList.contains('bmb-tf')) return 'tf:' + p[1];
    const b = x.closest('tr').dataset.b;
    return x.classList.contains('bmb-more') ? `more:${b}:${p[1]}:${x.parentNode.querySelectorAll('.bmb-c').length}` : `c:${b}:${p[1]}:${ITEMS[x.dataset.i].c.slug}`;
  }
  function findKey(key) {
    const [k, a, b, c] = key.split(':'), table = box.firstElementChild;
    if (k === 'tg') return table.querySelector(`.bmb-tg[data-b="${a}"]`);
    if (k === 'tf') return NAV.find((line) => line[0][0] && line[0][0].classList.contains('bmb-tf'))[Number(a)][0];
    const r = Array.from(table.rows).findIndex((tr) => tr.dataset.b === a); if (r < 0) return null;
    const items = NAV[r][Number(b)];
    // a "+n" button that was pressed is gone: the first name it brought in takes its place
    if (k === 'more') { const names = table.rows[r].cells[Number(b) + 1].querySelectorAll('.bmb-c'); return names[Number(c)] || names[names.length - 1] || null; }
    return items.find((x) => x.dataset.i != null && ITEMS[x.dataset.i].c.slug === c) || null;
  }
  function setStop(x) {
    if (STOP && STOP !== x) STOP.tabIndex = -1;
    STOP = x || null;
    if (x) { x.tabIndex = 0; STOP_KEY = keyOf(x); }
  }
  function drawStatus(found) {
    const parts = [];
    const from = G.ex.length ? `${G.ex.map((x) => EX[x]).join(', ')}에 ${G.ex.length > 1 ? '모두 ' : ''}상장한 ${M.coins.length}종목` : `데이터가 있는 ${M.coins.length}종목`;
    parts.push(!M.coins.length ? '거래소 조건에 맞는 종목이 없습니다.' : M.onBoard.size ? `${from} 가운데 ${M.onBoard.size}종목이 보드에 있습니다.` : `${from} 가운데 지금 설정에 맞는 신호가 있는 종목이 없습니다.`);
    if (found) {
      const names = found.slice(0, 3).map((c) => c.s).join(', ') + (found.length > 3 ? ` 외 ${found.length - 3}종목` : '');
      const tfs = new Set(); let n = 0;
      for (const c of found) for (const a of BY_SLUG.get(c.slug) || []) { n++; tfs.add(ITEMS[a.dataset.i].j); }
      if (!found.length) parts.push(`“${Q.trim()}”에 맞는 종목이 없습니다.`);
      else if (!n) parts.push(`${names}: 지금 설정에서는 보드에 없습니다.`);
      else parts.push(`${names}: 보드의 ${n}곳(${[...tfs].sort((a, b) => a - b).map((j) => TFS[j]).join(', ')})에 있습니다.`);
    }
    statusEl.textContent = parts.join(' ');
  }
  function drawLegend() {
    const f0 = BE.FAMS.find((f) => BE.famOn(f)) ?? BE.FAMS[0], f1 = BE.FAMS.find((f) => f !== f0 && BE.famOn(f));
    const chip = (cls, right) => { const s = el('span', 'bmb-c ' + cls); s.append(el('span', 't', '종목')); if (right) { const r = el('span', 'r'); r.innerHTML = right; s.append(r); } return s; };
    const add = (nodes, text) => { const s = el('span'); s.append(...nodes, document.createTextNode(text)); legendEl.append(s); };
    legendEl.replaceChildren();
    add([chip(`d f${f0}`)], '13 완성 (계열 색)');
    if (f1 != null) add([chip(`d f${f0} m2 e${f1}`)], '오른쪽 띠는 함께 있는 다른 계열');
    add([chip(`n f${f0} l2`, `<span class="p">${fmtPct(-0.032)}</span>`)], '13 임박과 조건가까지의 거리');
    add([chip(`n f${f0} now`, '<i class="dot"></i>')], '지금 값으로 충족');
    if (st.nines) { add([chip('s')], '9'); add([chip('s', '<span class="x">9*</span>')], '9*'); add([chip('s rep')], '반복 9'); }
    if (G.win) add([chip('s', '<span class="g">2</span>')], '작은 숫자는 몇 봉 전인지');
    if (ITEMS.some((e) => e.lag)) add([chip('s lag')], 'TradingView에 최근 봉이 없는 종목');
    add([el('span', 'bmb-key', '▲ ▼')], '매도 쪽, 매수 쪽에 이름이 있는 종목 수');
    hintEl.textContent = `13 임박은 카운트다운이 12에서 13을 기다리는 종목 가운데, 최근 종가에서 조건가까지의 거리가 ${G.thr}% 이하인 종목입니다. ` +
      `점이 있는 종목은 진행 중인 봉이 지금 값으로 마감해도 13이 나옵니다. 이름은 가운데 줄에서부터 놓습니다. ${st.nines ? '13 완성과 9는' : '13 완성은'} 시가총액 순서이고, 13 임박은 점이 있는 종목 다음에 조건가가 가까운 순서입니다.`;
    useEl.textContent = (TOUCH ? '종목 이름을 한 번 누르면 그 타임프레임의 신호와 다음 봉 조건이 나오고, 같은 종목이 다른 타임프레임에서도 표시됩니다. 한 번 더 누르면 그 종목의 화면이 열립니다.'
      : '종목 이름에 마우스를 올리거나 방향키로 옮기면 그 타임프레임의 신호와 다음 봉 조건이 나오고, 같은 종목이 다른 타임프레임에서도 표시됩니다. 이름을 누르거나 Enter를 치면 그 종목의 화면이 열립니다.') +
      ' +숫자를 누르면 그 줄의 나머지 종목이 모두 나옵니다.';
  }

  // ---------- interaction ----------
  function setHot(slug) {
    if (HOT === slug) return;
    if (HOT) for (const a of BY_SLUG.get(HOT) || []) a.classList.remove('hot');
    HOT = slug || null;
    if (HOT) for (const a of BY_SLUG.get(HOT) || []) a.classList.add('hot');
  }
  function tipNodes(x, touch) {
    if (TIP_FOR !== x || touch) { TIP_FOR = x; TIP_NODES = x.classList.contains('bmb-tf') ? tipTf(Number(x.dataset.j)) : tipChip(ITEMS[x.dataset.i], touch); }
    return TIP_NODES;
  }
  // after a touch on a name its details stay up and its coin stays marked (also while the board is scrolled sideways
  // to look for it) until a touch lands anywhere else
  function disarm() { ARMED = null; TIP_FOR = null; setHot(null); BE.tip.hide(); }
  function onDocClick(e) { if ((ARMED || HOT) && !(e.target instanceof Element && e.target.closest('a.bmb-c'))) disarm(); }
  function onWinScroll() { ARMED = null; TIP_FOR = null; }
  function showAll(band, on) {
    if (on) OPEN.add(band); else OPEN.delete(band);
    draw();
  }
  // where an arrow key leads from a name: up and down through the column (across the bands and the timeframe row),
  // left and right to the next timeframe that has a name in the same band, at the same height when it has one there
  function move(from, key) {
    const [r, j, i] = POS.get(from), line = NAV[r];
    const level = (a) => { const n = Math.min(line.fromEnd ? line[j].length - 1 - i : i, a.length - 1); return a[line.fromEnd ? a.length - 1 - n : n]; };
    const scan = (k, d) => { for (; k >= 0 && k < TFS.length && k !== j; k += d) if (line[k].length) return level(line[k]); return null; };
    switch (key) {
      case 'ArrowDown': if (i + 1 < line[j].length) return line[j][i + 1]; for (let k = r + 1; k < NAV.length; k++) if (NAV[k][j].length) return NAV[k][j][0]; return null;
      case 'ArrowUp': if (i > 0) return line[j][i - 1]; for (let k = r - 1; k >= 0; k--) { const a = NAV[k][j]; if (a.length) return a[a.length - 1]; } return null;
      case 'ArrowRight': return scan(j + 1, 1);
      case 'ArrowLeft': return scan(j - 1, -1);
      case 'Home': return scan(0, 1);
      case 'End': return scan(TFS.length - 1, -1);
      default: return null;
    }
  }
  function wire() {
    box.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const x = e.target.closest && e.target.closest('a.bmb-c, .bmb-tf');
      if (!x) { BE.tip.hide(); TIP_FOR = null; setHot(null); return; }
      setHot(x.dataset.i != null ? ITEMS[x.dataset.i].c.slug : null);
      BE.tip.show(e.clientX, e.clientY, tipNodes(x));
    });
    box.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { BE.tip.hide(); TIP_FOR = null; setHot(null); } });
    box.addEventListener('scroll', () => { BE.tip.hide(); TIP_FOR = null; ARMED = null; }, { passive: true });
    // what the click that follows comes from (a click event does not say so in every browser)
    box.addEventListener('pointerdown', (e) => { POINTER = e.pointerType; }, true);
    box.addEventListener('click', (e) => {
      const more = e.target.closest('.bmb-more'); if (more) { showAll(more.dataset.b, true); return; }
      const tg = e.target.closest('.bmb-tg'); if (tg) { showAll(tg.dataset.b, !OPEN.has(tg.dataset.b)); return; }
      const a = e.target.closest('a.bmb-c'); if (!a) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; // the link itself: a new tab or window
      e.preventDefault();
      const it = ITEMS[a.dataset.i];
      // a finger has no hover: the first touch shows the details, the second one opens the coin
      if ((e.pointerType || POINTER) === 'touch' && ARMED !== a) {
        ARMED = a; setHot(it.c.slug);
        const rc = a.getBoundingClientRect(); BE.tip.show(rc.left - 8, rc.bottom - 8, tipNodes(a, true));
        return;
      }
      BE.tip.hide();
      BE.openCoin(it.c.slug);
    });
    box.addEventListener('focusin', (e) => {
      const x = e.target.closest('.bmb-c, .bmb-more, .bmb-tf'); if (!x || !POS.has(x)) return;
      setStop(x);
      if (!x.matches(':focus-visible') || x.classList.contains('bmb-more')) return;
      setHot(x.dataset.i != null ? ITEMS[x.dataset.i].c.slug : null);
      const showAt = () => { const rc = x.getBoundingClientRect(); BE.tip.show(rc.right - 6, rc.bottom - 4, tipNodes(x)); };
      showAt();
      // a focus move that brings the name into view is followed by a scroll event, which hides the tooltip: it is shown
      // again two frames later, where the name then is
      cancelAnimationFrame(focusRaf);
      focusRaf = requestAnimationFrame(() => { focusRaf = requestAnimationFrame(() => { if (box && document.activeElement === x && TIP_FOR !== x) showAt(); }); });
    });
    box.addEventListener('focusout', () => { if (!ARMED) { BE.tip.hide(); TIP_FOR = null; setHot(null); } });
    box.addEventListener('keydown', (e) => {
      POINTER = '';
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const x = e.target.closest('.bmb-c, .bmb-more, .bmb-tf'); if (!x || !POS.has(x)) return;
      if (e.key === 'Escape') { BE.tip.hide(); return; }
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const to = move(x, e.key);
      if (to) to.focus();
    });
  }
  // the board scrolls inside its own box, which is never taller than the window below the app bar
  function fitBox() {
    const bar = document.querySelector('.appbar');
    box.style.setProperty('--bmb-top', (bar ? bar.offsetHeight : 53) + 'px');
  }
  // the outlines of 13 임박 are lifted towards the text color on a dark page, where the family colors are dim
  function themeClass() {
    const m = /^#([0-9a-f]{6})$/i.exec(BE.C.surface || ''), v = m ? parseInt(m[1], 16) : 0xffffff;
    const dark = 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255) < 128;
    box.classList.toggle('bmb-dark', dark); legendEl.classList.toggle('bmb-dark', dark);
  }
  function changed() { BE.save(); draw(); }

  function css() {
    if (document.getElementById('be-market-b-css')) return;
    const s = document.createElement('style'); s.id = 'be-market-b-css';
    s.textContent = `
.bmb-ctl .bmb-q { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 5px 10px; width: 150px; max-width: 100%; }
.bmb-ctl .bmb-status { flex-basis: 100%; }
.bmb-box { --bmb-lw: 54px; --bmb-cw: 62px; --bmb-hh: 47px; --bmb-lift: 0%; overflow: auto; max-height: calc(100dvh - var(--bmb-top, 53px) - 16px); overscroll-behavior-x: contain;
  scroll-snap-type: x proximity; scroll-padding: calc(var(--bmb-hh) + 6px) 0 6px var(--bmb-lw); }
.bmb-box.bmb-dark, .bmb-legend.bmb-dark { --bmb-lift: 34%; }
.bmb-t { border-collapse: separate; border-spacing: 0; table-layout: fixed; width: 100%; min-width: calc(var(--bmb-lw) + 20 * var(--bmb-cw)); }
.bmb-t col.bmb-cl { width: var(--bmb-lw); }
.bmb-t td { padding: 0; vertical-align: top; border-bottom: 1px solid var(--line); }
.bmb-t tr.sell td, .bmb-t tr.sell .bmb-l { vertical-align: bottom; }
.bmb-t tr:last-child td, .bmb-t tr:last-child th { border-bottom: 0; }
.bmb-t .gs { border-left: 1px solid var(--line); }
.bmb-t .bmb-l { position: sticky; left: 0; z-index: 2; background: var(--surface); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 0; vertical-align: top; text-align: left; font-weight: 400; }
.bmb-t .bmb-ln { position: sticky; top: calc(var(--bmb-hh) + 2px); bottom: 2px; display: grid; justify-items: start; gap: 1px; padding: 4px 2px 4px 8px; line-height: 1.25; }
.bmb-t .bmb-ln .sd, .bmb-t .bmb-ln .nt { font-size: 10px; color: var(--muted); white-space: nowrap; }
.bmb-t .bmb-ln b { font-size: 11px; font-weight: 600; white-space: nowrap; }
.bmb-t tr.done .bmb-ln b { font-weight: 700; }
.bmb-t .bmb-tg { margin-top: 2px; border: 1px solid var(--line); background: var(--surface); border-radius: 5px; padding: 0 4px; font-size: 10px; line-height: 15px; color: var(--muted); cursor: pointer; }
.bmb-t .bmb-tg:hover { color: var(--fg); background: var(--sunken); }
.bmb-t tr.bmb-h th { position: sticky; top: 0; z-index: 3; height: var(--bmb-hh); background: var(--sunken); border-bottom: 1px solid var(--line); padding: 3px 1px; text-align: center; font-weight: 400; vertical-align: middle; }
.bmb-t tr.bmb-h th.bmb-corner { z-index: 4; left: 0; text-align: left; padding-left: 8px; font-size: 9.5px; line-height: 13px; color: var(--muted); }
.bmb-t .bmb-corner span { display: block; white-space: nowrap; }
.bmb-t .bmb-tf { cursor: default; scroll-snap-align: start; }
.bmb-t .bmb-tf b { display: block; font: 600 12.5px/15px var(--font-mono); color: var(--fg); }
.bmb-t .bmb-tf .dt, .bmb-t .bmb-tf .ct { display: block; font: 400 9px/12px var(--font-mono); color: var(--muted); white-space: nowrap; }
.bmb-t .bmb-tf .ct { font-size: 9.5px; font-weight: 500; color: var(--fg); }
.bmb-t .bmb-tf .ct .z { color: var(--faint); font-weight: 400; }
.bmb-t .bmb-tf:focus-visible { outline-offset: -2px; }
.bmb-cell { display: flex; flex-direction: column; gap: 2px; padding: 3px 1px; min-width: 0; }
.bmb-t tr.sell .bmb-cell { flex-direction: column-reverse; }
.bmb-c { --c: var(--setup); --i: var(--fg); --cc: color-mix(in srgb, var(--c), var(--fg) var(--bmb-lift, 0%)); display: flex; flex-wrap: wrap; align-items: center; column-gap: 2px; min-width: 0;
  padding: 0 2px 0 3px; border: 1px solid transparent; border-radius: 4px; background-origin: border-box; background-repeat: no-repeat; font: 600 10.5px/14px var(--font-mono); color: var(--fg); text-decoration: none; }
.bmb-c.long { font-size: 9px; letter-spacing: -.2px; }
.bmb-c .t { min-width: 0; overflow-wrap: anywhere; }
.bmb-c .r { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; height: 14px; font-size: 9px; font-weight: 500; line-height: 14px; white-space: nowrap; }
.bmb-c .g { font-size: 9px; font-weight: 500; opacity: .8; }
.bmb-c .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cc); align-self: center; }
.bmb-c.f0 { --c: var(--f0); --i: var(--fi0); } .bmb-c.f1 { --c: var(--f1); --i: var(--fi1); } .bmb-c.f2 { --c: var(--f2); --i: var(--fi2); } .bmb-c.f3 { --c: var(--f3); --i: var(--fi3); }
.bmb-c.e0 { --c2: var(--f0); } .bmb-c.e1 { --c2: var(--f1); } .bmb-c.e2 { --c2: var(--f2); } .bmb-c.e3 { --c2: var(--f3); }
.bmb-c.t0 { --c3: var(--f0); } .bmb-c.t1 { --c3: var(--f1); } .bmb-c.t2 { --c3: var(--f2); } .bmb-c.t3 { --c3: var(--f3); }
.bmb-c.d { background-color: var(--c); color: var(--i); }
.bmb-c.n { border-color: color-mix(in srgb, var(--cc) var(--bmb-a, 100%), transparent); }
.bmb-c.n.l2 { --bmb-a: 82%; } .bmb-c.n.l3 { --bmb-a: 64%; } .bmb-c.n.l4 { --bmb-a: 48%; }
.bmb-c.n.now { background-color: color-mix(in srgb, var(--cc) 13%, transparent); }
.bmb-c.n .p { color: var(--fg); }
.bmb-c.s { border-color: color-mix(in srgb, var(--setup) 80%, transparent); color: var(--setup-ink); }
.bmb-c.s .x { font-weight: 600; }
.bmb-c.s.rep { border-color: color-mix(in srgb, var(--setup) 36%, transparent); color: var(--faint); font-weight: 500; }
.bmb-c.m2 { padding-right: 8px; background-image: linear-gradient(90deg, transparent calc(100% - 6px), var(--surface) calc(100% - 6px) calc(100% - 5px), var(--c2) calc(100% - 5px)); }
.bmb-c.m3 { padding-right: 14px; background-image: linear-gradient(90deg, transparent calc(100% - 12px), var(--surface) calc(100% - 12px) calc(100% - 11px), var(--c2) calc(100% - 11px) calc(100% - 6px), var(--surface) calc(100% - 6px) calc(100% - 5px), var(--c3) calc(100% - 5px)); }
.bmb-c.lag .t { text-decoration: underline dotted; text-underline-offset: 2px; }
.bmb-c.hot { box-shadow: 0 0 0 2px var(--hl); position: relative; z-index: 1; }
.bmb-t.q .bmb-c { opacity: .26; }
.bmb-t.q .bmb-c.hit, .bmb-t.q .bmb-c.hot, .bmb-t.q .bmb-c:focus-visible { opacity: 1; }
.bmb-t.q .bmb-c.hit { box-shadow: 0 0 0 2px var(--hl); position: relative; z-index: 1; }
.bmb-t a.bmb-c:focus-visible { outline-offset: 1px; position: relative; z-index: 1; }
.bmb-more { border: 1px solid var(--line); background: var(--sunken); border-radius: 4px; padding: 0 3px; font: 500 10px/14px var(--font-mono); color: var(--muted); cursor: pointer; text-align: center; }
.bmb-more:hover { color: var(--fg); border-color: var(--muted); }
.bmb-cnt { font: 500 10px/16px var(--font-mono); color: var(--muted); text-align: center; }
.bmb-legend .bmb-c { display: inline-flex; }
.bmb-key { font: 600 10.5px var(--font-mono); color: var(--fg); }
.bmb-fam { font-weight: 600; } .bmb-fam.f0 { color: var(--f0); } .bmb-fam.f1 { color: var(--f1); } .bmb-fam.f2 { color: var(--f2); } .bmb-fam.f3 { color: var(--f3); }
.bmb-pc { --c: var(--setup); flex: none; padding: 0 3px; border: 1px solid var(--c); border-radius: 4px; background: color-mix(in srgb, var(--c) 14%, transparent); font: 600 11px/13px var(--font-mono); }
.bmb-pc.f0 { --c: var(--f0); } .bmb-pc.f1 { --c: var(--f1); } .bmb-pc.f2 { --c: var(--f2); } .bmb-pc.f3 { --c: var(--f3); }
.bmb-pc.p9 { border-style: dashed; background: none; color: var(--setup-ink); }
.bmb-ok { color: var(--ok-fg); font-weight: 600; }
.bmb-dist { font-weight: 600; font-variant-numeric: tabular-nums; }
.bmb-warn { margin-top: 3px; color: var(--warn-fg); background: var(--warn-bg); border-radius: 5px; padding: 2px 6px; }
.bmb-foot { margin-top: 6px; color: var(--muted); font-size: 11px; }
@media (min-width: 1760px) {
  .bmb-box { --bmb-lw: 62px; --bmb-hh: 52px; }
  .bmb-c { font-size: 11.5px; line-height: 15px; }
  .bmb-c.long { font-size: 10px; }
  .bmb-c .r { height: 15px; font-size: 10px; line-height: 15px; }
  .bmb-c .g { font-size: 10px; }
  .bmb-c.s .x { font-size: 12px; }
  .bmb-more { font-size: 11px; line-height: 15px; }
  .bmb-cnt { font-size: 11px; line-height: 17px; }
  .bmb-t .bmb-tf b { font-size: 13.5px; line-height: 17px; }
  .bmb-t .bmb-tf .dt { font-size: 10px; line-height: 13px; }
  .bmb-t .bmb-tf .ct { font-size: 10.5px; line-height: 14px; }
  .bmb-t .bmb-ln .sd, .bmb-t .bmb-ln .nt { font-size: 11px; }
  .bmb-t .bmb-ln b { font-size: 12px; }
  .bmb-t .bmb-tg { font-size: 11px; }
  .bmb-t tr.bmb-h th.bmb-corner { font-size: 10.5px; line-height: 14px; }
}
@media (max-width: 720px) {
  .bmb-box { --bmb-lw: 48px; --bmb-cw: 74px; }
  .bmb-c { font-size: 11px; }
  .bmb-c.long { font-size: 9.5px; }
  .bmb-c .r { font-size: 9.5px; }
  .bmb-t .bmb-ln, .bmb-t tr.bmb-h th.bmb-corner { padding-left: 5px; }
  .bmb-ctl .bmb-q { width: 100%; }
}
@media (pointer: coarse) {
  .bmb-cell { gap: 3px; }
  .bmb-c { line-height: 19px; }
  .bmb-c .r { height: 19px; line-height: 19px; }
  .bmb-more { line-height: 19px; }
  .bmb-cnt { line-height: 21px; }
  .bmb-t .bmb-tg { line-height: 21px; padding: 0 6px; }
}`;
    document.head.append(s);
  }

  BE.register({
    view: 'market', key: 'b', name: 'TF 신호 보드',
    blurb: '타임프레임마다 신호가 나온 종목의 이름을 바로 보여 줍니다. 가운데 줄이 타임프레임이고, 위쪽은 매도 쪽, 아래쪽은 매수 쪽입니다. 가운데에서 멀수록 강한 신호입니다.',
    good: ['종목 이름을 바로 읽을 수 있음', '임박한 13을 조건가가 가까운 순서로 확인', '13x2, 9* 같은 라벨 글자와 조건가까지의 거리를 표시'],
    weak: ['신호가 많은 날에는 세로로 길어짐', '신호가 없는 종목은 보이지 않음', '칸마다 일부만 보여서 전체 분포는 숫자로만 확인'],
    mount(rootEl) {
      root = rootEl; css(); readSettings(); Q = '';
      const ctl = el('div', 'panel controls bmb-ctl'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'TF 신호 보드 설정');
      const set = (k) => (v) => { st[k] = v; changed(); };
      ctl.append(
        BE.seg('기간', [[0, '마지막 봉'], [3, '최근 4봉']], () => G.win, (v) => { G.win = v; changed(); }),
        BE.seg('임박 기준', [[3, '3%'], [5, '5%'], [10, '10%']], () => G.thr, (v) => { G.thr = v; changed(); }),
        BE.seg('칸마다 종목 수', [[5, '5'], [10, '10'], [0, '전부']], () => st.n, (v) => { st.n = v; OPEN.clear(); changed(); }),
        BE.seg('9', [[1, '포함'], [0, '빼기']], () => st.nines, set('nines')));
      { // the exchanges: any number of them, and every chosen one must list the coin
        const wrap = el('div', 'ctl'), lb = el('span', null, '거래소'), g = el('div', 'seg'); lb.id = 'bmb-lb-ex';
        g.setAttribute('role', 'group'); g.setAttribute('aria-labelledby', lb.id);
        for (const x of EXS) {
          const b = el('button', null, EX[x]); b.type = 'button'; b.setAttribute('aria-pressed', String(G.ex.includes(x)));
          b.addEventListener('click', () => { G.ex = EXS.filter((y) => (y === x ? !G.ex.includes(y) : G.ex.includes(y))); b.setAttribute('aria-pressed', String(G.ex.includes(x))); changed(); });
          g.append(b);
        }
        wrap.append(lb, g); ctl.append(wrap);
      }
      { const wrap = el('div', 'ctl'), lb = el('span', null, '종목 찾기'); lb.id = 'bmb-lb-q';
        qInput = el('input', 'bmb-q'); qInput.type = 'search'; qInput.placeholder = '심볼이나 이름'; qInput.autocomplete = 'off'; qInput.spellcheck = false;
        qInput.setAttribute('aria-labelledby', lb.id);
        qInput.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { if (!box) return; Q = qInput.value; draw(); }, 120); });
        wrap.append(lb, qInput); ctl.append(wrap);
      }
      statusEl = el('p', 'hint bmb-status'); statusEl.setAttribute('aria-live', 'polite'); ctl.append(statusEl);
      box = el('div', 'panel bmb-box');
      legendEl = el('div', 'legend bmb-legend'); legendEl.setAttribute('aria-label', '표시 방법');
      hintEl = el('p', 'hint'); useEl = el('p', 'hint');
      root.append(ctl, box, legendEl, hintEl, useEl);
      wire();
      document.addEventListener('click', onDocClick, true);
      addEventListener('scroll', onWinScroll, { passive: true });
    },
    render(why) {
      if (!box) return;
      fitBox(); themeClass();
      if (why === 'theme' || why === 'resize' || why === 'coin') return; // the board is DOM in the page's own colors
      draw();
    },
    unmount() {
      clearTimeout(qTimer); cancelAnimationFrame(focusRaf);
      document.removeEventListener('click', onDocClick, true);
      removeEventListener('scroll', onWinScroll);
      BE.tip.hide();
      root = box = statusEl = legendEl = hintEl = useEl = qInput = null;
      M = null; ITEMS = []; NAV = []; POS = new Map(); BY_SLUG = new Map(); STOP = HOT = ARMED = TIP_FOR = TIP_NODES = null;
    },
  });
})();
