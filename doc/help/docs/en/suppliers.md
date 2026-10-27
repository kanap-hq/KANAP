# Suppliers

Suppliers (also known as vendors) represent the companies you purchase software, services, and support from. Link suppliers to applications, contracts, and OPEX lines to track vendor relationships and spending across your IT portfolio.

## Getting started

Navigate to **Master Data > Suppliers** to open the supplier directory. Click **New** to create your first entry.

**Required fields**:
- **Name**: The supplier or vendor name

**Optional but useful**:
- **ERP supplier ID**: Reference ID from your ERP or procurement system
- **Notes**: Free-form notes about the vendor relationship

**Tip**: Create suppliers before adding applications or contracts: you will be able to link them during creation.

---

## Working with the list

The Suppliers list gives you a searchable, sortable directory of all your vendors.

**Default columns**:
- **Name**: Supplier name (click to open the supplier page)
- **ERP supplier ID**: Reference ID from external systems

**Additional columns** (via column chooser):
- **Status**: Enabled or Disabled
- **Notes**: Additional information
- **Created**: When the record was created

Every cell in a row is clickable and opens that supplier's page.

**Default sort**: By name, alphabetical. Sorting a text column ignores case and accents.

**Filtering**:
- Quick search: Searches across supplier fields
- Status scope: Use the **Show: All / Enabled / Disabled** toggle above the grid to filter by status. The list shows enabled suppliers by default

**Actions**:
- **New**: Create a new supplier (requires `suppliers:member`)
- **Import**: Bulk-import suppliers (requires `suppliers:admin`)
- **Export**: Export the list to a CSV file or an Excel workbook (requires `suppliers:admin`)
- **Delete Selected**: Remove selected suppliers (requires `suppliers:admin`)

---

## The supplier page

Click any row to open the supplier page. Use the arrows at the top, or the left and right arrow keys, to step through suppliers without returning to the list. Every change saves on its own: there is no save button.

The page has two tabs: **Overview** and **Contacts**.

**Title**: The supplier's name. Click it to edit it; the change saves when you leave the field or press Enter, and Escape cancels it. A name is required and must differ from the name of every other supplier, whatever the case (`SAP` and `sap` are the same name): KANAP shows the message under the name and keeps the stored one.

**Reference**: The ERP supplier ID, when the supplier has one, shows before the name. Click it to copy it.

**Header**, under the name:
- **Status**: **Enabled** or **Disabled**. Click it to change it. Choosing **Disabled** disables the supplier at once: the end of validity becomes the current time.
- **Contacts**: How many contacts are linked to the supplier. Click it to open the **Contacts** tab.
- **Used by**: How many budget lines, contracts, applications and assets use the supplier. Click it to scroll to the **Used by** section of the **Overview** tab.

**Properties** (the panel on the right, opened with its tab or the `P` key):
- **ERP supplier ID**: The supplier's ID in your ERP or procurement system. It saves when you leave the field or press Enter.
- **Lifecycle**: The status switch and the **End of validity** date. Leave the date blank to keep the supplier active indefinitely, or set a future date to schedule its end.

**Notes**: Free-form notes about the vendor, on the **Overview** tab. They save a moment after you stop typing, and when you leave the field.

Editing requires `suppliers:member` permission. Read-only users see the same page but cannot make changes.

Press **Escape** or click the close button to go back to the list.

### Contacts

The **Contacts** tab lists the contacts linked to this supplier by contact type:

| Contact type | Purpose |
|------|---------|
| **Commercial** | Sales and account management contacts |
| **Technical** | Engineering and technical support contacts |
| **Support** | Helpdesk and customer support contacts |
| **Other** | Any contact that does not fit the above types |

**How it works**:
- Each section lists its contacts by name. Click a name to open the contact page.
- **Add existing**: Search for a contact by name and pick it. The link saves at once.
- **New contact**: Opens the contact form with the supplier and the contact type already filled in. KANAP brings you back to this tab once the contact is created.
- The bin button removes the link. The contact itself stays in your contacts. A message confirms it, with an **Undo** action that links the contact again.

**Tip**: Keep at least one contact per supplier so that vendor communication is always one click away.

### Used by

The **Used by** section, under the notes on the **Overview** tab, lists what refers to this supplier, one list per type, each with its count:

- **Budget lines**: OPEX and CAPEX lines whose supplier it is, with their reference (`BL-12`) and type.
- **Contracts**: contracts with this supplier.
- **Applications**: applications whose vendor it is.
- **Assets**: assets it supports (the support vendor of the asset).

Click a row to open that page. Disabled items show **Disabled** and come after the others. A list shows up to 50 items and says how many there are in all. Past 50, budget lines, contracts and applications get a link such as **Show all 57** that opens their list filtered on this supplier. You only see the lists you are allowed to read: a user without access to contracts sees no contract list. A supplier that nothing uses shows one line that says so.

Check this section before you disable or delete a supplier. A supplier still used by budget lines, contracts, applications or assets cannot be deleted. The message counts what uses it, for example "This supplier is used by 2 contracts and 1 application". Disable it instead. In the list, the confirmation names the suppliers kept this way, with what uses them, before anything is deleted. To delete it anyway, first set another supplier on those budget lines, contracts, applications and assets, or clear it where it is optional (a contract always needs one). Then delete it.

### Creating a supplier

Click **New** in the list. Fill in the name (required), the ERP supplier ID and the notes, then click **Create**. The supplier is created enabled and its page opens, with the **Contacts** tab ready.

---

## CSV import/export

The export writes a CSV file or an Excel workbook (`.xlsx`): choose under **Format** in the dialog. The import reads either. See [CSV and Excel files](csv-files.md).

**Export** downloads the suppliers the list shows, with its search, filters and sort. Choose **The whole register** in the dialog to download every supplier, enabled and disabled. The dialog closes once the file is downloaded. **Import** reads a file back. The import dialog also carries **Download template**: a file with the headers only. The dialog lists the accepted values.

The columns:

| Column | Content |
|---|---|
| `name` | Required. The supplier name. Rows are matched on it |
| `erp_supplier_id` | The supplier's ID in your ERP |
| `commercial_contact` | The email of an existing contact. The load links the supplier to it |
| `technical_contact` | The email of a contact, as above |
| `support_contact` | The email of a contact, as above |
| `notes` | Free text |
| `status` | `enabled` or `disabled` |
| `disabled_at` | The end of validity: a date (`2026-12-31`) or a full date and time. The export writes the date only. Imported again, that date keeps the stored end of validity. Empty when the supplier has none |

**Import**:

- Use **Preflight check** to validate the file before applying it, then **Load**
- Rows are matched by `name`, whatever the case: a row updates the supplier it names, any other row creates one. The stored spelling stays: a row `sap` updates `SAP`, and the preflight check says "sap" was matched to "SAP"
- `name` is required. Every other cell is optional
- Each supplier takes one row. Two rows with the same name, even in a different case, are refused at the preflight check, with both row numbers
- A contact email must belong to a contact that already exists in **Contacts**. Otherwise the row is refused at the preflight check: create the contact first
- `disabled_at` sets the end of validity, and the status follows from it. A status that contradicts the date is refused. A file without the `disabled_at` column still imports: the status alone then sets the lifecycle

**Notes**:
- See [CSV and Excel files](csv-files.md) for the encoding, the separator and the two import steps
- Import suppliers before importing applications or contracts that reference them. The budget file creates a missing supplier too, when **Create missing suppliers** is ticked. See [Load a budget from a spreadsheet](budget-file.md)

---

## Tips

- **Be consistent with naming**: Use official vendor names (e.g., "Microsoft Corporation" rather than "MS" or "MSFT") to avoid duplicates.
- **Add ERP IDs early**: If you use an ERP system, recording the supplier ID makes cross-referencing straightforward.
- **Disable, do not delete**: When you stop working with a vendor, disable them instead of deleting to preserve historical data in contracts and applications.
- **Organise contacts by role**: Use the four role categories to make it easy for colleagues to find the right person at each vendor.
- **Create before linking**: Add suppliers to master data before creating applications or contracts that reference them.
