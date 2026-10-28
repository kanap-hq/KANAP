# Record history

The **History** tab of a record lists the changes made to it: who changed what, and when. It answers everyday questions such as "who raised this amount?" or "when was this contract unlinked?" without a visit to the audit log.

!!! note "Where it is available"
    Today the **History** tab is on budget lines (see [Budget lines](budget-lines.md#history)). Other records will get it later.

## Who can see it

- Anyone who can open the record can read its history. No extra permission is needed.
- With data access limited to some companies or cost centers, a person sees the history of the records within their access only. See [Data access](data-access.md).

## What an entry shows

The tab lists one entry per change, the most recent at the top. Each entry shows:

- the date and time of the change;
- its author: a person, **System** for changes KANAP makes by itself, **Import** for changes loaded from a file, or **Plaid for** a person when the assistant made the change on their behalf;
- for the record itself, the event: **Created**, **Updated** or **Deleted**; for its parts, the title or the event of the part;
- each changed field, with its value before and after (`before → after`).

A change of amount names the year, the column and the values before and after.

Long histories load in pages: click **Load more** at the bottom of the list to see older changes.

## Changes to the parts of a record

The history of a budget line also lists the changes made to its parts:

- amounts, by year and budget column;
- analytics dimensions;
- allocations;
- links and attachments;
- contacts;
- linked applications, technologies and assets;
- tasks.

## Records you cannot read

An entry can name a record from another module, for example a contract linked to the line. If you cannot read that module, or the record has since been deleted, the entry names it by its kind only, for example "a contract".

## The full audit log

The history keeps to what a reader needs. The complete technical record of every change, across the whole workspace, stays in **Admin > Audit log**. See [Audit log](admin.md#audit-log).
