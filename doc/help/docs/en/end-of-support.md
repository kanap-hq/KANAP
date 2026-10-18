# End of support

The End of support report lists what has reached, or soon reaches, the end of its support, and what each item touches: the servers that run it and the applications that rely on it. A second view lists the missing data that keeps the report from answering.

Open it from **IT Landscape > End of support**, in the **Operations** group. You need `infrastructure:reader`. The application columns and rows appear only if you can also read applications.

## Deadlines

The **Deadlines** view shows one row per item whose support has ended, or ends within the horizon. The subtitle gives the last day the horizon covers.

What the report watches:

| Type | What ends | Where the date comes from |
|---|---|---|
| **Technology** | A version in use on a server in service, or declared by an application in service | The version's end of standard and extended support, on the [technology](technologies.md#overview) |
| **OS** | A version of an operating system in use on a server in service | The version's end of standard and extended support, on the technology of the **Operating system** family |
| **Application** | An application in service | Its end of support date |
| **Hardware** | A physical asset in service | Its end of life or the end of its support contract, shown in the **Version** column |

Retired assets, disabled applications and versions nobody uses are left out.

**Filters**:

- **Type**: one of the four types, or **All types**.
- **Horizon**: 6, 12, 24 or 36 months. 12 months by default.

**Columns**: **Type**, **Item** (opens the record), **Version**, **End date**, **State**, **Servers** and **Applications** (how many each item touches).

**State**:

- **Out of support**: every end date has passed.
- **Extended support**: standard support has ended, extended support still runs.
- **Ends soon**: support ends within the horizon.

**What an item touches**: click a row to unfold the servers and the applications behind its counts. Each name opens its record.

- A technology version touches the servers that carry it (including the virtual machines inside a host that carries it) and the applications hosted on them or that declare it.
- An operating system touches the servers that run that version, what they contain, and the applications deployed on all of them. Its row opens the technology.
- A piece of hardware touches its servers, what they contain, and the applications deployed on all of them.
- An application touches the servers it is deployed on.

## Missing data

The **Missing data** view lists the records to complete so that the deadlines are right. Click a row to open the record.

| Missing data | What it means |
|---|---|
| **Hosted application without a server** | An application hosted on premises or in a private cloud has no server on a deployment in service |
| **Virtual machine without a host** | No asset contains this virtual machine |
| **On-premises technology on no server** | A technology whose hosting type is on premises (On-prem, Colocation) runs on no server |
| **Technology without a hosting type of the IT settings** | The technology's hosting type is no longer in the **Hosting types** list of the IT settings. Choose another one on the technology |
| **Database server without a database technology** | A server holds a database role for an application, yet carries no technology of the **Database** family |
| **Application with SSO without an identity technology** | An application uses SSO and has no technology of the **Directory and identity** family |
| **Technology link without a version** | A server or an application uses a technology without saying which version |
| **Version in use without an end of support date** | The report cannot tell when this version ends |

The rows about applications need the right to read applications.

## Export and print

**Export table as CSV** downloads the list on screen: the deadlines with the current horizon and type, or the missing data. Headers follow the language of your screen. **Print / Save as PDF** prints the report.

## Tips

- **Clear the missing data first**: a server without its technologies, or a version without a date, never shows up in the deadlines.
- **Look 24 months ahead for budgets**: a migration planned next year needs its money in this year's budget.
- **Use the catalog**: technologies added from the catalog come with their end of support dates.
