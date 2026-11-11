import React from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical';
import { vi } from 'vitest';
import MarkdownEditor from './MarkdownEditor';
import { createAppTheme } from '../config/ThemeContext';

const theme = createAppTheme('light');

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
    name: 'a page redirection',
    text: '<meta http-equiv="refresh" content="0;url=https://exemple.test/m" />',
    shown: '<meta http-equiv="refresh"',
  },
  {
    name: 'a layer with a style',
    text: '<div style="position:fixed;top:0;left:0">calque</div>',
    shown: '<div style="position:fixed;top:0;left:0">',
  },
  {
    name: 'a styled span',
    text: 'avant <span style="position:fixed;top:0">milieu</span> après',
    shown: '<span style="position:fixed;top:0">',
  },
  {
    name: 'a frame',
    text: '<iframe src="https://exemple.test/c"></iframe>',
    shown: '<iframe src="https://exemple.test/c"',
  },
  {
    name: 'an element with a handler',
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
    text: `<u onclick="globalThis.${HANDLER_FLAG} = true" style="position:fixed">souligné</u>`,
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
    name: 'a page redirection in a table cell',
    text: '| a |\n| - |\n| <meta http-equiv="refresh" content="0;url=https://exemple.test/m" /> |',
    shown: '<meta http-equiv="refresh"',
  },
  {
    name: 'an element with a handler in a table header cell',
    text: `| <details open ontoggle="globalThis.${HANDLER_FLAG} = true">détail</details> |\n| - |\n| b |`,
    shown: '<details open ontoggle=',
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
    name: 'a layer around paragraphs',
    text: '<div style="position:fixed">\n\n**gras** dedans\n\n</div>',
    shown: '<div style="position:fixed">',
  },
];

const FOREIGN_ELEMENTS = [
  'form', 'input', 'textarea', 'select', 'meta', 'iframe', 'details', 'summary', 'style', 'script',
  'object', 'embed', 'link', 'base', 'a', 'u',
];
const FOREIGN_ATTRIBUTES = ['action', 'formaction', 'http-equiv', 'srcdoc'];

/** Elements and attributes under `root` that only the text given to the editor can have produced. */
export function foreignMarkup(root: Element): string[] {
  const found: string[] = [];
  root.querySelectorAll('*').forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (FOREIGN_ELEMENTS.includes(tag)) found.push(`<${tag}>`);
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on')
        || FOREIGN_ATTRIBUTES.includes(name)
        || (name === 'style' && /position|display:\s*none/.test(attribute.value))
        || (name === 'href' && /^\s*javascript:/i.test(attribute.value))
      ) {
        found.push(`${tag}[${name}="${attribute.value}"]`);
      }
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
}: {
  initial: string;
  disabled: boolean;
  onChange: (markdown: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <ThemeProvider theme={theme}>
      <MarkdownEditor
        value={value}
        disabled={disabled}
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
  const view = render(<Harness initial={text} disabled={disabled} onChange={onChange} />);
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
    /** A person's edit: one more paragraph at the end of the text. */
    async appendParagraph(paragraph: string) {
      const editor = (content() as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;
      await act(async () => {
        editor.update(() => {
          $getRoot().append($createParagraphNode().append($createTextNode(paragraph)));
        });
      });
      await settle();
    },
    unmount: view.unmount,
  };
}
