# Interfaces

Interfaces document the logical data flows between your applications. Each interface represents a business integration (the "why" and "what" of data exchange), independent of how it is technically implemented. The workspace lets you describe the interface, define the legs that move data through your landscape, configure environment-specific bindings, capture the field-level mapping rules, and link related interfaces, documents, and attachments.

## Getting started

Navigate to **IT Landscape > Interfaces** to see your integration registry. Click **Add interface** to create a new entry, or open an existing one to edit it.

**Add interface** opens the interface page on the **Flow** tab, where its required fields are:

- The title: a descriptive name for the integration
- **Source application** and **Target application**, on the **Flow** tab
- **Data category**, in the properties panel: the type of data being transferred

You can fill them in any order. Nothing is saved until all four are filled. As soon as they are, Kadratis creates the interface with everything the draft holds and assigns its reference (`INT-4`). The page moves to the interface, and **Environments**, **Data mapping**, **Relations** and **History** open.

**Tip**: Set the **Route type** early. It controls which legs are generated automatically and what shows up on the Flow tab and the Environments matrix.

### Creating or cancelling { #cancelling-a-creation }

While the interface is being created, its header shows **Create** and **Cancel**. They stay until you leave the interface.

- **Create** keeps the interface and takes you back to where you started. If something is still missing, a message names it, and the title or the first missing field gets the focus. If the draft is complete, Kadratis creates the interface and takes you back at once
- **Cancel** deletes the interface. If you added anything after it was created, a confirmation lists what will be deleted. You can cancel your own creation without the right to delete interfaces

Leaving the interface another way (the menu, the back arrow) keeps it: it is complete.

Before the interface is created, **Cancel**, the back arrow, or Escape on the title leaves without saving. When the draft holds something, a confirmation asks before it is discarded. A link in the menu asks the same.

---

## Working with the list

The Interfaces grid shows your integration registry at a glance.

**Default columns**:

- **Reference**: The reference Kadratis assigns (`INT-4`)
- **Interface code**: Your own short code, when set
- **Name**: Interface name
- **Environments**: Coloured dots showing which environments already have bindings configured (e.g., PROD, QA, DEV)
- **Source App** and **Target App**: The connected applications
- **Lifecycle**: Current status
- **Criticality**: Business importance
- **Created**: When the record was created

**Additional columns** (via column chooser):

- **Business process**: Linked business process
- **Data category**: Type of data being transferred
- **Contains PII**: Whether the interface handles personal data
- **Env coverage**: Number of environments with at least one binding
- **Bindings**: Total number of environment bindings

**Filtering**:

- Quick search across all text columns
- Column filters on the text columns
- **Lifecycle**, **Criticality**, **Business process**, **Data category** and **Contains PII** use checkbox filters, so you can pick several values at once. The **Criticality** filter also offers **(Blank)** for interfaces without a criticality

**Sorting**:

- **Criticality** sorts by severity, in the order of the levels in [Classifications and continuity](it-ops-settings.md#classifications-and-continuity). Interfaces without a value come last

**Actions**:

- **Add interface**: Create a new interface (requires `applications:member`)
- **Duplicate interface**: Create a copy of a selected interface (requires `applications:member`). Select exactly one row to enable this action. A dialog lets you choose whether to copy environment bindings (see [Copying interfaces](#copying-interfaces) below).
- **Delete selected**: Remove selected interfaces (requires `applications:admin`). Before the confirmation, the window lists the interfaces that have bindings as kept, with their count of bindings. Check **Also delete related bindings** to delete them with their bindings; their connections stay. The message then names the interfaces deleted and those kept, with the reason.

---

## The Interfaces workspace

Click any row to open the workspace. The workspace has six tabs, with the interface properties in a side panel on the right. The name in the header can be edited in place. The last one, **History**, lists the changes made to the interface (see [Record history](record-history.md)).

The header carries **Delete**, a trash icon with its name in a tooltip (`applications:admin`). The confirmation uses the same check as **Delete selected**. It says this cannot be undone. When the interface has bindings, it explains them and offers **Also delete related bindings**: the delete is available once that option is checked, the bindings go with the interface, and the connections stay. The list opens again afterwards.

### Interface properties (side panel)

The side panel stays visible across every tab. Click its **Properties** tab to collapse or expand it. It holds three groups of fields:

**Identification**:

- **Reference**: Assigned by Kadratis, read-only
- **Interface code**: Your own short code
- **Business process**: Link to a business process from master data
- **Lifecycle**
- **Created on** and **Updated on**: Read-only dates

**Team**:

- **Business owners**: Business stakeholders accountable for the integration
- **IT owners**: Technical team members responsible for maintenance
- **Impacted companies**: The companies affected by the integration

**Data and compliance**:

- **Criticality**: Business importance
- **Data category** (required): The kind of data being transferred
- **Data class**: Sensitivity level
- **Contains PII**: When switched on, a **PII description** field appears so you can detail what PII is included
- **Data residency**: Countries where the data flows

Field changes in the side panel are saved automatically, so you can update properties from any tab without switching context. The source and target applications, the route type and the middleware are set on the Flow tab.

---

### Overview

The Overview tab holds the **Specification**, a managed rich-text document where you describe the interface end to end: business context, scope, contract, examples. It is the primary narrative document for the interface.

**Tip**: Use this tab as your single source of truth for prose. Mapping rules and technical legs live in the dedicated tabs below; keep this document focused on intent, scope, and the human-readable summary.

---

### Flow

The Flow tab sets the route of the interface, then the shared **legs** that make it up.

**Logical flow**:

- **Source application** and **Target application** (required)
- **Route type**: Direct or Via middleware
- **Middleware applications**: Only shown when the route type is Via middleware. The list is restricted to applications flagged as ETL/middleware.

**Leg template**: Legs describe what each step does in general (the same definition applies across every environment). For each leg you can edit:

- **Leg type**: Extract, Transform, Load, or Direct (set automatically based on the integration route)
- **From -> To**: Which role handles each step (Source app, Target app, or Middleware)
- **Trigger type**: What initiates this leg (e.g., scheduled, event-driven, manual)
- **Pattern**: The integration pattern (e.g., batch, real-time, pub/sub)
- **Format**: The data format (e.g., JSON, XML, CSV, flat file)
- **Job name**: An optional default job or process name

If no legs appear yet, select the source and target applications. Legs are generated from the **Source application**, **Target application** and **Route type**.

---

### Environments

The Environments tab manages the per-environment bindings that turn the leg templates into actual configurations. It presents a matrix with one row per leg and one column per environment, so you can configure each combination independently.

**Environments**:

- **Add environment** (`applications:member`) offers the environments where the source and target applications (and the middleware, for a route via middleware) all have a deployment. Deployments are created in the Applications workspace.
- An environment appears in the matrix once you add it or once it has a binding.
- To delete an environment, click the trash icon in its column header. The confirmation gives the number of bindings deleted with it.
- A strip above the matrix shows each environment with the number of legs configured out of the total, for example `QA 2/3`. The dot is green when every leg is configured, orange when some are, and grey when none is.

**Cells**: Each cell shows the binding status and its source and target endpoints. Once you have opened a binding, its cell also shows its infrastructure connection: the first one, with a count of the others when there are more (`+2`). An **Active** binding with no infrastructure connection then shows **Missing connection** in orange. Click an empty cell to add a binding, or a configured cell to edit it. The trash icon in a cell deletes its binding, after a confirmation.

**Binding panel**: Clicking a cell opens a panel beside the matrix.

- For a new binding, fill the fields and click **Add binding**. The **Source deployment** and **Target deployment** selectors appear when the application has more than one deployment in that environment; otherwise the only deployment is used. The **Integration tool** selector appears, and is required, for a route via middleware when more than one middleware application has a deployment in the environment.
- For an existing binding, each change is saved as you go. The panel header shows when the change is saved.

**Binding fields**:

- **Status**: The [lifecycle statuses](it-ops-settings.md#lifecycle-statuses): Proposed, Active, Deprecated, Retired, plus any your administrator adds
- **Authentication mode**: How the binding authenticates
- **Infra connection**: The infrastructure connection from your connection registry, so you can trace the full path from logical interface down to the physical network connection. The panel edits one connection. When the binding has more, the others are listed as a count and kept unchanged.
- **Source endpoint** and **Target endpoint**: Technical endpoints (URLs, paths, queue names, etc.)
- **Trigger details**: Environment-specific trigger configuration
- **Job name override**: Replaces the leg template's job name in this environment
- **Monitoring URL**: Link to monitoring or observability for this binding
- **Notes**: Environment-specific notes

---

### Data mapping

The Data mapping tab is where you describe how source fields turn into target fields. It is organised around two concepts:

- **Mapping rules** describe a single mapping decision: one or more source fields, one or more target fields, an operation (direct copy, transform, lookup, split, merge, filter, default value, or a custom operation), and optional condition / business / middleware notes.
- **Mapping groups** are folders that organise the rules into themed sections (for example "Header", "Customer block", "Line items", "Footer"). Rules can be assigned to a group or left ungrouped. Two baseline groups, **Head** and **Item**, are always present; you can add more.

The tab works on the interface's **default mapping set**. The header bar shows the set name, the current revision number, the rule and group counts.

**Filtering rules**:

Use the **Group view** dropdown above the rules table to focus on:

- **All rules** (default)
- **Ungrouped** rules (with the count)
- A specific group (showing the order, title, and rule count)

**Managing groups**:

Click **Manage groups** to open the group manager. From there you can:

- Add a new group (title, optional description, order)
- Edit an existing group
- Delete a non-baseline group (rules assigned to it move to Ungrouped)

The **Head** and **Item** baseline groups can be selected but not edited or deleted.

**Adding or editing a rule**:

Click **Add rule** or click any rule row to open the rule drawer on the right. Rule fields:

- **Rule title** (required) and optional **Rule key** (a stable technical identifier for exports or downstream systems)
- **Group**: Assign to a group or leave Ungrouped
- **Source field(s)**: One row per source binding. Each row has a **path** (e.g., `origin.customerId`) and an optional **type** (string, number, date, etc., or any free-text descriptor). Use multiple rows to model 1:N or N:1 mappings.
- **Target field(s)**: Same structure, one row per destination binding
- **Operation**: Direct copy, Transform, Lookup, Split, Merge, Filter, Default value, or **Other** (with a free-text label)
- **Applies to leg**: Restrict the rule to a specific leg (e.g., only the EXTRACT leg) or leave as **All legs**
- **Order**: Display order within the group
- **Condition**: When the rule applies
- **Business rule**: Plain-language explanation of the business logic
- **Middleware / transformation note**: Implementation notes for the middleware or ETL team
- **Remarks**: Anything else worth noting

The mapping table summarises each rule by listing the source bindings, an arrow, and the target bindings, plus the operation, the group it belongs to, and the leg scope. Click a row to edit it, or use the row's icons to edit or delete.

**Tip**: Keep one rule per logical decision rather than one rule per field. A rule that takes three source fields and produces one concatenated target field is clearer than three near-identical rows, and the operation field makes the intent explicit.

---

### Relations

The Relations tab shows what this interface depends on and what depends on it, with its links and files. The knowledge documents linked to the interface come first, then the upstream interfaces, the downstream interfaces, and the links and files. The tab badge counts the upstream and downstream interfaces, and the links and files. Knowledge documents are not counted.

**Upstream interfaces** and **Downstream interfaces**: one table each, with the reference (`INT-4`), name, source application, target application and lifecycle. Click a row to open the interface. A retired interface stays listed with its row greyed out. Use these sections to document an order, such as "Order Sync must run before Invoice Sync".

A dependency goes one way. If you add interface B upstream of interface A, B appears upstream on A only. A does not appear downstream on B.

**Adding and removing interfaces** (`applications:member`): **Add** at the right of a section opens a search of interfaces. Type a name or a reference and pick a result: the link is saved at once. The search leaves out this interface and the interfaces already in the section. To remove a link, hover the row and click the cross at its end. Removing a link deletes neither interface. Readers see the tables read-only.

**Links and files**: the web links of the interface (specifications, documentation pages, monitoring dashboards) and its files, one row each with its name, the domain of the link or the size of the file, and the date it was added. Click a link to open it in a new tab, or a file to download it. With `applications:member`:

- **Add link** opens a dialog for a URL and an optional name; the link is saved at once. To change a link, hover its row and click the pencil.
- **Attach file** opens the file chooser. You can also drop files on the section.
- To remove a link or a file, hover the row and click the cross. Removing a link shows a message and offers **Undo**, which creates the link again. Deleting a file asks for confirmation first.

**Tip**: Attach the specification and the mapping documents to the interface, so the people who run it find them in one place.

---

## Copying interfaces

There are two ways to copy interfaces in Kadratis.

### Duplicate Interface (from the Interfaces grid)

Use this when you want an independent copy of an interface, typically to create a similar integration between the same or different applications.

1. Select an interface in the grid
2. Click **Duplicate interface**
3. Choose whether to copy environment bindings:
   - **Without bindings**: A clean copy: just the interface definition, legs, owners, and metadata
   - **With bindings**: Also copies environment bindings, but clears environment-specific details (endpoints, authentication, job names) so you can configure them fresh

**What gets copied**:

| Data | Copied |
|------|--------|
| Interface definition (name, apps, route type) | Yes |
| Legs (extract / transform / load / direct) | Yes |
| Middleware applications | Yes |
| Owners (business and IT) | Yes |
| Impacted companies | Yes |
| Dependencies | Yes |
| Key identifiers | Yes |
| External URL links | Yes |
| Data residency | Yes |
| Specification | Yes, with its images |
| Bindings | Optional |
| Mapping groups and rules | No |
| Attachments | No |

**Naming**: The copy gets " - copy" appended to both the name and the interface code. An empty interface code stays empty. The copy gets its own reference.

### Version Migration (from Application versioning)

Use this when upgrading an application to a new version and you need to migrate interfaces to the new version. See [Applications > Version management](applications.md#version-management) for details.

**Key differences from Duplicate**:

| Aspect | Duplicate | Version Migration |
|--------|-----------|-------------------|
| Purpose | Create independent copy | Migrate to new app version |
| App references | Unchanged | Updated to new version |
| Middleware references | Unchanged | Updated if app is middleware |
| Dependencies | Copied | Not copied |
| Bindings | Optional (instances unchanged) | Optional (instances mapped to new app) |
| Lifecycle | Preserved | Reset to Proposed |
| Name suffix | " - copy" | " (new version)" |

---

## Tips

- **Document the "why" first**: Use the **Specification** on the Overview tab to capture intent before diving into legs and bindings.
- **Use the side panel from any tab**: Owners, criticality, PII flag and the rest persist immediately, so you can update them while reviewing rules or bindings.
- **One interface, many environments**: Don't create separate interfaces for each environment. Use one interface and configure each environment in the Environments tab.
- **Group your mapping rules**: For interfaces with more than a handful of fields, organise rules into mapping groups (Header, Item lines, Footer, etc.). It makes review and impact analysis far easier.
- **Keep middleware explicit**: If data flows through middleware, set the route type to **Via middleware** on the Flow tab and pick the middleware applications. The Interface Map will then render the real data path.
- **Duplicate for similar interfaces**: When creating a new interface that's similar to an existing one, use **Duplicate interface** to copy all settings, then modify what's different. Optionally include bindings to get a head start on environment configuration.
- **Link bindings to infra connections**: On the Environments tab, link each binding to its underlying infrastructure connection so you can trace the full path from business interface down to network connection.
