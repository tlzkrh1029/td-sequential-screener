// Timeframe bars rebuilt from TradingView daily bars (month timeframes from TradingView's own 1M bars, when the data
// file has them), the input of the TD engine (dashboard/td-engine.js).
// Shared by the Node build and the screener page, which inlines it: plain ES module, no DOM, no Node APIs.
//
// Buckets are the WMA screener's keyFn (wma0.3-screenshot/dashboard/engine.js lines 16-34), which was checked
// against TradingView's own bars there: nD bars restart every January 1st, 1W bars start on Monday, 2W/3W bars
// restart at the first Monday on or after January 1st (the days before it finish the previous year's cycle) and nM
// bars restart every January. A bucket becomes a bar only if a day inside it has a daily bar; days without one are
// skipped, never forward-filled.

export const TFS = Object.freeze(['1D', '2D', '3D', '4D', '5D', '6D', '1W', '8D', '9D', '10D', '2W', '3W',
  '1M', '2M', '3M', '4M', '6M', '8M', '10M', '12M']);

const DAYMS = 86400000;

// ---------- verbatim port of the WMA keyFn (engine.js lines 16-34): bucket key of a unix day ----------
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

// The same buckets as keyFn(tf), as calendar-day ranges: bucketFn(tf)(d, out) writes the first and the last
// calendar day of the bucket that holds day d into out[0] and out[1]. buildBars calls it once per bucket instead of
// calling keyFn once per day; test/bars.test.mjs checks day by day that both give the same buckets.
export function bucketFn(tf) {
  const m = /^(\d+)([DWM])$/.exec(tf);
  if (!m || !TFS.includes(tf)) throw new Error(`unknown timeframe ${tf}`);
  const k = Number(m[1]), u = m[2];
  const jan1 = (y) => Date.UTC(y, 0, 1) / DAYMS;
  const yearOf = (d) => new Date(d * DAYMS).getUTCFullYear();
  if (u === 'D' && k === 1) return (d, out) => { out[0] = d; out[1] = d; return out; };
  if (u === 'D') {
    return (d, out) => {
      const y = yearOf(d), j = jan1(y), s = j + Math.floor((d - j) / k) * k;
      out[0] = s; out[1] = Math.min(s + k - 1, jan1(y + 1) - 1); return out;
    };
  }
  if (u === 'W' && k === 1) {
    return (d, out) => { const s = Math.floor((d + 3) / 7) * 7 - 3; out[0] = s; out[1] = s + 6; return out; };
  }
  if (u === 'W') {
    const firstMon = (yy) => { const j = jan1(yy); return j + ((1 - ((j + 4) % 7) + 7) % 7); };
    return (d, out) => {
      const y = yearOf(d), cy = d >= firstMon(y) ? y : y - 1, f = firstMon(cy);
      const s = f + Math.floor(Math.floor((d - f) / 7) / k) * 7 * k;
      out[0] = s; out[1] = Math.min(s + 7 * k - 1, firstMon(cy + 1) - 1); return out;
    };
  }
  return (d, out) => {
    const t = new Date(d * DAYMS), y = t.getUTCFullYear(), g = Math.floor(t.getUTCMonth() / k) * k;
    out[0] = Date.UTC(y, g, 1) / DAYMS; out[1] = Date.UTC(y, Math.min(g + k, 12), 1) / DAYMS - 1; return out;
  };
}

// Bars of one timeframe from one ticker's data file, in one pass over the daily arrays.
//   daily          {d0, o, h, l, c[, m]}: index i is unix day d0 + i; null in all four on a day without a daily bar.
//                  m (optional) = TradingView's own 1M bars of the closed months, {d, o, h, l, c}: d[j] is the unix
//                  day of the first day of the month of the j-th bar (scripts/fetch-tv.mjs)
//   tf             one of TFS
//   lastClosedDay  unix day of the last closed daily bar; daily data after it is ignored
// A bar is confirmed when its bucket's last calendar day is <= lastClosedDay. Only confirmed bars go into the arrays
// (the TD engine runs on them only); the bucket still in progress, if it has a daily bar, is returned as `partial`.
// Per bar: start / end = first / last calendar day of the bucket, first / last = first / last day in it with a daily
// bar, o = open of its first daily bar, h = highest high, l = lowest low, c = close of its last daily bar.
//
// Month timeframes (1M ... 12M) with `m`: a 1M chart shows TradingView's own 1M bars, and those are not always the
// aggregate of its daily bars. A 1M bar keeps prices that TradingView later revised away in its daily bars (six fetches
// on 2026-11-01: CRYPTO:HUNTUSD's 2026-10 low 0.082473 and CRYPTO:TDROPUSD's 2026-10 close 0.00042404 are in no version
// of their daily bars), and TradingView's own 3M, 6M and 12M bars equal the aggregate of its 1M bars on all 17,381 bars
// compared (verify/native/check-native-bars.mjs). So the confirmed bars are aggregated from the 1M bars instead, with
// the same buckets and rules: a bucket with a 1M bar is a bar, o = open of its first 1M bar, h = highest high,
// l = lowest low, c = close of its last 1M bar, and first / last = first day of the month of its first / last 1M bar.
// `partial` (display only; the bar in progress never reaches the engine) still comes from the daily bars, since the
// 1M bar of the month in progress is not stored.
export function buildBars(daily, tf, lastClosedDay) {
  const out = buildDailyBars(daily, tf, lastClosedDay);
  if (daily.m == null || !tf.endsWith('M')) return out;
  return { ...buildMonthBars(daily.m, tf, lastClosedDay), partial: out.partial };
}

// The confirmed bars of a month timeframe from TradingView's own 1M bars m = {d, o, h, l, c} (see buildBars).
function buildMonthBars(m, tf, lastClosedDay) {
  const bounds = bucketFn(tf), se = [0, 0];
  const D = m.d, O = m.o, H = m.h, L = m.l, C = m.c, len = D.length;
  if (![O, H, L, C].every((a) => a.length === len)) throw new Error('m: d, o, h, l and c must have the same length');
  for (let j = 0; j < len; j++) {
    const t = new Date(D[j] * DAYMS);
    if (!Number.isInteger(D[j]) || t.getUTCDate() !== 1 || (j > 0 && D[j] <= D[j - 1])) {
      throw new Error(`m.d[${j}] = ${D[j]}: 1M bar days must be first days of months, strictly increasing`);
    }
    if (![O[j], H[j], L[j], C[j]].every(Number.isFinite)) throw new Error(`m: 1M bar ${isoOfDay(D[j])} has a missing value`);
  }
  const start = new Int32Array(len), end = new Int32Array(len), first = new Int32Array(len), last = new Int32Array(len);
  const o = new Float64Array(len), h = new Float64Array(len), l = new Float64Array(len), c = new Float64Array(len);
  let n = 0;
  for (let j = 0; j < len;) {
    bounds(D[j], se);
    const s = se[0], e = se[1];
    if (e > lastClosedDay) break; // the bucket in progress, and every later one, is not confirmed
    let hh = H[j], ll = L[j], k = j;
    while (k + 1 < len && D[k + 1] <= e) {
      k++;
      if (H[k] > hh) hh = H[k];
      if (L[k] < ll) ll = L[k];
    }
    start[n] = s; end[n] = e; first[n] = D[j]; last[n] = D[k];
    o[n] = O[j]; h[n] = hh; l[n] = ll; c[n] = C[k]; n++;
    j = k + 1;
  }
  return {
    start: start.slice(0, n), end: end.slice(0, n), first: first.slice(0, n), last: last.slice(0, n),
    o: o.slice(0, n), h: h.slice(0, n), l: l.slice(0, n), c: c.slice(0, n), n,
  };
}

function buildDailyBars(daily, tf, lastClosedDay) {
  if (!Number.isInteger(lastClosedDay)) throw new Error(`lastClosedDay must be a unix day number, got ${lastClosedDay}`);
  const bounds = bucketFn(tf), se = [0, 0];
  const d0 = daily.d0, O = daily.o, H = daily.h, L = daily.l, C = daily.c;
  if (!Number.isInteger(d0)) throw new Error(`daily.d0 must be a unix day number, got ${d0}`);
  const len = Math.max(0, Math.min(C.length, lastClosedDay - d0 + 1));
  let cap = 0; // buckets spanned by the data: at least the number of bars
  for (let d = d0, dEnd = d0 + len - 1; d <= dEnd; d = bounds(d, se)[1] + 1) cap++;
  const start = new Int32Array(cap), end = new Int32Array(cap), first = new Int32Array(cap), last = new Int32Array(cap);
  const o = new Float64Array(cap), h = new Float64Array(cap), l = new Float64Array(cap), c = new Float64Array(cap);
  let n = 0, partial = null;
  let i = 0;
  while (i < len) {
    if (C[i] === null) { i++; continue; } // no daily bar that day; a bucket without any is not a bar
    bounds(d0 + i, se);
    const s = se[0], e = se[1], jEnd = Math.min(e - d0, len - 1);
    let oo = O[i], hh = H[i], ll = L[i], cc = C[i], la = i;
    for (let j = i + 1; j <= jEnd; j++) {
      if (C[j] === null) continue;
      if (H[j] > hh) hh = H[j];
      if (L[j] < ll) ll = L[j];
      cc = C[j]; la = j;
    }
    if (e <= lastClosedDay) {
      start[n] = s; end[n] = e; first[n] = d0 + i; last[n] = d0 + la;
      o[n] = oo; h[n] = hh; l[n] = ll; c[n] = cc; n++;
    } else {
      // only the bucket holding lastClosedDay can end after it, and it is the last one read
      partial = { start: s, end: e, first: d0 + i, last: d0 + la, o: oo, h: hh, l: ll, c: cc };
    }
    i = jEnd + 1;
  }
  return {
    start: start.slice(0, n), end: end.slice(0, n), first: first.slice(0, n), last: last.slice(0, n),
    o: o.slice(0, n), h: h.slice(0, n), l: l.slice(0, n), c: c.slice(0, n), n, partial,
  };
}

// unix day <-> ISO date (YYYY-MM-DD, UTC)
export const isoOfDay = (d) => new Date(d * DAYMS).toISOString().slice(0, 10);
export const dayOfIso = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`not an ISO date: ${iso}`);
  return Date.parse(`${iso}T00:00:00Z`) / DAYMS;
};

// data file name of a ticker id (as scripts/fetch-tv.mjs writes it): CRYPTO:BTCUSD -> CRYPTO_BTCUSD
export const fileIdOf = (id) => id.replace(/[^A-Za-z0-9.]+/g, '_');
