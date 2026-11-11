// Check 6: 다음 봉 조건. The conditions the page shows are the engine's next-bar triggers with their distances (computed
// in Node, expect.json). The zone is a 1 px line at the last day with a small title, 120 px wide, no panel. A
// condition inside the price range has its mark at its price on the chart's scale: quiet (the number in its family
// color at about 70%, a dashed 1 px frame, no ground) beyond the 임박 threshold, framed and tinted within it, filled
// when it is met; the conditions beyond the price range are counted in one line per edge. Nothing vertical is painted
// in the zone while nothing is pointed at: the close level shows for the chip that is pointed at. Every condition is
// reachable with both of its prices (tooltip, edge line's tooltip, the list of a narrow screen). And what is WRITTEN is
// put to the engine: "조건가 60,492.4 초과" means no label for a bar that closes exactly there and a label one tick
// beyond; "이상" / "이하" mean a label at the level itself and none one tick short. Besides, without the triggers: a
// scan of closes on a grid through the engine finds the same conditions and nothing else.
//   node conds.cjs --base http://127.0.0.1:8911/ --out <dir> --repo <repoDir>
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const Q = require('../lib/qa.cjs'), { Model, iso, FAM_NAME } = require('../lib/model.cjs'), P = require('../lib/paint.cjs'), { scales, parsePrice } = require('../lib/verify.cjs');
const A = Q.args();
const num = (t) => Number(String(t).replace(/,/g, ''));
const pctOk = (text, pct) => {   // the written percent is the distance, rounded to what is shown (at least one decimal under 100%)
  if (text === '0%') return pct === 0;
  const m = /^([+−])(\d+(?:\.(\d+))?)%$/.exec(text); if (!m) return false;
  const dec = (m[3] || '').length, v = (m[1] === '−' ? -1 : 1) * Number(m[2]), a = Math.abs(pct * 100);
  if (Math.sign(v) !== Math.sign(pct)) return false;
  if (a < 100 && dec < 1) return false;
  return Math.abs(v - pct * 100) <= 0.5 * Math.pow(10, -dec) + 1e-9;
};
const priceOk = (text, v) => { const x = num(text); return x === v || Math.abs(x - v) <= Math.abs(v) * 5e-12; };
const SRC = { 시가: 'o', 고가: 'h', 저가: 'l', 종가: 'c' }, OP = { 미만: '<', 이하: '<=', 초과: '>', 이상: '>=' };
// The line that says where the bar stands: "지금 값으로 충족", or the level with its comparison and the distance,
// "조건가 60,492.4 초과 (+3.9%)", and, when the bar may close elsewhere after it has been there, the level of the close:
// "조건가 1,620.24 이하 (−24.0%) · 종가 기준 2,076.68 이하 (−2.6%)".
const FIRE = /^조건가 ([\d,.]+) (미만|이하|초과|이상) \(([+−][\d.]+%|0%)\)(?: · 종가 기준 ([\d,.]+) (미만|이하|초과|이상) \(([+−][\d.]+%|0%)\))?$/;
function parseFire(text) {
  if (text === '지금 값으로 충족') return { now: true };
  const m = FIRE.exec(text); if (!m) return null;
  return { now: false, P: num(m[1]), Ptext: m[1], Pop: OP[m[2]], Ppct: m[3], Q: m[4] ? num(m[4]) : null, Qtext: m[4] || null, Qop: m[5] ? OP[m[5]] : null, Qpct: m[6] || null };
}
// a sentence of the page back into conditions: { bar, what, all: [[src, op, v]], any: [[[src, op, v]]] | null, unless, never }
function parseSentence(text) {
  const out = { all: [], any: null, unless: null, never: false, always: false };
  let m = /^(진행 중인 봉|다음 봉)(?:의 (.+)이면|이 마감하면 가격과 상관없이) (13이|9가) 나옵니다\.(?: 다만 (?:(.+)이면 나오지 않습니다|(이번 봉에서는 나오지 않습니다))\.)?$/.exec(text);
  if (!m) return null;
  out.bar = m[1]; out.what = m[3] === '13이' ? '13' : '9';
  const cond = (t) => { const k = /^(시가|고가|저가|종가)가 ([\d,.]+) (미만|이하|초과|이상)$/.exec(t.trim()); if (!k) throw new Error(`cannot read the condition "${t}"`); return [SRC[k[1]], OP[k[3]], num(k[2])]; };
  const group = (t) => t.split('이고 ').map(cond);
  const anyOf = (t) => {
    const k = /^((?:시가|고가|저가|종가)(?:나 (?:시가|고가|저가|종가))+)가 ([\d,.]+) (미만|이하|초과|이상)$/.exec(t.trim());
    if (k) return k[1].split('나 ').map((s) => [[SRC[s], OP[k[3]], num(k[2])]]);
    return t.split('이거나 ').map(group);
  };
  if (m[2]) {
    const parts = m[2].split('이고, ');
    if (parts.length > 2) return null;
    const isAny = (t) => /이거나 /.test(t) || /^(?:시가|고가|저가|종가)나 /.test(t);
    if (parts.length === 2) { out.all = group(parts[0]); out.any = anyOf(parts[1]); } else if (isAny(parts[0])) out.any = anyOf(parts[0]); else out.all = group(parts[0]);
  } else out.always = true;
  if (m[4]) out.unless = m[4].split('이거나 ').map(group);
  if (m[5]) out.never = true;
  return out;
}
const holds = (g, b) => g.every(([s, op, v]) => (op === '<' ? b[s] < v : op === '<=' ? b[s] <= v : op === '>' ? b[s] > v : b[s] >= v));
const sentenceSays = (S, b) => !S.never && holds(S.all, b) && (!S.any || S.any.some((g) => holds(g, b))) && !(S.unless && S.unless.some((g) => holds(g, b)));
const sameConds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const META = /^(?:출발 봉 (\d{4}-\d\d-\d\d) · )?(진행 중인 봉|다음 봉) (\d{4}-\d\d-\d\d)(?: ~ ((?:\d{4}-)?\d\d-\d\d))?(?: · (\d{4}-\d\d-\d\d)까지 반영)?$/;

(async () => {
  const M = new Model(A.expect), C = new Q.Check('c06_conditions');
  const { makeEngine } = await import('../lib/recount.mjs');
  const ENG = await makeEngine(A.repo || M.E.repo);
  // the grid scan, beside the browser
  const scanFile = path.join(A.out, 'scan.json');
  const scan = new Promise((res) => { const ch = spawn(process.execPath, [path.join(__dirname, '../lib/expect.mjs'), A.repo || M.E.repo, scanFile, '--scan', '--coins', M.slugs().map((s) => M.coin(s).sym).join(',')], { stdio: 'ignore' }); ch.on('exit', (code) => res(code)); });
  const strictSeen = { written: 0, days: new Set() };

  // ---- 0. Node alone: td-view's distances and levels are the engine's (found again by recount) ----
  for (const slug of M.slugs()) for (const T of M.coin(slug).tfs) {
    if (!T.progress) continue;
    C.ok(T.progress.sameAsBarsPartial, `[${slug} ${T.tf}] the bar in progress built here from the daily data is not bars.js's partial bar`);
    for (const t of T.trigs) {
      C.count('triggers');
      const f = t.fire, m = t.mine;
      C.ok((f === null) === (m === null) && (f === null || (f.now === m.now && f.p === m.p && f.q === m.q)), `[${slug} ${T.tf}] ${t.k} dir ${t.d} f ${t.f}: td-view fire ${JSON.stringify(f)}, recount of the engine ${JSON.stringify(m)}`);
      if (f) C.count('reachable');
      if (f && m && !f.now) {
        // the level that decides at p and at q, and whether it counts itself
        const same = (c, l) => (c === null) === (l === null) && (c === null || (c.v === l.v && !!c.strict === !!l.strict && c.op === (m.dir < 0 ? (l.strict ? '<' : '<=') : (l.strict ? '>' : '>='))));
        C.ok(same(f.pc, m.pl), `[${slug} ${T.tf}] ${t.k} dir ${t.d}: td-view says the comparison at p is ${JSON.stringify(f.pc)}; with the engine alone the level is ${JSON.stringify(m.pl)}`);
        C.ok(same(f.qc, m.ql), `[${slug} ${T.tf}] ${t.k} dir ${t.d}: td-view says the comparison at q is ${JSON.stringify(f.qc)}; with the engine alone ${JSON.stringify(m.ql)}`);
        if (m.pl && m.pl.strict) C.count('strictLevels');
      }
    }
  }

  // what a text has to say for a condition, from the engine's recount alone: the level, its word and the distance
  const wordOf = (dir, strict) => (dir < 0 ? (strict ? '<' : '<=') : (strict ? '>' : '>='));
  const fireIs = (F, e, name, where) => {
    const m = e.mine, f = e.fire;
    if (!F) { C.fail(`${name}: cannot read "${where}"`); return false; }
    if (F.now !== m.now) { C.fail(`${name}: written as ${F.now ? 'met now' : 'not met'}, the engine ${m.now ? 'prints the label on the bar as it is' : 'does not'}`); return false; }
    if (F.now) return true;
    if (!m.pl) { C.fail(`${name}: the engine's price ${m.p} is no level of the trigger`); return false; }
    if (!priceOk(F.Ptext, m.pl.v) || F.Pop !== wordOf(m.dir, m.pl.strict)) C.fail(`${name}: written "조건가 ${F.Ptext} ${F.Pop}"; the engine prints the label ${m.pl.strict ? 'only beyond' : 'from'} ${m.pl.v} (${wordOf(m.dir, m.pl.strict)})`);
    if (!pctOk(F.Ppct, f.pct)) C.fail(`${name}: written distance ${F.Ppct}, it is ${(f.pct * 100).toFixed(3)}%`);
    const wantQ = m.q !== m.p && m.ql !== null;
    if ((F.Q !== null) !== wantQ) C.fail(`${name}: ${F.Q !== null ? 'a' : 'no'} close level written ("${where}"); the engine has p ${m.p}, q ${m.q}`);
    else if (wantQ && (!priceOk(F.Qtext, m.ql.v) || F.Qop !== wordOf(m.dir, m.ql.strict) || !pctOk(F.Qpct, f.qpct))) C.fail(`${name}: written "종가 기준 ${F.Qtext} ${F.Qop} (${F.Qpct})"; the engine's close level is ${m.ql.strict ? 'beyond' : 'at'} ${m.ql.v} (${(f.qpct * 100).toFixed(3)}%)`);
    if (F.Pop === '<' || F.Pop === '>' || F.Qop === '<' || F.Qop === '>') strictSeen.written++;
    return true;
  };
  // The written numbers put to the engine. A level with 이상 / 이하: a bar that goes there (and closes at the close
  // level, or there) gets the label, a bar one tick short does not. A level with 초과 / 미만: a bar that closes exactly
  // there gets no label, a bar one tick beyond gets it.
  const recountFromText = (slug, tf, base, info, where) => {
    const coin = M.coin(slug), tick = coin.tick, c0 = base.c, want = { is13: info.is13, d: info.d, f: info.f, o: info.o, rep: info.is13 ? null : info.rep };
    const pr = (bar) => ENG.has(ENG.printed(coin.usd, tf, bar), want);
    const mk = (reach, close, open = base.o) => ({ o: open, h: Math.max(base.h, reach, close, open), l: Math.min(base.l, reach, close, open), c: close });
    const fix = (v) => Number(v.toFixed(coin.decimals + 2));
    const F = info.fire;
    if (F) {
      if (F.now) { C.count('recounts'); C.ok(pr({ o: base.o, h: base.h, l: base.l, c: base.c }), `${where}: written as met now, but the engine prints no such label on the bar as it is`); }
      else {
        const dir = Math.sign(F.P - c0), strictP = F.Pop === '<' || F.Pop === '>';
        // where the bar closes in these trials: at the written close level (one tick beyond a strict one), else at the price itself
        const strictQ = F.Q !== null && (F.Qop === '<' || F.Qop === '>'), closeAt = F.Q === null ? null : strictQ ? fix(F.Q + dir * tick) : F.Q;
        const at = (reach) => mk(reach, closeAt === null ? reach : closeAt);
        C.count('recounts', 2);
        if (strictP) {
          C.count('strictRecounts');
          C.ok(!pr(at(F.P)), `${where}: written "조건가 ${F.Ptext} ${F.Pop === '<' ? '미만' : '초과'}", but a bar that goes to ${F.P} exactly${closeAt === null ? ' and closes there' : ''} already gets the label`);
          C.ok(pr(at(fix(F.P + dir * tick))), `${where}: written "조건가 ${F.Ptext} ${F.Pop === '<' ? '미만' : '초과'}", but a bar one tick beyond it (${fix(F.P + dir * tick)}) gets no label`);
        } else {
          C.ok(pr(at(F.P)), `${where}: written "조건가 ${F.Ptext} ${F.Pop === '<=' ? '이하' : '이상'}", but a bar that goes to ${F.P}${closeAt === null ? ' and closes there' : ' and closes at ' + closeAt} gets no label from the engine`);
          C.ok(!pr(at(fix(F.P - dir * tick))), `${where}: a bar that stops one tick short of the written price (${fix(F.P - dir * tick)}) already gets the label`);
        }
        if (F.Q !== null) {
          // the close level: after the bar has been at the price, a close one tick nearer to the current price than the level gives no label
          C.count('recounts'); C.count('closeLevels');
          const reach = strictP ? fix(F.P + dir * tick) : F.P;
          if (strictQ) C.ok(!pr(mk(reach, F.Q)), `${where}: written "종가 기준 ${F.Qtext} ${F.Qop === '<' ? '미만' : '초과'}", but a bar that closes exactly at ${F.Q} gets the label`);
          else C.ok(!pr(mk(reach, fix(F.Q - dir * tick))), `${where}: a bar that touches ${F.Ptext} and closes one tick nearer than the written ${F.Qtext} (${fix(F.Q - dir * tick)}) still gets the label`);
        }
      }
    }
    const S = info.sentence;
    if (S) {
      // every bar made of the written thresholds and one tick either side of them: the sentence and the engine agree
      const vs = new Set([c0]); for (const g of [S.all, ...(S.any || []), ...(S.unless || [])]) for (const [, , v] of g) for (const d of [-tick, 0, tick]) vs.add(Number((v + d).toFixed(coin.decimals + 2)));
      const prices = [...vs].filter((v) => v > 0), opens = base.assumed ? prices : [base.o];
      let diff = 0, n = 0, yes = 0;
      for (const o of opens) for (const reach of prices) for (const close of prices) {
        const bar = base.assumed ? { o, h: Math.max(o, reach, close), l: Math.min(o, reach, close), c: close } : mk(reach, close);
        const says = sentenceSays(S, bar), does = pr(bar); n++; if (does) yes++;
        if (says !== does && diff++ < 2) C.fail(`${where}: the sentence "${info.sentenceText}" ${says ? 'promises' : 'excludes'} the label for the bar ${JSON.stringify(bar)}, the engine ${does ? 'prints it' : 'does not print it'}`);
      }
      C.count('sentenceBars', n); C.count('sentenceBarsWithLabel', yes); if (!diff) C.count('sentencesAgreeing');
      if (!S.never && yes === 0) C.fail(`${where}: none of ${n} bars around the written prices gets the label`);
    }
  };
  const condName = (e) => `${e.k === 'C13' ? FAM_NAME[e.f] + ' ' : ''}${e.d === 1 ? '매도' : '매수'} 쪽 ${e.k === 'C13' ? '13' : e.k === 'S9r' ? '반복 9' : '9'}`;
  const order = (a, b) => Number(b.fire.now) - Number(a.fire.now) || Math.abs(a.fire.pct) - Math.abs(b.fire.pct) || a.j - b.j || (a.f == null ? -1 : a.f) - (b.f == null ? -1 : b.f);
  const tvUrl = (usd, tf) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(usd)}&interval=${tf.replace(/^1(?=[DWM]$)/, '')}`;
  const near2 = (a, b, e) => Math.abs(a - b) <= e;

  // ---- 1. the page on a wide screen ----
  await Promise.all(M.slugs().map(async (slug) => {
    for (const dark of A.quick ? [false] : [false, true]) {
    const coin = M.coin(slug), ctx = await Q.open(A.base, { hash: '#chart-a-' + slug, dark });
    const { page } = ctx;
    let st = { ...Q.DEFAULT_STATE };
    const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
    const zone = async (tag, withTips) => {
      await Q.mouseOff(page);
      const s = await Q.snap(page, { over: true }), p = s.probe, c = P.parseChart(s.frames.cBase, s.theme), { Y } = scales(p), where = `[${slug}${dark ? ' dark' : ''} ${tag}]`, T = s.theme;
      C.count('states');
      const exp = st.cond === 'on' && p.end ? M.conds(slug, st) : [];
      const key = (q) => `${q.j}|${q.k}|${q.d}|${q.f == null ? '-' : q.f}|${q.o == null ? '-' : q.o}`;
      const eBy = new Map(exp.map((q) => [q.key, q])), pBy = new Map(p.conds.map((q) => [key(q), q]));
      if (pBy.size !== p.conds.length) C.fail(`${where} the probe has a condition twice`);
      for (const [k, e] of eBy) if (!pBy.has(k)) C.fail(`${where} missing condition: ${e.tf} ${e.k} dir ${e.d} f ${e.f} from ${e.o == null ? '-' : iso(e.o)} (engine: p ${e.fire.p}, ${(e.fire.pct * 100).toFixed(2)}%)`);
      for (const [k, q] of pBy) if (!eBy.has(k)) C.fail(`${where} a condition the engine does not have in this selection: ${q.tf} ${q.k} dir ${q.d} f ${q.f} p ${q.p}`);
      C.count('expectedConditions', exp.length);
      if (c.unknown.length) C.fail(`${where} ${c.unknown.length} painted calls fit no part of the picture, first ${JSON.stringify(c.unknown[0]).slice(0, 220)}`);
      const Z = c.zone;
      if (!!Z !== (st.cond === 'on' && p.end)) C.fail(`${where} the zone is ${Z ? '' : 'not '}painted; 다음 봉 조건 is ${st.cond}, the window ${p.end ? 'ends at the newest day' : 'is moved back'}`);
      if (!Z) { if (p.conds.length) C.fail(`${where} conditions in the probe without a zone`); return s; }
      // the zone: a line and a title, no panel; 120 px to the canvas' edge (the plot has the rest); nothing vertical in it
      if (Z.panel) C.fail(`${where} the zone has a panel`);
      if (Z.stray.length) C.fail(`${where} the zone has ${Z.stray.length} painted things that are no part of a chip: ${JSON.stringify(Z.stray[0]).slice(0, 200)}`);
      if (!Z.title) C.fail(`${where} the zone has no title`);
      if (Math.abs(Z.x0 - p.plot.r) > 0.01) C.fail(`${where} the zone's line is at x ${Z.x0}, the plot ends at ${p.plot.r}`);
      if (Z.line.y !== p.plot.t || Z.line.y + Z.line.h !== p.plot.b) C.fail(`${where} the zone's line runs y ${Z.line.y}..${Z.line.y + Z.line.h}, the plot ${p.plot.t}..${p.plot.b}`);
      if (c.W - Z.x0 > 120.01 || (c.W >= 700 && c.W - Z.x0 < 119.99)) C.fail(`${where} the zone is ${c.W - Z.x0} px wide (the canvas ${c.W}); it is 120 px`);
      if (s.frames.cOver && s.frames.cOver.calls.some((q) => q.op !== 'cr')) C.fail(`${where} the layer over the chart is not empty while nothing is pointed at`);
      // the newest close
      const yC = Y(coin.lastClose);
      if (p.last !== coin.lastClose) C.fail(`${where} newest close ${p.last} in the probe, ${coin.lastClose} in the data`);
      if (yC >= p.plot.t + 1 && yC <= p.plot.b - 1) {
        if (!Z.closeLine || Math.abs(Z.closeLine.path[0][2] - 0.5 - yC) > 0.51) C.fail(`${where} the line of the newest close is at y ${Z.closeLine ? Z.closeLine.path[0][2] : 'nowhere'}, ${coin.lastClose} is at ${yC.toFixed(2)}`);
        // (its price is written where there is room for it; the page's first row has it in any case)
        if (Z.closeTag) { C.count('closeTags'); if (!(Math.abs(parsePrice(Z.closeTag.text) - coin.lastClose) <= coin.lastClose * 5e-4)) C.fail(`${where} the newest close is written "${Z.closeTag.text}", it is ${coin.lastClose}`); else if (parsePrice(Z.closeTag.text) !== coin.lastClose) C.count('closeTagShortened'); }
      }
      if (!exp.length && !Z.empty.length) C.fail(`${where} no condition, and the zone does not say so`);
      if (!exp.length && Z.empty.length) { const want = st.off.length >= M.TFS.length ? '켜 둔 타임프레임이 없습니다.' : '지금은 9나 13이 나올 조건이 없습니다.'; if (Z.empty.map((t) => t.text).join(' ') !== want) C.fail(`${where} the zone says "${Z.empty.map((t) => t.text).join(' ')}", expected "${want}"`); }
      const byBox = new Map(Z.chips.map((ch) => [ch.frame ? `${ch.frame.x - ch.frame.lw / 2}|${ch.frame.y - ch.frame.lw / 2}|${ch.frame.w + ch.frame.lw}|${ch.frame.h + ch.frame.lw}` : '?', ch])), used = new Set(), boxes = [];
      const edgeOf = { above: Z.edges.find((e) => e.above) || null, below: Z.edges.find((e) => !e.above) || null }, inEdge = { above: [], below: [] };
      let tinted = 0, nearN = 0;
      for (const [k, q] of pBy) {
        const e = eBy.get(k); if (!e) continue;
        const f = e.fire, name = `${where} ${q.tf} ${q.k === 'C13' ? FAM_NAME[q.f] + ' ' : ''}${q.d === 1 ? 'sell' : 'buy'} ${q.k}`;
        C.count('conditions');
        if (q.p !== f.p || q.q !== f.q || q.pct !== f.pct || q.now !== f.now) C.fail(`${name}: the page has p ${q.p}, q ${q.q}, ${q.pct}, now ${q.now}; the engine and td-view give p ${f.p}, q ${f.q}, ${f.pct}, now ${f.now}`);
        const isNear = !f.now && Math.abs(f.pct) <= st.near / 100, state = f.now ? 'now' : isNear ? 'near' : 'far';
        if (isNear) nearN++;
        if (q.near !== isNear) C.fail(`${name}: near ${q.near} at ${(f.pct * 100).toFixed(2)}% with the threshold ${st.near}%`);
        if (!['in', 'above', 'below'].includes(q.shown)) { C.fail(`${name}: shown "${q.shown}" on a wide screen`); continue; }
        const is13 = q.k === 'C13', color = is13 ? M.famColorOn(q.f, dark) : M.colorOf({ kind: 'S' }, dark);
        const target = f.now ? coin.lastClose : f.p, yT = Y(target);
        if (q.shown !== 'in') {
          // beyond the price range: counted in the line of that edge; no chip pinned to the edge
          const up = q.shown === 'above', ed = edgeOf[q.shown];
          inEdge[q.shown].push(e); C.count('beyondThePriceRange');
          if (!ed) { C.fail(`${name}: counted at the ${up ? 'upper' : 'lower'} edge, but no line of text is painted there`); continue; }
          if (!ed.over && (up ? !(yT < p.plot.t + 5) : !(yT > p.plot.b - 5))) C.fail(`${name}: counted as beyond the ${up ? 'top' : 'bottom'} of the price range, but its price ${target} is at y ${yT.toFixed(1)} (plot ${p.plot.t}..${p.plot.b})`);
          continue;
        }
        const ch = byBox.get(`${q.x}|${q.y}|${q.w}|${q.h}`);
        if (!ch) { C.fail(`${name}: the probe has its chip at ${q.x},${q.y} (${q.w} x ${q.h}); no frame is painted there`); continue; }
        used.add(ch); boxes.push({ x: q.x, y: q.y, w: q.w, h: q.h, name }); C.count('chipsPainted');
        if (!ch.text || ch.text.text !== (is13 ? '13' : '9')) C.fail(`${name}: the chip says "${ch.text && ch.text.text}"`);
        if (!ch.sup || ch.sup.text !== q.tf) C.fail(`${name}: the chip's superscript is "${ch.sup && ch.sup.text}"`);
        if (!ch.frame || ch.frame.color !== color) C.fail(`${name}: the chip's frame is ${ch.frame && ch.frame.color}, its color on the ${dark ? 'dark' : 'light'} theme is ${color}`);
        // its weight by how near it is
        const rep = q.k === 'S9r' ? 0.8 : 1, fr = ch.frame, tx = ch.text;
        if (state === 'far') {
          if (ch.ground || ch.box) C.fail(`${name} (${(f.pct * 100).toFixed(1)}%, beyond the 임박 threshold of ${st.near}%): the chip has a ground`);
          if (fr && (!(fr.dash.length > 0) || fr.lw !== 1)) C.fail(`${name} (beyond the 임박 threshold): the frame is ${fr.dash.length ? 'dashed' : 'solid'}, ${fr.lw} px (a dashed 1 px frame)`);
          if (fr && !near2(fr.al, 0.7 * rep, 0.06)) C.fail(`${name} (beyond the 임박 threshold): the frame is painted at strength ${fr.al} (about 70%)`);
          if (tx && (tx.fs !== color || !near2(tx.al, 0.7 * rep, 0.06) || ch.sup.fs !== color)) C.fail(`${name} (beyond the 임박 threshold): the number is painted in ${tx.fs} at strength ${tx.al}; expected its color ${color} at about 70%`);
          if (ch.dist && (P.fontOf(ch.dist.font).fam !== 'mono' || ch.dist.fs !== T.muted)) C.fail(`${name}: the distance "${ch.dist.text}" is written in ${ch.dist.font.slice(0, 24)} / ${ch.dist.fs}; expected muted mono`);
        } else {
          tinted++;
          if (!ch.ground || ch.ground.color !== color) C.fail(`${name} (${state === 'now' ? 'met' : 'within the 임박 threshold'}): the chip's ground is ${ch.ground && ch.ground.color}`);
          if (fr && (fr.dash.length > 0)) C.fail(`${name} (${state}): a dashed frame`);
          if (ch.ground && (state === 'now' ? !near2(ch.ground.al, rep, 0.01) : !(ch.ground.al > 0.1 && ch.ground.al < 0.4))) C.fail(`${name} (${state}): the ground is painted at strength ${ch.ground.al} (${state === 'now' ? 'filled' : 'a light tint'})`);
        }
        if (!ch.dist) C.fail(`${name}: no distance written beside the chip`);
        else if (f.now ? ch.dist.text !== '충족' : !pctOk(ch.dist.text, f.pct)) C.fail(`${name}: written "${ch.dist.text}" beside the chip, the distance is ${(f.pct * 100).toFixed(3)}%${f.now ? ' (met now)' : ''}`);
        // its price on the chart's scale
        if (!ch.pointer) C.fail(`${name}: no pointer from its price to the chip`);
        else {
          const py = ch.pointer.path[0][2], end = ch.pointer.path[2];
          if (Math.abs(py - 0.5 - Math.max(p.plot.t, Math.min(p.plot.b, yT))) > 0.51) C.fail(`${name}: the pointer starts at y ${py}, the price ${target} is at y ${yT.toFixed(2)} on the chart's scale`);
          if (Math.abs(end[1] - (q.x - 1)) > 0.01 || Math.abs(end[2] - (q.y + q.h / 2)) > 0.01) C.fail(`${name}: the pointer ends at ${end[1]},${end[2]}, the chip is at ${q.x},${q.y}`);
          if (ch.pointer.ss !== color) C.fail(`${name}: pointer in ${ch.pointer.ss}`);
          if (Math.abs(ch.pointer.path[0][1] - ch.pointer.path[1][1]) < 0.01) C.fail(`${name}: the pointer begins with a vertical piece`);
          C.count('pricesOnScale');
        }
        if (yT < p.plot.t + 5 - 0.01 || yT > p.plot.b - 5 + 0.01) C.fail(`${name}: shown inside the zone, but its price is at y ${yT.toFixed(1)} (plot ${p.plot.t}..${p.plot.b})`);
        if (!!ch.dot !== !!f.now) C.fail(`${name}: ${ch.dot ? 'a' : 'no'} dot for a condition that is ${f.now ? '' : 'not '}met now`);
      }
      // framed and tinted chips are the conditions within the threshold (and the met ones)
      C.count('framedAndTintedChips', tinted); C.count('conditionsWithinTheThreshold', nearN);
      for (const ch of Z.chips) if (!used.has(ch)) C.fail(`${where} a chip "${ch.text && ch.text.text}${ch.sup ? ch.sup.text : ''}" is painted at ${JSON.stringify(ch.frame)}; the probe has no condition there`);
      for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) if (P.hit(boxes[i], boxes[k])) C.fail(`${boxes[i].name} and ${boxes[k].name}: chips overlap`);
      for (const b of boxes) if (b.x < Z.x0 || b.x + b.w > c.W || b.y < p.plot.t || b.y + b.h > p.plot.b) C.fail(`${b.name}: the chip leaves the zone`);
      // the lines of the edges: "▲ 범위 밖 N개" / "▼ 범위 밖 N개", muted, each counting its conditions
      for (const side of ['above', 'below']) {
        const ed = edgeOf[side], list = inEdge[side];
        if (!ed && !list.length) continue;
        if (!ed) continue;
        C.count('edgeLines');
        if (ed.n !== list.length) C.fail(`${where} the ${side === 'above' ? 'upper' : 'lower'} edge says "${ed.text}", ${list.length} conditions are beyond the price range there`);
        if (ed.t.fs !== T.muted) C.fail(`${where} "${ed.text}" is painted in ${ed.t.fs}, not muted`);
        // (the other wording, for conditions that found no room inside: only when the zone is full)
        if (ed.over && (boxes.length + 1) * 17 < p.plot.b - p.plot.t - 60) C.fail(`${where} "${ed.text}": conditions inside the price range are counted at the edge although the zone holds only ${boxes.length} chips`);
      }
      if (Z.edges.length > 2) C.fail(`${where} ${Z.edges.length} edge lines`);
      // tooltips, and the written numbers put to the engine
      if (withTips) {
        for (const [k, q] of pBy) {
          const e = eBy.get(k); if (!e || q.shown !== 'in') continue;
          const f = e.fire, is13 = q.k === 'C13', name = `${where} ${q.tf} ${is13 ? FAM_NAME[q.f] + ' ' : ''}${q.d === 1 ? '매도' : '매수'} ${q.k}`;
          const px = s.rc.x + q.x + q.w / 2, py = s.rc.y + q.y + q.h / 2;
          await page.mouse.move(px, py);
          const t = await Q.tip(page);
          if (!t) { C.fail(`${name}: no tooltip on the chip`); continue; }
          C.count('tooltips');
          const h1 = t.kids.find((x) => x.cls === 'h1'), m1 = h1 && /^(\d+[DWM]) · (?:(Sequential|Combo|Aggressive Combo|Aggressive Sequential) )?(매수|매도) 쪽 (13|반복 9|9)$/.exec(h1.text);
          if (!m1) { C.fail(`${name}: tooltip heading "${h1 && h1.text}"`); continue; }
          const info = { tf: m1[1], is13: m1[4] === '13', f: m1[2] ? FAM_NAME.indexOf(m1[2]) : null, d: m1[3] === '매도' ? 1 : -1, rep: m1[4] === '반복 9', o: null, fire: null, sentence: null };
          if (info.tf !== q.tf || info.is13 !== is13 || info.d !== e.d || (is13 && info.f !== e.f) || (!is13 && info.rep !== (e.k === 'S9r'))) C.fail(`${name}: tooltip heading "${h1.text}"`);
          const r0 = t.rows[0];
          if (!r0 || !r0.num || r0.num.text !== (is13 ? '13' : '9') || r0.num.sup !== q.tf) C.fail(`${name}: the tooltip's mark is "${r0 && r0.num && r0.num.text + r0.num.sup}"`);
          const ftRaw = r0 ? r0.rest : '', badge = / ?임박$/.test(ftRaw), ft = ftRaw.replace(/ ?임박$/, '');
          if (/마감하면 충족|마감해도 충족/.test(t.text)) C.fail(`${name}: the tooltip still says "…마감하면 충족": "${ftRaw}"`);
          info.fire = parseFire(ft);
          if (fireIs(info.fire, e, name, ftRaw) && !f.now && badge !== q.near) C.fail(`${name}: 임박 ${badge ? 'written' : 'not written'}, near is ${q.near}`);
          const sent = t.kids.find((x) => x.cls === 'm');
          let S = null; try { S = sent ? parseSentence(sent.text) : null; } catch (err) { S = null; }
          if (!S) C.fail(`${name}: cannot read the sentence "${sent && sent.text}"`);
          else {
            info.sentence = S; info.sentenceText = sent.text;
            if (S.what !== (is13 ? '13' : '9')) C.fail(`${name}: the sentence is about a ${S.what}`);
            if (S.bar !== (e.progress.base.assumed ? '다음 봉' : '진행 중인 봉')) C.fail(`${name}: the sentence speaks of "${S.bar}"; the bar in progress ${e.progress.base.assumed ? 'holds no closed day yet' : 'holds closed days'}`);
            // the same conditions as the trigger (prices as written)
            const wr = (g) => g.map(([s2, op, v]) => [s2, op, v]);
            const tAll = wr(e.all || []), tAny = e.any && e.any.length && !e.any.some((g) => !g.length) ? e.any.map(wr) : null, tUn = e.unless && e.unless.length && !e.unless.some((g) => !g.length) ? e.unless.map(wr) : null;
            if (!sameConds(S.all, tAll) || !sameConds(S.any, tAny) || !sameConds(S.unless, tUn) || S.never !== !!(e.unless && e.unless.some((g) => !g.length))) C.fail(`${name}: the sentence "${sent.text}" reads as ${JSON.stringify({ all: S.all, any: S.any, unless: S.unless })}, the trigger is ${JSON.stringify({ all: tAll, any: tAny, unless: tUn })}`);
          }
          const meta = t.rows[t.rows.length - 1], m3 = meta && META.exec(meta.rest);
          if (!m3) C.fail(`${name}: cannot read the tooltip's last line "${meta && meta.rest}"`);
          else {
            const s0 = Q.dayOf(m3[3]), e0 = m3[4] ? Q.dayOf(m3[4].length === 5 ? m3[3].slice(0, 5) + m3[4] : m3[4]) : s0, pr = e.progress;
            info.o = m3[1] ? Q.dayOf(m3[1]) : null;
            if (is13 ? info.o !== e.o : info.o !== null) C.fail(`${name}: origin bar ${m3[1]}, the engine's run starts at ${e.o == null ? '-' : iso(e.o)}`);
            if (s0 !== pr.start || e0 !== pr.end) C.fail(`${name}: the bar is written as ${m3[3]} ~ ${m3[4] || m3[3]}, the bar in progress is ${iso(pr.start)} ~ ${iso(pr.end)}`);
            if ((m3[5] ? Q.dayOf(m3[5]) : null) !== (pr.last !== null && pr.last < pr.end ? pr.last : null)) C.fail(`${name}: "${m3[5] || ''}까지 반영", the bar in progress holds closed days through ${pr.last == null ? 'none' : iso(pr.last)}`);
          }
          recountFromText(slug, q.tf, e.progress.base, info, name);
          // while it is pointed at: its price across the chart, and its close level (when the bar may close elsewhere,
          // inside the plot) as a line down the zone's edge with a tick and a dotted line across the chart
          const ov = P.parseOver((await Q.snap(page, { over: true, nobase: true })).frames.cOver), yP = Math.round(Math.max(p.plot.t, Math.min(p.plot.b, Y(f.now ? coin.lastClose : f.p)))) + 0.5;
          const across = ov.lines.filter((l) => l.horizontal && l.x1 <= p.plot.l + 0.5 && l.x2 >= Z.x0 - 0.5), rails = ov.lines.filter((l) => l.vertical && l.x1 >= Z.x0);
          C.ok(across.some((l) => Math.abs(l.y1 - yP) <= 0.01), `${name}: pointed at, no line runs across the chart at its price (y ${yP})`);
          const hasQ = !f.now && f.q !== f.p, qIn = hasQ && f.qpct !== 0 && Y(f.q) >= p.plot.t && Y(f.q) <= p.plot.b;
          if (hasQ) {
            C.count('closeLevelsPointedAt');
            C.ok(rails.length === 1 && Math.abs(Math.min(rails[0].y1, rails[0].y2) - Math.min(yP, Math.round(Math.max(p.plot.t, Math.min(p.plot.b, Y(f.q)))) + 0.5)) <= 0.01, `${name}: pointed at, the close level (${f.q}) is not drawn as a line down the zone's edge: ${JSON.stringify(rails)}`);
            if (qIn) C.ok(across.some((l) => Math.abs(l.y1 - (Math.round(Y(f.q)) + 0.5)) <= 0.01), `${name}: pointed at, no line across the chart at its close level ${f.q}`);
          } else C.ok(rails.length === 0, `${name}: pointed at, a line down the zone's edge although the bar has to close at the price itself`);
          // a click pins the tooltip with the link to that timeframe's chart; a second click opens it, once
          const before = await page.evaluate(() => __qa.opens.length);
          await page.mouse.click(px, py);
          const t2 = await Q.tip(page), n1 = await page.evaluate(() => __qa.opens.length);
          C.ok(n1 === before && t2 && t2.pin && t2.links.length === 1 && t2.links[0].text === `TradingView ${q.tf} 차트 ↗` && t2.links[0].href === tvUrl(coin.usd, q.tf), `${name}: a click did not pin the tooltip with its link (opened ${n1 - before}, tooltip ${t2 ? JSON.stringify(t2.links) + ' pinned ' + t2.pin : 'none'})`);
          await page.mouse.click(px, py);
          const opened = await page.evaluate((n) => __qa.opens.slice(n), before);
          C.ok(opened.length === 1 && opened[0].url === tvUrl(coin.usd, q.tf) && opened[0].target === '_blank', `${name}: the second click on the chip opened ${JSON.stringify(opened)}`);
          await page.mouse.click(s.rc.x + p.plot.l + 40, s.rc.y - 14);   // let it go
        }
        // the lines of the edges: their tooltips list their conditions with both prices
        for (const side of ['above', 'below']) {
          const ed = edgeOf[side], list = inEdge[side].slice().sort(order); if (!ed) continue;
          await page.mouse.move(s.rc.x + ed.x + ed.w / 2, s.rc.y + ed.y + ed.h / 2);
          const t = await Q.tip(page), name = `${where} "${ed.text}"`;
          if (!t) { C.fail(`${name}: no tooltip`); continue; }
          C.count('edgeTooltips');
          const rows = t.rows.filter((r) => r.inSec && r.num);
          C.ok(t.kids[0].text === `${side === 'above' ? '위쪽' : '아래쪽'} 조건 ${list.length}개` && rows.length === list.length, `${name}: tooltip "${t.kids[0].text}" with ${rows.length} rows for ${list.length} conditions`);
          rows.forEach((r, i) => {
            const e = list[i]; if (!e) return;
            const is13 = e.k === 'C13', want = condName(e), nm = `${name} row ${i + 1} (${e.tf} ${want})`;
            if (r.num.text !== (is13 ? '13' : '9') || r.num.sup !== e.tf || !r.rest.startsWith(want + ' ')) { C.fail(`${nm}: the row is "${r.num.text}${r.num.sup} ${r.rest}"`); return; }
            const F = parseFire(r.rest.slice(want.length + 1));
            if (fireIs(F, e, nm, r.rest)) { C.count('edgeConditionsWithBothPrices'); recountFromText(slug, e.tf, e.progress.base, { tf: e.tf, is13, f: e.f, d: e.d, rep: e.k === 'S9r', o: e.o, fire: F, sentence: null }, nm); }
          });
        }
        await Q.mouseOff(page);
      }
      return s;
    };
    await zone('6개월', true);
    for (const name of ['3개월', '1년', '2년', '5년', '전체']) { await Q.preset(page, name); await zone(name, name === '전체' || name === '3개월'); }
    await Q.preset(page, '6개월');
    for (const patch of [{ near: 3 }, { near: 10 }, { near: 5, dir: 'buy' }, { dir: 'sell' }, { dir: 'both', fam: [0] }, { fam: [3] }, { fam: [2] }, { fam: [] }, { fam: [0, 2, 3], nine: 'off' }, { nine: 'on', off: ['2W'] }, { off: M.TFS.filter((t) => t !== '2D') }, { off: M.TFS.slice(0, 7) }, { off: M.TFS.slice() }, { off: [], scale: 'log' }, { scale: 'lin' }, { scale: 'auto', cond: 'off' }, { cond: 'on' }]) { await set(patch); await zone(JSON.stringify(patch).slice(0, 50), false); }
    // the widest threshold on the whole history: every state of a chip that today's data can show
    await set({ near: 10 }); await Q.preset(page, '전체'); await zone('전체, 임박 기준 10%', true); await set({ near: 5 }); await Q.preset(page, '6개월');
    // moved back: the zone leaves; 최근 날짜로 brings it back
    await Q.panWheel(page, -200); await zone('moved back', false);
    await page.click('.bec-now'); const back = await zone('after 최근 날짜로', false);
    C.ok(back.probe.end && back.probe.d1 === M.LAST, `[${slug}] 최근 날짜로 did not return to the newest day`);
    C.logs(ctx, slug + (dark ? ' dark' : ''));
    await ctx.context.close();
    }

    // ---- 2. a narrow screen: the same conditions under the chart, first as ONE line ----
    const coin = M.coin(slug);
    const ph = await Q.open(A.base, { hash: '#chart-a-' + slug, width: 390, height: 844, touch: true, dpr: 2 });
    const exp = M.conds(slug, Q.DEFAULT_STATE).sort(order);
    const sp = await Q.snap(ph.page);
    C.ok(P.parseChart(sp.frames.cBase, sp.theme).zone === null, `[${slug} phone] a zone is painted in the narrow chart`);
    C.ok(sp.probe.conds.length === exp.length && sp.probe.conds.every((q) => q.shown === 'list'), `[${slug} phone] ${sp.probe.conds.length} conditions in the probe (${sp.probe.conds.map((q) => q.shown).join()}), ${exp.length} expected as a list`);
    const lineOf = () => ph.page.evaluate(() => { const b = document.querySelector('.bec-conds .bec-csum'); if (!b) return null; const w = b.querySelector('b.bec-w'), r = b.getBoundingClientRect(); return { text: [...b.children].filter((e) => !e.classList.contains('bec-chev')).map((e) => e.textContent.trim()).join(' '), mark: w ? w.firstChild.textContent : null, sup: w ? w.querySelector('sup').textContent : null, open: b.getAttribute('aria-expanded'), h: r.height, rows: document.querySelectorAll('.bec-conds .bec-crow').length, lines: Math.round(r.height / 40) }; });
    const rowsOf = () => ph.page.evaluate(() => [...document.querySelectorAll('.bec-conds .bec-crow')].map((r) => { const w = r.querySelector('b.bec-w'), g = (s) => { const e = r.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, b = r.querySelector(':scope > button').getBoundingClientRect();
      return { mark: w ? w.firstChild.textContent : null, sup: w ? w.querySelector('sup').textContent : null, name: g(':scope > button > span:not(.bec-end)'), dist: g('.bec-dist'), near: !!r.querySelector('.bec-near'), met: !!r.querySelector('.bec-met'), open: r.querySelector(':scope > button').getAttribute('aria-expanded'), h: b.height, fire: g('.bec-fire'), sent: g('.bec-sent'), meta: g('.bec-meta > span'), href: (r.querySelector('.bec-meta a') || {}).href || null, link: g('.bec-meta a') }; }));
    if (exp.length) {
      const e0 = exp[0], l0 = await lineOf();
      const want = `다음 봉 조건 ${exp.length}개 · 가장 가까운 조건 ${e0.k === 'C13' ? '13' : '9'}${e0.tf}`;
      C.ok(l0 && l0.rows === 0 && l0.open === 'false' && l0.text.startsWith(want) && (e0.fire.now ? l0.text.endsWith('충족') : pctOk(l0.text.slice(want.length).trim(), e0.fire.pct)), `[${slug} phone] the conditions start as "${l0 && l0.text}" with ${l0 && l0.rows} rows; expected one line "다음 봉 조건 ${exp.length}개 · 가장 가까운 조건 …" of the nearest (${e0.tf} ${(e0.fire.pct * 100).toFixed(1)}%)`);
      C.ok(l0 && l0.h >= 40 && l0.h < 62, `[${slug} phone] the line of the conditions is ${l0 && l0.h} px high (one line, at least 40 px for a finger)`);
      // a tap opens the list: one line per condition (mark, family and side, distance)
      await ph.page.tap('.bec-conds .bec-csum');
      const rows = await rowsOf();
      C.ok(rows.length === exp.length, `[${slug} phone] a tap opened ${rows.length} lines for ${exp.length} conditions`);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], e = exp[i]; if (!e) break; const f = e.fire, is13 = e.k === 'C13', name = `[${slug} phone row ${i + 1}] ${e.tf} ${condName(e)}`;
        C.count('listRows');
        if (r.mark !== (is13 ? '13' : '9') || r.sup !== e.tf) C.fail(`${name}: the row's mark is ${r.mark}${r.sup}`);
        if (r.name !== condName(e)) C.fail(`${name}: named "${r.name}"`);
        if (f.now ? !r.met : !(r.dist && pctOk(r.dist, f.pct))) C.fail(`${name}: distance "${r.dist}", met ${r.met}; the engine's ${(f.pct * 100).toFixed(3)}%, now ${f.now}`);
        if (r.near !== (!f.now && Math.abs(f.pct) <= 0.05)) C.fail(`${name}: 임박 ${r.near}`);
        if (r.open !== 'false' || r.sent !== null) C.fail(`${name}: the line is open before it was tapped`);
        if (r.h < 40) C.fail(`${name}: the line is ${r.h} px high (40 px at least)`);
        // a tap on the line opens its prices, its sentence, its bars and the link
        await ph.page.evaluate((k) => document.querySelectorAll('.bec-conds .bec-crow > button')[k].scrollIntoView({ block: 'center' }), i);
        await ph.page.locator('.bec-conds .bec-crow > button').nth(i).tap();   // (a locator: the page may draw the list anew when a font arrives)
        const o = (await rowsOf())[i], info = { tf: e.tf, is13, f: e.f, d: e.d, rep: e.k === 'S9r', o: null, fire: null, sentence: null };
        if (!o || o.open !== 'true' || !o.sent) { C.fail(`${name}: a tap on the line did not open its sentence`); continue; }
        info.fire = parseFire(o.fire || '');
        if (fireIs(info.fire, e, name, o.fire)) C.count('listConditionsWithBothPrices');
        let S = null; try { S = parseSentence(o.sent || ''); } catch (err) { S = null; }
        if (!S) C.fail(`${name}: cannot read the sentence "${o.sent}"`); else { info.sentence = S; info.sentenceText = o.sent; }
        const m3 = META.exec(o.meta || '');
        if (!m3) C.fail(`${name}: cannot read "${o.meta}"`); else { info.o = m3[1] ? Q.dayOf(m3[1]) : null; if (is13 && info.o !== e.o) C.fail(`${name}: origin bar ${m3[1]}, the engine's ${iso(e.o)}`); }
        if (o.href !== tvUrl(coin.usd, e.tf) || o.link !== `TradingView ${e.tf} 차트 ↗`) C.fail(`${name}: link "${o.link}" ${o.href}`);
        recountFromText(slug, e.tf, e.progress.base, info, name);
      }
      const sp2 = await Q.snap(ph.page);
      C.ok(sp2.sw <= sp2.cw, `[${slug} phone] the page scrolls sideways with the list open (${sp2.sw} > ${sp2.cw})`);
      // a tap on the first line folds the list again
      await ph.page.evaluate(() => document.querySelector('.bec-conds .bec-csum').scrollIntoView({ block: 'center' })); await ph.page.tap('.bec-conds .bec-csum');
      const l2 = await lineOf(); C.ok(l2 && l2.rows === 0 && l2.open === 'false', `[${slug} phone] a second tap did not fold the list`);
    } else {
      const text = await ph.page.evaluate(() => (document.querySelector('.bec-conds') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim());
      C.ok(/^다음 봉 조건 지금은 9나 13이 나올 조건이 없습니다\.$/.test(text), `[${slug} phone] no condition: the place under the chart says "${text}"`);
    }
    C.ok(sp.sw <= sp.cw, `[${slug} phone] the page scrolls sideways (${sp.sw} > ${sp.cw})`);
    C.logs(ph, slug + ' phone');
    await ph.context.close();
  }));

  // ---- 3. the grid scan: the same conditions, found without the triggers ----
  const code = await scan;
  if (code !== 0 || !fs.existsSync(scanFile)) C.fail(`the grid scan did not finish (exit ${code})`);
  else {
    const SC = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
    for (const slug of M.slugs()) for (const T of SC.coins[slug].tfs) {
      if (!T.scan) continue;
      const exp = M.conds(slug, Q.DEFAULT_STATE).filter((q) => q.tf === T.tf), g = T.scan;
      const keyOf = (q) => (q.k === 'C13' ? `C|${q.d}|${q.f}|${q.o}` : `S|${q.d}|${q.k}`), stepAt = (a) => (a <= g.near + 1e-9 ? g.fine : g.coarse);
      const found = new Map(g.found.map((x) => [x.key, x]));
      for (const q of exp) {
        const f = q.fire, a = Math.abs(f.pct); C.count('scanCompared');
        if (f.pct > g.up || f.pct < -g.down) { C.count('beyondScanRange'); continue; }
        const x = found.get(keyOf(q));
        if (!x) { C.fail(`[${slug} ${T.tf}] the scan through the engine never prints ${keyOf(q)} between -${g.down * 100}% and +${g.up * 100}%; the page shows it at ${(f.pct * 100).toFixed(2)}%`); continue; }
        if (!(Math.abs(x.pct) >= a - 1e-9 && Math.abs(x.pct) <= a + stepAt(a) + 1e-9 && (a === 0 || Math.sign(x.pct) === Math.sign(f.pct)))) C.fail(`[${slug} ${T.tf}] ${keyOf(q)}: the scan first prints it at ${(x.pct * 100).toFixed(2)}%, the page shows ${(f.pct * 100).toFixed(3)}%`);
      }
      for (const x of g.found) { C.count('scanFound'); if (!exp.some((q) => keyOf(q) === x.key)) C.fail(`[${slug} ${T.tf}] the scan through the engine prints ${x.key} at ${(x.pct * 100).toFixed(2)}% (${x.p}); the page has no such condition`); }
    }
  }
  C.count('strictLevelsWritten', strictSeen.written);
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('conds.cjs crashed:', e); process.exit(3); });
