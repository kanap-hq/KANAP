import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLinkMatcherWithRegExp } from '@lexical/react/LexicalAutoLinkPlugin';
import {
  AUTO_LINK_MATCHERS,
  EMAIL_DOMAIN_MAX,
  EMAIL_LOCAL_MAX,
  boundedEmailMatcher,
  boundedWebAddressMatcher,
} from './richTextAutoLink';
import { richTextLinkAddress } from './richTextLinkAddress';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The expressions of the editor's own module (`@mdxeditor/editor` 4.3, `plugins/link/AutoLinkPlugin`), as they were. */
const ORIGINAL_MATCHERS = [
  createLinkMatcherWithRegExp(
    /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/,
    (text) => (text.startsWith('http') ? text : `https://${text}`),
  ),
  createLinkMatcherWithRegExp(
    /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/,
    (text) => `mailto:${text}`,
  ),
];

/** The first match of each matcher in turn, as the editor's link module reads its list. */
const firstMatch = (matchers: typeof AUTO_LINK_MATCHERS, text: string) => {
  for (const matcher of matchers) {
    const match = matcher(text);
    if (match) return match;
  }
  return null;
};

/** Texts of everyday use, the oddities of the old expressions included. */
const CORPUS = [
  'voir https://exemple.fr/chemin pour le détail',
  'http://exemple.fr',
  'https://www.exemple.fr/a/b?c=1&d=2#e',
  'www.exemple.fr',
  'WWW.exemple.fr et HTTPS://exemple.fr',
  'xwww.exemple.fr',
  'www.exemple',
  'http://localhost:3000/chemin',
  'https://exemple.fr/chemin.',
  'https://exemple.fr/chemin, puis la suite',
  'voir (https://exemple.fr/chemin) ici',
  'https://en.wikipedia.org/wiki/Fish_(disambiguation)',
  'https://exemple.fr/é',
  'https://exemple.fr:8080/p',
  'ftp://exemple.fr/a et file:///etc/passwd',
  'javascript:alert(1)',
  'mailto:jean@exemple.fr',
  'jean@exemple.fr',
  'jean.martin@exemple.fr',
  'jean.martin+tag@sous.domaine.exemple.fr.',
  'écrire à jean.martin@exemple.fr, merci',
  '(a@b.fr) et x@y',
  'a@b',
  'a@b.c',
  '@exemple.fr',
  'jean@',
  'jean@@exemple.fr',
  'a..b@exemple.fr',
  '.a@exemple.fr',
  'a.@exemple.fr',
  'jean@[192.168.0.1]',
  'jean@[192.168.0]',
  'jean@exemple.fr-',
  'jean@exemple-fr.com',
  'jean@-exemple.com',
  'a@www.b.fr',
  'contact: jean@exemple.fr ou https://exemple.fr/x ou www.exemple.fr',
  'jean@exemple.fr https://exemple.fr/x',
  'mot sans adresse',
  '',
  '@',
  '://',
  'www.',
  'https://',
  '@@@@ www. :// @',
];

describe('auto links: what the bounded detectors find', () => {
  it.each(CORPUS)('finds in %j what the editor module found', (text) => {
    expect(firstMatch(AUTO_LINK_MATCHERS, text)).toEqual(firstMatch(ORIGINAL_MATCHERS, text));
    // The same, from each position on: the editor hands a detector the rest of the text after a match.
    for (let from = 1; from < text.length; from += 3) {
      const rest = text.slice(from);
      expect(firstMatch(AUTO_LINK_MATCHERS, rest)).toEqual(firstMatch(ORIGINAL_MATCHERS, rest));
    }
  });

  it('gives the link target of each kind of address', () => {
    expect(boundedWebAddressMatcher('voir https://exemple.fr/chemin')).toMatchObject({
      index: 5,
      text: 'https://exemple.fr/chemin',
      url: 'https://exemple.fr/chemin',
    });
    expect(boundedWebAddressMatcher('voir www.exemple.fr')).toMatchObject({
      index: 5,
      text: 'www.exemple.fr',
      url: 'https://www.exemple.fr',
    });
    expect(boundedEmailMatcher('écrire à jean.martin@exemple.fr')).toMatchObject({
      index: 9,
      text: 'jean.martin@exemple.fr',
      url: 'mailto:jean.martin@exemple.fr',
    });
  });

  it('opens only the schemes a rich text opens', () => {
    for (const text of CORPUS) {
      const match = firstMatch(AUTO_LINK_MATCHERS, text);
      if (match) expect(richTextLinkAddress(match.url)).toBe(match.url);
    }
  });

  it('caps the local part and the domain of an e-mail address', () => {
    const local = (length: number) => `${'a'.repeat(length)}@exemple.fr`;
    expect(boundedEmailMatcher(local(EMAIL_LOCAL_MAX))?.text).toBe(local(EMAIL_LOCAL_MAX));
    expect(boundedEmailMatcher(local(EMAIL_LOCAL_MAX + 1))).toBeNull();

    // Labels of 60 characters: four of them and the ending make a domain of 246, five make more than 255.
    const domain = (labelCount: number) => [...Array<string>(labelCount).fill('c'.repeat(60)), 'fr'].join('.');
    expect(boundedEmailMatcher(`jean@${domain(4)}`)?.text).toBe(`jean@${domain(4)}`);
    const tooLong = boundedEmailMatcher(`jean@${domain(5)}`);
    expect(tooLong?.text.length).toBeLessThanOrEqual('jean@'.length + EMAIL_DOMAIN_MAX);
  });

  it('takes an address in quotes for what it is, not for a quoted local part that spans words', () => {
    expect(boundedEmailMatcher('il dit "bonjour" puis "jean"@exemple.fr')).toBeNull();
  });
});

describe('auto links: bounded work', () => {
  const WORDS_WITHOUT_ADDRESS = [
    'a*'.repeat(5000) + 'a',
    'a'.repeat(10_000),
    'a.'.repeat(5000),
    '-'.repeat(10_000),
    'word '.repeat(2000),
    '.@.'.replace('@', '').repeat(3000),
  ];

  it('runs no regular expression on a text without `@`, `://` or `www.`', () => {
    // Every regular expression operation of the engine goes through `exec` once it is replaced.
    const exec = vi.spyOn(RegExp.prototype, 'exec');
    /a/.test('a');
    expect(exec).toHaveBeenCalledTimes(1);
    exec.mockClear();

    for (const word of WORDS_WITHOUT_ADDRESS) {
      for (const matcher of AUTO_LINK_MATCHERS) expect(matcher(word)).toBeNull();
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it('answers in bounded time on texts built to make a search long', () => {
    const hard = [
      '@'.repeat(10_000),
      'a@'.repeat(5000),
      'a.'.repeat(5000) + '@',
      'a'.repeat(10_000) + '@b',
      '@' + 'a.'.repeat(5000),
      '@a' + '.a'.repeat(5000) + '.',
      'www.'.repeat(2500),
      'www.a'.repeat(2000),
      'http://'.repeat(1400),
      'https://a.' + 'b'.repeat(10_000),
      'https://' + 'a.'.repeat(5000),
      ('www.a ' + 'a@b ').repeat(1000),
    ];
    const started = performance.now();
    for (const text of hard) {
      for (const matcher of AUTO_LINK_MATCHERS) matcher(text);
    }
    // A few milliseconds in all; the limit leaves room for a machine under load.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
