#!/usr/bin/env bash
# Checks an API image built from the runtime stage of backend/Dockerfile: the document
# converters answer, the sources and the development tools are absent, and the compiled scripts
# the API runs and the pages of the user manual are present. The development tools are looked
# for at any depth of node_modules: the find lists each one it meets and the check fails when
# it lists anything.
#
#   check-api-image.sh <image>    for example kanap-api:ci
#
# Called by the `images` job of ci.yml and the `publish` job of release-images.yml.
set -euo pipefail

image=${1:?usage: check-api-image.sh <image>}

docker run --rm "$image" sh -c 'node -v && inkscape --version && pandoc --version | head -1 && typst --version && test ! -e src && test -f dist/knowledge/scripts/backfill-integrated-docs.js'
# The user manual's pages (stage help-docs), Markdown only, in the four languages.
docker run --rm "$image" sh -c 'for lang in en fr de es; do test -f help-docs/$lang/contracts.md || exit 1; done; others=$(find help-docs -type f ! -name "*.md"); test -z "$others" || { echo "$others"; exit 1; }'
docker run --rm "$image" sh -c 'tools=$(find ./node_modules -path "*/node_modules/ts-node-dev" -o -path "*/node_modules/ts-node" -o -path "*/node_modules/typescript") || exit 1; echo "${tools:-No ts-node-dev, ts-node or typescript in node_modules.}"; test -z "$tools"'
docker image ls "$image"
