// What was painted, read from the recorded canvas calls by the picture's visual grammar alone (colors of the theme,
// fonts, shapes). Nothing here asks the page what it meant: a call that fits no part of the grammar lands in `unknown`,
// and the checks fail on it.
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

function parseChart(frame, theme) {
  const calls = frame.calls, T = theme;
  const out = { W: frame.w, H: frame.h, n: frame.n, wipe: false, lines: [], dateMarks: [], prices: [], dates: [], candles: [], closeLine: null, zone: null, leaders: [], pointers: [],
    marks: [], numbers: [], chips: [], handles: [], note: null, unknown: [], plotL: null, plotB: null, order: [] };
  if (!calls.length) { out.unknown.push({ why: 'empty frame' }); return out; }
  const zg = calls.find((c) => c.op === 'fi' && isRR(c) && c.fs === T.sunken && c.al < 0.9 && c.path[0][4] > 100);
  if (zg) out.zone = { ...rrBox(zg), x0: zg.path[0][1], title: null, closeLine: null, closeTag: null, chips: [], more: [], empty: [], stray: [] };
  const Z = out.zone, inZone = (x) => !!Z && x >= Z.x0 - 0.5;
  const unk = (c, why) => out.unknown.push({ why, i: c.i, op: c.op, text: c.text, x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, ss: c.ss, al: c.al, path: Array.isArray(c.path) ? c.path.slice(0, 5) : c.path, font: c.font });
  let zc = null;   // the condition chip being read in the zone
  const zchip = () => (zc || (zc = { rail: null, tick: null, pointer: null, dot: null, arrow: null, box: null, ground: null, frame: null, text: null, sup: null, dist: null }));
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i], n1 = calls[i + 1], n2 = calls[i + 2];
    if (c.tr) { unk(c, 'transform'); continue; }
    if (i === 0) { if (c.op === 'fr' && c.fs === T.surface && c.al === 1 && c.x <= 0 && c.y <= 0 && c.w >= frame.w && c.h >= frame.h) { out.wipe = true; continue; } unk(c, 'first call is not the wipe'); continue; }
    if (c === zg) continue;
    if (c.op === 'fr') {
      if (c.fs === T.line && c.al === 1) { if (c.h === 1 && c.w > 8) out.lines.push(c); else if (c.w === 1 && c.h === 4) out.dateMarks.push(c); else unk(c, 'line-colored rect'); continue; }
      if (c.fs === T.faint || c.fs === T.fg) { out.candles.push({ x: c.x, y: c.y, w: c.w, h: c.h, cls: c.fs === T.faint ? 'soft' : 'hard', al: c.al, i: c.i }); continue; }
      if (c.fs === T.surface && c.al < 1) {
        if (n1 && n2 && n1.op === 'ft' && n2.op === 'ft') { out.numbers.push({ ground: { x: c.x, y: c.y, w: c.w, h: c.h, al: c.al }, t: n1, s: n2, i: c.i }); i += 2; continue; }
        unk(c, 'a ground without its number'); continue;
      }
      if (c.w <= 4 && c.h <= 5 && c.w > 0 && c.h > 0 && !inZone(c.x)) { out.marks.push({ x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, al: c.al, i: c.i }); continue; }
      unk(c, 'rect'); continue;
    }
    if (c.op === 'ft') {
      const f = fontOf(c.font);
      if (f.fam === 'mono') {
        if (inZone(c.x) && c.ta === 'right') { Z.closeTag = c; continue; }
        if (inZone(c.x) && c.ta === 'left') { if (zc && zc.text) { zc.dist = c; Z.chips.push(zc); zc = null; } else Z.stray.push(c); continue; }
        if (c.ta === 'right') { out.prices.push(c); continue; }
        if (c.ta === 'center') { out.dates.push(c); continue; }
        unk(c, 'mono text'); continue;
      }
      if (inZone(c.x)) {
        if (c.text === '다음 봉 조건') { Z.title = c; continue; }
        if (c.text === '충족' && zc && zc.text) { zc.dist = c; Z.chips.push(zc); zc = null; continue; }
        if (zc && zc.frame && !zc.text) { zc.text = c; continue; }
        if (zc && zc.text && !zc.sup) { zc.sup = c; continue; }
        if (/조건이 없습니다|나올$/.test(c.text)) { Z.empty.push(c); continue; }
        Z.stray.push(c); continue;
      }
      if (c.ta === 'center' && /TradingView 일봉이 없습니다/.test(c.text)) { out.note = c; continue; }
      unk(c, 'text'); continue;
    }
    if (c.op === 'fi' || c.op === 'st') {
      if (c.path === 'path2d') { unk(c, 'path2d'); continue; }
      if (isRR(c)) {
        const b = rrBox(c);
        if (c.op === 'fi' && c.fs === T.sunken && c.al === 1 && n1 && n2 && n1.op === 'st' && isRR(n1) && n2.op === 'ft') {
          const chip = { x: b.x, y: b.y, w: b.w, h: b.h, text: n2.text, t: n2, i: c.i, frameColor: n1.ss };
          if (inZone(b.x)) Z.more.push(chip); else if (/^외 \d+개$/.test(n2.text)) out.chips.push(chip); else if (n2.text === '접기') out.handles.push(chip); else { unk(c, 'a chip with another text'); }
          i += 2; continue;
        }
        if (inZone(b.x)) {
          const q = zchip();
          if (c.op === 'fi' && c.fs === T.surface && c.al === 1 && !q.box) { q.box = b; continue; }
          if (c.op === 'fi' && q.box && !q.frame && !q.ground) { q.ground = { color: c.fs, al: c.al, ...b }; continue; }
          if (c.op === 'st' && q.box && !q.frame) { q.frame = { color: c.ss, al: c.al, lw: c.lw, dash: c.dash, ...b }; continue; }
        }
        unk(c, 'round rect'); continue;
      }
      if (inZone(Array.isArray(c.path) && c.path[0] ? c.path[0][1] : 0) || (Z && Array.isArray(c.path) && c.path.some((s) => s[1] >= Z.x0))) {
        if (c.op === 'st' && c.dash && c.dash.length) { Z.closeLine = c; continue; }
        const q = zchip();
        if (c.op === 'st' && isLine(c, 3)) { q.pointer = c; continue; }
        if (c.op === 'st' && isLine(c, 2)) { if (near(c.path[0][1], c.path[1][1])) q.rail = c; else if (near(c.path[0][2], c.path[1][2])) q.tick = c; else unk(c, 'zone line'); continue; }
        if (c.op === 'fi' && isTri(c)) { q.arrow = c; continue; }
        if (c.op === 'fi' && c.path.length === 1 && c.path[0][0] === 'A') { q.dot = c; continue; }
        unk(c, 'zone path'); continue;
      }
      if (c.op === 'st' && isLine(c, 2) && !(c.dash && c.dash.length)) { out.leaders.push({ x1: c.path[0][1], y1: c.path[0][2], x2: c.path[1][1], y2: c.path[1][2], color: c.ss, al: c.al, lw: c.lw, i: c.i }); continue; }
      if (c.op === 'fi' && isTri(c)) { out.pointers.push({ pts: c.path.slice(0, 3).map((s) => [s[1], s[2]]), color: c.fs, al: c.al, i: c.i }); continue; }
      if (c.op === 'st' && Array.isArray(c.path) && c.path.length > 2 && c.ss === T.fg && !out.closeLine) { out.closeLine = c; continue; }
      unk(c, 'path'); continue;
    }
    unk(c, 'call');
  }
  if (zc && (zc.box || zc.pointer || zc.rail)) { if (Z) Z.stray.push({ text: 'a condition chip that was not finished', ...zc }); }
  if (out.lines.length) { out.plotL = out.lines[0].x; out.plotB = Math.max(...out.lines.map((l) => l.y)); out.gridR = out.lines[0].x + out.lines[0].w; }
  // numbers: text, superscript, fonts, color, and the boxes
  for (const N of out.numbers) {
    const ft = fontOf(N.t.font), fs = fontOf(N.s.font), bt = inkBox(N.t), bs = inkBox(N.s);
    N.text = N.t.text; N.sup = N.s.text; N.color = N.t.fs; N.supColor = N.s.fs; N.alpha = N.t.al; N.supAlpha = N.s.al; N.font = ft; N.supFont = fs;
    N.base = N.t.y; N.supBase = N.s.y;
    const x0 = Math.min(bt.x, bs.x), y0 = Math.min(bt.y, bs.y), x1 = Math.max(bt.x + bt.w, bs.x + bs.w), y1 = Math.max(bt.y + bt.h, bs.y + bs.h);
    N.ink = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    N.supAfter = N.s.x >= N.t.x + N.t.mw - 0.6;   // the superscript begins where the number ends
    N.supGap = N.s.x - (N.t.x + N.t.mw);            // and how far after it (1 px by the page's own spacing)
    N.inGround = x0 >= N.ground.x - 1.01 && x1 <= N.ground.x + N.ground.w + 1.01 && y0 >= N.ground.y - 1.01 && y1 <= N.ground.y + N.ground.h + 1.01;
  }
  return out;
}

function parseStrip(frame, theme) {
  const calls = frame.calls, T = theme;
  const out = { W: frame.w, H: frame.h, n: frame.n, wipe: false, closeLine: null, dots: [], grounds: [], ticks: [], dateMarks: [], dates: [], groups: [], bands: [], unknown: [] };
  const unk = (c, why) => out.unknown.push({ why, i: c.i, op: c.op, text: c.text, x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, al: c.al });
  calls.forEach((c, i) => {
    if (c.tr) return unk(c, 'transform');
    if (i === 0) { if (c.op === 'fr' && c.fs === T.surface && c.x <= 0 && c.y <= 0 && c.w >= frame.w && c.h >= frame.h) { out.wipe = true; return; } return unk(c, 'first call is not the wipe'); }
    if (c.op === 'st') { if (!out.closeLine && Array.isArray(c.path) && c.ss === T.muted) { out.closeLine = c; return; } return unk(c, 'stroke'); }
    if (c.op === 'fr') {
      if (c.fs === T.muted && c.w === 1 && c.h === 1) return void out.dots.push(c);
      if (c.fs === T.sunken) return void out.grounds.push({ x: c.x, y: c.y, w: c.w, h: c.h, al: c.al });
      if (c.fs === T.line && c.w === 1 && c.h === 4) return void out.dateMarks.push(c);
      if (c.fs === T.surface || c.fs === T.line || c.fs === T.muted || c.fs === T.fg || c.fs === T.faint) return unk(c, 'rect');
      return void out.ticks.push({ x: c.x, y: c.y, w: c.w, h: c.h, color: c.fs, al: c.al, i: c.i });
    }
    if (c.op === 'ft') {
      const f = fontOf(c.font);
      if (f.fam === 'mono' && c.ta === 'center') return void out.dates.push(c);
      if (f.fam === 'mono' && c.ta === 'right' && /^\d+[DWM]~\d+[DWM]$/.test(c.text)) return void out.groups.push(c);
      if (f.fam === 'sans' && c.ta === 'right' && /^[▲▼] (매도|매수) 쪽$/.test(c.text)) return void out.bands.push(c);
      return unk(c, 'text');
    }
    return unk(c, 'call');
  });
  return out;
}

function parseStripOver(frame, theme) {
  const T = theme, out = { n: frame.n, wipe: false, box: null, stroke: null, nameBg: null, name: null, hi: null, tri: null, unknown: [] };
  frame.calls.forEach((c, i) => {
    if (i === 0) { if (c.op === 'cr') out.wipe = true; else out.unknown.push(c); return; }
    if (c.op === 'fr' && c.fs === T.accent && !out.box) { out.box = { x: c.x, y: c.y, w: c.w, h: c.h, al: c.al }; return; }
    if (c.op === 'sr' && c.ss === T.accent && !out.stroke) { out.stroke = { x: c.x, y: c.y, w: c.w, h: c.h }; return; }
    if (c.op === 'fr' && c.fs === T.surface && !out.nameBg) { out.nameBg = c; return; }
    if (c.op === 'ft' && c.text === '현재 창') { out.name = c; return; }
    if (c.op === 'sr' && c.ss === T.fg) { out.hi = { x: c.x, y: c.y, w: c.w, h: c.h }; return; }
    if (c.op === 'fi' && isTri(c)) { out.tri = c; return; }
    out.unknown.push({ op: c.op, text: c.text, x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs });
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
module.exports = { paintKey, parseChart, parseStrip, parseStripOver, fontOf, inkBox, hit };
