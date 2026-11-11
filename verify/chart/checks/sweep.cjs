// Checks 0-4 and 11 over many states of the chart, per coin: the presets, the whole history swept at four zooms, the
// 2년 window stepped back through the whole history in 60 px pans, dense windows, windows in chosen eras, random
// windows, zooms and toggles, a matrix of the toggles, and at last every label that was never seen as a number is
// looked up with its own timeframe alone. Every state goes through lib/verify.cjs.
//   node sweep.cjs --base http://127.0.0.1:8911/ --out <dir> [--quick] [--vp 1440x900] [--dpr 1] [--tag name] [--dark] [--touch] [--coins btc]
// Prints one line per check: base (scales and candles), identity, anchor, painted, geometry, piles.
const Q = require('../lib/qa.cjs'), { Model, iso, DARK_FAM, DARK_NINE, contrast } = require('../lib/model.cjs'), { verifyState } = require('../lib/verify.cjs'), { paintKey } = require('../lib/paint.cjs');
const A = Q.args();
const argv = process.argv.slice(2), argOf = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const [VW, VH] = argOf('--vp', '1440x900').split('x').map(Number), DPR = Number(argOf('--dpr', '1')), TAG = argOf('--tag', ''), DARK = argv.includes('--dark');
const ONLY = argOf('--coins', ''), TOUCH = argv.includes('--touch');

(async () => {
  const M = new Model(A.expect);
  const C = { base: new Q.Check('c00_base' + TAG), identity: new Q.Check('c01_identity' + TAG), anchor: new Q.Check('c02_anchor' + TAG), paint: new Q.Check('c03_painted' + TAG), geometry: new Q.Check('c04_geometry' + TAG), piles: new Q.Check('c11_piles' + TAG) };
  const fonts = new Map(), alphas = new Map(), tot = {}, perTf = {}, stats = {}; let minIou = 1;
  const KNOWN = { bar: Q.dayOf('2024-12-16'), day: Q.dayOf('2024-12-29') }, known = { windows: 0, written: 0, how: {} };
  const slugs = M.slugs().filter((s) => !ONLY || ONLY.split(',').includes(s));
  await Promise.all(slugs.map(async (slug) => {
    const coin = M.coin(slug), all = M.all[slug], seen = new Map(), covered = new Set(), per = {};
    const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, width: VW, height: VH, dpr: DPR, dark: DARK, touch: TOUCH });
    const { page } = ctx;
    let st = { ...Q.DEFAULT_STATE, off: [], fam: [0, 2, 3] };
    const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
    let states = 0;
    const visit = async (tag, opt = {}) => {
      await Q.mouseOff(page);
      const s = await Q.snap(page, { over: true });
      const r = verifyState(M, slug, s, st, { tag, fonts, alphas, stats, seen: opt.noSeen ? null : seen });
      // nothing lies over the picture: the chart's canvas is shown and uncovered, and its own top layer is empty while nothing is pointed at
      if (s.seen && s.seen.hidden) C.paint.fail(`[${slug} ${tag}] the chart's canvas is not visible: ${s.seen.hidden}`);
      if (s.seen && s.seen.covered.length) C.paint.fail(`[${slug} ${tag}] something lies over the numbers: ${s.seen.covered[0]}`);
      if (s.frames.cOver && s.frames.cOver.calls.some((c) => c.op !== 'cr')) C.paint.fail(`[${slug} ${tag}] the layer over the chart has ${s.frames.cOver.calls.length - 1} painted things while nothing is pointed at`);
      stats.surface = s.theme.surface;
      if (!!s.dark !== DARK) C.paint.fail(`[${slug} ${tag}] the page is ${s.dark ? 'dark' : 'light'}, the browser was told to prefer ${DARK ? 'dark' : 'light'}`);
      for (const [k, v] of Object.entries(r.n)) { tot[k] = (tot[k] || 0) + v; per[k] = (per[k] || 0) + v; }
      for (const f of r.fails) C[f.cat].fail(f.msg);
      for (const k of Object.keys(C)) C[k].count('states');
      if (s.sw > s.cw) C.geometry.fail(`[${slug} ${tag}] the page scrolls sideways: scrollWidth ${s.sw}, clientWidth ${s.cw}`);
      for (let d = s.probe.d0; d <= s.probe.d1; d++) covered.add(d);
      // the label known from the owner's chart (BTC 2W, the bar of 2024-12-16, a pink sell 13x2): written as a number
      // in every window of 1.25 px a day or more that holds its day, whenever the toggles select it
      if (slug === 'btc' && s.probe.d0 <= KNOWN.day && s.probe.d1 >= KNOWN.day && s.probe.ppd >= 1.25) {
        const L = s.probe.labels.find((x) => x.tf === '2W' && x.s === KNOWN.bar && x.kind === 'C' && x.dir === 1 && x.f === 3);
        if (L) { known.windows++; known.how[L.shown] = (known.how[L.shown] || 0) + 1; if (L.shown === 'text') known.written++; else C.piles.fail(`[${slug} ${iso(s.probe.d0)}~${iso(s.probe.d1)} ppd ${s.probe.ppd.toFixed(3)} ${tag}] BTC 2W "13x2" of the bar 2024-12-16 is shown as "${L.shown}", not written, in a window of 1.25 px a day or more that holds 2024-12-29`); }
      }
      // the pixels: on every sixth state, the canvas under each number is the engine's text, timeframe and color
      if (states % 6 === 0 && r.shownText.length) {
        const some = r.shownText.slice(0, 80), px = await Q.pixelProof(page, Q.proofItems(M, some, s.dark));
        // (a faint number, of a deleted label or a +13, lets a line that passes under its ground show through a little: 0.97 there)
        px.forEach((x, i) => { const E = some[i][1], N = some[i][2]; C.paint.count('numbersComparedAsPixels'); if (!(x.iou >= (N.alpha < 1 ? 0.97 : 0.99) && x.real >= 8)) C.paint.fail(`[${slug} ${tag}] ${E.tf} "${E.text}" of bar ${iso(E.s)}: the pixels in its box are not that number in its color (overlap with the engine's text drawn anew ${x.iou.toFixed(2)}, ${x.real} ink pixels on the canvas, ${x.mine} in the drawing)`); if (x.iou < minIou) minIou = x.iou; });
      }
      states++;
      return { s, r };
    };
    // A. the presets
    for (const name of ['3개월', '6개월', '1년', '2년', '5년', '전체']) { await Q.preset(page, name); await visit('preset ' + name); }
    // B. the whole history at 3개월 (twice: +13 off and on), then at 1년, 2년 and 5년
    const back = async (s, step) => {
      // (a touch screen has no wheel: the strip's keys move the window there, a window's length at a time)
      if (TOUCH) { await page.focus('.bec-strip canvas.bec-over'); for (let k = 0; k < Math.max(1, Math.round(step / (s.probe.d1 - s.probe.d0 + 1))); k++) await page.keyboard.press('Shift+ArrowLeft'); }
      else await Q.panWheel(page, -step);
      return page.evaluate(() => document.querySelector('#stage-root').__probe().d0);
    };
    const sweep = async (name, step, both) => {
      await Q.preset(page, name);
      for (let guard = 0; guard < 400; guard++) {
        const { s } = await visit(`sweep ${name}`);
        if (both) { await set({ def: 'on' }); await visit(`sweep ${name} +13`); await set({ def: 'off' }); }
        if (s.probe.d0 <= coin.first) break;
        const before = s.probe.d0, now = await back(s, step);
        if (now >= before) { C.identity.fail(`[${slug}] the window did not move back from ${iso(before)} on a horizontal wheel`); break; }
      }
    };
    await sweep('3개월', A.quick ? 400 : 92, true);
    if (!A.quick) { await sweep('1년', 330, false); await sweep('2년', 650, false); await sweep('5년', 1500, false); }
    // C. the piles: the 2년 window stepped back through the whole history in pans of 60 px (240 px in the short
    // form), and the dense windows the rules were written for
    {
      await Q.preset(page, '2년');
      for (let guard = 0; guard < 600; guard++) {
        const { s } = await visit('2년 in 60 px pans'); C.piles.count('windowsOf2YearsIn60PxPans');
        if (s.probe.d0 <= coin.first) break;
        const before = s.probe.d0, now = await back(s, Math.max(1, Math.round((A.quick ? 240 : 60) / s.probe.ppd)));
        if (now >= before) { C.identity.fail(`[${slug}] the window did not move back from ${iso(before)}`); break; }
      }
      const dense = slug === 'btc' ? [['1년', '2017-09-01'], ['6개월', '2021-01-15'], ['2년', null]] : [['1년', '2021-06-01']];
      for (const [name, when] of dense) for (const def of ['off', 'on']) { await set({ def }); await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when)); await visit(`dense ${name}${when ? ' @' + when : ''}${def === 'on' ? ' +13' : ''}`); C.piles.count('denseWindows'); }
      await set({ def: 'off' });
    }
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
    C.identity.note(`${slug}: label instances expected from the engine ${per.expected || 0}, in the probe ${per.probeLabels || 0}, differences ${per['fail:identity'] || 0}`);
    C.anchor.note(`${slug}: digits centered on the day ${per.digitsCentered || 0}, beside the day with a line and a pointer ${per.besideItsDayWithPointer || 0}, on such a number's stack ${per.besideItsDayOnItsStack || 0}, as a mark ${per.asMark || 0}, left to the strip ${per.leftToTheStrip || 0}, not drawn ${per.notDrawn || 0}; differences ${per['fail:anchor'] || 0}`);

    // H. hovering moves nothing; panning moves the numbers with their candles
    await Q.preset(page, '6개월'); await Q.centerOn(page, Q.dayOf(dense)); await set({ def: 'on' });
    {
      const a = await Q.snap(page), p = a.probe;
      const targets = [...p.labels.filter((L) => L.shown === 'text' || L.shown === 'mark').slice(0, 40).map((L) => [L.x + L.w / 2, L.y + L.h / 2]), ...p.folds.map((f) => [f.x + f.w / 2, f.y + f.h / 2]), ...[0.2, 0.5, 0.8].map((k) => [p.plot.l + (p.plot.r - p.plot.l) * k, p.plot.t + 150])];
      for (const [x, y] of targets) { await page.mouse.move(a.rc.x + x, a.rc.y + y); C.geometry.count('hovers'); }
      const b = await Q.snap(page);
      C.geometry.ok(JSON.stringify(a.probe.labels) === JSON.stringify(b.probe.labels) && JSON.stringify(a.probe.folds) === JSON.stringify(b.probe.folds), `[${slug}] hovering changed the probe's labels or chips`);
      C.geometry.ok(a.fn.cBase === b.fn.cBase || paintKey(a.frames.cBase.calls) === paintKey(b.frames.cBase.calls), `[${slug}] hovering repainted the chart with another picture (frame ${a.fn.cBase} -> ${b.fn.cBase})`);
      await Q.mouseOff(page);
      if (!TOUCH) {
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
    }
    await set({ ...Q.DEFAULT_STATE });
    for (const k of Object.keys(C)) C[k].logs(ctx, slug);
    await ctx.context.close();
  }));
  // one size for all timeframes, the one of the chart's width; the colors' strengths
  const byKind = {}; for (const [k, tfs] of fonts) { const [sz, rest] = k.split('|'), [kind, f] = rest.split(':'); (byKind[sz + ' ' + kind] = byKind[sz + ' ' + kind] || []).push({ f, tfs: [...tfs] }); }
  for (const [k, list] of Object.entries(byKind)) C.paint.ok(list.length === 1, `numbers of kind ${k.split(' ')[1]} on a ${k.split(' ')[0]} chart are painted in ${list.length} different fonts: ${list.map((x) => `${x.f} on ${x.tfs.join(' ')}`).join(' | ')}`);
  const al = (k) => (alphas.get(k) ? [...alphas.get(k)] : []);
  C.paint.ok(al('13').every((a) => a === 1) && al('9').every((a) => a === 1), `13s or 9s are not painted at full strength: 13 ${al('13')}, 9 ${al('9')}`);
  C.paint.ok(al('rep9').every((a) => a === 0.8), `a repeated 9 is not painted at strength .8: ${al('rep9')}`);
  C.paint.ok(al('+13').length <= 1 && al('+13').every((a) => a < 1), `a +13 is not lighter, or not at one strength: ${al('+13')}`);
  const hard = stats.hardAlpha ? [...stats.hardAlpha] : [];
  if (DARK) C.paint.ok(hard.filter((x) => x.startsWith('dark candle')).every((x) => Math.abs(Number(x.split(' ')[2]) - 0.42) <= 0.04), `falling candles on the dark theme are painted at ${hard.join(', ')}; about 42% of the text color makes them quieter than the numbers`);
  // the dark theme's own colors of the red, the purple and the 9: each at least 4.5:1 on that theme's surface
  if (DARK && /^#[0-9a-f]{6}$/.test(stats.surface || '')) { const list = [['Sequential', DARK_FAM[0]], ['Combo', DARK_FAM[2]], ['the 9', DARK_NINE]]; for (const [name, col] of list) C.paint.ok(contrast(col, stats.surface) >= 4.5, `dark theme: ${name} in ${col} has a contrast of ${contrast(col, stats.surface).toFixed(2)}:1 on the surface ${stats.surface} (4.5:1 at least)`); C.paint.note(`dark theme, contrast on the surface ${stats.surface}: ${list.map(([n2, col]) => `${n2} ${col} ${contrast(col, stats.surface).toFixed(2)}:1`).join(', ')}`); }
  C.paint.note(`fonts by chart width (number / superscript): ${Object.entries(byKind).map(([k, l]) => `${k.split(' ')[0]} ${k.endsWith('S') ? '9' : k.endsWith('C') ? '13' : '+13'}: ${l.map((x) => x.f).join(' and ')}`).join('; ')}; strengths: ${[...alphas].map(([k, v]) => `${k} ${[...v].join(',')}`).join('; ')}; falling candles: ${hard.join(', ')}`);
  C.paint.note(`pixels: the smallest overlap between a painted number and the engine's text drawn anew was ${minIou.toFixed(3)}`);
  C.paint.note(`per timeframe, labels / seen painted as a number: ${M.TFS.map((t) => `${t} ${perTf[t] ? perTf[t].labels + '/' + perTf[t].asNumber : '0/0'}`).join(', ')}`);
  for (const [k, keys] of Object.entries({ base: ['axisPrices', 'axisDates', 'priceLines', 'candles'], identity: ['expected', 'probeLabels'], anchor: ['digitsCentered', 'besideItsDayWithPointer', 'besideItsDayOnItsStack', 'asMark', 'leftToTheStrip', 'notDrawn', 'besideItsDay', 'stacksBesideTheirDay'], paint: ['paintedNumbers', 'paintedMarks', 'asFolded', 'chips', 'goneNumbers', 'goneMarks', 'leaderLines', 'pointers', 'timeframeKindsInWideWindows'], geometry: ['pairsCompared', 'candlesUnderNumbers', 'stacks'], piles: ['folded13', 'folded13Of2WOrLonger', 'chipsOf13', 'stacksWithNumbersGivenWay', 'ninesGivenWayToMarks', 'numbersFurtherThanALine'] })) for (const x of keys) C[k].count(x, tot[x] || 0);
  C.piles.count('windowsWithTheKnownLabel', known.windows); C.piles.count('knownLabelWritten', known.written);
  if (stats.maxCenterOff != null) C.anchor.note(`the middle of a centered number's digits is at most ${stats.maxCenterOff.toFixed(2)} px from its day; the pointer of a number beside its day at most ${(stats.maxPointerOff || 0).toFixed(2)} px`);
  if (tot.noLineWithinThreePxOfTheLimit || tot.noLineBeyond) C.piles.note(`numbers further than one line from their candle without a line: ${tot.noLineWithinThreePxOfTheLimit || 0} within 3 px of the limit, ${tot.noLineBeyond || 0} beyond that`);
  if (stats.leadContrast != null) C.paint.note(`lines from candles to numbers: lowest contrast against the surface ${stats.leadContrast.toFixed(2)}:1`);
  if (stats.minGap != null) C.geometry.note(`the smallest distance between a number and a candle under it: ${stats.minGap.toFixed(2)} px; the most marks in one window: ${stats.marksMax}`);
  if (tot.stacksBesideTheirDay) C.anchor.note(`of the ${tot.stacksBesideTheirDay} stacks (instances) that stand beside their day, ${tot.stacksBesideTheirDayThatWouldFitCentered || 0} would stand free with their digits centered on the day at the heights they are painted at (no rule of the picture: places are chosen in turn)${stats.wouldFit && stats.wouldFit.length ? '; the first: ' + stats.wouldFit[0] : ''}`);
  if (tot.besideItsDayNotBeyondItsCandle) C.anchor.note(`${tot.besideItsDayNotBeyondItsCandle} numbers (instances) stand beside their day's column, led there by a line, and reach less far out than their own candle does`);
  if (tot.marksOnCandles) C.geometry.note(`${tot.marksOnCandles} marks (numbers shown as marks at a wide zoom) lie on painted candle pixels`);
  let code = 0; for (const k of Object.keys(C)) code |= C[k].finish(A.out);
  await Q.closeAll();
  process.exit(code);
})().catch((e) => { console.error('sweep.cjs crashed:', e); process.exit(3); });
