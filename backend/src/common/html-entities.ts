/**
 * Text for a character reference body such as `amp`, `#39` or `#x3c`, keyed
 * without the leading `&` and the trailing `;`.
 */
export type HtmlEntityMap = Readonly<Record<string, string>>;

export type DecodeHtmlEntitiesOptions = {
  /** References decoded by name (`amp`, `lt`) or by exact numeric spelling (`#39`). */
  entities?: HtmlEntityMap;
  /** Also decode every valid decimal or hexadecimal reference. */
  numeric?: boolean;
  /** Match reference bodies case-insensitively; `entities` keys are then lower case. */
  ignoreCase?: boolean;
};

/** References decoded when markup is turned into plain text. */
export const HTML_TEXT_ENTITIES: HtmlEntityMap = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  '#39': '\'',
  lt: '<',
  gt: '>',
};

const CHARACTER_REFERENCE = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;

function decodeNumericReference(body: string): string | null {
  const hex = body[1] === 'x' || body[1] === 'X';
  const codePoint = hex
    ? Number.parseInt(body.slice(2), 16)
    : Number.parseInt(body.slice(1), 10);
  if (
    !Number.isFinite(codePoint)
    || codePoint === 0
    || codePoint > 0x10FFFF
    || (codePoint >= 0xD800 && codePoint <= 0xDFFF)
  ) {
    return null;
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
}

/**
 * Decodes HTML character references in a single pass. Each reference of the
 * input is decoded at most once: the text a reference decodes to is never read
 * again, so `&amp;lt;` becomes `&lt;`. References that are neither listed nor
 * valid numeric ones (when `numeric` is set) stay as they are.
 */
export function decodeHtmlEntities(value: string, options: DecodeHtmlEntitiesOptions = {}): string {
  const entities = options.entities ?? {};
  return String(value ?? '').replace(CHARACTER_REFERENCE, (match, body: string) => {
    const key = options.ignoreCase ? body.toLowerCase() : body;
    if (Object.prototype.hasOwnProperty.call(entities, key)) {
      return entities[key];
    }
    if (options.numeric && body.startsWith('#')) {
      return decodeNumericReference(body) ?? match;
    }
    return match;
  });
}

export function decodeNumericHtmlEntities(value: string): string {
  return decodeHtmlEntities(value, { numeric: true }).replace(/ /g, ' ');
}
