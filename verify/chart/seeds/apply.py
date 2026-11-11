#!/usr/bin/env python3
# Seeds ONE error into a COPY of the repository (never into the repository itself):  apply.py <seed> <copyDir>
# Each seed is one replacement in dashboard/mockups/be-chart.js (or dashboard/td-view.js); the text replaced must be
# there exactly once, so a seed that no longer fits the page says so instead of doing nothing.
import sys, os
BE = 'dashboard/mockups/be-chart.js'
SEEDS = {
 # --- the nine errors asked for ---
 'week-day-early': (BE, "a week-timeframe number one day early (the day the number is written at)",
   "let day = e; while (day > cur.first && !hasBar(day)) day--;",
   "let day = /W$/.test(x.tf) ? e - 1 : e; while (day > cur.first && !hasBar(day)) day--;"),
 'week-day-early-paint': (BE, "a week-timeframe number painted one day early while the probe still names the right day",
   "m.items.push({ a, cx: X(a.day), text:",
   "m.items.push({ a, cx: X(/W$/.test(a.tf) ? a.day - 1 : a.day), text:"),
 'drop-same-day': (BE, "a number dropped when two timeframes end on the same day",
   "for (const a of labelsAt(d0, d1)) m.items.push({",
   "for (const a of labelsAt(d0, d1)) if (!(m.items.length && m.items[m.items.length - 1].a.day === a.day && m.items[m.items.length - 1].a.dir === a.dir && m.items[m.items.length - 1].a.j !== a.j)) m.items.push({"),
 'wrong-family-color': (BE, "a Combo 13 painted in the Aggressive Combo color",
   "ctx.globalAlpha = alphaOf(a); ctx.fillStyle = colorOf(a); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';",
   "ctx.globalAlpha = alphaOf(a); ctx.fillStyle = a.kind === 'C' && a.f === 2 ? INK[3] : colorOf(a); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';"),
 'neighbour-superscript': (BE, "the superscript of the neighbouring timeframe (2W written as 3W)",
   "ctx.font = def ? FONT.supDef : FONT.sup; ctx.fillText(a.tf, it.x + 2 + it.nw,",
   "ctx.font = def ? FONT.supDef : FONT.sup; ctx.fillText(a.j === 10 ? TFS[11] : a.tf, it.x + 2 + it.nw,"),
 'folded-missing': (BE, "a folded number missing from its chip",
   "chip.members.push(...fold); chip.keys.add(st.key);",
   "chip.members.push(...fold.slice(0, Math.max(1, fold.length - 1))); chip.keys.add(st.key);"),
 'strip-row': (BE, "a strip tick on the neighbouring row (2W drawn on the 3W row)",
   "xb = X(Math.min(cell.e, LAST) + 1), y = rowTop(cell.j, cell.dir);",
   "xb = X(Math.min(cell.e, LAST) + 1), y = rowTop(cell.j === 10 ? 11 : cell.j, cell.dir);"),
 'cond-tick-view': ('dashboard/td-view.js', "a condition price shifted by one tick (in td-view.js, so the page and the Node expectations shift alike)",
   "  return { now: false, p, pct: p / c0 - 1, q, qpct: q / c0 - 1, dir: p < c0 ? -1 : 1 };",
   "  const ps = Math.round((p + 0.01) * 100) / 100, qs = q === p ? ps : q;\n  return { now: false, p: ps, pct: ps / c0 - 1, q: qs, qpct: qs / c0 - 1, dir: p < c0 ? -1 : 1 };"),
 'cond-tick-page': (BE, "a condition price shifted by one tick (in the page: what the probe and the tooltip's chip say)",
   "return { j: q.j, tf: q.tf, k: q.k, d: q.d, f: q.f, o: q.o, p: q.fire.p, q: q.fire.q,",
   "return { j: q.j, tf: q.tf, k: q.k, d: q.d, f: q.f, o: q.o, p: q.fire.p + 0.01, q: q.fire.q,"),
 'cond-tick-list': (BE, "a condition price shifted by one tick (in the list of a narrow screen)",
   "else { out.push(lab(f.dir < 0 ? '저가 ' : '고가 '), fmtPrice(f.p));",
   "else { out.push(lab(f.dir < 0 ? '저가 ' : '고가 '), fmtPrice(f.p + 0.01));"),
 'pixel-in-candle': (BE, "a number one pixel inside a candle",
   "else { it.shown = 'text'; it.y = toY(it.a.dir, it.u, it.h);",
   "else { it.shown = 'text'; it.y = toY(it.a.dir, it.u, it.h) + (it.a.dir === BUY ? -(GAP + 1) : GAP + 1);"),
 'nine-larger-1m': (BE, "a 9 painted larger on 1M",
   "ctx.font = def ? FONT.numDef : a.kind === 'C' ? FONT.num13 : FONT.num9; ctx.fillText(a.text, it.x + 1, base);",
   "ctx.font = def ? FONT.numDef : a.kind === 'C' ? FONT.num13 : a.j === 12 ? FONT.num9.replace('12.5px', '14px') : FONT.num9; ctx.fillText(a.text, it.x + 1, base);"),
 # --- more, one for each check that the nine do not reach ---
 'tooltip-origin': (BE, "a 13's tooltip names only its first origin bar",
   "` · 출발 봉 ${L.origins.map((o) => iso(b.start[o])).join(', ')}`}`;",
   "` · 출발 봉 ${L.origins.slice(0, 1).map((o) => iso(b.start[o])).join(', ')}`}`;"),
 'day-tooltip-misses': (BE, "the day tooltip leaves out a label when two stand at the day",
   "    const list = labelsAt(s, e);\n    if (e > s) out.push(",
   "    const list = labelsAt(s, e).slice(labelsAt(s, e).length > 1 ? 1 : 0);\n    if (e > s) out.push("),
 'strip-box-off': (BE, "the 현재 창 box begins 30 days late",
   "function stripBox() { const xa = Math.round(SM.X(win.d0));",
   "function stripBox() { const xa = Math.round(SM.X(win.d0 + 30));"),
 'mark-color': (BE, "a Sequential 13 shown as a mark in the Aggressive Combo color",
   "ctx.globalAlpha = a.kind === 'C' ? 1 : a.kind === 'S' ? (a.rep ? 0.5 : 0.9) : 0.55; ctx.fillStyle = colorOf(a); ctx.fillRect(it.x, it.y, it.w, it.h);",
   "ctx.globalAlpha = a.kind === 'C' ? 1 : a.kind === 'S' ? (a.rep ? 0.5 : 0.9) : 0.55; ctx.fillStyle = a.kind === 'C' && a.f === 0 ? INK[3] : colorOf(a); ctx.fillRect(it.x, it.y, it.w, it.h);"),
 'x2-dropped': (BE, "13x2 painted as 13",
   "ctx.font = def ? FONT.numDef : a.kind === 'C' ? FONT.num13 : FONT.num9; ctx.fillText(a.text, it.x + 1, base);",
   "ctx.font = def ? FONT.numDef : a.kind === 'C' ? FONT.num13 : FONT.num9; ctx.fillText(a.text.replace(/x\\d+$/, ''), it.x + 1, base);"),
 'nine-toggle-leaks': (BE, "9 끔 also switches +13 on",
   "const set = (k) => (v) => { S[k] = v; BE.save(); reset(); };",
   "const set = (k) => (v) => { S[k] = v; if (k === 'nine' && v === 'off') S.def = 'on'; BE.save(); reset(); };"),
 'chip-tooltip-misses': (BE, "the chip's tooltip leaves out its first folded number",
   "labelRows(chip.members.map((it) => it.a), 12),",
   "labelRows(chip.members.slice(chip.members.length > 1 ? 1 : 0).map((it) => it.a), 12),"),
 'sell-under': (BE, "the sell 13s of 2W written at the bar's first day instead of its last",
   "const item = { j: x.j, tf: x.tf, k, L, bar: L.bar, s, e, day, dir: L.dir,",
   "if (x.tf === '2W' && L.dir === SELL && is13) day = Math.max(s, cur.first);\n        const item = { j: x.j, tf: x.tf, k, L, bar: L.bar, s, e, day, dir: L.dir,"),
 'canvas-hidden': (BE, "the chart's canvas made invisible by a style (everything is still painted into it)",
   ".bec-box canvas { position: absolute; left: 0; top: 0; display: block; }",
   ".bec-box canvas { position: absolute; left: 0; top: 0; display: block; }\n.bec-chart canvas:not(.bec-over) { opacity: 0; }"),
 'overlay-covers': (BE, "a panel of the page laid over the upper part of the chart",
   ".bec-box { position: relative; min-width: 0; overflow: hidden; }",
   ".bec-box { position: relative; min-width: 0; overflow: hidden; }\n.bec-chart::after { content: ''; position: absolute; left: 0; top: 0; width: 100%; height: 60%; background: var(--surface); }"),
 'host-only-shift': (BE, "the view shifted by 7 px only inside the host's document (which has viewport-fit in its viewport meta)",
   "      root = node;\n      if (!document.getElementById(CSS_ID))",
   "      root = node;\n      if (document.querySelector('meta[name=\"viewport\"][content*=\"viewport-fit\"]')) root.style.paddingTop = '7px';\n      if (!document.getElementById(CSS_ID))"),
 'hover-moves': (BE, "hovering a number lays the chart out again with the number's stack unfolded",
   "if (k !== hkey || (thing && thing.type === 'day')) { hkey = k; hover = thing; schedule(D_OVER | D_SOVER); }",
   "if (k !== hkey || (thing && thing.type === 'day')) { hkey = k; hover = thing; if (thing && thing.type === 'label' && thing.it.st) { unfold.set(thing.it.st.key, thing.it.st.key); schedule(D_LAYOUT); } schedule(D_OVER | D_SOVER); }"),
}
def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--list':
        for k, v in SEEDS.items(): print(f'{k}\t{v[0]}\t{v[1]}')
        return
    name, root = sys.argv[1], sys.argv[2]
    if os.path.isdir(os.path.join(root, '.git')): sys.exit('refusing to seed a git checkout: seed a copy')
    path, what, old, new = SEEDS[name]
    p = os.path.join(root, path); s = open(p, encoding='utf8').read()
    n = s.count(old)
    if n != 1: sys.exit(f'seed {name}: the text to replace occurs {n} times in {path}')
    open(p, 'w', encoding='utf8').write(s.replace(old, new))
    print(f'seeded {name}: {what}')
main()
