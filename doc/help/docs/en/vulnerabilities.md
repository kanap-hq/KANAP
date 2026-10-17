# Vulnerabilities

The Vulnerabilities page lists the published vulnerabilities (CVE) that concern the versions of your technologies in use, and what each one reaches: the servers that carry a concerned version and the applications that use it. You review each vulnerability and record what you did about it.

Open it from **IT Landscape > Vulnerabilities**, in the **Operations** group. You need `infrastructure:reader` to view it and `infrastructure:member` to change a state. The application counts and lists appear only if you can also read applications.

## Availability

Vulnerabilities are followed by default in the cloud. On an on-premise installation they are off until your administrator [turns them on](on-premise/configuration.md#optional-vulnerabilities), and the server must then reach the NVD (the US National Vulnerability Database) or a mirror of it. While they are off, KANAP shows none of it: no page, no column in the technologies list, no section on a technology, no notification setting and no email.

## How KANAP finds them

KANAP reads the vulnerabilities published by the NVD every 6 hours and compares them with your technologies:

- **Products**: a technology is compared through its CPE product identifiers (see [Technologies](technologies.md#overview)). A technology without one gets no vulnerability. Retired technologies are left out.
- **Versions**: only the versions in use count: installed on a server in service, or used by an application in service.
- **Version numbers**: versions compare on their numbers, part by part. `2016 SP3` counts as 2016 and `19c` as 19. A version with fewer than three numbers stands for its whole branch: `9.0` covers every `9.0.x`. A version KANAP cannot compare, such as a label without a number, counts as concerned.
- **Unknown version**: a server or an application that names no version is potentially concerned by every vulnerability of the product. Its row reads "Version not recorded (potentially concerned)".

Some vulnerabilities only apply when two products run together, for example Tomcat on Windows. KANAP shows them for the vulnerable product alone, so one may appear for an installation it does not affect. Mark it **Not affected**.

A vulnerability the NVD has not analysed yet appears once it is.

Changes count at once. When you add a technology or a CPE product identifier, KANAP searches the NVD for that product right away; the technology's **Vulnerabilities** section says "Searching for vulnerabilities…" until the search ends. When a version, a server or an application of a technology changes, KANAP matches the technology again as soon as the change is saved. **Match again** on the technology does the same by hand.

## The list

The list uses the standard grid: one row per vulnerability, most severe first. It opens on the vulnerabilities **To review**: clear the filter of the **State** column to see the others.

**Columns**:

| Column | What it shows |
|---|---|
| **CVE** | The vulnerability's identifier, for example `CVE-2024-1234` |
| **Severity** | **Critical**, **High**, **Medium**, **Low**, **None** or **Not rated** |
| **Score** | The CVSS score. Hidden by default |
| **Summary** | The NVD description |
| **Technologies** | The concerned technologies and versions |
| **Publisher** | The publishers of these technologies |
| **Servers** | How many servers carry a concerned version, directly or through the server they run in |
| **Applications** | How many applications use a concerned version, hosted or declared |
| **State** | **To review** while one version is still to review, **Not affected** when every version is, **Handled** otherwise |
| **Published** | The publication date |

**Filters**: each column has its own filter under its header. **Severity**, **Technologies**, **Publisher** and **State** offer checkboxes, **Score** a number, **Published** a date, **CVE** and **Summary** a text. The search box above the grid matches the CVE identifier, the summary and the technology name.

**Sort** by **Severity**, **Score**, **Published** or **CVE**. The column chooser shows or hides columns, and the grid remembers your choice.

## Changing the state of several vulnerabilities

With `infrastructure:member`, tick the vulnerabilities to change, then click **Change state (n)**. Without a selection, **Change state** works on every vulnerability of the current filter. The window asks for:

- The **State** to set.
- A **Common note**, optional. Without a note, each row keeps its own.
- With a selection, you can tick **Every vulnerability of the current filter** to widen it.

Before you confirm, the window says how many rows (technology versions) the change touches, on how many vulnerabilities. A vulnerability that arrives after this count is left as it is. Above 5,000 rows, narrow the filters or select fewer vulnerabilities.

## Reviewing a vulnerability

Click a row to open the vulnerability in a side panel. You see:

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

**Export CSV** downloads the vulnerabilities that match the filters, one line per technology version and vulnerability, in the language of your screen. Above 10,000 vulnerabilities, narrow the filters first.

## Email notifications

After each check, the IT owners of a technology receive one email about its new critical or high vulnerabilities still to review:

- **What is announced**: a vulnerability published within the last 30 days on a product the technology was already compared on, or a known vulnerability that has just become critical or high.
- **What is not**: the first comparison of a technology, or of a CPE identifier you just added, is silent. Its results wait on this page.
- **How much**: 25 lines at most, one per technology and vulnerability, then a link to the page for the rest.
- **How often**: each person hears about a vulnerability on a technology once. A vulnerability not announced at its check is never announced later.

The recipients are the IT owners of the technology whose account is enabled and who can read the infrastructure. Each one can turn these emails off under **Technology notifications** in their notification settings. See [Settings](admin.md#notifications). No email goes out while email is not configured on your installation.

## Where vulnerabilities also appear

- **Technologies list**: the **Vulnerabilities to review** column, in orange when some are critical or high. See [Technologies](technologies.md#working-with-the-list).
- **Technology workspace**: the **Vulnerabilities** section of the Relations tab. See [Technologies](technologies.md#vulnerabilities).

## Tips

- **Fill in the CPE identifiers**: catalog technologies come with them. For the others, search the product in the NIST CPE dictionary.
- **Record versions**: a server or application without a version is potentially concerned by everything, which hides the real exposure.
- **Write the note**: the next person to read the vulnerability sees what was done.
