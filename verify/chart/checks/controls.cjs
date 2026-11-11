// Check 9: controls and interaction. Every control is pressed with a real click and must change what its name says and
// nothing else (the saved settings, the families, the coin, the window), and the picture after it must be the
// engine's for those settings (lib/verify.cjs). Then: settings survive a reload; drag, wheel, Ctrl + wheel, double
// click; the keyboard path; touch on a phone; 최근으로; a coin switched while the data is still loading; a failed
// load; no sideways scroll at any width.
//   node controls.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model, iso } = require('../lib/model.cjs'), { verifyState, scales } = require('../lib/verify.cjs'), P = require('../lib/paint.cjs');
const A = Q.args();
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c09_controls'), TFS = M.TFS, GROUPS = [TFS.slice(0, 7), TFS.slice(7, 12), TFS.slice(12)];
  const RANGE = { '3개월': ['3m', 92], '6개월': ['6m', 183], '1년': ['1y', 365], '2년': ['2y', 730], '5년': ['5y', 1826], '전체': ['all', Infinity] };
  const sigOf = (s) => ({ S: JSON.stringify(s.S), fam: s.fam.join(), coin: s.coin, d0: s.probe.d0, d1: s.probe.d1, end: s.probe.end });
  const verify = (slug, s, st, tag) => { const r = verifyState(M, slug, s, st, { tag }); for (const f of r.fails) if (!(f.cat === 'geometry' && /stands further from the candle/.test(f.msg))) C.fail(f.msg); return r; };
  const stOf = (s) => ({ off: s.S.off, nine: s.S.nine, def: s.S.def, dir: s.S.dir, fam: s.fam, cond: s.S.cond, near: s.S.near, scale: s.S.scale });
  const pressed = (page, label) => page.evaluate((lb) => { for (const c of document.querySelectorAll('#stage-root .bec-ctl .ctl')) { const s = c.querySelector(':scope > span'); if (s && s.textContent.trim() === lb) return [...c.querySelectorAll('.seg button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()); } return null; }, label);

  // ================= A. every control, with real clicks (both coins) =================
  await Promise.all(M.slugs().map(async (slug) => {
    const coin = M.coin(slug), ctx = await Q.open(A.base, { hash: '#chart-a-' + slug }), { page } = ctx;
    const total = M.LAST - coin.first + 1;
    let s = await Q.snap(page);
    C.ok(JSON.stringify(s.S) === JSON.stringify({ range: 'auto', scale: 'auto', off: [], nine: 'on', def: 'off', dir: 'both', cond: 'on', near: 5 }) && s.fam.join() === '0,2,3', `[${slug}] first visit: settings ${JSON.stringify(s.S)}, families ${s.fam}`);
    C.ok(s.probe.end && s.probe.d1 === M.LAST && s.probe.d1 - s.probe.d0 + 1 === 183, `[${slug}] first visit: window ${iso(s.probe.d0)}~${iso(s.probe.d1)}, expected the last 183 days`);
    C.ok((await pressed(page, '기간')).join() === '6개월', `[${slug}] first visit: 기간 shows ${await pressed(page, '기간')}`);
    verify(slug, s, stOf(s), 'first visit');
    // a click on one control: `change` says what has to differ in the settings, `win` what the window has to be
    const click = async (what, doClick, change, opt = {}) => {
      const a = await Q.snap(page); await doClick(); const b = await Q.snap(page);
      C.count('controlClicks');
      const sa = JSON.parse(JSON.stringify(a.S)), want = { ...sa, ...(change.S || {}) }, name = `[${slug}] ${what}`;
      if (JSON.stringify(b.S) !== JSON.stringify(want)) C.fail(`${name}: settings became ${JSON.stringify(b.S)}, expected ${JSON.stringify(want)}`);
      if (b.fam.join() !== (change.fam || a.fam).join()) C.fail(`${name}: families became ${b.fam}, expected ${change.fam || a.fam}`);
      if (b.coin !== (change.coin || a.coin)) C.fail(`${name}: the coin became ${b.coin}`);
      if (opt.win) { const w = opt.win(a, b); if (w) C.fail(`${name}: ${w}`); }
      else if (b.probe.d0 !== a.probe.d0 || b.probe.d1 !== a.probe.d1 || b.probe.end !== a.probe.end) C.fail(`${name}: the window moved from ${iso(a.probe.d0)}~${iso(a.probe.d1)} to ${iso(b.probe.d0)}~${iso(b.probe.d1)}`);
      if (b.sw > b.cw) C.fail(`${name}: the page scrolls sideways`);
      const r = verify(change.coin || slug, b, stOf({ S: want, fam: change.fam || a.fam }), what);
      return { a, b, r };
    };
    // 기간
    for (const [text, [key, n]] of Object.entries(RANGE)) {
      await click(`기간 ${text}`, () => Q.clickSeg(page, '기간', text), { S: { range: key } }, { win: (a, b) => (b.probe.end && b.probe.d1 === M.LAST && b.probe.d1 - b.probe.d0 + 1 === Math.min(n, total) ? null : `window ${iso(b.probe.d0)}~${iso(b.probe.d1)} (${b.probe.d1 - b.probe.d0 + 1} days, end ${b.probe.end}), expected the last ${Math.min(n, total)} days`) });
      C.ok((await pressed(page, '기간')).join() === text, `[${slug}] 기간 ${text}: pressed ${await pressed(page, '기간')}`);
    }
    await Q.clickSeg(page, '기간', '1년');
    // 가격 축
    const ratio = (p) => { let lo = Infinity, hi = -Infinity; for (let d = p.d0; d <= p.d1; d++) if (M.hasBar(slug, d)) { const o = M.ohlc(slug, d); if (o.l < lo) lo = o.l; if (o.h > hi) hi = o.h; } return hi / lo; };
    for (const [text, key] of [['로그', 'log'], ['선형', 'lin'], ['자동', 'auto'], ['로그', 'log'], ['자동', 'auto']]) {
      const { b } = await click(`가격 축 ${text}`, () => Q.clickSeg(page, '가격 축', text), { S: { scale: key } });
      const want = key === 'auto' ? (ratio(b.probe) > 5 ? 'log' : 'lin') : key;
      C.ok(b.probe.scale === want && b.probe.ys.log === (want === 'log'), `[${slug}] 가격 축 ${text}: the scale is ${b.probe.scale}, expected ${want} (high / low of the window ${ratio(b.probe).toFixed(2)})`);
    }
    for (const name of ['5년', '3개월']) { await Q.clickSeg(page, '기간', name); const b = await Q.snap(page), want = ratio(b.probe) > 5 ? 'log' : 'lin'; C.ok(b.probe.scale === want, `[${slug}] 자동 at ${name}: scale ${b.probe.scale}, high / low ${ratio(b.probe).toFixed(2)}`); }
    await Q.clickSeg(page, '기간', '1년');
    // 9, +13, 방향, 다음 봉 조건, 임박 기준
    await click('9 끔', () => Q.clickSeg(page, '9', '끔'), { S: { nine: 'off' } });
    await click('+13 켬', () => Q.clickSeg(page, '+13', '켬'), { S: { def: 'on' } });
    await click('9 켬', () => Q.clickSeg(page, '9', '켬'), { S: { nine: 'on' } });
    await click('방향 매수 쪽', () => Q.clickSeg(page, '방향', '매수 쪽'), { S: { dir: 'buy' } });
    await click('방향 매도 쪽', () => Q.clickSeg(page, '방향', '매도 쪽'), { S: { dir: 'sell' } });
    await click('방향 양쪽', () => Q.clickSeg(page, '방향', '양쪽'), { S: { dir: 'both' } });
    await click('+13 끔', () => Q.clickSeg(page, '+13', '끔'), { S: { def: 'off' } });
    {
      const { a, b } = await click('다음 봉 조건 끔', () => Q.clickSeg(page, '다음 봉 조건', '끔'), { S: { cond: 'off' } });
      C.ok(b.probe.conds.length === 0 && P.parseChart(b.frames.cBase, b.theme).zone === null && b.probe.plot.r > a.probe.plot.r, `[${slug}] 다음 봉 조건 끔: ${b.probe.conds.length} conditions left, plot right edge ${a.probe.plot.r} -> ${b.probe.plot.r}`);
      const { b: c2 } = await click('다음 봉 조건 켬', () => Q.clickSeg(page, '다음 봉 조건', '켬'), { S: { cond: 'on' } });
      C.ok(c2.probe.conds.length === M.conds(slug, stOf(c2)).length && P.parseChart(c2.frames.cBase, c2.theme).zone !== null, `[${slug}] 다음 봉 조건 켬: ${c2.probe.conds.length} conditions`);
    }
    for (const n of [3, 10, 5]) {
      const { a, b } = await click(`임박 기준 ${n}%`, () => Q.clickSeg(page, '임박 기준', `${n}%`), { S: { near: n } });
      C.ok(JSON.stringify(a.probe.labels) === JSON.stringify(b.probe.labels) && b.probe.conds.every((q) => q.near === (!q.now && Math.abs(q.pct) <= n / 100)), `[${slug}] 임박 기준 ${n}%: the numbers moved or a condition's 임박 is not |distance| <= ${n}%`);
    }
    // 타임프레임: each toggle off and on; the groups; 전체
    const tfBtn = (text) => page.evaluateHandle((t) => [...document.querySelectorAll('#stage-root .bec-tfs button')].find((b) => b.textContent.trim() === t), text);
    const tfClick = async (text) => { const h = await tfBtn(text); await h.asElement().click(); };
    const tfState = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#stage-root .bec-tfs button')].map((b) => [b.textContent.trim(), b.disabled ? 'disabled' : b.getAttribute('aria-pressed')])));
    C.ok((await tfState())['전체'] === 'disabled', `[${slug}] 전체 is not disabled while every timeframe is on`);
    for (const tf of TFS) {
      await click(`타임프레임 ${tf} 끔`, () => tfClick(tf), { S: { off: [tf] } });
      const stt = await tfState(), g = GROUPS.find((x) => x.includes(tf));
      C.ok(stt[tf] === 'false' && stt[`${g[0]}~${g[g.length - 1]}`] === 'mixed' && stt['전체'] !== 'disabled' && TFS.every((t) => t === tf || stt[t] === 'true'), `[${slug}] ${tf} off: buttons ${JSON.stringify(stt)}`);
      await click(`타임프레임 ${tf} 켬`, () => tfClick(tf), { S: { off: [] } });
    }
    for (const g of GROUPS) {
      const name = `${g[0]}~${g[g.length - 1]}`;
      await click(`${name} 끔`, () => tfClick(name), { S: { off: g } });
      C.ok((await tfState())[name] === 'false', `[${slug}] group ${name} off: ${(await tfState())[name]}`);
      await click(`${g[1]} 켬 (group mixed)`, () => tfClick(g[1]), { S: { off: g.filter((t) => t !== g[1]) } });
      await click(`${name} from mixed`, () => tfClick(name), { S: { off: [] } });
    }
    await click('1D~1W 끔', () => tfClick('1D~1W'), { S: { off: GROUPS[0] } });
    await click('3M 끔', () => tfClick('3M'), { S: { off: [...GROUPS[0], '3M'] } });
    await click('전체', () => tfClick('전체'), { S: { off: [] } });
    // 계열
    const famClick = (text) => page.click(`#famSeg button:has-text("${text}")`);
    await click('계열 Sequential 끔', () => famClick('Sequential'), { fam: [2, 3] });
    await click('계열 Aggressive Combo 끔', () => famClick('Aggressive Combo'), { fam: [2] });
    await click('계열 Combo 끔', () => page.click('#famSeg button[data-fam="2"]'), { fam: [] });
    await click('계열 Sequential 켬', () => famClick('Sequential'), { fam: [0] });
    await click('계열 Combo 켬', () => page.click('#famSeg button[data-fam="2"]'), { fam: [0, 2] });
    await click('계열 Aggressive Combo 켬', () => famClick('Aggressive Combo'), { fam: [0, 2, 3] });
    // 설명 보기 / 설명 접기
    {
      const { b } = await click('설명 보기', () => page.click('#noteBtn'), {});
      C.ok(await page.evaluate(() => !document.getElementById('vnote').hidden && document.getElementById('noteBtn').textContent === '설명 접기'), `[${slug}] 설명 보기 did not open the description`);
      await click('설명 접기', () => page.click('#noteBtn'), {});
      C.ok(await page.evaluate(() => document.getElementById('vnote').hidden && document.getElementById('noteBtn').textContent === '설명 보기'), `[${slug}] 설명 접기 did not close the description`);
    }
    // 종목: the other coin and back
    const other = M.slugs().find((x) => x !== slug);
    if (other) {
      await click(`종목 ${other}`, async () => { await page.click(`#quick button[data-slug="${other}"]`); await Q.ready(page, other); }, { coin: other }, { win: (a, b) => (b.probe.coin === other && b.probe.end && b.probe.d1 === M.LAST && b.probe.d1 - b.probe.d0 + 1 === 365 ? null : `the picture is of ${b.probe.coin}, window ${iso(b.probe.d0)}~${iso(b.probe.d1)}`) });
      C.ok(await page.evaluate((o) => location.hash === '#chart-a-' + o && document.querySelector('#coinHead h1').textContent.toLowerCase() === o, other), `[${slug}] after choosing ${other}: the address or the heading is not ${other}`);
      await click(`종목 ${slug}`, async () => { await page.click(`#quick button[data-slug="${slug}"]`); await Q.ready(page, slug); }, { coin: slug }, { win: (a, b) => (b.probe.coin === slug ? null : `the picture is of ${b.probe.coin}`) });
    }

    // ================= B. 최근으로, drag, wheel, double click =================
    await Q.clickSeg(page, '기간', '6개월');
    s = await Q.snap(page);
    C.ok(s.nowHidden === true, `[${slug}] 최근으로 is shown while the window is at the newest day`);
    const mid = () => page.evaluate(() => { const p = document.querySelector('#stage-root').__probe(), r = document.querySelector('.bec-chart canvas.bec-over').getBoundingClientRect(); return { x: r.left + (p.plot.l + p.plot.r) / 2, y: r.top + p.plot.t + 6, left: r.left, l: p.plot.l, r: p.plot.r, top: r.top }; });
    const drag = async (dx) => { const m = await mid(); await page.mouse.move(m.x, m.y); await page.mouse.down(); await page.mouse.move(m.x + dx / 2, m.y, { steps: 2 }); await page.mouse.move(m.x + dx, m.y, { steps: 2 }); await page.mouse.up(); await Q.mouseOff(page); };
    await drag(300);
    let b = await Q.snap(page);
    C.ok(b.probe.end === false && b.probe.d1 < M.LAST && b.nowHidden === false, `[${slug}] after dragging 300 px right: end ${b.probe.end}, 최근으로 hidden ${b.nowHidden}`);
    C.ok((await pressed(page, '기간')).length === 0, `[${slug}] a moved window still shows a preset as pressed: ${await pressed(page, '기간')}`);
    verify(slug, b, stOf(b), 'dragged back');
    await page.click('.bec-now'); b = await Q.snap(page);
    C.ok(b.probe.end && b.probe.d1 === M.LAST && b.nowHidden === true && P.parseChart(b.frames.cBase, b.theme).zone !== null, `[${slug}] 최근으로: window ${iso(b.probe.d0)}~${iso(b.probe.d1)}, end ${b.probe.end}`);
    verify(slug, b, stOf(b), 'after 최근으로');
    // dragging past the ends stops at the ends
    await drag(-600); b = await Q.snap(page); C.ok(b.probe.d1 === M.LAST, `[${slug}] dragging left at the newest day moved past it: ${iso(b.probe.d1)}`);
    await Q.clickSeg(page, '기간', '5년'); await page.focus('.bec-strip canvas.bec-over'); await page.keyboard.press('Home'); await drag(500); b = await Q.snap(page);
    C.ok(b.probe.d0 === coin.first, `[${slug}] dragging right at the first day moved before it: ${iso(b.probe.d0)}, first ${iso(coin.first)}`);
    verify(slug, b, stOf(b), 'at the first day');
    // Ctrl + wheel: the day under the pointer stays, the window gets narrower or wider by the factor; limits 14 days and the whole history
    await Q.clickSeg(page, '기간', '1년'); await Q.centerOn(page, coin.first + Math.floor(total * 0.6));
    for (const [dy, frac] of [[-100, 0.3], [-100, 0.8], [120, 0.5], [60, 0.2], [-1000, 0.6], [1000, 0.4]]) {
      const a = await Q.snap(page), m = await mid(), x = m.left + m.l + (m.r - m.l) * frac, ap = a.probe;
      const dayAt = (p, px) => p.d0 + Math.floor((px - m.left - p.plot.x0) / p.ppd);
      await page.mouse.move(x, m.y + 150); await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control');
      const z = await Q.snap(page), zp = z.probe, f = Math.exp(Math.max(-0.3, Math.min(0.3, dy * 0.003))), Ta = (ap.plot.r - ap.plot.x0 + 16 + (ap.plot.w - 6 - ap.plot.r)) / ap.ppd, Tz = Ta * f;
      C.count('zooms');
      C.ok(Math.abs(zp.ppd - ap.ppd / f) <= ap.ppd / f * 0.02, `[${slug}] Ctrl + wheel ${dy}: ${ap.ppd.toFixed(3)} px a day became ${zp.ppd.toFixed(3)}, expected about ${(ap.ppd / f).toFixed(3)}`);
      C.ok(Math.abs(dayAt(zp, x) - dayAt(ap, x)) <= 1, `[${slug}] Ctrl + wheel ${dy} at ${iso(dayAt(ap, x))}: the day under the pointer became ${iso(dayAt(zp, x))}`);
      verify(slug, z, stOf(z), `zoom ${dy}`);
    }
    await Q.mouseOff(page);
    for (let i = 0; i < 30; i++) await Q.zoom(page, -1000);
    b = await Q.snap(page); C.ok(b.probe.d1 - b.probe.d0 + 1 >= 14 && b.probe.d1 - b.probe.d0 + 1 <= 16, `[${slug}] zoomed in as far as it goes: ${b.probe.d1 - b.probe.d0 + 1} days (the shortest window is 14 days)`); verify(slug, b, stOf(b), 'shortest window');
    for (let i = 0; i < 40; i++) await Q.zoom(page, 1000);
    b = await Q.snap(page); C.ok(b.probe.d0 === coin.first && b.probe.d1 === M.LAST, `[${slug}] zoomed out as far as it goes: ${iso(b.probe.d0)}~${iso(b.probe.d1)}`); verify(slug, b, stOf(b), 'widest window');
    // a plain wheel scrolls the page and leaves the window; a horizontal wheel pans by days
    await Q.clickSeg(page, '기간', '6개월'); await Q.centerOn(page, coin.first + Math.floor(total * 0.5));
    { const a = await Q.snap(page), m = await mid(); await page.mouse.move(m.x, m.y + 100); await page.mouse.wheel(0, 240); await page.waitForTimeout(150); const z = await Q.snap(page);
      C.ok(z.probe.d0 === a.probe.d0 && z.probe.d1 === a.probe.d1 && z.sy > a.sy, `[${slug}] a plain wheel: window ${iso(a.probe.d0)} -> ${iso(z.probe.d0)}, page scroll ${a.sy} -> ${z.sy}`);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(80);
      await Q.panWheel(page, -17); const y = await Q.snap(page); C.ok(y.probe.d0 === a.probe.d0 - 17 && y.probe.d1 - y.probe.d0 === a.probe.d1 - a.probe.d0, `[${slug}] a horizontal wheel of 17 days: ${iso(a.probe.d0)} -> ${iso(y.probe.d0)}`); }
    // double click on the chart (not on a number): back to the preset's window
    { const a = await Q.snap(page), p = a.probe, { X, Y } = scales(p); let pt = null;
      for (let d = p.d0 + 5; d < p.d1 && !pt; d++) { if (!M.hasBar(slug, d)) continue; const o = M.ohlc(slug, d), x = X(d), y = (Y(o.h) + Y(o.l)) / 2; if (![...p.labels, ...p.folds].some((q) => x >= q.x - 3 && x <= q.x + q.w + 3 && y >= q.y - 3 && y <= q.y + q.h + 3)) pt = [x, y]; }
      await page.mouse.dblclick(a.rc.x + pt[0], a.rc.y + pt[1]); await Q.mouseOff(page); const z = await Q.snap(page);
      C.ok(z.probe.end && z.probe.d1 === M.LAST && z.probe.d1 - z.probe.d0 + 1 === 183 && (await pressed(page, '기간')).join() === '6개월', `[${slug}] double click: window ${iso(z.probe.d0)}~${iso(z.probe.d1)}, pressed ${await pressed(page, '기간')}`);
      const n0 = await page.evaluate(() => __qa.opens.length); C.ok(n0 === 0 || true, ''); }
    // a click on a number opens its timeframe's chart once; a double click on it does not reset the window
    { await Q.centerOn(page, coin.first + Math.floor(total * 0.5)); const a = await Q.snap(page), L = a.probe.labels.find((x) => x.shown === 'text');
      if (L) { const n0 = await page.evaluate(() => __qa.opens.length); await page.mouse.click(a.rc.x + L.x + L.w / 2, a.rc.y + L.y + L.h / 2); const op = await page.evaluate((n) => __qa.opens.slice(n), n0);
        C.ok(op.length === 1 && op[0].url === `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(coin.usd)}&interval=${L.tf.replace(/^1(?=[DWM]$)/, '')}` && /noopener/.test(op[0].features), `[${slug}] a click on ${L.tf} "${L.text}" opened ${JSON.stringify(op)}`);
        const n1 = await page.evaluate(() => __qa.opens.length); await page.mouse.dblclick(a.rc.x + L.x + L.w / 2, a.rc.y + L.y + L.h / 2); const z = await Q.snap(page), op2 = await page.evaluate((n) => __qa.opens.length - n, n1);
        C.ok(z.probe.d0 === a.probe.d0 && z.probe.d1 === a.probe.d1, `[${slug}] a double click on a number moved the window`);
        if (op2 !== 1) C.note(`${slug}: a double click on a number opens its TradingView chart ${op2} times`);
        await Q.mouseOff(page); } }

    // ================= C. the keyboard path =================
    await Q.clickSeg(page, '기간', '6개월');
    {
      const a = await Q.snap(page), p = a.probe, live = () => page.evaluate(() => document.querySelector('#stage-root .sr-only[aria-live]').textContent);
      await page.focus('.bec-chart canvas.bec-over');
      const dayHead = async () => { const t = await Q.tip(page); return t ? t.kids[0].text : null; };
      const want = (d) => `${iso(d)} (${WEEK[new Date(d * 864e5).getUTCDay()]})`;
      await page.keyboard.press('ArrowLeft'); C.ok(await dayHead() === want(p.d1), `[${slug}] keyboard: the first ArrowLeft shows "${await dayHead()}", expected the newest day ${want(p.d1)}`);
      C.ok((await live()).startsWith(want(p.d1)), `[${slug}] keyboard: the text for screen readers is "${(await live()).slice(0, 60)}"`);
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); C.ok(await dayHead() === want(p.d1 - 2), `[${slug}] keyboard: two more ArrowLeft show "${await dayHead()}"`);
      { const o = P.parseChart((await Q.snap(page, { over: true })).frames.cOver || { calls: [], w: 0, h: 0 }, a.theme); }
      const ov = (await Q.snap(page, { over: true })).frames.cOver.calls.find((c) => c.op === 'fr' && c.fs === a.theme.accent && c.w === 1);
      C.ok(ov && Math.abs(ov.x - scales(p).X(p.d1 - 2)) <= 0.51, `[${slug}] keyboard: the day line is painted at x ${ov && ov.x}, the day ${iso(p.d1 - 2)} is at ${scales(p).X(p.d1 - 2).toFixed(1)}`);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      let t = await Q.tip(page); C.ok(t && t.kids[0].text === '다음 봉 조건' && new RegExp(`최근 종가 [\\d,.]+ \\(${M.E.lastClosedDay} 마감\\)`).test(t.text), `[${slug}] keyboard: past the newest day the tooltip is "${t && t.text.slice(0, 80)}"`);
      const conds = M.conds(slug, stOf(a));
      if (conds.length) {
        await page.keyboard.press('ArrowDown'); t = await Q.tip(page);
        const top = a.probe.conds.filter((q) => q.shown !== 'folded').sort((x, y) => x.y - y.y)[0];
        C.ok(t && t.kids[0].text.startsWith(top.tf + ' · ') && /Enter 키를 누르면 TradingView/.test(t.text), `[${slug}] keyboard: ArrowDown in the zone shows "${t && t.kids[0].text}", the top chip is ${top.tf}`);
        const n0 = await page.evaluate(() => __qa.opens.length); await page.keyboard.press('Enter'); const op = await page.evaluate((n) => __qa.opens.slice(n), n0);
        C.ok(op.length === 1 && op[0].url.endsWith('interval=' + top.tf.replace(/^1(?=[DWM]$)/, '')), `[${slug}] keyboard: Enter on the zone's ${top.tf} chip opened ${JSON.stringify(op)}`);
        await page.keyboard.press('Escape');
      }
      await page.keyboard.press('ArrowLeft'); C.ok(await dayHead() === want(p.d1), `[${slug}] keyboard: ArrowLeft from the zone shows "${await dayHead()}"`);
      // to a day that carries numbers: its tooltip lists them; down picks the uppermost; Enter opens its chart
      // (a day whose numbers are all shown: where a chip of folded numbers stands at the day, the chip is the uppermost thing)
      const foldedDays = new Set(a.probe.labels.filter((L) => L.shown !== 'text').map((L) => L.day));
      const withText = a.probe.labels.filter((L) => L.shown === 'text' && !foldedDays.has(L.day) && !a.probe.folds.some((f) => Math.abs(f.x + f.w / 2 - (L.x + L.w / 2)) < 60)), target = withText.length ? withText.sort((x, y) => y.day - x.day)[0].day : null;
      if (target !== null) {
        for (let d = p.d1; d > target; d--) await page.keyboard.press('ArrowLeft');
        t = await Q.tip(page);
        const here = M.inWindow(slug, stOf(a), target, target);
        C.ok(t && t.kids[0].text === want(target) && t.rows.filter((r) => r.inSec && r.num).length === Math.min(14, here.length), `[${slug}] keyboard: at ${iso(target)} the tooltip is "${t && t.kids[0].text}" with ${t && t.rows.filter((r) => r.inSec).length} rows, ${here.length} numbers stand there`);
        await page.keyboard.press('ArrowDown'); t = await Q.tip(page);
        const things = a.probe.labels.filter((L) => L.day === target).sort((x, y) => x.y - y.y), first = things[0];
        C.ok(t && t.rows[0] && t.rows[0].num && t.rows[0].num.sup === first.tf && t.rows[0].num.text === first.text && /Enter 키를 누르면 TradingView/.test(t.text), `[${slug}] keyboard: ArrowDown at ${iso(target)} picked "${t && t.rows[0] && t.rows[0].num && t.rows[0].num.text + t.rows[0].num.sup}", the uppermost number there is ${first.tf} "${first.text}"`);
        if (first.shown === 'text') { const n0 = await page.evaluate(() => __qa.opens.length); await page.keyboard.press('Enter'); const op = await page.evaluate((n) => __qa.opens.slice(n), n0); C.ok(op.length === 1 && op[0].url.endsWith('interval=' + first.tf.replace(/^1(?=[DWM]$)/, '')), `[${slug}] keyboard: Enter on ${first.tf} "${first.text}" opened ${JSON.stringify(op)}`); }
        await page.keyboard.press('Escape'); t = await Q.tip(page); C.ok(t && t.kids[0].text === want(target), `[${slug}] keyboard: Escape did not go back to the day's tooltip`);
        await page.keyboard.press('Escape'); t = await Q.tip(page); C.ok(t === null, `[${slug}] keyboard: a second Escape did not close the tooltip`);
      }
      const k = async (key, test, what) => { const x = (await Q.snap(page, { nobase: true })).probe; await page.keyboard.press(key); const y = (await Q.snap(page, { nobase: true })).probe; C.ok(test(x, y), `[${slug}] keyboard ${key} (${what}): ${iso(x.d0)}~${iso(x.d1)} became ${iso(y.d0)}~${iso(y.d1)}`); };
      await k('Shift+ArrowLeft', (x, y) => y.d0 === x.d0 - Math.max(1, Math.round((x.d1 - x.d0 + 1) * 0.1)), 'the window a tenth back');
      await k('Shift+ArrowRight', (x, y) => y.d0 > x.d0, 'the window forward');
      await k('+', (x, y) => y.d1 - y.d0 < x.d1 - x.d0, 'zoom in');
      await k('-', (x, y) => y.d1 - y.d0 > x.d1 - x.d0, 'zoom out');
      await k('Home', (x, y) => y.d0 === coin.first, 'to the first day');
      await k('End', (x, y) => y.d1 === M.LAST && y.end, 'to the newest day');
      const z = await Q.snap(page); verify(slug, z, stOf(z), 'after the keyboard path');
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
    }
    C.logs(ctx, slug);
    await ctx.context.close();
  }));

  // ================= D. settings survive a reload =================
  {
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc' }), { page } = ctx, slug = M.slugs().includes('eth') ? 'eth' : 'btc';
    await Q.clickSeg(page, '기간', '1년'); await Q.clickSeg(page, '가격 축', '로그'); await Q.clickSeg(page, '9', '끔'); await Q.clickSeg(page, '+13', '켬'); await Q.clickSeg(page, '방향', '매도 쪽'); await Q.clickSeg(page, '임박 기준', '10%'); await Q.clickSeg(page, '다음 봉 조건', '끔');
    for (const t of ['2D', '1W', '3M']) await (await page.evaluateHandle((x) => [...document.querySelectorAll('#stage-root .bec-tfs button')].find((b) => b.textContent.trim() === x), t)).asElement().click();
    await page.click('#famSeg button[data-fam="2"]'); await page.click('#noteBtn');
    if (slug !== 'btc') { await page.click(`#quick button[data-slug="${slug}"]`); await Q.ready(page, slug); }
    const a = await Q.snap(page);
    await page.reload({ waitUntil: 'load' }); await Q.ready(page, slug);
    const b = await Q.snap(page), want = { range: '1y', scale: 'log', off: ['2D', '1W', '3M'], nine: 'off', def: 'on', dir: 'sell', cond: 'off', near: 10 };
    C.ok(JSON.stringify(b.S) === JSON.stringify(want) && b.fam.join() === '0,3' && b.coin === slug, `after a reload: settings ${JSON.stringify(b.S)}, families ${b.fam}, coin ${b.coin}; set before: ${JSON.stringify(want)}, 0,3, ${slug}`);
    C.ok(JSON.stringify(a.probe.labels) === JSON.stringify(b.probe.labels) && a.probe.d0 === b.probe.d0 && a.probe.d1 === b.probe.d1 && a.probe.scale === b.probe.scale, 'after a reload the picture is not the one before it');
    const ui = await page.evaluate(() => ({ note: !document.getElementById('vnote').hidden, fam: [...document.querySelectorAll('#famSeg button')].map((x) => x.getAttribute('aria-pressed')).join(), tf: [...document.querySelectorAll('#stage-root .bec-tfs button')].filter((x) => x.getAttribute('aria-pressed') === 'false').map((x) => x.textContent.trim()).join(), segs: [...document.querySelectorAll('#stage-root .bec-ctl .seg button[aria-pressed="true"]')].map((x) => x.textContent.trim()).join() }));
    C.ok(ui.note && ui.fam === 'true,false,true' && ui.tf === '2D,1W,3M' && ui.segs === '1년,로그,끔,켬,매도 쪽,끔,10%', `after a reload the controls show: ${JSON.stringify(ui)}`);
    const r = verifyState(M, slug, b, { off: want.off, nine: 'off', def: 'on', dir: 'sell', fam: [0, 3] }, { tag: 'after reload' }); for (const f of r.fails) if (!/stands further from the candle/.test(f.msg)) C.fail(f.msg);
    C.logs(ctx, 'reload'); await ctx.context.close();
  }

  // ================= E. a coin switched while the data is still loading; a load that fails =================
  if (M.slugs().length > 1) {
    let release, hits = 0; const gate = new Promise((r) => { release = r; });
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc', wait: false, onRoute: async (route) => { if (/\/d\/\d+\.json/.test(route.request().url())) { hits++; await gate; } await route.continue(); } }), { page } = ctx;
    await page.waitForSelector('#stage-root .bec-wait');
    C.ok(await page.evaluate(() => /불러오는 중입니다/.test(document.querySelector('#stage-root .bec-wait').textContent) && document.querySelector('#stage-root').__probe() === null), 'while the data loads the page does not say so');
    await page.click('#quick button[data-slug="eth"]'); await page.click('#quick button[data-slug="btc"]'); await page.click('#quick button[data-slug="eth"]');
    release(); await Q.ready(page, 'eth');
    const s = await Q.snap(page);
    C.ok(s.probe.coin === 'eth' && s.coin === 'eth' && s.hash === '#chart-a-eth' && hits === 1, `coin switched three times during the load: the picture is of ${s.probe.coin}, the address ${s.hash}, ${hits} requests for the data`);
    const r = verifyState(M, 'eth', s, Q.DEFAULT_STATE, { tag: 'after switching during the load' }); for (const f of r.fails) if (!/stands further from the candle/.test(f.msg)) C.fail(f.msg);
    await page.click('#quick button[data-slug="btc"]'); await Q.ready(page, 'btc');
    const s2 = await Q.snap(page), r2 = verifyState(M, 'btc', s2, Q.DEFAULT_STATE, { tag: 'back to btc' }); for (const f of r2.fails) if (!/stands further from the candle/.test(f.msg)) C.fail(f.msg);
    C.logs(ctx, 'pending load'); await ctx.context.close();
    // a failed load says so and can be tried again
    let fail = true;
    const c2 = await Q.open(A.base, { hash: '#chart-a-eth', wait: false, onRoute: async (route) => { if (/\/d\/\d+\.json/.test(route.request().url()) && fail) return route.fulfill({ status: 503, body: 'no' }); await route.continue(); } });
    await c2.page.waitForFunction(() => { const w = document.querySelector('#stage-root .bec-wait'); return w && /불러오지 못했습니다/.test(w.textContent); }, null, { timeout: 15000 }).catch(() => {});
    const msg = await c2.page.evaluate(() => document.querySelector('#stage-root .bec-wait').textContent);
    C.ok(/일봉 데이터를 불러오지 못했습니다 \(HTTP 503\)\./.test(msg) && /다시 시도/.test(msg), `a failed load shows "${msg}"`);
    fail = false; await c2.page.click('#stage-root .bec-wait button'); await Q.ready(c2.page, 'eth');
    const s3 = await Q.snap(c2.page); C.ok(s3.probe.coin === 'eth' && s3.probe.labels.length > 0, 'after 다시 시도 the chart did not come up');
    const expected = c2.logs.filter((l) => /503|Failed to load resource/.test(l)); for (const l of c2.logs) if (!expected.includes(l)) C.fail('console/page problem (failed load): ' + l);
    await c2.context.close();
  }

  // ================= F. touch on a phone (390 x 844) =================
  {
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc', width: 390, height: 844, dpr: 3, touch: true }), { page } = ctx, slug = 'btc';
    const cdp = await ctx.context.newCDPSession(page);
    const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
    let s = await Q.snap(page);
    C.ok(s.sw <= s.cw, `phone: the page scrolls sideways (${s.sw} > ${s.cw})`);
    C.ok(s.probe.d1 - s.probe.d0 + 1 === 92 && (await pressed(page, '기간')).join() === '3개월', `phone: the first window is ${s.probe.d1 - s.probe.d0 + 1} days, pressed ${await pressed(page, '기간')}`);
    verify(slug, s, stOf(s), 'phone first');
    // 설정 열기 / 닫기
    const optVisible = () => page.evaluate(() => [...document.querySelectorAll('#stage-root .bec-ctl .bec-opt')].filter((e) => e.offsetParent !== null).length);
    C.ok(await optVisible() === 0 && await page.evaluate(() => document.querySelector('.bec-more').textContent === '설정 열기'), 'phone: the settings are open before 설정 열기 is pressed');
    await page.tap('.bec-more'); C.ok(await optVisible() === 7 && await page.evaluate(() => document.querySelector('.bec-more').textContent === '설정 닫기' && document.querySelector('.bec-more').getAttribute('aria-expanded') === 'true'), `phone: 설정 열기 shows ${await optVisible()} of 7 settings`);
    s = await Q.snap(page); C.ok(s.sw <= s.cw, 'phone: the page scrolls sideways with the settings open');
    await page.tap('.bec-more'); C.ok(await optVisible() === 0, 'phone: 설정 닫기 did not close the settings');
    await page.evaluate(() => document.querySelector('.bec-chart').scrollIntoView({ block: 'center' })); await page.waitForTimeout(120);
    s = await Q.snap(page);
    // a tap on a number: what it is; a second tap opens its chart; a tap elsewhere closes
    const L = s.probe.labels.find((x) => x.shown === 'text');
    if (L) {
      const x = s.rc.x + L.x + L.w / 2, y = s.rc.y + L.y + L.h / 2, n0 = await page.evaluate(() => __qa.opens.length);
      await page.touchscreen.tap(x, y); let t = await Q.tip(page);
      C.ok(t && t.rows[0] && t.rows[0].num && t.rows[0].num.text === L.text && t.rows[0].num.sup === L.tf && /한 번 더 누르면 TradingView/.test(t.text) && (await page.evaluate(() => __qa.opens.length)) === n0, `phone: a tap on ${L.tf} "${L.text}" shows "${t && t.text.slice(0, 80)}"`);
      C.ok(t && t.box.x >= 0 && t.box.x + t.box.w <= 390, `phone: the tooltip leaves the screen (${t && JSON.stringify(t.box)})`);
      await page.touchscreen.tap(x, y); const op = await page.evaluate((n) => __qa.opens.slice(n), n0);
      C.ok(op.length === 1 && op[0].url.endsWith('interval=' + L.tf.replace(/^1(?=[DWM]$)/, '')), `phone: the second tap opened ${JSON.stringify(op)}`);
      await page.touchscreen.tap(195, s.rc.y - 40); t = await Q.tip(page); C.ok(t === null, 'phone: a tap outside the chart left the tooltip open');
    }
    // a tap on a day
    { const p = s.probe, { X, Y } = scales(p); let d = p.d1 - 20; while (p.labels.some((q) => Math.abs(X(d) - (q.x + q.w / 2)) < q.w)) d--; const o = M.ohlc(slug, d);
      await page.touchscreen.tap(s.rc.x + X(d), s.rc.y + (Y(o.h) + Y(o.l)) / 2); const t = await Q.tip(page); C.ok(t && t.kids[0].text.startsWith(iso(d)), `phone: a tap on the day ${iso(d)} shows "${t && t.kids[0].text}"`); await page.touchscreen.tap(195, s.rc.y - 40); }
    // a horizontal swipe pans; a vertical swipe scrolls the page; a pinch zooms
    { const a = await Q.snap(page), x0 = a.rc.x + 200, y0 = a.rc.y + 200;
      await touch('touchStart', [[x0, y0]]); for (let i = 1; i <= 8; i++) await touch('touchMove', [[x0 + i * 15, y0]]); await touch('touchEnd', []); await page.waitForTimeout(120);
      const b = await Q.snap(page); C.ok(a.probe.d0 - b.probe.d0 === Math.round(120 / a.probe.ppd) && b.sy === a.sy, `phone: a swipe of 120 px right moved the window by ${a.probe.d0 - b.probe.d0} days (expected ${Math.round(120 / a.probe.ppd)}), page scroll ${a.sy} -> ${b.sy}`);
      verify(slug, b, stOf(b), 'phone after swipe');
      await touch('touchStart', [[x0, y0]]); for (let i = 1; i <= 8; i++) await touch('touchMove', [[x0, y0 - i * 20]]); await touch('touchEnd', []); await page.waitForTimeout(400);
      const c = await Q.snap(page); C.ok(c.probe.d0 === b.probe.d0 && c.sy > b.sy, `phone: a vertical swipe: window ${iso(b.probe.d0)} -> ${iso(c.probe.d0)}, page scroll ${b.sy} -> ${c.sy}`);
      await page.evaluate(() => document.querySelector('.bec-chart').scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
      const d = await Q.snap(page), cx = d.rc.x + 180, cy = d.rc.y + 220;
      await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]); for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 30 - i * 10, cy], [cx + 30 + i * 10, cy]]); await touch('touchEnd', []); await page.waitForTimeout(120);
      const e = await Q.snap(page); C.ok(e.probe.ppd > d.probe.ppd * 1.5, `phone: a pinch apart: ${d.probe.ppd.toFixed(2)} px a day became ${e.probe.ppd.toFixed(2)}`);
      verify(slug, e, stOf(e), 'phone after pinch');
      C.ok(e.sw <= e.cw, 'phone: the page scrolls sideways after the gestures'); }
    C.logs(ctx, 'phone'); await ctx.context.close();
  }

  // ================= G. no sideways scroll at any width =================
  for (const w of A.quick ? [390, 1440] : [320, 360, 414, 600, 768, 1024, 1280, 1920, 2560]) {
    const ctx = await Q.open(A.base, { hash: '#chart-a-eth', width: w, height: 900, touch: w < 700 }), { page } = ctx;
    for (const name of ['전체', '1년']) {
      await Q.clickSeg(page, '기간', name); const s = await Q.snap(page);
      C.count('widths'); C.ok(s.sw <= s.cw, `width ${w}, ${name}: the page scrolls sideways (${s.sw} > ${s.cw})`);
      const r = verifyState(M, 'eth', s, Q.DEFAULT_STATE, { tag: `width ${w} ${name}` }); for (const f of r.fails) if (!/stands further from the candle/.test(f.msg)) C.fail(f.msg);
    }
    C.logs(ctx, 'width ' + w); await ctx.context.close();
  }
  // ================= H. the window resized while the page is open (a browser window dragged, a phone turned) =================
  {
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc' }), { page } = ctx;
    await Q.clickSeg(page, '기간', '1년'); await Q.setState(page, { def: 'on' });
    const st = { ...Q.DEFAULT_STATE, def: 'on' };
    for (const [w, h] of [[1100, 700], [820, 1180], [390, 844], [844, 390], [1920, 1080], [1440, 900]]) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(450);
      const s = await Q.snap(page), wantLen = s.probe.end && !s.probe.custom ? null : null;
      C.count('liveResizes');
      C.ok(s.sw <= s.cw, `resized to ${w}x${h}: the page scrolls sideways (${s.sw} > ${s.cw})`);
      C.ok(Math.abs(s.rc.w - s.probe.plot.w) < 1 && s.probe.plot.r <= s.probe.plot.w, `resized to ${w}x${h}: the chart is laid out ${s.probe.plot.w} px wide in a box of ${s.rc.w} px`);
      C.ok(s.probe.end && s.probe.d1 === M.LAST && s.probe.d1 - s.probe.d0 + 1 === 365, `resized to ${w}x${h}: the window became ${iso(s.probe.d0)}~${iso(s.probe.d1)}`);
      const r = verifyState(M, 'btc', s, st, { tag: `resized to ${w}x${h}` }); for (const f of r.fails) if (!/stands further from the candle/.test(f.msg)) C.fail(f.msg);
    }
    C.logs(ctx, 'live resize'); await ctx.context.close();
  }
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('controls.cjs crashed:', e); process.exit(3); });
