# Record history

The history of a record lists the changes made to it: who changed what, and when. It answers everyday questions such as "who raised this amount?" or "when was this contract unlinked?" without a visit to the audit log.

## Where to find it

- **History tab**, the last tab of the record: budget lines (see [Budget lines](budget-lines.md#history)), contracts, companies, departments, suppliers, locations, connections, interfaces, applications, assets, technologies, incidents, projects, requests and tasks.
- **History button** in the header, which opens the history in a side panel: accounts, cost centers, working-day calendars, business processes, analytics dimensions and values, and contacts.
- **History tab** in the right panel of a knowledge document.

An incident also keeps its **Journal** tab. The journal tells what happened during the incident. The history lists the changes made to the record.

The activity feed of a project, a request or a task shows comments and decisions only. The changes made to the record are in its history. On a task, a comment written with a status change shows that change.

## Who can see it

- Anyone who can open the record can read its history. No extra permission is needed.
- With data access limited to some companies or cost centers, a person sees the history of the records within their access only. See [Data access](data-access.md).
- A restricted incident stays hidden from people who cannot see it, and so does the history of its tasks.

## What an entry shows

The history lists one entry per change, the most recent at the top. Each entry shows:

- the date and time of the change;
- its author: a person, **System** for changes KANAP makes by itself, **Import** for changes loaded from a file, or **Plaid for** a person when the assistant made the change on their behalf;
- for the record itself, the event: **Created**, **Updated** or **Deleted**; for its parts, the title or the event of the part;
- each changed field, with its value before and after (`before → after`).

A change of amount names the year, the column and the values before and after.

Long histories load in pages: click **Load more** at the bottom of the list to see older changes.

## Changes to the parts of a record

The history also lists the changes made to the parts of a record. On a budget line, for example:

- amounts, by year and budget column;
- analytics dimensions;
- allocations;
- links and attachments;
- contacts;
- linked applications, technologies and assets;
- tasks.

On the other records, the history lists in the same way the links and parts they hold: budget lines, applications, assets, contracts, team members, contacts, dependencies, web links, embedded documents, attachments, tasks, deployments and criteria scores.

## Records you cannot read

An entry can name another record, for example a contract linked to the line. If you cannot open that record, the entry names it by its kind only, for example "a contract". A record deleted since then shows as "a deleted contract".

On a contract, a project or a request, a person with limited data access sees the budget lines outside their access as a count, without their names: "and 2 lines outside your access".

## Values the history does not show

- The email address, phone numbers and notes of a contact never appear.
- For long content, the entry says only that it changed: **Content changed** for the body of a knowledge document, **Working days changed** for the days of a working-day calendar, **Description changed**, **Purpose changed** or **Current situation changed** for the long texts of the other records.

## The full audit log

The history keeps to what a reader needs. The complete technical record of every change, across the whole workspace, stays in **Admin > Audit log**. See [Audit log](admin.md#audit-log).
