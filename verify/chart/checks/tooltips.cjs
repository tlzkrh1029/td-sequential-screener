// Check 7: tooltips against the engine dump (scripts/td-dump.mjs). For a sample of numbers over all timeframes: line 1
// is the number as drawn and what it is, line 2 its bar, line 3 (a 13 and a +13) its origin bars, all the dump's; the
// sentence about its place is there only when the number stands at an earlier day than its bar's last; "r" is
// explained in a sentence of its own; a label that TradingView has deleted says so. The tooltip stands beside the
// stack and covers no number of that day and side. The band the page lays over the bar's days is the bar, and the
// origin bars of a 13 inside the window are marked with dashed lines. A click pins the tooltip with the link to the
// chart of that timeframe, a second click or Enter opens it (once), a double click opens at most one, a press that
// slips opens none. The day tooltip lists exactly the labels written at that day, with the prices rounded to the
// coin's price step and no sentence for a day without labels; the date under the crosshair hides an axis label
// within 4 px of it.
//   node tooltips.cjs --base http://127.0.0.1:8911/ --out <dir> --repo <repoDir>
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const Q = require('../lib/qa.cjs'), { Model, iso, FAM_NAME } = require('../lib/model.cjs'), { scales } = require('../lib/verify.cjs'), P = require('../lib/paint.cjs');
const A = Q.args();
const WEEK = ['일', '월', '화', '수', '목', '금', '토'], wd = (d) => WEEK[new Date(d * 864e5).getUTCDay()];
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const spanText = (s, e) => (s === e ? iso(s) : iso(s).slice(0, 4) === iso(e).slice(0, 4) ? `${iso(s)} ~ ${iso(e).slice(5)}` : `${iso(s)} ~ ${iso(e)}`);
const tvUrl = (usd, tf) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(usd)}&interval=${tf.replace(/^1(?=[DWM]$)/, '')}`;
const R_NOTE = 'r은 셋업이 18 이상 이어진 뒤에 나온 13이라는 표시입니다.';
const GONE_NOTE = /^TradingView 차트에서는 지워진 라벨입니다\. 지표는 차트마다 라벨을 최근 (\d+)개까지만 남깁니다\.$/;

(async () => {
  const M = new Model(A.expect), C = new Q.Check('c07_tooltips'), repo = A.repo || M.E.repo;
  // ---- the dump, and that the expectations are the dump ----
  const dumpDir = path.join(A.out, 'dump');
  fs.rmSync(dumpDir, { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(repo, 'scripts/td-dump.mjs'), '--out', dumpDir, '--tickers', M.slugs().map((s) => M.coin(s).usd).join(',')], { stdio: 'pipe' });
  const DUMP = {};   // slug -> tf -> [{ start, kind, dir, family, text, extra }] of the kinds the chart shows, in the engine's order
  for (const slug of M.slugs()) {
    DUMP[slug] = {};
    for (const T of M.coin(slug).tfs) {
      const file = path.join(dumpDir, `${M.coin(slug).usd.replace(/[^A-Za-z0-9.]+/g, '_')}__${T.tf}.tsv`);
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('L\t')).map((l) => { const a = l.split('\t'); return { start: a[1], kind: a[2], dir: Number(a[3]), family: a[4] === '-' ? null : Number(a[4]), text: a[5], extra: a[6] }; });
      const shown = lines.filter((l) => (l.kind === 'S' && l.text.startsWith('9')) || l.kind === 'C' || (l.kind === 'I' && l.text.startsWith('+')));
      DUMP[slug][T.tf] = shown;
      C.count('dumpLabels', shown.length);
      if (shown.length !== T.labels.length) { C.fail(`[${slug} ${T.tf}] the dump has ${shown.length} labels of the kinds shown, the expectations ${T.labels.length}`); continue; }
      T.labels.forEach((L, i) => { const d = shown[i], extra = L.kind === 'S' ? String(L.raw) : L.origins.map(iso).join(','); if (d.start !== iso(L.s) || d.kind !== L.kind || d.dir !== L.dir || d.family !== L.f || d.text !== L.text || d.extra !== extra) C.fail(`[${slug} ${T.tf}] label ${i}: dump ${JSON.stringify(d)}, expectations ${iso(L.s)} ${L.kind} ${L.dir} ${L.f} ${L.text} ${extra}`); L.dump = d; });
    }
  }
  const dumpOf = (slug, E) => DUMP[slug][E.tf][M.coin(slug).tfs[E.j].labels.findIndex((x) => x.k === E.k)];

  await Promise.all(M.slugs().map(async (slug) => {
    const coin = M.coin(slug), all = M.all[slug], ctx = await Q.open(A.base, { hash: '#chart-a-' + slug });
    const { page } = ctx, rnd = Q.rng(slug === 'btc' ? 7 : 8), dark = false;
    let st = { ...Q.DEFAULT_STATE };
    const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
    const done = new Set(), perTf = {};
    const price = (v) => { const [i, f] = v.toFixed(coin.decimals).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); };
    // what a label is, in the page's words, from the dump
    const whatOf = (d, raw) => {
      const side = d.dir === 1 ? '매도' : '매수';
      if (d.kind === 'C') return `${FAM_NAME[d.family]} ${side} 쪽 13 완성`;
      if (d.kind === 'I') return `${FAM_NAME[d.family]} ${side} 쪽 13이 미뤄진 봉`;
      return raw >= 18 ? `${side} 쪽 반복 9 (셋업 ${raw})` : `${side} 쪽 셋업 9${d.text === '9*' ? ' (퍼펙트)' : ''}`;
    };
    // the tooltip of one number shown in the picture `s` (as a number or as a mark)
    const checkLabel = async (s, L, E, how) => {
      const p = s.probe, d = dumpOf(slug, E), name = `[${slug}] ${E.tf} "${E.text}" of bar ${iso(E.s)} (day ${iso(E.day)})`;
      await page.mouse.move(s.rc.x + L.x + L.w / 2, s.rc.y + L.y + L.h / 2);
      const got = await page.evaluate(`(() => { const t = ${Q.TIP_JS}; const cv = document.querySelector('.bec-chart canvas.bec-over'); return { t, over: __qa.frame(cv) }; })()`);
      const t = got.t, ov = P.parseOver(got.over);
      if (!t) { C.fail(`${name}: no tooltip when pointed at (${how})`); return; }
      C.count('labelTooltips'); perTf[E.tf] = (perTf[E.tf] || 0) + 1; done.add(E.id);
      // line 1: the number as drawn, and what it is
      const r = t.rows[0];
      if (!r || !r.num) { C.fail(`${name}: no number in the tooltip's first line ("${t.text.slice(0, 60)}")`); return; }
      if (r.num.text !== d.text || r.num.sup !== E.tf) C.fail(`${name}: the tooltip shows "${r.num.text}" with superscript "${r.num.sup}", the dump "${d.text}"`);
      if (r.num.color !== rgb(M.colorOf(E, dark))) C.fail(`${name}: the tooltip's number is ${r.num.color}, its color ${rgb(M.colorOf(E, dark))}`);
      if (r.rest !== `· ${whatOf(d, Number(d.extra))}`) C.fail(`${name}: the tooltip's first line says "${r.rest}"; the dump: ${d.kind}, dir ${d.dir}, family ${d.family}, "${d.text}"${d.kind === 'S' ? ', raw setup ' + d.extra : ''} ("· ${whatOf(d, Number(d.extra))}")`);
      // line 2: its bar
      const r2 = t.rows[1], m2 = r2 && /^(\d+[DWM]) 봉 (\d{4}-\d\d-\d\d)(?: ~ ((?:\d{4}-)?\d\d-\d\d))?$/.exec(r2.text);
      if (!m2 || r2.num) C.fail(`${name}: the tooltip's second line is "${r2 && r2.text}", expected its bar ("${E.tf} 봉 ${spanText(E.s, E.e)}")`);
      else {
        if (m2[1] !== E.tf) C.fail(`${name}: the tooltip is of timeframe ${m2[1]}`);
        if (m2[2] !== d.start) C.fail(`${name}: the tooltip's bar starts ${m2[2]}, the dump's ${d.start}`);
        if (r2.text !== `${E.tf} 봉 ${spanText(E.s, E.e)}`) C.fail(`${name}: the tooltip's bar is "${r2.text}"; bars.js has ${iso(E.s)} ~ ${iso(E.e)}`);
      }
      if (E.span[1] !== E.e) C.count('barsFollowedByAGap');   // the next bar of the timeframe starts later than the day after (TradingView has no bar in between)
      // line 3: the origin bars of a 13 (or of a +13), as the dump has them
      const r3 = t.rows[2];
      if (d.kind === 'S') { if (r3) C.fail(`${name}: a 9 with a third line "${r3.text}"`); }
      else {
        const m3 = r3 && /^출발 봉 ([\d\-, ]+)$/.exec(r3.text);
        if (!m3) C.fail(`${name}: the tooltip's third line is "${r3 && r3.text}", expected its origin bars ("출발 봉 ${d.extra.split(',').join(', ')}")`);
        else {
          if (m3[1].split(', ').join(',') !== d.extra) C.fail(`${name}: origin bars "${m3[1]}" in the tooltip, "${d.extra}" in the dump`);
          C.count('originsCompared', d.extra.split(',').length);
          if (d.kind === 'C') { const xn = /x(\d+)$/.exec(d.text); if ((xn ? Number(xn[1]) : 1) !== d.extra.split(',').length) C.fail(`${name}: "${d.text}" with ${d.extra.split(',').length} origins in the dump`); }
        }
      }
      if (t.rows.length > (d.kind === 'S' ? 2 : 3)) C.fail(`${name}: the tooltip has ${t.rows.length} lines: "${t.rows.map((x) => x.text).join(' | ')}"`);
      // sentences: where it stands (only when it was moved to an earlier day), what r means, deleted on TradingView
      const notes = t.notes.slice(), take = (re) => { const i = notes.findIndex((x) => (re instanceof RegExp ? re.test(x) : x === re)); return i < 0 ? null : notes.splice(i, 1)[0]; };
      const pos = take(/^봉의 마지막 날 /);
      if (E.day !== E.e) {
        const m = pos && /^봉의 마지막 날 (\d{4}-\d\d-\d\d)에는 일봉이 없어서, 숫자는 (\d{4}-\d\d-\d\d) \((.)\)에 있습니다\.$/.exec(pos);
        if (!m || Q.dayOf(m[1]) !== E.e || Q.dayOf(m[2]) !== E.day || m[3] !== wd(E.day)) C.fail(`${name}: stands at ${iso(E.day)} because ${iso(E.e)} has no daily bar; the tooltip says "${pos}"`);
        C.count('lateLabels');
      } else if (pos) C.fail(`${name}: stands at its bar's last day, but the tooltip says "${pos}"`);
      if (/숫자는 봉의 마지막 날/.test(t.text)) C.fail(`${name}: the tooltip still says where a number stands that is at its bar's last day`);
      const rn = take(R_NOTE);
      if (!!rn !== (d.kind === 'C' && /r/.test(d.text))) C.fail(`${name}: the sentence about r is ${rn ? 'written' : 'missing'} for "${d.text}"`);
      if (rn) C.count('rNotes');
      const gn = take(GONE_NOTE);
      if (!!gn !== E.gone) C.fail(`${name}: ${gn ? 'said' : 'not said'} to be deleted on TradingView; it is label ${E.k} of ${coin.tfs[E.j].labels.length} with the limit at ${coin.tfs[E.j].chartVisibleFrom}`);
      if (gn && Number(GONE_NOTE.exec(gn)[1]) !== M.E.options.labelLimit) C.fail(`${name}: "${gn}", the indicator's limit is ${M.E.options.labelLimit}`);
      if (E.gone) { C.count('goneLabels'); if (!/bec-gone/.test(r.num.cls) || r.num.opacity !== '0.55' || !/underline/.test(r.num.deco) || !/dotted/.test(r.num.deco)) C.fail(`${name}: deleted on TradingView, but the tooltip's number is drawn like the others (${r.num.cls}, opacity ${r.num.opacity}, ${r.num.deco})`); }
      else if (/bec-gone/.test(r.num.cls)) C.fail(`${name}: on TradingView's chart, but the tooltip's number is drawn as deleted`);
      if (notes.length) C.fail(`${name}: the tooltip also says "${notes.join(' | ')}"`);
      if (t.links.length || t.pin || /누르면/.test(t.text)) C.fail(`${name}: a tooltip that is only pointed at has a link or takes the pointer: "${t.text.slice(-50)}"`);
      // beside the stack: it covers no number of this day and side
      const mine = p.labels.filter((x) => x.shown === 'text' && x.day === L.day && x.dir === L.dir);
      for (const x of mine) { const bx = { x: s.rc.x + x.x, y: s.rc.y + x.y, w: x.w, h: x.h }; if (P.hit(bx, t.box)) { C.fail(`${name}: its tooltip (${JSON.stringify(t.box)}) covers ${x.tf} "${x.text}" of the same day and side (${JSON.stringify(bx)})`); break; } }
      C.count('tooltipsBesideTheStack');
      // the band over the bar's days
      const { X } = scales(p), xa = Math.max(p.plot.l, X(E.s) - p.ppd / 2), xb = Math.min(p.plot.r, X(E.e) + p.ppd / 2), band = ov.rects.find((q) => q.fs === s.theme.accent && q.h > 100 && q.w > 1.5) || ov.rects.find((q) => q.fs === s.theme.accent && q.h > 100);
      if (xb > xa && (!band || Math.abs(band.x - xa) > 0.01 || Math.abs(band.x + band.w - xb) > 0.01)) C.fail(`${name}: the band over its bar is painted x ${band ? band.x.toFixed(2) + '..' + (band.x + band.w).toFixed(2) : 'nowhere'}, the bar's days ${iso(E.s)}~${iso(E.e)} are x ${xa.toFixed(2)}..${xb.toFixed(2)}`);
      else C.count('barBands');
      // the origin bars of a 13: a dashed line each, where the bar lies inside the window
      const dashes = ov.lines.filter((q) => q.vertical && q.dash.length && Math.abs(Math.min(q.y1, q.y2) - p.plot.t) < 0.01 && Math.abs(Math.max(q.y1, q.y2) - p.plot.b) < 0.01);
      if (d.kind === 'S') { if (dashes.length) C.fail(`${name}: a 9 with ${dashes.length} dashed origin lines`); }
      else {
        const T2 = coin.tfs[E.j], spans = E.origins.map((sd) => [sd, T2.end[T2.start.indexOf(sd)]]);
        const inside = spans.filter(([a, b]) => a >= p.d0 && b <= p.d1), touching = spans.filter(([a, b]) => b >= p.d0 && a <= p.d1);
        for (const [a, b] of inside) { C.count('originLines'); if (!dashes.some((q) => q.x1 >= X(a) - p.ppd / 2 - 1.01 && q.x1 <= X(b) + p.ppd / 2 + 1.01)) C.fail(`${name}: its origin bar ${iso(a)}~${iso(b)} is inside the window, no dashed line marks it (lines at x ${dashes.map((q) => q.x1).join(', ') || 'none'})`); }
        if (dashes.length > touching.length) C.fail(`${name}: ${dashes.length} dashed origin lines, ${touching.length} of its origin bars touch the window`);
        for (const q of dashes) if (!touching.some(([a, b]) => q.x1 >= X(a) - p.ppd / 2 - 1.01 && q.x1 <= X(b) + p.ppd / 2 + 1.01)) C.fail(`${name}: a dashed line at x ${q.x1} is at none of its origin bars`);
      }
    };
    const pairUp = (p) => { const key = (L) => Model.key(L), by = new Map(); for (const E of M.inWindow(slug, st, p.d0, p.d1)) (by.get(E.key) || by.set(E.key, []).get(E.key)).push(E); const out = []; const used = new Map(); for (const L of p.labels) { const a = by.get(key(L)); if (!a) continue; const i = used.get(key(L)) || 0; used.set(key(L), i + 1); out.push([L, a[Math.min(i, a.length - 1)]]); } return out; };

    // ---- 1. per timeframe alone: labels spread over its history ----
    await Q.preset(page, '3개월');
    const PER_TF = A.quick ? 6 : 34;
    for (const T of coin.tfs) {
      const mine = all.filter((L) => L.tf === T.tf); if (!mine.length) continue;
      await set({ off: M.TFS.filter((t) => t !== T.tf), def: 'on', nine: 'on', dir: 'both', fam: [0, 2, 3] });
      // the rare kinds first, then a spread
      const want = [...mine.filter((L) => L.day !== L.e), ...mine.filter((L) => /x\d/.test(L.text)).slice(0, 4), ...mine.filter((L) => /r/.test(L.text)).slice(0, 3), ...mine.filter((L) => L.gone).slice(0, 3), ...mine.filter((L) => L.rep).slice(0, 3), ...mine.filter((L) => L.kind === 'I').slice(0, 3)];
      while (want.length < Math.min(mine.length, PER_TF)) want.push(mine[Math.floor(rnd() * mine.length)]);
      let n = 0;
      for (const target of want) {
        if (done.has(target.id)) continue; if (n >= PER_TF + 12) break;
        await Q.centerOn(page, target.day);
        const s = await Q.snap(page, { nobase: true });
        for (const [L, E] of pairUp(s.probe)) { if (L.shown !== 'text' || done.has(E.id)) continue; if (E.id !== target.id && rnd() < 0.5) continue; await checkLabel(s, L, E, 'timeframe alone'); n++; }
      }
    }
    await set({ ...Q.DEFAULT_STATE });
    // ---- 2. in the full picture: dense windows, every number shown; a wide window, numbers shown as marks ----
    for (const [name, when] of [['6개월', slug === 'btc' ? '2017-12-01' : '2021-05-01'], ['1년', slug === 'btc' ? '2021-02-01' : '2018-01-01'], ['2년', '2024-12-20'], ['6개월', null]]) {
      await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when));
      const s = await Q.snap(page, { nobase: true });
      let k = 0; for (const [L, E] of pairUp(s.probe)) { if (L.shown !== 'text') continue; if (k++ > (A.quick ? 10 : 60)) break; await checkLabel(s, L, E, 'full picture ' + name); }
    }
    {
      await Q.preset(page, '5년'); const s = await Q.snap(page, { nobase: true });
      // (marks whose 3 px are not shared with another mark: the pointer is then surely on this one)
      const marks = pairUp(s.probe).filter(([L]) => L.shown === 'mark'), lone = marks.filter(([L]) => !marks.some(([o]) => o !== L && Math.abs(o.x - L.x) < 5 && Math.abs(o.y - L.y) < 6));
      let k = 0; for (const [L, E] of lone) { if (k++ >= (A.quick ? 6 : 30)) break; await checkLabel(s, L, E, 'a mark at 5년'); C.count('markTooltips'); }
    }
    C.note(`${slug}: tooltips of ${done.size} different numbers; per timeframe ${M.TFS.map((t) => `${t} ${perTf[t] || 0}`).join(', ')}`);
    C.ok(done.size >= (A.quick ? 40 : 200), `[${slug}] only ${done.size} different numbers had their tooltip compared`);
    for (const T of coin.tfs) if (T.labels.length && !perTf[T.tf]) C.fail(`[${slug}] no tooltip was compared on ${T.tf}, which has ${T.labels.length} labels`);

    // ---- 3. day tooltips: exactly the labels written at that day ----
    const dayTip = async (s, day, tag) => {
      const p = s.probe, { X, Y } = scales(p), has = M.hasBar(slug, day), o = has ? M.ohlc(slug, day) : null;
      // a point of the day's column that is on no number, chip or mark: the middle of its candle, or the middle of the plot
      const x = X(day), y = has ? (Y(o.h) + Y(o.l)) / 2 : (p.plot.t + p.plot.b) / 2;
      if ([...p.labels.filter((b) => b.w > 0), ...p.folds].some((b) => x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2)) { C.count('daysSkippedUnderABox'); return; }
      await page.mouse.move(s.rc.x + x, s.rc.y + Math.max(p.plot.t + 1, Math.min(p.plot.b - 1, y)));
      const got = await page.evaluate(`(() => { const t = ${Q.TIP_JS}; const cv = document.querySelector('.bec-chart canvas.bec-over'); return { t, over: __qa.frame(cv) }; })()`);
      const t = got.t, name = `[${slug} ${tag}] day ${iso(day)}`;
      if (!t) { C.fail(`${name}: no tooltip`); return; }
      const h = /^(\d{4}-\d\d-\d\d) \((.)\)$/.exec(t.kids[0].text);
      if (!h) { C.fail(`${name}: tooltip heading "${t.kids[0].text}"`); return; }
      C.count('dayTooltips');
      let a = Q.dayOf(h[1]), b = a;
      const many = /화면의 이 한 칸에는 (\d{4}-\d\d-\d\d)부터 (\d{4}-\d\d-\d\d)까지 (\d+)일이 겹쳐 있습니다\./.exec(t.text);
      if (many) { a = Q.dayOf(many[1]); b = Q.dayOf(many[2]); if (b - a + 1 !== Number(many[3]) || Q.dayOf(h[1]) < a || Q.dayOf(h[1]) > b) C.fail(`${name}: "${many[0]}" around ${h[1]}`); C.count('dayTooltipsOfSeveralDays'); }
      if (p.ppd >= 1 ? Q.dayOf(h[1]) !== day || many : Math.abs(Q.dayOf(h[1]) - day) > Math.ceil(1 / p.ppd) + 1) C.fail(`${name}: the tooltip is of ${h[1]}${many ? ' (' + many[0] + ')' : ''} at ${p.ppd.toFixed(2)} px a day`);
      const hd = Q.dayOf(h[1]);
      if (h[2] !== wd(hd)) C.fail(`${name}: ${h[1]} is a ${wd(hd)}, the tooltip says ${h[2]}`);
      if (M.hasBar(slug, hd)) {
        // open, high, low, close as TradingView's price scale writes them: rounded to the coin's price step
        const v = M.ohlc(slug, hd), want = `시 ${price(v.o)} 고 ${price(v.h)} 저 ${price(v.l)} 종 ${price(v.c)}`, gotP = ((t.rows[0] || {}).cells || []).join(' ');
        if (gotP !== want) C.fail(`${name}: prices "${gotP}"; the data has ${JSON.stringify(v)}, which is "${want}" at a price step of ${coin.tick}`);
        C.count('dayPrices', 4);
        if ([v.o, v.h, v.l, v.c].some((x2) => Number(x2.toFixed(coin.decimals)) !== x2)) C.count('dayPricesRounded');
      }
      else if (!t.notes.includes('이 날짜에는 TradingView 일봉이 없습니다.')) C.fail(`${name}: ${h[1]} has no daily bar, the tooltip does not say so`);
      const exp = all.filter((L) => L.day >= a && L.day <= b && M.selected(L, st)), rows = t.rows.filter((r) => r.inSec && r.num), more = t.notes.map((x2) => /^(\d+)개가 더 있습니다\.$/.exec(x2)).find(Boolean);
      if (rows.length + (more ? Number(more[1]) : 0) !== exp.length) C.fail(`${name}: the tooltip lists ${rows.length}${more ? ' + ' + more[1] : ''} labels, ${exp.length} are written at ${a === b ? 'that day' : iso(a) + '~' + iso(b)}: ${exp.map((L) => L.tf + ' ' + L.text).join(', ')}`);
      // no sentence for a day without labels
      if (!exp.length) { C.count('daysWithoutLabels'); const extra = t.notes.filter((x2) => !/^이 날짜에는 TradingView 일봉이 없습니다\.$/.test(x2) && !/^화면의 이 한 칸에는/.test(x2)); if (extra.length || /없습니다/.test(t.text.replace('이 날짜에는 TradingView 일봉이 없습니다.', ''))) C.fail(`${name}: no label at that day, but the tooltip says "${extra.join(' | ') || t.text.slice(-40)}"`); }
      rows.forEach((r, i) => {
        const E = exp[i]; if (!E) return; C.count('dayTooltipRows');
        const what = E.kind === 'C' ? `${FAM_NAME[E.f]} ${E.dir === 1 ? '매도' : '매수'} 쪽 13 완성` : E.kind === 'I' ? `${FAM_NAME[E.f]} ${E.dir === 1 ? '매도' : '매수'} 쪽 13이 미뤄진 봉` : `${E.dir === 1 ? '매도' : '매수'} 쪽 ${E.rep ? '반복 9' : '셋업 9'}`;
        if (r.num.text !== E.text || r.num.sup !== E.tf || r.num.color !== rgb(M.colorOf(E, dark)) || !r.rest.startsWith(what) || !r.rest.endsWith(`${E.tf} 봉 ${spanText(E.s, E.e)}`)) C.fail(`${name}: row ${i + 1} is "${r.num.text}" ${r.num.sup} ${r.num.color} "${r.rest}"; the label written there is ${E.tf} "${E.text}" (${what}, bar ${spanText(E.s, E.e)})`);
        if (E.gone !== /bec-gone/.test(r.num.cls)) C.fail(`${name}: row ${i + 1} (${E.tf} "${E.text}") is ${/bec-gone/.test(r.num.cls) ? '' : 'not '}drawn as deleted; the label is ${E.gone ? 'deleted on TradingView' : 'on the chart'}`);
      });
      // the date under the crosshair hides an axis label within 4 px of it, and no other
      const ov = P.parseOver(got.over), tag2 = ov.rects.find((q) => q.fs === s.theme.fg && q.y > p.plot.b && q.h >= 10 && q.w > 30);
      if (!tag2 || !ov.texts.some((q) => q.text === iso(hd))) C.fail(`${name}: no date under the crosshair`);
      else {
        for (const dl of s.axisDates) {
          const nearTag = dl.x < tag2.x + tag2.w + 4 && tag2.x - 4 < dl.x + dl.w, hidden = ov.rects.some((q) => q.fs === s.theme.surface && q.x <= dl.x + 0.01 && q.x + q.w >= dl.x + dl.w - 0.01 && q.y <= dl.y + 0.01 && q.y + q.h >= dl.y + dl.h - 0.01) || (tag2.x <= dl.x + 0.01 && tag2.x + tag2.w >= dl.x + dl.w - 0.01);
          if (nearTag) { C.count('axisLabelsHiddenUnderTheDate'); if (!hidden) C.fail(`${name}: the axis label "${dl.text}" (x ${dl.x.toFixed(1)}..${(dl.x + dl.w).toFixed(1)}) is within 4 px of the date under the crosshair (x ${tag2.x.toFixed(1)}..${(tag2.x + tag2.w).toFixed(1)}) and is not hidden`); }
          else if (hidden) C.fail(`${name}: the axis label "${dl.text}" is hidden although the date under the crosshair is ${Math.max(dl.x - tag2.x - tag2.w, tag2.x - dl.x - dl.w).toFixed(1)} px away`);
        }
      }
    };
    for (const [name, when, toggles] of [['3개월', null, {}], ['6개월', slug === 'btc' ? '2017-12-01' : '2021-05-01', { def: 'on' }], ['3개월', slug === 'btc' ? '2011-02-01' : '2016-03-01', { def: 'on' }], ['6개월', slug === 'btc' ? '2023-11-01' : '2018-06-01', {}], ['1년', '2020-03-15', {}], ['2년', '2024-12-20', { dir: 'sell' }], ['5년', null, {}], ['전체', null, { fam: [0, 3] }]]) {
      await set({ ...Q.DEFAULT_STATE, ...toggles }); await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when));
      await Q.mouseOff(page);
      const s = await Q.snap(page), p = s.probe, step = Math.max(1, Math.floor((p.d1 - p.d0 + 1) / (A.quick ? 12 : 70)));
      s.axisDates = P.parseChart(s.frames.cBase, s.theme).dates.map((q) => ({ text: q.text, ...P.inkBox(q) }));
      const days = new Set(); for (let d = p.d0; d <= p.d1; d += step) days.add(d);
      // and the days that carry the most labels, and the days right at the axis labels
      const cnt = new Map(); for (const L of M.inWindow(slug, st, p.d0, p.d1)) cnt.set(L.day, (cnt.get(L.day) || 0) + 1);
      [...cnt].sort((x, y) => y[1] - x[1]).slice(0, 12).forEach(([d]) => days.add(d));
      for (const dl of s.axisDates.slice(0, 6)) for (const off of [-40, -30, 0, 30, 40]) { const d = p.d0 + Math.floor((dl.x + dl.w / 2 + off - p.plot.x0) / p.ppd); if (d >= p.d0 && d <= p.d1) days.add(d); }
      for (const d of [...days].sort((x, y) => x - y)) await dayTip(s, d, name + (when ? ' @' + when : ''));
    }
    await Q.mouseOff(page);
    await set({ ...Q.DEFAULT_STATE });

    // ---- 4. a click pins the tooltip; the second click or Enter opens the chart; a double click, a slipping press ----
    await Q.preset(page, '6개월'); await Q.mouseOff(page);
    {
      const s = await Q.snap(page, { nobase: true }), p = s.probe, opens = () => page.evaluate(() => __qa.opens.length), since = (n) => page.evaluate((k) => __qa.opens.slice(k), n);
      const nums = pairUp(p).filter(([L]) => L.shown === 'text'), [L, E] = nums[0], [L2, E2] = nums[nums.length - 1], at = (q) => [s.rc.x + q.x + q.w / 2, s.rc.y + q.y + q.h / 2];
      const url = tvUrl(coin.usd, E.tf);
      // one click: pinned, with the link row; nothing opened; the tooltip stays when the pointer leaves
      let n0 = await opens(); await page.mouse.click(...at(L));
      let t = await Q.tip(page);
      C.ok((await opens()) === n0 && t && t.pin && t.links.length === 1 && t.links[0].text === `TradingView ${E.tf} 차트 ↗` && t.links[0].href === url && t.links[0].target === '_blank', `[${slug}] a click on ${E.tf} "${E.text}" did not pin its tooltip with the link row: opened ${(await opens()) - n0}, tooltip ${t ? `"${t.text.slice(-28)}" pinned ${t.pin}, links ${JSON.stringify(t.links)}` : 'none'}`);
      C.ok((await Q.snap(page, { nobase: true })).probe.pinned === 'label', `[${slug}] the probe does not say that a number is pinned`);
      await page.mouse.move(s.rc.x + p.plot.l + 5, s.rc.y + p.plot.t + 5); await page.mouse.move(2, 2);
      t = await Q.tip(page); C.ok(t && t.pin && t.rows[0] && t.rows[0].num && t.rows[0].num.sup === E.tf, `[${slug}] the pinned tooltip left with the pointer`);
      // the second click opens the chart, once
      await page.mouse.click(...at(L));
      let op = await since(n0); C.ok(op.length === 1 && op[0].url === url && /noopener/.test(op[0].features), `[${slug}] the second click on ${E.tf} "${E.text}" opened ${JSON.stringify(op)}`);
      // Enter on the pinned number opens it too
      await page.focus('.bec-chart canvas.bec-over'); n0 = await opens(); await page.keyboard.press('Enter');
      op = await since(n0); C.ok(op.length === 1 && op[0].url === url, `[${slug}] Enter on the pinned ${E.tf} "${E.text}" opened ${JSON.stringify(op)}`);
      // Esc lets it go
      await page.keyboard.press('Escape'); t = await Q.tip(page); C.ok(t === null && (await Q.snap(page, { nobase: true })).probe.pinned === null, `[${slug}] Esc did not let the pinned tooltip go`);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      // a click elsewhere lets it go as well
      await page.mouse.click(...at(L)); await page.mouse.click(s.rc.x + p.plot.l + 30, s.rc.y - 14); t = await Q.tip(page);
      C.ok(t === null, `[${slug}] a click outside the chart left the pinned tooltip`);
      // a double click on a number: at most one chart, the window stays
      n0 = await opens(); await page.mouse.dblclick(...at(L2));
      const z = await Q.snap(page, { nobase: true }); op = await since(n0);
      C.ok(op.length <= 1 && z.probe.d0 === p.d0 && z.probe.d1 === p.d1, `[${slug}] a double click on ${E2.tf} "${E2.text}" opened ${op.length} charts; window ${iso(z.probe.d0)}~${iso(z.probe.d1)}`);
      C.count('doubleClicks'); C.count('chartsOpenedByADoubleClick', op.length);
      await page.mouse.click(s.rc.x + p.plot.l + 30, s.rc.y - 14); await page.waitForTimeout(350);
      // a press that slips 3 px is no click: nothing is pinned, nothing opens (twice, as the two presses of a careless double click)
      n0 = await opens();
      for (let k = 0; k < 2; k++) { const [x, y] = at(L); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 3, y + 1); await page.mouse.up(); }
      const z2 = await Q.snap(page, { nobase: true });
      C.ok((await opens()) === n0 && z2.probe.pinned === null && z2.probe.d0 === p.d0, `[${slug}] a press that slipped 3 px on ${E.tf} "${E.text}": opened ${(await opens()) - n0}, pinned ${z2.probe.pinned}`);
      await Q.mouseOff(page);
    }
    C.logs(ctx, slug);
    await ctx.context.close();
  }));
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('tooltips.cjs crashed:', e); process.exit(3); });
