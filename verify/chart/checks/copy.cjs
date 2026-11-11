// Check 14: the page's Korean copy and its text budget, mechanically. Every text the reader can meet (the page, both
// canvases, the tooltips of numbers, days, chips, conditions and strip ticks, the list of a chip, the 설정 panel, 설명,
// the conditions of a narrow screen, hover titles and labels for screen readers, the loading and error texts) is
// collected over several states and held against the page's rules:
//   no em dash and no en dash; hints, captions and explanations are complete sentences that end with a sentence
//   ending (…다.); hover titles are full sentences with a full stop; Latin words only where the chart itself has them
//   (tickers, timeframes, label texts, family names, product and key names); "Bird Eye" with a capital E.
// And the budget: the two captions say exactly what they are to say (one line each on a wide screen); under the
// chart ONE legend line of at most six items, each only while the picture shows what it explains, no family item,
// and one line about the data only where it applies, together at most 64 px high on a wide screen; no sentence
// stands twice on the page; "시안" stands once, in the sentence at the foot; the CoinGecko credit is there.
//   node copy.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model, iso } = require('../lib/model.cjs'), { verifyState } = require('../lib/verify.cjs');
const A = Q.args();
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c14_copy');
  const texts = new Map();   // text -> where it was seen, and whether it is running text (sentences)
  const add = (t, where, prose) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); if (!s) return; const was = texts.get(s); if (!was) texts.set(s, { where, prose: !!prose }); else if (prose) was.prose = true; };
  const DOM = `(() => { const out = [], vis = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const prose = 'p.hint, p.bec-cap, p.lead, #vnote p, .bec-sent, .bec-wait p, .bec-wait span';
    for (const e of document.querySelectorAll(prose)) if (vis(e)) out.push([e.textContent, e.matches('p.bec-cap') ? 'caption' : 'prose', true, e.querySelector && e.querySelector(':scope > b') ? e.querySelector(':scope > b').textContent : '']);
    for (const e of document.querySelectorAll('button, a, label, h1, h2, h3, .ctl > span, .legend > span, .bec-win, .foot span, .brand, .solo-info > *, .bec-meta span, .bec-fire, .bec-near, .bec-met, .bec-dist, .bec-list h3, .bec-rows a')) if (vis(e)) out.push([e.textContent, 'label', false, '']);
    for (const e of document.querySelectorAll('[title], [aria-label], [placeholder]')) for (const a of ['title', 'aria-label', 'placeholder']) if (e.getAttribute(a)) out.push([e.getAttribute(a), a, false, '']);
    const live = document.querySelector('#stage-root .sr-only[aria-live]'); if (live && live.textContent) out.push([live.textContent, 'screen reader text', false, '']);
    for (const sel of ['.bec-chart canvas:not(.bec-over)', '.bec-strip canvas:not(.bec-over)', '.bec-strip canvas.bec-over', '.bec-chart canvas.bec-over']) { const cv = document.querySelector(sel); if (cv) for (const c of __qa.frame(cv).calls) if (c.op === 'ft') out.push([c.text, 'canvas', false, '']); }
    return out; })()`;
  const titles = new Map();
  const grabDom = async (page, tag) => { for (const [t, kind, prose, lead] of await page.evaluate(DOM)) { const text = lead && t.startsWith(lead) ? t.slice(lead.length) : t; add(text, `${tag} (${kind})`, prose); if (kind === 'title') titles.set(String(t).trim(), tag); } };
  const grabTip = async (page, tag) => { const t = await Q.tip(page); if (!t) return null; for (const k of t.kids) { if (k.cls === 'h1') add(k.text, `${tag} tooltip heading`, false); else if (/^(m|bec-tip-foot)$/.test(k.cls)) add(k.text, `${tag} tooltip`, false); else if (k.tag === 'A') add(k.text, `${tag} tooltip link`, false); } for (const n of t.notes) add(n, `${tag} tooltip`, false); for (const r of t.rows) add(r.rest || r.text, `${tag} tooltip line`, /니다\.$/.test(r.rest)); return t; };
  // ---- the page as a whole, in one state: what is on it, and how much ----
  const PAGE = `(() => { const q = (s) => document.querySelector(s), box = (e) => { if (!e || e.hidden || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height }; };
    const foot = q('#stage-root .bec-foot'), lg = foot ? foot.querySelector('.legend') : null;
    return { inner: document.body.innerText, iw: innerWidth, capStrip: q('.bec-pic > p.bec-cap') ? q('.bec-pic > p.bec-cap').textContent : null, capStripBox: box(q('.bec-pic > p.bec-cap')), capChart: q('.bec-caprow p.bec-cap') ? q('.bec-caprow p.bec-cap').textContent : null, capChartBox: box(q('.bec-caprow p.bec-cap')),
      foot: box(foot), legend: lg && box(lg) ? [...lg.children].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()) : [], legendBox: box(lg), notes: foot && box(foot) ? [...foot.querySelectorAll('p.hint')].map((e) => e.textContent.trim()) : [],
      lead: q('#lead') ? q('#lead').textContent.trim() : '', credit: [...document.querySelectorAll('.foot a')].map((a) => ({ text: a.textContent.trim(), href: a.href })), title: document.title, brand: q('.brand') ? q('.brand').textContent.trim() : '' }; })()`;
  const LEGEND = { '반복 9': 'rep', '13이 미뤄진 봉': 'def', '자리가 모자라 접힌 숫자': 'chip', '숫자 대신 놓은 표시 (색은 13, 회색은 9)': 'mark', 'TradingView 차트에서 지워진 라벨': 'gone', '숫자와 그 날의 봉을 잇는 선': 'lead' };
  const sentencesOf = (inner) => inner.split('\n').flatMap((line) => line.trim().split(/(?<=[.…])\s+(?=[^\d])/)).map((x) => x.trim()).filter((x) => /(다|요)[.]$/.test(x) && x.length > 8);
  const pageRules = async (page, slug, tag, st, narrow) => {
    await Q.mouseOff(page);
    const s = await Q.snap(page), pg = await page.evaluate(PAGE), coin = M.coin(slug), where = `[${tag}]`;
    C.count('pageStates');
    // the captions
    const wantStrip = narrow ? '전체 기간계열 색 눈금은 13이고, 파란 상자는 아래 차트의 구간입니다.' : `전체 기간${iso(coin.first)} ~ ${M.E.lastClosedDay}의 종가(로그 축)와 ${M.TFS.length}개 타임프레임의 9와 13입니다. 회색 눈금은 9이고 계열 색 눈금은 13이며, 파란 상자는 아래 차트의 구간입니다.`;
    const wantChart = '숫자는 그 타임프레임 봉의 마지막 날에 있고, 위 첨자는 타임프레임입니다.' + (narrow ? '' : ' 봉 위는 매도 쪽이고 봉 아래는 매수 쪽이며, 색은 계열이고 회색은 9입니다.');
    C.ok(pg.capStrip === wantStrip, `${where} the strip's caption is "${pg.capStrip}"; expected "${wantStrip}"`);
    C.ok(pg.capChart === wantChart, `${where} the chart's caption is "${pg.capChart}"; expected "${wantChart}"`);
    if (pg.iw >= 1280) C.ok(pg.capStripBox && pg.capStripBox.h <= 20 && pg.capChartBox && pg.capChartBox.h <= 20, `${where} a caption takes more than one line (${pg.capStripBox && pg.capStripBox.h} and ${pg.capChartBox && pg.capChartBox.h} px high)`);
    // the legend: at most six items, each only while the picture shows what it explains; no family item
    const r = verifyState(M, slug, s, st, {}), p = s.probe;
    const has = { rep: r.shownText.some(([, E]) => E.rep), def: r.shownText.some(([, E]) => E.kind === 'I'), chip: p.folds.length > 0, mark: r.shownMark.length > 0, gone: r.pair.some(([L, E]) => E.gone && ['text', 'mark', 'folded'].includes(L.shown)), lead: r.c.leaders.length > 0 };
    const kinds = pg.legend.map((t) => Object.keys(LEGEND).find((k) => t.endsWith(k)));
    if (kinds.includes(undefined)) C.fail(`${where} a legend item that the picture's rules do not name: "${pg.legend[kinds.indexOf(undefined)]}"`);
    for (const [k, on] of Object.entries(has)) { const there = kinds.some((x) => LEGEND[x] === k); C.count('legendItemsChecked'); if (there !== on) C.fail(`${where} the legend ${there ? 'has' : 'lacks'} the item of "${Object.keys(LEGEND).find((x) => LEGEND[x] === k)}", but the picture ${on ? 'shows' : 'does not show'} one (${JSON.stringify(has)})`); }
    C.ok(pg.legend.length <= 6, `${where} the legend has ${pg.legend.length} items`);
    if (pg.legend.some((t) => /Sequential|Combo/.test(t))) C.fail(`${where} the legend has a family item: ${pg.legend.join(' | ')}`);
    if (pg.iw >= 1280 && pg.legendBox) C.ok(pg.legendBox.h <= 26, `${where} the legend takes ${pg.legendBox.h} px: more than one line`);
    // one line about the data, only where it applies: numbers that stand at an earlier day than their bar's last
    const late = r.pair.filter(([L, E]) => E.day !== E.e && ['text', 'mark', 'folded'].includes(L.shown)).length;
    const wantNote = late ? [`봉의 마지막 날에 TradingView 일봉이 없는 숫자 ${late}개는 그 봉에서 일봉이 있는 마지막 날에 놓았습니다.`] : [];
    C.ok(JSON.stringify(pg.notes) === JSON.stringify(wantNote), `${where} the line about the data is ${JSON.stringify(pg.notes)}; ${late} numbers of the picture stand at an earlier day than their bar's last (${JSON.stringify(wantNote)})`);
    // the block under the chart: at most 64 px on a wide screen
    if (pg.foot) { C.count('blocksUnderTheChart'); if (pg.iw >= 1280) { C.ok(pg.foot.h <= 64, `${where} the block under the chart is ${pg.foot.h} px high (64 at most)`); maxFoot = Math.max(maxFoot, pg.foot.h); } }
    if (!pg.foot && (pg.legend.length || wantNote.length)) C.fail(`${where} the block under the chart is not shown although it has something to say`);
    // no sentence twice on the page
    const seen = new Map(); for (const x of sentencesOf(pg.inner)) seen.set(x, (seen.get(x) || 0) + 1);
    C.count('sentencesOnThePage', seen.size);
    for (const [x, n] of seen) if (n > 1) C.fail(`${where} the sentence "${x.slice(0, 80)}" stands ${n} times on the page`);
    // "시안" once, in the sentence at the foot; the name with a capital E; the credit
    const sian = (pg.inner.match(/시안/g) || []).length, few = M.slugs().length === 2 ? `${coin0.sym}와 ${coin1.sym} 두 종목` : null;
    C.ok(sian === 1 && (!few || pg.lead.startsWith(`이 페이지는 Bird Eye 차트를 ${few}에 먼저 적용한 시안입니다.`)), `${where} "시안" stands ${sian} times on the page; the sentence at the foot is "${pg.lead.slice(0, 70)}"`);
    C.ok(!/[Bb]ird eye|bird Eye/.test(pg.inner + ' ' + pg.title) && /^TD Bird Eye/.test(pg.brand) && pg.title === 'TD Bird Eye', `${where} the name is not "Bird Eye" everywhere (title "${pg.title}", brand "${pg.brand}")`);
    C.ok(pg.credit.some((a) => a.text === 'Data provided by CoinGecko' && /^https:\/\/www\.coingecko\.com\/?$/.test(a.href)) && /CoinGecko/.test(pg.inner), `${where} the CoinGecko credit is missing: ${JSON.stringify(pg.credit)}`);
    return { s, r, pg };
  };
  let maxFoot = 0;
  const coin0 = M.coin(M.slugs()[0]), coin1 = M.coin(M.slugs()[1] || M.slugs()[0]);
  for (const [w, h, touch, vname] of [[1440, 900, false, 'wide'], [390, 844, true, 'phone']]) {
    for (const slug of M.slugs()) {
      const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, width: w, height: h, touch }), { page } = ctx, tag = `${vname} ${slug}`;
      let st = { ...Q.DEFAULT_STATE };
      const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
      await grabDom(page, tag); await pageRules(page, slug, tag, st, touch);
      // 설명, open: its sentences
      await page.click('#noteBtn'); await grabDom(page, tag + ' 설명'); await pageRules(page, slug, tag + ' 설명', st, touch);
      const help = await page.evaluate(() => [...document.querySelectorAll('#vnote p')].map((e) => e.textContent.trim()));
      C.ok(help.filter((x) => x === '기간을 넓히면 짧은 타임프레임의 숫자부터 작은 색 표시로 바뀝니다.').length === 1, `[${tag}] 설명 does not hold the one sentence about wide windows once: ${help.filter((x) => /넓히면/.test(x)).join(' | ')}`);
      for (const x of help) { C.count('helpSentences'); if (!/(다|요)\.$/.test(x) || x.split(/(?<=다\.)\s/).length > 2 || x.length > 70) C.fail(`[${tag}] 설명: "${x}" is not one or two short sentences (${x.length} characters)`); }
      await page.click('#noteBtn');
      // the 설정 panel, open
      await Q.openPanel(page); await grabDom(page, tag + ' 설정'); await Q.closePanel(page);
      if (!touch) {
        await set({ def: 'on' });
        for (const [name, when] of [['6개월', null], ['1년', slug === 'btc' ? '2017-12-10' : '2021-05-05'], ['3개월', slug === 'btc' ? '2011-02-10' : '2016-03-01'], ['6개월', slug === 'btc' ? '2013-11-20' : '2018-01-10'], ['2년', null], ['5년', null], ['전체', null]]) {
          await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when));
          await grabDom(page, `${tag} ${name}`);
          const { s } = await pageRules(page, slug, `${tag} ${name}${when ? ' @' + when : ''} +13`, st, false), p = s.probe;
          const pts = [...p.labels.filter((L) => L.shown === 'text' || L.shown === 'mark').filter((L, i) => i % 3 === 0).slice(0, 40).map((L) => [L.x + L.w / 2, L.y + L.h / 2]), ...p.folds.slice(0, 6).map((f) => [f.x + f.w / 2, f.y + f.h / 2]), ...p.conds.filter((q) => q.shown === 'in').map((q) => [q.x + q.w / 2, q.y + q.h / 2]), ...(p.zone ? p.zone.edges.map((e) => [e.x + e.w / 2, e.y + e.h / 2]) : []), ...[0.1, 0.3, 0.5, 0.7, 0.9].map((k) => [p.plot.l + (p.plot.r - p.plot.l) * k, p.plot.t + 200])];
          for (const [x, y] of pts) { await page.mouse.move(s.rc.x + x, s.rc.y + y); await grabTip(page, `${tag} ${name}`); C.count('tooltips'); }
          // a number pinned by a click (the link row), the list of a chip
          const L = p.labels.find((x) => x.shown === 'text');
          if (L) { await page.mouse.click(s.rc.x + L.x + L.w / 2, s.rc.y + L.y + L.h / 2); await grabTip(page, `${tag} ${name} pinned`); await page.mouse.click(s.rc.x + 30, s.rc.y - 14); }
          const f = p.folds[0]; if (f) { await page.mouse.click(s.rc.x + f.x + f.w / 2, s.rc.y + f.y + f.h / 2); await Q.mouseOff(page); await grabDom(page, `${tag} ${name} list of a chip`); C.count('chipLists'); await page.mouse.click(s.rc.x + 30, s.rc.y - 14); }
          // the strip: the date under the pointer, the tooltip of a tick
          const t = p.strip.slice().sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];
          if (t) { await page.mouse.move(s.rs.x + (t.x0 + t.x1) / 2, s.rs.y + t.y + t.h / 2); await grabTip(page, `${tag} ${name} strip tick`); await grabDom(page, `${tag} ${name} strip`); }
          await Q.mouseOff(page);
        }
        await set({ def: 'off' });
        for (const [name, when] of [['6개월', null], ['1년', slug === 'btc' ? '2017-12-10' : '2021-05-05'], ['전체', null]]) { await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when)); await pageRules(page, slug, `${tag} ${name}${when ? ' @' + when : ''}`, st, false); }
        // the keyboard's texts
        await Q.preset(page, '6개월'); await page.focus('.bec-chart canvas.bec-over');
        for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowDown', 'Escape', 'PageUp', 'ArrowDown', 'Escape', 'ArrowRight', 'End', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown']) { await page.keyboard.press(k); await grabTip(page, `${tag} keyboard`); await grabDom(page, `${tag} keyboard`); }
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.evaluate(() => document.activeElement && document.activeElement.blur());
        // settings that change texts: no timeframe, a moved window, the 설정 button with changes
        await set({ off: M.TFS.slice() }); await grabDom(page, tag + ' no timeframe'); await pageRules(page, slug, tag + ' no timeframe', st, false);
        await set({ off: M.TFS.slice(0, 12), dir: 'buy', near: 10, scale: 'log' }); await grabDom(page, tag + ' changed settings');
        await set({ ...Q.DEFAULT_STATE }); await Q.panWheel(page, -40); await grabDom(page, tag + ' moved back'); await Q.mouseOff(page);
      } else {
        // the conditions under the chart: the line, the list, one condition opened; a number tapped
        // (locators: the page may draw this list anew at any moment, when a font arrives)
        if (await page.locator('.bec-conds .bec-csum').count()) { await page.locator('.bec-conds .bec-csum').tap(); await grabDom(page, tag + ' conditions'); const rows = page.locator('.bec-conds .bec-crow > button'); if (await rows.count()) { await rows.nth(0).tap(); await grabDom(page, tag + ' a condition'); await pageRules(page, slug, tag + ' conditions open', st, true); } await page.evaluate(() => document.querySelector('.bec-conds .bec-csum').click()); }
        await page.evaluate(() => document.querySelector('.bec-chart').scrollIntoView({ block: 'center' })); await page.waitForTimeout(100);
        const s2 = await Q.snap(page, { nobase: true }), L = s2.probe.labels.find((x) => x.shown === 'text' && s2.rc.y + x.y > 200);
        if (L) { await page.touchscreen.tap(s2.rc.x + L.x + L.w / 2, s2.rc.y + L.y + L.h / 2); await grabTip(page, tag + ' tap'); await page.touchscreen.tap(195, s2.rc.y - 30); }
        for (const name of ['1년', '전체']) { await Q.preset(page, name); await pageRules(page, slug, `${tag} ${name}`, st, true); await grabDom(page, `${tag} ${name}`); }
      }
      C.logs(ctx, tag); await ctx.context.close();
    }
  }
  // the loading text and the text of a failed load
  {
    let release; const gate = new Promise((r) => { release = r; });
    const ctx = await Q.open(A.base, { hash: '#chart-a-btc', wait: false, onRoute: async (route) => { if (/\/d\/\d+\.json/.test(route.request().url())) { await gate; return route.fulfill({ status: 503, body: 'no' }); } await route.continue(); } });
    await ctx.page.waitForSelector('#stage-root .bec-wait'); await grabDom(ctx.page, 'loading');
    release(); await ctx.page.waitForFunction(() => /불러오지 못했습니다/.test(document.querySelector('#stage-root .bec-wait').textContent), null, { timeout: 15000 }).catch(() => {});
    await grabDom(ctx.page, 'failed load'); await ctx.context.close();
  }
  // ---- the rules, text by text ----
  const ALLOWED = new Set(['BTC', 'ETH', 'TD', 'Bird', 'Eye', 'Research', 'v6', 'TradingView', 'CoinGecko', 'Data', 'provided', 'by', 'Sequential', 'Combo', 'Aggressive', 'CRYPTO', 'USD', 'Bitcoin', 'Ethereum', 'Ctrl', 'Mac', 'Command', 'Shift', 'Enter', 'Home', 'End', 'Page', 'Up', 'Down', 'Esc', 'r', 'x', 'M', 'K', 'B', 'T', 'W', 'D']);
  const strange = new Map();
  for (const [t, info] of texts) {
    C.count('texts');
    if (/[—–]/.test(t)) C.fail(`a dash (em or en) in "${t.slice(0, 90)}" [${info.where}]`);
    if (/�|undefined|NaN|null|\[object/.test(t)) C.fail(`a broken value in "${t.slice(0, 90)}" [${info.where}]`);
    { const m = /[.]\s?[.]|,\s?,|·\s?·|[.],|,[.]/.exec(t); if (m) C.fail(`a punctuation mark twice ("${m[0]}") in "${t.slice(Math.max(0, m.index - 50), m.index + 30)}" [${info.where}]`); }
    if (/[Bb]ird eye|bird Eye|조감/.test(t)) C.fail(`"${t.slice(0, 90)}": the name is "Bird Eye", and the strip is "전체 기간" [${info.where}]`);
    if (/^외 \d+개$|외 \d+개가 더|마감하면 충족|마감해도 충족|최근으로|설명 보기|설명 접기|처음 기간|실제 데이터$/.test(t)) C.fail(`a wording that was to go: "${t.slice(0, 90)}" [${info.where}]`);
    // running text: a text with a sentence in it (…다. somewhere, or a full stop at its end) has to consist of complete
    // sentences; a text without any is a label, a heading or a list item, which may be a noun phrase. Texts for screen
    // readers (aria-label) begin with the thing's name and are left out of this rule.
    const body = t.replace(/\s*\([^()]*\)\s*$/, '').trim(), aria = /aria-label\)$/.test(info.where) || /screen reader/.test(info.where);
    if (!aria && (/(다|요)[.…](\s|$)/.test(body) || /[.]$/.test(body) || info.prose)) {
      C.count('sentenceTexts');
      // (a number followed by a full stop inside a sentence, as in "13. " never occurs; dates and prices have no blank after the dot)
      for (const sent of body.split(/(?<=[.…])\s+(?=[^\d])/)) { if (!sent) continue; C.count('sentences'); if (!/(다|요)[.…]$/.test(sent)) C.fail(`not a complete sentence: "${sent.slice(0, 110)}" in "${t.slice(0, 80)}" [${info.where}]`); }
    } else if (!aria && /(니다|습니다)$/.test(body)) C.fail(`a sentence without a full stop at its end: "${t.slice(0, 80)}" [${info.where}]`);
    // Latin words: after the chart's own tokens are taken out (a label text with its timeframe, a timeframe name)
    const plain = t.replace(/(\+?13r?(?:x\d+)?|9\*?)?(1[0-2]|[1-9])[DWM](?![a-z])/g, ' ').replace(/\b13r(?:x\d+)?\b/g, ' ');
    for (const w of plain.match(/[A-Za-z][A-Za-z0-9]*/g) || []) { if (ALLOWED.has(w) || /^x\d+$/.test(w)) continue; if (!strange.has(w)) strange.set(w, `"${t.slice(0, 70)}" [${info.where}]`); }
  }
  for (const [w, where] of strange) C.fail(`a Latin word that is no ticker, timeframe, label text, family, product or key name: "${w}" in ${where}`);
  // hover titles: full sentences with a full stop
  for (const [t, where] of titles) { C.count('hoverTitles'); if (!/(다|요)\.$/.test(t)) C.fail(`the hover title "${t.slice(0, 80)}" is not a full sentence with a full stop [${where}]`); }
  // the names of two buttons
  C.ok(texts.has('모두 켜기') && texts.has('최근 날짜로') && texts.has('설명') && texts.has('설정'), `a button name is missing among 모두 켜기, 최근 날짜로, 설명, 설정`);
  C.ok(texts.has('일봉 데이터를 불러오지 못했습니다. 다시 시도해 주세요.') && texts.has('불러오는 중입니다…'), 'the loading text or the text of a failed load was not met');
  C.note(`${texts.size} different texts; ${[...texts.values()].filter((x) => x.prose).length} of them running text; the tallest block under the chart on a wide screen: ${maxFoot} px`);
  const rc = C.finish(A.out);
  require('fs').writeFileSync(require('path').join(A.out, 'copy-texts.json'), JSON.stringify([...texts].map(([t, i]) => ({ t, ...i })), null, 1));
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('copy.cjs crashed:', e); process.exit(3); });
