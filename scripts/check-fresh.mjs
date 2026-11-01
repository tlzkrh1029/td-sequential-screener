// Fail the daily run when the data has stopped moving, so GitHub's failure notification reaches the owner even
// though the fetch itself reported no errors (for example TradingView answering with old bars only).
// Stale: CRYPTO:BTCUSD, or more than STALE_SHARE of the USD tickers in data/tickers.json, has no closed bar for
// the last STALE_DAYS UTC days before the run. A coin that stopped trading stays stale for good, which the share
// allows for.
//
// Usage: node scripts/check-fresh.mjs [--daily-dir data/daily]
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const i = args.indexOf('--daily-dir');
const DAILY_DIR = i >= 0 ? args[i + 1] : path.join('data', 'daily');
const STALE_DAYS = 2, STALE_SHARE = 0.1, CANARY = 'CRYPTO:BTCUSD';

const tickers = JSON.parse(await readFile(path.join('data', 'tickers.json'), 'utf8'));
const ids = tickers.coins.map((c) => c.usd).filter(Boolean);
// the fetch keeps closed bars only, so on a fresh run the newest bar is yesterday (UTC)
const today = Math.floor(Date.now() / 86400000);
const stale = [];
for (const id of ids) {
  let last = -Infinity;
  try {
    const f = JSON.parse(await readFile(path.join(DAILY_DIR, id.replace(/[^A-Za-z0-9.]+/g, '_') + '.json'), 'utf8'));
    let k = f.c.length - 1; while (k >= 0 && f.c[k] == null) k--;
    if (k >= 0) last = f.d0 + k;
  } catch {}
  if (today - 1 - last >= STALE_DAYS) stale.push({ id, days: Number.isFinite(last) ? today - 1 - last : null });
}
const canary = stale.find((s) => s.id === CANARY);
const tooMany = stale.length > ids.length * STALE_SHARE;
const sample = stale.slice(0, 10).map((s) => `${s.id} (${s.days ?? 'no file'}${s.days != null ? 'd' : ''})`).join(', ');
console.log(`${stale.length} of ${ids.length} tickers have no closed bar for ${STALE_DAYS}+ days${stale.length ? `: ${sample}${stale.length > 10 ? ', ...' : ''}` : ''}`);
if (canary || tooMany) {
  console.log(`::error::Daily data is stale: ${canary ? `${CANARY} has no closed bar for ${canary.days ?? '?'} days` : ''}${canary && tooMany ? '; ' : ''}` +
    `${tooMany ? `${stale.length} of ${ids.length} tickers have no closed bar for ${STALE_DAYS}+ days` : ''}.`);
  process.exit(1);
}
