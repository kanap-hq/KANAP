# Vulnerabilities

The Vulnerabilities page lists the published vulnerabilities (CVE) that concern the versions of your technologies in use, and what each one reaches: the servers that carry a concerned version and the applications that use it. You review each vulnerability and record what you did about it.

Open it from **IT Landscape > Vulnerabilities**, in the **Operations** group. You need `infrastructure:reader` to view it and `infrastructure:member` to change a state. The application counts and lists appear only if you can also read applications.

## Availability

Vulnerabilities are followed by default in the cloud. On an on-premise installation they are off until your administrator [turns them on](on-premise/configuration.md#optional-vulnerabilities), and the server must then reach the NVD (the US National Vulnerability Database) and the CVE.org list, or a mirror of each. The same switch also reads three exploitation sources, or a mirror of each: the CISA catalog, ENISA's European vulnerability database and the daily EPSS scores. While they are off, KANAP shows none of it: no page, no column in the technologies, assets and applications lists, no section or badge on a record, no dashboard tile, no notification setting and no email. Plaid does not answer about vulnerabilities either.

## How KANAP finds them

KANAP reads two sources every 6 hours and compares them with your technologies:

- **The NVD**: the vulnerabilities analysed by the US National Vulnerability Database. The NVD does not analyse every vulnerability. Many stay without a product identifier for a long time, and some never get one.
- **The CVE.org list**: the records that publishers write themselves for their own products. A vulnerability its publisher has published appears even when the NVD has not analysed it.

These records come from the CVE list (CVE.org), under the [terms of use of the CVE program](https://www.cve.org/Legal/TermsOfUse).

Each technology is compared as follows:

- **Products**: a technology is compared through its CPE product identifiers and its CVE.org names (see [Technologies](technologies.md#vulnerability-identifiers)). The CPE identifiers also match the CVE.org records that carry them, as Red Hat's do. A technology with neither gets no vulnerability. The catalog's operating systems have CPE identifiers too. Red Hat Enterprise Linux also gets the vulnerabilities Red Hat files under its application streams (AppStream). Retired technologies are left out.
- **CVE.org names**: the publisher and product names as the publisher writes them in its records, for example publisher `SAP_SE` and product `SAP HANA Database`. The comparison ignores case and punctuation, and otherwise needs the exact name. A close name does not match, so each variant of a product is declared on its own. A name can carry a version: it then applies only to the versions of the technology whose label starts with that version, for example `2019` for `Windows Server 2019`. When a label starts with several of them, only the longest counts: `2012 R2` carries `2012` and `2012 R2`, and gets the name of `2012 R2` only.
- **Versions**: only the versions in use count: installed on a server in service, or used by an application in service.
- **Version numbers**: versions compare on their numbers, part by part. `2016 SP3` counts as 2016 and `19c` as 19. A version with fewer than three numbers stands for its whole branch: `9.0` covers every `9.0.x`. A version KANAP cannot compare, such as a label without a number, counts as concerned.
- **Versions in publisher records**: the same rules apply to the versions a CVE.org record lists. A version KANAP cannot compare with the publisher's counts as concerned, and the **Match** column of the export says "Version not comparable". This happens when your version is named by a year and the publisher numbers its components, for example `2021` against `106`. Check the publisher's record to decide whether your version is concerned.
- **Operating systems**: Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux, SUSE Linux Enterprise Server and CentOS compare on their major version, and Ubuntu on its year and month, as the NVD publishes them: `9.4` gets the vulnerabilities of `9`, and `22.04.3 LTS` those of `22.04`. IBM AIX, IBM i and Oracle Solaris compare on their first two numbers: `7.3.2` gets the vulnerabilities of `7.3`. Windows Server compares on its year only, as KANAP does not know which updates a server has: a `2019` version is concerned by every vulnerability of Windows Server 2019, including those an update already fixed. 2012 and 2012 R2 are told apart by their label, as are 2008 and 2008 R2.
- **Unknown version**: a server or an application that names no version is potentially concerned by every vulnerability of the product. Its row shows **Not recorded** in the **Version** column.
- **Linux distributions**: a distribution publishes its vulnerabilities per package. KANAP sees the vulnerabilities that the publisher assigns to a version of the distribution. It does not see the packages installed on a server, or their level of updates. To know whether a server is exposed, check the package in the distributor's security tracker: the technology links to it, under its versions table (see [Technologies](technologies.md#versions-from-the-catalog)).

Some vulnerabilities only apply when two products run together, for example Tomcat on Windows. KANAP shows them for the vulnerable product alone, so one may appear for an installation it does not affect. Mark it **Not affected**.

A row exists as soon as one of the two sources matches it. When the NVD and the publisher disagree, the row stays. The **Source** column of the list says which sources matched it. When the NVD has not scored a vulnerability yet, KANAP shows the score and the severity of the publisher's record. A vulnerability that CVE.org or the NVD rejects no longer matches.

Changes count at once. When you add a technology or a CPE product identifier, KANAP searches the NVD for that product right away; the technology's **Vulnerabilities** section says "Searching for vulnerabilities…" until the search ends. When the search cannot be completed, the section says so. When a CVE.org name, a version, a server or an application of a technology changes, KANAP matches the technology again as soon as the change is saved. **Refresh**, in the technology's **Vulnerabilities** section, does the same by hand.

## Alerts

Each technology and each version is in the vulnerability alerts or out of them. You choose on the technology, in its versions table: the **Include in vulnerability alerts** switch sets the technology, and the **Alerts** column holds a switch per version. See [Vulnerability alerts](technologies.md#vulnerability-alerts). A version follows the setting of its technology unless it has its own. A server or an application that names no version follows the technology.

Two kinds of technologies are out of the alerts by default:

- **Operating systems**: KANAP does not know the patch level of a server, so an operating system would raise a very large number of vulnerabilities. The CVE.org list adds many more: the publishers of operating systems list the whole version as concerned.
- **Cloud services run by a provider**: a technology hosted in the public cloud or as SaaS, or a catalog entry the provider runs. The provider patches an online service, so its vulnerabilities call for no action on your side. A technology in a private cloud stays in the alerts.

You can include them again on the technology. To follow a single version of an operating system, for example the one your most exposed servers run, turn on its switch in the **Alerts** column of the versions table. The other versions stay out of the alerts.

On SUSE Linux Enterprise Server, turning the switch of a base version also turns the switches of its service packs the same way, and a service pack can then be changed on its own.

A version out of the alerts is still matched with the vulnerabilities. It stays in the technology's **Vulnerabilities** section, and its rows stay on this page under the **Alerts** filter. They are left out of everything else:

- This page shows only the rows in the alerts by default.
- The emails announce only the rows in the alerts.
- The **Vulnerabilities to review** columns of the technologies, assets and applications lists count only the rows in the alerts, as do the records, the badges and the dashboard tile.

## What KANAP counts { #what-kanap-counts }

A vulnerability reaches a server or an application through direct links only, everywhere: on this page, in the lists, on the records, on the dashboard and in Plaid.

- **Server**: the technology and the version are recorded on the server itself. A retired server is not counted.
- **Cluster**: what is recorded on the cluster itself, plus what is recorded on its members in service. A cluster counts the vulnerabilities of its members, in its list column, its badge and its record. Filtering this page on a cluster shows the rows of its members too.
- **Application**: the application declares the technology and the version, or one of its deployment servers has them recorded on itself. An application assigned to a cluster counts the cluster and its members in service. A technology both declared and hosted counts once. A disabled application, or one whose disable date has passed, is not counted.

The counts per server and per application, in the lists, on the records, on the dashboard and in Plaid, follow the same rules:

- **Which vulnerabilities**: those still **To review** whose technology or version is in the alerts. Each vulnerability counts once, even when it concerns several versions.
- **Severity**: the NVD's, or the publisher's (CVE.org) when the NVD has not scored the vulnerability yet. **Severe** means critical or high.
- **Out of service**: a retired server or a disabled application counts nothing. Its cell stays empty.

A virtual machine or a guest does not count the vulnerabilities of its host. A vulnerability of VMware ESXi counts on the ESXi hosts only. Counting through the hosts would put one vulnerability of a hypervisor on almost every server and application of a virtualised estate.

The reach through another asset stays visible, without being counted: in the side panel of a vulnerability, under **Through another asset**, and on the record of an asset, under a closed line **Underlying platform (n)** of its **Vulnerabilities** section. That line holds what only comes from a host, such as the ESXi of the host a virtual machine runs on. See [Assets](assets.md#operations).

## The list

The list uses the standard grid: one row per technology, version and vulnerability. Actively exploited vulnerabilities come first, then the most severe. A vulnerability that concerns three versions of SQL Server gives three rows, each with its own state. It opens on the rows **To review** that are in the alerts: clear the filter of the **State** column to see the other states.

A line above the grid says when KANAP last read each source: **Data read**, then the NVD, the publishers (CVE.org) and the exploitation catalogues (CISA KEV, EU KEV, EPSS and EUVD). The NVD, the publishers, CISA KEV, EU KEV and EUVD show the day and time of the last read. EPSS shows the day of its scores. A source that is off is left out. A warning follows on the same line when the last read of a source failed, or when a source has not been read for more than 3 days. The data of that source may then be out of date.

**Alerts**, **Published** and **Exploited only** sit above the grid. **Alerts** chooses the rows by their alerts setting: **Included** (the default), **Excluded** or **All**. Under **All**, the rows out of the alerts are greyed. When no row is in the alerts and some are excluded, the empty list offers **Show the excluded ones**. **Published** keeps the vulnerabilities by their publication date: **All** (the default), **Less than 7 days**, **Less than 30 days**, **Less than 90 days**, **Less than a year** or **More than a year**. The period counts back from today, so a saved or shared link keeps showing the latest ones. **Exploited only** keeps the vulnerabilities listed as actively exploited. The address carries `exploited=1`. **Reset filters** brings the page back to how it opens: the rows **To review**, actively exploited vulnerabilities first, **Alerts** on **Included**, **Published** on every date and **Exploited only** off. The export and a change of state in bulk follow these three.

**Columns**:

| Column | What it shows |
|---|---|
| **CVE** | The vulnerability's identifier, for example `CVE-2024-1234` |
| **Severity** | **Critical**, **High**, **Medium**, **Low**, **None** or **Not rated**. An alert icon follows the name when CISA or the European Union lists the vulnerability. Its tooltip names the catalogs, and ransomware use when CISA records it. An information icon marks a score released by the publisher: the NVD has not assessed the vulnerability yet |
| **Exploited** | **Yes** or **No**. Hidden by default: the icon in **Severity** shows the same fact |
| **Score** | The CVSS score. Hidden by default |
| **EPSS (%)** | The probability of exploitation within the next 30 days, as a percentage in the language of your screen. For example, 15.3%. The side panel adds the percentile |
| **Summary** | The description of the vulnerability |
| **Technology** | The concerned technology |
| **Version** | The concerned version. **Not recorded** when a server or an application uses the technology without naming its version: the row is then potentially concerned |
| **Publisher** | The technology's publisher. Hidden by default |
| **Servers** | How many servers in service have this version recorded on themselves, as the [technologies list](technologies.md) counts them. Clusters and the servers that run inside another one are not counted. See [What KANAP counts](#what-kanap-counts) |
| **Applications** | How many applications declare this version, or run on a server that has it recorded |
| **Source** | The sources that matched the row: **NVD**, **Publisher** (the record the publisher released on CVE.org), or both |
| **State** | **To review**, **Handled** or **Not affected** |
| **Note** | The note of the row. Hidden by default |
| **Published** | The publication date |

**Filters**: each column has its own filter under its header. **Servers** and **Applications** list the servers and the applications a vulnerability reaches by direct links: search one by name or reference and tick one or several. Several values keep the rows of any of them, and a filter in both columns keeps the rows that match both. The **Applications** filter needs the right to read applications. **Severity**, **Technology**, **Version**, **Publisher**, **Source**, **State** and **Exploited** offer checkboxes (**Version** offers **Not recorded** too, **Exploited** offers **Yes** and **No**), **Score** a number, **EPSS (%)** a minimum percentage from 0 to 100, **Published** a date, **CVE** and **Summary** a text. **Source** offers **NVD**, **Publisher** and **Both**: a row both sources matched stays under **NVD** and under **Publisher**, and **Both** keeps only those rows. The export and a change of state in bulk follow it, as they follow the other column filters. The search box above the grid matches the CVE identifier, the summary and the technology name.

**Sort** by **Exploited**, **Severity**, **Score**, **EPSS (%)**, **Published**, **CVE** or **Technology**. The list opens with actively exploited vulnerabilities first, then the most severe. The column chooser shows or hides columns, and the grid remembers your choice.

**Links**: the page reads its filters from its address, so you can share a filtered list. `?technology=TEC-4` keeps one technology, `?version=none` the rows without a recorded version, `?state=all` every state, `?published=30d` the vulnerabilities published within the last 30 days (`7d`, `30d`, `90d`, `1y` or `older1y`, as the **Published** filter), `?period=30` the same through the filter of the **Published** column, `?alerts=excluded` or `?alerts=all` the rows out of the alerts, `?exploited=1` the actively exploited vulnerabilities. The link of the emails uses `period`.

**Asset and application**: `?asset=AST-12` opens the page with the filter of the **Servers** column set on one asset, and `?application=APP-4` with the filter of the **Applications** column set on one application, by direct links (see [What KANAP counts](#what-kanap-counts)). The lists of assets and applications and their records open the page this way. Clear the column filter to see the other rows. You need to be able to read the application to filter on it.

**In use in the estate**: `?estate=1` keeps the vulnerabilities of the technologies installed on an asset in service or declared by an application in service. The links of the dashboard's **Vulnerabilities in your estate** tile to CVEs open the page with it. A line above the grid shows **In use in the estate · remove**. **remove** clears it.

**Reset filters** also clears these two filters. The export and a change of state in bulk follow them.

## Changing the state of several rows

With `infrastructure:member`, tick the rows to change. The box in the header selects every row of the filter, including the rows not loaded yet; you can then untick some of them. A banner above the grid says how many rows are selected, and **Clear selection** empties it.

**Change state (n)** then asks for:

- The **State** to set.
- A **Common note**, optional. Without a note, each row keeps its own.

Before you confirm, the window says how many rows the change touches, on how many vulnerabilities. A row found after this count stays as it is. Above 5,000 rows, narrow the filters or select fewer rows.

For example, to mark every unrecorded version of PostgreSQL as not affected: filter **Technology** on PostgreSQL and **Version** on **Not recorded**, tick the header box, click **Change state**, choose **Not affected** and write the reason in the note.

## Reviewing a vulnerability

Click a row to open its vulnerability in a side panel. Its header stays in view with the CVE identifier, the severity, the information icon when the score comes from the publisher, and the alert icon when the vulnerability is actively exploited. **Close** (the cross) or Escape closes the panel. The panel covers every technology and version the vulnerability concerns. You see, in this order:

- **Technologies and versions**: each concerned version, with its **State** and a note. Under each version, the badges of the sources that matched it. **Why this row** opens the criteria of each source in plain words, for example "CPE identifier a:apache:tomcat: versions before 9.0.99" for the NVD, or "Apache Software Foundation · Apache Tomcat: versions 9.0.0 to 9.0.98 affected" for the publisher.
- The description, cut at three lines (**See more** shows the rest), the CVSS vector and the reference links (publisher advisories, patches).
- **Sources**: the state of the vulnerability at the NVD (**analyzed**, **awaiting analysis**, **not analyzed**, **rejected**, or **not linked to this product yet**), with a link to its NVD page. When KANAP has read the publisher's record, a second line gives who released it and when, its last update, and **See on CVE.org**.
- **Exploitation**, when a catalog, an EPSS score or a European identifier is known. See [Exploitation](#exploitation).
- **Servers**: each server that has a concerned version recorded on itself, with the technology and the version. The servers reached through another asset, such as a virtual machine on a host or a cluster through its members, are hidden behind a button, for example **Also show the 4 servers reached through another asset**. They show under their own heading, **Through another asset**, with the asset they are reached through. They are not counted.
- **Applications**: each application that uses a concerned version, listed once per version with its servers (three at most, then "and 2 more"). An application that declares the technology, or runs on a server that has it recorded, comes first. The others sit behind the same kind of button and are not counted.

When no server or application is directly concerned, the panel says so, and the button still shows the others.

A version out of the alerts is greyed, with its servers and applications. When only some of them are in the alerts, a line above the list says how many, for example "3 servers, 1 in alerts".

Set the state of each version:

| State | Meaning |
|---|---|
| **To review** | Nobody has looked at it yet |
| **Handled** | The version is patched, or a workaround is in place |
| **Not affected** | The vulnerability does not apply to your installation |

The note records how, for example "patched on 12 March, change CHG-123". It saves when you leave the field. The audit log keeps who changed a state, and when. You can also ask [Plaid](#ask-the-assistant) to change a state.

KANAP never changes a state you chose. When a version no longer matches (you upgraded it, the technology was retired, a source changed its data), a row still **To review** goes away. A row you reviewed stays, greyed out, with its state; it comes back as it was if the version matches again.

## Exploitation { #exploitation }

A vulnerability is **actively exploited** when the CISA catalog (United States) or the catalog of the European Union lists it, or both. An alert icon sits next to the severity, in the list and in the side panel. Its tooltip names the catalogs that list the vulnerability. When CISA records use in ransomware campaigns, the tooltip says so.

**EPSS** is the probability that the vulnerability will be exploited within the next 30 days. [FIRST](https://www.first.org/epss) computes it every day. The **EPSS (%)** column shows it as a percentage. The side panel adds the percentile of that day when one is published, and the day of the score. The panel names the method: EPSS: FIRST.

The side panel also shows the **EUVD** identifier when the European mapping has one, with the link **See on the European vulnerability database (ENISA)**. ENISA's European vulnerability database is the European catalogue used when reviewing vulnerabilities in the scope of NIS2. The panel names the source: ENISA, European vulnerability database.

The list opens with actively exploited vulnerabilities first, then the most severe. **Exploited only**, above the grid, keeps those rows (`?exploited=1`). **Reset filters** turns it off. The export and a change of state in bulk keep it.

The email to the IT owners announces an exploited vulnerability of any severity, on the versions in the alerts, under the same rules as a critical or high one: published within the last 30 days, on a product the technology was already compared on, still to review. A vulnerability already detected that later joins an exploitation catalog is announced once, as now known to be exploited, when it is in the alerts.

## Export

**Export** downloads the vulnerabilities that match the filters as a CSV or Excel file, one line per row of the grid, in its order, in the language of your screen. In the Excel file, scores, EPSS and dates are values Excel can sort and filter. Its **Source** column, after **Match**, gives `NVD`, `CVE.org` or `NVD, CVE.org`. Above 10,000 vulnerabilities, narrow the filters first.

## Email notifications

After each check, the IT owners of a technology receive one email about its new vulnerabilities still to review, on the versions in the alerts. The email includes a vulnerability that is critical or high, or known to be exploited at any severity:

- **What is announced**: a vulnerability published within the last 30 days on a product the technology was already compared on, when it is critical, high or listed as exploited, or a known vulnerability that has just become critical or high.
- **What is not**: the first comparison of a technology, or of a CPE identifier or a CVE.org name you just added, is silent. So is the first comparison of a technology with the CVE.org list. Their results wait on this page.
- **How much**: 25 lines at most, one per technology and vulnerability, then a link to the page, filtered on the vulnerabilities published within the last 30 days.
- **How often**: each person hears about a vulnerability on a technology once. A vulnerability not announced at its check is never announced later.

The recipients are the IT owners of the technology whose account is enabled and who can read the infrastructure. Each one can turn these emails off under **Technology notifications** in their notification settings. See [Settings](admin.md#notifications). No email goes out while email is not configured on your installation.

## Where vulnerabilities also appear

- **Technologies list**: the **Vulnerabilities to review** column, in orange when some are critical or high. See [Technologies](technologies.md#working-with-the-list).
- **Technology workspace**: the **Vulnerabilities** section of the Compliance tab. See [Technologies](technologies.md#vulnerabilities).
- **Assets and applications lists**: the **Vulnerabilities to review** column. See [Assets](assets.md#working-with-the-list) and [Applications](applications.md#working-with-the-list).
- **Asset and application records**: the **Vulnerabilities** section and the badge of severe vulnerabilities in the header. See [Assets](assets.md#operations) and [Applications](applications.md#operations).
- **Dashboard**: the **Vulnerabilities in your estate** tile. See [My dashboard](my-dashboard.md#vulnerabilities).
- **Plaid**: the assistant answers questions about vulnerabilities and changes their state. See [Ask the assistant](#ask-the-assistant).

## Ask the assistant

[Plaid](ai-assistant.md) reads the vulnerabilities with the same rights as this page. It counts rows and distinct CVE, as the page does, keeps the technologies in use in the estate when you ask, and says when KANAP last read each source. Ask, for example: "How many critical vulnerabilities are to review on PostgreSQL, by version?" or "Which exploited CVE reach APP-4?"

With `infrastructure:member`, Plaid also changes the state of rows, and every change comes as a preview that you approve:

- Name a CVE to change all its rows, or add a technology, or a technology and a version.
- Or describe the rows with the filters of the page, for example the critical rows of one technology.
- Give a note to write it on every row. Without a note, each row keeps its own.

One change covers 5,000 rows at most, as **Change state**. The preview says how many rows and CVE change, and how many are out of the alerts. When rows that no longer match go back to **To review**, it counts them: they go away at the next matching. **Accepted** is not a state: Plaid offers **Handled** with a note such as "risk accepted", or **Not affected**, and waits for your choice. Ask Plaid to undo a change it made in the conversation. It refuses when a row changed since.

Ask, for example: "Mark CVE-2024-3094 as not affected on TEC-3 version 5.6, the package is not installed" or "Set the critical rows of PostgreSQL 14 to handled with the note 'patched in March'".

Running the matching again (**Refresh**) stays in the **Vulnerabilities** section of the technology. See [Technologies](technologies.md#vulnerabilities).

## Tips

- **Fill in the CPE identifiers**: most catalog technologies come with them, operating systems included. For the others, search the product in the NIST CPE dictionary.
- **Add the CVE.org names**: they bring in vulnerabilities the NVD has not analysed. Many catalog technologies come with them.
- **Record versions**: a server or application without a version is potentially concerned by everything, which hides the real exposure.
- **Write the note**: the next person to read the vulnerability sees what was done.
