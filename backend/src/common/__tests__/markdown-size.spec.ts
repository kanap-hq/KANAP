import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { backendPath } from './backend-root';
import { markdownToSearchText } from '../markdown-search-text';
import { containsInlineDataImage, findRawHtmlSnippets } from '../html-to-markdown';
import {
  MARKDOWN_MAX_BYTES,
  MARKDOWN_TOO_LARGE,
  assertMarkdownSize,
  containsInlineDataImageText,
  markdownTextSize,
} from '../markdown-limits';
import { normalizeMarkdownRichText } from '../markdown-rich-text';

// Reference outputs: the regular expressions the linear scans replace.
function referenceSearchText(value: string): string {
  return String(value || '')
    .replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_match, code: string) => ` ${code || ''} `)
    .replace(/`([^`]*)`/g, (_match, code: string) => ` ${code || ''} `)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => ` ${alt || ''} `)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_match, label: string) => ` ${label || ''} `)
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[*_~]+/g, '')
    .replace(/[>#|]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function referenceDataImageText(value: string): boolean {
  const text = String(value || '').trim();
  return /!\[[^\]]*]\(\s*<?data:image\/[a-z0-9.+-]+;base64,[^)>\s]+>?/i.test(text)
    || /<img\b[^>]*\bsrc\s*=\s*("data:image\/[a-z0-9.+-]+;base64,[^"]*"|'data:image\/[a-z0-9.+-]+;base64,[^']*')[^>]*>/i.test(text);
}

// Small deterministic generator, so a failure is reproducible.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomText(random: () => number, pieces: string[], maxPieces: number): string {
  const count = 1 + Math.floor(random() * maxPieces);
  let text = '';
  for (let index = 0; index < count; index += 1) {
    text += pieces[Math.floor(random() * pieces.length)];
  }
  return text;
}

function realDocuments(): Array<{ name: string; text: string }> {
  const files = [
    ...fs.readdirSync(backendPath('fixtures', 'fromage-co', 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => backendPath('fixtures', 'fromage-co', 'docs', name)),
    backendPath('fixtures', 'fromage-co', 'SETUP-GUIDE.md'),
    backendPath('fixtures', 'fromage-co', 'netbox', 'README.md'),
  ];
  // The user manual sits next to the backend in a full checkout.
  const manual = backendPath('..', 'doc', 'help', 'docs', 'en');
  if (fs.existsSync(manual)) {
    files.push(...fs.readdirSync(manual).filter((name) => name.endsWith('.md')).map((name) => path.join(manual, name)));
  }
  return files.map((file) => ({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') }));
}

function elapsedMs(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function fill(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

function sizeError(fn: () => unknown): { code?: string } | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return error.getResponse() as { code?: string };
  }
}

const LIMIT_TEXT = 'Texte de la documentation. '.repeat(Math.floor(MARKDOWN_MAX_BYTES / 27));
const IMAGE_5MB = `![schema](data:image/png;base64,${fill('iVBORw0KGgoAAAANSUhEUgAA', 5 * 1024 * 1024)})`;

function testSearchTextMatchesReferenceOnRealDocuments() {
  const documents = realDocuments();
  assert.ok(documents.length >= 5, 'the Fromage documents are found');
  for (const { name, text } of documents) {
    assert.equal(markdownToSearchText(text), referenceSearchText(text), name);
  }
}

function testSearchTextMatchesReferenceOnGeneratedText() {
  const random = seededRandom(20261014);
  const pieces = ['```', '```txt\n', '`', '![', '[', ']', '](', '(', ')', '<', '>', '</', '!', 'a', ' ', '\n', '*', '-', '#', '|'];
  for (let round = 0; round < 20000; round += 1) {
    const text = randomText(random, pieces, 14);
    assert.equal(markdownToSearchText(text), referenceSearchText(text), JSON.stringify(text));
  }
}

function testInlineImageTextCheckMatchesReference() {
  const random = seededRandom(1014);
  const pieces = [
    '![', '[', ']', '](', '(', ')', ' ', '<', '>', 'data:image/png;base64,', 'AAA', '<img ', 'src=', 'alt=',
    '"', '\'', 'x', '\n', 'data:image/', ';base64,',
  ];
  for (let round = 0; round < 20000; round += 1) {
    const text = randomText(random, pieces, 12);
    assert.equal(containsInlineDataImageText(text), referenceDataImageText(text), JSON.stringify(text));
  }
  assert.equal(containsInlineDataImageText('![logo](data:image/png;base64,iVBORw0KGgo=)'), true);
  assert.equal(containsInlineDataImageText('<img alt="logo" src="data:image/png;base64,iVBORw0KGgo=">'), true);
  assert.equal(containsInlineDataImageText('![logo](https://example.com/logo.png)'), false);
}

function testSearchTextTimeIsBoundedAtTheLimit() {
  const inputs = {
    'code block of "<"': `\`\`\`\n${fill('<', MARKDOWN_MAX_BYTES - 8)}\n\`\`\``,
    '"[](" runs': fill('[](', MARKDOWN_MAX_BYTES),
    '"![](" runs': fill('![](', MARKDOWN_MAX_BYTES),
    '"[" runs': fill('[', MARKDOWN_MAX_BYTES),
    '"[a]" runs': fill('[a]', MARKDOWN_MAX_BYTES),
    '"```" runs': fill('```a', MARKDOWN_MAX_BYTES),
  };
  for (const [name, text] of Object.entries(inputs)) {
    const ms = elapsedMs(() => markdownToSearchText(text));
    assert.ok(ms < 500, `search text of ${name}: ${ms.toFixed(0)} ms`);
  }
}

function testInlineImageTextCheckTimeIsBoundedAtTheLimit() {
  const inputs = {
    '"![" runs': fill('![', MARKDOWN_MAX_BYTES),
    '"![a](" runs': fill('![a](', MARKDOWN_MAX_BYTES),
    '"<img " runs': fill('<img ', MARKDOWN_MAX_BYTES),
    '"<img src=" runs': `${fill('<img src="data:image/png;base64,', MARKDOWN_MAX_BYTES)}>`,
  };
  for (const [name, text] of Object.entries(inputs)) {
    const ms = elapsedMs(() => containsInlineDataImageText(text));
    assert.ok(ms < 500, `inline image check of ${name}: ${ms.toFixed(0)} ms`);
  }
}

function testTextAtTheLimitIsAccepted() {
  assert.ok(markdownTextSize(LIMIT_TEXT) <= MARKDOWN_MAX_BYTES);
  assert.equal(normalizeMarkdownRichText(LIMIT_TEXT), LIMIT_TEXT.trim());
}

function testLargerTextIsRefused() {
  const text = 'Texte de la documentation. '.repeat(Math.ceil((210 * 1024) / 27));
  const refused = sizeError(() => normalizeMarkdownRichText(text, { fieldName: 'content_markdown' }));
  assert.equal(refused?.code, MARKDOWN_TOO_LARGE);
  assert.equal(sizeError(() => assertMarkdownSize(text))?.code, MARKDOWN_TOO_LARGE);
  // Contents already stored are processed whatever their size.
  assert.equal(normalizeMarkdownRichText(text, { enforceSizeLimit: false }), text.trim());
}

function testSizeCountsUtf8Bytes() {
  const accented = 'é'.repeat(MARKDOWN_MAX_BYTES / 2 + 1);
  assert.equal(sizeError(() => assertMarkdownSize(accented))?.code, MARKDOWN_TOO_LARGE);
}

function testInlineImagesDoNotCountTowardTheLimit() {
  const text = `${'Texte de la documentation. '.repeat(Math.floor((150 * 1024) / 27))}\n\n${IMAGE_5MB}\n`;
  assert.ok(markdownTextSize(text) < 151 * 1024);
  assert.equal(sizeError(() => assertMarkdownSize(text)), null);
  // An inline base64 image is still refused by its own rule, not by the size limit.
  const refused = sizeError(() => normalizeMarkdownRichText(text));
  assert.notEqual(refused?.code, MARKDOWN_TOO_LARGE);
  assert.match(String((refused as any)?.message), /inline base64 images/);
  // The same text with the image stored as an attachment is accepted.
  const withAttachment = text.replace(IMAGE_5MB, '![schema](/api/knowledge/attachments/fromage/1/inline)');
  assert.equal(normalizeMarkdownRichText(withAttachment), withAttachment.trim());
}

function testDataImageTextOutsideAnImageCountsInFull() {
  const payload = `data:image/png;base64,${fill('iVBORw0KGgoAAAANSUhEUgAA', 5 * 1024 * 1024)}`;
  // A data URI written as text is not an inline image: all its bytes count.
  const comment = `Valeur relevée : ${payload}`;
  assert.ok(markdownTextSize(comment) > 5 * 1024 * 1024);
  assert.equal(sizeError(() => assertMarkdownSize(comment))?.code, MARKDOWN_TOO_LARGE);
  assert.equal(sizeError(() => normalizeMarkdownRichText(comment, { fieldName: 'content' }))?.code, MARKDOWN_TOO_LARGE);
  // Nor is an image written inside a code block.
  const inCode = `\`\`\`\n![schema](${payload})\n\`\`\``;
  assert.equal(sizeError(() => normalizeMarkdownRichText(inCode, { fieldName: 'content' }))?.code, MARKDOWN_TOO_LARGE);
  // A real inline image is refused by its own rule, quickly: its payload is not parsed.
  const withImage = `Introduction avec un [lien](https://example.com).\n\n${IMAGE_5MB}\n\nFin.`;
  const ms = elapsedMs(() => {
    assert.equal(containsInlineDataImage(withImage), true);
    assert.deepEqual(findRawHtmlSnippets(withImage), []);
    assert.match(String((sizeError(() => normalizeMarkdownRichText(withImage)) as any)?.message), /inline base64 images/);
  });
  assert.ok(ms < 1000, `checks with a 5 MB inline image: ${ms.toFixed(0)} ms`);
}

function run() {
  testSearchTextMatchesReferenceOnRealDocuments();
  testSearchTextMatchesReferenceOnGeneratedText();
  testInlineImageTextCheckMatchesReference();
  testSearchTextTimeIsBoundedAtTheLimit();
  testInlineImageTextCheckTimeIsBoundedAtTheLimit();
  testTextAtTheLimitIsAccepted();
  testLargerTextIsRefused();
  testSizeCountsUtf8Bytes();
  testInlineImagesDoNotCountTowardTheLimit();
  testDataImageTextOutsideAnImageCountsInFull();
}

run();
