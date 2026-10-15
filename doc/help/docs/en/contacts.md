# Contacts

Contacts document the people you work with -- vendor account managers, support engineers, consultants, and other external stakeholders. Link contacts to suppliers to build a vendor contact directory, and reference them from applications and locations for support information.

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

**Actions**:
- **New**: Create a new contact (requires `contacts:manager`)
- **Import CSV**: Bulk import contacts (requires `contacts:admin`)
- **Export CSV**: Export to CSV (requires `contacts:admin`)
- **Delete Selected**: Remove selected contacts (requires `contacts:admin`)

---

## The contact page

Click any row to open the contact page. Every change saves on its own: there is no save button.

**Title**: The contact's name. Click it to edit the first and last name side by side; the change saves when you leave the two fields or press Enter, and Escape cancels it. A contact without a name shows its email instead.

**Header**, under the name:
- **Supplier**: The vendor this contact works for, as a link to its page. A contact without a supplier shows **No supplier**: click it to open the properties and choose one.
- **Contact type**: The contact's role at the supplier: Commercial, Technical, Support, or Other. Click it to choose another. It appears once the contact has a supplier.
- **Status**: **Active** or **Inactive**. Click it to change it.
- **Used by**: How many suppliers, budget lines, contracts and other items the contact is linked to. Click it to scroll to the **Used by** section.

**Properties** (the panel on the right, opened with its tab or the `P` key):
- **Supplier**: Choose the vendor from the list. A contact always has a contact type once it has a supplier: choosing a supplier for a contact without a type gives it **Commercial**, which you can change at once. Clearing the supplier clears the contact type too.
- **Contact type**: The same choice as in the header.
- **Email**: Required, and unique across your contacts.
- **Job title**: Their role or position.
- **Phone** / **Mobile**: A dial code and a number. Pick the dial code from the list or type it. When the contact has no country yet, the dial code sets it.
- **Country**: Searchable list of countries.

Text fields save when you leave them or press Enter, lists save as soon as you choose. A value KANAP cannot accept (an email that is not valid or that another contact already uses, a phone number that is not a dial code followed by a number of 7 to 15 digits in all) shows its message under the field and is not saved.

**Notes**: Free-form notes (up to 2,000 characters), under the header. They save a moment after you stop typing, and when you leave the field.

Press **Escape** or click the close button to go back to the list.

### Used by

The **Used by** section, under the notes, lists everything the contact is linked to, one list per type, each with its count: suppliers, budget lines (OPEX and CAPEX, with their `BL-` reference), contracts, applications, assets, locations, projects (`PRJ-`) and requests (`REQ-`). Each row shows the contact's role there: the contact type for suppliers, budget lines and contracts, the role typed on the application, asset or location.

Click a row to open that page. A list shows up to 50 items and says how many there are in all. You only see the lists you are allowed to read. A contact linked to nothing shows one line that says so.

### Creating a contact

Click **New** in the list. Fill in the email (required) and the other fields, then click **Create**. Choosing a supplier sets the contact type to **Commercial**, which you can change before creating. You return to the list once the contact is created.

---

## Where contacts are used

Contacts appear in several places throughout KANAP. The **Used by** section of the contact page lists them all.

### Supplier contacts

Each supplier has a **Contacts** tab showing all contacts linked to that vendor. You can create a new contact directly from the supplier workspace:

1. Open the supplier workspace and go to the **Contacts** tab.
2. Click **New contact** next to a contact type.
3. Fill in the contact details: the supplier and contact type are pre-filled.
4. Click **Create**: you return to the supplier's **Contacts** tab.

### Application support

In the Applications workspace, the **Technical & Support** tab references contacts for support escalation.

### Location contacts

Locations can have support contacts (facility managers, NOC contacts, etc.).

---

## CSV import/export

Manage contacts in bulk using CSV.

**Export**: Downloads the contacts the list shows with their details. Choose **The whole register** in the dialog for every contact.

**Import**:
- Use **Preflight** to validate before applying
- Matched by email address
- Can create new contacts or update existing ones

**Required fields**: Email

**Optional fields**: First Name, Last Name, Supplier Name, Job Title, Phone, Mobile, Country, Active

**Notes**:
- Use **UTF-8 encoding** and **semicolons** as separators. A file Excel saved as plain CSV (Windows-1252) imports too
- Supplier is matched by name -- ensure the supplier exists before importing

---

## Tips

- **Always set a supplier**: Linking contacts to suppliers makes them easier to find and manage.
- **Set the contact type**: Once a supplier is linked, choose whether the contact is Commercial, Technical, Support, or Other. This helps when browsing contacts from the supplier workspace.
- **Use consistent naming**: Enter names in a consistent format (e.g., always "FirstName LastName").
- **Mark inactive contacts**: When someone leaves a vendor, mark them as inactive rather than deleting -- this preserves the audit trail.
- **Include job titles**: Job titles help identify the right contact for different needs (sales vs. support vs. account management).
