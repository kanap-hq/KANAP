# Vulnerabilities

The Vulnerabilities page lists the published vulnerabilities (CVE) that concern the versions of your technologies in use, and what each one reaches: the servers that carry a concerned version and the applications that use it. You review each vulnerability and record what you did about it.

Open it from **IT Landscape > Vulnerabilities**, in the **Operations** group. You need `infrastructure:reader` to view it and `infrastructure:member` to change a state. The application counts and lists appear only if you can also read applications.

## Availability

Vulnerabilities are followed by default in the cloud. On an on-premise installation they are off until your administrator [turns them on](on-premise/configuration.md#optional-vulnerabilities), and the server must then reach the NVD (the US National Vulnerability Database) or a mirror of it. While they are off, KANAP shows none of it: no page, no column in the technologies list, no section on a technology, no notification setting and no email.

## How KANAP finds them

KANAP reads the vulnerabilities published by the NVD every 6 hours and compares them with your technologies:

- **Products**: a technology is compared through its CPE product identifiers (see [Technologies](technologies.md#overview)). A technology without one gets no vulnerability. The catalog's operating systems have them too. SUSE Linux Enterprise Server has none: the NVD keeps the service pack beside the version. Retired technologies are left out.
- **Versions**: only the versions in use count: installed on a server in service, or used by an application in service.
- **Version numbers**: versions compare on their numbers, part by part. `2016 SP3` counts as 2016 and `19c` as 19. A version with fewer than three numbers stands for its whole branch: `9.0` covers every `9.0.x`. A version KANAP cannot compare, such as a label without a number, counts as concerned.
- **Unknown version**: a server or an application that names no version is potentially concerned by every vulnerability of the product. Its row shows **Not recorded** in the **Version** column.

Some vulnerabilities only apply when two products run together, for example Tomcat on Windows. KANAP shows them for the vulnerable product alone, so one may appear for an installation it does not affect. Mark it **Not affected**.

A vulnerability the NVD has not analysed yet appears once it is.

Changes count at once. When you add a technology or a CPE product identifier, KANAP searches the NVD for that product right away; the technology's **Vulnerabilities** section says "Searching for vulnerabilities…" until the search ends. When a version, a server or an application of a technology changes, KANAP matches the technology again as soon as the change is saved. **Match again** on the technology does the same by hand.

## The list

The list uses the standard grid: one row per technology, version and vulnerability, most severe first. A vulnerability that concerns three versions of SQL Server gives three rows, each with its own state. It opens on the rows **To review**: clear the filter of the **State** column to see the others.

**Columns**:

| Column | What it shows |
|---|---|
| **CVE** | The vulnerability's identifier, for example `CVE-2024-1234` |
| **Severity** | **Critical**, **High**, **Medium**, **Low**, **None** or **Not rated** |
| **Score** | The CVSS score. Hidden by default |
| **Summary** | The NVD description |
| **Technology** | The concerned technology |
| **Version** | The concerned version. **Not recorded** when a server or an application uses the technology without naming its version: the row is then potentially concerned |
| **Publisher** | The technology's publisher. Hidden by default |
| **Servers** | How many servers carry this version, directly or through the server they run in |
| **Applications** | How many applications use this version, hosted or declared |
| **State** | **To review**, **Handled** or **Not affected** |
| **Note** | The note of the row. Hidden by default |
| **Published** | The publication date |

**Filters**: each column has its own filter under its header. **Severity**, **Technology**, **Version**, **Publisher** and **State** offer checkboxes (**Version** offers **Not recorded** too), **Score** a number, **Published** a date, **CVE** and **Summary** a text. The search box above the grid matches the CVE identifier, the summary and the technology name.

**Sort** by **Severity**, **Score**, **Published**, **CVE** or **Technology**. The column chooser shows or hides columns, and the grid remembers your choice.

**Links**: the page reads its filters from its address, so you can share a filtered list. `?technology=TEC-4` keeps one technology, `?version=none` the rows without a recorded version, `?state=all` every state, `?period=30` the vulnerabilities published within the last 30 days. The link of the emails uses `period`.

## Changing the state of several rows

With `infrastructure:member`, tick the rows to change. The box in the header selects every row of the filter, including the rows not loaded yet; you can then untick some of them. A banner above the grid says how many rows are selected, and **Clear selection** empties it.

**Change state (n)** then asks for:

- The **State** to set.
- A **Common note**, optional. Without a note, each row keeps its own.

Before you confirm, the window says how many rows the change touches, on how many vulnerabilities. A row found after this count stays as it is. Above 5,000 rows, narrow the filters or select fewer rows.

For example, to mark every unrecorded version of PostgreSQL as not affected: filter **Technology** on PostgreSQL and **Version** on **Not recorded**, tick the header box, click **Change state**, choose **Not affected** and write the reason in the note.

## Reviewing a vulnerability

Click a row to open its vulnerability in a side panel. The panel covers every technology and version the vulnerability concerns. You see:

- The summary, the CVSS vector and the reference links (publisher advisories, patches).
- **Technologies and versions**: each concerned version, with its **State** and a note.
- **Servers**: each server that carries a concerned version, with the technology, the version and the server it runs in.
- **Applications**: each application that uses a concerned version, with its server.

Set the state of each version:

| State | Meaning |
|---|---|
| **To review** | Nobody has looked at it yet |
| **Handled** | The version is patched, or a workaround is in place |
| **Not affected** | The vulnerability does not apply to your installation |

The note records how, for example "patched on 12 March, change CHG-123". It saves when you leave the field. The audit log keeps who changed a state, and when.

KANAP never changes a state you chose. When a version no longer matches (you upgraded it, the technology was retired, the NVD changed its data), a row still **To review** goes away. A row you reviewed stays, greyed out, with its state; it comes back as it was if the version matches again.

## Export

**Export CSV** downloads the vulnerabilities that match the filters, one line per row of the grid, in its order, in the language of your screen. Above 10,000 vulnerabilities, narrow the filters first.

## Email notifications

After each check, the IT owners of a technology receive one email about its new critical or high vulnerabilities still to review:

- **What is announced**: a vulnerability published within the last 30 days on a product the technology was already compared on, or a known vulnerability that has just become critical or high.
- **What is not**: the first comparison of a technology, or of a CPE identifier you just added, is silent. Its results wait on this page.
- **How much**: 25 lines at most, one per technology and vulnerability, then a link to the page, filtered on the vulnerabilities published within the last 30 days.
- **How often**: each person hears about a vulnerability on a technology once. A vulnerability not announced at its check is never announced later.

The recipients are the IT owners of the technology whose account is enabled and who can read the infrastructure. Each one can turn these emails off under **Technology notifications** in their notification settings. See [Settings](admin.md#notifications). No email goes out while email is not configured on your installation.

## Where vulnerabilities also appear

- **Technologies list**: the **Vulnerabilities to review** column, in orange when some are critical or high. See [Technologies](technologies.md#working-with-the-list).
- **Technology workspace**: the **Vulnerabilities** section of the Relations tab. See [Technologies](technologies.md#vulnerabilities).

## Tips

- **Fill in the CPE identifiers**: catalog technologies come with them, including the operating systems. SUSE Linux Enterprise Server has none. For the others, search the product in the NIST CPE dictionary.
- **Record versions**: a server or application without a version is potentially concerned by everything, which hides the real exposure.
- **Write the note**: the next person to read the vulnerability sees what was done.
