// scripts/build-site.mjs --coins: a site for a few coins, as the Bird eye chart study is built. Run: node --test test/
//
// Each case runs the build script on the repository's data and writes into a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const json = (...parts) => JSON.parse(readFileSync(path.join(...parts), 'utf8'));
const build = (...args) => spawnSync(process.execPath, [path.join('scripts', 'build-site.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
const pageData = (html) => JSON.parse(/^const DATA = (\{.*\});$/m.exec(html)[1]);
function tmp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'td-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('--coins: the page data, the daily files and b.json hold only the coins asked for', (t) => {
  const out = path.join(tmp(t), 'site');
  const run = build(out, '--coins', 'eth, Btc', '--chunk', '8'); // letter case and blanks do not matter
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readdirSync(out).sort(), ['b.json', 'd', 'index.html']);
  assert.deepEqual(readdirSync(path.join(out, 'd')), ['0.json']);

  const data = pageData(readFileSync(path.join(out, 'index.html'), 'utf8'));
  assert.deepEqual(data.coins.map((c) => c.s), ['BTC', 'ETH']); // by market cap, as in the whole site
  // a coin keeps the rank it has among all coins of the universe
  const all = json(ROOT, 'data', 'universe.json').coins.map((u) => ({ s: u.sym, mc: Math.round(u.mcap || 0) })).sort((a, b) => b.mc - a.mc);
  for (const c of data.coins) assert.equal(c.r, all.findIndex((u) => u.s === c.s) + 1, c.s);
  assert.deepEqual(data.coins.map((c) => c.ch), [0, 0]);

  // the daily file: these two tickers, each the whole data file but its id
  const chunk = json(out, 'd', '0.json');
  assert.equal(chunk.build, data.build);
  assert.deepEqual(Object.keys(chunk.daily).sort(), data.coins.map((c) => c.usd).sort());
  for (const c of data.coins) {
    const { id, ...file } = json(ROOT, 'data', 'daily', c.usd.replace(/[^A-Za-z0-9.]+/g, '_') + '.json');
    assert.equal(id, c.usd);
    assert.deepEqual(chunk.daily[c.usd], file, c.usd);
  }

  // the breadth counts are those of the two coins
  const breadth = json(out, 'b.json');
  assert.equal(breadth.build, data.build);
  const days = breadth.series['1D'];
  assert.equal(days[days.length - 1][1], 2);
  assert.ok(days.every((row) => row[1] >= 1 && row[1] <= 2));
});

test('--coins: a symbol that is no coin or has no TradingView data, or no symbol at all, is an error and nothing is written', (t) => {
  const dir = tmp(t), out = path.join(dir, 'site');
  const fails = (re, ...args) => {
    const run = build(out, ...args);
    assert.notEqual(run.status, 0, args.join(' '));
    assert.match(run.stderr, re);
    assert.equal(existsSync(out), false, args.join(' '));
  };
  fails(/no coin with the symbol NOPE in data\/universe\.json/, '--coins', 'BTC,NOPE');
  fails(/--coins needs at least one coin symbol/, '--coins', ' , ');
  fails(/--coins needs at least one coin symbol/, '--coins'); // the value left out
  // a daily folder without the coin's file
  const daily = path.join(dir, 'daily');
  mkdirSync(daily);
  copyFileSync(path.join(ROOT, 'data', 'daily', '_status.json'), path.join(daily, '_status.json'));
  fails(/BTC has no TradingView data/, '--coins', 'BTC', '--daily-dir', daily);
});

test('the Bird eye chart page for BTC and ETH builds, and its scripts parse', (t) => {
  const out = path.join(tmp(t), 'site');
  const run = build(out, '--template', path.join('dashboard', 'mockups', 'birdeye.html'), '--chunk', '8', '--includes', 'be-chart', '--coins', 'BTC,ETH');
  assert.equal(run.status, 0, run.stderr);
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.deepEqual(pageData(html).coins.map((c) => c.s), ['BTC', 'ETH']);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 2);
  for (const code of scripts) new vm.Script(code); // throws on a syntax error
  // of the study's views only the chart is in the page
  assert.equal(scripts.filter((code) => /^\s*BE\.register\(\{/m.test(code)).length, 1);
  assert.match(html, /be-chart-css/);
});
