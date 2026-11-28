#!/usr/bin/env bash
# Checks a web image built from frontend/Dockerfile. Started as an arbitrary user with no
# capabilities, on a read-only root file system with a tmpfs on /tmp (what a Kubernetes cluster
# may impose), it serves the app on port 80 with its security headers, proxies /api to
# KANAP_API_UPSTREAM, listens on KANAP_WEB_PORT when set, and refuses to start on an invalid
# value. Started as root with the capabilities of the compose files (an older setting), it still
# runs its workers as nginx. The containers have no network: every request is made from inside
# with the image's own wget, and the API address is 127.0.0.1:9, where nothing listens (502).
# Each container is removed at the end.
#
#   check-web-image.sh <image>    for example kadratis-web:ci
#
# Called by the `images` job of ci.yml and the `publish` job of release-images.yml.
set -euo pipefail

image=${1:?usage: check-web-image.sh <image>}
prefix="check-web-$$"
restricted=(--network none --user 12345:0 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges)
no_api=(-e KANAP_API_UPSTREAM=127.0.0.1:9)
started=()

cleanup() {
  for name in "${started[@]}"; do docker rm -f "$name" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

fail() {
  echo "check-web-image: $1" >&2
  if [ -n "${2:-}" ]; then docker logs "$2" 2>&1 | tail -20 >&2 || true; fi
  exit 1
}

# start <name> <docker run options...>: starts a container and waits until it answers on /.
start() {
  local name="$prefix-$1" port=$2
  shift 2
  started+=("$name")
  docker run -d --name "$name" "$@" "$image" >/dev/null
  for _ in $(seq 1 40); do
    if docker exec "$name" wget -Y off -q -O /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then return 0; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || fail "$name stopped" "$name"
    sleep 0.25
  done
  fail "$name does not answer on port $port" "$name"
}

# headers <name> <url>: the status line and the headers of a GET, from inside the container.
headers() {
  docker exec "$1" wget -Y off -S -q -O /dev/null "$2" 2>&1 || true
}

expect_status() {
  local name="$prefix-$1" url=$2 status=$3 out
  out=$(headers "$name" "$url")
  grep -q "HTTP/1.1 $status " <<<"$out" || fail "$url: expected $status, got: $(head -1 <<<"$out")" "$name"
}

# 1. Restricted, default port.
start restricted 80 "${restricted[@]}" "${no_api[@]}"
name="$prefix-restricted"
out=$(headers "$name" http://127.0.0.1/)
grep -q 'HTTP/1.1 200 ' <<<"$out" || fail "GET /: $(head -1 <<<"$out")" "$name"
for header in \
  "Content-Security-Policy: default-src 'self'" \
  'X-Content-Type-Options: nosniff' \
  'Referrer-Policy: strict-origin-when-cross-origin' \
  'Permissions-Policy: camera=(), microphone=(), geolocation=()' \
  'X-Frame-Options: SAMEORIGIN' \
  'Cache-Control: no-cache, must-revalidate'; do
  grep -qiF "$header" <<<"$out" || fail "GET /: header missing: $header" "$name"
done
if grep -qiE '^ *Server: nginx/' <<<"$out"; then fail 'GET /: the nginx version is shown' "$name"; fi
expect_status restricted http://127.0.0.1/oauth/authorize 200
grep -qiF 'X-Frame-Options: DENY' <<<"$(headers "$name" http://127.0.0.1/oauth/authorize)" || fail '/oauth/authorize: X-Frame-Options is not DENY' "$name"
expect_status restricted http://127.0.0.1/assets/missing-chunk.js 404
expect_status restricted http://127.0.0.1/api/health 502
uid=$(docker exec "$name" awk '/^Uid:/ { print $2 }' /proc/1/status)
[ "$uid" = 12345 ] || fail "nginx runs as uid $uid, not 12345" "$name"
if docker logs "$name" 2>&1 | grep -E '\[(emerg|alert|crit)\]|"user" directive'; then fail 'unexpected lines in the log' "$name"; fi
echo "Restricted start: GET / 200 with the security headers, /api/health 502 (no API), nginx as uid 12345."

# 2. Another port.
start port 8080 "${restricted[@]}" "${no_api[@]}" -e KANAP_WEB_PORT=8080
expect_status port http://127.0.0.1:8080/ 200
if docker exec "$prefix-port" wget -Y off -q -O /dev/null http://127.0.0.1:80/ 2>/dev/null; then fail 'port 80 still answers with KANAP_WEB_PORT=8080' "$prefix-port"; fi
echo 'KANAP_WEB_PORT=8080: answers on 8080 only.'

# 3. Started as root with the capabilities of the compose files: the workers run as nginx.
start root 80 --network none --user 0 --read-only --tmpfs /tmp --cap-drop ALL \
  --cap-add CHOWN --cap-add SETGID --cap-add SETUID --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges "${no_api[@]}"
workers=$(docker exec "$prefix-root" ps -o user,args | grep -c '^nginx .*nginx: worker process' || true)
[ "$workers" -gt 0 ] || fail 'as root: no worker runs as nginx' "$prefix-root"
if docker logs "$prefix-root" 2>&1 | grep -E '\[(emerg|alert|crit)\]|"user" directive'; then fail 'as root: unexpected lines in the log' "$prefix-root"; fi
echo "Started as root: $workers workers run as nginx."

# 4. Invalid values: the container stops at once with a line that names the variable.
for setting in KANAP_WEB_PORT=http KANAP_WEB_PORT=70000 'KANAP_API_UPSTREAM=api:8080;' 'KANAP_API_UPSTREAM=api 8080'; do
  variable=${setting%%=*}
  name="$prefix-invalid"
  started+=("$name")
  docker run -d --name "$name" "${restricted[@]}" -e "$setting" "$image" >/dev/null
  code=$(timeout 20 docker wait "$name") || fail "$setting: the container did not stop" "$name"
  [ "$code" != 0 ] || fail "$setting: the container exited with 0" "$name"
  docker logs "$name" 2>&1 | grep -q "$variable" || fail "$setting: the log does not name $variable" "$name"
  docker rm -f "$name" >/dev/null
done
echo 'Invalid values: the container refuses to start and names the variable.'

docker image ls "$image"
