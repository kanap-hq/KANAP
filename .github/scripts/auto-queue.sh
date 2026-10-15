#!/usr/bin/env bash
# Puts the ready pull requests opened by the maintainer's account into the merge queue, in the
# order they were opened. Opening a ready pull request is the maintainer's go: the agent opens
# it after the maintainer has validated the change on dev, and does nothing else. A draft is not
# queued. Run by .github/workflows/auto-queue.yml on every pull request event, so a missed event
# costs nothing: each run looks at every open pull request.
#
#   auto-queue.sh
#
# A pull request of the queue that is turned back into a draft is taken out of the queue: a draft
# is the way to stop one.
#
# Handled: pull requests on main that are ready (not drafts), come from this repository and were
# opened by one of AUTO_QUEUE_AUTHORS. They enter the queue one at a time, lowest number first:
# each run queues at most one, and the next run starts when GitHub reports it in the queue (the
# `enqueued` event), so the queue keeps the order in which they were opened. A run skips:
#   - a pull request already in the queue;
#   - one whose current commit failed in the queue (its failed `merge queue` check, from
#     queue-failure.yml): it waits for the fix, whose push starts a new run;
#   - one that conflicts with main: it waits for the fix as well;
#   - one that contains the commits of another open pull request not yet in the queue (a
#     stack): it waits for the one below it.
# A pull request whose queueing is under way (auto-merge on, not yet in the queue) holds the
# others back until it is in. GitHub can miss that entry (its mergeability was being recomputed
# when auto-merge was turned on): after AUTO_QUEUE_RETRY_AFTER seconds (default 120) a run turns
# auto-merge off and on again, which queues it.
#
# Nothing from the pull requests is run: their commits are fetched and compared as data.
#
# Environment: GH_TOKEN (a token that may queue pull requests: the kanap-queue app), READ_TOKEN
# (reads the pull requests and their checks; GH_TOKEN when unset),
# GITHUB_REPOSITORY, AUTO_QUEUE_AUTHORS (logins separated by spaces), AUTO_QUEUE_DRY_RUN=true
# (prints what it would queue). The clone in the current directory has `origin` on GitHub.
set -euo pipefail

REPO=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}
AUTHORS=" ${AUTO_QUEUE_AUTHORS:?AUTO_QUEUE_AUTHORS is not set} "
DRY_RUN=${AUTO_QUEUE_DRY_RUN:-false}
READ_TOKEN=${READ_TOKEN:-${GH_TOKEN:-}}
RETRY_AFTER=${AUTO_QUEUE_RETRY_AFTER:-120}

# Open pull requests on main, lowest number first, one per line:
# <number> <head sha> <draft> <fork> <author> <in queue> <auto-merge since, or -> <mergeable>.
# shellcheck disable=SC2016 # GraphQL variables
open=$(GH_TOKEN=$READ_TOKEN gh api graphql --paginate -f owner="${REPO%%/*}" -f name="${REPO#*/}" -f query='
  query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, baseRefName: "main", first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { number headRefOid isDraft isCrossRepository author { login }
                mergeQueueEntry { position } autoMergeRequest { enabledAt } mergeable }
      }
    }
  }' --jq '.data.repository.pullRequests.nodes[]
    | "\(.number) \(.headRefOid) \(.isDraft) \(.isCrossRepository) \(.author.login // "-") \(.mergeQueueEntry != null) \(.autoMergeRequest.enabledAt // "-") \(.mergeable)"' | sort -n)

if [ -z "$open" ]; then
  echo "No open pull request on main."
  exit 0
fi

refspecs=("+refs/heads/main:refs/remotes/origin/main")
while read -r n _; do refspecs+=("+refs/pull/$n/head:refs/remotes/pull/$n"); done <<<"$open"
git fetch --no-tags --quiet origin "${refspecs[@]}"

declare -A HEAD QUEUED
while read -r n head _ _ _ queued _ _; do
  HEAD[$n]=$head
  QUEUED[$n]=$queued
done <<<"$open"

# Did this commit fail in the merge queue (queue-failure.yml marks it)?
failed_in_queue() {
  local count
  count=$(GH_TOKEN=$READ_TOKEN gh api "repos/$REPO/commits/$1/check-runs?check_name=merge%20queue" \
    --jq '[.check_runs[] | select(.conclusion == "failure")] | length' 2>/dev/null) || count=0
  [ "${count:-0}" -gt 0 ]
}

while read -r n head draft fork author queued automerge_since mergeable; do
  if [ "$draft" = true ] && [ "$queued" = true ]; then
    echo "#$n: a draft in the merge queue: taken out of it."
    if [ "$DRY_RUN" != true ]; then
      id=$(GH_TOKEN=$READ_TOKEN gh api "repos/$REPO/pulls/$n" --jq .node_id)
      # shellcheck disable=SC2016 # GraphQL variable
      gh api graphql -f id="$id" -f query='mutation($id: ID!) { dequeuePullRequest(input: {id: $id}) { clientMutationId } }' >/dev/null \
        || echo "::warning::#$n could not be taken out of the merge queue."
    fi
    continue
  fi
  if [ "$draft" = true ] || [ "$fork" = true ] || [[ "$AUTHORS" != *" $author "* ]]; then
    echo "#$n: left alone (draft, fork, or opened by $author)."
    continue
  fi
  if [ "$queued" = true ]; then
    echo "#$n: in the merge queue."
    continue
  fi
  # Queueing requested a moment ago: it holds the others back, even while GitHub shows it as
  # conflicting (it recomputes the mergeability of every pull request after each merge).
  age=$RETRY_AFTER
  if [ "$automerge_since" != - ]; then
    since=$(date -d "$automerge_since" +%s 2>/dev/null || echo 0)
    age=$(( $(date +%s) - since ))
  fi
  if [ "$age" -lt "$RETRY_AFTER" ]; then
    echo "#$n: entering the merge queue; the others wait until it is in."
    exit 0
  fi
  if [ "$mergeable" = CONFLICTING ]; then
    echo "#$n: conflicts with main; it waits for a fix."
    continue
  fi
  if failed_in_queue "$head"; then
    echo "#$n: its current commit failed in the merge queue; it waits for a fix."
    continue
  fi
  below=''
  for q in "${!HEAD[@]}"; do
    [ "$q" = "$n" ] && continue
    [ "${QUEUED[$q]}" = true ] && continue
    git merge-base --is-ancestor "${HEAD[$q]}" refs/remotes/origin/main && continue
    if git merge-base --is-ancestor "${HEAD[$q]}" "$head"; then below=$q; break; fi
  done
  if [ -n "$below" ]; then
    echo "#$n: waits until #$below, below it in a stack, is in the merge queue."
    continue
  fi
  if [ "$automerge_since" != - ]; then
    echo "#$n: auto-merge on since $automerge_since and still not in the queue: turning it off and on."
    if [ "$DRY_RUN" != true ]; then
      gh pr merge "$n" --repo "$REPO" --disable-auto || true
    fi
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "#$n: would be queued; the others wait until it is in."
  elif gh pr merge "$n" --repo "$REPO" --auto --squash; then
    echo "#$n: queued; the others wait until it is in."
  else
    echo "::warning::#$n could not be queued; the next pull request event tries again."
  fi
  exit 0
done <<<"$open"
echo "Nothing to queue."
