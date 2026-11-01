# Operating rules for this repository

The TD Sequential screener (`dashboard/`, `scripts/`, `.github/workflows/fetch-daily.yml`) fetches TradingView daily
OHLC every day, counts TD Research v6 on 20 timeframes and deploys a GitHub Pages site. The owner set these rules;
keep to them.

## The owner's TradingView chart is the reference

Every 9 and 13 the screener shows must match the owner's TradingView chart (`CRYPTO:<COIN>USD`, TD Research v6 with
its default inputs) without a single exception.

- **The indicator is the spec.** `dashboard/td-engine.js` is a statement-by-statement port of
  `td-research-v6/kidze_td_research_v6.pine` in tlzkrh1029/pinescript (completed 2026-10-31). Do not change its rules
  here, not even ones a review calls wrong (Combo final13 `Wick`, TDST cancellation off, `13xN`): the owner decides
  rule changes in the Pine script first, and then both ports follow it.
- **Two independent ports.** `verify/ref/` holds a Python port written without looking at the JavaScript one. After
  any change to `dashboard/bars.js` or `dashboard/td-engine.js`, run `verify/diff.mjs` (all tickers with the default
  inputs, plus the setting variants in `verify/variants/`) and keep it at zero mismatches, and keep `node --test test/`
  passing, including the golden case seen on the chart (CRYPTO:BTCUSD 2W, 2024-12-16, pink SELL `13x2` from the
  2021-11-08 and 2024-01-29 origins).
- **Whole history on every run.** TD counts depend on every earlier bar, so `scripts/fetch-tv.mjs` refetches every
  ticker's whole daily history each run. Never merge a recent window into older files: TradingView revises old bars
  (RSR was rebuilt from 2019, AVU lost 270 days, last digits changed on ICX and ARPA), and the chart always shows
  the revised bars.
- **Closed bars only.** The daily bar still in progress at fetch time is dropped, and the engine runs on confirmed
  bars only (a timeframe bar is confirmed once its calendar bucket has ended), as the script does on the chart.
- **No filled gaps, no trimmed history.** Days on which TradingView has no bar stay `null` and are not bars. Never
  forward-fill or interpolate them, and never cut off the start of a history (`usdFrom` / `capFrom` from the WMA
  screener do not apply here): the chart counts on every bar TradingView serves.

## Data and operations

- **TradingView without a login.** Fetch anonymously. Do not add TradingView login cookies to any workflow; the
  owner chose this for the WMA screener, and a login ties the automated requests to the owner's account.
- **No workarounds for GitHub's 60-day schedule rule.** Never add dummy or keepalive commits, and never call the
  "enable workflow" API automatically. The daily data commit is the only activity the repo relies on; if the schedule
  is ever disabled, the owner re-enables it by hand in the Actions tab.
- **The coin universe comes from wma0.3-screenshot.** `scripts/sync-universe.mjs` copies `data/universe.json` and
  `data/tickers.json` from that repository's default branch on every run, so coin matches fixed there (and logged in
  its `data/mapping-log.json`) apply here too. Fix coin matches there, not here.
- **Credit CoinGecko.** The coin list, ranks and market caps come from CoinGecko through the WMA screener, so keep the
  linked "Data provided by CoinGecko" credit on the page.
- **Custom timeframes need a login.** Anonymous requests get only standard resolutions (1D, 1W, 1M, 3M, 6M, 12M); 2D,
  3W, 2M and the like fail with `custom_resolution`. The screener rebuilds every timeframe from 1D bars with the
  bucketing of wma0.3-screenshot's engine; `verify/native/check-native-bars.mjs` compares the rebuilt standard
  resolutions with TradingView's own bars.
- **Keep `data/daily` under 3,000 files.**
- **Stale data must be loud.** `scripts/check-fresh.mjs` fails the daily run when the data stops moving. Do not
  weaken it to make a run pass.
