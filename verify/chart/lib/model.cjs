// The expectations (out/expect.json, written by expect.mjs) as the checks use them.
const fs = require('fs');
const DAY = 86400000;
const iso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const FAM_NAME = ['Sequential', 'Aggressive Sequential', 'Combo', 'Aggressive Combo'];
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => { const x = lum(rgbOf(a)), y = lum(rgbOf(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function isLift(base, fg, surface, c) {
  if (!/^#[0-9a-f]{6}$/.test(c) || !/^#[0-9a-f]{6}$/.test(fg)) return false;
  const b = rgbOf(base), f = rgbOf(fg), x = rgbOf(c);
  let best = null; for (let t = 0.01; t <= 0.9; t += 0.01) { const err = Math.max(...[0, 1, 2].map((i) => Math.abs(x[i] - (b[i] + (f[i] - b[i]) * t)))); if (best === null || err < best) best = err; }
  return best <= 1.5 && contrast(c, surface) >= 3;
}
class Model {
  constructor(file) {
    this.E = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.TFS = this.E.tfs; this.LAST = this.E.LAST;
    this.famColor = this.E.famColor.map((c) => c.toLowerCase()); this.setupColor = this.E.setupColor.toLowerCase();
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
  // The color a label is painted in: the indicator's family color (gray for a 9). On a theme whose surface the family
  // color hardly stands out from (contrast under 3: the Combo purple on the dark theme) the page may lift it towards
  // the text color; such a color is accepted once, if it lies between the family color and the text color and stands
  // out (contrast 3 or more), and from then on it has to be that same color everywhere.
  colorOf(L, theme, painted) {
    if (L.kind === 'S') return this.setupColor;
    const base = this.famColor[L.f];
    if (!theme || !theme.surface || contrast(base, theme.surface) >= 3) return base;
    const key = theme.surface + '|' + L.f;
    if (!this.lift) this.lift = new Map();
    if (!this.lift.has(key) && painted && isLift(base, theme.fg, theme.surface, painted)) this.lift.set(key, painted);
    return this.lift.get(key) || base;
  }
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
module.exports = { Model, iso, DAY, FAM_NAME };
