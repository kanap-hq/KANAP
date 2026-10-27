#!/usr/bin/env bash
# Refuses to publish over an image tag that already exists: a published tag is immutable, and a
# rerun of the image workflow never rewrites it. Exits 0 when none of the references exists yet,
# 1 when one does or when the registry answers anything else than "not found".
#
#   check-image-tag-free.sh <name:tag>...    for example ghcr.io/kanap-hq/kanap-api:26.11.1
#
# Called by release-images.yml after the registry login, before anything is built.
set -euo pipefail

[ "$#" -gt 0 ] || { echo "usage: check-image-tag-free.sh <name:tag>..." >&2; exit 2; }

status=0
for ref in "$@"; do
  if out=$(docker buildx imagetools inspect "$ref" 2>&1); then
    echo "::error::$ref is already published. A published tag is never rewritten, so there is nothing to do for it. A version whose images are incomplete is replaced by a new version."
    status=1
  elif printf '%s\n' "$out" | grep -qiE 'not found|manifest unknown|name unknown'; then
    echo "free  $ref"
  # A package this token cannot read (403) is one it cannot write either: the push that
  # follows fails rather than overwrite it. GHCR may also answer 403 for a package that does not
  # exist yet.
  elif printf '%s\n' "$out" | grep -qiE '403 forbidden|denied'; then
    echo "not readable with this token, the push decides  $ref"
  else
    echo "::error::$ref cannot be checked: $out"
    status=1
  fi
done
exit "$status"
