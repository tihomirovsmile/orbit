#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 LTS: https://nodejs.org/' >&2
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
exec npm run launch
