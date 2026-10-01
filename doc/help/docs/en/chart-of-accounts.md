# Charts of Accounts and Account Management

Charts of Accounts (CoA) organize your accounting structure by grouping accounts into named sets. Each company can be linked to a CoA, which determines which accounts are available when recording OPEX or CAPEX items.

## Why use Charts of Accounts?

Without CoAs, all accounts are available to all companies, making it easy to accidentally use the wrong account or mix accounting standards across entities. Charts of Accounts solve this by:

  - **Ensuring consistency**: Companies only see accounts from their assigned CoA
  - **Supporting multiple standards**: Different countries or business units can use different account structures
  - **Simplifying selection**: Account dropdowns show only relevant accounts, not your entire catalog
  - **Enabling templates**: Load pre-configured account sets from country-specific templates

**Example**: Your French subsidiary uses the French PCG (Plan Comptable General), while your UK entity uses UK GAAP. Create two CoAs — one for each standard — and assign companies accordingly. When recording spend, users automatically see the correct accounts.

## The relationship: CoA -> Company -> Accounts

The hierarchy works like this:

```
Chart of Accounts (FR-2024)
  -> assigned to
Company (Acme France)
  -> used when recording
OPEX/CAPEX items -> Account selection (filtered to FR-2024 accounts only)
```

**Key points**:
  - One CoA can be assigned to multiple companies
  - Each company has one CoA
  - Accounts belong to one CoA
  - When you create/edit spend items, the account dropdown is filtered by the company's CoA

## Where to find it

- Path: **Master Data -> Charts of Accounts**
- Permissions:
  - View: `accounts:reader`
  - Create/edit accounts and CoAs: `accounts:manager`
  - Import CSV, Export CSV, Delete: `accounts:admin`

## Working with the list

The page has two layers: a **CoA selector** at the top, and an **accounts grid** below it.

### CoA chip bar

A horizontal row of chips represents each Chart of Accounts. Click a chip to switch the accounts grid to that CoA.

- The selected chip is filled; others are outlined.
- A star badge (**★**) marks the country default for that CoA's country.
- A circle-plus badge marks the global default.
- Hover a chip to see the CoA name and account count.

If you have `accounts:manager` permission, two extra controls appear on the right:

- **New**: Opens the **New Chart of Accounts** dialog.
- **Manage**: Opens the **Manage Charts of Accounts** modal for administration.

When no CoAs exist, the chip bar shows a prompt to create your first Chart of Accounts.

### CoA summary

Below the chip bar, a summary line shows the selected CoA's **code**, **account count**, **name**, and **country** (for country-scoped CoAs).

### Accounts grid

The grid shows accounts for the selected CoA only.

**Default columns**:
- **Account #**: The account number. Click to open the account workspace.
- **Name**: The account name. Click to open the account workspace.
- **Consol. Account #**: The consolidation account number.
- **Consol. Name**: The consolidation account name.

**Additional columns** (hidden by default, enable via the column chooser):
- **Native Name**: The account name in the local language.
- **Description**: Account description.
- **Consol. Description**: Consolidation account description.
- **Status**: Whether the account is enabled or disabled.
- **Created**: Timestamp when the account was created.

**Filtering**:
- Quick search: Searches across visible text columns.
- Status scope: the **Show: All / Enabled / Disabled** toggle above the grid. It defaults to **Enabled**, showing only active accounts. Pick **All** to include disabled accounts.
- Column filters: Use column header filters (e.g., the **Status** column has a set filter). Clicking **Clear** in the **Status** filter, or unticking both values, lists nothing, whatever **Show** says.

**Sort**: Defaults to **Account #** ascending.

**Actions** (in the page header):
- **New Account** (`accounts:manager`): Opens a new account workspace pre-linked to the selected CoA.
- **Import CSV** (`accounts:admin`): Import accounts into the selected CoA.
- **Export CSV** (`accounts:admin`): Export accounts from the selected CoA.
- **Delete Selected** (`accounts:admin`): Delete selected account rows. Select rows using the checkbox column (visible to admins).

All row cells are clickable links to the account workspace. You can right-click or Ctrl+click to open in a new tab.

## The account workspace

Click any row in the accounts grid to open the account workspace.

### Overview

The workspace has a single **Overview** tab with a form to view and edit the account's fields.

**What you can edit**:
- **Chart of Accounts**: The CoA this account belongs to (dropdown of all CoAs in your workspace).
- **Account Number** (required): The account number.
- **Account Name** (required): The account name in English (or your primary language).
- **Native Name (local language)**: The account name in the local language.
- **Description**: Free-text description.
- **Consolidation Account Number**: The standardized consolidation account number.
- **Consolidation Account Name**: The standardized consolidation name.
- **Consolidation Account Description**: Details about the consolidation category.
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. Set an **End of validity** to schedule when the account stops appearing in selection dropdowns. See [Status and lifecycle](#status-and-lifecycle).

**Navigation**:
- **Prev / Next**: Navigate between accounts in the current list order.
- **Save**: Save changes (enabled when the form is dirty and you have `accounts:manager`).
- **Reset**: Discard unsaved changes.
- **Close** (X button): Return to the accounts list, preserving your CoA selection, sort, search, and filters.

If you navigate away with unsaved changes, the system prompts you to save or discard.

**Tip**: You need `accounts:manager` to edit. Read-only users see an info banner.

## Setting up Charts of Accounts

### Creating a CoA

You can create a CoA in two ways:

1. **From scratch**: Choose a Scope and then create an empty CoA.
   - **Scope**: `GLOBAL` (no country) or `COUNTRY` (requires a country selection)
   - For `COUNTRY` scope, you may mark it as the default for that country. Only one default per country exists at a time.
   - You can later load accounts via CSV.
2. **From a template**: Load a pre-configured account set maintained by platform admins.
   - Global templates create a `GLOBAL`-scoped CoA (no country field).
   - Country templates create a `COUNTRY`-scoped CoA with the template's country prefilled.

**Create dialog fields**:
- **Mode**: Choose **Create from scratch** or **Copy from template**.
- **Template** (template mode only): Select a template from the dropdown. Global templates show as "ALL -- ..."; country templates display their 2-letter code.
- **Code** (required): A stable identifier used in CSV exports/imports and deep links.
- **Name** (required): A descriptive name for the CoA.
- **Scope**: `Country` or `Global`.
- **Country** (country scope only): Select a country from the list.
- **Set as default for this country** (country scope only): Check to make this the default CoA for the selected country.

In template mode, you can run **Preflight** before creating to see how many accounts will be inserted and updated. Then click **Create** to finalize.

**Defaults**:
  - Per-country: You can mark one CoA as the default for each country. New companies from that country are automatically assigned to that CoA (you can change it later in the company's Overview tab).
  - Global fallback: Your workspace can have a Global Default CoA used for countries that don't have a country-specific default yet. Country defaults take precedence; the global default applies everywhere else.

### Loading from templates

Templates are standard account sets managed by platform administrators. They can be:
  - Country-specific (e.g., French PCG, UK GAAP)
  - Global (available for all countries)

**How it works**:
  - Go to **Master Data -> Charts of Accounts**
  - Click **New** in the chip bar
  - Select **Copy from template** mode
  - Select a template; global templates show as "ALL -- ..." (loads a `GLOBAL` CoA); country templates display their 2-letter code
  - The system shows a preflight report (how many accounts will be inserted/updated)
  - Confirm to copy accounts into your CoA

**What gets copied**: Account numbers, names, native names (local language), descriptions, consolidation mappings, and status. The accounts become yours to edit — changes to the platform template won't affect your CoA unless you explicitly reload it.

**Tip**: After loading a template, you can add company-specific accounts, rename entries, or disable unused accounts. Templates provide a starting point, not a locked structure.

### Available templates

KANAP ships with **20 pre-configured templates** covering 10 accounting standards. Each standard comes in two versions:

- **v1.0 (Simple)**: A focused set of ~20 IT-relevant accounts — software licenses, cloud hosting, cybersecurity, telecom, consulting, staff costs, training, and more. Best for organizations that want a lean starting point.
- **v2.0 (Detailed)**: Everything in v1.0 plus additional granular sub-accounts (~30 accounts). Adds breakdowns like Purchased vs. Internally Developed Software, Network Equipment, SaaS vs. Perpetual Licenses, Mobile Communications, IT Bonuses, IT Insurance, and more. Best for organizations that need finer cost tracking.

Both versions use **real account numbers from each country's official accounting standard** and include native names in the local language.

| Template Code | Country | Standard | Accounts (v1 / v2) |
|---------------|---------|----------|---------------------|
| **IFRS** | Global | International Financial Reporting Standards | 14 / 30 |
| **FR-PCG** | France | Plan Comptable General | 20 / 31 |
| **DE-SKR03** | Germany | Standardkontenrahmen 03 | 20 / 32 |
| **GB-UKGAAP** | United Kingdom | UK GAAP | 20 / 31 |
| **ES-PGC** | Spain | Plan General de Contabilidad | 20 / 31 |
| **IT-PDC** | Italy | Piano dei Conti | 20 / 31 |
| **NL-RGS** | Netherlands | Rekeningschema (RGS) | 20 / 31 |
| **BE-PCMN** | Belgium | Plan Comptable Minimum Normalise | 20 / 31 |
| **CH-KMU** | Switzerland | Kontenrahmen KMU | 20 / 31 |
| **US-USGAAP** | United States | US GAAP | 20 / 32 |

**Choosing a version**:

  - Start with **v1.0** if you want a clean, minimal chart that covers the essential IT cost categories. You can always add accounts later.
  - Choose **v2.0** if your organization tracks IT spending at a granular level (e.g., distinguishing SaaS subscriptions from perpetual licenses, or splitting IT salaries from bonuses).

### IFRS consolidation built in

All templates — regardless of country — map every account to one of **14 standardized IFRS consolidation accounts**. This means group-level reporting works out of the box, even across different local standards.

| # | Consolidation Account | What it covers |
|---|-----------------------|----------------|
| 1000 | Tangible Assets (CAPEX) | Physical IT equipment — servers, workstations, network gear |
| 1100 | Intangible Assets (CAPEX) | Capitalized software and development costs |
| 1200 | Depreciation & Amortization | Depreciation of hardware and software |
| 1300 | Impairments & Write-offs | Asset impairments and write-downs |
| 2000 | Software Licenses (OPEX) | Perpetual licenses, SaaS subscriptions, open-source support |
| 2100 | Cloud & Hosting Services | IaaS, PaaS, monitoring, cybersecurity tools |
| 2200 | Telecommunications & Network | Internet, mobile, WAN/LAN |
| 2300 | Maintenance & Support | Hardware and software maintenance contracts |
| 2400 | IT Consulting & External Services | Advisory, systems integration, contractors |
| 2500 | IT Staff Costs | Salaries, bonuses, social charges, pensions |
| 2600 | Training & Certification | Training programs, certifications, conferences |
| 2700 | Workplace IT (Non-capitalized) | End-user devices below capitalization threshold |
| 2800 | Travel & Mobility (IT Projects) | Project-related travel |
| 2900 | Other IT Operating Expenses | Miscellaneous IT costs, cyber insurance |

**Example**: Your French subsidiary loads **FR-PCG v1.0** and your German subsidiary loads **DE-SKR03 v1.0**. Both use different local account numbers and native names, but every account maps to the same IFRS consolidation structure. Group-level reports aggregate seamlessly without any manual mapping work.

### Global Default CoA (Provisioning)

New workspaces are automatically provisioned with the **IFRS v1.0** template. This creates a `GLOBAL`-scoped CoA containing the 14 IFRS consolidation accounts and sets it as the tenant's Global Default, so companies can use it immediately without any setup. You can edit or delete the preloaded accounts/CoA later as needed (subject to standard guardrails).

Global CoAs are shown with scope metadata in the **Manage** modal, with no country value for `GLOBAL` entries. Only `GLOBAL` CoAs can be marked as the Global Default, and only `COUNTRY` CoAs can be set as a per-country default.

## Managing Charts of Accounts

### The Manage modal

Click **Manage** in the chip bar to open the administration modal. The modal has two panels:

**Left panel** — CoA list:
- Shows all your Charts of Accounts with their codes and names.
- Default badges: **★** for country default, circle-plus for global default.
- Click a row to view its details.

**Right panel** — CoA details:
- **Code** and **Name**
- **Scope**: `GLOBAL` or `COUNTRY`
- **Country** (for country-scoped CoAs)
- **Country Default**: Yes/No
- **Global Default**: Yes/No
- **Linked Companies**: Number of companies assigned to this CoA
- **Accounts**: Number of accounts in this CoA

**Actions** (in the modal toolbar):
- **New** (`accounts:manager`): Opens the Create CoA dialog.
- **Set Country Default** (`accounts:manager`): Mark the selected country-scoped CoA as the default for its country. Disabled for global CoAs.
- **Set Global Default** (`accounts:manager`): Mark the selected global-scoped CoA as the global default. Disabled for country CoAs.
- **Delete Selected** (`accounts:admin`): Delete the selected CoA. Deletion is blocked if any companies reference it or any OPEX/CAPEX items use its accounts.

## Managing Accounts

### Account numbers

Account numbers are stored as text but typically contain numeric values. When editing accounts:
  - You can enter numbers (e.g., `6011`) or text (e.g., `6011-TRAVEL`)
  - The system automatically converts numeric inputs to strings
  - Within a CoA, account numbers should be unique (enforced after backfill)

### Native names for multilingual support

Some countries require accounts to be recorded in the local language. Use the **Native Name** field to store the original name while keeping the English name in the main **Account Name** field.

**Example**: French account
  - **Account Name**: `Travel expenses` (English, for reporting)
  - **Native Name**: `Frais de deplacement` (French, for legal compliance)

The native name is available as a hidden column in the accounts grid. Enable it from the column chooser to view both names side by side.

## Consolidation accounts (Group-level reporting)

For multi-country organizations, daily work is done using local Charts of Accounts (French PCG, UK GAAP, German HGB, etc.), but group-level reporting often requires consolidation to a common standard like **IFRS** or **US GAAP**.

**Consolidation accounts** solve this by mapping local accounts to standardized consolidation accounts.

### How it works

Each account can have three consolidation fields:
  - **Consolidation Account Number**: The standardized account number (e.g., IFRS account `6200`)
  - **Consolidation Account Name**: The standardized name (e.g., `IT Services and Software`)
  - **Consolidation Account Description**: Optional details about the consolidation category

**Example mapping**:

| Country | Local CoA | Local Account | Local Name | -> | Consolidation Account | Consolidation Name |
|---------|-----------|---------------|------------|---|----------------------|-------------------|
| France | FR-PCG | 6061 | Frais postaux | -> | 6200 | IT Services and Software |
| UK | UK-GAAP | 5200 | Postage and courier | -> | 6200 | IT Services and Software |
| Germany | DE-HGB | 4920 | Portokosten | -> | 6200 | IT Services and Software |

All three local accounts map to the same IFRS consolidation account `6200`, enabling group-level aggregation.

### Why this matters

**Daily operations**: Users work with their familiar local accounts
  - French users select account `6061 - Frais postaux`
  - UK users select account `5200 - Postage and courier`
  - German users select account `4920 - Portokosten`

**Group reporting**: The system can roll up costs by consolidation account
  - All IT services costs across countries aggregate to `6200 - IT Services and Software`
  - Management sees a unified view regardless of local accounting differences
  - Statutory reporting per country still uses local accounts

### Setting up consolidation mappings

**Option 1: Templates (recommended)**
All built-in templates include IFRS consolidation mappings on every account. Load any country template and the consolidation columns are already filled in — no manual mapping needed. See [Available templates](#available-templates) for the full list.

**Option 2: CSV import**
When importing accounts, include the consolidation fields in your CSV:

```
coa_code;account_number;account_name;consolidation_account_number;consolidation_account_name;consolidation_account_description
FR-PCG;6061;Frais postaux;6200;IT Services and Software;
UK-GAAP;5200;Postage and courier;6200;IT Services and Software;
DE-HGB;4920;Portokosten;6200;IT Services and Software;
```

**Option 3: Manual entry**
Edit accounts individually and fill in the consolidation fields in the account workspace.

### Best practices

  - **Use a common standard**: IFRS is typical for European groups; US GAAP for American companies. All built-in templates already map to the same 14 IFRS consolidation accounts (see [IFRS consolidation built in](#ifrs-consolidation-built-in))
  - **Maintain a consolidation chart**: Keep a reference document listing your consolidation accounts and what they represent. If you use the built-in templates, the 14 IFRS accounts serve as this reference
  - **Map at the right granularity**: Don't consolidate too broadly (loses insight) or too narrowly (too complex)
  - **Involve finance**: Consolidation account mappings should align with your group's financial reporting requirements
  - **Update systematically**: When you add local accounts, immediately map them to consolidation accounts

### Reporting with consolidation accounts

When building reports, you can choose to group by:
  - **Local accounts**: Shows country-specific detail (for local management)
  - **Consolidation accounts**: Shows group-level categories (for executive reporting)

This dual view lets you satisfy both local compliance requirements and group reporting needs without maintaining duplicate data.

## Legacy accounts (migration support)

**Legacy accounts** are accounts without a `coa_id` (created before Charts of Accounts were introduced).

**How they work**:
  - Companies WITHOUT a CoA can use legacy accounts
  - Companies WITH a CoA cannot use legacy accounts — they're filtered out automatically
  - Legacy accounts can still be migrated via CSV (`coa_code`) and reassignment workflows

**Migration path**:
  1. Create or load Charts of Accounts for your companies
  2. Assign CoAs to companies (in Company Overview tab)
  3. Assign `coa_id` to your legacy accounts (via CSV import with `coa_code` or bulk edit)
  4. Update existing OPEX/CAPEX items that show "obsolete account" warnings

**Tip**: You don't have to migrate everything at once. Companies without a CoA continue to work with legacy accounts, allowing gradual adoption.

## Obsolete account warnings

When editing OPEX or CAPEX items, you might see:

```
Obsolete account detected. The selected account does not belong to
the company's Chart of Accounts. Please update the account.
```

**Why this happens**:
  - The item's account belongs to CoA "A"
  - The item's company belongs to CoA "B"
  - Mismatch detected

**Common scenarios**:
  - You migrated a company to a new CoA but haven't updated old spend items yet
  - An account was manually reassigned to a different CoA
  - You're viewing historical data from before the CoA migration

**How to fix it**: Edit the item and select an account from the company's current Chart of Accounts. The warning will disappear once the account matches the company's CoA.

## Status and lifecycle

Accounts use the same lifecycle management as other master data:

  - **Enabled** by default
  - Set an **End of validity** to stop using an account from a specific date. Leave it blank to keep the account active indefinitely
  - Switching the account to **Disabled** without a date sets its end of validity to today
  - When the end of validity passes, the status switches to **Disabled** on its own within the hour
  - After the end of validity:
      - The account no longer appears in selection dropdowns for new items
      - Historical data remains intact; existing items keep their account assignments
      - Reports for years when the account was active still include it
  - The accounts grid defaults to showing **Enabled** accounts only. Use the **Show: All / Enabled / Disabled** toggle to pick **All** and include disabled accounts.

## Tenant deletion and CoA

When a workspace (tenant) is deleted by a platform administrator, all tenant-owned accounting data is permanently removed as part of the purge process:
- Charts of Accounts (`chart_of_accounts`)
- Accounts (`accounts`)
- Links from companies to a CoA (`companies.coa_id`)

Deletion is immediate and irreversible. The tenant record remains for auditability, and its slug is cleared for reuse.

**Tip**: Prefer disabling over deleting. Deletion is only allowed if no OPEX/CAPEX items reference the account.

## CSV import/export

### Charts of Accounts

You can export a list of your CoAs (with metadata like code, name, country, default status) but not import CoAs directly via CSV. Create CoAs through the UI or load them from templates.

### Accounts (global endpoint)

The global `/accounts` CSV includes a `coa_code` column to identify which CoA each account belongs to.

  - **Export**
      - **Template**: headers only (use this to prepare imports)
      - **Data**: all accounts with their CoA codes, account numbers, names, native names, descriptions, consolidation mappings, and status
  - **Import**
      - Start with **Preflight** (validates structure, encoding, required fields, duplicates)
      - If Preflight is OK, **Load** applies inserts/updates
      - **Matching**: by `(coa_code, account_number)` within your workspace
      - **Required fields**: `coa_code`, `account_number`, `account_name`
      - **Optional fields**: `native_name`, `description`, consolidation fields, `status`
      - Duplicates in the file (same coa_code + account_number) are deduplicated; first occurrence wins

**CSV schema** (semicolon `;` separated, UTF-8):
```
coa_code;account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

### Accounts (CoA-scoped)

From the Charts of Accounts page, **Import CSV** and **Export CSV** are automatically scoped to the currently selected CoA.

  - **Export**: accounts from this CoA (no `coa_code` column needed)
  - **Import**: accounts are inserted/updated into this CoA automatically

**CSV schema** (CoA-scoped, semicolon `;` separated, UTF-8):
```
account_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status
```

**Notes**:
  - Use **UTF-8 encoding** and **semicolons** as separators
  - The `coa_code` must match an existing Chart of Accounts in your workspace
  - Account numbers should be unique within a CoA
  - Status values: `enabled` or `disabled` (defaults to enabled)

## Tips

  - **Start with templates**: KANAP ships with templates for 9 countries plus IFRS. Load one instead of building from scratch — you get proper account numbers, native names, and IFRS consolidation mappings out of the box. Start with v1.0 (Simple) if unsure; upgrade to v2.0 (Detailed) if you need more granularity.
  - **One default per country**: Set a default CoA for each country so new companies are automatically assigned to the right account structure.
  - **Native names for compliance**: Use the Native Name field if local regulations require accounts in the local language. Enable the **Native Name** column in the grid to see both names at a glance.
  - **Migrate gradually**: You don't have to convert everything at once. Companies without CoAs continue to work with legacy accounts.
  - **Fix obsolete accounts**: When you see warnings, update the account to match the company's current CoA. This keeps your data clean for reporting.
  - **Disable over delete**: Disabling accounts preserves history. Only delete accounts that were created by mistake and have never been used.
  - **CSV imports are additive**: Importing accounts adds new ones and updates existing ones (matched by coa_code + account_number). It doesn't delete accounts not in the file.
  - **Consolidation accounts are key for groups**: If you operate in multiple countries, set up consolidation mappings from day one. This makes group-level reporting effortless and keeps local users working with familiar accounts.
  - **IFRS as consolidation standard**: Most European groups use IFRS for consolidation. All built-in templates already map to the same 14 IFRS consolidation accounts, so group reporting works across countries with no extra setup.
  - **Deep linking**: The URL preserves your selected CoA, sort order, search text, and filters. Share or bookmark a link to return to exactly the same view.

## Common scenarios

### Scenario 1: Multi-country organization

You have subsidiaries in France, UK, and Germany, each following local accounting standards.

**Setup**:
  1. Load three templates: **FR-PCG v1.0**, **GB-UKGAAP v1.0**, **DE-SKR03 v1.0** (or v2.0 for more granularity)
  2. Set each as the default for its country
  3. Assign companies to their respective CoAs
  4. New companies automatically get the right CoA; account selection is filtered accordingly
  5. Consolidation mappings are already in place — group reports work immediately

### Scenario 2: Migrating from legacy to CoA

You have 50 accounts and 5 companies, all set up before Charts of Accounts existed.

**Migration steps**:
  1. Create a CoA (e.g., `US-GAAP`)
  2. Export your accounts to CSV
  3. Add a `coa_code` column (e.g., `US-GAAP`) to all rows
  4. Import the updated CSV (accounts now belong to the CoA)
  5. Assign the CoA to your companies
  6. Edit any OPEX/CAPEX items showing "obsolete account" warnings

### Scenario 3: Switching a company to a new CoA

Your UK subsidiary switches from UK GAAP to IFRS.

**Steps**:
  1. Create a new CoA: `UK-IFRS` (or load from template)
  2. In the company's Overview tab, change Chart of Accounts to `UK-IFRS`
  3. Going forward, users can only select accounts from `UK-IFRS`
  4. Existing OPEX/CAPEX items keep their old accounts but show warnings
  5. Update items as needed (or leave historical data as-is if reporting allows)

### Scenario 4: Setting up group consolidation (multi-country)

Your group has subsidiaries in France, UK, and Germany. Each country uses its local accounting standard, but you need consolidated IFRS reporting.

**Setup**:
  1. Load country templates with built-in IFRS consolidation:
      - **FR-PCG v1.0** — French Plan Comptable General (20 accounts)
      - **GB-UKGAAP v1.0** — UK GAAP (20 accounts)
      - **DE-SKR03 v1.0** — Standardkontenrahmen 03 (20 accounts)

  2. Every account in these templates already maps to one of the 14 IFRS consolidation accounts. For example:
      - FR-PCG `205000` (Logiciels informatiques) -> IFRS `1100` (Intangible Assets)
      - GB-UKGAAP `510` (Capitalized Software) -> IFRS `1100` (Intangible Assets)
      - DE-SKR03 `27` (EDV-Software) -> IFRS `1100` (Intangible Assets)

  3. Set each CoA as the default for its country and assign companies

**Result**:
  - French users work with French PCG accounts and native names in their daily tasks
  - UK users work with UK GAAP accounts
  - German users work with SKR03 accounts and German native names
  - Group finance runs reports by consolidation account to see total spend in IFRS categories
  - No manual mapping work needed — the templates handle it all
  - Both local statutory reporting and group IFRS reporting work seamlessly from the same data

## Frequently asked questions

**Q: Can I have accounts that belong to multiple CoAs?**
A: No. Each account belongs to exactly one CoA (or none for legacy accounts). If you need the same account structure in multiple CoAs, load the template into each one or use CSV export/import with different `coa_code` values.

**Q: What happens if I delete a Chart of Accounts?**
A: Deletion is blocked if any companies reference it or any OPEX/CAPEX items use its accounts. Reassign companies and update items first, then you can delete the CoA. Deleting a CoA also deletes all accounts within it that aren't referenced elsewhere.

**Q: Can I rename account numbers?**
A: Yes, in the account's workspace. Changing the account number updates all references in OPEX/CAPEX items automatically (the account's UUID remains the same internally).

**Q: How do I see which companies use a specific CoA?**
A: Open **Manage** on the Charts of Accounts page, select the CoA, and check **Linked Companies** in the details panel. You can also filter the Companies page by CoA.

**Q: What if my country doesn't have a template?**
A: KANAP includes templates for 9 countries (FR, DE, GB, ES, IT, NL, BE, CH, US) plus IFRS as a global standard. If your country isn't covered, create a CoA from scratch and add accounts manually or via CSV import. You can still use the IFRS consolidation account numbers (1000-2900) in your consolidation mappings to stay compatible with the built-in templates.

**Q: What's the difference between v1.0 and v2.0 templates?**
A: **v1.0 (Simple)** has ~20 IT-focused accounts covering essential cost categories. **v2.0 (Detailed)** adds ~10 more granular sub-accounts for finer tracking (e.g., splitting SaaS subscriptions from perpetual licenses, or IT salaries from bonuses). Both versions use the same consolidation mappings. Start with v1.0 and switch to v2.0 if you need more detail.

**Q: Can I edit accounts that came from a template?**
A: Yes. Once you load a template, the accounts are copied into your CoA and become fully editable. Changes to the platform template don't affect your CoA unless you explicitly reload it (which overwrites your changes if you choose "overwrite" mode).

**Q: Are consolidation account mappings required?**
A: No, they're optional. If you only operate in one country or don't need group-level consolidation, you can leave these fields empty. Consolidation accounts are only needed for multi-country organizations that report at group level using a different standard than their local accounting.

**Q: Can multiple local accounts map to the same consolidation account?**
A: Yes, that's the whole point! Many local accounts across different CoAs can map to the same consolidation account. This is how you aggregate costs from different countries into a single consolidated category.

**Q: What happens if I change a consolidation mapping?**
A: Existing OPEX/CAPEX items don't store consolidation data directly — they reference the account, which has the consolidation mapping. When you change a mapping, all historical and future items using that account will report under the new consolidation account. Update mappings carefully if you need to preserve historical reporting categories.
