// Check 7: tooltips against the engine dump (scripts/td-dump.mjs). For a sample of numbers over all timeframes: the
// timeframe, the bar's dates, the side, the family, the text and the origin bars are the dump's; the band the page
// lays over the bar's days is the bar; the day tooltip lists exactly the labels written at that day.
//   node tooltips.cjs --base http://127.0.0.1:8911/ --out <dir> --repo <repoDir>
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const Q = require('../lib/qa.cjs'), { Model, iso, FAM_NAME } = require('../lib/model.cjs'), { scales } = require('../lib/verify.cjs');
const A = Q.args();
const WEEK = ['일', '월', '화', '수', '목', '금', '토'], wd = (d) => WEEK[new Date(d * 864e5).getUTCDay()];
const num = (t) => Number(String(t).replace(/,/g, ''));
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const spanOf = (a, b) => { const s = Q.dayOf(a); return [s, b ? Q.dayOf(b.length === 5 ? a.slice(0, 5) + b : b) : s]; };

(async () => {
  const M = new Model(A.expect), C = new Q.Check('c07_tooltips'), repo = A.repo || M.E.repo, rounded = new Set();
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
    const { page } = ctx, rnd = Q.rng(slug === 'btc' ? 7 : 8);
    let st = { ...Q.DEFAULT_STATE };
    const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
    const done = new Set(), perTf = {};
    // the tooltip of one number shown in the picture `s`
    const checkLabel = async (s, L, E, how) => {
      const p = s.probe, d = dumpOf(slug, E), name = `[${slug}] ${E.tf} "${E.text}" of bar ${iso(E.s)} (day ${iso(E.day)})`;
      await page.mouse.move(s.rc.x + L.x + L.w / 2, s.rc.y + L.y + L.h / 2);
      const got = await page.evaluate(`(() => { const t = ${Q.TIP_JS}; const cv = document.querySelector('.bec-chart canvas.bec-over'); return { t, over: __qa.frame(cv).calls.filter((c) => c.op === 'fr').map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, fs: c.fs, al: c.al })) }; })()`);
      const t = got.t;
      if (!t) { C.fail(`${name}: no tooltip when pointed at (${how})`); return; }
      C.count('labelTooltips'); perTf[E.tf] = (perTf[E.tf] || 0) + 1; done.add(E.id);
      const h1 = t.kids[0], m1 = h1 && /^(\d+[DWM]) 봉 (\d{4}-\d\d-\d\d)(?: ~ ((?:\d{4}-)?\d\d-\d\d))?$/.exec(h1.text);
      if (!m1) { C.fail(`${name}: tooltip heading "${h1 && h1.text}"`); return; }
      const [s0, e0] = spanOf(m1[2], m1[3]);
      if (m1[1] !== E.tf) C.fail(`${name}: the tooltip is of timeframe ${m1[1]}`);
      if (m1[2] !== d.start) C.fail(`${name}: the tooltip's bar starts ${m1[2]}, the dump's ${d.start}`);
      if (e0 !== E.e) C.fail(`${name}: the tooltip's bar ends ${iso(e0)}; bars.js ${iso(E.e)}`);
      if (E.span[1] !== E.e) C.count('barsFollowedByAGap');   // the next bar of the timeframe starts later than the day after (TradingView has no bar in between)
      const r = t.rows[0];
      if (!r || !r.num) { C.fail(`${name}: no number in the tooltip`); return; }
      if (r.num.text !== d.text || r.num.sup !== E.tf) C.fail(`${name}: the tooltip shows "${r.num.text}" with superscript "${r.num.sup}", the dump "${d.text}"`);
      if (r.num.color !== rgb(M.colorOf(E))) C.fail(`${name}: the tooltip's number is ${r.num.color}, its color ${rgb(M.colorOf(E))}`);
      const side = d.dir === 1 ? '매도' : '매수';
      if (d.kind === 'C') {
        const m = /^(Sequential|Aggressive Sequential|Combo|Aggressive Combo) (매수|매도) 쪽 13 완성( \(r: 셋업 18 이상 뒤\))? · 출발 봉 ([\d\-, ]+)$/.exec(r.rest);
        if (!m) C.fail(`${name}: tooltip line "${r.rest}"`);
        else {
          if (FAM_NAME.indexOf(m[1]) !== d.family) C.fail(`${name}: tooltip family ${m[1]}, the dump's ${d.family}`);
          if (m[2] !== side) C.fail(`${name}: tooltip side ${m[2]}, the dump's dir ${d.dir}`);
          if (!!m[3] !== /r/.test(d.text)) C.fail(`${name}: the r note is ${m[3] ? 'written' : 'missing'} for "${d.text}"`);
          if (m[4].split(', ').join(',') !== d.extra) C.fail(`${name}: origin bars "${m[4]}" in the tooltip, "${d.extra}" in the dump`);
          C.count('originsCompared', d.extra.split(',').length);
          const xn = /x(\d+)$/.exec(d.text); if ((xn ? Number(xn[1]) : 1) !== d.extra.split(',').length) C.fail(`${name}: "${d.text}" with ${d.extra.split(',').length} origins in the dump`);
        }
      } else if (d.kind === 'I') {
        const m = /^(Sequential|Aggressive Sequential|Combo|Aggressive Combo) (매수|매도) 쪽 13이 미뤄진 봉 · 출발 봉 (\d{4}-\d\d-\d\d)$/.exec(r.rest);
        if (!m || FAM_NAME.indexOf(m[1]) !== d.family || m[2] !== side || m[3] !== d.extra) C.fail(`${name}: tooltip line "${r.rest}", the dump: family ${d.family}, dir ${d.dir}, origin ${d.extra}`);
        C.count('originsCompared');
      } else {
        const raw = Number(d.extra), m = /^(매수|매도) 쪽 (?:셋업 9( \(퍼펙트\))?|반복 9 \(셋업 (\d+)\))$/.exec(r.rest);
        if (!m || m[1] !== side || (raw >= 18 ? Number(m[3]) !== raw : m[3] !== undefined) || (raw < 18 && !!m[2] !== (d.text === '9*'))) C.fail(`${name}: tooltip line "${r.rest}", the dump: dir ${d.dir}, raw setup ${raw}, text ${d.text}`);
      }
      // where it stands
      const pos = t.rows.slice(1).map((x) => x.rest).find((x) => /숫자는/.test(x)) || null;
      if (E.day !== E.e) {
        const m = pos && /^봉의 마지막 날 (\d{4}-\d\d-\d\d)에는 일봉이 없어서, 숫자는 (\d{4}-\d\d-\d\d) \((.)\) 자리에 있습니다\.$/.exec(pos);
        if (!m || Q.dayOf(m[1]) !== E.e || Q.dayOf(m[2]) !== E.day || m[3] !== wd(E.day)) C.fail(`${name}: stands at ${iso(E.day)} because ${iso(E.e)} has no daily bar; the tooltip says "${pos}"`);
        C.count('lateLabels');
      } else if (E.s !== E.e) {
        const m = pos && /^숫자는 봉의 마지막 날 (\d{4}-\d\d-\d\d) \((.)\) 자리에 있습니다\.$/.exec(pos);
        if (!m || Q.dayOf(m[1]) !== E.day || m[2] !== wd(E.day)) C.fail(`${name}: stands at ${iso(E.day)} (${wd(E.day)}); the tooltip says "${pos}"`);
      } else if (pos) C.fail(`${name}: a one-day bar, but the tooltip says "${pos}"`);
      const gone = /TradingView 차트에서는 지워진 라벨입니다/.test(t.text);
      if (gone !== E.gone) C.fail(`${name}: ${gone ? 'said' : 'not said'} to be deleted on TradingView; it is label ${E.k} of ${coin.tfs[E.j].labels.length + 0} with the limit at ${coin.tfs[E.j].chartVisibleFrom}`);
      if (E.gone) C.count('goneLabels');
      if (!t.text.endsWith(`누르면 TradingView ${E.tf} 차트가 새 탭에서 열립니다.`)) C.fail(`${name}: tooltip ends "${t.text.slice(-40)}"`);
      // the band over the bar's days
      const { X } = scales(p), xa = Math.max(p.plot.l, X(E.s) - p.ppd / 2), xb = Math.min(p.plot.r, X(E.e) + p.ppd / 2), band = got.over.find((c) => c.fs === s.theme.accent && c.h > 100 && c.w > 1.5) || got.over.find((c) => c.fs === s.theme.accent && c.h > 100);
      if (xb > xa && (!band || Math.abs(band.x - xa) > 0.01 || Math.abs(band.x + band.w - xb) > 0.01)) C.fail(`${name}: the band over its bar is painted x ${band ? band.x.toFixed(2) + '..' + (band.x + band.w).toFixed(2) : 'nowhere'}, the bar's days ${iso(E.s)}~${iso(E.e)} are x ${xa.toFixed(2)}..${xb.toFixed(2)}`);
      else C.count('barBands');
    };
    const pairUp = (p) => { const key = (L) => Model.key(L), by = new Map(); for (const E of M.inWindow(slug, st, p.d0, p.d1)) (by.get(E.key) || by.set(E.key, []).get(E.key)).push(E); const out = []; const used = new Map(); for (const L of p.labels) { const a = by.get(key(L)); if (!a) continue; const i = used.get(key(L)) || 0; used.set(key(L), i + 1); out.push([L, a[Math.min(i, a.length - 1)]]); } return out; };

    // ---- 1. per timeframe alone: labels spread over its history ----
    await Q.preset(page, '3개월');
    const PER_TF = A.quick ? 6 : 34;
    for (const T of coin.tfs) {
      const mine = all.filter((L) => L.tf === T.tf); if (!mine.length) continue;
      await set({ off: M.TFS.filter((t) => t !== T.tf), def: 'on', nine: 'on', dir: 'both', fam: [0, 2, 3] });
      // the rare kinds first, then a spread
      const want = [...mine.filter((L) => L.day !== L.e), ...mine.filter((L) => /x\d/.test(L.text)).slice(0, 4), ...mine.filter((L) => L.gone).slice(0, 3), ...mine.filter((L) => L.rep).slice(0, 3), ...mine.filter((L) => L.kind === 'I').slice(0, 3)];
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
    // ---- 2. in the full picture: dense windows, every number shown ----
    for (const [name, when] of [['6개월', slug === 'btc' ? '2017-12-01' : '2021-05-01'], ['1년', slug === 'btc' ? '2021-02-01' : '2018-01-01'], ['2년', '2024-12-20'], ['6개월', null]]) {
      await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when));
      const s = await Q.snap(page, { nobase: true });
      let k = 0; for (const [L, E] of pairUp(s.probe)) { if (L.shown !== 'text') continue; if (k++ > (A.quick ? 10 : 60)) break; await checkLabel(s, L, E, 'full picture ' + name); }
    }
    C.note(`${slug}: tooltips of ${done.size} different numbers; per timeframe ${M.TFS.map((t) => `${t} ${perTf[t] || 0}`).join(', ')}`);
    C.ok(done.size >= (A.quick ? 40 : 200), `[${slug}] only ${done.size} different numbers had their tooltip compared`);
    for (const T of coin.tfs) if (T.labels.length && !perTf[T.tf]) C.fail(`[${slug}] no tooltip was compared on ${T.tf}, which has ${T.labels.length} labels`);

    // ---- 3. day tooltips: exactly the labels written at that day ----
    const dayTip = async (s, day, tag) => {
      const p = s.probe, { X, Y } = scales(p), has = M.hasBar(slug, day), o = has ? M.ohlc(slug, day) : null;
      // a point of the day's column that is on no number, chip or mark: the middle of its candle, or the middle of the plot
      const x = X(day), y = has ? (Y(o.h) + Y(o.l)) / 2 : (p.plot.t + p.plot.b) / 2;
      if ([...p.labels, ...p.folds].some((b) => x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2)) { C.count('daysSkippedUnderABox'); return; }
      await page.mouse.move(s.rc.x + x, s.rc.y + Math.max(p.plot.t + 1, Math.min(p.plot.b - 1, y)));
      const t = await Q.tip(page), name = `[${slug} ${tag}] day ${iso(day)}`;
      if (!t) { C.fail(`${name}: no tooltip`); return; }
      const h = /^(\d{4}-\d\d-\d\d) \((.)\)$/.exec(t.kids[0].text);
      if (!h) { C.fail(`${name}: tooltip heading "${t.kids[0].text}"`); return; }
      C.count('dayTooltips');
      let a = Q.dayOf(h[1]), b = a;
      const many = /화면의 이 한 칸에는 (\d{4}-\d\d-\d\d)부터 (\d{4}-\d\d-\d\d)까지 (\d+)일이 겹쳐 있습니다/.exec(t.text);
      if (many) { a = Q.dayOf(many[1]); b = Q.dayOf(many[2]); if (b - a + 1 !== Number(many[3]) || Q.dayOf(h[1]) < a || Q.dayOf(h[1]) > b) C.fail(`${name}: "${many[0]}" around ${h[1]}`); C.count('dayTooltipsOfSeveralDays'); }
      if (p.ppd >= 1 ? Q.dayOf(h[1]) !== day || many : Math.abs(Q.dayOf(h[1]) - day) > Math.ceil(1 / p.ppd) + 1) C.fail(`${name}: the tooltip is of ${h[1]}${many ? ' (' + many[0] + ')' : ''} at ${p.ppd.toFixed(2)} px a day`);
      const hd = Q.dayOf(h[1]);
      if (h[2] !== wd(hd)) C.fail(`${name}: ${h[1]} is a ${wd(hd)}, the tooltip says ${h[2]}`);
      if (M.hasBar(slug, hd)) {
        const v = M.ohlc(slug, hd), m = /^시 ([\d,.]+) 고 ([\d,.]+) 저 ([\d,.]+) 종 ([\d,.]+)$/.exec((t.rows[0] || {}).rest || '');
        // the data's prices; a price with more than 12 significant digits is shown rounded to 12 (counted, and said in a note)
        const same = (txt, x) => num(txt) === x || (Math.abs(num(txt) - x) <= Math.abs(x) * 5e-12 && (rounded.add(`${slug} ${iso(hd)}`), true));
        if (!m || !same(m[1], v.o) || !same(m[2], v.h) || !same(m[3], v.l) || !same(m[4], v.c)) C.fail(`${name}: prices "${(t.rows[0] || {}).rest}", the data has ${JSON.stringify(v)}`);
        C.count('dayPrices', 4);
      }
      else if (!/이 날짜에는 TradingView 일봉이 없습니다/.test(t.text)) C.fail(`${name}: ${h[1]} has no daily bar, the tooltip does not say so`);
      const exp = all.filter((L) => L.day >= a && L.day <= b && M.selected(L, st)), rows = t.rows.filter((r) => r.inSec && r.num), more = /외 (\d+)개가 더 있습니다/.exec(t.text);
      if (rows.length + (more ? Number(more[1]) : 0) !== exp.length) C.fail(`${name}: the tooltip lists ${rows.length}${more ? ' + ' + more[1] : ''} labels, ${exp.length} are written at ${a === b ? 'that day' : iso(a) + '~' + iso(b)}: ${exp.map((L) => L.tf + ' ' + L.text).join(', ')}`);
      if (!exp.length && !/놓인 9나 13이 없습니다/.test(t.text)) C.fail(`${name}: no label at that day, the tooltip does not say so`);
      rows.forEach((r, i) => {
        const E = exp[i]; if (!E) return; C.count('dayTooltipRows');
        const span = E.s === E.e ? iso(E.s) : iso(E.s).slice(0, 4) === iso(E.e).slice(0, 4) ? `${iso(E.s)} ~ ${iso(E.e).slice(5)}` : `${iso(E.s)} ~ ${iso(E.e)}`;
        const what = E.kind === 'C' ? `${FAM_NAME[E.f]} ${E.dir === 1 ? '매도' : '매수'} 쪽 13 완성` : E.kind === 'I' ? `${FAM_NAME[E.f]} ${E.dir === 1 ? '매도' : '매수'} 쪽 13이 미뤄진 봉` : `${E.dir === 1 ? '매도' : '매수'} 쪽 ${E.rep ? '반복 9' : '셋업 9'}`;
        if (r.num.text !== E.text || r.num.sup !== E.tf || r.num.color !== rgb(M.colorOf(E)) || !r.rest.startsWith(what) || !r.rest.endsWith(`${E.tf} 봉 ${span}`)) C.fail(`${name}: row ${i + 1} is "${r.num.text}" ${r.num.sup} ${r.num.color} "${r.rest}"; the label written there is ${E.tf} "${E.text}" (${what}, bar ${span})`);
      });
    };
    for (const [name, when, toggles] of [['3개월', null, {}], ['6개월', slug === 'btc' ? '2017-12-01' : '2021-05-01', { def: 'on' }], ['3개월', slug === 'btc' ? '2011-02-01' : '2016-03-01', { def: 'on' }], ['1년', '2020-03-15', {}], ['2년', '2024-12-20', { dir: 'sell' }], ['5년', null, {}], ['전체', null, { fam: [0, 3] }]]) {
      await set({ ...Q.DEFAULT_STATE, ...toggles }); await Q.preset(page, name); if (when) await Q.centerOn(page, Q.dayOf(when));
      const s = await Q.snap(page, { nobase: true }), p = s.probe, step = Math.max(1, Math.floor((p.d1 - p.d0 + 1) / (A.quick ? 12 : 70)));
      const days = new Set(); for (let d = p.d0; d <= p.d1; d += step) days.add(d);
      // and the days that carry the most labels
      const cnt = new Map(); for (const L of M.inWindow(slug, st, p.d0, p.d1)) cnt.set(L.day, (cnt.get(L.day) || 0) + 1);
      [...cnt].sort((x, y) => y[1] - x[1]).slice(0, 12).forEach(([d]) => days.add(d));
      for (const d of [...days].sort((x, y) => x - y)) await dayTip(s, d, name + (when ? ' @' + when : ''));
    }
    await Q.mouseOff(page);
    await set({ ...Q.DEFAULT_STATE });
    C.logs(ctx, slug);
    await ctx.context.close();
  }));
  if (rounded.size) C.note(`day tooltips show a price rounded to 12 significant digits where the data has more, on ${rounded.size} days looked at: ${[...rounded].slice(0, 4).join(', ')}`);
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('tooltips.cjs crashed:', e); process.exit(3); });
