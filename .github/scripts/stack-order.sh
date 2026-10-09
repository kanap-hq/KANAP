#!/usr/bin/env bash
# Refuses, in the merge queue, a pull request that contains the commits of another pull request
# still open on main and not ahead of it in the queue. A stacked PR queued before the PR below
# it would squash several lots under one title and leave the PR below it empty.
#
#   stack-order.sh merge-group <head_ref> <base_sha>   queue run: fails on a stacking problem
#   stack-order.sh pull-request <number> <base_sha>    pull request run: warns, always passes
#
# <head_ref> is the queue branch, refs/heads/gh-readonly-queue/main/pr-<n>-<sha>: each queued
# PR gets its own branch and its own run, so the script checks PR <n> only.
#
# Rule: an open PR X (draft or not) blocks the tested PR N when the head of X is an ancestor of
# the head of N, X adds commits that main (<base_sha>) does not have yet, and X is not ahead of
# N in the queue (a lower queue position; PRs in the same group are ordered the same way). A
# merged or closed PR is no longer listed, so a stack whose lower PRs merged passes.
#
# Inputs come from GitHub (GraphQL through `gh`, GH_TOKEN and GITHUB_REPOSITORY, then a fetch of
# each open PR head). For local tests, two files replace them:
#   STACK_ORDER_PRS       one open PR per line: <number> <head> <queue position, or - if not queued>
#   STACK_ORDER_ANCESTRY  one pair per line: <ancestor> <descendant> (list every pair, the file
#                         is not closed transitively; a head is always its own ancestor)
# Errors (API, fetch, unknown head) fail the queue run and only warn on a pull request run.
set -euo pipefail

MODE=${1:-}
FAIL=1 # exit status for a problem: 1 in the queue, 0 on a pull request (warning only)

# Prints an error (queue) or a warning (pull request) annotation.
report() {
  if [ "$MODE" = merge-group ]; then echo "::error::$1"; else echo "::warning::$1"; fi
}

# Stops on a problem the script cannot work around.
give_up() {
  report "Stack order check could not run: $1"
  exit "$FAIL"
}

# Is $1 an ancestor of $2? Status 0 yes, 1 no, anything else: git could not tell.
is_ancestor() {
  if [ -n "${STACK_ORDER_ANCESTRY:-}" ]; then
    [ "$1" = "$2" ] && return 0
    grep -qxF "$1 $2" "$STACK_ORDER_ANCESTRY"
  else
    git merge-base --is-ancestor "$1" "$2"
  fi
}

# Prints the open PRs on main, one per line: <number> <head> <queue position or ->.
list_open_prs() {
  if [ -n "${STACK_ORDER_PRS:-}" ]; then
    cat "$STACK_ORDER_PRS"
    return
  fi
  local repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}
  # shellcheck disable=SC2016 # $owner, $name and $endCursor are GraphQL variables.
  gh api graphql --paginate -f owner="${repo%%/*}" -f name="${repo#*/}" -f query='
    query($owner: String!, $name: String!, $endCursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(states: OPEN, baseRefName: "main", first: 100, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes { number headRefOid mergeQueueEntry { position } }
        }
      }
    }' --jq '.data.repository.pullRequests.nodes[]
             | "\(.number) \(.headRefOid) \(.mergeQueueEntry.position // "-")"'
}

# Fetches the head of every listed PR (fork heads included), so git can compare them.
fetch_heads() {
  [ -n "${STACK_ORDER_PRS:-}" ] && return 0
  local refspecs=() number head position
  while read -r number head position; do
    [ -z "$number" ] && continue
    refspecs+=("+refs/pull/$number/head:refs/remotes/pull/$number")
  done <<<"$1"
  [ "${#refspecs[@]}" -eq 0 ] && return 0
  git fetch --no-tags --quiet origin "${refspecs[@]}"
}

case "$MODE" in
  merge-group)
    [ "$#" -eq 3 ] || { echo "usage: $0 merge-group <head_ref> <base_sha>" >&2; exit 2; }
    if [[ "$2" =~ /pr-([0-9]+)-[0-9a-f]+$ ]]; then
      PR=${BASH_REMATCH[1]}
    else
      give_up "no pull request number in the queue branch '$2'."
    fi
    ;;
  pull-request)
    [ "$#" -eq 3 ] || { echo "usage: $0 pull-request <number> <base_sha>" >&2; exit 2; }
    FAIL=0
    PR=$2
    ;;
  *)
    echo "usage: $0 merge-group <head_ref> <base_sha> | pull-request <number> <base_sha>" >&2
    exit 2
    ;;
esac
BASE=$3

prs=$(list_open_prs) || give_up "could not list the open pull requests."
fetch_heads "$prs" || give_up "could not fetch the heads of the open pull requests."

own_head='' own_position=''
while read -r number head position; do
  if [ "$number" = "$PR" ]; then own_head=$head; own_position=$position; fi
done <<<"$prs"
[ -n "$own_head" ] || give_up "#$PR is not among the open pull requests on main."
echo "Checking #$PR (head $own_head, queue position $own_position) against the open pull requests on main."

blocked=0
while read -r number head position; do
  [ -z "$number" ] || [ "$number" = "$PR" ] && continue
  status=0; is_ancestor "$head" "$own_head" || status=$?
  [ "$status" -gt 1 ] && give_up "git could not compare #$number with #$PR."
  [ "$status" -eq 1 ] && continue # #number is not below #PR in a stack
  status=0; is_ancestor "$head" "$BASE" || status=$?
  [ "$status" -gt 1 ] && give_up "git could not compare #$number with main."
  if [ "$status" -eq 0 ]; then
    echo "#$number: its commits are already on main."
    continue
  fi
  if [ "$position" != - ] && { [ "$own_position" = - ] || [ "$position" -lt "$own_position" ]; }; then
    echo "#$number: below #$PR in the stack and ahead of it in the queue (position $position)."
    continue
  fi
  report "#$PR contains the commits of #$number, which is still open: merge #$number first."
  blocked=1
done <<<"$prs"

if [ "$blocked" -eq 1 ]; then
  [ "$MODE" = pull-request ] && echo "The merge queue will refuse #$PR until these pull requests are merged."
  exit "$FAIL"
fi
echo "Stack order is fine: no open pull request below #$PR waits behind it."
