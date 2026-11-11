#!/bin/bash
# The checks on the page "as of" an earlier day:
#   tools/asof-run.sh <repoDir> <YYYY-MM-DD> [--out <dir>] [--port <n>] [--only <checks>]
# Cuts a copy of the BTC and ETH data off at that day (tools/asof.mjs) and runs run.sh on the copy in its short form
# (default checks: sweep,strip,conds,tooltips,controls,folds). Other days have other next-bar conditions (9s that
# still wait behind a level the close has to go beyond, repeated 9s, conditions met now or within the 임박 threshold,
# an "unless" clause) and other numbers at the right edge, which today's data does not have. Everything is written
# under <out> (default <the system's temporary folder>/td-bird-eye-check/asof-<day>).
set -u
QA="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -ge 2 ] || { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
REPO="$1"; DATE="$2"; shift 2
DIR="${TMPDIR:-/tmp}/td-bird-eye-check/asof-$DATE"; PORT=8911; CHECKS="sweep,strip,conds,tooltips,controls,folds"
while [ $# -gt 0 ]; do case "$1" in --out) DIR="$2"; shift 2;; --port) PORT="$2"; shift 2;; --only) CHECKS="$2"; shift 2;; *) echo "unknown argument $1" >&2; exit 2;; esac; done
mkdir -p "$DIR"; DIR="$(cd "$DIR" && pwd)"
node "$QA/tools/asof.mjs" "$REPO" "$DIR/repo" "$DATE" || exit 1
"$QA/run.sh" "$DIR/repo" --out "$DIR/out" --port "$PORT" --only "$CHECKS" --quick
