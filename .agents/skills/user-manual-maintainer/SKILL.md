---
name: user-manual-maintainer
description: Maintain KANAP user documentation in doc/help, including route-based manuals, Fast Track guides, inventory/process docs, and in-app help mappings.
---

# User Manual Maintainer

Use this skill when working on KANAP user documentation in `doc/help/` or on the in-app help links that point to it.

## Read First

Read only what you need:

1. `doc/help/_process/_documentation-process.md`
2. `doc/help/_process/_documentation-template.md`
3. `doc/help/_process/_documentation-inventory.md`
4. `doc/features/components/user-documentation-system.md`

Then inspect the relevant product code:

- `frontend/src/pages/**/*Page.tsx`
- `frontend/src/pages/**/*WorkspacePage.tsx`
- `frontend/src/pages/**/editors/*.tsx`
- `frontend/src/utils/docUrls.ts` when route mapping matters

## Source of Truth

Use this order:

1. Frontend code
2. Technical docs under `doc/`
3. Existing user docs under `doc/help/`

If they conflict, align the manuals to code and then clean up the supporting docs.

## Document Types

### Route manuals

Files in `doc/help/docs/en/*.md`

Use for page-specific manuals such as:

- `applications.md`
- `contracts.md`
- `portfolio-projects.md`

When adding or renaming one of these:

- update `doc/help/mkdocs.yml`
- update `frontend/src/utils/docUrls.ts` if the page should open from the header help button
- update `doc/help/_process/_documentation-inventory.md`

### Fast Track guides

Files in `doc/help/docs/en/fast-track/*.md`

Use for:

- onboarding
- cross-module workflows
- printable cheat sheets
- concise concept guides

Current examples:

- `fast-track/getting-started.md`
- `fast-track/index.md`
- `fast-track/apps-and-assets.md`
- `fast-track/task-types.md`

These are supplemental. Keep them workflow-oriented and link back to the full route manuals for detail.

Scope rule:

- Do not create new Fast Track guides as part of this skill's default workflow.
- You may update existing Fast Track guides when product changes materially affect them.
- New Fast Track authoring is intentionally collaborative and should be handled separately unless explicitly requested.

## Maintenance Rules

- Preserve current UI terminology exactly.
- Document what users can see and do, not internal implementation details.
- For route manuals, extract columns, tabs, actions, fields, and permission-relevant behavior from code.
- For Fast Track guides, verify that navigation names, workflows, links, downloads, and screenshots still match the product.
- Keep the docs landing page `doc/help/docs/en/index.md` updated so Fast Track guides are discoverable there, not only in the left nav.

## Writing Standard

For strict page manuals, write professional and technical user documentation.

- Do not waste space stating the obvious.
- Focus on how the feature behaves and on the consequences of user choices.
- Explain what a setting, status, or option changes in practice.
- Make the system legible: what happens next, what is read-only, what is derived, what is locked, what is inherited, and what is excluded.
- Verify behavior against code when needed, but never mention code in the published documentation.

Tone:

- Professional but friendly
- Clear and direct
- Light touches of humor are acceptable when they improve readability, but keep them rare and appropriate

For route manuals, prefer:

- implications over UI tours
- decision support over field enumeration
- workflow consequences over button-by-button narration

Avoid:

- developer framing
- “click this, then this” for obvious mechanics
- repeating labels without explaining why they matter
- speculative behavior not confirmed by the product

## Publishing Model

Markdown is the maintained source. MkDocs builds the static site.

Relevant files:

- `doc/help/mkdocs.yml`
- `doc/help/requirements.txt`
- `doc/help/DEPLOYMENT.md`

## Practical Checklist

When you finish a doc change, check whether you also need to update:

- `doc/help/mkdocs.yml`
- `doc/help/docs/en/index.md`
- `doc/help/_process/_documentation-inventory.md`
- `frontend/src/utils/docUrls.ts`
- any related Fast Track guide

## Stale-Doc Detector

Use the bundled detector when you want a short review list after product changes.

Files:

- `doc/help/_process/doc-update-map.tsv`
- `.agents/skills/user-manual-maintainer/scripts/stale_doc_check.py`

What it does:

- compares changed product files against the doc mapping
- flags route manuals that likely need review
- writes a markdown report to `doc/help/_process/_stale-doc-report.md`
- lists changed frontend files that are not mapped yet

What it does not do:

- it does not prove a manual is wrong
- it does not rewrite docs by itself
- it does not create new Fast Track guides

How to invoke it:

- ask the agent to run the stale-doc detector against `origin/main` with this skill
- or ask which user manuals are stale relative to the current branch

Terminal command if you want to run it directly:

```bash
python3 .agents/skills/user-manual-maintainer/scripts/stale_doc_check.py --base origin/main
```

Typical follow-up:

1. Run the detector.
2. Open `doc/help/_process/_stale-doc-report.md`.
3. Update the flagged route manuals.
4. Re-run the detector to confirm the review list shrank.

If the detector reports unmapped frontend changes for a new page or workspace:

- create or update the corresponding route manual
- add the mapping to `doc/help/_process/doc-update-map.tsv`
- update `doc/help/_process/_documentation-inventory.md`
- update `doc/help/mkdocs.yml` and `frontend/src/utils/docUrls.ts` if needed
