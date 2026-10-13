## Problem

<!-- What is broken, missing or risky, and how it shows up. Link the issue, audit finding or ADR. -->

## Changes

<!-- What the code does now, and why this approach. Note anything deliberately left out of scope. -->

## Release notes

<!-- What users and on-premise operators see. Visible changes: what users notice. On-premise: required actions, recommendations, migrations. Write None when there is nothing to say. -->

### Visible changes

### On-premise

## Verification

<!-- Commands actually run, with their result — not what should be run. -->
- [ ] `cd backend && npx tsc -p tsconfig.build.json --noEmit`
- [ ] relevant `npm run test:*` suites:
- [ ] UI checked in the browser, light + dark (UI changes only)

## Impact

- [ ] database migration
- [ ] RLS / tenant isolation touched
- [ ] on-prem (`single-tenant`) behaviour verified
- [ ] needs an API image rebuild to deploy

## References

<!-- Issue link, audit finding, screenshots, related PRs. -->
