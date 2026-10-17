# Vulnerabilities

The Vulnerabilities page lists the published vulnerabilities (CVE) that concern the versions of your technologies in use, and what each one reaches: the servers that carry a concerned version and the applications that use it. You review each vulnerability and record what you did about it.

Open it from **IT Landscape > Vulnerabilities**, in the **Operations** group. You need `infrastructure:reader` to view it and `infrastructure:member` to change a state. The application counts and lists appear only if you can also read applications.

## Availability

Vulnerabilities are followed by default in the cloud. On an on-premise installation they are off until your administrator turns them on, and the server must then reach the NVD (the US National Vulnerability Database) or a mirror of it. While they are off, KANAP shows none of it: no page, no column in the technologies list, no section on a technology, no notification setting and no email.

## How KANAP finds them

KANAP reads the vulnerabilities published by the NVD every 6 hours and compares them with your technologies:

- **Products**: a technology is compared through its CPE product identifiers (see [Technologies](technologies.md#overview)). A technology without one gets no vulnerability. Retired technologies are left out.
- **Versions**: only the versions in use count: installed on a server in service, or used by an application in service.
- **Version numbers**: versions compare on their numbers, part by part. `2016 SP3` counts as 2016 and `19c` as 19. A version with fewer than three numbers stands for its whole branch: `9.0` covers every `9.0.x`. A version KANAP cannot compare, such as a label without a number, counts as concerned.
- **Unknown version**: a server or an application that names no version is potentially concerned by every vulnerability of the product. Its row reads "Version not recorded (potentially concerned)".

Some vulnerabilities only apply when two products run together, for example Tomcat on Windows. KANAP shows them for the vulnerable product alone, so one may appear for an installation it does not affect. Mark it **Not affected**.

A vulnerability the NVD has not analysed yet appears once it is. A change to a technology's identifiers, versions, servers or applications is taken into account at the next check, or at once with **Match again** on the technology.

## The list

One row per vulnerability, most severe first. The page opens on the vulnerabilities **To review**.

**Filters**:

- **Severity**, **State**, **Editor** and **Technology**: one value, or **All**.
- **Published**: **Any time**, or the last 30, 90 or 365 days.
- **Search**: the CVE identifier, the summary or the technology name.

**Columns**:

| Column | What it shows |
|---|---|
| **CVE** | The vulnerability's identifier, for example `CVE-2024-1234` |
| **Severity** | **Critical**, **High**, **Medium**, **Low**, **None** or **Not rated**, with the CVSS score |
| **Summary** | The NVD description |
| **Technologies** | The concerned technologies and versions |
| **Servers** | How many servers carry a concerned version, directly or through the server they run in |
| **Applications** | How many applications use a concerned version, hosted or declared |
| **State** | **To review** while one version is still to review, **Not affected** when every version is, **Handled** otherwise |
| **Published** | The publication date |

**Show more** loads the next rows.

## Reviewing a vulnerability

Click a row to open it. You see:

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

**Export table as CSV** downloads the vulnerabilities that match the filters, one line per technology version and vulnerability, in the language of your screen. Above 10,000 vulnerabilities, narrow the filters first.

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
