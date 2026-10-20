# Vulnerabilities

The Vulnerabilities page lists the published vulnerabilities (CVE) that concern the versions of your technologies in use, and what each one reaches: the servers that carry a concerned version and the applications that use it. You review each vulnerability and record what you did about it.

Open it from **IT Landscape > Vulnerabilities**, in the **Operations** group. You need `infrastructure:reader` to view it and `infrastructure:member` to change a state. The application counts and lists appear only if you can also read applications.

## Availability

Vulnerabilities are followed by default in the cloud. On an on-premise installation they are off until your administrator [turns them on](on-premise/configuration.md#optional-vulnerabilities), and the server must then reach the NVD (the US National Vulnerability Database) or a mirror of it. The same switch also reads three exploitation sources, or a mirror of each: the CISA catalog, ENISA's European vulnerability database and the daily EPSS scores. While they are off, KANAP shows none of it: no page, no column in the technologies list, no section on a technology, no notification setting and no email.

## How KANAP finds them

KANAP reads the vulnerabilities published by the NVD every 6 hours and compares them with your technologies:

- **Products**: a technology is compared through its CPE product identifiers (see [Technologies](technologies.md#overview)). A technology without one gets no vulnerability. The catalog's operating systems have them too. SUSE Linux Enterprise Server has none: the NVD publishes too few of its vulnerabilities for a reliable match. Retired technologies are left out.
- **Versions**: only the versions in use count: installed on a server in service, or used by an application in service.
- **Version numbers**: versions compare on their numbers, part by part. `2016 SP3` counts as 2016 and `19c` as 19. A version with fewer than three numbers stands for its whole branch: `9.0` covers every `9.0.x`. A version KANAP cannot compare, such as a label without a number, counts as concerned.
- **Operating systems**: Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux and CentOS compare on their major version, and Ubuntu on its year and month, as the NVD publishes them: `9.4` gets the vulnerabilities of `9`, and `22.04.3 LTS` those of `22.04`. Windows Server compares on its year only, as KANAP does not know which updates a server has: a `2019` version is concerned by every vulnerability of Windows Server 2019, including those an update already fixed. 2012 and 2012 R2 are told apart by their label, as are 2008 and 2008 R2.
- **Unknown version**: a server or an application that names no version is potentially concerned by every vulnerability of the product. Its row shows **Not recorded** in the **Version** column.

Some vulnerabilities only apply when two products run together, for example Tomcat on Windows. KANAP shows them for the vulnerable product alone, so one may appear for an installation it does not affect. Mark it **Not affected**.

A vulnerability the NVD has not analysed yet appears once it is.

Changes count at once. When you add a technology or a CPE product identifier, KANAP searches the NVD for that product right away; the technology's **Vulnerabilities** section says "Searching for vulnerabilities…" until the search ends. When a version, a server or an application of a technology changes, KANAP matches the technology again as soon as the change is saved. **Refresh**, in the technology's **Vulnerabilities** section, does the same by hand.

## Alerts

Each technology and each version is in the vulnerability alerts or out of them. You choose on the technology, in its versions table: the **Include in vulnerability alerts** switch sets the technology, and the **Alerts** column holds a switch per version. See [Vulnerability alerts](technologies.md#vulnerability-alerts). A version follows the setting of its technology unless it has its own. A server or an application that names no version follows the technology.

Two kinds of technologies are out of the alerts by default:

- **Operating systems**: KANAP does not know the patch level of a server, so an operating system would raise a very large number of vulnerabilities.
- **Cloud services run by a provider**: a technology hosted in the public cloud or as SaaS, or a catalog entry the provider runs. The provider patches an online service, so its vulnerabilities call for no action on your side. A technology in a private cloud stays in the alerts.

You can include them again on the technology.

A version out of the alerts is still matched with the vulnerabilities. It stays in the technology's **Vulnerabilities** section, and its rows stay on this page under the **Alerts** filter. They are left out of everything else:

- This page shows only the rows in the alerts by default.
- The emails announce only the rows in the alerts.
- The **Vulnerabilities to review** column of the technologies list counts only the rows in the alerts.

## The list

The list uses the standard grid: one row per technology, version and vulnerability. Actively exploited vulnerabilities come first, then the most severe. A vulnerability that concerns three versions of SQL Server gives three rows, each with its own state. It opens on the rows **To review** that are in the alerts: clear the filter of the **State** column to see the other states.

**Alerts**, **Published** and **Exploited only** sit above the grid. **Alerts** chooses the rows by their alerts setting: **Included** (the default), **Excluded** or **All**. Under **All**, the rows out of the alerts are greyed. When no row is in the alerts and some are excluded, the empty list offers **Show the excluded ones**. **Published** keeps the vulnerabilities by their publication date at the NVD: **All** (the default), **Less than 7 days**, **Less than 30 days**, **Less than 90 days**, **Less than a year** or **More than a year**. The period counts back from today, so a saved or shared link keeps showing the latest ones. **Exploited only** keeps the vulnerabilities listed as actively exploited. The address carries `exploited=1`. **Reset filters** sets **Alerts** back to **Included**, **Published** back to **All**, and turns **Exploited only** off. The export and the state changes on the whole filter follow these three.

**Columns**:

| Column | What it shows |
|---|---|
| **CVE** | The vulnerability's identifier, for example `CVE-2024-1234` |
| **Severity** | **Critical**, **High**, **Medium**, **Low**, **None** or **Not rated**. An **Actively exploited** badge follows the name when CISA or the European Union lists the vulnerability |
| **Exploited** | **Yes** or **No**. Hidden by default: the badge in **Severity** shows the same fact |
| **Score** | The CVSS score. Hidden by default |
| **EPSS** | The probability of exploitation within the next 30 days, as a percentage in the language of your screen, with the percentile when one is published. For example, 15.3% (92nd percentile) |
| **Summary** | The NVD description |
| **Technology** | The concerned technology |
| **Version** | The concerned version. **Not recorded** when a server or an application uses the technology without naming its version: the row is then potentially concerned |
| **Publisher** | The technology's publisher. Hidden by default |
| **Servers** | How many servers carry this version, directly or through the server they run in |
| **Applications** | How many applications use this version, hosted or declared |
| **State** | **To review**, **Handled** or **Not affected** |
| **Note** | The note of the row. Hidden by default |
| **Published** | The publication date |

**Filters**: each column has its own filter under its header. **Severity**, **Technology**, **Version**, **Publisher**, **State** and **Exploited** offer checkboxes (**Version** offers **Not recorded** too, **Exploited** offers **Yes** and **No**), **Score** a number, **EPSS** a minimum probability from 0 to 1, **Published** a date, **CVE** and **Summary** a text. The search box above the grid matches the CVE identifier, the summary and the technology name.

**Sort** by **Exploited**, **Severity**, **Score**, **EPSS**, **Published**, **CVE** or **Technology**. The list opens with actively exploited vulnerabilities first, then the most severe. The column chooser shows or hides columns, and the grid remembers your choice.

**Links**: the page reads its filters from its address, so you can share a filtered list. `?technology=TEC-4` keeps one technology, `?version=none` the rows without a recorded version, `?state=all` every state, `?published=30d` the vulnerabilities published within the last 30 days (`7d`, `30d`, `90d`, `1y` or `older1y`, as the **Published** filter), `?period=30` the same through the filter of the **Published** column, `?alerts=excluded` or `?alerts=all` the rows out of the alerts, `?exploited=1` the actively exploited vulnerabilities. The link of the emails uses `period`.

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
- **Exploitation**, when a catalog, an EPSS score or a European identifier is known. See [Exploitation](#exploitation).

A version out of the alerts is greyed, with its servers and applications. When only some of them are in the alerts, a line above the list says how many, for example "3 servers, 1 in alerts".

Set the state of each version:

| State | Meaning |
|---|---|
| **To review** | Nobody has looked at it yet |
| **Handled** | The version is patched, or a workaround is in place |
| **Not affected** | The vulnerability does not apply to your installation |

The note records how, for example "patched on 12 March, change CHG-123". It saves when you leave the field. The audit log keeps who changed a state, and when.

KANAP never changes a state you chose. When a version no longer matches (you upgraded it, the technology was retired, the NVD changed its data), a row still **To review** goes away. A row you reviewed stays, greyed out, with its state; it comes back as it was if the version matches again.

## Exploitation { #exploitation }

A vulnerability is **actively exploited** when the CISA catalog (United States) or the catalog of the European Union lists it, or both. The **Actively exploited** badge sits next to the severity. Its detail names the catalogs. When CISA records use in ransomware campaigns, the detail says so.

**EPSS** is the probability that the vulnerability will be exploited within the next 30 days. [FIRST](https://www.first.org/epss) computes it every day. The column and the side panel show it as a percentage, with the percentile of that day when one is published, and the day of the score. The panel names the method: EPSS: FIRST.

The side panel also shows the **EUVD** identifier when the European mapping has one, with the link **See on the European vulnerability database (ENISA)**. ENISA's European vulnerability database is the European catalogue used when reviewing vulnerabilities in the scope of NIS2. The panel names the source: ENISA, European vulnerability database.

The list opens with actively exploited vulnerabilities first, then the most severe. **Exploited only**, above the grid, keeps those rows (`?exploited=1`). **Reset filters** turns it off. The export and a change of state in bulk keep it.

The email to the IT owners announces an exploited vulnerability of any severity, on the versions in the alerts, under the same rules as a critical or high one: published within the last 30 days, on a product the technology was already compared on, still to review. A vulnerability already detected that later joins an exploitation catalog stays on this page.

## Export

**Export CSV** downloads the vulnerabilities that match the filters, one line per row of the grid, in its order, in the language of your screen. Above 10,000 vulnerabilities, narrow the filters first.

## Email notifications

After each check, the IT owners of a technology receive one email about its new vulnerabilities still to review, on the versions in the alerts. The email includes a vulnerability that is critical or high, or known to be exploited at any severity:

- **What is announced**: a vulnerability published within the last 30 days on a product the technology was already compared on, when it is critical, high or listed as exploited, or a known vulnerability that has just become critical or high.
- **What is not**: the first comparison of a technology, or of a CPE identifier you just added, is silent. Its results wait on this page. A vulnerability already detected that later joins an exploitation catalog stays on this page.
- **How much**: 25 lines at most, one per technology and vulnerability, then a link to the page, filtered on the vulnerabilities published within the last 30 days.
- **How often**: each person hears about a vulnerability on a technology once. A vulnerability not announced at its check is never announced later.

The recipients are the IT owners of the technology whose account is enabled and who can read the infrastructure. Each one can turn these emails off under **Technology notifications** in their notification settings. See [Settings](admin.md#notifications). No email goes out while email is not configured on your installation.

## Where vulnerabilities also appear

- **Technologies list**: the **Vulnerabilities to review** column, in orange when some are critical or high. See [Technologies](technologies.md#working-with-the-list).
- **Technology workspace**: the **Vulnerabilities** section of the Compliance tab. See [Technologies](technologies.md#vulnerabilities).

## Tips

- **Fill in the CPE identifiers**: most catalog technologies come with them, operating systems included. SUSE Linux Enterprise Server has none. For the others, search the product in the NIST CPE dictionary.
- **Record versions**: a server or application without a version is potentially concerned by everything, which hides the real exposure.
- **Write the note**: the next person to read the vulnerability sees what was done.
