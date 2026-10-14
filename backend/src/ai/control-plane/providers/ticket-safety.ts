import { hasHtmlTag } from '../../../common/text-scan';
// Safety rules for agent-authored ticket content, shared by every ticketing provider and by
// the capability layer. A provider must never be more permissive than these rules; keep them
// in this single module so the invariant cannot drift between implementations.
export const MAX_INTERNAL_NOTE_CHARS = 4000;
export const MAX_PUBLIC_REPLY_CHARS = 12000;
export const MAX_REASON_CHARS = 1000;

export function noteBodyIsUnsafe(value: string): boolean {
  return hasHtmlTag(value) || /javascript:/i.test(value);
}

export function normalizeReason(value: string): string | null {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim();
  return normalized.length > 0 && normalized.length <= MAX_REASON_CHARS && !noteBodyIsUnsafe(normalized)
    ? normalized
    : null;
}
