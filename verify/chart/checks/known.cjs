// Check 8: the label known from the owner's chart. BTC 2W, the bar that starts 2024-12-16: an Aggressive Combo (pink)
// sell 13x2 from the origins 2021-11-08 and 2024-01-29, written above the candle of 2024-12-29 with the superscript 2W.
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
  C.ok(E && E.text === '13x2' && E.day === DAY && E.origins.map(iso).join() === dumpOrigins.join() && M.colorOf(E) === PINK, `expectations: ${JSON.stringify(E)}`);
  if (!E) { process.exit(C.finish(A.out)); }

  const ctx = await Q.open(A.base, { hash: '#chart-a-btc' }), { page } = ctx, st = { ...Q.DEFAULT_STATE };
  const find = (p) => p.labels.find((L) => L.tf === '2W' && L.s === BAR && L.kind === 'C' && L.dir === 1 && L.f === 3);
  const how = {};
  for (const name of ['3개월', '6개월', '1년', '2년', '5년', '전체']) {
    await Q.preset(page, name); if (name !== '전체') await Q.centerOn(page, DAY);
    const s = await Q.snap(page), p = s.probe, r = verifyState(M, 'btc', s, st, { tag: name }), L = find(p), { X, Y } = scales(p), o = M.ohlc('btc', DAY);
    C.count('zooms');
    for (const f of r.fails.filter((x) => x.cat !== 'geometry')) C.fail(f.msg);
    if (!C.ok(!!L, `[${name}] the label is not in the picture of ${iso(p.d0)}~${iso(p.d1)}`)) continue;
    how[name] = L.shown;
    C.ok(L.text === '13x2' && L.day === DAY && L.e === DAY && L.dir === 1 && L.f === 3, `[${name}] the probe has it as ${JSON.stringify(L)}`);
    if (L.shown === 'text') {
      const t = r.shownText.find((x) => x[0] === L), N = t && t[2];
      if (!C.ok(!!N, `[${name}] shown as a number, but nothing is painted in its box`)) continue;
      const g = N.ground;
      C.ok(N.text === '13x2' && N.sup === '2W', `[${name}] painted "${N.text}" with superscript "${N.sup}"`);
      C.ok(N.color === PINK && N.supColor === PINK && N.alpha === 1, `[${name}] painted in ${N.color} (strength ${N.alpha}), pink is ${PINK}`);
      C.ok(g.y + g.h <= Y(o.h), `[${name}] its box ends at y ${g.y + g.h}, the high of 2024-12-29 (${o.h}) is at y ${Y(o.h).toFixed(2)}: not above the candle`);
      const led = r.c.leaders.some((ld) => Math.abs(ld.x1 - X(DAY)) <= 1.01 && ld.x2 >= g.x - 1 && ld.x2 <= g.x + g.w + 1) || r.c.pointers.some((pt) => pt.pts.some((q) => Math.abs(q[0] - X(DAY)) <= 1.01));
      C.ok(Math.abs(g.x + g.w / 2 - X(DAY)) <= 3.01 || led, `[${name}] its box is around x ${g.x + g.w / 2}, the candle of 2024-12-29 at ${X(DAY).toFixed(1)}, and no line leads there`);
      const [px] = await Q.pixelProof(page, Q.proofItems(M, [t], s.theme));
      C.ok(px.iou >= 0.99 && px.real >= 20, `[${name}] the pixels in its box do not show a pink 13x2 with 2W (overlap ${px.iou.toFixed(2)}, ${px.real} ink pixels)`);
      // the tooltip
      await page.mouse.move(s.rc.x + g.x + g.w / 2, s.rc.y + g.y + g.h / 2);
      const tip = await Q.tip(page);
      C.ok(tip && tip.kids[0].text === '2W 봉 2024-12-16 ~ 12-29', `[${name}] tooltip heading "${tip && tip.kids[0].text}"`);
      C.ok(tip && tip.rows[0] && tip.rows[0].num && tip.rows[0].num.text === '13x2' && tip.rows[0].num.sup === '2W' && tip.rows[0].num.color === 'rgb(231, 75, 177)', `[${name}] tooltip number ${JSON.stringify(tip && tip.rows[0] && tip.rows[0].num)}`);
      C.ok(tip && tip.rows[0].rest === `Aggressive Combo 매도 쪽 13 완성 · 출발 봉 ${dumpOrigins.join(', ')}`, `[${name}] tooltip line "${tip && tip.rows[0].rest}"; the dump's origins are ${dumpOrigins.join(', ')}`);
      C.ok(tip && /숫자는 봉의 마지막 날 2024-12-29 \(일\) 자리에 있습니다\./.test(tip.text), `[${name}] the tooltip does not say it stands at 2024-12-29 (일): "${tip && tip.text}"`);
      // a click opens the 2W chart
      const n0 = await page.evaluate(() => __qa.opens.length);
      await page.mouse.click(s.rc.x + g.x + g.w / 2, s.rc.y + g.y + g.h / 2);
      const op = await page.evaluate((n) => __qa.opens.slice(n), n0);
      C.ok(op.length === 1 && op[0].url === 'https://www.tradingview.com/chart/?symbol=CRYPTO%3ABTCUSD&interval=2W', `[${name}] a click opened ${JSON.stringify(op)}`);
      await Q.mouseOff(page);
      if (name === '6개월') await page.screenshot({ path: path.join(A.out, 'known-label-6m.png'), clip: { x: Math.max(0, s.rc.x + g.x - 220), y: s.rc.y, width: 460, height: 420 } });
    } else if (L.shown === 'mark') {
      const m = r.c.marks.find((x) => x.x === L.x && x.y === L.y && x.fs === PINK);
      C.ok(!!m && Math.abs(m.x + m.w / 2 - X(DAY)) <= Math.max(1.01, p.ppd / 2 + 0.51) && m.y + m.h <= Y(o.h), `[${name}] shown as a mark: ${JSON.stringify(m)}; its day is at x ${X(DAY).toFixed(1)}, the candle's high at y ${Y(o.h).toFixed(1)}`);
    } else {
      const f = p.folds.find((x) => x.group === L.group);
      await page.mouse.move(s.rc.x + f.x + f.w / 2, s.rc.y + f.y + f.h / 2);
      const tip = await Q.tip(page);
      C.ok(tip && tip.rows.some((r2) => r2.num && r2.num.text === '13x2' && r2.num.sup === '2W' && /Aggressive Combo 매도 쪽 13 완성/.test(r2.rest) && /2W 봉 2024-12-16 ~ 12-29/.test(r2.rest)), `[${name}] folded into a chip whose tooltip does not name it: "${tip && tip.text}"`);
      await Q.mouseOff(page);
    }
  }
  C.note(`shown at the zooms: ${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  C.ok(how['6개월'] === 'text' && how['3개월'] === 'text', `at 3개월 and 6개월 it is shown as ${how['3개월']} and ${how['6개월']}, not as a number`);
  // the strip: a pink tick on the 2W row of the sell band, over 2024-12-16 ~ 12-29
  const s = await Q.snap(page, { strip: true, nobase: true }), g = P.parseStrip(s.frames.sBase, s.theme), sc = s.probe.stripScale, t = s.probe.strip.find((q) => q.j === 10 && q.kind === 'C' && q.dir === 1 && q.f === 3 && q.bar === E.bar);
  const X = (d) => sc.x0 + (d - sc.first) * sc.ppd, rect = t && g.ticks.find((r) => r.x === t.x0 && r.y === t.y && r.color === PINK);
  const grounds = g.grounds.slice().sort((a, b) => a.y - b.y), mid = grounds[1], row2W = mid ? mid.y + (11 - 10) * (mid.h / 5) : null;   // the middle ground of the upper band is 8D~3W; 3W is its top row, 2W the next
  C.ok(!!rect && rect.y === row2W && rect.x + rect.w > X(BAR) - 1.01 && rect.x < X(DAY + 1) + 1.01, `strip: its tick ${JSON.stringify(rect || t)}; the 2W sell row is at y ${row2W}, its days at x ${X(BAR).toFixed(1)}..${X(DAY + 1).toFixed(1)}`);
  C.logs(ctx, 'btc');
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('known.cjs crashed:', e); process.exit(3); });
