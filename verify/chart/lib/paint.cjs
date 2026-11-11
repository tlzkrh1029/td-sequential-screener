// What was painted, read from the recorded canvas calls by the picture's visual grammar alone (colors of the theme,
// fonts, shapes, the order of the calls). Nothing here asks the page what it meant: a call that fits no part of the
// grammar lands in `unknown`, and the checks fail on it.
//
// The grammar of the chart canvas (round 2 of the picture):
//   wipe            the first call: a rect of the surface color over the whole canvas
//   grid and axis   1 px high rects in the line color (price lines and the axis' base line), 1 x 4 date marks, the
//                   prices (mono, right aligned), the dates (mono, centered)
//   candles         rects in the faint color (a rising day) or the text color (a falling day); at the widest zooms a
//                   1 px band per pixel column and the close as one line in the text color
//   zone            다음 봉 조건: ONE 1 px wide line in the line color down the plot, and right of it: the title, the
//                   newest close as a dashed line with its price, per condition a pointer (3 points), a frame (dashed:
//                   far; solid on a tinted ground: near; filled: met), the number with its timeframe and the distance;
//                   per edge one line of text for the conditions beyond the price range. No panel, no chip pinned to
//                   an edge, and no vertical line while nothing is pointed at.
//   numbers         a ground of the surface color (not opaque), then the number and its superscript; a number that
//                   TradingView has deleted has a dotted 1 px line under it
//   marks           small rects (at most 4 x 5): filled, or a 1 px outline for a label TradingView has deleted
//   chips           folded numbers: a round rect in the sunken color with a frame, small squares (3 x 5, one per
//                   family) and the text "13 N개" or "9 N개"
//   leaders         a 1 px line from a candle to a number or a chip, with a round 3 px dot at the candle; a triangle
//                   (pointer) where a number stands beside its day
const fontOf = (s) => {
  const m = /^(?:(?:italic|oblique)\s+)?(?:(bold|normal|\d+)\s+)?([\d.]+)px\s+(.*)$/.exec(s || '');
  if (!m) return { weight: 0, size: 0, fam: '?', raw: s };
  return { weight: m[1] === 'bold' ? 700 : !m[1] || m[1] === 'normal' ? 400 : Number(m[1]), size: Number(m[2]), fam: /mono/i.test(m[3].split(',')[0]) ? 'mono' : 'sans', first: m[3].split(',')[0].replace(/"/g, '').trim(), raw: s };
};
// the ink box of a recorded fillText (from the metrics measured when it was drawn)
function inkBox(c) {
  let x = c.x;
  if (c.ta === 'center') x -= c.mw / 2; else if (c.ta === 'right' || c.ta === 'end') x -= c.mw;
  // actualBoundingBoxLeft / Right are measured from the alignment point
  const x0 = c.x - c.bl, x1 = c.x + c.br;
  return { x: Math.min(x, x0), y: c.y - c.ba, w: Math.max(x + c.mw, x1) - Math.min(x, x0), h: c.ba + c.bd, ax: x, aw: c.mw };
}
const isRR = (c) => Array.isArray(c.path) && c.path.length === 1 && c.path[0][0] === 'RR';
const rrBox = (c) => ({ x: c.path[0][1], y: c.path[0][2], w: c.path[0][3], h: c.path[0][4] });
const isTri = (c) => Array.isArray(c.path) && c.path.length === 4 && c.path[0][0] === 'M' && c.path[1][0] === 'L' && c.path[2][0] === 'L' && c.path[3][0] === 'Z';
const isLine = (c, n) => Array.isArray(c.path) && c.path.length === n && c.path[0][0] === 'M' && c.path.slice(1).every((s) => s[0] === 'L');
const near = (a, b, e = 0.011) => Math.abs(a - b) <= e;
const dashed = (c) => !!(c.dash && c.dash.length);
const CHIP_TEXT = /^(13|9) (\d+)개$/, EDGE_TEXT = /^([▲▼]) (범위 밖|그 밖의 조건) (\d+)개$/;
const NOTE_NONE = '이 기간에는 TradingView 일봉이 없습니다.', NOTE_EMPTY = '켜 둔 타임프레임이 없어서 보여 줄 숫자가 없습니다.';
const ZONE_EMPTY = [['지금은 9나 13이 나올', '조건이 없습니다.'], ['켜 둔 타임프레임이', '없습니다.']];

function parseChart(frame, theme) {
  const calls = frame.calls, T = theme;
  const out = { W: frame.w, H: frame.h, n: frame.n, wipe: false, lines: [], dateMarks: [], prices: [], dates: [], candles: [], closeLine: null, zone: null, leaders: [], dots: [], pointers: [],
    marks: [], numbers: [], chips: [], handles: [], note: null, emptyNote: null, unknown: [], plotL: null, plotB: null, order: [] };
  if (!calls.length) { out.unknown.push({ why: 'empty frame' }); return out; }
  // the zone is found by its one line: 1 px wide, in the line color, down the plot
  const zl = calls.filter((c) => c.op === 'fr' && c.fs === T.line && c.al === 1 && c.w === 1 && c.h > 20);
  if (zl.length) out.zone = { x0: zl[0].x, line: { x: zl[0].x, y: zl[0].y, w: zl[0].w, h: zl[0].h }, panel: null, title: null, closeLine: null, closeTag: null, chips: [], edges: [], empty: [], stray: [] };
  const Z = out.zone, inZone = (x) => !!Z && x >= Z.x0 - 0.5;
  const unk = (c, why) => out.unknown.push({ why, i: c.i, op: c.op, text: c.text, x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, ss: c.ss, al: c.al, lw: c.lw, dash: c.dash, path: Array.isArray(c.path) ? c.path.slice(0, 5) : c.path, font: c.font });
  let zc = null;   // the condition chip being read in the zone
  const zchip = () => (zc || (zc = { pointer: null, dot: null, box: null, ground: null, frame: null, text: null, sup: null, dist: null }));
  const endChip = () => { if (zc) { Z.chips.push(zc); zc = null; } };
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i], n1 = calls[i + 1], n2 = calls[i + 2];
    if (c.tr) { unk(c, 'transform'); continue; }
    if (i === 0) { if (c.op === 'fr' && c.fs === T.surface && c.al === 1 && c.x <= 0 && c.y <= 0 && c.w >= frame.w && c.h >= frame.h) { out.wipe = true; continue; } unk(c, 'first call is not the wipe'); continue; }
    if (c.op === 'fr') {
      if (c.fs === T.line && c.al === 1) {
        if (c.h === 1 && c.w > 8) out.lines.push(c); else if (c.w === 1 && c.h === 4) out.dateMarks.push(c);
        else if (c === zl[0]) { /* the zone's line */ } else unk(c, zl.includes(c) ? 'a second 1 px line down the plot' : 'line-colored rect');
        continue;
      }
      if (c.fs === T.sunken && c.w > 60 && c.h > 100) { if (Z) Z.panel = c; unk(c, 'a panel in the sunken color'); continue; }
      if (c.fs === T.faint || c.fs === T.fg) { out.candles.push({ x: c.x, y: c.y, w: c.w, h: c.h, cls: c.fs === T.faint ? 'soft' : 'hard', al: c.al, i: c.i }); continue; }
      if (c.fs === T.surface && c.al < 1) {
        if (n1 && n2 && n1.op === 'ft' && n2.op === 'ft') {
          const N = { ground: { x: c.x, y: c.y, w: c.w, h: c.h, al: c.al }, t: n1, s: n2, i: c.i, under: null };
          i += 2;
          // a dotted line under the number, in its box: the number is of a label that TradingView has deleted
          const u = calls[i + 1];
          if (u && u.op === 'st' && isLine(u, 2) && dashed(u) && near(u.path[0][2], u.path[1][2]) && u.path[0][2] > c.y + c.h - 2.01 && u.path[0][2] <= c.y + c.h + 0.01 && u.path[0][1] >= c.x - 0.01 && u.path[1][1] <= c.x + c.w + 0.01) { N.under = { x1: u.path[0][1], x2: u.path[1][1], y: u.path[0][2], color: u.ss, al: u.al, lw: u.lw, dash: u.dash }; i++; }
          out.numbers.push(N); continue;
        }
        unk(c, 'a ground without its number'); continue;
      }
      if (c.w <= 4 && c.h <= 5 && c.w > 0 && c.h > 0 && !inZone(c.x)) { out.marks.push({ x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, al: c.al, i: c.i, outline: false }); continue; }
      unk(c, 'rect'); continue;
    }
    if (c.op === 'sr') {
      // a 1 px outline: the mark of a label that TradingView has deleted (the box is the outline's outer edge)
      if (c.lw === 1 && !dashed(c) && c.w + 1 <= 4 && c.h + 1 <= 5 && !inZone(c.x)) { out.marks.push({ x: c.x - 0.5, y: c.y - 0.5, w: c.w + 1, h: c.h + 1, fs: c.ss, al: c.al, i: c.i, outline: true }); continue; }
      unk(c, 'stroked rect'); continue;
    }
    if (c.op === 'ft') {
      const f = fontOf(c.font);
      if (f.fam === 'mono') {
        if (inZone(c.x) && c.ta === 'right') { if (Z.closeTag) Z.stray.push(c); else Z.closeTag = c; continue; }
        if (inZone(c.x) && c.ta === 'left') { if (zc && zc.sup && !zc.dist) { zc.dist = c; endChip(); } else Z.stray.push(c); continue; }
        if (c.ta === 'right') { out.prices.push(c); continue; }
        if (c.ta === 'center') { out.dates.push(c); continue; }
        unk(c, 'mono text'); continue;
      }
      if (inZone(c.x)) {
        if (c.text === '다음 봉 조건' && !Z.title) { Z.title = c; continue; }
        if (c.text === '충족' && zc && zc.sup && !zc.dist) { zc.dist = c; endChip(); continue; }
        if (zc && zc.frame && !zc.text) { zc.text = c; continue; }
        if (zc && zc.text && !zc.sup) { zc.sup = c; continue; }
        if (EDGE_TEXT.test(c.text)) { const m = EDGE_TEXT.exec(c.text); Z.edges.push({ text: c.text, above: m[1] === '▲', over: m[2] !== '범위 밖', n: Number(m[3]), t: c, ...inkBox(c) }); continue; }
        if (ZONE_EMPTY.some((p) => p.includes(c.text))) { Z.empty.push(c); continue; }
        Z.stray.push(c); continue;
      }
      if (c.ta === 'center' && c.text === NOTE_NONE) { out.note = c; continue; }
      unk(c, 'text'); continue;
    }
    if (c.op === 'fi' || c.op === 'st') {
      if (c.path === 'path2d') { unk(c, 'path2d'); continue; }
      if (isRR(c)) {
        const b = rrBox(c);
        // a chip of folded numbers: ground, frame, a square per family, the text
        if (c.op === 'fi' && c.fs === T.sunken && c.al === 1 && n1 && n1.op === 'st' && isRR(n1) && !inZone(b.x)) {
          const chip = { x: b.x, y: b.y, w: b.w, h: b.h, text: null, t: null, i: c.i, frameColor: n1.ss, squares: [] };
          let k = i + 2;
          while (calls[k] && calls[k].op === 'fr' && calls[k].w === 3 && calls[k].h === 5 && calls[k].x >= b.x && calls[k].x + 3 <= b.x + b.w && calls[k].y >= b.y && calls[k].y + 5 <= b.y + b.h) { chip.squares.push({ x: calls[k].x, y: calls[k].y, color: calls[k].fs, al: calls[k].al }); k++; }
          const t = calls[k];
          if (t && t.op === 'ft') { chip.text = t.text; chip.t = t; if (CHIP_TEXT.test(t.text)) out.chips.push(chip); else if (t.text === '접기') out.handles.push(chip); else unk(c, `a chip with another text: "${t.text}"`); i = k; continue; }
          unk(c, 'a chip without a text'); i = k - 1; continue;
        }
        // the note in the plot while every timeframe is switched off: a ground and one line of text
        if (c.op === 'fi' && c.fs === T.surface && n1 && n1.op === 'ft' && n1.text === NOTE_EMPTY) { out.emptyNote = { ...b, t: n1 }; i++; continue; }
        if (inZone(b.x)) {
          const q = zchip();
          if (c.op === 'fi' && c.fs === T.surface && c.al === 1 && !q.box && !q.frame) { q.box = b; continue; }
          if (c.op === 'fi' && !q.frame && !q.ground) { q.ground = { color: c.fs, al: c.al, ...b }; continue; }
          if (c.op === 'st' && !q.frame) { q.frame = { color: c.ss, al: c.al, lw: c.lw, dash: c.dash, ...b }; continue; }
        }
        unk(c, 'round rect'); continue;
      }
      if (Z && Array.isArray(c.path) && c.path.some((s) => s[0] !== 'Z' && s[1] >= Z.x0 + 0.5)) {
        // the newest close: a dashed line into the zone (broken where a condition stands on it)
        if (c.op === 'st' && dashed(c) && c.path.every((s) => (s[0] === 'M' || s[0] === 'L') && near(s[2], c.path[0][2])) && !Z.closeLine) { Z.closeLine = c; continue; }
        if (c.op === 'st' && isLine(c, 3) && !dashed(c)) { endChip(); zchip().pointer = c; continue; }
        if (c.op === 'fi' && c.path.length === 1 && c.path[0][0] === 'A' && zc && zc.pointer && !zc.frame) { zc.dot = c; continue; }
        // (a vertical line in the zone: the close level's, which may be painted only for the chip that is pointed at, on the layer over the chart)
        unk(c, c.op === 'st' && isLine(c, 2) && near(c.path[0][1], c.path[1][1]) ? 'a vertical line in the zone' : 'zone path'); continue;
      }
      if (c.op === 'st' && isLine(c, 2) && !dashed(c)) {
        const [, x1, y1] = c.path[0], [, x2, y2] = c.path[1];
        if (c.lw === 3 && Math.abs(x1 - x2) < 0.02 && Math.abs(y1 - y2) < 0.05) { out.dots.push({ x: x1, y: y1, color: c.ss, al: c.al, lw: c.lw, i: c.i }); continue; }
        out.leaders.push({ x1, y1, x2, y2, color: c.ss, al: c.al, lw: c.lw, i: c.i }); continue;
      }
      if (c.op === 'fi' && isTri(c)) { out.pointers.push({ pts: c.path.slice(0, 3).map((s) => [s[1], s[2]]), color: c.fs, al: c.al, i: c.i }); continue; }
      if (c.op === 'st' && Array.isArray(c.path) && c.path.length > 2 && c.ss === T.fg && !dashed(c) && !out.closeLine) { out.closeLine = c; continue; }
      unk(c, 'path'); continue;
    }
    unk(c, 'call');
  }
  if (zc) { if (zc.dist) Z.chips.push(zc); else Z.stray.push({ text: 'a condition chip that was not finished', ...zc }); }
  // the axis' base line is the lowest 1 px line; the price lines are the others
  if (out.lines.length) { out.plotL = out.lines[0].x; out.plotB = Math.max(...out.lines.map((l) => l.y)); out.gridR = out.lines[0].x + out.lines[0].w; }
  // numbers: text, superscript, fonts, color, and the boxes
  for (const N of out.numbers) {
    const ft = fontOf(N.t.font), fs = fontOf(N.s.font), bt = inkBox(N.t), bs = inkBox(N.s);
    N.text = N.t.text; N.sup = N.s.text; N.color = N.t.fs; N.supColor = N.s.fs; N.alpha = N.t.al; N.supAlpha = N.s.al; N.font = ft; N.supFont = fs;
    N.base = N.t.y; N.supBase = N.s.y;
    const x0 = Math.min(bt.x, bs.x), y0 = Math.min(bt.y, bs.y), x1 = Math.max(bt.x + bt.w, bs.x + bs.w), y1 = Math.max(bt.y + bt.h, bs.y + bs.h);
    N.ink = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    N.digits = { x: bt.ax, w: bt.aw, mid: bt.ax + bt.aw / 2 };   // the digits alone: where they begin, how wide they are, their middle
    N.supAfter = N.s.x >= N.t.x + N.t.mw - 0.6;   // the superscript begins where the number ends
    N.supGap = N.s.x - (N.t.x + N.t.mw);            // and how far after it (1 px by the page's own spacing)
    N.inGround = x0 >= N.ground.x - 1.01 && x1 <= N.ground.x + N.ground.w + 1.01 && y0 >= N.ground.y - 1.01 && y1 <= N.ground.y + N.ground.h + 1.01;
  }
  return out;
}

// The strip (전체 기간): the wipe; six opaque band grounds (two sides x three timeframe groups); the close as one line
// (and single dots) in the text color; ticks (filled rects, or 1 px outlines for labels TradingView has deleted); date
// marks and dates; the group names (mono) and the two band names (sans) at the left.
function parseStrip(frame, theme) {
  const calls = frame.calls, T = theme;
  const out = { W: frame.w, H: frame.h, n: frame.n, wipe: false, closeLine: null, dots: [], grounds: [], ticks: [], dateMarks: [], dates: [], groups: [], bands: [], unknown: [] };
  const unk = (c, why) => out.unknown.push({ why, i: c.i, op: c.op, text: c.text, x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, ss: c.ss, al: c.al, lw: c.lw });
  calls.forEach((c, i) => {
    if (c.tr) return unk(c, 'transform');
    if (i === 0) { if (c.op === 'fr' && c.fs === T.surface && c.x <= 0 && c.y <= 0 && c.w >= frame.w && c.h >= frame.h) { out.wipe = true; return; } return unk(c, 'first call is not the wipe'); }
    if (c.op === 'st') { if (!out.closeLine && Array.isArray(c.path) && c.path.length > 2) { out.closeLine = c; return; } return unk(c, 'stroke'); }
    if (c.op === 'fr') {
      // a ground: wide and at least 5 px high (the lowest band of a narrow strip is 7.5 px)
      if (c.w > frame.w / 2 && c.h >= 5) return void out.grounds.push({ x: c.x, y: c.y, w: c.w, h: c.h, al: c.al, color: c.fs });
      if (c.fs === T.line && c.w === 1 && c.h === 4) return void out.dateMarks.push(c);
      if (c.fs === T.fg && c.w === 1 && c.h === 1 && out.closeLine === null) return void out.dots.push(c);   // (a day between two days without a bar, drawn while the line's path is built)
      if (c.fs === T.surface || c.fs === T.line || c.fs === T.muted || c.fs === T.fg || c.fs === T.faint) return unk(c, 'rect');
      return void out.ticks.push({ x: c.x, y: c.y, w: c.w, h: c.h, color: c.fs, al: c.al, i: c.i, outline: false });
    }
    if (c.op === 'sr') {
      if (c.lw === 1 && c.w + 1 <= frame.w / 2 && c.h + 1 <= 4) return void out.ticks.push({ x: c.x - 0.5, y: c.y - 0.5, w: c.w + 1, h: c.h + 1, color: c.ss, al: c.al, i: c.i, outline: true });
      return unk(c, 'stroked rect');
    }
    if (c.op === 'ft') {
      const f = fontOf(c.font);
      if (f.fam === 'mono' && c.ta === 'center') return void out.dates.push(c);
      if (f.fam === 'mono' && c.ta === 'right' && /^\d+[DWM]~\d+[DWM]$/.test(c.text)) return void out.groups.push(c);
      if (f.fam === 'sans' && c.ta === 'right') return void out.bands.push(c);
      return unk(c, 'text');
    }
    return unk(c, 'call');
  });
  return out;
}

// The layer over the strip: the 현재 창 box with its frame and its name; while the pointer is on the strip a hairline
// with the date under it; while a number is pointed at, a frame around its tick with a triangle at the band's edge,
// and for a 13 a 1 px tick per origin bar.
function parseStripOver(frame, theme) {
  const T = theme, out = { n: frame.n, wipe: false, box: null, stroke: null, nameBg: null, name: null, hi: null, tri: null, hair: null, dateBg: null, date: null, origins: [], unknown: [] };
  frame.calls.forEach((c, i) => {
    if (i === 0) { if (c.op === 'cr') out.wipe = true; else out.unknown.push(c); return; }
    if (c.op === 'fr' && c.fs === T.accent && !out.box) { out.box = { x: c.x, y: c.y, w: c.w, h: c.h, al: c.al }; return; }
    if (c.op === 'sr' && c.ss === T.accent && !out.stroke) { out.stroke = { x: c.x, y: c.y, w: c.w, h: c.h }; return; }
    if (c.op === 'fr' && c.fs === T.surface && !out.nameBg) { out.nameBg = c; return; }
    if (c.op === 'ft' && c.text === '현재 창') { out.name = c; return; }
    if (c.op === 'st' && isLine(c, 2) && near(c.path[0][1], c.path[1][1]) && !out.hair) { out.hair = { x: c.path[0][1], y1: c.path[0][2], y2: c.path[1][2], color: c.ss, al: c.al, lw: c.lw }; return; }
    if (c.op === 'fr' && c.fs === T.fg && c.w > 20 && c.h >= 8 && !out.dateBg) { out.dateBg = { x: c.x, y: c.y, w: c.w, h: c.h }; return; }
    if (c.op === 'ft' && /^\d{4}-\d\d-\d\d$/.test(c.text) && !out.date) { out.date = c; return; }
    if (c.op === 'fr' && c.fs === T.fg && c.w === 1 && c.h > 8) { out.origins.push({ x: c.x, y: c.y, w: c.w, h: c.h, al: c.al }); return; }
    if (c.op === 'sr' && c.ss === T.fg) { out.hi = { x: c.x, y: c.y, w: c.w, h: c.h }; return; }
    if (c.op === 'fi' && isTri(c)) { out.tri = c; return; }
    out.unknown.push({ op: c.op, text: c.text, x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, ss: c.ss });
  });
  return out;
}

// The layer over the chart, as lists by shape (the checks ask for what a state has to show there):
//   rects  filled rects { x, y, w, h, fs, al }            texts  { text, x, y, fs, font, ta }
//   lines  stroked 2-point lines { x1, y1, x2, y2, ss, al, lw, dash, vertical, horizontal }
//   rings  stroked round rects { x, y, w, h, ss, lw }     frames stroked rects        tris filled triangles
function parseOver(frame) {
  const out = { n: frame ? frame.n : 0, wipe: false, rects: [], texts: [], lines: [], rings: [], frames: [], tris: [], dots: [], other: [] };
  if (!frame) return out;
  frame.calls.forEach((c, i) => {
    if (i === 0 && c.op === 'cr') { out.wipe = true; return; }
    if (c.op === 'fr') return void out.rects.push({ x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, al: c.al });
    if (c.op === 'sr') return void out.frames.push({ x: c.x, y: c.y, w: c.w, h: c.h, ss: c.ss, al: c.al, lw: c.lw });
    if (c.op === 'ft') return void out.texts.push({ text: c.text, x: c.x, y: c.y, fs: c.fs, font: c.font, ta: c.ta });
    if (c.op === 'st' && isRR(c)) return void out.rings.push({ ...rrBox(c), ss: c.ss, lw: c.lw, al: c.al });
    if (c.op === 'st' && isLine(c, 2)) {
      const [, x1, y1] = c.path[0], [, x2, y2] = c.path[1];
      if (c.lw === 3 && Math.abs(x1 - x2) < 0.02 && Math.abs(y1 - y2) < 0.05) return void out.dots.push({ x: x1, y: y1, ss: c.ss });
      return void out.lines.push({ x1, y1, x2, y2, ss: c.ss, al: c.al, lw: c.lw, dash: c.dash || [], vertical: near(x1, x2), horizontal: near(y1, y2) });
    }
    if (c.op === 'fi' && isTri(c)) return void out.tris.push({ pts: c.path.slice(0, 3).map((s) => [s[1], s[2]]), fs: c.fs });
    out.other.push({ op: c.op, path: Array.isArray(c.path) ? c.path.slice(0, 4) : c.path, ss: c.ss, fs: c.fs });
  });
  return out;
}

// a frame as what it puts on the canvas: per call only the state that the call uses (a fill does not care about the
// stroke color in force), so that two frames can be compared as pictures
function paintKey(calls) {
  return JSON.stringify(calls.map((c) => {
    if (c.op === 'fr') return ['fr', c.x, c.y, c.w, c.h, c.fs, c.al];
    if (c.op === 'cr') return ['cr', c.x, c.y, c.w, c.h];
    if (c.op === 'sr') return ['sr', c.x, c.y, c.w, c.h, c.ss, c.al, c.lw, c.dash];
    if (c.op === 'ft') return ['ft', c.text, c.x, c.y, c.font, c.fs, c.al, c.ta, c.tb];
    if (c.op === 'st') return ['st', c.path, c.ss, c.al, c.lw, c.dash];
    if (c.op === 'fi') return ['fi', c.path, c.fs, c.al];
    return [c.op];
  }));
}
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
module.exports = { paintKey, parseChart, parseStrip, parseStripOver, parseOver, fontOf, inkBox, hit, CHIP_TEXT, EDGE_TEXT, NOTE_EMPTY, NOTE_NONE };
