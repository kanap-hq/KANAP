# CSV and Excel files

Every master data page has **Export** and **Import** in its toolbar, and documents its own columns. This page describes what those files have in common. It also applies to the user list in **Administration**.

## Export

**Format.** The export dialog offers **CSV** or **Excel (.xlsx)**. The choice is remembered in your browser and applies to every export dialog and export menu. The file holds the rows the list shows, with its filters and search, unless you ask the dialog for the whole register.

**Built by Kadratis.** Kadratis writes every export file, CSV or Excel, and records it in the [audit log](admin.md#audit-log): who exported what, with which filters, in which format, and how many rows.

**An Excel file** holds one sheet named after the list, with the same columns as the CSV. The header row is bold and stays in place when you scroll, with a filter on each column. Numbers are numbers, amounts are exact to the cent, and dates are dates that Excel and LibreOffice show in the day order of your language. Every other cell is text. A text that starts like a formula stays text.

## Import

**Check, then load.** An import has two steps. **Preflight check** reads the file and reports what a load would change: the rows to create, the rows to update and the rows that change nothing. **Load** writes it, then the dialog counts the rows created, updated and unchanged, for example "2 created, 5 updated, 30 unchanged". A count of zero is left out. Nothing is written before the load, and a file with one error loads nothing. Errors name the line of the file as a text editor shows it, blank lines and cells that span several lines included.

**Columns are matched by name**, in any order, whatever the case, the spaces and the underscores. These files are strict: a column Kadratis does not know refuses the whole file, and the message, on a **Header** line, names the unknown and the missing ones. The budget file is the one that ignores the columns it does not know. See [Load a budget from a spreadsheet](budget-file.md).

**References.** The companies, departments, suppliers and contacts files start with an optional `reference` column, which the export fills (`COMP-12`, `DEPT-4`, `SUP-12`, `CTCT-4`). A filled reference names the record the row updates, even when its name, or a contact's email, has changed. The preflight check lists each record that will be renamed or move to another company, and each contact whose email address will change. Left empty, the row is matched by its name, or a contact by its email. A reference your workspace does not know refuses the row, as happens with a file exported from another workspace: empty the cell to import the row as a new record or by its name. See [Companies](companies.md#csv-importexport), [Departments](departments.md#csv-importexport), [Suppliers](suppliers.md#csv-importexport) and [Contacts](contacts.md#csv-importexport).

The contracts file starts with the same optional `reference` column (`CTR-12`). A filled reference names the contract the row updates, even when its name or its supplier has changed, and the preflight check lists each contract that will be renamed or move to another supplier. Left empty, the row is matched by its name and supplier. See [Contracts](contracts.md#csv-importexport).

**Column titles.** The applications, assets, projects, incidents, suppliers and contracts files title their columns in the language of your screen, for example `Name` in English and `Nom` in French. The import reads these titles in any of the four languages, and the technical names the pages list (`name`). The other files, the budget file included, use the technical names.

**Excel workbooks.** An import reads a CSV file or an Excel workbook (`.xlsx`), with the same columns and the same rules. Kadratis reads the first sheet only. When the workbook has other sheets, the check says which sheet it read. A number or a date typed in a cell is read as it is, with no question of separator or day order, and a date with a time keeps its time. A date or an amount typed as text follows the rules of a CSV file below. An old Excel file (`.xls`) is refused with a message: save it as `.xlsx` or CSV. Import templates are CSV files, which Excel opens.

**Encoding and separator of a CSV file.** Save the file as UTF-8 ("CSV UTF-8" in Excel). A file Excel saved as plain CSV, in Windows-1252, imports too, accents included. The separator is read from the header line: `,`, `;` or a tab. The export writes the separator of the language the screen is shown in.

**Other files.** An OpenDocument spreadsheet (`.ods`) is refused before any column is read, with a message that says how to save it as CSV. In LibreOffice Calc: **File › Save As › Text CSV**, or **Excel 2007-365 (.xlsx)**. Any other file that is not text is refused the same way.

## Names of records { #names-of-records }

A cell that names another record, such as a supplier, a company or a project, finds it in three steps:

1. the same name, exactly as written;
2. the same name in other letter case;
3. the same name with other accents, for example `Fromagerie Leger` for `Fromagerie Léger`.

The third step applies only to records found by their name, in a list you can read. An email, a location reference such as `LOC-4` or a code takes the first two steps. When several records answer the third step, the row is refused and the message names them: write the name as it is stored.

**Matches.** The preflight check lists the names found at the third step under **N values matched**, folded. Unfold the line to see each match, for example `Supplier: Fromagerie Leger → Fromagerie Léger`. The list also holds the versions found by their catalog label (see [Version labels](technologies.md#version-labels)). **Undo** checks the file again without that match: the name is then read as one Kadratis does not know, and the load keeps that choice. The imports of applications, assets, projects, requests, tasks, incidents, contracts, cost centers, business processes, technology links and the budget file show this list.

**A name nothing finds.** The imports of applications, assets, projects, requests, tasks and incidents keep the current values for empty cells, unless you choose **Full replace**. With these choices, a row that updates a record also keeps the current value when a cell names a record Kadratis does not find. The check warns: "\"X\" was not found: the current value is kept." A value that belongs to another column is kept only while the row leaves that column as stored: a task's phase with its project, a stream with its category, a department with its company. Otherwise the field stays empty, and the check warns. A task keeps its viewers, or its owners, when one of their cells names an unknown email. On a new record, and with **Full replace**, the field stays empty and the check warns. A column that needs a known record refuses the row, as its page says.

Kad's imports follow the same rules and show the matches on their preview. See [Importing a spreadsheet](ai-assistant.md#importing-a-spreadsheet).

## Example files { #example-files }

The import dialog of applications, assets, projects, suppliers, contracts and the budget file offers **Download an example**: an Excel workbook in the language of your screen.

- The first sheet holds a few Fromage & Co examples of the columns most used. It is the sheet the import reads.
- **Advanced** shows the other columns for the same rows, when the import has more than the first sheet holds. To use one, copy it into the first sheet.
- **Notes** says what each column takes. Lists show the values your workspace accepts, such as its application categories or its analytics dimensions.

Names, codes and emails must match records of your workspace. The examples use those of the Fromage & Co sample data: replace them with yours, for example the location of a server or the company of a contract.

## Amounts, dates and yes or no

**In a CSV file, amounts, dates and yes or no follow the screen language** on export, and an import reads every form:

| Language | Separator | Amounts | Dates | Yes, no |
|---|---|---|---|---|
| English | `,` | `12280.50` | `2027-03-01` | `yes`, `no` |
| French | `;` | `12280,50` | `01/03/2027` | `oui`, `non` |
| Spanish | `;` | `12280,50` | `01/03/2027` | `sí`, `no` |
| German | `;` | `12280,50` | `01.03.2027` | `ja`, `nein` |

**Dates** are written year first (`2027-03-01`, `2027/03/01` or `2027.03.01`), or with the day and the month before the year (`01/03/2027`, `01.03.2027`). A date written in words, such as `Mar 1 2027`, is refused, and so is a day that is not on the calendar, such as `31/02/2027`.

On the master data pages, a date the file cannot settle on its own, such as `01/03/2027`, is read in the order of the language the screen is shown in: day first in French, German and Spanish, month first in English. The check says how it read the file, with a button to change the reading. A date with a day above 12 settles the question on its own, and the file carries no record of the language it was exported in. The files of applications, assets, incidents, projects, requests and tasks always read such a date day first.

An import reads yes or no in any of these languages, and the `true`, `false`, `1` and `0` of older files. The files of applications, assets, incidents, projects, requests and tasks follow the same table, and so do the link files of the technologies list. See [Technologies](technologies.md#import-and-export-links).

**Statuses, priorities and severities.** The files of projects, requests, tasks and incidents read a status, a priority or a severity by its name in any of the four languages, such as `On hold` or `Suspendu`, or by its code (`on_hold`). An unknown value is refused, and the message lists the accepted names in the language of your screen.

**Size.** A file holds up to 20,000 rows.

On an on-premise installation, the administrator can turn off Excel workbooks in imports. The import buttons then read **Import CSV** and take CSV files only. See [Configuration](on-premise/configuration.md#optional-excel-imports).
