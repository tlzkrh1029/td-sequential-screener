// Copy the coin universe and its TradingView tickers from the WMA screener (tlzkrh1029/wma0.3-screenshot, default
// branch), so coin matches fixed there apply here too. Writes data/universe.json and data/tickers.json.
// Fails without writing anything when a file is missing or does not look complete.
//
// Usage: node scripts/sync-universe.mjs        (locally behind the session proxy: NODE_USE_ENV_PROXY=1)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.WMA_RAW || 'https://raw.githubusercontent.com/tlzkrh1029/wma0.3-screenshot/HEAD/data';
const MIN_COINS = 300;

async function get(name) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.coins) || json.coins.length < MIN_COINS) throw new Error(`${name}: only ${json.coins?.length ?? 0} coins`);
  return json;
}

const [universe, tickers] = await Promise.all([get('universe.json'), get('tickers.json')]);
const usd = tickers.coins.filter((c) => c.usd).length;
await mkdir('data', { recursive: true });
await writeFile(path.join('data', 'universe.json'), JSON.stringify(universe, null, 1) + '\n');
await writeFile(path.join('data', 'tickers.json'), JSON.stringify(tickers, null, 1) + '\n');
console.log(`universe: ${universe.coins.length} coins (fetched ${universe.fetchedAt}); tickers: ${tickers.coins.length} coins, ${usd} with a USD ticker`);
