import type { TFunction } from 'i18next';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/**
 * The message of a failed CSV request, for the dialog to show. A download asks
 * for a blob, so the server's JSON error arrives as a blob too: read it first.
 */
export async function csvRequestErrorMessage(error: unknown, t: TFunction, fallback: string): Promise<string> {
  const response = (error as { response?: { status?: number; data?: unknown } } | null | undefined)?.response;
  if (typeof Blob !== 'undefined' && response?.data instanceof Blob) {
    let data: unknown = null;
    try {
      data = JSON.parse(await response.data.text());
    } catch {
      // Not a JSON body: the fallback says it.
    }
    return getApiErrorMessage({ response: { status: response.status, data } }, t, fallback);
  }
  return getApiErrorMessage(error, t, fallback);
}
