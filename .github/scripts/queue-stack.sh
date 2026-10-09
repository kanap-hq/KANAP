#!/usr/bin/env bash
# Adds pull requests to the merge queue in the order given, one at a time, so a stack enters the
# queue from the bottom up and merges in that order. Works for a single pull request too.
#
#   queue-stack.sh [--dry-run] <pr> [<pr>...]
#
# For each pull request, in order:
#   1. checks that it is open, targets main and is not a draft; skips it when it is already in
#      the queue or merged (so a rerun after a failure only queues what left the queue);
#   2. waits until its required checks are reported and none failed (on a pull request they are
#      skipped jobs, reported within seconds of the last push);
#   3. runs `gh pr merge <pr> --auto --squash`;
#   4. waits until it shows in the merge queue, then moves to the next one. This wait is what
#      keeps the order: the next pull request is queued only behind this one.
# Stops with a non-zero status at the first problem. --dry-run runs steps 1 and 2 and prints the
# command of step 3 without running it: it only reads.
#
# Environment: QUEUE_STACK_TIMEOUT (seconds allowed for each wait, default 600),
# QUEUE_STACK_POLL (seconds between two reads, default 10), GH_REPO (default: the repository of
# the current directory). Local tests put a fake `gh` first on PATH.
set -euo pipefail

TIMEOUT=${QUEUE_STACK_TIMEOUT:-600}
POLL=${QUEUE_STACK_POLL:-10}
DRY_RUN=0

usage() {
  echo "usage: $0 [--dry-run] <pr> [<pr>...]" >&2
  exit 2
}

fail() {
  echo "Error: $1" >&2
  exit 1
}

# Prints the state of a pull request: <state> <isDraft> <baseRefName> <queue position or ->.
pr_state() {
  local out
  # shellcheck disable=SC2016 # $owner, $name and $n are GraphQL variables.
  out=$(gh api graphql -F owner='{owner}' -F name='{repo}' -F n="$1" -f query='
    query($owner: String!, $name: String!, $n: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $n) { state isDraft baseRefName mergeQueueEntry { position } }
      }
    }') || return 1
  jq -r '.data.repository.pullRequest
         | "\(.state) \(.isDraft) \(.baseRefName) \(.mergeQueueEntry.position // "-")"' <<<"$out"
}

# Waits until the required checks of a pull request are reported and none is pending.
# Fails at once when one failed or was cancelled.
wait_for_checks() {
  local pr=$1 deadline=$((SECONDS + TIMEOUT)) out summary
  while :; do
    # gh exits non-zero while checks are pending or none is reported yet: read its output.
    out=$(gh pr checks "$pr" --required --json name,bucket 2>&1) || true
    if summary=$(jq -er 'if type == "array" and length > 0
                         then map("\(.name)=\(.bucket)") | join(", ") else empty end' <<<"$out" 2>/dev/null); then
      if jq -e 'any(.[]; .bucket == "fail" or .bucket == "cancel")' <<<"$out" >/dev/null; then
        fail "#$pr: a required check did not pass ($summary). Fix it, push, and rerun."
      fi
      if ! jq -e 'any(.[]; .bucket == "pending")' <<<"$out" >/dev/null; then
        echo "  required checks reported: $summary"
        return 0
      fi
    else
      summary="none reported yet"
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      fail "#$pr: required checks still not reported after ${TIMEOUT}s ($summary)."
    fi
    sleep "$POLL"
  done
}

# Waits until a pull request shows in the merge queue (or has already merged).
wait_for_queue_entry() {
  local pr=$1 deadline=$((SECONDS + TIMEOUT)) state draft base position
  while :; do
    read -r state draft base position < <(pr_state "$pr") || fail "#$pr: could not read its state."
    if [ "$state" = MERGED ]; then
      echo "  #$pr has already merged."
      return 0
    fi
    if [ "$position" != - ]; then
      echo "  #$pr is in the merge queue (position $position)."
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      fail "#$pr did not enter the merge queue within ${TIMEOUT}s. Auto-merge stays on and could \
queue it later, out of order: check the pull request, or turn auto-merge off with \
'gh pr merge $pr --disable-auto' before going on."
    fi
    sleep "$POLL"
  done
}

[ "${1:-}" = --dry-run ] && { DRY_RUN=1; shift; }
[ "$#" -ge 1 ] || usage
for pr in "$@"; do
  [[ "$pr" =~ ^[0-9]+$ ]] || usage
done

[ "$DRY_RUN" -eq 1 ] && echo "Dry run: nothing is queued."
echo "Queue order: $(printf '#%s ' "$@")"
for pr in "$@"; do
  echo "#$pr"
  read -r state draft base position < <(pr_state "$pr") || fail "#$pr: could not read its state."
  if [ "$state" = MERGED ]; then
    echo "  already merged."
    continue
  fi
  [ "$state" = OPEN ] || fail "#$pr is $state, not open."
  [ "$base" = main ] || fail "#$pr targets '$base': retarget it to main first."
  [ "$draft" = false ] || fail "#$pr is a draft: mark it ready ('gh pr ready $pr') and rerun."
  if [ "$position" != - ]; then
    echo "  already in the merge queue (position $position)."
    continue
  fi
  wait_for_checks "$pr"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  would run: gh pr merge $pr --auto --squash"
    continue
  fi
  gh pr merge "$pr" --auto --squash
  wait_for_queue_entry "$pr"
done
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run done: every pull request is ready to queue."
else
  echo "Done: every pull request is in the merge queue, in the order given."
fi
