// Bird eye study, ladder view, variant A: 진행 게이지 (progress gauges).
//
// One coin, one row per timeframe. For the buy side and the sell side a row shows how far the setup has come toward 9
// and each family's countdown toward 13, and how far the newest daily close is from the price at which the next 13
// appears. Everything is read from BE.detail(c): the engine's state after the last confirmed bar (setup counts, active
// countdowns), its labels on the last four bars and its next-bar triggers with VIEW.fire. Nothing is counted here.
//
//
//   setup gauge      9 segments filled to the count the indicator would draw (raw 10 shows as 1 again, in a lighter
//                    gray), the raw count next to it; the 9th is an empty box while the next bar can show a 9; the
//                    chart's "9" / "9*" as a chip when the last bar has one
//   countdown gauge  one per enabled family: 13 segments in the family color filled to the highest count among the
//                    active origins, short lines under the counts of the other origins and "×N"; the 13th is an empty
//                    box while a countdown waits at 12, stronger the nearer its price; all 13 filled with the chart's
//                    text ("13", "13x2", "13r") when the last bar completed one; a pale chip with the bars ago for a
//                    13 of 1 to 3 bars ago; "+13" when the last bar deferred one
//   13까지           the nearest 13 trigger of the side: the distance (fire.pct) and the condition that decides at
//                    fire.p, below them the close condition at fire.q when that is another level, and a track from
//                    the current price (inner end) to 25% with a dot per 13 trigger; without a 13 trigger the 9
//                    trigger in gray, else the bars to the next 9
//   emphasis         a side with a label on the last bar or a 13 within the 임박 threshold gets a soft band
//
// Wide screens get a mirrored table (buy side left, timeframe in the middle, sell side right; the gauges fill from the
// middle outward). Narrower screens get one card per timeframe (the sell line above the buy line, as on the chart).
// The cells are the keyboard path: one tab stop, the arrow keys move through them, the focused cell shows its tooltip.
(() => {
  const { BUY, SELL, FAMS, FAM_NAME, FAM_CODE, SIDE, ARROW, OPT, el, esc, iso, nf, fmtPrice, fmtPct, chipHTML, chipEl, agoText } = BE;
  const ID = 'ladder-a';
  const RECENT = 3;     // labels up to this many bars ago are shown at the gauges and in the tooltips
  const SCALE = 0.25;   // the distance track ends at 25% of the price
  const TOP = 5;        // nearest conditions listed under the picture
  const GROUP_START = new Set(['8D', '1M']);   // as the screener table: 1D…1W | 8D…3W | 1M…12M
  // table geometry in px: timeframe column, least and greatest width of a distance column (percent + text), room at
  // the outer end of a setup / countdown gauge for its number or chip, what a gauge cell adds around them (padding, gap)
  const G = { center: 98, dist: 172, distMax: 290, pct: 42, slot9: 24, slot13: 37, pad: 8 };   // slot13 holds the longest chip, "13rx2" (in the smaller type of .lda-long)

  const CSS = `
.lda { display: grid; gap: 12px; min-width: 0; grid-template-columns: minmax(0, 1fr); --lda-hot: color-mix(in srgb, var(--hl) 11%, var(--surface)); }
.lda-msg { padding: 36px 12px; text-align: center; color: var(--muted); font-size: 13px; }
.lda-msg p { margin: 0; }
.lda-msg p + .btn { margin-top: 10px; }
.lda-sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; }

/* gauge: a row of segments, the first count first; .r puts the first count at the right (buy side of the table) */
.lda-g { display: inline-flex; flex: none; gap: 1px; align-items: center; height: var(--lda-gh, 12px); }
.lda-g.r { flex-direction: row-reverse; }
.lda-g i { flex: none; position: relative; width: var(--lda-seg, 4px); height: 2px; border-radius: 1px; background: var(--muted); opacity: .4; }
.lda-g.su i { width: var(--lda-seg9, 5px); }
.lda-g.off i { opacity: .17; }
.lda-t .lda-g.off { visibility: hidden; }
.lda-g i.on { height: 100%; background: var(--c, var(--setup)); opacity: 1; }
.lda-g.su.rep i.on { opacity: .45; }
.lda-g i.w { height: 100%; margin: 0 2px; border-radius: 2px; background: transparent; opacity: 1; box-shadow: 0 0 0 1.5px var(--c, var(--setup)); }
.lda-g i.w3 { opacity: .36; }
.lda-g i.w2 { opacity: .68; }
.lda-g i.w0 { background: color-mix(in srgb, var(--c, var(--setup)) 45%, transparent); }
.lda-g i.mk::after { content: ""; position: absolute; left: 50%; top: calc(100% + 1px); width: 2px; height: 3px; margin-left: -1px; border-radius: 1px; background: var(--fg); }

/* what stands at the outer end of a gauge: the count, how many origins, a chip */
.lda-n { font: 500 10.5px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--muted); }
.lda-n.hi { color: var(--fg); font-weight: 600; }
.lda-x { font: 500 9.5px/1 var(--font-mono); font-style: normal; color: var(--muted); }
.lda-old { display: inline-flex; align-items: flex-start; gap: 1px; }
.lda-old > b { background: color-mix(in srgb, var(--c) 30%, var(--surface)); color: var(--fg); }
.lda-old > i { font: 500 9px/1 var(--font-mono); font-style: normal; color: var(--muted); }
.lda-long > b { font-size: 9.5px; padding: 0 2px; }
.lda-xlong > b { font-size: 9px; letter-spacing: -.2px; padding: 0 2px; }
.lda-rep > b { opacity: .55; }
.lda-r9 { display: inline-flex; align-items: center; gap: 1px; }
.lda-r9 .k9 { padding: 0 2px; }
.lda-r9 .lda-n { font-size: 9px; }
.lda-p13, .lda-p9 { display: inline-block; flex: none; font: 600 11px/13px var(--font-mono); padding: 0 3px; border-radius: 4px; border: 1px solid var(--c, var(--setup)); color: var(--fg); }
.lda-p13 { background: color-mix(in srgb, var(--c) 14%, transparent); }
.lda-p13.n1 { background: color-mix(in srgb, var(--c) 26%, transparent); box-shadow: 0 0 0 1px var(--c); }
.lda-p13.n0 { background: color-mix(in srgb, var(--c) 40%, transparent); box-shadow: 0 0 0 1px var(--c); }
.lda-p9 { border-style: dashed; color: var(--setup-ink); }
.lda-p9.n0 { background: color-mix(in srgb, var(--setup) 22%, transparent); }

/* wide screens: the mirrored table */
.lda-board { width: 100%; justify-self: center; }
.lda-board.panel { padding: 0; }
.lda-t { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 12px; }
.lda-t thead th { position: sticky; z-index: 2; padding: 0 4px; background: var(--surface); color: var(--muted); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
.lda-t .h1 th { top: var(--lda-top, 0px); height: 32px; color: var(--fg); font-size: 13px; }
.lda-t .h1 th small { margin: 0 10px; font-weight: 400; font-size: 11.5px; color: var(--muted); }
.lda-t .h1 th.b { text-align: right; padding-right: 10px; border-top-left-radius: var(--r); }
.lda-t .h1 th.s { text-align: left; padding-left: 10px; border-top-right-radius: var(--r); }
.lda-t .h1 th.c { background: var(--sunken); color: var(--muted); font-size: 11.5px; line-height: 1.35; border-bottom: 1px solid var(--line); }
.lda-t .h1 th.c small { display: block; margin: 0; font-size: 10.5px; }
.lda-t .h2 th { top: calc(var(--lda-top, 0px) + 32px); height: 24px; border-bottom: 1px solid var(--line); }
.lda-t .h2 th.b { text-align: right; }
.lda-t .h2 th.s { text-align: left; }
.lda-t tbody > tr > * { padding: 6px 2px; vertical-align: top; border-top: 1px solid var(--line); }
.lda-t tbody > tr:first-child > * { border-top: 0; }
.lda-t tbody > tr.gs > * { border-top: 2px solid color-mix(in srgb, var(--muted) 40%, var(--line)); }
.lda-t tr.hb td.b, .lda-t tr.hs td.s { background: var(--lda-hot); }
.lda-t td.lda-cell:hover { background: var(--sunken); }
.lda-t .lda-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.lda-t tbody .lda-tf { padding-left: 3px; background: var(--sunken); text-align: left; white-space: nowrap; font-weight: 400; }
.lda-tf a { display: inline-block; min-width: 26px; text-align: right; font: 600 13px/16px var(--font-mono); color: var(--muted); text-decoration: none; }
.lda-tf a:hover { text-decoration: underline; }
.lda-tf .dt { margin-left: 5px; font: 400 10px/16px var(--font-mono); color: var(--muted); }
.lda-tf .no { margin-left: 6px; font-size: 11px; color: var(--faint); }
.lda-t tr.hot .lda-tf a { color: var(--fg); font-weight: 700; }
.lda-c > div { display: flex; align-items: center; gap: 4px; height: 16px; }
.lda-c.b > div { justify-content: flex-end; }
.lda-s { flex: none; position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: flex-end; gap: 3px; max-width: ${G.slot13}px; white-space: nowrap; }
.lda-c.su .lda-s { max-width: ${G.slot9}px; }
.lda-c.b .lda-s { flex-direction: row-reverse; }

/* the distance column: percent and text, the distance track under them (mirrored on the buy side) */
.lda-d { font-size: 11px; }
.lda-dl { display: grid; column-gap: 4px; align-items: start; min-height: 16px; }
.lda-d.s .lda-dl { grid-template-columns: ${G.pct}px minmax(0, 1fr); }
.lda-d.b .lda-dl { grid-template-columns: minmax(0, 1fr) ${G.pct}px; }
.lda-dl > * { min-width: 0; }
.lda-dt { line-height: 16px; overflow-wrap: anywhere; }
.lda-d.b .lda-dt, .lda-d.b .lda-w2 { text-align: right; }
.lda-dp { justify-self: end; padding: 0 2px; border-radius: 4px; font: 600 11px/16px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lda-dp.n0, .lda-dp.n1, .lda-met { background: var(--warn-bg); color: var(--warn-fg); }
.lda-dp.n3 { color: var(--muted); font-weight: 500; }
.lda-far .lda-dt { color: var(--muted); }
.lda-q, .lda-q .lda-dp, .lda-g9, .lda-g9 .lda-dp { color: var(--muted); font-weight: 400; }
.lda-idle, .lda-to9 { color: var(--faint); }
.lda-w2 { grid-column: 1 / -1; line-height: 16px; white-space: nowrap; }
.lda-met { display: inline-block; padding: 0 4px; border-radius: 4px; font-weight: 700; white-space: nowrap; }
.lda-tr { position: relative; display: block; height: 9px; max-width: 240px; margin: 1px 0 2px; }
.lda-tr.b { margin-left: auto; }
.lda-tr::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 1px; margin-top: -.5px; background: var(--line); }
.lda-tr::after { content: ""; position: absolute; top: 0; bottom: 0; width: 1px; background: var(--muted); }
.lda-tr.s::after { left: 3.5px; }
.lda-tr.b::after { right: 3.5px; }
.lda-tr i { position: absolute; top: 50%; --at: calc(var(--x) * (100% - 8px)); }
.lda-tr .z { top: 1px; bottom: 1px; width: calc(var(--at) + 4px); border-radius: 2px; background: var(--warn-bg); }
.lda-tr .st { width: var(--at); height: 2px; margin-top: -1px; border-radius: 1px; background: var(--c); }
.lda-tr .dot { z-index: 1; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%; background: var(--c); }
.lda-tr .dot.sm { width: 5px; height: 5px; margin-top: -2.5px; }
.lda-tr.s .z { left: 0; }
.lda-tr.b .z { right: 0; }
.lda-tr.s .st { left: 4px; }
.lda-tr.b .st { right: 4px; }
.lda-tr.s .dot { left: calc(var(--at) + .5px); }
.lda-tr.b .dot { right: calc(var(--at) + .5px); }
.lda-tr.s .dot.sm { left: calc(var(--at) + 1.5px); }
.lda-tr.b .dot.sm { right: calc(var(--at) + 1.5px); }
.lda-tr .n2 { opacity: .75; }
.lda-tr .n3 { opacity: .45; }
.lda-tr .st.n2 { opacity: .55; }
.lda-tr .st.cap { height: 0; margin-top: -.5px; background: none; border-top: 1px dashed var(--c); border-radius: 0; opacity: .5; }
.lda-tr .dot.cap { background: var(--surface); box-shadow: inset 0 0 0 1.5px var(--c); }
.lda-tr .dot.n0 { box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 35%, transparent); }

/* narrower screens: one card per timeframe */
.lda-sum { margin: 0; display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12px; color: var(--muted); }
.lda-sum b { color: var(--fg); font-weight: 600; }
.lda-cards { display: grid; gap: 8px; }
.lda-cards.c2 { display: block; columns: 2; column-gap: 12px; }
.lda-cards.c2 .lda-card { margin-bottom: 8px; }
.lda-card { break-inside: avoid; padding: 8px 12px 10px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); }
.lda-card.hot { border-color: color-mix(in srgb, var(--hl) 62%, var(--line)); }
.lda-ch { display: flex; align-items: baseline; gap: 8px; border-radius: 4px; }
.lda-ch a { font: 700 14px/20px var(--font-mono); color: var(--fg); text-decoration: none; }
.lda-ch .dt { font: 400 11px var(--font-mono); color: var(--muted); }
.lda-ch .no { font-size: 12px; color: var(--faint); }
.lda-tag { margin-left: auto; padding: 0 7px; border-radius: 999px; background: var(--warn-bg); color: var(--warn-fg); font-size: 11px; font-weight: 600; }
.lda-cs { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 4px 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); }
.lda-sl { align-self: end; font-size: 11.5px; font-weight: 600; line-height: var(--lda-gh, 12px); white-space: nowrap; }
.lda-cs.idle .lda-sl { align-self: auto; line-height: 17px; color: var(--muted); font-weight: 500; }
.lda-cs .lda-idle { font-size: 11.5px; line-height: 17px; }
.lda-cg { display: flex; flex-wrap: wrap; gap: 4px 7px; min-width: 0; }
.lda-cc { display: grid; gap: 2px; justify-items: start; border-radius: 4px; }
.lda-cc.su { min-width: 54px; }
.lda-cap { display: flex; align-items: center; gap: 3px; height: 15px; font-size: 10.5px; color: var(--muted); white-space: nowrap; }
.lda-cd { grid-column: 2; font-size: 11.5px; line-height: 17px; border-radius: 4px; }
.lda-cd .lda-dp { font-size: 11.5px; line-height: 17px; padding: 0 3px; }
.lda-dotc { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: var(--c); }
.lda-dotc.n2 { opacity: .75; }
.lda-dotc.n3 { opacity: .45; }
.lda-cards .lda-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* legend and the nearest conditions */
.lda-lg { padding: 8px 12px; row-gap: 8px; }
.lda-lg > span { gap: 6px; min-width: 0; max-width: 100%; white-space: normal; }
.lda-lg > span > * { flex: none; }
.lda-lg .lda-tr { display: inline-block; width: 64px; margin: 0; }
.lda-near { padding: 10px 14px 6px; }
.lda-near h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; font-size: 14px; }
.lda-near h2 small { font-weight: 400; font-size: 12px; color: var(--muted); }
.lda-near ol { list-style: none; margin: 6px 0 0; padding: 0; }
.lda-near li { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 2px 14px; align-items: baseline; padding: 7px 0; border-top: 1px solid var(--line); font-size: 12.5px; }
.lda-nh { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.lda-nh .tf { min-width: 30px; font: 700 13px var(--font-mono); }
.lda-nh .lda-dp { margin-left: auto; font-size: 12px; line-height: 17px; padding: 0 4px; }
.lda-near p { margin: 0; }
.lda-near p .m { color: var(--muted); }
.lda-near .lda-none { margin: 4px 0 6px; font-size: 12.5px; color: var(--muted); }
@media (max-width: 720px) {
  .lda-near li { grid-template-columns: minmax(0, 1fr); }
  .lda-nh .lda-dp { margin-left: 0; }
}

/* tooltip parts */
.lda-tp { margin-top: 1px; }
.lda-tk { font: 600 12px var(--font-mono); min-width: 16px; text-align: right; }
`;

  // ---------- model: what one timeframe shows, read from BE.detail ----------
  // A trigger `t` below is an item of BE.detail's tfs[j].trigs: { t: the engine's next-bar trigger (its conditions),
  // k: 'S9' | 'S9r' | 'C13', d, f, o: origin day, fire: VIEW.fire(...) }.
  // How near a next-bar trigger is: -1 when its label appears at the current price, the distance as a ratio
  // otherwise, Infinity when no single move of the price makes it appear.
  const nearKey = (t) => (!t || !t.fire ? Infinity : t.fire.now ? -1 : Math.abs(t.fire.pct));
  const byNear = (a, b) => nearKey(a) - nearKey(b);
  // 0 appears at the current price, 1 임박 (within the threshold), 2 on the distance scale, 3 farther or not at all
  const levelOf = (t, thr) => { const k = nearKey(t); return k < 0 ? 0 : k <= thr ? 1 : k <= SCALE ? 2 : 3; };
  // the count the indicator draws for a raw setup count (td-engine.js, setup labels: with wrapSetup 10 shows as 1)
  const shown9 = (raw) => (raw <= 0 ? 0 : OPT.wrapSetup !== false ? (raw - 1) % 9 + 1 : Math.min(raw, 9));

  // One side (dir) of one timeframe x of BE.detail, for the enabled families `fams` and the 임박 threshold `thr`.
  function sideOf(x, d, fams, thr) {
    const st = x.res.state, last = x.bars.n - 1;
    const raw = d === BUY ? st.buyRaw : st.sellRaw;
    const fam = new Map(FAMS.map((f) => [f, { f, runs: [], trigs: [], labels: [] }]));
    for (const r of x.runs) if (r.direction === d && fam.has(r.family)) fam.get(r.family).runs.push(r);
    let t9 = null;
    for (const t of x.trigs) {
      if (t.d !== d) continue;
      if (t.k !== 'C13') t9 = t9 || t; else if (fam.has(t.f)) fam.get(t.f).trigs.push(t);
    }
    const nines = [], byBar = x.byBar();
    for (let ago = 0; ago <= RECENT; ago++) {
      for (const k of byBar.get(last - ago) || []) {
        const L = x.res.labels[k];
        if (L.dir !== d) continue;
        if (L.kind === 'S') { if (L.text.startsWith('9')) nines.push({ ago, text: L.text, raw: L.raw, rep: L.raw >= 18 }); }
        else if ((L.kind === 'C' || (L.kind === 'I' && L.text.startsWith('+'))) && fam.has(L.family)) {
          fam.get(L.family).labels.push({ ago, kind: L.kind, text: L.text, f: L.family, origins: L.kind === 'C' ? L.origins || [] : [L.origin] });
        }
      }
    }
    for (const F of fam.values()) {
      F.runs.sort((a, b) => b.n - a.n || a.originBar - b.originBar);
      F.trigs.sort(byNear);
      F.hi = F.runs.length ? F.runs[0].n : 0;                                   // the highest count among the active origins
      F.done = F.labels.find((L) => L.kind === 'C' && L.ago === 0) || null;     // a 13 on the last bar
      F.defer = F.labels.find((L) => L.kind === 'I' && L.ago === 0) || null;    // a +13 on the last bar
      F.old = F.labels.find((L) => L.kind === 'C' && L.ago > 0) || null;        // the newest 13 of 1 to RECENT bars ago
      F.lvl = levelOf(F.trigs[0], thr);
    }
    const t13 = fams.flatMap((f) => fam.get(f).trigs).sort(byNear);             // 13 triggers of the enabled families
    const lvl = levelOf(t13[0], thr);
    const event = nines.some((L) => L.ago === 0) || fams.some((f) => fam.get(f).done || fam.get(f).defer);
    // nothing to show on this side (the cards then say so in one line)
    const idle = !raw && !t9 && !nines.length && !fams.some((f) => fam.get(f).runs.length || fam.get(f).labels.length);
    return { d, raw, to9: VIEW.barsTo9(raw, OPT.wrapSetup !== false), nines, t9, fam, t13, lvl, event, hot: event || lvl <= 1, idle };
  }
  function rowOf(x, fams, thr) {
    const R = { j: x.j, tf: x.tf, x, n: x.bars.n, sides: null, hot: false, near: Infinity, done: false, grp: 2 };
    if (!R.n) return R;
    R.sides = { [BUY]: sideOf(x, BUY, fams, thr), [SELL]: sideOf(x, SELL, fams, thr) };
    for (const d of [BUY, SELL]) {
      const s = R.sides[d];
      R.hot = R.hot || s.hot;
      R.near = Math.min(R.near, nearKey(s.t13[0]));
      R.done = R.done || fams.some((f) => s.fam.get(f).done);
    }
    R.grp = R.done ? 0 : R.near < Infinity ? 1 : 2;
    return R;
  }
  // 13 가까운 순: a 13 on the last bar first (grp 0), then the 13 conditions by distance, met at the current price
  // first (grp 1), then the other timeframes in their own order (grp 2)
  function ordered(rows, order) {
    if (order !== 'near') return rows;
    return rows.slice().sort((a, b) => a.grp - b.grp || (a.grp === 1 ? a.near - b.near : 0) || a.j - b.j);
  }
  // how many 13 triggers of the enabled families a side has over all timeframes, and how many of them are 임박
  function totals(rows, d, thr) {
    let n = 0, imm = 0;
    for (const R of rows) if (R.sides) for (const t of R.sides[d].t13) { n++; if (levelOf(t, thr) <= 1) imm++; }
    return { n, imm };
  }

  // ---------- words ----------
  const SRC_KO = { o: '시가', h: '고가', l: '저가', c: '종가', hl: '고가와 저가의 차이' };
  const OP_KO = { '<': '미만', '<=': '이하', '>': '초과', '>=': '이상' };
  const NOT_OP = { '<': '>=', '<=': '>', '>': '<=', '>=': '<' };
  // The condition of an engine trigger that decides at price x (fire.p or fire.q): the one whose threshold is x or,
  // for a strict comparison, the double next to x. An `unless` group of one condition counts with its comparison
  // turned round. `prefer` lists the sources to take first. null when no threshold of the trigger is at x.
  function condAt(trigger, x, prefer) {
    const list = [...(trigger.all || [])];
    for (const g of trigger.any || []) list.push(...g);
    for (const g of trigger.unless || []) if (g.length === 1) list.push([g[0][0], NOT_OP[g[0][1]], g[0][2]]);
    let best = null, rank = Infinity;
    for (const c of list) {
      if (c[2] !== x && VIEW.nextAfter(c[2], -1) !== x && VIEW.nextAfter(c[2], 1) !== x) continue;
      const i = prefer.indexOf(c[0]), r = i < 0 ? prefer.length : i;
      if (r < rank) { best = c; rank = r; }
    }
    return best;
  }
  const condShort = (c) => `${SRC_KO[c[0]] || c[0]} ${fmtPrice(c[2])} ${OP_KO[c[1]] || c[1]}`;
  // What a trigger asks of the price, in the two steps of VIEW.fire: `main` is where the price has to go (p, at
  // distance pct), `close` where the bar then has to close when that is another level (q, at qpct; null when the bar
  // may close where it is now). { now: true } when the label appears at the current price, null when it cannot.
  function ask(t) {
    const f = t.fire;
    if (!f) return null;
    if (f.now) return { now: true };
    const wick = t.d === BUY ? 'l' : 'h', two = f.q !== f.p;
    const m = condAt(t.t, f.p, two ? [wick, 'c', 'o'] : ['c', wick, 'o']);
    const out = { now: false, pct: f.pct, main: m ? condShort(m) : `${fmtPrice(f.p)}에서 마감`, close: null, qpct: null };
    if (two && f.qpct !== 0) {
      const q = condAt(t.t, f.q, ['c', 'o', wick]);
      out.close = q ? condShort(q) : `${fmtPrice(f.q)}에서 마감`;
      out.qpct = f.qpct;
    }
    return out;
  }
  const NO_FIRE = '가격이 한 번 움직여서는 충족되지 않음';
  // how far a trigger is, in words: "지금 값으로 충족" | "조건가까지 −20.1% · 종가 조건까지 −6.6%"
  const distWords = (t) => { const a = ask(t); return !a ? NO_FIRE : a.now ? '지금 값으로 충족' : `조건가까지 ${fmtPct(a.pct)}` + (a.close ? ` · 종가 조건까지 ${fmtPct(a.qpct)}` : ''); };
  // a next-bar trigger as sentences, in the wording of the screener's trigText
  const condLong = ([s, op, v]) => `${SRC_KO[s] || s}가 ${fmtPrice(v)} ${OP_KO[op] || op}`;
  const groupLong = (g) => g.map(condLong).join('이고 ');
  const outcome = (g) => (g.k === 'C13' ? `${FAM_NAME[g.f]} ${SIDE[g.d]} 13이 완성됩니다` : g.k === 'S9r' ? `${SIDE[g.d]} 쪽 반복 9가 나옵니다` : `${SIDE[g.d]} 쪽 셋업 9가 나옵니다`);
  // `trigger` = the engine's trigger (t.t), `bar` = the words for the bar it is about
  function sentence(trigger, bar) {
    const g = trigger, parts = [];
    if (g.all && g.all.length) parts.push(groupLong(g.all));
    if (g.any && g.any.length && !g.any.some((x) => !x.length)) parts.push(g.any.map(groupLong).join('이거나 '));
    let s = parts.length ? `${bar}의 ${parts.join('이고, ')}이면 ${outcome(g)}.` : `${bar}이 마감하면 가격과 상관없이 ${outcome(g)}.`;
    if (g.unless && g.unless.some((x) => !x.length)) s += ' 다만 이 봉에서는 취소됩니다.';
    else if (g.unless && g.unless.length) s += ` 다만 ${g.unless.map(groupLong).join('이거나 ')}이면 취소됩니다.`;
    return s;
  }
  // the bar a trigger is about: the one in progress, or the next one when no closed day is in it yet (as on 1D)
  const barWord = (x) => (x.bars.partial ? '진행 중인 봉' : '다음 봉');
  const to9Text = (s) => `${s.raw >= 9 ? '반복 9까지' : '9까지'} ${s.to9}봉`;
  const runOf = (x, t) => x.runs.find((r) => r.family === t.f && r.direction === t.d && r.originDay === t.o) || null;

  // ---------- pieces of the picture ----------
  // setup gauge: 9 segments filled to the displayed count; the 9th is an empty box while the next bar can show a 9
  function setupGauge(s, thr, rev) {
    const n = shown9(s.raw), wait = !!s.t9 && n === 8, lvl = levelOf(s.t9, thr);
    let h = '';
    for (let i = 1; i <= 9; i++) h += i <= n ? '<i class="on"></i>' : wait && i === 9 ? `<i class="w w${lvl}"></i>` : '<i></i>';
    return `<span class="lda-g su${rev ? ' r' : ''}${s.raw > 9 ? ' rep' : ''}${s.raw > 0 ? '' : ' off'}" aria-hidden="true">${h}</span>`;
  }
  function setupSlot(s) {
    const L = s.nines.find((x) => x.ago === 0);
    const num = `<b class="lda-n${s.t9 ? ' hi' : ''}">${s.raw}</b>`;
    // a repeated 9 keeps its raw count next to the chip, both a little smaller so that they fit the slot
    if (L) return s.raw > 9 ? `<span class="lda-r9"><span${L.rep ? ' class="lda-rep"' : ''}>${chipHTML('S', L.text)}</span>${num}</span>` : `<span${L.rep ? ' class="lda-rep"' : ''}>${chipHTML('S', L.text)}</span>`;
    return s.raw > 0 ? num : '';
  }
  // countdown gauge of one family: 13 segments filled to the highest count among the active origins; short lines
  // under the counts of the other origins; the 13th an empty box while a countdown waits at 12; all 13 filled when a
  // 13 was completed on the last bar
  function runGauge(F, rev) {
    const full = !!F.done, hi = full ? 13 : F.hi, wait = !full && hi === 12;
    const marks = new Set();
    for (const r of full ? F.runs : F.runs.slice(1)) if (r.n > 0 && r.n < hi) marks.add(r.n);
    let h = '';
    for (let i = 1; i <= 13; i++) {
      const cls = i <= hi ? 'on' + (marks.has(i) ? ' mk' : '') : wait && i === 13 ? 'w w' + F.lvl : '';
      h += cls ? `<i class="${cls}"></i>` : '<i></i>';
    }
    return `<span class="lda-g${rev ? ' r' : ''}${full || F.runs.length ? '' : ' off'}" style="--c:var(--f${F.f})" aria-hidden="true">${h}</span>`;
  }
  function runSlot(F) {
    const many = F.runs.length > 1 ? `<i class="lda-x">×${F.runs.length}</i>` : '';
    // the longest texts fit the slot in smaller type: "13rx2" alone, "13x2" and "13rx2" with the bars ago next to them
    if (F.done) return F.done.text.length > 4 ? `<span class="lda-long">${chipHTML('C', F.done.text, F.f)}</span>` : chipHTML('C', F.done.text, F.f);
    if (F.defer) return chipHTML('I', F.defer.text, F.f) + many;
    if (F.old) return `<span class="lda-old${F.old.text.length > 4 ? ' lda-xlong' : F.old.text.length > 3 ? ' lda-long' : ''}">${chipHTML('C', F.old.text, F.f)}<i>${F.old.ago}</i></span>`;
    return F.runs.length ? `<b class="lda-n${F.hi === 12 ? ' hi' : ''}">${F.hi}</b>${many}` : '';
  }
  // distance track: the current price at the inner end, 25% away at the outer end, a dot per 13 trigger (the nearest
  // one large, with a line from the current price), a band for the 임박 threshold
  function track(t13, thr, rev) {
    const at = (k) => Math.round(Math.min(Math.max(k, 0), SCALE) / SCALE * 1000) / 1000;
    let h = `<i class="z" style="--x:${at(thr)}"></i>`;
    for (let i = t13.length - 1; i >= 0; i--) {
      const t = t13[i], k = nearKey(t);
      if (k === Infinity) continue;
      const cls = `n${levelOf(t, thr)}${k > SCALE ? ' cap' : ''}`, st = `--x:${at(k)};--c:var(--f${t.f})`;
      if (!i && k > 0) h += `<i class="st ${cls}" style="${st}"></i>`;
      h += `<i class="dot${i ? ' sm' : ''} ${cls}" style="${st}"></i>`;
    }
    return `<span class="lda-tr ${rev ? 'b' : 's'}" aria-hidden="true">${h}</span>`;
  }
  // What the distance column says for one side: the nearest 13 trigger of the enabled families; without one the 9
  // trigger; without that the bars to the next 9 of a running setup.
  function distOf(s) {
    const t = s.t13[0];
    if (t) return { kind: 13, t, a: ask(t), more: s.t13.length - 1 };
    if (s.t9) return { kind: 9, t: s.t9, a: ask(s.t9), more: 0 };
    return s.raw > 0 && s.to9 != null ? { kind: 0 } : null;
  }
  // the distance cell of the table: lines of percent and text (in this order on the sell side, reversed on the buy
  // side), with the track under the first line of a 13
  function distTable(s, thr, rev) {
    const D = distOf(s);
    if (!D) return '';
    const line = (cls, pct, text) => { const a = `<span class="lda-dp${pct[0]}">${pct[1]}</span>`, b = `<span class="lda-dt">${text}</span>`; return `<div class="lda-dl${cls ? ' ' + cls : ''}">${rev ? b + a : a + b}</div>`; };
    const wide = (cls, html) => `<div class="lda-dl ${cls}"><span class="lda-w2">${html}</span></div>`;
    if (D.kind === 0) return wide('lda-to9', to9Text(s));
    const a = D.a;
    if (D.kind === 9) return !a || a.now ? wide('lda-g9', `9: ${a ? '지금 값으로 충족' : NO_FIRE}`) : line('lda-g9', ['', fmtPct(a.pct)], `9: ${esc(a.main)}`);
    let h = !a ? wide('lda-q', `13: ${NO_FIRE}`) : a.now ? wide('lda-now', '<span class="lda-met">지금 값으로 충족</span>')
      : line(s.lvl === 3 ? 'lda-far' : '', [` n${s.lvl}`, fmtPct(a.pct)], esc(a.main));
    h += track(s.t13, thr, rev);
    if (a && a.close) h += line('lda-q', ['', fmtPct(a.qpct)], esc(a.close));
    if (D.more > 0) h += line('lda-q', ['', ''], `외 ${D.more}개`);
    return h;
  }
  // the same as running text, for the cards
  function distCard(s) {
    const D = distOf(s);
    if (!D) return '';
    if (D.kind === 0) return `<div class="lda-to9">${to9Text(s)}</div>`;
    const a = D.a, t = D.t;
    if (D.kind === 9) return `<div class="lda-g9">9: ${!a ? NO_FIRE : a.now ? '지금 값으로 충족' : `${esc(a.main)} (${fmtPct(a.pct)})`}</div>`;
    const dot = `<i class="lda-dotc n${s.lvl}" style="--c:var(--f${t.f})"></i>`, more = D.more > 0 ? `<span class="lda-q"> · 외 ${D.more}개</span>` : '';
    if (!a) return `<div class="lda-q">${dot}13: ${NO_FIRE}${more}</div>`;
    if (a.now) return `<div class="lda-now">${dot}<span class="lda-met">지금 값으로 충족</span>${more}</div>`;
    return `<div class="${s.lvl === 3 ? 'lda-far' : ''}">${dot}<b class="lda-dp n${s.lvl}">${fmtPct(a.pct)}</b> <span class="lda-dt">· ${esc(a.main)}</span>${a.close ? '' : more}</div>`
      + (a.close ? `<div class="lda-q">${esc(a.close)} (${fmtPct(a.qpct)})${more}</div>` : '');
  }

  // what a cell says to a screen reader
  function setupLabel(s) {
    const L = s.nines.find((x) => x.ago === 0);
    return `${SIDE[s.d]} 셋업 ` + (s.raw > 0 ? `카운트 ${s.raw}` : '없음') + (L ? `, 마지막 봉에 ${L.text}` : '');
  }
  function runLabel(F, d) {
    let s = `${FAM_NAME[F.f]} ${SIDE[d]} 카운트다운 ` + (F.runs.length ? `${F.hi}` + (F.runs.length > 1 ? `, 출발 봉 ${F.runs.length}개` : '') : '없음');
    if (F.done) s += `, 마지막 봉에 ${F.done.text}`; else if (F.defer) s += `, 마지막 봉에 ${F.defer.text}`; else if (F.old) s += `, ${F.old.ago}봉 전에 ${F.old.text}`;
    return s;
  }
  function distLabel(s) {
    const D = distOf(s);
    if (!D) return `${SIDE[s.d]} 쪽 다음 봉 조건 없음`;
    if (D.kind === 0) return `${SIDE[s.d]} 쪽 ${to9Text(s)}`;
    return `${SIDE[s.d]} ${D.kind} 조건 ${distWords(D.t)}` + (D.more > 0 ? `, 외 ${D.more}개` : '');
  }
  const sumText = (rows, d, thr) => { const x = totals(rows, d, thr); return x.n ? `13 조건 ${x.n}개 · 임박 ${x.imm}개` : '13 조건 없음'; };
  const tfLink = (R) => `<a href="${esc(BE.tvUrl(cur.det.c.usd, R.tf))}" target="_blank" rel="noopener" tabindex="-1">${R.tf}</a>`;
  const tfLabel = (R) => (R.n ? `${R.tf}, 마지막 확정 봉 ${iso(R.x.bars.start[R.n - 1])}` : `${R.tf}, 확정 봉 없음`);

  // ---------- wide screens: the mirrored table ----------
  function tableHTML(rows, fams, geo, thr) {
    const mid = fams.length + 2, rf = fams.slice().reverse();
    const col = (w) => `<col style="width:${w}px">`;
    const cols = ['<col>', ...rf.map(() => col(geo.gw)), col(geo.sw), col(G.center), col(geo.sw), ...fams.map(() => col(geo.gw)), '<col>'].join('');
    const fh = (f, sd) => `<th scope="col" class="${sd}" title="${esc(FAM_NAME[f])} 카운트다운"><i class="lda-sw" style="background:var(--f${f})"></i>${FAM_CODE[f]}</th>`;
    const head = `<tr class="h1"><th scope="colgroup" colspan="${mid}" class="b"><small>${sumText(rows, BUY, thr)}</small>매수 쪽 ${ARROW[BUY]}</th>`
      + `<th scope="col" rowspan="2" class="c">타임프레임<small>마지막 확정 봉</small></th>`
      + `<th scope="colgroup" colspan="${mid}" class="s">매도 쪽 ${ARROW[SELL]}<small>${sumText(rows, SELL, thr)}</small></th></tr>`
      + `<tr class="h2"><th scope="col" class="b">13까지</th>${rf.map((f) => fh(f, 'b')).join('')}<th scope="col" class="b">셋업</th>`
      + `<th scope="col" class="s">셋업</th>${fams.map((f) => fh(f, 's')).join('')}<th scope="col" class="s">13까지</th></tr>`;
    // the cells of one side from the middle outward: setup, one countdown per family, distance
    const sideCells = (R, d) => {
      const s = R.sides[d], rev = d === BUY;
      const gauge = (g, slot) => `<div>${rev ? `<span class="lda-s">${slot}</span>${g}` : `${g}<span class="lda-s">${slot}</span>`}</div>`;
      const out = [{ kind: 'su', d, cls: 'lda-c su', label: setupLabel(s), inner: gauge(setupGauge(s, thr, rev), setupSlot(s)) }];
      for (const f of fams) { const F = s.fam.get(f); out.push({ kind: 'f' + f, d, cls: 'lda-c', label: runLabel(F, d), inner: gauge(runGauge(F, rev), runSlot(F)) }); }
      out.push({ kind: 'ds', d, cls: 'lda-d', label: distLabel(s), inner: distTable(s, thr, rev) });
      return out;
    };
    let body = '';
    rows.forEach((R, r) => {
      const at = (c, kind, d) => `data-k="${R.j}:${d}:${kind}" data-r="${r}" data-c="${c}" tabindex="-1"`;
      const tf = (inner) => `<th scope="row" class="lda-tf lda-cell" ${at(mid, 'tf', 0)} aria-label="${esc(tfLabel(R))}">${tfLink(R)}${inner}</th>`;
      // a heavier line before 8D and 1M in timeframe order, and before the timeframes without a 13 in the other order
      const cls = [(S.order === 'tf' ? GROUP_START.has(R.tf) : r > 0 && R.grp === 2 && rows[r - 1].grp !== 2) ? 'gs' : ''];
      if (!R.sides) {
        body += `<tr class="${cls[0]}"><td colspan="${mid}"></td>${tf('<span class="no">확정 봉 없음</span>')}<td colspan="${mid}"></td></tr>`;
        return;
      }
      if (R.hot) cls.push('hot');
      if (R.sides[BUY].hot) cls.push('hb');
      if (R.sides[SELL].hot) cls.push('hs');
      const td = (x, c) => `<td class="lda-cell ${x.cls} ${x.d === BUY ? 'b' : 's'}" ${at(c, x.kind, x.d)} aria-label="${esc(x.label)}">${x.inner}</td>`;
      body += `<tr class="${cls.filter(Boolean).join(' ')}">${sideCells(R, BUY).reverse().map((x, i) => td(x, i)).join('')}`
        + tf(`<span class="dt">${iso(R.x.bars.start[R.n - 1])}</span>`)
        + `${sideCells(R, SELL).map((x, i) => td(x, mid + 1 + i)).join('')}</tr>`;
    });
    return `<table class="lda-t"><caption class="sr-only">${esc(cur.det.c.s)} 타임프레임별 셋업과 카운트다운 진행</caption><colgroup>${cols}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // ---------- narrower screens: one card per timeframe ----------
  function cardsHTML(rows, fams, geo, thr) {
    let h = `<p class="lda-sum"><span><b>매도 쪽 ${ARROW[SELL]}</b> ${sumText(rows, SELL, thr)}</span><span><b>매수 쪽 ${ARROW[BUY]}</b> ${sumText(rows, BUY, thr)}</span></p>`;
    h += `<div class="lda-cards${geo.cols === 2 ? ' c2' : ''}">`;
    rows.forEach((R, r) => {
      let c = 0;
      const at = (kind, d) => `data-k="${R.j}:${d}:${kind}" data-r="${r}" data-c="${c++}" tabindex="-1"`;
      const headCell = (inner) => `<div class="lda-ch lda-cell" ${at('tf', 0)} role="group" aria-label="${esc(tfLabel(R))}">${tfLink(R)}${inner}</div>`;
      if (!R.sides) { h += `<section class="lda-card">${headCell('<span class="no">확정 봉 없음</span>')}</section>`; return; }
      const imm = R.sides[BUY].lvl <= 1 || R.sides[SELL].lvl <= 1;
      h += `<section class="lda-card${R.hot ? ' hot' : ''}">${headCell(`<span class="dt">${iso(R.x.bars.start[R.n - 1])}</span>${imm ? '<span class="lda-tag">임박</span>' : ''}`)}`;
      for (const d of [SELL, BUY]) {
        const s = R.sides[d], name = `<span class="lda-sl">${SIDE[d]} ${ARROW[d]}</span>`;
        if (s.idle) { h += `<div class="lda-cs idle">${name}<span class="lda-idle">진행 없음</span></div>`; continue; }
        const cc = (kind, label, cap, g) => `<div class="lda-cc lda-cell${kind === 'su' ? ' su' : ''}" ${at(kind, d)} role="group" aria-label="${esc(label)}"><span class="lda-cap">${cap}</span>${g}</div>`;
        let g = cc('su', setupLabel(s), `셋업 ${setupSlot(s)}`, setupGauge(s, thr, false));
        for (const f of fams) {
          const F = s.fam.get(f);
          g += cc('f' + f, runLabel(F, d), `${FAM_CODE[f]} ${runSlot(F)}`, runGauge(F, false));
        }
        const dist = distCard(s);
        h += `<div class="lda-cs">${name}<div class="lda-cg">${g}</div>${dist ? `<div class="lda-cd lda-cell" ${at('ds', d)} role="group" aria-label="${esc(distLabel(s))}">${dist}</div>` : ''}</div>`;
      }
      h += '</section>';
    });
    return h + '</div>';
  }

  // ---------- under the picture: the nearest conditions as sentences, the legend ----------
  function nearHTML(rows, thr) {
    const all = [];
    for (const R of rows) {
      if (!R.sides) continue;
      for (const d of [SELL, BUY]) { const s = R.sides[d]; for (const t of s.t13) all.push({ R, t }); if (s.t9) all.push({ R, t: s.t9 }); }
    }
    // nearest first; at the same distance a 13 before a 9, then the longer timeframe
    const can = all.filter((x) => x.t.fire).sort((a, b) => nearKey(a.t) - nearKey(b.t) || (a.t.k === 'C13' ? 0 : 1) - (b.t.k === 'C13' ? 0 : 1) || b.R.j - a.R.j);
    const shown = Math.min(TOP, can.length);
    const note = !all.length ? '' : shown < all.length ? `다음 봉 조건 ${all.length}개 가운데 최근 종가에서 가까운 ${shown}개입니다.` : `다음 봉 조건은 모두 ${all.length}개입니다.`;
    let h = `<h2>가장 가까운 조건<small>${note}</small></h2>`;
    if (!can.length) return h + `<p class="lda-none">${all.length ? '가격이 한 번 움직여서 충족되는 조건이 없습니다.' : '다음 봉에 9나 13이 나올 조건이 없습니다.'}</p>`;
    h += '<ol>';
    for (const { R, t } of can.slice(0, TOP)) {
      const is13 = t.k === 'C13', a = ask(t), lvl = levelOf(t, thr), run = is13 ? runOf(R.x, t) : null;
      const mark = is13 ? `<b class="lda-p13 n${lvl}" style="--c:var(--f${t.f})">13</b>` : `<b class="lda-p9 n${lvl}">9</b>`;
      const dist = a.now ? '<span class="lda-now"><span class="lda-met">지금 값으로 충족</span></span>' : `<b class="lda-dp n${is13 ? lvl : 3}">${fmtPct(a.pct)}</b>`;
      const tail = [];
      if (a.close) tail.push(`종가 조건까지 ${fmtPct(a.qpct)}`);
      if (is13 && t.o != null) tail.push(`출발 봉 ${iso(t.o)}`, ...(run ? [`${run.ageBars}봉 전`] : []));
      h += `<li><div class="lda-nh"><b class="tf">${R.tf}</b>${mark}<span>${SIDE[t.d]} ${ARROW[t.d]}</span>${dist}</div><p>${esc(sentence(t.t, barWord(R.x)))}${tail.length ? ` <span class="m">${tail.join(' · ')}</span>` : ''}</p></li>`;
    }
    return h + '</ol>';
  }
  function legendHTML(fams, thr, table) {
    const f = fams.length ? fams[0] : FAMS[0];
    const fake = (n, more) => ({ f, runs: [{ n }, ...(more || []).map((m) => ({ n: m }))], hi: n, done: null, lvl: 1 });
    const item = (mark, text) => `<span>${mark}${text}</span>`;
    let h = item(setupGauge({ raw: 5, t9: null }, thr, false), '셋업 카운트(9까지)');
    if (fams.length) {
      h += item(runGauge(fake(8), false), `카운트다운(13까지, 계열 색: ${fams.map((x) => `${FAM_CODE[x]} ${FAM_NAME[x]}`).join(', ')})`);
      h += item(runGauge(fake(12), false), '12에서 13을 기다리는 칸(조건가가 가까울수록 진한 테두리)');
      h += item(`${runGauge(fake(9, [4]), false)}<i class="lda-x">×2</i>`, '출발 봉이 둘 이상(아래 짧은 선은 다른 출발 봉의 카운트)');
      h += item(chipHTML('C', '13', f), '마지막 봉에서 13 완성');
      h += item(`<span class="lda-old">${chipHTML('C', '13', f)}<i>2</i></span>`, '2봉 전에 완성');
      h += item(chipHTML('I', '+13', f), '13이 미뤄진 봉');
    }
    h += item(chipHTML('S', '9'), '마지막 봉의 셋업 9');
    if (fams.length) {
      const t = { f, fire: { now: false, pct: 0.12 } };
      h += table ? item(track([t], thr, false), `13 조건가까지의 거리(0~25%, 옅은 띠는 임박 기준 ${S.near}%)`)
        : item(`<i class="lda-dotc n2" style="--c:var(--f${f});margin:0"></i>`, '가장 가까운 13 조건(계열 색)');
      h += item(`<b class="lda-dp n1">${fmtPct(-S.near / 200)}</b>`, `임박(조건가가 최근 종가에서 ${S.near}% 안)`);
    }
    return h;
  }

  // ---------- tooltips ----------
  const tipRow = (...parts) => { const r = el('div', 'row'); for (const p of parts) r.append(typeof p === 'string' ? el('span', null, p) : p); return r; };
  const muted = (t) => el('span', 'm', t);
  const barDate = (x, ago) => iso(x.bars.start[x.bars.n - 1 - ago]);
  function trigNodes(x, t) {
    return [el('div', 'lda-tp', sentence(t.t, barWord(x))), el('div', 'm', distWords(t))];
  }
  function tipTf(R) {
    const c = cur.det.c, x = R.x, p = x.bars.partial, out = [el('div', 'h1', `${c.s} · ${R.tf}`)];
    if (!R.n) out.push(el('div', 'm', `${R.tf} 확정 봉이 아직 없습니다.`));
    else {
      const s = x.bars.start[R.n - 1], e = x.bars.end[R.n - 1];
      out.push(el('div', 'm', `마지막 확정 봉 ${iso(s)}${e !== s ? ` ~ ${iso(e)}` : ''} · 확정 봉 ${nf(R.n)}개`));
    }
    if (p) out.push(el('div', 'm', `진행 중인 봉 ${iso(p.start)} 시작, ${iso(p.last)}까지 반영 · 시 ${fmtPrice(p.o)} 고 ${fmtPrice(p.h)} 저 ${fmtPrice(p.l)} 종 ${fmtPrice(p.c)}`));
    else if (R.n) out.push(el('div', 'm', `다음 봉에는 아직 마감한 날이 없습니다. 거리는 최근 종가 ${fmtPrice(x.base.c)}에서 잽니다.`));
    const sec = el('div', 'sec'); sec.append(muted('누르거나 Enter를 치면 이 타임프레임의 TradingView 차트가 열립니다.'));
    out.push(sec);
    return out;
  }
  function tipSetup(R, d) {
    const s = R.sides[d], x = R.x, out = [el('div', 'h1', `${cur.det.c.s} · ${R.tf} · ${SIDE[d]} ${ARROW[d]} 셋업`)];
    if (!s.raw) out.push(el('div', 'm', '진행 중인 셋업이 없습니다.'));
    else {
      out.push(el('b', null, `셋업 카운트 ${s.raw}`));
      if (s.raw > 9) out.push(el('div', 'm', `9를 넘겨서 ${shown9(s.raw)}번째 칸까지 연한 색으로 채웁니다.`));
      if (s.to9 != null && !s.t9) out.push(el('div', 'm', `셋업이 끊기지 않으면 ${s.to9}봉 뒤에 ${s.raw >= 9 ? '반복 9' : '9'}가 나옵니다.`));
    }
    if (s.t9) { const sec = el('div', 'sec'); sec.append(el('b', null, '다음 봉 조건'), ...trigNodes(x, s.t9)); out.push(sec); }
    if (s.nines.length) {
      const sec = el('div', 'sec');
      for (const L of s.nines) sec.append(tipRow(chipEl('S', L.text), L.rep ? '반복 9' : L.text === '9*' ? '셋업 9 (퍼펙트)' : '셋업 9', muted(`${agoText(L.ago)} · ${barDate(x, L.ago)}`)));
      out.push(sec);
    }
    return out;
  }
  function tipRun(R, d, f) {
    const F = R.sides[d].fam.get(f), x = R.x, out = [el('div', 'h1', `${cur.det.c.s} · ${R.tf} · ${FAM_NAME[f]} ${SIDE[d]} ${ARROW[d]}`)];
    out.push(el('div', 'm', F.runs.length ? `진행 중인 카운트다운은 ${F.runs.length}개이고, 출발 봉마다 따로 셉니다.` : '진행 중인 카운트다운이 없습니다.'));
    if (F.runs.length) {
      const sec = el('div', 'sec');
      for (const r of F.runs) {
        sec.append(tipRow(el('b', 'lda-tk', String(r.n)), `출발 봉 ${iso(r.originDay)}`, muted(`${r.ageBars}봉 전`)));
        if (r.n !== 12) continue;
        const t = F.trigs.find((q) => q.o === r.originDay);
        if (t) sec.append(...trigNodes(x, t)); else sec.append(el('div', 'm', '다음 봉에 13이 나올 조건이 없습니다.'));
      }
      out.push(sec);
    }
    if (F.labels.length) {
      const sec = el('div', 'sec');
      for (const L of F.labels) {
        const from = L.origins.filter((o) => o != null).map((o) => iso(x.bars.start[o])).join(', ');
        sec.append(tipRow(chipEl(L.kind, L.text, f), L.kind === 'C' ? '13 완성' : '13 미뤄짐', muted(`${agoText(L.ago)} · ${barDate(x, L.ago)}${from ? ` · 출발 봉 ${from}` : ''}`)));
      }
      out.push(sec);
    }
    return out;
  }
  function tipDist(R, d) {
    const s = R.sides[d], x = R.x, out = [el('div', 'h1', `${cur.det.c.s} · ${R.tf} · ${SIDE[d]} ${ARROW[d]} 다음 봉 조건`)];
    const list = [...s.t13, ...(s.t9 ? [s.t9] : [])];
    if (!list.length) {
      out.push(el('div', 'm', '다음 봉에 9나 13이 나올 조건이 없습니다.'));
      if (s.raw > 0 && s.to9 != null) out.push(el('div', 'm', `셋업 카운트는 ${s.raw}이고, 끊기지 않으면 ${s.to9}봉 뒤에 ${s.raw >= 9 ? '반복 9' : '9'}가 나옵니다.`));
      return out;
    }
    out.push(el('div', 'm', `거리는 최근 종가 ${fmtPrice(x.base.c)}에서 잰 값입니다.`));
    for (const t of list) {
      const sec = el('div', 'sec'), run = t.k === 'C13' ? runOf(x, t) : null;
      const mark = el('b', `${t.k === 'C13' ? 'lda-p13' : 'lda-p9'} n${levelOf(t, S.near / 100)}`, t.k === 'C13' ? '13' : '9');
      if (t.k === 'C13') mark.style.setProperty('--c', `var(--f${t.f})`);
      const head = [mark, t.k === 'C13' ? FAM_NAME[t.f] : t.k === 'S9r' ? '반복 9' : '셋업 9'];
      if (t.k === 'C13' && t.o != null) head.push(muted(`출발 봉 ${iso(t.o)}${run ? ` · ${run.ageBars}봉 전` : ''}`));
      sec.append(tipRow(...head), ...trigNodes(x, t));
      out.push(sec);
    }
    return out;
  }
  function tipFor(key) {
    const [j, d, kind] = key.split(':'), R = cur.rows && cur.rows[Number(j)];
    if (!R) return null;
    if (kind === 'tf') return tipTf(R);
    if (!R.sides) return null;
    return kind === 'su' ? tipSetup(R, Number(d)) : kind === 'ds' ? tipDist(R, Number(d)) : tipRun(R, Number(d), Number(kind.slice(1)));
  }

  // ---------- state, drawing ----------
  let root = null, wrap = null, S = null, board = null, legend = null, nearBox = null;
  let cur = { slug: null, det: null, rows: null }, seq = 0, tipKey = null, tipNodes = null, pinned = false;
  let col = null;   // the column the up and down keys keep to
  let touch = false;   // the last pointer on the picture was a finger or a pen

  // Table when a countdown segment can be at least 4px wide, cards otherwise. pc / ps = pitch of a countdown / setup
  // segment, gh = height of a gauge.
  function geometry(W, nfam) {
    const side = G.dist + G.slot9 + nfam * G.slot13 + (nfam + 1) * G.pad;
    const pc = Math.floor((W - 2 - G.center - 2 * side - 18) / (2 * (9 + 13 * nfam)));
    if (pc >= 4) {
      const p = Math.min(pc, 8), gw = 13 * p + G.slot13 + G.pad, sw = 9 * (p + 1) + G.slot9 + G.pad;
      return { table: true, pc: p, ps: p + 1, gh: p >= 6 ? 14 : 12, gw, sw, width: G.center + 2 * (G.distMax + sw + nfam * gw) };
    }
    // a card: 26 border and padding, 48 the name of the side, 9 what the setup column's caption may need beyond its
    // gauge, per family 7 between gauges and 4 for the box of a waiting 13
    const cols = W >= 760 ? 2 : 1, cw = (W - (cols - 1) * 12) / cols;
    const p = Math.max(4, Math.min(7, Math.floor((cw - 26 - 48 - 9 - nfam * 11) / (9 + 13 * nfam))));
    return { table: false, cols, pc: p, ps: p, gh: p >= 6 ? 14 : 12 };
  }
  // the table's header sticks below the page's app bar
  function setTop() {
    const bar = document.querySelector('.appbar');
    wrap.style.setProperty('--lda-top', (bar ? Math.round(bar.getBoundingClientRect().bottom) : 0) + 'px');
  }
  function message(text, button) {
    hideTip();
    board.className = 'lda-board panel';
    board.style.maxWidth = '';
    delete board.dataset.coin;
    const box = el('div', 'lda-msg');
    box.append(el('p', null, text));
    if (button) box.append(button);
    board.replaceChildren(box);
    legend.hidden = true; nearBox.hidden = true;
  }
  function draw() {
    const det = cur.det;
    if (!det || !root) return;
    hideTip();
    const fams = FAMS.filter((f) => BE.famOn(f)), thr = S.near / 100;
    const byTf = det.tfs.map((x) => rowOf(x, fams, thr)), rows = ordered(byTf, S.order);
    cur.rows = byTf;
    const geo = geometry(wrap.clientWidth, fams.length);
    wrap.style.setProperty('--lda-seg', geo.pc - 1 + 'px');
    wrap.style.setProperty('--lda-seg9', geo.ps - 1 + 'px');
    wrap.style.setProperty('--lda-gh', geo.gh + 'px');
    setTop();
    const keep = board.querySelector('.lda-cell[tabindex="0"]'), key = keep ? keep.dataset.k : null;
    board.className = 'lda-board' + (geo.table ? ' panel' : '');
    board.style.minHeight = '';
    board.style.maxWidth = geo.table ? geo.width + 2 + 'px' : '';
    board.innerHTML = geo.table ? tableHTML(rows, fams, geo, thr) : cardsHTML(rows, fams, geo, thr);
    board.dataset.coin = det.c.slug;
    const stop = (key && board.querySelector(`.lda-cell[data-k="${key}"]`)) || board.querySelector('.lda-cell');
    if (stop) stop.tabIndex = 0;
    legend.hidden = false; legend.innerHTML = legendHTML(fams, thr, geo.table);
    nearBox.hidden = false; nearBox.innerHTML = nearHTML(rows, thr);
  }
  function load() {
    const c = BE.coin(), my = ++seq;
    cur = { slug: c ? c.slug : null, det: null, rows: null };
    board.style.minHeight = board.offsetHeight ? board.offsetHeight + 'px' : '';
    message('불러오는 중입니다…');
    BE.detail(c).then((det) => {
      if (my !== seq || !root) return;
      cur.det = det;
      draw();
    }, (err) => {
      if (my !== seq || !root) return;
      board.style.minHeight = '';
      // as the screener says it: a coin without data has nothing to try again; a newer build asks for a reload
      const noData = !c || !c.usd || !c.t, stale = !!(err && err.stale), why = err && err.message ? String(err.message) : String(err);
      let again = null;
      if (!noData) { again = el('button', 'btn', stale ? '새로고침' : '다시 시도'); again.type = 'button'; again.addEventListener('click', () => (stale ? location.reload() : load())); }
      message(noData ? `${why}.` : stale ? '이 화면을 연 뒤에 새 데이터가 배포되었습니다. 새로고침하면 최신 데이터로 다시 엽니다.' : `일봉 데이터를 불러오지 못했습니다 (${why}).`, again);
    });
  }

  // ---------- tooltips and keys ----------
  function hideTip() { BE.tip.hide(); tipKey = null; tipNodes = null; pinned = false; }
  function showTip(cell, x, y) {
    if (tipKey !== cell.dataset.k) { tipKey = cell.dataset.k; tipNodes = tipFor(tipKey); }
    if (!tipNodes) { hideTip(); return; }
    BE.tip.show(x, y, tipNodes);
  }
  const cellOf = (e) => (e.target.closest ? e.target.closest('.lda-cell') : null);
  function setStop(cell) {
    for (const x of board.querySelectorAll('.lda-cell[tabindex="0"]')) if (x !== cell) x.tabIndex = -1;
    cell.tabIndex = 0;
  }
  // Arrow keys. Sideways: the next cell of the row. Up and down: the next row, the cell nearest to the column the
  // keys came down in (remembered across a row without confirmed bars, which has only its timeframe cell).
  function move(from, dr, dc) {
    const r = Number(from.dataset.r);
    if (dc || col == null) col = Number(from.dataset.c);
    let best = null, gap = Infinity;
    for (const x of board.querySelectorAll('.lda-cell')) {
      const rows = (Number(x.dataset.r) - r) * dr, cols = Number(x.dataset.c) - col;
      const g = dc ? (rows === 0 && cols * dc > 0 ? cols * dc : Infinity) : rows > 0 ? rows * 1000 + Math.abs(cols) : Infinity;
      if (g < gap) { best = x; gap = g; }
    }
    if (!best) return;
    const keep = dc ? Number(best.dataset.c) : col;   // focusing a cell makes its own column the remembered one
    setStop(best); best.focus();
    col = keep;
  }
  function onMove(e) {
    if (e.pointerType === 'touch' || pinned) return;
    const cell = cellOf(e);
    if (cell) showTip(cell, e.clientX, e.clientY); else hideTip();
  }
  function onLeave(e) { if (e.pointerType !== 'touch' && !pinned) hideTip(); }
  // a tap keeps the tooltip of a cell open until the next tap (a mouse has the hover)
  function onDown(e) { touch = e.pointerType !== 'mouse'; }
  function onClick(e) {
    if (!touch || e.target.closest('a')) return;
    const cell = cellOf(e);
    if (!cell || (pinned && tipKey === cell.dataset.k)) { hideTip(); return; }
    showTip(cell, e.clientX, e.clientY);
    pinned = true;
  }
  function onFocusIn(e) {
    const cell = cellOf(e);
    if (!cell) return;
    setStop(cell);
    col = Number(cell.dataset.c);
    if (!cell.matches(':focus-visible')) return;
    const rc = cell.getBoundingClientRect();
    pinned = false;
    showTip(cell, rc.left + Math.min(rc.width, 120) - 14, rc.bottom - 10);
  }
  function onFocusOut() { if (!pinned) hideTip(); }
  function onKey(e) {
    const cell = cellOf(e);
    if (!cell || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (step) { e.preventDefault(); move(cell, step[0], step[1]); return; }
    if (e.key === 'Escape') { hideTip(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      const a = cell.querySelector('a');
      if (a) { e.preventDefault(); a.click(); }
    }
  }
  function onDocDown(e) { if (pinned && board && !board.contains(e.target)) hideTip(); }
  // the page hides the tooltip when it scrolls: a tap on the same cell then opens it again
  function onScroll() { tipKey = null; tipNodes = null; pinned = false; }

  BE.register({
    view: 'ladder', key: 'a', name: '진행 게이지',
    blurb: '한 종목의 20개 타임프레임을 한 줄씩 놓고, 셋업이 9까지, 카운트다운이 13까지 얼마나 진행했는지 막대로 보여 줍니다. 가운데가 타임프레임이고 왼쪽은 매수 쪽, 오른쪽은 매도 쪽이며, 바깥쪽 열은 다음 13이 나오는 조건가까지의 거리입니다. 좁은 화면에서는 타임프레임마다 카드 한 장으로 바뀌고, 매도 쪽이 위에 옵니다.',
    good: ['모든 타임프레임의 진행 상황을 한눈에 확인', '오래 멈춘 카운트다운과 임박한 카운트다운을 구별', '조건가와 거리를 숫자로 바로 확인'],
    weak: ['가격 수준끼리의 위치 관계는 숫자로만 보임', '휴대폰에서는 카드가 길게 이어짐'],
    mount(node) {
      root = node;
      if (!document.getElementById('be-ladder-a-css')) { const st = el('style'); st.id = 'be-ladder-a-css'; st.textContent = CSS; document.head.append(st); }
      S = BE.vstate(ID, { order: 'tf', near: 5 });
      if (S.order !== 'tf' && S.order !== 'near') S.order = 'tf';
      if (![3, 5, 10].includes(S.near)) S.near = 5;
      wrap = el('div', 'lda');
      const ctl = el('div', 'panel controls'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', '진행 게이지 설정');
      const set = (k) => (v) => { S[k] = v; BE.save(); draw(); };
      ctl.append(BE.seg('정렬', [['tf', '타임프레임 순서'], ['near', '13 가까운 순']], () => S.order, set('order')),
        BE.seg('임박 기준', [[3, '3%'], [5, '5%'], [10, '10%']], () => S.near, set('near')));
      board = el('div', 'lda-board panel');
      legend = el('div', 'panel legend lda-lg');
      nearBox = el('section', 'panel lda-near'); nearBox.setAttribute('aria-label', '가장 가까운 조건');
      const hint = el('p', 'hint', '칸에 마우스를 올리거나 방향키로 칸을 옮기면 출발 봉과 카운트, 다음 봉 조건이 나옵니다. 휴대폰에서는 칸을 누르면 나옵니다. 타임프레임 이름을 누르면 TradingView 차트가 열립니다. 거리는 최근 종가에서 조건가까지의 비율입니다. 13 가까운 순은 마지막 봉에서 13이 완성된 타임프레임, 지금 값으로 충족하는 타임프레임, 조건가가 가까운 타임프레임 순서로 놓습니다.');
      wrap.append(ctl, board, legend, nearBox, hint);
      root.append(wrap);
      board.addEventListener('pointermove', onMove);
      board.addEventListener('pointerleave', onLeave);
      board.addEventListener('pointerdown', onDown);
      board.addEventListener('click', onClick);
      board.addEventListener('focusin', onFocusIn);
      board.addEventListener('focusout', onFocusOut);
      board.addEventListener('keydown', onKey);
      document.addEventListener('pointerdown', onDocDown);
      addEventListener('scroll', onScroll, { passive: true });
    },
    render(why) {
      if (!root) return;
      if (why === 'theme') { setTop(); return; }      // every color is a CSS token: nothing to redraw (the fonts may have moved the app bar)
      const c = BE.coin();
      if ((why === 'fam' || why === 'resize') && cur.slug === (c ? c.slug : null)) { draw(); return; }
      load();
    },
    unmount() {
      document.removeEventListener('pointerdown', onDocDown);
      removeEventListener('scroll', onScroll);
      seq++; root = null; wrap = null; board = null; legend = null; nearBox = null; cur = { slug: null, det: null, rows: null };
    },
  });
})();
