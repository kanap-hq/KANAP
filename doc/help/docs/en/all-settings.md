# All settings

The All settings page lists, on one screen, every settings page you can open: your own account, the settings of each module, the administration of your organization and, depending on your installation, the installation or platform pages. Use it when you know what you want to change but not where it lives.

## Where to find it

- From the account menu (the person icon at the top right): **All settings**, above your account entry. Every signed-in person has it.
- In the **Administration** menu: **All settings**, the last entry, below the other sections.
- Route: `/admin/all-settings`

## How the list is organized

The pages are grouped in this order:

- **My account**: your profile, notifications, appearance, connected apps and the arrangement of your home page.
- **One group per module**: AI agents, Portfolio, IT landscape, Knowledge and Budget management, in the order of the top bar.
- **Administration**: users, roles, data access, audit log, billing, sign-in, branding, AI and integrations.
- **Installation**: on an installation on your own servers, the pages that set up the installation itself, such as scheduled tasks.
- **Platform**: on the platform host of the cloud service, the platform administration pages.

Each line gives the name of the page and, in grey, the menu path that leads to it. Click the name to open the page. When the page has tabs and the tab is part of its address, the link opens that tab directly (for example **Notifications** or **Netbox**). A setting that lives in a dialog, such as the contract decision window or the knowledge document types, opens the page that holds the dialog.

## Search

Type in the search field to filter the list. The search looks at the names of the pages and at the names of their main settings, in your language. Case and accents do not matter.

For example, **reporting currency** finds the **Currencies** page of Budget management, because the reporting currency is set there. Several words narrow the list: every word must appear.

When nothing matches, the page says so in one line.

## What the list shows you

The list shows only the pages you can open with your roles, exactly as the menus do:

- A page you can read but not change is listed. It opens in read-only mode.
- A page you cannot open does not appear, and neither does a group left empty.
- Pages that depend on a feature appear only when that feature is on: billing in the cloud, Microsoft sign-in when it is configured, the AI pages when AI is enabled.
- With limited data access, the budget administration and the data access pages are not listed.
- On an installation on your own servers, the cloud-only pages (billing, sample data) are not listed. The **Installation** group shows to the Administrator role.
- On the platform host, the list holds the platform pages only.

Nothing is changed from this page: it only leads to the pages where the settings are made.
