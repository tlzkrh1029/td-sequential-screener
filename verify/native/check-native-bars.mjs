// Compare the timeframe bars the screener rebuilds from TradingView daily bars with TradingView's own bars.
//
// 1. Native standard resolutions. For every USD ticker of data/tickers.json, TradingView's own 1W, 1M, 3M, 6M and
//    12M bars are fetched over the anonymous chart WebSocket (one connection, one request at a time) and compared
//    with the bars rebuilt from data/daily, over the buckets that ended by lastClosedDay (data/daily/_status.json):
//      (a) the set of bars: TradingView's bar time as a UTC day must be the first calendar day of the bucket;
//      (b) open, high, low and close, with exact float equality.
//    1D is fetched in the same pass and the bars are rebuilt from it too. A mismatch that disappears against those
//    bars comes from TradingView serving other daily bars than at the data/daily fetch ("revision"); one that stays
//    is a real difference between the rebuilt bars and TradingView's ("genuine"). A mismatch against the bars of the
//    fresh 1D that the stored data does not show is counted as "referenceOnly" (TradingView's own bars of that
//    resolution and its 1D of the same pass disagree).
//    TradingView's own 3M, 6M and 12M are also compared with bars aggregated from its own 1M bars, which tells
//    whether TradingView builds its month multiples from its 1M bars.
//    Custom resolutions (2D, 3W, 2M, ...) fail anonymously with custom_resolution and are not requested.
// 2. tv-history. wma0.3-screenshot/data/tv-history.json holds TradingView's own bars of all 20 timeframes for
//    CRYPTO:BTCUSD and CRYPTO:ETHUSD from a logged-in fetch on 2026-10-05 (bar times and closes). The rebuilt
//    closes of every timeframe are compared with them over the buckets that ended before the fetch day, rebuilt
//    both from data/daily and from tv-history's own 1D closes (fetched together with its other timeframes): a
//    mismatch that only the data/daily bars show is a later revision of daily values, one that both show is genuine.
//
// The bars are rebuilt here by a small aggregation of its own, independent of dashboard/bars.js. Buckets come from
// keyFn, copied from wma0.3-screenshot/dashboard/engine.js lines 16-34. A bucket becomes a bar only if a day inside
// it has a daily bar; open = first daily open, high = max, low = min, close = last daily close; bar start = first
// calendar day of the bucket; a bar is confirmed iff the bucket's last calendar day is <= the last closed day.
//
// Output: verify/out/native-bars.json and summary tables on stdout. Exits with code 1 when a genuine mismatch is
// found or a ticker could not be fetched.
//
// Env:
//   TV_SYMBOLS    comma-separated tickers instead of every coins[].usd of data/tickers.json
//   NATIVE_CACHE  folder with one file of TradingView bars per ticker: read when present, written after a fetch
//                 (to re-run the comparison without fetching again; the files keep their fetch time)
//   TV_HISTORY    path or URL of tv-history.json (default: a wma0.3-screenshot checkout next to this repository,
//                 else its default branch on GitHub)
//   DATA_DIR      daily data folder (default data/daily)
//   OUT           output file (default verify/out/native-bars.json)
//   HTTPS_PROXY   used for the WebSocket when set
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 86400, DAYMS = 86400000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data', 'daily');
const OUT = process.env.OUT || path.join(ROOT, 'verify', 'out', 'native-bars.json');
const CACHE_DIR = process.env.NATIVE_CACHE || null;
const NATIVE_TFS = ['1W', '1M', '3M', '6M', '12M'];
const MONTH_MULTIPLES = ['3M', '6M', '12M']; // also compared with bars aggregated from TradingView's own 1M bars
const ALL_TFS = ['1D', '2D', '3D', '4D', '5D', '6D', '1W', '8D', '9D', '10D', '2W', '3W',
  '1M', '2M', '3M', '4M', '6M', '8M', '10M', '12M'];
const HISTORY_TICKERS = ['CRYPTO:BTCUSD', 'CRYPTO:ETHUSD'];
const MAX_EXAMPLES = 20;
const CHUNK = 5000;
const MAX_ROUNDS = 12;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIELDS = { o: 'open', h: 'high', l: 'low', c: 'close' };

const iso = (d) => new Date(d * DAYMS).toISOString().slice(0, 10);
const dayOfIso = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`not an ISO date: ${s}`);
  return Date.parse(`${s}T00:00:00Z`) / DAYMS;
};
const fileIdOf = (id) => id.replace(/[^A-Za-z0-9.]+/g, '_');

// ---------- buckets: keyFn verbatim from wma0.3-screenshot/dashboard/engine.js lines 16-34 ----------
// nD bars restart every January 1st, 2W/3W at the year's first Monday, nM every January; 1W is Monday-based.
export function keyFn(tf) {
  const m = /^(\d+)([DWM])$/.exec(tf), k = Number(m[1]), u = m[2];
  return (d) => {
    if (u === 'D' && k === 1) return d;
    const t = new Date(d * DAYMS), y = t.getUTCFullYear(), jan1 = Date.UTC(y, 0, 1) / DAYMS;
    if (u === 'D') return y * 1000 + Math.floor((d - jan1) / k);
    if (u === 'W') {
      if (k === 1) return Math.floor((d + 3) / 7);
      // multi-week bars restart at the first Monday on or after January 1st; the days before it
      // finish the previous year's cycle (TradingView behaviour, checked against its 2W/3W bars)
      const firstMon = (yy) => { const j = Date.UTC(yy, 0, 1) / DAYMS; return j + ((1 - ((j + 4) % 7) + 7) % 7); };
      const cy = d >= firstMon(y) ? y : y - 1;
      return cy * 100 + Math.floor(Math.floor((d - firstMon(cy)) / 7) / k);
    }
    return y * 100 + Math.floor(t.getUTCMonth() / k);
  };
}

// Confirmed bars of one timeframe rebuilt from a daily series {d0, o, h, l, c} (index i = unix day d0 + i, null on a
// day without a daily bar), using the days up to lastDay. Per bar: k bucket key, start / end first / last calendar
// day of the bucket, first / last day in it with a daily bar, o h l c.
export function rebuild(daily, tf, lastDay) {
  const key = keyFn(tf), bars = [];
  const n = Math.min(daily.c.length, lastDay - daily.d0 + 1);
  let cur = null;
  for (let i = 0; i < n; i++) {
    if (daily.c[i] === null) continue;
    const d = daily.d0 + i, k = key(d);
    if (cur && cur.k === k) {
      if (daily.h[i] > cur.h) cur.h = daily.h[i];
      if (daily.l[i] < cur.l) cur.l = daily.l[i];
      cur.c = daily.c[i];
      cur.last = d;
      continue;
    }
    cur = { k, start: d, end: d, first: d, last: d, o: daily.o[i], h: daily.h[i], l: daily.l[i], c: daily.c[i] };
    while (key(cur.start - 1) === k) cur.start--;
    while (key(cur.end + 1) === k) cur.end++;
    bars.push(cur);
  }
  return bars.filter((b) => b.end <= lastDay);
}

// TradingView bars [{t, o, h, l, c}] (t in seconds) of one timeframe against rebuilt bars, over the buckets that ended
// by lastDay. Mismatch kinds:
//   missing           a rebuilt bar whose bucket holds no TradingView bar
//   extra             a TradingView bar in a bucket without a rebuilt bar
//   timeAtFirstDay    TradingView's bar time is the bucket's first day with a daily bar, not its first calendar day
//   timeOther         TradingView's bar time is another day inside the bucket
//   multiplePerBucket more than one TradingView bar inside one bucket (values not compared)
//   timeNotMidnight   a TradingView bar time that is not 00:00 UTC (its UTC day is used)
//   open/high/low/close  value differs (exact float comparison)
export function compareBars(tf, native, rebuilt, lastDay, fields) {
  const key = keyFn(tf), next = key(lastDay + 1);
  const groups = new Map(), out = [];
  for (const nb of native) {
    const day = Math.floor(nb.t / DAY);
    if (day > lastDay || key(day) === next) continue; // bucket not over by lastDay
    const k = key(day), bar = { ...nb, day };
    if (nb.t % DAY !== 0) out.push({ kind: 'timeNotMidnight', k, native: bar });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(bar);
  }
  const seen = new Set();
  let compared = 0;
  for (const b of rebuilt) {
    compared++;
    seen.add(b.k);
    const g = groups.get(b.k);
    if (!g) { out.push({ kind: 'missing', k: b.k, rebuilt: b }); continue; }
    if (g.length > 1) { out.push({ kind: 'multiplePerBucket', k: b.k, rebuilt: b, natives: g }); continue; }
    const nb = g[0];
    if (nb.day !== b.start) out.push({ kind: nb.day === b.first ? 'timeAtFirstDay' : 'timeOther', k: b.k, rebuilt: b, native: nb });
    for (const f of fields) if (nb[f] !== b[f]) out.push({ kind: FIELDS[f], k: b.k, rebuilt: b, native: nb });
  }
  for (const [k, g] of groups) {
    if (seen.has(k)) continue;
    compared++;
    for (const nb of g) out.push({ kind: 'extra', k, native: nb });
  }
  return { compared, mismatches: out };
}

// TradingView bars [{t, o, h, l, c}] of a 1D series -> {d0, o, h, l, c} of the days up to lastDay (or null).
export function dailyOf(bars, lastDay, closesOnly = false) {
  const rows = bars.filter((b) => b.t % DAY === 0 && b.t / DAY <= lastDay && Number.isFinite(b.c)
    && (closesOnly || [b.o, b.h, b.l].every(Number.isFinite)));
  if (!rows.length) return null;
  const d0 = rows[0].t / DAY, n = rows.at(-1).t / DAY - d0 + 1;
  const out = { d0, o: new Array(n).fill(null), h: new Array(n).fill(null), l: new Array(n).fill(null), c: new Array(n).fill(null) };
  for (const b of rows) {
    const i = b.t / DAY - d0;
    out.c[i] = b.c;
    out.o[i] = closesOnly ? b.c : b.o; out.h[i] = closesOnly ? b.c : b.h; out.l[i] = closesOnly ? b.c : b.l;
  }
  return out;
}

// Days up to lastDay on which two daily series differ (a bar present in one only, or another value).
export function dailyDiff(a, b, lastDay, fields) {
  const at = (s, f, d) => { const i = d - s.d0; return i >= 0 && i < s[f].length ? s[f][i] : null; };
  const from = Math.min(a.d0, b.d0), to = Math.min(lastDay, Math.max(a.d0 + a.c.length, b.d0 + b.c.length) - 1);
  const days = [];
  for (let d = from; d <= to; d++) {
    const diff = fields.filter((f) => at(a, f, d) !== at(b, f, d));
    if (diff.length) days.push({ day: iso(d), stored: fields.map((f) => at(a, f, d)), tv: fields.map((f) => at(b, f, d)) });
  }
  return days;
}

// ---------- TradingView chart WebSocket (the client of scripts/fetch-tv.mjs) ----------
// wire format: "~m~<len>~m~<payload>", heartbeats are "~h~<n>" payloads
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
// Whole history of one ticker in one resolution: {meta, bars: [{t, o, h, l, c}] sorted by time}.
async function fetchSeries(client, symbol, tf) {
  const cs = `cs_nat${++sessionSeq}`;
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
    const p = client.wait((msg) => failed(msg) ?? (msg.m === 'series_completed' && msg.p[0] === cs ? true : undefined), ms, `${symbol} ${tf} data`);
    p.catch(() => {});
    return p;
  };
  try {
    // Register the waits before sending so replies that arrive in one batch are not missed.
    const resolved = client.wait((msg) => failed(msg) ?? (msg.m === 'symbol_resolved' && msg.p[0] === cs ? msg.p[2] : undefined), 45_000, `${symbol} resolve`);
    resolved.catch(() => {});
    let next = completed(60_000);
    client.send('chart_create_session', [cs, '']);
    client.send('switch_timezone', [cs, 'Etc/UTC']);
    client.send('resolve_symbol', [cs, 'sds_sym_1', '=' + JSON.stringify({ symbol, adjustment: 'splits' })]);
    client.send('create_series', [cs, 'sds_1', 's1', 'sds_sym_1', tf, CHUNK, '']);
    const meta = await resolved;
    await next;
    // Older history comes in further chunks; keep asking until a round adds nothing.
    let added = bars.size >= CHUNK ? Infinity : 0;
    for (let round = 1; added > 0; round++) {
      if (round > MAX_ROUNDS) throw new Error(`still receiving data after ${MAX_ROUNDS} extra chunks; history may be truncated`);
      const before = bars.size;
      next = completed(45_000);
      client.send('request_more_data', [cs, 'sds_1', CHUNK]);
      await next; // a timeout fails the series instead of silently truncating it
      added = bars.size - before;
    }
    const sorted = [...bars.entries()].sort((a, b) => a[0] - b[0]);
    return { meta, bars: sorted.map(([t, [o, h, l, c]]) => ({ t, o, h, l, c })) };
  } finally {
    client.listeners.delete(onData);
    client.send('chart_delete_session', [cs]);
  }
}

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
async function fetchWithRetry(symbol, tf) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetchSeries(await connect(), symbol, tf); } catch (err) {
      last = err;
      if (/custom_resolution/.test(err.message)) break; // needs a login: never retried
      try { client?.ws.close(); } catch {}
      client = null;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw last;
}

// TradingView bars of one ticker in 1D and the native resolutions, from the cache folder when it has them.
async function nativeOf(symbol) {
  const file = CACHE_DIR && path.join(CACHE_DIR, fileIdOf(symbol) + '.json');
  if (file) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch {}
  }
  const rec = { id: symbol, fetchedAt: new Date().toISOString(), timezone: null, series: {}, errors: {} };
  for (const tf of ['1D', ...NATIVE_TFS]) {
    try {
      const { meta, bars } = await fetchWithRetry(symbol, tf);
      rec.timezone ??= meta?.timezone ?? null;
      rec.series[tf] = bars.map((b) => [b.t, b.o, b.h, b.l, b.c]);
    } catch (err) {
      rec.errors[tf] = err.message;
    }
  }
  if (file && !Object.keys(rec.errors).length) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file + '.tmp', JSON.stringify(rec));
    await rename(file + '.tmp', file);
  }
  return rec;
}
const barsOf = (rows) => rows.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));

// ---------- tallies ----------
const KINDS = ['missing', 'extra', 'timeAtFirstDay', 'timeOther', 'multiplePerBucket', 'timeNotMidnight', 'open', 'high', 'low', 'close'];
const CAUSES = ['genuine', 'unknown', 'revision']; // a bucket with mismatches of several causes counts as the first
const SMALL = 1e-6; // value mismatches below this relative size are counted as `small` (last digits / rounding)
function newTally() {
  return {
    tickers: 0, bars: 0, mismatchBars: 0, genuineBars: 0, unknownBars: 0, revisionBars: 0, tickersWithGenuine: 0,
    kinds: Object.fromEntries(KINDS.map((k) => [k, { total: 0, genuine: 0, unknown: 0, revision: 0, small: 0 }])),
    referenceOnly: 0, // mismatches against the reference rebuild (fresh 1D / tv-history 1D) that the stored data does not show
    // bars whose bucket's first calendar day has no daily bar (a coin listed mid-bucket, or a gap): TradingView's time
    midBucket: { bars: 0, atStart: 0, atFirstDay: 0, other: 0, missing: 0 },
    tickerList: [], // {id, genuine, unknown, revision}: mismatching bars per ticker
    all: [], // every mismatch record; examples are picked from it at the end
    refOnlyAll: [], // records of the referenceOnly mismatches
  };
}
function merge(into, t) {
  for (const k of ['tickers', 'bars', 'mismatchBars', 'genuineBars', 'unknownBars', 'revisionBars', 'tickersWithGenuine', 'referenceOnly']) into[k] += t[k];
  for (const k of KINDS) for (const c of ['total', 'small', ...CAUSES]) into.kinds[k][c] += t.kinds[k][c];
  for (const k of Object.keys(into.midBucket)) into.midBucket[k] += t.midBucket[k];
  into.tickerList.push(...t.tickerList);
  into.all.push(...t.all);
  into.refOnlyAll.push(...t.refOnlyAll);
}
const id = (m) => `${m.kind}|${m.k}`;

// Tally one ticker/timeframe: mismatches against the stored data, each classified by the reference comparison
// (ref = TradingView's bars against refRebuilt, the bars rebuilt from the reference 1D; null when that 1D is
// unavailable). Records carry tv (TradingView), rebuilt (from the stored data) and reference (from the reference 1D).
function tally(t, symbol, tf, res, ref, rebuilt, valueFields, refRebuilt = null) {
  t.tickers++;
  t.bars += res.compared;
  const refIds = ref ? new Set(ref.mismatches.map(id)) : null;
  const vals = (b) => (b ? valueFields.map((f) => b[f]) : null);
  const refByK = refRebuilt ? new Map(refRebuilt.map((b) => [b.k, b])) : null;
  const storedByK = new Map(rebuilt.map((b) => [b.k, b]));
  const bad = new Map(); // bucket key -> cause
  for (const m of res.mismatches) {
    const cause = !refIds ? 'unknown' : refIds.has(id(m)) ? 'genuine' : 'revision';
    t.kinds[m.kind].total++;
    t.kinds[m.kind][cause]++;
    const prev = bad.get(m.k);
    if (!prev || CAUSES.indexOf(cause) < CAUSES.indexOf(prev)) bad.set(m.k, cause);
    const r = record(symbol, tf, m, cause, valueFields);
    if (refByK) r.reference = vals(refByK.get(m.k));
    if (r.relDiff !== undefined && Math.abs(r.relDiff) < SMALL) t.kinds[m.kind].small++;
    t.all.push(r);
  }
  if (ref) {
    // TradingView's bars differ from the reference rebuild but not from the stored data (relDiff: tv vs reference)
    const ids = new Set(res.mismatches.map(id));
    for (const m of ref.mismatches.filter((x) => !ids.has(id(x)))) {
      t.referenceOnly++;
      const r = record(symbol, tf, m, 'referenceOnly', valueFields);
      r.reference = r.rebuilt;
      r.rebuilt = vals(storedByK.get(m.k));
      t.refOnlyAll.push(r);
    }
  }
  t.mismatchBars += bad.size;
  for (const c of bad.values()) t[`${c}Bars`]++;
  if ([...bad.values()].includes('genuine')) t.tickersWithGenuine++;
  if (bad.size) {
    const count = (c) => [...bad.values()].filter((x) => x === c).length;
    t.tickerList.push({ id: symbol, genuine: count('genuine'), unknown: count('unknown'), revision: count('revision') });
  }
  const kindsOf = new Map();
  for (const m of res.mismatches) { if (!kindsOf.has(m.k)) kindsOf.set(m.k, new Set()); kindsOf.get(m.k).add(m.kind); }
  for (const b of rebuilt) {
    if (b.first === b.start) continue;
    t.midBucket.bars++;
    const kinds = kindsOf.get(b.k) || new Set();
    if (kinds.has('timeAtFirstDay')) t.midBucket.atFirstDay++;
    else if (kinds.has('missing')) t.midBucket.missing++;
    else if (kinds.has('timeOther') || kinds.has('multiplePerBucket')) t.midBucket.other++;
    else t.midBucket.atStart++;
  }
}

function record(symbol, tf, m, cause, valueFields) {
  const vals = (b) => (b ? valueFields.map((f) => b[f]) : null);
  const r = { ticker: symbol, tf, kind: m.kind, cause };
  if (m.rebuilt) {
    Object.assign(r, { bucket: `${iso(m.rebuilt.start)}..${iso(m.rebuilt.end)}`, dailyBars: `${iso(m.rebuilt.first)}..${iso(m.rebuilt.last)}` });
  }
  if (m.native) r.tvTime = m.native.t % DAY === 0 ? iso(m.native.day) : new Date(m.native.t * 1000).toISOString();
  if (m.natives) r.tvTimes = m.natives.map((b) => iso(b.day));
  r.fields = valueFields.map((f) => FIELDS[f]);
  r.tv = vals(m.native);
  r.rebuilt = vals(m.rebuilt);
  const f = Object.keys(FIELDS).find((x) => FIELDS[x] === m.kind);
  if (f && m.native && m.rebuilt) r.relDiff = Number(((m.native[f] - m.rebuilt[f]) / Math.abs(m.rebuilt[f])).toPrecision(3));
  return r;
}

// Up to MAX_EXAMPLES records per kind and cause, taken round-robin over tickers so one ticker does not fill them all.
function examplesOf(all, causes = CAUSES) {
  const out = {};
  for (const kind of KINDS) {
    for (const cause of causes) {
      const list = all.filter((r) => r.kind === kind && r.cause === cause);
      if (!list.length) continue;
      const byTicker = new Map();
      for (const r of list) { if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []); byTicker.get(r.ticker).push(r); }
      const queues = [...byTicker.values()], picked = [];
      for (let round = 0; picked.length < MAX_EXAMPLES && queues.some((q) => q.length > round); round++) {
        for (const q of queues) if (round < q.length && picked.length < MAX_EXAMPLES) picked.push(q[round]);
      }
      (out[kind] ??= {})[cause] = picked;
    }
  }
  return out;
}
function finish(t) {
  const { all, refOnlyAll, ...rest } = t;
  for (const k of KINDS) if (!rest.kinds[k].total) delete rest.kinds[k];
  rest.tickerList.sort((a, b) => b.genuine - a.genuine || b.unknown - a.unknown || b.revision - a.revision || (a.id < b.id ? -1 : 1));
  return { ...rest, examples: examplesOf(all), referenceOnlyExamples: examplesOf(refOnlyAll, ['referenceOnly']) };
}

// ---------- part 1: TradingView's own standard-resolution bars ----------
async function checkNative(lastDay) {
  const symbols = process.env.TV_SYMBOLS
    ? process.env.TV_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean)
    : JSON.parse(await readFile(path.join(ROOT, 'data', 'tickers.json'), 'utf8')).coins.map((c) => c.usd).filter(Boolean);
  const per = Object.fromEntries(NATIVE_TFS.map((tf) => [tf, newTally()]));
  const from1M = Object.fromEntries(MONTH_MULTIPLES.map((tf) => [tf, newTally()]));
  const failed = [], revisedTickers = [], timezones = {};
  let fetchedFrom = null, fetchedTo = null, revisedDays = 0;
  const t0 = Date.now();
  for (const [n, symbol] of symbols.entries()) {
    let daily;
    try { daily = JSON.parse(await readFile(path.join(DATA_DIR, fileIdOf(symbol) + '.json'), 'utf8')); } catch (err) {
      failed.push({ id: symbol, error: `no daily file: ${err.message}` });
      continue;
    }
    const rec = await nativeOf(symbol);
    if (fetchedFrom === null || rec.fetchedAt < fetchedFrom) fetchedFrom = rec.fetchedAt;
    if (fetchedTo === null || rec.fetchedAt > fetchedTo) fetchedTo = rec.fetchedAt;
    timezones[rec.timezone] = (timezones[rec.timezone] || 0) + 1;
    if (Object.keys(rec.errors).length) failed.push({ id: symbol, errors: rec.errors });
    // the same 1D bars as now on TradingView, to tell revisions since the data/daily fetch from real differences
    const fresh = rec.series['1D'] ? dailyOf(barsOf(rec.series['1D']), lastDay) : null;
    if (fresh) {
      const diff = dailyDiff(daily, fresh, lastDay, ['o', 'h', 'l', 'c']);
      if (diff.length) { revisedDays += diff.length; revisedTickers.push({ id: symbol, days: diff.length, first: diff[0], last: diff.at(-1) }); }
    }
    const line = [];
    for (const tf of NATIVE_TFS) {
      if (!rec.series[tf]) { line.push(`${tf} failed`); continue; }
      const native = barsOf(rec.series[tf]);
      const rebuilt = rebuild(daily, tf, lastDay);
      const res = compareBars(tf, native, rebuilt, lastDay, ['o', 'h', 'l', 'c']);
      const refRebuilt = fresh ? rebuild(fresh, tf, lastDay) : null;
      const ref = refRebuilt ? compareBars(tf, native, refRebuilt, lastDay, ['o', 'h', 'l', 'c']) : null;
      const t = newTally();
      tally(t, symbol, tf, res, ref, rebuilt, ['o', 'h', 'l', 'c'], refRebuilt);
      merge(per[tf], t);
      line.push(`${tf} ${res.compared}${res.mismatches.length ? `/${res.mismatches.length} bad` : ''}`);
    }
    // TradingView's own 3M / 6M / 12M against bars aggregated from its own 1M bars: tells whether TradingView builds
    // its month multiples from its 1M bars (every mismatch here counts as genuine)
    const m1 = rec.series['1M'] ? dailyOf(barsOf(rec.series['1M']), lastDay) : null;
    for (const tf of MONTH_MULTIPLES) {
      if (!m1 || !rec.series[tf]) continue;
      const res = compareBars(tf, barsOf(rec.series[tf]), rebuild(m1, tf, lastDay), lastDay, ['o', 'h', 'l', 'c']);
      const t = newTally();
      tally(t, symbol, tf, res, res, [], ['o', 'h', 'l', 'c']);
      merge(from1M[tf], t);
      if (res.mismatches.length) line.push(`${tf} vs own 1M ${res.mismatches.length} bad`);
    }
    console.log(`[${n + 1}/${symbols.length}] ${symbol}: ${line.join(', ')}${Object.keys(rec.errors).length ? ` (errors: ${JSON.stringify(rec.errors)})` : ''}`);
  }
  try { client?.ws.close(); } catch {}
  revisedTickers.sort((a, b) => b.days - a.days);
  return {
    lastClosedDay: iso(lastDay), tickers: symbols.length, seconds: Math.round((Date.now() - t0) / 1000),
    tvFetchedFrom: fetchedFrom, tvFetchedTo: fetchedTo, symbolTimezones: timezones, failed,
    dailyRevisionsSinceFetch: { tickers: revisedTickers.length, days: revisedDays, list: revisedTickers.slice(0, MAX_EXAMPLES) },
    perResolution: Object.fromEntries(NATIVE_TFS.map((tf) => [tf, finish(per[tf])])),
    monthMultiplesFromTv1M: Object.fromEntries(MONTH_MULTIPLES.map((tf) => [tf, finish(from1M[tf])])),
  };
}

// ---------- part 2: tv-history (logged-in, all 20 timeframes, closes) ----------
async function loadHistory() {
  const candidates = process.env.TV_HISTORY ? [process.env.TV_HISTORY] : [
    path.resolve(ROOT, '..', 'tlzkrh1029', 'wma0.3-screenshot', 'data', 'tv-history.json'),
    path.resolve(ROOT, '..', 'wma0.3-screenshot', 'data', 'tv-history.json'),
    'https://raw.githubusercontent.com/tlzkrh1029/wma0.3-screenshot/HEAD/data/tv-history.json',
  ];
  for (const src of candidates) {
    try {
      if (/^https?:/.test(src)) {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { src, json: await res.json() };
      }
      await access(src);
      return { src, json: JSON.parse(await readFile(src, 'utf8')) };
    } catch (err) {
      if (process.env.TV_HISTORY) throw err;
    }
  }
  return null;
}

async function checkHistory() {
  const h = await loadHistory();
  if (!h) return { error: 'tv-history.json not found (set TV_HISTORY)' };
  const lastDay = Math.floor(Date.parse(h.json.fetchedAt) / DAYMS) - 1; // buckets that ended before the fetch day
  const per = Object.fromEntries(ALL_TFS.map((tf) => [tf, newTally()]));
  const tickers = {};
  for (const symbol of HISTORY_TICKERS) {
    const series = h.json.series[symbol];
    if (!series) { tickers[symbol] = { error: 'not in tv-history.json' }; continue; }
    const daily = JSON.parse(await readFile(path.join(DATA_DIR, fileIdOf(symbol) + '.json'), 'utf8'));
    const tvDaily = dailyOf(series['1D'].t.map((t, i) => ({ t, c: series['1D'].c[i] })), lastDay, true);
    const revised = dailyDiff(daily, tvDaily, lastDay, ['c']);
    tickers[symbol] = { dailyCloseRevisions: { days: revised.length, list: revised.slice(0, MAX_EXAMPLES) }, perTf: {} };
    for (const tf of ALL_TFS) {
      const s = series[tf];
      if (!s) { tickers[symbol].perTf[tf] = { error: 'not in tv-history.json' }; continue; }
      const native = s.t.map((t, i) => ({ t, c: s.c[i] }));
      const rebuilt = rebuild(daily, tf, lastDay);
      const res = compareBars(tf, native, rebuilt, lastDay, ['c']);
      const refRebuilt = rebuild(tvDaily, tf, lastDay);
      const ref = compareBars(tf, native, refRebuilt, lastDay, ['c']);
      const t = newTally();
      tally(t, symbol, tf, res, ref, rebuilt, ['c'], refRebuilt);
      merge(per[tf], t);
      const { all, refOnlyAll, tickers: _n, kinds, tickerList: _l, ...counts } = t;
      tickers[symbol].perTf[tf] = { ...counts, kinds: Object.fromEntries(KINDS.filter((k) => kinds[k].total).map((k) => [k, kinds[k]])) };
    }
  }
  return {
    source: h.src, fetchedAt: h.json.fetchedAt, loggedIn: h.json.loggedIn, bucketsEndedBy: iso(lastDay), tickers,
    perTf: Object.fromEntries(ALL_TFS.map((tf) => [tf, finish(per[tf])])),
  };
}

// ---------- report ----------
function table(rows) {
  const w = rows[0].map((_, j) => Math.max(...rows.map((r) => String(r[j]).length)));
  return rows.map((r) => r.map((v, j) => (j === 0 ? String(v).padEnd(w[j]) : String(v).padStart(w[j]))).join('  ')).join('\n');
}
// "<total> (<genuine>g, <small>s)": s = below SMALL relative size
const kindCell = (t, k) => { const K = t.kinds[k]; return K ? `${K.total} (${K.genuine}g${K.small ? `, ${K.small}s` : ''})` : 0; };

async function main() {
  const status = JSON.parse(await readFile(path.join(DATA_DIR, '_status.json'), 'utf8'));
  const lastDay = dayOfIso(status.lastClosedDay);
  const native = await checkNative(lastDay);
  const history = await checkHistory();
  const result = {
    generatedAt: new Date().toISOString(),
    daily: { dir: path.relative(ROOT, DATA_DIR), fetchedAt: status.fetchedAt, lastClosedDay: status.lastClosedDay },
    rules: 'keyFn of wma0.3-screenshot/dashboard/engine.js lines 16-34; a bucket is a bar only if a day in it has a daily bar; '
      + 'o = first daily open, h = max, l = min, c = last daily close; bar start = first calendar day of the bucket; '
      + 'compared buckets ended by the last closed day; genuine = also differs from bars rebuilt from the reference 1D '
      + '(fresh TradingView 1D in part 1, tv-history 1D in part 2), revision = only the stored daily data differs, '
      + 'referenceOnly = differs from the reference rebuild only. Records: tv = TradingView\'s bar, rebuilt = from the '
      + 'stored daily data, reference = from the reference 1D, relDiff = (tv - rebuilt) / |rebuilt| (tv vs reference for '
      + 'referenceOnly); small = |relDiff| < 1e-6',
    native, tvHistory: history,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(result, null, 1) + '\n');

  console.log(`\nTradingView's own bars vs bars rebuilt from ${result.daily.dir} (buckets ended by ${native.lastClosedDay}; `
    + `TradingView fetched ${native.tvFetchedFrom} .. ${native.tvFetchedTo})`);
  const head = ['res', 'tickers', 'bars', 'bad bars', 'genuine', 'unknown', 'revision', 'missing', 'extra', 'atFirstDay', 'timeOther', 'open', 'high', 'low', 'close', 'refOnly', 'mid-bucket bars at start'];
  console.log(table([head, ...NATIVE_TFS.map((tf) => {
    const t = native.perResolution[tf];
    return [tf, t.tickers, t.bars, t.mismatchBars, t.genuineBars, t.unknownBars, t.revisionBars, kindCell(t, 'missing'), kindCell(t, 'extra'),
      kindCell(t, 'timeAtFirstDay'), kindCell(t, 'timeOther'), kindCell(t, 'open'), kindCell(t, 'high'), kindCell(t, 'low'), kindCell(t, 'close'),
      t.referenceOnly, `${t.midBucket.atStart}/${t.midBucket.bars}`];
  })]));
  console.log('bad bars = buckets with any mismatch; kind cells: total (g = genuine, s = below 1e-6 relative); refOnly = TradingView '
    + 'differs from the 1D fetched in the same pass but not from data/daily; last column = bars whose bucket starts on a day '
    + 'without a daily bar that TradingView also times at the bucket start');
  console.log(`failed tickers: ${native.failed.length}; daily bars revised since the data/daily fetch: ${native.dailyRevisionsSinceFetch.days} days on ${native.dailyRevisionsSinceFetch.tickers} tickers`);
  console.log(`\nTradingView's own month multiples vs bars aggregated from TradingView's own 1M bars`);
  console.log(table([['res', 'tickers', 'bars', 'bad bars', 'missing', 'extra', 'open', 'high', 'low', 'close'],
    ...MONTH_MULTIPLES.map((tf) => {
      const t = native.monthMultiplesFromTv1M[tf];
      return [tf, t.tickers, t.bars, t.mismatchBars, ...['missing', 'extra', 'open', 'high', 'low', 'close'].map((k) => t.kinds[k]?.total ?? 0)];
    })]));

  if (history.error) console.log(`\ntv-history: ${history.error}`);
  else {
    console.log(`\ntv-history (${history.loggedIn ? 'logged-in' : 'anonymous'} fetch ${history.fetchedAt}) closes vs rebuilt closes (buckets ended by ${history.bucketsEndedBy})`);
    const cell = (s, tf) => { const x = history.tickers[s]?.perTf?.[tf]; return x ? (x.error ? 'n/a' : `${x.bars} / ${x.genuineBars}g ${x.revisionBars}r`) : '-'; };
    console.log(table([['tf', ...HISTORY_TICKERS.map((s) => `${s} bars / bad (genuine, revision)`)],
      ...ALL_TFS.map((tf) => [tf, ...HISTORY_TICKERS.map((s) => cell(s, tf))])]));
    for (const s of HISTORY_TICKERS) {
      const r = history.tickers[s]?.dailyCloseRevisions;
      if (r) console.log(`${s}: ${r.days} daily closes differ between tv-history and ${result.daily.dir}`);
    }
  }
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);

  const notRevision = (t) => t.genuineBars + t.unknownBars;
  const genuine = NATIVE_TFS.reduce((s, tf) => s + notRevision(native.perResolution[tf]), 0)
    + (history.error ? 0 : ALL_TFS.reduce((s, tf) => s + notRevision(history.perTf[tf]), 0));
  if (genuine || native.failed.length || history.error) process.exitCode = 1;
}

// run when executed directly; importing the module (for its functions) runs nothing
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
