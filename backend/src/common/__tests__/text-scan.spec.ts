import * as assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  EMAIL_ADDRESSES,
  findAddressTokens,
  replaceAddressTokens,
  findEmailAddresses,
  findImgSourceValues,
  findMarkdownImageTargets,
  findMarkdownPathLinks,
  hasHtmlTag,
  isRegExpSpace,
  removeSpacesBeforeLineBreaks,
  removeSvgBlipElements,
  removeThematicBreakLines,
  replaceDataImageTags,
  replaceEmailAddresses,
  replaceHtmlTags,
  replaceMarkdownDataImages,
  replaceMarkdownLinks,
  SPACES_BEFORE_LINE_BREAKS,
  trailingDigits,
  trailingRun,
  HTML_TAGS,
  untilLast,
  wordsInOrder,
} from '../text-scan';

// The scans give the result of the regular expression they stand for on any text,
// and read a text of 200 KB in well under 50 ms whatever it holds.

const KB = 1024;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomTexts(pieces: string[], count: number, seed: number): string[] {
  const random = seeded(seed);
  const texts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const length = Math.floor(random() * 24);
    let text = '';
    for (let j = 0; j < length; j += 1) text += pieces[Math.floor(random() * pieces.length)];
    texts.push(text);
  }
  return texts;
}

function sameAsPattern<T>(name: string, pieces: string[], expected: (text: string) => T, actual: (text: string) => T): void {
  for (const text of randomTexts(pieces, 20000, name.length * 7919)) {
    assert.deepEqual(actual(text), expected(text), `${name}: ${JSON.stringify(text)}`);
  }
}

function fill(unit: string, size = 200 * KB): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

/** Best of three runs, in milliseconds. */
function timeOf(work: () => unknown): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    work();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function assertFast(name: string, units: string[], work: (text: string) => unknown): void {
  for (const unit of units) {
    const text = fill(unit);
    const ms = timeOf(() => work(text));
    assert.ok(ms < 50, `${name} on ${JSON.stringify(unit)} x 200 KB took ${ms.toFixed(1)} ms`);
  }
}

function run() {
  for (let code = 0; code <= 0xffff; code += 1) {
    assert.equal(isRegExpSpace(code), /\s/.test(String.fromCharCode(code)), `\\s for ${code}`);
  }

  // Tags closed by ">".
  const tagPieces = ['<', '>', 'a', ' ', '<>', '<b>', '\n'];
  sameAsPattern('replaceHtmlTags', tagPieces, (t) => t.replace(/<[^>]+>/g, ' '), (t) => replaceHtmlTags(t, ' '));
  sameAsPattern('hasHtmlTag', tagPieces, (t) => /<[^>]+>/.test(t), hasHtmlTag);
  assertFast('replaceHtmlTags', ['<', '<a', '<>', '< '], (t) => replaceHtmlTags(t, ' '));
  assertFast('hasHtmlTag', ['<', '<a'], hasHtmlTag);

  // <img> tags.
  const imgPieces = ['<img', '<IMG', '<imgx', ' src', 'src', ' SRC', '=', ' = ', '"', '\'', 'a', '>', '\n', ' ', '-', '&amp;'];
  const imgSources = (t: string) => Array.from(t.matchAll(/<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi), (m) => m[2]);
  sameAsPattern('findImgSourceValues', imgPieces, imgSources, findImgSourceValues);
  assert.deepEqual(findImgSourceValues('<img alt="x" src="/a.png" data-src="/b.png"><img src=\'/c.png\'>'), ['/b.png', '/c.png']);
  assertFast('findImgSourceValues', ['<img src="a" ', '<img src="a', '<img a', '<img ', '<img src=\'a" '], findImgSourceValues);

  const dataPieces = ['<img', ' src=', '"', '\'', 'data:image/', 'DATA:IMAGE/', 'png', ';', ';base64,', 'QQ', '>', ' ', 'x'];
  const dataTagPattern = /<img\b[^>]*\bsrc=(['"])data:image\/[^;]*;base64,[^'"]*\1[^>]*>/gi;
  sameAsPattern('replaceDataImageTags', dataPieces, (t) => t.replace(dataTagPattern, '[x]'), (t) => replaceDataImageTags(t, '[x]'));
  assertFast('replaceDataImageTags', ['<img src="data:image/a;base64,a" ', '<img src="data:image/', '<img src=\'data:image/a;base64,\' ', '<img '], (t) => replaceDataImageTags(t, '[x]'));

  // Markdown links and images.
  const linkPieces = ['!', '[', ']', '(', ')', 'a', ' ', '![', '](', '\n', '/'];
  sameAsPattern(
    'replaceMarkdownLinks image',
    linkPieces,
    (t) => t.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_m, alt) => `{${alt}}`),
    (t) => replaceMarkdownLinks(t, true, (alt) => `{${alt}}`),
  );
  sameAsPattern(
    'replaceMarkdownLinks link',
    linkPieces,
    (t) => t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
    (t) => replaceMarkdownLinks(t, false, (label) => label),
  );
  assertFast('replaceMarkdownLinks', ['![', '[', '[a](', '![a](', '[a]', '](a'], (t) => [
    replaceMarkdownLinks(t, true, (alt) => alt),
    replaceMarkdownLinks(t, false, (label) => label),
  ]);
  sameAsPattern(
    'findMarkdownPathLinks',
    [...linkPieces, '/x', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    (t) => Array.from(t.matchAll(/\[([^\]]{1,160})\]\((\/[^)\s]+)\)/g), (m) => ({ label: m[1], path: m[2] })),
    findMarkdownPathLinks,
  );
  assertFast('findMarkdownPathLinks', ['[', '[a](/', '[a](/a', '](/'], findMarkdownPathLinks);

  const imageTargetPieces = ['![', '!', '[', ']', '(', ')', '<', '>', ' ', '\n', '"', '\'', 'a', '/inline', '](', '\u00a0'];
  const imageTargetPattern = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  sameAsPattern('findMarkdownImageTargets', imageTargetPieces, (t) => Array.from(t.matchAll(imageTargetPattern), (m) => m[1]), findMarkdownImageTargets);
  assertFast('findMarkdownImageTargets', ['![', '![a](', '![a](a ', '![a](<', '![a](a "', '![a]( ', '](a'], findMarkdownImageTargets);

  const dataImagePieces = ['![', '!', '[', ']', '\\', '\\]', '\\\n', '(data:image/', '(DATA:image/', 'png', ';', ';base64,', 'QQ', ')', ' ', '\n'];
  const markdownDataPattern = /!\[(?:\\.|[^\]\\])*\]\(data:image\/[^;]*;base64,[^)]+\)/gi;
  sameAsPattern('replaceMarkdownDataImages', dataImagePieces, (t) => t.replace(markdownDataPattern, '[x]'), (t) => replaceMarkdownDataImages(t, '[x]'));
  assertFast('replaceMarkdownDataImages', ['![', '![a](data:image/', '![a](data:image/a;base64,', '![\\', '!['], (t) => replaceMarkdownDataImages(t, '[x]'));

  // Replacer objects keep the result of the pattern they stand for.
  sameAsPattern('HTML_TAGS', tagPieces, (t) => t.replace(/<[^>]+>/g, '[$&]'), (t) => t.replace(HTML_TAGS, '[$&]'));
  sameAsPattern('untilLast li', ['<li', '<LI', '<lix', ' ', '>', 'a', '<'], (t) => t.replace(/<li\b[^>]*>/gi, '- '), (t) => t.replace(untilLast('>', /<li\b[^>]*>/gi), '- '));
  sameAsPattern('SPACES_BEFORE_LINE_BREAKS', [' ', '\t', '\n', 'a', '\r'], (t) => t.replace(/[ \t]+\n/g, '\n'), (t) => t.replace(SPACES_BEFORE_LINE_BREAKS, '\n'));
  assertFast('untilLast li', ['<li', '<li a'], (t) => t.replace(untilLast('>', /<li\b[^>]*>/gi), '- '));

  // Lines.
  const linePieces = [' ', '\t', '\n', 'a', '\r', '-', '---', '*', '_', '\u2028', '  \n'];
  sameAsPattern('removeSpacesBeforeLineBreaks', linePieces, (t) => t.replace(/[ \t]+\n/g, '\n'), removeSpacesBeforeLineBreaks);
  sameAsPattern('removeThematicBreakLines', linePieces, (t) => t.replace(/^\s*[-*_]{3,}\s*$/gm, ''), removeThematicBreakLines);
  assertFast('removeSpacesBeforeLineBreaks', [' ', ' \t', ' a', '\n'], removeSpacesBeforeLineBreaks);
  assertFast('removeThematicBreakLines', ['\n', ' ', '\n ', '---', '--- a\n', ' \n---'], removeThematicBreakLines);

  // Words and addresses.
  const ordered = wordsInOrder(/\b(?:latest|current|in progress)\b/, /\b(?:version|release|en cours)\b/);
  const orderedPattern = /\b(latest|current|in progress)\b.*\b(version|release|en cours)\b/;
  sameAsPattern(
    'wordsInOrder',
    ['latest', 'current', 'in progress', 'version', 'release', 'en cours', ' ', 'x', '\n', 'latestx', '_', 'in', 'cours'],
    (t) => orderedPattern.test(t),
    (t) => ordered.test(t),
  );
  assertFast('wordsInOrder', ['latest ', 'version latest ', 'x', 'latest\n'], (t) => ordered.test(t));

  // The word pairs of the chat intent rules.
  const pairs: Array<[RegExp, string, string]> = [
    [/\b(latest|current|derniere)\b.*\b(version|release)\b/, 'latest|current|derniere', 'version|release'],
    [/\b(ne veux|ne veut|don't want|do not want|dont want)\b.*\b(tache|taches|task|tasks|cible|cibles|target|targets)\b/, 'ne veux|ne veut|don\'t want|do not want|dont want', 'tache|taches|task|tasks|cible|cibles|target|targets'],
    [/\b(?:seulement|uniquement|only|que|qu['\u2019][a-z]+)\b.*\b(actif|active|actives|ouvert|ouverte|open|pending|in progress|en cours)\b/, 'seulement|uniquement|only|que|qu[\'\u2019][a-z]+', 'actif|active|actives|ouvert|ouverte|open|pending|in progress|en cours'],
    [/\b(quel|quelle|quels|quelles|what|which)\b.*\b(contenu|content|valeur|value|statut|status|commentaire|comment|texte|text|champ|field)\b/, 'quel|quelle|quels|quelles|what|which', 'contenu|content|valeur|value|statut|status|commentaire|comment|texte|text|champ|field'],
  ];
  for (const [pattern, first, second] of pairs) {
    const words = wordsInOrder(new RegExp(`\\b(?:${first})\\b`), new RegExp(`\\b(?:${second})\\b`));
    const pieces = [...first.replace(/\[.*?\]\[a-z\]\+/g, '\'est').split('|'), ...second.split('|'), ' ', 'x', '\n', "qu'", 'qu\u2019a', 'e', 's', '_'];
    sameAsPattern(`wordsInOrder ${first}`, pieces, (t) => pattern.test(t), (t) => words.test(t));
  }

  const emailPieces = ['a', 'B', '1', '.', '_', '%', '+', '-', '@', ' ', 'com', '.fr', '\u00e9', '@b.co', 'x@y.org'];
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  sameAsPattern(
    'findEmailAddresses',
    emailPieces,
    (t) => Array.from(t.matchAll(emailPattern), (m) => ({ start: m.index!, end: m.index! + m[0].length })),
    findEmailAddresses,
  );
  sameAsPattern('replaceEmailAddresses', emailPieces, (t) => t.replace(emailPattern, '[e]'), (t) => replaceEmailAddresses(t, '[e]'));
  assertFast('replaceEmailAddresses', ['a.', 'a', 'a@', '@a.', 'a@a.', 'a@a.aa1', '.a'], (t) => replaceEmailAddresses(t, '[e]'));

  const addressPieces = ['a', '@', ' ', '<', '>', ',', ';', '"', '\'', 'b.c', '\n'];
  sameAsPattern('findAddressTokens', addressPieces, (t) => t.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? [], findAddressTokens);
  sameAsPattern('replaceAddressTokens', addressPieces, (t) => t.replace(/[^\s<>,;"']+@[^\s<>,;"']+/g, '[a]'), (t) => replaceAddressTokens(t, '[a]'));
  sameAsPattern('EMAIL_ADDRESSES', emailPieces, (t) => t.replace(emailPattern, '[e]'), (t) => t.replace(EMAIL_ADDRESSES, '[e]'));
  assertFast('findAddressTokens', ['a', 'a ', 'a@', '@'], findAddressTokens);

  // Ends of texts, and the numbers of edit conflicts and exports, read without ambiguity.
  sameAsPattern('trailingRun', [' ', '"', ')', '.', 'a', '\n', '!', '\u00a0'], (t) => t.replace(/[\s"')}\].,:;!?]+$/g, ''), (t) => t.replace(trailingRun('"\')}].,:;!?', true), ''));
  assertFast('trailingRun', [' ', '. a'], (t) => t.replace(trailingRun('"\')}].,:;!?', true), ''));
  sameAsPattern('trailingRun _', ['_', 'a', '.', '-'], (t) => t.replace(/_+$/, ''), (t) => t.replace(trailingRun('_', false), ''));
  assertFast('trailingRun _', ['_', '_a'], (t) => t.replace(trailingRun('_', false), ''));
  sameAsPattern('trailingDigits', ['1', '0', 'a', 'DOC-', '-', ' '], (t) => t.match(/(?:^[A-Z]+-)?(\d+)$/i)?.[1] ?? null, trailingDigits);
  assertFast('trailingDigits', ['1', '1a'], trailingDigits);
  const numberPieces = ['1', '0', '.', 'e', 'E', '+', '-', 'x'];
  sameAsPattern('number', numberPieces, (t) => /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t), (t) => /^[+-]?(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(t));
  assertFast('number', ['1', '1.1'], (t) => /^[+-]?(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(`${t}x`));
  sameAsPattern('size', [...numberPieces, 'cm', 'px', ' '], (t) => t.match(/^([0-9]*\.?[0-9]+)\s*(cm|mm|in|pt|px)$/i), (t) => t.match(/^([0-9]+(?:\.[0-9]+)?|\.[0-9]+)\s*(cm|mm|in|pt|px)$/i));
  assertFast('size', ['1', '1.1'], (t) => /^([0-9]+(?:\.[0-9]+)?|\.[0-9]+)\s*(cm|mm|in|pt|px)$/i.test(`${t}x`));

  // DOCX.
  const svgPieces = ['<', 'svgBlip', 'asvg:', 'a1:', ':', '/>', '/', '>', ' ', 'x', '_', '<asvg:svgBlip '];
  sameAsPattern('removeSvgBlipElements', svgPieces, (t) => t.replace(/<(?:[a-zA-Z0-9]+:)?svgBlip\b[\s\S]*?\/>/g, ''), removeSvgBlipElements);
  assertFast('removeSvgBlipElements', ['<svgBlip ', '<asvg:svgBlip ', '<a', 'a:svgBlip ', '<svgBlip/>'], removeSvgBlipElements);
}

run();
console.log('text-scan.spec OK');
