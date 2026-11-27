import * as assert from 'node:assert/strict';
import { extractInlineImageUrls } from '../content-image-urls';
import { findMarkdownImageTargets } from '../text-scan';

/** The reading the linear scan replaced: the inline `src` values of `<img>` tags, then Markdown images. */
function patternUrls(content: string): string[] {
  const urls: string[] = [];
  const pattern = /\bsrc\s*=\s*["']([^"']*\/inline(?:\/[^"']*)?)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const raw = (match[1] || '').trim();
    if (raw) urls.push(raw);
  }
  for (const target of findMarkdownImageTargets(content)) {
    const raw = target.trim();
    if (raw && raw.includes('/inline')) urls.push(raw);
  }
  return [...new Set(urls)];
}

function run() {
  // The callers compare the addresses without case: `/INLINE/` and `/Inline` name an inline image.
  assert.deepEqual(extractInlineImageUrls('<img src="/a/INLINE/b">'), ['/a/INLINE/b'], 'upper case inline segment');
  assert.deepEqual(extractInlineImageUrls('<img src="/a/Inline">'), ['/a/Inline'], 'mixed case inline at the end');
  assert.deepEqual(extractInlineImageUrls('<IMG SRC="/a/inline/b">'), ['/a/inline/b'], 'upper case attribute');
  assert.deepEqual(extractInlineImageUrls('<img src="/a/inlinex">'), [], 'not an inline segment');
  assert.deepEqual(extractInlineImageUrls('<img data-src="/a/inline/b">'), ['/a/inline/b'], 'a word boundary before src');
  assert.deepEqual(extractInlineImageUrls('<img xsrc="/a/inline/b">'), [], 'no word boundary before src');

  // Random texts of the pieces that matter read as the pattern read them.
  const pieces = ['src', 'SRC', 'Src', 'x', ' ', '\t', '=', '"', "'", '/inline', '/INLINE', '/Inline', '/inline/', '/InLiNe/', 'a', '/', '![i](', ')', '<', '>'];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 20000; n += 1) {
    let text = '';
    const length = 1 + Math.floor(next() * 14);
    for (let i = 0; i < length; i += 1) text += pieces[Math.floor(next() * pieces.length)];
    assert.deepEqual(extractInlineImageUrls(text), patternUrls(text), JSON.stringify(text));
  }
}

run();
console.log('content-image-urls.spec OK');
