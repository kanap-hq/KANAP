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

export function getPreviewLabel(preview: AiMutationPreview): string {
  const ref = preview.target?.ref?.trim();
  const title = preview.target?.title?.trim();
  if (ref && title) return `${ref} · ${title}`;
  return ref || title || preview.tool_name;
}

export function selectLongPreviews(previews: AiMutationPreview[]): AiMutationPreview[] {
  return previews.filter(isLongPreview);
}
