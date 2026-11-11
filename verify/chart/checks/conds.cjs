// Check 6: 다음 봉 조건. The conditions the page shows are the engine's next-bar triggers with their distances (computed
// in Node, expect.json); every chip is painted with the right mark, timeframe, family color and distance at its price
// on the chart's scale; its tooltip says the same numbers; and what is WRITTEN is put to the engine: a bar that does
// what the text says gets the label, a bar one tick short does not. Besides, without the triggers: a scan of closes
// on a grid through the engine finds the same conditions and nothing else.
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

(async () => {
  const M = new Model(A.expect), C = new Q.Check('c06_conditions');
  const { makeEngine } = await import('../lib/recount.mjs');
  const ENG = await makeEngine(A.repo || M.E.repo);
  // the grid scan, beside the browser
  const scanFile = path.join(A.out, 'scan.json');
  const scan = new Promise((res) => { const ch = spawn(process.execPath, [path.join(__dirname, '../lib/expect.mjs'), A.repo || M.E.repo, scanFile, '--scan', '--coins', M.slugs().map((s) => M.coin(s).sym).join(',')], { stdio: 'ignore' }); ch.on('exit', (code) => res(code)); });

  // ---- 0. Node alone: td-view's distances are the engine's (found again by recount) ----
  for (const slug of M.slugs()) for (const T of M.coin(slug).tfs) {
    if (!T.progress) continue;
    C.ok(T.progress.sameAsBarsPartial, `[${slug} ${T.tf}] the bar in progress built here from the daily data is not bars.js's partial bar`);
    for (const t of T.trigs) {
      C.count('triggers');
      const f = t.fire, m = t.mine;
      C.ok((f === null) === (m === null) && (f === null || (f.now === m.now && f.p === m.p && f.q === m.q)), `[${slug} ${T.tf}] ${t.k} dir ${t.d} f ${t.f}: td-view fire ${JSON.stringify(f)}, recount of the engine ${JSON.stringify(m)}`);
      if (f) C.count('reachable');
    }
  }

  const recountFromText = (slug, cond, base, tipInfo, where) => {
    const coin = M.coin(slug), tick = coin.tick, c0 = base.c, want = { is13: tipInfo.is13, d: tipInfo.d, f: tipInfo.f, o: tipInfo.o, rep: tipInfo.is13 ? null : tipInfo.rep };
    const pr = (bar) => ENG.has(ENG.printed(coin.usd, cond.tf, bar), want);
    const mk = (reach, close, open = base.o) => ({ o: open, h: Math.max(base.h, reach, close, open), l: Math.min(base.l, reach, close, open), c: close });
    const F = tipInfo.fire;
    if (F) {
      if (F.now) { C.count('recounts'); C.ok(pr({ o: base.o, h: base.h, l: base.l, c: base.c }), `${where}: written as met now, but the engine prints no such label on the bar as it is`); }
      else {
        const dir = Math.sign(F.P - c0), short = F.P - dir * tick;
        if (F.kind === 'close') {
          C.count('recounts', 2);
          C.ok(pr(mk(F.P, F.P)), `${where}: "조건가 ${F.Ptext} · 이 값에서 마감하면 충족", but a bar that goes to ${F.P} and closes there gets no label from the engine`);
          C.ok(!pr(mk(short, short)), `${where}: a bar that stops one tick short of the written price (${short}) and closes there already gets the label`);
        } else {
          const Qv = F.kind === 'back' ? c0 : F.Q;
          C.count('recounts', 2);
          C.ok(pr(mk(F.P, Qv)), `${where}: written "조건가 ${F.Ptext}, 닿은 뒤 ${F.kind === 'back' ? '지금 가격' : F.Qtext}에서 마감해도 충족", but a bar that touches ${F.P} and closes at ${Qv} gets no label`);
          C.ok(!pr(mk(short, Qv)), `${where}: a bar that stops one tick short of ${F.Ptext} (${short}) and closes at ${Qv} already gets the label`);
          if (F.kind === 'q') { const nearer = F.Q - Math.sign(F.Q - c0) * tick; C.count('recounts'); C.ok(!pr(mk(F.P, nearer)), `${where}: a bar that touches ${F.Ptext} and closes one tick nearer than the written ${F.Qtext} (${nearer}) still gets the label`); }
        }
      }
    }
    const S = tipInfo.sentence;
    if (S) {
      // every bar made of the written thresholds and one tick either side of them: the sentence and the engine agree
      const vs = new Set([c0]); for (const g of [S.all, ...(S.any || []), ...(S.unless || [])]) for (const [, , v] of g) for (const d of [-tick, 0, tick]) vs.add(Number((v + d).toFixed(coin.decimals + 2)));
      const prices = [...vs].filter((v) => v > 0), opens = base.assumed ? prices : [base.o];
      let diff = 0, n = 0, yes = 0;
      for (const o of opens) for (const reach of prices) for (const close of prices) {
        const bar = base.assumed ? { o, h: Math.max(o, reach, close), l: Math.min(o, reach, close), c: close } : mk(reach, close);
        const says = sentenceSays(S, bar), does = pr(bar); n++; if (does) yes++;
        if (says !== does && diff++ < 2) C.fail(`${where}: the sentence "${tipInfo.sentenceText}" ${says ? 'promises' : 'excludes'} the label for the bar ${JSON.stringify(bar)}, the engine ${does ? 'prints it' : 'does not print it'}`);
      }
      C.count('sentenceBars', n); C.count('sentenceBarsWithLabel', yes); if (!diff) C.count('sentencesAgreeing');
      if (!S.never && yes === 0) C.fail(`${where}: none of ${n} bars around the written prices gets the label`);
    }
  };

  // ---- 1. the page on a wide screen ----
  await Promise.all(M.slugs().map(async (slug) => {
    const coin = M.coin(slug), ctx = await Q.open(A.base, { hash: '#chart-a-' + slug });
    const { page } = ctx;
    let st = { ...Q.DEFAULT_STATE };
    const set = async (patch) => { st = { ...st, ...patch }; await Q.setState(page, patch); };
    const zone = async (tag, withTips) => {
      const s = await Q.snap(page), p = s.probe, c = P.parseChart(s.frames.cBase, s.theme), { Y } = scales(p), where = `[${slug} ${tag}]`;
      C.count('states');
      const exp = st.cond === 'on' && p.end ? M.conds(slug, st) : [];
      const key = (q) => `${q.j}|${q.k}|${q.d}|${q.f == null ? '-' : q.f}|${q.o == null ? '-' : q.o}`;
      const eBy = new Map(exp.map((q) => [q.key, q])), pBy = new Map(p.conds.map((q) => [key(q), q]));
      if (pBy.size !== p.conds.length) C.fail(`${where} the probe has a condition twice`);
      for (const [k, e] of eBy) if (!pBy.has(k)) C.fail(`${where} missing condition: ${e.tf} ${e.k} dir ${e.d} f ${e.f} from ${e.o == null ? '-' : iso(e.o)} (engine: p ${e.fire.p}, ${(e.fire.pct * 100).toFixed(2)}%)`);
      for (const [k, q] of pBy) if (!eBy.has(k)) C.fail(`${where} a condition the engine does not have in this selection: ${q.tf} ${q.k} dir ${q.d} f ${q.f} p ${q.p}`);
      C.count('expectedConditions', exp.length);
      if (c.unknown.length) C.fail(`${where} ${c.unknown.length} painted calls fit no part of the picture, first ${JSON.stringify(c.unknown[0]).slice(0, 200)}`);
      const Z = c.zone;
      if (!!Z !== (st.cond === 'on' && p.end)) C.fail(`${where} the zone is ${Z ? '' : 'not '}painted; 다음 봉 조건 is ${st.cond}, the window ${p.end ? 'ends at the newest day' : 'is moved back'}`);
      if (!Z) { if (p.conds.length) C.fail(`${where} conditions in the probe without a zone`); return s; }
      if (Z.stray.length) C.fail(`${where} the zone has ${Z.stray.length} painted things that are no part of a chip: ${JSON.stringify(Z.stray[0]).slice(0, 200)}`);
      if (!Z.title) C.fail(`${where} the zone has no title`);
      if (Math.abs(Z.x0 - p.plot.r) > 0.01) C.fail(`${where} the zone begins at x ${Z.x0}, the plot ends at ${p.plot.r}`);
      // the newest close
      const yC = Y(coin.lastClose);
      if (p.last !== coin.lastClose) C.fail(`${where} newest close ${p.last} in the probe, ${coin.lastClose} in the data`);
      if (yC >= p.plot.t + 1 && yC <= p.plot.b - 1) {
        if (!Z.closeLine || Math.abs(Z.closeLine.path[0][2] - 0.5 - yC) > 0.51) C.fail(`${where} the line of the newest close is at y ${Z.closeLine ? Z.closeLine.path[0][2] : 'nowhere'}, ${coin.lastClose} is at ${yC.toFixed(2)}`);
        if (!Z.closeTag || !(Math.abs(parsePrice(Z.closeTag.text) - coin.lastClose) <= coin.lastClose * 5e-4)) C.fail(`${where} the newest close is written "${Z.closeTag ? Z.closeTag.text : ''}", it is ${coin.lastClose}`);
        else if (parsePrice(Z.closeTag.text) !== coin.lastClose) C.count('closeTagShortened');
      }
      if (!exp.length && !Z.empty.length) C.fail(`${where} no condition, and the zone does not say so`);
      const byBox = new Map(Z.chips.map((ch) => [ch.box ? `${ch.box.x}|${ch.box.y}|${ch.box.w}|${ch.box.h}` : '?', ch])), used = new Set(), folded = [];
      const boxes = [];
      for (const [k, q] of pBy) {
        const e = eBy.get(k); if (!e) continue;
        const f = e.fire, name = `${where} ${q.tf} ${q.k === 'C13' ? FAM_NAME[q.f] + ' ' : ''}${q.d === 1 ? 'sell' : 'buy'} ${q.k}`;
        C.count('conditions');
        if (q.p !== f.p || q.q !== f.q || q.pct !== f.pct || q.now !== f.now) C.fail(`${name}: the page has p ${q.p}, q ${q.q}, ${q.pct}, now ${q.now}; the engine and td-view give p ${f.p}, q ${f.q}, ${f.pct}, now ${f.now}`);
        if (q.near !== (!f.now && Math.abs(f.pct) <= st.near / 100)) C.fail(`${name}: near ${q.near} at ${(f.pct * 100).toFixed(2)}% with the threshold ${st.near}%`);
        if (q.shown === 'folded') { folded.push(q); continue; }
        if (!['in', 'above', 'below'].includes(q.shown)) { C.fail(`${name}: shown "${q.shown}" on a wide screen`); continue; }
        const ch = byBox.get(`${q.x}|${q.y}|${q.w}|${q.h}`);
        if (!ch) { C.fail(`${name}: the probe has its chip at ${q.x},${q.y}; nothing is painted there`); continue; }
        used.add(ch); boxes.push({ x: q.x, y: q.y, w: q.w, h: q.h, name }); C.count('chipsPainted');
        const is13 = q.k === 'C13', color = is13 ? M.famColor[q.f] : M.setupColor;
        if (!ch.text || ch.text.text !== (is13 ? '13' : '9')) C.fail(`${name}: the chip says "${ch.text && ch.text.text}"`);
        if (!ch.sup || ch.sup.text !== q.tf) C.fail(`${name}: the chip's superscript is "${ch.sup && ch.sup.text}"`);
        if (!ch.frame || ch.frame.color !== color) C.fail(`${name}: the chip's frame is ${ch.frame && ch.frame.color}, its color is ${color}`);
        if (ch.frame && (ch.frame.dash.length > 0) !== !is13) C.fail(`${name}: a ${is13 ? '13' : '9'} with a ${ch.frame.dash.length ? 'dashed' : 'solid'} frame`);
        if (is13 && (!ch.ground || ch.ground.color !== color)) C.fail(`${name}: the chip's ground is ${ch.ground && ch.ground.color}`);
        if (!ch.dist) C.fail(`${name}: no distance written beside the chip`);
        else if (f.now ? ch.dist.text !== '충족' : !pctOk(ch.dist.text, f.pct)) C.fail(`${name}: written "${ch.dist.text}" beside the chip, the distance is ${(f.pct * 100).toFixed(3)}%${f.now ? ' (met now)' : ''}`);
        // its price on the chart's scale
        const target = f.now ? coin.lastClose : f.p, yT = Y(target);
        if (q.shown === 'in') {
          if (!ch.pointer) C.fail(`${name}: no pointer from its price to the chip`);
          else {
            const py = ch.pointer.path[0][2], end = ch.pointer.path[2];
            if (Math.abs(py - 0.5 - Math.max(p.plot.t, Math.min(p.plot.b, yT))) > 0.51) C.fail(`${name}: the pointer starts at y ${py}, the price ${target} is at y ${yT.toFixed(2)} on the chart's scale`);
            if (Math.abs(end[1] - (q.x - 1)) > 0.01 || Math.abs(end[2] - (q.y + q.h / 2)) > 0.01) C.fail(`${name}: the pointer ends at ${end[1]},${end[2]}, the chip is at ${q.x},${q.y}`);
            if (ch.pointer.ss !== color) C.fail(`${name}: pointer in ${ch.pointer.ss}`);
            C.count('pricesOnScale');
          }
          if (yT < p.plot.t + 5 - 0.01 || yT > p.plot.b - 5 + 0.01) C.fail(`${name}: shown inside the zone, but its price is at y ${yT.toFixed(1)} (plot ${p.plot.t}..${p.plot.b})`);
          if (ch.arrow) C.fail(`${name}: an edge arrow on a chip that is at its price`);
          const hasQ = !f.now && f.q !== f.p;
          if (!!ch.rail !== hasQ) C.fail(`${name}: ${ch.rail ? 'a' : 'no'} line to the close level; q ${f.q}, p ${f.p}`);
          else if (hasQ) {
            const yq = Math.max(p.plot.t, Math.min(p.plot.b, Y(f.q))), a = ch.rail.path[0][2], b = ch.rail.path[1][2];
            if (Math.abs(b - 0.5 - yq) > 0.51 || Math.abs(a - ch.pointer.path[0][2]) > 0.01) C.fail(`${name}: the close level line runs y ${a}..${b}, the close level ${f.q} is at y ${Y(f.q).toFixed(2)}`);
            const wantTick = f.qpct !== 0 && Y(f.q) >= p.plot.t && Y(f.q) <= p.plot.b;
            if (!!ch.tick !== wantTick) C.fail(`${name}: ${ch.tick ? 'a' : 'no'} tick at the close level (q ${f.q}, ${f.qpct})`);
            else if (ch.tick && Math.abs(ch.tick.path[0][2] - 0.5 - Y(f.q)) > 0.51) C.fail(`${name}: the tick of the close level is at y ${ch.tick.path[0][2]}, ${f.q} is at ${Y(f.q).toFixed(2)}`);
            C.count('closeLevels');
          }
          if (!!ch.dot !== !!f.now) C.fail(`${name}: ${ch.dot ? 'a' : 'no'} dot for a condition that is ${f.now ? '' : 'not '}met now`);
        } else {
          const up = q.shown === 'above';
          if (up ? !(yT < p.plot.t + 5) : !(yT > p.plot.b - 5)) C.fail(`${name}: pinned to the ${up ? 'top' : 'bottom'} edge, but its price ${target} is at y ${yT.toFixed(1)} (plot ${p.plot.t}..${p.plot.b})`);
          if (!ch.arrow) C.fail(`${name}: pinned to an edge without an arrow`);
          else { const ys = ch.arrow.path.slice(0, 3).map((x) => x[2]), apex = ch.arrow.path[0][2]; if (up ? apex !== Math.min(...ys) : apex !== Math.max(...ys)) C.fail(`${name}: the arrow of a chip pinned to the ${up ? 'top' : 'bottom'} points the other way`); }
          if (ch.pointer) C.fail(`${name}: a pinned chip with a pointer to a price`);
          C.count('pinned');
        }
      }
      for (const ch of Z.chips) if (!used.has(ch)) C.fail(`${where} a chip "${ch.text && ch.text.text}${ch.sup ? ch.sup.text : ''}" is painted at ${JSON.stringify(ch.box)}; the probe has no condition there`);
      for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) if (P.hit(boxes[i], boxes[k])) C.fail(`${boxes[i].name} and ${boxes[k].name}: chips overlap`);
      for (const b of boxes) if (b.x < Z.x0 || b.x + b.w > c.W || b.y < p.plot.t || b.y + b.h > p.plot.b) C.fail(`${b.name}: the chip leaves the zone`);
      // folded conditions: in "외 N개" chips, whose tooltips name them
      const nMore = Z.more.reduce((a, m) => a + Number((/외 (\d+)개/.exec(m.text) || [0, 0])[1]), 0);
      if (nMore !== folded.length) C.fail(`${where} ${folded.length} conditions are folded, the zone's 외 N개 chips count ${nMore}`);
      if (folded.length) {
        const named = [];
        for (const mo of Z.more) { await page.mouse.move(s.rc.x + mo.x + mo.w / 2, s.rc.y + mo.y + mo.h / 2); const t = await Q.tip(page); if (!t) { C.fail(`${where} no tooltip on the zone's "${mo.text}"`); continue; } for (const r of t.rows) if (r.num && r.inSec) named.push(r); const more = /외 (\d+)개가 더 있습니다/.exec(t.text); if (more) C.count('foldedBeyondTooltip', Number(more[1])); }
        await Q.mouseOff(page);
        for (const q of folded) { const hitRow = named.find((r) => r.num.sup === q.tf && r.num.text === (q.k === 'C13' ? '13' : '9') && r.rest.includes(q.d === 1 ? '매도 쪽' : '매수 쪽') && (q.k !== 'C13' || r.rest.includes(FAM_NAME[q.f]))); if (hitRow) C.count('foldedNamed'); else C.count('foldedNotInTooltip'); }
      }
      // tooltips, and the written numbers put to the engine
      if (withTips) {
        for (const [k, q] of pBy) {
          const e = eBy.get(k); if (!e || q.shown === 'folded') continue;
          const f = e.fire, is13 = q.k === 'C13', name = `${where} ${q.tf} ${is13 ? FAM_NAME[q.f] + ' ' : ''}${q.d === 1 ? '매도' : '매수'} ${q.k}`;
          await page.mouse.move(s.rc.x + q.x + q.w / 2, s.rc.y + q.y + q.h / 2);
          const t = await Q.tip(page);
          if (!t) { C.fail(`${name}: no tooltip on the chip`); continue; }
          C.count('tooltips');
          const h1 = t.kids.find((x) => x.cls === 'h1'), m1 = h1 && /^(\d+[DWM]) · (?:(Sequential|Combo|Aggressive Combo|Aggressive Sequential) )?(매수|매도) 쪽 (13|반복 9|9)$/.exec(h1.text);
          if (!m1) { C.fail(`${name}: tooltip heading "${h1 && h1.text}"`); continue; }
          const info = { tf: m1[1], is13: m1[4] === '13', f: m1[2] ? FAM_NAME.indexOf(m1[2]) : null, d: m1[3] === '매도' ? 1 : -1, rep: m1[4] === '반복 9', o: null, fire: null, sentence: null };
          if (info.tf !== q.tf || info.is13 !== is13 || info.d !== e.d || (is13 && info.f !== e.f) || (!is13 && info.rep !== (e.k === 'S9r'))) C.fail(`${name}: tooltip heading "${h1.text}"`);
          const r0 = t.rows[0];
          if (!r0 || !r0.num || r0.num.text !== (is13 ? '13' : '9') || r0.num.sup !== q.tf) C.fail(`${name}: the tooltip's mark is "${r0 && r0.num && r0.num.text + r0.num.sup}"`);
          const ft = r0 ? r0.rest : '';
          if (/^지금 값으로 충족$/.test(ft)) { info.fire = { now: true }; if (!f.now) C.fail(`${name}: the tooltip says met now, the engine does not`); }
          else {
            const m2 = /^조건가 ([\d,.]+) \(([+−][\d.]+%|0%)\) · (이 값에서 마감하면 충족|닿은 뒤 지금 가격에서 마감해도 충족|닿은 뒤 ([\d,.]+) \(([+−][\d.]+%|0%)\)에서 마감해도 충족)\s*(임박)?$/.exec(ft);
            if (!m2) C.fail(`${name}: cannot read the tooltip line "${ft}"`);
            else {
              const kind = m2[3].startsWith('이 값') ? 'close' : m2[4] ? 'q' : 'back';
              info.fire = { now: false, P: num(m2[1]), Ptext: m2[1], kind, Q: m2[4] ? num(m2[4]) : null, Qtext: m2[4] || null };
              if (f.now) C.fail(`${name}: the engine says met now, the tooltip "${ft}"`);
              if (!priceOk(m2[1], f.p)) C.fail(`${name}: tooltip price ${m2[1]}, the engine's ${f.p}`);
              if (!pctOk(m2[2], f.pct)) C.fail(`${name}: tooltip distance ${m2[2]}, the engine's ${(f.pct * 100).toFixed(3)}%`);
              if (kind !== (f.q === f.p ? 'close' : f.qpct === 0 ? 'back' : 'q')) C.fail(`${name}: tooltip "${m2[3]}", the engine has p ${f.p}, q ${f.q}`);
              if (kind === 'q' && (!priceOk(m2[4], f.q) || !pctOk(m2[5], f.qpct))) C.fail(`${name}: tooltip close level ${m2[4]} (${m2[5]}), the engine's ${f.q} (${(f.qpct * 100).toFixed(3)}%)`);
              if (!!m2[6] !== q.near) C.fail(`${name}: 임박 ${m2[6] ? 'written' : 'not written'}, near is ${q.near}`);
            }
          }
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
          const meta = t.rows[t.rows.length - 1], m3 = meta && /^(?:출발 봉 (\d{4}-\d\d-\d\d) · )?(진행 중인 봉|다음 봉) (\d{4}-\d\d-\d\d)(?: ~ ((?:\d{4}-)?\d\d-\d\d))?(?: · (\d{4}-\d\d-\d\d)까지 반영)?$/.exec(meta.rest);
          if (!m3) C.fail(`${name}: cannot read the tooltip's last line "${meta && meta.rest}"`);
          else {
            const s0 = Q.dayOf(m3[3]), e0 = m3[4] ? Q.dayOf(m3[4].length === 5 ? m3[3].slice(0, 5) + m3[4] : m3[4]) : s0, pr = e.progress;
            info.o = m3[1] ? Q.dayOf(m3[1]) : null;
            if (is13 ? info.o !== e.o : info.o !== null) C.fail(`${name}: origin bar ${m3[1]}, the engine's run starts at ${e.o == null ? '-' : iso(e.o)}`);
            if (s0 !== pr.start || e0 !== pr.end) C.fail(`${name}: the bar is written as ${m3[3]} ~ ${m3[4] || m3[3]}, the bar in progress is ${iso(pr.start)} ~ ${iso(pr.end)}`);
            if ((m3[5] ? Q.dayOf(m3[5]) : null) !== (pr.last !== null && pr.last < pr.end ? pr.last : null)) C.fail(`${name}: "${m3[5] || ''}까지 반영", the bar in progress holds closed days through ${pr.last == null ? 'none' : iso(pr.last)}`);
          }
          recountFromText(slug, { tf: q.tf }, e.progress.base, info, name);
          // a click opens that timeframe's chart on TradingView
          const before = await page.evaluate(() => __qa.opens.length);
          await page.mouse.click(s.rc.x + q.x + q.w / 2, s.rc.y + q.y + q.h / 2);
          const opened = await page.evaluate((n) => __qa.opens.slice(n), before), iv = q.tf.replace(/^1(?=[DWM]$)/, '');
          C.ok(opened.length === 1 && opened[0].url === `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(coin.usd)}&interval=${iv}` && opened[0].target === '_blank', `${name}: a click on the chip opened ${JSON.stringify(opened)}`);
        }
        await Q.mouseOff(page);
      }
      return s;
    };
    await zone('6개월', true);
    for (const name of ['3개월', '1년', '2년', '5년', '전체']) { await Q.preset(page, name); await zone(name, name === '전체'); }
    await Q.preset(page, '6개월');
    for (const patch of [{ near: 3 }, { near: 10 }, { near: 5, dir: 'buy' }, { dir: 'sell' }, { dir: 'both', fam: [0] }, { fam: [3] }, { fam: [2] }, { fam: [] }, { fam: [0, 2, 3], nine: 'off' }, { nine: 'on', off: ['2W'] }, { off: M.TFS.filter((t) => t !== '2D') }, { off: M.TFS.slice(0, 7) }, { off: [], scale: 'log' }, { scale: 'lin' }, { scale: 'auto', cond: 'off' }, { cond: 'on' }]) { await set(patch); await zone(JSON.stringify(patch).slice(0, 50), false); }
    // moved back: the zone leaves; 최근으로 brings it back
    await Q.panWheel(page, -200); await zone('moved back', false);
    await page.click('.bec-now'); const back = await zone('after 최근으로', false);
    C.ok(back.probe.end && back.probe.d1 === M.LAST, `[${slug}] 최근으로 did not return to the newest day`);
    C.logs(ctx, slug);
    await ctx.context.close();

    // ---- 2. a phone: the same conditions as a list under the chart ----
    const ph = await Q.open(A.base, { hash: '#chart-a-' + slug, width: 390, height: 844, touch: true });
    const rows = await ph.page.evaluate(() => [...document.querySelectorAll('.bec-conds .bec-crow')].map((r) => { const w = r.querySelector('b.bec-w'), g = (s) => { const e = r.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
      return { mark: w ? w.firstChild.textContent : null, sup: w ? w.querySelector('sup').textContent : null, color: w ? w.style.getPropertyValue('--c') : null, name: g('.bec-r1 > span:not(.bec-end)'), dist: g('.bec-dist'), near: !!r.querySelector('.bec-near'), met: !!r.querySelector('.bec-met'), px: g('.bec-px'), sent: g('.bec-sent'), meta: g('.bec-meta > span'), href: (r.querySelector('a') || {}).href || null }; }));
    const sp = await Q.snap(ph.page), head = await ph.page.evaluate(() => { const h = document.querySelector('.bec-conds h3'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : null; });
    const exp = M.conds(slug, Q.DEFAULT_STATE).sort((a, b) => Number(b.fire.now) - Number(a.fire.now) || Math.abs(a.fire.pct) - Math.abs(b.fire.pct) || a.j - b.j || (a.f == null ? -1 : a.f) - (b.f == null ? -1 : b.f));
    C.ok(P.parseChart(sp.frames.cBase, sp.theme).zone === null, `[${slug} phone] a zone is painted in the narrow chart`);
    C.ok(rows.length === exp.length && sp.probe.conds.length === exp.length && sp.probe.conds.every((q) => q.shown === 'list'), `[${slug} phone] ${rows.length} rows in the list, ${sp.probe.conds.length} conditions in the probe, ${exp.length} expected`);
    const hm = head && /^다음 봉 조건\s*최근 종가 ([\d,.]+) · (\d{4}-\d\d-\d\d) 마감$/.exec(head);
    C.ok(hm && num(hm[1]) === coin.lastClose && hm[2] === M.E.lastClosedDay, `[${slug} phone] list heading "${head}"`);
    rows.forEach((r, i) => {
      const e = exp[i]; if (!e) return; const f = e.fire, is13 = e.k === 'C13', name = `[${slug} phone row ${i + 1}] ${e.tf} ${is13 ? FAM_NAME[e.f] + ' ' : ''}${e.d === 1 ? '매도' : '매수'} ${e.k}`;
      C.count('listRows');
      if (r.mark !== (is13 ? '13' : '9') || r.sup !== e.tf) C.fail(`${name}: the row's mark is ${r.mark}${r.sup}`);
      if (r.name !== `${is13 ? FAM_NAME[e.f] + ' ' : ''}${e.d === 1 ? '매도' : '매수'} 쪽 ${is13 ? '13' : e.k === 'S9r' ? '반복 9' : '9'}`) C.fail(`${name}: named "${r.name}"`);
      if (f.now ? !r.met : !(r.dist && pctOk(r.dist, f.pct))) C.fail(`${name}: distance "${r.dist}", met ${r.met}; the engine's ${(f.pct * 100).toFixed(3)}%, now ${f.now}`);
      if (r.near !== (!f.now && Math.abs(f.pct) <= 0.05)) C.fail(`${name}: 임박 ${r.near}`);
      const info = { tf: e.tf, is13, f: e.f, d: e.d, rep: e.k === 'S9r', o: null, fire: null, sentence: null };
      if (!f.now) {
        const m = /^(종가|저가|고가) ([\d,.]+)(?: · 종가 ([\d,.]+) \(([+−][\d.]+%|0%)\))?$/.exec(r.px || '');
        if (!m) C.fail(`${name}: cannot read the prices "${r.px}"`);
        else {
          const kind = m[1] === '종가' ? 'close' : m[3] ? 'q' : 'back';
          if (kind !== (f.q === f.p ? 'close' : f.qpct === 0 ? 'back' : 'q') || !priceOk(m[2], f.p) || (kind !== 'close' && m[1] !== (f.dir < 0 ? '저가' : '고가')) || (kind === 'q' && (!priceOk(m[3], f.q) || !pctOk(m[4], f.qpct)))) C.fail(`${name}: prices "${r.px}", the engine has p ${f.p}, q ${f.q} (${f.qpct}), dir ${f.dir}`);
          info.fire = { now: false, P: num(m[2]), Ptext: m[2], kind, Q: m[3] ? num(m[3]) : null, Qtext: m[3] || null };
        }
      } else info.fire = { now: true };
      let S = null; try { S = parseSentence(r.sent || ''); } catch (err) { S = null; }
      if (!S) C.fail(`${name}: cannot read the sentence "${r.sent}"`); else { info.sentence = S; info.sentenceText = r.sent; }
      const m3 = /^(?:출발 봉 (\d{4}-\d\d-\d\d) · )?(진행 중인 봉|다음 봉) (\d{4}-\d\d-\d\d)(?: ~ ((?:\d{4}-)?\d\d-\d\d))?(?: · (\d{4}-\d\d-\d\d)까지 반영)?$/.exec(r.meta || '');
      if (!m3) C.fail(`${name}: cannot read "${r.meta}"`); else { info.o = m3[1] ? Q.dayOf(m3[1]) : null; if (is13 && info.o !== e.o) C.fail(`${name}: origin bar ${m3[1]}, the engine's ${iso(e.o)}`); }
      if (r.href !== `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(coin.usd)}&interval=${e.tf.replace(/^1(?=[DWM]$)/, '')}`) C.fail(`${name}: link ${r.href}`);
      recountFromText(slug, { tf: e.tf }, e.progress.base, info, name);
    });
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
  const rc = C.finish(A.out);
  await Q.closeAll();
  process.exit(rc);
})().catch((e) => { console.error('conds.cjs crashed:', e); process.exit(3); });
