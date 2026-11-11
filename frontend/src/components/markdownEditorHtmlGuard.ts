import {
  addImportVisitor$,
  createActiveEditorSubscription$,
  createRootEditorSubscription$,
  DEFAULT_FORMAT,
  GenericHTMLNode,
  realmPlugin,
  type MdastImportVisitor,
} from '@mdxeditor/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $isRootOrShadowRoot,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
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

type HtmlAttribute = MdxJsxAttribute | MdxJsxExpressionAttribute;

/** True for an element of `RICH_TEXT_HTML_ELEMENTS`, in the only form the list accepts. */
function isAcceptedElement(name: string, attributes: HtmlAttribute[], hasChildren: boolean): boolean {
  if (isRichTextBareElementName(name)) return attributes.length === 0;
  if (name !== 'img' || hasChildren) return false;
  let hasSource = false;
  for (const attribute of attributes) {
    if (attribute?.type !== 'mdxJsxAttribute' || typeof attribute.value !== 'string') return false;
    if (!isRichTextImageAttribute(attribute.name, attribute.value)) return false;
    if (attribute.name === 'src') hasSource = true;
  }
  return hasSource;
}

/** True for the elements of `RICH_TEXT_HTML_ELEMENTS`, in the only form the list accepts. */
export function isRichTextHtmlElement(node: HtmlElementNode): boolean {
  return isAcceptedElement(node.name ?? '', node.attributes, node.children.length > 0);
}

function attributeText(attribute: HtmlAttribute): string {
  if (attribute.type !== 'mdxJsxAttribute') return ` {${attribute.value}}`;
  const { name, value } = attribute;
  if (value === null || value === undefined) return ` ${name}`;
  if (typeof value !== 'string') return ` ${name}={${value.value}}`;
  return value.includes('"') ? ` ${name}='${value}'` : ` ${name}="${value}"`;
}

function openingTagText(name: string, attributes: HtmlAttribute[], selfClosing: boolean): string {
  return `<${name}${attributes.map(attributeText).join('')}${selfClosing ? ' />' : '>'}`;
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
    appendText(openingTagText(mdastNode.name ?? '', mdastNode.attributes, empty));
    if (empty) return;
    // The content keeps the formatting of the text around the element.
    actions.addFormatting(DEFAULT_FORMAT);
    actions.visitChildren(mdastNode, parent);
    appendText(`</${mdastNode.name ?? ''}>`);
  },
};

/**
 * The same rule on the editor's own node of an HTML element, however the node came to be (the
 * editor's clipboard format carries such nodes as they are, past the reading of a text): an element
 * outside `RICH_TEXT_HTML_ELEMENTS` is replaced by its opening tag as text, its content, its
 * closing tag as text. It runs before the editor builds the page, so the element never exists.
 */
function $showHtmlElementAsText(node: GenericHTMLNode): void {
  const name = String(node.getTag() ?? '');
  const given: unknown = node.getAttributes();
  const attributes = (Array.isArray(given) ? given : []).filter(
    (attribute): attribute is HtmlAttribute => typeof attribute === 'object' && attribute !== null,
  );
  const children = node.getChildren();
  if (Array.isArray(given) && attributes.length === given.length && isAcceptedElement(name, attributes, children.length > 0)) {
    return;
  }

  const inline = node.isInline() && !$isRootOrShadowRoot(node.getParent());
  // In a line, a piece stays as it is; among blocks, a piece that is not a block gets a paragraph.
  const place = (piece: LexicalNode) => {
    node.insertBefore(inline || !piece.isInline() ? piece : $createParagraphNode().append(piece));
  };
  place($createTextNode(openingTagText(name, attributes, children.length === 0)));
  if (children.length > 0) {
    children.forEach(place);
    place($createTextNode(`</${name}>`));
  }
  node.remove();
}

const registerHtmlAsTextTransform = (editor: LexicalEditor) =>
  editor.registerNodeTransform(GenericHTMLNode, $showHtmlElementAsText);

export const htmlAsTextPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, htmlAsTextVisitor);
    // The editor of the text, and each editor inside it (a table cell, a note) once a person is in it.
    realm.pub(createRootEditorSubscription$, registerHtmlAsTextTransform);
    realm.pub(createActiveEditorSubscription$, registerHtmlAsTextTransform);
  },
});
