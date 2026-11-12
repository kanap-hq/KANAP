/**
 * The only HTML elements a rich text holds, in lower case. Everything else written with angle
 * brackets is text.
 * - `paired`: an opening and a closing tag, without any attribute (`<u>`, `</u>`);
 * - `lineBreak`: `<br>`, `<br/>` or `<br />`, without any attribute;
 * - `imageAttributes`: an `<img>` tag on one line with these attributes only, each with a quoted
 *   value, and a source that is a path of the application or an `http(s)` address; a width and a
 *   height are whole numbers.
 * The server holds the same list, `RICH_TEXT_ALLOWED_HTML` in
 * `backend/src/common/html-to-markdown.ts`, and refuses a text with any other tag. A change of one
 * list is made in the other: a spec of the server (`rich-text-html-rule.spec.ts`) reads this file
 * and compares the two lists, and the test of each side keeps a copy of the accepted and refused
 * forms. That spec reads the object below as written: keep it one plain object of names.
 */
export const RICH_TEXT_HTML_ELEMENTS = {
  paired: ['u', 'sub', 'sup'],
  lineBreak: 'br',
  imageAttributes: ['src', 'alt', 'title', 'width', 'height'],
} as const;

// Sticky expressions: each one reads the tag at a given place of a text, without copying the text.
const PAIRED_TAG_REGEX = new RegExp(`<(/?)(${RICH_TEXT_HTML_ELEMENTS.paired.join('|')})>`, 'y');
const LINE_BREAK_TAG_REGEX = new RegExp(`<${RICH_TEXT_HTML_ELEMENTS.lineBreak}(?: ?/)?>`, 'y');
// An image tag on one line whose attributes all have a quoted value.
const IMAGE_TAG_REGEX = /<img((?:[ \t]+[a-z]+=(?:"[^"\n]*"|'[^'\n]*'))+)[ \t]*\/?>/y;
const IMAGE_ATTRIBUTE_REGEX = /([a-z]+)=(?:"([^"\n]*)"|'([^'\n]*)')/g;

/** True for the name of an element accepted without any attribute. */
export function isRichTextBareElementName(name: string): boolean {
  return name === RICH_TEXT_HTML_ELEMENTS.lineBreak
    || (RICH_TEXT_HTML_ELEMENTS.paired as readonly string[]).includes(name);
}

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

function matchAt(regex: RegExp, text: string, index: number): RegExpExecArray | null {
  regex.lastIndex = index;
  return regex.exec(text);
}

/**
 * The tag at `index` of `text` when it is one of `RICH_TEXT_HTML_ELEMENTS` in its accepted form,
 * with the way the editor reads it (a line break and an image are closed tags).
 */
export function matchRichTextHtmlTag(
  text: string,
  index = 0,
): { length: number; tag: string; name: string; closing: boolean } | null {
  const paired = matchAt(PAIRED_TAG_REGEX, text, index);
  if (paired) {
    const [whole, slash, name] = paired;
    return { length: whole.length, tag: whole, name, closing: slash !== '' };
  }

  const lineBreak = matchAt(LINE_BREAK_TAG_REGEX, text, index);
  if (lineBreak) {
    return { length: lineBreak[0].length, tag: '<br />', name: RICH_TEXT_HTML_ELEMENTS.lineBreak, closing: false };
  }

  const image = matchAt(IMAGE_TAG_REGEX, text, index);
  if (!image) return null;
  let hasSource = false;
  for (const [, name, doubleQuoted, singleQuoted] of image[1].matchAll(IMAGE_ATTRIBUTE_REGEX)) {
    if (!isRichTextImageAttribute(name, doubleQuoted ?? singleQuoted ?? '')) return null;
    if (name === 'src') hasSource = true;
  }
  return hasSource ? { length: image[0].length, tag: `<img${image[1]} />`, name: 'img', closing: false } : null;
}
