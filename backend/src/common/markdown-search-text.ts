/**
 * Plain text for the search index, from Markdown.
 *
 * Each step scans the text once (linear time whatever the input): code fences,
 * inline code, images, links and tags are matched with indexOf scans that stop
 * as soon as no closing delimiter is left, instead of regular expressions whose
 * failed matches would rescan the rest of the text from every opening delimiter.
 * The output is the one of the former regular expressions:
 *   /```[^\n`]*\n?([\s\S]*?)```/g, /`([^`]*)`/g, /!\[([^\]]*)\]\([^)]*\)/g,
 *   /\[([^\]]*)\]\([^)]*\)/g and /<\/?[^>]+>/g.
 */
export function markdownToSearchText(value: string | null | undefined): string {
  const text = String(value || '');

  let result = replaceCodeFences(text);
  result = replaceInlineCode(result);
  result = replaceLinks(result, true);
  result = replaceLinks(result, false);
  result = replaceTags(result);
  return result
    .replace(/[*_~]+/g, '')
    .replace(/[>#|]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FENCE = '```';

/** ```info\n code ``` becomes " code ". */
function replaceCodeFences(text: string): string {
  let out = '';
  let copied = 0;
  let open = text.indexOf(FENCE);
  while (open !== -1) {
    let contentStart = open + FENCE.length;
    while (contentStart < text.length && text[contentStart] !== '\n' && text[contentStart] !== '`') contentStart += 1;
    if (text[contentStart] === '\n') contentStart += 1;
    const close = text.indexOf(FENCE, contentStart);
    // No closing fence after this one: none after any later opening fence either.
    if (close === -1) break;
    out += `${text.slice(copied, open)} ${text.slice(contentStart, close)} `;
    copied = close + FENCE.length;
    open = text.indexOf(FENCE, copied);
  }
  return copied === 0 ? text : out + text.slice(copied);
}

/** `code` becomes " code ". */
function replaceInlineCode(text: string): string {
  let out = '';
  let copied = 0;
  let open = text.indexOf('`');
  while (open !== -1) {
    const close = text.indexOf('`', open + 1);
    if (close === -1) break;
    out += `${text.slice(copied, open)} ${text.slice(open + 1, close)} `;
    copied = close + 1;
    open = text.indexOf('`', copied);
  }
  return copied === 0 ? text : out + text.slice(copied);
}

/**
 * [label](target) becomes " label "; with `image`, ![alt](target) becomes " alt ".
 * The label ends at the first "]" and the target at the first ")", so each
 * opening bracket has a single possible match. The next "]" and ")" positions
 * are kept between candidates, so the scan stays linear.
 */
function replaceLinks(text: string, image: boolean): string {
  const opener = image ? '![' : '[';
  let out = '';
  let copied = 0;
  let nextBracket = -1;
  let nextParen = -1;
  let open = text.indexOf(opener);
  while (open !== -1) {
    const labelStart = open + opener.length;
    if (nextBracket < labelStart) nextBracket = text.indexOf(']', labelStart);
    if (nextBracket === -1) break;
    if (text[nextBracket + 1] !== '(') {
      open = text.indexOf(opener, open + 1);
      continue;
    }
    const targetStart = nextBracket + 2;
    if (nextParen < targetStart) nextParen = text.indexOf(')', targetStart);
    if (nextParen === -1) break;
    out += `${text.slice(copied, open)} ${text.slice(labelStart, nextBracket)} `;
    copied = nextParen + 1;
    open = text.indexOf(opener, copied);
  }
  return copied === 0 ? text : out + text.slice(copied);
}

/** <tag ...> and </tag> become a space; "<>" is kept. */
function replaceTags(text: string): string {
  let out = '';
  let copied = 0;
  let open = text.indexOf('<');
  while (open !== -1) {
    const close = text.indexOf('>', open + 1);
    if (close === -1) break;
    if (close === open + 1) {
      open = text.indexOf('<', open + 1);
      continue;
    }
    out += `${text.slice(copied, open)} `;
    copied = close + 1;
    open = text.indexOf('<', copied);
  }
  return copied === 0 ? text : out + text.slice(copied);
}
