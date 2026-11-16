/**
 * Load failures of a single document, split by what the user can do about it.
 *
 * `access` covers 404, 403 and 400. The document does not exist, was deleted,
 * the viewer lost access to it, or the address is not a document id or a DOC-N
 * reference (the API answers 400 for that). An incident review follows the
 * confidentiality of its incident, so access can disappear between two visits.
 * Retrying is pointless and the cached copy must not stay on screen.
 *
 * `failure` covers everything else (network, 5xx): the document may well still
 * be readable, so the screen offers a retry.
 */
export type KnowledgeLoadErrorKind = 'access' | 'failure';

export function classifyKnowledgeLoadError(error: unknown): KnowledgeLoadErrorKind | null {
  if (!error) return null;
  const status = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
  if (status === 400 || status === 403 || status === 404) return 'access';
  return 'failure';
}

const DOCUMENT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `DOC-n` or a bare item number: the shapes the document routes accept besides an id. */
const DOCUMENT_REF_RE = /^(?:DOC-)?\d+$/i;

/**
 * True when the route segment can name a document. Other text, such as
 * `/knowledge/documents`, is not an id or a DOC-N reference: the API answers
 * 400, so versions and activities are not requested.
 */
export function isKnowledgeDocumentAddress(value: string): boolean {
  const raw = value.trim();
  return DOCUMENT_UUID_RE.test(raw) || DOCUMENT_REF_RE.test(raw);
}
