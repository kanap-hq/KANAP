# CSV files

Every master data page has **Export CSV** and **Import CSV** in its toolbar, and documents its own columns. This page describes what those files have in common. It also applies to the user list in **Administration**.

**Check, then load.** An import has two steps. **Preflight check** reads the file and reports what a load would change: the rows to create, the rows to update and the rows that change nothing. **Load** writes it, then the dialog counts the rows created, updated and unchanged, for example "2 created, 5 updated, 30 unchanged". A count of zero is left out. Nothing is written before the load, and a file with one error loads nothing. Errors name the line of the file as a text editor shows it, blank lines and cells that span several lines included.

**Columns are matched by name**, in any order, whatever the case, the spaces and the underscores. These files are strict: a column KANAP does not know refuses the whole file, and the message, on a **Header** line, names the unknown and the missing ones. The budget file is the one that ignores the columns it does not know. See [Load a budget from a spreadsheet](budget-file.md).

**Encoding and separator.** Save the file as UTF-8 ("CSV UTF-8" in Excel). A file Excel saved as plain CSV, in Windows-1252, imports too, accents included. The separator is read from the header line: `,`, `;` or a tab. The export writes the separator of the language the screen is shown in.

**Workbooks and other files.** An import reads CSV text only. An Excel workbook (`.xlsx`, `.xls`) or an OpenDocument spreadsheet (`.ods`) is refused before any column is read, with a message that says how to save it as CSV. In Excel: **File › Save As › CSV UTF-8 (Comma delimited)**. In LibreOffice Calc: **File › Save As › Text CSV**. Any other file that is not text is refused the same way.

**Amounts, dates and yes or no follow the screen language** on export, and an import reads every form:

| Language | Separator | Amounts | Dates | Yes, no |
|---|---|---|---|---|
| English | `,` | `12280.50` | `2027-03-01` | `yes`, `no` |
| French | `;` | `12280,50` | `01/03/2027` | `oui`, `non` |
| Spanish | `;` | `12280,50` | `01/03/2027` | `sí`, `no` |
| German | `;` | `12280,50` | `01.03.2027` | `ja`, `nein` |

**Dates** are written year first (`2027-03-01`, `2027/03/01` or `2027.03.01`), or with the day and the month before the year (`01/03/2027`, `01.03.2027`). A date written in words, such as `Mar 1 2027`, is refused, and so is a day that is not on the calendar, such as `31/02/2027`.

On the master data pages, a date the file cannot settle on its own, such as `01/03/2027`, is read in the order of the language the screen is shown in: day first in French, German and Spanish, month first in English. The check says how it read the file, with a button to change the reading. A date with a day above 12 settles the question on its own, and the file carries no record of the language it was exported in. The files of applications, assets, incidents, projects, requests and tasks always read such a date day first.

An import reads yes or no in any of these languages, and the `true`, `false`, `1` and `0` of older files. The files of applications, assets, incidents, projects, requests and tasks follow the same table, and so do the link files of the technologies list. See [Technologies](technologies.md#import-and-export-links).

**Size.** A file holds up to 20,000 rows.
