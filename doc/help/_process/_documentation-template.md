# User Documentation Template

_This template defines the structure and style for Kadratis user documentation._

---

## Document Types

There are two document types in `doc/help/docs/en/`:

1. **Reference pages**
   Route-oriented manuals such as `applications.md` or `portfolio-requests.md`
2. **Fast Track guides**
   Workflow-oriented guides under `fast-track/`

Use the right structure for the document type. Do not force a Fast Track guide into a route-manual format.

---

## File Naming Convention

### Reference pages

Use lowercase, hyphen-separated slugs:

- `applications.md`
- `contracts.md`
- `portfolio-projects.md`
- `portfolio-team-members.md`

Do **not** use the old `user-manual-` prefix.

### Fast Track guides

Store under `fast-track/` with lowercase, hyphen-separated slugs:

- `fast-track/getting-started.md`
- `fast-track/apps-and-assets.md`
- `fast-track/task-types.md`

---

## Reference Page Structure

### 1. Title and Introduction

```markdown
# {Feature Name}

{One paragraph explaining what the feature is for and why users use it. Focus on
business purpose and practical outcomes, not implementation.}
```

### 2. Getting Started or Where to Find It

Use **Getting started** for pages where users create or manage records.

```markdown
## Getting started

Navigate to **{Menu Path}** to open the list or workspace.

**Required fields**:
- **{Field Name}**: {Why it matters}

**Tip**: {Actionable advice}
```

Use **Where to find it** for admin, settings, and overview pages.

```markdown
## Where to find it

- Workspace: **{Workspace Name}**
- Path: **{Full navigation path}**
- Permissions:
  - View: `{resource}:reader`
  - Edit: `{resource}:manager`
  - Advanced/admin actions: `{resource}:admin`
```

### 3. Working with the List

```markdown
## Working with the list

{Brief explanation of what the list helps users do.}

**Default columns**:
- **{Column}**: {What it shows}

**Additional columns**:
- **{Column}**: {What it shows}

**Filtering**:
- Quick search: {What it searches}
- Column filters: {Notable filters}
- Scope/status toggles: {If applicable}

**Actions**:
- **New**: {What it creates}
- **Import CSV**: {If applicable}
- **Export CSV**: {If applicable}
- **Delete Selected**: {If applicable}
```

### 4. Workspace Section

```markdown
## The {Feature} workspace

Click a row to open the workspace.

### {Tab Name}

{What the tab is for}

**What you can edit**:
- **{Field}**: {What it controls}

**How it works**:
- {Important behavior}

**Tip**: {Useful advice}
```

Use `---` between substantial tab sections when it improves readability.

### 5. CSV Import/Export

Only include this section when the page actually supports it.

```markdown
## CSV import/export

{Short explanation}

**Export**:
- **Template**: {What users get}
- **Data**: {What users get}

**Import**:
- **Preflight**: {What it validates}
- **Load**: {What it changes}
- Matching: {How rows are matched}
```

### 6. Tips

```markdown
## Tips

- **{Short title}**: {Practical advice}
- **{Short title}**: {Practical advice}
```

---

## Fast Track Guide Structure

Fast Track pages are workflow guides. They should read differently from a route manual.

Recommended structure:

```markdown
# {Guide Title}

{Short explanation of who the guide is for and what outcome it gets them to.}

{Optional callout for downloadable PDF}

## The Big Picture

{High-level framing, table, or diagram}

## Step 1: ...
## Step 2: ...
## Step 3: ...

## Common Pitfalls

- ...

## Where to Go Next

- [Reference page](../applications.md)
- [Related Fast Track guide](task-types.md)
```

Fast Track guides should:

- optimize for speed to understanding
- focus on the workflow, not every option
- link out to route manuals for exhaustive detail
- stay readable as onboarding material

---

## Writing Style

### Tone

- Direct and practical
- User-facing, not developer-facing
- Clear about purpose and consequences

### Formatting Rules

- Use **bold** for UI labels, field names, and menu paths
- Use `code` for permission codes and literal technical values
- Prefer short sections and flat bullet lists
- Use tables when they improve scanability

### Language Rules

Prefer:

- "You can..."
- "Use this to..."
- "This page lets you..."

Avoid:

- implementation details
- internal backend terminology
- copied code comments
- invisible/internal fields

---

## Maintenance Checklist

- Title matches current UI terminology
- Navigation path is current
- Permissions are still accurate
- Tabs and columns match code
- Cross-links resolve
- Fast Track links and downloads still exist
- `mkdocs.yml` nav includes the page
- `frontend/src/utils/docUrls.ts` includes the route if the page should open from the in-app Help button
