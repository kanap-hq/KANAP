# User Documentation Maintenance Process

_This document describes how Kadratis user documentation is created, updated, and published._

---

## Overview

There are two distinct outputs in `doc/help/`:

1. **Reference pages** in `doc/help/docs/en/*.md`
   Use these for route-specific user manuals such as `applications.md`, `contracts.md`, or `portfolio-projects.md`.
2. **Fast Track guides** in `doc/help/docs/en/fast-track/*.md`
   Use these for onboarding flows, cross-module workflows, and printable cheat-sheet style guidance.

Both content types are written in Markdown and then built into the published site by MkDocs.

```
Frontend code + technical docs
            |
            v
Manual / AI-assisted authoring
(.codex skill or .claude commands)
            |
            v
doc/help/docs/en/**/*.md
            |
            v
mkdocs build
            |
            v
https://doc.kadratis.com
```

---

## Source of Truth

```
Frontend code (*.tsx)                 ← GROUND TRUTH
        |
        +--> Technical docs in /doc   ← Secondary context
        |
        +--> User docs in /doc/help   ← Derived documentation
```

When sources conflict, **code wins**.

Use supporting docs such as `doc/page-and-feature-overview.md` or `doc/features/**/*.md` for business intent, terminology, and workflow context. Do not trust them over live code for:

- column lists
- tab counts
- field names
- button labels
- permissions

---

## Authoring Assets

The current maintenance assets are:

- `doc/help/_process/_documentation-template.md`
  Writing template and content rules
- `doc/help/_process/_documentation-inventory.md`
  Coverage tracker for route-based manuals plus a note about supplemental guides
- `doc/help/_process/doc-update-map.tsv`
  Machine-readable mapping from frontend files to route manuals for stale-doc checks
- `.codex/skills/user-manual-maintainer/SKILL.md`
  Codex skill for maintaining user docs from this repository
- `.codex/skills/user-manual-maintainer/scripts/stale_doc_check.py`
  Minimal stale-doc detector that generates a review report
- `.claude/commands/doc-page.md`
- `.claude/commands/doc-check.md`
- `.claude/commands/doc-batch.md`

The Claude commands support single-page generation (`/doc-page`), staleness detection (`/doc-check`), and batch generation with refresh/stale modes (`/doc-batch`). See `doc/features/components/user-documentation-system.md` for full usage details.

---

## Content Types

### 1. Route-Based Reference Pages

Store these in `doc/help/docs/en/`.

Examples:

- `applications.md`
- `portfolio-projects.md`
- `master-data-operations.md`

These pages are typically linked from the in-app Help button through `frontend/src/utils/docUrls.ts`.

### 2. Fast Track Guides

Store these in `doc/help/docs/en/fast-track/`.

Current guides:

- `fast-track/getting-started.md`
- `fast-track/index.md`
- `fast-track/apps-and-assets.md`
- `fast-track/task-types.md`

Use Fast Track guides for:

- first-day onboarding
- cross-workspace flows
- role-oriented walkthroughs
- printable cheat sheets and downloads

Do not force Fast Track content into the 1-route-to-1-page manual structure. It is supplemental documentation.

---

## Standard Workflow

### For a New or Changed Page

1. Read the relevant frontend page, workspace, and editor components.
2. Check `doc/page-and-feature-overview.md` and any matching `doc/features/**/*.md` files for business context.
3. Update or create the page in `doc/help/docs/en/{slug}.md`.
4. If the page should open from the app Help button, verify or update `frontend/src/utils/docUrls.ts`.
5. Update `doc/help/_process/_documentation-inventory.md` if coverage, naming, or route mapping changed.
6. Preview locally with MkDocs when the change affects navigation, links, or formatting.

### For a New Fast Track Guide

1. Identify the workflow or audience the guide serves.
2. Decide whether it belongs in `fast-track/` rather than as a route manual.
3. Add or update the Markdown page plus any images or downloadable PDFs it references.
4. Add it to `doc/help/mkdocs.yml` navigation.
5. Add it to the home page `doc/help/docs/en/index.md` if users should discover it from the docs landing page.
6. Update process docs or inventory notes if the guide changes maintenance expectations.

---

## What to Review in Code

For route manuals, inspect the code directly and extract:

- list/grid columns
- filters and scopes
- actions such as create/import/export/delete
- workspace tabs
- field labels and visible behaviors
- permission checks
- notable user workflows

Look in:

- `frontend/src/pages/**/*Page.tsx`
- `frontend/src/pages/**/*WorkspacePage.tsx`
- `frontend/src/pages/**/editors/*.tsx`
- shared components used by the page when they carry visible behavior

---

## Staleness Checks

Documentation should be reviewed when:

- a page component changes
- a workspace tab is added or removed
- a list column changes
- a major workflow or permission rule changes
- Fast Track guidance becomes inconsistent with the current UX

For the simple machine-assisted check, run:

```bash
python3 .codex/skills/user-manual-maintainer/scripts/stale_doc_check.py --base origin/main
```

This generates `doc/help/_process/_stale-doc-report.md` with:

- route manuals needing review because their mapped product files changed
- impacted manuals already touched in the same diff
- changed frontend files that are not mapped yet

Use the report as a review aid, not as ground truth. A flagged page may still be correct, and an unflagged page may still need a rewrite after a broad UX change.

---

## Fast Track Maintenance Rules

Fast Track guides need a separate review lens from route manuals.

Check that they still:

- link to the correct reference pages
- match current menu names
- match current workflow sequencing
- reference existing downloads, screenshots, and images
- stay concise and onboarding-oriented rather than turning into full reference docs

If a Fast Track guide starts listing every tab and every field, split that detail back into the relevant route manual and keep the Fast Track page focused on the workflow.

---

## Handling Inconsistencies

### Code changed, docs did not

Update the user docs to match code. If technical docs are also stale, update them in the same change where practical.

### Technical docs disagree with code

Treat this as a technical-docs issue, not a reason to mirror the mistake in `doc/help`.

### Fast Track guide disagrees with route manual

Check code first, then decide:

- update the Fast Track guide if the workflow really changed
- update the route manual if the reference page is stale
- update both if the terminology or navigation changed globally

---

## Publishing

The published site is built from `doc/help/` using MkDocs:

```bash
cd doc/help
pip install -r requirements.txt
mkdocs build
```

Cloudflare Pages deploys from the `doc/help` root with `mkdocs build`. See `doc/help/DEPLOYMENT.md`.

---

## Practical Rules

- Keep route manuals focused on one page or one tightly related feature area.
- Keep Fast Track guides workflow-oriented and short.
- Preserve user-facing terminology exactly as it appears in the UI.
- Add business context that code cannot express, but do not invent behavior.
- When adding a newly documented page, update both MkDocs navigation and app-side help mapping if applicable.
- When touching homepage navigation, make sure Fast Track guides are discoverable from `docs/en/index.md`, not only from the left nav.

---

## Troubleshooting

### The help button opens the wrong page

Check `frontend/src/utils/docUrls.ts` first. Route mapping drift is common after renames and navigation changes.

### A page is documented but hard to discover

Check both:

- `doc/help/mkdocs.yml`
- `doc/help/docs/en/index.md`

### A Fast Track page exists but no one finds it

Add or strengthen links from:

- `docs/en/index.md`
- relevant route manuals
- other Fast Track guides

### A generated draft is structurally right but thin

Keep the extracted structure, then add:

- business purpose
- practical examples
- sequencing guidance
- warnings and tips users actually need
