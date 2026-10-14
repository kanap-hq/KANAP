type ClipboardMarkdownImportOptions = {
  html?: string | null;
  plainText?: string | null;
  imageFiles?: File[];
  uploadImage?: ((file: File) => Promise<string>) | null;
  importRemoteImage?: ((sourceUrl: string) => Promise<string>) | null;
};

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'td',
  'th',
  'ul',
]);

type ConversionContext = {
  clipboardImages: File[];
  uploadImage?: ((file: File) => Promise<string>) | null;
  importRemoteImage?: ((sourceUrl: string) => Promise<string>) | null;
};

const WORD_LIST_MARKER_REGEX = /^\s*(?:[\u2022\u00b7\u25cf\u25e6\u25aa\u25a0o]|(?:\d+|[A-Za-z])[.)])\s+/;

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

function isWordLikeCharacter(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function getNodeTextBoundary(node: Node): {
  firstChar: string | null;
  lastChar: string | null;
  startsWithSpace: boolean;
  endsWithSpace: boolean;
} {
  const normalized = normalizeWhitespace(node.textContent || '');
  const trimmed = normalized.trim();
  return {
    firstChar: trimmed[0] || null,
    lastChar: trimmed ? trimmed.slice(-1) : null,
    startsWithSpace: /^\s/.test(normalized),
    endsWithSpace: /\s$/.test(normalized),
  };
}

function shouldInsertInlineSeparator(
  previousNode: Node | null,
  previousFragment: string | undefined,
  nextNode: Node,
  nextFragment: string,
): boolean {
  if (!previousNode || !previousFragment || !nextFragment) return false;
  if (/\s$/.test(previousFragment) || /^\s/.test(nextFragment)) return false;
  if (previousFragment.endsWith('\n') || nextFragment.startsWith('\n')) return false;

  const previousBoundary = getNodeTextBoundary(previousNode);
  const nextBoundary = getNodeTextBoundary(nextNode);
  if (!previousBoundary.lastChar || !nextBoundary.firstChar) return false;
  if (previousBoundary.endsWithSpace || nextBoundary.startsWithSpace) return true;

  if (previousBoundary.lastChar === ':' && isWordLikeCharacter(nextBoundary.firstChar)) {
    return true;
  }

  return isWordLikeCharacter(previousBoundary.lastChar) && isWordLikeCharacter(nextBoundary.firstChar);
}

function trimTrailingWhitespace(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function isBlockElement(node: Node): boolean {
  return node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName.toLowerCase());
}

function isSkippableNode(node: Node): boolean {
  return node instanceof Comment;
}

function isMeaningfulHtml(html: string, plainText: string): boolean {
  if (!/<[a-z][\s\S]*>/i.test(html)) return false;
  if (/<(img|table|ul|ol|li|blockquote|pre|code|h[1-6]|hr)\b/i.test(html)) return true;
  if (/<(p|div|br|strong|em|b|i|s|strike|del|a|span)\b/i.test(html)) return true;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const htmlText = normalizeWhitespace(doc.body.textContent || '').trim();
  return htmlText !== normalizeWhitespace(plainText).trim();
}

export function extractClipboardImageFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) return [];

  return Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File);
}

export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 20) return false;
  let score = 0;
  for (const line of text.split('\n')) {
    if (/^#{1,6}\s/.test(line)) score += 2;
    if (/^`{3}/.test(line)) score += 2;
    if (/^\|.+\|$/.test(line)) score += 1;
    if (/^>\s/.test(line)) score += 1;
    if (score >= 4) return true;
  }
  return false;
}

export function shouldHandleRichClipboardImport(opts: ClipboardMarkdownImportOptions): boolean {
  const html = String(opts.html || '').trim();
  const plainText = String(opts.plainText || '');
  const imageFiles = opts.imageFiles || [];

  if (html && isMeaningfulHtml(html, plainText)) {
    return true;
  }

  return imageFiles.length > 0 && Boolean(plainText.trim() || html);
}

function wrapWith(markdown: string, wrapper: string): string {
  const content = markdown.trim();
  if (!content) return '';
  return `${wrapper}${content}${wrapper}`;
}

// A code span takes its content literally: it is fenced with more backticks
// than the longest run inside, and padded when that content starts or ends with one.
function formatInlineCode(value: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padding = /^`|`$/.test(value) ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

// A pipe is escaped in a table cell, and so is each backslash right before it.
function escapeTableCell(value: string): string {
  return value
    .replace(/\\*\|/g, (run) => run.replace(/[\\|]/g, '\\$&'))
    .replace(/\n+/g, ' ');
}

function formatLinkDestination(value: string): string {
  const trimmed = String(value || '').trim();
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  return /\s/.test(normalized) ? `<${normalized}>` : normalized;
}

function formatImageMarkdown(src: string, alt: string, title: string): string {
  const titleSuffix = title ? ` "${title.replace(/[\\"]/g, '\\$&')}"` : '';
  return `![${alt}](${formatLinkDestination(src)}${titleSuffix})`;
}

function inferFileExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'bin';
  }
}

function dataUriToFile(dataUri: string, fileNamePrefix = 'pasted-image'): File | null {
  const match = dataUri.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return null;

  const mimeType = match[1];
  const payload = match[2].replace(/\s+/g, '');
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], `${fileNamePrefix}.${inferFileExtension(mimeType)}`, { type: mimeType });
}

function parseLanguageHint(element: HTMLElement): string {
  const className = [element.className, element.getAttribute('data-language') || '']
    .filter(Boolean)
    .join(' ');
  const match = className.match(/(?:lang|language)-([a-z0-9_-]+)/i);
  return match?.[1] || '';
}

function isExternalUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value) || value.startsWith('/');
}

function nodeContainsOnlyImages(node: Node): boolean {
  if (node instanceof Comment) return true;
  if (node instanceof Text) {
    return normalizeWhitespace(node.textContent || '').trim().length === 0;
  }
  if (!(node instanceof HTMLElement)) return false;

  const tag = node.tagName.toLowerCase();
  if (tag === 'img') return true;
  if (tag === 'br') return true;

  return Array.from(node.childNodes).every((child) => nodeContainsOnlyImages(child));
}

function normalizeExternalImageUrlForImport(value: string): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    return new URL(trimmed, window.location.origin).toString();
  }
  return null;
}

function stripWordListMarker(value: string): string {
  return value.replace(WORD_LIST_MARKER_REGEX, '');
}

function trimLeadingWordListMarker(container: HTMLElement): void {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const firstTextNode = walker.nextNode();
  if (!firstTextNode) return;
  const nextValue = stripWordListMarker(String(firstTextNode.textContent || ''));
  if (nextValue !== firstTextNode.textContent) {
    firstTextNode.textContent = nextValue;
  }
}

function isWordListParagraph(element: HTMLElement): boolean {
  const style = String(element.getAttribute('style') || '');
  const className = String(element.getAttribute('class') || '');
  return /mso-list:/i.test(style) || /MsoListParagraph/i.test(className);
}

function detectWordListType(element: HTMLElement): 'ol' | 'ul' {
  const text = normalizeWhitespace(element.textContent || '');
  if (/^\s*(?:\d+|[A-Za-z])[.)]\s+/.test(text)) return 'ol';
  return 'ul';
}

function normalizeWordLists(root: ParentNode): void {
  const doc = root.ownerDocument;
  if (!doc) return;

  const nextMeaningfulSibling = (node: ChildNode | null): ChildNode | null => {
    let cursor = node;
    while (cursor instanceof Text && !cursor.textContent?.trim()) {
      const next = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
    return cursor;
  };

  let current: ChildNode | null = root.firstChild;
  while (current) {
    const nextNode = current.nextSibling;
    if (!(current instanceof HTMLElement) || !isWordListParagraph(current)) {
      current = nextNode;
      continue;
    }

    const list = doc.createElement(detectWordListType(current));
    root.insertBefore(list, current);

    let cursor: ChildNode | null = current;
    while (cursor instanceof HTMLElement && isWordListParagraph(cursor) && list.tagName.toLowerCase() === detectWordListType(cursor)) {
      const nextSibling: ChildNode | null = nextMeaningfulSibling(cursor.nextSibling);
      const item = doc.createElement('li');
      const cloned = cursor.cloneNode(true) as HTMLElement;
      cloned.querySelectorAll('[style*="mso-list:Ignore"]').forEach((node) => node.remove());
      trimLeadingWordListMarker(cloned);

      while (cloned.firstChild) {
        item.appendChild(cloned.firstChild);
      }

      list.appendChild(item);
      cursor.remove();
      cursor = nextSibling;
    }

    current = cursor ?? nextNode;
  }

  Array.from(root.childNodes).forEach((child) => {
    if (child instanceof HTMLElement) {
      normalizeWordLists(child);
    }
  });
}

function sanitizeClipboardDom(body: HTMLElement): void {
  body.querySelectorAll('script, style, meta, link, title, noscript, iframe, object, embed').forEach((node) => {
    node.remove();
  });

  body.querySelectorAll('*').forEach((node) => {
    const style = String(node.getAttribute('style') || '');
    if (/\b(display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(style)) {
      node.remove();
      return;
    }
    if (node.tagName.toLowerCase() === 'o:p') {
      node.remove();
    }
  });

  normalizeWordLists(body);
}

async function uploadClipboardImage(file: File, ctx: ConversionContext): Promise<string | null> {
  if (!ctx.uploadImage) return null;
  return ctx.uploadImage(file);
}

async function resolveImageSource(element: HTMLImageElement, ctx: ConversionContext): Promise<string | null> {
  const src = String(element.getAttribute('src') || '').trim();

  if (/^data:image\//i.test(src)) {
    const file = dataUriToFile(src);
    if (!file) return null;
    return uploadClipboardImage(file, ctx);
  }

  if (isExternalUrl(src)) {
    const normalizedImportUrl = normalizeExternalImageUrlForImport(src);
    if (normalizedImportUrl && ctx.importRemoteImage) {
      return ctx.importRemoteImage(normalizedImportUrl);
    }
    return src.startsWith('//') ? `https:${src}` : src;
  }

  if (ctx.clipboardImages.length > 0) {
    const nextFile = ctx.clipboardImages.shift() || null;
    if (nextFile) {
      return uploadClipboardImage(nextFile, ctx);
    }
  }

  return null;
}

async function convertInlineNodes(nodes: Node[], ctx: ConversionContext): Promise<string> {
  const parts: string[] = [];
  let previousMeaningfulNode: Node | null = null;
  let previousMeaningfulFragment: string | undefined;

  for (const node of nodes) {
    if (isSkippableNode(node)) continue;

    let fragment = '';

    if (node instanceof Text) {
      const normalized = normalizeWhitespace(node.textContent || '');
      if (normalized) {
        fragment = normalized;
      }
    } else if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();

      if (tag === 'br') {
        fragment = '\n';
      } else if (tag === 'img') {
        const imageMarkdown = await convertImageNode(node as HTMLImageElement, ctx);
        if (imageMarkdown) {
          fragment = imageMarkdown;
        }
      } else if (BLOCK_TAGS.has(tag)) {
        const blockMarkdown = await convertBlockNode(node, ctx);
        if (blockMarkdown) {
          fragment = blockMarkdown;
        }
      } else {
        const childMarkdown = await convertInlineNodes(Array.from(node.childNodes), ctx);
        if (!childMarkdown.trim()) {
          const nodeText = normalizeWhitespace(node.textContent || '');
          if (nodeText.trim().length === 0 && nodeText.length > 0) {
            fragment = ' ';
          }
        } else {
          const inlineStyle = String(node.getAttribute('style') || '').toLowerCase();
          switch (tag) {
            case 'strong':
            case 'b':
              if (node.style.fontWeight === 'normal' || /font-weight\s*:\s*normal/.test(inlineStyle)) {
                fragment = childMarkdown;
              } else {
                fragment = wrapWith(childMarkdown, '**');
              }
              break;
            case 'em':
            case 'i':
              if (node.style.fontStyle === 'normal' || /font-style\s*:\s*normal/.test(inlineStyle)) {
                fragment = childMarkdown;
              } else {
                fragment = wrapWith(childMarkdown, '*');
              }
              break;
            case 's':
            case 'strike':
            case 'del':
              fragment = wrapWith(childMarkdown, '~~');
              break;
            case 'mark':
              fragment = childMarkdown;
              break;
            case 'code':
              fragment = formatInlineCode(childMarkdown);
              break;
            case 'a': {
              const href = String(node.getAttribute('href') || '').trim();
              if (!href || /^javascript:/i.test(href)) {
                fragment = childMarkdown;
                break;
              }
              if (Array.from(node.childNodes).every((child) => nodeContainsOnlyImages(child))) {
                fragment = childMarkdown;
                break;
              }
              fragment = `[${childMarkdown.trim() || href}](${formatLinkDestination(href)})`;
              break;
            }
            case 'span':
            case 'font': {
              let styled = childMarkdown;
              const style = String(node.getAttribute('style') || '').toLowerCase();
              const fontWeight = node.style.fontWeight || '';
              const isBold = /font-weight\s*:\s*(bold|[6-9]00)/.test(style) || /^(bold|[6-9]00)$/.test(fontWeight);
              const isItalic = /font-style\s*:\s*italic/.test(style) || node.style.fontStyle === 'italic';
              const isStruck = /text-decoration[^;]*line-through/.test(style);
              if (isBold) styled = wrapWith(styled, '**');
              if (isItalic) styled = wrapWith(styled, '*');
              if (isStruck) styled = wrapWith(styled, '~~');
              fragment = styled;
              break;
            }
            default:
              fragment = childMarkdown;
              break;
          }
        }
      }
    }

    if (!fragment) continue;

    if (shouldInsertInlineSeparator(previousMeaningfulNode, previousMeaningfulFragment, node, fragment)) {
      parts.push(' ');
    }

    parts.push(fragment);
    previousMeaningfulNode = node;
    previousMeaningfulFragment = fragment;
  }

  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
}

async function convertParagraphLikeNode(element: HTMLElement, ctx: ConversionContext): Promise<string> {
  const containsBlockChildren = Array.from(element.childNodes).some(isBlockElement);
  if (containsBlockChildren) {
    return convertBlockContainer(Array.from(element.childNodes), ctx);
  }
  return convertInlineNodes(Array.from(element.childNodes), ctx);
}

async function convertListItemNode(element: HTMLLIElement, ctx: ConversionContext, prefix: string): Promise<string> {
  const content = await convertBlockContainer(Array.from(element.childNodes), ctx);
  if (!content.trim()) {
    return prefix.trimEnd();
  }

  const lines = content.split('\n');
  return lines
    .map((line, index) => {
      if (index === 0) return `${prefix}${line}`;
      if (!line.trim()) return '';
      return `${' '.repeat(prefix.length)}${line}`;
    })
    .join('\n');
}

async function convertListNode(element: HTMLOListElement | HTMLUListElement, ctx: ConversionContext): Promise<string> {
  const ordered = element.tagName.toLowerCase() === 'ol';
  const start = Number(element.getAttribute('start') || '1');
  const items = Array.from(element.children)
    .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);

  if (items.length === 0) {
    return convertBlockContainer(Array.from(element.childNodes), ctx);
  }

  const markdownItems: string[] = [];
  for (const [index, item] of items.entries()) {
    const prefix = ordered ? `${start + index}. ` : '- ';
    markdownItems.push(await convertListItemNode(item, ctx, prefix));
  }

  return markdownItems.join('\n');
}

async function convertBlockquoteNode(element: HTMLElement, ctx: ConversionContext): Promise<string> {
  const content = await convertBlockContainer(Array.from(element.childNodes), ctx);
  if (!content.trim()) return '';

  return content
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

async function convertTableNode(element: HTMLTableElement, ctx: ConversionContext): Promise<string> {
  const rows = Array.from(element.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const matrix: string[][] = [];
  for (const row of rows) {
    const cells = Array.from(row.children).filter(
      (child): child is HTMLTableCellElement => child instanceof HTMLTableCellElement,
    );
    const values: string[] = [];
    for (const cell of cells) {
      const cellMarkdown = await convertInlineNodes(Array.from(cell.childNodes), ctx);
      values.push(escapeTableCell(cellMarkdown || ' '));
    }
    if (values.length > 0) {
      matrix.push(values);
    }
  }

  if (matrix.length === 0) return '';

  const columnCount = Math.max(...matrix.map((row) => row.length));
  const normalized = matrix.map((row) => {
    const next = [...row];
    while (next.length < columnCount) next.push(' ');
    return next;
  });

  const header = normalized[0];
  const divider = header.map(() => '---');
  const body = normalized.slice(1);

  return [
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

async function convertImageNode(element: HTMLImageElement, ctx: ConversionContext): Promise<string> {
  const src = await resolveImageSource(element, ctx);
  if (!src) return '';

  const alt = String(element.getAttribute('alt') || '').trim();
  const title = String(element.getAttribute('title') || '').trim();
  return formatImageMarkdown(src, alt, title);
}

async function convertBlockNode(element: HTMLElement, ctx: ConversionContext): Promise<string> {
  const tag = element.tagName.toLowerCase();

  if (tag === 'img') {
    return convertImageNode(element as HTMLImageElement, ctx);
  }

  if (tag === 'hr') {
    return '---';
  }

  if (tag === 'blockquote') {
    return convertBlockquoteNode(element, ctx);
  }

  if (tag === 'ul' || tag === 'ol') {
    return convertListNode(element as HTMLOListElement | HTMLUListElement, ctx);
  }

  if (tag === 'pre') {
    const codeElement = element.querySelector('code');
    const codeText = codeElement?.textContent || element.textContent || '';
    const language = parseLanguageHint(codeElement || element);
    const fence = language ? `\`\`\`${language}` : '```';
    return `${fence}\n${codeText.replace(/\n$/, '')}\n\`\`\``;
  }

  if (tag === 'table') {
    return convertTableNode(element as HTMLTableElement, ctx);
  }

  if (tag.match(/^h[1-6]$/)) {
    const level = Number(tag.slice(1));
    const content = await convertInlineNodes(Array.from(element.childNodes), ctx);
    return `${'#'.repeat(level)} ${content.trim()}`;
  }

  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' || tag === 'main' || tag === 'aside') {
    return convertParagraphLikeNode(element, ctx);
  }

  if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'tr' || tag === 'td' || tag === 'th') {
    return convertBlockContainer(Array.from(element.childNodes), ctx);
  }

  return convertParagraphLikeNode(element, ctx);
}

async function convertBlockContainer(nodes: Node[], ctx: ConversionContext): Promise<string> {
  const blocks: string[] = [];
  let inlineBuffer: Node[] = [];

  const flushInlineBuffer = async () => {
    if (inlineBuffer.length === 0) return;
    const inlineMarkdown = await convertInlineNodes(inlineBuffer, ctx);
    inlineBuffer = [];
    if (inlineMarkdown.trim()) {
      blocks.push(inlineMarkdown);
    }
  };

  for (const node of nodes) {
    if (isSkippableNode(node)) continue;

    if (node instanceof Text || !isBlockElement(node)) {
      inlineBuffer.push(node);
      continue;
    }

    await flushInlineBuffer();
    const blockMarkdown = await convertBlockNode(node as HTMLElement, ctx);
    if (blockMarkdown.trim()) {
      blocks.push(blockMarkdown.trim());
    }
  }

  await flushInlineBuffer();
  return blocks.join('\n\n');
}

export async function convertRichClipboardToMarkdown(
  opts: ClipboardMarkdownImportOptions,
): Promise<string> {
  const plainText = String(opts.plainText || '');
  const html = String(opts.html || '').trim();
  const imageFiles = [...(opts.imageFiles || [])];
  const ctx: ConversionContext = {
    clipboardImages: imageFiles,
    uploadImage: opts.uploadImage,
    importRemoteImage: opts.importRemoteImage,
  };

  if (!html) {
    if (imageFiles.length === 0) {
      return plainText;
    }

    const uploadedImages = await Promise.all(
      imageFiles.map(async (file) => uploadClipboardImage(file, ctx)),
    );
    const imageMarkdown = uploadedImages
      .filter((value): value is string => Boolean(value))
      .map((src) => formatImageMarkdown(src, '', ''));

    return trimTrailingWhitespace([plainText.trim(), ...imageMarkdown].filter(Boolean).join('\n\n'));
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeClipboardDom(doc.body);
  const markdown = await convertBlockContainer(Array.from(doc.body.childNodes), ctx);
  const trimmed = trimTrailingWhitespace(markdown);

  if (trimmed) {
    return trimmed;
  }

  return plainText;
}
