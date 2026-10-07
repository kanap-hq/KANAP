#!/usr/bin/env bash
# Fails when a package-lock.json entry has no `integrity` hash: `npm ci` checks every downloaded
# package against that hash, so each entry must carry one.
#   check-lockfile-integrity.sh [lockfile ...]   (default: the backend, frontend and marketing lockfiles)
set -euo pipefail
[ "$#" -gt 0 ] || set -- backend/package-lock.json frontend/package-lock.json marketing/web/package-lock.json
node -e 'let n=0;for(const f of process.argv.slice(1)){for(const [k,v] of Object.entries(require(require("path").resolve(f)).packages||{}))if(k&&!v.link&&!v.inBundle&&!v.integrity){console.log(`${f}: ${k} has no integrity`);n++}}if(n){console.log(`${n} lockfile entries without integrity`);process.exit(1)}console.log(`Every entry of ${process.argv.length-1} lockfiles has an integrity hash.`)' "$@"
