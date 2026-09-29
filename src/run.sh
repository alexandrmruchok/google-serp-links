#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

command -v node >/dev/null 2>&1 || { echo "node-not-found" >&2; exit 127; }
command -v npm  >/dev/null 2>&1 || { echo "npm-not-found" >&2; exit 127; }

if [ ! -d "$SKILL_DIR/node_modules/cheerio" ]; then
    npm install --prefix "$SKILL_DIR" --no-audit --no-fund --silent
fi

SAVE_HTML_DIR="$SKILL_DIR/../save-html"
if [ ! -d "$SAVE_HTML_DIR/node_modules/playwright-core" ]; then
    npm install --prefix "$SAVE_HTML_DIR" --no-audit --no-fund --silent
fi

exec node "$SCRIPT_DIR/serp-links.mjs" "$@"
