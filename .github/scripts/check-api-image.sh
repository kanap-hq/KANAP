#!/usr/bin/env bash
# Checks an API image built from the runtime stage of backend/Dockerfile: the document
# converters answer, the sources and the development tools are absent, and the compiled scripts
# the API runs and the pages of the user manual are present. The development tools are looked
# for at any depth of node_modules: the find lists each one it meets and the check fails when
# it lists anything. The modules of the sample data loader are imported one by one, the entry
# point setup-tenant.mjs excepted (importing it would start a load): a module that reads a file
# missing from the image when it loads fails here (26.11.1 read its criteria labels from src/).
# The image names its user by number (an orchestrator that refuses root images checks a number).
#
# Then the start on a throwaway PostgreSQL 16 (pinned by digest, on a network of its own with no
# way out, removed at the end), with what a Kubernetes cluster may impose: an arbitrary user,
# no capabilities, a read-only root file system with a tmpfs on /tmp. The migration step
# (--migrate-only) exits 0 and migrates, then 0 with nothing to migrate; it exits 2 with
# SKIP_MIGRATIONS on and 1 with a protected database role. An API started with SKIP_MIGRATIONS
# stops on the empty database, after a warning; once migrated it answers /health, and
# /health/ready 200, or 503 while a migration is pending.
#
#   check-api-image.sh <image>    for example kadratis-api:ci
#
# Called by the `images` job of ci.yml and the `publish` job of release-images.yml.
set -euo pipefail

image=${1:?usage: check-api-image.sh <image>}

docker run --rm "$image" sh -c 'node -v && inkscape --version && pandoc --version | head -1 && typst --version && test ! -e src && test -f dist/knowledge/scripts/backfill-integrated-docs.js'
# The user manual's pages (stage help-docs), Markdown only, in the four languages.
docker run --rm "$image" sh -c 'for lang in en fr de es; do test -f help-docs/$lang/contracts.md || exit 1; done; others=$(find help-docs -type f ! -name "*.md"); test -z "$others" || { echo "$others"; exit 1; }'
docker run --rm "$image" sh -c 'tools=$(find ./node_modules -path "*/node_modules/ts-node-dev" -o -path "*/node_modules/ts-node" -o -path "*/node_modules/typescript") || exit 1; echo "${tools:-No ts-node-dev, ts-node or typescript in node_modules.}"; test -z "$tools"'
docker run --rm "$image" sh -c 'for module in fixtures/fromage-co/*.mjs fixtures/fromage-co/translations/*.mjs scripts/lib/*.mjs; do test "$module" = fixtures/fromage-co/setup-tenant.mjs && continue; node --input-type=module -e "await import(\"/app/$module\")" || { echo "Cannot load $module"; exit 1; }; done; echo "Sample data loader modules load."'

user=$(docker image inspect -f '{{.Config.User}}' "$image")
[[ "$user" =~ ^[0-9]+(:[0-9]+)?$ ]] || { echo "check-api-image: the image user is '$user', not a number"; exit 1; }
echo "Image user: $user."

# The start, on a throwaway database.
postgres_image='postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d'
prefix="check-api-$$"
network="$prefix-net"
db="$prefix-db"
restricted=(--network "$network" --user 12345:0 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --memory 3g)
started=()
cleanup() {
  for name in "${started[@]}"; do docker rm -f "$name" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "check-api-image: $1" >&2
  if [ -n "${2:-}" ]; then docker logs "$2" 2>&1 | tail -30 >&2 || true; fi
  exit 1
}

docker network create --internal "$network" >/dev/null
started+=("$db")
docker run -d --name "$db" --network "$network" --memory 1g -e POSTGRES_PASSWORD=check-only "$postgres_image" >/dev/null
for _ in $(seq 1 120); do
  docker exec "$db" pg_isready -q -U postgres -h 127.0.0.1 2>/dev/null && break
  sleep 0.5
done
docker exec "$db" pg_isready -q -U postgres -h 127.0.0.1 || fail 'PostgreSQL does not start' "$db"
psql() { docker exec "$db" psql -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
psql -c "CREATE ROLE kanap LOGIN PASSWORD 'check-only'" -c 'CREATE DATABASE kanap OWNER kanap'
for extension in citext pgcrypto '"uuid-ossp"' pg_trgm unaccent; do psql -d kanap -c "CREATE EXTENSION $extension"; done
app_url="postgres://kanap:check-only@$db:5432/kanap"

# migrate <expected exit code> <docker run options...>: runs the migration step, prints its log.
migrate() {
  local expected=$1 code=0
  shift
  out=$(docker run --rm "${restricted[@]}" "$@" "$image" node ./scripts/migrate-and-start.js --migrate-only 2>&1) || code=$?
  [ "$code" = "$expected" ] || { echo "$out" | tail -30 >&2; fail "--migrate-only exited $code, expected $expected"; }
}

# api <name>: starts an API with SKIP_MIGRATIONS on.
api() {
  local name="$prefix-$1"
  started+=("$name")
  docker run -d --name "$name" "${restricted[@]}" -e "DATABASE_URL=$app_url" -e SKIP_MIGRATIONS=true \
    -e DEPLOYMENT_MODE=single-tenant -e APP_BASE_URL=http://localhost -e "JWT_SECRET=check-api-image-$$-0123456789abcdefghijklmnop" \
    -e S3_ENDPOINT=http://127.0.0.1:9 -e S3_BUCKET=check-only \
    "$image" >/dev/null
}

# The empty database: an API with SKIP_MIGRATIONS names the pending migrations and stops.
api empty
code=$(timeout 90 docker wait "$prefix-empty") || fail 'empty database: the API did not stop' "$prefix-empty"
[ "$code" != 0 ] || fail 'empty database: the API exited 0' "$prefix-empty"
logs=$(docker logs "$prefix-empty" 2>&1)
grep -qE 'SKIP_MIGRATIONS is on and [0-9]+ migration\(s\) are pending' <<<"$logs" || fail 'empty database: no warning' "$prefix-empty"
echo "Empty database, API with SKIP_MIGRATIONS: names the pending migrations and exits $code."

migrate 2 -e "DATABASE_URL=$app_url" -e SKIP_MIGRATIONS=true
grep -q -- '--migrate-only with SKIP_MIGRATIONS on: no migration ran' <<<"$out" || fail "SKIP_MIGRATIONS: $out"
migrate 1 -e "DATABASE_URL=postgres://postgres:check-only@$db:5432/kanap"
grep -q 'No migration ran.' <<<"$out" || fail "protected role: $out"
migrate 0 -e "DATABASE_URL=$app_url"
executed=$(sed -nE 's/.*Migrations complete \(([0-9]+) executed\).*/\1/p' <<<"$out")
[ "${executed:-0}" -gt 0 ] || fail "first run: no migration executed: $(tail -5 <<<"$out")"
grep -q 'exiting without starting the API' <<<"$out" || fail "first run: $(tail -5 <<<"$out")"
migrate 0 -e "DATABASE_URL=$app_url"
grep -q 'Migrations complete (0 executed)' <<<"$out" || fail "second run: $(tail -5 <<<"$out")"
echo "Migration step as uid 12345 on a read-only file system: $executed migrations, then none; exit 2 with SKIP_MIGRATIONS, 1 with a protected role."

# serving <name>: starts an API with SKIP_MIGRATIONS on and waits until /health answers.
serving() {
  local name="$prefix-$1"
  api "$1"
  for _ in $(seq 1 120); do
    [ "$(get "$1" /health 2>/dev/null)" = '200 {"status":"ok","text_processing":"ready"}' ] && return 0
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || fail "$name stopped" "$name"
    sleep 1
  done
  fail "$name: /health does not answer" "$name"
}
# get <name> <path>: "<status> <body>" of a GET, from inside the container.
get() {
  docker exec "$prefix-$1" node -e 'fetch("http://127.0.0.1:8080" + process.argv[1]).then(async (r) => console.log(r.status, await r.text()), () => process.exit(1))' "$2"
}
expect() {
  local got
  got=$(get "$1" "$2") || got='no answer'
  [ "$got" = "$3" ] || fail "$2: expected '$3', got '$got'" "$prefix-$1"
}

serving ready
expect ready /health/ready '200 {"status":"ok"}'
echo 'API with SKIP_MIGRATIONS on the migrated database: /health and /health/ready 200.'

# A migration pending: its row taken out of the migrations table, then put back.
last=$(psql -d kanap -At -c 'SELECT name FROM migrations ORDER BY id DESC LIMIT 1')
row=$(psql -d kanap -At -c "SELECT timestamp FROM migrations WHERE name = '$last'")
psql -d kanap -c "DELETE FROM migrations WHERE name = '$last'"
serving pending
expect pending /health/ready '503 {"status":"unavailable"}'
logs=$(docker logs "$prefix-pending" 2>&1)
grep -qF 'SKIP_MIGRATIONS is on and 1 migration(s) are pending' <<<"$logs" || fail 'no warning about the pending migration' "$prefix-pending"
psql -d kanap -c "INSERT INTO migrations (timestamp, name) VALUES ($row, '$last')"
expect pending /health/ready '200 {"status":"ok"}'
echo 'A pending migration: /health/ready 503 and one warning, then 200 once recorded.'

docker image ls "$image"
