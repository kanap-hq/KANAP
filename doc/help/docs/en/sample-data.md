# Sample data

Use the Sample data page to explore KANAP with a ready-made set of data. It fills an empty workspace with Fromage & Co, a fictional cheese maker, so you can see budgets, applications, contracts and projects working together before you enter your own. When you are done exploring, one action erases everything and puts the workspace back in its starting state.

## Where to find it

- Workspace: **Admin** › **Sample data**
- Route: `/admin/sample-data`
- Who can use it: users with the **Administrator** role. A module permission level, even `admin`, does not give access.
- Available in cloud workspaces only. Installations on your own servers do not have this page.

The page is not available on the platform host. It always acts on the workspace you are signed in to.

## What the sample set contains

The set describes Fromage & Co, a fictional cheese maker:

- **4 companies** in France, the Netherlands, Italy and the United States
- **18 fictional users**, who cannot sign in and receive no e-mail
- **Applications and their landscape**: instances, interfaces and connections
- **Contracts, the budget of the current year, projects and tasks**

Dates follow the current year, so the budget always looks up to date. Loading takes less than a minute.

The fictional users have no password and no access. They exist so that owners, assignees and project teams look realistic. KANAP sends them no e-mail, and the erase step removes them.

## Load the sample data

Sample data loads into an empty workspace only. A workspace counts as empty when it holds none of the following:

- business data such as applications, assets, contracts, budget lines, projects, requests or tasks
- master data beyond what a new workspace starts with: extra companies, suppliers, contacts, departments, cost centers or locations
- configuration you added: a chart of accounts of your own, analytics categories, portfolio classification, extra working-day calendars, integrations or AI agents
- documents outside the templates library

What a new workspace creates for you (its first company, the default chart of accounts and the calendar for its country) does not count.

**To load the set**:

1. Open **Admin** › **Sample data**.
2. Click **Load sample data**.
3. Read the summary in the dialog and confirm with **Load sample data**.

The page follows the load step by step (for example "Step 4 of 19: charts of accounts") and the status changes to **Loaded** when it finishes. The status strip then shows when the data was loaded and by whom. Everything you see in KANAP refreshes with the new data.

**If a load is not possible**, the page shows no **Load sample data** button. One line explains why:

- the workspace already holds data
- the subscription is frozen
- the trial has ended

The home banner stays hidden in those cases. Erasing remains possible on a frozen workspace (see below).

**If the load fails**, KANAP puts the workspace back in its starting state by itself. The status shows **Load failed** with the date, and the page gives the reason. Click **Try again** to start another load.

!!! warning "Wait for the load to finish"
    While a load is running, anything created in the workspace is erased if the load fails. Hold off on real work until the status shows **Loaded**.

## The home banner

While the workspace is empty and sample data has never been loaded, Administrators see one line at the top of the home page: "Discover KANAP with sample data."

- **Load** opens the same dialog as the page.
- **Hide** removes the line for good, for every Administrator of the workspace. The page under **Admin** › **Sample data** stays available.
- While a load runs, the line shows the current step.
- If a load fails, the line gives the reason and offers **Try again**.

The line disappears as soon as the workspace holds data. It does not come back after you erase the workspace. To load the set again, use **Admin** › **Sample data**.

## Erase everything and start over

Once sample data is loaded, the page offers **Erase everything and start over**. It is also offered after a load that failed and could not restore the starting state. It works when the subscription is frozen or the trial has expired.

**This action cannot be undone.** All the content of the workspace is erased, whether it came from the sample set or from your own work, and the workspace returns to its starting state.

**What is erased**:

- every record: applications, contracts, budget, projects, requests, tasks, documents, master data and so on
- uploaded files and attachments
- the sample users

**What is kept**:

- real user accounts and their roles
- the subscription
- the name, address and logo of the workspace
- the Microsoft sign-in connection
- AI settings
- the audit log

**What goes back to defaults**: settings saved on the workspace, namely currencies, budget columns and the classification catalog.

**To erase**:

1. Click **Erase everything and start over**.
2. The dialog lists what is kept. If you created items since the sample data was loaded, it also gives their number (for example "12 items created since the sample data was loaded will also be erased"). Those items are erased with the rest.
3. Type the name of the workspace, as shown in the dialog, in the **Workspace name** field. Capitals and spaces around the name do not matter.
4. Click **Erase everything**. The button stays disabled until the name matches.

Erasing takes a few seconds. The status shows **Erasing**, then **Not loaded**. During those seconds KANAP refuses changes from every user of the workspace, and an error says to try again in a moment. Reading keeps working.

If the erase fails, the page shows "The content of the workspace could not be erased. Nothing was changed." Nothing is lost, and you can try again.

When the workspace is erased, every Administrator receives an e-mail that says who erased it and when. The audit log keeps a record of the operation.

After erasing, the workspace is as new, and you can load the sample data again from the page or start entering your own data. The home banner does not return.

## Tips

- **Explore, then clean up**: load the sample data to learn the product or to prepare a demonstration, then erase it before you enter real data. Mixing both makes the erase step remove your own entries.
- **Check the count before you erase**: the number of items created since the load tells you whether anyone has started real work in the workspace.
- **One person at a time**: only one load or erase can run on a workspace at a time. If another Administrator started one, the page shows its progress.
- **Real users are safe**: erasing keeps every real account, so nobody loses access to the workspace.
