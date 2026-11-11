import React from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { vi } from 'vitest';
import MarkdownEditor from './MarkdownEditor';
import { isRichTextImageAttribute } from '../lib/richTextHtmlElements';
import { richTextLinkAddress } from '../lib/richTextLinkAddress';
import { createAppTheme } from '../config/ThemeContext';

const theme = createAppTheme('light');

// jsdom has no clipboard event and no drag event; the editor names both classes when it reads a paste.
for (const name of ['ClipboardEvent', 'DragEvent']) {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, { value: { [name]: class extends Event {} }[name], configurable: true, writable: true });
  }
}

/** Name of the global a handler attribute of the texts below sets when it runs. */
export const HANDLER_FLAG = 'richTextHandlerRan';

/**
 * Texts that hold an HTML element outside the list a rich text accepts, each with the opening tag
 * the editor must show as text.
 */
export const HTML_ELEMENT_TEXTS: Array<{ name: string; text: string; shown: string }> = [
  {
    name: 'a form',
    text: '<form action="https://exemple.test/f"><input name="p" /></form>',
    shown: '<form action="https://exemple.test/f">',
  },
  {
    name: 'a metadata tag',
    text: '<meta name="note" content="x" />',
    shown: '<meta name="note"',
  },
  {
    name: 'a styled block',
    text: '<div style="color: red">bloc</div>',
    shown: '<div style="color: red">',
  },
  {
    name: 'a styled span',
    text: 'avant <span style="color: red">milieu</span> après',
    shown: '<span style="color: red">',
  },
  {
    name: 'a frame',
    text: '<iframe src="https://exemple.test/c"></iframe>',
    shown: '<iframe src="https://exemple.test/c"',
  },
  {
    name: 'a block with a handler',
    text: `avant <section onclick="globalThis.${HANDLER_FLAG} = true">bloc</section> après`,
    shown: '<section onclick=',
  },
  {
    // An open disclosure calls its handler as soon as it is built.
    name: 'an open disclosure with a handler',
    text: `avant <details open ontoggle="globalThis.${HANDLER_FLAG} = true">détail</details> après`,
    shown: '<details open ontoggle=',
  },
  {
    name: 'a style sheet',
    text: '<style>p { display: none }</style>',
    shown: '<style>',
  },
  {
    name: 'a link with a script scheme',
    text: '<a href="javascript:void 0">lien</a>',
    shown: '<a href="javascript:void 0">',
  },
  {
    name: 'an underline tag with attributes',
    text: `<u onclick="globalThis.${HANDLER_FLAG} = true" style="color: red">souligné</u>`,
    shown: '<u onclick=',
  },
  {
    name: 'a line break with an attribute',
    text: 'ligne 1<br class="x" />ligne 2',
    shown: '<br class="x" />',
  },
  {
    name: 'an image with a handler',
    text: `<img src="/api/x.png" onerror="globalThis.${HANDLER_FLAG} = true" />`,
    shown: '<img src="/api/x.png" onerror=',
  },
  {
    name: 'an image without a source',
    text: '<img alt="sans source" />',
    shown: '<img alt="sans source" />',
  },
  {
    name: 'a form in a table cell',
    text: '| a |\n| - |\n| <form action="https://exemple.test/f"><input name="p" /></form> |',
    shown: '<form action="https://exemple.test/f">',
  },
  {
    name: 'a metadata tag in a table cell',
    text: '| a |\n| - |\n| <meta name="note" content="x" /> |',
    shown: '<meta name="note"',
  },
  {
    name: 'a block with a handler in a table header cell',
    text: `| <section onclick="globalThis.${HANDLER_FLAG} = true">bloc</section> |\n| - |\n| b |`,
    shown: '<section onclick=',
  },
  {
    name: 'a form in an indented block',
    text: 'Texte\n\n    <form action="https://exemple.test/f"><input name="p" /></form>\n\nSuite',
    shown: '<form action="https://exemple.test/f">',
  },
  {
    name: 'a frame in an indented block',
    text: 'Texte\n\n    <iframe src="https://exemple.test/c"></iframe>\n\nSuite',
    shown: '<iframe src="https://exemple.test/c"',
  },
  {
    name: 'a frame in a list item',
    text: '* premier\n* <iframe src="https://exemple.test/c"></iframe>',
    shown: '<iframe src="https://exemple.test/c"',
  },
  {
    name: 'a form in a quote',
    text: '> <form action="https://exemple.test/f"><input name="p" /></form>',
    shown: '<form action="https://exemple.test/f">',
  },
  {
    name: 'a form in a heading',
    text: '## Titre <form action="https://exemple.test/f"><input name="p" /></form>',
    shown: '<form action="https://exemple.test/f">',
  },
  {
    name: 'an open disclosure with a handler in a note',
    text: `:::note\n<details open ontoggle="globalThis.${HANDLER_FLAG} = true">détail</details>\n:::`,
    shown: '<details open ontoggle=',
  },
  {
    name: 'a styled span in bold text',
    text: '**gras <span style="color: red">milieu</span> gras**',
    shown: '<span style="color: red">',
  },
  {
    name: 'a styled block around paragraphs',
    text: '<div style="color: red">\n\n**gras** dedans\n\n</div>',
    shown: '<div style="color: red">',
  },
];

const FORM = '<form action="https://exemple.test/f"><input name="p" /></form>';
const HANDLER = `globalThis.${HANDLER_FLAG} = true`;
const DETAILS = `<details open ontoggle="${HANDLER}">détail</details>`;
const DETAILS_SINGLE_QUOTED = `<details open ontoggle='${HANDLER}'>détail</details>`;

/**
 * Texts that readers of Markdown do not cut the same way: what is code, a comment or plain text
 * for one is a tag for another. Whatever the editor reads in them, it builds no element out of
 * them. `builds` names the element the editor builds by itself: a link for a Markdown link, an
 * underline for an underline tag without attribute.
 */
export const READER_GAP_TEXTS: Array<{ name: string; text: string; builds?: 'a' | 'u' }> = [
  { name: 'an underline tag whose attribute holds a backtick', text: `<u $a="\`"> ${FORM} \` fin</u>` },
  { name: 'a line break whose attribute holds a backtick', text: `<br $a="\`"/> ${FORM} \` fin` },
  { name: 'a styled block whose attribute holds a backtick', text: `<div $a="\`" style="color: red"> ${DETAILS} \` fin</div>` },
  { name: 'an image whose attribute holds a backtick', text: `<img $a="\`" src="/api/x.png" onerror="${HANDLER}" /> \` fin` },
  { name: 'an underline tag with a space before its end', text: '<u >souligné</u >' },
  { name: 'a self-closed underline tag', text: 'a <u/> b' },
  { name: 'a closing line break', text: 'a</br>b' },
  { name: 'an upper-case image', text: '<IMG SRC="/api/x.png" ONERROR="1" />' },
  { name: 'an image with an unquoted attribute', text: `<img src=/api/x.png onerror=${HANDLER} />` },
  { name: 'a tag on several lines', text: '<form\n  action="https://exemple.test/f"\n>\n<input name="p" />\n</form>' },
  { name: 'a tag on several lines in a sentence', text: `avant <details\nopen\nontoggle="${HANDLER}">détail</details> après` },
  { name: 'an attribute value on two lines', text: '<div title="a\nb" style="color: red">bloc</div>' },
  { name: 'an attribute value with a blank line', text: '<div title="a\n\nb" style="color: red">bloc</div>' },
  { name: 'a comment around a tag', text: `<!-- ${FORM} -->` },
  { name: 'a comment in a sentence', text: `avant <!-- note --> après ${FORM}` },
  { name: 'a comment left open', text: `<!-- \n\n${FORM}` },
  { name: 'a comment closed at once', text: `<!--> ${FORM} -->` },
  { name: 'a character data section', text: `<![CDATA[${FORM}]]>` },
  { name: 'a character data section in a sentence', text: `avant <![CDATA[ ${DETAILS} ]]> après` },
  { name: 'a processing instruction', text: `<?php echo 1 ?>${FORM}` },
  { name: 'a processing instruction left open', text: `<?x \n\n${DETAILS}` },
  { name: 'a document type declaration', text: `<!DOCTYPE html>\n${FORM}` },
  { name: 'a character reference in a tag name', text: '<fo&#114;m action="https://exemple.test/f"></fo&#114;m>' },
  { name: 'a tag written with character references', text: '&lt;form action="https://exemple.test/f"&gt;&lt;/form&gt; &#60;iframe src="https://exemple.test/c"&#62;' },
  { name: 'a tag in a link title', text: `[lien](https://exemple.test/a "${DETAILS_SINGLE_QUOTED}")`, builds: 'a' },
  { name: 'a tag in an image title and description', text: `![<iframe src=x>](/api/x.png "<form action='https://exemple.test/f'>")` },
  { name: 'a tag in a link address', text: `[lien](<https://exemple.test/a>${FORM})`, builds: 'a' },
  { name: 'a tag in a link text', text: `[${DETAILS}](https://exemple.test/a)`, builds: 'a' },
  { name: 'a code span with several backticks', text: `\`\` \` ${FORM} \` \`\`` },
  { name: 'two backticks left open before a code span', text: `\`\` a \` ${FORM} \` b` },
  { name: 'a code span closed by a longer run of backticks', text: `\` a \`\` ${DETAILS} \` b \`\`` },
  { name: 'a code span over several lines', text: `\`a\n${FORM}\nb\`` },
  { name: 'a fenced block left open', text: `\`\`\`html\n${FORM}\n\nsuite ${DETAILS}` },
  { name: 'a tilde fence left open', text: `~~~\n${FORM}` },
  { name: 'a fence of a list item closed outside it', text: `* a\n\n  \`\`\`\n  ${FORM}\n\n\`\`\`\n${DETAILS}\n\`\`\`` },
  { name: 'a fence closed by a shorter run', text: `\`\`\`\`\n${FORM}\n\`\`\`\n${DETAILS}\n\`\`\`\`` },
  { name: 'a fence whose language is a tag', text: `\`\`\`<details open ontoggle="${HANDLER}">\ncode\n\`\`\`` },
  { name: 'a tag in a footnote', text: `Texte[^1]\n\n[^1]: ${FORM}` },
  { name: 'a tag in the title of a link definition', text: `[ref]: https://exemple.test/a "${DETAILS_SINGLE_QUOTED}"\n\n[lien][ref]`, builds: 'a' },
  { name: 'a tag in the label of a link definition', text: `[<iframe src=x>]: https://exemple.test/a\n\n${FORM}` },
  { name: 'a tag after a backslash', text: `\\${FORM}` },
  { name: 'a tag after two backslashes', text: `\\\\${FORM}` },
  { name: 'a tag cut by emphasis', text: '<for*m action="https://exemple.test/f"*>' },
  { name: 'a tag without a name', text: `<>${DETAILS}</>` },
  { name: 'tags with a dotted and a prefixed name', text: '<a.b c="1">x</a.b> <svg:a href="javascript:void 0">y</svg:a>' },
  { name: 'attributes between braces', text: '<u {...{onclick:1}}>x</u> <img src={"/api/x.png"} onerror={1} />' },
  { name: 'a text between braces', text: `{${HANDLER}}` },
  { name: 'an import line', text: `import x from "y"\n\n${FORM}` },
  { name: 'a tag in an inline directive', text: `:abbr[${DETAILS}]{title="x" style="color: red"}` },
  { name: 'a tag in a one-line directive', text: `::video[${FORM}]{src="https://exemple.test/c" onload="${HANDLER}"}` },
  { name: 'a note with attributes around a tag', text: `:::note{style="color: red" onclick="${HANDLER}"}\n${FORM}\n:::` },
  { name: 'a tag in an underlined heading', text: `Titre ${FORM}\n=====` },
  { name: 'a tag in a table in a quote in a list', text: `* a\n  > | a |\n  > | - |\n  > | ${DETAILS} |` },
  { name: 'a tag in a front matter', text: `---\ntitle: ${FORM}\n---\n\ntexte` },
  { name: 'accepted tags around other tags', text: `<u>${FORM}</u> <sub>${DETAILS}</sub>` },
  { name: 'an underline tag around paragraphs', text: `<u>\n\n${FORM}\n\n</u>`, builds: 'u' },
  { name: 'a line break with a content', text: `a <br>${DETAILS}</br> b` },
  { name: 'a tag name followed by a slash', text: '<form/action="https://exemple.test/f">x</form>' },
  { name: 'a null character in a tag name', text: '<fo\u0000rm action="https://exemple.test/f">' },
  { name: 'a stack trace in an indented block', text: 'Erreur :\n\n    at com.exemple.Service.<init>(Service.java:12)\n    at java.util.Map.<clinit>(Map.java:3)\n' },
];

/** The elements the editor, its toolbar and its dialogs build by themselves, in the page and in its head. */
const EXPECTED_ELEMENTS = new Set([
  'body', 'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
  'strong', 'em', 'code', 'mark', 'sub', 'sup', 'img',
  'table', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'button', 'svg', 'path',
]);
const EXPECTED_HEAD_ELEMENTS = new Set(['head', 'style']);
/** The attributes these elements carry, in lower case, with every `aria-` and `data-` attribute. */
const EXPECTED_ATTRIBUTES = new Set([
  'class', 'style', 'dir', 'role', 'tabindex', 'title', 'type', 'value', 'disabled',
  'contenteditable', 'spellcheck', 'translate', 'autocapitalize', 'autocorrect', 'writingsuggestions',
  'href', 'target', 'rel', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan',
  'xmlns', 'viewbox', 'focusable', 'd', 'fill', 'fill-rule', 'clip-rule',
]);
/** The style properties the editor sets on its own elements, with every custom property. */
const EXPECTED_STYLE_PROPERTIES = new Set([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'transform', 'z-index', 'visibility', 'pointer-events',
  'height', 'min-height', 'margin', 'outline', 'white-space', 'word-break', 'tab-size', 'user-select',
  'animation-duration',
]);

function unexpectedAttribute(tag: string, name: string, value: string): boolean {
  if (name.startsWith('aria-') || name.startsWith('data-')) return false;
  if (!EXPECTED_ATTRIBUTES.has(name)) return true;
  // A link opens an address of a rich text; the editor's own links also keep a phone or message
  // address, and get `about:blank` for any other scheme.
  if (name === 'href') {
    return tag !== 'a' || (richTextLinkAddress(value) === null && !/^(?:about:blank$|tel:|sms:)/i.test(value));
  }
  if (name === 'src') return !isRichTextImageAttribute('src', value);
  if (name === 'target') return value !== '_blank';
  if (name !== 'style') return false;
  return value.split(';').some((declaration) => {
    const [property, ...rest] = declaration.split(':');
    const propertyName = property.trim().toLowerCase();
    if (!propertyName || propertyName.startsWith('--')) return false;
    return !EXPECTED_STYLE_PROPERTIES.has(propertyName) || (propertyName === 'position' && /fixed/i.test(rest.join(':')));
  });
}

/**
 * What the whole document holds that the editor does not build by itself: an element or an
 * attribute outside the expected lists, a link or an image with an address a rich text does not
 * open, a style the editor does not set. The dialogs and the tooltips of the editor are in the
 * document too. `built` names the elements the text given to the editor builds: a link for a
 * Markdown link, an underline for an underline tag around paragraphs.
 */
export function unexpectedMarkup({ built = [] }: { built?: Array<'a' | 'u'> } = {}): string[] {
  const found: string[] = [];
  document.documentElement.querySelectorAll('*').forEach((element) => {
    const tag = element.tagName.toLowerCase();
    const expected = element.closest('head') ? EXPECTED_HEAD_ELEMENTS.has(tag) : EXPECTED_ELEMENTS.has(tag) || (built as string[]).includes(tag);
    if (!expected) found.push(`<${tag}>`);
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (unexpectedAttribute(tag, name, attribute.value)) found.push(`${tag}[${name}="${attribute.value}"]`);
    }
  });
  return found;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

function Harness({
  initial,
  disabled,
  onChange,
  setValueRef,
}: {
  initial: string;
  disabled: boolean;
  onChange: (markdown: string) => void;
  setValueRef: { current: (markdown: string, refresh?: boolean) => void };
}) {
  const [value, setValue] = React.useState(initial);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  setValueRef.current = (markdown, refresh = false) => {
    setValue(markdown);
    if (refresh) setRefreshNonce((nonce) => nonce + 1);
  };
  return (
    <ThemeProvider theme={theme}>
      <MarkdownEditor
        value={value}
        disabled={disabled}
        refreshNonce={refreshNonce}
        onChange={(markdown) => {
          onChange(markdown);
          setValue(markdown);
        }}
      />
    </ThemeProvider>
  );
}

/** Mounts the real editor on a text, as a record page does, and waits for it to settle. */
export async function mountEditor(text: string, { disabled = false }: { disabled?: boolean } = {}) {
  const onChange = vi.fn<(markdown: string) => void>();
  const setValueRef = { current: (_markdown: string, _refresh?: boolean) => {} };
  const view = render(
    <Harness initial={text} disabled={disabled} onChange={onChange} setValueRef={setValueRef} />,
  );
  await settle();

  const content = () => {
    const element = view.container.querySelector('.kanap-mdx-content');
    if (!element) throw new Error('The editor shows no rich text content');
    return element as HTMLElement;
  };

  return {
    container: view.container,
    content,
    onChange,
    /** The text of the last change the editor reported. */
    lastChange: () => onChange.mock.calls[onChange.mock.calls.length - 1]?.[0],
    /** True when the editor shows its content as rich text, false when it reports a reading error. */
    showsRichText: () => {
      const richText = view.container.querySelector<HTMLElement>('.mdxeditor-rich-text-editor');
      return richText?.style.display === 'block';
    },
    /** The record gives the editor another text, as after a reload; `refresh` asks it to read it in place. */
    async setValue(markdown: string, { refresh = false }: { refresh?: boolean } = {}) {
      await act(async () => {
        setValueRef.current(markdown, refresh);
      });
      await settle();
    },
    /** A person's edit: one more paragraph at the end of the text. */
    async appendParagraph(paragraph: string) {
      const editor = (content() as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;
      await act(async () => {
        editor.update(() => {
          // The editor ends a text with an empty paragraph when its last block is not one.
          const last = $getRoot().getLastChild();
          if ($isParagraphNode(last) && last.getChildrenSize() === 0) {
            last.append($createTextNode(paragraph));
          } else {
            $getRoot().append($createParagraphNode().append($createTextNode(paragraph)));
          }
        });
      });
      await settle();
    },
    /** A person's click in the first link of the text: the editor shows the preview of the link. */
    async placeCaretInLink() {
      const editor = (content() as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;
      const firstLink = (node: LexicalNode): LexicalNode | null => {
        if (node.getType() === 'link') return node;
        if (!$isElementNode(node)) return null;
        for (const child of node.getChildren()) {
          const link = firstLink(child);
          if (link) return link;
        }
        return null;
      };
      await act(async () => {
        content().focus();
      });
      await act(async () => {
        editor.update(() => {
          const link = firstLink($getRoot());
          const text = $isElementNode(link) ? link.getFirstChild() : null;
          if (!$isTextNode(text)) throw new Error('The text holds no link');
          text.select(1, 1);
          // jsdom gives a selection no rectangle to scroll to.
        }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
      });
      await settle();
      await settle();
    },
    /** A paste of nodes in the editor's own clipboard format, at the end of the text. */
    async pasteEditorNodes(nodes: unknown[]) {
      const editor = (content() as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;
      const format = 'application/x-lexical-editor';
      const payload = JSON.stringify({ namespace: editor._config.namespace, nodes });
      await act(async () => {
        editor.update(() => {
          $getRoot().selectEnd();
        }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
      });
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === format ? payload : ''), types: [format], files: [] },
      });
      await act(async () => {
        content().dispatchEvent(event);
      });
      await settle();
    },
    unmount: view.unmount,
  };
}

/** An HTML element as the editor's own clipboard format writes it. */
export function editorHtmlNode(
  tag: string,
  attributes: Array<[name: string, value: string]>,
  { inline = false, children = [] as unknown[] } = {},
) {
  return {
    type: 'generic-html',
    tag,
    mdxType: inline ? 'mdxJsxTextElement' : 'mdxJsxFlowElement',
    attributes: attributes.map(([name, value]) => ({ type: 'mdxJsxAttribute', name, value })),
    children,
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  };
}

/** A text as the editor's own clipboard format writes it; `format` is the editor's own number for its formats. */
export function editorTextNode(text: string, format = 0) {
  return { type: 'text', text, format, detail: 0, mode: 'normal', style: '', version: 1 };
}

/** A paragraph as the editor's own clipboard format writes it. */
export function editorParagraphNode(children: unknown[]) {
  return { type: 'paragraph', children, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', version: 1 };
}
