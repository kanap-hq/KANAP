# Knowledge

Knowledge is KANAP's document workspace for policies, procedures, technical notes, reference material, and the documentation that needs to stay connected to real work. It combines free-form writing with governance features such as templates, ownership, review, version history, and relations to applications, assets, projects, requests, and tasks.

Unlike a file share, Knowledge is not just a place to store documents. The important design choice is that every article can be classified, reviewed, versioned, exported, and linked to operational objects across the platform. That makes the article easier to find and gives it context when people open it from another workspace.

## Where to find it

- Workspace: **Knowledge**
- Permissions:
  - `knowledge:reader` lets you open and read documents
  - `knowledge:member` lets you create, edit, comment, organize folders, and manage document metadata
  - `knowledge:admin` adds library administration and cross-library moves

If you can read a document but cannot edit it, the workspace stays available in read-only mode.

## How Knowledge is organized

Knowledge is built around four layers of organization: libraries, folders, document types, and relations.

### Libraries

Libraries are the highest-level containers. They separate document populations that should be managed differently.

Typical patterns:
- Use a regular library for your team's working knowledge base.
- Use the **Templates** library for reusable document starters.
- Use the **Managed Docs** library for documents that originate from another workspace and remain partly controlled there.

Consequences of the library choice:
- The active library determines which folder tree you see and where new blank documents are created.
- In a normal library, documents behave like standard knowledge articles.
- In **Templates**, published documents become reusable starting points for new articles and are grouped by document type in the template picker.
- In **Managed Docs**, articles may still be readable and editable, but some metadata is controlled by the source workspace rather than from Knowledge itself.

Library administration is intentionally stricter than document editing. Creating, renaming, deleting, or reorganizing libraries is an admin responsibility because those changes affect navigation and ownership for everyone.

### Restricted libraries

By default, every library is open to anyone with the `knowledge` permission. A library administrator can switch a library to **Restricted** access from the library settings dialog. Restricted libraries are marked with a small lock icon on the library tab.

In a restricted library:

- Only the library owner, the people listed as **Readers**, and the people listed as **Writers** can see the library and its documents.
- Readers can open and read articles inside the library but cannot edit them.
- Writers can read and edit articles. Writers also need the standard `knowledge:member` permission to actually create or modify documents.
- The owner can always read and manage the library.
- Switching from **Restricted** back to **Default** clears the reader and writer lists. The dialog asks for confirmation before discarding the membership.

Use restricted libraries for sensitive content (security procedures, HR documents, executive material) where you want fine-grained access control inside Knowledge instead of relying only on global roles.

Restricted libraries also bound what an AI agent can read. When an administrator scopes an agent to a chosen set of libraries in its **Knowledge and web sources** settings, that choice is combined with the libraries the configuring administrator can already read — an agent never sees more than the person who set it up. A restricted library the administrator cannot access stays invisible to the agent as well.

### Folders

Folders organize documents inside a library. They are not cosmetic: they shape how users browse the library and how teams maintain a shared structure over time.

Important behavior:
- Folders exist inside one library. They are not shared across libraries.
- In a single-library view, documents can be dragged into folders for quick reorganization.
- Folders can be nested to create a browsing structure.
- Deleting a folder does not delete its documents. Documents move back to **Unfiled** instead.
- A folder with subfolders cannot be deleted until the hierarchy is cleaned up.

Use folders for stable subject areas, not for temporary workflow states. Status and workflow already exist for that.

### Scope filters

The top-level scope filter changes which documents are listed:

- **My docs** focuses on documents you own.
- **My team's docs** focuses on documents owned by your team.
- **All docs** removes the ownership scope and shows the full population you are allowed to see.

If you are not assigned to a team, the team scope is unavailable. The page opens on **All docs**, and your last scope choice is remembered, which is convenient when it matches your normal working mode and slightly confusing when you forget you changed it yesterday.

### Templates and document types

Templates are ordinary Knowledge documents stored in the **Templates** library and published for reuse. Creating a document from a template copies the template content into a new article and preserves the template reference.

Document types matter because they:
- classify the article for filtering and reporting
- group templates in the creation picker
- help readers understand what kind of document they are opening

One subtle but important behavior: if a document was created from a template and you later change its document type to a different type, the template link is cleared. That prevents the article from pretending it still follows a template it no longer matches.

When browsing the **Templates** library, administrators can open the **Manage Types** panel to create, rename, deactivate, or reorder document types.

### Managed documents

Some Knowledge articles are created from Requests, Projects, Applications, Assets, Tasks, or Incidents. These appear as **Integrated** documents, grouped in the **Managed Docs** library by the workspace they come from.

Managed documents keep the writing experience inside Knowledge, but the source workspace continues to control part of their metadata. In practice, that means:
- status may be controlled by the source object
- folder placement may be fixed by the source workspace
- document type or template may be fixed
- direct relations may be read-only in Knowledge
- the Knowledge review workflow is not available for these documents
- managed documents cannot be moved out of Knowledge or deleted from the Knowledge list

This protects the link between the document and the operational record that owns it.

Access follows the source object as well. The clearest case is the **Incidents** folder: an incident review can only be opened by someone who is allowed to see that incident, whatever their Knowledge permissions are, it becomes read-only once the incident is closed or cancelled, and it disappears from lists, search, exports and the assistant for anyone excluded from a restricted incident. See [Incidents](incidents.md).

## Working with the Knowledge list

The main Knowledge page is a document register with navigation and organization tools around it.

### What the list shows

The default grid focuses on document identity and governance:

- **Ref**: the permanent `DOC-{number}` reference
- **Title**
- **Status**
- **Type**
- **Version**
- **Owner**
- **Folder**
- **Updated**

**Additional columns** (hidden by default, available via the column chooser):
- **Template**: shows the template the document was created from, if any
- **Library**: appears automatically when **All libraries** is enabled, and can be shown manually otherwise

### Search, filters, and browsing

Knowledge supports two navigation styles:

- Browse one library with its folder tree when you already know the subject area.
- Search across all libraries when you care more about the article than its storage location.

The **All libraries** switch changes the experience significantly:
- the folder tree is no longer the main driver
- search becomes broader
- the list can compare content across libraries
- the Library column becomes part of the result context

Single-library browsing is better for curation. All-library search is better for retrieval.

**Filtering**:
- Quick search bar at the top of the grid
- Column filters on **Status**, **Type**, **Owner**, **Folder**, **Template**, and **Library** using checkbox-set selectors

### Moving documents and folders

In a single-library view, documents can be dragged into folders. A drag handle appears on each row when dragging is available. This is the fastest way to tidy a library without opening every article.

Cross-library moves are more controlled:
- they require higher permission (`knowledge:admin`)
- they are not available for managed documents
- template documents are intentionally restricted because templates are meant to stay in the template system, not wander off into the wild
- they will not work into or out of a restricted library if the writer lacks access

Folders can also be dragged between libraries by dropping them on the target library tab. A confirmation dialog opens to let you choose a destination folder before the move runs.

Folder moves follow the same idea as document moves. Reorganizing a folder changes the browsing structure for everyone using that library, so treat it as an information architecture change, not just personal housekeeping.

### List actions

- **New** (split button): creates a blank document in the active library, or opens the template picker to create from a published template
- **Move**: moves selected documents to a different folder or library
- **Delete**: permanently removes selected documents (admin only; unavailable for managed documents)
- **Manage Types**: visible only inside the **Templates** library to administrators; opens the document type editor

## Creating and shaping a document

New articles can start in two ways:

- **Blank document**: best when you already know the structure you need
- **From template**: best when the team wants consistent sections, language, or review expectations

When you create from a template, the template content is copied into the new document. From that point on, the new article is independent. Updating the template later does not rewrite existing documents.

The document workspace keeps writing in the center and governance in the sidebar.

Core properties include:
- **Title**: the primary label readers will search for and cite
- **Status**: the lifecycle of the article
- **Folder**: where the article lives within its library
- **Type**: what kind of document it is
- **Based on template**: the template lineage, when relevant
- **Summary**: a short description for context

After the first save, the full document governance model becomes available. That is when you can manage contributors, classifications, relations, comments, and version history against a stable document reference.

### Status and what it means

Status is not decoration. It tells readers how seriously they should treat the article.

| Status | Meaning | Practical consequence |
|--------|---------|-----------------------|
| **Draft** | Work in progress | Suitable for authorship and internal iteration |
| **In Review** | Under formal review | Editing is blocked while the workflow is active |
| **Published** | Approved for normal use | Best choice for content people should rely on |
| **Archived** | Kept for record | Usually still useful for history, not for active guidance |
| **Obsolete** | Superseded or no longer valid | Readers should not follow it as current practice |

Knowledge allows direct publishing even without a formal review workflow. That is useful for low-risk material, but it also means teams need discipline about when review is optional and when it should be expected.

## Writing, locks, and autosave

Knowledge uses an edit lock so only one person actively edits a document at a time.

How it works:
- entering edit mode acquires the lock
- other users can still open and read the article
- they cannot edit while the lock is held by someone else
- if the lock expires or is lost, edit mode stops and must be re-entered

This avoids silent overwrites, which is excellent for document integrity and less excellent if two people both thought they had "just one quick tweak."

While you are editing:
- changes are saved manually with **Save**
- unsaved content is also autosaved periodically while your lock is active
- **Discard** returns to the last saved state

The workspace also supports inline image upload inside the markdown content area, so screenshots and diagrams can live with the article rather than in a mysterious folder on somebody's desktop. When you paste or reference an image from an external URL, the image is automatically imported and stored within the document so it remains available even if the original URL goes offline.

## Importing a Word document

You can import a Word document (`.docx`) into an existing Knowledge article. The **Import** button appears in the workspace toolbar once the document has been saved at least once and you are in edit mode.

How it works:

- Click **Import** and select a `.docx` file from your computer.
- If the article already has content, a confirmation dialog asks whether you want to replace it. Choosing **Continue** overwrites the current markdown with the imported content.
- The Word content is converted to markdown and loaded into the editor. Images embedded in the Word file are extracted and stored as inline attachments, so you do not have to re-upload them manually.
- After import, your changes are unsaved. Use **Save** to persist the imported content.

If the import encounters a lock conflict (someone else acquired the lock) or an expired lock, editing mode ends and an appropriate message is shown. Re-enter edit mode and try again.

Import warnings — for example, unsupported formatting that was simplified during conversion — appear briefly as a notification at the bottom of the screen.

Use the import feature when migrating existing Word documents into Knowledge. It is faster and safer than copy-paste, and it preserves embedded images automatically.

## Export formats

Knowledge articles can be exported as:

- **PDF**
- **DOCX**
- **ODT**

Export is available when the article has content. This is useful when:
- a document needs to circulate outside KANAP
- a reviewer prefers Word-format markup
- a stable PDF snapshot is needed for sharing or recordkeeping

Export does not replace the live article. The Knowledge version remains the governed source, while exported files are distribution formats.

## Generating documents from chat

If the AI Assistant is enabled in your KANAP, you can ask it to draft a Knowledge article for you from chat. The assistant prepares a preview that you review before anything is saved. Confirming the preview creates a real Knowledge document with the content, type, template lineage, and any relations you specified — exactly as if you had written it yourself.

Generated documents follow the same governance rules as hand-written ones: ownership, status, version history, locks, and review workflow all apply.

## Contributors and review workflow

Every document can have a structured contributor model:

- **Owner**: the accountable person for the article
- **Authors**: people who help maintain the content
- **Reviewers**: stage 1 reviewers
- **Approvers**: stage 2 approvers

The owner matters operationally. Scope filtering is based on ownership, and a document without a clear owner is much more likely to become "important background material" that nobody updates.

### Review workflow

The review workflow is optional but deliberate:

- reviewers work first
- approvers act after the review stage is complete
- approvers and reviewers can record decision notes
- requesting changes sends the document back for revision
- the workflow keeps track of the last approved revision

Important consequences:
- you cannot request review while there are unsaved changes
- you need assigned reviewers or approvers before a review can be requested
- archived and obsolete documents are not candidates for a new review request
- managed (integrated) documents do not use the Knowledge review workflow
- once review starts, normal editing is disabled until the review is approved, changes are requested, or the review is cancelled

This makes review meaningful. If authors could keep editing the content during approval, the approved document would be a moving target, which is a splendid way to create arguments and a poor way to create documentation.

## The document workspace sidebar

The sidebar has two tabs: **Properties** and **Comments**.

### Properties tab

The Properties tab organizes governance data into collapsible sections:

- **Status, Folder, Type, Template, and Summary** are always visible at the top.
- **Contributors**: assign owner, authors, reviewers, and approvers. Each role is saved independently of the main document save.
- **Review Workflow**: shows the current workflow state when a review is active, including stage progress, participant decisions, and recent workflow activity. When no workflow is active, you can request a review from here.
- **Classification**: tag the document with categories and streams from your organization's classification scheme. Multiple classification rows can be added.
- **Relations**: link the document to applications, assets, projects, requests, or tasks. Each relation type has its own search-and-select field.
- **Versions**: lists saved revisions with timestamps. **Revert** is available only while you hold an active editing lock.

### Comments tab

The Comments tab shows activity around the document: comments, workflow events, and change history. Use comments for review context, editorial clarification, or change rationale that should stay attached to the article.

## Relations and cross-workspace context

Knowledge documents can be related directly to:

- Applications
- Assets
- Projects
- Requests
- Tasks

Relations are not just tags. They control where the document appears elsewhere in KANAP and how users discover it from operational workspaces.

Consequences of adding relations:
- the document becomes easier to find from the linked object
- readers opening the object get contextual documentation without having to search manually
- reporting and governance around the object become more complete

Consequences of poor relations:
- useful documents stay invisible outside Knowledge
- users create duplicates because they cannot find the existing article
- the same subject starts drifting across multiple documents

In related workspaces, Knowledge panels distinguish between:
- **Linked documents**: directly attached to the object
- **Related documents**: surfaced through context and provenance from connected work

That distinction matters. Direct links express an intentional relationship. Related documents express useful context, but not the same level of ownership.

## Good operating habits

- Use libraries for governance boundaries, folders for navigation, and relations for business context.
- Keep ownership current. A good article with the wrong owner is usually living on borrowed time.
- Use templates when consistency matters across teams.
- Use review for documents that drive decisions, controls, or repeatable processes.
- Mark outdated content as archived or obsolete instead of leaving readers to guess.
- Import Word documents when migrating existing content into Knowledge rather than copying and pasting, so that embedded images are preserved automatically.
- Reach for restricted libraries when access matters at the library level — do not rely on folder layout to hide sensitive content.
