# Branding

Use the Branding page to apply your company identity across KANAP. You set the organization name, the logo and the primary colors here, and the change is visible to every user on your tenant the next time they reload the page.

## Where to find it

- Workspace: **Admin** menu → **Branding**
- Route: `/admin/branding`
- Permission: `users:admin`
- Available only on tenant hosts (not on the platform-admin host)

Changes apply to your current tenant only.

## What you can customize

The page has three cards: **Organization name**, **Logo** and **Primary colors**. The logo and the colors are optional. With nothing set, KANAP shows its default text-and-icon header and the default theme colors.

- **Organization name**
  - The name shown with the logo, in the About window, on the consent page, and to the assistant
  - From 1 to 120 characters
  - The workspace address stays as it is
- **Logo**
  - Appears in the top app bar (when logged in)
  - Appears on the login page header
- **Primary colors**
  - One primary color for **light mode**
  - One primary color for **dark mode**
  - Used by the app bar, primary buttons, and links

## Organization name

1. Type the name.
2. Click **Save Changes**.

**Reset to Default** leaves the name as it is. It removes the logo and the custom colors only.

## Logo setup

### Supported files

- Formats: `PNG`, `JPG/JPEG`, `GIF`, `WEBP`
- Max size: `20 MB`

### Recommended logo format

- Use a wide, horizontal logo (transparent background preferred).
- Keep important content centered: the header area is compact.
- For sharp rendering, use at least about 2× the displayed size (for example `280x72` or higher).

### How to set it

1. Click **Upload Logo** and choose your file.
2. Use the built-in **Light** and **Dark** header previews to validate appearance.
3. Toggle **Show logo in dark mode** if you want to fall back to the default text branding in dark theme.
4. Click **Save Changes** to publish.

To remove the current logo, click **Remove Logo**.

When no logo is set, or when **Show logo in dark mode** is off, KANAP falls back to its default text branding in the relevant theme.

## Primary color setup

You can set colors for **Light mode primary** and **Dark mode primary** independently. Each color picker offers four ways to enter a value:

- Hex input (`#RRGGBB`)
- A color picker dialog (palette icon)
- Preset palette chips (one curated row per mode)
- A **Clear** action to remove the custom value

### Light/dark behavior

- **Light mode primary** is used in light mode.
- **Dark mode primary** is used in dark mode.
- If only one mode has a color, KANAP reuses that color in the other mode as a fallback.
- If both fields are empty, KANAP uses its default theme colors.

### Contrast warning

After you pick colors, the page evaluates how readable text is against the chosen background. If contrast falls below the readable threshold for either mode, an advisory warning appears with the contrast ratio.

The warning is informational (you can still save), but low contrast usually means white text on a pale color or dark text on a saturated color, both of which become tiring to read in real interfaces.

## Saving and resetting

Three actions at the bottom of the page control persistence:

- **Save Changes**: commits the organization name, the selected logo upload and the color values. Disabled while there are no pending changes, while the name is empty or longer than 120 characters, or while a hex input is invalid.
- **Discard**: rolls back any unsaved edits on the page (does not affect what is already saved).
- **Reset to Default**: removes the saved logo and clears all custom colors. The organization name stays. Asks for confirmation before running.

A small caption below the actions shows the **logo version** counter, which increments each time the logo is uploaded. This is mainly a hint that browser caches will refresh.

## Tips

- **Test in both themes**: switch between light and dark theme before saving. The same brand color rarely works in both modes.
- **Prefer a transparent background**: simple logos with transparent backgrounds give the cleanest header rendering, especially in dark mode.
- **Use Reset deliberately**: it removes both the logo and all custom colors in one step. Use it when starting over, not as an "undo" for a single change. That is what **Discard** is for.
- **Brand colors are for accents**: KANAP uses the primary color on app bars, primary buttons, and links. Pick something that reads cleanly at button size, not just on a marketing site.
