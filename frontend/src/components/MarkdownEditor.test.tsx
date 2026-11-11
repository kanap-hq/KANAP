import { afterEach, describe, expect, it, vi } from 'vitest';
import { foreignMarkup, HANDLER_FLAG, HTML_ELEMENT_TEXTS, mountEditor } from './markdownEditorTestSupport';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[HANDLER_FLAG];
});

/** Texts with angle brackets the editor's reader refuses as they stand, each with what must show. */
const UNREADABLE_AS_STORED: Array<{ name: string; text: string; shown: string }> = [
  { name: 'an attribute without quotes', text: '<a href=x>lien</a>', shown: '<a href=x>lien</a>' },
  { name: 'a tag that is never closed', text: 'avant <div> après', shown: 'avant <div> après' },
  { name: 'a less-than sign in prose', text: 'si x <y alors', shown: 'si x <y alors' },
  { name: 'a less-than sign after a parenthesis', text: 'f(<y) vaut 2', shown: 'f(<y) vaut 2' },
  { name: 'a tag after the opening of a link destination', text: 'texte](<section>bloc</section>) fin', shown: '<section>bloc</section>' },
  { name: 'an HTML comment', text: 'avant <!-- note --> après', shown: '<!-- note -->' },
  { name: 'an unknown tag', text: '<inconnu>texte</inconnu>', shown: '<inconnu>texte</inconnu>' },
  { name: 'an underline tag that is never closed', text: '<u>jamais fermé', shown: '<u>jamais fermé' },
  { name: 'accepted tags closed in the wrong order', text: '**<u>gras**</u> suite', shown: '<u>' },
];

describe('MarkdownEditor: a stored text with HTML elements', () => {
  for (const disabled of [false, true]) {
    describe(disabled ? 'read-only' : 'editable', () => {
      for (const { name, text, shown } of [...HTML_ELEMENT_TEXTS, ...UNREADABLE_AS_STORED]) {
        it(`shows ${name} as text and reports no change`, async () => {
          const editor = await mountEditor(text, { disabled });

          expect(editor.showsRichText()).toBe(true);
          expect(foreignMarkup(editor.content())).toEqual([]);
          expect(editor.content().textContent).toContain(shown);
          expect((globalThis as Record<string, unknown>)[HANDLER_FLAG]).toBeUndefined();
          expect(editor.onChange).not.toHaveBeenCalled();

          editor.unmount();
        });
      }
    });
  }

  it('gives a Markdown link with a script scheme no address', async () => {
    const editor = await mountEditor('[lien](javascript:void%200)');

    expect(foreignMarkup(editor.content())).toEqual(['<a>']);
    expect(editor.content().querySelector('a')?.getAttribute('href')).toBe('about:blank');

    editor.unmount();
  });

  it('shows a note with attributes without them', async () => {
    const editor = await mountEditor(`:::note{style="position:fixed" onclick="globalThis.${HANDLER_FLAG} = true"}\ntexte\n:::`);

    expect(foreignMarkup(editor.content())).toEqual([]);
    expect(editor.content().textContent).toContain('texte');

    editor.unmount();
  });

  it('reads an automatic link as a link', async () => {
    const editor = await mountEditor('voir <https://exemple.test/a>');

    expect(editor.showsRichText()).toBe(true);
    expect(editor.content().querySelector('a')?.getAttribute('href')).toBe('https://exemple.test/a');
    expect(editor.onChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it('reads a line break tag in a table cell as a line break', async () => {
    const editor = await mountEditor('| a |\n| - |\n| l1<br>l2 |');

    expect(editor.showsRichText()).toBe(true);
    expect(editor.content().textContent).not.toContain('<');
    expect(editor.onChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it('keeps the accepted elements of a text that also holds other tags', async () => {
    const editor = await mountEditor('H<sub>2</sub>O dans <section>la cuve</section>');

    expect(editor.content().querySelector('sub')?.textContent).toBe('2');
    expect(editor.content().textContent).toContain('<section>la cuve</section>');

    editor.unmount();
  });

  it('saves the text as it shows once a person changes it', async () => {
    const editor = await mountEditor('<form action="https://exemple.test/f"><input name="p" /></form>');

    await editor.appendParagraph('ajout');

    expect(editor.lastChange()).toBe(
      '\\<form action\\="https://exemple.test/f">\\<input name\\="p" />\\</form>\n\najout',
    );

    editor.unmount();
  });

  it('saves a text whose accepted tags did not read with every tag as text', async () => {
    const editor = await mountEditor('**<u>gras**</u> suite');

    await editor.appendParagraph('ajout');

    expect(editor.lastChange()).toBe('**\\<u>gras**\\</u> suite\n\najout');

    editor.unmount();
  });

  it('reads the accepted elements again when the record gives another text', async () => {
    const editor = await mountEditor('**<u>gras**</u> suite');
    expect(editor.content().textContent).toContain('<u>');

    await editor.setValue('<u>fermé</u>');

    expect(editor.showsRichText()).toBe(true);
    expect(editor.content().textContent).toBe('fermé');
    expect(editor.onChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it('shows a text it is asked to read in place the same way', async () => {
    const editor = await mountEditor('premier texte');

    await editor.setValue('avant <section>texte</section> <u>souligné</u> après', { refresh: true });

    expect(editor.showsRichText()).toBe(true);
    expect(foreignMarkup(editor.content())).toEqual([]);
    expect(editor.content().textContent).toBe('avant <section>texte</section> souligné après');
    expect(editor.onChange).not.toHaveBeenCalled();

    editor.unmount();
  });
});

describe('MarkdownEditor: ordinary Markdown', () => {
  const ORDINARY: Array<{ name: string; text: string }> = [
    {
      name: 'underline, subscript, superscript and the Markdown formats',
      text: '<u>souligné</u> H<sub>2</sub>O x<sup>2</sup> ==surligné== ~~barré~~ **gras** *italique*',
    },
    { name: 'a table', text: '| a | b |\n| - | - |\n| 1 | 2 |' },
    { name: 'a line break in a table cell', text: '| a          |\n| ---------- |\n| l1<br />l2 |' },
    { name: 'a code block that shows HTML', text: '```html\n<form action="x"></form>\n```' },
    { name: 'inline code that shows a tag', text: 'du `<b>` en ligne' },
    { name: 'an image', text: '![schéma](/api/x.png "titre")' },
    { name: 'a sized image', text: '<img height="40" width="60" alt="schéma" src="/api/x.png" />' },
    { name: 'a check list', text: '* [x] fait\n* [ ] à faire' },
    { name: 'a link', text: '[texte](https://exemple.test/a)' },
    { name: 'an escaped less-than sign', text: 'si x \\<y alors' },
    { name: 'a brace', text: 'accolade { seule' },
  ];

  for (const { name, text } of ORDINARY) {
    it(`reports no change on opening ${name}, then saves it unchanged with the edit`, async () => {
      const editor = await mountEditor(text);

      expect(editor.showsRichText()).toBe(true);
      expect(foreignMarkup(editor.content())).toEqual(name === 'a link' ? ['<a>'] : []);
      expect(editor.onChange).not.toHaveBeenCalled();

      await editor.appendParagraph('ajout');

      expect(editor.lastChange()).toBe(`${text}\n\najout`);

      editor.unmount();
    });
  }

  it('reports no change in read-only mode', async () => {
    const editor = await mountEditor('<u>souligné</u> et <section>texte</section>', { disabled: true });

    expect(editor.onChange).not.toHaveBeenCalled();

    editor.unmount();
  });
});
