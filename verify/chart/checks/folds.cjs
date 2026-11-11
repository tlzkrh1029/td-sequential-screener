// Check 1 (folded numbers) and 9 (folding and unfolding). Every folded number is in exactly one "외 N개" chip; the
// chip's tooltip names its numbers (the first twelve); a click unfolds the pile: what was shown stays shown, the
// folded numbers come back as numbers or wait in a chip of the pile whose tooltip names them; "접기" (or moving the
// window) gives the folded picture back, pixel call for pixel call.
//   node folds.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model, iso, FAM_NAME } = require('../lib/model.cjs'), { verifyState } = require('../lib/verify.cjs'), { paintKey } = require('../lib/paint.cjs');
const A = Q.args();
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c01_folds');
  await Promise.all(M.slugs().map(async (slug) => {
    const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug }), { page } = ctx;
    let st = { ...Q.DEFAULT_STATE };
    const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
    const keyOf = (L) => `${L.j}|${L.bar}|${L.kind}|${L.dir}|${L.f}|${L.text}`;
    // a tooltip row against a label
    const rowIs = (r, E) => {
      const span = E.s === E.e ? iso(E.s) : iso(E.s).slice(0, 4) === iso(E.e).slice(0, 4) ? `${iso(E.s)} ~ ${iso(E.e).slice(5)}` : `${iso(E.s)} ~ ${iso(E.e)}`;
      const what = E.kind === 'C' ? `${FAM_NAME[E.f]} ${E.dir === 1 ? '매도' : '매수'} 쪽 13 완성` : E.kind === 'I' ? `${FAM_NAME[E.f]} ${E.dir === 1 ? '매도' : '매수'} 쪽 13이 미뤄진 봉` : `${E.dir === 1 ? '매도' : '매수'} 쪽 ${E.kind === 'S' && E.raw >= 18 ? '반복 9' : '셋업 9'}`;
      return !!r.num && r.num.text === E.text && r.num.sup === E.tf && r.num.color === rgb(M.colorOf(E)) && r.rest.startsWith(what) && r.rest.endsWith(`${E.tf} 봉 ${span}`);
    };
    // the engine label of a probe label
    const engineOf = (p) => { const by = new Map(); for (const E of M.inWindow(slug, st, p.d0, p.d1)) (by.get(E.key) || by.set(E.key, []).get(E.key)).push(E); const used = new Map(), out = new Map(); for (const L of p.labels) { const k = Model.key(L), a = by.get(k); if (!a) continue; const i = used.get(k) || 0; used.set(k, i + 1); out.set(L, a[Math.min(i, a.length - 1)]); } return out; };
    const chipTip = async (s, f) => { await page.mouse.move(s.rc.x + f.x + f.w / 2, s.rc.y + f.y + f.h / 2); return Q.tip(page); };
    let unfolded = 0, shownNothing = null;
    const windows = [];
    const eras = slug === 'btc' ? ['2013-04-10', '2013-11-25', '2017-06-01', '2017-12-10', '2020-08-15', '2021-02-15', '2023-10-25', '2024-11-25', '2025-07-15'] : ['2016-03-01', '2017-06-10', '2017-12-25', '2020-08-10', '2021-01-15', '2021-05-05', '2023-10-25', '2024-11-25', '2025-08-15'];
    for (const era of A.quick ? eras.slice(0, 3) : eras) for (const name of ['6개월', '1년', '2년']) windows.push([name, era]);
    let wi = 0;
    for (const [name, era] of windows) {
      await set({ def: wi++ % 2 ? 'on' : 'off' });
      await Q.preset(page, name); await Q.centerOn(page, Q.dayOf(era));
      const s0 = await Q.snap(page), p0 = s0.probe, tag = `${slug} ${name} @${era}${st.def === 'on' ? ' +13' : ''}`;
      const r0 = verifyState(M, slug, s0, st, { tag }); for (const f of r0.fails.filter((x) => x.cat !== 'geometry')) C.fail(f.msg);
      C.count('states');
      const eng0 = engineOf(p0);
      // each folded label in exactly one chip (its group is a chip's), each chip's count is its labels
      const byGroup = new Map(); for (const L of p0.labels) if (L.shown === 'folded') (byGroup.get(L.group) || byGroup.set(L.group, []).get(L.group)).push(L);
      for (const g of byGroup.keys()) if (p0.folds.filter((f) => f.group === g).length !== 1) C.fail(`[${tag}] ${byGroup.get(g).length} numbers are folded into group ${g}, which is ${p0.folds.filter((f) => f.group === g).length} chips`);
      for (const f of p0.folds) {
        const members = byGroup.get(f.group) || [];
        C.count('chips'); C.count('foldedNumbers', members.length);
        // 1. the tooltip
        const t = await chipTip(s0, f);
        if (!t) { C.fail(`[${tag}] no tooltip on chip "${f.text}" at ${f.x},${f.y}`); continue; }
        const h = /^접힌 숫자 (\d+)개$/.exec(t.kids[0].text), rows = t.rows.filter((r) => r.inSec && r.num), more = /외 (\d+)개가 더 있습니다/.exec(t.text);
        if (!h || Number(h[1]) !== members.length || f.n !== members.length) C.fail(`[${tag}] chip "${f.text}": tooltip heading "${t.kids[0].text}", ${members.length} numbers are folded into it`);
        if (rows.length + (more ? Number(more[1]) : 0) !== members.length || rows.length !== Math.min(12, members.length)) C.fail(`[${tag}] chip "${f.text}": the tooltip lists ${rows.length} rows${more ? ' and says ' + more[1] + ' more' : ''} for ${members.length} folded numbers`);
        const left = members.map((L) => eng0.get(L)), named = new Set();
        for (const r of rows) { const i = left.findIndex((E) => E && !named.has(E) && rowIs(r, E)); if (i < 0) C.fail(`[${tag}] chip "${f.text}": the tooltip row "${r.num.text}" ${r.num.sup} "${r.rest}" is none of its folded numbers (${left.filter(Boolean).map((E) => E.tf + ' ' + E.text).join(', ')})`); else { named.add(left[i]); C.count('namedInTooltip'); } }
        // 2. unfold a sample of chips (every chip whose tooltip cannot name all its numbers, and every third other one)
        if (!(members.length > 12 || (unfolded % 3 === 0 && !A.quick) || unfolded < 3)) { unfolded++; continue; }
        unfolded++;
        await page.mouse.click(s0.rc.x + f.x + f.w / 2, s0.rc.y + f.y + f.h / 2); await Q.mouseOff(page);
        const s1 = await Q.snap(page), p1 = s1.probe, r1 = verifyState(M, slug, s1, st, { tag: tag + ' unfolded ' + f.text });
        C.count('unfolds');
        for (const x of r1.fails.filter((x2) => x2.cat !== 'geometry' || !/stands further from the candle/.test(x2.msg))) C.fail(x.msg);
        const eng1 = engineOf(p1), shown1 = new Map(); for (const L of p1.labels) shown1.set(eng1.get(L), L);
        // nothing that was shown folds
        for (const L of p0.labels) { const E = eng0.get(L), L1 = shown1.get(E); if (!L1) { C.fail(`[${tag}] after unfolding "${f.text}", ${E.tf} "${E.text}" of ${iso(E.s)} is gone from the picture`); continue; } if (L.shown === 'text' && L1.shown !== 'text') C.fail(`[${tag}] after unfolding "${f.text}" at day ${iso(members[0].day)}, ${E.tf} "${E.text}" of bar ${iso(E.s)} (day ${iso(E.day)}), which was shown as a number, is ${L1.shown}`); }
        if (!p1.handles.length) C.fail(`[${tag}] after unfolding "${f.text}" there is no 접기 handle`);
        // the chip's numbers: back as numbers, or waiting in a chip whose tooltip names them
        let back = 0, waiting = 0;
        const restTips = new Map();
        for (const L of members) {
          const E = eng0.get(L), L1 = shown1.get(E); if (!L1) continue;
          if (L1.shown === 'text') { back++; continue; }
          waiting++;
          if (named.has(E)) continue;   // named by the first tooltip already
          const rf = p1.folds.find((x) => x.group === L1.group); if (!rf) { C.fail(`[${tag}] unfolded: ${E.tf} "${E.text}" is folded into no chip`); continue; }
          let rt = restTips.get(rf.group); if (rt === undefined) { rt = await chipTip(s1, rf); restTips.set(rf.group, rt); }
          if (rt && rt.rows.some((r) => r.inSec && rowIs(r, E))) C.count('namedAfterUnfolding'); else { C.fail(`[${tag}] chip "${f.text}": ${E.tf} "${E.text}" of bar ${iso(E.s)} is named neither by the chip's tooltip (12 rows of ${members.length}) nor shown after unfolding, nor named by the chip it waits in ("${rt ? rt.text.slice(0, 120) : 'no tooltip'}")`); C.count('neverNamed'); }
        }
        C.count('cameBackAsNumbers', back); C.count('stillWaitingInAChip', waiting);
        if (back === 0) { C.count('unfoldsThatShowedNothingNew'); if (!shownNothing) shownNothing = `[${tag}] a click on "${f.text}" (day ${iso(members[0].day)}) unfolds nothing: all ${members.length} numbers still wait in a chip, only the price scale changes and a 접기 handle appears`; }
        await Q.mouseOff(page);
        // 3. fold again with the handle (not within the 350 ms the page keeps for a double click)
        await page.waitForTimeout(380);
        const hd = p1.handles[0];
        if (hd) {
          await page.mouse.click(s1.rc.x + hd.x + hd.w / 2, s1.rc.y + hd.y + hd.h / 2); await Q.mouseOff(page);
          const s2 = await Q.snap(page);
          const same = JSON.stringify(s2.probe.labels) === JSON.stringify(p0.labels) && JSON.stringify(s2.probe.folds) === JSON.stringify(p0.folds) && s2.probe.handles.length === 0;
          C.ok(same && paintKey(s2.frames.cBase.calls) === paintKey(s0.frames.cBase.calls), `[${tag}] after 접기 the picture is not the folded picture it was before unfolding "${f.text}"`);
        }
        await page.waitForTimeout(380);
      }
      await Q.mouseOff(page);
    }
    // moving the window folds what was unfolded; so does a setting
    await set({ def: 'on' }); await Q.preset(page, '6개월'); await Q.centerOn(page, Q.dayOf(slug === 'btc' ? '2017-12-10' : '2021-05-05'));
    for (const how of ['pan', 'setting', 'key']) {
      const s0 = await Q.snap(page), f = s0.probe.folds[0]; if (!f) break;
      await page.waitForTimeout(380);
      if (how === 'key') {   // by keyboard: the day cursor to the chip's day, down to the chip, Enter
        const day = s0.probe.labels.find((L) => L.group === f.group).day;
        await page.focus('.bec-chart canvas.bec-over'); await page.keyboard.press('ArrowLeft');
        const steps = s0.probe.d1 - day; for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowLeft');
        let found = false;
        for (let i = 0; i < 12 && !found; i++) { await page.keyboard.press('ArrowDown'); const t = await Q.tip(page); found = !!t && /^접힌 숫자/.test(t.kids[0].text); }
        if (!C.ok(found, `[${slug}] keyboard: the chip at ${iso(day)} cannot be reached with the arrow keys`)) break;
        await page.keyboard.press('Enter');
      } else await page.mouse.click(s0.rc.x + f.x + f.w / 2, s0.rc.y + f.y + f.h / 2);
      const s1 = await Q.snap(page); C.ok(s1.probe.handles.length > 0, `[${slug}] ${how}: the chip did not unfold`);
      if (how === 'pan') await Q.panWheel(page, -3); else if (how === 'setting') await set({ nine: st.nine === 'on' ? 'off' : 'on' }); else { await page.keyboard.press('Shift+ArrowLeft'); }
      const s2 = await Q.snap(page); C.ok(s2.probe.handles.length === 0, `[${slug}] after ${how === 'pan' ? 'moving the window' : how === 'setting' ? 'a setting' : 'Shift+ArrowLeft'} the pile is still unfolded`);
      const r2 = verifyState(M, slug, s2, st, { tag: 'after ' + how }); for (const x of r2.fails.filter((x2) => x2.cat !== 'geometry')) C.fail(x.msg);
      await Q.mouseOff(page);
    }
    if (shownNothing) C.fail(shownNothing);
    await set({ ...Q.DEFAULT_STATE });
    C.logs(ctx, slug);
    await ctx.context.close();
  }));
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('folds.cjs crashed:', e); process.exit(3); });
