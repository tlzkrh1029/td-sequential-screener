// Check 10: the published form. The --fragment build inside the host's document (served with index.html and d/0.json
// only) gives the same picture as the page as its own document: the same probe, the same recorded paint, and the same
// pixels in screenshots of several states (first screen, whole history, a dense year, a chip's list, toggles, a
// tooltip, a pinned tooltip, the 설정 panel, 설명; on a phone the settings and the conditions), sizes and themes; it
// asks its server for nothing but the page and the daily file.
//   node published.cjs --base http://127.0.0.1:8911/ --frag http://127.0.0.1:8912/ --out <dir>
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const Q = require('../lib/qa.cjs'), { Model, iso } = require('../lib/model.cjs'), { verifyState } = require('../lib/verify.cjs'), { paintKey } = require('../lib/paint.cjs');
const A = Q.args();
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c10_published');
  if (!A.frag) { C.fail('no --frag address given'); process.exit(C.finish(A.out)); }
  const frag = A.frag.endsWith('/') ? A.frag : A.frag + '/', dir = path.join(A.out, 'pub');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const SETS = [[1440, 900, 'desk', false, false, 1], [1440, 900, 'deskdark', true, false, 1], [390, 844, 'phone', false, true, 2], [390, 844, 'phonedark', true, true, 2], [1920, 1080, 'wide', false, false, 1], [1024, 768, 'tab', false, false, 1], [768, 1024, 'narrow', false, false, 1]];
  const clean = (p) => JSON.stringify({ ...p, ms: 0, paintMs: 0 });
  for (const [w, h, tag, dark, touch, dpr] of A.quick ? SETS.slice(0, 3) : SETS) {
    for (const slug of M.slugs()) {
      const pages = [];
      for (const [name, base] of [['a', A.base], ['b', frag]]) pages.push({ name, ctx: await Q.open(base, { hash: '#chart-a-' + slug, width: w, height: h, dark, touch, dpr }) });
      const both = async (fn) => { for (const p of pages) await fn(p.ctx.page); };
      const compare = async (state) => {
        const snaps = [];
        // (the window as it is, at the top and at the bottom of the page: a full-page capture would resize the window,
        // and the chart follows the window's height)
        for (const p of pages) {
          const pg = p.ctx.page; await Q.mouseOff(pg); await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(60);
          const s = await Q.snap(pg, { strip: true, over: true }); snaps.push(s);
          await pg.screenshot({ path: path.join(dir, `${tag}-${slug}-${state}-top-${p.name}.png`) });
          await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pg.waitForTimeout(60);
          await pg.screenshot({ path: path.join(dir, `${tag}-${slug}-${state}-bottom-${p.name}.png`) });
          await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(30);
        }
        C.count('states');
        const [a, b] = snaps, where = `[${tag} ${slug} ${state}]`;
        C.ok(clean(a.probe) === clean(b.probe), `${where} the probe of the fragment in the host differs from the page's`);
        for (const k of ['cBase', 'sBase', 'sOver', 'cOver']) C.ok(paintKey(a.frames[k].calls) === paintKey(b.frames[k].calls), `${where} the paint of ${k} differs (${a.frames[k].calls.length} and ${b.frames[k].calls.length} calls)`);
        C.ok(JSON.stringify(a.theme) === JSON.stringify(b.theme), `${where} theme colors differ: ${JSON.stringify(a.theme)} / ${JSON.stringify(b.theme)}`);
        C.ok(a.sw <= a.cw && b.sw <= b.cw, `${where} sideways scroll: page ${a.sw}/${a.cw}, fragment ${b.sw}/${b.cw}`);
        if (state === 'first') { const r = verifyState(M, slug, b, Q.DEFAULT_STATE, { tag: where + ' fragment' }); for (const f of r.fails) C.fail(f.msg); }
      };
      await compare('first');
      await both((pg) => Q.preset(pg, '전체')); await compare('all');
      if (!touch) {
        await both(async (pg) => { await Q.preset(pg, '1년'); await Q.setState(pg, { def: 'on' }); await Q.centerOn(pg, Q.dayOf('2021-03-01')); }); await compare('2021');
        // the list of a chip, pinned beside it (the first chip of that dense year)
        {
          const lists = [];
          for (const p of pages) { const pg = p.ctx.page, s = await Q.snap(pg, { nobase: true }), f = s.probe.folds[0]; if (f) await pg.mouse.click(s.rc.x + f.x + f.w / 2, s.rc.y + f.y + f.h / 2); await Q.mouseOff(pg); lists.push(await Q.list(pg)); await pg.screenshot({ path: path.join(dir, `${tag}-${slug}-chiplist-${p.name}.png`) }); await pg.keyboard.press('Escape'); await pg.mouse.click(s.rc.x + 30, s.rc.y - 14); }
          C.count('states'); C.ok(lists[0] && lists[1] && JSON.stringify(lists[0]) === JSON.stringify(lists[1]), `[${tag} ${slug}] the list of a chip differs between the page and the fragment`);
        }
        await both(async (pg) => { await Q.setState(pg, { def: 'off', dir: 'sell', fam: [0, 3], cond: 'off' }); await Q.preset(pg, '2년'); }); await compare('toggles');
        // a tooltip in view, then pinned by a click
        await both(async (pg) => { await Q.setState(pg, { ...Q.DEFAULT_STATE }); await Q.preset(pg, '6개월'); });
        const tips = [], pins = [];
        for (const p of pages) {
          const pg = p.ctx.page; await Q.mouseOff(pg);
          const s = await Q.snap(pg, { nobase: true }), L = s.probe.labels.find((x) => x.shown === 'text'), at = L ? [s.rc.x + L.x + L.w / 2, s.rc.y + L.y + L.h / 2] : null;
          if (at) await pg.mouse.move(...at); tips.push(await Q.tip(pg)); await pg.screenshot({ path: path.join(dir, `${tag}-${slug}-tooltip-${p.name}.png`) });
          if (at) await pg.mouse.click(...at); await pg.mouse.move(2, 2); pins.push(await Q.tip(pg)); await pg.screenshot({ path: path.join(dir, `${tag}-${slug}-pinned-${p.name}.png`) });
          await pg.mouse.click(s.rc.x + 30, s.rc.y - 14);
        }
        C.count('states', 2);
        C.ok(tips[0] && tips[1] && JSON.stringify(tips[0]) === JSON.stringify(tips[1]), `[${tag} ${slug}] the tooltip differs between the page and the fragment`);
        C.ok(pins[0] && pins[1] && pins[0].pin && JSON.stringify(pins[0]) === JSON.stringify(pins[1]), `[${tag} ${slug}] the pinned tooltip differs between the page and the fragment`);
        // the 설정 panel and 설명, open
        for (const [sel, name] of [['#stage-root .bec-more', 'settings'], ['#noteBtn', 'help']]) {
          for (const p of pages) { const pg = p.ctx.page; await pg.click(sel); await Q.mouseOff(pg); await pg.screenshot({ path: path.join(dir, `${tag}-${slug}-${name}-${p.name}.png`) }); await pg.click(sel); }
          C.count('states');
        }
      } else {
        // (opened without a finger: after a tap the button may or may not keep its pressed look, from one run to the next)
        await both(async (pg) => { await pg.evaluate(() => document.querySelector('.bec-more').click()); }); await compare('settings');
        await both(async (pg) => { await pg.evaluate(() => document.querySelector('.bec-more').click()); });
        // the conditions under the chart, opened
        await both(async (pg) => { await pg.evaluate(() => { const b = document.querySelector('.bec-conds .bec-csum'); if (b) b.click(); }); }); await compare('conditions');
      }
      // what the fragment asked its own server for
      const mine = pages[1].ctx.requests.map((r) => r.url).filter((u) => u.startsWith(frag)).map((u) => u.slice(frag.length).replace(/\?v=.*$/, '?v'));
      C.ok(mine.length === 2 && mine.includes('') && mine.some((u) => /^d\/\d+\.json\?v$/.test(u)), `[${tag} ${slug}] the fragment asked its server for ${JSON.stringify(mine)}; expected the page and one daily file`);
      for (const p of pages) { C.logs(p.ctx, `${tag} ${slug} ${p.name === 'a' ? 'page' : 'fragment'}`); await p.ctx.context.close(); }
    }
  }
  // pixels
  let out = '';
  try { out = execFileSync('python3', ['-I', path.join(__dirname, '../lib/cmp.py'), dir], { encoding: 'utf8' }); } catch (e) { out = (e.stdout || '') + (e.stderr || String(e)); }
  const m = /(\d+) pairs identical, (\d+) pairs within 2 levels, (\d+) pairs differ/.exec(out);
  if (!m) C.fail('the pixel comparison did not run: ' + out.slice(0, 300));
  else { C.count('screenshotPairs', Number(m[1]) + Number(m[2]) + Number(m[3])); C.count('identicalPairs', Number(m[1])); C.count('pairsWithinTwoOf255Levels', Number(m[2])); for (const line of out.split('\n').filter((l) => /^(DIFF|SIZE|MISSING)/.test(l))) C.fail('screenshots differ: ' + line); }
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('published.cjs crashed:', e); process.exit(3); });
