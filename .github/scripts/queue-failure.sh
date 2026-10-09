#!/usr/bin/env bash
# Marks a pull request that failed in the merge queue, so its owner sees it. GitHub removes a
# failed pull request from the queue without a trace on the pull request itself: its own checks
# are the skipped CI jobs, reported as passed. Run by .github/workflows/queue-failure.yml.
#
#   queue-failure.sh <CI run id>
#
# Acts only on a CI run of the merge queue that failed or timed out. A cancelled run is left
# alone: when a pull request fails, GitHub cancels the runs of the pull requests behind it and
# builds them again. For a run that qualifies:
#   1. reads the pull request number from the queue branch, gh-readonly-queue/<base>/pr-<n>-<sha>;
#   2. creates a failed check run `merge queue` on the current head commit of the pull request;
#   3. posts one comment: the failed jobs, the run link, the failed backend specs when the job
#      log names them, and how to queue the pull request again.
# Exits 0 with a log line when the run does not qualify, or the pull request is no longer open.
#
# Branch names, job names and log lines come from the queued code: they are untrusted. Only
# validated or filtered values reach the check run, the comment and the log.
#
# Environment: GH_TOKEN, GITHUB_REPOSITORY (owner/name), GITHUB_SERVER_URL and GITHUB_API_URL
# (GitHub defaults otherwise). QUEUE_FAILURE_DRY_RUN=true prints the check run and the comment
# instead of creating them; every GitHub read still happens. Local tests put a fake `gh` and a
# fake `curl` first on PATH.
set -euo pipefail

CHECK_NAME="merge queue"
REPO=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}
SERVER=${GITHUB_SERVER_URL:-https://github.com}
API=${GITHUB_API_URL:-https://api.github.com}
DRY_RUN=${QUEUE_FAILURE_DRY_RUN:-false}
RUN_ID=${1:-}

if ! [[ "$RUN_ID" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <CI run id>" >&2
  exit 2
fi

# Keeps letters, digits and a few punctuation marks, at most 100 characters: enough for a job
# name, and nothing that Markdown, a mention or a workflow command could act on.
plain() {
  printf '%s' "$1" | tr -cd 'A-Za-z0-9 ()/._-' | cut -c1-100
}

# Prints the backend specs that the runner lists under "Failed:" at the end of a job log (at
# most 10), or "type check" when the compile step failed before any spec ran. Prints nothing
# when the log cannot be read.
failed_specs() {
  local job_id=$1 log
  [ -n "${GH_TOKEN:-}" ] || return 0
  log=$(mktemp)
  # The logs endpoint answers with a redirect to a storage URL; curl does not send the token
  # to that other host.
  if ! curl -fsSL --max-time 60 --max-filesize 200000000 \
    -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    -o "$log" "$API/repos/$REPO/actions/jobs/$job_id/logs"; then
    rm -f "$log"
    return 0
  fi
  {
    sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //' "$log" |
      awk '/^tsc -p tsconfig\.ci\.json failed/ { print "type check"; next }
           /^Failed:\r?$/ { listing = 1; next }
           listing && /^  - / { sub(/\r$/, ""); print substr($0, 5); next }
           { listing = 0 }' |
      grep -E '^(type check|src/[A-Za-z0-9_./-]+\.spec\.ts)$' | head -n 10
  } || true
  rm -f "$log"
}

run=$(gh api "repos/$REPO/actions/runs/$RUN_ID")
event=$(jq -r '.event' <<<"$run")
conclusion=$(jq -r '.conclusion' <<<"$run")
workflow=$(jq -r '.path' <<<"$run")
attempt=$(jq -r '.run_attempt' <<<"$run")
branch=$(jq -r '.head_branch' <<<"$run")
run_url="$SERVER/$REPO/actions/runs/$RUN_ID"

if [ "$workflow" != .github/workflows/ci.yml ] || [ "$event" != merge_group ]; then
  echo "Run $RUN_ID is not a merge queue run of CI (workflow $(plain "$workflow"), event $(plain "$event")): nothing to do."
  exit 0
fi
if [ "$conclusion" != failure ] && [ "$conclusion" != timed_out ]; then
  echo "Run $RUN_ID ended with '$(plain "$conclusion")': nothing to do."
  exit 0
fi
[[ "$attempt" =~ ^[0-9]+$ ]] || attempt=1
if ! [[ "$branch" =~ ^gh-readonly-queue/.+/pr-([0-9]+)-[0-9a-f]{40}$ ]]; then
  echo "Run $RUN_ID: the branch '$(plain "$branch")' is not a merge queue branch: nothing to do."
  exit 0
fi
pr=${BASH_REMATCH[1]}

pull=$(gh api "repos/$REPO/pulls/$pr")
state=$(jq -r '.state' <<<"$pull")
head_sha=$(jq -r '.head.sha' <<<"$pull")
if [ "$state" != open ]; then
  echo "Run $RUN_ID: #$pr is $(plain "$state"): nothing to do."
  exit 0
fi
if ! [[ "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Run $RUN_ID: could not read the head commit of #$pr." >&2
  exit 1
fi

# Failed jobs of this attempt, one per line: <job id> <tab> <job name>.
jobs=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$attempt/jobs?per_page=100" \
  --jq '.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out") | "\(.id)\t\(.name)"')

job_names=""
job_lines=""
spec_lines=""
while IFS=$'\t' read -r job_id job_name; do
  [[ "$job_id" =~ ^[0-9]+$ ]] || continue
  name=$(plain "$job_name")
  [ -n "$name" ] || name="job $job_id"
  job_names+="${job_names:+, }$name"
  job_lines+="- [$name]($run_url/job/$job_id)"$'\n'
  if [ "$name" = "backend (cloud)" ]; then
    while IFS= read -r spec; do
      [ -n "$spec" ] || continue
      if [ "$spec" = "type check" ]; then
        spec_lines+="- The type check failed: no spec ran."$'\n'
      else
        spec_lines+="- Failed spec: \`$spec\`"$'\n'
      fi
    done < <(failed_specs "$job_id")
  fi
done <<<"$jobs"
[ -n "$job_names" ] || job_names="none listed, see the run"
[ -n "$job_lines" ] || job_lines="- None listed: see the run."$'\n'

marker="<!-- merge-queue-failure run=$RUN_ID attempt=$attempt -->"
title="Failed in the merge queue: $job_names"
summary="The merge queue run failed and removed #$pr from the queue.

Run: $run_url

Failed jobs:
$job_lines"
[ -z "$spec_lines" ] || summary+="
From the backend log:
$spec_lines"
summary+="
This check is not a required check. The next push to the pull request clears it."

body="$marker
**This pull request failed in the merge queue and left it.**

Run: $run_url

Failed jobs:
$job_lines"
[ -z "$spec_lines" ] || body+="
From the backend log:
$spec_lines"
body+="
Next steps: fix the failure on this branch, merge \`origin/main\` into it if needed, push, then add the pull request to the queue again:

\`\`\`
bash .github/scripts/queue-stack.sh $pr
\`\`\`

(or \`gh pr merge $pr --auto --squash\`). The failing \`$CHECK_NAME\` check is not a required check: the next push clears it."

check_json=$(jq -n --arg name "$CHECK_NAME" --arg sha "$head_sha" --arg url "$run_url" \
  --arg title "$title" --arg summary "$summary" \
  '{name: $name, head_sha: $sha, status: "completed", conclusion: "failure", details_url: $url,
    output: {title: $title, summary: $summary}}')
comment_json=$(jq -n --arg body "$body" '{body: $body}')

echo "Run $RUN_ID (attempt $attempt) failed in the merge queue: #$pr, head $head_sha, failed jobs: $job_names."
if [ "$DRY_RUN" = true ]; then
  echo "Dry run: nothing is created."
  echo "--- check run on $head_sha"
  echo "$check_json"
  echo "--- comment on #$pr"
  echo "$body"
  exit 0
fi

gh api -X POST "repos/$REPO/check-runs" --input - <<<"$check_json" >/dev/null
echo "Created the failed '$CHECK_NAME' check on $head_sha."

# One comment per run attempt, even when the workflow runs again for the same attempt.
comments=$(gh api --paginate "repos/$REPO/issues/$pr/comments?per_page=100" --jq '.[].body')
if grep -qF "$marker" <<<"$comments"; then
  echo "#$pr already has the comment for this run: not posted again."
else
  gh api -X POST "repos/$REPO/issues/$pr/comments" --input - <<<"$comment_json" >/dev/null
  echo "Posted the comment on #$pr."
fi
