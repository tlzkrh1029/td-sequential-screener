// Check 13: the picture after the fonts have arrived, with nobody touching the page. A canvas text can be the first
// use of a font, so fonts can arrive long after the first paint (as on a revisit, or on a slow network); the page
// then has to draw again by itself, with the text widths measured anew. This check loads the page fresh several times
// with fonts that come quick (as from a browser cache), slow (350 ms a file) and late (1.2 s a file: well after the
// first paint), waits, and looks at what is on the canvases: text still drawn in the fallback font, and numbers laid
// out for another width than they are painted with.
// A fourth way: the data comes late (1.5 s), when the fonts of the page around the chart are all in. The fonts the
// canvases then ask for first (other weights, other parts of the Korean font) are loaded after the browser has
// reported its fonts ready: only a page that draws again whenever fonts finish loading shows them.
//   node fonts.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model } = require('../lib/model.cjs'), P = require('../lib/paint.cjs');
const A = Q.args();
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c13_fonts_settle');
  const N = A.quick ? 3 : 8, modes = [['quick fonts', 0, N], ['slow fonts', 350, N], ['late fonts', 1200, A.quick ? 1 : 3], ['fonts asked for after the data came late', 300, A.quick ? 2 : 4, 1500]], views = [[1440, 900, false, 'wide screen'], [390, 844, true, 'phone']];
  const summary = [], shot = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const loadedFaces = () => ({ loaded: [...document.fonts].filter((f) => f.status === 'loaded').length, status: document.fonts.status });
  for (const [vw, vh, touch, vname] of views) for (const [mname, delay, LOADS, dataDelay] of modes) {
    let stale = 0, fallback = 0, staleNums = 0, fbTexts = 0, example = null, before = 0, askedLater = 0;
    for (let i = 0; i < LOADS; i++) {
      const slug = M.slugs()[i % M.slugs().length];
      // (the data held back: when it is let through, how many font faces the page has loaded by then)
      let facesAtData = null;
      const onRoute = dataDelay ? async (route) => { if (/\/d\/\d+\.json/.test(route.request().url())) { await sleep(dataDelay); try { facesAtData = await route.request().frame().page().evaluate(loadedFaces); } catch (e) { /* the page is gone */ } } await route.continue(); } : undefined;
      const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, width: vw, height: vh, touch, fontDelay: delay, settle: false, wait: false, onRoute });
      const { page } = ctx;
      await page.waitForFunction(() => { const r = document.querySelector('#stage-root'); return !!(r && r.__probe && r.__probe()); }, null, { timeout: 30000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 60000 });
      await page.waitForTimeout(1200 + Math.min(delay, 500) * 3);
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 60000 });
      await page.waitForTimeout(250);
      const s = await Q.snap(page, { strip: true, over: true });
      // every text on the canvases: its width as it was painted against its width in the fonts that are in now
      const now = await page.evaluate(() => { const out = {}, cv = document.createElement('canvas').getContext('2d'); for (const [k, sel] of [['cBase', '.bec-chart canvas:not(.bec-over)'], ['sBase', '.bec-strip canvas:not(.bec-over)'], ['sOver', '.bec-strip canvas.bec-over']]) out[k] = __qa.frame(document.querySelector(sel)).calls.filter((c) => c.op === 'ft').map((c) => { cv.font = c.font; return { text: c.text, font: c.font, was: c.mw, now: cv.measureText(c.text).width }; }); return out; });
      const fb = []; for (const k of Object.keys(now)) for (const t of now[k]) if (Math.abs(t.was - t.now) > 0.26) fb.push({ canvas: k, ...t });
      // was the first paint made before the fonts were in? (then the page has drawn again by itself since)
      // (the recorder keeps the texts of each canvas' first frame with the widths they were painted with)
      const firstFb = await page.evaluate(() => { const cv = document.createElement('canvas').getContext('2d'); let n = 0; for (const sel of ['.bec-chart canvas:not(.bec-over)', '.bec-strip canvas:not(.bec-over)']) for (const t of __qa.first(document.querySelector(sel))) { cv.font = t.font; if (Math.abs(cv.measureText(t.text).width - t.mw) > 0.26) n++; } return n; });
      if (firstFb) { before++; C.count('loadsFirstPaintedBeforeTheFonts'); }
      if (dataDelay) { const end = await page.evaluate(loadedFaces); if (facesAtData && facesAtData.status === 'loaded' && end.loaded > facesAtData.loaded) { askedLater++; C.count('loadsWithFontsAskedForAfterThePageHadItsFonts'); } }
      const c = P.parseChart(s.frames.cBase, s.theme), wrong = c.numbers.filter((N2) => Math.abs(N2.supGap - 1) > 0.6 || !N2.inGround);
      // the fonts the canvases asked for are really in (no text was measured against a font that never came)
      const missing = await page.evaluate(() => { const want = new Set(); for (const sel of ['.bec-chart canvas:not(.bec-over)', '.bec-strip canvas:not(.bec-over)', '.bec-strip canvas.bec-over']) for (const c2 of __qa.frame(document.querySelector(sel)).calls) if (c2.op === 'ft') want.add(c2.font + '|' + c2.text); const out = []; for (const k of want) { const [font, text] = k.split('|'); if (!document.fonts.check(font, text)) out.push(k); } return out; });
      if (missing.length) C.fail(`${vname}, ${mname}, ${slug}: ${missing.length} canvas texts are in fonts that have not arrived, e.g. ${missing[0]}`);
      const so = P.parseStripOver(s.frames.sOver, s.theme), nameOff = so.nameBg && so.name ? Math.abs(so.nameBg.w - 4 - so.name.mw) : 0;
      C.count('loads'); C.count('textsLookedAt', Object.values(now).reduce((a, l) => a + l.length, 0)); C.count('numbersLookedAt', c.numbers.length);
      if (fb.length && !shot[vname]) { shot[vname] = true; await page.screenshot({ path: require('path').join(A.out, `fonts-fallback-${touch ? 'phone' : 'wide'}.png`), fullPage: false }); }
      if (fb.length) { fallback++; fbTexts += fb.length; if (!example) example = `${vname}, ${mname}, ${slug}: "${fb[0].text}" (${fb[0].font.slice(0, 22)}…) was painted ${fb[0].was} px wide, in the font that has arrived it is ${fb[0].now.toFixed(2)} px`; }
      if (wrong.length || nameOff > 0.6) { stale++; staleNums += wrong.length; if (!example || !/laid out/.test(example)) example = (example ? example + '; ' : '') + (wrong.length ? `${vname}, ${mname}, ${slug}: "${wrong[0].text}" with "${wrong[0].sup}" is laid out for a number ${(wrong[0].t.mw + wrong[0].supGap - 1).toFixed(2)} px wide and painted ${wrong[0].t.mw} px wide` : `${vname}, ${mname}, ${slug}: the ground of "현재 창" is made for a text ${(so.nameBg.w - 4).toFixed(2)} px wide, painted ${so.name.mw} px`); }
      // (network problems would show as console errors; the fonts are served locally)
      C.logs(ctx, `${vname} ${mname}`);
      await ctx.context.close();
    }
    summary.push(`${vname}, ${mname}: ${before} of ${LOADS} loads painted first before the fonts were in${dataDelay ? ` (${askedLater} asked for fonts after the page had its own)` : ''}; ${fallback} of ${LOADS} loads leave text in the fallback font (${fbTexts} texts), ${stale} of ${LOADS} leave numbers or the strip's name laid out for other widths (${staleNums} numbers)`);
    // (the late mode is there for a paint before the fonts: a run in which that never happened has not tried the page)
    if (delay >= 1000 && !before) C.fail(`${vname}, ${mname}: in none of ${LOADS} loads was the first paint made before the fonts arrived: the case was not tried`);
    if (dataDelay && !askedLater) C.fail(`${vname}, ${mname}: in none of ${LOADS} loads did the canvases ask for a font after the page's own fonts were in: the case was not tried`);
    if (fallback || stale) C.fail(`${vname}, ${mname}: after the fonts arrived and 1.2 s without a touch, ${fallback} of ${LOADS} loads still show text in the fallback font and ${stale} of ${LOADS} have numbers laid out for another font's widths. ${example || ''}`);
  }
  for (const l of summary) C.note(l);
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('fonts.cjs crashed:', e); process.exit(3); });
