import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  editorHtmlNode,
  editorParagraphNode,
  editorTextNode,
  unexpectedMarkup,
  HANDLER_FLAG,
  HTML_ELEMENT_TEXTS,
  mountEditor,
  READER_GAP_TEXTS,
} from './markdownEditorTestSupport';

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
  { name: 'a less-than sign at the end of the text', text: 'si x <', shown: 'si x <' },
  { name: 'a less-than sign at the end of a line', text: 'si x <\n5 alors', shown: 'si x <' },
  { name: 'a less-than sign before a no-break space', text: 'si x <\u00a05 alors', shown: 'si x <\u00a05 alors' },
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
          expect(unexpectedMarkup()).toEqual([]);
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

    expect(unexpectedMarkup({ built: ['a'] })).toEqual([]);
    expect(editor.content().querySelector('a')?.getAttribute('href')).toBe('about:blank');

    editor.unmount();
  });

  it('shows a note with attributes without them', async () => {
    const editor = await mountEditor(`:::note{style="color: red" onclick="globalThis.${HANDLER_FLAG} = true"}\ntexte\n:::`);

    expect(unexpectedMarkup()).toEqual([]);
    expect(editor.content().textContent).toContain('texte');

    editor.unmount();
  });

  it('shows an automatic link with another scheme as text', async () => {
    const editor = await mountEditor('voir <ftp://exemple.test/a> ici');

    expect(editor.showsRichText()).toBe(true);
    expect(editor.content().querySelector('a')).toBeNull();
    expect(editor.content().textContent).toBe('voir <ftp://exemple.test/a> ici');
    expect(editor.onChange).not.toHaveBeenCalled();

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
    expect(unexpectedMarkup()).toEqual([]);
    expect(editor.content().textContent).toBe('avant <section>texte</section> souligné après');
    expect(editor.onChange).not.toHaveBeenCalled();

    editor.unmount();
  });
});

describe("MarkdownEditor: a paste in the editor's own clipboard format", () => {
  it('shows an element outside the accepted list as text', async () => {
    const editor = await mountEditor('texte simple');

    await editor.pasteEditorNodes([
      editorHtmlNode('section', [['onclick', `globalThis.${HANDLER_FLAG} = true`]], {
        children: [editorParagraphNode([editorTextNode('bloc')])],
      }),
      editorHtmlNode('form', [['action', 'https://exemple.test/f']]),
      editorParagraphNode([
        editorTextNode('avant '),
        editorHtmlNode('span', [['style', 'color: red']], { inline: true, children: [editorTextNode('milieu')] }),
        editorTextNode(' après'),
      ]),
      editorHtmlNode('u', [['class', 'x']], { inline: true, children: [editorTextNode('souligné')] }),
    ]);

    expect(editor.content().querySelector('section, form, span[style], u')).toBeNull();
    expect(unexpectedMarkup()).toEqual([]);
    const shown = editor.content().textContent ?? '';
    for (const tag of ['<section onclick=', '</section>', '<form action="https://exemple.test/f" />', '<span style="color: red">milieu</span>', '<u class="x">souligné</u>']) {
      expect(shown).toContain(tag);
    }
    expect((globalThis as Record<string, unknown>)[HANDLER_FLAG]).toBeUndefined();
    expect(editor.lastChange()).toContain('\\<section onclick');
    expect(editor.lastChange()).not.toMatch(/(^|[^\\])<(section|form|span|u)\b/);

    editor.unmount();
  });

  it('keeps underline, subscript and superscript', async () => {
    const editor = await mountEditor('texte simple');
    const UNDERLINE = 8;
    const SUBSCRIPT = 32;
    const SUPERSCRIPT = 64;

    await editor.pasteEditorNodes([
      editorParagraphNode([
        editorTextNode(' '),
        editorTextNode('souligné', UNDERLINE),
        editorTextNode(' H'),
        editorTextNode('2', SUBSCRIPT),
        editorTextNode('O x'),
        editorTextNode('2', SUPERSCRIPT),
      ]),
    ]);

    expect(editor.content().querySelector('sub')?.textContent).toBe('2');
    expect(editor.content().querySelector('sup')?.textContent).toBe('2');
    expect(editor.lastChange()).toBe('texte simple <u>souligné</u> H<sub>2</sub>O x<sup>2</sup>');

    editor.unmount();
  });
});

describe('MarkdownEditor: the preview of a link', () => {
  const anchorsOutsideTheText = (content: HTMLElement) =>
    Array.from(document.body.querySelectorAll('a')).filter((anchor) => !content.contains(anchor));

  it.each([
    ['a web address', 'https://exemple.test/a'],
    ['a mail address', 'mailto:equipe@exemple.test'],
    ['a path of the application', '/portfolio/tasks/T-1/overview'],
    ['an anchor', '#suite'],
  ])('opens %s', async (_name, address) => {
    const editor = await mountEditor(`voir [le lien](${address}) ici`);

    await editor.placeCaretInLink();

    expect(unexpectedMarkup({ built: ['a'] })).toEqual([]);
    expect(anchorsOutsideTheText(editor.content()).map((anchor) => anchor.getAttribute('href'))).toEqual([address]);

    editor.unmount();
  });

  it.each([
    ['a file transfer address', 'ftp://exemple.test/a'],
    ['a phone number', 'tel:+33123456789'],
    ['a script scheme', 'javascript:void%200'],
    ['a relative address', 'page.md'],
  ])('shows %s as text, without a link', async (_name, address) => {
    const editor = await mountEditor(`voir [le lien](${address}) ici`);

    await editor.placeCaretInLink();

    expect(unexpectedMarkup({ built: ['a'] })).toEqual([]);
    expect(document.body.textContent).toContain(address);
    expect(anchorsOutsideTheText(editor.content())).toEqual([]);

    editor.unmount();
  });
});

describe('MarkdownEditor: a stored text that readers of Markdown cut differently', () => {
  for (const { name, text, builds } of READER_GAP_TEXTS) {
    it(`builds no element out of ${name} and reports no change`, async () => {
      const editor = await mountEditor(text);

      expect(unexpectedMarkup({ built: builds === 'a' ? [builds] : [] })).toEqual([]);
      expect((globalThis as Record<string, unknown>)[HANDLER_FLAG]).toBeUndefined();
      expect(editor.onChange).not.toHaveBeenCalled();

      editor.unmount();
    });
  }
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
    {
      name: 'a code block of a list item, with a blank line',
      text: '1. Lancer :\n   ```bash\n   cat <<EOF > out.txt\n\n   <config a="1">\n   EOF\n   ```\n2. Suite',
    },
    { name: 'a code block in a quote', text: '> ```html\n> <div>x</div>\n>\n> <p>y</p>\n> ```' },
    { name: 'inline code that shows a tag', text: 'du `<b>` en ligne' },
    { name: 'inline code between two backticks', text: 'le type ``Map<String, `X`>`` ici' },
    { name: 'an image', text: '![schéma](/api/x.png "titre")' },
    { name: 'a sized image', text: '<img height="40" width="60" alt="schéma" src="/api/x.png" />' },
    { name: 'a check list', text: '* [x] fait\n* [ ] à faire' },
    { name: 'a link', text: '[texte](https://exemple.test/a)' },
    { name: 'an escaped less-than sign', text: 'si x \\<y alors' },
    { name: 'a closing bracket without an opening bracket', text: 'tableau] ici' },
    { name: 'a brace', text: 'accolade { seule' },
  ];

  for (const { name, text } of ORDINARY) {
    it(`reports no change on opening ${name}, then saves it unchanged with the edit`, async () => {
      const editor = await mountEditor(text);

      expect(editor.showsRichText()).toBe(true);
      expect(unexpectedMarkup({ built: name === 'a link' ? ['a'] : [] })).toEqual([]);
      expect(editor.onChange).not.toHaveBeenCalled();

      await editor.appendParagraph('ajout');

      expect(editor.lastChange()).toBe(`${text}\n\najout`);

      editor.unmount();
    });
  }

  it('saves the code of a text with Windows line ends as it is written', async () => {
    const editor = await mountEditor('avant\r\n\r\n~~~\r\n<div>x</div>\r\n~~~\r\n\r\nfin');

    expect(editor.showsRichText()).toBe(true);
    expect(editor.onChange).not.toHaveBeenCalled();

    await editor.appendParagraph('ajout');

    expect(editor.lastChange()).toBe('avant\n\n```\n<div>x</div>\n```\n\nfin\n\najout');

    editor.unmount();
  });

  it('reports no change in read-only mode', async () => {
    const editor = await mountEditor('<u>souligné</u> et <section>texte</section>', { disabled: true });

    expect(editor.onChange).not.toHaveBeenCalled();

    editor.unmount();
  });
});

describe('MarkdownEditor: a long text of structure marks', () => {
  const size = 200 * 1024;
  const repeated = (unit: string) => unit.repeat(Math.floor(size / unit.length));

  it.each([
    ['closing brackets', repeated(']')],
    ['openings of a link destination', repeated('](<')],
    ['opening brackets', repeated('[')],
    ['opening brackets, then closing brackets', `${'['.repeat(size / 2)}${']'.repeat(size / 2)}`],
    ['opening parentheses', repeated('(')],
    ['asterisks', repeated('*')],
    ['underscores', repeated('_')],
    ['backticks', repeated('`')],
    ['tildes', repeated('~')],
    ['quote marks', repeated('>')],
    ['list marks', repeated('+ - ')],
    ['asterisks that close nothing', repeated('a* ')],
    ['underscores that close nothing', repeated('a_ ')],
    ['strikethrough marks that close nothing', repeated('a~~ ')],
    ['highlight marks that close nothing', repeated('a== ')],
  ])('opens 200 KB of %s in less than two seconds and reports no change', async (_name, text) => {
    const start = performance.now();
    const editor = await mountEditor(text);
    const elapsed = performance.now() - start;

    expect(editor.showsRichText()).toBe(true);
    expect(editor.onChange).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(2000);

    editor.unmount();
  });
});
