#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
node scripts/launch.mjs --mode lan "$@"
