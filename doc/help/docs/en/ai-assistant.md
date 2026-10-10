# Plaid

Plaid is KANAP's built-in chat assistant. It is connected to the same data you already work with — applications, assets, incidents, projects, requests, tasks, contracts, knowledge documents, and master data — so you can ask questions in plain language instead of clicking through several screens to find an answer.

Plaid does not replace the rest of the application. It is a faster way to summarise context, locate records, draft text, or prepare changes. Sensitive operations are always shown as previews you must approve before anything is written back into KANAP.

!!! note "Plaid vs AI Agents"
    Plaid is the interactive assistant **you** drive: you ask, it answers, and you approve one change at a time. **AI Agents** are different — they are autonomous helpers that watch your service desk and propose or handle ticket work on their own, within the approval limits you set. See [AI Agents — Overview](agents-overview.md).

## Where to find it

- Workspace: **Plaid** (top navigation)
- Route: `/ai`
- Permission: `ai_chat:reader` lets you open the chat workspace and start conversations
- Feature flag: requires the chat surface to be enabled on your instance. If it is turned off, the workspace shows a notice instead of the chat UI.

The workspace is also available to administrators with `ai_chat:admin`, who can see and moderate everything regular users do.

!!! note "Waiting for an administrator"
    On the hosted service, Plaid can run on the KANAP included model. Before it does, an administrator confirms the provider and where it processes data. Until then the workspace shows *An administrator must confirm the AI provider in Admin > Plaid.* instead of the chat. An administrator does this on the [Plaid Settings](ai-settings.md#confirming-the-kanap-included-model) page. Organizations that use a model of their own never see this notice.

## Starting a conversation

When you open Plaid for the first time, you land on a welcome screen with:

- A short tagline ("Plaid is ready") and a description of what you can ask
- A **Try asking** section with sample prompts you can click to send
- The composer at the bottom, ready to accept your first message

Click any suggestion to either send it directly, or — for prompts that contain an `@` placeholder — drop the suggestion into the composer so you can finish it.

Type a message and press **Enter** to send. **Shift+Enter** inserts a new line. The send button is disabled while there is nothing to send and morphs into a red **Stop** button while Plaid is responding.

## The conversation list

The left sidebar lists your past conversations. Use the menu icon in the top-left of the chat area to collapse or expand it.

The list contains:

- A **New conversation** button at the top
- A search field that appears as soon as you have at least one conversation
- Conversations grouped by date: **Today**, **Yesterday**, **Last 7 days**, **Older**

Each row shows the conversation title (or **Untitled** when none has been set yet). Hover or focus a row to reveal:

- A pencil icon — **Rename** the conversation. Double-click the title to do the same thing.
- A trash icon — **Archive** the conversation. Archived conversations disappear from the list. If you archive the conversation you currently have open, Plaid switches to a fresh empty chat.

Search filters the list by title as you type. Renaming and archiving are saved immediately.

## Writing a message

The composer is the main control point of the workspace. It supports:

- Multi-line text up to 10 visible rows before it scrolls
- Inline image attachments (PNG, JPG, GIF, WEBP)
- `@`-mentions of KANAP records
- A keyboard hint reminder ("Enter to send · Shift+Enter for new line")

### Attaching images

You can add images in three ways:

- Click the paperclip icon and pick files from your computer
- Drag and drop image files onto the composer (a hint overlay confirms the drop target)
- Paste an image directly from the clipboard

Each pending image appears as a thumbnail above the text. Click the small **X** on a thumbnail to remove it. There is a per-message attachment limit; once it is reached, the paperclip is disabled until you remove or send the current attachments.

Images are uploaded together with your message so Plaid can describe them, compare them, or extract details.

### Mentioning records with `@`

Typing `@` opens the **mention picker** above the composer. It lets you reference any KANAP record you have access to, with two complementary modes:

- **Type-token prefix**: short codes that map to a single entity family. Examples:
  - `@T-5` — task with the reference T-5
  - `@DOC` — recent knowledge documents
  - `@APP backup` — applications matching "backup"
  - `@PRJ`, `@REQ`, `@INC`, `@AST`, `@CONN`, `@INT`, `@LOC`, `@CTR`, `@CPX`, `@COMP`, `@CONT`, `@DEPT`, `@SUP`, `@BP`
- **Plain text**: anything else (`@payroll`, `@server-2`) runs a cross-type search ranked by relevance. It also finds OPEX and CAPEX lines by the names of their analytics values.

Use the arrow keys to move through the suggestions, **Enter** or **Tab** to confirm, **Escape** to dismiss the picker. Results are grouped by entity type (Knowledge, Tasks, Projects, Applications, Assets, Contracts, and so on) so you can tell at a glance what kind of record you are about to insert.

When you confirm a suggestion, the composer keeps showing a readable label (`@DOC-152`, `@SAP S/4HANA`). When the message is sent, each mention is expanded into a real link Plaid can follow back to the source record.

### Editing or regenerating a message

Hover any of your previous messages to get message-level actions:

- **Copy** — copy the message text to the clipboard
- **Edit** — re-open the message in an inline editor; saving sends the new version and truncates everything that came after it (the conversation reruns from that point)
- **Regenerate** (on assistant replies) — ask Plaid to produce another answer to the same prompt

Editing is the right tool when you realise your earlier question was unclear. Regenerating is the right tool when the question was fine but the answer was not.

## How Plaid replies

Plaid streams its answer character by character. While streaming:

- The composer stays usable so you can prepare a follow-up
- The send button shows a red **Stop** icon — clicking it cancels the in-flight response
- A small "Using tools…" indicator appears when Plaid is searching KANAP, fetching a document, or running another tool call
- The number and type of tools used are summarised under the answer once it is complete

When the stream finishes, focus jumps back to the composer so you can keep the conversation moving without reaching for the mouse.

### Tool calls

Plaid uses a small set of internal tools to answer questions: `Search all`, `Search knowledge`, `Get document`, `Get entity context`, and a handful of others. Each tool call shows up as a compact line under the message ("used Search all · 8 results"). You usually do not need to read the tool details, but they are there if you want to see exactly which records the answer was based on.

`Search all` finds OPEX and CAPEX lines by the names of their analytics values, and tells Plaid which values each line holds.

## Artifacts and previews

Some answers come with extra material that does not fit naturally inside the chat thread. KANAP calls these **artifacts**.

Common cases:

- A long block of text or markdown that Plaid prepared for you
- A side-by-side **Before / After** diff of a record Plaid wants to update
- A draft import or change set that requires your sign-off

Artifacts open in a side panel on the right of the workspace. The panel can be toggled by clicking the **Artifacts** tab button on the right edge of the screen.

The panel auto-opens when:

- A long preview arrives during a streaming response
- A pending preview needs your decision (these always pop the panel open, since you must act on them)

For pending change previews, the panel offers two buttons:

- **Approve** — confirms the change and lets Plaid apply it
- **Reject** — cancels the change. Plaid acknowledges the rejection and continues the conversation.

Nothing that mutates KANAP data is applied silently. The preview is the gate.

## Usage indicators

Above the composer, two small indicators help you stay aware of cost and limits:

- **Built-in usage**: when Plaid is running on the KANAP included model rather than one of your organization's own models, this shows how many messages remain in the current month and the date the quota resets. An administrator has confirmed that model beforehand (see [Plaid Settings](ai-settings.md#confirming-the-kanap-included-model)). When the limit is reached, the composer is disabled and a helper text invites administrators to switch to a model of their own; see [AI models](ai-models.md).
- **Token usage**: a thin bar with input/output token counters for the current conversation, plus the size of the last request. Long conversations get more expensive over time; the bar makes that cost visible so you can decide when to start a fresh thread.

The token usage bar only appears once the conversation has at least one exchange.

## Tips

- **Use prefixes for precision**: `@T-`, `@DOC-`, `@PRJ-`, `@REQ-`, `@INC-` map directly to native KANAP references. They are the fastest way to point Plaid at a specific record and they survive copy-paste because they look identical to what you see elsewhere in the application.
- **Start a new conversation per topic**: keeping unrelated questions in separate conversations makes the context window smaller, the answers faster, and the token bill lower. The conversation list is grouped by date so you can find them again easily.
- **Approve and reject deliberately**: previews are the only thing standing between Plaid and your live data. Take the extra second to read the diff before clicking **Approve**.
- **Stop instead of waiting**: if Plaid heads down the wrong path mid-stream, hit the **Stop** button rather than waiting for it to finish. You will save tokens, and your follow-up message can correct the course.
- **Drop images directly**: dragging a screenshot onto the composer is faster than the file picker, and pasting from the clipboard works too. Use it when describing a UI issue or asking Plaid to read a chart.
