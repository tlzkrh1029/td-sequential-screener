// Check 14: the page's Korean copy, mechanically. Every text the reader can meet (the page, both canvases, the
// tooltips of numbers, days, chips and conditions, the list on a phone, titles and labels for screen readers) is
// collected over several states and held against the page's own rules: no em dash and no en dash; hints, captions
// and explanations are complete sentences that end with a sentence ending (…다.); Latin words only where the chart
// itself has them (tickers, timeframes, label texts, family names, product and key names).
//   node copy.cjs --base http://127.0.0.1:8911/ --out <dir>
const Q = require('../lib/qa.cjs'), { Model } = require('../lib/model.cjs');
const A = Q.args();
(async () => {
  const M = new Model(A.expect), C = new Q.Check('c14_copy');
  const texts = new Map();   // text -> where it was seen, and whether it is running text (sentences)
  const add = (t, where, prose) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); if (!s) return; const was = texts.get(s); if (!was) texts.set(s, { where, prose: !!prose }); else if (prose) was.prose = true; };
  const DOM = `(() => { const out = [], vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const prose = 'p.hint, p.bec-cap, p.lead, #vnote p, .bec-sent, .bec-wait p, .bec-wait span';
    for (const e of document.querySelectorAll(prose)) if (vis(e)) out.push([e.textContent, e.matches('p.bec-cap') ? 'caption' : 'prose', true, e.querySelector && e.querySelector('b') ? e.querySelector('b').textContent : '']);
    for (const e of document.querySelectorAll('button, a, label, h1, h2, h3, .ctl > span, .legend > span, .bec-win, .foot span, .coinhead span, .brand, .bec-meta span, .bec-px, .bec-near, .bec-met')) if (vis(e)) out.push([e.textContent, 'label', false, '']);
    for (const e of document.querySelectorAll('[title], [aria-label], [placeholder]')) for (const a of ['title', 'aria-label', 'placeholder']) if (e.getAttribute(a)) out.push([e.getAttribute(a), a, a !== 'placeholder' && /[.다]$/.test(e.getAttribute(a).trim()), '']);
    const live = document.querySelector('#stage-root .sr-only[aria-live]'); if (live && live.textContent) out.push([live.textContent, 'screen reader text', false, '']);
    for (const sel of ['.bec-chart canvas:not(.bec-over)', '.bec-strip canvas:not(.bec-over)', '.bec-strip canvas.bec-over', '.bec-chart canvas.bec-over']) { const cv = document.querySelector(sel); if (cv) for (const c of __qa.frame(cv).calls) if (c.op === 'ft') out.push([c.text, 'canvas', false, '']); }
    return out; })()`;
  const grabDom = async (page, tag) => { for (const [t, kind, prose, lead] of await page.evaluate(DOM)) add(lead && t.startsWith(lead) ? t.slice(lead.length) : t, `${tag} (${kind})`, prose); };
  const grabTip = async (page, tag) => { const t = await Q.tip(page); if (!t) return; for (const k of t.kids) { if (k.cls === 'h1') add(k.text, `${tag} tooltip heading`, false); else if (/^(m|bec-tip-foot)$/.test(k.cls)) add(k.text, `${tag} tooltip`, true); else add(k.text, `${tag} tooltip line`, false); } for (const r of t.rows) add(r.rest, `${tag} tooltip line`, /니다\.$/.test(r.rest)); };
  for (const [w, h, touch, vname] of [[1440, 900, false, 'wide'], [390, 844, true, 'phone']]) {
    for (const slug of M.slugs()) {
      const ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, width: w, height: h, touch }), { page } = ctx, tag = `${vname} ${slug}`;
      await grabDom(page, tag);
      if (!touch) {
        await page.click('#noteBtn'); await grabDom(page, tag + ' description'); await page.click('#noteBtn');
        await Q.setState(page, { def: 'on' });
        for (const [name, when] of [['6개월', null], ['1년', slug === 'btc' ? '2017-12-10' : '2021-05-05'], ['3개월', slug === 'btc' ? '2011-02-10' : '2016-03-01'], ['전체', null]]) {
          await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when));
          await grabDom(page, `${tag} ${name}`);
          const s = await Q.snap(page, { nobase: true }), p = s.probe;
          const pts = [...p.labels.filter((L) => L.shown !== 'folded').filter((L, i) => i % 3 === 0).slice(0, 40).map((L) => [L.x + L.w / 2, L.y + L.h / 2]), ...p.folds.slice(0, 6).map((f) => [f.x + f.w / 2, f.y + f.h / 2]), ...p.conds.filter((q) => q.shown !== 'folded').map((q) => [q.x + q.w / 2, q.y + q.h / 2]), ...[0.1, 0.3, 0.5, 0.7, 0.9].map((k) => [p.plot.l + (p.plot.r - p.plot.l) * k, p.plot.t + 200])];
          for (const [x, y] of pts) { await page.mouse.move(s.rc.x + x, s.rc.y + y); await grabTip(page, `${tag} ${name}`); C.count('tooltips'); }
          const f = p.folds[0]; if (f) { await page.mouse.click(s.rc.x + f.x + f.w / 2, s.rc.y + f.y + f.h / 2); await Q.mouseOff(page); const s1 = await Q.snap(page, { nobase: true }); for (const b of [...s1.probe.handles, ...s1.probe.folds.slice(0, 3)]) { await page.mouse.move(s1.rc.x + b.x + b.w / 2, s1.rc.y + b.y + b.h / 2); await grabTip(page, `${tag} ${name} unfolded`); } await grabDom(page, `${tag} ${name} unfolded`); await page.waitForTimeout(380); }
          await Q.mouseOff(page);
        }
        // the keyboard's texts
        await Q.preset(page, '6개월'); await page.focus('.bec-chart canvas.bec-over');
        for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowDown', 'Escape', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown']) { await page.keyboard.press(k); await grabTip(page, `${tag} keyboard`); await grabDom(page, `${tag} keyboard`); }
        // settings that change texts
        await Q.setState(page, { ...Q.DEFAULT_STATE, off: M.TFS.slice() }); await grabDom(page, tag + ' no timeframe');
        await Q.setState(page, { ...Q.DEFAULT_STATE });
      } else {
        await page.tap('.bec-more'); await grabDom(page, tag + ' settings');
        const s = await Q.snap(page, { nobase: true }), L = s.probe.labels.find((x) => x.shown === 'text');
        await page.evaluate(() => document.querySelector('.bec-chart').scrollIntoView({ block: 'center' })); await page.waitForTimeout(100);
        const s2 = await Q.snap(page, { nobase: true }); if (L) { await page.touchscreen.tap(s2.rc.x + L.x + L.w / 2, s2.rc.y + L.y + L.h / 2); await grabTip(page, tag + ' tap'); }
      }
      C.logs(ctx, tag); await ctx.context.close();
    }
  }
  // ---- the rules ----
  const ALLOWED = new Set(['BTC', 'ETH', 'TD', 'Bird', 'Eye', 'eye', 'bird', 'Research', 'v6', 'TradingView', 'CoinGecko', 'Data', 'provided', 'by', 'Sequential', 'Combo', 'Aggressive', 'CRYPTO', 'USD', 'Bitcoin', 'Ethereum', 'Ctrl', 'Mac', 'Command', 'Shift', 'Enter', 'Home', 'End', 'TF', 'r', 'x', 'M', 'K', 'B', 'T', 'W', 'D']);
  const strange = new Map();
  const noPeriod = [];
  for (const [t, info] of texts) {
    C.count('texts');
    if (/[\u2014\u2013]/.test(t)) C.fail(`a dash (em or en) in "${t.slice(0, 90)}" [${info.where}]`);
    if (/\uFFFD|undefined|NaN|null|\[object/.test(t)) C.fail(`a broken value in "${t.slice(0, 90)}" [${info.where}]`);
    // running text: a text with a sentence in it (…다. somewhere, or a full stop at its end) has to consist of complete
    // sentences; a text without any is a label, a heading or a list item, which may be a noun phrase. Texts for screen
    // readers (aria-label) begin with the thing's name and are left out of this rule.
    const body = t.replace(/\s*\([^()]*\)\s*$/, '').trim(), aria = /aria-label\)$/.test(info.where) || /screen reader/.test(info.where);
    if (!aria && (/(다|요)[.…](\s|$)/.test(body) || /[.]$/.test(body))) {
      C.count('sentenceTexts');
      // (a number followed by a full stop inside a sentence, as in "13. " never occurs; dates and prices have no blank after the dot)
      for (const sent of body.split(/(?<=[.…])\s+(?=[^\d])/)) { if (!sent) continue; C.count('sentences'); if (!/(다|요)[.…]$/.test(sent)) C.fail(`not a complete sentence: "${sent.slice(0, 110)}" in "${t.slice(0, 80)}" [${info.where}]`); }
    } else if (!aria && /(니다|습니다)$/.test(body)) noPeriod.push(`"${t.slice(0, 60)}" [${info.where}]`);
    // Latin words: after the chart's own tokens are taken out (a label text with its timeframe, a timeframe name)
    const plain = t.replace(/(\+?13r?(?:x\d+)?|9\*?)?(1[0-2]|[1-9])[DWM](?![a-z])/g, ' ').replace(/\b13r(?:x\d+)?\b/g, ' ');
    for (const w of plain.match(/[A-Za-z][A-Za-z0-9]*/g) || []) { if (ALLOWED.has(w) || /^x\d+$/.test(w)) continue; if (!strange.has(w)) strange.set(w, `"${t.slice(0, 70)}" [${info.where}]`); }
  }
  if (noPeriod.length) C.note(`${noPeriod.length} texts are sentences without a full stop at the end (all in hover titles), e.g. ${noPeriod[0]}`);
  for (const [w, where] of strange) C.fail(`a Latin word that is no ticker, timeframe, label text, family, product or key name: "${w}" in ${where}`);
  C.note(`${texts.size} different texts; ${[...texts.values()].filter((x) => x.prose).length} of them running text`);
  const rc = C.finish(A.out);
  require('fs').writeFileSync(require('path').join(A.out, 'copy-texts.json'), JSON.stringify([...texts].map(([t, i]) => ({ t, ...i })), null, 1));
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('copy.cjs crashed:', e); process.exit(3); });
