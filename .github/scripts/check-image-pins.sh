#!/usr/bin/env bash
# Checks the base images of every Dockerfile and the images of the compose files in infra/:
# each one is written name:tag@sha256:<digest>, and the digest is that of a multi-architecture
# index (the manifest of a single architecture would not run on the others).
# KANAP's own images (ghcr.io/kanap-hq/kanap-*) are tagged by version, and the release workflow
# publishes them: they are exempt from the digest, and only their form is checked (one of the
# four names, tag ${KANAP_VERSION:-YY.M.N}, or the marketing form with KANAP_MARKETING_VERSION).
# The names a build overlay gives to images built on the spot (kanap-api:local, kanap-web:local,
# kanap-api-tools:local) are exempt too: nothing pulls them.
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

version='[0-9]{2}\.[0-9]{1,2}\.[0-9]+'
own_image='^ghcr\.io/kanap-hq/kanap-(api|api-tools|web|marketing):'
own_tag='\$\{KANAP_VERSION:-'"$version"'\}'
own_marketing_tag='\$\{KANAP_MARKETING_VERSION:-\$\{KANAP_VERSION:-'"$version"'\}\}'

status=0
for entry in "${refs[@]}"; do
  file=${entry%% *}
  ref=${entry#* }
  if [[ "$ref" =~ ^kanap-(api|api-tools|web):local$ ]]; then
    echo "ok (local) $file  $ref"
    continue
  fi
  if [[ "$ref" == ghcr.io/kanap-hq/kanap-* ]]; then
    if [[ "$ref" =~ ${own_image}${own_tag}$ ]] || [[ "$ref" =~ ^ghcr\.io/kanap-hq/kanap-marketing:${own_marketing_tag}$ ]]; then
      echo "ok (own)   $file  $ref"
    else
      echo "::error file=$file::$ref is not one of the forms of KANAP's own images: kanap-api, kanap-api-tools or kanap-web:\${KANAP_VERSION:-YY.M.N}, kanap-marketing:\${KANAP_VERSION:-YY.M.N} or \${KANAP_MARKETING_VERSION:-\${KANAP_VERSION:-YY.M.N}}"
      status=1
    fi
    continue
  fi
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
