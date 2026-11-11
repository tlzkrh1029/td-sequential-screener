#!/bin/bash
# The Bird Eye chart (dashboard/mockups/be-chart.js), checked against the engine and against the rules of its picture,
# in one run.
#
#   run.sh <repoDir> [--out <dir>] [--port <n>] [--quick] [--only <check,check>] [--coins BTC,ETH]
#
# Builds the owner's page (and its published --fragment form inside the host's document) from <repoDir>, serves both
# on 127.0.0.1:<port> and <port>+1 (default 8911 and 8912), computes the expectations in Node from the repository's
# own modules and data (lib/expect.mjs), runs every check and prints one PASS / FAIL line per check with its totals.
# Exit code 0 only when every line is PASS.
#
# Nothing is written into <repoDir>. Everything goes to <out>: the two builds, the expectations, logs/, one
# <check>.json per line with every failure message, screenshots, and fontcache/ (the web fonts, fetched once from the
# font hosts and served from there afterwards; another folder can be named with QA_FONTCACHE). The default <out> is
# <the system's temporary folder>/td-bird-eye-check/latest, outside the repository.
#
#   checks (names for --only) and the lines they print:
#     sweep        c00_base c01_identity c02_anchor c03_painted c04_geometry c11_piles
#     folds        c01_folds                     strip        c05_strip
#     conds        c06_conditions                tooltips     c07_tooltips
#     known        c08_known_label               controls     c09_controls
#     published    c10_published                 screens      c12_other_screens
#     fonts        c13_fonts_settle              copy         c14_copy
#     asof         c15_conditions_other_days     firstscreen  c16_first_screen
#   --quick   the short form of every check (for a first look; the totals are smaller)
# The servers started here are stopped by their process ids when the run ends. Needs node, python3 (with Pillow and
# numpy, for the pixel comparison of the published form) and the playwright package with its Chromium.
set -u
QA="$(cd "$(dirname "$0")" && pwd)"
REPO=""; OUT="${TMPDIR:-/tmp}/td-bird-eye-check/latest"; PORT=8911; QUICK=""; ONLY=""; COINS="BTC,ETH"
USAGE="usage: run.sh <repoDir> [--out dir] [--port n] [--quick] [--only names] [--coins BTC,ETH]"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2;; --port) PORT="$2"; shift 2;; --quick) QUICK="--quick"; shift;; --only) ONLY="$2"; shift 2;; --coins) COINS="$2"; shift 2;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    -*) echo "unknown option $1" >&2; echo "$USAGE" >&2; exit 2;; *) REPO="$1"; shift;;
  esac
done
[ -n "$REPO" ] && [ -f "$REPO/scripts/build-site.mjs" ] || { echo "$USAGE" >&2; exit 2; }
case "$PORT" in ''|*[!0-9]*) echo "--port must be a number (the next port is used too)" >&2; exit 2;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65534 ] || { echo "--port must be between 1024 and 65534 (the next port is used too)" >&2; exit 2; }
REPO="$(cd "$REPO" && pwd)"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
export QA_FONTCACHE="${QA_FONTCACHE:-$OUT/fontcache}"
# (what an earlier run left in <out>; the fonts' copy stays)
for d in site fragbuild frag logs pub screens dump dump-known asof; do [ -e "$OUT/$d" ] && rm -rf "${OUT:?}/$d"; done
rm -f "$OUT"/*.json "$OUT"/*.png; mkdir -p "$OUT/logs"
T0=$(date +%s)
HEAD_IS="$(cd "$REPO" && git rev-parse --short HEAD 2>/dev/null || echo 'no git')"
# (the page is built from the files as they are: say so when they differ from that commit)
[ "$HEAD_IS" != "no git" ] && [ -n "$(cd "$REPO" && git status --porcelain --untracked-files=no 2>/dev/null)" ] && HEAD_IS="$HEAD_IS with uncommitted changes"
echo "run.sh: repository $REPO ($HEAD_IS), output $OUT, ports $PORT and $((PORT + 1))${QUICK:+, quick}"

# ---- build: the page as its own document, and the published fragment inside the host's document ----
BUILD=(--template dashboard/mockups/birdeye.html --chunk 8 --includes be-chart --coins "$COINS")
(cd "$REPO" && node scripts/build-site.mjs "$OUT/site" "${BUILD[@]}") > "$OUT/logs/build.log" 2>&1 || { echo "FAIL build: the page did not build"; cat "$OUT/logs/build.log"; exit 1; }
(cd "$REPO" && node scripts/build-site.mjs "$OUT/fragbuild" "${BUILD[@]}" --fragment) >> "$OUT/logs/build.log" 2>&1 || { echo "FAIL build: the fragment did not build"; cat "$OUT/logs/build.log"; exit 1; }
mkdir -p "$OUT/frag/d" && cp "$OUT"/fragbuild/d/*.json "$OUT/frag/d/"
{ printf '%s\n' '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>'; cat "$OUT/fragbuild/index.html"; printf '%s' '</body></html>'; } > "$OUT/frag/index.html"
echo "PASS build: page $(wc -c < "$OUT/site/index.html") bytes, daily file $(wc -c < "$OUT/site/d/0.json") bytes; fragment in the host's document $(wc -c < "$OUT/frag/index.html") bytes, served with index.html and d/0.json only"

# ---- expectations, outside the page ----
node "$QA/lib/expect.mjs" "$REPO" "$OUT/expect.json" --coins "$COINS" > "$OUT/logs/expect.log" 2>&1 || { echo "FAIL expect: the expectations could not be computed"; cat "$OUT/logs/expect.log"; exit 1; }
sed 's/; anchor facts.*//' "$OUT/logs/expect.log" | sed 's/^/     /'

# ---- serve ----
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
python3 -m http.server --directory "$OUT/site" --bind 127.0.0.1 "$PORT" > "$OUT/logs/server-site.log" 2>&1 & PIDS+=($!)
python3 -m http.server --directory "$OUT/frag" --bind 127.0.0.1 "$((PORT + 1))" > "$OUT/logs/server-frag.log" 2>&1 & PIDS+=($!)
BASE="http://127.0.0.1:$PORT/"; FRAG="http://127.0.0.1:$((PORT + 1))/"
for i in $(seq 1 50); do curl -s -o /dev/null "$BASE" && curl -s -o /dev/null "$FRAG" && break; sleep 0.1; done
curl -s -o /dev/null "$BASE" || { echo "FAIL serve: nothing answers on $BASE (is the port taken?)"; exit 1; }
# (the two addresses have to be the servers started here, not something else that listens there)
kill -0 "${PIDS[0]}" 2>/dev/null && kill -0 "${PIDS[1]}" 2>/dev/null || { echo "FAIL serve: a server did not start on $PORT or $((PORT + 1)) (is the port taken?)"; exit 1; }

# ---- the checks, in three lanes side by side; their lines are printed in order at the end ----
ARGS=(--base "$BASE" --out "$OUT" --expect "$OUT/expect.json" --repo "$REPO" --frag "$FRAG")
[ -n "$QUICK" ] && ARGS+=(--quick)
NAMES="sweep folds strip conds tooltips known controls published screens fonts copy asof firstscreen"
for n in ${ONLY//,/ }; do case " $NAMES " in *" $n "*) ;; *) echo "unknown check \"$n\" (the checks: $NAMES)" >&2; exit 2;; esac; done
want() { [ -z "$ONLY" ] || case ",$ONLY," in *",$1,"*) return 0;; *) return 1;; esac; }
run() { local name="$1"; want "$name" || return 0; node "$QA/checks/$name.cjs" "${ARGS[@]}" > "$OUT/logs/$name.out" 2> "$OUT/logs/$name.err"; echo $? > "$OUT/logs/$name.code"; }
( run sweep; run known; run conds; run tooltips; run copy ) &
L1=$!
( run screens; run strip; run folds; run firstscreen ) &
L2=$!
( run controls; run published; run asof ) &
L3=$!
wait $L1 $L2 $L3
# (the font check measures a race in the page's own timing: it runs alone, when the machine is quiet)
run fonts
RC=0; LINES=0; FAILS=0
for name in $NAMES; do
  want "$name" || continue
  if [ ! -s "$OUT/logs/$name.out" ] || [ "$(cat "$OUT/logs/$name.code" 2>/dev/null)" = "3" ]; then echo "FAIL $name: the check did not finish: $(tail -c 600 "$OUT/logs/$name.err" | tr '\n' ' ')"; RC=1; FAILS=$((FAILS + 1)); LINES=$((LINES + 1)); continue; fi
  cat "$OUT/logs/$name.out"
  LINES=$((LINES + $(grep -cE '^(PASS|FAIL) ' "$OUT/logs/$name.out"))); FAILS=$((FAILS + $(grep -cE '^FAIL ' "$OUT/logs/$name.out")))
  [ "$(cat "$OUT/logs/$name.code")" = "0" ] || RC=1
done
echo "run.sh: $LINES check lines, $FAILS FAIL, $(( $(date +%s) - T0 )) s; details per check in $OUT/<check>.json"
exit $RC
