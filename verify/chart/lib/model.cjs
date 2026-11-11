// The expectations (expect.json, written by expect.mjs) as the checks use them, and the rules of the picture that are
// plain numbers: the colors of the numbers on each theme, their sizes by the chart's width, how important a number is
// where room is short, and how a timeframe is shown in a wide window. These are written here from the rules the
// picture was specified with, not read from the page.
const fs = require('fs');
const DAY = 86400000;
const iso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const FAM_NAME = ['Sequential', 'Aggressive Sequential', 'Combo', 'Aggressive Combo'];
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrastRgb = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const contrast = (a, b) => contrastRgb(rgbOf(a), rgbOf(b));
// a color painted at a strength over a ground, as the eye gets it
const over = (hex, alpha, ground) => { const c = rgbOf(hex), g = rgbOf(ground); return c.map((v, i) => g[i] + (v - g[i]) * alpha); };

// ---- the rules ----
// The dark theme's own colors for the numbers (the light theme has the indicator's): Sequential, Combo and the 9.
const DARK_FAM = { 0: '#e25151', 2: '#a866e0' }, DARK_NINE = '#9296a1';
// One size for every timeframe, by the chart's width: the number and its superscript, a +13 and its superscript, and
// the distance from one line of a stack to the next (not given for the narrow size).
const SIZE = (w) => (w < 560 ? { key: 'narrow', num: 13, sup: 9, def: 12, supDef: 9, pitch: null } : w < 1700 ? { key: 'middle', num: 15, sup: 10.5, def: 12, supDef: 9, pitch: 18 } : { key: 'wide', num: 17, sup: 11.5, def: 14, supDef: 10, pitch: 20 });
const K_STACK = 5;                  // numbers a stack shows
const PPD_ALL13 = 1.25, PPD_NINE = 2.6, T_NUM = 4.5;   // px a day from which every 13 is a number / a 9 is a number; under PPD_ALL13: the width of a timeframe's bar from which it is written
const NEAR_PX = 40;                 // a folded 13 of 2W or longer lets no 13 of a shorter timeframe stay written this near
// the days of a timeframe's bar: n days, n weeks, or n months of a twelfth of a year
const tfDays = (tf) => { const m = /^(\d+)([DWM])$/.exec(tf); return Number(m[1]) * (m[2] === 'D' ? 1 : m[2] === 'W' ? 7 : 365.25 / 12); };
// How a label of a kind ('C' 13, 'S' 9, 'I' +13) on a timeframe is shown at ppd px a day: 'num' (a number, or folded
// by the rules of a pile), 'mark', 'off' (not on the chart). Returns the set of readings that the rule allows: two of
// them where the bar's width is within a five-hundredth of a threshold (a month is not a whole number of days).
function modesOf(kind, tf, ppd) {
  if (ppd >= PPD_ALL13) return [kind === 'C' || ppd >= PPD_NINE ? 'num' : 'mark'];
  const w = tfDays(tf) * ppd, lo = kind === 'C' ? T_NUM / 5 : T_NUM / 2, out = new Set();
  for (const k of [0.998, 1, 1.002]) out.add(w * k >= T_NUM ? 'num' : w * k >= lo ? 'mark' : 'off');
  return [...out];
}
// how much a number matters where room is short: a 13 before a 9 before a +13, the longer timeframe first
const impOf = (L) => (L.kind === 'C' ? 2 : L.kind === 'S' ? 1 : 0) * 100 + L.j;

class Model {
  constructor(file) {
    this.E = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.TFS = this.E.tfs; this.LAST = this.E.LAST;
    this.famColor = this.E.famColor.map((c) => c.toLowerCase()); this.setupColor = this.E.setupColor.toLowerCase();
    this.J_2W = this.TFS.indexOf('2W');
    this.all = {};
    for (const [slug, c] of Object.entries(this.E.coins)) {
      const list = [];
      for (const T of c.tfs) for (const L of T.labels) list.push({ ...L, j: T.j, tf: T.tf, id: `${slug}:${T.tf}:${L.k}`, key: Model.key({ j: T.j, bar: L.bar, kind: L.kind, dir: L.dir, f: L.f, text: L.text }) });
      list.sort((a, b) => a.day - b.day || a.j - b.j || a.k - b.k);
      this.all[slug] = list;
    }
  }
  static key(L) { return `${L.j}|${L.bar}|${L.kind}|${L.dir}|${L.f == null ? '-' : L.f}|${L.text}`; }
  coin(slug) { return this.E.coins[slug]; }
  slugs() { return Object.keys(this.E.coins); }
  // what the toggles leave: st = { off: [tf names], nine, def, dir, fam: [families] }
  selected(L, st) {
    if (st.off.includes(L.tf)) return false;
    if (st.dir === 'buy' && L.dir !== -1) return false;
    if (st.dir === 'sell' && L.dir !== 1) return false;
    if (L.kind === 'S') return st.nine === 'on';
    if (L.kind === 'I') return st.def === 'on' && st.fam.includes(L.f);
    return st.fam.includes(L.f);
  }
  inWindow(slug, st, d0, d1) { return this.all[slug].filter((L) => L.day >= d0 && L.day <= d1 && this.selected(L, st)); }
  // The color a label is painted in: the indicator's family color, gray for a 9; on the dark theme the red, the purple
  // and the gray are the lighter ones of that theme.
  colorOf(L, dark) {
    if (L.kind === 'S') return dark ? DARK_NINE : this.setupColor;
    return dark && DARK_FAM[L.f] ? DARK_FAM[L.f] : this.famColor[L.f];
  }
  famColorOn(f, dark) { return dark && DARK_FAM[f] ? DARK_FAM[f] : this.famColor[f]; }
  // every color a number can have on a theme (for "is this line in a number's color?")
  inks(dark) { return [0, 1, 2, 3].map((f) => this.famColorOn(f, dark)).concat([dark ? DARK_NINE : this.setupColor]); }
  hasBar(slug, day) { const c = this.E.coins[slug], i = day - c.d0; return day <= this.LAST && i >= 0 && i < c.daily.c.length && c.daily.c[i] != null; }
  ohlc(slug, day) { const c = this.E.coins[slug], i = day - c.d0; return { o: c.daily.o[i], h: c.daily.h[i], l: c.daily.l[i], c: c.daily.c[i] }; }
  // the conditions the zone has to show: every trigger that one move of the price can meet, of what the toggles select
  conds(slug, st) {
    const out = [];
    for (const T of this.E.coins[slug].tfs) {
      if (st.off.includes(T.tf)) continue;
      for (const t of T.trigs) {
        if (!t.fire) continue;
        if (st.dir === 'buy' && t.d !== -1) continue;
        if (st.dir === 'sell' && t.d !== 1) continue;
        if (t.k === 'C13' ? !st.fam.includes(t.f) : st.nine !== 'on') continue;
        out.push({ ...t, j: T.j, tf: T.tf, progress: T.progress, key: `${T.j}|${t.k}|${t.d}|${t.f == null ? '-' : t.f}|${t.o == null ? '-' : t.o}` });
      }
    }
    return out;
  }
}
module.exports = { Model, iso, DAY, FAM_NAME, DARK_FAM, DARK_NINE, SIZE, K_STACK, PPD_ALL13, PPD_NINE, T_NUM, NEAR_PX, tfDays, modesOf, impOf, contrast, contrastRgb, over, rgbOf };
