# Analytics Dimensions

Analytics Dimensions give you a flexible way to classify and analyze your IT budget outside of your formal accounting structure. Instead of reworking Companies, Departments, or Accounts, you create lightweight categories -- "Infrastructure," "Cloud Migration," "Licenses" -- and tag spend items for custom reporting.

## Getting started

Navigate to **Master Data > Analytics** to open the category list.

**Required fields**:
- **Name**: The label that appears in dropdowns and reports. Must be unique.

**Optional fields**:
- **Description**: Explain when this category should be used so teammates apply it consistently.

**Permissions**:
- View the list: `analytics:reader`
- Create or edit categories: `analytics:member`

**Tip**: Start with 5--10 broad categories. Consistent naming (all nouns or all gerunds) makes lists easier to scan.

## Working with the list

The category list gives you a quick overview of every analytics dimension in your tenant.

**Columns**:

| Column | What it shows |
|---|---|
| **Name** | Category label (clickable -- opens the workspace) |
| **Description** | Short explanation of the category's purpose |
| **Status** | Enabled or Disabled |
| **Updated** | Timestamp of the last change |

**Filtering**:
- Quick search: searches across name and description
- Status filter: narrow the list to Enabled or Disabled categories

**Actions**:
- **New Category**: Creates a new analytics dimension (requires `analytics:member`)

## The Analytics workspace

Click any row to open the workspace for that category.

### Overview tab

This is the only tab. It contains every field for the category.

**What you can edit**:
- **Name**: The category label. Changing it updates dropdowns and reports everywhere.
- **Description**: Free-text explanation of the category's intended use.
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. See [Status and lifecycle](#status-and-lifecycle).

**Workspace navigation**: Use the **Prev** and **Next** buttons to step through categories without returning to the list. The workspace preserves your current sort, search, and filter context. If you have unsaved changes, you will be prompted before navigating away.

**Tip**: Click the close icon (X) in the top-right corner to return to the list with your filters intact.

## Status and lifecycle

Every category has a status (**Enabled** or **Disabled**) and an optional **End of validity**. Use them to retire a category without deleting it.

- **End of validity**: the date the category stops. Leave it blank to keep the category active indefinitely. You can also schedule a future date.
- Switching the category to **Disabled** without a date sets its end of validity to today. Switching it back to **Enabled** clears the date.
- After the end of validity, the category no longer appears in selection dropdowns for new items.
- Existing items keep their assignment, and historical reports remain accurate.
- **Prefer disabling over deleting**: there is no delete action on this page. Disabling preserves reporting continuity while keeping the list clean.

## Tagging spend items

When creating or editing OPEX or CAPEX items:

1. Open the **Overview** tab of the spend item.
2. Find the **Analytics Category** field.
3. Select a category from the dropdown, or leave it blank for "Unassigned."
4. Save the item.

You can change or remove the category at any time. The category applies to the entire item across all fiscal years.

## The Analytics Report

The **Analytics dimensions** report (under **Reporting**) shows how the budget of your OPEX or CAPEX items is spread across your categories. See [Reporting](reports.md) for the full description.

**Report features**:
- **Item type**: OPEX or CAPEX
- **Year range**: Single year (pie or bar chart) or multi-year (line chart)
- **Metric**: Budget, Actuals, Expected landing, or Revision
- **Chart type** (single year): Pie chart or horizontal bar chart
- **Category exclusion**: Filter out specific categories to focus on a subset

**Report outputs**:
- Visual chart showing budget distribution
- Summary table with totals by category and year
- Export to CSV (table), PNG (chart), or PDF (full report)

## Tips

- **Keep it simple**: 5--10 broad categories usually reveal more than dozens of granular tags.
- **Document with descriptions**: A short description goes a long way toward consistent usage across teams.
- **Don't force it**: "Unassigned" is a valid state. Avoid creating vague catch-all categories just to fill the gap.
- **Disable, don't delete**: Retiring a category preserves historical accuracy in reports.
- **Use reports to refine**: Run the Analytics Report periodically -- if a category captures too much or too little spend, split or merge accordingly.

## Frequently asked questions

**Can I assign multiple analytics dimensions to one item?**
No. Each spend item has zero or one category. For multi-dimensional analysis, consider combining categories or using Departments with Allocations.

**Do analytics dimensions affect allocations or accounting?**
No. They are purely for reporting and have no impact on cost allocations or formal accounting.

**How many categories should I create?**
Start with 5--10. More than 20 usually indicates over-engineering. You can always split later.

**What is the difference between analytics dimensions and departments?**
**Departments** are formal organizational units with precise allocation drivers. **Analytics dimensions** are informal, optional tags for flexible reporting without allocation overhead.

**Why do some items show "Unassigned"?**
Items without an analytics category appear as "Unassigned" in reports. This is expected -- categories are entirely optional.
