// Download the whole daily OHLC history of the USD tickers in data/tickers.json over TradingView's chart
// WebSocket, without a login, one file per ticker in data/daily:
//   {id, d0, o, h, l, c, m, w}: index i is unix day d0 + i; null marks a day on which TradingView has no bar.
//   m = {d, o, h, l, c}: TradingView's own 1M bars of the closed months, fetched in the same pass; d[j] is the unix
//   day of the first day of the month of the j-th bar. A 1M chart shows these, and they are not always the aggregate
//   of the daily bars (they keep prices TradingView later revised away in its daily bars: CRYPTO:HUNTUSD 2026-10 low,
//   CRYPTO:TDROPUSD 2026-10 close), so dashboard/bars.js builds the month timeframes from them.
//   w = {d, o, h, l, c}: TradingView's own 1W bars of the closed weeks, likewise; d[j] is the unix day of the Monday
//   of the j-th bar. They lag behind revisions of the daily bars the same way (the open week of 2026-10-26:
//   CRYPTO:HUNTUSD low 0.082473, CRYPTO:SUNDOGUSD high 0.0015266, in no daily bar of that fetch), so the week
//   timeframes are built from them. Some histories come in two versions for 1W too: on 2026-11-01 one fetch got
//   CRYPTO:AVUUSD's 1D with and its 1W without 37 weeks of 2024-09 .. 2025-05 (weeksVsDaily reports such a fetch). 1D, 1M and 1W are fetched one right after the other, because some histories come
//   in two versions (CRYPTO:ZECUSD with or without the 2023-01-31 spike, CRYPTO:RSRUSD, ...) and each request can get
//   either.
//
// Based on wma0.3-screenshot/scripts/fetch-tv.mjs, changed so the TD counts can match the TradingView chart:
// - Every run fetches every ticker's whole history again. Nothing is merged into older files, so each file is
//   exactly what TradingView serves on the day of the run, revisions of old bars included.
// - The daily bar still in progress is dropped: only bars of days before the run's UTC start day are written.
//   One cutoff for the whole run, so a run that crosses midnight UTC stays consistent.
// - Every bar is checked: its time must be 00:00 UTC, days strictly increasing, open/high/low/close finite; a 1M bar
//   must start on the 1st of a month and a 1W bar on a Monday, and the 1M bar of the month in progress and the 1W
//   bar of the week in progress are dropped like the daily one. A ticker that fails a check, or whose 1D, 1M or 1W
//   request fails, keeps its previous file and is listed in _status.json.
// - Changes to bars that were already stored (TradingView revisions) are counted per ticker in _status.json (days,
//   months, weeks), and so are closed months and weeks that have a 1M / 1W bar but no daily bar or the other way
//   round (monthsVsDaily, weeksVsDaily).
//
// Env:
//   TICKERS_FILE  coins with resolved tickers (default data/tickers.json); the `usd` ticker of each coin is used
//   TV_SYMBOLS    comma-separated tickers instead of TICKERS_FILE (for tests; no pruning then)
//   OUT_DIR       output folder (default data/daily)
//   MAX_FAILED    share of tickers allowed to fail before the run fails (default 0.05)
//   HTTPS_PROXY   used for the WebSocket when set (the session proxy here; GitHub Actions has none)
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DAY = 86400;
const OUT_DIR = process.env.OUT_DIR || path.join('data', 'daily');
const MAX_FAILED = Number(process.env.MAX_FAILED ?? 0.05);
const FROM_LIST = !process.env.TV_SYMBOLS;
const SYMBOLS = FROM_LIST
  ? JSON.parse(await readFile(process.env.TICKERS_FILE || path.join('data', 'tickers.json'), 'utf8')).coins.map((c) => c.usd).filter(Boolean)
  : process.env.TV_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean);
const CANARY = 'CRYPTO:BTCUSD';
const CHUNK = 5000;
const MAX_ROUNDS = 12;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const startedAt = new Date();
const CUTOFF = Math.floor(startedAt.getTime() / 1000 / DAY); // first day that is not written (still in progress)
export const fileOf = (dir, id) => path.join(dir, id.replace(/[^A-Za-z0-9.]+/g, '_') + '.json');

// ---- wire format: "~m~<len>~m~<payload>", heartbeats are "~h~<n>" payloads ----
const frame = (payload) => `~m~${payload.length}~m~${payload}`;
function parseFrames(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const m = /^~m~(\d+)~m~/.exec(raw.slice(i));
    const end = m ? i + m[0].length + Number(m[1]) : -1;
    // The declared length may not match JS string length for non-ASCII text;
    // if it doesn't land on the next frame, split the rest on the delimiters.
    if (!m || (end < raw.length && !raw.startsWith('~m~', end))) {
      out.push(...raw.slice(i).split(/~m~\d+~m~/).filter(Boolean));
      break;
    }
    out.push(raw.slice(i + m[0].length, end));
    i = end;
  }
  return out;
}

class TVClient {
  constructor(ws) {
    this.ws = ws;
    this.listeners = new Set();
    this.rejecters = new Set();
    this.closed = null;
    const abort = (reason) => {
      this.closed = reason;
      for (const reject of [...this.rejecters]) reject(new Error(reason));
    };
    ws.on('close', (code) => abort(`connection closed (code ${code})`));
    ws.on('error', (err) => abort(`connection error: ${err.message}`));
    ws.on('message', (data) => {
      for (const payload of parseFrames(data.toString())) {
        if (payload.startsWith('~h~')) { ws.send(frame(payload)); continue; }
        let msg;
        try { msg = JSON.parse(payload); } catch { continue; }
        if ((msg.m === 'protocol_error' || msg.m === 'critical_error') && !String(msg.p?.[0] ?? '').startsWith('cs_')) {
          abort(`${msg.m}: ${JSON.stringify(msg.p).slice(0, 200)}`);
          continue;
        }
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  send(m, p) { this.ws.send(frame(JSON.stringify({ m, p }))); }
  wait(pick, timeoutMs = 45_000, label = 'message') {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error(this.closed));
      const done = () => { clearTimeout(timer); this.listeners.delete(fn); this.rejecters.delete(fail); };
      const fail = (err) => { done(); reject(err); };
      const timer = setTimeout(() => fail(new Error(`timeout waiting for ${label}`)), timeoutMs);
      const fn = (msg) => {
        let v;
        try { v = pick(msg); } catch (err) { v = err; }
        if (v === undefined) return;
        done();
        v instanceof Error ? reject(v) : resolve(v);
      };
      this.listeners.add(fn);
      this.rejecters.add(fail);
    });
  }
}

let sessionSeq = 0;
// Whole history of one ticker in one resolution ('1D', '1M' or '1W'): Map time -> [open, high, low, close] as
// TradingView sends them.
async function fetchSeries(client, symbol, resolution) {
  const cs = `cs_td${++sessionSeq}`;
  const bars = new Map();
  const onData = (msg) => {
    if ((msg.m === 'timescale_update' || msg.m === 'du') && msg.p?.[0] === cs) {
      for (const b of msg.p[1]?.sds_1?.s || []) bars.set(b.v[0], b.v.slice(1, 5));
    }
  };
  client.listeners.add(onData);
  const failed = (msg) => {
    if (msg.p?.[0] !== cs) return undefined;
    if (['symbol_error', 'series_error', 'critical_error', 'protocol_error'].includes(msg.m)) {
      return new Error(`${msg.m}: ${JSON.stringify(msg.p.slice(1)).slice(0, 200)}`);
    }
    return undefined;
  };
  const completed = (ms) => {
    const p = client.wait((msg) => failed(msg) ?? (msg.m === 'series_completed' && msg.p[0] === cs ? true : undefined), ms, `${symbol} ${resolution} data`);
    p.catch(() => {});
    return p;
  };
  try {
    const resolved = client.wait((msg) => failed(msg) ?? (msg.m === 'symbol_resolved' && msg.p[0] === cs ? msg.p[2] : undefined), 45_000, `${symbol} resolve`);
    resolved.catch(() => {});
    let next = completed(60_000);
    client.send('chart_create_session', [cs, '']);
    client.send('switch_timezone', [cs, 'Etc/UTC']);
    client.send('resolve_symbol', [cs, 'sds_sym_1', '=' + JSON.stringify({ symbol, adjustment: 'splits' })]);
    client.send('create_series', [cs, 'sds_1', 's1', 'sds_sym_1', resolution, CHUNK, '']);
    const meta = await resolved;
    await next;
    let added = bars.size >= CHUNK ? Infinity : 0;
    for (let round = 1; added > 0; round++) {
      if (round > MAX_ROUNDS) throw new Error(`still receiving data after ${MAX_ROUNDS} extra chunks; history may be truncated`);
      const before = bars.size;
      next = completed(45_000);
      client.send('request_more_data', [cs, 'sds_1', CHUNK]);
      await next; // a timeout fails the ticker instead of silently truncating it
      added = bars.size - before;
    }
    return { meta, bars };
  } finally {
    client.listeners.delete(onData);
    client.send('chart_delete_session', [cs]);
  }
}

// Bars -> {d0, o, h, l, c} of closed days, after checking every bar. Throws on a bar that breaks a check.
export function toDaily(bars, cutoff) {
  const rows = [...bars.entries()].sort((a, b) => a[0] - b[0]);
  const kept = [];
  let prevDay = -Infinity, oddRanges = 0;
  for (const [t, v] of rows) {
    if (!Number.isInteger(t) || t % DAY !== 0) throw new Error(`bar time ${t} is not 00:00 UTC`);
    const d = t / DAY;
    if (d <= prevDay) throw new Error(`bar days not increasing at ${t}`);
    prevDay = d;
    if (d >= cutoff) continue; // still in progress (or in the future)
    if (v.length < 4 || !v.every(Number.isFinite)) throw new Error(`bar ${new Date(t * 1000).toISOString().slice(0, 10)} has a missing value: ${JSON.stringify(v)}`);
    const [o, h, l, c] = v;
    if (h < Math.max(o, c) || l > Math.min(o, c)) oddRanges++;
    kept.push([d, o, h, l, c]);
  }
  if (!kept.length) throw new Error('no closed bars');
  const d0 = kept[0][0], n = kept.at(-1)[0] - d0 + 1;
  const out = { d0, o: new Array(n).fill(null), h: new Array(n).fill(null), l: new Array(n).fill(null), c: new Array(n).fill(null) };
  for (const [d, o, h, l, c] of kept) { const i = d - d0; out.o[i] = o; out.h[i] = h; out.l[i] = l; out.c[i] = c; }
  return { daily: out, bars: kept.length, oddRanges };
}

// 1M bars -> m = {d, o, h, l, c} of the closed months (last day before cutoff), after checking every bar.
export function toMonthly(bars, cutoff) {
  const rows = [...bars.entries()].sort((a, b) => a[0] - b[0]);
  const m = { d: [], o: [], h: [], l: [], c: [] };
  let prevDay = -Infinity;
  for (const [t, v] of rows) {
    const date = new Date(t * 1000);
    if (!Number.isInteger(t) || t % DAY !== 0 || date.getUTCDate() !== 1) throw new Error(`1M bar time ${t} is not 00:00 UTC on the 1st of a month`);
    const d = t / DAY;
    if (d <= prevDay) throw new Error(`1M bar times not increasing at ${t}`);
    prevDay = d;
    const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000 / DAY - 1;
    if (monthEnd >= cutoff) continue; // the month still in progress (or in the future)
    if (v.length < 4 || !v.every(Number.isFinite)) throw new Error(`1M bar ${date.toISOString().slice(0, 7)} has a missing value: ${JSON.stringify(v)}`);
    m.d.push(d); m.o.push(v[0]); m.h.push(v[1]); m.l.push(v[2]); m.c.push(v[3]);
  }
  return m;
}

// 1W bars -> w = {d, o, h, l, c} of the closed weeks (Sunday before cutoff), after checking every bar.
export function toWeekly(bars, cutoff) {
  const rows = [...bars.entries()].sort((a, b) => a[0] - b[0]);
  const w = { d: [], o: [], h: [], l: [], c: [] };
  let prevDay = -Infinity;
  for (const [t, v] of rows) {
    if (!Number.isInteger(t) || t % DAY !== 0 || new Date(t * 1000).getUTCDay() !== 1) throw new Error(`1W bar time ${t} is not 00:00 UTC on a Monday`);
    const d = t / DAY;
    if (d <= prevDay) throw new Error(`1W bar times not increasing at ${t}`);
    prevDay = d;
    if (d + 6 >= cutoff) continue; // the week still in progress (its Sunday is not closed), or in the future
    if (v.length < 4 || !v.every(Number.isFinite)) throw new Error(`1W bar ${new Date(t * 1000).toISOString().slice(0, 10)} has a missing value: ${JSON.stringify(v)}`);
    w.d.push(d); w.o.push(v[0]); w.h.push(v[1]); w.l.push(v[2]); w.c.push(v[3]);
  }
  return w;
}

// Closed months (last day before cutoff) with a 1M bar but no daily bar, and with daily bars but no 1M bar, as
// YYYY-MM lists (null when both agree).
export function monthsVsDaily(daily, m, cutoff) {
  const fromDaily = new Set();
  for (let i = 0; i < daily.c.length; i++) {
    if (daily.c[i] === null) continue;
    const t = new Date((daily.d0 + i) * DAY * 1000), y = t.getUTCFullYear(), mo = t.getUTCMonth();
    if (Date.UTC(y, mo + 1, 1) / 1000 / DAY - 1 < cutoff) fromDaily.add(Date.UTC(y, mo, 1) / 1000 / DAY);
  }
  const fromMonthly = new Set(m.d);
  const iso = (d) => new Date(d * DAY * 1000).toISOString().slice(0, 7);
  const only1M = m.d.filter((d) => !fromDaily.has(d)).map(iso);
  const only1D = [...fromDaily].filter((d) => !fromMonthly.has(d)).sort((a, b) => a - b).map(iso);
  return only1M.length || only1D.length ? { only1M, only1D } : null;
}

// Closed weeks (Sunday before cutoff) with a 1W bar but no daily bar, and with daily bars but no 1W bar, as lists of
// their Mondays (YYYY-MM-DD; null when both agree).
export function weeksVsDaily(daily, w, cutoff) {
  const fromDaily = new Set();
  for (let i = 0; i < daily.c.length; i++) {
    if (daily.c[i] === null) continue;
    const d = daily.d0 + i, monday = Math.floor((d + 3) / 7) * 7 - 3; // unix day 4 (1970-01-05) is a Monday
    if (monday + 6 < cutoff) fromDaily.add(monday);
  }
  const fromWeekly = new Set(w.d);
  const iso = (d) => new Date(d * DAY * 1000).toISOString().slice(0, 10);
  const only1W = w.d.filter((d) => !fromDaily.has(d)).map(iso);
  const only1D = [...fromDaily].filter((d) => !fromWeekly.has(d)).sort((a, b) => a - b).map(iso);
  return only1W.length || only1D.length ? { only1W, only1D } : null;
}

// Days whose stored bar changed, appeared or disappeared, compared with the previous file (the new last day is
// not a revision).
function revisions(prev, next) {
  if (!prev?.c) return null;
  const at = (f, k, d) => { const i = d - f.d0; return i >= 0 && i < f[k].length ? f[k][i] : null; };
  const prevEnd = prev.d0 + prev.c.length - 1;
  let changed = 0, first = null;
  for (let d = Math.min(prev.d0, next.d0); d <= prevEnd; d++) {
    if (['o', 'h', 'l', 'c'].some((k) => at(prev, k, d) !== at(next, k, d))) { changed++; first ??= d; }
  }
  return changed ? { changed, first: new Date(first * DAY * 1000).toISOString().slice(0, 10) } : null;
}

// Number of stored 1M bars (months) or 1W bars (weeks) that changed or disappeared, compared with the previous file
// (null when none, or when the previous file has no such bars).
export function barRevisions(prev, next) {
  if (!prev?.d) return null;
  const at = new Map(next.d.map((d, j) => [d, [next.o[j], next.h[j], next.l[j], next.c[j]]]));
  let changed = 0;
  prev.d.forEach((d, j) => {
    const v = at.get(d);
    if (!v || v[0] !== prev.o[j] || v[1] !== prev.h[j] || v[2] !== prev.l[j] || v[3] !== prev.c[j]) changed++;
  });
  return changed || null;
}

async function main() {
  const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
  let client = null;
  async function connect() {
    if (client && !client.closed) return client;
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?type=chart', {
      agent, headers: { Origin: 'https://www.tradingview.com', 'User-Agent': UA },
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    client = new TVClient(ws);
    client.send('set_auth_token', ['unauthorized_user_token']);
    client.send('set_locale', ['en', 'US']);
    return client;
  }
  async function fetchWithRetry(symbol, resolution) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await fetchSeries(await connect(), symbol, resolution); } catch (err) {
        last = err;
        try { client?.ws.close(); } catch {}
        client = null;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    throw last;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const failed = [], revised = [], odd = [], monthGaps = [], weekGaps = [];
  let ok = 0;
  const t0 = Date.now();
  for (const [k, symbol] of SYMBOLS.entries()) {
    const file = fileOf(OUT_DIR, symbol);
    let prev = null;
    try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
    try {
      const { meta, bars } = await fetchWithRetry(symbol, '1D');
      if (meta?.timezone && meta.timezone !== 'Etc/UTC') throw new Error(`symbol timezone ${meta.timezone}`);
      const { daily, bars: n, oddRanges } = toDaily(bars, CUTOFF);
      const monthly = await fetchWithRetry(symbol, '1M');
      if (monthly.meta?.timezone && monthly.meta.timezone !== 'Etc/UTC') throw new Error(`symbol timezone ${monthly.meta.timezone} (1M)`);
      const m = toMonthly(monthly.bars, CUTOFF);
      const weekly = await fetchWithRetry(symbol, '1W');
      if (weekly.meta?.timezone && weekly.meta.timezone !== 'Etc/UTC') throw new Error(`symbol timezone ${weekly.meta.timezone} (1W)`);
      const w = toWeekly(weekly.bars, CUTOFF);
      const rev = revisions(prev, daily);
      const revMonths = barRevisions(prev?.m, m);
      const revWeeks = barRevisions(prev?.w, w);
      if (rev || revMonths || revWeeks) {
        revised.push({ id: symbol, ...(rev || { changed: 0 }), ...(revMonths ? { months: revMonths } : {}), ...(revWeeks ? { weeks: revWeeks } : {}) });
      }
      if (oddRanges) odd.push({ id: symbol, bars: oddRanges });
      const gaps = monthsVsDaily(daily, m, CUTOFF);
      if (gaps) monthGaps.push({ id: symbol, ...gaps });
      const wgaps = weeksVsDaily(daily, w, CUTOFF);
      if (wgaps) weekGaps.push({ id: symbol, ...wgaps });
      const tmp = file + '.tmp';
      await writeFile(tmp, JSON.stringify({ id: symbol, ...daily, m, w }));
      await rename(tmp, file);
      ok++;
      const lastDay = new Date((daily.d0 + daily.c.length - 1) * DAY * 1000).toISOString().slice(0, 10);
      console.log(`[${k + 1}/${SYMBOLS.length}] ${symbol}: ${n} bars to ${lastDay}, ${m.d.length} months, ${w.d.length} weeks` +
        `${rev ? `, ${rev.changed} revised from ${rev.first}` : ''}${revMonths ? `, ${revMonths} months revised` : ''}${revWeeks ? `, ${revWeeks} weeks revised` : ''}` +
        `${gaps ? `, months only in 1M ${gaps.only1M.length} / only in 1D ${gaps.only1D.length}` : ''}` +
        `${wgaps ? `, weeks only in 1W ${wgaps.only1W.length} / only in 1D ${wgaps.only1D.length}` : ''}`);
    } catch (err) {
      failed.push({ id: symbol, error: err.message });
      console.error(`[${k + 1}/${SYMBOLS.length}] ${symbol} failed (previous file kept): ${err.message}`);
    }
  }
  try { client?.ws.close(); } catch {}

  let removed = 0, pruneRefused = 0;
  if (FROM_LIST) {
    const keep = new Set(SYMBOLS.map((id) => path.basename(fileOf(OUT_DIR, id))));
    const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    const stale = files.filter((f) => !keep.has(f));
    if (stale.length > files.length / 10) {
      pruneRefused = stale.length;
      console.error(`::error::${stale.length} of ${files.length} files are not in the tickers file; not removing them`);
    } else for (const f of stale) { await rm(path.join(OUT_DIR, f)); removed++; }
  }
  const status = {
    fetchedAt: startedAt.toISOString(), lastClosedDay: new Date((CUTOFF - 1) * DAY * 1000).toISOString().slice(0, 10),
    mode: 'full', loggedIn: false, seconds: Math.round((Date.now() - t0) / 1000),
    total: SYMBOLS.length, ok, removed, pruneRefused, failed, revised, oddRanges: odd, monthsVsDaily: monthGaps, weeksVsDaily: weekGaps,
  };
  if (FROM_LIST) await writeFile(path.join(OUT_DIR, '_status.json'), JSON.stringify(status, null, 1));
  console.log(`daily OHLC: ${ok} ok, ${failed.length} failed, ${revised.length} with revised bars, ${monthGaps.length} with months only in 1M or 1D, ` +
    `${weekGaps.length} with weeks only in 1W or 1D, ${removed} old files removed, ${status.seconds}s`);
  if (failed.some((f) => f.id === CANARY) || failed.length > SYMBOLS.length * MAX_FAILED || pruneRefused) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
