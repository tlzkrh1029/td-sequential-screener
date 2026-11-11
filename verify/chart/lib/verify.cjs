// One state of the chart against the expectations: what the probe says, what was painted, and the engine's labels.
// verifyState returns the failures found (strings, each with the check line it belongs to) and counts; the checks call
// it for every state they visit. The rules it holds a state to:
//   identity  the probe's labels are the engine's labels of the window and the toggles, each once, nothing else
//   anchor    each at the last day of its timeframe bar that has a daily candle; a painted number's DIGITS are centered
//             on that day (within 1 px), or it stands beside its day with a line to its candle and a pointer, or right
//             on such a number of its own day and side; sell above the candles, buy under them
//   base      axes and candles are the data's; no price line above the window's highest high or under its lowest low
//   paint     text, superscript, family color (the theme's), one size for every timeframe by the chart's width, the
//             strengths; a label that TradingView has deleted is drawn apart; chips say what they hold; a timeframe is
//             shown as the zoom says (numbers, marks, or not on the chart), never numbers and marks of one kind in a
//             wide window
//   geometry  nothing overlaps, nothing covers a candle, numbers keep 3 px from the candles; in a stack the shorter
//             timeframe is nearer the candle, without exception; at most five numbers a stack
//   piles     where room is short the less important number gives way (13 before 9 before +13, the longer timeframe
//             first): nothing folded in a stack is more important than a number written in it; no 13 of 2W or longer
//             is folded while a shorter 13 is written within 40 px on its side; no 9 (or +13) is written in the
//             columns of a chip that holds a 13; a number further than a line from its candle has a line to it
const { parseChart, hit } = require('./paint.cjs');
const { Model, iso, SIZE, K_STACK, PPD_ALL13, NEAR_PX, modesOf, impOf, contrastRgb, over, rgbOf } = require('./model.cjs');

const parsePrice = (t) => { const m = /^(-?[\d,]*\.?\d+)([KMB])?$/.exec(t.trim()); if (!m) return NaN; return Number(m[1].replace(/,/g, '')) * (m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : m[2] === 'B' ? 1e9 : 1); };
const dayOfIso = (s) => Date.parse(s + 'T00:00:00Z') / 86400000;
const near = (a, b, e) => Math.abs(a - b) <= e;

function scales(p) {
  const X = (d) => p.plot.x0 + (d - p.d0 + 0.5) * p.ppd;
  const Y = (v) => p.ys.a - p.ys.b * (p.ys.log ? Math.log(v) : v);
  return { X, Y };
}

// st: the toggles in force { off, nine, def, dir, fam }.  opt.seen: Map label id -> how it was seen (for coverage);
// opt.fonts / opt.alphas / opt.stats: collected over the states of a check
function verifyState(M, slug, s, st, opt = {}) {
  const fails = [], n = {}, cnt = (k, by = 1) => { n[k] = (n[k] || 0) + by; };
  const p = s.probe, T = s.theme, dark = !!s.dark, where = `${slug} ${iso(p.d0)}~${iso(p.d1)} ppd ${p.ppd.toFixed(3)}`;
  let CAT = 'identity';
  const bad = (msg, cat) => { const k = cat || CAT; if (fails.length < 80) fails.push({ cat: k, msg: `[${where}${opt.tag ? ' ' + opt.tag : ''}] ${msg}` }); cnt('fail:' + k); };
  const { X, Y } = scales(p);
  const c = parseChart(s.frames.cBase, T);
  const size = SIZE(p.plot.w), inks = M.inks(dark), surface = T.surface;
  cnt('states');
  if (p.coin !== slug) bad(`the probe is of ${p.coin}`);

  // ---- 1. identity: the probe's labels are the engine's labels of the window, each once ----
  const exp = M.inWindow(slug, st, p.d0, p.d1);
  const eBy = new Map(); for (const L of exp) { const a = eBy.get(L.key); if (a) a.push(L); else eBy.set(L.key, [L]); }
  const pBy = new Map(); for (const L of p.labels) { const k = Model.key(L); const a = pBy.get(k); if (a) a.push(L); else pBy.set(k, [L]); }
  for (const [k, a] of eBy) { const b = pBy.get(k) || []; if (b.length !== a.length) bad(`engine label ${a[0].tf} bar ${iso(a[0].s)} ${a[0].kind} ${a[0].text} dir ${a[0].dir} f ${a[0].f}: ${a.length} expected at day ${iso(a[0].day)}, the probe has ${b.length}`); }
  for (const [k, b] of pBy) { if (!eBy.has(k)) bad(`the probe has a label the engine does not put in this window or selection: ${b[0].tf} bar ${iso(b[0].s)} ${b[0].kind} "${b[0].text}" dir ${b[0].dir} f ${b[0].f} at day ${iso(b[0].day)}`); }
  cnt('expected', exp.length); cnt('probeLabels', p.labels.length);
  // ---- 2. the day, the bar's span and the side, label by label; and how each is shown at this zoom ----
  CAT = 'anchor';
  const pair = [];   // [probe label, engine label]
  const SHOWN = ['text', 'mark', 'folded', 'strip', 'none'];
  for (const [k, b] of pBy) {
    const a = eBy.get(k); if (!a) continue;
    b.forEach((L, i) => {
      const E = a[Math.min(i, a.length - 1)]; pair.push([L, E]);
      if (L.day !== E.day) bad(`${E.tf} ${E.text} of bar ${iso(E.s)}: the probe puts it at ${iso(L.day)}, the last day of its bar with a daily candle is ${iso(E.day)}`);
      if (L.s !== E.s || L.e !== E.e) bad(`${E.tf} ${E.text}: bar span ${iso(L.s)}~${iso(L.e)} in the probe, ${iso(E.s)}~${iso(E.e)} from bars.js`);
      if (L.tf !== E.tf || L.j !== E.j) bad(`${E.tf} ${E.text}: timeframe ${L.tf} in the probe`);
      if (!!L.gone !== !!E.gone) bad(`${E.tf} ${E.text} of ${iso(E.s)}: gone ${L.gone} in the probe, ${E.gone} by the label limit`);
      if (!SHOWN.includes(L.shown)) bad(`${E.tf} ${E.text}: shown "${L.shown}"`);
    });
  }

  // ---- the scales, against the painted axes and candles ----
  CAT = 'base';
  if (c.unknown.length) bad(`${c.unknown.length} painted calls fit no part of the picture, first: ${JSON.stringify(c.unknown[0]).slice(0, 240)}`);
  if (!c.wipe) bad('the frame does not begin with a wipe of the whole canvas');
  if (c.plotL !== null && (c.plotL !== p.plot.l || c.plotB !== p.plot.b)) bad(`plot corner: painted axis at x ${c.plotL}, y ${c.plotB}; probe ${p.plot.l}, ${p.plot.b}`);
  for (const t of c.prices) {
    const v = parsePrice(t.text); cnt('axisPrices');
    if (!(v > 0) || Math.abs((t.y - 0.5) - Y(v)) > 1.0) bad(`price axis: "${t.text}" is written at y ${t.y}, the scale has ${v} at ${Y(v).toFixed(2)}`);
  }
  for (const t of c.dates) {
    let d, at; cnt('axisDates');
    if (/^\d{4}$/.test(t.text)) { d = dayOfIso(t.text + '-01-01'); at = 0; } else if (/^\d{4}-\d\d$/.test(t.text)) { d = dayOfIso(t.text + '-01'); at = 0; }
    else if (/^\d{4}-\d\d-\d\d$/.test(t.text)) { d = dayOfIso(t.text); at = 0.5; }
    else if (/^\d\d-\d\d$/.test(t.text)) { // the year: of the window's day that fits
      const cand = []; for (let y = new Date(p.d0 * 864e5).getUTCFullYear(); y <= new Date(p.d1 * 864e5).getUTCFullYear(); y++) { const dd = dayOfIso(`${y}-${t.text}`); if (dd >= p.d0 && dd <= p.d1) cand.push(dd); }
      d = cand.sort((a, b) => Math.abs(p.plot.x0 + (a - p.d0 + 0.5) * p.ppd - t.x) - Math.abs(p.plot.x0 + (b - p.d0 + 0.5) * p.ppd - t.x))[0]; at = 0.5;
    } else { bad(`date axis: cannot read "${t.text}"`); continue; }
    const want = p.plot.x0 + (d - p.d0 + at) * p.ppd;
    if (!(Math.abs(want - t.x) <= 0.51)) bad(`date axis: "${t.text}" is written at x ${t.x.toFixed(2)}, the day axis has it at ${want.toFixed(2)}`);
    // a window of four months or more is labelled by months or years, at every width
    if (p.d1 - p.d0 + 1 >= 123 && !/^\d{4}(-\d\d)?$/.test(t.text)) bad(`date axis: "${t.text}" in a window of ${p.d1 - p.d0 + 1} days, which has to be labelled by months`);
  }
  // candles: every day with a daily bar has its candle from its high to its low at its place, no other day has one
  const D = M.coin(slug).daily, d0i = M.coin(slug).d0;
  const lineLod = !!c.closeLine, dayBox = new Map(), bandExt = new Map();   // bandExt: per pixel column of the widest zooms' band, the highest high and the lowest low in it
  let winLo = Infinity, winHi = -Infinity;
  for (let d = p.d0; d <= p.d1; d++) if (M.hasBar(slug, d)) { const o = M.ohlc(slug, d); if (o.l < winLo) winLo = o.l; if (o.h > winHi) winHi = o.h; }
  // price lines: each has its price written at the axis, and none lies above the window's highest high or under its
  // lowest low (the axis' own base line is the lowest line)
  const priceLines = c.lines.filter((l) => l.y !== c.plotB);
  for (const l of priceLines) {
    cnt('priceLines');
    const t = c.prices.find((q) => Math.abs(q.y - 0.5 - l.y) <= 0.51);
    if (!t) { bad(`a price line at y ${l.y} has no price written at the axis`); continue; }
    const v = parsePrice(t.text);
    // (the written price can be shortened: the line's own place on the scale decides, half a pixel either way)
    const yHi = Y(winHi), yLo = Y(winLo);
    if (winHi > -Infinity && (l.y + 0.5 < yHi - 0.51 || l.y + 0.5 > yLo + 0.51)) bad(`a price line "${t.text}" (${v}) at y ${l.y} lies ${l.y + 0.5 < yHi ? 'above the highest high' : 'under the lowest low'} of the window (${winLo} ~ ${winHi}: y ${yHi.toFixed(1)} ~ ${yLo.toFixed(1)})`);
  }
  if (c.prices.length !== priceLines.length) bad(`${c.prices.length} prices are written at the axis for ${priceLines.length} price lines`);
  const hardAl = new Set(c.candles.filter((q) => q.cls === 'hard').map((q) => q.al));
  if (opt.stats) for (const a of hardAl) (opt.stats.hardAlpha = opt.stats.hardAlpha || new Set()).add(`${dark ? 'dark' : 'light'} ${lineLod ? 'band' : 'candle'} ${a}`);
  if (!lineLod && p.ppd < 1.25) {
    // about a pixel a day: one bar from high to low per day, and two days may share a pixel column. Each day with a
    // daily bar has its bar at its place; every painted bar is some day's.
    const fits = (q, d) => { const o = M.ohlc(slug, d), yh = Y(o.h), yl = Y(o.l), x = X(d); return q.x <= x + 0.76 && q.x + q.w >= x - 0.76 && Math.abs(q.y - yh) <= 1.01 && q.y + q.h >= yl - 1.01 && q.y + q.h <= Math.max(yl, yh + 1) + 1.51; };
    const bars = c.candles.slice().sort((a2, b2) => a2.x - b2.x), claimed = new Set();
    for (let d = p.d0; d <= p.d1; d++) {
      if (!M.hasBar(slug, d)) continue;
      cnt('candles');
      const o = M.ohlc(slug, d), x = X(d), cls = o.c >= o.o ? 'soft' : 'hard';
      const cand = bars.filter((q) => q.x <= x + 0.76 && q.x + q.w >= x - 0.76 && fits(q, d)).sort((a2, b2) => Math.abs(a2.x + a2.w / 2 - x) - Math.abs(b2.x + b2.w / 2 - x));
      // (where two days share a pixel column, the day painted last covers the other: its bar is then that one's)
      const r = cand.find((q) => q.cls === cls) || cand[0] || null;
      if (!r) { const o2 = M.ohlc(slug, d); bad(`no bar painted for ${iso(d)} from its high to its low (x ${x.toFixed(2)}, y ${Y(o2.h).toFixed(2)}~${Y(o2.l).toFixed(2)})`); continue; }
      for (const q of cand) claimed.add(q);
      dayBox.set(d, { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h });
    }
    for (const r of c.candles) if (!claimed.has(r)) bad(`a bar is painted at x ${r.x}, y ${r.y}~${r.y + r.h} that is no day's high to low`);
  } else if (!lineLod) {
    const byDay = dayBox;
    for (const r of c.candles) { const d = p.d0 + Math.floor((r.x + r.w / 2 - p.plot.x0) / p.ppd); let g = byDay.get(d); if (!g) byDay.set(d, g = { y0: Infinity, y1: -Infinity, x0: Infinity, x1: -Infinity, cls: r.cls, mixed: false }); g.y0 = Math.min(g.y0, r.y); g.y1 = Math.max(g.y1, r.y + r.h); g.x0 = Math.min(g.x0, r.x); g.x1 = Math.max(g.x1, r.x + r.w); if (g.cls !== r.cls) g.mixed = true; }
    for (let d = p.d0; d <= p.d1; d++) {
      const g = byDay.get(d), has = M.hasBar(slug, d);
      if (!has) { if (g) bad(`a candle is painted at ${iso(d)}, a day without a daily bar`); continue; }
      cnt('candles');
      if (!g) { bad(`no candle painted for ${iso(d)}`); continue; }
      const o = M.ohlc(slug, d), yh = Y(o.h), yl = Y(o.l);
      if (Math.abs(g.y0 - yh) > 1.01 || g.y1 < yl - 1.01 || g.y1 > Math.max(yl, yh + 1) + 1.51)   // (a body is at least 1 px high: at the low it may end half a pixel row under it)
        bad(`candle of ${iso(d)}: painted from y ${g.y0} to ${g.y1}, high ${o.h} and low ${o.l} are at ${yh.toFixed(2)} and ${yl.toFixed(2)}`);
      if (Math.abs((g.x0 + g.x1) / 2 - X(d)) > 1.01) bad(`candle of ${iso(d)}: painted around x ${((g.x0 + g.x1) / 2).toFixed(2)}, the day is at ${X(d).toFixed(2)}`);
      if (g.mixed || g.cls !== (o.c >= o.o ? 'soft' : 'hard')) bad(`candle of ${iso(d)}: drawn as ${g.mixed ? 'both rising and falling' : g.cls === 'soft' ? 'rising' : 'falling'}, open ${o.o} close ${o.c}`);
    }
    for (const d of byDay.keys()) if (d < p.d0 || d > p.d1) bad(`a candle is painted outside the window, at ${iso(d)}`);
  } else {
    // a band per pixel column from the highest high to the lowest low of the days in it, and the close as a line
    const cols = new Map(); for (const r of c.candles) { if (r.w !== 1) { bad(`band column ${r.w} px wide at x ${r.x}`); continue; } cols.set(r.x, r); }
    const ext = bandExt;
    for (let d = p.d0; d <= p.d1; d++) {
      if (!M.hasBar(slug, d)) continue; cnt('candles');
      const o = M.ohlc(slug, d), xa = p.plot.x0 + (d - p.d0) * p.ppd, xb = xa + p.ppd;
      for (let k = Math.floor(xa + 1e-6); k <= Math.ceil(xb - 1e-6) - 1; k++) { let e = ext.get(k); if (!e) ext.set(k, e = { hi: -Infinity, lo: Infinity }); if (o.h > e.hi) e.hi = o.h; if (o.l < e.lo) e.lo = o.l; }
    }
    for (const [k, e] of ext) {
      if (k < p.plot.l || k >= p.plot.r) continue;
      const r = cols.get(k); if (!r) { bad(`no band painted in pixel column ${k}`); continue; }
      const yh = Y(e.hi), yl = Y(e.lo);
      if (Math.abs(r.y - yh) > 0.6 || Math.abs(r.y + r.h - Math.max(yl, yh + 1)) > 0.6) bad(`band column ${k}: painted y ${r.y.toFixed(2)}~${(r.y + r.h).toFixed(2)}, the days in it reach ${yh.toFixed(2)}~${yl.toFixed(2)}`);
    }
    for (const k of cols.keys()) if (!ext.has(k)) bad(`a band is painted in pixel column ${k}, where no day has a daily bar`);
    // (a day whose middle lies on a pixel boundary may fall into either column)
    const closes = new Map(); for (let d = p.d0; d <= p.d1; d++) if (M.hasBar(slug, d)) { for (const k of new Set([Math.floor(X(d) - 1e-6), Math.floor(X(d) + 1e-6)])) (closes.get(k) || closes.set(k, []).get(k)).push(Y(M.ohlc(slug, d).c)); }
    for (const seg of c.closeLine.path) { const k = Math.floor(seg[1]); const ys = closes.get(k); if (!ys || !ys.some((y) => Math.abs(y - seg[2]) < 0.01)) { bad(`close line: point at x ${seg[1]}, y ${seg[2].toFixed(2)} is no close of a day in that column`); break; } }
  }

  // ---- 3. what is painted, against the probe and the engine ----
  CAT = 'paint';
  const key4 = (b) => `${b.x}|${b.y}|${b.w}|${b.h}`;
  const numBy = new Map(); for (const N of c.numbers) { const k = key4(N.ground); if (numBy.has(k)) bad(`two numbers are painted in the same box at ${k}: "${numBy.get(k).text}" and "${N.text}"`); numBy.set(k, N); }
  const markBy = new Map(); for (const m of c.marks) { const k = key4(m); (markBy.get(k) || markBy.set(k, []).get(k)).push(m); }
  const chipBy = new Map(); for (const ch of c.chips) chipBy.set(key4(ch), ch);
  const usedN = new Set(), usedM = new Set(), shownText = [], shownMark = [];
  // the strength a label is painted at: a 13 and a 9 full, a repeated 9 at .8, a +13 lighter (one value, kept in
  // opt.alphas); a label that TradingView has deleted at 55% of that
  const baseAlpha = (E) => (E.kind === 'C' ? 1 : E.kind === 'S' ? (E.rep ? 0.8 : 1) : null);
  const modeSeen = new Map();   // "tf|kind" -> Set of how its labels are painted in this window
  for (const [L, E] of pair) {
    const color = M.colorOf(E, dark), modes = modesOf(E.kind, E.tf, p.ppd), num = modes.includes('num'), mk = `${E.tf}|${E.kind}`;
    // how the zoom says this timeframe is shown: a number (or folded, or having given way in a pile), a mark, or not on the chart
    const allowed = new Set();
    if (num) { allowed.add('text'); if (E.kind !== 'I') allowed.add('folded'); if (E.kind !== 'C') allowed.add(p.ppd >= PPD_ALL13 ? 'mark' : E.kind === 'S' ? 'strip' : 'none'); }
    if (modes.includes('mark')) allowed.add('mark');
    if (modes.includes('off')) allowed.add(E.kind === 'I' ? 'none' : 'strip');
    if (!allowed.has(L.shown)) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} is shown as "${L.shown}"; at ${p.ppd.toFixed(3)} px a day a ${E.kind === 'C' ? '13' : E.kind === 'S' ? '9' : '+13'} of ${E.tf} is ${modes.join(' or ')} (${[...allowed].join(', ')})`);
    if (L.shown === 'text' || L.shown === 'mark') (modeSeen.get(mk) || modeSeen.set(mk, new Set()).get(mk)).add(L.shown);
    if (L.shown === 'text') {
      cnt('asText');
      const N = numBy.get(key4(L));
      if (!N) { bad(`${E.tf} "${E.text}" of ${iso(E.s)} (day ${iso(E.day)}): the probe shows it as a number at ${key4(L)}, nothing is painted there`); continue; }
      if (usedN.has(N)) bad(`${E.tf} "${E.text}": its painted number is also another label's`);
      usedN.add(N); shownText.push([L, E, N]);
      if (N.text !== E.text) bad(`${E.tf} label of bar ${iso(E.s)}: the engine says "${E.text}", painted "${N.text}"`);
      if (N.sup !== E.tf) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)}: the superscript painted is "${N.sup}"`);
      if (N.color !== color || N.supColor !== color) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} (${E.kind}${E.f == null ? '' : ' family ' + E.f}): painted in ${N.color} / superscript ${N.supColor}, its color on the ${dark ? 'dark' : 'light'} theme is ${color}`);
      if (!N.supAfter || !(N.supBase < N.base)) bad(`${E.tf} "${E.text}": the timeframe is not written as a superscript after the number (text x ${N.t.x}, width ${N.t.mw}, base ${N.base}; superscript x ${N.s.x}, base ${N.supBase})`);
      if (N.supGap > 2.1) bad(`${E.tf} "${E.text}": the superscript stands ${N.supGap.toFixed(1)} px after the number (the number is ${N.t.mw} px wide as painted); the layout was made for another width`);
      if (!N.inGround) bad(`${E.tf} "${E.text}" at ${key4(L)}: the ink of the number (${JSON.stringify(N.ink)}) leaves its box`);
      // one size for every timeframe, by the chart's width; a 13 bold, a 9 a little lighter, the superscript bold
      const wantNum = E.kind === 'I' ? size.def : size.num, wantSup = E.kind === 'I' ? size.supDef : size.sup;
      if (N.font.fam !== 'sans' || N.supFont.fam !== 'sans') bad(`${E.tf} "${E.text}": fonts ${N.t.font} / ${N.s.font}`);
      if (N.font.size !== wantNum || N.supFont.size !== wantSup) bad(`${E.tf} "${E.text}": painted at ${N.font.size} px with a ${N.supFont.size} px superscript; on a chart ${p.plot.w} px wide a ${E.kind === 'I' ? '+13' : 'number'} is ${wantNum} px with ${wantSup} px`);
      if (E.kind === 'C' ? N.font.weight !== 700 || N.supFont.weight !== 700 : E.kind === 'S' ? N.font.weight !== 600 || N.supFont.weight !== 700 : N.font.weight > 600 || N.supFont.weight > 700) bad(`${E.tf} "${E.text}": weights ${N.font.weight} / ${N.supFont.weight} (a 13 is 700, a 9 600, the superscript 700; a +13 not bolder than a 9)`);
      if (E.kind !== 'I' && size.pitch && N.ground.h !== size.pitch - 1) bad(`${E.tf} "${E.text}": its box is ${N.ground.h} px high; the line pitch on a chart ${p.plot.w} px wide is ${size.pitch} (a box of ${size.pitch - 1})`);
      if (opt.fonts) { const fk = `${size.key}|${E.kind}:${N.font.weight} ${N.font.size}px/${N.supFont.weight} ${N.supFont.size}px`; let fm = opt.fonts.get(fk); if (!fm) opt.fonts.set(fk, fm = new Set()); fm.add(E.tf); }
      // strength: full, .8 for a repeated 9, lighter for a +13; 55% of that with a dotted line under it for a label deleted on TradingView
      const ba = baseAlpha(E), ga = E.gone ? 0.55 : 1;
      if (N.alpha !== N.supAlpha) bad(`${E.tf} "${E.text}": number at strength ${N.alpha}, superscript at ${N.supAlpha}`);
      if (ba !== null && !near(N.alpha, ba * ga, 0.006)) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)}${E.rep ? ' (a repeated 9)' : ''}${E.gone ? ' (deleted on TradingView)' : ''}: painted at strength ${N.alpha}, expected ${(ba * ga).toFixed(3)}`);
      if (ba === null) { const one = N.alpha / ga; if (!(one < 0.999)) bad(`${E.tf} "${E.text}": a +13 at strength ${N.alpha}${E.gone ? ' (deleted on TradingView)' : ''}, not lighter than a 13`); if (opt.alphas) (opt.alphas.get('+13') || opt.alphas.set('+13', new Set()).get('+13')).add(Math.round(one * 1000) / 1000); }
      if (opt.alphas) { const ak = E.kind === 'S' ? (E.rep ? 'rep9' : '9') : E.kind === 'C' ? '13' : null; if (ak) (opt.alphas.get(ak) || opt.alphas.set(ak, new Set()).get(ak)).add(Math.round(N.alpha / ga * 1000) / 1000); }
      if (E.gone) {
        cnt('goneNumbers');
        if (!N.under) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} is deleted on TradingView (label ${E.k} is older than the indicator's limit): no dotted line is painted under it`);
        else if (N.under.lw !== 1 || N.under.color !== color || !(N.under.dash.length >= 2) || N.under.x2 - N.under.x1 < N.ground.w - 4.01) bad(`${E.tf} "${E.text}" (deleted on TradingView): the line under it is ${JSON.stringify(N.under)}, expected a dotted 1 px line in ${color} under the whole number`);
      } else if (N.under) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} is on TradingView's chart, but it is drawn with the dotted line of a deleted label`);
      if (opt.seen) opt.seen.set(E.id, 'text');
    } else if (L.shown === 'mark') {
      cnt('asMark');
      const list = markBy.get(key4(L)) || [];
      const m = list.find((x) => !usedM.has(x) && x.fs === color && x.outline === !!E.gone) || list.find((x) => !usedM.has(x) && x.fs === color) || list.find((x) => !usedM.has(x));
      if (!m) { bad(`${E.tf} "${E.text}" of ${iso(E.s)}: the probe shows it as a mark at ${key4(L)}, no mark is painted there`); continue; }
      usedM.add(m); shownMark.push([L, E, m]);
      if (m.fs !== color) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} as a mark: painted in ${m.fs}, its color on the ${dark ? 'dark' : 'light'} theme is ${color}`);
      if (m.outline !== !!E.gone) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} as a mark: ${m.outline ? 'an outline' : 'filled'}, but the label is ${E.gone ? 'deleted on TradingView (its mark is a 1 px outline)' : 'on TradingView\'s chart'}`);
      if (E.gone) cnt('goneMarks');
      if (Math.abs(m.x + m.w / 2 - X(E.day)) > Math.max(1.01, p.ppd / 2 + 0.51) && !(m.x <= p.plot.l + 0.5 || m.x + m.w >= p.plot.r - 0.5)) bad(`${E.tf} "${E.text}" as a mark: painted around x ${(m.x + m.w / 2).toFixed(1)}, its day ${iso(E.day)} is at ${X(E.day).toFixed(1)}`, 'anchor');
      const o = M.ohlc(slug, E.day);
      if (E.dir === 1 ? m.y + m.h > Y(o.h) + 0.01 : m.y < Y(o.l) - 0.01) bad(`${E.tf} "${E.text}" as a mark (${E.dir === 1 ? 'sell' : 'buy'}): y ${m.y}~${m.y + m.h}, its candle ${iso(E.day)} spans ${Y(o.h).toFixed(1)}~${Y(o.l).toFixed(1)}`, 'anchor');
      if (opt.seen && !opt.seen.has(E.id)) opt.seen.set(E.id, 'mark');
    } else if (L.shown === 'folded') {
      cnt('asFolded');
      const f = p.folds.find((x) => x.group === L.group);
      if (!f) bad(`${E.tf} "${E.text}" of ${iso(E.s)}: folded into group ${L.group}, which is no chip`);
      else if (key4(L) !== key4(f)) bad(`${E.tf} "${E.text}": folded, but its box is not its chip's`);
      if (opt.seen && !opt.seen.has(E.id)) opt.seen.set(E.id, 'folded');
    } else {
      cnt(L.shown === 'strip' ? 'leftToTheStrip' : 'notDrawn');
      if (opt.seen && !opt.seen.has(E.id)) opt.seen.set(E.id, L.shown);
    }
  }
  for (const N of c.numbers) if (!usedN.has(N)) bad(`a number "${N.text}" with superscript "${N.sup}" in ${N.color} is painted at ${key4(N.ground)}; the probe has no label there`);
  for (const m of c.marks) if (!usedM.has(m)) bad(`a mark in ${m.fs} is painted at ${key4(m)}; the probe has no label there`);
  cnt('paintedNumbers', c.numbers.length); cnt('paintedMarks', c.marks.length);
  // in a wide window (under 1.25 px a day) a timeframe never shows numbers and marks of one kind
  if (p.ppd < PPD_ALL13) for (const [mk, set] of modeSeen) { cnt('timeframeKindsInWideWindows'); if (set.size > 1) bad(`${mk.split('|')[0]} shows its ${mk.endsWith('C') ? '13s' : mk.endsWith('S') ? '9s' : '+13s'} both as numbers and as marks at ${p.ppd.toFixed(3)} px a day`); }
  if (opt.stats) { opt.stats.marksMax = Math.max(opt.stats.marksMax || 0, c.marks.length); }
  // chips of folded numbers: each folded label in exactly one; a chip holds 13s or 9s and says so: "13 7개" with one
  // small square per family in it, in that family's color, or "9 3개"
  const usedC = new Set(), chips = [];
  for (const f of p.folds) {
    cnt('chips');
    const members = pair.filter(([L]) => L.shown === 'folded' && L.group === f.group).map(([, E]) => E), ch = chipBy.get(key4(f));
    if (members.length !== f.n) bad(`chip ${f.group}: the probe counts ${f.n}, ${members.length} labels are folded into it`);
    if (!members.length) { bad(`chip ${f.group} at ${key4(f)} holds nothing`); continue; }
    const kinds = new Set(members.map((E) => E.kind)), is13 = kinds.has('C');
    if (kinds.size !== 1 || kinds.has('I')) bad(`chip ${f.group} holds ${members.map((E) => (E.kind === 'C' ? '13' : E.kind === 'S' ? '9' : '+13') + ' ' + E.tf).join(', ')}: a chip holds 13s or 9s, never both and no +13`, 'piles');
    chips.push({ f, members, is13, dir: members[0].dir });
    if (!ch) { bad(`chip ${f.group} at ${key4(f)}: nothing painted there`); continue; }
    usedC.add(ch);
    const want = `${is13 ? '13' : '9'} ${members.length}개`;
    if (ch.text !== want) bad(`chip ${f.group}: painted "${ch.text}", it holds ${members.length} ${is13 ? '13s' : '9s'} ("${want}")`);
    const fams = is13 ? [...new Set(members.filter((E) => E.kind === 'C').map((E) => E.f))].sort((a, b) => a - b) : [];
    const sq = ch.squares.map((q) => q.color), wantSq = fams.map((x) => M.famColorOn(x, dark));
    if (sq.slice().sort().join() !== wantSq.slice().sort().join()) bad(`chip ${f.group} "${ch.text}": squares in ${sq.join(', ') || 'none'}; it holds the families ${fams.join(', ') || 'none'} (${wantSq.join(', ') || 'no square'})`);
    if (ch.x < p.plot.l || ch.x + ch.w > p.plot.r || ch.y < p.plot.t || ch.y + ch.h > p.plot.b) bad(`chip "${ch.text}" at ${key4(ch)} leaves the plot`, 'geometry');
  }
  for (const ch of c.chips) if (!usedC.has(ch)) bad(`a chip "${ch.text}" is painted at ${key4(ch)}; the probe has none there`);
  if (c.handles.length || (p.handles && p.handles.length)) bad(`${c.handles.length} 접기 handles painted, ${(p.handles || []).length} in the probe: the chart no longer unfolds in place`);

  // ---- 2b / 4. where the painted numbers stand: at their day, on their side, clear of everything ----
  CAT = 'anchor';
  // The day is read off a number in one of three ways: the middle of its DIGITS is at the day (within 1 px; the
  // superscript hangs to the right), or a line leads from the day's candle to its box and a pointer in its color
  // stands at the box within 3 px of the day, or it stands right on a number of the same day and side that is read so
  // (a stack: one line for all of them).
  const boxes = [];
  const edgeY = (g, sell) => (sell ? g.y + g.h : g.y);
  const candleEnd = (o, sell) => (sell ? Y(o.h) : Y(o.l));
  const leadOf = (g, x, sell, o) => c.leaders.find((ld) => Math.abs(ld.x1 - x) <= 1.01 && ld.x2 >= g.x - 1.01 && ld.x2 <= g.x + g.w + 1.01 && Math.abs(ld.y2 - edgeY(g, sell)) <= 1.01 && Math.abs(ld.y1 - candleEnd(o, sell)) <= 2.51) || null;
  // a pointer at the box's edge towards the candle: a triangle with two corners on the edge and the third beyond it,
  // at the day (the page keeps it 3 px inside the box's corner, so it can stand up to 3.5 px beside the day's middle)
  const pointerOf = (g, x, sell) => c.pointers.find((pt) => { const on = pt.pts.filter((q) => Math.abs(q[1] - edgeY(g, sell)) <= 0.51), off = pt.pts.filter((q) => Math.abs(q[1] - edgeY(g, sell)) > 0.51); return on.length === 2 && off.length === 1 && off[0][0] >= g.x - 0.01 && off[0][0] <= g.x + g.w + 0.01 && Math.abs(off[0][0] - x) <= 3.51 && (sell ? off[0][1] > edgeY(g, sell) : off[0][1] < edgeY(g, sell)); }) || null;
  const usedLead = new Set(), usedPtr = new Set();
  const groups = new Map();
  for (const t of shownText) { const k = `${t[1].day}|${t[1].dir}`; (groups.get(k) || groups.set(k, []).get(k)).push(t); }
  // the line pitch: the one of the chart's width; on a narrow chart (not given) a number's box and the 1 px between two
  const tallest = c.numbers.reduce((a, N) => Math.max(a, N.ground.h), 0), pitchOf = () => size.pitch || tallest + 1;
  for (const list of groups.values()) {
    const sell = list[0][1].dir === 1, day = list[0][1].day, x = X(day), o = M.ohlc(slug, day);
    list.sort((a, b) => (sell ? b[2].ground.y - a[2].ground.y : a[2].ground.y - b[2].ground.y));
    if (list.length > K_STACK) bad(`day ${iso(day)} ${sell ? 'sell' : 'buy'} side: ${list.length} numbers are written in one stack (a stack shows ${K_STACK})`, 'geometry');
    const at = [];
    list.forEach(([L, E, N], i) => {
      const g = N.ground, off = Math.abs(N.digits.mid - x), ld = leadOf(g, x, sell, o), pt = pointerOf(g, x, sell);
      if (ld) usedLead.add(ld); if (pt) usedPtr.add(pt);
      let onStack = false;
      for (let k = 0; k < i && !onStack; k++) { const pg = list[k][2].ground; if (at[k] && Math.abs(sell ? pg.y - (g.y + g.h) : g.y - (pg.y + pg.h)) <= 2.01 && Math.min(g.x + g.w, pg.x + pg.w) - Math.max(g.x, pg.x) >= 8) onStack = true; }
      const how = off <= 1.0 ? 'centered' : ld && pt ? 'led' : onStack ? 'stack' : null;
      at.push(how);
      cnt(how === 'centered' ? 'digitsCentered' : how === 'led' ? 'besideItsDayWithPointer' : how === 'stack' ? 'besideItsDayOnItsStack' : 'atDayNot');
      if (opt.stats) { opt.stats.maxCenterOff = Math.max(opt.stats.maxCenterOff || 0, how === 'centered' ? off : 0); }
      if (!how) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)}: the middle of its digits is at x ${N.digits.mid.toFixed(2)} (box ${g.x}..${g.x + g.w}, y ${g.y}), its day ${iso(E.day)} is at x ${x.toFixed(2)}: ${off.toFixed(2)} px beside it${ld ? ' with a line but no pointer' : pt ? ' with a pointer but no line' : ', and neither a line with a pointer leads there nor does it stand on a number that has one'}`);
      if (L.lead && !ld) bad(`${E.tf} "${E.text}" of ${iso(E.s)}: the probe says it has a line to its day, none is painted from x ${x.toFixed(1)} to its box ${key4(g)}`);
      if (pt && pt.color !== M.colorOf(E, dark)) bad(`${E.tf} "${E.text}" of ${iso(E.s)}: its pointer is painted in ${pt.color}, the number's color is ${M.colorOf(E, dark)}`, 'paint');
      if (pt) { const xs = pt.pts.map((q) => q[0]), ys = pt.pts.map((q) => q[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys); if (!near(w, 5, 0.01) || !near(h, 4, 0.01)) bad(`${E.tf} "${E.text}": its pointer is ${w} px wide and ${h} px high (5 and 4)`, 'paint'); }
      if (pt && opt.stats) { const ax = pt.pts.find((q) => Math.abs(q[1] - edgeY(g, sell)) > 0.51)[0]; opt.stats.maxPointerOff = Math.max(opt.stats.maxPointerOff || 0, Math.abs(ax - x)); }
      // a number further than one line from its candle has a line to it (its own, or its stack's)
      // (how far from its candle: from the day's own high or low; in the widest zooms, where a column of the band holds
      // several days, from the band's end over the day's columns, which is what is painted there)
      let endY = candleEnd(o, sell);
      if (lineLod) { const xa = p.plot.x0 + (E.day - p.d0) * p.ppd; for (let k = Math.floor(xa + 1e-6); k <= Math.ceil(xa + p.ppd - 1e-6) - 1; k++) { const e2 = bandExt.get(k); if (e2) endY = sell ? Math.min(endY, Y(e2.hi)) : Math.max(endY, Y(e2.lo)); } }
      const dist = sell ? endY - (g.y + g.h) : g.y - endY;
      if (dist > pitchOf(N) + 0.5) { cnt('numbersFurtherThanALine'); if (!ld && !onStack) { cnt(dist <= pitchOf(N) + 3.5 ? 'noLineWithinThreePxOfTheLimit' : 'noLineBeyond'); } if (!ld && !onStack) bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} stands ${dist.toFixed(1)} px from its candle (more than one line of ${pitchOf(N)} px) and has no line to it`, 'piles'); }
      // the side: over (sell) or under (buy) its own day's candle. A number that stands beside its day's column, led
      // there by a line, has only the candles under its box to clear (the geometry check); it still has to be on its side
      const ex0 = lineLod ? [Math.floor(p.plot.x0 + (E.day - p.d0) * p.ppd + 1e-6), Math.ceil(p.plot.x0 + (E.day - p.d0 + 1) * p.ppd - 1e-6)] : dayBox.get(E.day) ? [dayBox.get(E.day).x0, dayBox.get(E.day).x1] : [x - 0.5, x + 0.5];
      const overDay = ex0[1] > g.x && ex0[0] < g.x + g.w;
      if (overDay ? (sell ? g.y + g.h > Y(o.h) + 0.01 : g.y < Y(o.l) - 0.01) : (sell ? g.y + g.h / 2 > (Y(o.h) + Y(o.l)) / 2 : g.y + g.h / 2 < (Y(o.h) + Y(o.l)) / 2)) bad(`${E.tf} "${E.text}" (${sell ? 'sell: above' : 'buy: under'} the candle): box x ${g.x}..${g.x + g.w}, y ${g.y}~${g.y + g.h}; its candle ${iso(E.day)} is at x ${x.toFixed(1)} and spans y ${Y(o.h).toFixed(2)}~${Y(o.l).toFixed(2)}`);
      if (!overDay) { cnt('besideItsDay'); if (sell ? g.y + g.h > Y(o.h) + 0.01 : g.y < Y(o.l) - 0.01) cnt('besideItsDayNotBeyondItsCandle'); }
      // inside the plot
      if (g.x < p.plot.l || g.x + g.w > p.plot.r || g.y < p.plot.t || g.y + g.h > p.plot.b) bad(`${E.tf} "${E.text}" at ${key4(g)} leaves the plot (${p.plot.l}..${p.plot.r}, ${p.plot.t}..${p.plot.b})`, 'geometry');
      boxes.push({ g, E, N, kind: 'number', how, dx: x - N.digits.mid, key: `${day}|${sell ? 1 : 0}` });
    });
  }
  // the lines: 1 px, in no number's color, strong enough to be seen (3:1 against the surface as painted), each with a
  // 3 px dot at the candle it begins at; each leads to a number (above) or to a chip
  CAT = 'paint';
  const dotAt = (ld) => c.dots.find((d) => Math.abs(d.x - ld.x1) <= 0.01 && Math.abs(d.y - ld.y1) <= 0.02 && d.color === ld.color) || null;
  for (const ld of c.leaders) {
    cnt('leaderLines');
    if (ld.lw !== 1) bad(`a line from a candle to a number is ${ld.lw} px wide (x ${ld.x1}, y ${ld.y1})`);
    if (inks.includes(ld.color)) bad(`a line from a candle to a number is painted in ${ld.color}, a number's color: the lines are neutral`);
    else if (/^#[0-9a-f]{6}$/.test(ld.color) && /^#[0-9a-f]{6}$/.test(surface)) { const cr = contrastRgb(over(ld.color, ld.al, surface), rgbOf(surface)); if (opt.stats) opt.stats.leadContrast = Math.min(opt.stats.leadContrast || 99, cr); if (cr < 3) bad(`a line from a candle to a number: ${ld.color} at strength ${ld.al} on ${surface} has a contrast of ${cr.toFixed(2)}:1 (3:1 at least)`); }
    if (!dotAt(ld)) bad(`the line from x ${ld.x1}, y ${ld.y1.toFixed(1)} has no 3 px dot at the candle's end`);
    if (!usedLead.has(ld)) {
      // not a number's: a chip's, from the candle of one of its days to its box
      const ch = c.chips.find((q) => ld.x2 >= q.x - 1.01 && ld.x2 <= q.x + q.w + 1.01 && (Math.abs(ld.y2 - q.y) <= 1.01 || Math.abs(ld.y2 - (q.y + q.h)) <= 1.01));
      if (!ch) bad(`a line from x ${ld.x1}, y ${ld.y1.toFixed(1)} to x ${ld.x2}, y ${ld.y2} leads to no number of that day and to no chip`, 'anchor');
      else cnt('leaderLinesToChips');
    }
  }
  if (c.dots.length !== c.leaders.length) bad(`${c.dots.length} dots for ${c.leaders.length} lines from candles to numbers`);
  for (const pt of c.pointers) if (!usedPtr.has(pt)) bad(`a pointer in ${pt.color} at ${JSON.stringify(pt.pts)} belongs to no number that stands beside its day`, 'anchor');
  cnt('pointers', c.pointers.length);

  CAT = 'geometry';
  for (const ch of c.chips) boxes.push({ g: ch, kind: 'chip' });
  // no two overlap (numbers, chips); none covers a candle
  boxes.sort((a, b) => a.g.x - b.g.x);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let k = i + 1; k < boxes.length && boxes[k].g.x < a.g.x + a.g.w; k++) {
      const b = boxes[k]; cnt('pairsCompared');
      if (hit(a.g, b.g)) bad(`${a.kind} ${a.E ? a.E.tf + ' "' + a.E.text + '"' : '"' + a.g.text + '"'} at ${key4(a.g)} and ${b.kind} ${b.E ? b.E.tf + ' "' + b.E.text + '"' : '"' + b.g.text + '"'} at ${key4(b.g)} overlap`);
      else if (a.N && b.N && hit(a.N.ink, b.N.ink)) bad(`the inks of ${a.E.tf} "${a.E.text}" and ${b.E.tf} "${b.E.text}" overlap`);
    }
  }
  const cand = c.candles.slice().sort((a, b) => a.x - b.x);
  let covered = 0;
  for (const bx of boxes) {
    for (const r of cand) { if (r.x >= bx.g.x + bx.g.w) break; if (hit(bx.g, r)) { covered++; if (covered <= 6) bad(`${bx.kind} ${bx.E ? bx.E.tf + ' "' + bx.E.text + '" of ' + iso(bx.E.s) : '"' + bx.g.text + '"'} at ${key4(bx.g)} covers painted candle pixels at x ${r.x}, y ${r.y}~${(r.y + r.h).toFixed(1)}`); break; } }
  }
  // exact: a number keeps 3 px clear of the high and the low of every day whose painted candle is under it
  const extentOf = (d) => { if (lineLod) { const xa = p.plot.x0 + (d - p.d0) * p.ppd; return [Math.floor(xa + 1e-6), Math.ceil(xa + p.ppd - 1e-6)]; } const g = dayBox.get(d); return g ? [g.x0, g.x1] : null; };
  let minGap = Infinity;
  for (const { g, E, kind } of boxes) {
    if (kind !== 'number') continue;
    const da = Math.max(p.d0, Math.floor(p.d0 + (g.x - p.plot.x0) / p.ppd) - 2), db = Math.min(p.d1, Math.ceil(p.d0 + (g.x + g.w - p.plot.x0) / p.ppd) + 2);
    for (let d = da; d <= db; d++) {
      if (!M.hasBar(slug, d)) continue;
      const ex = extentOf(d); if (!ex || ex[1] <= g.x || ex[0] >= g.x + g.w) continue;
      cnt('candlesUnderNumbers');
      const o = M.ohlc(slug, d), yh = Y(o.h), yl = Y(o.l);
      if (g.y < yl && yh < g.y + g.h) { bad(`${E.tf} "${E.text}" of ${iso(E.s)} at ${key4(g)} reaches into the candle of ${iso(d)} (x ${ex[0]}..${ex[1]}, y ${yh.toFixed(2)}~${yl.toFixed(2)})`); break; }
      const gap = g.y >= yl ? g.y - yl : yh - (g.y + g.h);
      if (gap < minGap) minGap = gap;
      if (gap < 2.99) { bad(`${E.tf} "${E.text}" of ${iso(E.s)} at ${key4(g)} is ${gap.toFixed(2)} px from the candle of ${iso(d)} (y ${yh.toFixed(2)}~${yl.toFixed(2)}): numbers keep 3 px from the candles`); break; }
    }
  }
  if (opt.stats && minGap < Infinity) opt.stats.minGap = Math.min(opt.stats.minGap == null ? Infinity : opt.stats.minGap, minGap);
  // Stacks beside their day (C9: the DIGITS are centered on the day, the superscript hangs to the right of them).
  // A stack may stand to one side of its day, with a line and a pointer: then its boxes end at the edge of the day's
  // slot (or at the plot's end). What never happens: the BOX of every such number centered on the day, which is the
  // number centered with its superscript included.
  // Counted besides, not a rule of the picture: the stacks beside their day that would stand free with their digits
  // centered on the day at the heights they are painted at (the places are chosen in turn, so a stack can keep a
  // place beside its day after what was in its way has folded).
  {
    const CATWAS = CAT; CAT = 'anchor';
    const beside = new Map();
    for (const b of boxes) if (b.kind === 'number' && (b.how === 'led' || b.how === 'stack')) (beside.get(b.key) || beside.set(b.key, []).get(b.key)).push(b);
    const freeAt = (g2, own) => {
      if (g2.x < p.plot.l || g2.x + g2.w > p.plot.r) return false;
      for (const b of boxes) { if (own.has(b)) continue; if (b.g.x < g2.x + g2.w && g2.x < b.g.x + b.g.w && b.g.y < g2.y + g2.h + 4 && g2.y < b.g.y + b.g.h + 4) return false; }
      for (const mk of c.marks) if (mk.x < g2.x + g2.w + 1 && g2.x < mk.x + mk.w + 1 && mk.y < g2.y + g2.h + 1 && g2.y < mk.y + mk.h + 1) return false;
      const da = Math.max(p.d0, Math.floor(p.d0 + (g2.x - p.plot.x0) / p.ppd) - 2), db = Math.min(p.d1, Math.ceil(p.d0 + (g2.x + g2.w - p.plot.x0) / p.ppd) + 2);
      for (let d = da; d <= db; d++) {
        if (!M.hasBar(slug, d)) continue;
        // (the whole slot of a day counts here, not only its painted candle)
        const xa = p.plot.x0 + (d - p.d0) * p.ppd, ex = [Math.floor(xa + 1e-6), Math.ceil(xa + p.ppd - 1e-6)]; if (ex[1] <= g2.x || ex[0] >= g2.x + g2.w) continue;
        const o = M.ohlc(slug, d), yh = Y(o.h), yl = Y(o.l);
        if (g2.y < yl + 2.99 && yh - 2.99 < g2.y + g2.h) return false;
      }
      return true;
    };
    for (const list of beside.values()) {
      cnt('stacksBesideTheirDay');
      const b = list[0];
      if (list.every((q) => Math.abs(q.g.x + q.g.w / 2 - (q.N.digits.mid + q.dx)) <= 1.0 && q.g.x > p.plot.l + 1.01 && q.g.x + q.g.w < p.plot.r - 1.01)) bad(`${b.E.tf} "${b.E.text}" of ${iso(b.E.s)} (day ${iso(b.E.day)}): its box ${key4(b.g)} is centered on its day (x ${(b.N.digits.mid + b.dx).toFixed(1)}) with the superscript included, so its digits stand ${Math.abs(b.dx).toFixed(1)} px beside the day and it was given a line and a pointer: the DIGITS are centered on the day`);
      const own = new Set(boxes.filter((q) => q.key === b.key));
      if (list.every((q) => freeAt({ x: q.g.x + q.dx, y: q.g.y, w: q.g.w, h: q.g.h }, own))) { cnt('stacksBesideTheirDayThatWouldFitCentered'); if (opt.stats) (opt.stats.wouldFit = opt.stats.wouldFit || []).push(`[${opt.tag || ''}] ${b.E.tf} "${b.E.text}" of ${iso(b.E.s)} (day ${iso(b.E.day)}) at ${key4(b.g)}, ${Math.abs(b.dx).toFixed(1)} px beside its day`); }
    }
    CAT = CATWAS;
  }
  let markOnCandle = 0;
  for (const m of c.marks) { for (const r of cand) { if (r.x >= m.x + m.w) break; if (hit(m, r)) { markOnCandle++; break; } } }
  if (markOnCandle) cnt('marksOnCandles', markOnCandle);
  // one day, one side: the shorter timeframe nearer the candle, whatever the kind, without exception
  for (const list of groups.values()) {
    if (list.length < 2) continue; cnt('stacks');
    const sell = list[0][1].dir === 1, byY = list.map(([, E, N]) => ({ E, y: N.ground.y })).sort((a, b) => (sell ? b.y - a.y : a.y - b.y));
    for (let i = 1; i < byY.length; i++) if (byY[i].E.j < byY[i - 1].E.j) { bad(`day ${iso(byY[i].E.day)} ${sell ? 'sell' : 'buy'} side: ${byY[i].E.tf} "${byY[i].E.text}" stands further from the candle than ${byY[i - 1].E.tf} "${byY[i - 1].E.text}" (order from the candle: ${byY.map((q) => q.E.tf + ' ' + q.E.text).join(', ')})`); break; }
    // two lines of a stack are never nearer than the line pitch
    if (size.pitch) for (let i = 1; i < byY.length; i++) if (Math.abs(byY[i].y - byY[i - 1].y) < size.pitch - 0.01 && byY[i].E.kind !== 'I' && byY[i - 1].E.kind !== 'I') bad(`day ${iso(byY[i].E.day)}: two numbers of one stack are ${Math.abs(byY[i].y - byY[i - 1].y)} px apart (the line pitch is ${size.pitch})`);
  }

  // ---- 5. piles: who stays written where room is short ----
  CAT = 'piles';
  const wroteBy = new Map();   // "day|dir" -> the labels of that stack by how they are shown
  for (const [L, E] of pair) { const k = `${E.day}|${E.dir}`; (wroteBy.get(k) || wroteBy.set(k, []).get(k)).push([L, E]); }
  // (a) in one stack nothing that has given way is more important than a number that is written
  for (const list of wroteBy.values()) {
    const text = list.filter(([L]) => L.shown === 'text'), gave = list.filter(([L, E]) => L.shown !== 'text' && modesOf(E.kind, E.tf, p.ppd).join() === 'num');
    if (!text.length || !gave.length) continue; cnt('stacksWithNumbersGivenWay');
    const low = text.reduce((a, b) => (impOf(a[1]) <= impOf(b[1]) ? a : b)), high = gave.reduce((a, b) => (impOf(a[1]) >= impOf(b[1]) ? a : b));
    if (impOf(high[1]) > impOf(low[1])) bad(`day ${iso(low[1].day)} ${low[1].dir === 1 ? 'sell' : 'buy'} side: ${high[1].tf} "${high[1].text}" has given way (${high[0].shown}) while the less important ${low[1].tf} "${low[1].text}" is written`);
  }
  // (b) no 13 of 2W or longer is folded while a 13 of a shorter timeframe is written within 40 px on the same side.
  // The folded number's place: its day and its chip; the written number's: its box and its day.
  const text13 = shownText.filter(([, E]) => E.kind === 'C');
  for (const [L, E] of pair) {
    if (L.shown !== 'folded' || E.kind !== 'C') continue;
    cnt('folded13');
    if (E.j < M.J_2W) continue;
    cnt('folded13Of2WOrLonger');
    const f = p.folds.find((x) => x.group === L.group), xd = X(E.day), a0 = Math.min(xd, f ? f.x : xd), a1 = Math.max(xd, f ? f.x + f.w : xd);
    for (const [, E2, N2] of text13) {
      if (E2.dir !== E.dir || E2.j >= E.j) continue;
      const b0 = Math.min(N2.ground.x, X(E2.day)), b1 = Math.max(N2.ground.x + N2.ground.w, X(E2.day)), gap = Math.max(0, b0 - a1, a0 - b1);
      if (gap <= NEAR_PX) { bad(`${E.tf} "${E.text}" of bar ${iso(E.s)} (day ${iso(E.day)}) is folded while the shorter ${E2.tf} "${E2.text}" of ${iso(E2.day)} is written ${gap.toFixed(0)} px from it on the ${E.dir === 1 ? 'sell' : 'buy'} side`); break; }
    }
  }
  // (c) no 9 and no +13 is written in the columns of a chip that holds a 13
  for (const ch of chips) {
    if (!ch.is13) continue; cnt('chipsOf13');
    for (const [, E, N] of shownText) {
      if (E.kind === 'C' || E.dir !== ch.dir) continue;
      if (N.ground.x < ch.f.x + ch.f.w && ch.f.x < N.ground.x + N.ground.w) bad(`${E.tf} "${E.text}" of ${iso(E.day)} is written in the columns of the chip "${ch.f.text}" (x ${ch.f.x}..${ch.f.x + ch.f.w}), which holds a 13: a ${E.kind === 'S' ? '9' : '+13'} there becomes a mark before a 13 folds`);
    }
  }
  // (d) a 9 that is a mark (or left to the strip) although its timeframe is written as numbers has given way to a 13:
  // a 13 is written or folded in its pile (within 75 px of its day on its side), or its own stack is full
  for (const [L, E] of pair) {
    if (E.kind !== 'S' || L.shown === 'text' || L.shown === 'folded' || modesOf('S', E.tf, p.ppd).join() !== 'num') continue;
    cnt('ninesGivenWayToMarks');
    const xd = X(E.day), R = 75;
    const pile = pair.some(([L2, E2]) => E2.kind === 'C' && E2.dir === E.dir && (L2.shown === 'folded' ? Math.abs(X(E2.day) - xd) <= R || (L2.x <= xd + R && L2.x + L2.w >= xd - R) : L2.shown === 'text' && L2.x <= xd + R && L2.x + L2.w >= xd - R));
    const full = (wroteBy.get(`${E.day}|${E.dir}`) || []).filter(([L2]) => L2.shown === 'text').length >= K_STACK;
    if (!pile && !full) bad(`${E.tf} "${E.text}" of ${iso(E.day)} is shown as "${L.shown}" although 9s of ${E.tf} are numbers at this zoom, and no 13 stands or is folded within ${R} px of it on its side`);
  }
  return { fails, n, c, pair, shownText, shownMark, chips };
}

module.exports = { verifyState, scales, parsePrice };
