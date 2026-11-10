# Branding

Use the Branding page to apply your company identity across Kadratis. You set the workspace name, the logo and the primary colors here, and the change is visible to every user on your tenant the next time they reload the page.

## Where to find it

- Workspace: **Admin** menu → **Branding**
- Route: `/admin/branding`
- Permission: `users:admin`
- Available only on tenant hosts (not on the platform-admin host)

Changes apply to your current tenant only.

## What you can customize

The page has three cards: **Workspace name**, **Logo** and **Primary colors**. The logo and the colors are optional. Without a logo, the header shows the workspace name. Without custom colors, Kadratis uses its default theme colors.

- **Workspace name**
  - Identifies your workspace in the header, the browser tab, e-mails and AI tools (see [Where the workspace name appears](#where-the-workspace-name-appears))
  - From 1 to 120 characters
  - The workspace address stays as it is
- **Logo**
  - Appears in the top app bar (when logged in)
  - Appears on the login page header
  - An optional second logo for dark mode
- **Primary colors**
  - One primary color for **light mode**
  - One primary color for **dark mode**
  - Used by the app bar, primary buttons, and links

## Workspace name

1. Type the name.
2. Click **Save Changes**.

**Reset to Default** leaves the name as it is. It removes the logos and the custom colors only.

## Where the workspace name appears

- **App header and sign-in page**: the name shows when there is no logo.
- **Browser tab**: the tab title is the name. A project, request, task or budget line page shows the record first, for example `PRJ-3 New ERP | Acme`.
- **Installed app**: when someone installs Kadratis on a phone or a desktop, the app takes the name.
- **E-mails**: the header shows the name when there is no logo. The subjects of the password reset, invitation, weekly review and workspace reset e-mails carry the name, for example "Reset your password on Acme". The weekly review button reads "Open Acme". In the cloud, the sender name reads "Acme via Kadratis". On-premise, the sender is the one set in the installation (`SMTP_FROM`).
- **AI tools**: when an AI tool (Claude, ChatGPT and others) connects through the MCP server, the authorization page shows the name, and the tool shows it as the server name.

With no name set, or with the on-premise default name "My Organization", these places show "Kadratis".

## Logo setup

### Supported files

- Formats: `PNG`, `JPG/JPEG`, `GIF`, `WEBP`
- Max size: `20 MB`

### Recommended logo format

- Use a wide, horizontal logo (transparent background preferred).
- Keep important content centered: the header area is compact.
- For sharp rendering, use at least about 2× the displayed size (for example `280x72` or higher).

### How to set it

The card shows a light header preview and a dark header preview, each with its own **Upload Logo** and **Remove Logo** buttons.

1. Under the light preview, click **Upload Logo** and choose your file.
2. If your logo does not read well on a dark background (dark text, for example), upload a second version under the dark preview.
3. Without a dark mode logo, **Use the light mode logo** decides what dark mode shows: the light mode logo when it is on, the workspace name as text when it is off.
4. Check both previews, then click **Save Changes** to publish.

To remove a logo, click **Remove Logo** under its preview. The other logo stays.

Dark mode shows the dark mode logo when there is one. Light mode always shows the light mode logo, or the workspace name as text when there is none. E-mails always use the light mode logo, since their background is light.

## Primary color setup

You can set colors for **Light mode primary** and **Dark mode primary** independently. Each color picker offers four ways to enter a value:

- Hex input (`#RRGGBB`)
- A color picker dialog (palette icon)
- Preset palette chips (one curated row per mode)
- A **Clear** action to remove the custom value

### Light/dark behavior

- **Light mode primary** is used in light mode.
- **Dark mode primary** is used in dark mode.
- If only one mode has a color, Kadratis reuses that color in the other mode as a fallback.
- If both fields are empty, Kadratis uses its default theme colors.

### Contrast warning

After you pick colors, the page evaluates how readable text is against the chosen background. If contrast falls below the readable threshold for either mode, an advisory warning appears with the contrast ratio.

The warning is informational (you can still save), but low contrast usually means white text on a pale color or dark text on a saturated color, both of which become tiring to read in real interfaces.

## Saving and resetting

Three actions at the bottom of the page control persistence:

- **Save Changes**: commits the workspace name, the selected logos and the color values. Disabled while there are no pending changes, while the name is empty or longer than 120 characters, or while a hex input is invalid.
- **Discard**: rolls back any unsaved edits on the page (does not affect what is already saved).
- **Reset to Default**: removes both saved logos and clears all custom colors. The workspace name stays. Asks for confirmation before running.

A small caption below the actions shows the **logo version** counter, which increments each time a logo is uploaded or removed. This is mainly a hint that browser caches will refresh.

## Tips

- **Test in both themes**: switch between light and dark theme before saving. The same brand color rarely works in both modes.
- **Prefer a transparent background**: simple logos with transparent backgrounds give the cleanest header rendering, especially in dark mode.
- **Use Reset deliberately**: it removes both logos and all custom colors in one step. Use it when starting over, not as an "undo" for a single change. That is what **Discard** is for.
- **Brand colors are for accents**: Kadratis uses the primary color on app bars, primary buttons, and links. Pick something that reads cleanly at button size, not just on a marketing site.
