// Bird eye study, ladder view, variant B: 가격 사다리 (price ladder).
//
// One coin: the prices at which the bar in progress of each of the 20 timeframes would get its next 9 or 13, as a map
// around the current price (the newest daily close). The distance axis is symmetric and compresses the far range:
// sign(d) * log(1 + |d| / 1%). Everything drawn comes from BE.detail(coin): tfs[j].trigs are the engine's next-bar
// triggers (TD.nextBarTriggers) with VIEW.fire(...) = where the bar stands against each ({now, p, pct, q, qpct, dir});
// tfs[j].base is the bar in progress so far. Nothing is counted here.
//
//   chip                at fire.p: the price the bar has to reach (for a 13: the low of a buy, the high of a sell),
//                       with the distance next to it. Drawn as the study draws a 13 that waits at 12: a frame in the
//                       family color around a light ground of it, heavier within the 임박 threshold; a 9 that may come
//                       is a dashed gray frame (a repeated 9 lighter). Marks of one family and side at one spot share
//                       a chip ("×2"); a chip that would cover another stands beside it; a mark without room for a
//                       chip is a short bar in its lane
//   thin line and tick  from p back to fire.q: the close nearest to the current price at which the label still appears
//                       once p has been touched ("종"). The line runs to the center line when the close may stay where
//                       it is, and there is none when the close itself has to be at p
//   dot on the center   fire.now: the label appears if the bar closes where it is; its chip stands next to the dot,
//                       on the side of its signal
//   bar at a cell's edge  the low and the high of the bar in progress so far (none where the data has no such bar)
//   beyond the range    an arrow at the edge and the distance in the strip beyond it
//
// Wide rooms: timeframes are columns, up = the price has to rise (sell side), down = it has to fall (buy side), the
// list of the same marks on the right or below. Narrow rooms: the picture is turned (timeframes are rows, buy side
// left, sell side right) and the list follows below. The list is the keyboard path: one tab stop, the arrow keys move
// through the rows, and the focused row's mark is highlighted in the picture.
(() => {
  const ID = 'ladder-b';
  const RANGES = [10, 25, 60], NEARS = [3, 5, 10];
  const TICKS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5];       // grid lines, as a ratio of the current price
  const TICK_RANK = [0.1, 0.5, 0.05, 0.2, 0.02, 0.01];   // which tick labels stay when they do not all fit
  const UNIT = 0.01;                                     // the scale's unit: log(1 + |d| / 1%)
  const scale = (d) => Math.sign(d) * Math.log1p(Math.abs(d) / UNIT);
  const LIST_W = 340;                                    // the list's width when it stands next to the picture
  const WIDE_MIN = 1300, TALL_MIN = 880;                 // root widths: list on the right from WIDE_MIN, columns from TALL_MIN
  const NINE_LANE = 0.7;                                 // the 9 lane's size against a family lane
  const MAX_NOW = 12;                                    // entries built for the summary's "지금 값으로 충족" cell
  // Room around the cells in px. "before" / "after": along the timeframes (axis labels); "lead" / "trail": along the
  // distance axis (timeframe names, closing days); "strip": the band beyond the range on either side; "inset": between
  // the end of the range and that band, so that a chip at the end of the range stays inside; "gap": between the
  // timeframe groups; "padA" / "padB": inside a cell before the first lane (room for the bar of the bar in progress)
  // and after the last.
  const COLS = { before: 50, lead: 20, trail: 18, strip: 38, inset: 8, gap: 10, padA: 6, padB: 2, minH: 420, maxH: 640 };   // timeframes as columns
  const ROWS = { before: 34, after: 20, lead: 32, trail: 2, strip: 40, inset: 11, gap: 8, padA: 5, padB: 2, row: 36 };      // turned: as rows
  const CHIP_H = 14, CHIP_PX = 10.5;                     // a chip in the picture: its height and the size of its text
  const { el, fmtPrice, fmtPct, iso } = BE;
  // a gap before these timeframes, as in the screener's table
  const GROUP_AT = ['8D', '1M'].map((tf) => BE.TFS.indexOf(tf)).filter((j) => j > 0);

  let root = null, S = null, ui = null, cur = null, token = 0;
  let marks = [], skipped = 0, geo = null, hoverId = null, focusId = null, raf = 0, FONT = null;
  let seenH = 0, tallTimer = 0;   // the window's height the picture was laid out for (the page redraws only when the width changes)

  // ---------- style ----------
  function addCss() {
    if (document.getElementById('be-ladder-b-css')) return;
    const st = document.createElement('style'); st.id = 'be-ladder-b-css';
    st.textContent = `
.blb-main { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); align-items: start; min-width: 0; }
.blb-main.blb-wide { grid-template-columns: minmax(0, 1fr) ${LIST_W}px; }
.blb-chart { padding: 10px; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); align-content: start; }
.blb-sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.blb-turned .blb-sum { grid-template-columns: minmax(0, 1fr); }
.blb-sc { display: flex; align-items: center; gap: 2px 8px; min-width: 0; min-height: 30px; padding: 3px 9px; border-radius: 8px; background: var(--sunken); font-size: 12.5px; }
.blb-sl { color: var(--muted); font-weight: 500; white-space: nowrap; }
.blb-sv { display: flex; flex: 1 1 0; align-items: center; gap: 2px; min-width: 0; overflow: hidden; padding: 2px; margin: -2px; }
.blb-turned .blb-sc { flex-wrap: wrap; }
.blb-turned .blb-sv { flex: 0 1 auto; flex-wrap: wrap; }
.blb-none { color: var(--faint); }
.blb-more { color: var(--muted); font-size: 12px; padding: 0 4px; white-space: nowrap; }
.blb-go { flex: none; border: 0; background: transparent; padding: 2px 5px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--fg); white-space: nowrap; }
.blb-turned .blb-go { padding-block: 4px; }
.blb-go:hover, .blb-go.blb-on { background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
.blb-go .blb-ar { font-size: 10px; color: var(--muted); }
.blb-go .blb-pr { font-size: 12px; color: var(--muted); }
.blb-go .blb-x { font-size: 11.5px; color: var(--muted); }
.blb-cvw { position: relative; min-width: 0; overflow-x: auto; }
.blb-cv { display: block; touch-action: pan-y; }
.blb-quiet { position: absolute; left: 0; right: 0; top: 26%; margin: 0 auto; width: fit-content; max-width: 78%; padding: 4px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); color: var(--muted); font-size: 12.5px; text-align: center; pointer-events: none; }
.blb-turned .blb-quiet { position: static; width: auto; max-width: none; margin: 0 0 8px; }
.blb-wait p { margin: 0 0 10px; }
.blb-list { display: flex; flex-direction: column; overflow: hidden; }
.blb-lh { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 8px; padding: 9px 12px 8px; border-bottom: 1px solid var(--line); }
.blb-lh h2 { font-size: 14px; }
.blb-cnt { font-size: 12px; color: var(--muted); }
.blb-rows { overflow-y: auto; min-height: 0; flex: 1 1 auto; }
.blb-sec ol { list-style: none; margin: 0; padding: 0; }
.blb-grp { position: sticky; top: 0; z-index: 1; margin: 0; padding: 3px 12px; font-size: 11.5px; font-weight: 600; color: var(--muted); background: var(--sunken); border-bottom: 1px solid var(--line); }
.blb-sec + .blb-sec .blb-grp { border-top: 1px solid var(--line); }
.blb-row { display: grid; gap: 3px; grid-template-columns: minmax(0, 1fr); padding: 8px 12px 8px 9px; border-left: 3px solid transparent; border-bottom: 1px solid var(--line); cursor: default; }
.blb-row:last-child { border-bottom: 0; }
.blb-row.blb-on { background: var(--accent-soft); border-left-color: var(--accent); }
.blb-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.blb-cols .blb-rows { column-count: 2; column-gap: 0; column-rule: 1px solid var(--line); }
.blb-cols .blb-row, .blb-cols .blb-grp { break-inside: avoid; }
.blb-cols .blb-grp { position: static; break-after: avoid; }
.blb-cols .blb-row:last-child { border-bottom: 1px solid var(--line); }
.blb-cols .blb-sec + .blb-sec .blb-grp { border-top: 0; }
.blb-r1 { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 7px; }
.blb-tf { min-width: 30px; font-size: 13px; }
.blb-fam { font-weight: 500; font-size: 12.5px; }
.blb-side { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.blb-end { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.blb-dist { font-size: 13.5px; font-weight: 600; }
.blb-near { font-size: 11px; font-weight: 600; line-height: 16px; padding: 0 5px; border-radius: 4px; background: var(--warn-bg); color: var(--warn-fg); white-space: nowrap; }
.blb-now { font-size: 11.5px; font-weight: 600; line-height: 18px; padding: 0 8px; border-radius: 999px; background: var(--fg); color: var(--surface); white-space: nowrap; }
.blb-px { font-size: 12px; }
.blb-px i { font-style: normal; color: var(--muted); font-family: var(--font-sans); }
.blb-cond { margin: 0; font-size: 12px; line-height: 1.45; color: var(--muted); }
.blb-meta { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11.5px; color: var(--muted); }
.blb-meta a { margin-left: auto; white-space: nowrap; }
.blb-k { display: inline-block; flex: none; font: 600 11px/13px var(--font-mono); font-style: normal; padding: 0 3px; border-radius: 4px; border: 1px solid var(--c, var(--setup)); color: var(--fg); white-space: nowrap; }
.blb-k13 { background: color-mix(in srgb, var(--c) 14%, transparent); }
.blb-k13.blb-n1 { background: color-mix(in srgb, var(--c) 26%, transparent); box-shadow: 0 0 0 1px var(--c); }
.blb-k13.blb-n0 { background: color-mix(in srgb, var(--c) 40%, transparent); box-shadow: 0 0 0 1px var(--c); }
.blb-k9 { border-style: dashed; color: var(--setup-ink); }
.blb-k9.blb-n0 { background: color-mix(in srgb, var(--setup) 22%, transparent); }
.blb-rep { opacity: .6; }
.blb-empty { margin: 0; padding: 28px 12px; text-align: center; color: var(--muted); font-size: 13px; }
.blb-foot { padding: 10px 12px; display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.blb-foot .legend > span { white-space: normal; }
.blb-foot .hint { max-width: 120ch; }
.blb-g { display: inline-block; flex: none; }
.blb-g-turn { transform: rotate(90deg); }
.blb-g-band { width: 3px; height: 14px; margin: 0 4px; border-radius: 1px; background: var(--muted); opacity: .4; }
.blb-g-near { width: 14px; height: 12px; border-radius: 2px; background: var(--hl); opacity: .3; border-block: 1px dashed var(--hl); }
.blb-g-fam { width: 9px; height: 9px; border-radius: 2px; }
.blb-tipbox { display: grid; gap: 3px; grid-template-columns: minmax(0, 1fr); min-width: min(250px, 70vw); }
.blb-tipbox + .blb-tipbox { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--line); }
.blb-tipmore { margin-top: 6px; color: var(--muted); }
`;
    document.head.append(st);
  }

  // ---------- words ----------
  // a trigger's conditions as a sentence, in the wording of the screener's trigText
  const SRC_KO = { o: '시가', h: '고가', l: '저가', c: '종가', hl: '고가와 저가의 차이' };
  const OP_KO = { '<': '미만', '<=': '이하', '>': '초과', '>=': '이상' };
  const condText = ([s, op, v]) => `${SRC_KO[s] || s}가 ${fmtPrice(v)} ${OP_KO[op] || op}`;
  const groupText = (g) => g.map(condText).join('이고 ');
  // the bar a trigger is about: the one in progress, or the next one when no closed day is in it yet (as on 1D)
  const barWord = (x) => (x.bars.partial ? '진행 중인 봉' : '다음 봉');
  function condSentence(t, x) {
    const parts = [], bar = barWord(x);
    if (t.all && t.all.length) parts.push(groupText(t.all));
    if (t.any && t.any.length && !t.any.some((g) => !g.length)) parts.push(t.any.length === 1 ? groupText(t.any[0]) : t.any.map(groupText).join('이거나 '));
    let s = parts.length ? `${bar}의 ${parts.join('이고, ')}이면 나옵니다.` : `${bar}이 마감하면 가격과 상관없이 나옵니다.`;
    if (t.unless && t.unless.some((g) => !g.length)) s += ' 다만 이 봉에서는 취소됩니다.';
    else if (t.unless && t.unless.length) s += ` 다만 ${t.unless.map(groupText).join('이거나 ')}이면 취소됩니다.`;
    return s;
  }
  const kindName = (m) => (m.is13 ? BE.FAM_NAME[m.f] : m.rep ? '반복 9' : '셋업 9');
  const markText = (m) => (m.is13 ? '13' : '9');
  const markColor = (m) => (m.is13 ? BE.FAM_COLOR[m.f] : BE.SETUP_COLOR);
  // The prices of a mark that is not met yet. When the close may come back after the bar has touched p (q differs
  // from p), p is the level of the low (the price has to fall) or of the high (it has to rise) and q the close level;
  // q at the current price is not named. When q is p, the close itself has to be there.
  function priceNodes(m) {
    const f = m.fire, out = [], lab = (t) => { const i = document.createElement('i'); i.textContent = t; return i; };
    if (f.q === f.p) out.push(lab('종가 '), fmtPrice(f.p));
    else {
      out.push(lab(f.dir < 0 ? '저가 ' : '고가 '), fmtPrice(f.p));
      if (f.qpct !== 0) out.push(lab(' · 종가 '), `${fmtPrice(f.q)} (${fmtPct(f.qpct)})`);
    }
    return out;
  }
  // the last calendar day of the bar a timeframe's triggers are tested on: the bar in progress, or the one that begins
  // after the last closed day
  function closeDay(x) {
    if (x.bars.partial) return x.bars.partial.end;
    try { return BARS.bucketFn(x.tf)(BE.LAST + 1, [0, 0])[1]; } catch (e) { return null; }
  }

  // ---------- the marks ----------
  // One per trigger that can fire, of the families switched on (9s when the display includes them): "지금 값으로 충족"
  // first, then nearest first. lane: 0 for a 9, then the families in the indicator's order.
  function collect() {
    marks = []; skipped = 0;
    for (const x of cur.det.tfs) {
      for (const t of x.trigs) {
        const is13 = t.k === 'C13';
        if (is13 ? !BE.famOn(t.f) : S.show !== 'all') continue;
        if (!t.fire) { skipped++; continue; }
        marks.push({ j: x.j, tf: x.tf, x, trig: t.t, is13, f: is13 ? t.f : null, d: t.d, o: t.o, rep: t.k === 'S9r', fire: t.fire,
          lane: is13 ? 1 + BE.FAMS.indexOf(t.f) : 0 });
      }
    }
    marks.sort((a, b) => (Number(b.fire.now) - Number(a.fire.now)) || (Math.abs(a.fire.pct) - Math.abs(b.fire.pct)) || (a.j - b.j) || (a.lane - b.lane));
    marks.forEach((m, i) => { m.id = i; m.near = !m.fire.now && Math.abs(m.fire.pct) <= S.near / 100; });
  }
  // The mark of a condition, in the list as in the picture, as the study draws a 13 that waits at 12: a frame in the
  // family color around a light ground of it, heavier within the 임박 threshold, darker when it is met as things are.
  // A 9 that may come is a dashed gray frame. (A filled chip is a 13 that is on the chart; none of these is yet.)
  function chip(m) {
    const c = el('b', `blb-k ${m.is13 ? 'blb-k13' : 'blb-k9'}${m.fire.now ? ' blb-n0' : m.near ? ' blb-n1' : ''}${m.rep ? ' blb-rep' : ''}`, markText(m));
    if (m.is13) c.style.setProperty('--c', inkOf(m));
    return c;
  }

  // ---------- list rows, tooltips, summary, legend ----------
  // the body of a list row; the tooltip of a mark shows the same without the link
  function rowBody(m, withLink) {
    const out = [], r1 = el('div', 'blb-r1'), end = el('span', 'blb-end');
    r1.append(el('b', 'blb-tf num', m.tf), chip(m), el('span', 'blb-fam', kindName(m)), el('span', 'blb-side', `${BE.SIDE[m.d]} ${BE.ARROW[m.d]}`));
    if (m.fire.now) end.append(el('span', 'blb-now', '지금 값으로 충족'));
    else { if (m.near) end.append(el('span', 'blb-near', '임박')); end.append(el('span', 'blb-dist num', fmtPct(m.fire.pct))); }
    r1.append(end); out.push(r1);
    if (!m.fire.now) { const px = el('div', 'blb-px num'); px.append(...priceNodes(m)); out.push(px); }
    out.push(el('p', 'blb-cond', condSentence(m.trig, m.x)));
    const meta = el('div', 'blb-meta'), cd = closeDay(m.x);
    const dated = (label, day) => { const s = el('span', null, `${label} `); s.append(el('span', 'num', iso(day))); return s; };
    if (m.is13 && m.o != null) meta.append(dated('출발 봉', m.o));
    if (cd != null) meta.append(dated('봉 마감', cd));
    if (withLink && cur.c.usd) {
      const a = el('a', null, '차트 ↗'); a.href = BE.tvUrl(cur.c.usd, m.tf); a.target = '_blank'; a.rel = 'noopener'; a.tabIndex = -1;
      a.setAttribute('aria-label', `${m.tf} TradingView 차트`);
      meta.append(a);
    }
    if (meta.childNodes.length) out.push(meta);
    return out;
  }
  function tipNodes(ids) {
    const out = [];
    for (const id of ids.slice(0, 3)) { const b = el('div', 'blb-tipbox'); b.append(...rowBody(marks[id], false)); out.push(b); }
    if (ids.length > 3) out.push(el('div', 'blb-tipmore', `같은 자리에 ${ids.length - 3}개가 더 있습니다.`));
    return out;
  }
  // a summary entry: a button that takes the focus to the mark's row
  function goButton(m, withDist) {
    const b = el('button', 'blb-go'); b.type = 'button'; b.dataset.id = m.id;
    b.append(el('b', 'num', m.tf), chip(m), el('span', 'blb-ar', BE.ARROW[m.d]));
    if (withDist) b.append(el('b', 'num', fmtPct(m.fire.pct)), el('span', 'num blb-pr', fmtPrice(m.fire.p)));
    b.setAttribute('aria-label', `${m.tf} ${kindName(m)} ${BE.SIDE[m.d]} ${markText(m)}${withDist ? `, ${fmtPct(m.fire.pct)}, ${fmtPrice(m.fire.p)}` : ', 지금 값으로 충족'}. 목록에서 보기`);
    return b;
  }
  // The summary: what is met now and the nearest mark on either side. The cells stand in the order of the study's
  // convention: side by side the buy side left of the sell side, below each other (turned) the sell side first.
  function fillSummary(turned) {
    const now = marks.filter((m) => m.fire.now);
    const up = marks.find((m) => !m.fire.now && m.fire.pct > 0), down = marks.find((m) => !m.fire.now && m.fire.pct < 0);   // nearest: marks are sorted
    const cell = (label, nodes, cls) => { const c = el('div', 'blb-sc' + (cls ? ' ' + cls : '')), v = el('div', 'blb-sv'); v.append(...nodes); c.append(el('span', 'blb-sl', label), v); return c; };
    const none = () => [el('span', 'blb-none', '없음')];
    // conditions of one timeframe, family and side that hold together stand as one entry with their number
    const groups = new Map();
    for (const m of now) { const k = `${m.j}|${m.lane}|${m.d}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    const nowNodes = [...groups.values()].slice(0, MAX_NOW).map((list) => { const b = goButton(list[0], false); if (list.length > 1) b.append(el('span', 'blb-x', `${list.length}개`)); return b; });
    if (nowNodes.length > 1) { const more = el('span', 'blb-more'); more.hidden = true; more.dataset.rest = groups.size - nowNodes.length; nowNodes.push(more); }
    const rise = cell('가격이 오를 때 첫 신호', up ? [goButton(up, true)] : none()), fall = cell('가격이 내릴 때 첫 신호', down ? [goButton(down, true)] : none());
    ui.sum.replaceChildren(cell('지금 값으로 충족', now.length ? nowNodes : none(), 'blb-sc-now'), ...(turned ? [rise, fall] : [fall, rise]));
    ui.sum.dataset.turned = String(turned);
  }
  // Side by side, every summary cell stays on one line, so that the picture keeps its place from coin to coin: of the
  // first cell's entries those that do not fit are counted ("외 2개"), and a price that does not fit is left to the
  // list. Below each other (turned), the cells wrap instead.
  function fitSummary(turned) {
    for (const x of ui.sum.querySelectorAll('.blb-go, .blb-pr')) x.hidden = false;
    const more = ui.sum.querySelector('.blb-more');
    if (more) { const rest = Number(more.dataset.rest) || 0; more.hidden = rest === 0; more.textContent = `외 ${rest}개`; }
    if (turned) return;
    for (const v of ui.sum.querySelectorAll('.blb-sv')) {
      const over = () => v.scrollWidth > v.clientWidth + 1;
      if (v.contains(more)) {
        const items = [...v.querySelectorAll('.blb-go')], rest = Number(more.dataset.rest) || 0;
        for (let shown = items.length; shown > 1 && over(); shown--) { items[shown - 1].hidden = true; more.hidden = false; more.textContent = `외 ${items.length - shown + 1 + rest}개`; }
      } else if (over()) { const pr = v.querySelector('.blb-pr'); if (pr) pr.hidden = true; }
    }
  }
  const emptyText = () => '지금 보이는 설정에서는 진행 중인 봉에 9나 13이 나올 조건이 없습니다.';
  function fillList() {
    const now = marks.filter((m) => m.fire.now), near = marks.filter((m) => m.near), rest = marks.filter((m) => !m.fire.now && !m.near);
    ui.cnt.textContent = marks.length ? `가까운 순서 · ${marks.length}개` : '';
    const out = [];
    if (!marks.length) out.push(el('p', 'blb-empty', emptyText()));
    let first = true;
    for (const [title, list] of [['지금 값으로 충족', now], [`임박 · ${S.near}% 이내`, near], ['그 밖', rest]]) {
      if (!list.length) continue;
      const sec = el('section', 'blb-sec'), ol = el('ol');
      sec.setAttribute('aria-label', title);
      for (const m of list) {
        const li = el('li', 'blb-row'); li.dataset.id = m.id; li.tabIndex = first ? 0 : -1; first = false;   // one tab stop for the whole list
        li.append(...rowBody(m, true));
        ol.append(li);
      }
      sec.append(el('h3', 'blb-grp', `${title} ${list.length}개`), ol);
      out.push(sec);
    }
    ui.rows.replaceChildren(...out);
    ui.rows.scrollTop = 0;
  }
  function fillFoot() {
    const turned = !!(geo && geo.turned);
    const lg = el('div', 'legend');
    const add = (nodes, text) => { const s = el('span'); s.append(...nodes, document.createTextNode(text)); lg.append(s); };
    // glyphs as the picture draws them: the chips as in the list; lines lying when the timeframes are columns,
    // standing when the picture is turned
    const svg = (w, h, body, turn) => { const t = document.createElement('template'); t.innerHTML = `<svg class="blb-g${turn && turned ? ' blb-g-turn' : ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`; return t.content.firstChild; };
    const on = BE.FAMS.filter((f) => BE.famOn(f)), f0 = on.length ? on[0] : BE.FAMS[0];
    const sample = (o) => chip({ is13: true, f: f0, rep: false, near: false, fire: { now: false }, ...o }), c0 = inkOf({ is13: true, f: f0 });
    add([sample({})], '13 조건가');
    add([sample({ near: true })], `임박한 13 조건가(${S.near}% 이내)`);
    add([svg(16, 12, `<path d="M1 6h14" stroke="var(--fg)" stroke-width="1.2"/><circle cx="8" cy="6" r="4.2" fill="${c0}" stroke="var(--surface)" stroke-width="1.2"/>`, true), sample({ fire: { now: true } })], '지금 값으로 충족');
    if (S.show === 'all') {
      add([sample({ is13: false, f: null })], '9 조건가');
      add([sample({ is13: false, f: null, rep: true })], '반복 9');
    }
    add([svg(16, 16, `<path d="M8 15V3" stroke="${c0}" stroke-width="1" opacity=".6"/><path d="M4.5 3h7" stroke="${c0}" stroke-width="1.6"/>`, true)], '종가 조건가(종)');
    add([el('i', `blb-g blb-g-band${turned ? ' blb-g-turn' : ''}`)], '진행 중인 봉의 저가에서 고가까지');
    add([el('i', 'blb-g blb-g-near')], '임박 구간');
    add([svg(12, 12, '<path d="M6 2l4.2 7.5H1.8z" fill="var(--muted)"/>', false)], '범위 밖과 그 거리');
    BE.FAMS.forEach((f, n) => { const i = el('i', 'blb-g blb-g-fam'); i.style.background = `var(--f${f})`; add(n ? [i] : [document.createTextNode('계열 색'), i], BE.FAM_NAME[f]); });

    const hints = [];
    hints.push('표시가 놓인 자리는 진행 중인 봉의 저가(매도 쪽은 고가)가 닿아야 하는 가격이고, 옆의 숫자는 최근 종가에서 그 가격까지의 거리입니다. ‘종’이 붙은 가는 눈금은 종가가 마감해야 하는 가격입니다. 가는 선이 가운데 선까지 이어지면 종가는 현재가에 마감해도 되고, 가는 선이 없으면 종가도 표시의 가격까지 가야 합니다.');
    let facts = `한 타임프레임 안에서는 ${turned ? '위에서부터' : '왼쪽부터'} 9, ${BE.FAMS.map((f) => BE.FAM_NAME[f]).join(', ')} 순서로 자리가 정해져 있습니다.`;
    facts += ` 가운데 선의 점은 지금 값으로 충족하는 조건이고, 그 표시는 매도 쪽이면 선 ${turned ? '오른쪽' : '위'}에, 매수 쪽이면 선 ${turned ? '왼쪽' : '아래'}에 붙습니다.`;
    const assumed = cur ? cur.det.tfs.filter((x) => x.bars.n && x.base.assumed).map((x) => x.tf) : [];
    if (assumed.length) facts += ` 진행 중인 봉이 데이터에 아직 없는 타임프레임(${assumed.join(', ')})은 다음 봉의 시가를 최근 종가로 보고 계산했습니다.`;
    const seen = new Set(); let multi = false;
    for (const m of marks) { if (!m.is13) continue; const k = `${m.j}|${m.f}|${m.d}`; if (seen.has(k)) multi = true; seen.add(k); }
    if (multi) facts += ' 같은 계열의 13 조건 여러 개가 한 봉에서 함께 충족되면 차트에는 13x2처럼 하나로 나옵니다.';
    if (geo && geo.times) facts += ' 표시 옆의 ×2는 같은 계열의 조건 2개가 같은 자리에 있다는 뜻입니다.';
    if (skipped) facts += ` 가격이 한 번 움직여서는 충족될 수 없는 조건 ${skipped}개는 그리지 않았습니다.`;
    hints.push(facts);
    let mouse = true; try { mouse = matchMedia('(hover: hover)').matches; } catch (e) { /* old browsers: as with a mouse */ }
    hints.push(mouse ? '그림의 표시에 마우스를 올리면 그 표시의 조건이 글로 나오고, 목록에서 같은 줄이 강조됩니다. 목록의 줄에 마우스를 올리거나 줄을 고른 뒤 위아래 화살표 키로 옮기면 그림에서 같은 표시가 강조됩니다. 줄에서 Enter 키를 누르면 그 타임프레임의 TradingView 차트가 열립니다.'
      : '그림의 표시를 누르면 그 표시의 조건이 글로 나옵니다.');
    ui.foot.replaceChildren(lg, ...hints.map((h) => el('p', 'hint', h)));
  }

  // ---------- geometry ----------
  // Two axes: "cross" runs over the timeframes (coordinate a), "dist" over the distance from the current price
  // (coordinate d). Timeframes as columns: a = x, d = y, a rise is up. Turned: a = y, d = x, a rise is to the right.
  function fonts() {
    if (!FONT) {
      const cs = getComputedStyle(document.documentElement);
      const mono = cs.getPropertyValue('--font-mono').trim() || 'monospace', sans = cs.getPropertyValue('--font-sans').trim() || 'sans-serif';
      FONT = { m: (w, px) => `${w} ${px}px ${mono}`, s: (w, px) => `${w} ${px}px ${sans}` };
    }
    return FONT;
  }
  const axisPrice = (v) => fmtPrice(Number(v.toPrecision(5)));
  const tickPct = (x) => `${x < 0 ? '−' : '+'}${Math.round(Math.abs(x) * 100)}%`;
  function layout() {
    const rw = root.clientWidth, wide = rw >= WIDE_MIN, turned = !wide && rw < TALL_MIN;
    ui.main.classList.toggle('blb-wide', wide); ui.main.classList.toggle('blb-turned', turned); ui.main.classList.toggle('blb-cols', !wide && !turned);
    ui.list.style.height = '';
    if (ui.sum.dataset.turned !== String(turned)) fillSummary(turned);   // new marks, or the cells change their order
    fitSummary(turned);
    // the picture is as wide as its box; in a box narrower than 240 px it keeps that width and scrolls inside the box
    const W = Math.max(240, Math.floor(ui.cvw.clientWidth)), n = BE.TFS.length, R = S.range / 100, c0 = cur.det.last, F = fonts();
    const g = { turned, wide, W, n, R, sR: scale(R), c0, ticks: TICKS.filter((t) => t <= R + 1e-9), hits: [], ...(turned ? ROWS : COLS) };
    if (!turned) {
      // room for the prices on the right; the height follows the window so that the picture ends at its lower edge
      const ctx = ui.cv.getContext('2d');
      let pw = 0;
      ctx.font = F.m(500, 10.5); for (const t of [...g.ticks, R]) for (const s of [-1, 1]) pw = Math.max(pw, ctx.measureText(axisPrice(c0 * (1 + s * t))).width);
      ctx.font = F.m(600, 10.5); pw = Math.max(pw, ctx.measureText(fmtPrice(c0)).width + 10);
      g.after = Math.ceil(pw) + 12;
      const top = ui.cvw.getBoundingClientRect().top + window.scrollY;
      g.H = Math.round(Math.max(g.minH, Math.min(g.maxH, window.innerHeight - top - 14)));
      g.half = (g.H - g.lead - g.trail - 2 * g.strip) / 2;
      g.a1 = W - g.after;
    } else {
      g.H = g.before + n * g.row + GROUP_AT.length * g.gap + g.after;
      g.half = (W - g.lead - g.trail - 2 * g.strip) / 2;
      g.a1 = g.H - g.after;
    }
    g.a0 = g.before; g.dc = g.lead + g.strip + g.half;
    g.cs = (g.a1 - g.a0 - GROUP_AT.length * g.gap) / n;                                  // size of a cell along the timeframes
    g.cell = (j) => g.a0 + j * g.cs + GROUP_AT.filter((x) => j >= x).length * g.gap;    // where cell j begins
    g.groups = []; { let s = 0; for (const x of [...GROUP_AT, n]) { g.groups.push([s, x - 1]); s = x; } }
    g.unit = (g.cs - g.padA - g.padB) / (NINE_LANE + BE.FAMS.length);                   // size of a family lane
    g.lane = (j, k) => { const s = g.cell(j) + g.padA + (k ? (NINE_LANE + k - 1) * g.unit : 0), size = k ? g.unit : NINE_LANE * g.unit; return { a0: s, a1: s + size, mid: s + size / 2, size }; };
    g.span = g.half - g.inset;                                                          // px from the current price to the end of the range
    g.fresh = true;
    geo = g;
  }

  // ---------- drawing ----------
  const rgbOf = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const relLum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // The color a mark is drawn with: its own, or, when that hardly stands out from the surface (the Combo purple on the
  // dark theme), the same hue mixed towards the text color until it does.
  function standOut(color, surface, fg) {
    const c = rgbOf(color), s = rgbOf(surface), f = rgbOf(fg);
    if (!c || !s || !f || contrast(c, s) >= 3) return color;
    for (let t = 0.1; t < 0.75; t += 0.1) { const m = c.map((v, i) => Math.round(v + (f[i] - v) * t)); if (contrast(m, s) >= 3.5) return `rgb(${m.join(', ')})`; }
    return fg;
  }
  const inkOf = (m) => standOut(markColor(m), BE.C.surface, BE.C.fg);
  const overlaps = (b, o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h;
  const grown = (b, n) => ({ x: b.x - n, y: b.y - n, w: b.w + 2 * n, h: b.h + 2 * n });
  const activeId = () => (hoverId != null ? hoverId : focusId);
  function schedule() { if (!raf) raf = requestAnimationFrame(draw); }
  // the tools of one drawing pass; positions are (a, d) as above, boxes are {x, y, w, h} in canvas px
  function pen() {
    const g = geo, ctx = BE.setupCanvas(ui.cv, g.W, g.H), T = g.turned, sgn = T ? 1 : -1;
    const pt = (a, d) => (T ? [d, a] : [a, d]);
    return {
      g, ctx, T, sgn, pt, C: BE.C, F: fonts(), dark: relLum(rgbOf(BE.C.surface) || [255, 255, 255]) < 0.2,
      ink: inkOf,
      D: (p) => g.dc + sgn * scale(Math.max(-g.R, Math.min(g.R, p))) / g.sR * g.span,     // a distance (ratio), held inside the range
      edge: (s) => g.dc + sgn * s * g.half,                                               // where the band beyond the range begins, on the side of a rise (1) or a fall (-1)
      dLo: g.dc - g.half, dHi: g.dc + g.half, dMin: g.dc - g.half - g.strip, dMax: g.dc + g.half + g.strip,
      snap: (v) => Math.round(v) + 0.5,
      box: (a0, d0, a1, d1) => { const [x0, y0] = pt(a0, d0), [x1, y1] = pt(a1, d1); return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; },
      fill: (b) => ctx.fillRect(b.x, b.y, b.w, b.h),
      seg: (a0, d0, a1, d1) => { ctx.beginPath(); ctx.moveTo(...pt(a0, d0)); ctx.lineTo(...pt(a1, d1)); ctx.stroke(); },
      round: (b, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, r); else ctx.rect(b.x, b.y, b.w, b.h); },
      hit: (id, b, padX = 0, padY = 0) => g.hits.push({ id, x: b.x - padX, y: b.y - padY, w: b.w + 2 * padX, h: b.h + 2 * padY }),
    };
  }
  function draw() {
    raf = 0;
    if (!geo || !cur || !root) return;
    geo.hits = [];
    const k = pen(), am = activeId() == null ? null : marks[activeId()] || null;
    k.ctx.clearRect(0, 0, geo.W, geo.H);
    drawFrame(k, am);
    drawBars(k);
    const P = drawMarks(k);
    drawAxes(k);
    drawNames(k, am);
    if (am) drawActive(k, P[am.id]);
    ui.cv.setAttribute('aria-label', ariaText());
    if (geo.fresh) {   // once per layout, for tests: where each mark stands in the picture (canvas px) and what is written next to it
      geo.fresh = false;
      const r1 = (v) => Math.round(v * 10) / 10;
      ui.cv.dataset.geo = JSON.stringify({ coin: cur.c.slug, turned: geo.turned, W: geo.W, H: geo.H, dc: geo.dc, half: geo.half, span: geo.span, R: geo.R, cs: r1(geo.cs), cells: BE.TFS.map((tf, j) => r1(geo.cell(j))) });
      ui.cv.dataset.marks = JSON.stringify(P.map((p) => [p.m.id, p.m.tf, markText(p.m), p.m.f, p.m.d,
        p.off ? 'arrow' : p.m.fire.now ? 'dot' : p.small ? 'bar' : p.host ? 'with' : 'chip', r1(p.box.x), r1(p.box.y), r1(p.box.w), r1(p.box.h), p.note || null, p.times || null, p.m.fire.now ? !!p.tag : null]));
    }
  }
  // the cells: strips beyond the range, the 임박 zone, the cell of the highlighted mark, grid lines, frames
  function drawFrame(k, am) {
    const { g, ctx, C, D, snap, box, fill, seg, dark, dLo, dHi, dMin, dMax } = k;
    const near = Math.min(S.near / 100, g.R), span = (gr) => [g.cell(gr[0]), g.cell(gr[1]) + g.cs];
    ctx.lineWidth = 1;
    for (const gr of g.groups) {
      const [a0, a1] = span(gr);
      ctx.fillStyle = C.sunken; fill(box(a0, dMin, a1, dLo)); fill(box(a0, dHi, a1, dMax));
      ctx.globalAlpha = dark ? 0.05 : 0.07; ctx.fillStyle = C.hl; fill(box(a0, D(near), a1, D(-near))); ctx.globalAlpha = 1;
    }
    if (am) { ctx.globalAlpha = dark ? 0.55 : 0.7; ctx.fillStyle = C['accent-soft']; fill(box(g.cell(am.j), dMin, g.cell(am.j) + g.cs, dMax)); ctx.globalAlpha = 1; }
    for (const gr of g.groups) {
      const [a0, a1] = span(gr);
      ctx.strokeStyle = C.line;
      for (const t of g.ticks) for (const s of [-1, 1]) seg(a0, snap(D(s * t)), a1, snap(D(s * t)));
      ctx.globalAlpha = 0.6;
      for (let j = gr[0] + 1; j <= gr[1]; j++) seg(snap(g.cell(j)), dMin, snap(g.cell(j)), dMax);
      ctx.globalAlpha = 1;
      if (near < g.R) {
        ctx.strokeStyle = C.hl; ctx.globalAlpha = 0.55; ctx.setLineDash([2, 3]);
        for (const s of [-1, 1]) seg(a0, snap(D(s * near)), a1, snap(D(s * near)));
      }
      ctx.strokeStyle = C.faint; ctx.globalAlpha = 0.7; ctx.setLineDash([3, 3]);
      seg(a0, snap(dLo), a1, snap(dLo)); seg(a0, snap(dHi), a1, snap(dHi));
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.line; const fb = box(snap(a0), snap(dMin), snap(a1) - 1, snap(dMax) - 1); ctx.strokeRect(fb.x, fb.y, fb.w, fb.h);
    }
  }
  // per timeframe: what the bar in progress has touched so far, as a slim bar at the cell's first edge (the lanes
  // begin after it); then the line of the current price over all of them
  function drawBars(k) {
    const { g, ctx, C, F, T, D, snap, pt, box, fill, seg } = k;
    for (const x of cur.det.tfs) {
      if (!x.bars.n || x.base.assumed || !(x.base.c > 0)) continue;
      const lo = x.base.l / x.base.c - 1, hi = x.base.h / x.base.c - 1, a = g.cell(x.j) + 1.5;
      ctx.fillStyle = C.muted; ctx.globalAlpha = 0.3; fill(box(a, D(lo), a + 2, D(hi)));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.fg; ctx.lineWidth = 1.25; seg(g.a0 - 4, snap(g.dc), g.a1 + 4, snap(g.dc)); ctx.lineWidth = 1;
    // a timeframe without a confirmed bar says so on the line
    ctx.font = F.s(500, 9.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const x of cur.det.tfs) {
      if (x.bars.n) continue;
      const lines = T ? ['확정 봉 없음'] : ['확정 봉', '없음'], [cx, cy] = pt(g.cell(x.j) + g.cs / 2, g.dc);
      const w = Math.max(...lines.map((s) => ctx.measureText(s).width)) + 6, h = lines.length * 12 + 2;
      ctx.fillStyle = C.surface; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.fillStyle = C.faint; lines.forEach((s, i) => ctx.fillText(s, cx, cy + (i - (lines.length - 1) / 2) * 12 + 0.5));
    }
  }
  // The marks. Returns their placements (by mark id): lane, where p and q are, the box of the chip, bar, dot or arrow.
  function drawMarks(k) {
    const { g, ctx, C, F, T, sgn, D, edge, snap, pt, box, fill, seg, round, hit, dark, dLo, dHi } = k;
    const P = marks.map((m) => {
      const f = m.fire, L = g.lane(m.j, m.lane), hasQ = !f.now && f.q !== f.p;
      return { m, L, col: k.ink(m), off: !f.now && Math.abs(f.pct) > g.R,
        out: sgn * (f.now ? m.d : Math.sign(f.pct)),                            // away from the current price (a dot: the side of its signal)
        dP: f.now ? g.dc : D(f.pct), dQ: D(f.qpct), hasQ, qTick: hasQ && f.qpct !== 0 && Math.abs(f.qpct) <= g.R,
        a: m.rep ? 0.6 : 1 };                                                   // a repeated 9 is lighter
    });
    const taken = [box(g.a0, g.dc - 1.5, g.a1, g.dc + 1.5)];   // what the chips of dots and the texts keep clear of: the line of the current price, then every mark
    ctx.font = F.m(700, CHIP_PX);
    const CW = { 13: Math.ceil(ctx.measureText('13').width) + 6, 9: Math.ceil(ctx.measureText('9').width) + 7 };
    const AX = T ? 'y' : 'x', LEN = T ? 'h' : 'w';              // a box along the timeframes
    // the chip of mark p with its middle at d on the distance axis and at a along the timeframes (its lane's middle
    // unless given), held inside the cell of its timeframe
    const chipBox = (p, d, a = p.L.mid) => {
      const w = CW[markText(p.m)], across = T ? CHIP_H : w, c0 = g.cell(p.m.j), c1 = c0 + g.cs;
      const [cx, cy] = pt(Math.max(c0 + across / 2, Math.min(c1 - across / 2, a)), d);
      return { x: Math.round(cx - w / 2), y: Math.round(cy - CHIP_H / 2), w, h: CHIP_H };
    };
    // level 0: beyond the 임박 threshold, 1: within it, 2: met as things are
    const drawChip = (b, p, level) => {
      const m = p.m, lw = !m.is13 ? (level ? 1.5 : 1) : level ? 2 : 1.25;
      ctx.globalAlpha = 1; ctx.fillStyle = C.surface; round(b, 3.5); ctx.fill();
      ctx.globalAlpha = p.a * (m.is13 ? [0.14, 0.26, 0.4][level] : level === 2 ? 0.22 : 0);
      if (ctx.globalAlpha > 0) { ctx.fillStyle = p.col; round(b, 3.5); ctx.fill(); }
      ctx.globalAlpha = p.a; ctx.strokeStyle = p.col; ctx.lineWidth = lw;
      if (!m.is13) ctx.setLineDash([2.5, 1.5]);
      round({ x: b.x + lw / 2, y: b.y + lw / 2, w: b.w - lw, h: b.h - lw }, 3.5 - lw / 2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.fillStyle = m.is13 ? C.fg : C['setup-ink']; ctx.font = F.m(700, CHIP_PX); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(markText(m), b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      ctx.globalAlpha = 1;
    };
    // Where each mark inside the range goes, nearest first: a chip at its price in its lane; with the chip of its own
    // family and side when that stands at the same spot (the chip then counts them); beside a chip that is in the
    // way, on the side of its own lane (that chip moves over when the cell has no room otherwise); else a short bar in
    // its lane. Beyond the range: an arrow at the edge.
    const chips = [], outside = new Map();
    const place = (p) => {
      const b = chipBox(p, p.dP), there = chips.find((c) => overlaps(grown(b, 0.5), c.b));
      if (!there) return b;
      const m = p.m, o = there.p.m;
      if (o.j === m.j && o.lane === m.lane && o.d === m.d && Math.abs(p.dP - there.p.dP) <= 4.5) { there.n++; p.host = there.p; return there.b; }
      const size = b[LEN], c0 = g.cell(m.j), c1 = c0 + g.cs, after = m.lane >= o.lane;
      let at = there.b[AX];                                     // where the chip in the way would have to stand
      const need = after ? at + there.b[LEN] + 1 + size - c1 : c0 - (at - 1 - size);
      if (need > 0.01) at += (after ? -1 : 1) * Math.ceil(need - 0.01);
      const moved = { ...there.b, [AX]: at };
      if (at < c0 - 0.5 || at + moved[LEN] > c1 + 0.5 || chips.some((c) => c !== there && overlaps(grown(moved, 0.5), c.b))) return null;
      const b2 = chipBox(p, p.dP, after ? at + moved[LEN] + 1 + size / 2 : at - 1 - size / 2);
      if (overlaps(grown(b2, 0.5), moved) || chips.some((c) => c !== there && overlaps(grown(b2, 0.5), c.b))) return null;
      there.b[AX] = at;
      return b2;
    };
    for (const p of P) {
      const m = p.m;
      if (m.fire.now) continue;
      if (p.off) {
        const s = Math.sign(m.fire.pct), key = `${m.j}|${s}`;
        p.box = box(p.L.a0, edge(s) - p.out * 9, p.L.a1, edge(s));
        if (!outside.has(key)) outside.set(key, []);
        outside.get(key).push(p);
        continue;
      }
      const b = place(p);
      if (!b) p.small = true; else { p.box = b; if (!p.host) chips.push({ p, b, n: 1 }); }
    }
    // the close level: a thin line from p back towards the current price and a tick where it ends
    const stems = [];
    ctx.lineCap = 'butt';
    for (const p of P) {
      if (!p.hasQ) continue;
      const a = snap((p.box && !p.off && !p.small ? p.box[AX] + p.box[LEN] / 2 : p.L.mid) - 0.5);
      ctx.strokeStyle = p.col; ctx.globalAlpha = p.m.near ? 0.75 : dark ? 0.6 : 0.5; ctx.lineWidth = 1;
      seg(a, p.dP, a, p.dQ);
      stems.push(box(a - 1, p.dP, a + 1, p.dQ));
      if (p.qTick) {
        const w = Math.max(3, p.L.size * 0.4);
        ctx.globalAlpha = 1; ctx.lineWidth = 1.5; seg(a - w, snap(p.dQ), a + w, snap(p.dQ));
        p.qbox = box(a - w, p.dQ - 0.75, a + w, p.dQ + 0.75);
        taken.push(grown(p.qbox, 1));   // no text goes over the tick of a close level
        hit(p.m.id, box(a - Math.max(w, p.L.size / 2), p.dQ - 1, a + Math.max(w, p.L.size / 2), p.dQ + 1), T ? 3 : 0, T ? 0 : 3);
      }
    }
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
    for (const p of P) {
      if (!p.off) continue;
      const e = edge(Math.sign(p.m.fire.pct)), w = Math.min(4.2, p.L.size * 0.45);
      ctx.fillStyle = p.col; ctx.globalAlpha = p.a;
      ctx.beginPath(); ctx.moveTo(...pt(p.L.mid, e - p.out)); ctx.lineTo(...pt(p.L.mid - w, e - p.out * 8)); ctx.lineTo(...pt(p.L.mid + w, e - p.out * 8)); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      hit(p.m.id, p.box, 1, 1);
    }
    for (const p of P) {
      if (!p.small) continue;
      const th = p.m.is13 ? 4 : 2, b = box(p.L.a0 + 0.5, p.dP - th / 2, p.L.a1 - 0.5, p.dP + th / 2);
      ctx.globalAlpha = p.a; ctx.fillStyle = p.col; fill(b); ctx.globalAlpha = 1;
      p.box = b; taken.push(grown(b, 1));
      hit(p.m.id, box(p.L.a0, p.dP - 1, p.L.a1, p.dP + 1), T ? 4 : 0.5, T ? 0.5 : 4);
    }
    for (const c of chips) { drawChip(c.b, c.p, c.p.m.near ? 1 : 0); taken.push(grown(c.b, 1)); }
    for (const p of P) if (p.box && !p.small && !p.off && !p.m.fire.now) hit(p.m.id, p.box, 2, 2);
    // What is met as things are: one dot on the line of the current price per timeframe, lane and side, and next to
    // it, on the side of its signal, the chip where there is room.
    const nows = new Map();
    for (const p of P) { if (!p.m.fire.now) continue; const key = `${p.m.j}|${p.m.lane}|${p.m.d}`; if (!nows.has(key)) nows.set(key, []); nows.get(key).push(p); }
    for (const list of nows.values()) {
      const p = list[0], [cx, cy] = pt(p.L.mid, g.dc + 0.5), r = Math.min(p.m.is13 ? 4.5 : 3.5, p.L.size * 0.5);
      ctx.globalAlpha = 1; ctx.fillStyle = C.surface; ctx.beginPath(); ctx.arc(cx, cy, r + 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = p.a; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      const dot = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
      taken.push(grown(dot, 1));
      for (const q of list) { q.box = dot; hit(q.m.id, dot, 3, 3); }
    }
    for (const list of nows.values()) {
      const p = list[0], r = p.box.w / 2, b = chipBox(p, g.dc + 0.5 + p.out * (r + 2.5 + (T ? CW[markText(p.m)] : CHIP_H) / 2));
      if (taken.some((t) => overlaps(b, t))) continue;   // no room (its own dot ends before the chip begins)
      drawChip(b, p, 2); taken.push(grown(b, 1));
      for (const q of list) { q.tag = b; hit(q.m.id, b, 1, 1); }
    }
    // a text next to its anchor, on the first of the given sides (1 = towards larger d) that is free and inside the
    // range; lim = [from, to]: where the text has to stay along the timeframes. With `across` (the picture turned,
    // where a text beside its chip may run into a close tick) it may also stand under or over the anchor in its row.
    const put = (txt, font, h, anchor, sides, gap, color, alpha, id, lim, across) => {
      ctx.font = font;
      const w = ctx.measureText(txt).width, cx = anchor.x + anchor.w / 2, cy = anchor.y + anchor.h / 2;
      const places = sides.map((o) => (T ? { x: o > 0 ? anchor.x + anchor.w + gap : anchor.x - gap - w, y: cy - h / 2, w, h } : { x: cx - w / 2, y: o > 0 ? anchor.y + anchor.h + gap : anchor.y - gap - h, w, h }));
      if (across && T && lim) {
        const x = Math.max(dLo + 1, Math.min(dHi - 1 - w, cx - w / 2));
        for (const y of [anchor.y + anchor.h + 1.5, anchor.y - 1.5 - h]) if (y >= lim[0] && y + h <= lim[1]) places.push({ x, y, w, h });
      }
      for (const b of places) {
        if (lim && !T) b.x = Math.max(lim[0], Math.min(lim[1] - w, b.x));
        const lo = T ? b.x : b.y, hi = T ? b.x + b.w : b.y + b.h;
        if (lo < dLo + 1 || hi > dHi - 1 || taken.some((t) => overlaps(b, t))) continue;
        taken.push({ x: b.x - 0.5, y: b.y - 0.5, w: b.w + 1, h: b.h + 1 });
        if (stems.some((s) => overlaps(b, s))) { ctx.globalAlpha = 1; ctx.fillStyle = C.surface; ctx.fillRect(b.x - 1.5, b.y - 1, b.w + 3, b.h + 2); }   // a text on a thin line gets a ground
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, b.x, b.y + b.h / 2 + 0.5);
        ctx.globalAlpha = 1;
        if (id != null) hit(id, b, 1, 1);
        return true;
      }
      return false;
    };
    const cellLim = (m) => [g.cell(m.j) + (T ? 0.5 : 2), g.cell(m.j) + g.cs - (T ? 0.5 : 2)];
    const inkText = (p) => (p.m.is13 ? p.col : C['setup-ink']);
    // the distance of each chip: away from the current price, or on the other side when that place is taken (nearest
    // marks choose first)
    for (const c of chips) {
      const p = c.p, m = p.m;
      if (put(fmtPct(m.fire.pct), F.m(m.near ? 700 : 600, 9), 8, c.b, [p.out, -p.out], 2, inkText(p), p.a, m.id, cellLim(m), true)) p.note = fmtPct(m.fire.pct);
    }
    // a chip that stands for several marks says how many ("×2"), on its other side; the hint under the picture
    // explains it then
    g.times = false;
    for (const c of chips) if (c.n > 1 && put(`×${c.n}`, F.m(700, 9), 8, c.b, [-c.p.out, c.p.out], 2, inkText(c.p), c.p.a, c.p.m.id, cellLim(c.p.m))) { g.times = true; c.p.times = c.n; }
    for (const list of nows.values()) { const p = list[0]; if (p.tag && list.length > 1 && put(`×${list.length}`, F.m(700, 9), 8, p.tag, [p.out], 2, inkText(p), p.a, p.m.id, cellLim(p.m))) { g.times = true; p.times = list.length; } }
    // a short bar gets its number when there is room
    for (const p of P) if (p.small) put(markText(p.m), F.m(700, 9.5), 8, p.box, [p.out, -p.out], 2.5, inkText(p), p.a, p.m.id, cellLim(p.m));
    // "종" at the tick of a close level, on the side of the current price when there is room
    for (const p of P) if (p.qbox) put('종', F.s(600, T ? 9 : 10), T ? 9.5 : 10.5, p.qbox, [-p.out, p.out], 2, p.col, 1, p.m.id);
    // beyond the range: the distances in the strip. Columns: nearest next to the range; turned: in the order of the lanes
    const room = T ? Math.floor((g.cs - 2) / 10) : Math.floor((g.strip - 3) / 10.5);
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const list of outside.values()) {
      const far = (p) => Math.abs(p.m.fire.pct), o = list[0].out, e = edge(Math.sign(list[0].m.fire.pct)), a = g.cell(list[0].m.j);
      list.sort((p, q) => (T ? p.m.lane - q.m.lane : 0) || far(p) - far(q));
      const shown = list.length > room ? list.slice(0, room - 1) : list, rows = shown.length + (list.length > shown.length ? 1 : 0);
      for (let i = 0; i < rows; i++) {
        const p = shown[i] || null, txt = p ? fmtPct(p.m.fire.pct) : `외 ${list.length - shown.length}개`;
        ctx.font = p ? F.m(600, 9) : F.s(500, 9);
        const w = ctx.measureText(txt).width;
        const x = T ? (o > 0 ? e + 4 : e - 4 - w) : a + g.cs / 2 - w / 2, y = T ? a + g.cs / 2 + (i - (rows - 1) / 2) * 10 : e + o * (8 + i * 10.5);
        ctx.fillStyle = !p ? C.muted : inkText(p);
        ctx.fillText(txt, x, y + 0.5);
        if (p) { p.tbox = { x, y: y - 5, w, h: 10 }; p.note = txt; hit(p.m.id, p.tbox, 2, 0.5); }
      }
    }
    return P;
  }
  // Axis labels: the distance before the cells (left, or above when turned), the price after them (right / below).
  function drawAxes(k) {
    const { g, ctx, C, F, T, D, round, dLo, dHi } = k;
    // of the candidates, in the order of their rank, those that do not run into one already placed
    const place = (cands, size) => { const out = []; for (const c of cands.slice().sort((p, q) => p.rank - q.rank)) { const h = size(c) / 2 + (T ? 3 : 1); if (out.every((o) => Math.abs(o.d - c.d) >= h + o.h)) out.push({ ...c, h }); } return out; };
    const pctC = [], priC = [];
    for (const t of g.ticks) for (const s of [-1, 1]) {
      const rank = 1 + TICK_RANK.indexOf(t);
      pctC.push({ d: D(s * t), text: tickPct(s * t), rank }); priC.push({ d: D(s * t), text: axisPrice(g.c0 * (1 + s * t)), rank });
    }
    if (!g.ticks.some((t) => Math.abs(t - g.R) < 1e-9)) for (const s of [-1, 1]) { pctC.push({ d: D(s * g.R), text: tickPct(s * g.R), rank: 9 }); priC.push({ d: D(s * g.R), text: axisPrice(g.c0 * (1 + s * g.R)), rank: 9 }); }
    if (!T) {
      ctx.textBaseline = 'middle';
      pctC.push({ d: g.dc, text: '현재가', rank: 0, own: true });
      priC.push({ d: g.dc, text: fmtPrice(g.c0), rank: 0, own: true }, { d: g.dc + 17, text: '최근 종가', rank: 0.5, cap: true });
      ctx.textAlign = 'right';
      for (const c of place(pctC, () => 11)) {
        if (c.own) { ctx.font = F.s(600, 10.5); ctx.fillStyle = C.fg; } else { ctx.font = F.m(500, 10.5); ctx.fillStyle = C.muted; }
        ctx.fillText(c.text, g.a0 - 7, c.d + 0.5);
      }
      ctx.textAlign = 'left';
      for (const c of place(priC, (c) => (c.own ? 16 : 11))) {
        if (c.own) {   // the current price as a tag
          ctx.font = F.m(600, 10.5); const w = ctx.measureText(c.text).width + 10;
          ctx.fillStyle = C.fg; round({ x: g.a1 + 4, y: c.d - 8, w, h: 16 }, 3); ctx.fill();
          ctx.fillStyle = C.surface; ctx.fillText(c.text, g.a1 + 9, c.d + 0.5);
        } else { ctx.font = c.cap ? F.s(500, 9.5) : F.m(500, 10.5); ctx.fillStyle = C.muted; ctx.fillText(c.text, g.a1 + 7, c.d + 0.5); }
      }
      // the strips: which side they belong to and what they hold; the last row: when each bar closes
      ctx.textAlign = 'right';
      ctx.font = F.s(600, 10.5); ctx.fillStyle = C.muted;
      ctx.fillText('▲ 매도 쪽', g.a0 - 7, dLo - g.strip / 2 - 6); ctx.fillText('▼ 매수 쪽', g.a0 - 7, dHi + g.strip / 2 + 7);
      ctx.font = F.s(500, 9.5); ctx.fillStyle = C.faint;
      ctx.fillText('범위 밖', g.a0 - 7, dLo - g.strip / 2 + 7.5); ctx.fillText('범위 밖', g.a0 - 7, dHi + g.strip / 2 - 6.5);
      ctx.fillText('봉 마감', g.a0 - 7, g.H - g.trail / 2 + 1);
    } else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = F.m(500, 9.5);
      pctC.push({ d: g.dc, text: '0%', rank: 0 }, { d: dLo - g.strip / 2, text: '범위 밖', rank: 0.1, cap: true }, { d: dHi + g.strip / 2, text: '범위 밖', rank: 0.1, cap: true });
      for (const c of place(pctC, (c) => (c.cap ? g.strip : ctx.measureText(c.text).width))) {
        if (c.cap) { ctx.font = F.s(500, 9); ctx.fillStyle = C.faint; } else { ctx.font = F.m(500, 9.5); ctx.fillStyle = C.muted; }
        ctx.fillText(c.text, c.d, g.a0 - 5);
      }
      ctx.textBaseline = 'top'; ctx.font = F.m(500, 9.5);
      priC.push({ d: g.dc, text: fmtPrice(g.c0), rank: 0, own: true });
      for (const c of place(priC, (c) => ctx.measureText(c.text).width + (c.own ? 4 : 0))) {
        if (c.own) { ctx.font = F.m(600, 9.5); ctx.fillStyle = C.fg; } else { ctx.font = F.m(500, 9.5); ctx.fillStyle = C.muted; }
        ctx.fillText(c.text, c.d, g.a1 + 6);
      }
      ctx.textBaseline = 'middle'; ctx.font = F.s(600, 10.5); ctx.fillStyle = C.muted;
      ctx.textAlign = 'left'; ctx.fillText('◀ 매수 쪽', g.lead, 9.5);
      ctx.textAlign = 'right'; ctx.fillText('매도 쪽 ▶', g.W - g.trail, 9.5);
      ctx.textAlign = 'center'; ctx.fillStyle = C.fg; ctx.fillText('현재가', g.dc, 9.5);
    }
  }
  // timeframe names: strong where the timeframe has a mark, faint where it has no confirmed bar; columns also get the
  // day their bar closes
  function drawNames(k, am) {
    const { g, ctx, C, F, T } = k, has = new Set(marks.map((m) => m.j));
    ctx.textBaseline = 'middle';
    for (const x of cur.det.tfs) {
      const mid = g.cell(x.j) + g.cs / 2, on = !!am && am.j === x.j, strong = on || has.has(x.j);
      ctx.fillStyle = on ? C.accent : !x.bars.n ? C.faint : strong ? C.fg : C.muted;
      ctx.font = F.m(strong ? 600 : 500, T ? 10.5 : 11);
      if (T) { ctx.textAlign = 'right'; ctx.fillText(x.tf, g.lead - 5, mid + 0.5); continue; }
      ctx.textAlign = 'center'; ctx.fillText(x.tf, mid, g.lead / 2 + 0.5);
      const cd = x.bars.n ? closeDay(x) : null;
      if (cd == null) continue;
      ctx.font = F.m(on ? 600 : 500, 9.5); if (!on) ctx.fillStyle = strong ? C.muted : C.faint;
      ctx.fillText(iso(cd).slice(5), mid, g.H - g.trail / 2 + 1);
    }
  }
  // the mark under the pointer or of the focused row: a ring, and for a rung a line across the picture with its
  // distance and its price on the axes
  function drawActive(k, p) {
    const { g, ctx, C, F, T, seg, round, snap } = k, f = p.m.fire;
    const tag = (text, d, side, strong) => {   // side -1: on the distance axis, 1: on the price axis
      ctx.font = F.m(600, 10.5);
      const w = ctx.measureText(text).width + 10, h = 16;
      const x = T ? Math.max(1, Math.min(g.W - w - 1, d - w / 2)) : side < 0 ? g.a0 - w - 3 : Math.min(g.a1 + 4, g.W - w - 1);
      const y = T ? (side < 0 ? g.a0 - h - 1 : g.a1 + 2) : d - h / 2;
      ctx.fillStyle = C.surface; round({ x, y, w, h }, 3); ctx.fill();
      ctx.strokeStyle = p.col; ctx.lineWidth = strong ? 1.5 : 1; round({ x: x + 0.5, y: y + 0.5, w: w - 1, h: h - 1 }, 3); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = C.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 5, y + h / 2 + 0.5);
    };
    const ring = (b, r) => { ctx.strokeStyle = C.fg; ctx.lineWidth = 1.5; round({ x: b.x - 2.5, y: b.y - 2.5, w: b.w + 5, h: b.h + 5 }, r); ctx.stroke(); ctx.lineWidth = 1; };
    if (f.now) { ring(p.box, 8); if (p.tag) ring(p.tag, 5); return; }
    if (p.off) {
      ring(p.box, 3);
      if (p.tbox) { ctx.strokeStyle = p.col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.tbox.x, p.tbox.y + p.tbox.h + 1.5); ctx.lineTo(p.tbox.x + p.tbox.w, p.tbox.y + p.tbox.h + 1.5); ctx.stroke(); ctx.lineWidth = 1; }
      return;
    }
    // a line across the picture at the mark's price, left open where the mark stands
    const b0 = T ? p.box.y : p.box.x, b1 = b0 + (T ? p.box.h : p.box.w);
    ctx.strokeStyle = p.col; ctx.globalAlpha = 0.9; ctx.setLineDash([4, 3]);
    seg(g.a0, snap(p.dP), Math.max(g.a0, b0 - 4), snap(p.dP)); seg(Math.min(g.a1, b1 + 4), snap(p.dP), g.a1, snap(p.dP));
    if (p.qTick) { ctx.globalAlpha = 0.6; ctx.setLineDash([1.5, 3]); seg(g.a0, snap(p.dQ), g.a1, snap(p.dQ)); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ring(p.box, p.small ? 3 : 5);
    if (!T && p.qTick && Math.abs(p.dQ - p.dP) >= 17 && Math.abs(p.dQ - g.dc) >= 17) tag(fmtPrice(f.q), p.dQ, 1, false);
    tag(fmtPct(f.pct), p.dP, -1, true); tag(fmtPrice(f.p), p.dP, 1, true);
  }
  function ariaText() {
    const now = marks.filter((m) => m.fire.now).length, near = marks.filter((m) => m.near).length;
    return `${cur.c.s} 가격 사다리. 조건가 ${marks.length}개, 지금 값으로 충족 ${now}개, 임박 ${near}개. 값은 조건가 목록에 있습니다.`;
  }

  // ---------- highlight: picture and list show the same mark ----------
  // hoverId: the mark under the mouse (in the picture, the list or the summary); focusId: the mark of the focused row
  function syncActive(reveal) {
    const id = activeId();
    for (const li of ui.rows.querySelectorAll('.blb-row')) li.classList.toggle('blb-on', Number(li.dataset.id) === id);
    for (const b of ui.sum.querySelectorAll('.blb-go')) b.classList.toggle('blb-on', Number(b.dataset.id) === id);
    if (reveal && id != null) revealRow(id);
    schedule();
  }
  function setHover(id, reveal) { if (id !== hoverId) { hoverId = id; syncActive(reveal); } }
  const rowOf = (id) => ui.rows.querySelector(`.blb-row[data-id="${id}"]`);
  // bring a row into view inside the list's own scroll box (the page stays where it is)
  function revealRow(id) {
    const li = rowOf(id), sc = ui.rows;
    if (!li || sc.scrollHeight <= sc.clientHeight + 1) return;
    const r = li.getBoundingClientRect(), s = sc.getBoundingClientRect(), head = li.closest('.blb-sec').querySelector('.blb-grp'), hh = head ? head.offsetHeight : 0;   // the sticky heading covers the top
    if (r.top < s.top + hh) sc.scrollTop += r.top - s.top - hh; else if (r.bottom > s.bottom) sc.scrollTop += r.bottom - s.bottom;
  }
  // the row of a mark takes the focus: from a click in the picture (the page stays) or from the summary (the page
  // moves to the row when it is out of sight)
  function focusRow(id, movePage) {
    const li = rowOf(id); if (!li) return;
    li.focus({ preventScroll: true });
    revealRow(id);
    if (movePage) li.scrollIntoView({ block: 'nearest' });
  }
  // the marks at a point of the picture, nearest first; slack: how far outside a mark's box still counts (a finger
  // is less exact than a mouse)
  function hitsAt(x, y, slack = 0) {
    if (!geo) return [];
    const found = new Map();
    for (const h of geo.hits) {
      const out = Math.hypot(Math.max(h.x - x, 0, x - h.x - h.w), Math.max(h.y - y, 0, y - h.y - h.h));
      if (out > slack) continue;
      const rank = out * 1000 + Math.hypot(x - (h.x + h.w / 2), y - (h.y + h.h / 2));   // inside before near, then by the middle of the box
      if (!found.has(h.id) || rank < found.get(h.id)) found.set(h.id, rank);
    }
    return [...found.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  }
  function wire() {
    const cv = ui.cv;
    const at = (e) => { const r = cv.getBoundingClientRect(); return hitsAt(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch' ? 14 : 0); };
    const tipAt = (e, ids) => { if (ids.length) BE.tip.show(e.clientX, e.clientY, tipNodes(ids)); else BE.tip.hide(); };
    // mouse and pen: the mark under the pointer; touch: a tap shows the tooltip and, with the click that follows,
    // moves the focus to the mark's row
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const ids = at(e);
      cv.style.cursor = ids.length ? 'pointer' : 'default';
      tipAt(e, ids); setHover(ids.length ? ids[0] : null, true);
    });
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { BE.tip.hide(); setHover(null, false); } });
    cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') tipAt(e, at(e)); });
    cv.addEventListener('click', (e) => { const ids = at(e); if (ids.length) focusRow(ids[0], false); });
    const rowId = (t) => { const li = t && t.closest ? t.closest('.blb-row') : null; return li && ui.rows.contains(li) ? Number(li.dataset.id) : null; };
    ui.rows.addEventListener('mouseover', (e) => setHover(rowId(e.target), false));
    ui.rows.addEventListener('mouseleave', () => setHover(null, false));
    ui.rows.addEventListener('focusin', (e) => {
      const id = rowId(e.target); if (id == null) return;
      focusId = id;
      for (const r of ui.rows.querySelectorAll('.blb-row')) r.tabIndex = Number(r.dataset.id) === id ? 0 : -1;   // one tab stop: the row last focused
      syncActive(false);
    });
    ui.rows.addEventListener('focusout', (e) => { if (rowId(e.relatedTarget) == null) { focusId = null; syncActive(false); } });
    ui.rows.addEventListener('keydown', (e) => {
      const li = e.target.closest && e.target.closest('.blb-row'); if (!li || e.target !== li) return;
      const all = [...ui.rows.querySelectorAll('.blb-row')], i = all.indexOf(li);
      const to = e.key === 'ArrowDown' ? all[i + 1] : e.key === 'ArrowUp' ? all[i - 1] : e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : null;
      if (to) { e.preventDefault(); to.focus(); return; }
      if (e.key === 'Enter') { const a = li.querySelector('a'); if (a) { e.preventDefault(); a.click(); } }
    });
    const goId = (t) => { const b = t && t.closest ? t.closest('.blb-go') : null; return b ? Number(b.dataset.id) : null; };
    ui.sum.addEventListener('click', (e) => { const id = goId(e.target); if (id != null) focusRow(id, true); });
    ui.sum.addEventListener('mouseover', (e) => setHover(goId(e.target), false));
    ui.sum.addEventListener('mouseleave', () => setHover(null, false));
    ui.sum.addEventListener('focusin', (e) => setHover(goId(e.target), false));
    ui.sum.addEventListener('focusout', () => setHover(null, false));
  }

  // ---------- states ----------
  function show(mode) { ui.sum.hidden = mode !== 'ready'; ui.cvw.hidden = mode !== 'ready'; ui.wait.hidden = mode === 'ready'; }
  // marks, summary, list and picture from the coin's detail and the settings
  function rebuild() {
    if (!cur) return;
    collect(); hoverId = focusId = null; BE.tip.hide();
    show('ready'); ui.chart.style.minHeight = '';
    delete ui.sum.dataset.turned;   // the summary is filled with the layout (redraw)
    fillList();
    ui.quiet.hidden = marks.length > 0; ui.quiet.textContent = marks.length ? '' : emptyText();
    redraw(); fillFoot();
  }
  // With the timeframes as columns the picture is as tall as the window allows: lay it out again when only the
  // window's height has changed.
  function onWindowResize() {
    clearTimeout(tallTimer);
    tallTimer = setTimeout(() => { if (root && cur && geo && !geo.turned && window.innerHeight !== seenH) { redraw(); fillFoot(); } }, 180);
  }
  function redraw() {
    if (!cur) return;
    seenH = window.innerHeight;
    layout(); draw();
    ui.list.style.height = geo.wide ? `${ui.chart.offsetHeight}px` : '';   // next to the picture the list is as tall as it and scrolls inside
  }
  function load() {
    const c = BE.coin(), my = ++token;
    cur = null; geo = null; marks = []; hoverId = focusId = null; BE.tip.hide();
    if (!ui.cvw.hidden) ui.chart.style.minHeight = `${ui.chart.offsetHeight}px`;   // the panel keeps its room while the next coin loads
    show('wait'); ui.wait.replaceChildren(document.createTextNode('불러오는 중입니다…'));
    ui.rows.replaceChildren(); ui.cnt.textContent = ''; ui.foot.replaceChildren();
    BE.detail(c).then((det) => {
      if (my !== token || !root) return;   // another coin was chosen meanwhile, or the variant was left
      cur = { c, det }; rebuild();
    }, (err) => {
      if (my !== token || !root) return;
      const noData = !c || !c.usd || !c.t, text = err && err.message ? err.message : String(err);
      const msg = noData ? `${text}.` : err && err.stale ? '이 화면을 연 뒤에 새 데이터가 배포되었습니다. 새로고침하면 최신 데이터로 다시 엽니다.' : `일봉 데이터를 불러오지 못했습니다 (${text}).`;
      ui.wait.replaceChildren(el('p', null, msg));
      if (!noData) { const b = el('button', 'btn', err && err.stale ? '새로고침' : '다시 시도'); b.type = 'button'; b.addEventListener('click', () => (err && err.stale ? location.reload() : load())); ui.wait.append(b); }
    });
  }

  BE.register({
    view: 'ladder', key: 'b', name: '가격 사다리',
    blurb: '진행 중인 봉이 어느 가격까지 가면 9나 13이 나오는지를 20개 타임프레임에 걸쳐 한 장에 그립니다. 가운데 선이 현재가이고, 그보다 높은 쪽은 가격이 올라야 나오는 매도 쪽 신호, 낮은 쪽은 내려야 나오는 매수 쪽 신호입니다. 가운데 선에 가까운 표시일수록 가격이 조금만 움직여도 나오는 신호입니다.',
    good: ['가격이 움직이면 어떤 신호가 먼저 나오는지 바로 보임', '조건가를 정확한 숫자로 확인', '저가(고가) 조건과 종가 조건을 나누어 표시'],
    weak: ['다음 봉에 나올 수 있는 신호만 표시됨', '카운트다운의 진행 정도는 보이지 않음', '조건이 없는 타임프레임은 빈칸으로 남음'],
    mount(node) {
      root = node; addCss();
      S = BE.vstate(ID, { range: 25, show: 'all', near: 5 });
      if (!RANGES.includes(S.range)) S.range = 25;
      if (!NEARS.includes(S.near)) S.near = 5;
      if (S.show !== 'all' && S.show !== '13') S.show = 'all';
      const ctl = el('div', 'panel controls blb-ctl'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', '가격 사다리 설정');
      ctl.append(
        BE.seg('범위', RANGES.map((r) => [r, `±${r}%`]), () => S.range, (v) => { S.range = v; BE.save(); if (cur) { redraw(); fillFoot(); } }),
        BE.seg('표시', [['all', '9와 13'], ['13', '13만']], () => S.show, (v) => { S.show = v; BE.save(); rebuild(); }),
        BE.seg('임박 기준', NEARS.map((x) => [x, `${x}%`]), () => S.near, (v) => { S.near = v; BE.save(); rebuild(); }));
      const main = el('div', 'blb-main');
      const chart = el('section', 'panel blb-chart'); chart.setAttribute('aria-label', '가격 사다리 그림');
      const sum = el('div', 'blb-sum'), cvw = el('div', 'blb-cvw'), cv = el('canvas', 'blb-cv'), quiet = el('p', 'blb-quiet'), wait = el('div', 'loading blb-wait');
      cv.setAttribute('role', 'img'); quiet.hidden = true;
      cvw.append(quiet, cv); chart.append(sum, cvw, wait);
      const list = el('section', 'panel blb-list'); list.setAttribute('aria-label', '조건가 목록');
      const lh = el('div', 'blb-lh'), cnt = el('span', 'blb-cnt'), rows = el('div', 'blb-rows');
      lh.append(el('h2', null, '조건가 목록'), cnt); list.append(lh, rows);
      main.append(chart, list);
      const foot = el('div', 'panel blb-foot');
      root.append(ctl, main, foot);
      ui = { main, chart, sum, cvw, cv, quiet, wait, list, cnt, rows, foot };
      show('wait');
      wire();
      addEventListener('resize', onWindowResize);
    },
    render(why) {
      if (!root) return;
      if (why === 'resize') { if (cur) { redraw(); fillFoot(); } return; }
      if (why === 'theme' || why === 'fam') { rebuild(); return; }   // the chips of the list carry the theme's colors
      load();
    },
    unmount() {
      removeEventListener('resize', onWindowResize); clearTimeout(tallTimer);
      token++; if (raf) cancelAnimationFrame(raf); raf = 0;
      BE.tip.hide(); root = null; ui = null; cur = null; geo = null; marks = [];
    },
  });
})();
