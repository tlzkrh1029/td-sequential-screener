#!/bin/bash
# The checks on the page "as of" an earlier day:  tools/asof-run.sh <repoDir> <YYYY-MM-DD> [port] [checks]
# Cuts a copy of the BTC and ETH data off at that day (tools/asof.mjs) and runs run.sh on the copy in its short form.
# Other days have other next-bar conditions (9s, repeated 9s, conditions met now or within the 임박 threshold, an
# "unless" clause) and other numbers at the right edge, which today's data does not have.
set -u
QA="$(cd "$(dirname "$0")/.." && pwd)"; REPO="$1"; DATE="$2"; PORT="${3:-8911}"; CHECKS="${4:-sweep,strip,conds,tooltips,known,controls}"
DIR="$QA/out/asof-$DATE"; rm -rf "$DIR"; mkdir -p "$DIR"
node "$QA/tools/asof.mjs" "$REPO" "$DIR/repo" "$DATE" || exit 1
"$QA/run.sh" "$DIR/repo" --out "$DIR/out" --port "$PORT" --only "$CHECKS" --quick
