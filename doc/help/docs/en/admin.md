# Administration

The Admin section provides access to user management, role configuration, billing, authentication settings, branding controls, and the audit log viewer. These pages are typically restricted to administrators.

## Where to find it

Navigate to **Admin** from the main menu to access the administration hub.

**Permissions**: Different admin pages require different permissions:
- Companies, Departments, Suppliers, Accounts: `{resource}:reader` to view
- Users & Access: `users:reader` to view, `users:admin` to manage
- Roles: `users:reader` to view, `users:admin` to edit
- Audit Log: Requires `users:admin`
- Billing: Requires billing admin role
- Authentication: Requires `users:admin` (feature-flagged; requires SSO enabled)
- Branding: Requires `users:admin` (tenant host only; accessible from sidebar)
- Sample data: Requires the Administrator role (cloud workspaces only; accessible from sidebar)

---

## Admin Hub

The Admin landing page provides quick access to the main administrative functions:

| Card | Description | Required Permission |
|------|-------------|---------------------|
| **Companies** | Manage companies and year metrics | `companies:reader` |
| **Departments** | Manage departments and headcount | `departments:reader` |
| **Suppliers** | Manage suppliers and contacts | `suppliers:reader` |
| **Accounts** | Manage accounting codes | `accounts:reader` |
| **Users & Access** | Manage users and roles | `users:reader` |
| **Roles** | Define role permissions | `users:reader` |
| **Audit Log** | Browse all change history | `users:admin` |
| **Billing** | Plan and invoices | Billing admin |

Authentication, Branding and Sample data are available from the sidebar navigation but do not appear on the Admin hub landing page.

---

## Audit Log

The Audit Log page shows tenant-scoped change history for data updates across the platform.

### Access

- Route: `/admin/audit-logs`
- Required permission: `users:admin`
- This page is read-only (no create/edit/delete actions).

### What You Can Do

- Search across table name, action, and actor (email/name)
- Filter by:
  - Date
  - Table
  - Action
  - Source (`user`, `system`, `webhook`)
- Open any row to view full details:
  - Metadata chips (date, table, action, source, source reference, tenant, record id, user)
  - Changed fields summary
  - Side-by-side **Before** and **After** JSON payloads

### Columns

**Default columns**:
- **Date**: When the change occurred
- **Table**: Which database table was affected
- **Action**: The type of change (create, update, delete, disable)
- **Source**: Who or what triggered the change (user, system, webhook)
- **User**: Email of the user who made the change (or "System"/"Webhook" for non-user sources)

**Additional columns** (via column chooser):
- **Record ID**: Identifier of the affected record
- **User ID**: UUID of the acting user
- **User Name**: Display name of the acting user
- **Source Ref**: External reference for webhook-originated changes
- **Tenant ID**: The tenant this entry belongs to

### Pagination

- The grid uses explicit pagination with **100 rows per page**.
- Filters and search apply to the full dataset, not only the current page.

### Understanding Source and Actor

- **Source = user**: change initiated by an authenticated user action.
- **Source = webhook**: change initiated by an external webhook (for example billing sync events). Use **Source Ref** to correlate upstream event IDs.
- **Source = system**: internal platform process without a direct user actor.

If a user account is no longer resolvable in the current context, the User column may show a UUID fallback (`Unknown (xxxx...)`) instead of an email.

---

## Users & Access

Manage who can access KANAP and what they can do.

### The Users Grid

**Default columns**:
- **Last name** / **First name**: user's name
- **Email address**: login email address
- **Job title**: their role in the organization
- **Status**: a colored dot with the account state. See below.
- **Last sign-in**: when the person last signed in, or **Never**
- **Roles**: all roles assigned to the user
- **Account type**: **Local** for accounts that sign in with an email and password, **Microsoft Entra** for accounts that sign in with Microsoft
- **Company** / **Department**: user's organizational assignment

**Additional columns** (via column chooser):
- **Business phone** / **Mobile phone**: contact numbers
- **MFA enabled**: whether multi-factor authentication is active
- **Created**: when the user was created

**Status values**:

| Status | Meaning |
|--------|---------|
| **Enabled** | The account can sign in and use KANAP. |
| **Disabled** | The account is kept with all its history, but cannot sign in. |
| **Invited** | An invitation was sent and has not been accepted yet. |
| **Pending access** | The person can sign in but has no role, so they cannot open anything. Assign a role to give them access. |
| **Contact** | A directory entry only. The person does not sign in. |

The grid defaults to showing **Enabled** users. Use the **Show** toggle to switch between **All**, **Enabled**, **Invited** and **Disabled**.

### User management actions

Toolbar actions:

| Action | Description | Permission |
|--------|-------------|------------|
| **New** | Create a new user | `users:admin` |
| **Import CSV** | Bulk import users | `users:admin` |
| **Export CSV** | Export user list | `users:admin` |
| **Invite** | Send login invitations to selected users | `users:admin` |
| **Disable** | Disable the selected users. They are signed out immediately. | `users:admin` |
| **Delete** | Remove selected users permanently | `users:admin` |

`users:reader` is enough to open the page and read the list. Every action above, and the row actions below, require `users:admin`.

Row actions, from the menu at the end of each row:

| Action | Description |
|--------|-------------|
| **Edit** | Open the user for editing. Clicking the row does the same. |
| **Enable** / **Disable** | Switch the account on or off. Disabling signs the person out immediately. |
| **Send invite** | Email a sign-in invitation. Hidden for Microsoft Entra accounts. |
| **Send password reset** | Email a password reset link. Shown for enabled local accounts only. |
| **Delete** | Remove the user permanently. Disable the account instead if other records reference it. |

### Users CSV

**Export CSV** downloads the user list. **Import CSV** reads a file back. The import dialog also carries **Download template**: a file with the headers only.

The columns:

| Column | Content |
|---|---|
| `email` | Required. Rows are matched on it, so write the address as the workspace holds it |
| `first_name`, `last_name` | The person's name |
| `role` | The role to give. A blank cell gives the **Contact** role |
| `company_name` | The company, by name. Optional |
| `department_name` | The department, by name. It needs a `company_name` |
| `status` | `contact`, `invited`, `enabled` or `disabled`. A blank cell gives `contact` |

A role the file names and your workspace does not have is created by the load, with a default description. The check lists it and creates nothing, so a file you only check changes no role. A name that appears twice in the file is kept once, the first row winning.

The file holds no date and no amount. An import sets no password: a new user signs in after an invitation or a password reset.

See [CSV files](csv-files.md) for the encoding, the separator and the two import steps.

### Creating a User

1. Click **New**
2. Fill in required fields:
   - **Email**: Login email address (must be unique)
3. Optional fields:
   - **First Name** / **Last Name**: User's name
   - **Job Title**: Their role in the organization
   - **Business Phone** / **Mobile Phone**: Contact numbers
   - **Roles**: Assign one or more roles (determines permissions)
   - **Company** / **Department**: Organizational assignment
   - **Enabled**: Whether the user can log in
4. Click **Save** or **Save and Invite** to send login email

### Multi-Role Assignment

Users can be assigned multiple roles. Their effective permissions are the combination of all assigned roles -- if any role grants access to a resource, the user has that access.

Clearing every role does not delete the account. The user falls back to the **Contact** system role, keeps no access, and shows as **Pending access** in the grid. You cannot remove your own last role, so you cannot lock yourself out.

### Enabled and disabled users

Your subscription includes **unlimited users**. The **Enabled** switch controls who can sign in:
- **Enabled users**: Can log in and use KANAP
- **Disabled users**: Keep their data but can no longer log in
- Toggle the **Enabled** switch when editing a user to control access

### Users managed by Microsoft Entra

Accounts with the account type **Microsoft Entra** are owned by your directory. Their profile is refreshed from Entra in two moments:

- **At every sign-in**, from the person's own Microsoft profile
- **Every night**, by the daily directory sync, if a Microsoft Entra administrator has approved it. See [Authentication](#authentication).

Both refresh the same fields: first name, last name, job title, business phone, mobile phone, and the department and company, matched by name against records that already exist in KANAP. Empty values in the directory never clear what is stored in KANAP.

People who are also contributors get their **Manager** from the directory as well, with the nightly sync. KANAP matches the manager in Entra to their KANAP account and writes it on the contributor profile, where the field becomes read-only. A manager who has no KANAP account yet is picked up by a later sync. See [Contributors](portfolio-team-members.md).

When editing one of these users, the email, name, job title and phone fields are locked, with the note:

> This user is managed by Microsoft Entra ID. Directory fields cannot be edited here. Last synced from Microsoft Entra: {date}

You can still manage their roles, company, department and the Enabled switch.

Microsoft Entra accounts never hold a KANAP password. They cannot be sent an invitation or a password reset.

If someone is removed from your directory, or their directory account is deactivated, the nightly sync disables their KANAP account. They are signed out immediately and their data is kept.

### Just-in-time sign-in with Microsoft

When single sign-on is connected, a person who signs in with Microsoft for the first time gets a KANAP account automatically. If an account with the same email address already exists, it is linked to their Microsoft identity instead.

A new account starts with the **Contact** system role and no permissions. The person sees a page saying:

> Your account hasn't been given access to KANAP yet. Ask your administrator to grant you access.

Administrators receive an email when this happens. To give the person access, open **Admin > Users**, find them by their **Pending access** status, and assign a role.

---

## Roles

Define what each role can do across KANAP.

### How Roles Work

Each role has permission levels for different resources:
- **None**: No access to this resource
- **Reader**: View only
- **Contributor**: View and edit existing items, add comments and attachments, but cannot create new top-level items. The role editor offers this level on most resources (not on Knowledge, AI settings, Plaid chat or MCP access). Portfolio projects, incidents and AI agents use it today. On every other resource, changes need the Member level, so a Contributor there has Reader access.
- **Member**: View, create, and edit
- **Admin**: Full access including delete

### Permission Groups

Resources are organized into groups for easier management:

**Budget & Finance**
| Resource | What it controls |
|----------|------------------|
| `opex` | Operating Expenses |
| `capex` | Capital Expenses |
| `budget_ops` | Budget Administration tools, including the currency settings |
| `contracts` | Vendor contracts |
| `analytics` | Analytics dimensions |
| `reporting` | Reports access |

**Portfolio Management**
| Resource | What it controls |
|----------|------------------|
| `portfolio_requests` | Portfolio requests |
| `portfolio_projects` | Portfolio projects |
| `portfolio_planning` | Portfolio planning |
| `portfolio_reports` | Portfolio reports |
| `portfolio_settings` | Portfolio settings |

**IT Landscape**
| Resource | What it controls |
|----------|------------------|
| `applications` | Applications |
| `infrastructure` | Servers and infrastructure |
| `locations` | Location master data |
| `settings` | IT landscape settings only |

**Master Data**
| Resource | What it controls |
|----------|------------------|
| `companies` | Company master data |
| `departments` | Department master data |
| `cost_centers` | Cost centers and their groups |
| `working_day_profiles` | Working-day calendars, for lines priced per day |
| `suppliers` | Supplier master data |
| `contacts` | Contact directory |
| `accounts` | Chart of accounts |
| `business_processes` | Business process catalog |

**Tasks**
| Resource | What it controls |
|----------|------------------|
| `tasks` | Task management |

**Knowledge**
| Resource | What it controls |
|----------|------------------|
| `knowledge` | Knowledge base articles |

The Knowledge resource supports Reader, Member, and Admin levels (Contributor is not available for this resource).

**Administration**
| Resource | What it controls |
|----------|------------------|
| `users` | User and role management |
| `billing` | Billing and subscription |

### Role Types

Roles are categorized by how they can be modified:

| Badge | Description |
|-------|-------------|
| **System** | Cannot be modified. Administrator has full access; Contact is for directory entries only. |
| **Built-in** | Pre-configured roles providing standard access patterns. Cannot be modified directly -- use **Duplicate** to create a customizable copy. |
| _(no badge)_ | Custom roles you create. Fully editable. |

### Built-in Roles

KANAP ships with pre-configured roles organized by functional area:

**Budget**: Budget Administrator, Budget Member, Budget Reader
**Portfolio**: Portfolio Administrator, Portfolio Member, Portfolio Reader, **Business Contributor**
**IT Landscape**: IT Landscape Administrator, IT Landscape Member, IT Landscape Reader
**Master Data**: Master Data Administrator, Master Data Member, Master Data Reader
**Tasks**: Tasks Administrator, Tasks Member, Tasks Reader

#### The Business Contributor Role

The **Business Contributor** role is designed for business stakeholders who participate in the portfolio process without full project management privileges. A Business Contributor can:

- **Submit and manage portfolio requests** (full member access to requests)
- **Edit existing projects** -- update fields, add comments, upload attachments, manage phases, milestones, dependencies, and time entries
- **Create and work on project tasks** -- add tasks to projects, log time, and post comments
- **View users, companies, departments, and contacts** for dropdown selections

A Business Contributor **cannot**:
- Create new projects (requires Member level on portfolio projects)
- Convert requests into projects (requires Member level)
- Import/export CSV (requires Admin level)

This role bridges the gap between read-only access (Reader) and full project management (Member), letting business users actively contribute without the ability to create new projects.

### The Contact Role

The **Contact** role is a special system role for users who appear in dropdown lists but don't need to log in. Common uses:

- Requestors or sponsors who only need to be referenced, not active users
- External stakeholders listed for tracking purposes
- Placeholder entries for organizational structure

**Contact users:**
- Cannot log in to KANAP
- Do not count in the enabled-user total
- Do not receive email notifications (even if assigned to projects/tasks)
- Can be selected in user dropdowns (e.g., as project sponsor)

If someone with the Contact role needs to actively use KANAP, change their role to a regular role (e.g., Viewer, Member) and invite them.

One exception: a person auto-created on their first Microsoft sign-in also holds the Contact role. They can sign in, but they only reach the pending access page until you assign them a role. The grid shows them as **Pending access**.

### Managing Roles

The Roles page has a two-panel layout:
- **Left panel**: List of all roles with badges indicating type, and a user count for each role
- **Right panel**: Details and permissions for the selected role

**Actions**:
- **New Role**: Create a custom role from scratch
- **Duplicate**: Copy an existing role (including built-in roles) as a starting point. Not available for System roles.
- **Delete**: Remove a custom role (only if no users are assigned)
- **Save Details**: Update the role name and description
- **Save Permissions**: Apply permission changes

### Creating a Custom Role

1. Click **New Role**
2. Enter a name and description
3. Click **Create**
4. Set permission levels for each resource group
5. Click **Save Permissions**

**Tip**: Start by duplicating a built-in role that's close to what you need, then adjust permissions.

---

## Billing

Manage your subscription, your invoicing information and your invoices.

### Subscription Overview

The top of the page sums up your subscription in two lines:
- The plan, the billing frequency and the amount, for example "Hosted KANAP · Annual · €2,490.00 / year". The subscription includes unlimited users, billed monthly or annually.
- The status (Active, Trialing, Past due, Canceled, etc.), the renewal date and the payment method, for example "Active · renews 7 Oct 2027 · Visa •••• 4242".

Without a running subscription (a trial, an expired trial or an ended subscription), only the status is shown. During a trial, it comes with the trial end date and the number of days remaining.

### Actions

- **Choose plan** / **Change plan**: Open the plan dialog to subscribe or switch between monthly and annual billing. Requires billing admin.
- **Manage payment**: Open the Stripe customer portal to update the payment method, cancel, or make other changes. Only available once you have subscribed.

If your subscription is unhealthy (expired trial, past due, etc.), the plan selection dialog opens automatically when you visit the Billing page.

To subscribe, by card or by bank transfer, the invoicing information must be complete (see [Invoicing Information](#invoicing-information)). If something is missing, the **Choose a plan** dialog lists the missing fields and the pay buttons stay disabled. Click **Complete invoicing information** to close the dialog and go to the first missing field. Once the details are saved, the pay buttons become available. Changing the plan of a running card subscription does not require this check.

### Invoicing Information

These details appear on your invoices. KANAP copies them to your Stripe customer record when you subscribe and each time a field is saved.

The section holds the company, email, recipient name, phone, address (line 1, line 2, postal code, city, state/province), country and VAT number.

Each field is saved on its own, with no save button. A text field is saved when you leave it or press Enter, and the country as soon as you pick it. "Saving..." and then "Saved" appear next to the section title. To remove a value, clear the field and leave it.

The **Country** field is a searchable list. A country entered as free text in an earlier version shows empty until you pick a country from the list.

Required fields are marked with an asterisk:
- **Company**
- **Email**
- **Address line 1**, **Postal code** and **City**
- **Country**
- **VAT number**, when the country is in the European Union

You can leave the details incomplete and finish them later. While something is missing, a line under the fields lists it, for example "Required before subscribing: email, city." The details must be complete before you can subscribe.

Earlier versions of KANAP had a separate customer information card. If you filled it in, its values appear in the matching empty invoicing fields, and they are saved as invoicing information the next time you change a field.

For a country in the European Union, the VAT number is sent to Stripe and printed on your invoices. If Stripe does not accept it, KANAP shows "The VAT number was not accepted. Check it in the invoicing information." Correct the number and try again.

### Invoice History

Your invoices are listed in a table below the invoicing information:
- Invoice number and date
- Amount
- Status (Draft, Open, Paid, Void, Uncollectible)
- **View**: Open the invoice in Stripe's hosted viewer
- **Download**: Download the invoice PDF

The five most recent invoices are shown first. Click **Show all** to see the others.

---

## Authentication

Configure single sign-on (SSO) for your organization. This page is only available when the SSO feature is enabled and is not accessible from the platform-admin host.

### Microsoft Entra ID

Connect KANAP to your Microsoft Entra ID tenant for SSO:

1. Click **Connect**
2. Sign in with a Microsoft admin account
3. Grant the requested permissions
4. Users can now sign in with their Microsoft accounts

### SSO status

- **Connected**: shows your Entra tenant ID
- **Not connected**: local authentication only

### Actions

| Action | Description |
|--------|-------------|
| **Connect** | Start the Microsoft Entra setup flow |
| **Reconnect** | Re-run the setup flow (shown when already connected) |
| **Test sign-in** | Test SSO login with your Microsoft account |
| **Disconnect** | Remove SSO configuration (reverts to local auth) |

### Daily directory sync

This block appears below the Entra card once single sign-on is connected. Every night at 03:00 server time, KANAP refreshes names, titles, phones, departments and companies from Microsoft Entra, refreshes the manager of the people who are contributors, and disables accounts that were removed or deactivated in the directory.

Departments and companies are matched by name against records that already exist in KANAP. Nothing is created automatically. Empty values in the directory never clear what is already stored in KANAP.

The sync needs a one-time approval by a Microsoft Entra administrator. Until it is granted, the block shows **Not authorized yet. A Microsoft Entra administrator must grant KANAP permission to read directory users.**

| State or action | What it means |
|-----------------|---------------|
| **Not authorized yet...** | No Microsoft Entra administrator has approved the sync, or the required permission is missing from the app registration. |
| **Grant access in Microsoft Entra** | Sends you to Microsoft's approval page. Shown while the sync is not authorized. You return with **Access granted. The first sync is running.** |
| **Last synced {date}: N accounts refreshed, N disabled.** | Result of the last successful run. |
| **The last sync failed: {message}** | The last run did not complete. The message comes from Microsoft. |
| **Sync now** | Runs the sync immediately instead of waiting for tonight. Reports **Sync complete: N accounts refreshed, N disabled.** |

Setup steps for the Entra app registration are in [Microsoft Entra SSO](on-premise/sso-entra.md).

---

## Branding

Use **Admin > Branding** to apply your company identity in KANAP.

- Route: `/admin/branding`
- Permission: `users:admin`
- Scope: tenant hosts only (not available on platform-admin host)

Branding lets you:
- Upload or remove your tenant logo
- Control whether the logo is shown in dark mode
- Set separate primary colors for light and dark mode
- Reset all branding back to default

For full step-by-step instructions, see: [Branding](branding.md)

---

## Sample data

Use **Admin › Sample data** to fill an empty workspace with Fromage & Co, a fictional cheese maker, and to erase the whole workspace afterwards.

- Route: `/admin/sample-data`
- Who: users with the Administrator role
- Scope: cloud workspaces only

For what the set contains, what the erase step removes and keeps, and the home banner, see: [Sample data](sample-data.md)

---

## Settings

The Settings page lets you manage your personal profile and notification preferences. Access it from the user menu (top-right avatar) or navigate to `/settings`.

The page has two tabs, accessible via URL:
- `/settings/profile` (default) -- Profile tab
- `/settings/notifications` -- Notifications tab

### Profile

Edit your personal information:
- **First Name** / **Last Name**
- **Job Title**
- **Business Phone** / **Mobile Phone**

If your organization uses Microsoft Entra ID (SSO), some fields may be synced from Entra and cannot be edited in KANAP.

### Notifications

Control which email notifications you receive.

**Master toggle**: Turn all email notifications on or off with the **Email Notifications** switch at the top.

**Workspace categories** (each with its own enable/disable toggle):

| Workspace | Notification categories |
|-----------|------------------------|
| **Portfolio** | Status changes, when added to a team, team changes on items you lead, comments |
| **Tasks** | Assignment (as assignee, requestor, or viewer), status changes, comments |
| **Budget** | Expiration warnings, status changes, comments |

**Expiration warnings** email the owners of a contract, an OPEX item or a CAPEX item 30, 14, 7 and 1 day(s) before its dates: a contract's cancellation deadline and end date, an OPEX or CAPEX item's end of validity. Only owners who switched on Budget notifications and **Expiration warnings** receive them. The check runs every day at 08:00 UTC. Each reminder is sent once per day to each recipient, even if the check runs again that day, for example after a restart.

**Weekly Review Email**: Receive a periodic summary of your activity and upcoming items. Configure:
- **Day of the week** (e.g., Monday)
- **Time** (hour in your timezone)
- **Timezone**

Use the **Preview email** button to send yourself a test email and verify the format.

All changes are saved automatically as you toggle switches or change selections.

---

## Tips

  - **Duplicate built-in roles**: Instead of creating roles from scratch, duplicate a built-in role and adjust permissions. This saves time and ensures you don't miss important resources.
  - **Use multi-role for flexibility**: Assign users multiple roles to combine permissions -- for example, a "Finance Reader" role plus a "Project Manager" role.
  - **Use SSO**: If you have Microsoft 365, connect Entra ID for easier user management and automatic profile sync.
  - **Disable don't delete**: When someone leaves, disable their account to preserve audit history.
  - **Review permissions regularly**: Audit role permissions periodically to maintain least-privilege access.
