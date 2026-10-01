# Contracts

Contracts document your vendor agreements -- software licenses, maintenance contracts, SaaS subscriptions, and service agreements. Track key dates, costs, renewal terms, and link contracts to your OPEX and CAPEX items for complete cost visibility.

## Getting started

Navigate to **Budget Management > Contracts** to see your contract registry. Click **New** to create your first entry.

**Required fields**:

- **Name**: A recognizable contract name
- **Supplier**: The vendor providing the service
- **Company**: Which company signed the contract

**Strongly recommended** (set these on the Details tab right after creation):

- **Start Date**: When the contract begins
- **Duration**: Contract length in months
- **Yearly Amount**: The annual contract value
- **Currency**: Contract currency
- **Auto-renewal**: Whether the contract renews automatically
- **Notice Period**: How many months notice required to cancel

**Tip**: The system automatically calculates the end date and cancellation deadline based on your start date, duration, and notice period.

---

## Working with the list

The Contracts grid provides an overview of all your vendor agreements. Each row is a clickable link that opens the contract workspace, and your search and filter context is preserved when you navigate back.

**Default columns**:

- **Contract**: Contract name (click to open workspace)
- **Supplier**: The vendor
- **Company**: The contracting entity
- **Start**: Contract start date
- **Duration (m)**: Length in months
- **Auto-renewal**: Whether the contract auto-renews (yes/no)
- **Notice (m)**: Notice period in months
- **End**: Calculated end date
- **Cancel by**: Cancellation deadline (end date minus notice period)
- **Yearly amount**: Annual contract value (formatted with space separators)
- **Curr**: Currency code
- **Billing**: Billing frequency (Monthly, Quarterly, Annual, Other)
- **Linked OPEX**: Number of linked OPEX items (click to open workspace)
- **Status**: **Enabled** or **Disabled**, read from the end of validity

**Additional columns** (via column chooser):

- **Task**: Latest task for this contract (status and description preview)

**Default sort**: By cancellation deadline ascending, so contracts requiring action soon appear first.

**Filtering**:

- Quick search: Searches across contract name, supplier, and company
- Column filters: Available on each column header. The **Status** filter offers **Enabled** and **Disabled**. Clicking **Clear** in it, or unticking both values, lists nothing, whatever **Show** says
- **Status scope**: the **Show: All / Enabled / Disabled** toggle above the list. The list shows enabled contracts by default. Pick **All** or **Disabled** to find contracts past their end of validity

**Actions**:

- **New**: Create a new contract (requires `contracts:manager`)
- **Import CSV**: Bulk import contracts (requires `contracts:admin`)
- **Export CSV**: Export to CSV (requires `contracts:admin`)

---

## The Contracts workspace

Click any row to open the workspace. The header shows the contract name, your position in the list (e.g., "Contract 3 of 42"), and navigation controls:

- **Prev / Next**: Move between contracts without returning to the list
- **Reset**: Discard unsaved changes on the current tab
- **Save**: Persist your edits
- **Close** (X icon): Return to the list, preserving your search and filter context

The workspace has four vertical tabs: **Overview**, **Details**, **Relations**, and **Tasks**.

### Overview

The Overview tab captures the contract's identity and lifecycle status.

**What you can edit**:

- **Contract Name**: The display name used across lists and reports
- **Supplier**: Link to a supplier from master data
- **Contracting Company**: Which company is party to this contract
- **Owner**: The person responsible for managing this contract
- **Notes**: Free-form notes
- **Status switch**: labelled with the current state (**Enabled** or **Disabled**). Switching the contract to **Disabled** without a date sets its end of validity to today
- **End of validity**: the date the contract stops. Type a date in dd/mm/yyyy format or use the calendar button. Leave it blank to keep the contract active indefinitely

**How it works**:

- When creating a new contract, only the Overview tab is available. Once you save, the remaining tabs become accessible and you are taken directly to the Details tab to fill in financial terms.
- Name, Supplier, and Company are required to create a contract.

---

### Details

The Details tab captures dates, terms, and financial information.

**What you can edit**:

- **Start Date**: When the contract begins (dd/mm/yyyy)
- **Duration (months)**: Contract length
- **Notice (months)**: Cancellation notice required
- **Yearly amount**: The annual contract value at signature
- **Currency**: Three-letter currency code (e.g., EUR, USD)
- **Billing frequency**: Monthly, Quarterly, Annual, or Other
- **Auto-renewal**: Whether the contract automatically renews

**Calculated fields** (read-only):

- **End date**: Start date plus duration
- **Cancellation deadline**: End date minus notice period

---

### Relations

The Relations tab links contracts to other entities in your registry.

**Available links**:

- **OPEX items**: Recurring costs associated with this contract -- use the searchable multi-select to find and link items by product name
- **CAPEX items**: Capital expenditure items linked to this contract -- same searchable multi-select interface
- **Contacts**: People associated with this contract, each with a role (Commercial, Technical, Support, or Other). Contacts inherited from the supplier are shown with a filled badge; manually added ones appear with an outlined badge. Click a contact row to open their profile.
- **Relevant websites**: Links to external documents such as contract PDFs or vendor portals. Each link has a description and a URL.
- **Attachments**: Upload files by drag-and-drop or using the file picker. Click an attachment chip to download it; click the delete icon to remove it.

**Tip**: Linking OPEX and CAPEX items to contracts gives you complete cost traceability -- from budget line items to vendor agreements.

---

### Tasks

The Tasks tab manages action items for this contract (e.g., renewal reviews, price negotiations, compliance checks).

**Task list**:

- Shows all tasks linked to this contract
- Columns: Title, Status, Priority, Due Date, Actions
- Click a task title to open the full task workspace

**Filtering**:

- Click the filter icon to show or hide filter controls
- **Status filter**: All, Active (hides done/cancelled), or a specific status (Open, In Progress, Pending, In Testing, Done, Cancelled)
- Click the clear button to reset filters
- Default filter shows active tasks only

**Creating a task**:

- Click **Add Task** to open the task creation workspace
- The task is automatically linked to this contract
- Fill in the title, description, priority, assignee, and due date in the task workspace

**Deleting a task**:

- Click the delete icon in the Actions column
- Confirm the deletion in the dialog

**Note**: The Tasks tab is only available after the contract has been saved for the first time. If you don't have `contracts:manager` permission, the Add Task and Delete buttons are hidden.

---

## CSV import/export

Keep your contract registry in sync with external systems using CSV.

**Export**: Downloads all contracts with core fields and calculated dates. The `status` column holds the status read from the end of validity.

**Import**:

- Use **Preflight** to validate before applying
- A row is matched to a contract by contract name and supplier
- Supports creation and updates
- The file has no end of validity column. On an update, a blank `status`, or one equal to the contract's current status, keeps its end of validity. A different status applies it: `enabled` clears the end of validity, and `disabled` ends the contract today unless its end of validity has already passed
- A new contract is enabled unless the row says `disabled`

**Notes**:

- Use **UTF-8 encoding** and **semicolons** as separators
- Calculated fields (End Date, Cancellation Deadline) are not imported -- they are computed from Duration and Notice Period

---

## Tips

- **Watch the Cancel by column**: The list sorts by cancellation deadline by default, so contracts needing attention appear first.
- **Link to OPEX and CAPEX early**: Connect contracts to cost items when creating them for complete cost tracking.
- **Use tasks for renewals**: Create a task 3--6 months before the cancellation deadline for renewal review.
- **Track yearly amounts**: Even if billing is monthly, record the yearly amount for easier year-over-year comparison.
- **Deep-link from the list**: You can share a direct link to any contract -- the workspace URL includes the contract ID and preserves your list context (search, sort, filters) so the back button returns you exactly where you were.
