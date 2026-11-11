import { afterEach, describe, expect, it, vi } from 'vitest';
import { foreignMarkup, HANDLER_FLAG, HTML_ELEMENT_TEXTS, mountEditor } from './markdownEditorTestSupport';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[HANDLER_FLAG];
});

describe('MarkdownEditor: an HTML element outside the accepted list is text', () => {
  for (const disabled of [false, true]) {
    describe(disabled ? 'read-only' : 'editable', () => {
      for (const { name, text, shown } of HTML_ELEMENT_TEXTS) {
        it(`shows ${name} as text`, async () => {
          const editor = await mountEditor(text, { disabled });

          expect(foreignMarkup(editor.content())).toEqual([]);
          expect(editor.content().textContent).toContain(shown);
          expect((globalThis as Record<string, unknown>)[HANDLER_FLAG]).toBeUndefined();

          editor.unmount();
        });
      }
    });
  }
});

describe('MarkdownEditor: the accepted elements keep their meaning', () => {
  it('renders underline, subscript and superscript', async () => {
    const editor = await mountEditor('<u>souligné</u> H<sub>2</sub>O x<sup>2</sup>');

    expect(editor.content().textContent).not.toContain('<');
    expect(editor.content().querySelector('sub')?.textContent).toBe('2');
    expect(editor.content().querySelector('sup')?.textContent).toBe('2');

    editor.unmount();
  });

  it('renders a line break, in a paragraph and in a table cell', async () => {
    const editor = await mountEditor('ligne 1<br />ligne 2\n\n| a |\n| - |\n| l1<br />l2 |');

    expect(editor.content().textContent).not.toContain('<');
    expect(editor.content().querySelectorAll('br').length).toBeGreaterThanOrEqual(2);

    editor.unmount();
  });

  it('renders a sized image', async () => {
    const editor = await mountEditor('<img height="40" width="60" alt="schéma" src="/api/x.png" />');

    expect(editor.content().textContent).not.toContain('<');

    editor.unmount();
  });
});
