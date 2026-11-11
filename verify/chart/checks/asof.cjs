// Check 15: 다음 봉 조건 on other days. Today's data shows only some kinds of conditions (on 2026-11-09: nine 13s,
// no 9, none met, none within the 임박 threshold, no level that the price has to go beyond). This check cuts a copy of
// the data off at earlier days chosen from the last 500: the latest day with a 9 still waiting (a strict level: the
// close has to be beyond it, written "초과" / "미만"), the day with the most kinds of conditions, the latest day with
// two or more conditions within 3%, the latest day with a repeated 9 still waiting and the latest day with a condition
// met now. It builds the page for each into a folder of the served site and runs the conditions check
// (checks/conds.cjs) there: the written levels are put to the engine as on the newest day. On the first of them also
// the short sweep (base, identity, anchor, painted, geometry, piles). It fails when no strict level was met on the
// days chosen for one.
//   node asof.cjs --base http://127.0.0.1:8911/ --out <dir> --repo <repoDir>
const path = require('path'), fs = require('fs'), { spawn, execFileSync } = require('child_process');
const Q = require('../lib/qa.cjs');
const A = Q.args();
const run = (args, cwd) => new Promise((res) => { const ch = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('exit', (code) => res({ code, out, err })); });
(async () => {
  const C = new Q.Check('c15_conditions_other_days'), repo = path.resolve(A.repo);
  const { makeEngine } = await import('../lib/recount.mjs');
  const ENG = await makeEngine(repo), { BARS, TD, VIEW, LAST } = ENG;
  const E = JSON.parse(fs.readFileSync(A.expect, 'utf8'));
  const usds = Object.values(E.coins).map((c) => c.usd), syms = Object.values(E.coins).map((c) => c.sym);
  // ---- the days ----
  const byDay = new Map();
  for (const usd of usds) {
    const d = ENG.daily(usd);
    for (let D = LAST - 500; D < LAST; D++) {
      const i = D - d.d0; if (i < 400 || d.c[i] == null) continue;
      const a = byDay.get(D) || { D, n: 0, wait9: 0, wait9r: 0, s9r: 0, now: 0, near: 0, unless: 0, q: 0, strict: 0 };
      for (const tf of BARS.TFS) {
        const bars = BARS.buildBars(d, tf, D); if (!bars.n) continue;
        const res = TD.runTD(bars, {}), base = VIEW.baseBar(bars.partial, d.c[i]);
        for (const t of TD.nextBarTriggers(bars, res, {})) { const f = VIEW.fire(TD.evalTrigger, t, base); if (!f) continue; a.n++; if (t.k !== 'C13' && !f.now) a.wait9++; if (t.k === 'S9r' && !f.now) a.wait9r++; if (t.k === 'S9r') a.s9r++; if (f.now) a.now++; else if (Math.abs(f.pct) <= 0.03) a.near++; if (t.unless) a.unless++; if (!f.now && f.q !== f.p && f.qpct !== 0) a.q++; if ((f.pc && f.pc.strict) || (f.qc && f.qc.strict)) a.strict++; }
      }
      byDay.set(D, a);
    }
  }
  const all = [...byDay.values()], score = (a) => (a.wait9 ? 3 : 0) + (a.s9r ? 3 : 0) + (a.now ? 3 : 0) + (a.near ? 2 : 0) + (a.unless ? 4 : 0) + (a.q ? 1 : 0) + Math.min(a.n, 30) / 10;
  const pick = [], take = (a) => { if (a && !pick.includes(a)) pick.push(a); };
  const latest = (f) => all.filter(f).sort((x, y) => y.D - x.D)[0];
  take(latest((a) => a.wait9));
  take(all.slice().sort((x, y) => score(y) - score(x) || y.D - x.D)[0]);
  take(latest((a) => a.near >= 2));
  if (!A.quick) { take(latest((a) => a.wait9r)); take(latest((a) => a.now && a.wait9)); }
  const wantStrict = pick.some((a) => a.strict > 0);
  C.note(`days: ${pick.map((a) => `${BARS.isoOfDay(a.D)} (${a.n} conditions: ${a.wait9} waiting 9, ${a.wait9r} of them a repeated 9, ${a.now} met now, ${a.near} within 3%, ${a.unless} with an "unless", ${a.strict} with a strict level)`).join('; ')}; a 9 is still waiting on ${all.filter((a) => a.wait9).length} of the last ${all.length} days`);
  // ---- per day: the copy, the page, the checks ----
  const siteRoot = path.join(A.out, 'site');
  let first = true;
  for (const a of pick) {
    const day = BARS.isoOfDay(a.D), dir = path.join(A.out, 'asof', day), copy = path.join(dir, 'repo'), site = path.join(siteRoot, 'asof-' + day);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    execFileSync(process.execPath, [path.join(__dirname, '../tools/asof.mjs'), repo, copy, day, '--coins', syms.join(',')], { stdio: 'pipe' });
    execFileSync(process.execPath, ['scripts/build-site.mjs', site, '--template', 'dashboard/mockups/birdeye.html', '--chunk', '8', '--includes', 'be-chart', '--coins', syms.join(',')], { cwd: copy, stdio: 'pipe' });
    execFileSync(process.execPath, [path.join(__dirname, '../lib/expect.mjs'), copy, path.join(dir, 'expect.json'), '--coins', syms.join(',')], { stdio: 'pipe' });
    const base = A.base + 'asof-' + day + '/', args = ['--base', base, '--out', dir, '--expect', path.join(dir, 'expect.json'), '--repo', copy];
    const jobs = [['conds', run([path.join(__dirname, 'conds.cjs'), ...args, ...(A.quick ? ['--quick'] : [])])]];
    if (first) jobs.push(['sweep', run([path.join(__dirname, 'sweep.cjs'), ...args, '--quick'])]);
    first = false;
    for (const [name, job] of jobs) {
      const r = await job;
      if (r.code === 3 || r.code === null) { C.fail(`[as of ${day}] ${name} did not finish: ${r.err.slice(0, 300)}`); continue; }
      for (const f of fs.readdirSync(dir).filter((x) => (name === 'conds' ? /^c06_/ : /^c(0[0-4]|11)_/).test(x) && x.endsWith('.json'))) {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (name === 'conds') { for (const k of ['triggers', 'conditions', 'tooltips', 'recounts', 'strictLevels', 'strictLevelsWritten', 'strictRecounts', 'framedAndTintedChips', 'closeLevels', 'sentenceBars', 'listRows', 'scanFound']) C.count(k, j.totals[k] || 0); }
        else if (f.startsWith('c01')) { C.count('sweepStates', j.totals.states || 0); C.count('labelInstancesCompared', j.totals.expected || 0); }
        for (const m of j.fails) C.fail(`[as of ${day}] ${j.name}: ${m}`);
      }
    }
    C.count('days');
  }
  // the days were chosen for a level that the close has to go beyond: it has to have been written and put to the engine
  if (wantStrict) C.ok((C.n.strictLevelsWritten || 0) > 0 && (C.n.strictRecounts || 0) > 0, `on the days chosen for a 9 that is still waiting, ${C.n.strictLevelsWritten || 0} levels were written with "초과" or "미만" and ${C.n.strictRecounts || 0} of them put to the engine`);
  process.exit(C.finish(A.out));
})().catch((e) => { console.error('asof.cjs crashed:', e); process.exit(3); });
