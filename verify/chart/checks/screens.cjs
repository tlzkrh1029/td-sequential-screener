// Check 12: the same sweep (base, identity, anchor, painted, geometry: checks/sweep.cjs in its short form) on other
// screens: a phone at 3 device pixels, a wide and a small desktop, a screen at 2 device pixels, and the dark theme.
// One line for all of them; the failures say on which screen.
//   node screens.cjs --base http://127.0.0.1:8911/ --out <dir>
const path = require('path'), fs = require('fs'), { spawn } = require('child_process');
const Q = require('../lib/qa.cjs');
const A = Q.args();
(async () => {
  const C = new Q.Check('c12_other_screens');
  const variants = [['phone 390x844 @3', ['--vp', '390x844', '--dpr', '3', '--touch']], ['wide 1920x1080', ['--vp', '1920x1080']], ['small 1024x768', ['--vp', '1024x768']], ['1440x900 @2', ['--dpr', '2']], ['dark theme', ['--dark']]];
  const run = (name, extra) => new Promise((res) => {
    const out = path.join(A.out, 'screens', name.replace(/[^a-z0-9]+/gi, '-')); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
    const ch = spawn(process.execPath, [path.join(__dirname, 'sweep.cjs'), '--base', A.base, '--out', out, '--expect', A.expect, '--quick', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; ch.stderr.on('data', (d) => { err += d; }); ch.stdout.on('data', () => {});
    ch.on('exit', (code) => res({ name, out, code, err }));
  });
  // two at a time
  const results = [];
  for (let i = 0; i < variants.length; i += 2) results.push(...await Promise.all(variants.slice(i, i + 2).map(([n, x]) => run(n, x))));
  for (const r of results) {
    C.count('screens');
    if (r.code === 3 || r.code === null) { C.fail(`[${r.name}] the sweep crashed: ${r.err.slice(0, 300)}`); continue; }
    for (const f of fs.readdirSync(r.out).filter((x) => /^c0\d_.*\.json$/.test(x))) {
      const j = JSON.parse(fs.readFileSync(path.join(r.out, f), 'utf8'));
      C.count('states', f.startsWith('c01') ? j.totals.states || 0 : 0);
      if (f.startsWith('c01')) C.count('labelInstancesCompared', j.totals.expected || 0);
      if (f.startsWith('c03')) { C.count('numbersPainted', j.totals.paintedNumbers || 0); C.count('numbersComparedAsPixels', j.totals.numbersComparedAsPixels || 0); }
      for (const m of j.fails) C.fail(`[${r.name}] ${j.name}: ${m}`);
    }
  }
  process.exit(C.finish(A.out));
})().catch((e) => { console.error('screens.cjs crashed:', e); process.exit(3); });
