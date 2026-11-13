import type { LinkMatcher } from '@lexical/react/LexicalAutoLinkPlugin';

type LinkMatch = NonNullable<ReturnType<LinkMatcher>>;

/**
 * Detectors of the web addresses and e-mail addresses an editor turns into links by itself.
 *
 * The expressions of the editor's own module (`@mdxeditor/editor`, `plugins/link/AutoLinkPlugin`)
 * cost the square of the length of a word that holds no `@`, and Lexical runs them again for each
 * formatted piece of a word without a space: a long word cut into pieces (`a*a*a*...`, 10 KB)
 * froze the tab for 20 seconds. These detectors answer at once on a text that holds none of the
 * marks of an address, and look for an address around its mark, over lengths that are capped.
 * They find what the editor's module found, and a web address whose last label is longer
 * than six characters, up to the 63 a domain label may hold. The link targets stay the same.
 */

/** Longest local part of an e-mail address (RFC 5321). */
export const EMAIL_LOCAL_MAX = 64;
/** Longest domain of an e-mail address (RFC 5321 allows 255). */
export const EMAIL_DOMAIN_MAX = 255;
/** Longest web address a link holds (the usual limit of browsers). */
export const WEB_ADDRESS_MAX = 2083;

/** A character that cannot be part of the local part of an address. */
const LOCAL_STOP = /[<>()[\]\\,;:\s@"]/;
const DOMAIN = /^(?:\[[0-9]{1,3}(?:\.[0-9]{1,3}){3}\]|(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63})/;
/** Last label: at most 63 characters, the longest a domain label may be. The editor's own expression stopped at 6. */
const WEB_ADDRESS =
  /^(?:https?:\/\/(?:www\.)?|www\.)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,63}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/;

/** The e-mail address whose `@` is at `at`, or null. */
function emailAround(text: string, at: number): LinkMatch | null {
  // The local part, backwards from the `@`: at most EMAIL_LOCAL_MAX characters.
  let start = at;
  while (start > 0 && at - start <= EMAIL_LOCAL_MAX && !LOCAL_STOP.test(text[start - 1])) start -= 1;
  if (at - start > EMAIL_LOCAL_MAX) return null;

  // Atoms joined by single dots: the address starts after the last doubled dot and the dots before it.
  const doubled = text.slice(start, at).lastIndexOf('..');
  if (doubled !== -1) start += doubled + 2;
  while (start < at && text[start] === '.') start += 1;
  if (start === at || text[at - 1] === '.') return null;

  const domain = DOMAIN.exec(text.slice(at + 1, at + 1 + EMAIL_DOMAIN_MAX));
  if (domain === null) return null;

  const length = at - start + 1 + domain[0].length;
  const address = text.slice(start, start + length);
  return { index: start, length, text: address, url: `mailto:${address}` };
}

/** The first e-mail address of the text. Looks nowhere when the text holds no `@`. */
export const boundedEmailMatcher: LinkMatcher = (text) => {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    const match = emailAround(text, at);
    if (match !== null) return match;
  }
  return null;
};

const WEB_ADDRESS_STARTS = ['https://', 'http://', 'www.'] as const;

/** The first web address of the text. Looks nowhere when the text holds no `http://`, `https://` or `www.`. */
export const boundedWebAddressMatcher: LinkMatcher = (text) => {
  // The next position of each start, kept until it is passed: a text that repeats one start stays linear.
  const next: number[] = WEB_ADDRESS_STARTS.map((start) => text.indexOf(start));
  for (;;) {
    let position = -1;
    for (const found of next) {
      if (found !== -1 && (position === -1 || found < position)) position = found;
    }
    if (position === -1) return null;

    const match = WEB_ADDRESS.exec(text.slice(position, position + WEB_ADDRESS_MAX));
    if (match !== null) {
      const address = match[0];
      return {
        index: position,
        length: address.length,
        text: address,
        url: address.startsWith('http') ? address : `https://${address}`,
      };
    }
    for (let i = 0; i < next.length; i += 1) {
      if (next[i] !== -1 && next[i] <= position) next[i] = text.indexOf(WEB_ADDRESS_STARTS[i], position + 1);
    }
  }
};

/** In the order of the editor's own module: web addresses first. */
export const AUTO_LINK_MATCHERS: LinkMatcher[] = [boundedWebAddressMatcher, boundedEmailMatcher];
