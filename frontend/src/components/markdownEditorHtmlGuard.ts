import { addImportVisitor$, DEFAULT_FORMAT, realmPlugin, type MdastImportVisitor } from '@mdxeditor/editor';
import { $createParagraphNode, $createTextNode, type ElementNode } from 'lexical';
import type {
  MdxJsxAttribute,
  MdxJsxExpressionAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from 'mdast-util-mdx-jsx';
import { isRichTextBareElementName, isRichTextImageAttribute } from '../lib/richTextHtmlElements';

type HtmlElementNode = MdxJsxFlowElement | MdxJsxTextElement;

/** Lexical parents that hold their text directly, without a paragraph (as the editor's own paragraph import). */
const PARENTS_WITHOUT_PARAGRAPH = ['listitem', 'admonition'];

function isHtmlElementNode(node: { type: string }): node is HtmlElementNode {
  return node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement';
}

/** True for the elements of `RICH_TEXT_HTML_ELEMENTS`, in the only form the list accepts. */
export function isRichTextHtmlElement(node: HtmlElementNode): boolean {
  const name = node.name ?? '';
  if (isRichTextBareElementName(name)) return node.attributes.length === 0;
  if (name !== 'img' || node.children.length > 0) return false;
  let hasSource = false;
  for (const attribute of node.attributes) {
    if (attribute.type !== 'mdxJsxAttribute' || typeof attribute.value !== 'string') return false;
    if (!isRichTextImageAttribute(attribute.name, attribute.value)) return false;
    if (attribute.name === 'src') hasSource = true;
  }
  return hasSource;
}

function attributeText(attribute: MdxJsxAttribute | MdxJsxExpressionAttribute): string {
  if (attribute.type !== 'mdxJsxAttribute') return ` {${attribute.value}}`;
  const { name, value } = attribute;
  if (value === null || value === undefined) return ` ${name}`;
  if (typeof value !== 'string') return ` ${name}={${value.value}}`;
  return value.includes('"') ? ` ${name}='${value}'` : ` ${name}="${value}"`;
}

function openingTagText(node: HtmlElementNode, selfClosing: boolean): string {
  return `<${node.name ?? ''}${node.attributes.map(attributeText).join('')}${selfClosing ? ' />' : '>'}`;
}

/**
 * Shows as text every HTML element of a text that is not in `RICH_TEXT_HTML_ELEMENTS`: its opening
 * tag with its attributes, its content read as Markdown, its closing tag. The editor then builds no
 * element, attribute or style out of the text it is given. It runs on the tree the editor parsed
 * itself, table cells included, ahead of the editor's own import of HTML elements.
 */
const htmlAsTextVisitor: MdastImportVisitor<HtmlElementNode> = {
  testNode: (node) => isHtmlElementNode(node) && !isRichTextHtmlElement(node),
  priority: 1000,
  visitNode({ mdastNode, lexicalParent, actions }) {
    const parent = lexicalParent as ElementNode;
    const parentType = parent.getType();
    const inline = mdastNode.type === 'mdxJsxTextElement'
      ? parentType !== 'root'
      : PARENTS_WITHOUT_PARAGRAPH.includes(parentType);
    const format = actions.getParentFormatting();
    const appendText = (text: string) => {
      const textNode = $createTextNode(text).setFormat(format);
      parent.append(inline ? textNode : $createParagraphNode().append(textNode));
    };

    const empty = mdastNode.children.length === 0;
    appendText(openingTagText(mdastNode, empty));
    if (empty) return;
    // The content keeps the formatting of the text around the element.
    actions.addFormatting(DEFAULT_FORMAT);
    actions.visitChildren(mdastNode, parent);
    appendText(`</${mdastNode.name ?? ''}>`);
  },
};

export const htmlAsTextPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, htmlAsTextVisitor);
  },
});
