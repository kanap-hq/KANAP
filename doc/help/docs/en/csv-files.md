# CSV files

Every master data page has **Export CSV** and **Import CSV** in its toolbar, and documents its own columns. This page describes what those files have in common. It also applies to the user list in **Administration**.

**Check, then load.** An import has two steps. **Preflight check** reads the file and reports what a load would change: the rows to create, the rows to update and the rows that change nothing. **Load** writes it. Nothing is written before that, and a file with one error loads nothing. Errors name the line of the file as a text editor shows it, blank lines and cells that span several lines included.

**Columns are matched by name**, in any order, whatever the case, the spaces and the underscores. These files are strict: a column KANAP does not know refuses the whole file, and the message names the unknown and the missing ones. The budget file is the one that ignores the columns it does not know. See [Load a budget from a spreadsheet](budget-file.md).

**Encoding and separator.** Save the file as UTF-8 ("CSV UTF-8" in Excel). A file Excel saved as plain CSV, in Windows-1252, imports too, accents included. The separator is read from the header line: `,`, `;` or a tab. The export writes the separator of the language the screen is shown in.

**Amounts and dates follow the screen language** on export, and an import reads both forms:

| Language | Separator | Amounts | Dates |
|---|---|---|---|
| English | `,` | `12280.50` | `2027-03-01` |
| French, Spanish | `;` | `12280,50` | `01/03/2027` |
| German | `;` | `12280,50` | `01.03.2027` |

A date the file cannot settle on its own, such as `01/03/2027`, is read in the order of the language the screen is shown in: day first in French, German and Spanish, month first in English. The check says how it read the file, with a button to change the reading. A date with a day above 12 settles the question on its own, and the file carries no record of the language it was exported in.

**Size.** A file holds up to 20,000 rows.
