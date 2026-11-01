# Portfolio Settings

Portfolio Settings let you configure the scoring system, team skills, project phase templates, the classification structure, and the contract types used across all portfolio requests and projects. These settings shape how requests are evaluated, how projects are structured, and how items are categorized.

## Where to find it

- Workspace: **Portfolio Management**
- Path: **Portfolio Management > Settings**
- Permissions:
  - You need `portfolio_settings:admin` to modify settings
  - Lower permission levels can view but not edit

If you don't see Settings in the menu, ask your administrator to grant you the appropriate permissions.

## Scoring Criteria

Define the evaluation criteria used to calculate priority scores for requests and projects.

### Mandatory Bypass Setting

At the top of the Scoring Criteria tab:
- **Mandatory requests automatically score 100 points**: When enabled, any request with a criterion value flagged as "mandatory" receives a priority score of 100 regardless of other criteria

### Managing Criteria

Each criterion has:
  - **Name**: What you're evaluating (e.g., "Strategic Alignment", "Risk Level")
  - **Weight**: Relative importance (higher weight = more impact on score)
  - **Inverted**: If checked, first value = highest score instead of lowest
  - **Enabled/Disabled**: Toggle to include in scoring or not
  - **Values**: The scale options in order

**To add a criterion**:
1. Click **Add Criterion**
2. Enter the name
3. Set the weight (default is 1)
4. Check "Inverted" if higher position should mean lower score
5. Define the values in order (minimum 2)
6. Optionally flag a value as "Mandatory" (triggers the bypass)
7. Click **Save**

**To edit a criterion**:
- Click the edit icon
- Modify name, weight, inversion, or values
- Click **Save**

**To delete a criterion**:
- Click the delete icon
- Confirm the deletion
- Note: Existing evaluations using this criterion will be removed

**Example criteria**:
- Strategic Alignment: Low, Medium, High (weight 2)
- Business Value: Low, Medium, High, Very High (weight 1.5)
- Risk Level: Low, Medium, High, Critical (weight 1, inverted)
- Compliance: Optional, Recommended, Mandatory (weight 1, "Mandatory" triggers bypass)

---

## Skills

Define team member expertise areas for project staffing.

### Managing Skills

Skills are grouped by category:
- Toggle skills on/off to make them available for team assignments
- Add, edit, or delete skills as needed

**To seed defaults**:
- If no skills exist, click **Seed Defaults** to populate with standard IT and business skills
- Categories include: Development, Infrastructure, Business Analysis, Project Management, etc.

**To add a skill**:
1. Click **Add Skill**
2. Select or type a category name
3. Enter the skill name
4. Click **Save**

**To disable a skill**:
- Toggle the switch next to the skill name
- Disabled skills won't appear in team skill selectors

---

## Phase Templates

Define standard phase structures to apply to projects.

### Understanding Templates

Phase templates provide:
- Consistent project structures across the organization
- Quick setup when creating or planning projects
- Optional milestones linked to each phase

**System templates**:
- Pre-defined templates provided by KANAP
- Marked with a "System" chip
- Can be edited but provide sensible defaults

**Custom templates**:
- Templates you create for your organization's methodology
- Useful for different project types (e.g., Agile, Waterfall, Quick Win)

### Managing Templates

**To create a template**:
1. Click **Add Template**
2. Enter the template name
3. Add phases in order:
   - Enter phase name
   - Check "Milestone" if a completion milestone should be created
   - Optionally customize the milestone name
4. Add more phases as needed
5. Click **Save**

**To edit a template**:
- Click the edit icon
- Modify name, phases, or milestone settings
- Click **Save**

**To delete a template**:
- Click the delete icon
- Confirm the deletion
- Note: Existing projects using this template are not affected

**Example templates**:
- Waterfall: Analysis, Design, Development, Testing, Deployment (all with milestones)
- Agile: Discovery, MVP, Iteration 1, Iteration 2, Release
- Quick Win: Planning, Execution, Closure

---

## Classification

Configure types, categories, and streams for organizing requests and projects.

A new workspace starts with three sources (IT, Business, Compliance) and three categories (Applications, Cybersecurity, Infrastructure), with no stream. Their names follow the workspace language. You can rename, disable or delete them like any other value.

### Types

Types describe the nature of the work:
- **Enhancement**: Improvements to existing capabilities
- **New Development**: Building new capabilities
- **Maintenance**: Keeping systems operational
- **Infrastructure**: Platform and technical foundation

**To add a type**:
1. Click **Add Type**
2. Enter name and optional description
3. Click **Save**

**To toggle a type**:
- Use the switch to enable/disable
- Disabled types won't appear in selection dropdowns

### Categories & Streams

Categories provide high-level grouping, and streams offer sub-categorization within each category.

**Structure**:
```
Category (e.g., "Digital Transformation")
  ├── Stream (e.g., "Customer Experience")
  ├── Stream (e.g., "Operations Efficiency")
  └── Stream (e.g., "Data Analytics")
```

**To add a category**:
1. Click **Add Category**
2. Enter name and optional description
3. Click **Save**

**To add a stream**:
1. Expand the category
2. Click **Add Stream**
3. Enter name and optional description
4. Click **Save**

**To toggle items**:
- Use switches to enable/disable categories or streams
- Disabled items won't appear in selection dropdowns
- Disabling a category hides all its streams

**System items**:
- Pre-defined categories and types marked with "System" chip
- Can be edited or disabled but not deleted
- An item that requests or projects still use, or a task type that tasks use, cannot be deleted. KANAP says so before asking you to confirm, and counts what uses it. Disable it instead

### Best Practices

- Keep type list short (3-6 items)
- Use categories for major business areas or strategic themes
- Use streams for more specific groupings within categories
- Review and clean up unused classification items periodically

---

## Contract Types

Contract types record how each contributor works with you. They appear as a dropdown on every contributor's Properties panel, and as a filter on the Contributors page. Every contributor starts as Internal.

Four types are created with every workspace:

- **Internal**: the default for every new contributor
- **External**
- **Apprentice**
- **Other**

### Managing Contract Types

**To add a type**:
1. Open the **Contract types** tab
2. Click **Add contract type**
3. Enter a name and click **Save**

**To rename a type**: Click the edit icon, change the name and save. Contributors already on that type keep it.

**To switch a type off**: Use the toggle. An inactive type disappears from the dropdown for new assignments, but contributors already on it keep it and still show it.

**To delete a type**: Click the delete icon. A built-in type, or a type that contributors use, is refused before you confirm, with the reason. The count beside each type tells you how many contributors are on it. The four built-in types can be renamed but never deleted. To retire a type that contributors use, switch it off.

**Seed defaults**: If the list is ever empty, **Seed defaults** recreates Internal, External, Apprentice and Other.

Contract types are never imported from Microsoft Entra: they are yours to maintain.

---

## Tips

  - **Start with scoring**: Define your evaluation criteria first so requests can be properly prioritized
  - **Use templates**: Create templates that match your organization's delivery methodology
  - **Keep classification simple**: Too many options create confusion; start small and expand as needed
  - **Review regularly**: As your organization evolves, revisit these settings to ensure they remain relevant
  - **Keep contract types few**: Four or five types are usually enough to answer "who is internal and who is not"


