---
name: translate
description: Generate and maintain fr/de/es translations for KANAP locale files. Translates missing keys, detects stale translations from changed English source text, and enforces glossary consistency.
argument-hint: [--all | --check]
allowed-tools: Read, Write, Glob, Grep, Bash(node *), Bash(git show *)
---

# /translate — KANAP Translation Skill

Generate and maintain French, German, and Spanish translations from the English source of truth, using the domain glossary for consistency.

## Arguments

- `/translate` — **Incremental sync** (default). Translates missing keys, retranslates keys whose English source changed, and propagates glossary updates. Only touches what needs work.
- `/translate --all` — **Full retranslation**. Retranslates every key in every namespace. Use after major glossary changes or quality concerns.
- `/translate --check` — **Dry run**. Reports missing keys, stale translations, and glossary drift without writing files. No files are modified.

## Scope

### Frontend locale files (14 namespaces)
- Source: `frontend/src/locales/en/*.json`
- Targets: `frontend/src/locales/{fr,de,es}/*.json`
- Namespaces: common, nav, auth, settings, portfolio, ops, master-data, it, admin, knowledge, ai, validation, errors, grid

### Backend email locale files
- Source: `backend/src/i18n/email-locales/en.ts`
- Targets: `backend/src/i18n/email-locales/{fr,de,es}.ts`

### Translation state
- Manifest: `translation-state/i18n-source-hashes.json`

## Workflow

Execute these steps in order:

### Step 1: Read inputs

1. Read the glossary: `frontend/src/locales/glossary.json`
2. Read the source-hash manifest: `translation-state/i18n-source-hashes.json` (create empty `{}` if missing)
3. Read all English source files:
   - `frontend/src/locales/en/*.json` (14 files)
   - `backend/src/i18n/email-locales/en.ts` (1 file)
4. Read all target language files (fr, de, es) for the same paths

### Step 2: Build work list

For each English key in each namespace, for each target language:

**If `--all` flag:** Add every key to the work list.

**If `--check` flag or default mode:**
- **Missing key**: exists in English, missing in target → add to work list
- **Stale source**: compute MD5 hash of the English value; compare to stored hash in `i18n-source-hashes.json`. If different → add to work list (English text changed since last translation)
- **Glossary drift**: compare current `glossary.json` with committed version (`git show HEAD:frontend/src/locales/glossary.json`). If a glossary term's translation changed for a language, search that language's locale files for values containing the OLD term. Add matching keys to work list.

**If `--check` flag:** Report the work list and stop. Do not write any files.

### Step 3: Translate

For each namespace that has work, for each target language:

1. Collect the English keys to translate
2. Translate them into the target language following the quality rules below
3. For large namespaces (>50 keys), work in batches of ~30-50 keys to maintain quality

### Step 4: Write results

1. **Merge** translated keys into existing target locale files. Preserve all untouched keys and their values. Preserve JSON key order matching the English source.
2. **Update `translation-state/i18n-source-hashes.json`**: for every key that was translated (or confirmed up-to-date), store `{ "namespace.key.path": "<md5 of English value>" }`. The hash is computed on the English value string only.
3. Create the `translation-state/` directory and manifest file if they don't exist.

### Step 5: Validate

After writing, verify:
- **Key parity**: every key in English exists in fr, de, es (and vice-versa — no orphan keys)
- **Interpolation variables**: `{{varName}}` placeholders in English must appear identically in translations
- **Plural suffixes**: if English has `key_one` and `key_other`, translations must have both
- **HTML tags**: `<strong>`, `<br/>` etc. in English must be preserved in translations
- **No raw English**: translations should not be identical to English (except for acronyms, brand names, and technical terms)

Report any validation failures.

### Step 6: Report

Print a summary:
```
Translation sync complete.
  Namespaces processed: 14 frontend + 1 backend
  Keys translated: X new, Y updated, Z glossary-synced
  Languages: fr, de, es
  Validation: [PASS | N failures]
```

## Quality Rules

Follow these rules when translating. They are critical.

### Glossary enforcement
Read `frontend/src/locales/glossary.json`. Every term listed MUST use the exact translation specified for each language. The glossary is organized by category (acronyms, entities, workspaces, budget, portfolio_concepts, it_concepts, knowledge_workflow, roles_access). Terms marked with a `note` field provide context.

Example: if glossary says `"request": { "fr": "demande" }`, then every French translation that refers to a "request" (portfolio context) must use "demande", never "requête" or "requête de service".

### Interpolation preservation
`{{variable}}` markers must appear EXACTLY as in English, including the variable name. Never translate the variable name inside `{{}}`.

English: `"Deleted {{count}} item(s)"`
French: `"{{count}} élément(s) supprimé(s)"` ✓
French: `"{{nombre}} élément(s) supprimé(s)"` ✗ (translated the variable name)

### Plural suffix preservation
i18next uses `_one` / `_other` suffixes. If the English source has both, the translation must have both. The key names (suffixes) must be identical.

### HTML preservation
Values containing HTML tags (`<strong>`, `<br/>`, `<a href="...">`) must preserve the tags exactly. Only translate the text content between tags.

### Formality register
- Use **formal "you"** in all languages: vous (fr), Sie (de), usted (es)
- B2B professional tone — not casual, not stiff
- Match sentence structure to the target language (don't force English word order)

### Technical terms
- Keep acronyms as-is: OPEX, CAPEX, SLA, SSO, MFA, API, URL, CSV, JSON, PDF, HTML
- Keep brand names as-is: KANAP, Microsoft, Stripe
- Keep programming identifiers as-is (anything in `{{}}` or backticks)

### Backend .ts locale files
Backend email locales are TypeScript exports, not JSON. When writing to `backend/src/i18n/email-locales/{fr,de,es}.ts`:
- Preserve the `export const fr: EmailStrings = { ... }` structure
- Preserve the `import type { EmailStrings } from './en';` import
- Translate all string values; keep keys, types, and structure unchanged

## Source-Hash Manifest Format

`translation-state/i18n-source-hashes.json`:
```json
{
  "frontend/common": {
    "buttons.save": "a1b2c3d4...",
    "buttons.cancel": "e5f6a7b8...",
    "status.loading": "c9d0e1f2..."
  },
  "frontend/nav": {
    "workspaces.ai": "...",
    ...
  },
  "backend/email": {
    "common.footer.poweredBy": "...",
    ...
  }
}
```

Keys are dot-paths within each namespace. Values are MD5 hex hashes of the English source string. This file should be committed to git.
