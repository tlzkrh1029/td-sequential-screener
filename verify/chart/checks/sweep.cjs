// Checks 0-4 over many states of the chart, per coin: the presets, the whole history swept at four zooms, windows in
// chosen eras, random windows, zooms and toggles, a matrix of the toggles, and at last every label that was never seen
// as a number is looked up with its own timeframe alone. Every state goes through lib/verify.cjs.
//   node sweep.cjs --base http://127.0.0.1:8911/ --out <dir> [--quick] [--vp 1440x900] [--dpr 1] [--tag name]
// Prints one line per check: base (scales and candles), identity, anchor, painted, geometry.
const Q = require('../lib/qa.cjs'), { Model, iso } = require('../lib/model.cjs'), { verifyState } = require('../lib/verify.cjs'), { paintKey } = require('../lib/paint.cjs');
const A = Q.args();
const argv = process.argv.slice(2), argOf = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const [VW, VH] = argOf('--vp', '1440x900').split('x').map(Number), DPR = Number(argOf('--dpr', '1')), TAG = argOf('--tag', ''), DARK = argv.includes('--dark');
const ONLY = argOf('--coins', ''), TOUCH = argv.includes('--touch');

(async () => {
  const M = new Model(A.expect);
  const C = { base: new Q.Check('c00_base' + TAG), identity: new Q.Check('c01_identity' + TAG), anchor: new Q.Check('c02_anchor' + TAG), paint: new Q.Check('c03_painted' + TAG), geometry: new Q.Check('c04_geometry' + TAG) };
  const fonts = new Map(), alphas = new Map(), tot = {}, perTf = {}; let minIou = 1;
  const slugs = M.slugs().filter((s) => !ONLY || ONLY.split(',').includes(s));
  await Promise.all(slugs.map(async (slug) => {
    const coin = M.coin(slug), all = M.all[slug], seen = new Map(), covered = new Set();
    const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, width: VW, height: VH, dpr: DPR, dark: DARK, touch: TOUCH });
    const { page } = ctx;
    let st = { ...Q.DEFAULT_STATE, off: [], fam: [0, 2, 3] };
    const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
    let states = 0;
    const visit = async (tag, opt = {}) => {
      await Q.mouseOff(page);
      const s = await Q.snap(page, { over: true });
      const r = verifyState(M, slug, s, st, { tag, fonts, alphas, seen: opt.noSeen ? null : seen });
      // nothing lies over the picture: the chart's canvas is shown and uncovered, and its own top layer is empty while nothing is pointed at
      if (s.seen && s.seen.hidden) C.paint.fail(`[${slug} ${tag}] the chart's canvas is not visible: ${s.seen.hidden}`);
      if (s.seen && s.seen.covered.length) C.paint.fail(`[${slug} ${tag}] something lies over the numbers: ${s.seen.covered[0]}`);
      if (s.frames.cOver && s.frames.cOver.calls.some((c) => c.op !== 'cr')) C.paint.fail(`[${slug} ${tag}] the layer over the chart has ${s.frames.cOver.calls.length - 1} painted things while nothing is pointed at`);
      for (const [k, v] of Object.entries(r.n)) tot[k] = (tot[k] || 0) + v;
      for (const f of r.fails) C[f.cat].fail(f.msg);
      for (const k of Object.keys(C)) C[k].count('states');
      if (s.sw > s.cw) C.geometry.fail(`[${slug} ${tag}] the page scrolls sideways: scrollWidth ${s.sw}, clientWidth ${s.cw}`);
      for (let d = s.probe.d0; d <= s.probe.d1; d++) covered.add(d);
      // the pixels: on every sixth state, the canvas under each number is the engine's text, timeframe and color
      if (states % 6 === 0 && r.shownText.length) {
        const some = r.shownText.slice(0, 80), px = await Q.pixelProof(page, Q.proofItems(M, some, s.theme));
        px.forEach((x, i) => { const E = some[i][1]; C.paint.count('numbersComparedAsPixels'); if (!(x.iou >= 0.99 && x.real >= 8)) C.paint.fail(`[${slug} ${tag}] ${E.tf} "${E.text}" of bar ${iso(E.s)}: the pixels in its box are not that number in its color (overlap with the engine's text drawn anew ${x.iou.toFixed(2)}, ${x.real} ink pixels on the canvas, ${x.mine} in the drawing)`); if (x.iou < minIou) minIou = x.iou; });
      }
      states++;
      return { s, r };
    };
    // A. the presets
    for (const name of ['3개월', '6개월', '1년', '2년', '5년', '전체']) { await Q.preset(page, name); await visit('preset ' + name); }
    // B. the whole history at 3개월 (twice: +13 off and on), then at 1년, 2년 and 5년
    const sweep = async (name, step, both) => {
      await Q.preset(page, name);
      for (let guard = 0; guard < 400; guard++) {
        const { s } = await visit(`sweep ${name}`);
        if (both) { await set({ def: 'on' }); await visit(`sweep ${name} +13`); await set({ def: 'off' }); }
        if (s.probe.d0 <= coin.first) break;
        const before = s.probe.d0;
        // (a touch screen has no wheel: the strip's keys move the window there, a window's length at a time)
        if (TOUCH) { await page.focus('.bec-strip canvas.bec-over'); for (let k = 0; k < Math.max(1, Math.round(step / (s.probe.d1 - s.probe.d0 + 1))); k++) await page.keyboard.press('Shift+ArrowLeft'); }
        else await Q.panWheel(page, -step);
        const now = await page.evaluate(() => document.querySelector('#stage-root').__probe().d0);
        if (now >= before) { C.identity.fail(`[${slug}] the window did not move back from ${iso(before)} on a horizontal wheel`); break; }
      }
    };
    await sweep('3개월', A.quick ? 400 : 92, true);
    if (!A.quick) { await sweep('1년', 330, false); await sweep('2년', 650, false); await sweep('5년', 1500, false); }
    // D. chosen eras at every zoom
    const eras = slug === 'btc' ? ['2013-11-20', '2017-12-10', '2020-03-15', '2021-05-10', '2024-12-20', '2025-08-10'] : ['2017-06-20', '2018-01-10', '2020-03-15', '2021-05-10', '2024-12-20', '2025-08-10'];
    for (const era of A.quick ? eras.slice(0, 2) : eras) for (const name of ['3개월', '6개월', '1년', '2년', '5년']) { await Q.preset(page, name); await Q.centerOn(page, Q.dayOf(era)); await visit(`era ${era} ${name}`); }
    // E. random windows, zooms and toggles
    const rnd = Q.rng(slug === 'btc' ? 20261110 : 20261111), TFS = M.TFS, GROUPS = [TFS.slice(0, 7), TFS.slice(7, 12), TFS.slice(12)];
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const randomToggles = () => {
      const fam = [0, 2, 3].filter(() => rnd() < 0.75), r = rnd();
      let off = [];
      if (r < 0.25) { const g = pick(GROUPS); off = TFS.filter((t) => !g.includes(t)); } else if (r < 0.45) { const t = pick(TFS); off = TFS.filter((x) => x !== t); } else if (r < 0.65) off = TFS.filter(() => rnd() < 0.4);
      return { fam, off, nine: rnd() < 0.8 ? 'on' : 'off', def: rnd() < 0.5 ? 'on' : 'off', dir: pick(['both', 'both', 'buy', 'sell']), scale: pick(['auto', 'auto', 'lin', 'log']) };
    };
    for (let i = 0; i < (A.quick ? 12 : 70); i++) {
      await Q.preset(page, pick(['3개월', '6개월', '6개월', '1년', '2년', '5년']));
      await Q.centerOn(page, coin.first + Math.floor(rnd() * (M.LAST - coin.first)));
      const z = Math.floor(rnd() * 4); for (let k = 0; k < z; k++) await Q.zoom(page, (rnd() < 0.5 ? -1 : 1) * (60 + rnd() * 400), 0.1 + rnd() * 0.8);
      if (rnd() < 0.5 && !TOUCH) await Q.panWheel(page, Math.round((rnd() - 0.5) * 80));
      await set(randomToggles());
      await visit(`random ${i}`);
    }
    await set({ ...Q.DEFAULT_STATE });
    // F. the toggles as a matrix, on the whole history and on a dense half year
    const dense = slug === 'btc' ? '2017-12-01' : '2021-05-01';
    for (const where of ['all', 'dense']) {
      if (where === 'all') await Q.preset(page, '전체'); else { await Q.preset(page, '6개월'); await Q.centerOn(page, Q.dayOf(dense)); }
      const fams = [[0, 2, 3], [0], [2], [3], [0, 2], [0, 3], [2, 3], []];
      for (const fam of A.quick ? fams.slice(0, 3) : fams) for (const nine of ['on', 'off']) for (const def of ['off', 'on']) for (const dir of ['both', 'buy', 'sell']) { await set({ fam, nine, def, dir }); await visit(`matrix ${where} fam ${fam.join('')} 9 ${nine} +13 ${def} ${dir}`); }
      await set({ ...Q.DEFAULT_STATE });
      const sets = [...TFS.map((t) => [t]), ...GROUPS, ...GROUPS.map((g) => TFS.filter((t) => !g.includes(t)))];
      for (const on of A.quick ? sets.slice(0, 6) : sets) for (const def of ['off', 'on']) { await set({ off: TFS.filter((t) => !on.includes(t)), def }); await visit(`matrix ${where} only ${on.join(',')} +13 ${def}`); }
      await set({ ...Q.DEFAULT_STATE });
    }
    // G. every label that has not been seen as a number yet: its timeframe alone, three months around its day
    const never = () => all.filter((L) => seen.get(L.id) !== 'text');
    const before = never().length;
    if (!A.quick) {
      await Q.preset(page, '3개월');
      for (const tf of M.TFS) {
        let todo = never().filter((L) => L.tf === tf); if (!todo.length) continue;
        await set({ off: M.TFS.filter((t) => t !== tf), def: 'on', nine: 'on', dir: 'both', fam: [0, 2, 3] });
        for (let guard = 0; todo.length && guard < 300; guard++) {
          const L = todo[0];
          await Q.centerOn(page, L.day); const at = await visit(`lookup ${tf} ${iso(L.day)}`);
          if (L.day < at.s.probe.d0 || L.day > at.s.probe.d1) C.identity.fail(`[${slug}] harness: the window ${iso(at.s.probe.d0)}~${iso(at.s.probe.d1)} could not be brought to ${iso(L.day)}`);
          if (seen.get(L.id) !== 'text') { // still folded or out of the window: its side alone
            await set({ dir: L.dir === 1 ? 'sell' : 'buy' }); await visit(`lookup ${tf} ${iso(L.day)} one side`); await set({ dir: 'both' });
            if (seen.get(L.id) !== 'text') {
              seen.set(L.id, 'never');
              if (process.env.QA_DEBUG) { const s = await Q.snap(page), mine = s.probe.labels.filter((x) => x.j === L.j && x.bar === L.bar && x.kind === L.kind && x.dir === L.dir); console.log('NEVER', slug, tf, iso(L.day), L.text, 'window', iso(s.probe.d0), iso(s.probe.d1), 'ppd', s.probe.ppd, JSON.stringify(mine), JSON.stringify(s.probe.folds), JSON.stringify(s.S), s.fam); await page.screenshot({ path: `${A.out}/never-${slug}-${tf}-${iso(L.day)}.png` }); }
            }
          }
          todo = never().filter((x) => x.tf === tf && seen.get(x.id) !== 'never');
        }
      }
      await set({ ...Q.DEFAULT_STATE });
    }
    // coverage
    const left = all.filter((L) => seen.get(L.id) !== 'text'), unseen = all.filter((L) => !seen.has(L.id));
    for (const k of ['identity', 'paint']) { C[k].count('labels', all.length); C[k].count('labelsSeenAsNumber', all.length - left.length); }
    if (!A.quick) {
      for (const L of unseen.slice(0, 5)) C.identity.fail(`[${slug}] ${L.tf} "${L.text}" of bar ${iso(L.s)} (day ${iso(L.day)}) was in no state visited`);
      for (const L of left.slice(0, 10)) C.paint.fail(`[${slug}] ${L.tf} "${L.text}" of bar ${iso(L.s)} (day ${iso(L.day)}) was never painted as a number, in no window and with its timeframe alone`);
      let miss = 0; for (let d = coin.first; d <= M.LAST; d++) if (!covered.has(d)) miss++;
      C.identity.ok(miss === 0, `[${slug}] ${miss} days of the history were in no window visited`);
    }
    for (const L of all) { const t = (perTf[L.tf] = perTf[L.tf] || { labels: 0, asNumber: 0 }); t.labels++; if (seen.get(L.id) === 'text') t.asNumber++; }
    C.identity.note(`${slug}: ${states} states; ${all.length} engine labels, each in a state visited: ${all.length - unseen.length}; seen painted as a number: ${all.length - left.length} (${before} of them only after the lookup with their timeframe alone)`);

    // H. hovering moves nothing; panning moves the numbers with their candles
    await Q.preset(page, '6개월'); await Q.centerOn(page, Q.dayOf(dense)); await set({ def: 'on' });
    {
      const a = await Q.snap(page), p = a.probe;
      const targets = [...p.labels.filter((L) => L.shown !== 'folded').slice(0, 40).map((L) => [L.x + L.w / 2, L.y + L.h / 2]), ...p.folds.map((f) => [f.x + f.w / 2, f.y + f.h / 2]), ...[0.2, 0.5, 0.8].map((k) => [p.plot.l + (p.plot.r - p.plot.l) * k, p.plot.t + 150])];
      for (const [x, y] of targets) { await page.mouse.move(a.rc.x + x, a.rc.y + y); C.geometry.count('hovers'); }
      const b = await Q.snap(page);
      C.geometry.ok(JSON.stringify(a.probe.labels) === JSON.stringify(b.probe.labels) && JSON.stringify(a.probe.folds) === JSON.stringify(b.probe.folds), `[${slug}] hovering changed the probe's labels or chips`);
      C.geometry.ok(a.fn.cBase === b.fn.cBase || paintKey(a.frames.cBase.calls) === paintKey(b.frames.cBase.calls), `[${slug}] hovering repainted the chart with another picture (frame ${a.fn.cBase} -> ${b.fn.cBase})`);
      await Q.mouseOff(page);
      // drag the chart by 150 px to the right (earlier days come in), then back
      const y = a.rc.y + p.plot.t + 8;
      for (const dx of [150, -90, -60]) {
        const s0 = await Q.snap(page), x0 = s0.rc.x + (s0.probe.plot.l + s0.probe.plot.r) / 2;
        await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move(x0 + dx / 2, y, { steps: 3 }); await page.mouse.move(x0 + dx, y, { steps: 3 }); await page.mouse.up(); await Q.mouseOff(page);
        const { s: s1 } = await visit(`after a drag of ${dx} px`, { noSeen: true });
        const moved = s0.probe.d0 - s1.probe.d0, want = Math.round(dx / s0.probe.ppd);
        C.geometry.ok(moved === want && Math.abs(s1.probe.ppd - s0.probe.ppd) < 1e-9, `[${slug}] a drag of ${dx} px at ${s0.probe.ppd.toFixed(3)} px a day moved the window by ${moved} days (expected ${want}); px a day ${s0.probe.ppd} -> ${s1.probe.ppd}`);
        // numbers shown in both pictures: each moved as its day did (unless the layout chose another place for it, which the per-state check covers)
        const k = (L) => `${L.j}|${L.bar}|${L.kind}|${L.dir}|${L.f}`, was = new Map(s0.probe.labels.filter((L) => L.shown === 'text').map((L) => [k(L), L]));
        let same = 0, other = 0;
        for (const L of s1.probe.labels) { if (L.shown !== 'text') continue; const o = was.get(k(L)); if (!o) continue; const shift = (L.x - o.x) - moved * s0.probe.ppd; if (Math.abs(shift) <= 1.01) same++; else other++; }
        C.geometry.count('numbersMovedWithTheirDay', same); C.geometry.count('numbersPlacedAnewAfterPan', other);
      }
    }
    await set({ ...Q.DEFAULT_STATE });
    for (const k of Object.keys(C)) C[k].logs(ctx, slug);
    await ctx.context.close();
  }));
  // one size for all timeframes; the colors' strengths
  const byKind = {}; for (const [k, tfs] of fonts) { const [kind, f] = k.split(':'); (byKind[kind] = byKind[kind] || []).push({ f, tfs: [...tfs] }); }
  for (const [kind, list] of Object.entries(byKind)) C.paint.ok(list.length === 1, `numbers of kind ${kind} are painted in ${list.length} different fonts: ${list.map((x) => `${x.f} on ${x.tfs.join(' ')}`).join(' | ')}`);
  const sizeOf = (kind) => (byKind[kind] && byKind[kind][0] ? Number(/ ([\d.]+)px\//.exec(byKind[kind][0].f)[1]) : null);
  if (sizeOf('S') !== null && sizeOf('C') !== null) C.paint.ok(sizeOf('S') === sizeOf('C'), `9s are ${sizeOf('S')} px, 13s ${sizeOf('C')} px`);
  if (sizeOf('I') !== null && sizeOf('C') !== null) C.paint.ok(sizeOf('I') < sizeOf('C'), `+13 is ${sizeOf('I')} px, a 13 ${sizeOf('C')} px: not smaller`);
  const al = (k) => (alphas.get(k) ? [...alphas.get(k)] : []);
  C.paint.ok(al('13').every((a) => a === '1/1') && al('9').every((a) => a === '1/1'), `13s or 9s are not painted at full strength: 13 ${al('13')}, 9 ${al('9')}`);
  C.paint.ok(al('rep9').every((a) => Number(a.split('/')[0]) < 1) && al('+13').every((a) => Number(a.split('/')[0]) < 1), `a repeated 9 or a +13 is not lighter: repeated 9 ${al('rep9')}, +13 ${al('+13')}`);
  C.paint.note(`fonts (number / superscript): ${Object.entries(byKind).map(([k, l]) => `${k === 'S' ? '9' : k === 'C' ? '13' : '+13'}: ${l.map((x) => x.f).join(' and ')}`).join('; ')}; strengths: ${[...alphas].map(([k, v]) => `${k} ${[...v].join(',')}`).join('; ')}`);
  C.paint.note(`pixels: the smallest overlap between a painted number and the engine's text drawn anew was ${minIou.toFixed(3)}`);
  C.paint.note(`per timeframe, labels / seen painted as a number: ${M.TFS.map((t) => `${t} ${perTf[t] ? perTf[t].labels + '/' + perTf[t].asNumber : '0/0'}`).join(', ')}`);
  for (const [k, keys] of Object.entries({ base: ['axisPrices', 'axisDates', 'candles'], identity: ['expected', 'probeLabels'], anchor: ['atDayCentered', 'atDayByLine', 'atDayByStack', 'asMark', 'besideItsDay'], paint: ['paintedNumbers', 'paintedMarks', 'asFolded', 'chips'], geometry: ['pairsCompared', 'candlesUnderNumbers', 'stacks'] })) for (const x of keys) C[k].count(x, tot[x] || 0);
  if (tot.besideItsDayNotBeyondItsCandle) C.anchor.note(`${tot.besideItsDayNotBeyondItsCandle} numbers (instances) stand beside their day's column, led there by a line, and reach less far out than their own candle does`);
  if (tot.marksOnCandles) C.geometry.note(`${tot.marksOnCandles} marks (numbers shown as marks at a wide zoom) lie on painted candle pixels`);
  let code = 0; for (const k of Object.keys(C)) code |= C[k].finish(A.out);
  await Q.closeAll();
  process.exit(code);
})().catch((e) => { console.error('sweep.cjs crashed:', e); process.exit(3); });
