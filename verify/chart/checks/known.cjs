// Check 8: the label known from the owner's chart. BTC 2W, the bar that starts 2024-12-16: an Aggressive Combo (pink)
// sell 13x2 from the origins 2021-11-08 and 2024-01-29, written above the candle of 2024-12-29 with the superscript
// 2W: as a number at every zoom from 1.25 px a day (3개월 to 2년), a number or in a chip at 5년, a pink mark on the
// whole history; on both themes.
//   node known.cjs --base http://127.0.0.1:8911/ --out <dir> --repo <repoDir>
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const Q = require('../lib/qa.cjs'), { Model, iso } = require('../lib/model.cjs'), { verifyState, scales } = require('../lib/verify.cjs'), P = require('../lib/paint.cjs');
const A = Q.args();
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c08_known_label'), repo = A.repo || M.E.repo;
  const BAR = Q.dayOf('2024-12-16'), DAY = Q.dayOf('2024-12-29'), ORIGINS = ['2021-11-08', '2024-01-29'], PINK = '#e74bb1';
  if (!M.coin('btc') || M.LAST < DAY) { C.note('the data ends before 2024-12-29 or has no BTC: nothing to compare'); const rc = C.finish(A.out); process.exit(rc); }
  // the engine, twice: the dump and the expectations
  const dumpDir = path.join(A.out, 'dump-known'); fs.rmSync(dumpDir, { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(repo, 'scripts/td-dump.mjs'), '--out', dumpDir, '--tickers', 'CRYPTO:BTCUSD', '--tfs', '2W'], { stdio: 'pipe' });
  const lines = fs.readFileSync(path.join(dumpDir, 'CRYPTO_BTCUSD__2W.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('L\t2024-12-16\t'));
  // (the dump lists the origins in the order the indicator appends their tooltips: the newer run first)
  const dl = lines.map((l) => l.split('\t')).find((a) => a[2] === 'C' && a[3] === '1' && a[4] === '3');
  C.ok(!!dl && dl[5] === '13x2' && dl[6].split(',').sort().join() === ORIGINS.join(), `the engine dump for BTC 2W 2024-12-16 is ${JSON.stringify(lines)}, expected a line C 1 3 13x2 with the origins 2021-11-08 and 2024-01-29`);
  const dumpOrigins = dl ? dl[6].split(',') : [];
  const E = M.all.btc.find((L) => L.tf === '2W' && L.s === BAR && L.kind === 'C' && L.dir === 1 && L.f === 3);
  C.ok(E && E.text === '13x2' && E.day === DAY && E.origins.map(iso).join() === dumpOrigins.join() && M.colorOf(E, false) === PINK && M.colorOf(E, true) === PINK && !E.gone, `expectations: ${JSON.stringify(E)}`);
  if (!E) { process.exit(C.finish(A.out)); }

  for (const dark of [false, true]) {
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc', dark }), { page } = ctx, st = { ...Q.DEFAULT_STATE }, th = dark ? 'dark ' : '';
    const find = (p) => p.labels.find((L) => L.tf === '2W' && L.s === BAR && L.kind === 'C' && L.dir === 1 && L.f === 3);
    const how = {};
    for (const name of ['3개월', '6개월', '1년', '2년', '5년', '전체']) {
      await Q.preset(page, name); if (name !== '전체') await Q.centerOn(page, DAY);
      await Q.mouseOff(page);
      const s = await Q.snap(page), p = s.probe, r = verifyState(M, 'btc', s, st, { tag: th + name }), L = find(p), { X, Y } = scales(p), o = M.ohlc('btc', DAY);
      C.count('zooms');
      for (const f of r.fails) C.fail(f.msg);
      if (!C.ok(!!L, `[${th}${name}] the label is not in the picture of ${iso(p.d0)}~${iso(p.d1)}`)) continue;
      how[name] = L.shown;
      C.ok(L.text === '13x2' && L.day === DAY && L.e === DAY && L.dir === 1 && L.f === 3 && !L.gone, `[${th}${name}] the probe has it as ${JSON.stringify(L)}`);
      if (L.shown === 'text') {
        const t = r.shownText.find((x) => x[0] === L), N = t && t[2];
        if (!C.ok(!!N, `[${th}${name}] shown as a number, but nothing is painted in its box`)) continue;
        const g = N.ground;
        C.ok(N.text === '13x2' && N.sup === '2W', `[${th}${name}] painted "${N.text}" with superscript "${N.sup}"`);
        C.ok(N.color === PINK && N.supColor === PINK && N.alpha === 1 && !N.under, `[${th}${name}] painted in ${N.color} (strength ${N.alpha}${N.under ? ', with the dotted line of a deleted label' : ''}), pink is ${PINK}`);
        C.ok(g.y + g.h <= Y(o.h), `[${th}${name}] its box ends at y ${g.y + g.h}, the high of 2024-12-29 (${o.h}) is at y ${Y(o.h).toFixed(2)}: not above the candle`);
        // its digits are centered on 2024-12-29, or a line leads from that candle to it
        const led = r.c.leaders.some((ld) => Math.abs(ld.x1 - X(DAY)) <= 1.01 && ld.x2 >= g.x - 1 && ld.x2 <= g.x + g.w + 1 && Math.abs(ld.y1 - Y(o.h)) <= 2.51);
        C.ok(Math.abs(N.digits.mid - X(DAY)) <= 1.0 || led, `[${th}${name}] the middle of its digits is at x ${N.digits.mid.toFixed(1)}, the candle of 2024-12-29 at ${X(DAY).toFixed(1)}, and no line leads there`);
        const [px] = await Q.pixelProof(page, Q.proofItems(M, [t], dark));
        C.ok(px.iou >= 0.99 && px.real >= 20, `[${th}${name}] the pixels in its box do not show a pink 13x2 with 2W (overlap ${px.iou.toFixed(2)}, ${px.real} ink pixels)`);
        // the tooltip: the number and what it is, its bar, its origin bars; nothing about its place (it stands at its bar's last day)
        const cx = s.rc.x + g.x + g.w / 2, cy = s.rc.y + g.y + g.h / 2;
        await page.mouse.move(cx, cy);
        const tip = await Q.tip(page);
        C.ok(tip && tip.rows[0] && tip.rows[0].num && tip.rows[0].num.text === '13x2' && tip.rows[0].num.sup === '2W' && tip.rows[0].num.color === 'rgb(231, 75, 177)' && tip.rows[0].rest === '· Aggressive Combo 매도 쪽 13 완성', `[${th}${name}] tooltip line 1: ${JSON.stringify(tip && tip.rows[0])}`);
        C.ok(tip && tip.rows[1] && tip.rows[1].text === '2W 봉 2024-12-16 ~ 12-29', `[${th}${name}] tooltip line 2 "${tip && tip.rows[1] && tip.rows[1].text}"`);
        C.ok(tip && tip.rows[2] && tip.rows[2].text === `출발 봉 ${dumpOrigins.join(', ')}`, `[${th}${name}] tooltip line 3 "${tip && tip.rows[2] && tip.rows[2].text}"; the dump's origins are ${dumpOrigins.join(', ')}`);
        C.ok(tip && tip.notes.length === 0 && tip.links.length === 0, `[${th}${name}] the tooltip also says "${tip && tip.notes.join(' | ')}"`);
        // a click pins it with the link; the second click opens the 2W chart
        const n0 = await page.evaluate(() => __qa.opens.length);
        await page.mouse.click(cx, cy);
        const pinned = await Q.tip(page), n1 = await page.evaluate(() => __qa.opens.length);
        C.ok(n1 === n0 && pinned && pinned.pin && pinned.links.length === 1 && pinned.links[0].text === 'TradingView 2W 차트 ↗' && pinned.links[0].href === 'https://www.tradingview.com/chart/?symbol=CRYPTO%3ABTCUSD&interval=2W', `[${th}${name}] a click did not pin the tooltip with the link to the 2W chart: ${JSON.stringify(pinned && pinned.links)}, opened ${n1 - n0}`);
        await page.mouse.click(cx, cy);
        const op = await page.evaluate((n) => __qa.opens.slice(n), n0);
        C.ok(op.length === 1 && op[0].url === 'https://www.tradingview.com/chart/?symbol=CRYPTO%3ABTCUSD&interval=2W', `[${th}${name}] the second click opened ${JSON.stringify(op)}`);
        await page.mouse.click(s.rc.x + p.plot.l + 30, s.rc.y - 14); await Q.mouseOff(page);
        if (name === '6개월' && !dark) await page.screenshot({ path: path.join(A.out, 'known-label-6m.png'), clip: { x: Math.max(0, s.rc.x + g.x - 220), y: s.rc.y, width: 460, height: 420 } });
      } else if (L.shown === 'mark') {
        const m = r.c.marks.find((x) => x.x === L.x && x.y === L.y && x.fs === PINK);
        C.ok(!!m && !m.outline && Math.abs(m.x + m.w / 2 - X(DAY)) <= Math.max(1.01, p.ppd / 2 + 0.51) && m.y + m.h <= Y(o.h), `[${th}${name}] shown as a mark: ${JSON.stringify(m)}; its day is at x ${X(DAY).toFixed(1)}, the candle's high at y ${Y(o.h).toFixed(1)}`);
      } else if (L.shown === 'folded') {
        const f = p.folds.find((x) => x.group === L.group);
        await page.mouse.click(s.rc.x + f.x + f.w / 2, s.rc.y + f.y + f.h / 2);
        const li = await Q.list(page);
        C.ok(li && li.rows.some((r2) => r2.text === '13x2' && r2.sup === '2W' && r2.span === '2024-12-16 ~ 12-29' && r2.color === 'rgb(231, 75, 177)'), `[${th}${name}] folded into the chip "${f.text}" whose list does not name it: ${JSON.stringify(li && li.rows.map((x) => x.text + x.sup))}`);
        await page.keyboard.press('Escape'); await page.mouse.click(s.rc.x + p.plot.l + 30, s.rc.y - 14); await Q.mouseOff(page);
      } else C.fail(`[${th}${name}] shown as "${L.shown}"`);
    }
    C.note(`${dark ? 'dark' : 'light'} theme, shown at the zooms: ${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    C.ok(['3개월', '6개월', '1년', '2년'].every((k) => how[k] === 'text'), `[${th}] from 3개월 to 2년 (1.25 px a day or more) it is shown as ${['3개월', '6개월', '1년', '2년'].map((k) => how[k]).join(', ')}, not as a number everywhere`);
    C.ok(['text', 'folded'].includes(how['5년']) && how['전체'] === 'mark', `[${th}] at 5년 it is "${how['5년']}" (a number or in a chip) and on the whole history "${how['전체']}" (a mark)`);
    // the strip: a pink tick on the 2W row of the sell band, over 2024-12-16 ~ 12-29
    const s = await Q.snap(page, { strip: true, nobase: true }), g = P.parseStrip(s.frames.sBase, s.theme), sc = s.probe.stripScale, t = s.probe.strip.find((q) => q.j === 10 && q.kind === 'C' && q.dir === 1 && q.f === 3 && q.bar === E.bar);
    const X = (d) => sc.x0 + (d - sc.first) * sc.ppd, rect = t && g.ticks.find((r) => r.x === t.x0 && r.y === t.y && r.color === PINK && !r.outline);
    const grounds = g.grounds.slice().sort((a, b) => a.y - b.y), mid = grounds[1], row2W = mid ? mid.y + (11 - 10) * (mid.h / 5) : null;   // the middle ground of the upper band is 8D~3W; 3W is its top row, 2W the next
    C.ok(!!rect && rect.y === row2W && rect.x + rect.w > X(BAR) - 1.01 && rect.x < X(DAY + 1) + 1.01, `[${th}] strip: its tick ${JSON.stringify(rect || t)}; the 2W sell row is at y ${row2W}, its days at x ${X(BAR).toFixed(1)}..${X(DAY + 1).toFixed(1)}`);
    C.logs(ctx, 'btc' + (dark ? ' dark' : ''));
    await ctx.context.close();
  }
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('known.cjs crashed:', e); process.exit(3); });
