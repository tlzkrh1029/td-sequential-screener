// Bird eye study, sheet view, variant A: 격자 시트.
// One coin, every timeframe as a small candle chart on one sheet, with the v6 labels where the indicator draws them
// and the prices at which the next 9 or 13 appears (조건가) as dashed lines. Everything comes from BE.detail(coin):
// bars, labels, active countdowns and next-bar triggers with VIEW.fire; nothing is counted here.
(() => {
  const ID = 'sheet-a';
  const { TFS, OPT, BUY, SELL, SIDE, ARROW, FAM_NAME, FAM_CODE, FAM_COLOR, SETUP_COLOR, C } = BE;
  const { el, esc, iso, fmtPrice, fmtPct } = BE;
  const SANS = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
  // label fonts scaled for a small panel (the indicator draws 9 and 13 'large' and +13 'tiny'), and for a panel shown large
  // (the last set is for a panel so full of labels that they do not fit otherwise)
  const labelFonts = (c, s, i) => ({ C: [`700 ${c}px ${SANS}`, c], S: [`600 ${s}px ${SANS}`, s], I: [`500 ${i}px ${SANS}`, i] });
  const LABEL_FONT = labelFonts(12, 10, 8), LABEL_FONT_BIG = labelFonts(14, 11.5, 9.5), LABEL_FONT_TIGHT = labelFonts(10, 8.5, 7);
  const PUSH = { C: Infinity, S: 4, I: 3 };   // how many text heights a label may move away from its place to stay readable
  const AXIS_FONT = `500 9px ${MONO}`, TAG_FONT = `500 9.5px ${MONO}`, TAG_FONT_NEAR = `600 9.5px ${MONO}`, NOTE_FONT = `12px ${SANS}`;
  const AXIS_H = 13;   // the date strip under the candles
  const TAG_H = 11;    // line height of the texts in the right margin
  const GAP = 8;       // grid gap, as in the CSS below

  // ---------- settings (kept by the shell) ----------
  const S = BE.vstate(ID, { bars: 60, tfs: 'all', scale: 'lin', labels: 'all', lines: 'on', near: 5 });
  const oneOf = (k, allowed, def) => { if (!allowed.includes(S[k])) S[k] = def; };
  oneOf('bars', [30, 60, 120], 60); oneOf('tfs', ['all', 'day', 'wm'], 'all'); oneOf('scale', ['lin', 'log'], 'lin');
  oneOf('labels', ['all', '13'], 'all'); oneOf('lines', ['on', 'off'], 'on'); oneOf('near', [3, 5, 10], 5);
  const DAY_TFS = TFS.filter((tf) => tf.endsWith('D')).length;
  const inGroup = (tf) => S.tfs === 'all' || (S.tfs === 'day') === tf.endsWith('D');
  // what the family toggles and the label setting leave on the sheet
  const labelOn = (L) => (L.kind === 'S' ? S.labels === 'all' && L.text.startsWith('9') : (L.kind === 'C' || L.kind === 'I') && BE.famOn(L.family));
  const trigOn = (t) => (t.k === 'C13' ? BE.famOn(t.f) : S.labels === 'all');
  const repeated9 = (L) => L.kind === 'S' && L.raw >= 18;

  const CSS = `
.gs-grid { display: grid; gap: ${GAP}px; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); min-width: 0; }
.gs-cell { position: relative; display: flex; flex-direction: column; min-width: 0; padding: 7px 8px 6px; overflow: hidden; cursor: zoom-in; scroll-margin: 64px 0 12px; }
.gs-cell.gs-zoom { cursor: zoom-out; }
.gs-cell::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px; pointer-events: none; }
.gs-cell.gs-hit::before { background: var(--gs-bar); }
.gs-cell.gs-now::before { height: 2px; background: repeating-linear-gradient(90deg, var(--gs-c) 0 6px, transparent 6px 11px); }
.gs-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; }
.gs-tf { font: 600 15px/18px var(--font-mono); }
.gs-meta { font: 11px/18px var(--font-mono); color: var(--muted); }
.gs-tv { margin-left: auto; font-size: 11px; line-height: 18px; text-decoration: none; white-space: nowrap; }
.gs-tv:hover { text-decoration: underline; }
.gs-state { display: flex; flex-wrap: wrap; align-content: flex-start; align-items: center; gap: 1px 10px; min-height: 35px; margin: 1px 0 3px; font-size: 11.5px; line-height: 17px; color: var(--muted); }
.gs-it { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.gs-w { display: inline-block; font: 600 11px/14px var(--font-mono); padding: 0 4px; border-radius: 4px; border: 1px solid var(--c); color: var(--fg); white-space: nowrap; }
.gs-w.gs-wn { background: var(--c); color: var(--i); }
.gs-sw { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 2px; background: var(--c); }
.gs-run { font: 500 11.5px/17px var(--font-mono); color: var(--fg); }
.gs-pct { font-family: var(--font-mono); font-weight: 500; color: var(--fg); }
.gs-ok { font-weight: 600; color: var(--fg); }
.gs-near { font-style: normal; font-weight: 600; font-size: 10.5px; line-height: 15px; padding: 0 5px; border-radius: 4px; background: var(--warn-bg); color: var(--warn-fg); }
.gs-rep { opacity: .55; display: inline-flex; }
.gs-plot { position: relative; flex: 0 0 var(--gs-h, 124px); margin-top: auto; border-radius: 4px; touch-action: pan-y; }
.gs-zoom .gs-plot { flex: 1 1 var(--gs-h, 124px); margin-top: 3px; }
.gs-zoom.gs-one .gs-plot { flex-basis: calc(var(--gs-h, 124px) * 1.9); }
.gs-plot canvas { position: absolute; left: 0; top: 0; display: block; }
.gs-plot:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.gs-wait { min-height: 220px; display: grid; place-content: center; justify-items: center; gap: 10px; }
.gs-foot { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.gs-foot .legend > span { white-space: normal; }
.gs-foot .legend i { display: inline-block; flex: none; }
.gs-lp { width: 20px; border-top: 2px dashed var(--f0); }
.gs-lq { width: 20px; border-top: 1px dotted var(--f0); }
.gs-lb { width: 7px; height: 12px; border: 1px solid var(--up); }
.gs-lh { width: 20px; height: 3px; background: var(--f0); }
.gs-ln { width: 20px; height: 2px; background: repeating-linear-gradient(90deg, var(--f0) 0 6px, transparent 6px 10px); }
.gs-lm { width: 12px; height: 12px; background: var(--accent-soft); border-left: 1px solid var(--accent); border-right: 1px solid var(--accent); }
`;

  let root = null, grid = null, wait = null, foot = null, fadeNote = null, cells = [];
  let cur = null;        // { c, det } of the coin on the sheet (det null while it loads)
  let zoomTf = null;     // the timeframe shown large, if any
  let hover = null;      // { cell, i, y, s, e, kb }: the bar under the pointer (or chosen with the arrow keys) and its days
  let ro = null, rafPaint = 0, rafSize = 0, touch = null, clickGuard = 0;

  // ---------- header of a panel ----------
  const nearest = (list) => { let best = null; for (const t of list) if (!best || (t.fire.now ? !best.fire.now : !best.fire.now && Math.abs(t.fire.pct) < Math.abs(best.fire.pct))) best = t; return best; };
  // the state line: labels on the last 4 confirmed bars, the countdown nearest to its 13, the running setup
  function headState(x) {
    const out = { html: '', hit: [], now: null };
    const b = x.bars, n = b.n, res = x.res;
    if (!res) { out.html = `<span>${b.partial ? '확정 봉이 아직 없어서 진행 중인 봉만 그렸습니다.' : '확정 봉이 아직 없습니다.'}</span>`; return out; }
    const parts = [], by = x.byBar();
    if (n < S.bars) parts.push(`<span class="gs-it">확정 봉 ${BE.nf(n)}개</span>`);
    for (let ago = 0; ago < 4 && ago < n; ago++) {
      const ks = by.get(n - 1 - ago); if (!ks) continue;
      const chips = [];
      for (const kind of ['C', 'S', 'I']) {
        for (const k of ks) {
          const L = res.labels[k]; if (L.kind !== kind || !labelOn(L)) continue;
          chips.push(repeated9(L) ? `<span class="gs-rep">${BE.chipHTML('S', L.text)}</span>` : BE.chipHTML(L.kind, L.text, L.family));
          if (ago === 0 && kind === 'C' && !out.hit.includes(L.family)) out.hit.push(L.family);
        }
      }
      if (chips.length) parts.push(`<span class="gs-it">${chips.join(' ')} <span>${BE.agoText(ago)}</span></span>`);
    }
    const t13 = x.trigs.filter((t) => t.k === 'C13' && t.fire && BE.famOn(t.f)), best = nearest(t13);
    if (best) {
      const fr = best.fire, run = x.runs.find((r) => r.family === best.f && r.direction === best.d && r.originDay === best.o);
      const tail = fr.now ? '<span class="gs-ok">지금 값으로 충족</span>'
        : `<span>13까지 <span class="gs-pct">${fmtPct(fr.pct)}</span></span>${Math.abs(fr.pct) <= S.near / 100 ? ' <i class="gs-near">임박</i>' : ''}`;
      // the mark of a 13 waiting at 12, as in sheet B: an outline in the family color, filled when the bar would complete it now
      parts.push(`<span class="gs-it gs-cd" style="--c:var(--f${best.f});--i:var(--fi${best.f})" title="${esc(`${FAM_NAME[best.f]} ${sideKo(best.d)} 카운트다운`)}"><b class="gs-w${fr.now ? ' gs-wn' : ''}">${FAM_CODE[best.f]} ${run ? run.n : 12} ${ARROW[best.d]}</b> ${tail}${t13.length > 1 ? ` <span>외 ${t13.length - 1}개</span>` : ''}</span>`);
      const now = t13.find((t) => t.fire.now); if (now) out.now = now.f;
    } else {
      let top = null; for (const r of x.runs) if (BE.famOn(r.family) && (!top || r.n > top.n)) top = r;
      if (top) parts.push(`<span class="gs-it gs-cd" style="--c:var(--f${top.family})" title="${esc(`${FAM_NAME[top.family]} ${sideKo(top.direction)} 카운트다운`)}"><i class="gs-sw"></i><b class="gs-run">${FAM_CODE[top.family]} ${top.n} ${ARROW[top.direction]}</b></span>`);
    }
    if (S.labels === 'all') {
      for (const d of [BUY, SELL]) {
        const raw = d === BUY ? res.state.buyRaw : res.state.sellRaw; if (!(raw > 0)) continue;
        const to9 = VIEW.barsTo9(raw, OPT.wrapSetup !== false), what = raw >= 9 ? '반복 9' : '9';
        const t9 = to9 === 1 ? x.trigs.find((t) => t.k !== 'C13' && t.d === d && t.fire) : null;
        const tail = to9 == null ? '' : t9 ? (t9.fire.now ? `, ${what}는 <span class="gs-ok">지금 값으로 충족</span>` : `, ${what}까지 <span class="gs-pct">${fmtPct(t9.fire.pct)}</span>`) : `, ${what}까지 ${to9}봉`;
        parts.push(`<span class="gs-it gs-su">셋업 ${ARROW[d]}${raw}${tail}</span>`);
      }
    }
    if (parts.length === (n < S.bars ? 1 : 0)) parts.push(`<span>${S.labels === 'all' ? '카운트다운과 셋업 없음' : '카운트다운 없음'}</span>`);
    out.html = parts.join(' ');
    return out;
  }
  function fillHead(cell, x, c) {
    const b = x.bars, n = b.n, st = headState(x);
    cell.tv.href = BE.tvUrl(c.usd, x.tf);
    cell.tv.title = `${c.s} ${x.tf} 차트를 TradingView에서 엽니다`; cell.tv.setAttribute('aria-label', cell.tv.title);
    cell.meta.textContent = n ? `마지막 봉 ${iso(b.start[n - 1])}` : '확정 봉 없음';
    cell.state.innerHTML = st.html;
    cell.el.classList.toggle('gs-hit', st.hit.length > 0);
    cell.el.classList.toggle('gs-now', !st.hit.length && st.now != null);
    const k = st.hit.length;
    cell.el.style.setProperty('--gs-bar', k > 1 ? `linear-gradient(90deg, ${st.hit.map((f, i) => `var(--f${f}) ${i / k * 100}% ${(i + 1) / k * 100}%`).join(', ')})` : k ? `var(--f${st.hit[0]})` : 'transparent');
    cell.el.style.setProperty('--gs-c', st.now != null ? `var(--f${st.now})` : 'transparent');
    const said = [...cell.state.children].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(', ');
    cell.plot.setAttribute('aria-label', `${x.tf} 차트. ${cell.meta.textContent}. ${said}. Enter 키로 크게 보거나 되돌리고, 좌우 화살표 키로 봉을 옮깁니다.`);
  }

  // ---------- model of one panel: geometry, label places, condition price lines ----------
  function niceStep(range, target) { const raw = range / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw))), k = raw / p; return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * p; }
  function priceTicks(pLo, pHi, log, target) {
    const out = [];
    if (log) {
      for (let e = Math.floor(Math.log10(pLo)); e <= Math.ceil(Math.log10(pHi)); e++) for (const k of [1, 2, 5]) { const v = Number((k * Math.pow(10, e)).toPrecision(3)); if (v >= pLo && v <= pHi) out.push(v); }
      if (out.length >= 2 && out.length <= target + 3) return out;
      out.length = 0;
    }
    const st = niceStep(pHi - pLo, target);
    for (let v = Math.ceil(Math.max(pLo, 0) / st) * st; v <= pHi + st * 1e-9; v += st) out.push(Number(v.toPrecision(12)));
    return out;
  }
  // a price for the right margin: 4 or 5 significant digits, fewer while fits(text) says it is too wide (tiny prices)
  const axisText = (v, fits) => { let s = ''; for (let p = Math.abs(v) >= 1000 ? 5 : 4; p >= 1; p--) { s = fmtPrice(Number(v.toPrecision(p))); if (!fits || fits(s)) break; } return s; };
  // The calendar bucket of the day in progress [first day, last day]: the bar in progress of a timeframe that has no
  // closed day in it yet (1D always; any timeframe on the first day of its bucket, or when TradingView has no bar there).
  const OPEN = new Map();
  const openBucket = (tf) => {
    if (!OPEN.has(tf)) { let r; try { r = BARS.bucketFn(tf)(BE.LAST + 1, [0, 0]); } catch (e) { r = [BE.LAST + 1, BE.LAST + 1]; } OPEN.set(tf, r); }
    return OPEN.get(tf);
  };
  // the first and the last bar of timeframe tf that hold a day of [s, e], with the bar in progress as index n
  function barsOfDays(b, tf, s, e) {
    const n = b.n;
    let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (b.end[mid] < s) lo = mid + 1; else hi = mid; }
    const i0 = lo;
    lo = -1; hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b.start[mid] <= e) lo = mid; else hi = mid - 1; }
    let i1 = lo;
    if (e >= (b.partial ? b.partial.start : openBucket(tf)[0])) i1 = n;
    return i0 <= i1 ? [i0, i1] : null;
  }
  function build(cell) {
    const x = cur.det.tfs[cell.j], b = x.bars, n = b.n, P = b.partial, res = x.res;
    const W = cell.w, H = cell.h, zoom = cell.el.classList.contains('gs-zoom'), ctx = cell.ctx;
    const N = S.bars * (zoom ? 2 : 1), a = Math.max(0, n - N);
    const m = { x, tf: x.tf, n, a, N, W, H, zoom, P, none: !n && !P, small: W < 80 || H < 50, labels: [], paintOrder: [], tags: [], axis: [], gridY: [], ticks: [], gaps: [], faded: 0, tight: false };
    if (m.none || m.small) return m;
    // price range: the bars, then the labels on them, then the condition prices that are near
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i < n; i++) { if (b.l[i] < lo) lo = b.l[i]; if (b.h[i] > hi) hi = b.h[i]; }
    if (P) { if (P.l < lo) lo = P.l; if (P.h > hi) hi = P.h; }
    const log = S.scale === 'log' && lo > 0, f = log ? Math.log : (v) => v, fi = log ? Math.exp : (v) => v;
    const flat = !(f(hi) > f(lo)), span0 = flat ? Math.max(Math.abs(f(hi)) * 0.02, 1e-12) : f(hi) - f(lo);
    const fl0 = flat ? f(lo) - span0 / 2 : f(lo), fh0 = fl0 + span0;
    let fl = fl0, fh = fh0;
    if (res) {
      const pad = x.pad(), by = x.byBar(), cap = 0.35 * span0;
      for (let i = a; i < n; i++) {
        const ks = by.get(i); if (!ks) continue;
        for (const k of ks) {
          const L = res.labels[k]; if (!labelOn(L)) continue;
          const price = BE.labelPrice(L, b, pad);
          // a label far outside the bars (a +13 of a long timeframe can sit below zero) stays at the edge of the range
          const v = Math.min(fh0 + cap, Math.max(fl0 - cap, log ? (price > 0 ? Math.log(price) : -Infinity) : price));
          if (v < fl) fl = v; if (v > fh) fh = v;
          if (k < res.chartVisibleFrom) m.faded++;
          m.labels.push({ L, k, i, v, price, rank: L.kind === 'C' ? 2 : L.kind === 'S' ? 1 : 0, halo: L.kind === 'I' ? 2.5 : 3, color: BE.labelColor(L),
            alpha: k < res.chartVisibleFrom ? 0.3 : repeated9(L) ? 0.55 : L.kind === 'I' ? 0.8 : 1, font: '', w: 0, asc: 0, h: 0, cx: 0, top: 0 });
        }
      }
    }
    const c0 = x.base.c, near = S.near / 100, trigs = [];
    if (S.lines === 'on') {
      for (const t of x.trigs) {
        if (!t.fire || !trigOn(t)) continue;
        const fr = t.fire, o = { t, fr, zone: false };
        if (!fr.now) { const v = f(fr.p); o.zone = v >= fl0 - 0.3 * span0 && v <= fh0 + 0.3 * span0; if (o.zone) { if (v < fl) fl = v; if (v > fh) fh = v; } }
        trigs.push(o);
      }
    }
    // texts of the right margin, to know how wide it is: prices, and one tag per condition price
    const strength = (fr) => (fr.now || Math.abs(fr.pct) <= near ? 1 : Math.max(0.55, 1 - (Math.abs(fr.pct) - near) / 0.25 * 0.45));
    for (const o of trigs) {
      const t = o.t, fr = o.fr, what = t.k === 'C13' ? '13' : '9', color = t.k === 'C13' ? FAM_COLOR[t.f] : SETUP_COLOR, alpha = strength(fr), strong = fr.now || Math.abs(fr.pct) <= near;
      // side: -1 a price above the panel's range (an arrow at the top edge), 1 below it, 0 on the panel
      // (two countdowns of one family that wait at one price share a tag; the tooltip lists both)
      const tag = (kind, v, text, side) => {
        if (m.tags.some((g) => g.kind === kind && g.text === text && g.color === color && g.v === v)) return;
        m.tags.push({ kind, t, v, text, side, color, alpha: kind === 'q' ? alpha * 0.85 : alpha, strong, y: 0, yLine: null });
      };
      if (fr.now) tag('now', f(c0), `${what} 충족`, 0);
      else if (o.zone) tag('p', f(fr.p), `${what} ${fmtPct(fr.pct)}`, 0);
      else tag('out', f(fr.p), `${fr.p > c0 ? '▲' : '▼'} ${what} ${fmtPct(fr.pct)}`, fr.p > c0 ? -1 : 1);
      // where the bar has to close once it has reached the condition price, when that is another price than both
      if (!fr.now && fr.q !== fr.p && fr.q !== c0) { const v = f(fr.q); if (v >= fl && v <= fh) tag('q', v, `종가 ${fmtPct(fr.qpct)}`, 0); }
    }
    const axisVals = zoom ? priceTicks(fi(fl), fi(fh), log, Math.max(3, Math.round(H / 70))) : flat ? [hi] : [hi, lo];
    ctx.font = AXIS_FONT;
    const axisMax = Math.round(W * 0.3) - 9, axisTexts = axisVals.map(zoom ? fmtPrice : (v) => axisText(v, (s) => ctx.measureText(s).width <= axisMax));
    let gw = 0;
    for (const s of axisTexts) gw = Math.max(gw, ctx.measureText(s).width);
    for (const g of m.tags) { ctx.font = g.strong ? TAG_FONT_NEAR : TAG_FONT; g.w = ctx.measureText(g.text).width + (g.kind === 'now' ? 6 : 0); gw = Math.max(gw, g.w); }
    const gut = Math.max(38, Math.min(Math.ceil(gw) + 9, Math.round(W * 0.36)));
    // geometry: the newest bar at the right, then the bar in progress in a slot of its own; a history shorter than the
    // panel gets wider bars (up to a limit) instead of an empty panel
    const plotL = 0, plotR = W - gut, plotT = 2, plotB = H - AXIS_H, plotW = plotR - plotL, shown = Math.max(1, n - a);
    let slot = Math.min(zoom ? 16 : 12, plotW / (shown + 1)), lastW = slot; if (slot < 7) { lastW = Math.min(7, plotW / 2); slot = (plotW - lastW) / shown; }
    const X = (i) => (i >= n ? plotR - lastW / 2 : plotR - lastW - (n - 1 - i + 0.5) * slot);
    const scale = (mT, mB) => { const ky = (plotB - plotT - mT - mB) / (fh - fl), yb = plotB - mB; return Object.assign((v) => yb - (v - fl) * ky, { ky, yb }); };
    // labels: every bar's labels of one side in the order the indicator stacks them, at the prices the indicator gives.
    // Where two texts would cover each other the later one moves further out: 13 before 9 before +13, newer before older.
    // The margins above and below the candles grow until the labels fit (up to a limit, then with smaller texts).
    const stacks = new Map();
    for (const lab of m.labels) { const key = lab.i * 2 + (lab.L.dir === BUY ? 0 : 1); let st = stacks.get(key); if (!st) stacks.set(key, st = { i: lab.i, rank: 0, list: [] }); st.list.push(lab); st.rank = Math.max(st.rank, lab.rank); }
    const order = [...stacks.values()].sort((p, q) => q.rank - p.rank || q.i - p.i);
    for (const st of order) st.list.sort((p, q) => (p.L.dir === BUY ? q.v - p.v : p.v - q.v));
    const setFonts = (set) => {
      for (const lab of m.labels) {
        const [font, px] = set[lab.L.kind]; ctx.font = font;
        const mt = ctx.measureText(lab.L.text);
        lab.font = font; lab.w = mt.width; lab.asc = mt.actualBoundingBoxAscent > 0 ? mt.actualBoundingBoxAscent : px * 0.72; lab.h = lab.asc + Math.max(0, mt.actualBoundingBoxDescent || 0);
      }
    };
    const place = (Y) => {
      const done = []; let needT = 0, needB = 0;
      for (const st of order) {
        let edge = null;
        for (const lab of st.list) {
          const buy = lab.L.dir === BUY, y0 = Y(lab.v);
          let top = buy ? y0 + 2 : y0 - 2 - lab.h;
          if (edge != null) top = buy ? Math.max(top, edge + 1) : Math.min(top, edge - 1 - lab.h);
          const cx = Math.min(plotR - 1 - lab.w / 2, Math.max(plotL + 1 + lab.w / 2, X(lab.i))), home = top;
          for (let guard = 0; guard < 24; guard++) {
            const hit = done.find((r) => cx - lab.w / 2 < r.x1 + 1 && cx + lab.w / 2 > r.x0 - 1 && top < r.y1 + 1 && top + lab.h > r.y0 - 1);
            if (!hit) break;
            top = buy ? hit.y1 + 1 : hit.y0 - 1 - lab.h;
          }
          if (Math.abs(top - home) > lab.h * PUSH[lab.L.kind] + 4) top = home;   // too far from its bar to mean anything: it stays, under the others
          if (top < plotT) needT = Math.max(needT, plotT - top);
          if (top + lab.h > plotB) needB = Math.max(needB, top + lab.h - plotB);
          lab.cx = cx; lab.top = Math.max(plotT, Math.min(plotB - lab.h, top));
          done.push({ x0: cx - lab.w / 2, x1: cx + lab.w / 2, y0: lab.top, y1: lab.top + lab.h });
          edge = buy ? lab.top + lab.h : lab.top;
        }
      }
      return [needT, needB];
    };
    let Y = null;
    const fit = () => {
      const room = plotB - plotT; let mT = 5, mB = 5, short = 0;
      Y = scale(mT, mB);
      for (let pass = 0; ; pass++) {
        const [needT, needB] = place(Y);
        let t = Math.min(room * 0.5, mT + needT), u = Math.min(room * 0.5, mB + needB);
        if (t + u > room * 0.64) { const k = room * 0.64 / (t + u); t *= k; u *= k; }   // the candles keep a third of the height
        short = Math.max(0, mT + needT - t) + Math.max(0, mB + needB - u);
        if (pass === 5 || (Math.abs(t - mT) < 0.5 && Math.abs(u - mB) < 0.5)) return short;   // the labels fit, or no more room is given
        mT = t; mB = u; Y = scale(mT, mB);
      }
    };
    setFonts(zoom ? LABEL_FONT_BIG : LABEL_FONT);
    if (fit() > 0.5) { setFonts(zoom ? LABEL_FONT : LABEL_FONT_TIGHT); m.tight = true; fit(); }
    const Yp = (p) => Y(log ? (p > 0 ? Math.log(p) : fl) : p), Pof = (y) => fi(fl + (Y.yb - y) / Y.ky);
    // right margin: tags at their prices, pushed apart where they would cover each other; the out-of-range ones at the edges
    const tags = m.tags.slice().sort((p, q) => p.side - q.side || q.v - p.v);   // from the top of the panel down
    const yMin = plotT + TAG_H / 2, yMax = plotB - TAG_H / 2;
    for (const g of tags) { if (g.kind !== 'out') g.yLine = Y(g.v); g.y = g.kind === 'out' ? (g.side < 0 ? yMin : yMax) : Math.max(yMin, Math.min(yMax, g.yLine)); }
    for (let k = 1; k < tags.length; k++) tags[k].y = Math.max(tags[k].y, tags[k - 1].y + TAG_H);
    for (let k = tags.length - 1; k >= 0; k--) tags[k].y = Math.min(tags[k].y, k === tags.length - 1 ? yMax : tags[k + 1].y - TAG_H);
    axisVals.forEach((v, k) => {
      const y = Yp(v); if (y < plotT + 4 || y > plotB - 4) return;
      if (zoom) m.gridY.push(y);
      if (!tags.some((g) => Math.abs(g.y - y) < TAG_H - 1)) m.axis.push({ y, text: axisTexts[k] });
    });
    // date ticks: where a year, a quarter or a month begins, and the first bar of the history when it is on the panel
    if (n - a >= 1) {
      const span = b.start[n - 1] - b.start[a], d8 = (d) => new Date(d * BE.DAY);
      const key = span > 365 * 3 ? (d) => d8(d).getUTCFullYear() : span > 200 ? (d) => d8(d).getUTCFullYear() * 4 + Math.floor(d8(d).getUTCMonth() / 3) : (d) => d8(d).getUTCFullYear() * 12 + d8(d).getUTCMonth();
      const text = span > 365 * 3 ? (d) => String(d8(d).getUTCFullYear()) : (d) => iso(d).slice(0, 7);
      ctx.font = AXIS_FONT;
      let lastX = -Infinity;
      for (let i = a; i < n; i++) {
        if (i === a ? a > 0 : key(b.start[i]) === key(b.start[i - 1])) continue;
        const s = text(b.start[i]), w = ctx.measureText(s).width, xx = Math.max(plotL + w / 2 + 1, Math.min(plotR - w / 2 - 1, X(i)));
        if (xx - w / 2 < lastX + 10) continue;
        m.ticks.push({ x: xx, line: i > 0 ? X(i) - slot / 2 : null, text: s }); lastX = xx + w / 2;
      }
    }
    // days without a TradingView bar between two bars: the bars stay next to each other, with a mark between them
    for (let i = Math.max(1, a); i < n; i++) if (b.start[i] - b.end[i - 1] > 1) m.gaps.push(X(i) - slot / 2);
    if (P && n && P.start - b.end[n - 1] > 1) m.gaps.push(plotR - lastW);
    Object.assign(m, { lo, hi, log, c0, gut, plotL, plotR, plotT, plotB, slot, lastW, X, Y, Yp, Pof });
    m.tags = tags;
    m.paintOrder = m.labels.slice().sort((p, q) => p.rank - q.rank || p.i - q.i);   // +13, then 9, then 13; the newest on top
    return m;
  }

  // ---------- drawing ----------
  function paint(cell) {
    const m = cell.m, ctx = cell.ctx; if (!m || !ctx) return;
    const { W, H } = m, dpr = window.devicePixelRatio || 1;
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineJoin = 'round';
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, H);
    if (m.small) return;
    if (m.none) {
      ctx.fillStyle = C.muted; ctx.font = NOTE_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('이 타임프레임에는 아직 봉이 없습니다.', W / 2, H / 2);
      return;
    }
    const { x, n, a, P, plotL, plotR, plotT, plotB, slot, lastW, X, Yp } = m, b = x.bars;
    const mine = hover && hover.cell === cell ? hover : null, band = hover && !mine ? cell.band : null;
    // the same days on this timeframe while another panel is pointed at
    if (band && band !== 'left') {
      const x0 = Math.max(plotL, X(band[0]) - (band[0] >= n ? lastW : slot) / 2), x1 = Math.min(plotR, X(band[1]) + (band[1] >= n ? lastW : slot) / 2);
      ctx.fillStyle = C['accent-soft']; ctx.fillRect(x0, plotT, Math.max(2, x1 - x0), plotB - plotT);
      ctx.fillStyle = C.accent; ctx.globalAlpha = 0.7;
      if (x1 - x0 < 6) ctx.fillRect(Math.round((x0 + x1) / 2), plotT, 1, plotB - plotT);
      else { ctx.fillRect(Math.round(x0), plotT, 1, plotB - plotT); ctx.fillRect(Math.round(x1) - 1, plotT, 1, plotB - plotT); }
      ctx.globalAlpha = 1;
      // a pointer at the top edge, so the place is found at a glance on twenty panels
      const bx = Math.round((x0 + x1) / 2) + 0.5;
      ctx.beginPath(); ctx.moveTo(bx - 4.5, plotT); ctx.lineTo(bx + 4.5, plotT); ctx.lineTo(bx, plotT + 6); ctx.closePath(); ctx.fill();
    }
    // date ticks, price grid of a large panel, gaps
    ctx.font = AXIS_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const t of m.ticks) { if (t.line != null) { ctx.fillStyle = C.line; ctx.fillRect(Math.round(t.line), plotT, 1, plotB - plotT); } ctx.fillStyle = C.muted; ctx.fillText(t.text, t.x, H - 3); }
    ctx.fillStyle = C.line; for (const y of m.gridY) ctx.fillRect(plotL, Math.round(y), plotR - plotL, 1);
    if (m.gaps.length) {
      ctx.strokeStyle = C.faint; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
      for (const gx of m.gaps) { ctx.beginPath(); ctx.moveTo(Math.round(gx) + 0.5, plotT); ctx.lineTo(Math.round(gx) + 0.5, plotB); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // candles, snapped to device pixels; the bar in progress hollow
    const slotDev = slot * dpr, wickDev = Math.max(1, Math.round(dpr));
    let bodyDev = Math.max(wickDev, Math.min(Math.round(slotDev * 0.72), Math.floor(slotDev - wickDev * 0.9), Math.round(9 * dpr)));
    if ((bodyDev - wickDev) % 2 && bodyDev > 2 * wickDev) bodyDev -= 1;
    const candle = (cx, o, h, l, c, body, hollow, back) => {
      ctx.fillStyle = c >= o ? C.up : C.down;
      const left = Math.round(cx * dpr - body / 2), wl = left + Math.floor((body - wickDev) / 2);
      const yh = Math.round(Yp(h) * dpr), yl = Math.max(yh + 1, Math.round(Yp(l) * dpr));
      ctx.fillRect(wl / dpr, yh / dpr, wickDev / dpr, (yl - yh) / dpr);
      const y0 = Math.round(Yp(Math.max(o, c)) * dpr), y1 = Math.max(y0 + 1, Math.round(Yp(Math.min(o, c)) * dpr));
      ctx.fillRect(left / dpr, y0 / dpr, body / dpr, (y1 - y0) / dpr);
      if (hollow && body > 2 * wickDev && y1 - y0 > 2 * wickDev) { ctx.fillStyle = back; ctx.fillRect((left + wickDev) / dpr, (y0 + wickDev) / dpr, (body - 2 * wickDev) / dpr, (y1 - y0 - 2 * wickDev) / dpr); }
    };
    for (let i = a; i < n; i++) candle(X(i), b.o[i], b.h[i], b.l[i], b.c[i], bodyDev, false);
    if (P) {
      let body = Math.max(bodyDev, Math.min(Math.round(5 * dpr), Math.floor(lastW * dpr - wickDev))); if ((body - wickDev) % 2) body -= 1;
      candle(X(n), P.o, P.h, P.l, P.c, Math.max(wickDev, body), true, band && band !== 'left' && band[1] >= n ? C['accent-soft'] : C.surface);
    }
    // condition price lines over the right part, with their tags in the right margin
    const lineX = Math.max(plotL, plotR - Math.max(64, (plotR - plotL) * 0.42));
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const g of m.tags) {
      ctx.globalAlpha = g.alpha; ctx.strokeStyle = g.color; ctx.fillStyle = g.color;
      if (g.kind === 'p' || g.kind === 'q') {
        const y = Math.round(g.yLine) + 0.5;
        ctx.lineWidth = g.kind === 'q' ? 1 : g.strong ? 1.75 : 1.25; ctx.setLineDash(g.kind === 'q' ? [1.5, 2.5] : [4, 3]);
        ctx.beginPath(); ctx.moveTo(lineX, y); ctx.lineTo(plotR, y); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;
        if (Math.abs(g.y - g.yLine) > 1) { ctx.beginPath(); ctx.moveTo(plotR, y); ctx.lineTo(plotR + 4, g.y); ctx.stroke(); }
      }
      ctx.font = g.strong ? TAG_FONT_NEAR : TAG_FONT;
      if (g.kind === 'now') {
        // the bar in progress would get the label at its price now: a framed tag at that price
        ctx.lineWidth = 1; ctx.strokeRect(plotR + 2.5, Math.round(g.y - TAG_H / 2) + 0.5, Math.ceil(g.w), TAG_H - 1);
        ctx.fillText(g.text, plotR + 5.5, g.y + 0.5);
      } else ctx.fillText(g.text, plotR + 5, g.y + 0.5);
    }
    ctx.globalAlpha = 1;
    // prices of the right margin
    ctx.font = AXIS_FONT; ctx.fillStyle = C.muted;
    for (const t of m.axis) ctx.fillText(t.text, plotR + 5, Math.max(plotT + 5, Math.min(plotB - 4, t.y)) + 0.5);
    // labels: text only, buy under the bar and sell above it, with a halo in the surface color
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.strokeStyle = C.surface;
    for (const lab of m.paintOrder) {
      ctx.font = lab.font; ctx.globalAlpha = lab.alpha; ctx.lineWidth = lab.halo;
      ctx.strokeText(lab.L.text, lab.cx, lab.top + lab.asc);
      ctx.fillStyle = lab.color; ctx.fillText(lab.L.text, lab.cx, lab.top + lab.asc);
    }
    ctx.globalAlpha = 1;
    if (band === 'left') { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.moveTo(plotL + 1, (plotT + plotB) / 2); ctx.lineTo(plotL + 8, (plotT + plotB) / 2 - 6); ctx.lineTo(plotL + 8, (plotT + plotB) / 2 + 6); ctx.closePath(); ctx.fill(); }
    // crosshair of the panel pointed at: the bar, its start day, the price under the pointer
    if (mine) {
      const cx = Math.round(X(mine.i)) + 0.5;
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, plotT); ctx.lineTo(cx, plotB); ctx.stroke();
      const hy = mine.y != null && mine.y >= plotT && mine.y <= plotB ? Math.round(mine.y) + 0.5 : null;
      if (hy != null) { ctx.beginPath(); ctx.moveTo(plotL, hy); ctx.lineTo(plotR, hy); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.font = AXIS_FONT; ctx.textBaseline = 'middle';
      const day = iso(mine.s), tw = ctx.measureText(day).width + 8, tx = Math.max(plotL, Math.min(plotR - tw, cx - tw / 2));
      ctx.fillStyle = C.fg; ctx.fillRect(tx, plotB + 1, tw, AXIS_H - 1);
      ctx.fillStyle = C.surface; ctx.textAlign = 'center'; ctx.fillText(day, tx + tw / 2, plotB + 1 + (AXIS_H - 1) / 2 + 0.5);
      if (hy != null) {
        const s = axisText(m.Pof(mine.y)), w = ctx.measureText(s).width + 7, tx2 = Math.min(plotR + 1, W - w);
        ctx.fillStyle = C.fg; ctx.fillRect(tx2, hy - 6.5, w, 13);
        ctx.fillStyle = C.surface; ctx.textAlign = 'left'; ctx.fillText(s, tx2 + 3.5, hy + 0.5);
      }
    }
  }

  // ---------- layout: columns, the large panel, canvas sizes ----------
  function layout() {
    const vis = cells.filter((cell) => !cell.el.hidden);
    for (const cell of cells) { cell.el.style.gridColumn = ''; cell.el.style.gridRow = ''; cell.el.classList.remove('gs-zoom', 'gs-one'); }
    if (!vis.length) return;
    const cellW = vis[0].el.getBoundingClientRect().width, cols = Math.max(1, Math.round((grid.clientWidth + GAP) / (cellW + GAP)));
    grid.style.setProperty('--gs-h', Math.max(116, Math.min(200, Math.round((cellW - 18) * 0.48))) + 'px');
    const z = vis.find((cell) => cell.tf === zoomTf);
    for (const cell of cells) cell.plot.setAttribute('aria-expanded', String(cell === z));
    if (!z) return;
    z.el.classList.add('gs-zoom');
    if (cols < 2) { z.el.classList.add('gs-one'); return; }
    // the large panel grows where it stands: two columns and two rows from its own place (one column to the left in the last column)
    const i = vis.indexOf(z);
    z.el.style.gridColumn = `${Math.min(i % cols, cols - 2) + 1} / span 2`; z.el.style.gridRow = `${Math.floor(i / cols) + 1} / span 2`;
  }
  function drawAll(force) {
    if (!cur || !cur.det) return;
    const todo = [];
    for (const cell of cells) {
      if (cell.el.hidden) continue;
      const w = cell.plot.clientWidth, h = cell.plot.clientHeight;
      if (force || !cell.m || w !== cell.w || h !== cell.h) todo.push([cell, w, h]);
    }
    for (const [cell, w, h] of todo) {
      cell.w = w; cell.h = h; cell.ctx = BE.setupCanvas(cell.cv, Math.max(1, w), Math.max(1, h));
      cell.m = build(cell); cell.cv.gsModel = cell.m;   // the drawn model stays on the canvas, for checks
      cell.band = hover && hover.cell !== cell ? bandOf(cell.m) : null;
      paint(cell);
    }
    if (todo.length) syncFadeNote();
  }
  function syncFadeNote() {
    const gone = cells.some((cell) => !cell.el.hidden && cell.m && cell.m.faded > 0);
    fadeNote.hidden = !gone;
  }
  function update() {
    const { c, det } = cur;
    clearHover();
    wait.hidden = true; grid.hidden = false; foot.hidden = false;
    for (const cell of cells) { cell.el.hidden = !inGroup(cell.tf); fillHead(cell, det.tfs[cell.j], c); }
    layout(); drawAll(true);
  }

  // ---------- pointing at a bar: crosshair, tooltip, the same days on the other panels ----------
  function bandOf(m) {
    if (m.none || m.small || !hover) return null;
    const r = barsOfDays(m.x.bars, m.tf, hover.s, hover.e); if (!r) return null;
    return r[1] < m.a ? 'left' : [Math.max(r[0], m.a), r[1]];
  }
  function requestPaint() {
    if (rafPaint) return;
    rafPaint = requestAnimationFrame(() => {
      rafPaint = 0;
      for (const cell of cells) {
        if (cell.el.hidden || !cell.m) continue;
        const band = hover && hover.cell !== cell ? bandOf(cell.m) : null;
        const key = !hover ? '' : hover.cell === cell ? `x${hover.i}:${hover.y == null ? '' : Math.round(hover.y)}` : String(band);
        if (key === cell.hk) continue;
        cell.hk = key; cell.band = band; paint(cell);
      }
    });
  }
  function clearHover() { if (hover) { hover = null; requestPaint(); } BE.tip.hide(); }
  function setHover(cell, i, y, kb) {
    const b = cell.m.x.bars, P = b.partial;
    const open = i < b.n || P ? null : openBucket(cell.tf);
    const s = i < b.n ? b.start[i] : P ? P.start : open[0], e = i < b.n ? b.end[i] : P ? P.end : open[1];
    hover = { cell, i, y, s, e, kb };
    requestPaint();
  }
  function slotAt(m, px) {
    if (m.none || m.small) return -1;
    if (px >= m.plotR - m.lastW) return m.n;   // the bar in progress, and the right margin with its tags
    const i = m.n - 1 - Math.floor((m.plotR - m.lastW - px) / m.slot);
    return i >= m.a ? i : -1;
  }
  function pointAt(cell, ev, touching) {
    const m = cell.m; if (!m) return;
    const r = cell.cv.getBoundingClientRect(), i = slotAt(m, ev.clientX - r.left);
    if (i < 0) { clearHover(); return; }
    setHover(cell, i, ev.clientY - r.top, false);
    BE.tip.show(ev.clientX, touching ? r.bottom - 8 : ev.clientY, tipHTML(cell, i));
  }
  function stepHover(cell, to) {
    const m = cell.m; if (!m || m.none || m.small) return;
    const i = Math.max(m.a, Math.min(m.n, to)), b = m.x.bars, r = cell.cv.getBoundingClientRect();
    setHover(cell, i, null, true);
    const y = m.Yp(i < m.n ? b.l[i] : m.c0);
    BE.tip.show(r.left + m.X(i), r.top + (Number.isFinite(y) ? y : (m.plotT + m.plotB) / 2), tipHTML(cell, i));
  }

  // ---------- tooltip ----------
  const SRC_KO = { o: '시가', h: '고가', l: '저가', c: '종가', hl: '고가와 저가의 차이' };
  const OP_KO = { '<': '미만', '<=': '이하', '>': '초과', '>=': '이상' };
  const condText = ([s, op, v]) => `${SRC_KO[s] || s}가 ${fmtPrice(v)} ${OP_KO[op] || op}`;
  const groupText = (g) => g.map(condText).join('이고 ');
  const sideKo = (d) => `${SIDE[d]} 쪽`;
  const trigName = (t) => (t.k === 'C13' ? `${FAM_NAME[t.f]} ${sideKo(t.d)} 13` : t.k === 'S9r' ? `${sideKo(t.d)} 반복 9` : `${sideKo(t.d)} 9`);
  // A next-bar trigger in words, the same sentences as sheet B writes: "진행 중인 봉의 저가가 … 이하이고, 종가나 시가가 …
  // 이하이면 13이 완성됩니다."
  function anyText(any) {
    // "the close or the open at one level" reads better as one clause
    const one = any.every((g) => g.length === 1 && g[0][1] === any[0][0][1] && g[0][2] === any[0][0][2] && SRC_KO[g[0][0]] && g[0][0] !== 'hl');
    if (one && any.length > 1) return `${any.map((g) => SRC_KO[g[0][0]]).join('나 ')}가 ${fmtPrice(any[0][0][2])} ${OP_KO[any[0][0][1]]}`;
    return any.map(groupText).join('이거나 ');
  }
  function trigSentence(t) {
    const parts = [], is13 = t.k === 'C13', done = is13 ? '13이 완성됩니다' : `${t.k === 'S9r' ? '반복 9' : '9'}가 나옵니다`;
    if (t.all && t.all.length) parts.push(groupText(t.all));
    if (t.any && t.any.length && !t.any.some((g) => !g.length)) parts.push(anyText(t.any));
    let s = parts.length ? `진행 중인 봉의 ${parts.join('이고, ')}이면 ${done}.` : `진행 중인 봉이 마감하면 가격과 상관없이 ${done}.`;
    if (t.unless && t.unless.some((g) => !g.length)) s += is13 ? ' 다만 이번 봉에서는 카운트다운이 취소되어 완성되지 않습니다.' : ' 다만 이번 봉에서는 나오지 않습니다.';
    else if (t.unless && t.unless.length) s += ` 다만 ${t.unless.map(groupText).join(' 또는 ')}이면 ${is13 ? '취소됩니다' : '나오지 않습니다'}.`;
    return s;
  }
  // Where the bar in progress stands against a trigger (t of BE.detail's trigs), in the words of sheet B: the price the
  // low (buy) or the high (sell) has to reach, and the close price when that is a condition of its own. A close price at
  // the current price means any close on the way back completes it, so only the reach is named.
  function whereText(t) {
    const fr = t.fire;
    if (!fr) return `가격이 한 번 움직여서는 이번 봉에서 ${t.k === 'C13' ? '완성되지' : '나오지'} 않습니다.`;
    if (fr.now) return '지금 값으로 충족';
    if (fr.q === fr.p) return `조건가 ${fmtPrice(fr.p)} (${fmtPct(fr.pct)})`;
    const reach = `${t.d === BUY ? '저가' : '고가'} 조건가 ${fmtPrice(fr.p)} (${fmtPct(fr.pct)})`;
    return fr.qpct === 0 ? reach : `${reach} · 종가 조건가 ${fmtPrice(fr.q)} (${fmtPct(fr.qpct)})`;
  }
  const ohlcRow = (o, h, l, c, prev) => {
    const cells = [['시', o], ['고', h], ['저', l], ['종', c]].map(([k, v]) => `<span><span class="m">${k}</span> ${esc(fmtPrice(v))}</span>`).join('');
    return `<div class="row num">${cells}${prev > 0 ? `<span class="m">앞 봉 종가 대비 ${fmtPct(c / prev - 1)}</span>` : ''}</div>`;
  };
  function labelRow(x, k) {
    const L = x.res.labels[k], b = x.bars;
    let s;
    if (L.kind === 'C') s = `${FAM_NAME[L.family]} ${sideKo(L.dir)} 13 완성${/r/.test(L.text) ? ' (r: 셋업 18 이상 뒤)' : ''} · 출발 봉 ${L.origins.map((o) => iso(b.start[o])).join(', ')}`;
    else if (L.kind === 'I') s = `${FAM_NAME[L.family]} ${sideKo(L.dir)} 13이 미뤄진 봉 · 출발 봉 ${iso(b.start[L.origin])}`;
    else s = repeated9(L) ? `${sideKo(L.dir)} 반복 9 (셋업 ${L.raw})` : `${sideKo(L.dir)} 셋업 9${L.text === '9*' ? ' (퍼펙트)' : ''}`;
    if (k < x.res.chartVisibleFrom) s += ' · TradingView 차트에서는 지워진 라벨';
    return `<div class="row">${repeated9(L) ? `<span class="gs-rep">${BE.chipHTML('S', L.text)}</span>` : BE.chipHTML(L.kind, L.text, L.family)}<span>${esc(s)}</span></div>`;
  }
  function tipHTML(cell, i) {
    const x = cell.m.x, b = x.bars, n = b.n, P = b.partial, h = [];
    const range = (s, e) => `${x.tf} ${iso(s)}${e !== s ? ' ~ ' + iso(e).slice(5) : ''}`;
    if (i < n) {
      h.push(`<div class="h1">${range(b.start[i], b.end[i])}</div>`, ohlcRow(b.o[i], b.h[i], b.l[i], b.c[i], i > 0 ? b.c[i - 1] : 0));
      if (i > 0 && b.start[i] - b.end[i - 1] > 1) h.push(`<div class="m">앞 봉과의 사이에 TradingView 봉이 없는 날이 ${BE.nf(b.start[i] - b.end[i - 1] - 1)}일 있습니다.</div>`);
      const ks = (x.byBar().get(i) || []).filter((k) => labelOn(x.res.labels[k]));
      if (ks.length) h.push(`<div class="sec">${ks.map((k) => labelRow(x, k)).join('')}</div>`);
      return h.join('');
    }
    if (P) h.push(`<div class="h1">${range(P.start, P.end)}</div><div class="m">진행 중인 봉입니다. ${iso(P.last)} 마감까지의 값이고, 신호는 세지 않습니다.</div>`, ohlcRow(P.o, P.h, P.l, P.c, n ? b.c[n - 1] : 0));
    else { const [s, e] = openBucket(x.tf); h.push(`<div class="h1">${range(s, e)}</div><div class="m">진행 중인 봉입니다. 마감된 날이 아직 없어서, 조건가는 이 봉이 마지막 종가 ${esc(fmtPrice(x.base.c))}에서 시작한다고 보고 계산했습니다.</div>`); }
    const ts = x.trigs.filter(trigOn);
    if (!ts.length) {
      const none = x.trigs.length ? '켜 둔 계열과 라벨에는 다음 봉 조건이 없습니다.' : '다음 봉 조건이 없습니다. 이 봉이 어떻게 마감해도 9나 13은 나오지 않습니다.';
      h.push(`<div class="sec"><div class="m">${none}</div></div>`);
    } else {
      h.push(`<div class="sec"><div class="m">다음 봉 조건</div>${ts.map((t) => {
        // a 13 that has not completed yet is the outlined mark (filled when it holds now), never the chip of a 13 on the chart
        const fr = t.fire, chip = t.k === 'C13' ? `<b class="gs-w${fr && fr.now ? ' gs-wn' : ''}" style="--c:var(--f${t.f});--i:var(--fi${t.f})">13</b>` : BE.chipHTML('S', '9');
        return `<div class="row">${chip}<b>${esc(trigName(t))}</b>${t.o != null ? `<span class="m">출발 봉 ${iso(t.o)}</span>` : ''}</div><div class="num">${esc(whereText(t))}</div><div class="m">${esc(trigSentence(t.t))}</div>`;
      }).join('')}</div>`);
    }
    return h.join('');
  }

  // ---------- one panel ----------
  function toggleZoom(cell) {
    zoomTf = zoomTf === cell.tf ? null : cell.tf;
    clearHover();
    layout(); drawAll(true);
    cell.el.scrollIntoView({ block: 'nearest' });
  }
  function makeCell(tf, j) {
    const cell = { tf, j, el: el('section', 'panel gs-cell'), w: 0, h: 0, m: null, ctx: null, band: null, hk: '' };
    cell.el.dataset.tf = tf;
    const top = el('div', 'gs-top'), name = el('h3', 'gs-tf', tf);
    name.id = `gs-tf-${tf}`; cell.el.setAttribute('aria-labelledby', name.id);
    cell.meta = el('span', 'gs-meta');
    cell.tv = el('a', 'gs-tv', '차트 ↗'); cell.tv.target = '_blank'; cell.tv.rel = 'noopener';
    top.append(name, cell.meta, cell.tv);
    cell.state = el('div', 'gs-state');
    cell.plot = el('div', 'gs-plot'); cell.plot.tabIndex = 0; cell.plot.setAttribute('role', 'button'); cell.plot.setAttribute('aria-expanded', 'false');
    cell.cv = el('canvas'); cell.cv.setAttribute('aria-hidden', 'true');
    cell.plot.append(cell.cv);
    cell.el.append(top, cell.state, cell.plot);
    const p = cell.plot;
    p.addEventListener('pointerdown', (ev) => { touch = ev.pointerType === 'touch' ? { id: ev.pointerId, x: ev.clientX, y: ev.clientY, scrub: false } : null; });
    p.addEventListener('pointermove', (ev) => {
      if (!cur || !cur.det) return;
      if (ev.pointerType !== 'touch') { pointAt(cell, ev, false); return; }
      // a finger: sliding sideways over the chart reads the bars; a tap shows the panel large
      if (!touch || touch.id !== ev.pointerId) return;
      const dx = Math.abs(ev.clientX - touch.x), dy = Math.abs(ev.clientY - touch.y);
      if (!touch.scrub && dx > 8 && dx > dy) touch.scrub = true;
      if (touch.scrub) pointAt(cell, ev, true);
    });
    p.addEventListener('pointerup', () => { if (touch && touch.scrub) clickGuard = performance.now(); touch = null; });
    p.addEventListener('pointercancel', () => { touch = null; });
    p.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch' && hover && !hover.kb) clearHover(); });
    p.addEventListener('blur', () => { if (hover && hover.kb && hover.cell === cell) clearHover(); });
    p.addEventListener('keydown', (ev) => {
      if (!cur || !cur.det || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const m = cell.m, at = hover && hover.cell === cell ? hover.i : null;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleZoom(cell); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); if (m) stepHover(cell, at == null ? (m.n > m.a ? m.n - 1 : m.n) : at + (ev.key === 'ArrowLeft' ? -1 : 1)); }
      else if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); if (m) stepHover(cell, ev.key === 'Home' ? m.a : m.n); }
      else if (ev.key === 'Escape') { if (hover) clearHover(); else if (zoomTf === cell.tf) toggleZoom(cell); }
    });
    return cell;
  }

  // ---------- the variant ----------
  function showWait(node, busy) {
    wait.style.minHeight = grid.hidden ? '' : `${grid.offsetHeight}px`;
    wait.className = `panel gs-wait ${busy ? 'loading' : 'empty'}`;
    wait.replaceChildren(...node); wait.hidden = false; grid.hidden = true; foot.hidden = true;
  }
  function load(c) {
    cur = { c, det: null };
    clearHover();
    showWait([el('span', null, '불러오는 중입니다…')], true);
    BE.detail(c).then((det) => {
      if (!root || !cur || cur.c !== c) return;   // another coin was chosen meanwhile
      cur.det = det; update();
    }, (err) => {
      if (!root || !cur || cur.c !== c) return;
      const text = err.stale ? '이 화면을 연 뒤에 새 데이터가 배포되었습니다. 새로고침하면 최신 데이터로 다시 엽니다.'
        : !c.usd ? 'TradingView에서 이 종목의 USD 티커를 찾지 못해서 TD를 셀 수 없습니다.'
          : !c.t ? `이번 수집에서 ${c.usd}의 TradingView 데이터를 받지 못해서 TD를 셀 수 없습니다.`
            : `${c.s}의 일봉 데이터를 불러오지 못했습니다 (${err.message}).`;
      const nodes = [el('span', null, text)];
      if (err.stale || (c.usd && c.t)) { const btn = el('button', 'btn', err.stale ? '새로고침' : '다시 시도'); btn.type = 'button'; btn.addEventListener('click', () => (err.stale ? location.reload() : load(c))); nodes.push(btn); }
      showWait(nodes, false);
    });
  }
  const onScroll = () => { if (hover) clearHover(); };
  const onDocDown = (ev) => { if (hover && !(ev.target.closest && ev.target.closest('.gs-plot'))) clearHover(); };

  BE.register({
    view: 'sheet', key: 'a', name: '격자 시트',
    blurb: '한 종목의 20개 타임프레임 차트를 한 장에 놓았습니다. 차트마다 지표가 그리는 위치에 9와 13을 표시합니다. '
      + '오른쪽의 점선은 진행 중인 봉이 그 가격에 닿으면 다음 9나 13이 나오는 조건가이고, 옆의 숫자는 최근 종가에서 그 가격까지의 거리입니다.',
    good: ['타임프레임마다 봉 모양과 신호를 함께 봄', '조건가가 차트 위에 보임', '차트를 누르면 크게 봄'],
    weak: ['차트가 작아서 오래된 신호는 보이지 않음', '타임프레임 사이의 시간 관계는 마우스를 올려서 맞춰 봐야 함', '휴대폰에서는 한 줄에 하나씩이라 길게 내려야 함'],
    mount(node) {
      root = node;
      if (!document.getElementById('be-sheet-a-css')) { const st = document.createElement('style'); st.id = 'be-sheet-a-css'; st.textContent = CSS; document.head.append(st); }
      const ctl = el('div', 'panel controls'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', '격자 시트 보기 설정');
      const set = (k) => (v) => { S[k] = v; BE.save(); if (cur && cur.det) update(); };
      ctl.append(
        BE.seg('봉 수', [[30, '30'], [60, '60'], [120, '120']], () => S.bars, set('bars')),
        BE.seg('타임프레임', [['all', `전체 ${TFS.length}`], ['day', `일 단위 ${DAY_TFS}`], ['wm', `주·월 단위 ${TFS.length - DAY_TFS}`]], () => S.tfs, set('tfs')),
        BE.seg('가격 축', [['lin', '선형'], ['log', '로그']], () => S.scale, set('scale')),
        BE.seg('라벨', [['all', '9와 13'], ['13', '13만']], () => S.labels, set('labels')),
        BE.seg('조건가 선', [['on', '켬'], ['off', '끔']], () => S.lines, set('lines')),
        BE.seg('임박 기준', [[3, '3%'], [5, '5%'], [10, '10%']], () => S.near, set('near')),
      );
      wait = el('div', 'panel gs-wait loading'); wait.setAttribute('role', 'status'); wait.hidden = true;
      grid = el('div', 'gs-grid'); grid.hidden = true;
      cells = TFS.map(makeCell);
      grid.append(...cells.map((cell) => cell.el));
      grid.addEventListener('click', (ev) => {
        const node = ev.target.closest && ev.target.closest('.gs-cell'); if (!node || ev.target.closest('a')) return;
        if (performance.now() - clickGuard < 250 || !cur || !cur.det) return;   // not the end of a finger's slide
        toggleZoom(cells.find((cell) => cell.el === node));
      });
      foot = el('div', 'gs-foot'); foot.hidden = true;
      const lg = el('div', 'legend');
      const f0 = BE.FAMS[0] ?? 0;
      lg.innerHTML = [
        `${BE.chipHTML('C', '13', f0)}13 완성 (색은 계열)`,
        `${BE.chipHTML('S', '9')}셋업 9`,
        `<span class="gs-rep">${BE.chipHTML('S', '9')}</span>반복 9`,
        `${BE.chipHTML('I', '+13', f0)}13이 미뤄진 봉`,
        `<b class="gs-w" style="--c:var(--f${f0})">${FAM_CODE[f0]} 12 ▼</b>12에서 대기 중인 13`,
        BE.FAMS.map((f) => `${FAM_CODE[f]} ${FAM_NAME[f]}`).join(' · '),
        '▼ 매수 쪽 · ▲ 매도 쪽',
        '<i class="gs-lb"></i>진행 중인 봉',
        '<i class="gs-lp"></i>조건가',
        '<i class="gs-lq"></i>종가 조건가',
        '<i class="gs-lh"></i>차트 위쪽 선: 마지막 봉에 13 완성',
        '<i class="gs-ln"></i>차트 위쪽 점선: 지금 값으로 13 충족',
        '<i class="gs-lm"></i>가리킨 봉과 같은 기간',
      ].map((s) => `<span>${s}</span>`).join('');
      const h1 = el('p', 'hint', '조건가는 진행 중인 봉이 닿아야 하는 가격이고, 종가 조건가는 그 뒤에 봉이 마감해야 하는 가격입니다. '
        + '옆의 숫자는 최근 종가에서 그 가격까지의 거리이고, 임박 기준 안에 들어오면 굵게 표시합니다. '
        + '▲나 ▼가 붙은 숫자는 조건가가 차트의 가격 범위 밖에 있다는 뜻입니다. "충족"은 진행 중인 봉이 지금 값에서 마감하면 그 라벨이 나온다는 뜻입니다.');
      const h2 = el('p', 'hint', '차트를 누르면 크게 보고, 다시 누르면 돌아갑니다. 마우스를 올리면 그 봉의 값과 라벨이 나오고, 다른 타임프레임에는 같은 기간의 봉이 표시됩니다. '
        + '키보드에서는 Tab으로 차트를 고른 뒤 Enter로 크게 보고, 좌우 화살표로 봉을 옮깁니다. 휴대폰에서는 차트를 옆으로 밀면 봉의 값이 나옵니다.');
      fadeNote = el('p', 'hint', `흐린 라벨은 TradingView 차트에서는 지워진 라벨입니다. 지표가 라벨을 최근 ${OPT.labelLimit}개까지만 남기기 때문입니다.`); fadeNote.hidden = true;
      foot.append(lg, h1, h2, fadeNote);
      root.append(ctl, wait, grid, foot);
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => {
          if (rafSize) return;
          rafSize = requestAnimationFrame(() => { rafSize = 0; if (!root || grid.hidden || !cur || !cur.det) return; layout(); drawAll(false); });
        });
        ro.observe(grid); for (const cell of cells) ro.observe(cell.plot);
      }
      addEventListener('scroll', onScroll, { passive: true });
      document.addEventListener('pointerdown', onDocDown, true);
    },
    render() {
      if (!root) return;
      const c = BE.coin();
      if (!cur || cur.c !== c) load(c);            // mount, coin
      else if (cur.det) update();                 // fam, theme, resize: the same coin again
    },
    unmount() {
      if (ro) ro.disconnect();
      cancelAnimationFrame(rafPaint); cancelAnimationFrame(rafSize);
      removeEventListener('scroll', onScroll); document.removeEventListener('pointerdown', onDocDown, true);
      BE.tip.hide();
      root = grid = wait = foot = fadeNote = ro = cur = hover = touch = null; cells = []; rafPaint = rafSize = 0;
    },
  });
})();
