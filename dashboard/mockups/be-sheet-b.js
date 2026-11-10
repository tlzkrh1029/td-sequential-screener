// Bird eye study, sheet view, variant B: 시간 정렬 레인.
//
// One coin, its 20 timeframes as lanes on ONE date axis, so the 9s and 13s of different timeframes can be read against
// each other in time. A lane draws the bars of its timeframe on its own log price scale (candles, or a high-low band
// with a close line when a bar is under 3 px wide) and the indicator's labels as marks at the lane edges: sell at the
// top edge, buy at the bottom edge, as wide as the period of their bar. A 13 is a block in the family color (several
// families on one bar share the block), a 9 a gray line; where a block is wide and tall enough its text is written in
// it, and a wide 9 or +13 gets its text too. The bar in progress is hollow, with the 13s that wait at 12 as outlines.
// Confluence: per side, the days on which the bars of at least K timeframes carry a 13 of an enabled family get a band
// across all lanes, and those periods are listed under the picture.
// Nothing here counts TD: labels, runs and next-bar triggers come from BE.detail (the engine), distances from
// VIEW.fire through it.
(() => {
  const { TFS, LAST, DAY, BUY, SELL, SIDE, ARROW, FAM_NAME, FAM_CODE, FAM_COLOR, SETUP_COLOR, C, el, iso, nf, fmtPrice, fmtPct } = BE;
  const ID = 'sheet-b', CSS_ID = 'be-sheet-b-css';
  const TODAY = LAST + 1, END = LAST + 2; // the day in progress, and where the date axis ends (after it)
  const MONO = '"IBM Plex Mono", ui-monospace, monospace', SANS = '"IBM Plex Sans KR", sans-serif';
  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  const RANGES = [['6m', '6개월', 183], ['1y', '1년', 365], ['2y', '2년', 730], ['5y', '5년', 1826], ['all', '전체', Infinity]];
  const SIZES = [['s', '작게'], ['m', '보통'], ['l', '크게']];
  // lane geometry per size: h lane height, gap to the next lane, n9 / n13 heights of the 9 row (outer) and the 13 row
  // (inner) of an edge strip, inset of the price area from the lane edges, font size of the text in a block (0: none).
  // The small and the middle size let the price run under the 13 rows, so the lanes stay low enough for one screen;
  // the large size keeps the price between the strips. The middle size takes the height at which the 20 lanes fill
  // the window (between its h and hMax).
  const LANE = {
    s: { h: 24, gap: 3, n9: 2, n13: 6, inset: 4, font: 0 },
    m: { h: 32, hMax: 52, gap: 3, n9: 3, n13: 10, inset: 5, font: 9.5 },
    l: { h: 76, gap: 4, n9: 4, n13: 13, inset: 19, font: 10.5 },
  };
  const GROUP_BEFORE = new Set(['8D', '1M']); // a wider gap before these lanes, as the screener table groups its columns
  const GROUP_GAP = 6, AXIS_H = 16, TRACK_H = 11, MIN_SPAN = 30, FADE = 0.35, LIST_STEP = 40;
  const CANDLE_MIN_PX = 3, CANDLE_MAX_BODY = 9, CELL_MIN_PX = 22; // candles from 3 px a bar (a high-low band below it); bar borders from 22 px
  const nomDays = (tf) => { const m = /^(\d+)([DWM])$/.exec(tf); return Number(m[1]) * { D: 1, W: 7, M: 30.44 }[m[2]]; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const spanText = (s, e) => (s === e ? iso(s) : iso(s).slice(0, 4) === iso(e).slice(0, 4) ? `${iso(s)} ~ ${iso(e).slice(5)}` : `${iso(s)} ~ ${iso(e)}`);
  const dayText = (d) => `${iso(d)} (${WEEKDAY[new Date(d * DAY).getUTCDay()]})`;
  // the first calendar day of the bar in progress of a timeframe (the bucket that holds the day in progress)
  const openStart = (tf) => { try { return BARS.bucketFn(tf)(TODAY, [0, 0])[0]; } catch (e) { return TODAY; } };

  const CSS = `
.shb-pic { padding: 8px; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); }
.shb-head { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; justify-content: space-between; min-height: 28px; padding: 0 4px; }
.shb-pin { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.shb-pin .lb { font-size: 12px; color: var(--muted); font-weight: 500; }
.shb-pin .d { font: 600 13px var(--font-mono); min-width: 15ch; text-align: center; }
.shb-span { font: 12px var(--font-mono); color: var(--muted); white-space: nowrap; }
.shb-stage { position: relative; overflow: hidden; touch-action: pan-y; min-width: 0; }
.shb-stage canvas { display: block; }
.shb-over { position: absolute; left: 0; top: 0; cursor: crosshair; outline-offset: -2px; border-radius: 4px; }
.shb-over.drag { cursor: grabbing; }
.shb-over.gut { cursor: default; }
.shb-notes { display: grid; gap: 6px; padding: 0 4px 2px; }
.shb-notes .legend > span { white-space: normal; }
.shb-w { font-family: var(--font-mono); font-weight: 600; font-size: 11px; line-height: 13px; padding: 0 3px; border-radius: 4px; border: 1px solid var(--c); color: var(--fg); display: inline-block; white-space: nowrap; }
.shb-w.now { background: var(--c); color: var(--i); }
.shb-sw { display: inline-block; position: relative; width: 16px; height: 12px; border-radius: 2px; overflow: hidden; }
.shb-sw.band { border-top: 3px solid var(--hl); }
.shb-sw.band::after { content: ""; position: absolute; inset: 0; background: var(--hl); opacity: .3; }
.shb-sw.prog { width: 7px; border: 1px solid var(--up); border-radius: 0; }
.shb-sw.gone { background: var(--f0); opacity: .35; }
.shb-listp { padding: 10px 12px 12px; display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); }
.shb-lhead { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; }
.shb-lhead span { font-size: 12.5px; color: var(--muted); }
.shb-list { display: grid; gap: 4px; grid-template-columns: minmax(0, 1fr); }
.shb-row { display: flex; flex-wrap: wrap; gap: 3px 12px; align-items: center; width: 100%; text-align: left; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.shb-row:hover { background: var(--sunken); }
.shb-row[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.shb-row .d { font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; min-width: 25ch; }
.shb-row .sd { font-weight: 600; white-space: nowrap; min-width: 5em; }
.shb-row .n { color: var(--muted); font-size: 12.5px; white-space: nowrap; min-width: 8.5em; }
.shb-row .tfs { display: inline-flex; flex-wrap: wrap; gap: 3px 10px; min-width: 0; }
.shb-tf { display: inline-flex; align-items: center; gap: 3px; font: 600 12px var(--font-mono); white-space: nowrap; }
.shb-tf i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: var(--c); }
.shb-tipfoot { margin-top: 6px; color: var(--muted); }
.shb-gone { opacity: .4; }
@media (max-width: 720px) {
  .shb-pic { padding: 6px; }
  .shb-listp { padding: 10px; }
  .shb-row .d, .shb-row .n, .shb-row .sd { min-width: 0; }
}`;

  // ---------- state ----------
  let root = null, ui = null, st = null;
  let cur = null;    // the coin shown: { c, det, lanes, dataStart, conf }
  let view = null;   // the date range on the axis: { t0, t1 (unix days, fractional), custom (moved off a preset) }
  let G = null;      // geometry of the last base drawing
  let pin = null;    // pinned day | null
  let hover = null;  // mouse over the plot: { day, lane } | null
  let laneSel = null; // the timeframe chosen with the up and down keys: its state is shown next to its name, as a hover on the name does
  let drag = null, raf = 0, seq = 0, listKey = '', listMax = LIST_STEP, listTimer = 0, onAway = null;
  let clickMemo = null; // { t, pin }: the pinned day before the first click of what may become a double click
  let fitH = 0;      // lane height of the middle size: the 20 lanes fill the window (set on mount, on a new width or size)
  let sized = '';    // canvas size last set, so a repaint of the same size keeps the canvas
  let goneSeen = false, goneNoted = null; // a label the chart no longer shows is in the picture / is explained under it

  const narrow = () => ((root && root.clientWidth) || innerWidth) < 640; // a phone: narrow gutter, shorter default range, low lanes
  const rangeKey = () => (st.range === 'auto' ? (narrow() ? '1y' : '2y') : st.range);
  const laneKey = () => (st.lane === 'auto' ? (narrow() ? 's' : 'm') : st.lane);

  // ---------- the coin: marks per lane, counts of 13s per day, confluence periods ----------
  // how near a waiting 13 is: 0 = it would complete if the bar closed now, Infinity = no single move completes it
  const nearOf = (fire) => (!fire ? Infinity : fire.now ? 0 : Math.abs(fire.pct));
  const waitAlpha = (fire) => (!fire ? 0.45 : fire.now ? 1 : clamp(1 - Math.abs(fire.pct) * 2.5, 0.5, 0.95));

  // One lane's marks from the engine's labels: a cell per bar and side that has a 9, a 13 or a +13 (9s belong to no
  // family; 13s and +13s follow the family toggles), and the 13s waiting at 12 (the C13 next-bar triggers).
  function buildLane(lane) {
    const x = lane.x, res = x.res, bars = x.bars, cells = [];
    if (res) {
      const vis = res.chartVisibleFrom, byKey = new Map();
      res.labels.forEach((L, k) => {
        const is9 = L.kind === 'S' && L.text.startsWith('9'), is13 = L.kind === 'C', isDef = L.kind === 'I' && L.text.startsWith('+');
        if (!(is9 || is13 || isDef) || (!is9 && !BE.famOn(L.family))) return;
        const key = L.bar * 2 + (L.dir === SELL ? 1 : 0);
        let cell = byKey.get(key);
        if (!cell) { cell = { bar: L.bar, dir: L.dir, s: bars.start[L.bar], e: bars.end[L.bar], c13: [], s9: null, def: [] }; byKey.set(key, cell); cells.push(cell); }
        const item = { L, gone: k < vis }; // gone: the indicator's label limit has deleted it from the chart
        if (is13) cell.c13.push(item); else if (is9) cell.s9 = item; else cell.def.push(item);
      });
      cells.sort((a, b) => a.bar - b.bar || a.dir - b.dir);
      for (const cell of cells) cell.c13.sort((a, b) => a.L.family - b.L.family);
    }
    lane.cells = cells;
    lane.byBar = new Map();
    for (const cell of cells) { const a = lane.byBar.get(cell.bar); if (a) a.push(cell); else lane.byBar.set(cell.bar, [cell]); }
    lane.waits = x.trigs.filter((t) => t.k === 'C13' && BE.famOn(t.f)).sort((a, b) => { const u = nearOf(a.fire), v = nearOf(b.fire); return u === v ? 0 : u < v ? -1 : 1; });
  }
  // per side and day: how many timeframes have a 13 of an enabled family on the bar that holds the day
  function buildCounts() {
    let d0 = Infinity, d1 = -Infinity;
    for (const lane of cur.lanes) for (const cell of lane.cells) if (cell.c13.length) { if (cell.s < d0) d0 = cell.s; if (cell.e > d1) d1 = cell.e; }
    const n = d1 >= d0 ? d1 - d0 + 1 : 0, cnt = { [SELL]: new Uint8Array(n), [BUY]: new Uint8Array(n) };
    for (const lane of cur.lanes) for (const cell of lane.cells) if (cell.c13.length) { const a = cnt[cell.dir]; for (let d = cell.s; d <= cell.e; d++) a[d - d0]++; }
    cur.conf = { d0, n, cnt, periods: [] };
    buildPeriods();
  }
  const countAt = (dir, day) => { const f = cur.conf; return day >= f.d0 && day < f.d0 + f.n ? f.cnt[dir][day - f.d0] : 0; };
  // the runs of days with at least K timeframes, newest first: { dir, s, e, max, core (first day of the highest count),
  // tfs: [{ j, fams }] every timeframe with a 13 bar inside the period and the families of those 13s }
  function buildPeriods() {
    const { d0, n, cnt } = cur.conf, K = st.k, out = [];
    for (const dir of [SELL, BUY]) {
      const a = cnt[dir];
      for (let i = 0; i < n; i++) {
        if (a[i] < K) continue;
        let z = i, max = a[i], core = i;
        while (z + 1 < n && a[z + 1] >= K) { z++; if (a[z] > max) { max = a[z]; core = z; } }
        const p = { dir, s: d0 + i, e: d0 + z, max, core: d0 + core, tfs: [] };
        for (const lane of cur.lanes) {
          const fams = new Set();
          for (const cell of lane.cells) if (cell.dir === dir && cell.c13.length && cell.e >= p.s && cell.s <= p.e) for (const it of cell.c13) fams.add(it.L.family);
          if (fams.size) p.tfs.push({ j: lane.j, fams: [...fams].sort((u, v) => u - v) });
        }
        out.push(p); i = z;
      }
    }
    out.sort((u, v) => v.s - u.s || v.dir - u.dir);
    cur.conf.periods = out;
    listKey = ''; listMax = LIST_STEP;
  }
  function refam() { for (const lane of cur.lanes) buildLane(lane); buildCounts(); }
  function prepare(c, det) {
    const d1 = det.tfs[0].bars;
    cur = { c, det, dataStart: d1.n ? d1.start[0] : c.li != null ? c.li : LAST - 365, conf: null,
      lanes: det.tfs.map((x) => ({ x, j: x.j, tf: x.tf, nom: nomDays(x.tf), cells: [], byBar: null, waits: [],
        // the bar in progress: the calendar bucket that holds the day in progress, from its first day (that is the
        // day in progress itself on 1D, and on any timeframe whose bucket begins today)
        prog: { s: x.bars.partial ? x.bars.partial.start : openStart(x.tf), e: x.bars.partial ? x.bars.partial.end : null } })) };
    refam();
  }

  // ---------- the date range ----------
  const leftLimit = () => cur.dataStart - Math.max(1, (END - cur.dataStart) * 0.012);
  function applyPreset() {
    const days = RANGES.find((r) => r[0] === rangeKey())[2];
    view = { t0: Math.min(Math.max(END - days, leftLimit()), END - MIN_SPAN), t1: END, custom: false };
  }
  function clampView() {
    const lo = leftLimit(), span = clamp(view.t1 - view.t0, MIN_SPAN, Math.max(MIN_SPAN, END - lo));
    if (view.t1 > END) view.t1 = END;
    view.t0 = view.t1 - span;
    if (view.t0 < lo && END - lo >= span) { view.t0 = lo; view.t1 = lo + span; }
  }
  function panBy(days) { view.t0 += days; view.t1 += days; view.custom = true; clampView(); }
  function zoomAt(px, factor) {
    const span = view.t1 - view.t0, anchor = view.t0 + clamp((px - G.plotL) / G.plotW, 0, 1) * span;
    const ns = clamp(span * factor, MIN_SPAN, Math.max(MIN_SPAN, END - leftLimit()));
    view.t0 = anchor - (anchor - view.t0) * ns / span; view.t1 = view.t0 + ns; view.custom = true; clampView();
  }
  // bring a day into the range (keeps the span) for the keyboard cursor; true when the range moved
  function reveal(day) {
    const span = view.t1 - view.t0, edge = Math.min(span * 0.02, 3);
    if (day >= view.t0 + edge && day + 1 <= view.t1 - edge) return false;
    const before = view.t0;
    view.t0 = day + 0.5 - span * (day < view.t0 + edge ? 0.15 : 0.85); view.t1 = view.t0 + span; clampView();
    if (view.t0 === before) return false;
    view.custom = true; return true;
  }

  // ---------- geometry ----------
  // The middle size: what the window leaves for the lanes under the app bar, after the panel's head, both axes and
  // tracks and the gaps. Not taken on every repaint: on a phone the window height changes while the page scrolls.
  function fitLanes() {
    const L = LANE.m, bar = document.querySelector('.appbar'), groups = TFS.filter((tf) => GROUP_BEFORE.has(tf)).length;
    const rest = (bar ? bar.offsetHeight : 53) + 60 + 2 * (AXIS_H + TRACK_H) + 12 + (TFS.length - 1) * L.gap + groups * GROUP_GAP;
    fitH = clamp(Math.floor((innerHeight - rest) / TFS.length), L.h, L.hMax);
  }
  function geometry() {
    const W = Math.max(240, ui.stage.clientWidth), nar = narrow(), key = laneKey(), L = key === 'm' ? { ...LANE.m, h: fitH || LANE.m.h } : LANE[key];
    const gut = nar ? 42 : 88, padR = nar ? 1 : 6;
    let y = AXIS_H + 1; const sellY = y; y += TRACK_H + 4;
    const tops = [];
    TFS.forEach((tf) => { if (GROUP_BEFORE.has(tf)) y += GROUP_GAP; tops.push(y); y += L.h + L.gap; });
    y += 4 - L.gap; const buyY = y; y += TRACK_H + 1;
    const plotW = W - padR - gut, ppd = plotW / (view.t1 - view.t0), t0 = view.t0;
    return { W, H: y + AXIS_H, nar, L, gut, plotL: gut, plotR: W - padR, plotW, ppd, sellY, buyY, tops, X: (d) => gut + (d - t0) * ppd };
  }
  // date ticks [[day, text, text with the year (day ticks only)], ...]: days, Mondays, months or years, whichever keeps
  // the texts apart. A day tick is written without its year; the axis adds the year on the first tick it draws and where
  // the year changes.
  function dateTicks(t0, t1, ppd) {
    const out = [], a = Math.ceil(t0), z = Math.floor(t1);
    const dayStep = [1, 2, 7, 14].find((k) => k * ppd >= 58);
    if (dayStep) {
      for (let d = a; d <= z; d++) {
        if (dayStep >= 7 ? (d + 3) % 7 !== 0 || (dayStep === 14 && Math.floor((d + 3) / 7) % 2 === 1) : d % dayStep !== 0) continue;
        const t = iso(d); out.push([d, t.slice(5), t]);
      }
      return out;
    }
    const y0 = new Date(a * DAY).getUTCFullYear(), y1 = new Date(z * DAY).getUTCFullYear();
    const monStep = [1, 2, 3, 6].find((k) => k * 30.44 * ppd >= 58);
    if (monStep) {
      for (let y = y0; y <= y1; y++) for (let m = 0; m < 12; m += monStep) { const d = Date.UTC(y, m, 1) / DAY; if (d >= t0 && d <= t1) out.push([d, `${y}-${String(m + 1).padStart(2, '0')}`]); }
      return out;
    }
    const yStep = [1, 2, 5, 10].find((k) => k * 365.25 * ppd >= 44) || 20;
    for (let y = y0; y <= y1; y++) { if (y % yStep) continue; const d = Date.UTC(y, 0, 1) / DAY; if (d >= t0 && d <= t1) out.push([d, String(y)]); }
    return out;
  }
  // the confirmed bar that holds a day, or -1
  function barIndexAt(bars, day) {
    let lo = 0, hi = bars.n - 1;
    if (hi < 0 || day < bars.start[0]) return -1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars.start[mid] <= day) lo = mid; else hi = mid - 1; }
    return day <= bars.end[lo] ? lo : -1;
  }
  // the confirmed bars that overlap the range: [first, last] (first > last when none)
  function visibleBars(bars) {
    const a = Math.floor(view.t0), z = Math.ceil(view.t1);
    let lo = 0, hi = bars.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bars.end[mid] < a) lo = mid + 1; else hi = mid; }
    const first = lo; hi = bars.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bars.start[mid] <= z) lo = mid + 1; else hi = mid; }
    return [first, lo - 1];
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  // the text color with the most contrast on a token color, of the theme's two ends
  function inkOn(hex) {
    const lum = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return 0.5; const f = (i) => { const v = parseInt(m[1].slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4); };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), L = lum(hex);
    return ratio(L, lum(C.fg)) >= ratio(L, lum(C.surface)) ? C.fg : C.surface;
  }
  const bandAlpha = (n) => Math.min(0.34, 0.12 + 0.04 * (n - 2));

  // ---------- the picture ----------
  function drawBase() {
    if (!cur || !ui) return;
    const g = G = geometry(), { L, X, ppd, plotL, plotR, plotW } = g, dpr = window.devicePixelRatio || 1, size = `${g.W}x${g.H}@${dpr}`;
    let ctx;
    if (size !== sized) { sized = size; ctx = BE.setupCanvas(ui.base, g.W, g.H); BE.setupCanvas(ui.over, g.W, g.H); } // the line layer has the same size
    else { ctx = ui.base.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.setLineDash([]); }
    goneSeen = false;
    const { t0, t1 } = view, a0 = Math.floor(t0), z0 = Math.ceil(t1);
    const fInk = FAM_COLOR.map((c, f) => cssVar('--fi' + f) || inkOn(c));
    const lanesTop = g.tops[0], lanesBottom = g.tops[TFS.length - 1] + L.h;
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, g.W, g.H);

    ctx.save(); ctx.beginPath(); ctx.rect(plotL, 0, plotW, g.H); ctx.clip();
    // lane grounds: where the timeframe has bars; days without a bar stay empty
    ctx.fillStyle = C.sunken;
    const ranges = cur.lanes.map((lane) => visibleBars(lane.x.bars));
    cur.lanes.forEach((lane, j) => {
      const bars = lane.x.bars, [a, z] = ranges[j], top = g.tops[j];
      let rs = null, re = 0;
      const flush = () => { if (rs !== null) { const x0 = Math.max(plotL, X(rs)), x1 = Math.min(plotR, X(re)); if (x1 > x0) ctx.fillRect(x0, top, x1 - x0, L.h); } };
      for (let i = a; i <= z; i++) { const s = bars.start[i], e = bars.end[i] + 1; if (rs !== null && s <= re) re = e; else { flush(); rs = s; re = e; } }
      if (lane.prog.s < t1) { if (rs !== null && lane.prog.s <= re) re = END; else { flush(); rs = lane.prog.s; re = END; } }
      flush();
    });
    // date grid
    const ticks = dateTicks(t0, t1, ppd);
    ctx.fillStyle = C.line;
    for (const [d] of ticks) ctx.fillRect(Math.round(X(d)), lanesTop, 1, lanesBottom - lanesTop);
    // wide bars: a border where each bar starts, so the period of a bar can be read off the lane
    ctx.fillStyle = C.surface;
    cur.lanes.forEach((lane, j) => {
      if (lane.nom * ppd < CELL_MIN_PX) return;
      const bars = lane.x.bars, [a, z] = ranges[j], top = g.tops[j];
      for (let i = a; i <= z; i++) ctx.fillRect(Math.round(X(bars.start[i])), top, 1, L.h);
      if (lane.prog.s < t1) ctx.fillRect(Math.round(X(lane.prog.s)), top, 1, L.h);
    });
    // confluence bands: stronger where more timeframes overlap
    const periods = cur.conf.periods.filter((p) => p.e >= a0 && p.s <= z0);
    ctx.fillStyle = C.hl;
    for (const p of periods) {
      const yA = g.sellY + TRACK_H, yZ = g.buyY, x0 = X(p.s), x1 = X(p.e + 1);
      if (x1 - x0 < 3) { ctx.globalAlpha = bandAlpha(p.max); ctx.fillRect(Math.round((x0 + x1) / 2 - 1.5), yA, 3, yZ - yA); continue; }
      for (let d = Math.max(p.s, a0 - 1); d <= Math.min(p.e, z0); d++) {
        const n = countAt(p.dir, d); let d2 = d;
        while (d2 < p.e && d2 < z0 && countAt(p.dir, d2 + 1) === n) d2++;
        ctx.globalAlpha = bandAlpha(n); ctx.fillRect(X(d), yA, X(d2 + 1) - X(d), yZ - yA); d = d2;
      }
    }
    ctx.globalAlpha = 1;
    cur.lanes.forEach((lane, j) => drawLane(ctx, g, lane, g.tops[j], ranges[j], fInk));
    ctx.restore();

    // gutter: timeframe names and the 13s waiting at 12
    cur.lanes.forEach((lane, j) => drawGutter(ctx, g, lane, g.tops[j], fInk));
    // tracks of the bands: sell above the lanes, buy below them
    const hlInk = inkOn(C.hl);
    ctx.textBaseline = 'middle';
    for (const [dir, y, text] of [[SELL, g.sellY, g.nar ? '매도' : '매도 13 겹침'], [BUY, g.buyY, g.nar ? '매수' : '매수 13 겹침']]) {
      ctx.font = `500 10.5px ${SANS}`; ctx.textAlign = 'right'; ctx.fillStyle = C.muted; ctx.fillText(text, plotL - 6, y + TRACK_H / 2 + 0.5);
      ctx.fillStyle = C.line; ctx.fillRect(plotL, dir === SELL ? y + TRACK_H - 1 : y, plotW, 1);
      ctx.save(); ctx.beginPath(); ctx.rect(plotL, y, plotW, TRACK_H); ctx.clip();
      ctx.font = `600 9.5px ${MONO}`; ctx.textAlign = 'center';
      for (const p of periods) {
        if (p.dir !== dir) continue;
        const x0 = X(p.s), x1 = X(p.e + 1), w = Math.max(5, Math.round(x1 - x0)), bx = Math.round(x1 - x0 < 5 ? (x0 + x1) / 2 - 2.5 : x0);
        ctx.fillStyle = C.hl; ctx.fillRect(bx, y, w, TRACK_H);
        if (w >= 12) { ctx.fillStyle = hlInk; ctx.fillText(String(p.max), bx + w / 2, y + TRACK_H / 2 + 0.5); }
      }
      ctx.restore();
    }
    // date axis, above and below
    ctx.font = `10.5px ${MONO}`; ctx.textAlign = 'center'; ctx.fillStyle = C.muted;
    let lastX = -Infinity, year = '';
    for (const [d, short, full] of ticks) {
      // a day tick carries its year when it is the first one drawn or the year has changed (a tick that does not fit is
      // skipped, so this is decided here and not when the ticks are made)
      const text = full && full.slice(0, 4) !== year ? full : short;
      const x = X(d), half = ctx.measureText(text).width / 2;
      if (x - half < plotL + 2 || x + half > plotR - 1 || x - half < lastX + 10) continue;
      ctx.textBaseline = 'middle'; ctx.fillText(text, x, AXIS_H / 2); ctx.fillText(text, x, g.H - AXIS_H / 2 + 1); lastX = x + half;
      if (full) year = full.slice(0, 4);
    }
  }

  function drawLane(ctx, g, lane, top, [a, z], fInk) {
    const { L, X, ppd, plotL, plotR, plotW } = g, x = lane.x, bars = x.bars, p = bars.partial, { t0, t1 } = view;
    const pVis = p && p.start < t1;
    // price: log scale fitted to the bars in the range
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i <= z; i++) { if (bars.l[i] < lo) lo = bars.l[i]; if (bars.h[i] > hi) hi = bars.h[i]; }
    if (pVis) { if (p.l < lo) lo = p.l; if (p.h > hi) hi = p.h; }
    // A candle stands in the middle of its bar's period. The first bar of a long timeframe begins before the coin's
    // first day, and so can the bar in progress of a young coin: their candles stand in the middle of the days the coin
    // has had, or they would be out of sight on a history that fills the width.
    const mid = (s, x1) => (X(Math.max(s, cur.dataStart)) + x1) / 2;
    if (!bars.n || !(lo < Infinity)) {
      // a quiet note: no bar in the range, or no confirmed bar at all yet. The bar in progress is still drawn, so
      // the note goes to the half of the lane where its candle is not
      const left = pVis && mid(p.start, X(END)) > plotL + plotW / 2;
      ctx.font = `10.5px ${SANS}`; ctx.textAlign = pVis ? (left ? 'left' : 'right') : 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.faint;
      ctx.fillText(bars.n ? '이 기간에는 봉이 없습니다.' : '확정 봉이 아직 없습니다.', pVis ? (left ? plotL + 10 : plotR - 10) : plotL + plotW / 2, top + L.h / 2 + 0.5);
    }
    if (lo < Infinity) {
      const yT = top + L.inset, yB = top + L.h - L.inset, f = lo > 0 ? Math.log : (v) => v;
      const fl = f(lo), fh = f(hi), ky = fh > fl ? (yB - yT) / (fh - fl) : 0;
      const Y = (v) => (ky ? yB - (f(v) - fl) * ky : (yT + yB) / 2);
      if (lane.nom * ppd >= CANDLE_MIN_PX) {
        // candles: wick and body per bar, the body 9 px at most; all rising ones and all falling ones in one fill each
        const up = new Path2D(), down = new Path2D();
        for (let i = a; i <= z; i++) {
          const x0 = X(bars.start[i]), x1 = X(bars.end[i] + 1), w = x1 - x0, bw = Math.max(1, Math.min(w * 0.72, w - 1.2, CANDLE_MAX_BODY)), cx = mid(bars.start[i], x1);
          const o = bars.o[i], c = bars.c[i], yh = Y(bars.h[i]), yl = Y(bars.l[i]), y0 = Y(Math.max(o, c)), y1 = Y(Math.min(o, c)), path = c >= o ? up : down;
          path.rect(Math.round(cx - 0.5), yh, 1, Math.max(1, yl - yh)); path.rect(cx - bw / 2, y0, bw, Math.max(1, y1 - y0));
        }
        ctx.globalAlpha = 0.66;
        ctx.fillStyle = C.up; ctx.fill(up); ctx.fillStyle = C.down; ctx.fill(down);
        if (pVis) {
          // the bar in progress: hollow, over the days it has had so far
          const x0 = X(p.start), x1 = X(END), w = x1 - x0, bw = Math.max(1, Math.min(w * 0.72, w - 1.2, CANDLE_MAX_BODY)), cx = mid(p.start, x1), wx = Math.round(cx - 0.5);
          const yh = Y(p.h), yl = Y(p.l), y0 = Y(Math.max(p.o, p.c)), y1 = Y(Math.min(p.o, p.c));
          ctx.fillStyle = ctx.strokeStyle = p.c >= p.o ? C.up : C.down; ctx.lineWidth = 1;
          ctx.fillRect(wx, yh, 1, Math.max(0, y0 - yh)); ctx.fillRect(wx, y1, 1, Math.max(0, yl - y1));
          ctx.strokeRect(Math.round(cx - bw / 2) + 0.5, Math.round(y0) + 0.5, Math.max(1, Math.round(bw) - 1), Math.max(1, Math.round(y1 - y0) - 1));
        }
        ctx.globalAlpha = 1;
      } else {
        // under 3 px a bar: per pixel column the highest high and the lowest low as a band, and the close as a line
        const n = Math.ceil(plotW) + 1, cHi = new Float64Array(n).fill(-Infinity), cLo = new Float64Array(n).fill(Infinity), cCl = new Float64Array(n).fill(NaN);
        const put = (s, e, h, l, c) => {
          const c0 = clamp(Math.floor(X(s) - plotL), 0, n - 1), c1 = clamp(Math.max(c0, Math.ceil(X(e) - plotL) - 1), 0, n - 1);
          for (let k = c0; k <= c1; k++) { if (h > cHi[k]) cHi[k] = h; if (l < cLo[k]) cLo[k] = l; cCl[k] = c; }
        };
        for (let i = a; i <= z; i++) put(bars.start[i], bars.end[i] + 1, bars.h[i], bars.l[i], bars.c[i]);
        if (pVis) put(p.start, END, p.h, p.l, p.c);
        const band = new Path2D(), line = new Path2D();
        let pen = false;
        for (let k = 0; k < n; k++) {
          if (Number.isNaN(cCl[k])) { pen = false; continue; }
          const yh = Y(cHi[k]), yc = Y(cCl[k]);
          band.rect(plotL + k, yh, 1, Math.max(1, Y(cLo[k]) - yh));
          if (pen) line.lineTo(plotL + k + 0.5, yc); else { line.moveTo(plotL + k + 0.5, yc); pen = true; }
        }
        ctx.fillStyle = C.faint; ctx.globalAlpha = 0.34; ctx.fill(band);
        ctx.globalAlpha = 1; ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.lineJoin = 'round'; ctx.stroke(line);
      }
    }
    // marks: the block of a bar and side, pixel-snapped, at least 3 px wide, 1 px short of the next bar when wide
    const stripH = L.n9 + L.n13, a0 = Math.floor(t0), z0 = Math.ceil(t1);
    const box = (s, e, dir) => {
      const x0 = X(s), x1 = X(e + 1); let bx = Math.round(x0), bw = Math.round(x1) - bx;
      if (bw >= 5) bw -= 1; if (bw < 3) { bx = Math.round((x0 + x1) / 2 - 1.5); bw = 3; }
      const sell = dir === SELL;
      return { bx, bw, sell, y9: sell ? top : top + L.h - L.n9, y13: sell ? top + L.n9 : top + L.h - stripH, yS: sell ? top : top + L.h - stripH };
    };
    // the 13 row of a cell: one slice per family, from the price outward: Sequential, Combo, Aggressive Combo
    const slices = (b, n, each) => { const hEach = L.n13 / n; for (let k = 0; k < n; k++) { const idx = b.sell ? n - 1 - k : k, ys = Math.round(b.y13 + idx * hEach), ye = Math.round(b.y13 + (idx + 1) * hEach); each(k, ys, ye - ys); } };
    // a text in a block: in the part of the block that is inside the plot, down to 8.5 px when it is long (13x2,
    // 13r), not at all when it still does not fit
    const fits = (text, w) => ctx.measureText(text).width + 2 <= w;
    const write = (text, b, yMid, weight, size, color, slack = 0) => {
      const x0 = Math.max(b.bx, plotL), x1 = Math.min(b.bx + b.bw, plotR), w = x1 - x0 + slack;
      for (let px = size; ; px -= 1) {
        ctx.font = `${weight} ${px}px ${MONO}`;
        if (fits(text, w)) break;
        if (px - 1 < 8.5) return false;
      }
      ctx.fillStyle = color; ctx.fillText(text, (x0 + x1) / 2, yMid); return true;
    };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const cell of lane.cells) {
      if (cell.e < a0 || cell.s > z0) continue;
      const b = box(cell.s, cell.e, cell.dir), n = cell.c13.length;
      if ((cell.s9 && cell.s9.gone) || cell.c13.some((it) => it.gone)) goneSeen = true;
      if (cell.s9) { ctx.globalAlpha = (cell.s9.gone ? FADE : 1) * (cell.s9.L.raw > 9 ? 0.5 : 1); ctx.fillStyle = SETUP_COLOR; ctx.fillRect(b.bx, b.y9, b.bw, L.n9); }
      if (n) {
        ctx.globalAlpha = 1; ctx.fillStyle = C.sunken; ctx.fillRect(b.bx - 1, b.sell ? b.y13 : b.y13 - 1, b.bw + 2, L.n13 + 1); // keeps the block apart from the price under it
        slices(b, n, (k, ys, h) => {
          const it = cell.c13[k];
          ctx.globalAlpha = it.gone ? FADE : 1; ctx.fillStyle = FAM_COLOR[it.L.family]; ctx.fillRect(b.bx, ys, b.bw, h);
          if (L.font && h >= L.font - 0.5) write(it.L.text, b, ys + h / 2 + 0.5, 600, L.font, fInk[it.L.family]);
        });
      } else if (L.font && cell.s9) {
        // a wide 9: the gray line becomes a box with its text
        ctx.font = `600 ${L.font}px ${MONO}`;
        if (fits(cell.s9.L.text, Math.min(b.bx + b.bw, plotR) - Math.max(b.bx, plotL) - 2)) {
          ctx.fillStyle = C.sunken; ctx.fillRect(b.bx, b.sell ? b.y13 : b.yS, b.bw, L.n13);
          ctx.strokeStyle = SETUP_COLOR; ctx.lineWidth = 1; ctx.strokeRect(b.bx + 0.5, b.yS + 0.5, b.bw - 1, stripH - 1);
          ctx.globalAlpha = cell.s9.gone ? FADE : cell.s9.L.raw > 9 ? 0.7 : 1; write(cell.s9.L.text, b, b.y13 + L.n13 / 2 + (b.sell ? 0 : 1), 600, L.font, C['setup-ink']);
        }
      } else if (L.font && cell.def.length) {
        const it = cell.def[0];
        ctx.globalAlpha = it.gone ? FADE : 1; write(it.L.text, b, b.y13 + L.n13 / 2 + 0.5, 600, L.font - 1, FAM_COLOR[it.L.family], 2);
      }
      ctx.globalAlpha = 1;
    }
    // 13s waiting at 12, on the bar in progress: outlines, stronger the nearer their price, filled when the bar
    // would complete them if it closed now
    if (lane.waits.length && lane.prog.s < t1) {
      for (const dir of [SELL, BUY]) {
        const fams = [];
        for (const w of lane.waits) if (w.d === dir && !fams.some((q) => q.f === w.f)) fams.push(w); // the nearest run of each family
        if (!fams.length) continue;
        fams.sort((u, v) => u.f - v.f);
        const b = box(lane.prog.s, END - 1, dir);
        if (b.bw < 5) { b.bx = Math.round(X(END)) - 5; b.bw = 5; }
        slices(b, fams.length, (k, ys, h) => {
          const w = fams[k], al = waitAlpha(w.fire);
          ctx.fillStyle = ctx.strokeStyle = FAM_COLOR[w.f];
          ctx.globalAlpha = al * (w.fire && w.fire.now ? 0.32 : 0.14); ctx.fillRect(b.bx, ys, b.bw, h);
          ctx.globalAlpha = al; ctx.lineWidth = 1; ctx.strokeRect(b.bx + 0.5, ys + 0.5, b.bw - 1, Math.max(1, h - 1));
        });
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawGutter(ctx, g, lane, top, fInk) {
    const { L, gut, nar } = g, mid = top + L.h / 2;
    const stacked = nar && lane.waits.length > 0; // a narrow gutter: the name above, the nearest tag below it
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = `600 ${stacked ? 10.5 : 11}px ${MONO}`;
    ctx.fillStyle = lane.x.bars.n ? C.fg : C.faint;
    ctx.fillText(lane.tf, nar ? 2 : 6, stacked ? top + 6.5 : mid + 0.5);
    if (!lane.waits.length) return;
    const tag = (w, more, yMid) => {
      const text = `${FAM_CODE[w.f]}12${ARROW[w.d]}`, extra = more > 0 ? `외 ${more}` : ''; // not "+1": that would read like the indicator's +13
      ctx.font = `10px ${SANS}`; const ew = extra ? ctx.measureText(extra).width + 3 : 0;
      ctx.font = `600 ${nar ? 8.5 : 9.5}px ${MONO}`;
      const tw = ctx.measureText(text).width, bw = Math.round(tw + (nar ? 5 : 7)), bh = nar ? 11 : 13;
      const bx = Math.round(gut - (nar ? 3 : 6) - ew - bw), by = Math.round(yMid - bh / 2), now = w.fire && w.fire.now, al = waitAlpha(w.fire);
      ctx.globalAlpha = al;
      if (now) { ctx.fillStyle = FAM_COLOR[w.f]; roundRect(ctx, bx, by, bw, bh, 3); ctx.fill(); }
      else { ctx.strokeStyle = FAM_COLOR[w.f]; ctx.lineWidth = 1.25; roundRect(ctx, bx + 0.6, by + 0.6, bw - 1.2, bh - 1.2, 3); ctx.stroke(); }
      ctx.globalAlpha = Math.max(al, 0.8); ctx.textAlign = 'center'; ctx.fillStyle = now ? fInk[w.f] : C.fg; ctx.fillText(text, bx + bw / 2, by + bh / 2 + 0.5);
      if (extra) { ctx.font = `10px ${SANS}`; ctx.textAlign = 'left'; ctx.fillStyle = C.muted; ctx.fillText(extra, bx + bw + 3, by + bh / 2 + 0.5); }
      ctx.globalAlpha = 1;
    };
    if (nar) { tag(lane.waits[0], 0, top + L.h - 6); return; }
    // sell above, buy below, as the lane's edges; each side shows its nearest and how many more wait
    const sell = lane.waits.filter((w) => w.d === SELL), buy = lane.waits.filter((w) => w.d === BUY);
    if (sell.length && buy.length) { tag(sell[0], sell.length - 1, top + 7.5); tag(buy[0], buy.length - 1, top + L.h - 7.5); }
    else if (sell.length) tag(sell[0], sell.length - 1, L.h >= 40 ? top + 9 : mid);
    else tag(buy[0], buy.length - 1, L.h >= 40 ? top + L.h - 9 : mid);
  }

  // the lines: the pinned day and the day under the mouse; and per lane the bar that holds the day (of the hovered
  // day, else of the pinned one), which shows why a 13 on a long bar counts for that day
  function drawOver() {
    if (!cur || !G || !ui) return;
    const g = G, ctx = ui.over.getContext('2d'), dpr = ui.over.width / g.W, boxDay = hover && !drag ? hover.day : pin;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.W, g.H);
    const { X, L, plotL, plotR } = g, yA = g.sellY, yZ = g.buyY + TRACK_H;
    const flag = (day, bg, fgc) => {
      const cx = X(day + 0.5), text = iso(day);
      ctx.font = `600 10.5px ${MONO}`; const tw = ctx.measureText(text).width + 10, bx = clamp(cx - tw / 2, plotL, Math.max(plotL, plotR - tw));
      for (const y of [0, g.H - AXIS_H + 1]) { ctx.fillStyle = bg; ctx.fillRect(bx, y, tw, AXIS_H - 1); ctx.fillStyle = fgc; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + tw / 2, y + (AXIS_H - 1) / 2 + 0.5); }
    };
    const line = (day, color, dash) => {
      const cx = Math.round(X(day + 0.5)) + 0.5; if (cx < plotL || cx > plotR) return false;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(cx, yA); ctx.lineTo(cx, yZ); ctx.stroke(); ctx.setLineDash([]);
      return true;
    };
    ctx.save(); ctx.beginPath(); ctx.rect(plotL, 0, g.plotW, g.H); ctx.clip();
    if (boxDay != null) {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
      cur.lanes.forEach((lane, j) => {
        const bars = lane.x.bars, i = barIndexAt(bars, boxDay);
        let s, e;
        if (i >= 0) { s = bars.start[i]; e = bars.end[i] + 1; } else if (boxDay >= lane.prog.s && boxDay <= TODAY) { s = lane.prog.s; e = END; } else return;
        const x0 = Math.round(X(s)), w = Math.round(X(e)) - x0; if (w < 4) return;
        ctx.globalAlpha = 0.09; ctx.fillStyle = C.accent; ctx.fillRect(x0, g.tops[j], w, L.h);
        ctx.globalAlpha = 0.7; ctx.strokeRect(x0 + 0.5, g.tops[j] + 0.5, w - 1, L.h - 1);
      });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (pin != null && line(pin, C.accent, [])) flag(pin, C.accent, C.surface);
    if (hover && !drag && hover.day !== pin && line(hover.day, C.fg, [3, 3])) flag(hover.day, C.fg, C.surface);
    if (laneSel != null) { ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; roundRect(ctx, 1, g.tops[laneSel] + 0.75, g.gut - (g.nar ? 2 : 4), L.h - 1.5, 4); ctx.stroke(); }
  }

  // ---------- what a day holds ----------
  // per timeframe with something on the bar that holds the day: its labels, or on the bar in progress the 13s waiting
  function rowsAt(day) {
    const out = [];
    for (const lane of cur.lanes) {
      const bars = lane.x.bars, i = barIndexAt(bars, day);
      if (i >= 0) { const cells = lane.byBar.get(i); if (cells) out.push({ lane, s: bars.start[i], e: bars.end[i], cells, waits: null }); }
      else if (day >= lane.prog.s && day <= TODAY && lane.waits.length) out.push({ lane, s: lane.prog.s, e: lane.prog.e, cells: null, waits: lane.waits });
    }
    return out;
  }
  const row = (...parts) => { const r = el('div', 'row'); for (const p of parts) if (p != null) r.append(typeof p === 'string' ? el('span', null, p) : p); return r; };
  const muted = (t) => el('span', 'm', t);
  function waitChip(w) {
    const b = el('b', 'shb-w' + (w.fire && w.fire.now ? ' now' : ''), '13');
    b.style.setProperty('--c', `var(--f${w.f})`); b.style.setProperty('--i', `var(--fi${w.f})`);
    return b;
  }
  // how far the bar in progress is from a waiting 13
  function waitText(w) {
    const f = w.fire;
    if (!f) return '가격이 한 번 움직여서는 이번 봉에서 완성되지 않습니다.';
    if (f.now) return '지금 값으로 충족';
    // p: how far the low (buy) or the high (sell) has to reach; q: where the bar may close after that. q at the
    // current price means any close on the way back completes it, so only the reach is a condition
    if (f.q === f.p) return `조건가 ${fmtPrice(f.p)} (${fmtPct(f.pct)})`;
    const reach = `${w.d === BUY ? '저가' : '고가'} 조건가 ${fmtPrice(f.p)} (${fmtPct(f.pct)})`;
    return f.qpct === 0 ? reach : `${reach} · 종가 조건가 ${fmtPrice(f.q)} (${fmtPct(f.qpct)})`;
  }
  function chipOf(it) { const c = BE.chipEl(it.L.kind, it.L.text, it.L.family); if (it.gone) c.classList.add('shb-gone'); return c; }
  function dayTip(day, laneJ, foot) {
    const out = [el('div', 'h1', dayText(day) + (day === TODAY ? ' · 진행 중인 날' : ''))];
    if (laneJ != null) {
      const lane = cur.lanes[laneJ], bars = lane.x.bars, i = barIndexAt(bars, day), p = bars.partial;
      const ohlc = (o, h, l, c) => `시 ${fmtPrice(o)} · 고 ${fmtPrice(h)} · 저 ${fmtPrice(l)} · 종 ${fmtPrice(c)}`;
      if (i >= 0) out.push(el('div', 'm', `${lane.tf} 봉 ${spanText(bars.start[i], bars.end[i])} · ${ohlc(bars.o[i], bars.h[i], bars.l[i], bars.c[i])}`));
      else if (p && day >= p.start && day <= TODAY) out.push(el('div', 'm', `${lane.tf} 진행 중인 봉 ${iso(p.start)} 시작, ${iso(p.last)}까지 반영 · ${ohlc(p.o, p.h, p.l, p.c)}`));
      else if (day < lane.prog.s || day > TODAY) out.push(el('div', 'm', `${lane.tf}에는 이 날짜의 봉이 없습니다.`));
      // the bar in progress without a closed day in it: it begins today, or TradingView has no bar on its days so far
      else out.push(el('div', 'm', lane.prog.s === TODAY ? `${lane.tf} 봉은 ${iso(day)}에 새로 시작합니다.` : `${lane.tf} 진행 중인 봉은 ${iso(lane.prog.s)}에 시작했고, 마감된 날이 아직 없습니다.`));
    }
    for (const dir of [SELL, BUY]) { const n = countAt(dir, day); if (n >= st.k) out.push(el('div', null, `${SIDE[dir]} 13 겹침 · 타임프레임 ${n}개`)); }
    const rows = rowsAt(day);
    let gone = false;
    if (rows.length) {
      const sec = el('div', 'sec');
      for (const r of rows) {
        if (r.cells) {
          const parts = [el('b', 'num', r.lane.tf), muted(spanText(r.s, r.e))];
          for (const cell of [...r.cells].sort((u, v) => v.dir - u.dir)) {
            parts.push(el('span', null, SIDE[cell.dir]));
            for (const it of [cell.s9, ...cell.c13, ...cell.def]) if (it) { parts.push(chipOf(it)); if (it.gone) gone = true; }
          }
          sec.append(row(...parts));
        } else {
          for (const w of r.waits.slice(0, 3)) sec.append(row(el('b', 'num', r.lane.tf), muted('진행 중인 봉'), waitChip(w), `${SIDE[w.d]} 쪽 대기`, muted(waitText(w))));
          if (r.waits.length > 3) sec.append(row(el('b', 'num', r.lane.tf), muted(`대기 중인 13이 ${r.waits.length - 3}개 더 있습니다.`)));
        }
      }
      out.push(sec);
    } else out.push(el('div', 'm', '이 날짜가 속한 봉에는 9나 13이 없습니다.'));
    if (gone) out.push(el('div', 'shb-tipfoot', '흐린 라벨은 TradingView 차트에서는 지워진 라벨입니다.'));
    if (foot) out.push(el('div', 'shb-tipfoot', foot));
    return out;
  }
  // the same in one line of text, for screen readers
  function dayLine(day) {
    const parts = [dayText(day)];
    for (const dir of [SELL, BUY]) { const n = countAt(dir, day); if (n >= st.k) parts.push(`${SIDE[dir]} 13 겹침, 타임프레임 ${n}개`); }
    const rows = rowsAt(day);
    for (const r of rows) {
      if (r.cells) for (const cell of r.cells) parts.push(`${r.lane.tf} ${SIDE[cell.dir]} ${[cell.s9, ...cell.c13, ...cell.def].filter(Boolean).map((it) => (it.L.family != null ? FAM_NAME[it.L.family] + ' ' : '') + it.L.text).join(', ')}`);
      else parts.push(`${r.lane.tf} 진행 중인 봉, 대기 중인 13 ${r.waits.length}개`);
    }
    if (!rows.length) parts.push('9나 13이 없습니다');
    return parts.join('. ') + '.';
  }

  // next-bar conditions in words (the wording of the screener's trigText, as full sentences)
  const SRC_KO = { o: '시가', h: '고가', l: '저가', c: '종가', hl: '고가와 저가의 차이' };
  const OP_KO = { '<': '미만', '<=': '이하', '>': '초과', '>=': '이상' };
  const condText = ([s, op, v]) => `${SRC_KO[s] || s}가 ${fmtPrice(v)} ${OP_KO[op] || op}`;
  const groupText = (grp) => grp.map(condText).join('이고 ');
  function anyText(any) {
    // "the close or the open at one level" reads better as one clause
    const one = any.every((grp) => grp.length === 1 && grp[0][1] === any[0][0][1] && grp[0][2] === any[0][0][2] && SRC_KO[grp[0][0]] && grp[0][0] !== 'hl');
    if (one && any.length > 1) return `${any.map((grp) => SRC_KO[grp[0][0]]).join('나 ')}가 ${fmtPrice(any[0][0][2])} ${OP_KO[any[0][0][1]]}`;
    return any.map(groupText).join('이거나 ');
  }
  function trigText(t) {
    const parts = [];
    if (t.all && t.all.length) parts.push(groupText(t.all));
    if (t.any && t.any.length && !t.any.some((grp) => !grp.length)) parts.push(anyText(t.any));
    let s = parts.length ? `진행 중인 봉의 ${parts.join('이고, ')}이면 13이 완성됩니다.` : '진행 중인 봉이 마감하면 가격과 상관없이 13이 완성됩니다.';
    if (t.unless && t.unless.some((grp) => !grp.length)) s += ' 다만 이번 봉에서는 카운트다운이 취소되어 완성되지 않습니다.';
    else if (t.unless && t.unless.length) s += ` 다만 ${t.unless.map(groupText).join(' 또는 ')}이면 취소됩니다.`;
    return s;
  }
  // a timeframe's state now, for the gutter
  function laneTip(lane) {
    const x = lane.x, bars = x.bars, p = bars.partial, out = [el('div', 'h1', `${cur.c.s} · ${lane.tf}`)];
    out.push(el('div', 'm', bars.n ? `확정 봉 ${nf(bars.n)}개 · 마지막 확정 봉 ${spanText(bars.start[bars.n - 1], bars.end[bars.n - 1])}` : '확정 봉이 아직 없습니다.'));
    if (p) out.push(el('div', 'm', `진행 중인 봉 ${iso(p.start)} 시작, ${iso(p.last)}까지 반영`));
    const best = new Map(); // family and side -> the highest count among its active countdowns
    for (const r of x.runs) if (BE.famOn(r.family)) { const k = r.family * 2 + (r.direction === SELL ? 1 : 0); if (!(best.get(k) >= r.n)) best.set(k, r.n); }
    if (best.size) out.push(el('div', 'm', '진행 중인 카운트다운: ' + [...best.keys()].sort((u, v) => u - v).map((k) => `${FAM_NAME[k >> 1]} ${SIDE[k & 1 ? SELL : BUY]} ${best.get(k)}`).join(' · ')));
    if (!lane.waits.length) { out.push(el('div', 'm', '12에서 대기 중인 13이 없습니다.')); return out; }
    for (const w of lane.waits.slice(0, 4)) {
      const sec = el('div', 'sec');
      sec.append(row(waitChip(w), `${FAM_NAME[w.f]} ${SIDE[w.d]} 쪽 · 카운트다운 12`, w.o != null ? muted(`출발 봉 ${iso(w.o)}`) : null));
      sec.append(el('div', null, waitText(w)), el('div', 'm', trigText(w.t)));
      out.push(sec);
    }
    if (lane.waits.length > 4) out.push(el('div', 'shb-tipfoot', `대기 중인 13이 ${lane.waits.length - 4}개 더 있습니다.`));
    return out;
  }

  // ---------- under the picture ----------
  function syncHead() {
    const has = pin != null;
    ui.pinHint.hidden = has; for (const n of ui.pinParts) n.hidden = !has;
    if (has) { ui.pinDate.textContent = dayText(pin); ui.pinPrev.disabled = pin <= cur.dataStart; ui.pinNext.disabled = pin >= TODAY; }
    ui.span.textContent = `${iso(Math.ceil(view.t0))} ~ ${iso(Math.min(TODAY, Math.ceil(view.t1) - 1))}`;
    ui.rangeCtl.sync(); ui.laneCtl.sync(); ui.kCtl.sync();
  }
  function renderList() {
    const ps = cur.conf.periods, a = Math.floor(view.t0), z = Math.ceil(view.t1);
    const vis = []; ps.forEach((p, i) => { if (p.e >= a && p.s < z) vis.push(i); });
    const key = [cur.c.slug, st.k, BE.state.fam.join(''), vis.length, vis[0], vis[vis.length - 1], listMax].join('|');
    if (key !== listKey) {
      listKey = key;
      ui.listNote.textContent = vis.length
        ? `보이는 기간에 ${vis.length}개가 있습니다.${ps.length > vis.length ? ` 전체 이력에는 ${ps.length}개가 있습니다.` : ''}`
        : `보이는 기간에는 타임프레임 ${st.k}개 이상에서 13이 겹친 구간이 없습니다.${ps.length ? ` 전체 이력에는 ${ps.length}개가 있습니다.` : ''}`;
      const frag = document.createDocumentFragment();
      for (const i of vis.slice(0, listMax)) {
        const p = ps[i], b = el('button', 'shb-row'); b.type = 'button'; b.dataset.i = i;
        b.append(el('span', 'd', p.s === p.e ? iso(p.s) : `${iso(p.s)} ~ ${iso(p.e)}`), el('span', 'sd', `${SIDE[p.dir]} 13 ${ARROW[p.dir]}`), el('span', 'n', `동시에 최대 ${p.max}개`));
        const tfs = el('span', 'tfs');
        for (const t of p.tfs) { const s = el('span', 'shb-tf'); s.append(el('b', null, TFS[t.j])); for (const f of t.fams) { const k = el('i'); k.style.setProperty('--c', `var(--f${f})`); k.title = FAM_NAME[f]; s.append(k); } tfs.append(s); }
        b.append(tfs); frag.append(b);
      }
      ui.list.replaceChildren(frag);
      if (vis.length > listMax) { const more = el('button', 'btn sm', `${vis.length - listMax}개 더 보기`); more.type = 'button'; more.dataset.more = '1'; ui.list.append(more); }
    }
    for (const b of ui.list.querySelectorAll('.shb-row')) { const p = ps[Number(b.dataset.i)]; b.setAttribute('aria-pressed', String(pin != null && p && pin >= p.s && pin <= p.e)); }
  }
  function renderNotes() {
    const leg = ui.legend; leg.replaceChildren();
    const item = (...parts) => { const s = el('span'); for (const p of parts) s.append(typeof p === 'string' ? document.createTextNode(p) : p); leg.append(s); };
    const sw = (cls) => el('i', 'shb-sw ' + cls);
    for (const f of BE.FAMS) item(BE.chipEl('C', '13', f), `${FAM_NAME[f]} 13`);
    item(BE.chipEl('S', '9'), '9');
    const rep = BE.chipEl('S', '9'); rep.style.opacity = '.5'; item(rep, '반복 9');
    if (BE.FAMS.includes(0)) item(BE.chipEl('I', '+13', 0), '13이 미뤄진 봉 (봉이 넓을 때만 표시)');
    const w = el('b', 'shb-w', `${FAM_CODE[BE.FAMS[0]]}12▼`); w.style.setProperty('--c', `var(--f${BE.FAMS[0]})`);
    item(w, '12에서 대기 중인 13');
    item(BE.FAMS.map((f) => `${FAM_CODE[f]} ${FAM_NAME[f]}`).join(' · '));
    item('▼ 매수 쪽 · ▲ 매도 쪽');
    item(sw('band'), '13이 겹친 구간');
    item(sw('prog'), '진행 중인 봉');
    if (goneNoted) item(sw('gone'), 'TradingView 차트에서는 지워진 라벨');
    ui.hint.textContent = '줄마다 위 가장자리가 매도 쪽이고 아래 가장자리가 매수 쪽입니다. 색 블록은 13이고 회색 선은 9이며, 블록의 폭은 그 봉의 기간입니다.'
      + (goneNoted ? ` 흐린 표시는 TradingView 차트에서는 지워진 라벨입니다. 지표가 라벨을 최근 ${BE.OPT.labelLimit}개까지만 남기기 때문입니다.` : '');
    ui.hint2.textContent = narrow()
      ? '그림을 좌우로 끌면 기간이 옮겨지고, 날짜를 누르면 그 날짜의 9와 13이 나옵니다. 날짜를 누른 뒤 ◀와 ▶ 버튼을 누르면 선이 하루씩 움직입니다. 타임프레임 이름을 누르면 그 타임프레임의 지금 상태가 나옵니다.'
      : '그림을 좌우로 끌면 기간이 옮겨지고, Ctrl 키(Mac은 Command 키)를 누른 채 휠을 돌리면 확대되거나 축소됩니다. 그림을 한 번 누른 뒤 좌우 화살표 키를 누르면 날짜 선이 하루씩 움직이고, Shift 키를 함께 누르면 7일씩 움직입니다. 타임프레임 이름에 마우스를 올리거나 위아래 화살표 키로 타임프레임을 고르면 그 타임프레임의 지금 상태가 나옵니다.';
  }

  // ---------- drawing on demand ----------
  function paint() { drawBase(); drawOver(); syncHead(); if (goneSeen !== goneNoted) { goneNoted = goneSeen; renderNotes(); } }
  function refresh() { if (!cur || !ui) return; paint(); renderList(); }
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (cur && ui) paint(); }); }
  function showWait(node) { cur = null; ui.body.hidden = true; ui.wait.hidden = false; ui.wait.replaceChildren(...(typeof node === 'string' ? [document.createTextNode(node)] : node)); }
  function load() {
    const c = BE.coin(), token = ++seq;
    BE.tip.hide(); hover = null; laneSel = null;
    if (cur && cur.c === c) { refresh(); return; }
    if (!c) { showWait('종목을 찾을 수 없습니다.'); return; }
    if (!c.usd) { showWait('TradingView에서 이 종목의 USD 티커를 찾지 못해서 TD를 셀 수 없습니다.'); return; }
    if (!c.t) { showWait(`이번 수집에서 ${c.usd}의 TradingView 데이터를 받지 못해서 TD를 셀 수 없습니다.`); return; }
    showWait('불러오는 중입니다…');
    BE.detail(c).then((det) => {
      if (token !== seq || !ui) return; // another coin, or the variant was closed, while this one was loading
      prepare(c, det);
      ui.wait.hidden = true; ui.body.hidden = false;
      if (!view || !view.custom) applyPreset(); else clampView();
      if (pin != null) pin = clamp(pin, cur.dataStart, TODAY);
      goneNoted = null; refresh();
    }, (err) => {
      if (token !== seq || !ui) return;
      const b = el('button', 'btn', err.stale ? '새로고침' : '다시 시도'); b.type = 'button';
      b.addEventListener('click', () => (err.stale ? location.reload() : load()));
      showWait([el('p', null, err.stale ? '이 화면을 연 뒤에 새 데이터가 배포되었습니다. 새로고침하면 최신 데이터로 다시 엽니다.' : `${c.s}의 일봉 데이터를 불러오지 못했습니다 (${err.message}).`), b]);
    });
  }

  // ---------- pointer, wheel, keyboard ----------
  function locate(e) {
    const r = ui.over.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = G;
    let lane = null;
    for (let j = 0; j < g.tops.length; j++) if (y >= g.tops[j] - g.L.gap / 2 && y < g.tops[j] + g.L.h + g.L.gap / 2) { lane = j; break; }
    if (x < g.plotL) return { zone: 'gutter', lane, x, y };
    if (x > g.plotR) return { zone: 'out', lane, x, y };
    return { zone: 'plot', lane, x, y, day: clamp(Math.floor(view.t0 + (x - g.plotL) / g.ppd), Math.floor(leftLimit()), TODAY) };
  }
  const tipFoot = (day) => (day === pin ? '다시 누르면 고정을 풉니다.' : '누르면 이 날짜에 선을 고정합니다.');
  // the tooltip of the pinned day, next to its line (for the keyboard, the step buttons and the list)
  function tipAtPin() {
    if (pin == null || !G) return;
    const r = ui.over.getBoundingClientRect(), x = r.left + G.X(pin + 0.5), y = clamp(r.top + G.tops[0] + 6, 64, Math.max(64, innerHeight - 220));
    if (r.bottom < 80 || r.top > innerHeight - 80) { BE.tip.hide(); return; }
    BE.tip.show(x, y, dayTip(pin, null, null));
  }
  // how: 'pointer' (the caller shows the tooltip at the pointer), 'key', 'step' or 'list' (the tooltip goes to the line)
  function setPin(day, how, moved) {
    laneSel = null; // the tooltip goes to the day
    pin = day == null ? null : clamp(day, cur.dataStart, TODAY);
    if ((pin != null && how !== 'pointer' && reveal(pin)) || moved) refresh();
    else { drawOver(); syncHead(); renderList(); } // the range stayed: only the line moves
    ui.live.textContent = pin != null ? dayLine(pin) : '';
    if (how === 'pointer') return;
    if (pin == null) BE.tip.hide(); else tipAtPin();
  }
  // The up and down keys choose a timeframe and show its state next to its name (what the mouse gets on the name).
  function showLane(j) {
    const r = ui.over.getBoundingClientRect();
    BE.tip.show(r.left + G.gut + 2, r.top + G.tops[j] + G.L.h / 2, laneTip(cur.lanes[j]));
  }
  function setLane(j) {
    laneSel = j; hover = null; drawOver();
    if (j == null) { BE.tip.hide(); ui.live.textContent = ''; return; }
    ui.live.textContent = laneTip(cur.lanes[j]).map((n) => n.textContent).join('. ');
    // keep the chosen line in the window; the page closes tooltips when it scrolls, so the tooltip comes after that
    const r = ui.over.getBoundingClientRect(), y0 = r.top + G.tops[j], y1 = y0 + G.L.h;
    const dy = y0 < 72 ? y0 - 72 : y1 > innerHeight - 12 ? y1 - innerHeight + 12 : 0;
    if (!dy) { showLane(j); return; }
    window.scrollBy(0, dy);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (ui && cur && G && laneSel === j) showLane(j); }));
  }
  const dropLane = () => { if (laneSel != null) { laneSel = null; drawOver(); } };
  function wire() {
    const cv = ui.over;
    cv.addEventListener('pointerdown', (e) => {
      if (!cur || !G || e.button > 0) return;
      dropLane();
      const at = locate(e);
      drag = { id: e.pointerId, x: e.clientX, t0: view.t0, t1: view.t1, moved: false, plot: at.zone === 'plot' };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur || !G) return;
      if (drag && drag.id === e.pointerId && drag.plot) {
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; cv.classList.add('drag'); BE.tip.hide(); hover = null; }
        if (drag.moved) { const span = drag.t1 - drag.t0; view.t0 = drag.t0 - dx / G.ppd; view.t1 = view.t0 + span; view.custom = true; clampView(); schedule(); return; }
      }
      if (e.pointerType === 'touch') return; // a finger has no hover: a tap pins
      dropLane();
      const at = locate(e);
      cv.classList.toggle('gut', at.zone !== 'plot');
      if (at.zone === 'plot') {
        if (!hover || hover.day !== at.day || hover.lane !== at.lane) { hover = { day: at.day, lane: at.lane }; drawOver(); }
        BE.tip.show(e.clientX, e.clientY, dayTip(at.day, at.lane, tipFoot(at.day)));
      } else {
        if (hover) { hover = null; drawOver(); }
        if (at.zone === 'gutter' && at.lane != null) BE.tip.show(e.clientX, e.clientY, laneTip(cur.lanes[at.lane])); else BE.tip.hide();
      }
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag; drag = null; cv.classList.remove('drag');
      if (d.moved) { refresh(); return; }
      if (e.type !== 'pointerup' || !cur || !G) return;
      const at = locate(e);
      if (at.zone !== 'plot') { if (at.zone === 'gutter' && at.lane != null && e.pointerType !== 'mouse') BE.tip.show(e.clientX, e.clientY, laneTip(cur.lanes[at.lane])); return; }
      const now = performance.now();
      if (!clickMemo || now - clickMemo.t > 700) clickMemo = { t: now, pin };
      setPin(at.day === pin ? null : at.day, 'pointer');
      if (pin == null) { if (e.pointerType === 'touch') BE.tip.hide(); else BE.tip.show(e.clientX, e.clientY, dayTip(at.day, at.lane, tipFoot(at.day))); }
      else BE.tip.show(e.clientX, e.clientY, dayTip(pin, at.lane, e.pointerType === 'touch' ? null : tipFoot(pin)));
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') return; if (hover) { hover = null; drawOver(); } BE.tip.hide(); });
    cv.addEventListener('wheel', (e) => {
      if (!cur || !G) return;
      const zoom = e.ctrlKey || e.metaKey, side = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!zoom && !side) return; // a plain wheel scrolls the page: the picture is taller than most screens
      e.preventDefault(); BE.tip.hide(); laneSel = null;
      if (zoom) zoomAt(e.clientX - cv.getBoundingClientRect().left, Math.exp(clamp(e.deltaY * (e.deltaMode ? 0.05 : 0.01), -0.5, 0.5)));
      else panBy(e.deltaX / G.ppd);
      schedule(); clearTimeout(listTimer); listTimer = setTimeout(() => { if (cur && ui) renderList(); }, 160); // the list after the wheel has stopped
    }, { passive: false });
    cv.addEventListener('dblclick', () => {
      if (!cur) return;
      if (clickMemo) { pin = clickMemo.pin; clickMemo = null; ui.live.textContent = pin != null ? dayLine(pin) : ''; } // its two clicks pinned and unpinned a day
      BE.tip.hide(); applyPreset(); refresh();
    });
    cv.addEventListener('keydown', (e) => {
      if (!cur || !G) return;
      const k = e.key, from = pin != null ? pin : hover ? hover.day : Math.min(LAST, Math.ceil(view.t1) - 1);
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        // from no choice, down takes the first timeframe; up from the first one ends the choice. Past either end the
        // key is left to the page, which scrolls.
        const to = laneSel == null ? (k === 'ArrowDown' ? 0 : -2) : laneSel + (k === 'ArrowDown' ? 1 : -1);
        if (to === -2 || to >= TFS.length) return;
        setLane(to < 0 ? null : to);
      } else if (k === 'Escape' && laneSel != null) setLane(null);
      else if (k === 'ArrowLeft' || k === 'ArrowRight') { setPin(pin == null && !e.shiftKey ? from : from + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1), 'key'); }
      else if (k === 'Home') setPin(cur.dataStart, 'key');
      else if (k === 'End') setPin(LAST, 'key');
      else if (k === '+' || k === '=' || k === '-' || k === '_') {
        laneSel = null; BE.tip.hide();
        zoomAt(pin != null ? G.X(pin + 0.5) : G.plotL + G.plotW / 2, k === '+' || k === '=' ? 0.8 : 1.25); refresh(); tipAtPin();
      }
      else if (k === 'Escape') setPin(null, 'key');
      else return;
      e.preventDefault();
    });
    cv.addEventListener('blur', () => { dropLane(); BE.tip.hide(); });
    // a finger has no pointer to move away: a tap outside the picture closes the tooltip
    onAway = (e) => { if (e.pointerType !== 'mouse' && ui && e.target !== ui.over) BE.tip.hide(); };
    document.addEventListener('pointerdown', onAway, true);
    ui.pinPrev.addEventListener('click', () => setPin(pin - 1, 'step'));
    ui.pinNext.addEventListener('click', () => setPin(pin + 1, 'step'));
    ui.pinOff.addEventListener('click', () => setPin(null, 'step'));
    ui.list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !cur) return;
      if (b.dataset.more) { listMax += LIST_STEP; renderList(); return; }
      const p = cur.conf.periods[Number(b.dataset.i)]; if (!p) return;
      // the period into the middle of the range when a part of it is outside, then the line on its strongest day
      const span = view.t1 - view.t0, out = p.s < view.t0 || p.e + 1 > view.t1;
      if (out) { view.t0 = (p.s + p.e + 1) / 2 - span / 2; view.t1 = view.t0 + span; view.custom = true; clampView(); }
      const r = ui.stage.getBoundingClientRect(), away = r.bottom < 160 || r.top > innerHeight - 160;
      if (away) ui.stage.scrollIntoView({ block: r.bottom < 160 ? 'end' : 'start' });
      setPin(p.core, 'list', out);
      // the page closes tooltips when it scrolls: the one of the line comes back after that scroll
      if (away) requestAnimationFrame(() => requestAnimationFrame(() => { if (ui && cur && pin === p.core) tipAtPin(); }));
    });
  }

  // ---------- the variant ----------
  function mount(r) {
    root = r;
    if (!document.getElementById(CSS_ID)) { const s = document.createElement('style'); s.id = CSS_ID; s.textContent = CSS; document.head.append(s); }
    st = BE.vstate(ID, { range: 'auto', lane: 'auto', k: 3 });
    if (st.range !== 'auto' && !RANGES.some((x) => x[0] === st.range)) st.range = 'auto';
    if (st.lane !== 'auto' && !LANE[st.lane]) st.lane = 'auto';
    if (![2, 3, 4].includes(st.k)) st.k = 3;
    cur = null; view = null; G = null; hover = null; laneSel = null; drag = null; clickMemo = null; listKey = ''; listMax = LIST_STEP; sized = '';
    ui = {}; fitLanes();
    const ctl = el('div', 'panel controls'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', '시간 정렬 레인 설정');
    ui.rangeCtl = BE.seg('기간', RANGES.map((x) => [x[0], x[1]]), () => (view && view.custom ? '' : rangeKey()), (v) => { st.range = v; BE.save(); if (cur) { applyPreset(); refresh(); } });
    ui.laneCtl = BE.seg('줄 높이', SIZES, laneKey, (v) => { st.lane = v; BE.save(); fitLanes(); if (cur) refresh(); });
    ui.kCtl = BE.seg('13이 겹친 타임프레임', [[2, '2개 이상'], [3, '3개 이상'], [4, '4개 이상']], () => st.k, (v) => { st.k = v; BE.save(); if (cur) { buildPeriods(); refresh(); } });
    ctl.append(ui.rangeCtl, ui.laneCtl, ui.kCtl);

    ui.wait = el('div', 'panel loading');
    ui.body = el('div'); ui.body.style.cssText = 'display:grid;gap:12px;min-width:0;grid-template-columns:minmax(0,1fr)'; ui.body.hidden = true;
    const pic = el('div', 'panel shb-pic'), head = el('div', 'shb-head'), pinBox = el('div', 'shb-pin');
    ui.pinHint = el('span', 'hint', '그림을 누르면 그 날짜에 선을 고정합니다.');
    const btn = (text, label) => { const b = el('button', 'btn sm', text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
    ui.pinPrev = btn('◀', '하루 전으로'); ui.pinNext = btn('▶', '하루 뒤로'); ui.pinOff = btn('고정 해제');
    ui.pinDate = el('span', 'd');
    ui.pinParts = [el('span', 'lb', '고정한 날짜'), ui.pinPrev, ui.pinDate, ui.pinNext, ui.pinOff];
    pinBox.append(ui.pinHint, ...ui.pinParts);
    const spanBox = el('div', 'shb-span'); spanBox.append(document.createTextNode('보이는 기간 ')); ui.span = el('span'); spanBox.append(ui.span);
    head.append(pinBox, spanBox);
    ui.stage = el('div', 'shb-stage');
    ui.base = el('canvas'); ui.base.setAttribute('aria-hidden', 'true');
    ui.over = el('canvas', 'shb-over'); ui.over.tabIndex = 0; ui.over.setAttribute('role', 'img');
    ui.over.setAttribute('aria-label', '20개 타임프레임의 봉과 9, 13을 같은 날짜 축에 그린 그림입니다. 좌우 화살표 키로 날짜 선을 옮기고, 위아래 화살표 키로 타임프레임을 골라 그 상태를 보고, +와 - 키로 확대하거나 축소합니다.');
    ui.stage.append(ui.base, ui.over);
    ui.live = el('div', 'sr-only'); ui.live.setAttribute('aria-live', 'polite');
    const notes = el('div', 'shb-notes'); ui.legend = el('div', 'legend'); ui.hint = el('p', 'hint'); ui.hint2 = el('p', 'hint'); notes.append(ui.legend, ui.hint, ui.hint2);
    pic.append(head, ui.stage, ui.live, notes);

    const lp = el('div', 'panel shb-listp'), lh = el('div', 'shb-lhead');
    ui.listNote = el('span'); lh.append(el('h2', null, '13이 겹친 구간'), ui.listNote);
    ui.list = el('div', 'shb-list');
    lp.append(lh, el('p', 'hint', '13은 그 봉이 마감해야 확정되고, 세로 띠는 13이 나온 봉의 기간 전체에 그립니다. 그래서 봉이 마감하기 전의 날짜도 띠에 들어갑니다. 구간을 누르면 그 구간에서 겹친 타임프레임이 가장 많은 날짜에 선을 고정합니다.'), ui.list);
    ui.body.append(pic, lp);
    root.append(ctl, ui.wait, ui.body);
    wire();
  }
  function render(why) {
    if (!ui) return;
    if (why === 'mount' || why === 'coin') { load(); return; }
    if (!cur) return; // still loading, or the message of a failed load is up
    if (why !== 'theme') { BE.tip.hide(); hover = null; laneSel = null; } // new colors change nothing a tooltip says
    if (why === 'fam') refam();
    else if (why === 'resize') { goneNoted = null; fitLanes(); if (!view.custom) applyPreset(); } // lane height, default range and hint follow the window
    refresh();
  }
  function unmount() {
    seq++; if (raf) cancelAnimationFrame(raf); raf = 0; clearTimeout(listTimer);
    if (onAway) document.removeEventListener('pointerdown', onAway, true); onAway = null;
    BE.tip.hide(); root = null; ui = null; cur = null; G = null; hover = null; laneSel = null; drag = null;
  }

  BE.register({
    view: 'sheet', key: 'b', name: '시간 정렬 레인',
    blurb: '20개 타임프레임을 같은 날짜 축에 위아래로 놓았습니다. 한 줄이 한 타임프레임이고, 줄마다 그 타임프레임의 봉과 9, 13을 그립니다. 여러 타임프레임의 13이 같은 시기에 겹친 구간은 세로 띠로 표시합니다.',
    good: ['여러 타임프레임의 신호가 겹치는 시기가 보임', '긴 기간의 이력을 한 장으로 확인', '겹친 구간을 날짜 목록으로 확인'],
    weak: ['줄이 낮아서 봉 모양은 자세히 보이지 않음', '봉이 좁은 타임프레임은 라벨 글자 없이 색 블록만 보임', '가격 눈금과 조건가 선이 없음'],
    mount, render, unmount,
  });
})();
