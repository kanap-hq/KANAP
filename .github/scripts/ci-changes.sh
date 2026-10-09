#!/usr/bin/env bash
# Decides which CI jobs a change can affect, prints why, and writes the decision to
# $GITHUB_OUTPUT (backend, frontend, onprem, images = 'true' or 'false') when it is set.
#
#   ci-changes.sh all            every job runs (push on main, merge queue)
#   ci-changes.sh <base> <head>  jobs for the files changed on <head> since its merge base with <base>
#   ci-changes.sh --stdin        jobs for the file list read on stdin (local tests)
#
# Rules: backend/** -> backend; frontend/** -> frontend; .github/workflows/** and
# .github/scripts/** -> both; onprem = backend or frontend, or the marketing lockfile (the onprem
# job checks the integrity hashes of every lockfile). images = a Dockerfile or .dockerignore,
# infra/**, frontend/nginx/**, marketing/web/nginx.conf, a package.json or a lockfile, the API
# tsconfig files, start-up script and script helpers, or a CI file (the images job builds the
# images and checks the compose files). Everything else (doc/, the rest of marketing/, .agents/, root
# files) runs no job: no job reads it.
set -euo pipefail

emit() {
  echo "Decision: backend=$1 frontend=$2 onprem=$3 images=$4"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    { echo "backend=$1"; echo "frontend=$2"; echo "onprem=$3"; echo "images=$4"; } >>"$GITHUB_OUTPUT"
  fi
}

# Files the images job reads: what goes into an image or a compose file.
is_image_file() {
  case "$1" in
    Dockerfile | Dockerfile.* | */Dockerfile | */Dockerfile.* | .dockerignore | */.dockerignore) return 0 ;;
    infra/* | frontend/nginx/*) return 0 ;;
    backend/package-lock.json | frontend/package-lock.json | marketing/web/package-lock.json) return 0 ;;
    backend/package.json | frontend/package.json | marketing/web/package.json) return 0 ;;
    backend/tsconfig*.json | backend/scripts/migrate-and-start.js | backend/scripts/lib/*) return 0 ;;
    marketing/web/nginx.conf) return 0 ;;
    *) return 1 ;;
  esac
}

# Prints a group of matched files, capped so a huge PR keeps a readable log.
show() {
  local label=$1; shift
  local count=$#
  [ "$count" -eq 0 ] && return 0
  echo "$label ($count):"
  local shown=0 f
  for f in "$@"; do
    if [ "$shown" -ge 30 ]; then
      echo "  ... and $((count - shown)) more"
      break
    fi
    echo "  $f"
    shown=$((shown + 1))
  done
}

classify() {
  local backend=() frontend=() shared=() lockfiles=() images=() other=() f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if is_image_file "$f"; then images+=("$f"); fi
    case "$f" in
      backend/*) backend+=("$f") ;;
      frontend/*) frontend+=("$f") ;;
      .github/workflows/* | .github/scripts/*) shared+=("$f") ;;
      marketing/web/package-lock.json) lockfiles+=("$f") ;;
      *) is_image_file "$f" || other+=("$f") ;;
    esac
  done

  show "Backend files" ${backend[@]+"${backend[@]}"}
  show "Frontend files" ${frontend[@]+"${frontend[@]}"}
  show "CI files (run every job)" ${shared[@]+"${shared[@]}"}
  show "Other lockfiles (run onprem)" ${lockfiles[@]+"${lockfiles[@]}"}
  show "Image and compose files (run images)" ${images[@]+"${images[@]}"}
  show "Files no job reads" ${other[@]+"${other[@]}"}

  local b=false fe=false o=false im=false
  if [ "${#backend[@]}" -gt 0 ] || [ "${#shared[@]}" -gt 0 ]; then b=true; fi
  if [ "${#frontend[@]}" -gt 0 ] || [ "${#shared[@]}" -gt 0 ]; then fe=true; fi
  if [ "$b" = true ] || [ "$fe" = true ] || [ "${#lockfiles[@]}" -gt 0 ]; then o=true; fi
  if [ "${#images[@]}" -gt 0 ] || [ "${#shared[@]}" -gt 0 ]; then im=true; fi
  emit "$b" "$fe" "$o" "$im"
}

case "${1:-}" in
  all)
    echo "Not a pull request: every job runs."
    emit true true true true
    ;;
  --stdin)
    classify
    ;;
  *)
    if [ "$#" -ne 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
      echo "usage: $0 all | <base> <head> | --stdin" >&2
      exit 2
    fi
    echo "Files changed on $2 since its merge base with $1:"
    # --no-renames lists a moved file under both paths, so a move out of backend/ or
    # frontend/ still counts for that side.
    if ! files=$(git diff --name-only --no-renames "$1...$2"); then
      echo "::warning::Could not list the changed files: every job runs."
      emit true true true true
      exit 0
    fi
    classify <<<"$files"
    ;;
esac
