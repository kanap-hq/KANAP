#!/usr/bin/env bash
# Checks the base images of every Dockerfile and the images of the compose files in infra/:
# each one is written name:tag@sha256:<digest>, and the digest is that of a multi-architecture
# index (the manifest of a single architecture would not run on the others).
#
#   check-image-pins.sh            the form, then each digest against its registry
#   check-image-pins.sh --offline  the form only
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

offline=false
[ "${1:-}" = --offline ] && offline=true

refs=()
while IFS= read -r file; do
  # Stage names (FROM ... AS <name>) are references to earlier stages, not images.
  stages=$(sed -nE 's/^[[:space:]]*FROM[[:space:]].*[[:space:]][Aa][Ss][[:space:]]+([^[:space:]]+).*/\1/p' "$file")
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    if printf '%s\n' "$stages" | grep -qxF "$ref"; then continue; fi
    refs+=("$file $ref")
  done < <(sed -nE 's/^[[:space:]]*FROM[[:space:]]+(--[^[:space:]]+[[:space:]]+)*([^[:space:]]+).*/\2/p' "$file")
done < <(git ls-files '*Dockerfile*')
while IFS= read -r file; do
  while IFS= read -r ref; do
    refs+=("$file $ref")
  done < <(sed -nE 's/^[[:space:]]*image:[[:space:]]*["'\'']?([^"'\''[:space:]]+).*/\1/p' "$file")
done < <(git ls-files 'infra/*.yml')

status=0
for entry in "${refs[@]}"; do
  file=${entry%% *}
  ref=${entry#* }
  if ! [[ "$ref" =~ ^[^@[:space:]]+:[^@[:space:]]+@sha256:[0-9a-f]{64}$ ]]; then
    echo "::error file=$file::$ref is not pinned as name:tag@sha256:<digest>"
    status=1
    continue
  fi
  if [ "$offline" = true ]; then
    echo "ok (form)  $file  $ref"
    continue
  fi
  media=$(docker buildx imagetools inspect --raw "$ref" | jq -r '.mediaType // empty')
  case "$media" in
    application/vnd.oci.image.index.v1+json | application/vnd.docker.distribution.manifest.list.v2+json)
      echo "ok (index) $file  $ref" ;;
    *)
      echo "::error file=$file::$ref is not a multi-architecture index (media type: ${media:-none})"
      status=1 ;;
  esac
done
[ "${#refs[@]}" -gt 0 ] || { echo "::error::no image reference found"; exit 1; }
exit "$status"
