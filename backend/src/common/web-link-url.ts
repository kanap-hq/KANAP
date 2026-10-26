import { BadRequestException } from '@nestjs/common';

/** A scheme at the start (`javascript:`, `https:`), told apart from a host and its port (`intranet:8080`). */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_AND_PORT = /^[^/?#:\\]+:\d+(?:[/?#]|$)/;
/** The scheme, the two slashes and a host: `http://` or `https://` (any case), nothing else. */
const WEB_ADDRESS = /^https?:\/\/([^/?#]+)/i;

/**
 * A web link the user can open: http or https, with a host.
 * A blank value stays blank. The caller keeps its own "url is required" when the field is mandatory.
 * An address typed without a scheme gets `https://` (`www.vmware.com`, `intranet:8080/wiki`).
 * Any other scheme, or a malformed address (`https:host`, `http:\\host`), is `link_url_invalid`.
 * Returns the address as stored.
 */
export function assertWebLinkUrl(value: unknown): string {
  const typed = String(value ?? '').trim();
  if (!typed) return '';
  const hasScheme = SCHEME.test(typed) && !HOST_AND_PORT.test(typed);
  if (!hasScheme && /^[/\\]/.test(typed)) throw invalidWebLink(typed);
  const url = hasScheme ? typed : `https://${typed}`;
  const authority = WEB_ADDRESS.exec(url)?.[1];
  if (!authority || authority.includes('\\') || /\s/.test(url)) throw invalidWebLink(typed);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidWebLink(typed);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw invalidWebLink(typed);
  }
  return url;
}

/** Each link of a list checked by `assertWebLinkUrl`; a blank address drops the link. */
export function webLinkUrlsOf<T extends { url?: unknown }>(links: T[] | null | undefined): Array<T & { url: string }> {
  return (links || [])
    .map((link) => ({ ...link, url: assertWebLinkUrl(link?.url) }))
    .filter((link) => link.url);
}

function invalidWebLink(value: string): BadRequestException {
  return new BadRequestException({
    code: 'link_url_invalid',
    message: 'A web link must be an http or https address.',
    params: { value },
  });
}
