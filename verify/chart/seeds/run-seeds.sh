#!/bin/bash
# Proves the checks: seeds one error at a time into a COPY of the repository and shows which check fails for it.
#
#   seeds/run-seeds.sh <repoDir> <baselineOutDir> [seed ...]
#
# <baselineOutDir> is the output of run.sh on the unseeded repository: a seed counts as CAUGHT only when its check
# fails with a message that the baseline run does not have. Runs three seeds side by side on ports 8913-8918.
# Prints one line per seed:  CAUGHT | MISSED  <seed>: <what was seeded> -> <check>: <first message that names it>
set -u
QA="$(cd "$(dirname "$0")/.." && pwd)"; REPO="$(cd "$1" && pwd)"; BASELINE="$(cd "$2" && pwd)"; shift 2
WORK="$QA/out/seeds"; mkdir -p "$WORK"
# seed | checks to run | check whose failures name it | pattern of the failure
TABLE='week-day-early|sweep|c02_anchor|the probe puts it at .* the last day of its bar with a daily candle is
week-day-early-paint|sweep|c02_anchor|painted around x .* its day .* is at x
drop-same-day|sweep|c01_identity|expected at day .* the probe has 0
wrong-family-color|sweep|c03_painted|painted in #e74bb1 / superscript #e74bb1, its color is #74279a
neighbour-superscript|sweep|c03_painted|the superscript painted is "3W"
folded-missing|sweep|c03_painted|labels are folded into it
strip-row|strip|c05_strip|the row of 2W on that side
cond-tick-view|conds|c06_conditions|td-view fire|gets no label|already gets the label
cond-tick-page|conds|c06_conditions|the page has p
cond-tick-list|conds|c06_conditions|phone row .* prices
pixel-in-candle|sweep|c04_geometry|reaches into the candle|covers painted candle pixels
nine-larger-1m|sweep|c03_painted|numbers of kind S are painted in 2 different fonts
tooltip-origin|tooltips|c07_tooltips|origin bars
day-tooltip-misses|tooltips|c07_tooltips|the tooltip lists
strip-box-off|strip|c05_strip|현재 창 box painted
mark-color|sweep|c03_painted|as a mark: painted in #e74bb1, its color is #dc2a2a
x2-dropped|sweep|c03_painted|the engine says "13x2", painted "13"
nine-toggle-leaks|controls|c09_controls|9 끔: settings became
chip-tooltip-misses|folds|c01_folds|the tooltip lists [0-9]+ rows
sell-under|sweep|c02_anchor|the probe puts it at
hover-moves|sweep|c04_geometry|hovering changed|hovering repainted
canvas-hidden|sweep|c03_painted|the chart.s canvas is not visible
overlay-covers|sweep|c03_painted|something lies over the numbers
host-only-shift|published|c10_published|screenshots differ'
if [ ! -d "$QA/seeds/base" ] || [ "${RESEED:-}" = "1" ]; then
  rm -rf "$QA/seeds/base"; mkdir -p "$QA/seeds/base/data/daily" "$QA/seeds/base/verify/out"
  cp -r "$REPO/dashboard" "$REPO/scripts" "$REPO/package.json" "$QA/seeds/base/"; cp "$REPO/data/universe.json" "$REPO/data/tickers.json" "$QA/seeds/base/data/"
  cp "$REPO/data/daily/_status.json" "$REPO/data/daily/CRYPTO_BTCUSD.json" "$REPO/data/daily/CRYPTO_ETHUSD.json" "$QA/seeds/base/data/daily/"; cp "$REPO/verify/out/summary.json" "$QA/seeds/base/verify/out/" 2>/dev/null
fi
one() {
  local line="$1" port="$2"; IFS='|' read -r seed checks check pattern <<< "$line"
  pattern="${line#*|*|*|}"
  local dir="$WORK/$seed"; rm -rf "$dir"; mkdir -p "$dir"; cp -r "$QA/seeds/base" "$dir/repo"
  local what; what="$(python3 "$QA/seeds/apply.py" "$seed" "$dir/repo" 2>&1)" || { echo "MISSED $seed: the seed could not be applied: $what"; return; }
  "$QA/run.sh" "$dir/repo" --out "$dir/out" --port "$port" --only "$checks" --quick > "$dir/run.log" 2>&1
  node -e '
    const fs = require("fs"), [seedDir, baseDir, check, pattern, seed, what] = process.argv.slice(1), re = new RegExp(pattern);
    const read = (d) => { try { return JSON.parse(fs.readFileSync(d + "/" + check + ".json", "utf8")); } catch (e) { return null; } };
    const s = read(seedDir), b = read(baseDir);
    if (!s) { console.log(`MISSED ${seed}: ${what.replace(/^seeded [^:]*: /, "")} -> ${check} did not finish`); process.exit(0); }
    const hit = s.fails.filter((f) => re.test(f)), was = b ? b.fails.filter((f) => re.test(f)) : [];
    const others = fs.readdirSync(seedDir).filter((f) => /^c\d\d.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(seedDir + "/" + f, "utf8"))).filter((j) => !j.pass).map((j) => j.name);
    if (hit.length && !was.length) console.log(`CAUGHT ${seed}: ${what.replace(/^seeded [^:]*: /, "")} -> ${check} FAIL (${hit.length} messages name it; failing lines of the run: ${others.join(" ")}), first: ${hit[0].slice(0, 230)}`);
    else console.log(`MISSED ${seed}: ${what.replace(/^seeded [^:]*: /, "")} -> ${check}: ${hit.length} matching messages (${was.length} of that kind in the baseline); failing lines: ${others.join(" ")}`);
  ' "$dir/out" "$BASELINE" "$check" "$pattern" "$seed" "$what"
}
LIST=(); while IFS= read -r l; do [ -z "$l" ] && continue; s="${l%%|*}"; if [ $# -eq 0 ]; then LIST+=("$l"); else for w in "$@"; do [ "$w" = "$s" ] && LIST+=("$l"); done; fi; done <<< "$TABLE"
i=0
while [ $i -lt ${#LIST[@]} ]; do
  one "${LIST[$i]}" 8913 & p1=$!
  if [ $((i + 1)) -lt ${#LIST[@]} ]; then one "${LIST[$((i + 1))]}" 8915 & p2=$!; else p2=""; fi
  if [ $((i + 2)) -lt ${#LIST[@]} ]; then one "${LIST[$((i + 2))]}" 8917 & p3=$!; else p3=""; fi
  wait $p1 $p2 $p3
  i=$((i + 3))
done
