---
name: translate-docs
description: Generate and maintain fr/de/es translations for KANAP user documentation (Markdown). Translates pages, detects stale translations from changed English source text, and enforces glossary and nav-label consistency.
argument-hint: [--all | --check]
allowed-tools: Read, Write, Glob, Grep, Bash(node *), Bash(git show *), Bash(git log *), Bash(git diff *)
---

# /translate-docs — KANAP Documentation Translation Skill

Generate and maintain French, German, and Spanish translations of the KANAP user manual (MkDocs Markdown pages), using the domain glossary and app nav labels for consistency.

## Arguments

- `/translate-docs` — **Incremental sync** (default). Translates missing pages, retranslates pages whose English source changed, and propagates glossary/nav updates. Only touches what needs work.
- `/translate-docs --all` — **Full retranslation**. Retranslates every page in every language. Use after major glossary changes or quality concerns.
- `/translate-docs --check` — **Dry run**. Reports missing pages, stale translations, and glossary/nav drift without writing files. No files are modified.

## Scope

### Documentation files
- Source: `doc/help/docs/en/**/*.md`
- Targets: `doc/help/docs/{fr,de,es}/**/*.md`

### Reference inputs (read-only)
- Glossary: `frontend/src/locales/glossary.json`
- App nav labels: `frontend/src/locales/{fr,de,es}/nav.json`

### Translation status
- `node scripts/docs/translation-status.mjs` (`--json` for the details). It reads git history; the
  repository stores no manifest.

## Workflow

Execute these steps in order:

### Step 1: Read inputs

1. Read the glossary: `frontend/src/locales/glossary.json`
2. Read the app nav labels: `frontend/src/locales/{fr,de,es}/nav.json`
3. Run `node scripts/docs/translation-status.mjs --json`

### Step 2: Build work list

**If `--all` flag:** Add every English source file to the work list for all three languages.

**If `--check` flag or default mode**, from the status:
- **`missing`**: English page with no translation in that locale → add
- **`stale`**: the English page changed in a commit after the last commit of the translation (or
  has uncommitted changes) → add for that locale. `git diff <oldest listed commit>~1 -- doc/help/docs/en/<page>`
  shows what changed: update the translation for those changes, or retranslate the page.
- **`terms`**: a glossary term or nav label of that locale was renamed since the translation's last
  commit and the page still uses the former wording → replace it with the new one
- **`orphans`**: translated file with no English source → delete it

**If `--check` flag:** Report the work list and stop. Do not write any files.

### Step 3: Translate

For each file in the work list, for each target language:

1. Read the English source file
2. Translate the entire page following the quality rules below
3. Write the translated file to `doc/help/docs/{locale}/{same-path}.md`

**Batch strategy:** Process files in groups of ~5 per language to maintain quality. For each batch:
- Read all English source files in the batch
- Translate and write each target file

### Step 4: Commit

There is no manifest to update: a translation is up to date once it is committed in the same
commit as its English change, or in a later one. Commit the translations on the branch that
changed the English pages (the repository squashes a pull request into one commit).

A page whose English change needs no translation (a fix inside a code block, for instance) stays
stale until its translation is touched: make the matching edit in each locale.

### Step 5: Validate

After writing, verify:
- **Coverage**: every English Markdown file has a fr, de, and es counterpart
- **No orphans**: no translated files exist without a corresponding English source
- **Front matter**: front matter keys preserved; string values translated
- **Code fences**: content inside code fences is unchanged
- **Local links**: relative image/download links still resolve (same paths exist in locale tree)
- **Structure**: heading levels, bullet nesting, table column counts match English source

Report any validation failures.

### Step 6: Report

Print a summary:
```
Documentation translation sync complete.
  Pages translated: X new, Y updated
  Languages: fr, de, es
  Orphans removed: Z
  Validation: [PASS | N failures]
```

## Quality Rules

Follow these rules when translating. They are critical.

### Glossary enforcement
Read `frontend/src/locales/glossary.json`. Every domain term listed MUST use the exact translation specified for each language. The glossary is organized by category (acronyms, entities, workspaces, budget, portfolio_concepts, it_concepts, knowledge_workflow, roles_access).

Example: if glossary says `"request": { "fr": "demande" }`, then every French translation that refers to a portfolio "request" must use "demande", never "requête".

### UI navigation path translation
When the English doc contains bold UI navigation paths like **IT Landscape > Assets**, translate them to match the app's nav labels from `frontend/src/locales/{locale}/nav.json`.

Examples:
- **IT Landscape > Assets** → **Cartographie SI > Actifs** (French)
- **Budget Management > OPEX** → **Budgetverwaltung > OPEX** (German)
- **Portfolio Management > Tasks** → **Gestión de portafolio > Tareas** (Spanish)

Cross-reference the `workspaces`, `sidebar`, and `breadcrumbs` sections of each nav.json to find the correct terms.

### Markdown structure preservation
- Preserve heading levels exactly (`#`, `##`, `###`, etc.)
- Preserve bullet nesting, numbered list numbering, and table alignment
- Preserve blank lines between sections
- Preserve admonition syntax (`!!! tip`, `!!! warning`, etc.) — translate the admonition title text but keep the syntax marker
- Preserve code fences (``` blocks) and their language tags — do NOT translate content inside code fences
- Preserve inline code (backtick-wrapped text) — do NOT translate
- Preserve HTML tags and attributes

### Front matter
- Preserve all front matter keys exactly
- Translate front matter string values (e.g., `title`, `description`)
- Keep non-string values unchanged

### Links and references
- Preserve **cross-page** link targets, including the `file.md#anchor` part — do NOT translate them (the target file keeps its English slug)
- **Same-page anchor links** (`](#some-anchor)`) are the exception: the anchor is auto-generated from the heading text, and you are translating the headings, so the target breaks unless you re-point it. After translating, set each same-page anchor to the slug of the **translated** heading it refers to (MkDocs slug: lowercase, strip accents to ASCII, drop punctuation, spaces→hyphens — e.g. `## Pause d'urgence` → `#pause-durgence`). Verify with `mkdocs build` — a "no such anchor on this page" warning means a same-page link was left pointing at the English slug.
- Preserve absolute URLs unchanged
- Preserve image paths unchanged
- Translate link display text

### Formality register
- French: vous (formal)
- German: Sie (formal)
- Spanish: usted (formal)
- B2B professional tone — not casual, not stiff

### Technical terms
- Keep acronyms as-is: OPEX, CAPEX, SLA, SSO, MFA, API, URL, CSV, JSON, PDF, HTML, RBAC
- Keep brand names as-is: KANAP, Microsoft, Stripe, Ubuntu
- Keep programming identifiers, file names, and CLI commands as-is
- Keep content inside code blocks and backticks as-is

### Things to translate
- Prose paragraphs
- Headings
- List items
- Table cell text
- Admonition titles and body text
- Front matter string values
- Image alt text
- Link display text

### Things NOT to translate
- Code fences and inline code
- File names and file paths
- URLs (both relative and absolute)
- Front matter keys
- Markdown syntax markers
- HTML tags and attributes
- Anchor IDs in links
