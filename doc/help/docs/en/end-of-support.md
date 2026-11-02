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

- A technology version touches the servers it is installed on, and the applications that declare it or are hosted on a server that carries it (including the virtual machines inside such a server).
- An operating system touches the servers that run that version, and the applications deployed on them and on what they contain. Its row opens the technology.
- A piece of hardware touches its servers, what they contain, and the applications deployed on all of them. The hardware itself is not one of its servers.
- An application touches the servers it is deployed on. On a cluster, these are the cluster and its members in service.

The servers of a technology or an operating system are counted as in the **Servers** column of the [technologies list](technologies.md): the servers in service it is installed on, clusters excluded. The servers of a piece of hardware are the assets it carries, clusters excluded. The applications of a cluster still count.

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

**Export table** downloads the list on screen as a CSV or Excel file: the deadlines with the current horizon and type, or the missing data. Headers follow the language of your screen, and dates are real dates in the Excel file, which adds a **Parameters** sheet. See [Reporting](reports.md#export-options). **Print / Save as PDF** prints the report.

## Ask the assistant

[Plaid](ai-assistant.md) reads both views, **Deadlines** and **Missing data**, with the same rights as the report. It names each item by its reference (`APP-4`, `AST-12`, `TEC-3`) and reads one horizon at a time: 6, 12, 24 or 36 months. Plaid lists the deadlines 30 at a time and can read the following pages; its counts and totals cover every deadline. When you cannot read applications, Plaid says that it left the application rows out.

Plaid can also add technology versions and correct their support dates, with your approval. The end of support of an application is a field of the application: Plaid changes it as it changes the application, with the rights of the [Applications](applications.md) page.

Ask, for example: "Which applications reach their end of support in the next six months?", "End of support deadlines for the next twelve months, by type", "Which records should I complete for the End of support report?", "PostgreSQL 16 ends its support on 31/12/2028" or "Clear the end of extended support date of version 14 of TEC-3".

## Tips

- **Clear the missing data first**: a server without its technologies, or a version without a date, never shows up in the deadlines.
- **Look 24 months ahead for budgets**: a migration planned next year needs its money in this year's budget.
- **Use the catalog**: technologies added from the catalog come with their end of support dates. They come from endoflife.date, or from the publisher's official pages for the products KANAP maintains (see [Versions from the catalog](technologies.md#versions-from-the-catalog)).
