/**
 * Scans of texts written by users or read from external systems (tickets, imports,
 * chat messages, monitoring data) that run on the main thread of the API.
 *
 * Each function gives exactly the result of the regular expression quoted in its
 * comment, in time proportional to the length of the text, whatever the text: a
 * mark opened many times and never closed is read once, not once per opening.
 */

/** `\s` of a regular expression. */
export function isRegExpSpace(code: number): boolean {
  return code === 0x20
    || (code >= 0x09 && code <= 0x0d)
    || code === 0xa0
    || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028
    || code === 0x2029
    || code === 0x202f
    || code === 0x205f
    || code === 0x3000
    || code === 0xfeff;
}

/** `\w` of a regular expression without the `u` flag. */
function isWordChar(code: number): boolean {
  return (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || code === 0x5f;
}

/** Characters `.` does not match. */
function isLineTerminator(code: number): boolean {
  return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

/** `\b` at `index`. */
function isWordBoundary(text: string, index: number): boolean {
  const before = index > 0 && isWordChar(text.charCodeAt(index - 1));
  const after = index < text.length && isWordChar(text.charCodeAt(index));
  return before !== after;
}

/**
 * The next index found from a position, remembered: asked again from a position
 * between the last start and the last result, it answers without reading again.
 */
class NextIndex {
  private from = -1;
  private at = -1;

  constructor(
    private readonly text: string,
    private readonly find: (text: string, from: number) => number,
  ) {}

  next(from: number): number {
    if (this.from !== -1 && from >= this.from && (this.at === -1 || from <= this.at)) return this.at;
    this.from = from;
    this.at = this.find(this.text, from);
    return this.at;
  }
}

function charFinder(text: string, char: string): NextIndex {
  return new NextIndex(text, (source, from) => source.indexOf(char, from));
}

function patternFinder(text: string, pattern: RegExp): NextIndex {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return new NextIndex(text, (source, from) => {
    global.lastIndex = from;
    const match = global.exec(source);
    return match ? match.index : -1;
  });
}

/** End of the run of characters accepted by `accept` that holds `from`, remembered like NextIndex. */
class RunEnd {
  private from = -1;
  private end = -1;

  constructor(
    private readonly text: string,
    private readonly accept: (code: number) => boolean,
  ) {}

  at(from: number): number {
    if (this.from !== -1 && from >= this.from && from < this.end) return this.end;
    let end = from;
    while (end < this.text.length && this.accept(this.text.charCodeAt(end))) end += 1;
    this.from = from;
    this.end = end;
    return end;
  }
}

type Span = { start: number; end: number };

function replaceSpans(text: string, spans: Span[], replacement: (span: Span) => string): string {
  if (spans.length === 0) return text;
  let out = '';
  let last = 0;
  for (const span of spans) {
    out += text.slice(last, span.start) + replacement(span);
    last = span.end;
  }
  return out + text.slice(last);
}

// ---------------------------------------------------------------------------
// Tags closed by a ">".

/**
 * `text.replace(pattern, replacement)` for a pattern whose every match ends with
 * `terminator` and fails at once when a terminator follows (`/<[^>]+>/g`,
 * `/<img\b[^>]*>/gi`): the text after the last terminator cannot match and is not
 * searched. The pattern must not use `$`, `^` or `$'`.
 */
export function replaceUpToLast(
  text: string,
  terminator: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: any[]) => string),
): string {
  const last = text.lastIndexOf(terminator);
  if (last === -1) return text;
  const end = last + terminator.length;
  const head = text.slice(0, end);
  const replaced = typeof replacement === 'string'
    ? head.replace(pattern, replacement)
    : head.replace(pattern, replacement);
  return replaced + text.slice(end);
}

/** `pattern.test(text)` for a pattern as in `replaceUpToLast`. */
export function testUpToLast(text: string, terminator: string, pattern: RegExp): boolean {
  const last = text.lastIndexOf(terminator);
  if (last === -1) return false;
  if (pattern.global || pattern.sticky) pattern.lastIndex = 0;
  return pattern.test(text.slice(0, last + terminator.length));
}

/** Stands for a pattern in `text.replace(...)`, so a chain of replacements keeps its shape. */
export type TextReplacer = {
  [Symbol.replace](text: string, replacement: string | ((substring: string, ...args: any[]) => string)): string;
};

/** `pattern` in `text.replace(...)`, searched only up to the last `terminator` (see replaceUpToLast). */
export function untilLast(terminator: string, pattern: RegExp): TextReplacer {
  return { [Symbol.replace]: (text, replacement) => replaceUpToLast(String(text), terminator, pattern, replacement) };
}

/** `/<[^>]+>/g` in `text.replace(...)`. */
export const HTML_TAGS = untilLast('>', /<[^>]+>/g);

/** `/[ \t]+\n/g` in `text.replace(...)`, with a replacement without `$` patterns. */
export const SPACES_BEFORE_LINE_BREAKS: TextReplacer = {
  [Symbol.replace]: (text, replacement) => {
    if (typeof replacement !== 'string' || replacement.includes('$')) {
      throw new Error('SPACES_BEFORE_LINE_BREAKS takes a plain replacement text.');
    }
    return removeSpacesBeforeLineBreaks(String(text), replacement);
  },
};

/** `text.replace(/<[^>]+>/g, replacement)`. */
export function replaceHtmlTags(text: string, replacement: string): string {
  return replaceUpToLast(text, '>', /<[^>]+>/g, replacement);
}

/** `/<[^>]+>/.test(text)`. */
export function hasHtmlTag(text: string): boolean {
  return testUpToLast(text, '>', /<[^>]+>/);
}

// ---------------------------------------------------------------------------
// `<img>` tags.

type ImgSource = { start: number; end: number; valueStart: number; valueEnd: number };

/**
 * Matches of `/<img\b[^>]*\bsrc<attribute>[^>]*>/gi` where `readAttribute(s)`
 * reads the attribute from the `src` at `s` and returns its quoted value (the
 * closing quote at `valueEnd`), or null. Of the `src` before the first ">" of a
 * tag, the last one that reads and is followed by a ">" is the one matched.
 */
function scanImgSources(
  html: string,
  readAttribute: (s: number) => { valueStart: number; valueEnd: number } | null,
): ImgSource[] {
  const matches: ImgSource[] = [];
  const tag = /<img\b/gi;
  const nextClose = charFinder(html, '>');
  const nextCloseAfterValue = charFinder(html, '>');
  const nextSrc = patternFinder(html, /src/i);
  let from = 0;
  while (from < html.length) {
    tag.lastIndex = from;
    const open = tag.exec(html);
    if (!open) break;
    const p = open.index;
    const firstClose = nextClose.next(p + 4);
    if (firstClose === -1) break;
    let best: ImgSource | null = null;
    for (let s = nextSrc.next(p + 4); s !== -1 && s < firstClose; s = nextSrc.next(s + 1)) {
      if (!isWordBoundary(html, s)) continue;
      const value = readAttribute(s);
      if (!value) continue;
      const close = value.valueEnd < firstClose ? firstClose : nextCloseAfterValue.next(value.valueEnd + 1);
      if (close === -1) continue;
      best = { start: p, end: close + 1, valueStart: value.valueStart, valueEnd: value.valueEnd };
    }
    if (best) {
      matches.push(best);
      from = best.end;
    } else {
      // Every other `<img` before this ">" sees the same `src` attributes or fewer.
      from = firstClose + 1;
    }
  }
  return matches;
}

/**
 * The `src` values of `<img>` tags, as matched by
 * `/<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi` (group 2), in text order.
 */
export function findImgSourceValues(html: string): string[] {
  const quoteEnd: Record<string, NextIndex> = { '"': charFinder(html, '"'), '\'': charFinder(html, '\'') };
  const lineEnd = patternFinder(html, /[\n\r\u2028\u2029]/);
  const attribute = /src\s*=\s*(['"])/iy;
  return scanImgSources(html, (s) => {
    attribute.lastIndex = s;
    const match = attribute.exec(html);
    if (!match) return null;
    const valueStart = attribute.lastIndex;
    const valueEnd = quoteEnd[match[1]].next(valueStart);
    if (valueEnd === -1) return null;
    const lineBreak = lineEnd.next(valueStart);
    if (lineBreak !== -1 && lineBreak < valueEnd) return null;
    return { valueStart, valueEnd };
  }).map((match) => html.slice(match.valueStart, match.valueEnd));
}

/**
 * `text.replace(/<img\b[^>]*\bsrc=(['"])data:image\/[^;]*;base64,[^'"]*\1[^>]*>/gi, replacement)`.
 */
export function replaceDataImageTags(html: string, replacement: string): string {
  const nextSemicolon = charFinder(html, ';');
  const nextQuote = patternFinder(html, /["']/);
  const attribute = /src=(['"])data:image\//iy;
  const base64 = /;base64,/iy;
  const matches = scanImgSources(html, (s) => {
    attribute.lastIndex = s;
    const match = attribute.exec(html);
    if (!match) return null;
    const valueStart = s + 5;
    const semicolon = nextSemicolon.next(attribute.lastIndex);
    if (semicolon === -1) return null;
    base64.lastIndex = semicolon;
    if (!base64.test(html)) return null;
    const valueEnd = nextQuote.next(semicolon + 8);
    if (valueEnd === -1 || html[valueEnd] !== match[1]) return null;
    return { valueStart, valueEnd };
  });
  return replaceSpans(html, matches, () => replacement);
}

// ---------------------------------------------------------------------------
// Markdown links and images.

/**
 * `text.replace(/!\[([^\]]*)\]\([^)]+\)/g, ...)` (`image: true`) or
 * `text.replace(/\[([^\]]+)\]\([^)]+\)/g, ...)` (`image: false`); `replacement`
 * receives the text between the brackets.
 */
export function replaceMarkdownLinks(text: string, image: boolean, replacement: (label: string) => string): string {
  const open = image ? '![' : '[';
  const labelStart = open.length;
  const minLabel = image ? 0 : 1;
  const nextBracket = charFinder(text, ']');
  const nextParen = charFinder(text, ')');
  const spans: Array<Span & { label: string }> = [];
  let from = 0;
  for (;;) {
    const p = text.indexOf(open, from);
    if (p === -1) break;
    const b = nextBracket.next(p + labelStart);
    if (b === -1) break;
    if (b - (p + labelStart) < minLabel) {
      from = p + 1;
      continue;
    }
    if (text.charCodeAt(b + 1) !== 0x28) {
      // Every opening before this "]" ends its label here too.
      from = b + 1;
      continue;
    }
    const c = nextParen.next(b + 2);
    if (c === -1) break;
    if (c === b + 2) {
      from = b + 1;
      continue;
    }
    spans.push({ start: p, end: c + 1, label: text.slice(p + labelStart, b) });
    from = c + 1;
  }
  return replaceSpans(text, spans, (span) => replacement((span as Span & { label: string }).label));
}

/**
 * Matches of `/\[([^\]]{1,160})\]\((\/[^)\s]+)\)/g`: the label (group 1) and the
 * path (group 2) of each Markdown link to a path of the application.
 */
export function findMarkdownPathLinks(text: string): Array<{ label: string; path: string }> {
  const nextBracket = charFinder(text, ']');
  const pathEnd = new RunEnd(text, (code) => code !== 0x29 && !isRegExpSpace(code));
  const links: Array<{ label: string; path: string }> = [];
  let from = 0;
  for (;;) {
    const p = text.indexOf('[', from);
    if (p === -1) break;
    const b = nextBracket.next(p + 1);
    if (b === -1) break;
    const labelLength = b - p - 1;
    if (labelLength < 1 || labelLength > 160) {
      from = p + 1;
      continue;
    }
    if (text.charCodeAt(b + 1) !== 0x28 || text.charCodeAt(b + 2) !== 0x2f) {
      from = b + 1;
      continue;
    }
    const end = pathEnd.at(b + 3);
    if (end === b + 3 || text.charCodeAt(end) !== 0x29) {
      from = b + 1;
      continue;
    }
    links.push({ label: text.slice(p + 1, b), path: text.slice(b + 2, end) });
    from = end + 1;
  }
  return links;
}

/**
 * `text.replace(/!\[(?:\\.|[^\]\\])*\]\(data:image\/[^;]*;base64,[^)]+\)/gi, replacement)`.
 */
export function replaceMarkdownDataImages(text: string, replacement: string): string {
  const nextSemicolon = charFinder(text, ';');
  const nextParen = charFinder(text, ')');
  const source = /\(data:image\//iy;
  const base64 = /;base64,/iy;
  const spans: Span[] = [];
  let from = 0;
  for (;;) {
    const p = text.indexOf('![', from);
    if (p === -1) break;
    // The label: escaped characters, or any character but "]" and "\".
    let i = p + 2;
    let b = -1;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code === 0x5d) {
        b = i;
        break;
      }
      if (code === 0x5c) {
        if (i + 1 < text.length && !isLineTerminator(text.charCodeAt(i + 1))) {
          i += 2;
          continue;
        }
        break;
      }
      i += 1;
    }
    if (b === -1) {
      if (i >= text.length) break;
      from = i + 1;
      continue;
    }
    source.lastIndex = b + 1;
    if (!source.test(text)) {
      from = b + 1;
      continue;
    }
    const semicolon = nextSemicolon.next(source.lastIndex);
    if (semicolon === -1) break;
    base64.lastIndex = semicolon;
    if (!base64.test(text)) {
      from = b + 1;
      continue;
    }
    const c = nextParen.next(semicolon + 8);
    if (c === -1) break;
    if (c === semicolon + 8) {
      from = b + 1;
      continue;
    }
    spans.push({ start: p, end: c + 1 });
    from = c + 1;
  }
  return replaceSpans(text, spans, () => replacement);
}

// ---------------------------------------------------------------------------
// Lines.

/** `text.replace(/[ \t]+\n/g, replacement)` for a replacement without `$` patterns. */
export function removeSpacesBeforeLineBreaks(text: string, replacement = '\n'): string {
  let out = '';
  let last = 0;
  let changed = false;
  let index = text.indexOf('\n');
  while (index !== -1) {
    let start = index;
    while (start > last) {
      const code = text.charCodeAt(start - 1);
      if (code !== 0x20 && code !== 0x09) break;
      start -= 1;
    }
    if (start < index) {
      out += text.slice(last, start) + replacement;
      last = index + 1;
      changed = true;
    }
    index = text.indexOf('\n', index + 1);
  }
  return changed ? out + text.slice(last) : text;
}

/** `text.replace(/^\s*[-*_]{3,}\s*$/gm, '')`: lines that hold only a thematic break. */
export function removeThematicBreakLines(text: string): string {
  const n = text.length;
  const spaceEnd = new RunEnd(text, isRegExpSpace);
  const markEnd = new RunEnd(text, (code) => code === 0x2d || code === 0x2a || code === 0x5f);
  const nextLineTerminator = patternFinder(text, /[\n\r\u2028\u2029]/);
  const spans: Span[] = [];
  let lineStart = 0;
  while (lineStart <= n) {
    const k = spaceEnd.at(lineStart);
    const marks = markEnd.at(k);
    let end = -1;
    if (marks - k >= 3) {
      // `\s*$`: the last end of line or end of text within the spaces after the marks.
      const after = spaceEnd.at(marks);
      for (let position = after; position >= marks; position -= 1) {
        if (position === n || isLineTerminator(text.charCodeAt(position))) {
          end = position;
          break;
        }
      }
    }
    if (end !== -1) {
      spans.push({ start: lineStart, end });
      lineStart = end > 0 && isLineTerminator(text.charCodeAt(end - 1)) ? end : nextLineStart(end);
    } else {
      // Every line start within the same spaces fails the same way.
      lineStart = nextLineStart(k);
    }
    if (lineStart === -1) break;
  }
  return replaceSpans(text, spans, () => '');

  function nextLineStart(from: number): number {
    const terminator = nextLineTerminator.next(from);
    return terminator === -1 ? -1 : terminator + 1;
  }
}

// ---------------------------------------------------------------------------
// Words and addresses.

/**
 * `/\b(first)\b.*\b(second)\b/.test(text)` for alternations of plain words: a word
 * of `first`, then a word of `second` further on the same line. `first` and
 * `second` are `\b(?:...)\b` patterns where no word of a list holds another one.
 */
export function wordsInOrder(first: RegExp, second: RegExp): { test(text: string): boolean } {
  const firstGlobal = new RegExp(first.source, `${first.flags.replace('g', '')}g`);
  const secondGlobal = new RegExp(second.source, `${second.flags.replace('g', '')}g`);
  return {
    test(text: string): boolean {
      for (const line of String(text).split(/[\n\r\u2028\u2029]/)) {
        firstGlobal.lastIndex = 0;
        const match = firstGlobal.exec(line);
        if (!match) continue;
        secondGlobal.lastIndex = match.index + match[0].length;
        if (secondGlobal.exec(line)) return true;
      }
      return false;
    },
  };
}

function isEmailLocalChar(code: number): boolean {
  return isAsciiAlphanumeric(code) || code === 0x2e || code === 0x5f || code === 0x25 || code === 0x2b || code === 0x2d;
}

function isEmailDomainChar(code: number): boolean {
  return isAsciiAlphanumeric(code) || code === 0x2e || code === 0x2d;
}

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || isAsciiLetter(code);
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** Matches of `/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi`. */
export function findEmailAddresses(text: string): Span[] {
  const spans: Span[] = [];
  let lastIndex = 0;
  let at = text.indexOf('@');
  while (at !== -1) {
    // Domain: the last "." of the run after "@" followed by 2 letters or more and a word boundary.
    let runEnd = at + 1;
    while (runEnd < text.length && isEmailDomainChar(text.charCodeAt(runEnd))) runEnd += 1;
    let end = -1;
    let letters = 0;
    for (let position = runEnd - 1; position > at + 1; position -= 1) {
      const code = text.charCodeAt(position);
      if (isAsciiLetter(code)) {
        letters += 1;
        continue;
      }
      if (code === 0x2e && letters >= 2 && isWordBoundary(text, position + 1 + letters)) {
        end = position + 1 + letters;
        break;
      }
      letters = 0;
    }
    if (end !== -1) {
      // Local part: the run before "@", from its first word boundary at or after the last match.
      let runStart = at;
      while (runStart > lastIndex && isEmailLocalChar(text.charCodeAt(runStart - 1))) runStart -= 1;
      for (let start = runStart; start < at; start += 1) {
        if (isWordBoundary(text, start)) {
          spans.push({ start, end });
          lastIndex = end;
          break;
        }
      }
    }
    at = text.indexOf('@', Math.max(at + 1, lastIndex));
  }
  return spans;
}

/** `text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement)`. */
export function replaceEmailAddresses(text: string, replacement: string): string {
  return replaceSpans(text, findEmailAddresses(text), () => replacement);
}

/** `/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi` in `text.replace(...)`, with a replacement without `$` patterns. */
export const EMAIL_ADDRESSES: TextReplacer = {
  [Symbol.replace]: (text, replacement) => {
    if (typeof replacement !== 'string' || replacement.includes('$')) {
      throw new Error('EMAIL_ADDRESSES takes a plain replacement text.');
    }
    return replaceEmailAddresses(String(text), replacement);
  },
};

function addressTokenSpans(text: string): Span[] {
  const spans: Span[] = [];
  const excluded = (code: number) => isRegExpSpace(code)
    || code === 0x3c || code === 0x3e || code === 0x2c || code === 0x3b || code === 0x22 || code === 0x27;
  let index = 0;
  while (index < text.length) {
    if (excluded(text.charCodeAt(index))) {
      index += 1;
      continue;
    }
    // A run of address characters matches whole when it holds an "@" with characters on both sides.
    let end = index;
    let hasInnerAt = false;
    while (end < text.length && !excluded(text.charCodeAt(end))) {
      if (!hasInnerAt && end > index && text.charCodeAt(end) === 0x40) {
        hasInnerAt = end + 1 < text.length && !excluded(text.charCodeAt(end + 1));
      }
      end += 1;
    }
    if (hasInnerAt) spans.push({ start: index, end });
    index = end;
  }
  return spans;
}

/** `text.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []`. */
export function findAddressTokens(text: string): string[] {
  return addressTokenSpans(text).map((span) => text.slice(span.start, span.end));
}

/** `text.replace(/[^\s<>,;"']+@[^\s<>,;"']+/g, replacement)` for a replacement without `$` patterns. */
export function replaceAddressTokens(text: string, replacement: string): string {
  return replaceSpans(text, addressTokenSpans(text), () => replacement);
}

// ---------------------------------------------------------------------------
// DOCX.

/** `xml.replace(/<(?:[a-zA-Z0-9]+:)?svgBlip\b[\s\S]*?\/>/g, '')`. */
export function removeSvgBlipElements(xml: string): string {
  const spans: Span[] = [];
  let lastIndex = 0;
  let searchFrom = 0;
  for (;;) {
    const name = xml.indexOf('svgBlip', searchFrom);
    if (name === -1) break;
    searchFrom = name + 1;
    if (isWordChar(xml.charCodeAt(name + 7)) && name + 7 < xml.length) continue;
    let start = -1;
    const before = xml.charCodeAt(name - 1);
    if (before === 0x3c) {
      start = name - 1;
    } else if (before === 0x3a) {
      let i = name - 2;
      while (i >= lastIndex && isAsciiAlphanumeric(xml.charCodeAt(i))) i -= 1;
      if (i < name - 2 && i >= lastIndex && xml.charCodeAt(i) === 0x3c) start = i;
    }
    if (start === -1 || start < lastIndex) continue;
    const close = xml.indexOf('/>', name + 7);
    if (close === -1) break;
    spans.push({ start, end: close + 2 });
    lastIndex = searchFrom = close + 2;
  }
  return replaceSpans(xml, spans, () => '');
}

// ---------------------------------------------------------------------------
// Markdown image targets.

function isImageTargetChar(code: number): boolean {
  return code !== 0x29 && code !== 0x3e && !isRegExpSpace(code);
}

/**
 * The targets of Markdown images, as group 1 of
 * `/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g`, in text order.
 */
export function findMarkdownImageTargets(text: string): string[] {
  const n = text.length;
  const nextBracket = charFinder(text, ']');
  const nextQuote = patternFinder(text, /["']/);
  const targetEnd = new RunEnd(text, isImageTargetChar);
  const spaceEnd = (from: number) => {
    let index = from;
    while (index < n && isRegExpSpace(text.charCodeAt(index))) index += 1;
    return index;
  };
  // What follows a target: an optional ">", an optional quoted title, then ")".
  // It depends only on where the target ends, which several openings can share.
  let tailOf = -1;
  let tailEnd = -1;
  const matchTail = (targetEndIndex: number): number => {
    let j = targetEndIndex;
    if (text.charCodeAt(j) === 0x3e) j += 1;
    const k = spaceEnd(j);
    const quote = text.charCodeAt(k);
    if (k > j && (quote === 0x22 || quote === 0x27)) {
      const closing = nextQuote.next(k + 1);
      if (closing !== -1) {
        const m = spaceEnd(closing + 1);
        if (text.charCodeAt(m) === 0x29) return m + 1;
      }
    }
    return text.charCodeAt(k) === 0x29 ? k + 1 : -1;
  };
  const targets: string[] = [];
  let from = 0;
  for (;;) {
    const p = text.indexOf('![', from);
    if (p === -1) break;
    const b = nextBracket.next(p + 2);
    if (b === -1) break;
    // Every opening before this "]" ends its text here too, so they all match or fail alike.
    if (text.charCodeAt(b + 1) !== 0x28) {
      from = b + 1;
      continue;
    }
    const i = spaceEnd(b + 2);
    let start = i;
    if (text.charCodeAt(i) === 0x3c && i + 1 < n && isImageTargetChar(text.charCodeAt(i + 1))) {
      start = i + 1;
    } else if (i >= n || !isImageTargetChar(text.charCodeAt(i))) {
      from = b + 1;
      continue;
    }
    const end = targetEnd.at(start);
    if (tailOf !== end) {
      tailOf = end;
      tailEnd = matchTail(end);
    }
    if (tailEnd === -1) {
      from = b + 1;
      continue;
    }
    targets.push(text.slice(start, end));
    from = tailEnd;
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Ends of texts.

/**
 * `/[...]+$/g` in `text.replace(..., '')` for a class of characters: the run of
 * those characters that ends the text, removed. `withSpaces` adds `\s` to the class.
 */
export function trailingRun(chars: string, withSpaces: boolean): TextReplacer {
  return {
    [Symbol.replace]: (text, replacement) => {
      if (replacement !== '') throw new Error('trailingRun removes the run: its replacement is empty.');
      const value = String(text);
      let end = value.length;
      while (end > 0) {
        const code = value.charCodeAt(end - 1);
        if (!(withSpaces && isRegExpSpace(code)) && !chars.includes(value[end - 1])) break;
        end -= 1;
      }
      return value.slice(0, end);
    },
  };
}

/** Group 1 of `/(?:^[A-Z]+-)?(\d+)$/i`: the digits that end the text, or null. */
export function trailingDigits(text: string): string | null {
  let start = text.length;
  while (start > 0) {
    const code = text.charCodeAt(start - 1);
    if (code < 0x30 || code > 0x39) break;
    start -= 1;
  }
  return start < text.length ? text.slice(start) : null;
}
