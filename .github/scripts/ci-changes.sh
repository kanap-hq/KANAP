#!/usr/bin/env bash
# Decides which checks a merge queue run needs, from the files the queued changes touch. Run by
# the `changes` job of .github/workflows/ci.yml; prints GitHub step outputs:
#
#   ci-changes.sh <base sha> <head sha>
#     backend=full|docs|none   every backend spec, the specs that read the user manual, or none
#     frontend=true|false      the frontend build and tests
#     builds=true|false        the on-premise builds of backend and frontend
#     images=true|false        the container images
#
# Rules (the first that matches a file wins for that file; the run takes the largest need):
#   - .github/: everything;
#   - backend/: backend full, builds, and frontend too for backend/fixtures/ (a frontend test
#     reads the demo fixture) and for tenants.service.ts (roleLabel.test.ts reads the seeded
#     role names);
#   - frontend/: frontend, builds, and backend full for the modules the backend specs import
#     (auditLogLabels, recordHistoryTables, contractTerms, reportAggregates, rolePermissionGroups) and the Dockerfiles (container-images
#     spec);
#   - infra/, any Dockerfile: backend full (container-images, admin-password-policy and
#     data-access-role-script specs);
#   - doc/help/docs/: backend docs (markdown-size, markdown-worker and admin-password-policy
#     read the manual) and frontend (the noDashes locale test reads it), without the builds;
#   - anything else (doc/, marketing/, scripts/, translation-state/, root files): no suite; the
#     script checks of `build (onprem)` always run.
# The images rule is the former `image files` job, unchanged. When the files cannot be listed
# (a fetch or diff error), everything runs.
set -euo pipefail

BASE=${1:?usage: ci-changes.sh <base sha> <head sha>}
HEAD=${2:?usage: ci-changes.sh <base sha> <head sha>}

all() {
  echo "::warning::Could not list the queued changes: every check runs." >&2
  printf 'backend=full\nfrontend=true\nbuilds=true\nimages=true\n'
  exit 0
}

git cat-file -e "$BASE^{commit}" 2>/dev/null || git fetch --no-tags --quiet --depth=1 origin "$BASE" 2>/dev/null || all
files=$(git diff --name-only --no-renames "$BASE" "$HEAD" 2>/dev/null) || all

backend=none frontend=false images=false manual=false
need_backend() {
  case "$1" in
    full) backend=full ;;
    docs) [ "$backend" = none ] && backend=docs ;;
  esac
  return 0
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    .github/*)
      need_backend full; frontend=true ;;
    backend/fixtures/*)
      need_backend full; frontend=true ;;
    backend/src/tenants/tenants.service.ts)
      need_backend full; frontend=true ;;
    backend/*)
      need_backend full ;;
    frontend/src/lib/audit/auditLogLabels.* | frontend/src/components/history/recordHistoryTables.* | \
      frontend/src/pages/contracts/contractTerms.* | \
      frontend/src/pages/reports/reportAggregates.* | frontend/src/pages/reports/reportTables.* | frontend/Dockerfile* | \
      frontend/src/pages/operations/copyBudgetRows.* | frontend/src/pages/admin/master-data/masterDataCopyRows.* | frontend/src/pages/admin/rolePermissionGroups.* | \
      frontend/src/pages/portfolio/contributorsOrdering.* | frontend/src/pages/portfolio/skillsMatrix.* | \
      frontend/src/pages/portfolio/roadmapOccupation.* | \
      frontend/src/locales/*/portfolio.json | frontend/src/locales/*/it.json | frontend/src/locales/*/ops.json | \
      frontend/src/locales/*/admin.json | frontend/src/locales/*/master-data.json | frontend/src/locales/*/nav.json)
      need_backend full; frontend=true ;;
    frontend/*)
      frontend=true ;;
    infra/* | Dockerfile | Dockerfile.* | */Dockerfile | */Dockerfile.*)
      need_backend full ;;
    doc/help/docs/*)
      need_backend docs; manual=true ;;
  esac
  case "$f" in
    Dockerfile | Dockerfile.* | */Dockerfile | */Dockerfile.* | .dockerignore | */.dockerignore | \
      infra/* | frontend/nginx/* | marketing/web/nginx.conf | \
      package.json | */package.json | package-lock.json | */package-lock.json | \
      backend/tsconfig*.json | backend/scripts/migrate-and-start.js | backend/scripts/lib/* | .github/*)
      images=true ;;
  esac
done <<<"$files"

builds=false
{ [ "$backend" = full ] || [ "$frontend" = true ]; } && builds=true
[ "$manual" = true ] && frontend=true

echo "Files changed: $(grep -c . <<<"$files" || true). backend=$backend frontend=$frontend builds=$builds images=$images" >&2
printf 'backend=%s\nfrontend=%s\nbuilds=%s\nimages=%s\n' "$backend" "$frontend" "$builds" "$images"
