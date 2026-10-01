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

Authentication and Branding are available from the sidebar navigation but do not appear on the Admin hub landing page.

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

### Seat Management

The hosted subscription includes **unlimited users** -- there is no seat limit to manage:
- **Enabled users**: Can log in and use KANAP
- **Disabled users**: Keep their data but can no longer log in
- The counter in the toolbar shows how many enabled users you have
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
- **Contributor**: View and edit existing items, add comments and attachments, but cannot create new top-level items (currently used for portfolio projects)
- **Member**: View, create, and edit
- **Admin**: Full access including delete

### Permission Groups

Resources are organized into groups for easier management:

**Budget & Finance**
| Resource | What it controls |
|----------|------------------|
| `opex` | Operating Expenses |
| `capex` | Capital Expenses |
| `budget_ops` | Budget Administration tools |
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
| `settings` | Application settings |

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

Manage your subscription, users, and invoices.

### Subscription Overview

The subscription card shows your current plan at a glance:
- **Plan**: Hosted KANAP (or Free trial). The subscription includes unlimited users -- billed monthly or annually
- **Seats**: Number of enabled users
- **Status**: Active, Trialing, Past Due, Canceled, etc.
- **Renewal date**: When the next billing cycle starts

For active subscriptions (not local trials), additional details are shown:
- **Amount per period**: Cost for the current billing cycle
- **Billing frequency**: Monthly or Annual
- **Collection method**: Automatic charge or Invoice (manual payment)
- **Payment method**: Card details or Bank transfer
- **Last Stripe sync**: When subscription data was last updated from Stripe

If the subscription is in a trial period, the remaining trial days are displayed.

### Actions

- **Choose plan** / **Change plan**: Open the plan dialog to subscribe or switch between monthly and annual billing. Requires billing admin.
- **Manage subscription**: Open the Stripe customer portal to update payment methods, cancel, or make other changes. Only available when a Stripe subscription exists.

If your subscription is unhealthy (expired trial, past due, etc.), the plan selection dialog opens automatically when you visit the Billing page.

### Invoice History

Past invoices are displayed below the subscription card:
- Invoice number and date
- Status (Draft, Open, Paid, Voided, Uncollectible)
- Amount and currency
- **View**: Open the invoice in Stripe's hosted viewer
- **Download**: Download the invoice PDF

By default, the five most recent invoices are shown. Click **Show more invoices** to see the full history.

### Customer Information

Update the contact details associated with your Stripe customer record:
- **Customer name** and **Company**
- **Email** and **Phone**
- **VAT number**
- **Address** (line 1, line 2, city, state/province, postal code, country)

### Invoicing Information

Separate contact details used specifically on invoices. Click **Copy from customer** to pre-fill from the customer information above.

Fields match the customer information section: recipient name, company, email, phone, VAT number, and full address.

Click **Save changes** to update both customer and invoicing details. Use **Reset** to discard unsaved edits.

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
