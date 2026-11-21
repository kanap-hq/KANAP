# Contacts

Contacts document the people you work with: vendor account managers, support engineers, consultants and other external stakeholders. Link contacts to suppliers to build a vendor contact directory, and reference them from applications and locations for support information.

## Getting started

Navigate to **Master Data > Contacts** to see your contact directory. Click **New** to create your first entry.

**Required fields**:
- **Email**: The contact's email address (used as unique identifier)

**Strongly recommended**:
- **First Name** / **Last Name**: The contact's name
- **Supplier**: Which vendor this contact works for
- **Contact type**: The contact's role at the supplier (Commercial, Technical, Support, or Other). Choosing a supplier sets it to Commercial; change it if needed.

**Optional but useful**:
- **Job Title**: Their role or position
- **Phone** / **Mobile**: Phone numbers, entered with a country dial code
- **Country**: Location (ISO country code)

**Tip**: Link contacts to suppliers first, then reference them from applications and locations for consistent support information.

---

## Working with the list

The Contacts grid provides a searchable directory of all external contacts. Every cell in a row is a clickable link that opens the contact page.

**Default columns**:
- **Reference**: The reference Kadratis assigns (`CTCT-3`)
- **Last Name** / **First Name**: Contact name
- **Supplier**: The vendor they work for
- **Email**: Email address
- **Active**: Whether the contact is currently active (Yes / No)

**Additional columns** (via column chooser):
- **Job Title**: Their role
- **Phone** / **Mobile**: Phone numbers
- **Country**: Location
- **Created**: When the record was created

**Default sort**: By last name, alphabetical.

**Quick search**: Type a reference, such as `CTCT-3`, to find that contact. Digits alone search the text.

**Column filters**: The **Reference** filter takes `CTCT-3` or `3`.

**Actions**:
- **New**: Create a new contact (requires `contacts:member`)
- **Import**: Bulk import contacts (requires `contacts:admin`)
- **Export**: Export to a CSV file or an Excel workbook (requires `contacts:admin`)
- **Delete Selected**: Remove selected contacts (requires `contacts:admin`). They are removed from the suppliers, budget lines, contracts, applications, assets, locations, projects and requests that name them; these records stay

---

## The contact page

Click any row to open the contact page. Every change saves on its own: there is no save button. The **History** button in the header opens the contact's history in a side panel. See [Record history](record-history.md).

**Title**: The contact's name. Click it to edit the first and last name side by side; the change saves when you leave the two fields or press Enter, and Escape cancels it. A contact without a name shows its email instead.

**Reference**: The contact reference (`CTCT-4`) shows before the name. Click it to copy it.

**Page address**: the address of the page uses the reference, for example `/master-data/contacts/CTCT-4/overview`. The former address of a contact page still opens it, and changes to the new one.

**Header**, under the name:
- **Supplier**: The vendor this contact works for, as a link to its page. A contact without a supplier shows **No supplier**: click it to open the properties and choose one.
- **Contact type**: The contact's role at the supplier: Commercial, Technical, Support, or Other. Click it to choose another. It appears once the contact has a supplier.
- **Status**: **Active** or **Inactive**. Click it to change it.
- **Used by**: How many suppliers, budget lines, contracts and other items the contact is linked to. Click it to scroll to the **Used by** section.

**Properties** (the panel on the right, opened with its tab or the `P` key):
- **Supplier**: Choose the vendor from the list, or type its name or its reference (`SUP-12`). A contact always has a contact type once it has a supplier: choosing a supplier for a contact without a type gives it **Commercial**, which you can change at once. Clearing the supplier clears the contact type too.
- **Contact type**: The same choice as in the header.
- **Email**: Required, and unique across your contacts.
- **Job title**: Their role or position.
- **Phone** / **Mobile**: A dial code and a number. Pick the dial code from the list or type it. When the contact has no country yet, the dial code sets it.
- **Country**: Searchable list of countries.

Text fields save when you leave them or press Enter, lists save as soon as you choose. A value Kadratis cannot accept (an email that is not valid or that another contact already uses, a phone number that is not a dial code followed by a number of 7 to 15 digits in all) shows its message under the field and is not saved.

**Notes**: Free-form notes (up to 2,000 characters), under the header. They save a moment after you stop typing, and when you leave the field.

Press **Escape** or click the close button to go back to the list.

**Delete**, a trash icon at the top right, is shown to contact administrators (`contacts:admin`). After a confirmation, the contact is deleted and removed from the suppliers, budget lines, contracts, applications, assets, locations, projects and requests that name it; these records stay. You return to the list.

### Used by

The **Used by** section, under the notes, lists everything the contact is linked to, one list per type, each with its count: suppliers, budget lines (OPEX and CAPEX, with their `BL-` reference), contracts (`CTR-`), applications, assets, locations, projects (`PRJ-`) and requests (`REQ-`). Each row shows the contact's role there: the contact type for suppliers, budget lines and contracts, the role typed on the application, asset or location.

Click a row to open that page. A list shows up to 50 items and says how many there are in all. You only see the lists you are allowed to read. A contact linked to nothing shows one line that says so.

### Creating a contact

Click **New** in the list. The page of the new contact opens. Type the first and last name side by side in the header, then the email. The contact is created when you leave the email field with a valid email. Phone numbers must be valid too. Choosing a supplier sets the contact type to **Commercial**, which you can change. A contact with a supplier needs a type. Every tab then becomes available, and the other fields save automatically. Press Escape in the name to leave without creating anything, even with a name typed.

While the contact is being created, the header shows **Create** and **Cancel** until you leave it. **Ctrl+S** works like the button shown. **Create** writes the contact when its required fields are given and leaves it open. If one is still missing, its label turns red and the cursor goes to it. Once the contact is created, **Create** becomes **Done**: it saves what you are still typing and takes you back to where you started, the list, the previous screen, or the supplier you started from. **Cancel** leaves without keeping anything, and deletes the contact if it was already created. If you entered more than what created it, a confirmation lists what will be deleted. You can cancel your own creation without the right to delete contacts. Leaving the contact any other way keeps it.

---

## Where contacts are used

Contacts appear in several places throughout Kadratis. The **Used by** section of the contact page lists them all.

### Supplier contacts

Each supplier has a **Contacts** tab showing all contacts linked to that vendor. You can create a new contact directly from the supplier workspace:

1. Open the supplier workspace and go to the **Contacts** tab.
2. Click **New contact** next to a contact type.
3. Fill in the contact details: the supplier and contact type are pre-filled.
4. Click **Create**, then **Done**: you return to the supplier's **Contacts** tab.

### Application support

In the Applications workspace, the **Technical & Support** tab references contacts for support escalation.

### Technology support

In the Technologies workspace, the **Operations** tab lists the support contacts of a technology. See [Technologies](technologies.md#operations). In the contact's **Used by** section, a retired technology comes last, marked **Disabled**.

### Location contacts

Locations can have support contacts (facility managers, NOC contacts, etc.).

---

## CSV import/export

The export writes a CSV file or an Excel workbook (`.xlsx`): choose under **Format** in the dialog. The import reads either. See [CSV and Excel files](csv-files.md).

Manage contacts in bulk using CSV files or Excel workbooks.

**Export**: Downloads the contacts the list shows with their reference and details. Choose **The whole register** in the dialog for every contact.

**Import**:
- Use **Preflight check** to validate before applying
- Can create new contacts or update existing ones
- **Matching by reference**: a filled `reference` (`CTCT-4` or `4`) names the contact the row updates, even when its email has changed. The contact takes the name and the email the row gives. The preflight check lists each contact that will be renamed or change its email address
- **Matching by email**: when `reference` is empty, or the file has no such column, the row is matched by email address
- **Unknown reference**: a reference your workspace does not know refuses the row: "\"CTCT-999\" is no reference in this workspace. Leave the cell empty to import the row without it." This happens with a file exported from another workspace
- **Changing the email**: an email that another contact already has is refused, and the message names that contact's reference: "\"ana@acme.example\" already belongs to CTCT-7."
- **One row per contact**: two rows that update the same contact are refused: "This row updates CTCT-7, as row 3 does. Keep one row per record." Two rows that create the same contact (same email, whatever the case) are refused too: "Same values in email as row 3."

- **Empty cells and `-`**: on a contact the file updates, an empty cell keeps the stored value and `-` clears it. `-` clears the names, `job_title`, `phone`, `mobile`, `country` and `notes`. It cannot clear `reference`, `email` or `active`: the row is refused. See [Empty cells and `-`](csv-files.md#empty-cells-and-clearing)

**Supplier columns**:
- `supplier_name` sets the contact's supplier, by its reference (`SUP-12`) or its name. Names are found as described in [Names of records](csv-files.md#names-of-records): a name found with other accents is listed at the check, and you can undo the match. A name that matches no supplier, or several, refuses the row. The import never creates a supplier
- `supplier_role` is the contact type for that supplier: `commercial`, `technical`, `support` or `other`, or the word the contact page shows, in any of the four languages. Left empty, the contact keeps its type, and a contact without one gets **Commercial**, as on the contact page
- An empty `supplier_name` keeps the supplier. `-` removes the supplier and its contact type. `-` in `supplier_role` alone is refused, and so is a type on a contact without a supplier
- A change of supplier does what choosing the supplier on the contact page does
- The export and the template include both columns

**Required fields**: `email`, on a new contact

**Optional fields**: `reference`, `first_name`, `last_name`, `job_title`, `phone`, `mobile`, `country`, `supplier_name`, `supplier_role`, `notes`, `active`

**Notes**:
- See [CSV and Excel files](csv-files.md) for the encoding, the separator and the two import steps

---

## Tips

- **Always set a supplier**: Linking contacts to suppliers makes them easier to find and manage.
- **Set the contact type**: Once a supplier is linked, choose whether the contact is Commercial, Technical, Support, or Other. This helps when browsing contacts from the supplier workspace.
- **Use consistent naming**: Enter names in a consistent format (e.g., always "FirstName LastName").
- **Mark inactive contacts**: When someone leaves a vendor, mark them as inactive rather than deleting them. This preserves the audit trail.
- **Include job titles**: Job titles help identify the right contact for different needs (sales vs. support vs. account management).
