/**
 * The only HTML elements a rich text holds. Everything else written with angle brackets is text.
 * The server applies the same list when a rich text is saved
 * (`backend/src/common/html-to-markdown.ts`): keep both in step.
 */
export const RICH_TEXT_HTML_ELEMENTS = {
  /** Accepted without any attribute: underline, subscript, superscript, line break. */
  bare: ['u', 'sub', 'sup', 'br'],
  /** `<img>` is accepted with a `src` and these attributes only. */
  imageAttributes: ['src', 'alt', 'title', 'width', 'height'],
} as const;

/** An image is served by a web address or by a path of the application. */
function isRichTextImageSource(value: string): boolean {
  const source = value.trim();
  return /^https?:\/\//i.test(source) || source.startsWith('/');
}

/** True when `<img>` may carry this attribute with this value. */
export function isRichTextImageAttribute(name: string, value: string): boolean {
  if (!(RICH_TEXT_HTML_ELEMENTS.imageAttributes as readonly string[]).includes(name)) return false;
  if (name === 'src') return isRichTextImageSource(value);
  if (name === 'width' || name === 'height') return /^\d{1,5}$/.test(value);
  return true;
}
