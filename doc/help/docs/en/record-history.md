# Record history

The history of a record lists the changes made to it: who changed what, and when. It answers everyday questions such as "who raised this amount?" or "when was this contract unlinked?" without a visit to the audit log.

## Where to find it

- **History tab**, the last tab of the record: budget lines (see [Budget lines](budget-lines.md#history)), companies, departments, suppliers, locations, connections, interfaces, assets and technologies.
- **History button** in the header, which opens the history in a side panel: accounts, cost centers, working-day calendars, business processes, analytics dimensions and values, and contacts.
- **History tab** in the right panel of a knowledge document.

## Who can see it

- Anyone who can open the record can read its history. No extra permission is needed.
- With data access limited to some companies or cost centers, a person sees the history of the records within their access only. See [Data access](data-access.md).

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

## Records you cannot read

An entry can name another record, for example a contract linked to the line. If you cannot open that record, the entry names it by its kind only, for example "a contract". A record deleted since then shows as "a deleted contract".

## Values the history does not show

- The email address, phone numbers and notes of a contact never appear.
- For long content, the entry says only that it changed: **Content changed** for the body of a knowledge document, **Working days changed** for the days of a working-day calendar.

## Ask the assistant

[Plaid](ai-assistant.md#tool-calls) reads the history of a record with the same rights as its page. Ask, for example: "Who changed the amounts of BL-12?" or "What changed on TEC-3 this year?" Plaid answers from the History tab only: for a record without one, it says that KANAP keeps no history for it.

## The full audit log

The history keeps to what a reader needs. The complete technical record of every change, across the whole workspace, stays in **Admin > Audit log**. See [Audit log](admin.md#audit-log).
