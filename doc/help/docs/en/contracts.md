# Contracts

Contracts document your vendor agreements: software licences, maintenance contracts, SaaS subscriptions and service agreements. KANAP dates each term of a contract, tells you when a renewal decision is due, compares what the contract commits with the budget lines linked to it, and lists the clauses its applications call for.

## Getting started

Navigate to **Budget management > Contracts** to see the list. Click **New** to create a contract (`contracts:member`).

The page opens on a single form. Fill it in, then click **Create**.

**Required fields**:

- **Contract name**: a recognizable name
- **Supplier** and **Contracting company**: who provides the service and which of your companies signed
- **Start**: the first day of the contract
- **Duration (months)**: the length of one term, at least one month
- **Currency**: one of your workspace currencies, the default one to begin with

**Optional fields**:

- **Owner**: the person who manages the contract. The owner receives the renewal decision tasks, so set one
- **Tacit renewal**: **Yes** by default
- **Notice (months)**: blank means no notice
- **Yearly amount**: the annual value at signature, with at most two decimals. Blank means 0
- **Billing**: **Annual** by default, or **Quarterly**, **Monthly**, **Other**

Once the contract exists, every change saves itself. There is no **Save** button.

---

## How terms and deadlines work

KANAP computes the dates of a contract from four fields: **Start**, **Duration (months)**, **Notice (months)** and **Tacit renewal**, plus the **End of validity** when one is set. Nothing is stored: change a field and every date follows.

- **Terms**: a contract runs in terms of the chosen duration, counted from the start date. A contract that starts on 1 July 2024 for 12 months runs from 1 July to 30 June each year.
- **Cancellation deadline**: the end of a term minus the notice. With 6 months notice, the contract above can be cancelled until 30 December each year.
- **Tacit renewal**: with **Yes**, the terms follow one another until an end of validity stops them. With **No**, the contract stops after its first term. When it has an end of validity, it runs term after term up to that day instead, so a contract whose renewal was turned off keeps the terms it has already run.
- **End of validity**: the day the contract stops. No term starts after it. When it falls inside a term, the contract stops on that day.
- **Months at the end of a month**: when the same day does not exist in the target month, the last day of that month is used. 31 March minus one month is 28 February (29 in a leap year).

All dates are calendar days in UTC.

---

## Working with the list

Each row opens the contract. Your search, filters and sort are kept when you come back, and **Previous** / **Next** on the contract page walk through the same set.

**Default columns**:

- **Contract**, **Supplier**, **Company**
- **Next due date**: the next cancellation deadline of a contract that renews tacitly, or the end of any other contract. The date is followed by "in n days". An ended contract shows the day it ended, greyed out
- **State**: see below
- **Yearly amount**: the amount at signature, followed by its currency
- **Committed**, **Budget** and **Gap** for the chosen budget year. See [Budget columns](#budget-columns)
- **Compliance**: the summary of the [Compliance](#compliance) tab: "2 missing · 1 to check" in orange, **Complete**, or **No expectation**
- **Linked lines**: the number of linked budget lines, OPEX and CAPEX together
- **Status**: **Enabled** or **Disabled**, read from the end of validity

**Other columns** (column chooser): **Curr**, **Budget coverage**, **Start**, **Duration (m)**, **Auto-renewal**, **Notice (m)**, **Term end** (end of the current term), **Cancel by** (next cancellation deadline), **Billing**, and **Task** (the latest task of the contract).

**Default sort**: by **Next due date**, soonest first. Ended contracts stay at the bottom in both directions.

### State

Each contract has one state, the first that applies:

- **To decide** (orange): a decision is due. For a contract that renews tacitly, its next cancellation deadline falls within the decision window and its renewal has not been confirmed for that term. For a contract without renewal, its end falls within the window and nobody has confirmed that it should end. See [Renewal decisions](#renewal-decisions)
- **Ends without renewal**: the contract is in its last term and will stop at its end
- **Renewed on** a date: the cancellation deadline of the current term has passed, so the contract goes on into the next term, which starts on that date
- **In progress**: the contract runs and nothing is due yet
- **Expired**: the contract has ended

### Quick filters

The links above the grid filter the list in one click. Click again to remove the filter.

- **To decide within n days (n)**: contracts in the **To decide** state. The number of days is the decision window of your workspace
- **No budget line (n)** and **Under-budgeted (n)**: contracts whose budget coverage for the chosen year is in that state
- **Without cost center**: contracts with no **Cost center or group**. The **Cost center** column (column chooser) shows the field

An orange dot marks a link whose count is not zero.

### Budget columns

With read access to budget lines (`budget:reader`), the right of the toolbar shows **Budget** with a year and a budget column (your workspace's column names). The choice is yours alone. It is shared with the **Budget** tab of every contract and kept for your next visit. It starts on next year and your workspace's default column.

- **Committed** (year): what the contract commits for that year, in your reporting currency. See [Commitment](#commitment-and-coverage)
- **Budget** (year): the sum of the linked lines' amounts in that year and column
- **Gap**: budget minus commitment. A shortfall shows in orange. **No line** means nothing is budgeted on a linked line, and **Contract expired** means budget remains on a contract that has ended
- **Budget coverage** (hidden by default): one of the six coverage states

A contract in a currency that has no exchange rate for the year shows "No USD rate" instead of an amount.

When a linked budget line has no exchange rate for the year, the **Budget** amount leaves it out and shows a small orange mark. **Gap** and **Budget coverage** stay empty, since the coverage is unknown. A one-line warning under the list names the lines left out, for example "Excluding 1 line with no exchange rate: USD 2026." See [Manual rates](currencies.md#manual-rates). Without the budget right, these columns, the selector and the two budget quick filters are hidden.

### Totals row

The row pinned at the bottom reads **Total (n contracts)**. It sums the yearly amounts of the contracts the list shows, converted to your reporting currency with the year's latest rates, and the three budget columns. A currency without a rate is left out of the sum and named, for example "excluding 2 contracts in GBP without a rate".

### Search, filters and scope

- **Quick search**: contract name, supplier and company
- **Column filters**: on each column header. **State**, **Compliance** and **Budget coverage** offer their values as checkboxes. The **Status** filter shows the **Show** choice (**All**, **Enabled** or **Disabled**): changing one changes the other
- **Show: All / Enabled / Disabled**: the toggle above the list. The list shows enabled contracts by default. Pick **All** or **Disabled** to find contracts past their end of validity

### Actions

- **New**: create a contract (`contracts:member`)
- **Import** and **Export**: see [CSV import/export](#csv-importexport) (`contracts:admin`)
- **Export the register**: the compliance register of the contracts the list shows (`contracts:admin`). See [Compliance](#compliance)
- **Settings**: the decision window of the workspace (`contracts:admin`). See [Decision window](#decision-window)
- **Delete**: delete the contracts you tick (`contracts:admin`). See [Deleting a contract](#deleting-a-contract)

---

## The contract page

### Header and properties

The header shows the contract name (click it to rename), **Previous** / **Next** with the position in the list, and a bar with **Supplier**, **Contracting company**, **Owner** and **Status**. The owner and the status change in place. Supplier and company open the **Properties** panel.

The **Properties** panel on the right holds every field of the contract: the parties, **Start**, **Duration (months)**, **Notice (months)**, **Tacit renewal**, **Yearly amount**, **Currency**, **Billing**, then **Lifecycle** (**Status** and **End of validity**), **Created** and **Updated**. Open or close it with its button; KANAP remembers your choice.

**Cost center or group** is optional. It places the contract under a cost center or a group for [data access](data-access.md): the people limited to that node, or to a group above it, see the contract as well as those limited to its company.

Every change saves itself: lists and dates at once, typed values and notes after a short pause, the name when you leave the field. "Saving…" then "Saved" appears in the header. Two people editing the same contract are not warned: the last change wins.

**Lifecycle**:

- Switching the status to **Disabled** ends its validity now: it is disabled at once. While a future date is set, the switch reads **Active until** and that date. Switching it back to **Enabled** removes the end of validity
- **End of validity**: type a date (dd/mm/yyyy) or use the calendar. Leave it blank to keep the contract active
- **Tacit renewal** has its own rules when the contract has already been renewed or awaits a decision. See [Turning the tacit renewal off or back on](#turning-the-tacit-renewal-off-or-back-on)

You need `contracts:member` to edit. Readers see the same page with every field locked.

**Share** in the header emails a link to the contract to colleagues of your workspace.

The page has five tabs: **Overview**, **Budget**, **Compliance**, **Relations** and **History** (the changes made to the contract, see [Record history](record-history.md)). The addresses of the former **Details** and **Tasks** tabs open the overview.

### Overview

**Deadlines** sums up where the contract stands:

- A sentence on what comes next: "Cancellation possible until 30 Dec 2026 · in 78 days", "Notice passed, renewed until 30 Jun 2027", "Ends on 31 Mar 2027 without renewal", or "Ended on 31 Dec 2025". When a decision is due on the end of a contract without renewal, the sentence adds "decision due" with an orange dot
- A timeline of the terms: past terms, the current term, today, the next cancellation deadline and the decision window before it. The next term is dashed while it can still be cancelled, and solid once the notice has passed
- A line of facts: the current term with its dates, how many times the contract has been renewed and since when, and the notice

Once a renewal is confirmed, the sentence reads "Renewal confirmed · next term from 1 Jul 2027 to 30 Jun 2028" and the timeline no longer shows that deadline.

The page recomputes these dates while you edit the start, duration, notice or renewal.

**Renewal decision**: when a decision is due, a box with an orange border appears under the deadlines. See [Renewal decisions](#renewal-decisions).

**Tasks**: the open tasks of the contract, with their reference, assignee, due date and status. **Show completed tasks (n)** adds the finished ones. **New task** creates a task linked to the contract. Open a task to change or delete it.

**Notes**: free text with Markdown formatting. The toolbar appears when you click in the editor.

### Budget

The tab lists the linked budget lines, OPEX and CAPEX together, with their reference (`BL-12`), name, type and company. Use the picker under the table to link or remove lines. A line whose paying company, cost center, supplier or currency differs from the contract shows a small orange mark. Hover the mark to see each difference, with the value on the line and the value on the contract. The picker shows the same mark on a line before you link it. Linking stays possible. The mark appears for a line you can read.

With read access to budget lines (`budget:reader`), the tab also shows figures:

- Year tabs and a **Column** selector, the same choice as the list's budget columns
- Each line's amount in that year and column, with a **Total (n lines)** row
- **Commitment and coverage**: one row per year offered, the chosen year highlighted. Click a row to pick its year

The years offered are the current year and the two after it, and the previous year when the budget holds lines for it.

#### Commitment and coverage

**Committed by the contract** is the yearly amount at signature spread over the months of the year that a term covers. A month covered in part counts by its days. The following years assume the renewal goes on until it is stopped, and nothing is committed after the end of validity or the end of the contract. The amount at signature applies to every term. The commitment is converted to your reporting currency with the year's rates.

For example, a contract of 350 000 a year that renews every 1 July commits 350 000 in each year. If it ends on 30 June 2027, it commits 175 000 in 2027 and nothing in 2028.

**Linked lines** sums the linked lines' amounts in that year and column. **Gap** is the difference. The state is the first that applies:

- **No commitment**: the contract commits nothing that year and no linked line has an amount
- **Budget not started yet**: no budget line of your workspace has an amount in that year and column
- **No budget line**: no linked line has an amount
- **Under-budgeted**: the linked lines hold less than the commitment
- **Budget above the contract**: the linked lines hold more than the commitment plus 10%
- **Covered**: anything else

For a person with limited data access, the tab lists the linked lines they see, then a count of the others. The coverage still counts every linked line, so the owner of the contract sees the real coverage. In the list, each row shows that full coverage too, while the totals row counts the visible contracts and **Linked lines** counts the visible lines. See [Data access](data-access.md#what-a-limited-person-sees).

When a linked line has no exchange rate for a year, its amount shows in its own currency with a small orange mark, and the total and **Linked lines** leave it out. The state of that year reads **Unknown: a linked line has no exchange rate**. A one-line warning under the coverage table names the lines left out, for example "Excluding 1 line with no exchange rate: USD 2026." See [Missing rate](currencies.md#conversion-mechanics-quick-reference) and [Manual rates](currencies.md#manual-rates).

### Compliance

The tab lists the clauses a contract is expected to hold, given the applications it covers, and lets you record whether the contract has them. It helps you keep a register. It does not certify compliance with any regulation.

**Requirements**: **GDPR data processing agreement (art. 28)**, **Data location**, **Reversibility clause**, **Exit plan**, **Audit rights and security clauses**.

**Why a requirement is expected**: the contract covers the applications linked to it, and the applications with an instance on an asset linked to it or whose support contract it is. An application past its end of validity no longer counts.

- An application that holds personal data makes the data processing agreement and the data location expected
- A high business or cyber criticality makes the reversibility clause, the exit plan and the audit rights expected. High means the two most severe levels of your catalog (only the most severe when the catalog has fewer than three levels)
- An instance hosted in the cloud makes the data location expected. The hosting type's category in **IT Landscape > Settings** decides what counts as cloud

The **Expected because** column gives the first reason, for example "SAP S/4HANA holds personal data", then "and n more". Hover it to read them all. A reason that comes through an asset names it if you read the infrastructure. An application you cannot read (or, for a Business Contributor, one you do not take part in) reads "An application you cannot see": the requirement stays expected.

**Recording**: pick a state for each requirement: **Present**, **Missing**, or **Not applicable**. It saves at once. An expected requirement without a state reads **To check**. Type a **Reference** (for example "article 18.3"); it saves when you leave the field or press Enter. Hover a row to see when it was last updated and by whom.

**Show the other requirements (n)** adds the requirements nothing calls for, so you can record them too. When nothing is expected, the tab says so in one line.

The tab's badge counts the expected requirements recorded as missing. In the list, the **Compliance** column reads:

- **n missing** (and "· n to check"), in orange
- **n to check**
- **Complete**: every expected requirement is present or not applicable
- **No expectation**

Linking or removing an application or an asset in **Relations** updates the tab at once. You need `contracts:member` to record; readers see the tab read-only.

**Export the register** (list, `contracts:admin`) downloads a CSV or Excel file of the contracts the list shows, with its search, filters, scope and order: one line per contract and requirement, with whether it is expected, the reason, the state, the reference and the last update. Headers and words follow the language of your screen.

### Relations

The Relations tab shows what this contract covers: its applications, assets and technologies, each in its own table, then suggestions, contacts, and links and files. Click a row to open the record. Budget lines are linked on the [Budget](#budget) tab.

**Linked records**, one table each:

| Section | Columns |
|---|---|
| **Applications** | Reference (`APP-3`), name, lifecycle, business criticality. Shown only if you can read the applications. A Business Contributor sees the applications they take part in |
| **Assets** | Reference (`AST-12`), name, type, environment, status. Shown only if you can read the infrastructure |
| **Technologies** | Reference (`TEC-5`), name, family, vendor. Shown only if you can read the infrastructure |

A disabled or retired application or asset stays listed with its name greyed out. The applications and assets feed the [Compliance](#compliance) tab. An asset whose support contract is set to this one on the asset page is not listed here. It still counts for compliance.

**Adding and removing links** (`contracts:member`): **Add** at the right of a section opens a search. Type a name or a reference and pick a result: the link is saved at once. The search offers the applications and assets you can see. Retired technologies are not offered. To remove a link, hover the row and click the cross at its end. Removing a link deletes nothing else. Linking an application also needs a read of the applications, and linking an asset or a technology a read of the infrastructure. A Business Contributor links and removes only the applications they take part in; the other applications of the contract stay linked. Readers see the tables read-only.

**Related**: applications and assets of the contract's supplier that are not linked yet, with the reason "same supplier". An asset belongs to the supplier through its support vendor. Click **Link** to add the suggestion to its section. The suggestions show:

- applications in service, if you can read the applications. A Business Contributor only sees the applications they take part in;
- assets that are not retired, if you can read the infrastructure;
- at most 20 of each.

The section is absent when there is nothing to suggest.

**Contacts**: people for this contract, each with a role (Commercial, Technical, Support or Other). **Add the supplier's contacts** copies the supplier's contacts in one click.

**Links and files**: the web links of the contract (the signed PDF online, the vendor portal) and its files, one row each with its name, the domain of the link or the size of the file, and the date it was added. Click a link to open it in a new tab, or a file to download it. With `contracts:member`:

- **Add link** opens a dialog for a URL and an optional name; the link is saved at once. To change a link, hover its row and click the pencil.
- **Attach file** opens the file chooser. You can also drop files on the section.
- To remove a link or a file, hover the row and click the cross. Removing a link shows a message and offers **Undo**, which creates the link again. Deleting a file asks for confirmation first.

### Deleting a contract

**Delete** (trash icon) in the header of the contract page, or in the list for the contracts you tick, deletes contracts (`contracts:admin`). This cannot be undone.

- The links go and the linked items stay: budget lines, applications, assets (also those whose support contract it is) and contacts lose their link to the contract
- What belongs to the contract goes with it: its tasks (the renewal decision task included), relevant websites and attachments
- A contract with recorded compliance requirements (a state, including **Not applicable**, or a reference) cannot be deleted: KANAP says how many are recorded and suggests disabling it instead. In the list, the confirmation names the contracts kept, with their count, before anything is deleted; the others are deleted
- A confirmation always comes first. It counts what loses its link and what goes too, or says that the contract is linked to nothing

To stop using a contract and keep its history, disable it instead.

---

## Renewal decisions

KANAP asks the owner to decide each renewal before it happens, and records the decision.

### Decision window

A contract that renews tacitly awaits a decision when its next cancellation deadline is within the decision window. A contract without renewal awaits one when its end is within the window. The window is 90 days by default. Contract administrators change it with **Settings** on the list, from 0 to 365 days.

The window drives the **To decide** state, the quick filter, the decision box, the timeline and the decision tasks.

### The decision task

Every day at 07:30 UTC, KANAP creates a task for each contract that awaits a decision:

- **Decide on the renewal of** the contract, due on the cancellation deadline, for a contract that renews tacitly
- **Decide whether to renew or let** the contract **end**, due on its end, for a contract without renewal

The task is assigned to the contract's owner, with the usual assignment email. Its text is in the owner's language, or in the workspace language when the owner has not chosen one. There is one task per contract and term. A task you delete is not created again for that term. A contract without an owner gets no task until one is set.

The decision box and the task stay in step: a decision taken in the box closes the task, with the justification as a comment.

### Deciding

The box shows the deadline, the days left, the task and its assignee, and what happens without a decision ("Without a decision, the contract renews for 12 months on 1 Jul 2027"). Type an optional **Justification**, then choose:

- **Renew**: the renewal is confirmed for this term. The task is closed, the contract leaves **To decide**, and it comes back into the window at the next term's deadline
- **Renegotiate**: the box reads **Renegotiation in progress** and the task stays open until the final decision. The contract stays in **To decide**
- **Terminate**: the box shows the end date to confirm. KANAP proposes the earliest end the notice allows ("6 months notice: the earliest possible end is 30 Jun 2027"). You can pick another day, from today and from the contract's start. A day before the proposed one shows an orange warning: the supplier has to agree to it. The box lists the consequences for that day: the commitment of the year and the next, the applications that lose this contract, and the assets that lose their support contract, each if you can read its module. **Confirm termination** turns the tacit renewal off, sets the end of validity to that day and closes the task. The contract then reads **Ends without renewal** and its commitment stops on that day

For a contract without renewal, the box reads "Ends on 31 Mar 2027 · decision due" and offers two actions:

- **Renew**: turns the tacit renewal back on and removes the end of validity
- **Let it end**: confirms the end. Nothing else changes

Once decided, the box shrinks to one line, for example "Renewal confirmed on 2 Oct 2026 by Sophie Laurent. The contract renews on 1 Jul 2027.", with the task and the justification. After a termination, it reminds you to send the termination letter before the deadline and to attach it in **Relations**.

**Undo the decision** puts the contract and the task back as they were: before the cancellation deadline, or before the end for a contract without renewal.

You need `contracts:member` to decide. Readers see the box without its actions.

### Turning the tacit renewal off or back on

**Tacit renewal** in the **Properties** panel follows the same rules.

**No** on a contract already renewed, or one that awaits a renewal decision, opens **Turn off the tacit renewal**. It proposes an end date as a termination does (earliest end the notice allows, any day from today, orange warning before the proposed day, consequences for the day chosen) and says "The contract will end on 30 Jun 2027, unless renewed." For a contract already renewed, it adds that its past terms are kept. **Turn off the renewal** sets that end of validity and the field reads **No**. **Cancel** changes nothing.

This records no decision. The contract now awaits a decision on its end: an open decision task becomes "Decide whether to renew or let the contract end", due on the new end, with a comment that says why. Without an open task, one is created when the end falls within the window.

On a contract in its first term with no decision due, **No** applies at once: the contract stops at the end of its first term.

**Yes** on a contract without renewal that has an end of validity opens **Turn the tacit renewal back on**: "The contract will renew tacitly and the end on 31 Mar 2027 will be removed." **Turn the renewal back on** applies it, whatever set that end. When a decision was due on the end, this counts as **Renew** and can be undone. Otherwise the open task on the end becomes the renewal decision task when that decision is due, or is closed. Without an end of validity, **Yes** applies at once.

---

## CSV import/export

The export writes a CSV file or an Excel workbook (`.xlsx`): choose under **Format** in the dialog. The import reads either. See [CSV and Excel files](csv-files.md).

Keep your contract list in sync with other tools using CSV files or Excel workbooks (`contracts:admin`).

**Export**: downloads the contracts the list shows (or, on request in the dialog, every contract) with these columns: `name`, `company_name`, `supplier_name`, `start_date`, `duration_months`, `auto_renewal`, `notice_period_months`, `yearly_amount_at_signature`, `currency`, `billing_frequency`, `status`, `owner_email`, `notes`. The computed dates (term end, deadlines, state) are not exported.

**Import**:

- Use **Preflight** to check the file before applying it
- A row is matched to a contract by contract name and supplier
- Supports creation and updates
- The file has no end of validity column. On an update, a blank `status`, or one equal to the contract's current status, keeps its end of validity. A different status applies it: `enabled` clears the end of validity, and `disabled` ends the contract today unless its end of validity has already passed
- A new contract is enabled unless the row says `disabled`
- A row that sets `auto_renewal` to false on a contract already renewed and without an end of validity is refused, preflight included: it would erase the terms the contract has run. Turn the renewal off from the contract page, which sets the end

**Notes**:

- See [CSV and Excel files](csv-files.md) for the encoding, the separator, the date and amount forms, and the two import steps
- Dates are computed from the start, duration, notice and renewal; they are never imported

---

## Tips

- **Set an owner on every contract**: the renewal decision tasks go to the owner. A contract without one gets no task.
- **Start the week with To decide**: the quick filter lists the contracts whose decision is due, and the decision box on each one shows what happens without a decision.
- **Link budget lines early**: the **Gap** and **Under-budgeted** filter only help when the contract is linked to the lines that pay for it.
- **Record the yearly amount**: even when billing is monthly, the yearly amount drives the commitment and the totals.
- **Link applications and assets**: they decide which clauses the contract is expected to hold.
- **Share a contract**: use **Share**, or copy the page address. It opens the same tab and keeps your list context.
