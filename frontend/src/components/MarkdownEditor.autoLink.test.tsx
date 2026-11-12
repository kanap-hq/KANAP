import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_LINK_MATCHERS } from '../lib/richTextAutoLink';
import { richTextLinkAddress } from '../lib/richTextLinkAddress';
import { mountEditor } from './markdownEditorTestSupport';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

const originalMatchers = [...AUTO_LINK_MATCHERS];

afterEach(() => {
  AUTO_LINK_MATCHERS.splice(0, AUTO_LINK_MATCHERS.length, ...originalMatchers);
});

/** What the links of the text show: target and words. */
const linksOf = (content: HTMLElement) =>
  Array.from(content.querySelectorAll('a')).map((link) => `${link.getAttribute('href')} | ${link.textContent}`);

describe('MarkdownEditor: addresses typed in the text become links', () => {
  // Each saved text is the one the editor wrote with the module of its library, before the detectors of
  // `richTextAutoLink` took over.
  const CASES: Array<{ name: string; text: string; links: string[]; saved: string }> = [
    {
      name: 'an e-mail address',
      text: 'écrire à jean.martin@exemple.fr, merci',
      links: ['mailto:jean.martin@exemple.fr | jean.martin@exemple.fr'],
      saved: 'écrire à [jean.martin@exemple.fr](mailto\\:jean.martin@exemple.fr), merci\n\nsuite',
    },
    {
      name: 'a web address with a query and a fragment, between formatted words',
      text: '**gras** http://exemple.fr/a?b=1&c=2#d *suite*',
      links: ['http://exemple.fr/a?b=1&c=2#d | http://exemple.fr/a?b=1&c=2#d'],
      saved: '**gras** [http://exemple.fr/a?b\\=1\\&c\\=2#d](http://exemple.fr/a?b=1\\&c=2#d) *suite*\n\nsuite',
    },
    {
      name: 'a web address that ends a sentence',
      text: 'voir https://exemple.fr/chemin. Fin',
      links: ['https://exemple.fr/chemin. | https://exemple.fr/chemin.'],
      saved: 'voir [https://exemple.fr/chemin.](https://exemple.fr/chemin.) Fin\n\nsuite',
    },
    {
      name: 'addresses between angle brackets',
      text: '<jean@exemple.fr> et <https://exemple.fr/z>',
      links: ['mailto:jean@exemple.fr | jean@exemple.fr', 'https://exemple.fr/z | https://exemple.fr/z'],
      saved: '[jean@exemple.fr](mailto\\:jean@exemple.fr) et [https://exemple.fr/z](https://exemple.fr/z)\n\nsuite',
    },
    {
      name: 'a web address and a www address',
      text: 'voir https://exemple.fr/chemin, www.exemple.fr fin',
      links: ['https://exemple.fr/chemin | https://exemple.fr/chemin', 'https://www.exemple.fr | www.exemple.fr'],
      saved:
        'voir [https://exemple.fr/chemin](https://exemple.fr/chemin), [www.exemple.fr](https://www.exemple.fr) fin\n\nsuite',
    },
    {
      name: 'an e-mail address after an opening parenthesis (left as text)',
      text: '(a@b.fr) et x@y',
      links: [],
      saved: '(a@b.fr) et x@y\n\nsuite',
    },
  ];

  for (const { name, text, links, saved } of CASES) {
    it(`links ${name} and saves the same text as before`, async () => {
      const editor = await mountEditor(text);
      await editor.appendParagraph('suite');

      expect(linksOf(editor.content())).toEqual(links);
      expect(editor.lastChange()).toBe(saved);
      editor.unmount();
    });
  }

  it('links an address typed after the text', async () => {
    const editor = await mountEditor('début');
    await editor.appendParagraph('https://exemple.fr/chemin');
    await editor.appendParagraph('jean@exemple.fr');

    expect(linksOf(editor.content())).toEqual([
      'https://exemple.fr/chemin | https://exemple.fr/chemin',
      'mailto:jean@exemple.fr | jean@exemple.fr',
    ]);
    editor.unmount();
  });

  it('opens only the addresses a rich text opens', async () => {
    const editor = await mountEditor(
      'javascript:alert(1) ftp://exemple.fr/a data:text/html;base64,AAAA https://exemple.fr/ok a@exemple.fr',
    );

    const hrefs = Array.from(editor.content().querySelectorAll('a')).map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['https://exemple.fr/ok', 'mailto:a@exemple.fr']);
    for (const href of hrefs) expect(richTextLinkAddress(href)).toBe(href);
    editor.unmount();
  });
});

describe('MarkdownEditor: a long word cut into formatted pieces', () => {
  // `a*a*a*...` is read as a word of 5 000 italic and plain pieces without a space. The editor's own link
  // module took 22 seconds on it (3 seconds for half of it).
  const WORD = `${'a*'.repeat(5000)}a`;

  it('is read without a freeze, and no detector holds the editor', async () => {
    const spent = { calls: 0, longest: 0, total: 0 };
    AUTO_LINK_MATCHERS.forEach((matcher, index) => {
      AUTO_LINK_MATCHERS[index] = (text) => {
        const started = performance.now();
        const match = matcher(text);
        const took = performance.now() - started;
        spent.calls += 1;
        spent.total += took;
        spent.longest = Math.max(spent.longest, took);
        return match;
      };
    });

    const started = performance.now();
    const editor = await mountEditor(WORD);
    const total = performance.now() - started;

    expect(editor.showsRichText()).toBe(true);
    expect(editor.content().textContent).toHaveLength(5001);
    expect(spent.calls).toBeGreaterThan(0);
    // The detectors answer at once on a text with no address: a few milliseconds in all.
    expect(spent.total).toBeLessThan(500);
    expect(spent.longest).toBeLessThan(200);
    // About a second here (the editor alone takes a third of it); the old module took 22.
    expect(total).toBeLessThan(10_000);
    editor.unmount();
  }, 30_000);

  it('keeps the address typed after the word', async () => {
    const editor = await mountEditor(`${'a*'.repeat(500)}a`);
    await editor.appendParagraph('https://exemple.fr/chemin');

    expect(linksOf(editor.content())).toEqual(['https://exemple.fr/chemin | https://exemple.fr/chemin']);
    editor.unmount();
  });
});
