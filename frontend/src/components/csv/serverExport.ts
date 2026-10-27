import api from '../../api';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import type { ExportFormat } from './exportFormat';
import { screenLanguage } from './readings';

/**
 * Downloads a file the server builds (`…/export?format=csv|xlsx&language=…&tz=…`), for a page whose
 * `ExportFormatButton` sends its own parameters: a GET with `params` in the query, or a POST with `body`
 * when the parameters are too long or too structured for an address (the roadmap's generate payload).
 * Empty parameters are not sent. The words of the file follow the screen language, its date the browser's
 * zone. The file name is the server's. A failure rejects: the page says so.
 */
export async function downloadServerExport({
  url,
  format,
  language,
  params = {},
  body,
  fileBase,
}: {
  /** The export route, `/portfolio/team-members/skills-matrix/export`. */
  url: string;
  format: ExportFormat;
  /** The screen language (`i18n.resolvedLanguage`). */
  language: string | undefined;
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Sent as the JSON body of a POST. */
  body?: unknown;
  /** The name of the file when the server gives none. */
  fileBase: string;
}): Promise<void> {
  const query: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query[key] = value;
  }
  query.format = format;
  query.language = screenLanguage(language);
  const zone = browserTimeZone();
  if (zone && query.tz === undefined) query.tz = zone;
  const res = body === undefined
    ? await api.get<Blob>(url, { params: query, responseType: 'blob' })
    : await api.post<Blob>(url, body, { params: query, responseType: 'blob' });
  const headers = (res.headers ?? {}) as Record<string, unknown>;
  const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
  const name = extractFilenameFromDisposition(disposition) || `${fileBase}.${format}`;
  downloadBlob(res.data instanceof Blob ? res.data : new Blob([res.data as BlobPart]), name);
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
