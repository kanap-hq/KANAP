# Interfaces

Interfaces document the logical data flows between your applications. Each interface represents a business integration -- the "why" and "what" of data exchange -- independent of how it is technically implemented. The workspace lets you describe the interface, define the legs that move data through your landscape, configure environment-specific bindings, capture the field-level mapping rules, and link related interfaces, documents, and attachments.

## Getting started

Navigate to **IT Landscape > Interfaces** to see your integration registry. Click **Add interface** to create a new entry, or open an existing one to edit it.

To create an interface you need:

- **Interface ID**: A unique short code (e.g., `INT-CRM-ERP-001`)
- **Name**: A descriptive name for the integration
- **Business purpose**: A short summary of why this integration exists
- **Source application** and **Target application**
- **Data category**: The type of data being transferred

Once these are set you can save the interface; the rest of the workspace (Technical, Environments, Mapping, Relations) becomes available afterwards.

**Tip**: Set the **Integration route type** (Direct or Via middleware) early. It controls which legs are generated automatically and what shows up on the Technical tab and the Environments matrix.

---

## Working with the list

The Interfaces grid shows your integration registry at a glance.

**Default columns**:

- **Interface ID**: The unique identifier (click to open the workspace)
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
- Column filters on the text columns, including lifecycle and criticality. Business process, data category and contains PII have no column filter

**Actions**:

- **Add interface**: Create a new interface (requires `applications:manager`)
- **Duplicate interface**: Create a copy of a selected interface (requires `applications:manager`). Select exactly one row to enable this action. A dialog lets you choose whether to copy environment bindings -- see [Copying interfaces](#copying-interfaces) below.
- **Delete selected**: Remove selected interfaces (requires `applications:admin`). A checkbox option lets you also delete related bindings; if unchecked, interfaces with bindings will not be deleted.

---

## The Interfaces workspace

Click any row to open the workspace. The workspace has a side panel with the interface properties on the left, and five tabs on the right.

### Interface properties (side panel)

The side panel stays visible across every tab and groups the most-edited fields into three collapsible sections:

**Core properties**:

- **Interface ID**, **Name**, **Business purpose** (required)
- **Business process**: Link to a business process from master data
- **Lifecycle** and **Criticality**
- **Source application** and **Target application** (required)
- **Integration route type**: Direct or Via middleware
- **Middleware applications**: Only shown when route type is Via middleware. The list is restricted to applications flagged as ETL/middleware.

**Team**:

- **Business owners**: Business stakeholders accountable for the integration
- **IT owners**: Technical team members responsible for maintenance

**Data & Compliance**:

- **Data category**: The kind of data being transferred
- **Data classification**: Sensitivity level (Public, Internal, Confidential, Restricted)
- **Contains PII**: When checked, a **PII description** field appears so you can detail what PII is included
- **Data residency**: Countries where the data flows (ISO 2-letter codes)

Field changes in the side panel are saved automatically when you leave the field, so you can update properties from any tab without switching context.

---

### Specification

The Specification tab is a managed rich-text document where you describe the interface end to end -- business context, scope, contract, examples. It is the primary narrative document for the interface.

**Tip**: Use this tab as your single source of truth for prose. Mapping rules and technical legs live in the dedicated tabs below; keep this document focused on intent, scope, and the human-readable summary.

---

### Technical

The Technical tab defines the shared **legs** that make up the interface. Legs are templates: they describe what each step does in general (the same definition applies across every environment).

For each leg you can edit:

- **Leg type**: EXTRACT, TRANSFORM, LOAD, or DIRECT (set automatically based on the integration route)
- **From -> To**: Which role handles each step (Source app, Target app, or Middleware)
- **Trigger type**: What initiates this leg (e.g., scheduled, event-driven, manual)
- **Pattern**: The integration pattern (e.g., batch, real-time, pub/sub)
- **Format**: The data format (e.g., JSON, XML, CSV, flat file)
- **Job name**: An optional default job or process name

If no legs appear yet, save the interface first. Legs are generated from the **Source application**, **Target application**, and **Integration route type** in the side panel.

---

### Environments

The Environments tab manages the per-environment bindings that turn the leg templates into actual configurations. It presents a matrix of environments and legs, letting you configure each combination independently.

**How it works**:

- Each environment (Prod, Pre-prod, QA, Test, Dev, Sandbox, or custom) can have bindings for each leg
- Environments are discovered automatically from your application instances; you can also add custom environments
- Click an empty cell to create a binding, or click an existing one to edit it

**Binding fields**:

- **Source instance** and **Target instance**: Which application instances to use in this environment
- **Status**: Enabled, Disabled, or Testing
- **Source endpoint** and **Target endpoint**: Technical endpoints (URLs, paths, queue names, etc.)
- **Trigger details**: Environment-specific trigger configuration
- **Env job name**: Override the leg template's job name for this environment
- **Authentication mode**: How the binding authenticates
- **Monitoring URL**: Link to monitoring or observability for this binding
- **Integration tool application**: If applicable, the integration tool used
- **Env notes**: Environment-specific notes

**Connection linking**: Each binding can be linked to infrastructure connections from your connection registry. This lets you trace the full path from logical interface down to the physical network connection.

---

### Mapping

The Mapping tab is where you describe how source fields turn into target fields. It is organised around two concepts:

- **Mapping rules** describe a single mapping decision -- one or more source fields, one or more target fields, an operation (direct copy, transform, lookup, split, merge, filter, default value, or a custom operation), and optional condition / business / middleware notes.
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

**Tip**: Keep one rule per logical decision rather than one rule per field. A rule that takes three source fields and produces one concatenated target field is clearer than three near-identical rows -- and the operation field makes the intent explicit.

---

### Relations

The Relations tab gathers the links from this interface to other things.

- **Interface dependencies**: Upstream and downstream interfaces. Use these to document orderings such as "Order Sync must run before Invoice Sync".
- **External URLs**: Links to documentation in Confluence, SharePoint, etc. Add a description and a URL; the open-in-new-tab icon takes you straight to the link.
- **Attachments**: Drag and drop files into the upload area or use **Select files** to attach specification documents directly to the interface. Click an attachment chip to download it; click the trash icon to delete it (requires manager rights).

A Knowledge section is reserved for future cross-entity knowledge linking; it currently shows an informational placeholder.

---

## Copying interfaces

There are two ways to copy interfaces in KANAP.

### Duplicate Interface (from the Interfaces grid)

Use this when you want an independent copy of an interface -- typically to create a similar integration between the same or different applications.

1. Select an interface in the grid
2. Click **Duplicate interface**
3. Choose whether to copy environment bindings:
   - **Without bindings**: A clean copy -- just the interface definition, legs, owners, and metadata
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
| Bindings | Optional |
| Mapping groups and rules | No |
| Attachments | No |

**Naming**: The copy gets " - copy" appended to both the name and the Interface ID.

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

- **Document the "why" first**: Use the Specification tab and the side-panel **Business purpose** field to capture intent before diving into legs and bindings.
- **Use the side panel from any tab**: Owners, criticality, route type, PII flag and the rest persist immediately, so you can update them while reviewing rules or bindings.
- **One interface, many environments**: Don't create separate interfaces for each environment -- use one interface and configure each environment in the Environments tab.
- **Group your mapping rules**: For interfaces with more than a handful of fields, organise rules into mapping groups (Header, Item lines, Footer, etc.). It makes review and impact analysis far easier.
- **Keep middleware explicit**: If data flows through middleware, set route type to **Via middleware** and pick the middleware applications. The Interface Map will then render the real data path.
- **Duplicate for similar interfaces**: When creating a new interface that's similar to an existing one, use **Duplicate interface** to copy all settings, then modify what's different. Optionally include bindings to get a head start on environment configuration.
- **Link bindings to infra connections**: On the Environments tab, link each binding to its underlying infrastructure connection so you can trace the full path from business interface down to network connection.
