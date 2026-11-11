// Check 5: the strip of the whole history (전체 기간). Every painted tick is an engine 9 or 13 on the row of its
// timeframe, in the band of its side, in its family's color, over the days of its bar; every engine 9 and 13 the
// toggles select has its tick (on a narrow screen the 13s alone). The close runs in a lane of its own between the two
// bands: inside a band on no day, in no pixel row of a 9 tick. The bands' grounds are opaque and stand out from the
// surface (1.12:1 at least), the rows are as high as the window's height says, the band names are "매도 쪽" and
// "매수 쪽". A tick of a label that TradingView has deleted is drawn apart. The 현재 창 box covers the chart's window,
// also after the strip itself was dragged, resized, clicked and keyed ("+" narrows, "-" widens). Pointing at the
// strip shows a hairline with the date, on a tick that number's tooltip; a 13 that is pointed at has its origin bars
// marked.
//   node strip.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model, iso, FAM_NAME, contrast } = require('../lib/model.cjs'), P = require('../lib/paint.cjs');
const A = Q.args();
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c05_strip'), TFS = M.TFS;
  const GROUPS = [TFS.slice(0, 7), TFS.slice(7, 12), TFS.slice(12)];
  // [width, height, touch, device pixels, dark]
  const views = A.quick ? [[1440, 900, false, 1, false], [390, 844, true, 3, false]] : [[1440, 900, false, 1, false], [1440, 900, false, 1, true], [1920, 1080, false, 1, false], [1440, 789, false, 1, false], [1280, 720, false, 2, false], [390, 844, true, 3, false], [390, 844, true, 2, true]];
  const measures = [];
  for (const [vw, vh, touch, dpr, dark] of views) {
    await Promise.all(M.slugs().map(async (slug) => {
      const coin = M.coin(slug), all = M.all[slug], tag0 = `${slug} ${vw}x${vh}${dpr > 1 ? '@' + dpr : ''}${dark ? ' dark' : ''}`;
      const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, width: vw, height: vh, touch, dpr, dark });
      const { page } = ctx;
      let st = { ...Q.DEFAULT_STATE };
      const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
      const bad = (tag, msg) => C.fail(`[${tag0} ${tag}] ${msg}`);
      const eps = 0.5 / dpr + 0.01;
      // ---- the ticks of one state ----
      const ticksOf = async (tag) => {
        const s = await Q.snap(page, { strip: true, nobase: true }), p = s.probe, sc = p.stripScale, T = s.theme;
        const g = P.parseStrip(s.frames.sBase, T), narrow = g.W < 560;
        C.count('states');
        if (g.unknown.length) bad(tag, `${g.unknown.length} painted calls of the strip fit no part of it, first ${JSON.stringify(g.unknown[0])}`);
        const X = (d) => sc.x0 + (d - sc.first) * sc.ppd;
        if (sc.first !== coin.first) bad(tag, `the strip begins at ${iso(sc.first)}, the first daily bar is ${iso(coin.first)}`);
        if (Math.abs(X(M.LAST + 1) - sc.x1) > 0.01) bad(tag, `the strip's scale ends at x ${X(M.LAST + 1)} for the day after the last, its plot at ${sc.x1}`);
        // the grounds: six, over the plot's width, opaque, standing out from the surface
        if (g.grounds.length !== 6) { bad(tag, `${g.grounds.length} band grounds painted, 6 expected (2 sides x 3 timeframe groups)`); return null; }
        for (const gr of g.grounds) {
          if (Math.abs(gr.x - sc.x0) > 0.01 || Math.abs(gr.x + gr.w - sc.x1) > 0.01) bad(tag, `a band ground spans x ${gr.x}..${gr.x + gr.w}, the scale ${sc.x0}..${sc.x1}`);
          if (gr.al !== 1) bad(tag, `a band ground is painted at strength ${gr.al}: the grounds are opaque`);
          const cr = /^#[0-9a-f]{6}$/.test(gr.color) ? contrast(gr.color, T.surface) : 0;
          if (cr < 1.12) bad(tag, `a band ground in ${gr.color} has a contrast of ${cr.toFixed(3)}:1 against the surface ${T.surface} (1.12:1 at least)`);
        }
        const grounds = g.grounds.slice().sort((a, b) => a.y - b.y), sellB = grounds[2].y + grounds[2].h, buyT = grounds[3].y, lane = buyT - sellB;
        // the lane of the close: 64 px in a window at least 800 px high, 44 px below that (a narrow strip has its own, lower one)
        const wantLane = narrow ? null : s.ih >= 800 ? 64 : 44;
        if (wantLane !== null && Math.abs(lane - wantLane) > 0.01) bad(tag, `the lane between the two bands is ${lane} px high; in a window ${s.ih} px high it is ${wantLane} px`);
        if (narrow && !(lane >= 12)) bad(tag, `the lane between the two bands is ${lane} px high`);
        for (const t of g.dates) { const d = /^\d{4}$/.test(t.text) ? Q.dayOf(t.text + '-01-01') : /^\d{4}-\d\d$/.test(t.text) ? Q.dayOf(t.text + '-01') : NaN; C.count('dateLabels'); if (!(Math.abs(X(d) - t.x) <= 0.51)) bad(tag, `date "${t.text}" is written at x ${t.x.toFixed(2)}, the scale has it at ${X(d).toFixed(2)}`); }
        // the close: one line, 1.25 px, in the text color at about 70%, a point per day with a daily bar at its log height
        // inside the lane (4 px from its ends; 3 px in a narrow strip)
        let lineY = null;
        if (g.closeLine) {
          const cl = g.closeLine, pts = cl.path, days = []; for (let d = coin.first; d <= M.LAST; d++) if (M.hasBar(slug, d)) days.push(d);
          if (cl.ss !== T.fg || Math.abs(cl.al - 0.7) > 0.06 || cl.lw !== 1.25) bad(tag, `the close line is painted in ${cl.ss} at strength ${cl.al}, ${cl.lw} px wide; expected the text color ${T.fg} at about 70%, 1.25 px`);
          // (a day between two days without a bar is a dot, and still begins a path segment of one point)
          if (pts.length !== days.length) bad(tag, `the close line has ${pts.length} points, ${days.length} days have a daily bar`);
          else {
            let lo = Infinity, hi = -Infinity; for (const d of days) { const v = M.ohlc(slug, d).c; if (v < lo) lo = v; if (v > hi) hi = v; }
            const yOf = new Map(pts.map((q, i) => [days[i], q[2]])), yLo = yOf.get(days.find((d) => M.ohlc(slug, d).c === lo)), yHi = yOf.get(days.find((d) => M.ohlc(slug, d).c === hi));
            let off = 0, offX = 0, inBand = 0;
            pts.forEach((q, i) => { const d = days[i], v = M.ohlc(slug, d).c, want = yLo - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * (yLo - yHi); if (Math.abs(want - q[2]) > 0.02) off++; if (Math.abs(q[1] - X(d + 0.5)) > 0.01) offX++; if (grounds.some((gr) => q[2] >= gr.y && q[2] <= gr.y + gr.h)) inBand++; });
            C.count('closePoints', pts.length); C.count('closePointsInABand', inBand);
            if (off || offX) bad(tag, `close line: ${off} points are not at the log height of their close, ${offX} not at their day`);
            if (!(yHi < yLo)) bad(tag, 'close line: the highest close is not drawn above the lowest');
            if (inBand) bad(tag, `the close line is inside a band on ${inBand} of ${pts.length} days (${(inBand / pts.length * 100).toFixed(1)}%)`);
            const pad = narrow ? 3 : 4;
            if (Math.abs(yHi - (sellB + pad)) > 0.02 || Math.abs(yLo - (buyT - pad)) > 0.02) bad(tag, `the close line runs from y ${yHi} to ${yLo}; the lane is ${sellB}..${buyT}, ${pad} px inside it is ${sellB + pad}..${buyT - pad}`);
            lineY = [yHi - cl.lw / 2, yLo + cl.lw / 2];
            measures.push(`${tag0} ${tag}: lane ${lane} px, line y ${yHi.toFixed(1)}..${yLo.toFixed(1)}, ground ${grounds[0].color} ${contrast(grounds[0].color, T.surface).toFixed(3)}:1`);
          }
        } else bad(tag, 'no close line painted');
        // rows from what is painted: each ground with the group name written beside it; the upper three are the sell band
        const rows = new Map(), names = g.bands.slice().sort((a, b) => a.y - b.y);
        if (names.length !== 2 || names[0].text !== '매도 쪽' || names[1].text !== '매수 쪽') bad(tag, `band names painted: ${names.map((x) => `"${x.text}"@${x.y}`).join(', ')}; expected "매도 쪽" above "매수 쪽"`);
        else if (!(sellB <= names[0].y && names[1].y <= buyT)) bad(tag, `the band names (y ${names[0].y}, ${names[1].y}) do not stand between the upper band (ends ${sellB}) and the lower band (begins ${buyT})`);
        let pitch = null;
        grounds.forEach((gr, i) => {
          const dir = i < 3 ? 1 : -1, lab = g.groups.find((t) => t.y >= gr.y && t.y <= gr.y + gr.h);
          if (!lab) return bad(tag, `no group name is written beside the ground at y ${gr.y}`);
          if (P.fontOf(lab.font).size !== 10) bad(tag, `group name "${lab.text}" is written at ${P.fontOf(lab.font).size} px (10 px)`);
          const [a, b] = lab.text.split('~').map((t) => TFS.indexOf(t));
          if (a < 0 || b < a) return bad(tag, `group name "${lab.text}"`);
          const ph = gr.h / (b - a + 1); if (pitch === null) pitch = ph; else if (Math.abs(ph - pitch) > 1e-9) bad(tag, `row heights differ: ${ph} and ${pitch}`);
          for (let j = a; j <= b; j++) { if (rows.has(j + '|' + dir)) bad(tag, `timeframe ${TFS[j]} has two rows on one side`); rows.set(j + '|' + dir, { top: gr.y + (b - j) * ph, h: ph }); }
        });
        if (rows.size !== 40) { bad(tag, `${rows.size} rows found from the grounds and group names, 40 expected`); return null; }
        // rows 2 px high, 3 px in a window from 1,000 px high, 1.5 px in a narrow strip
        const wantPitch = narrow ? 1.5 : s.ih >= 1000 ? 3 : 2;
        if (pitch !== wantPitch) bad(tag, `rows are ${pitch} px high; ${narrow ? 'in a narrow strip' : 'in a window ' + s.ih + ' px high'} they are ${wantPitch} px`);
        // the order the reader is told: 1D lowest, 12M highest, in both bands
        for (const dir of [1, -1]) for (let j = 1; j < 20; j++) if (!(rows.get(j + '|' + dir).top < rows.get((j - 1) + '|' + dir).top)) bad(tag, `row of ${TFS[j]} is not above the row of ${TFS[j - 1]}`);
        // expected ticks: every 9 and 13 of the selection; a narrow strip has the 13s alone
        const exp = all.filter((L) => L.kind !== 'I' && M.selected(L, st) && !(narrow && L.kind === 'S'));
        const key = (L) => `${L.j}|${L.bar}|${L.kind}|${L.dir}|${L.f == null ? '-' : L.f}`;
        const eBy = new Map(exp.map((L) => [key(L), L])), pBy = new Map();
        for (const t of p.strip) { const k = key(t); if (pBy.has(k)) bad(tag, `two ticks for ${TFS[t.j]} bar ${t.bar} ${t.kind} dir ${t.dir} f ${t.f}`); pBy.set(k, t); }
        for (const [k, L] of eBy) if (!pBy.has(k)) bad(tag, `no tick for ${L.tf} "${L.text}" of bar ${iso(L.s)} (${L.dir === 1 ? 'sell' : 'buy'}${L.f == null ? '' : ', family ' + L.f})`);
        for (const [k, t] of pBy) if (!eBy.has(k)) bad(tag, `a tick for ${TFS[t.j]} bar ${t.bar} ${t.kind} dir ${t.dir} f ${t.f}, which is no engine 9 or 13 of the selection${narrow && t.kind === 'S' ? ' (a narrow strip shows no 9)' : ''}`);
        C.count('expectedTicks', exp.length); C.count('paintedTicks', g.ticks.length);
        // painted rects by place
        const r3 = (v) => Math.round(v * 1000) / 1000, rBy = new Map(); for (const r of g.ticks) { const k = `${r3(r.x)}|${r3(r.y)}|${r3(r.w)}|${r3(r.h)}`; (rBy.get(k) || rBy.set(k, []).get(k)).push(r); }
        const used = new Set(), cells = new Map();
        let nineRows = 0;
        for (const [k, t] of pBy) {
          const L = eBy.get(k); if (!L) continue;
          const list = rBy.get(`${r3(t.x0)}|${r3(t.y)}|${r3(t.x1 - t.x0)}|${r3(t.h)}`) || [], color = M.colorOf(L, s.dark), r = list.find((x) => !used.has(x) && x.color === color) || list.find((x) => !used.has(x));
          if (!r) { bad(tag, `${L.tf} "${L.text}" of ${iso(L.s)}: the probe has its tick at x ${t.x0}..${t.x1}, y ${t.y}; nothing is painted there`); continue; }
          used.add(r); C.count('ticksChecked');
          if (r.color !== color) bad(tag, `${L.tf} "${L.text}" of bar ${iso(L.s)}: tick painted in ${r.color}, its color on the ${s.dark ? 'dark' : 'light'} theme is ${color}`);
          // strength and shape: a 13 full and filled, a 9 strong, a repeated 9 lighter; a tick of a label that
          // TradingView has deleted is a 1 px outline, or, where it is too low for one, clearly fainter
          if (!L.gone) {
            if (r.outline) bad(tag, `${L.tf} "${L.text}" of bar ${iso(L.s)} is on TradingView's chart, its tick is drawn as an outline`);
            if (L.kind === 'S' && !(L.rep ? r.al < 0.7 && r.al >= 0.45 : r.al >= 0.7)) bad(tag, `${L.tf} "${L.text}" (raw ${L.raw}): tick strength ${r.al}`);
            if (L.kind === 'C' && r.al !== 1) bad(tag, `${L.tf} "${L.text}": tick strength ${r.al}`);
          } else {
            C.count('ticksOfDeletedLabels');
            const full = L.kind === 'C' ? 1 : L.rep ? 0.5 : 0.9;
            if (!(r.al <= full * 0.7 + 1e-9)) bad(tag, `${L.tf} "${L.text}" of bar ${iso(L.s)} is deleted on TradingView, but its tick is painted at strength ${r.al} like one that is on the chart`);
            if (r.h >= 2 - 1e-9 && r.w >= 2 && !r.outline) bad(tag, `${L.tf} "${L.text}" of bar ${iso(L.s)} is deleted on TradingView: its tick (${r.w} x ${r.h}) is filled, not a 1 px outline`);
            if (r.outline) C.count('outlinedTicks');
          }
          // the row of its timeframe on its side
          const row = rows.get(L.j + '|' + L.dir), h13 = Math.min(2, row.h);
          const wantY = L.kind === 'C' ? row.top : row.top + row.h - 1, wantH = L.kind === 'C' ? h13 : 1;
          if (Math.abs(r.y - wantY) > eps || Math.abs(r.h - wantH) > 2 * eps) bad(tag, `${L.tf} "${L.text}" of bar ${iso(L.s)} (${L.dir === 1 ? 'sell' : 'buy'}): tick at y ${r.y} (h ${r.h}); the row of ${L.tf} on that side is y ${row.top}..${row.top + row.h}, so y ${wantY} (h ${wantH})`);
          if (L.kind === 'S' && lineY) { nineRows++; if (r.y < lineY[1] && lineY[0] < r.y + r.h) bad(tag, `the 9 tick of ${L.tf} ${iso(L.s)} (y ${r.y}..${r.y + r.h}) shares a pixel row with the close line (y ${lineY[0].toFixed(2)}..${lineY[1].toFixed(2)})`); }
          const ck = `${L.j}|${L.bar}|${L.dir}|${L.kind}`; (cells.get(ck) || cells.set(ck, []).get(ck)).push({ L, r });
        }
        C.count('nineTicksAgainstTheCloseLine', nineRows);
        for (const r of g.ticks) if (!used.has(r)) bad(tag, `a tick in ${r.color} is painted at x ${r.x}, y ${r.y} (w ${r.w}, h ${r.h}); the probe has none there`);
        // the days: the ticks of one bar and side lie over the bar's days (at least 2 px a tick), families side by side
        for (const list of cells.values()) {
          list.sort((a, b) => a.r.x - b.r.x);
          const L = list[0].L, k = list.length, xa = X(Math.max(L.s, coin.first)), xb = X(Math.min(L.e, M.LAST) + 1);
          const x0 = list[0].r.x, x1 = list[k - 1].r.x + list[k - 1].r.w, w = x1 - x0, mid = (x0 + x1) / 2;
          const atEdge = x0 <= sc.x0 + 0.01 || x1 >= Math.floor(sc.x1) - 0.01;
          if (!(w >= 2 * k - 0.01 && w <= Math.max(2 * k, xb - xa + 1.01))) bad(tag, `${L.tf} bar ${iso(L.s)}~${iso(L.e)}: its ${k} tick(s) are ${w} px wide together, its days are ${(xb - xa).toFixed(2)} px`);
          if (Math.abs(mid - (xa + xb) / 2) > Math.max(1.01, k + 0.51) && !atEdge) bad(tag, `${L.tf} bar ${iso(L.s)}~${iso(L.e)}: ticks around x ${mid.toFixed(1)}, its days around ${((xa + xb) / 2).toFixed(1)}`);
          for (let i = 1; i < k; i++) { if (list[i].r.x !== list[i - 1].r.x + list[i - 1].r.w) bad(tag, `${L.tf} bar ${iso(L.s)}: the ticks of its families are not side by side`); if (!(list[i].L.f > list[i - 1].L.f)) bad(tag, `${L.tf} bar ${iso(L.s)}: families not in order`); }
          if (k > 1) { const ws = list.map((q) => q.r.w); if (Math.max(...ws) - Math.min(...ws) > 1) bad(tag, `${L.tf} bar ${iso(L.s)}: family ticks of unequal width ${ws.join(',')}`); }
        }
        return { s, p, sc, X, rows, grounds };
      };
      // ---- the window box ----
      const boxOf = async (tag) => {
        const s = await Q.snap(page, { strip: true, nobase: true }), p = s.probe, sc = p.stripScale, o = P.parseStripOver(s.frames.sOver, s.theme), g = P.parseStrip(s.frames.sBase, s.theme);
        const X = (d) => sc.x0 + (d - sc.first) * sc.ppd;
        C.count('boxes');
        if (!o.box || !o.stroke || !o.name) { bad(tag, 'the 현재 창 box, its frame or its name is not painted'); return s; }
        const xa = X(p.d0), xb = X(p.d1 + 1), b = o.box, bottom = g.grounds.length ? Math.max(...g.grounds.map((q) => q.y + q.h)) : 0;
        if (Math.abs(b.x - xa) > 0.51 || (Math.abs(b.x + b.w - xb) > 0.51 && !(xb - xa < 3 && b.w === 3))) bad(tag, `현재 창 box painted x ${b.x}..${b.x + b.w}; the chart shows ${iso(p.d0)}~${iso(p.d1)}, which is x ${xa.toFixed(2)}..${xb.toFixed(2)} on the strip`);
        if (Math.abs(o.stroke.x - b.x) > 0.51 || Math.abs(o.stroke.x + o.stroke.w - (b.x + b.w)) > 0.51) bad(tag, `the frame of the box (${o.stroke.x}..${o.stroke.x + o.stroke.w}) is not the box (${b.x}..${b.x + b.w})`);
        if (b.y !== 0 || b.h < bottom - 0.01) bad(tag, `the box spans y ${b.y}..${b.y + b.h}, the bands end at ${bottom}`);
        // the chart says the same window in words
        const m = /^(\d{4}-\d\d-\d\d) ~ (\d{4}-\d\d-\d\d) · ([\d,]+)일$/.exec(s.winText || '');
        if (!m || Q.dayOf(m[1]) !== p.d0 || Q.dayOf(m[2]) !== p.d1 || Number(m[3].replace(/,/g, '')) !== p.d1 - p.d0 + 1) bad(tag, `window text "${s.winText}", the window is ${iso(p.d0)}~${iso(p.d1)}`);
        if (o.unknown.length) bad(tag, `strip overlay: ${o.unknown.length} unknown calls, first ${JSON.stringify(o.unknown[0])}`);
        if (o.hair || o.date || o.origins.length || o.hi) bad(tag, 'the strip shows a hairline, a date or a marked tick while nothing is pointed at');
        return s;
      };

      // 1. ticks under the toggles
      await Q.mouseOff(page);
      await ticksOf('default');
      if (vw >= 1000 && dpr === 1 && !dark) {
        const combos = [{ nine: 'off' }, { nine: 'on', def: 'on' }, { def: 'off', dir: 'buy' }, { dir: 'sell' }, { dir: 'both', fam: [0] }, { fam: [2] }, { fam: [3] }, { fam: [] }, { fam: [0, 2, 3], off: TFS.filter((t) => !GROUPS[0].includes(t)) }, { off: TFS.filter((t) => !GROUPS[1].includes(t)) }, { off: TFS.filter((t) => !GROUPS[2].includes(t)) }, { off: TFS.filter((t) => t !== '1W') }, { off: TFS.filter((t) => t !== '2W') }, { off: ['1D'] }, { off: TFS.slice() }, { off: [], nine: 'off', fam: [0, 3], dir: 'sell' }];
        for (const patch of A.quick ? combos.slice(0, 5) : combos) { await set(patch); await ticksOf(JSON.stringify(patch).slice(0, 60)); }
        await set({ ...Q.DEFAULT_STATE });
      }
      // 2. the window box: presets, then the strip's own handling
      for (const name of ['3개월', '6개월', '1년', '2년', '5년', '전체']) { await Q.preset(page, name); await Q.mouseOff(page); await boxOf('preset ' + name); }
      await Q.preset(page, '6개월');
      if (!touch) {
        const g0 = await page.evaluate(() => { const r = document.querySelector('.bec-strip canvas.bec-over').getBoundingClientRect(); return { x: r.left, y: r.top }; });
        // a click elsewhere: the window goes there
        for (const day of [coin.first + 900, coin.first + 2200, M.LAST - 700]) {
          await Q.stripClick(page, day); await Q.mouseOff(page); const s = await boxOf('click at ' + iso(day));
          C.ok(Math.abs((s.probe.d0 + s.probe.d1) / 2 - day) <= 2 / s.probe.stripScale.ppd + 1, `[${tag0}] a click on the strip at ${iso(day)} put the window at ${iso(s.probe.d0)}~${iso(s.probe.d1)}`);
        }
        // drag inside the box: the window moves and keeps its length
        let s0 = await boxOf('before drag'), sc = s0.probe.stripScale, X = (d) => sc.x0 + (d - sc.first) * sc.ppd;
        const mid = g0.x + (X(s0.probe.d0) + X(s0.probe.d1 + 1)) / 2;
        await page.mouse.move(mid, g0.y + 40); await page.mouse.down(); await page.mouse.move(mid - 60, g0.y + 40, { steps: 4 }); await page.mouse.up(); await Q.mouseOff(page);
        let s1 = await boxOf('after drag');
        C.ok(s1.probe.d0 - s0.probe.d0 === Math.round(-60 / sc.ppd) && s1.probe.d1 - s1.probe.d0 === s0.probe.d1 - s0.probe.d0, `[${tag0}] dragging the box by -60 px (${(60 / sc.ppd).toFixed(1)} days) moved the window from ${iso(s0.probe.d0)}~${iso(s0.probe.d1)} to ${iso(s1.probe.d0)}~${iso(s1.probe.d1)}`);
        // drag the left edge: the right end stays; drag the right edge: the left end stays
        s0 = s1; let xl = g0.x + X(s0.probe.d0) + 1;
        await page.mouse.move(xl, g0.y + 40); await page.mouse.down(); await page.mouse.move(xl - 30, g0.y + 40, { steps: 3 }); await page.mouse.up(); await Q.mouseOff(page);
        s1 = await boxOf('after left edge drag');
        C.ok(s1.probe.d1 === s0.probe.d1 && s1.probe.d0 < s0.probe.d0, `[${tag0}] dragging the left edge by -30 px: ${iso(s0.probe.d0)}~${iso(s0.probe.d1)} became ${iso(s1.probe.d0)}~${iso(s1.probe.d1)}`);
        s0 = s1; let xr = g0.x + X(s0.probe.d1 + 1) - 1;
        await page.mouse.move(xr, g0.y + 40); await page.mouse.down(); await page.mouse.move(xr + 25, g0.y + 40, { steps: 3 }); await page.mouse.up(); await Q.mouseOff(page);
        s1 = await boxOf('after right edge drag');
        C.ok(s1.probe.d0 === s0.probe.d0 && s1.probe.d1 > s0.probe.d1, `[${tag0}] dragging the right edge by +25 px: ${iso(s0.probe.d0)}~${iso(s0.probe.d1)} became ${iso(s1.probe.d0)}~${iso(s1.probe.d1)}`);
        // keys on the strip: "+" narrows the window and "-" widens it, as on the chart
        await page.focus('.bec-strip canvas.bec-over');
        const key = async (k, test, what) => { const a = (await Q.snap(page, { nobase: true })).probe; await page.keyboard.press(k); const b = (await boxOf('key ' + k)).probe; C.ok(test(a, b), `[${tag0}] strip key ${k} (${what}): ${iso(a.d0)}~${iso(a.d1)} became ${iso(b.d0)}~${iso(b.d1)}`); };
        await key('ArrowLeft', (a, b) => b.d0 === a.d0 - Math.max(1, Math.round((a.d1 - a.d0 + 1) * 0.1)), 'a tenth back');
        await key('ArrowRight', (a, b) => b.d0 === a.d0 + Math.max(1, Math.round((a.d1 - a.d0 + 1) * 0.1)), 'a tenth forward');
        await key('Shift+ArrowLeft', (a, b) => b.d0 === a.d0 - (a.d1 - a.d0 + 1), 'a window back');
        await key('+', (a, b) => b.d1 - b.d0 < a.d1 - a.d0, 'narrower');
        await key('-', (a, b) => b.d1 - b.d0 > a.d1 - a.d0, 'wider');
        await key('=', (a, b) => b.d1 - b.d0 < a.d1 - a.d0, 'narrower');
        await key('Home', (a, b) => b.d0 === coin.first, 'to the first day');
        await key('End', (a, b) => b.d1 === M.LAST && b.end === true, 'to the newest day');
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        // the tick of the number pointed at in the chart is marked in the strip; for a 13 also its origin bars
        await Q.preset(page, '6개월'); await Q.mouseOff(page);
        const s = await Q.snap(page, { nobase: true });
        for (const L of [s.probe.labels.find((x) => x.shown === 'text' && x.kind === 'S'), s.probe.labels.find((x) => x.shown === 'text' && x.kind === 'C')].filter(Boolean)) {
          await page.mouse.move(s.rc.x + L.x + L.w / 2, s.rc.y + L.y + L.h / 2);
          const h = await Q.snap(page, { sover: true, nobase: true }), o = P.parseStripOver(h.frames.sOver, h.theme), t = h.probe.strip.find((q) => q.j === L.j && q.bar === L.bar && q.kind === L.kind && q.dir === L.dir && q.f === L.f), scH = h.probe.stripScale;
          C.ok(o.hi && t && o.hi.x < t.x0 && o.hi.x + o.hi.w > t.x1 && o.hi.y < t.y && o.hi.y + o.hi.h > t.y + t.h, `[${tag0}] pointing at ${L.tf} "${L.text}" in the chart: the strip marks ${JSON.stringify(o.hi)}, its tick is ${JSON.stringify(t)}`);
          const E = all.find((x) => x.j === L.j && x.bar === L.bar && x.kind === L.kind && x.dir === L.dir && x.f === L.f), T2 = coin.tfs[L.j];
          if (L.kind === 'C' && E) {
            // one 1 px tick per origin bar, within the days of that bar
            const spans = E.origins.map((sd) => { const b = T2.start.indexOf(sd); return [sd, T2.end[b]]; });
            C.ok(o.origins.length === spans.length && spans.every(([a, b]) => o.origins.some((q) => q.w === 1 && q.x >= scH.x0 + (a - scH.first) * scH.ppd - 1.01 && q.x <= scH.x0 + (b + 1 - scH.first) * scH.ppd + 1.01)), `[${tag0}] pointing at ${L.tf} "${L.text}" (origin bars ${spans.map((x) => iso(x[0]) + '~' + iso(x[1])).join(', ')}): the strip marks ${JSON.stringify(o.origins)}`);
            C.count('originTicks', o.origins.length);
          } else C.ok(o.origins.length === 0, `[${tag0}] pointing at a 9: the strip marks ${o.origins.length} origin bars`);
          await Q.mouseOff(page);
        }
        // pointing at the strip: a hairline at that day with its date; on a tick the tooltip of that number
        const st0 = await ticksOf('before pointing'), scP = st0.p.stripScale;
        for (const frac of [0.13, 0.5, 0.87]) {
          const x = scP.x0 + (scP.x1 - scP.x0) * frac, laneY = (st0.grounds[2].y + st0.grounds[2].h + st0.grounds[3].y) / 2, day = Math.max(scP.first, Math.min(M.LAST, Math.floor(scP.first + (x - scP.x0) / scP.ppd)));
          await page.mouse.move(st0.s.rs.x + x, st0.s.rs.y + laneY);
          const h = await Q.snap(page, { sover: true, nobase: true }), o = P.parseStripOver(h.frames.sOver, h.theme);
          C.count('stripHovers');
          C.ok(o.hair && o.date && o.date.text === iso(day) && Math.abs(o.hair.x - (scP.x0 + (day + 0.5 - scP.first) * scP.ppd)) <= 1.01, `[${tag0}] pointing at the strip at x ${x.toFixed(1)} (${iso(day)}): hairline ${JSON.stringify(o.hair)}, date "${o.date && o.date.text}"`);
          C.ok((await Q.tip(page)) === null, `[${tag0}] pointing at the lane of the close shows a tooltip`);
        }
        // on ticks: a 13 and a 9 (the widest of their kind, so that the pointer is surely on them)
        for (const kind of ['C', 'S']) {
          const t = st0.p.strip.filter((q) => q.kind === kind && !q.gone).sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0]; if (!t) continue;
          const E = all.find((x) => x.j === t.j && x.bar === t.bar && x.kind === t.kind && x.dir === t.dir && x.f === t.f);
          await page.mouse.move(st0.s.rs.x + (t.x0 + t.x1) / 2, st0.s.rs.y + t.y + t.h / 2);
          const tip = await Q.tip(page), r = tip && tip.rows[0];
          C.count('tickTooltips');
          C.ok(r && r.num && r.num.text === E.text && r.num.sup === E.tf && r.num.color === rgb(M.colorOf(E, dark)) && (E.kind === 'C' ? r.rest === `· ${FAM_NAME[E.f]} ${E.dir === 1 ? '매도' : '매수'} 쪽 13 완성` : /^· (매도|매수) 쪽 (셋업 9|반복 9)/.test(r.rest)), `[${tag0}] pointing at the strip tick of ${E.tf} "${E.text}" of ${iso(E.s)}: tooltip "${tip && tip.text.slice(0, 90)}"`);
        }
        await Q.mouseOff(page);
        const after = await Q.snap(page, { sover: true, nobase: true }), oa = P.parseStripOver(after.frames.sOver, after.theme);
        C.ok(!oa.hair && !oa.date && (await Q.tip(page)) === null, `[${tag0}] after the pointer left the strip the hairline, the date or a tooltip is still there`);
      }
      C.logs(ctx, tag0);
      await ctx.context.close();
    }));
  }
  for (const m of measures.filter((x) => / default:/.test(x))) C.note(m);
  const code = C.finish(A.out);
  await Q.closeAll();
  process.exit(code);
})().catch((e) => { console.error('strip.cjs crashed:', e); process.exit(3); });
