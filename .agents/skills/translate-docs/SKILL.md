---
name: translate-docs
description: Generate and maintain fr/de/es translations for KANAP user documentation (Markdown). Translates pages, detects stale translations from changed English source text, and enforces glossary and nav-label consistency.
argument-hint: [--all | --check]
allowed-tools: Read, Write, Glob, Grep, Bash(node *), Bash(git show *), Bash(md5sum *)
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

### Translation state
- Manifest: `translation-state/docs-source-hashes.json`

## Workflow

Execute these steps in order:

### Step 1: Read inputs

1. Read the glossary: `frontend/src/locales/glossary.json`
2. Read the app nav labels: `frontend/src/locales/{fr,de,es}/nav.json`
3. Read the source-hash manifest: `translation-state/docs-source-hashes.json` (create empty `{"files":{},"glossary_hash":"","nav_hashes":{}}` if missing)
4. List all English source files: `doc/help/docs/en/**/*.md`
5. Compute MD5 hash of each English source file, the glossary file, and each nav.json file (use `node -e` with crypto module)

### Step 2: Build work list

**If `--all` flag:** Add every English source file to the work list for all three languages.

**If `--check` flag or default mode:**
- **Missing target**: English file exists but `doc/help/docs/{locale}/same-path.md` is missing → add
- **Stale source**: MD5 hash of English file differs from stored hash in manifest → add (all three languages)
- **Glossary changed**: current glossary hash differs from stored `glossary_hash` → requeue ALL files for ALL languages
- **Nav labels changed**: current nav.json hash for a locale differs from stored `nav_hashes.{locale}` → requeue ALL files for THAT locale
- **Orphan cleanup**: translated file exists but no corresponding English source → delete orphan

**If `--check` flag:** Report the work list and stop. Do not write any files.

### Step 3: Translate

For each file in the work list, for each target language:

1. Read the English source file
2. Translate the entire page following the quality rules below
3. Write the translated file to `doc/help/docs/{locale}/{same-path}.md`

**Batch strategy:** Process files in groups of ~5 per language to maintain quality. For each batch:
- Read all English source files in the batch
- Translate and write each target file

### Step 4: Update manifest

Write `translation-state/docs-source-hashes.json`:
```json
{
  "files": {
    "index.md": "<md5 of English source>",
    "applications.md": "<md5>",
    "fast-track/getting-started.md": "<md5>",
    ...
  },
  "glossary_hash": "<md5 of glossary.json>",
  "nav_hashes": {
    "fr": "<md5 of fr/nav.json>",
    "de": "<md5 of de/nav.json>",
    "es": "<md5 of es/nav.json>"
  }
}
```

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

## Manifest Format

`translation-state/docs-source-hashes.json`:
```json
{
  "files": {
    "index.md": "a1b2c3d4e5f6...",
    "applications.md": "f6e5d4c3b2a1...",
    "fast-track/getting-started.md": "1234abcd5678...",
    "on-premise/index.md": "abcd1234efgh..."
  },
  "glossary_hash": "9876fedc5432...",
  "nav_hashes": {
    "fr": "aaaa1111bbbb...",
    "de": "cccc2222dddd...",
    "es": "eeee3333ffff..."
  }
}
```

File keys are relative to `doc/help/docs/en/`. Values are MD5 hex hashes. This file should be committed to git.
