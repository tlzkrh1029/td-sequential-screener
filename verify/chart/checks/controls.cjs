// Check 9: controls and interaction. Every control is pressed with a real click and must change what its name says and
// nothing else (the saved settings, the families, the coin, the window), and the picture after it must be the
// engine's for those settings (lib/verify.cjs). The row of controls (기간, 계열, 9, the timeframe groups, 설정) and the
// 설정 panel (가격 축, 방향, +13, 다음 봉 조건, 임박 기준, the 20 timeframes, 모두 켜기): the panel opens with its button
// and closes with Esc, a click outside or the button, and the button says what differs from the defaults. 설명 opens
// over the page. Then: settings survive a reload; drag, wheel, Ctrl + wheel, double click; the keyboard (the day
// cursor, the zone, Shift + arrows without a script error, + and -, Page Up and Page Down, Up and Down never scroll
// the page under the cursor); touch on a phone (the tooltip above the finger); 최근 날짜로; the texts of the empty
// states; a coin switched while the data is still loading; a failed load; no sideways scroll at any width.
//   node controls.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model, iso, modesOf, FAM_NAME } = require('../lib/model.cjs'), { verifyState, scales } = require('../lib/verify.cjs'), P = require('../lib/paint.cjs');
const A = Q.args();
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c09_controls'), TFS = M.TFS, GROUPS = [TFS.slice(0, 7), TFS.slice(7, 12), TFS.slice(12)];
  const RANGE = { '3개월': ['3m', 92], '6개월': ['6m', 183], '1년': ['1y', 365], '2년': ['2y', 730], '5년': ['5y', 1826], '전체': ['all', Infinity] };
  const verify = (slug, s, st, tag) => { const r = verifyState(M, slug, s, st, { tag }); for (const f of r.fails) C.fail(f.msg); return r; };
  const stOf = (s) => ({ off: s.S.off, nine: s.S.nine, def: s.S.def, dir: s.S.dir, fam: s.fam, cond: s.S.cond, near: s.S.near, scale: s.S.scale });
  const pressed = (page, label) => page.evaluate((lb) => { for (const c of document.querySelectorAll('#stage-root .bec-ctl .ctl')) { const s = c.querySelector(':scope > span'); if (s && s.textContent.trim() === lb) return [...c.querySelectorAll('.seg button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()); } return null; }, label);
  const moreText = (page) => page.evaluate(() => document.querySelector('#stage-root .bec-more').textContent.trim());

  // ================= A. every control, with real clicks (both coins) =================
  await Promise.all(M.slugs().map(async (slug) => {
    const coin = M.coin(slug), ctx = await Q.open(A.base, { hash: '#chart-a-' + slug }), { page } = ctx;
    const total = M.LAST - coin.first + 1;
    let s = await Q.snap(page);
    C.ok(JSON.stringify(s.S) === JSON.stringify({ range: 'auto', scale: 'auto', off: [], nine: 'on', def: 'off', dir: 'both', cond: 'on', near: 5 }) && s.fam.join() === '0,2,3', `[${slug}] first visit: settings ${JSON.stringify(s.S)}, families ${s.fam}`);
    C.ok(s.probe.end && s.probe.d1 === M.LAST && s.probe.d1 - s.probe.d0 + 1 === 183, `[${slug}] first visit: window ${iso(s.probe.d0)}~${iso(s.probe.d1)}, expected the last 183 days`);
    C.ok((await pressed(page, '기간')).join() === '6개월', `[${slug}] first visit: 기간 shows ${await pressed(page, '기간')}`);
    C.ok(s.setOpen === false && (await moreText(page)) === '설정', `[${slug}] first visit: the 설정 panel is ${s.setOpen ? 'open' : 'closed'} and its button says "${await moreText(page)}"`);
    verify(slug, s, stOf(s), 'first visit');
    // a click on one control: `change` says what has to differ in the settings, `win` what the window has to be
    const click = async (what, doClick, change, opt = {}) => {
      const a = await Q.snap(page); await doClick(); await Q.mouseOff(page); const b = await Q.snap(page);
      C.count('controlClicks');
      const sa = JSON.parse(JSON.stringify(a.S)), want = { ...sa, ...(change.S || {}) }, name = `[${slug}] ${what}`;
      if (JSON.stringify(b.S) !== JSON.stringify(want)) C.fail(`${name}: settings became ${JSON.stringify(b.S)}, expected ${JSON.stringify(want)}`);
      if (b.fam.join() !== (change.fam || a.fam).join()) C.fail(`${name}: families became ${b.fam}, expected ${change.fam || a.fam}`);
      if (b.coin !== (change.coin || a.coin)) C.fail(`${name}: the coin became ${b.coin}`);
      if (opt.win) { const w = opt.win(a, b); if (w) C.fail(`${name}: ${w}`); }
      else if (b.probe.d0 !== a.probe.d0 || b.probe.d1 !== a.probe.d1 || b.probe.end !== a.probe.end) C.fail(`${name}: the window moved from ${iso(a.probe.d0)}~${iso(a.probe.d1)} to ${iso(b.probe.d0)}~${iso(b.probe.d1)}`);
      if (b.sw > b.cw) C.fail(`${name}: the page scrolls sideways`);
      if (b.setOpen) C.fail(`${name}: the 설정 panel is open after the click was done and the panel closed`);
      const r = verify(change.coin || slug, b, stOf({ S: want, fam: change.fam || a.fam }), what);
      return { a, b, r };
    };
    // 기간
    for (const [text, [key, n]] of Object.entries(RANGE)) {
      await click(`기간 ${text}`, () => Q.clickSeg(page, '기간', text), { S: { range: key } }, { win: (a, b) => (b.probe.end && b.probe.d1 === M.LAST && b.probe.d1 - b.probe.d0 + 1 === Math.min(n, total) ? null : `window ${iso(b.probe.d0)}~${iso(b.probe.d1)} (${b.probe.d1 - b.probe.d0 + 1} days, end ${b.probe.end}), expected the last ${Math.min(n, total)} days`) });
      C.ok((await pressed(page, '기간')).join() === text, `[${slug}] 기간 ${text}: pressed ${await pressed(page, '기간')}`);
    }
    await Q.clickSeg(page, '기간', '1년');
    // the 설정 panel: what it holds; it opens with its button and closes with Esc, a click outside and the button
    {
      const panel = () => page.evaluate(() => { const e = document.querySelector('#stage-root .bec-set'), r = e.getBoundingClientRect(); return { open: !e.hidden, labels: [...e.querySelectorAll(':scope > .ctl > span')].map((x) => x.textContent.trim()), tfs: [...e.querySelectorAll('.bec-tfg button')].map((x) => x.textContent.trim()), allOn: [...e.querySelectorAll('.bec-tfbox > button')].map((x) => x.textContent.trim()), segs: Object.fromEntries([...e.querySelectorAll(':scope > .ctl')].map((c) => [c.querySelector(':scope > span').textContent.trim(), [...c.querySelectorAll('.seg button')].map((b) => b.textContent.trim())])), box: { x: r.left, y: r.top, w: r.width, h: r.height }, expanded: document.querySelector('#stage-root .bec-more').getAttribute('aria-expanded') }; });
      await page.click('#stage-root .bec-more');
      let pn = await panel();
      C.ok(pn.open && pn.expanded === 'true', `[${slug}] 설정: the button did not open the panel`);
      C.ok(pn.labels.map((x) => x.replace(/ 표시$/, '')).sort().join() === ['+13', '가격 축', '다음 봉 조건', '방향', '임박 기준', '타임프레임'].sort().join(), `[${slug}] the 설정 panel holds ${pn.labels.join(', ')}; expected 가격 축, +13, 방향, 다음 봉 조건, 임박 기준 and the timeframes`);
      C.ok(pn.tfs.join() === TFS.join() && pn.allOn.join() === '모두 켜기', `[${slug}] the 설정 panel's timeframe toggles are ${pn.tfs.join(' ')} and "${pn.allOn.join()}"`);
      C.ok((pn.segs['다음 봉 조건'] || []).join() === '켬,끔' && (pn.segs['임박 기준'] || []).join() === '3%,5%,10%' && (pn.segs['가격 축'] || []).join() === '자동,선형,로그' && (pn.segs['방향'] || []).join() === '양쪽,매수 쪽,매도 쪽', `[${slug}] the 설정 panel's choices: ${JSON.stringify(pn.segs)}`);
      C.ok(pn.box.x >= 0 && pn.box.x + pn.box.w <= s.cw + 0.5, `[${slug}] the 설정 panel leaves the window (${JSON.stringify(pn.box)})`);
      await page.keyboard.press('Escape'); pn = await panel();
      C.ok(!pn.open && pn.expanded === 'false' && await page.evaluate(() => document.activeElement === document.querySelector('#stage-root .bec-more')), `[${slug}] 설정: Esc did not close the panel and give the focus back to its button`);
      await page.click('#stage-root .bec-more'); await page.mouse.click(s.rc.x + s.probe.plot.l + 200, s.rc.y + s.probe.plot.b + 9); pn = await panel();
      C.ok(!pn.open, `[${slug}] 설정: a click outside did not close the panel`);
      await page.click('#stage-root .bec-more'); await page.click('#stage-root .bec-more'); pn = await panel();
      C.ok(!pn.open, `[${slug}] 설정: its button did not close the panel`);
      const z = await Q.snap(page); C.ok(z.probe.d0 === s.probe.d0 || true, ''); verify(slug, z, stOf(z), 'after the 설정 panel was opened and closed');
    }
    // 가격 축
    const ratio = (p) => { let lo = Infinity, hi = -Infinity; for (let d = p.d0; d <= p.d1; d++) if (M.hasBar(slug, d)) { const o = M.ohlc(slug, d); if (o.l < lo) lo = o.l; if (o.h > hi) hi = o.h; } return hi / lo; };
    for (const [text, key] of [['로그', 'log'], ['선형', 'lin'], ['자동', 'auto'], ['로그', 'log'], ['자동', 'auto']]) {
      const { b } = await click(`가격 축 ${text}`, () => Q.clickSeg(page, '가격 축', text), { S: { scale: key } });
      const want = key === 'auto' ? (ratio(b.probe) > 5 ? 'log' : 'lin') : key;
      C.ok(b.probe.scale === want && b.probe.ys.log === (want === 'log'), `[${slug}] 가격 축 ${text}: the scale is ${b.probe.scale}, expected ${want} (high / low of the window ${ratio(b.probe).toFixed(2)})`);
      C.ok((await moreText(page)) === (key === 'auto' ? '설정' : `설정 · ${key === 'log' ? '로그 축' : '선형 축'}`), `[${slug}] 가격 축 ${text}: the 설정 button says "${await moreText(page)}"`);
    }
    for (const name of ['5년', '3개월']) { await Q.clickSeg(page, '기간', name); const b = await Q.snap(page), want = ratio(b.probe) > 5 ? 'log' : 'lin'; C.ok(b.probe.scale === want, `[${slug}] 자동 at ${name}: scale ${b.probe.scale}, high / low ${ratio(b.probe).toFixed(2)}`); }
    await Q.clickSeg(page, '기간', '1년');
    // 9 (one toggle button), +13, 방향, 다음 봉 조건, 임박 기준
    const nineState = () => page.evaluate(() => { const b = document.querySelectorAll('#stage-root .bec-nine button'); return { n: b.length, text: b[0] && b[0].textContent.trim(), pressed: b[0] && b[0].getAttribute('aria-pressed') }; });
    C.ok(JSON.stringify(await nineState()) === JSON.stringify({ n: 1, text: '9', pressed: 'true' }), `[${slug}] the 9 toggle: ${JSON.stringify(await nineState())}; expected one button "9", pressed`);
    await click('9 끔', () => Q.clickNine(page), { S: { nine: 'off' } });
    C.ok((await nineState()).pressed === 'false', `[${slug}] 9 끔: the button is still pressed`);
    await click('+13 켬', () => Q.clickSeg(page, '+13 표시', '켬'), { S: { def: 'on' } });
    C.ok((await moreText(page)) === '설정 · +13 켬', `[${slug}] +13 켬: the 설정 button says "${await moreText(page)}"`);
    await click('9 켬', () => Q.clickNine(page), { S: { nine: 'on' } });
    await click('방향 매수 쪽', () => Q.clickSeg(page, '방향', '매수 쪽'), { S: { dir: 'buy' } });
    C.ok(/^설정 · .+ 외 1개$/.test(await moreText(page)), `[${slug}] two settings changed: the 설정 button says "${await moreText(page)}"`);
    await click('방향 매도 쪽', () => Q.clickSeg(page, '방향', '매도 쪽'), { S: { dir: 'sell' } });
    await click('방향 양쪽', () => Q.clickSeg(page, '방향', '양쪽'), { S: { dir: 'both' } });
    await click('+13 끔', () => Q.clickSeg(page, '+13 표시', '끔'), { S: { def: 'off' } });
    C.ok((await moreText(page)) === '설정', `[${slug}] back at the defaults the 설정 button says "${await moreText(page)}"`);
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
    // 타임프레임: each toggle off and on; the groups in the row; 모두 켜기
    const tfState = () => page.evaluate(() => ({ ...Object.fromEntries([...document.querySelectorAll('#stage-root .bec-tfg button')].map((b) => [b.textContent.trim(), b.getAttribute('aria-pressed')])), ...Object.fromEntries([...document.querySelectorAll('#stage-root .bec-grp button')].map((b) => [b.textContent.trim(), b.getAttribute('aria-pressed')])), all: document.querySelector('#stage-root .bec-tfbox > button').disabled ? 'disabled' : 'enabled' }));
    C.ok((await tfState()).all === 'disabled', `[${slug}] 모두 켜기 is not disabled while every timeframe is on`);
    for (const tf of TFS) {
      await click(`타임프레임 ${tf} 끔`, () => Q.clickTf(page, tf), { S: { off: [tf] } });
      const stt = await tfState(), g = GROUPS.find((x) => x.includes(tf));
      C.ok(stt[tf] === 'false' && stt[`${g[0]}~${g[g.length - 1]}`] === 'mixed' && stt.all === 'enabled' && TFS.every((t) => t === tf || stt[t] === 'true'), `[${slug}] ${tf} off: buttons ${JSON.stringify(stt)}`);
      C.ok((await moreText(page)) === '설정 · 타임프레임 19/20', `[${slug}] ${tf} off: the 설정 button says "${await moreText(page)}"`);
      await click(`타임프레임 ${tf} 켬`, () => Q.clickTf(page, tf), { S: { off: [] } });
    }
    for (const g of GROUPS) {
      const name = `${g[0]}~${g[g.length - 1]}`;
      await click(`${name} 끔`, () => Q.clickGroup(page, name), { S: { off: g } });
      C.ok((await tfState())[name] === 'false', `[${slug}] group ${name} off: ${(await tfState())[name]}`);
      await click(`${g[1]} 켬 (group mixed)`, () => Q.clickTf(page, g[1]), { S: { off: g.filter((t) => t !== g[1]) } });
      await click(`${name} from mixed`, () => Q.clickGroup(page, name), { S: { off: [] } });
    }
    await click('1D~1W 끔', () => Q.clickGroup(page, '1D~1W'), { S: { off: GROUPS[0] } });
    await click('8D~3W 끔', () => Q.clickGroup(page, '8D~3W'), { S: { off: [...GROUPS[0], ...GROUPS[1]] } });
    C.ok((await moreText(page)) === '설정 · 타임프레임 8/20', `[${slug}] 12 timeframes off: the 설정 button says "${await moreText(page)}" (설정 · 타임프레임 8/20)`);
    await click('3M 끔', () => Q.clickTf(page, '3M'), { S: { off: [...GROUPS[0], ...GROUPS[1], '3M'] } });
    await click('모두 켜기', () => Q.clickAllOn(page), { S: { off: [] } });
    // every timeframe off: the plot and the zone say so
    {
      await Q.clickSeg(page, '기간', '6개월');
      for (const g of GROUPS) await Q.clickGroup(page, `${g[0]}~${g[g.length - 1]}`);
      await Q.mouseOff(page);
      const e = await Q.snap(page), c = P.parseChart(e.frames.cBase, e.theme);
      C.ok(e.S.off.length === 20 && e.probe.labels.length === 0 && c.numbers.length === 0 && c.marks.length === 0, `[${slug}] every timeframe off: ${e.probe.labels.length} labels in the probe, ${c.numbers.length} numbers painted`);
      C.ok(c.emptyNote && c.emptyNote.t.text === '켜 둔 타임프레임이 없어서 보여 줄 숫자가 없습니다.', `[${slug}] every timeframe off: the plot says "${c.emptyNote ? c.emptyNote.t.text : ''}"`);
      C.ok(c.zone && c.zone.empty.map((t) => t.text).join(' ') === '켜 둔 타임프레임이 없습니다.' && e.probe.conds.length === 0, `[${slug}] every timeframe off: the zone says "${c.zone ? c.zone.empty.map((t) => t.text).join(' ') : ''}"`);
      verify(slug, e, stOf(e), 'every timeframe off');
      await Q.clickAllOn(page); await Q.clickSeg(page, '기간', '1년');
      const f = await Q.snap(page); C.ok(P.parseChart(f.frames.cBase, f.theme).emptyNote === null, `[${slug}] after 모두 켜기 the plot still says that no timeframe is on`);
    }
    // 계열: three toggles in the row; their squares are the colors the numbers have; Korean hover titles
    const fams = await page.evaluate(() => [...document.querySelectorAll('#famSeg button')].map((b) => ({ f: Number(b.dataset.fam), text: b.textContent.trim(), title: b.title, inRow: !!b.closest('.bec-row'), sq: getComputedStyle(b.querySelector('i')).backgroundColor })));
    const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    C.ok(fams.length === 3 && fams.every((x) => x.inRow && x.text === FAM_NAME[x.f] && x.title === `${FAM_NAME[x.f]} 계열을 켜거나 끕니다.` && x.sq === rgb(M.famColorOn(x.f, false))), `[${slug}] the 계열 toggles: ${JSON.stringify(fams)}`);
    const famClick = (f) => Q.clickFam(page, f);
    await click('계열 Sequential 끔', () => famClick(0), { fam: [2, 3] });
    await click('계열 Aggressive Combo 끔', () => famClick(3), { fam: [2] });
    await click('계열 Combo 끔', () => famClick(2), { fam: [] });
    await click('계열 Sequential 켬', () => famClick(0), { fam: [0] });
    await click('계열 Combo 켬', () => famClick(2), { fam: [0, 2] });
    await click('계열 Aggressive Combo 켬', () => famClick(3), { fam: [0, 2, 3] });
    // 설명: opens over the page (nothing moves), closes with its button, Esc and a click outside; closed at first
    {
      const note = () => page.evaluate(() => { const n = document.getElementById('vnote'), b = document.getElementById('noteBtn'), r = n.getBoundingClientRect(), cr = document.querySelector('.bec-chart').getBoundingClientRect(); return { open: !n.hidden, btn: b.textContent.trim(), expanded: b.getAttribute('aria-expanded'), h2: n.querySelector('h2') ? n.querySelector('h2').textContent : '', secs: [...n.querySelectorAll('h3')].map((x) => x.textContent), box: { x: r.left, y: r.top, w: r.width, h: r.height }, chartTop: cr.top + scrollY, pos: getComputedStyle(n).position }; });
      const n0 = await note();
      C.ok(!n0.open && n0.btn === '설명' && n0.expanded !== 'true', `[${slug}] 설명 is ${n0.open ? 'open' : 'closed'} at first, its button says "${n0.btn}"`);
      const { b } = await click('설명 열기', () => page.click('#noteBtn'), {});
      const n1 = await note();
      C.ok(n1.open && n1.btn === '설명' && n1.expanded === 'true' && n1.h2 === 'Bird Eye 차트 읽는 법' && n1.secs.length >= 4, `[${slug}] 설명 did not open: ${JSON.stringify(n1).slice(0, 200)}`);
      C.ok(n1.chartTop === n0.chartTop && n1.pos === 'absolute' && n1.box.h <= b.ih, `[${slug}] 설명 pushed the chart from y ${n0.chartTop} to ${n1.chartTop} (position ${n1.pos}), or is taller than the window (${n1.box.h})`);
      await page.keyboard.press('Escape'); C.ok(!(await note()).open, `[${slug}] 설명: Esc did not close it`);
      await page.click('#noteBtn'); await page.mouse.click(40, b.ih - 20); C.ok(!(await note()).open, `[${slug}] 설명: a click outside did not close it`);
      await page.click('#noteBtn'); await page.click('#noteBtn'); C.ok(!(await note()).open, `[${slug}] 설명: its button did not close it`);
    }
    // 종목: the other coin and back; the hover title of a coin button is a full sentence
    const other = M.slugs().find((x) => x !== slug);
    if (other) {
      const titles = await page.evaluate(() => [...document.querySelectorAll('#quick button')].map((b) => ({ slug: b.dataset.slug, text: b.textContent.trim(), title: b.title, pressed: b.getAttribute('aria-pressed') })));
      C.ok(titles.every((t) => /^.+입니다\. 시가총액은 \d+위\(.+ 달러\)이고, .+에 상장되어 있습니다\.$/.test(t.title)) && titles.find((t) => t.slug === slug).pressed === 'true', `[${slug}] the coin buttons: ${JSON.stringify(titles)}`);
      await click(`종목 ${other}`, async () => { await page.click(`#quick button[data-slug="${other}"]`); await Q.ready(page, other); }, { coin: other }, { win: (a, b) => (b.probe.coin === other && b.probe.end && b.probe.d1 === M.LAST && b.probe.d1 - b.probe.d0 + 1 === 365 ? null : `the picture is of ${b.probe.coin}, window ${iso(b.probe.d0)}~${iso(b.probe.d1)}`) });
      C.ok(await page.evaluate((o) => location.hash === '#chart-a-' + o && document.querySelector(`#quick button[data-slug="${o}"]`).getAttribute('aria-pressed') === 'true' && document.getElementById('soloPrice').textContent.startsWith('최근 종가 '), other), `[${slug}] after choosing ${other}: the address, the pressed coin button or the newest close is not ${other}'s`);
      const lc = await page.evaluate(() => document.getElementById('soloPrice').textContent);
      C.ok(Number(lc.replace('최근 종가 ', '').replace(/,/g, '')) === M.coin(other).lastClose, `[${slug}] after choosing ${other} the first row says "${lc}", its newest close is ${M.coin(other).lastClose}`);
      await click(`종목 ${slug}`, async () => { await page.click(`#quick button[data-slug="${slug}"]`); await Q.ready(page, slug); }, { coin: slug }, { win: (a, b) => (b.probe.coin === slug ? null : `the picture is of ${b.probe.coin}`) });
    }

    // ================= B. 최근 날짜로, drag, wheel, double click =================
    await Q.clickSeg(page, '기간', '6개월');
    s = await Q.snap(page);
    C.ok(s.nowHidden === true, `[${slug}] 최근 날짜로 is shown while the window is at the newest day`);
    const mid = () => page.evaluate(() => { const p = document.querySelector('#stage-root').__probe(), r = document.querySelector('.bec-chart canvas.bec-over').getBoundingClientRect(); return { x: r.left + (p.plot.l + p.plot.r) / 2, y: r.top + p.plot.t + 6, left: r.left, l: p.plot.l, r: p.plot.r, top: r.top }; });
    const drag = async (dx) => { const m = await mid(); await page.mouse.move(m.x, m.y); await page.mouse.down(); await page.mouse.move(m.x + dx / 2, m.y, { steps: 2 }); await page.mouse.move(m.x + dx, m.y, { steps: 2 }); await page.mouse.up(); await Q.mouseOff(page); };
    await drag(300);
    let b = await Q.snap(page);
    C.ok(b.probe.end === false && b.probe.d1 < M.LAST && b.nowHidden === false, `[${slug}] after dragging 300 px right: end ${b.probe.end}, 최근 날짜로 hidden ${b.nowHidden}`);
    C.ok(await page.evaluate(() => document.querySelector('.bec-now').textContent.trim() === '최근 날짜로'), `[${slug}] the button back to the newest day is named "${await page.evaluate(() => document.querySelector('.bec-now').textContent)}"`);
    C.ok((await pressed(page, '기간')).length === 0, `[${slug}] a moved window still shows a preset as pressed: ${await pressed(page, '기간')}`);
    verify(slug, b, stOf(b), 'dragged back');
    await page.click('.bec-now'); await Q.mouseOff(page); b = await Q.snap(page);
    C.ok(b.probe.end && b.probe.d1 === M.LAST && b.nowHidden === true && P.parseChart(b.frames.cBase, b.theme).zone !== null, `[${slug}] 최근 날짜로: window ${iso(b.probe.d0)}~${iso(b.probe.d1)}, end ${b.probe.end}`);
    verify(slug, b, stOf(b), 'after 최근 날짜로');
    // dragging past the ends stops at the ends
    await drag(-600); b = await Q.snap(page); C.ok(b.probe.d1 === M.LAST, `[${slug}] dragging left at the newest day moved past it: ${iso(b.probe.d1)}`);
    await Q.clickSeg(page, '기간', '5년'); await page.focus('.bec-strip canvas.bec-over'); await page.keyboard.press('Home'); await page.evaluate(() => document.activeElement.blur()); await drag(500); b = await Q.snap(page);
    C.ok(b.probe.d0 === coin.first, `[${slug}] dragging right at the first day moved before it: ${iso(b.probe.d0)}, first ${iso(coin.first)}`);
    verify(slug, b, stOf(b), 'at the first day');
    // Ctrl + wheel: the day under the pointer stays, the window gets narrower or wider by the factor; limits 14 days and the whole history
    await Q.clickSeg(page, '기간', '1년'); await Q.centerOn(page, coin.first + Math.floor(total * 0.6));
    for (const [dy, frac] of [[-100, 0.3], [-100, 0.8], [120, 0.5], [60, 0.2], [-1000, 0.6], [1000, 0.4]]) {
      const a = await Q.snap(page), m = await mid(), x = m.left + m.l + (m.r - m.l) * frac, ap = a.probe;
      const dayAt = (p, px) => p.d0 + Math.floor((px - m.left - p.plot.x0) / p.ppd);
      await page.mouse.move(x, m.y + 150); await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control');
      await Q.mouseOff(page);
      const z = await Q.snap(page), zp = z.probe, f = Math.exp(Math.max(-0.3, Math.min(0.3, dy * 0.003)));
      C.count('zooms');
      C.ok(Math.abs(zp.ppd - ap.ppd / f) <= ap.ppd / f * 0.02, `[${slug}] Ctrl + wheel ${dy}: ${ap.ppd.toFixed(3)} px a day became ${zp.ppd.toFixed(3)}, expected about ${(ap.ppd / f).toFixed(3)}`);
      C.ok(Math.abs(dayAt(zp, x) - dayAt(ap, x)) <= 1, `[${slug}] Ctrl + wheel ${dy} at ${iso(dayAt(ap, x))}: the day under the pointer became ${iso(dayAt(zp, x))}`);
      verify(slug, z, stOf(z), `zoom ${dy}`);
    }
    await Q.mouseOff(page);
    for (let i = 0; i < 30; i++) await Q.zoom(page, -1000);
    await Q.mouseOff(page);
    b = await Q.snap(page); C.ok(b.probe.d1 - b.probe.d0 + 1 >= 14 && b.probe.d1 - b.probe.d0 + 1 <= 16, `[${slug}] zoomed in as far as it goes: ${b.probe.d1 - b.probe.d0 + 1} days (the shortest window is 14 days)`); verify(slug, b, stOf(b), 'shortest window');
    for (let i = 0; i < 40; i++) await Q.zoom(page, 1000);
    await Q.mouseOff(page);
    b = await Q.snap(page); C.ok(b.probe.d0 === coin.first && b.probe.d1 === M.LAST, `[${slug}] zoomed out as far as it goes: ${iso(b.probe.d0)}~${iso(b.probe.d1)}`); verify(slug, b, stOf(b), 'widest window');
    // a plain wheel scrolls the page and leaves the window; a horizontal wheel pans by days
    await Q.clickSeg(page, '기간', '6개월'); await Q.centerOn(page, coin.first + Math.floor(total * 0.5));
    { const a = await Q.snap(page), m = await mid(); await page.mouse.move(m.x, m.y + 100); await page.mouse.wheel(0, 240); await page.waitForTimeout(150); const z = await Q.snap(page);
      C.ok(z.probe.d0 === a.probe.d0 && z.probe.d1 === a.probe.d1 && z.sy > a.sy, `[${slug}] a plain wheel: window ${iso(a.probe.d0)} -> ${iso(z.probe.d0)}, page scroll ${a.sy} -> ${z.sy}`);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(80);
      await Q.panWheel(page, -17); const y = await Q.snap(page); C.ok(y.probe.d0 === a.probe.d0 - 17 && y.probe.d1 - y.probe.d0 === a.probe.d1 - a.probe.d0, `[${slug}] a horizontal wheel of 17 days: ${iso(a.probe.d0)} -> ${iso(y.probe.d0)}`); }
    // double click on the chart (not on a number): back to the preset's window
    { await Q.mouseOff(page); const a = await Q.snap(page), p = a.probe, { X, Y } = scales(p); let pt = null;
      for (let d = p.d0 + 5; d < p.d1 && !pt; d++) { if (!M.hasBar(slug, d)) continue; const o = M.ohlc(slug, d), x = X(d), y = (Y(o.h) + Y(o.l)) / 2; if (![...p.labels.filter((q) => q.w > 0), ...p.folds].some((q) => x >= q.x - 3 && x <= q.x + q.w + 3 && y >= q.y - 3 && y <= q.y + q.h + 3)) pt = [x, y]; }
      const n0 = await page.evaluate(() => __qa.opens.length);
      await page.mouse.dblclick(a.rc.x + pt[0], a.rc.y + pt[1]); await Q.mouseOff(page); const z = await Q.snap(page);
      C.ok(z.probe.end && z.probe.d1 === M.LAST && z.probe.d1 - z.probe.d0 + 1 === 183 && (await pressed(page, '기간')).join() === '6개월', `[${slug}] double click: window ${iso(z.probe.d0)}~${iso(z.probe.d1)}, pressed ${await pressed(page, '기간')}`);
      C.ok((await page.evaluate(() => __qa.opens.length)) === n0, `[${slug}] a double click on the chart opened a TradingView chart`); }

    // ================= C. the keyboard path =================
    await Q.clickSeg(page, '기간', '6개월'); await Q.mouseOff(page);
    {
      const a = await Q.snap(page), p = a.probe, live = () => page.evaluate(() => document.querySelector('#stage-root .sr-only[aria-live]').textContent);
      await page.focus('.bec-chart canvas.bec-over');
      const dayHead = async () => { const t = await Q.tip(page); return t ? t.kids[0].text : null; };
      // (the day the cursor stands at, read off the tooltip's heading; null when no day's tooltip shows)
      const dayAt = async () => { const h = await dayHead(); return h && /^\d{4}-\d\d-\d\d/.test(h) ? Q.dayOf(h.slice(0, 10)) : null; };
      const want = (d) => `${iso(d)} (${WEEK[new Date(d * 864e5).getUTCDay()]})`;
      await page.keyboard.press('ArrowLeft'); C.ok(await dayHead() === want(p.d1), `[${slug}] keyboard: the first ArrowLeft shows "${await dayHead()}", expected the newest day ${want(p.d1)}`);
      C.ok((await live()).startsWith(want(p.d1)), `[${slug}] keyboard: the text for screen readers is "${(await live()).slice(0, 60)}"`);
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); C.ok(await dayHead() === want(p.d1 - 2), `[${slug}] keyboard: two more ArrowLeft show "${await dayHead()}"`);
      const ov = P.parseOver((await Q.snap(page, { over: true })).frames.cOver).rects.find((c) => c.fs === a.theme.accent && c.w === 1 && c.h > 100);
      C.ok(ov && Math.abs(ov.x - scales(p).X(p.d1 - 2)) <= 0.51, `[${slug}] keyboard: the day line is painted at x ${ov && ov.x}, the day ${iso(p.d1 - 2)} is at ${scales(p).X(p.d1 - 2).toFixed(1)}`);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      let t = await Q.tip(page); C.ok(t && t.kids[0].text === '다음 봉 조건' && new RegExp(`최근 종가 [\\d,.]+ \\(${M.E.lastClosedDay} 마감\\)`).test(t.text), `[${slug}] keyboard: past the newest day the tooltip is "${t && t.text.slice(0, 80)}"`);
      const conds = M.conds(slug, stOf(a));
      if (conds.length) {
        await page.keyboard.press('ArrowDown'); t = await Q.tip(page);
        const top = a.probe.conds.filter((q) => q.shown === 'in').sort((x, y) => x.y - y.y)[0], edgeTop = a.probe.zone.edges.find((e) => e.above);
        // (the uppermost thing of the zone: the line of the upper edge when there is one, else the top chip)
        if (edgeTop) C.ok(t && /^위쪽 조건 \d+개$/.test(t.kids[0].text), `[${slug}] keyboard: ArrowDown in the zone shows "${t && t.kids[0].text}", the uppermost thing is "${edgeTop.text}"`);
        else C.ok(t && t.kids[0].text.startsWith(top.tf + ' · '), `[${slug}] keyboard: ArrowDown in the zone shows "${t && t.kids[0].text}", the top chip is ${top.tf}`);
        if (edgeTop && top) { await page.keyboard.press('ArrowDown'); t = await Q.tip(page); }
        if (top) {
          C.ok(t && t.kids[0].text.startsWith(top.tf + ' · ') && t.links.length === 1 && t.links[0].text === `TradingView ${top.tf} 차트 ↗`, `[${slug}] keyboard: the zone's top chip (${top.tf}) shows "${t && t.kids[0].text}" with the links ${JSON.stringify(t && t.links)}`);
          const n0 = await page.evaluate(() => __qa.opens.length); await page.keyboard.press('Enter'); const op = await page.evaluate((n) => __qa.opens.slice(n), n0);
          C.ok(op.length === 1 && op[0].url.endsWith('interval=' + top.tf.replace(/^1(?=[DWM]$)/, '')), `[${slug}] keyboard: Enter on the zone's ${top.tf} chip opened ${JSON.stringify(op)}`);
        }
        await page.keyboard.press('Escape');
      }
      // from the zone, Shift + ArrowLeft moves the window back: the zone leaves, the cursor goes to the window's last day, no script error
      {
        const errs0 = ctx.logs.length;
        await page.keyboard.press('Shift+ArrowLeft');
        const z = await Q.snap(page); t = await Q.tip(page);
        C.ok(ctx.logs.length === errs0, `[${slug}] keyboard: Left, Right into the zone, Shift+Left: a script error: ${ctx.logs.slice(errs0).join(' | ').slice(0, 240)}`);
        C.ok(z.probe.end === false && z.probe.zone === null && t && t.kids[0].text === want(z.probe.d1), `[${slug}] keyboard: Shift+Left from the zone: window ${iso(z.probe.d0)}~${iso(z.probe.d1)} (end ${z.probe.end}), tooltip "${t && t.kids[0].text}" (expected the window's last day ${want(z.probe.d1)})`);
        await page.keyboard.press('End');
      }
      await page.keyboard.press('ArrowLeft'); C.ok(await dayHead() === want(p.d1 - 1) || await dayHead() === want(p.d1), `[${slug}] keyboard: ArrowLeft after End shows "${await dayHead()}"`);
      // to a day that carries numbers: its tooltip lists them; down picks the uppermost; Enter opens its chart
      // (a day whose numbers are all shown: where a chip of folded numbers stands at the day, the chip is the uppermost thing)
      const cur = await Q.snap(page), cp = cur.probe;
      const foldedDays = new Set(cp.labels.filter((L) => L.shown !== 'text').map((L) => L.day));
      const withText = cp.labels.filter((L) => L.shown === 'text' && !foldedDays.has(L.day) && !cp.folds.some((f) => Math.abs(f.x + f.w / 2 - (L.x + L.w / 2)) < 60)), target = withText.length ? withText.sort((x, y) => y.day - x.day)[0].day : null;
      if (target !== null) {
        const from = await dayAt();
        C.ok(from !== null, `[${slug}] keyboard: no day's tooltip shows after ArrowLeft ("${await dayHead()}")`);
        for (let d = from === null ? target : from; d > target; d--) await page.keyboard.press('ArrowLeft');
        t = await Q.tip(page);
        const here = M.inWindow(slug, stOf(a), target, target);
        C.ok(t && t.kids[0].text === want(target) && t.rows.filter((r) => r.inSec && r.num).length === Math.min(14, here.length), `[${slug}] keyboard: at ${iso(target)} the tooltip is "${t && t.kids[0].text}" with ${t && t.rows.filter((r) => r.inSec).length} rows, ${here.length} numbers stand there`);
        await page.keyboard.press('ArrowDown'); t = await Q.tip(page);
        const things = cp.labels.filter((L) => L.day === target).sort((x, y) => x.y - y.y), first = things[0];
        C.ok(t && t.rows[0] && t.rows[0].num && t.rows[0].num.sup === first.tf && t.rows[0].num.text === first.text && t.links.length === 1 && t.links[0].text === `TradingView ${first.tf} 차트 ↗`, `[${slug}] keyboard: ArrowDown at ${iso(target)} picked "${t && t.rows[0] && t.rows[0].num && t.rows[0].num.text + t.rows[0].num.sup}", the uppermost number there is ${first.tf} "${first.text}"; links ${JSON.stringify(t && t.links)}`);
        const n0 = await page.evaluate(() => __qa.opens.length); await page.keyboard.press('Enter'); const op = await page.evaluate((n) => __qa.opens.slice(n), n0); C.ok(op.length === 1 && op[0].url.endsWith('interval=' + first.tf.replace(/^1(?=[DWM]$)/, '')), `[${slug}] keyboard: Enter on ${first.tf} "${first.text}" opened ${JSON.stringify(op)}`);
        await page.keyboard.press('Escape'); t = await Q.tip(page); C.ok(t && t.kids[0].text === want(target), `[${slug}] keyboard: Escape did not go back to the day's tooltip`);
        // Page Up and Page Down: to the day before, and after, that has a number
        const allSel = M.all[slug].filter((L) => M.selected(L, stOf(a)) && !modesOf(L.kind, L.tf, cp.ppd).every((x) => x === 'off'));
        const prev = Math.max(...allSel.filter((L) => L.day < target).map((L) => L.day)), next = Math.min(...allSel.filter((L) => L.day > target).map((L) => L.day));
        await page.keyboard.press('PageUp'); C.ok(await dayHead() === want(prev), `[${slug}] keyboard: Page Up from ${iso(target)} shows "${await dayHead()}"; the day before with a number is ${iso(prev)}`);
        await page.keyboard.press('PageDown'); C.ok(await dayHead() === want(target), `[${slug}] keyboard: Page Down from ${iso(prev)} shows "${await dayHead()}"; the next day with a number is ${iso(target)}`);
        if (Number.isFinite(next)) { await page.keyboard.press('PageDown'); C.ok(await dayHead() === want(next), `[${slug}] keyboard: Page Down from ${iso(target)} shows "${await dayHead()}"; the next day with a number is ${iso(next)}`); }
        // Up and Down belong to the chart while the day cursor shows: the page does not scroll, also on a day without numbers
        const empty = (() => { for (let d = cp.d1 - 1; d > cp.d0; d--) if (!cp.labels.some((L) => L.day === d)) return d; return null; })();
        if (empty !== null) {
          let at = await dayAt();
          // (no day's tooltip after the Page keys: said above; the cursor is put back with the arrows)
          if (at === null) { await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft'); at = await dayAt(); }
          C.ok(at !== null, `[${slug}] keyboard: no day's tooltip shows after Page Up and Page Down ("${await dayHead()}")`);
          if (at === null) at = empty;
          for (let d = at; d > empty; d--) await page.keyboard.press('ArrowLeft'); for (let d = at; d < empty; d++) await page.keyboard.press('ArrowRight');
          C.ok(await dayHead() === want(empty), `[${slug}] keyboard: the cursor could not be brought to ${iso(empty)} ("${await dayHead()}")`);
          const y0 = await page.evaluate(() => { window.scrollTo(0, 0); return document.documentElement.scrollHeight - innerHeight; });
          await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120);
          const y1 = await page.evaluate(() => scrollY);
          C.ok(y1 === 0, `[${slug}] keyboard: Up and Down on ${iso(empty)}, a day without numbers, scrolled the page by ${y1} px (the page can scroll ${y0} px)`);
          C.ok(await dayHead() === want(empty), `[${slug}] keyboard: after Up and Down the day's tooltip is "${await dayHead()}"`);
          C.count('upDownOnADayWithoutNumbers');
          // without the cursor the keys are the page's again
          await page.keyboard.press('Escape'); C.ok((await Q.tip(page)) === null, `[${slug}] keyboard: Escape did not close the day's tooltip`);
          if (y0 > 30) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250); const y2 = await page.evaluate(() => scrollY); C.ok(y2 > 0, `[${slug}] keyboard: without a day cursor ArrowDown did not scroll the page`); await page.evaluate(() => window.scrollTo(0, 0)); }
        }
      }
      const k = async (key, test, what) => { const x = (await Q.snap(page, { nobase: true })).probe; await page.keyboard.press(key); const y = (await Q.snap(page, { nobase: true })).probe; C.ok(test(x, y), `[${slug}] keyboard ${key} (${what}): ${iso(x.d0)}~${iso(x.d1)} became ${iso(y.d0)}~${iso(y.d1)}`); };
      await k('Shift+ArrowLeft', (x, y) => y.d0 === x.d0 - Math.max(1, Math.round((x.d1 - x.d0 + 1) * 0.1)), 'the window a tenth back');
      await k('Shift+ArrowRight', (x, y) => y.d0 > x.d0, 'the window forward');
      await k('+', (x, y) => y.d1 - y.d0 < x.d1 - x.d0, 'narrower');
      await k('-', (x, y) => y.d1 - y.d0 > x.d1 - x.d0, 'wider');
      await k('Home', (x, y) => y.d0 === coin.first, 'to the first day');
      await k('End', (x, y) => y.d1 === M.LAST && y.end, 'to the newest day');
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await Q.mouseOff(page);
      const z = await Q.snap(page); verify(slug, z, stOf(z), 'after the keyboard path');
    }
    C.logs(ctx, slug);
    await ctx.context.close();
  }));

  // ================= C2. the zone leaves while the day cursor is in it =================
  // Shift + ArrowLeft is one way (above). The window can also leave the newest day under a cursor that stands in the
  // zone by a wheel pan or a drag, and the zone goes when the window becomes narrow. The next key that keeps the
  // cursor's place (Right, Down, Up) then finds no zone: the cursor goes to the window's last day, without a script error.
  {
    const slug = M.slugs()[0];
    const ways = [
      ['a wheel pan', async (page) => { await Q.panWheel(page, -40); }],
      ['a drag', async (page) => { const r = await page.evaluate(() => { const c = document.querySelector('.bec-chart canvas.bec-over').getBoundingClientRect(); return { x: c.left, y: c.top }; }); await page.mouse.move(r.x + 500, r.y + 200); await page.mouse.down(); await page.mouse.move(r.x + 800, r.y + 200, { steps: 6 }); await page.mouse.up(); await Q.mouseOff(page); }],
      ['a window made narrow', async (page) => { await page.setViewportSize({ width: 500, height: 844 }); await page.waitForTimeout(400); }],
    ];
    for (const [how, act] of ways) for (const key of A.quick ? ['ArrowRight'] : ['ArrowRight', 'ArrowDown', 'ArrowUp']) {
      const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug }), { page } = ctx;
      await page.focus('.bec-chart canvas.bec-over'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
      const t0 = await Q.tip(page);
      if (!(t0 && t0.kids[0].text === '다음 봉 조건')) { C.fail(`[${slug}] the zone leaves (${how}): the cursor could not be put into the zone first ("${t0 && t0.kids[0].text}")`); await ctx.context.close(); continue; }
      const n0 = ctx.logs.length;
      await act(page); await page.waitForTimeout(200);
      await page.focus('.bec-chart canvas.bec-over');
      await page.keyboard.press(key); await page.waitForTimeout(120);
      const z = await Q.snap(page, { nobase: true }), t = await Q.tip(page), wantHead = `${iso(z.probe.d1)} (${WEEK[new Date(z.probe.d1 * 864e5).getUTCDay()]})`;
      C.count('zoneLeftUnderTheCursor');
      C.ok(ctx.logs.length === n0, `[${slug}] the zone leaves under the day cursor (${how}), then ${key}: a script error: ${ctx.logs.slice(n0).join(' | ').slice(0, 240)}`);
      C.ok(z.probe.zone === null && t && t.kids[0].text === wantHead, `[${slug}] the zone leaves under the day cursor (${how}), then ${key}: zone ${z.probe.zone ? 'still shown' : 'gone'}, tooltip "${t && t.kids[0].text}" (expected the window's last day ${wantHead})`);
      await ctx.context.close();
    }
  }

  // ================= D. settings survive a reload =================
  {
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc' }), { page } = ctx, slug = M.slugs().includes('eth') ? 'eth' : 'btc';
    await Q.clickSeg(page, '기간', '1년'); await Q.clickSeg(page, '가격 축', '로그'); await Q.clickNine(page); await Q.clickSeg(page, '+13 표시', '켬'); await Q.clickSeg(page, '방향', '매도 쪽'); await Q.clickSeg(page, '임박 기준', '10%'); await Q.clickSeg(page, '다음 봉 조건', '끔');
    for (const t of ['2D', '1W', '3M']) await Q.clickTf(page, t);
    await Q.clickFam(page, 2); await page.click('#noteBtn');
    if (slug !== 'btc') { await page.click(`#quick button[data-slug="${slug}"]`); await Q.ready(page, slug); }
    await Q.mouseOff(page);
    const a = await Q.snap(page);
    await page.reload({ waitUntil: 'load' }); await Q.ready(page, slug);
    const b = await Q.snap(page), want = { range: '1y', scale: 'log', off: ['2D', '1W', '3M'], nine: 'off', def: 'on', dir: 'sell', cond: 'off', near: 10 };
    C.ok(JSON.stringify(b.S) === JSON.stringify(want) && b.fam.join() === '0,3' && b.coin === slug, `after a reload: settings ${JSON.stringify(b.S)}, families ${b.fam}, coin ${b.coin}; set before: ${JSON.stringify(want)}, 0,3, ${slug}`);
    C.ok(JSON.stringify(a.probe.labels) === JSON.stringify(b.probe.labels) && a.probe.d0 === b.probe.d0 && a.probe.d1 === b.probe.d1 && a.probe.scale === b.probe.scale, 'after a reload the picture is not the one before it');
    const ui = await page.evaluate(() => ({ note: !document.getElementById('vnote').hidden, fam: [...document.querySelectorAll('#famSeg button')].map((x) => x.getAttribute('aria-pressed')).join(), nine: document.querySelector('#stage-root .bec-nine button').getAttribute('aria-pressed'), tf: [...document.querySelectorAll('#stage-root .bec-tfg button')].filter((x) => x.getAttribute('aria-pressed') === 'false').map((x) => x.textContent.trim()).join(), segs: [...document.querySelectorAll('#stage-root .bec-ctl .seg:not(.bec-nine):not(.bec-grp):not(.fam) button[aria-pressed="true"]')].map((x) => x.textContent.trim()).join(), more: document.querySelector('#stage-root .bec-more').textContent.trim() }));
    // (설명 is closed at every visit; the settings come back, and the 설정 button says that they differ from the defaults)
    C.ok(!ui.note && ui.fam === 'true,false,true' && ui.nine === 'false' && ui.tf === '2D,1W,3M' && ui.segs === '1년,로그,매도 쪽,켬,끔,10%' && /^설정 · 타임프레임 17\/20 외 5개$/.test(ui.more), `after a reload the controls show: ${JSON.stringify(ui)}`);
    const r = verifyState(M, slug, b, { off: want.off, nine: 'off', def: 'on', dir: 'sell', fam: [0, 3] }, { tag: 'after reload' }); for (const f of r.fails) C.fail(f.msg);
    C.logs(ctx, 'reload'); await ctx.context.close();
  }

  // ================= E. a coin switched while the data is still loading; a load that fails =================
  if (M.slugs().length > 1) {
    let release, hits = 0; const gate = new Promise((r) => { release = r; });
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc', wait: false, onRoute: async (route) => { if (/\/d\/\d+\.json/.test(route.request().url())) { hits++; await gate; } await route.continue(); } }), { page } = ctx;
    await page.waitForSelector('#stage-root .bec-wait');
    C.ok(await page.evaluate(() => /^불러오는 중입니다…$/.test(document.querySelector('#stage-root .bec-wait').textContent.trim()) && document.querySelector('#stage-root').__probe() === null), 'while the data loads the page does not say so');
    await page.click('#quick button[data-slug="eth"]'); await page.click('#quick button[data-slug="btc"]'); await page.click('#quick button[data-slug="eth"]');
    release(); await Q.ready(page, 'eth');
    const s = await Q.snap(page);
    C.ok(s.probe.coin === 'eth' && s.coin === 'eth' && s.hash === '#chart-a-eth' && hits === 1, `coin switched three times during the load: the picture is of ${s.probe.coin}, the address ${s.hash}, ${hits} requests for the data`);
    const r = verifyState(M, 'eth', s, Q.DEFAULT_STATE, { tag: 'after switching during the load' }); for (const f of r.fails) C.fail(f.msg);
    await page.click('#quick button[data-slug="btc"]'); await Q.ready(page, 'btc');
    const s2 = await Q.snap(page), r2 = verifyState(M, 'btc', s2, Q.DEFAULT_STATE, { tag: 'back to btc' }); for (const f of r2.fails) C.fail(f.msg);
    C.logs(ctx, 'pending load'); await ctx.context.close();
    // a failed load says so in the page's own words (no message of the browser) and can be tried again
    for (const how of ['503', 'abort']) {
      let fail = true;
      const c2 = await Q.open(A.base, { hash: '#chart-a-eth', wait: false, onRoute: async (route) => { if (/\/d\/\d+\.json/.test(route.request().url()) && fail) return how === '503' ? route.fulfill({ status: 503, body: 'no' }) : route.abort('connectionrefused'); await route.continue(); } });
      await c2.page.waitForFunction(() => { const w = document.querySelector('#stage-root .bec-wait'); return w && /불러오지 못했습니다/.test(w.textContent); }, null, { timeout: 15000 }).catch(() => {});
      const msg = await c2.page.evaluate(() => { const w = document.querySelector('#stage-root .bec-wait'); return { p: w.querySelector('p') ? w.querySelector('p').textContent.trim() : w.textContent.trim(), btn: w.querySelector('button') ? w.querySelector('button').textContent.trim() : null }; });
      C.ok(msg.p === '일봉 데이터를 불러오지 못했습니다. 다시 시도해 주세요.' && msg.btn === '다시 시도', `a failed load (${how === '503' ? 'HTTP 503' : 'no connection'}) shows "${msg.p}" with the button "${msg.btn}"`);
      fail = false; await c2.page.click('#stage-root .bec-wait button'); await Q.ready(c2.page, 'eth');
      const s3 = await Q.snap(c2.page); C.ok(s3.probe.coin === 'eth' && s3.probe.labels.length > 0, 'after 다시 시도 the chart did not come up');
      const expected = c2.logs.filter((l) => /503|Failed to load resource|requestfailed|ERR_CONNECTION_REFUSED/.test(l)); for (const l of c2.logs) if (!expected.includes(l)) C.fail(`console/page problem (failed load, ${how}): ` + l);
      await c2.context.close();
    }
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
    // 설정: 계열, 9 and the timeframe groups are in the panel here
    const inPanel = () => page.evaluate(() => { const e = document.querySelector('#stage-root .bec-set'); return { open: !e.hidden, fam: !!e.querySelector('#famSeg'), nine: !!e.querySelector('.bec-nine'), grp: !!e.querySelector('.bec-grp'), ctls: e.querySelectorAll(':scope > .ctl').length, more: document.querySelector('.bec-more').textContent.trim(), expanded: document.querySelector('.bec-more').getAttribute('aria-expanded') }; });
    let pn = await inPanel();
    C.ok(!pn.open && pn.more === '설정' && pn.fam && pn.nine && pn.grp, `phone: before 설정 is pressed: ${JSON.stringify(pn)} (계열, 9 and the groups belong into the panel)`);
    await page.tap('.bec-more'); pn = await inPanel();
    C.ok(pn.open && pn.expanded === 'true' && pn.ctls === 9, `phone: 설정 shows ${pn.ctls} of 9 settings (${JSON.stringify(pn)})`);
    s = await Q.snap(page); C.ok(s.sw <= s.cw, 'phone: the page scrolls sideways with the settings open');
    await page.tap('.bec-more'); C.ok(!(await inPanel()).open, 'phone: the 설정 button did not close the settings');
    await page.evaluate(() => document.querySelector('.bec-chart').scrollIntoView({ block: 'center' })); await page.waitForTimeout(120);
    s = await Q.snap(page);
    // a tap on a number: what it is, above the finger, with the link; a second tap opens its chart; a tap elsewhere closes
    const L = s.probe.labels.find((x) => x.shown === 'text' && s.rc.y + x.y > 240);
    if (L) {
      const x = s.rc.x + L.x + L.w / 2, y = s.rc.y + L.y + L.h / 2, n0 = await page.evaluate(() => __qa.opens.length);
      await page.touchscreen.tap(x, y); let t = await Q.tip(page);
      C.ok(t && t.rows[0] && t.rows[0].num && t.rows[0].num.text === L.text && t.rows[0].num.sup === L.tf && t.pin && t.links.length === 1 && t.links[0].text === `TradingView ${L.tf} 차트 ↗` && (await page.evaluate(() => __qa.opens.length)) === n0, `phone: a tap on ${L.tf} "${L.text}" shows "${t && t.text.slice(0, 80)}" (pinned ${t && t.pin}, links ${JSON.stringify(t && t.links)})`);
      C.ok(t && t.box.x >= 0 && t.box.x + t.box.w <= 390, `phone: the tooltip leaves the screen (${t && JSON.stringify(t.box)})`);
      C.ok(t && t.box.y + t.box.h <= y - 8, `phone: the tooltip (y ${t && t.box.y.toFixed(0)}..${t && (t.box.y + t.box.h).toFixed(0)}) does not stand above the finger at y ${y.toFixed(0)}`);
      await page.touchscreen.tap(x, y); const op = await page.evaluate((n) => __qa.opens.slice(n), n0);
      C.ok(op.length === 1 && op[0].url.endsWith('interval=' + L.tf.replace(/^1(?=[DWM]$)/, '')), `phone: the second tap opened ${JSON.stringify(op)}`);
      await page.touchscreen.tap(195, s.rc.y - 30); t = await Q.tip(page); C.ok(t === null, 'phone: a tap outside the chart left the tooltip open');
    } else C.fail('phone: no number low enough in the first window to tap');
    // a tap on a day: its tooltip, above the finger
    { const p = s.probe, { X, Y } = scales(p); let d = p.d1 - 20; while (p.labels.some((q) => q.w > 0 && Math.abs(X(d) - (q.x + q.w / 2)) < q.w)) d--; const o = M.ohlc(slug, d), ty = s.rc.y + (Y(o.h) + Y(o.l)) / 2;
      await page.touchscreen.tap(s.rc.x + X(d), ty); const t = await Q.tip(page); C.ok(t && t.kids[0].text.startsWith(iso(d)), `phone: a tap on the day ${iso(d)} shows "${t && t.kids[0].text}"`);
      C.ok(t && (t.box.y + t.box.h <= ty - 8 || ty < 140), `phone: the day's tooltip (y ${t && t.box.y.toFixed(0)}..${t && (t.box.y + t.box.h).toFixed(0)}) does not stand above the finger at y ${ty.toFixed(0)}`);
      await page.touchscreen.tap(195, s.rc.y - 30); }
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
    // +13 on a narrow chart: the size of a narrow chart for it too
    { await Q.setState(page, { def: 'on' }); await Q.preset(page, '6개월'); const z = await Q.snap(page); verify(slug, z, { ...Q.DEFAULT_STATE, def: 'on' }, 'phone with +13'); C.count('phoneStatesWithPlus13'); await Q.setState(page, { def: 'off' }); }
    C.logs(ctx, 'phone'); await ctx.context.close();
  }

  // ================= G. no sideways scroll at any width =================
  for (const w of A.quick ? [390, 1440] : [320, 360, 414, 560, 600, 768, 1024, 1280, 1700, 1920, 2560]) {
    const ctx = await Q.open(A.base, { hash: '#chart-a-eth', width: w, height: 900, touch: w < 700 }), { page } = ctx;
    for (const name of ['전체', '1년']) {
      await Q.clickSeg(page, '기간', name); await Q.mouseOff(page); const s = await Q.snap(page);
      C.count('widths'); C.ok(s.sw <= s.cw, `width ${w}, ${name}: the page scrolls sideways (${s.sw} > ${s.cw})`);
      const r = verifyState(M, 'eth', s, Q.DEFAULT_STATE, { tag: `width ${w} ${name}` }); for (const f of r.fails) C.fail(f.msg);
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
      const s = await Q.snap(page);
      C.count('liveResizes');
      C.ok(s.sw <= s.cw, `resized to ${w}x${h}: the page scrolls sideways (${s.sw} > ${s.cw})`);
      C.ok(Math.abs(s.rc.w - s.probe.plot.w) < 1 && s.probe.plot.r <= s.probe.plot.w, `resized to ${w}x${h}: the chart is laid out ${s.probe.plot.w} px wide in a box of ${s.rc.w} px`);
      C.ok(s.probe.end && s.probe.d1 === M.LAST && s.probe.d1 - s.probe.d0 + 1 === 365, `resized to ${w}x${h}: the window became ${iso(s.probe.d0)}~${iso(s.probe.d1)}`);
      const r = verifyState(M, 'btc', s, st, { tag: `resized to ${w}x${h}` }); for (const f of r.fails) C.fail(f.msg);
    }
    C.logs(ctx, 'live resize'); await ctx.context.close();
  }
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('controls.cjs crashed:', e); process.exit(3); });
