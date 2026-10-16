# Contributors

Contributors lets you define skills, team assignments, project availability, and classification defaults for people who work on portfolio projects. This information helps with resource planning and ensures you have the right expertise for upcoming work.

## Getting started

Navigate to **Portfolio > Contributors** to see configured contributors grouped by team. Click **Add contributor** to add someone from your user list.

**To add a contributor**:
1. Click **Add contributor**
2. Search for and select a user from the dropdown
3. Click **Add** to create their profile
4. Configure their team, availability, skills, and defaults in the workspace

**Tip**: Contributors are separate from user accounts. Adding someone as a contributor doesn't change their login access -- it just lets you track their team membership, skills, availability, and classification defaults for project planning.

---

## Where to find it

- Workspace: **Portfolio**
- Path: **Portfolio > Contributors**
- Self-service path: **Settings > Profile > Contributor Settings** (opens your own contributor profile)
- Permissions:
  - View: `portfolio_settings:reader`
  - Add or edit contributors: `portfolio_settings:member`
  - Remove contributors: `portfolio_settings:admin`
  - Edit your own profile: any portfolio-level reader permission (e.g. `tasks:reader`, `portfolio_projects:reader`, `portfolio_settings:reader`)

If you don't see Contributors in the menu, ask your administrator to grant you the appropriate permissions.

---

## Working with the list

Contributors are displayed as cards grouped by team.

**Each contributor card shows**:
- **Name** (or email if no display name is set)
- **Skills count**: Number of skills configured (e.g. "3 skills")
- **Availability**: Days per month available for projects (e.g. "5d/mo")
- **Avg project effort**: Average monthly project time from logged entries over the last 6 months, when data is available

**Filtering**:
- Use the **Filter by Team** dropdown to show only contributors from a specific team
- Select **Unassigned** to see contributors who haven't been assigned to a team yet
- Select **All Teams** to see everyone
- Use the **Filter by contract type** dropdown next to it to show only internal staff, only externals, and so on. The two filters combine, and both apply to the list and to the skills matrix. The org chart has its own controls instead, because a reporting line crosses teams.

**Team groups**:
- Each team is displayed as a collapsible card with a member count badge
- Click the team header to expand or collapse its members
- Teams are sorted alphabetically; **Unassigned** always appears last

Click any contributor card to open their workspace.

**Switching views**:
Above the team filter, **List**, **Skills matrix** and **Org chart** switch between three readings of the same people. The team filter applies to the first two. The address changes to `?view=matrix` or `?view=org`, so a link can be bookmarked or shared, and the last view you used is remembered in your browser.

---

## The skills matrix

The skills matrix answers two questions on one screen: what each person can do, and which skills nobody can cover. It is a read-only view -- levels are set in each contributor's Skills tab.

**Reading the grid**:
- **Rows** are the skills of your catalog, grouped by category. Skills you have disabled in Portfolio Settings never appear, and skills nobody has declared start hidden
- **Columns** are the contributors, grouped by team. Their names read bottom to top; click one to open that person's Skills tab
- **Cells** hold the level, 1 to 4. Levels 3 and 4 (autonomous and expert) print in full text color, levels 1 and 2 stay faint, and an empty cell means the skill was never declared for that person. Hover a cell to read the level name
- The **Autonomous or expert** column on the right counts, for every skill, how many of the people on screen are at level 3 or 4. **The count turns orange when it is zero**: nobody currently covers that skill on their own
- The **Skills** line at the bottom summarizes each person as "autonomous / declared", for example `2/5`

**Turning the grid around**:
Catalogs are usually longer than teams, so contributors sit in the columns by default and skill names stay readable across the rows. Use the **Columns** control above the grid to put the skills in the columns instead, which suits a short catalog or a large team. Everything swaps with it: the two summaries change sides, and a contributor then opens from their row rather than from their column header. The choice is remembered in your browser.

**Narrowing the grid**:
- The grid starts on the skills people actually have. **Show unused skills** brings back the rest of the catalog, for when you are planning what to train rather than reading what you already cover
- Each skill category has a pill above the grid. Switch a category off to drop it
- The team filter restricts the people, and the coverage counts follow: filter on one team and you read that team's coverage
- The category pills and the unused-skills toggle are both remembered in your browser

**Acting on what you see**:
- Click a contributor to open their **Skills** tab, where levels can be changed
- **Export**, next to **Add contributor** at the top of the page, downloads what is on screen as an `.xlsx` file, laid out the same way round, levels as numbers. Useful for skill reviews and training plans

---

## The org chart

The org chart draws the reporting line of your contributors, built from the **Manager** set on each profile. Everyone who has no manager among the contributors sits at the top, side by side, so several independent branches can be read at once.

**Reading a card**:
- Initials, name, job title, contract type, and the number of skills on the profile
- Click a card to open that contributor
- A card with people below it carries a small chevron on its bottom edge. Click it to fold that branch away, click again to unfold it
- Hover a card that was moved up the chart to read which manager was skipped, for example "Reports through Claire Meunier"

**Who appears**:
- Only contributors are drawn. If someone's manager is not a contributor, that person becomes a top-of-chart entry rather than disappearing
- Disabled accounts are left out. **Include disabled accounts** brings them back, which is useful while a departure is being handed over
- Each contract type has a pill above the chart. Switch one off and those people leave the chart, **but their own reports stay**: they move up to the nearest manager still on screen. Hiding the externals therefore keeps your internal staff in one readable tree instead of cutting whole branches away

**Framing the chart**:
- **Start from** narrows the chart to one person and everyone below them, which is how you produce a single department's chart
- **Levels** limits how far down the chart goes, for example the top two levels for a management overview
- The zoom controls on the right scale the drawing; the chart scrolls in both directions inside its frame
- Every one of these choices is written into the address, so a branch chart can be sent to someone as a link exactly as you framed it

**Exporting and printing**:
- **Export PNG**, next to **Add contributor** at the top of the page, saves the whole chart as an image, always on a white background whatever theme you are reading in. The export date is stamped in the bottom-left corner. Folded branches stay folded, and a folded card carries the number of people hidden below it. The zoom on screen does not change the image
- Your browser's print command prints the chart on its own, in landscape and without the surrounding application

---

## The Contributor workspace

Click a contributor row to open their workspace. The header shows the contributor's reference (`CTR-1`, `CTR-2`…, click it to copy), their name, team, availability, and skill count. The reference is also what the page address uses. Use the arrows next to the back link (or the left and right arrow keys) to move to the previous or next contributor in list order. Press **Escape** to return to the list.

The workspace has three tabs, **General**, **Skills**, and **Time Logged**, plus a **Properties** panel on the right that holds the job title, team, availability, and classification defaults. Open or close the panel with the tab on its edge, or press **P**.

Every change saves automatically. A short "Saving… / Saved" note appears next to the header metadata while a change is written.

### Properties panel

**Job title**
The person's job title, the same one that appears wherever they show up in KANAP -- the org chart, their user record, their profile. It is not a label local to the portfolio, so changing it here changes it everywhere. Type it and click away to save.

You can always set your own. Setting someone else's needs the **Administrator** level on users; without it you still see the value, but the field is read-only.

When the account comes from Microsoft Entra, the field is read-only and shows **From Microsoft Entra** underneath. Change it in your directory, not here: the nightly sync and the next sign-in both bring the directory value back, so anything typed here would be overwritten.

**Team**
Assign this contributor to a team. Teams are organizational groups configured in Portfolio Settings. This assignment determines how contributors are grouped on the Contributors page. The team can also be changed from the **Team** item in the header. This field is only visible when editing another contributor's profile (not your own).

**Manager**
The person this contributor reports to. Click the field, search by name, and pick anyone in your organization -- the manager does not have to be a contributor themselves. Use **Clear** to remove the link. A contributor cannot be their own manager, and you cannot pick someone who already reports to them, directly or through a chain of managers.

When the manager comes from Microsoft Entra, the field is read-only and shows **From Microsoft Entra** underneath. Change it in your directory, not here, and the nightly sync brings the change over. A manager who has no KANAP account yet is skipped until they have one, and the field keeps its current value in the meantime.

Once set, the manager's name also appears in the workspace header, and clicking it opens their contributor profile when they have one. This field is only visible when editing another contributor's profile (not your own).

**Contract type**
How this person works with you. Every contributor starts as **Internal**; switch to **External**, **Apprentice** or **Other** when that is not the case. The list is yours to adapt in **Portfolio > Settings > Contract types**. Contract type is never imported from Microsoft Entra. This field is only visible when editing another contributor's profile (not your own).

**Project availability**
Use the slider to set how many days per month this person can work on portfolio projects. Range is 0 -- 20 days, with 0.5-day increments. Default is 5 days. The value is saved when you release the slider.

**Classification defaults**
Set the classification values that pre-fill new tasks, requests, and projects when classification fields are still empty. This saves time for contributors who consistently work in the same area.

- **Source**: The default source classification
- **Category**: The default category classification
- **Stream**: The default stream classification (only available once a **Category** is selected; filtered to streams belonging to that category)
- **Company**: The default company

When a contributor creates a new task, request, or project, these defaults are used to pre-populate the classification fields automatically. Changing the **Category** clears the **Stream** if the current stream does not belong to the newly selected category.

**Tip**: You can also reach your own defaults from **Settings > Profile**, which opens your contributor profile with the Properties panel visible.

### General

View time statistics and add notes.

**Time Statistics**
Read-only summary of logged time for this contributor. Requires `portfolio_settings:reader` to see.

- **Average monthly project effort (last 6 months)**: Shown in man-days (hours / 8)
- **Monthly Effort (12 months)**: Line chart showing **Total**, **Project**, and **Other** time
  - **Project** = project overhead time + time logged to project tasks
  - **Other** = time logged to non-project tasks
  - Months with no data display as gaps in the chart

**Notes**
Free-text field for any additional information about this contributor -- certifications, preferences, constraints, or other relevant details. Notes are saved shortly after you stop typing.

---

### Skills

Track what this contributor knows and how proficient they are.

**Adding skills**:
1. Click **Add skill** in the workspace header (available from any tab)
2. Search for the skill; the list is grouped by category
3. Pick its level in the same dialog (default: 2, "Can execute with support")
4. Click **Add**: the skill lands in its section with that level already set, so a long list never needs to be scrolled to adjust it

**Proficiency levels**:
Each skill has a proficiency rating from 1 -- 4:

| Level | Label | Description |
|-------|-------|-------------|
| 1 | Basic / Theoretical | Understands concepts but hasn't applied them |
| 2 | Can execute with support | Can do the work with guidance |
| 3 | Autonomous | Can work independently |
| 4 | Expert | Deep expertise, can mentor others |

Each skill shows four level markers followed by the name of the current level. Click a marker to set the level, or focus the markers and use the arrow keys. Hover a marker to see what that level means.

**Removing skills**:
Hover a skill and click the **×** that appears at the end of the row to remove it from the contributor's profile.

**Skill categories**:
Skills are grouped under their category heading, with the number of skills next to it. Use **Group by** above the list to switch to a grouping by level instead, from expert down: it shows at a glance what this person masters. The choice is remembered. On a wide screen the list flows into two columns.

---

### Time Logged

View and manage all time entries for this contributor in one place. This tab is only visible if you have `portfolio_settings:reader` or higher.

The table consolidates time logged from both project overhead entries and task time entries, giving you a complete picture of how the contributor spends their time.

**Columns**:
- **Date**: When the time was logged
- **Source**: Where the time was logged -- either a task name or project name
- **Category**: Whether the entry is classified as **IT** or **Business**, shown as a color-coded label
- **Time**: Duration in hours or days (e.g. "4h", "1d 2h")
- **Notes**: Any notes attached to the entry

**Editing entries**:
Click the **edit icon** next to a time entry to open the edit dialog. The dialog depends on the entry type:
- **Task entries** open the task time-logging dialog, where you can adjust the hours, date, category, and notes
- **Project entries** open the project time-logging dialog, where you can adjust the hours, category, user, and notes

**Deleting entries**:
Click the **delete icon** next to a time entry to remove it. You will be asked to confirm before the entry is deleted. Deleting an entry also updates the contributor's time statistics on the **General** tab.

**Permissions for time entry actions**:
- To see the **Actions** column, you need at least `tasks:member` or `portfolio_projects:contributor`
- Non-admin users can only edit or delete entries they created or are assigned to
- Users with `tasks:admin` can edit or delete any standalone task entry
- Users with `portfolio_projects:admin` can edit or delete any project task entry or project overhead entry

---

## Actions

From the workspace header:
- **Delete**: Remove this contributor configuration (doesn't affect the user account). Only available when editing another contributor's profile with `portfolio_settings:admin`.
- **Back link**: Return to the contributors list, or to **Settings** if you opened your own profile

There is no Save button: every change is saved automatically.

---

## Your own contributor profile

Every user with at least one portfolio-level reader permission can access their own contributor profile at **Portfolio > Contributors > me** or from **Settings > Profile > Contributor Settings**.

When editing your own profile:
- You can update your **availability**, **skills**, **notes**, and **classification defaults**
- You cannot change your own **team assignment** (only a portfolio settings member can do that)
- You cannot delete your own contributor record

If you don't have a contributor record yet, opening the self-service page creates one automatically.

---

## Teams

Contributors can be assigned to organizational teams for better organization. Teams are configured in **Portfolio > Settings > Teams**.

**Default teams** (can be customized):
- Infrastructure
- Business Applications
- Engineering Applications
- Service Desk
- Master Data
- Cybersecurity

**Managing teams**:
- Go to **Portfolio > Settings** and click the **Teams** tab
- Add, edit, or disable teams
- Use **Seed Defaults** to populate with standard teams
- A team with members or sub-teams cannot be deleted: move them to another team first, or disable the team. Built-in teams cannot be deleted

---

## Contract types

Contract types record how each person works with you: an employee, someone from a supplier, an apprentice, and whatever else your organization needs. They are configured in **Portfolio > Settings > Contract types**. Every contributor starts as Internal.

**Default types** (can be renamed):
- Internal
- External
- Apprentice
- Other

**Managing contract types**:
- Go to **Portfolio > Settings** and open the **Contract types** tab
- Add your own types, rename any of them, or switch one off to keep it out of new assignments without losing the contributors already on it
- The four built-in types can be renamed but not deleted
- A type that is assigned to at least one contributor cannot be deleted; the tab shows how many contributors use each one

---

## Tips

- **Assign contributors to teams**: This helps organize the Contributors page and makes it easier to find specific people.
- **Set realistic availability**: Account for meetings, BAU work, and holidays when setting days per month. Most people have less project time than you'd expect.
- **Use proficiency honestly**: A team full of "experts" isn't useful for planning. Be realistic about skill levels to make better resource decisions.
- **Keep skills current**: Review contributor skills periodically, especially after training or new project experience.
- **Set up your classification defaults early**: If you always work on the same category and stream, configuring defaults saves you from selecting them every time you create a task or request.
