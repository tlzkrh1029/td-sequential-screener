#!/bin/bash
# Proves the checks: seeds one error at a time into a COPY of the repository's page sources and shows which check fails
# for it.
#
#   seeds/run-seeds.sh <repoDir> <baselineOutDir> [--out <dir>] [--port <n>] [--full] [seed ...]
#
# <baselineOutDir> is the output of run.sh on the unseeded repository: a seed counts as CAUGHT only when its check
# fails with a message that the baseline run does not have. Without seed names every seed of seeds/apply.py is run
# (apply.py --list names them). Three seeds run side by side, each with run.sh --only <its check> --quick (--full:
# the whole check) on the ports <n> .. <n>+5 (default 8913). Everything is written under <out> (default <the system's
# temporary folder>/td-bird-eye-check/seeds); the fonts are taken from the baseline's copy.
# Prints one line per seed:  CAUGHT | MISSED  <seed>: <what was seeded> -> <check>: <first message that names it>
set -u
QA="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -ge 2 ] || { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
REPO="$(cd "$1" && pwd)"; BASELINE="$(cd "$2" && pwd)"; shift 2
WORK="${TMPDIR:-/tmp}/td-bird-eye-check/seeds"; PORT=8913; MODE="--quick"; WANT=()
while [ $# -gt 0 ]; do
  case "$1" in --out) WORK="$2"; shift 2;; --port) PORT="$2"; shift 2;; --full) MODE=""; shift;; -*) echo "unknown option $1" >&2; exit 2;; *) WANT+=("$1"); shift;; esac
done
mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"
export QA_FONTCACHE="${QA_FONTCACHE:-$BASELINE/fontcache}"
# seed | check to run | line whose failures name it | pattern of the failure
TABLE='shorter-kept|sweep|c11_piles|has given way .* while the less important|is folded while the shorter|not written, in a window
nine-in-chip-columns|sweep|c11_piles|is written in the columns of the chip
mixed-wide|sweep|c03_painted|both as numbers and as marks|is shown as "mark"; at
number-larger-1m|sweep|c03_painted|1M ".*": painted at 17 px
center-with-superscript|sweep|c02_anchor|the middle of its digits is at x .* px beside it
center-with-superscript-pointers|sweep|c02_anchor|with the superscript included
say-double-stop|copy|c14_copy|a punctuation mark twice
gone-full-strength|sweep|c03_painted|deleted on TradingView\): painted at strength
gone-no-underline|sweep|c03_painted|no dotted line is painted under it
gone-mark-filled|sweep|c03_painted|as a mark: filled, but the label is deleted
gone-strip-tick|strip|c05_strip|is deleted on TradingView
close-through-band|strip|c05_strip|the close line is inside a band on
list-missing-member|folds|c01_folds|the list does not name|the list has [0-9]+ lines for
chip-click-moves-scale|folds|c01_folds|a click changed the scales|a click repainted
strict-worded-old|asof|c15_conditions_other_days|cannot read|still says
strict-as-inclusive|asof|c15_conditions_other_days|the engine prints the label only beyond|already gets the label
strict-level-view|asof|c15_conditions_other_days|td-view says the comparison at
probe-drops-undrawn|sweep|c01_identity|expected at day .* the probe has 0
zone-chip-at-q|conds|c06_conditions|the pointer starts at y
fonts-late-hook|fonts|c13_fonts_settle|after the fonts arrived
width-cache-kept|fonts|c13_fonts_settle|after the fonts arrived
appbar-sticky|firstscreen|c16_first_screen|the app bar is sticky
chart-short|firstscreen|c16_first_screen|the chart is [0-9.]+ px high; the window
coin-head-row|firstscreen|c16_first_screen|the first screen holds|are written on the page
leader-colored|sweep|c03_painted|the lines are neutral
leader-faint|sweep|c03_painted|has a contrast of
no-leader|sweep|c11_piles|and has no line to it
own-from-columns|sweep|c11_piles|and has no line to it
lead-side-3|sweep|c02_anchor|px beside it
demote-single|sweep|c11_piles|has given way \(mark\) while the less important
stack-order-exception|sweep|c04_geometry|stands further from the candle than
dark-colors-light|screens|c12_other_screens|its color on the dark theme is
dark-candles-loud|screens|c12_other_screens|falling candles on the dark theme
grid-above-high|sweep|c00_base|above the highest high|under the lowest low
plus13-narrow-small|screens|c12_other_screens|painted at 11 px with a 8 px superscript
chip-says-oe|sweep|c00_base|a chip with another text
chip-squares-wrong|sweep|c03_painted|squares in
chip-tooltip-12|folds|c01_folds|the tooltip lists 12 rows
list-order|folds|c01_folds|is not ordered from the longest timeframe|is not line
strip-9-narrow|strip|c05_strip|a narrow strip shows no 9
strip-ground-clear|strip|c05_strip|the grounds are opaque
strip-plus-widens|strip|c05_strip|strip key \+ \(narrower\)
strip-no-date|strip|c05_strip|pointing at the strip at x
zone-rail-always|conds|c06_conditions|a vertical line in the zone
zone-wide|conds|c06_conditions|px wide \(the canvas
zone-panel|conds|c06_conditions|a panel
near-not-tinted|asof|c15_conditions_other_days|within the 임박 threshold\): the chip.s ground
far-tinted|conds|c06_conditions|the chip has a ground
edge-pinned-missing|conds|c06_conditions|conditions are beyond the price range there
phone-list-open|conds|c06_conditions|the conditions start as
key-zone-error|controls|c09_controls|a script error
key-page-dead|controls|c09_controls|Page Up from
key-updown-scroll|controls|c09_controls|scrolled the page by
click-opens-at-once|tooltips|c07_tooltips|did not pin its tooltip
slip-is-click|tooltips|c07_tooltips|a press that slipped 3 px
day-price-raw|tooltips|c07_tooltips|at a price step of
day-sentence-back|tooltips|c07_tooltips|no label at that day, but the tooltip says
place-sentence-back|tooltips|c07_tooltips|stands at its bar.s last day, but the tooltip says|the tooltip still says where
tip-over-stack|tooltips|c07_tooltips|its tooltip .* covers
origin-lines-off|tooltips|c07_tooltips|no dashed line marks it
axis-label-kept|tooltips|c07_tooltips|and is not hidden
failed-load-english|controls|c09_controls|a failed load
empty-plot-silent|controls|c09_controls|every timeframe off: the plot says
caption-old|copy|c14_copy|the strip.s caption is
legend-always|copy|c14_copy|the legend has the item
legend-family|copy|c14_copy|a family item|rules do not name
sian-twice|copy|c14_copy|"시안" stands 2 times
title-english|copy|c14_copy|the hover title|Latin word
setting-button-silent|controls|c09_controls|the 설정 button says
k-six|sweep|c04_geometry|numbers are written in one stack
monthly-axis|sweep|c00_base|which has to be labelled by months
week-day-early|sweep|c02_anchor|the probe puts it at .* the last day of its bar with a daily candle is
week-day-early-paint|sweep|c02_anchor|the middle of its digits is at x
drop-same-day|sweep|c01_identity|expected at day .* the probe has 0
wrong-family-color|sweep|c03_painted|painted in #e74bb1 / superscript #e74bb1, its color on the light theme is #74279a
neighbour-superscript|sweep|c03_painted|the superscript painted is "3W"
folded-missing|sweep|c03_painted|labels are folded into it
strip-row|strip|c05_strip|the row of 2W on that side
cond-tick-view|conds|c06_conditions|td-view fire
cond-tick-page|conds|c06_conditions|the page has p
cond-tick-list|conds|c06_conditions|phone row .* written
cond-tick-tooltip|conds|c06_conditions|written "조건가
pixel-in-candle|sweep|c04_geometry|reaches into the candle|covers painted candle pixels|px from the candle
gap-two|sweep|c04_geometry|numbers keep 3 px from the candles
tooltip-origin|tooltips|c07_tooltips|origin bars
day-tooltip-misses|tooltips|c07_tooltips|the tooltip lists
strip-box-off|strip|c05_strip|현재 창 box painted
mark-color|sweep|c03_painted|as a mark: painted in #e74bb1, its color on the light theme is #dc2a2a
x2-dropped|sweep|c03_painted|the engine says "13x2", painted "13"
nine-toggle-leaks|controls|c09_controls|9 끔: settings became
chip-tooltip-misses|folds|c01_folds|tooltip heading|the tooltip lists|is not line
sell-under|sweep|c02_anchor|the probe puts it at
canvas-hidden|sweep|c03_painted|the chart.s canvas is not visible
overlay-covers|sweep|c03_painted|something lies over the numbers
host-only-shift|published|c10_published|screenshots differ|differs
hover-moves|sweep|c04_geometry|hovering changed|hovering repainted'
# every seed of apply.py has its line here, and every line its seed
for s in $(python3 "$QA/seeds/apply.py" --list | cut -f1); do grep -q "^$s|" <<< "$TABLE" || echo "run-seeds.sh: seed $s has no line in the table" >&2; done
python3 "$QA/seeds/apply.py" --check "$REPO" > "$WORK/fit.log" 2>&1 || { echo "run-seeds.sh: some seeds no longer fit the page's sources:"; cat "$WORK/fit.log"; }
# the copy that is seeded: the page's sources and the data of the two coins
[ -e "$WORK/base" ] && rm -rf "${WORK:?}/base"
mkdir -p "$WORK/base/data/daily" "$WORK/base/verify/out"
cp -r "$REPO/dashboard" "$REPO/scripts" "$REPO/package.json" "$WORK/base/"; cp "$REPO/data/universe.json" "$REPO/data/tickers.json" "$WORK/base/data/"
cp "$REPO/data/daily/_status.json" "$REPO/data/daily/CRYPTO_BTCUSD.json" "$REPO/data/daily/CRYPTO_ETHUSD.json" "$WORK/base/data/daily/"; cp "$REPO/verify/out/summary.json" "$WORK/base/verify/out/" 2>/dev/null
one() {
  local line="$1" port="$2"; IFS='|' read -r seed checks check pattern <<< "$line"
  pattern="${line#*|*|*|}"
  local dir="$WORK/$seed"; [ -e "$dir" ] && rm -rf "${dir:?}"; mkdir -p "$dir"; cp -r "$WORK/base" "$dir/repo"
  local what; what="$(python3 "$QA/seeds/apply.py" "$seed" "$dir/repo" 2>&1)" || { echo "MISSED $seed: the seed could not be applied: $what"; return; }
  "$QA/run.sh" "$dir/repo" --out "$dir/out" --port "$port" --only "$checks" $MODE > "$dir/run.log" 2>&1
  node -e '
    const fs = require("fs"), [seedDir, baseDir, check, pattern, seed, what] = process.argv.slice(1), re = new RegExp(pattern);
    const read = (d) => { try { return JSON.parse(fs.readFileSync(d + "/" + check + ".json", "utf8")); } catch (e) { return null; } };
    const s = read(seedDir), b = read(baseDir);
    if (!s) { console.log(`MISSED ${seed}: ${what.replace(/^seeded [^:]*: /, "")} -> ${check} did not finish`); process.exit(0); }
    const hit = s.fails.filter((f) => re.test(f)), was = b ? b.fails.filter((f) => re.test(f)) : [];
    const others = fs.readdirSync(seedDir).filter((f) => /^c\d\d.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(seedDir + "/" + f, "utf8"))).filter((j) => !j.pass).map((j) => j.name);
    if (hit.length && !was.length) console.log(`CAUGHT ${seed}: ${what.replace(/^seeded [^:]*: /, "")} -> ${check} FAIL (${hit.length} messages name it; failing lines of the run: ${others.join(" ")}), first: ${hit[0].slice(0, 230)}`);
    else console.log(`MISSED ${seed}: ${what.replace(/^seeded [^:]*: /, "")} -> ${check}: ${hit.length} matching messages (${was.length} of that kind in the baseline); failing lines: ${others.join(" ")}${s.fails.length ? "; first failure: " + s.fails[0].slice(0, 200) : ""}`);
  ' "$dir/out" "$BASELINE" "$check" "$pattern" "$seed" "$what"
}
LIST=(); while IFS= read -r l; do [ -z "$l" ] && continue; s="${l%%|*}"; if [ ${#WANT[@]} -eq 0 ]; then LIST+=("$l"); else for w in "${WANT[@]}"; do [ "$w" = "$s" ] && LIST+=("$l"); done; fi; done <<< "$TABLE"
i=0
while [ $i -lt ${#LIST[@]} ]; do
  one "${LIST[$i]}" "$PORT" & p1=$!
  if [ $((i + 1)) -lt ${#LIST[@]} ]; then one "${LIST[$((i + 1))]}" "$((PORT + 2))" & p2=$!; else p2=""; fi
  if [ $((i + 2)) -lt ${#LIST[@]} ]; then one "${LIST[$((i + 2))]}" "$((PORT + 4))" & p3=$!; else p3=""; fi
  wait $p1 $p2 $p3
  i=$((i + 3))
done
