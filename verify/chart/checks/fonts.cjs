// Check 13: the picture after the fonts have arrived, with nobody touching the page. The page measures its canvas
// text once and lays the numbers out with those widths; it measures again when the browser says the fonts are ready.
// A font that a canvas asks for after that moment arrives unnoticed. This check loads the page fresh several times
// (fonts quick, as from a browser cache, and slow, as from the network), waits, and looks at what is on the canvases:
// text still drawn in the fallback font, and numbers laid out for another width than they are painted with.
//   node fonts.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model } = require('../lib/model.cjs'), P = require('../lib/paint.cjs');
const A = Q.args();
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c13_fonts_settle');
  const LOADS = A.quick ? 3 : 8, modes = [['quick fonts', 0], ['slow fonts', 350]], views = [[1440, 900, false, 'wide screen'], [390, 844, true, 'phone']];
  const summary = [], shot = {};
  for (const [vw, vh, touch, vname] of views) for (const [mname, delay] of modes) {
    let stale = 0, fallback = 0, staleNums = 0, fbTexts = 0, example = null;
    for (let i = 0; i < LOADS; i++) {
      const slug = M.slugs()[i % M.slugs().length];
      const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, width: vw, height: vh, touch, fontDelay: delay, settle: false, wait: false });
      const { page } = ctx;
      await page.waitForFunction(() => { const r = document.querySelector('#stage-root'); return !!(r && r.__probe && r.__probe()); }, null, { timeout: 30000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30000 });
      await page.waitForTimeout(1200 + delay * 3);
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 30000 });
      const s = await Q.snap(page, { strip: true, over: true });
      // every text on the canvases: its width as it was painted against its width in the fonts that are in now
      const now = await page.evaluate(() => { const out = {}, cv = document.createElement('canvas').getContext('2d'); for (const [k, sel] of [['cBase', '.bec-chart canvas:not(.bec-over)'], ['sBase', '.bec-strip canvas:not(.bec-over)'], ['sOver', '.bec-strip canvas.bec-over']]) out[k] = __qa.frame(document.querySelector(sel)).calls.filter((c) => c.op === 'ft').map((c) => { cv.font = c.font; return { text: c.text, font: c.font, was: c.mw, now: cv.measureText(c.text).width }; }); return out; });
      const fb = []; for (const k of Object.keys(now)) for (const t of now[k]) if (Math.abs(t.was - t.now) > 0.26) fb.push({ canvas: k, ...t });
      const c = P.parseChart(s.frames.cBase, s.theme), wrong = c.numbers.filter((N) => Math.abs(N.supGap - 1) > 0.6 || !N.inGround);
      const so = P.parseStripOver(s.frames.sOver, s.theme), nameOff = so.nameBg && so.name ? Math.abs(so.nameBg.w - 4 - so.name.mw) : 0;
      C.count('loads'); C.count('textsLookedAt', Object.values(now).reduce((a, l) => a + l.length, 0)); C.count('numbersLookedAt', c.numbers.length);
      if (fb.length && !shot[vname]) { shot[vname] = true; await page.screenshot({ path: require('path').join(A.out, `fonts-fallback-${touch ? 'phone' : 'wide'}.png`), fullPage: false }); }
      if (fb.length) { fallback++; fbTexts += fb.length; if (!example) example = `${vname}, ${mname}, ${slug}: "${fb[0].text}" (${fb[0].font.slice(0, 22)}…) was painted ${fb[0].was} px wide, in the font that has arrived it is ${fb[0].now.toFixed(2)} px`; }
      if (wrong.length || nameOff > 0.6) { stale++; staleNums += wrong.length; if (!example || !/laid out/.test(example)) example = (example ? example + '; ' : '') + (wrong.length ? `${vname}, ${mname}, ${slug}: "${wrong[0].text}" with "${wrong[0].sup}" is laid out for a number ${(wrong[0].t.mw + wrong[0].supGap - 1).toFixed(2)} px wide and painted ${wrong[0].t.mw} px wide` : `${vname}, ${mname}, ${slug}: the ground of "현재 창" is made for a text ${(so.nameBg.w - 4).toFixed(2)} px wide, painted ${so.name.mw} px`); }
      // (network problems would show as console errors; the fonts are served locally)
      C.logs(ctx, `${vname} ${mname}`);
      await ctx.context.close();
    }
    summary.push(`${vname}, ${mname}: ${fallback} of ${LOADS} loads leave text in the fallback font (${fbTexts} texts), ${stale} of ${LOADS} leave numbers or the strip's name laid out for other widths (${staleNums} numbers)`);
    if (fallback || stale) C.fail(`${vname}, ${mname}: after the fonts arrived and 1.2 s without a touch, ${fallback} of ${LOADS} loads still show text in the fallback font and ${stale} of ${LOADS} have numbers laid out for another font's widths. ${example || ''}`);
  }
  for (const l of summary) C.note(l);
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('fonts.cjs crashed:', e); process.exit(3); });
