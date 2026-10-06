#!/usr/bin/env bash
# Decides which CI jobs a change can affect, prints why, and writes the decision to
# $GITHUB_OUTPUT (backend, frontend, onprem = 'true' or 'false') when it is set.
#
#   ci-changes.sh all            every job runs (push on main)
#   ci-changes.sh <base> <head>  jobs for the files changed on <head> since its merge base with <base>
#   ci-changes.sh --stdin        jobs for the file list read on stdin (local tests)
#
# Rules: backend/** -> backend; frontend/** -> frontend; .github/workflows/** and
# .github/scripts/** -> both; onprem = backend or frontend. Everything else (doc/, marketing/,
# infra/, .agents/, root files) runs none of the three jobs: no job reads it.
set -euo pipefail

emit() {
  echo "Decision: backend=$1 frontend=$2 onprem=$3"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    { echo "backend=$1"; echo "frontend=$2"; echo "onprem=$3"; } >>"$GITHUB_OUTPUT"
  fi
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
  local backend=() frontend=() shared=() other=() f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      backend/*) backend+=("$f") ;;
      frontend/*) frontend+=("$f") ;;
      __test_never__) shared+=("$f") ;;
      *) other+=("$f") ;;
    esac
  done

  show "Backend files" ${backend[@]+"${backend[@]}"}
  show "Frontend files" ${frontend[@]+"${frontend[@]}"}
  show "CI files (run every job)" ${shared[@]+"${shared[@]}"}
  show "Files no job reads" ${other[@]+"${other[@]}"}

  local b=false fe=false o=false
  if [ "${#backend[@]}" -gt 0 ] || [ "${#shared[@]}" -gt 0 ]; then b=true; fi
  if [ "${#frontend[@]}" -gt 0 ] || [ "${#shared[@]}" -gt 0 ]; then fe=true; fi
  if [ "$b" = true ] || [ "$fe" = true ]; then o=true; fi
  emit "$b" "$fe" "$o"
}

case "${1:-}" in
  all)
    echo "Not a pull request: every job runs."
    emit true true true
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
      emit true true true
      exit 0
    fi
    classify <<<"$files"
    ;;
esac
