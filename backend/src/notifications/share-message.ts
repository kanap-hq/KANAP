/**
 * The personal message of a "Send link" e-mail, with its web addresses made inert: a mail client
 * turns a written address into a link, and the message is free text sent under the platform's
 * name. Each address stays readable with its separators in brackets (`https[:]//example[.]com`),
 * which no mail client recognises as an address. Ordinary text is left as it is: a dot between
 * digits (`v2.0`, `3.5`) or before a single letter (`e.g.`) is no domain name.
 */

/** A dot, and the full stops that browsers read as one in a domain name. */
const DOT = '[.\\u3002\\uFF0E\\uFF61]';
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_-]*[\\p{L}\\p{N}])?';
const DOTTED_NAME = new RegExp(`${LABEL}(?:${DOT}${LABEL})+`, 'gu');
const ANY_DOT = new RegExp(DOT, 'gu');
/** A top-level domain: letters only, or its ASCII form (`xn--...`). */
const TOP_LEVEL = /^(?:\p{L}{2,}|xn--[a-z0-9-]+)$/iu;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const SCHEME = /\b([a-z][a-z0-9+.-]*):\/\//gi;

export function inertLinks(message: string): string {
  return message
    .replace(SCHEME, '$1[:]//')
    .replace(DOTTED_NAME, (name) => {
      const labels = name.split(ANY_DOT);
      const looksLikeAddress = TOP_LEVEL.test(labels[labels.length - 1]) || IPV4.test(name);
      return looksLikeAddress ? name.replace(ANY_DOT, '[.]') : name;
    });
}
