import { AiMutationPreview } from '../aiTypes';

/**
 * Threshold above which a markdown diff is considered "long" — these previews are
 * routed to the artifact panel instead of being rendered inline in the chat. The
 * limit is intentionally generous (≈10–15 lines of dense markdown) so that small
 * field tweaks stay inline and only substantial documents move to the side panel.
 */
const LONG_PREVIEW_CHAR_THRESHOLD = 800;

export function isLongPreview(preview: AiMutationPreview): boolean {
  return Object.values(preview.changes).some((diff) => {
    if (diff.format !== 'markdown') return false;
    const fromLen = (diff.from || '').length;
    const toLen = (diff.to || '').length;
    return Math.max(fromLen, toLen) > LONG_PREVIEW_CHAR_THRESHOLD;
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The title of a preview's target without its reference: the server names a record by its label,
 * which often starts with the reference ("APP-36 - CheeseTrack"), while the card and the tabs show
 * the reference beside the title. A title that is only the reference gives null.
 */
export function getPreviewTitle(preview: AiMutationPreview): string | null {
  const ref = preview.target?.ref?.trim();
  const title = preview.target?.title?.trim() || null;
  if (!ref || !title) return title;
  if (title === ref) return null;
  // A server label that already repeats the reference ("CON-1 - CON-1 - DB link") loses every
  // leading occurrence: the header shows the reference once, beside the rest of the name.
  const pattern = new RegExp(`^${escapeRegExp(ref)}(?:\\s*[-–—·:|]\\s*|\\s+)`);
  let stripped = title;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = stripped.replace(pattern, '').trim();
    if (next === stripped) break;
    stripped = next;
  }
  return stripped && stripped !== title ? stripped : title;
}

export function getPreviewLabel(preview: AiMutationPreview): string {
  const ref = preview.target?.ref?.trim();
  const title = getPreviewTitle(preview);
  if (ref && title) return `${ref} · ${title}`;
  return ref || title || preview.tool_name;
}

export function selectLongPreviews(previews: AiMutationPreview[]): AiMutationPreview[] {
  return previews.filter(isLongPreview);
}
