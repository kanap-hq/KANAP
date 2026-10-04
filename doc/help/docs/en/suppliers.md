# Suppliers

Suppliers (also known as vendors) represent the companies you purchase software, services, and support from. Link suppliers to applications, contracts, and OPEX items to track vendor relationships and spending across your IT portfolio.

## Getting started

Navigate to **Master Data > Suppliers** to open the supplier directory. Click **New** to create your first entry.

**Required fields**:
- **Name**: The supplier or vendor name

**Optional but useful**:
- **ERP Supplier ID**: Reference ID from your ERP or procurement system
- **Notes**: Free-form notes about the vendor relationship

**Tip**: Create suppliers before adding applications or contracts -- you will be able to link them during creation.

---

## Working with the list

The Suppliers list gives you a searchable, sortable directory of all your vendors.

**Default columns**:
- **Name**: Supplier name (click to open workspace)
- **ERP Supplier ID**: Reference ID from external systems

**Additional columns** (via column chooser):
- **Status**: Enabled or Disabled
- **Notes**: Additional information
- **Created**: When the record was created

Every cell in a row is clickable and navigates to that supplier's workspace.

**Default sort**: By name, alphabetical.

**Filtering**:
- Quick search: Searches across supplier fields
- Status scope: Use the **Show: All / Enabled / Disabled** toggle above the grid to filter by status. The list shows enabled suppliers by default

**Actions**:
- **New**: Create a new supplier (requires `suppliers:manager`)
- **Import CSV**: Bulk-import suppliers (requires `suppliers:admin`)
- **Export CSV**: Export the list to CSV (requires `suppliers:admin`)
- **Delete Selected**: Remove selected suppliers (requires `suppliers:admin`)

---

## The Supplier workspace

Click any row to open the workspace. Use **Prev** and **Next** to step through suppliers without returning to the list. If you have unsaved changes, KANAP will prompt you before navigating away.

The workspace has two tabs: **Overview** and **Contacts**.

### Overview

The Overview tab captures the supplier's identity and status.

**What you can edit**:
- **Name**: Supplier or vendor name (required)
- **ERP Supplier ID**: Reference ID from your procurement or ERP system
- **Lifecycle**: the status switch, labelled with the current state (**Enabled** or **Disabled**), and the **End of validity** date. Leave the date blank to keep the supplier active indefinitely, or set a future date to schedule its end. Switching the supplier to **Disabled** without a date sets the end of validity to today
- **Notes**: Free-form notes about the vendor

Editing requires `suppliers:manager` permission. Read-only users see the same fields but cannot make changes.

---

### Contacts

The Contacts tab organises contacts linked to this supplier into four role categories:

| Role | Purpose |
|------|---------|
| **Commercial** | Sales and account management contacts |
| **Technical** | Engineering and technical support contacts |
| **Support** | Helpdesk and customer support contacts |
| **Other** | Any contact that does not fit the above roles |

**How it works**:
- Each role section lists its linked contacts in a table showing first name, last name, job title, email, and mobile
- Click a contact row to open that contact's workspace
- Use **Add** to search for and attach an existing contact to a role
- Use **Create** to create a brand-new contact and link it in one step -- KANAP will return you to this tab afterward

**Tip**: Keep at least one contact per supplier so that vendor communication is always one click away.

When creating a new supplier, the Contacts tab is disabled until you save the record.

---

## CSV import/export

**Export CSV** downloads all suppliers with their current details. **Import CSV** reads a file back. The import dialog also carries **Download template**: a file with the headers only.

The columns:

| Column | Content |
|---|---|
| `name` | Required. The supplier name. Rows are matched on it |
| `erp_supplier_id` | The supplier's ID in your ERP |
| `commercial_contact` | The email of a contact. The load links the supplier to the contact with that email, and creates one when the workspace has none |
| `technical_contact` | The email of a contact, as above |
| `support_contact` | The email of a contact, as above |
| `notes` | Free text |
| `status` | `enabled` or `disabled` |

**Import**:

- Use **Preflight check** to validate the file before applying it, then **Load**
- Rows are matched by `name`: a row updates the supplier it names, any other row creates one
- `name` is required. Every other cell is optional

**Notes**:
- See [CSV files](master-data-operations.md#csv-files) for the encoding, the separator and the two import steps
- Import suppliers before importing applications or contracts that reference them. The budget file creates a missing supplier too, when **Create missing suppliers** is ticked. See [Load a budget from a spreadsheet](budget-file.md)

---

## Tips

- **Be consistent with naming**: Use official vendor names (e.g., "Microsoft Corporation" rather than "MS" or "MSFT") to avoid duplicates.
- **Add ERP IDs early**: If you use an ERP system, recording the supplier ID makes cross-referencing straightforward.
- **Disable, do not delete**: When you stop working with a vendor, disable them instead of deleting to preserve historical data in contracts and applications.
- **Organise contacts by role**: Use the four role categories to make it easy for colleagues to find the right person at each vendor.
- **Create before linking**: Add suppliers to master data before creating applications or contracts that reference them.
