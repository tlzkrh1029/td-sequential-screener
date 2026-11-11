// Check 1 (folded numbers): the chips and their lists. Every folded number is in exactly one chip, and the chip says
// what it holds ("13 7개" with a square per family, "9 3개": lib/verify.cjs). Pointing at a chip shows the first eight
// lines of its list and how many more there are; a click pins the whole list beside the chip: its title, one line per
// folded number (the number in its color with its superscript, then its bar's period), the longest timeframe first,
// each line a link to the TradingView chart of its timeframe, not taller than 60% of the chart. The click moves
// nothing: the price scale, every number's place and state and the painted picture are what they were. Esc, a click
// outside, a click on the chip again, a moved window and a changed setting close the list. The chart no longer
// unfolds in place: there is no 접기 handle.
//   node folds.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model, iso } = require('../lib/model.cjs'), { verifyState } = require('../lib/verify.cjs'), { paintKey } = require('../lib/paint.cjs');
const A = Q.args();
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const spanOf = (E) => (E.s === E.e ? iso(E.s) : iso(E.s).slice(0, 4) === iso(E.e).slice(0, 4) ? `${iso(E.s)} ~ ${iso(E.e).slice(5)}` : `${iso(E.s)} ~ ${iso(E.e)}`);
const tvUrl = (usd, tf) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(usd)}&interval=${tf.replace(/^1(?=[DWM]$)/, '')}`;
const TIP_ROWS = 8;
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c01_folds');
  let longest = 0, tallest = 0;
  await Promise.all(M.slugs().map(async (slug) => {
    for (const dark of A.quick ? [false] : [false, true]) {
      const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, dark }), { page } = ctx, coin = M.coin(slug);
      let st = { ...Q.DEFAULT_STATE };
      const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
      // a row (of the tooltip or of the list) against a label: the number, its superscript, its color, the bar's period
      const rowIs = (num, span, E) => !!num && num.text === E.text && num.sup === E.tf && num.color === rgb(M.colorOf(E, dark)) && span === spanOf(E);
      // the engine label of a probe label
      const engineOf = (p) => { const by = new Map(); for (const E of M.inWindow(slug, st, p.d0, p.d1)) (by.get(E.key) || by.set(E.key, []).get(E.key)).push(E); const used = new Map(), out = new Map(); for (const L of p.labels) { const k = Model.key(L), a = by.get(k); if (!a) continue; const i = used.get(k) || 0; used.set(k, i + 1); out.set(L, a[Math.min(i, a.length - 1)]); } return out; };
      const windows = [];
      const eras = slug === 'btc' ? ['2013-04-10', '2013-11-25', '2017-06-01', '2017-12-10', '2020-08-15', '2021-02-15', '2023-10-25', '2024-11-25', '2025-07-15'] : ['2016-03-01', '2017-06-10', '2017-12-25', '2020-08-10', '2021-01-15', '2021-05-05', '2023-10-25', '2024-11-25', '2025-08-15'];
      for (const era of A.quick ? eras.slice(0, 3) : dark ? eras.slice(1, 4) : eras) for (const name of ['6개월', '1년', '2년', '5년']) windows.push([name, era]);
      let wi = 0;
      for (const [name, era] of windows) {
        await set({ def: wi++ % 2 ? 'on' : 'off' });
        await Q.preset(page, name); await Q.centerOn(page, Q.dayOf(era));
        const s0 = await Q.snap(page), p0 = s0.probe, tag = `${slug}${dark ? ' dark' : ''} ${name} @${era}${st.def === 'on' ? ' +13' : ''}`;
        const r0 = verifyState(M, slug, s0, st, { tag }); for (const f of r0.fails) C.fail(f.msg);
        C.count('states');
        const eng0 = engineOf(p0), key0 = paintKey(s0.frames.cBase.calls);
        // each folded label in exactly one chip (its group is a chip's), each chip's count is its labels
        const byGroup = new Map(); for (const L of p0.labels) if (L.shown === 'folded') (byGroup.get(L.group) || byGroup.set(L.group, []).get(L.group)).push(L);
        for (const g of byGroup.keys()) if (p0.folds.filter((f) => f.group === g).length !== 1) C.fail(`[${tag}] ${byGroup.get(g).length} numbers are folded into group ${g}, which is ${p0.folds.filter((f) => f.group === g).length} chips`);
        for (const f of p0.folds) {
          const members = (byGroup.get(f.group) || []).map((L) => eng0.get(L)).filter(Boolean), cx = s0.rc.x + f.x + f.w / 2, cy = s0.rc.y + f.y + f.h / 2;
          C.count('chips'); C.count('foldedNumbers', members.length);
          const chip = `[${tag}] chip "${f.text}" of ${members.length ? iso(members[0].day) : '?'}`;
          // 1. pointing at it: the first eight lines of its list, and how many more
          await page.mouse.move(cx, cy);
          const t = await Q.tip(page);
          if (!t) { C.fail(`${chip}: no tooltip`); continue; }
          const h = /^접힌 숫자 (\d+)개$/.exec(t.kids[0].text), rows = t.rows.filter((r) => r.inSec && r.num), more = t.notes.map((x) => /^(\d+)개가 더 있습니다\.$/.exec(x)).find(Boolean) || null;
          if (!h || Number(h[1]) !== members.length || f.n !== members.length) C.fail(`${chip}: tooltip heading "${t.kids[0].text}", ${members.length} numbers are folded into it`);
          if (rows.length !== Math.min(TIP_ROWS, members.length) || (more ? Number(more[1]) : 0) !== members.length - rows.length) C.fail(`${chip}: the tooltip lists ${rows.length} rows${more ? ' and says ' + more[1] + ' more' : ''} for ${members.length} folded numbers (the first ${TIP_ROWS} lines and "N개가 더 있습니다.")`);
          if (/외 \d+개/.test(t.text)) C.fail(`${chip}: the tooltip still says "외 N개": "${t.text.slice(-40)}"`);
          if (t.pin) C.fail(`${chip}: the tooltip of a chip that is only pointed at takes the pointer`);
          // 2. a click: the list is pinned beside the chip, and nothing else changes
          await page.mouse.click(cx, cy); await Q.mouseOff(page);
          const s1 = await Q.snap(page), li = await Q.list(page), p1 = s1.probe;
          C.count('clicks');
          if (JSON.stringify(p1.ys) !== JSON.stringify(p0.ys) || p1.d0 !== p0.d0 || p1.d1 !== p0.d1 || p1.ppd !== p0.ppd) C.fail(`${chip}: a click changed the scales: ys ${JSON.stringify(p0.ys)} -> ${JSON.stringify(p1.ys)}, window ${iso(p0.d0)}~${iso(p0.d1)} -> ${iso(p1.d0)}~${iso(p1.d1)}`);
          if (JSON.stringify(p1.labels) !== JSON.stringify(p0.labels) || JSON.stringify(p1.folds) !== JSON.stringify(p0.folds)) { const i = p0.labels.findIndex((L, k) => JSON.stringify(L) !== JSON.stringify(p1.labels[k])); C.fail(`${chip}: a click changed a number's place or state: ${i >= 0 ? JSON.stringify(p0.labels[i]).slice(0, 160) + ' -> ' + JSON.stringify(p1.labels[i]).slice(0, 160) : 'the chips'}`); }
          if (paintKey(s1.frames.cBase.calls) !== key0) C.fail(`${chip}: a click repainted the chart with another picture`);
          if (p1.handles && p1.handles.length) C.fail(`${chip}: a 접기 handle after the click`);
          if (!li) { C.fail(`${chip}: a click opened no list`); continue; }
          C.count('lists');
          if (li.title !== `접힌 숫자 ${members.length}개`) C.fail(`${chip}: the list's title is "${li.title}"`);
          if (!p1.list || p1.list.group !== f.group || p1.list.n !== members.length) C.fail(`${chip}: the probe's list is ${JSON.stringify(p1.list).slice(0, 120)}`);
          // every member is named, each once; the longest timeframe first
          const left = members.slice();
          for (const r of li.rows) { const i = left.findIndex((E) => rowIs(r, r.span, E)); if (i < 0) C.fail(`${chip}: the list's line "${r.text}" ${r.sup} ${r.color} "${r.span}" is none of its folded numbers (${left.map((E) => E.tf + ' ' + E.text).join(', ')})`); else { const E = left.splice(i, 1)[0]; C.count('namedInList'); if (r.href !== tvUrl(coin.usd, E.tf) || r.target !== '_blank') C.fail(`${chip}: the line of ${E.tf} "${E.text}" leads to ${r.href} (${r.target})`); if (E.gone !== /bec-gone/.test(r.cls)) C.fail(`${chip}: the line of ${E.tf} "${E.text}" is ${/bec-gone/.test(r.cls) ? '' : 'not '}drawn as a deleted label; the label is ${E.gone ? 'deleted on TradingView' : 'on the chart'}`); } }
          for (const E of left) C.fail(`${chip}: the list does not name ${E.tf} "${E.text}" of bar ${iso(E.s)}`);
          if (li.rows.length !== members.length) C.fail(`${chip}: the list has ${li.rows.length} lines for ${members.length} folded numbers`);
          const js = li.rows.map((r) => M.TFS.indexOf(r.sup));
          for (let i = 1; i < js.length; i++) if (js[i] > js[i - 1] && members.every((E) => E.kind === members[0].kind)) { C.fail(`${chip}: the list is not ordered from the longest timeframe: ${li.rows.map((r) => r.sup).join(', ')}`); break; }
          if (js.length > longest) longest = js.length;
          // the tooltip was the first eight lines of this list
          rows.forEach((r, i) => { const q = li.rows[i]; if (!q || q.text !== r.num.text || q.sup !== r.num.sup || q.color !== r.num.color || q.span !== r.rest) C.fail(`${chip}: line ${i + 1} of the tooltip ("${r.num.text}" ${r.num.sup} "${r.rest}") is not line ${i + 1} of the list ("${q && q.text}" ${q && q.sup} "${q && q.span}")`); });
          // beside the chip, inside the chart, not taller than 60% of it (the lines scroll inside)
          const b = li.box, ch = li.chart, fx = ch.x + f.x, fy = ch.y + f.y;
          if (b.h > ch.h * 0.6 + 0.5) C.fail(`${chip}: the list is ${b.h.toFixed(0)} px high, the chart ${ch.h} px (60% is ${(ch.h * 0.6).toFixed(0)})`);
          if (b.h / ch.h > tallest) tallest = b.h / ch.h;
          if (li.rowsBox.scrollH > li.rowsBox.h + 1 && !li.scrolls) C.fail(`${chip}: the list's lines do not fit and do not scroll`);
          if (b.x < ch.x - 0.5 || b.x + b.w > ch.x + ch.w + 0.5 || b.y < ch.y - 0.5 || b.y + b.h > ch.y + ch.h + 0.5) C.fail(`${chip}: the list leaves the chart (${JSON.stringify(b)} in ${JSON.stringify(ch)})`);
          const gapX = Math.max(b.x - (fx + f.w), fx - (b.x + b.w));
          if (b.x < fx + f.w && fx < b.x + b.w && b.y < fy + f.h && fy < b.y + b.h) C.fail(`${chip}: the list covers its chip`);
          else if (gapX > 12.5 && b.w + f.w + 24 < ch.w) C.fail(`${chip}: the list stands ${gapX.toFixed(0)} px from its chip, not beside it`);
          // closing: Esc, a click outside, the chip again (in turn)
          const how = ['esc', 'outside', 'again'][C.n.lists % 3];
          if (how === 'esc') { await page.focus('.bec-chart canvas.bec-over'); await page.keyboard.press('Escape'); }
          else if (how === 'outside') await page.mouse.click(s0.rc.x + 30, s0.rc.y - 14);
          else await page.mouse.click(cx, cy);
          await Q.mouseOff(page);
          const s2 = await Q.snap(page);
          C.ok((await Q.list(page)) === null && s2.probe.list === null, `${chip}: the list did not close (${how === 'esc' ? 'Esc' : how === 'outside' ? 'a click outside' : 'a click on the chip again'})`);
          C.ok(paintKey(s2.frames.cBase.calls) === key0 && JSON.stringify(s2.probe.labels) === JSON.stringify(p0.labels), `${chip}: after the list was closed the picture is not what it was`);
          await page.evaluate(() => document.activeElement && document.activeElement.blur());
        }
        await Q.mouseOff(page);
      }
      // a moved window and a changed setting close the list; the keyboard reaches a chip and opens its list
      await set({ def: 'on' }); await Q.preset(page, '6개월'); await Q.centerOn(page, Q.dayOf(slug === 'btc' ? '2017-12-10' : '2021-05-05'));
      for (const how of ['pan', 'setting', 'key']) {
        const s0 = await Q.snap(page), f = s0.probe.folds[0]; if (!f) { C.fail(`[${slug}] no chip in the dense half year to try "${how}" with`); break; }
        if (how === 'key') {   // by keyboard: the day cursor to a day of the chip's numbers, down to the chip, Enter
          // (a chip stands at one of the days whose numbers it holds: each of them is tried)
          const days = [...new Set(s0.probe.labels.filter((L) => L.group === f.group).map((L) => L.day))].sort((x, y) => y - x);
          await page.focus('.bec-chart canvas.bec-over'); await page.keyboard.press('ArrowLeft');
          let found = false, at = s0.probe.d1;
          for (const day of days) {
            for (; at > day; at--) await page.keyboard.press('ArrowLeft');
            for (let i = 0; i < 14 && !found; i++) { await page.keyboard.press('ArrowDown'); const t = await Q.tip(page); if (!t) break; found = /^접힌 숫자/.test(t.kids[0].text); }
            if (found) break;
            await page.keyboard.press('Escape');
          }
          if (!C.ok(found, `[${slug}] keyboard: the chip "${f.text}" of ${days.map(iso).join(', ')} cannot be reached with the arrow keys`)) break;
          await page.keyboard.press('Enter');
          const li = await Q.list(page);
          C.ok(!!li && await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.bec-list')), `[${slug}] keyboard: Enter on a chip did not open its list with the focus in it`);
          await page.keyboard.press('Escape');
          C.ok((await Q.list(page)) === null && await page.evaluate(() => document.activeElement === document.querySelector('.bec-chart canvas.bec-over')), `[${slug}] keyboard: Esc did not close the list and give the focus back to the chart`);
          continue;
        }
        await page.mouse.click(s0.rc.x + f.x + f.w / 2, s0.rc.y + f.y + f.h / 2); await Q.mouseOff(page);
        C.ok((await Q.list(page)) !== null, `[${slug}] ${how}: the chip's list did not open`);
        // (the window is moved with the strip's keys: a wheel over the list would not reach the chart)
        if (how === 'pan') { await page.focus('.bec-strip canvas.bec-over'); await page.keyboard.press('ArrowLeft'); await page.evaluate(() => document.activeElement.blur()); } else await set({ near: st.near === 5 ? 3 : 5 });
        C.ok((await Q.list(page)) === null, `[${slug}] after ${how === 'pan' ? 'moving the window' : 'a setting'} the list is still open`);
        const s2 = await Q.snap(page), r2 = verifyState(M, slug, s2, st, { tag: 'after ' + how }); for (const x of r2.fails) C.fail(x.msg);
        await Q.mouseOff(page);
      }
      await set({ ...Q.DEFAULT_STATE });
      C.logs(ctx, slug + (dark ? ' dark' : ''));
      await ctx.context.close();
    }
  }));
  C.note(`the longest list had ${longest} lines; the tallest was ${(tallest * 100).toFixed(0)}% of the chart's height`);
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('folds.cjs crashed:', e); process.exit(3); });
