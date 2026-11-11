// Check 16: the first screen belongs to the chart. For the page that holds only the chart view, measured at the
// window sizes the rule names:
//   1440x900                              the chart begins at y 340 or above and is at least 548 px high
//   1440x789, 1536x730, 1280x800, 1024x768  the chart's bottom edge, with the date axis, is inside the first screen
//   1920x1080                             the chart is at least 680 px high
//   390x844                               the chart begins at y 340 or above
// and at every size: the chart is as high as the window leaves under it (window height - the chart's top - 12 px, at
// least 360 px). From 1280 px width: row 1 is the app bar, not sticky, at most 44 px high, with the name and the
// closing day, the coin buttons, the newest close, the TradingView link and 설명 at its right end; no coin head row
// (names, rank and exchanges are in the coin button's hover title, a full sentence); row 2 is ONE row of controls of
// at most 40 px (기간, the three 계열 toggles, "9", the three timeframe groups, 설정, and at the right end the window's
// dates, with 최근 날짜로 when the window was moved back); then one caption line, the strip, one caption line, the
// chart. Narrower than 560 px: name and coin buttons, one line with the symbol and the newest close, a row with 기간
// and 설정, every button at least 40 px high, the strip about 100 px. At most 16 Tab stops before the chart.
// The same is measured on the published form (the fragment inside the host's document) when --frag is given.
//   node firstscreen.cjs --base http://127.0.0.1:8911/ [--frag http://127.0.0.1:8912/] --out <dir>
const Q = require('../lib/qa.cjs'), { Model, iso, FAM_NAME } = require('../lib/model.cjs');
const A = Q.args();
const MEASURE = `(() => {
  const q = (s) => document.querySelector(s), box = (e) => { if (!e) return null; const cs = getComputedStyle(e); if (e.hidden || cs.display === 'none' || cs.visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top + scrollY, w: r.width, h: r.height, r: r.right, b: r.bottom + scrollY } : null; };
  const txt = (e) => (e ? e.textContent.replace(/\\s+/g, ' ').trim() : null);
  const bar = q('.appbar'), row = q('#stage-root .bec-ctl'), p = q('#stage-root').__probe();
  const btns = [...document.querySelectorAll('button, a')].filter((e) => box(e)).map((e) => ({ text: txt(e), tag: e.tagName, ...box(e), inChart: !!e.closest('#stage-root'), inBar: !!e.closest('.appbar') }));
  const ctls = [...document.querySelectorAll('#stage-root .bec-row > *')].filter((e) => box(e)).map((e) => ({ cls: e.className, label: e.querySelector(':scope > span') ? txt(e.querySelector(':scope > span')) : null, buttons: [...e.querySelectorAll('button')].map(txt), text: e.matches('button, span') ? txt(e) : null, ...box(e) }));
  return { iw: innerWidth, ih: innerHeight, cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight,
    bar: box(bar), barPos: getComputedStyle(bar).position, brand: txt(q('.brand')), brandBox: box(q('.brand')), asof: txt(q('#asof')), asofBox: box(q('#asof')),
    coins: [...document.querySelectorAll('#quick button')].map((b) => ({ text: txt(b), pressed: b.getAttribute('aria-pressed'), title: b.title, ...box(b) })),
    sym: box(q('#soloSym')) ? txt(q('#soloSym')) : null, symBox: box(q('#soloSym')), price: txt(q('#soloPrice')), priceBox: box(q('#soloPrice')), tv: q('#soloTv') ? { text: txt(q('#soloTv')), href: q('#soloTv').href, ...box(q('#soloTv')) } : null, note: { text: txt(q('#noteBtn')), title: q('#noteBtn').title, ...box(q('#noteBtn')) }, noteOpen: !!box(q('#vnote')),
    coinHead: box(q('#coinHead')), shellCtl: box(q('#shellCtl')), tabs: box(q('#tabs')), inner: document.body.innerText,
    row: box(row), ctls, setOpen: !!box(q('#stage-root .bec-set')), win: txt(q('.bec-win')), winBox: box(q('.bec-win')), now: box(q('.bec-now')) && getComputedStyle(q('.bec-now')).visibility !== 'hidden' ? { text: txt(q('.bec-now')), ...box(q('.bec-now')) } : null,
    capStrip: box(q('.bec-pic > p.bec-cap')), strip: box(q('.bec-strip')), capRow: box(q('.bec-caprow')), capChart: box(q('.bec-caprow p.bec-cap')), chart: box(q('.bec-chart')), conds: box(q('.bec-conds')), foot: box(q('.bec-foot')),
    plot: p.plot, ppd: p.ppd, d0: p.d0, d1: p.d1, narrow: p.narrow, btns };
})()`;
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c16_first_screen');
  const fmt = (v) => { const [i, f] = String(v).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); };
  const tvUrl = (usd) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(usd)}&interval=D`;
  const SIZES = [[1440, 900], [1440, 789], [1536, 730], [1280, 800], [1024, 768], [1920, 1080], [390, 844], [360, 740], [820, 1180]];
  const forms = [['page', A.base], ...(A.frag ? [['published form', A.frag.endsWith('/') ? A.frag : A.frag + '/']] : [])];
  const lines = [];
  for (const [form, base] of forms) for (const [w, h] of form === 'page' ? SIZES : SIZES.slice(0, 7)) {
    await Promise.all(M.slugs().map(async (slug) => {
      for (const dark of w === 1440 && h === 900 && form === 'page' ? [false, true] : [false]) {
        const coin = M.coin(slug), touch = w < 700, ctx = await Q.open(base, { hash: '#chart-a-' + slug, width: w, height: h, touch, dpr: touch ? 2 : 1, dark }), { page } = ctx;
        const m = await page.evaluate(MEASURE), tag = `[${form} ${slug} ${w}x${h}${dark ? ' dark' : ''}]`, ok = (c, msg) => C.ok(c, `${tag} ${msg}`);
        C.count('screens');
        // ---- the measures ----
        const top = m.chart.y, ch = m.chart.h, wantH = Math.max(360, m.ih - top - 12 - (m.narrow && m.conds ? 48 : 0));
        if (slug === M.slugs()[0] && !dark) lines.push(`${form} ${w}x${h}: chart top ${Math.round(top)}, height ${Math.round(ch)}, bottom ${Math.round(m.chart.b)} of ${m.ih}`);
        ok(Math.abs(ch - wantH) <= 1, `the chart is ${ch} px high; the window (${m.ih}) minus its top (${top}) minus 12 px is ${m.ih - top - 12}${m.narrow && m.conds ? ', less the line of the conditions under it' : ''} (at least 360): ${wantH}`);
        if (w === 1440 && h === 900) { ok(top <= 340, `the chart begins at y ${top} (340 at most)`); ok(ch >= 548, `the chart is ${ch} px high (548 at least)`); }
        if ([[1440, 789], [1536, 730], [1280, 800], [1024, 768]].some(([a, b]) => a === w && b === h)) ok(m.chart.b <= m.ih && m.chart.y + m.plot.b + 14 <= m.ih, `the chart ends at y ${m.chart.b} (its date axis at ${m.chart.y + m.plot.b}), the first screen at ${m.ih}`);
        if (w === 1920) ok(ch >= 680, `the chart is ${ch} px high (680 at least)`);
        if (w === 390) ok(top <= 340, `the chart begins at y ${top} (340 at most)`);
        ok(m.sw <= m.cw, `the page scrolls sideways (${m.sw} > ${m.cw})`);
        ok(Math.abs(m.chart.w - m.plot.w) < 1, `the chart is laid out ${m.plot.w} px wide in a box of ${m.chart.w} px`);
        // ---- what is not there: the study's shell (variant switch, tabs), a coin head row, an open panel ----
        ok(!m.coinHead && !m.shellCtl && !m.tabs && !m.noteOpen && !m.setOpen, `the first screen holds ${[m.coinHead && 'a coin head row', m.shellCtl && "the study's control panel", m.tabs && 'tabs', m.noteOpen && '설명 open', m.setOpen && 'the 설정 panel open'].filter(Boolean).join(', ')}`);
        // (the foot's credit names what CoinGecko gives, "코인 목록, 순위, 시가총액": that is no fact about this coin)
        ok(!/\d위|업비트|빗썸|바이낸스|Bitcoin|비트코인|Ethereum|이더리움|\d조 달러|\d억 달러/.test(m.inner), 'the names, the rank, the market cap or the exchanges of the coin are written on the page (they belong in the coin button\'s hover title)');
        const cb = m.coins.find((x) => x.text === coin.sym);
        ok(m.coins.map((x) => x.text).join() === M.slugs().map((x) => M.coin(x).sym).join() && cb && cb.pressed === 'true' && m.coins.filter((x) => x.pressed === 'true').length === 1, `coin buttons ${JSON.stringify(m.coins.map((x) => x.text + ':' + x.pressed))}; the current coin is ${coin.sym}`);
        ok(m.coins.every((x) => /입니다\. 시가총액은 \d+위.*이고, .*에 상장되어 있습니다\.$/.test(x.title)), `the hover title of a coin button is not the sentence with its names, rank and exchanges: "${m.coins[0] && m.coins[0].title}"`);
        ok(m.price === `최근 종가 ${fmt(coin.lastClose)}`, `the newest close is written "${m.price}", it is ${coin.lastClose}`);
        ok(m.tv && m.tv.text === 'TradingView 차트 ↗' && m.tv.href === tvUrl(coin.usd), `the TradingView link is ${JSON.stringify(m.tv && { text: m.tv.text, href: m.tv.href })}`);
        ok(m.note.text === '설명' && /다\.$/.test(m.note.title), `the 설명 button says "${m.note.text}" (title "${m.note.title}")`);
        ok(/^TD Bird Eye/.test(m.brand), `the name is "${m.brand}"`);
        ok(m.barPos !== 'sticky' && m.barPos !== 'fixed', `the app bar is ${m.barPos}`);
        const days = m.d1 - m.d0 + 1;
        ok(m.win === `${iso(m.d0)} ~ ${iso(m.d1)} · ${fmt(days)}일` && m.d1 === M.LAST && days === (w < 640 ? 92 : 183), `the window's text is "${m.win}", the window ${iso(m.d0)} ~ ${iso(m.d1)} (${days} days)`);
        ok(!m.now, 'the button 최근 날짜로 is shown while the window is at the newest day');
        // the picture's order: caption, strip, caption, chart
        ok(m.capStrip && m.strip && m.capChart && m.capStrip.b <= m.strip.y + 0.5 && m.strip.b <= m.capRow.y + 0.5 && m.capRow.b <= m.chart.y + 0.5, `the picture is not caption, strip, caption, chart: y ${[m.capStrip, m.strip, m.capRow, m.chart].map((b) => b && Math.round(b.y)).join(', ')}`);
        if (w >= 1280) {
          // row 1: one app bar row of at most 44 px, with everything in it, 설명 at its right end
          ok(m.bar.h <= 44 && m.bar.y === 0, `the app bar is ${m.bar.h} px high at y ${m.bar.y} (44 at most)`);
          ok(m.brand === `TD Bird Eye ${M.E.lastClosedDay} 마감 기준`, `the app bar's name is "${m.brand}"; expected "TD Bird Eye" with "${M.E.lastClosedDay} 마감 기준" beside it`);
          const inBar = [m.brandBox, ...m.coins, m.priceBox, m.tv, m.note];
          ok(inBar.every((b) => b && b.y >= m.bar.y && b.b <= m.bar.b + 0.5), `not everything of row 1 stands inside the app bar (y ${m.bar.y}..${m.bar.b}): ${JSON.stringify(inBar.map((b) => b && [Math.round(b.y), Math.round(b.b)]))}`);
          const xs = [m.brandBox.x, m.coins[0].x, m.priceBox.x, m.tv.x, m.note.x];
          ok(xs.every((x, i) => i === 0 || x > xs[i - 1]) && m.note.r >= m.bar.r - 24 && !m.symBox, `row 1 is not name, coin buttons, newest close, TradingView link and 설명 at the right end (x ${xs.map(Math.round).join(', ')}; 설명 ends at ${Math.round(m.note.r)}, the bar at ${m.bar.r})`);
          // row 2: ONE row of controls of at most 40 px
          ok(m.row.h <= 40, `the row of controls is ${m.row.h} px high (40 at most)`);
          const c = m.ctls, labels = c.map((x) => x.label || x.text);
          ok(c.length === 6 && c[0].label === '기간' && c[0].buttons.join() === '3개월,6개월,1년,2년,5년,전체' && c[1].buttons.join() === [0, 2, 3].map((f) => FAM_NAME[f]).join() && c[2].buttons.join() === '9' && c[3].buttons.join() === '1D~1W,8D~3W,1M~12M' && /bec-more/.test(c[4].cls) && c[4].text === '설정' && /bec-win/.test(c[5].cls), `the row of controls holds ${JSON.stringify(labels)} (${JSON.stringify(c.map((x) => x.buttons))}); expected 기간, the three 계열 toggles, 9, the three timeframe groups, 설정 and the window's dates`);
          ok(c.every((x) => Math.abs(x.y + x.h / 2 - (m.row.y + m.row.h / 2)) <= 4) && c.every((x, i) => i === 0 || x.x >= c[i - 1].r - 0.5), `the controls do not stand in one row: ${JSON.stringify(c.map((x) => [Math.round(x.x), Math.round(x.y)]))}`);
          ok(m.winBox.r >= m.row.r - 16, `the window's dates end at x ${m.winBox.r}, the row at ${m.row.r}: not at its right end`);
          ok(m.capStrip.h <= 20 && m.capChart.h <= 20, `a caption is ${m.capStrip.h} or ${m.capChart.h} px high: more than one line`);
          // at most 16 Tab stops before the chart
          await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); });
          let stops = 0, reached = false;
          for (let i = 0; i < 40 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement === document.querySelector('.bec-chart canvas.bec-over')); if (!reached) stops++; }
          ok(reached && stops <= 16, `${stops} Tab stops before the chart${reached ? '' : ' (the chart was not reached in 40)'} (16 at most)`);
          if (slug === M.slugs()[0] && !dark && form === 'page' && w === 1440 && h === 900) lines.push(`Tab stops before the chart at 1440x900: ${stops}; app bar ${m.bar.h} px, row of controls ${m.row.h} px, captions ${m.capStrip.h} and ${m.capChart.h} px`);
          // moved back: the button 최근 날짜로 comes, before the dates, in the same row; nothing over the chart moves
          await Q.panWheel(page, -60); await Q.mouseOff(page);
          const m2 = await page.evaluate(MEASURE);
          ok(m2.now && m2.now.text === '최근 날짜로' && m2.now.y >= m2.row.y && m2.now.b <= m2.row.b + 0.5 && m2.row.h === m.row.h && m2.chart.y === m.chart.y && m2.winBox.r >= m2.row.r - 16, `moved back: 최근 날짜로 is ${JSON.stringify(m2.now)}, the row ${m2.row.h} px, the chart at y ${m2.chart.y} (was ${m.chart.y})`);
        }
        if (w < 560) {
          // narrow: name and coin buttons; one line with the symbol and the newest close; 기간 and 설정; buttons of 40 px; the strip about 100 px
          ok(m.brandBox && m.coins.every((b) => Math.abs(b.y + b.h / 2 - (m.brandBox.y + m.brandBox.h / 2)) <= 12), `the name and the coin buttons are not one row (y ${Math.round(m.brandBox.y)}, ${m.coins.map((b) => Math.round(b.y)).join(', ')})`);
          ok(m.sym === coin.sym && m.symBox && m.priceBox && Math.abs(m.symBox.y - m.priceBox.y) <= 6 && m.symBox.y > m.coins[0].b - 2 && m.priceBox.h <= 24, `no single line with the symbol and the newest close under the first row: symbol ${JSON.stringify(m.sym)} at y ${m.symBox && Math.round(m.symBox.y)}, close at y ${m.priceBox && Math.round(m.priceBox.y)}`);
          const c = m.ctls;
          ok(c.length === 2 && c[0].label === '기간' && /bec-more/.test(c[1].cls) && c[1].text === '설정', `the row of controls holds ${JSON.stringify(c.map((x) => x.label || x.text))}; expected 기간 and 설정`);
          const small = m.btns.filter((b) => b.tag === 'BUTTON' && b.h < 39.5);
          ok(small.length === 0, `${small.length} buttons are lower than 40 px: ${small.slice(0, 4).map((b) => `"${b.text}" ${b.h.toFixed(0)}`).join(', ')}`);
          ok(m.strip.h >= 85 && m.strip.h <= 115, `the strip is ${m.strip.h} px high (about 100)`);
          if (slug === M.slugs()[0] && form === 'page') lines.push(`${w}x${h}: strip ${m.strip.h} px, lowest button ${Math.min(...m.btns.filter((b) => b.tag === 'BUTTON').map((b) => b.h)).toFixed(0)} px`);
        }
        C.logs(ctx, `${form} ${slug} ${w}x${h}`);
        await ctx.context.close();
      }
    }));
  }
  for (const l of lines) C.note(l);
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('firstscreen.cjs crashed:', e); process.exit(3); });
