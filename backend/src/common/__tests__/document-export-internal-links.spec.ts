import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import AdmZip = require('adm-zip');
import { DocumentExportService } from '../document-export.service';

// Typst rejects a PDF whose Markdown links to a heading that is not there
// (`label <missing> does not exist`). The export drops that link and keeps a
// link that names an identifier of the same document. Pandoc and Typst are not
// in CI: the tree walk and the call from `exportMarkdown` are checked here
// with a stand-in for Pandoc. When both tools are on PATH (the API image),
// the same input is also exported to PDF, DOCX and ODT for real.

function text(value: string) {
  return { t: 'Str', c: value };
}

function link(parts: any[], target: string) {
  return { t: 'Link', c: [['', [], []], parts, [target, '']] };
}

function header(id: string, label: string) {
  return { t: 'Header', c: [1, [id, [], []], [text(label)]] };
}

function stringsOf(node: any, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) stringsOf(child, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  if (node.t === 'Str') found.push(String(node.c));
  for (const value of Object.values(node)) stringsOf(value, found);
  return found;
}

function linksOf(node: any, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) linksOf(child, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  if (node.t === 'Link' && Array.isArray(node.c) && Array.isArray(node.c[2])) {
    found.push(String(node.c[2][0] ?? ''));
  }
  for (const value of Object.values(node)) linksOf(value, found);
  return found;
}

function documentWith(blocks: any[]) {
  return {
    'pandoc-api-version': [1, 23, 1],
    meta: {},
    blocks,
  };
}

function sampleAst() {
  return documentWith([
    header('budget-review', 'Budget review'),
    header('hello world', 'Hello world'),
    {
      t: 'Div',
      c: [['box', [], []], [
        { t: 'Para', c: [{ t: 'Span', c: [['note', [], []], [text('Note')]] }] },
      ]],
    },
    {
      t: 'Para',
      c: [
        link([text('review')], '#budget-review'),
        { t: 'Space' },
        link([text('box')], '#box'),
        { t: 'Space' },
        link([text('note')], '#note'),
        { t: 'Space' },
        link([text('spaced')], '#hello%20world'),
        { t: 'Space' },
        link([{ t: 'Strong', c: [text('old name')] }], '#missing'),
        { t: 'Space' },
        link([text('Wrong')], '#Budget-review'),
        { t: 'Space' },
        link([text('top')], '#'),
        { t: 'Space' },
        link([text('site')], 'https://example.com/doc#missing'),
        { t: 'Space' },
        link([text('file')], 'guide.md#missing'),
        { t: 'Space' },
        link([
          text('see'),
          { t: 'Space' },
          link([text('gone')], '#missing'),
        ], '#budget-review'),
      ],
    },
    {
      t: 'BulletList',
      c: [[
        { t: 'Para', c: [link([text('listed')], '#missing')] },
      ]],
    },
  ]);
}

function testThePassRewritesOnlyMissingInternalLinks() {
  const service = new DocumentExportService();
  const ast = sampleAst();
  (service as any).rewriteMissingInternalLinks(ast);

  assert.deepEqual(linksOf(ast).sort(), [
    '#box',
    '#budget-review',
    '#budget-review',
    '#hello%20world',
    '#note',
    'guide.md#missing',
    'https://example.com/doc#missing',
  ]);
  const words = stringsOf(ast);
  assert.ok(words.includes('old name'), 'the broken link keeps its text');
  assert.ok(words.includes('Wrong'), 'a different case is not the heading id');
  assert.ok(words.includes('top'), 'a bare hash is not an identifier');
  assert.ok(words.includes('listed'), 'a link in a list is rewritten too');
  assert.ok(words.includes('gone'), 'a broken link nested in a valid one becomes text');
  assert.match(JSON.stringify(ast), /"t":"Strong"/, 'formatting of the broken link text stays');
  const listed = ast.blocks.find((block: any) => block.t === 'BulletList');
  assert.equal(listed.c[0][0].t, 'Para');
  assert.deepEqual(listed.c[0][0].c, [text('listed')]);
}

function installFakePandoc(service: DocumentExportService, firstAst: any, captured: any[]) {
  (service as any).runPandoc = async (args: string[]) => {
    const output = args[args.indexOf('--output') + 1];
    const target = args[args.indexOf('--to') + 1];
    if (target === 'json') {
      await fs.writeFile(output, JSON.stringify(firstAst), 'utf8');
      return;
    }
    captured.push({
      target,
      ast: JSON.parse(await fs.readFile(args[args.length - 1], 'utf8')),
    });
    if (target === 'odt') {
      // A real ODT is a zip. An empty file makes the image post-pass warn.
      const zip = new AdmZip();
      zip.addFile('content.xml', Buffer.from('<office:document-content/>'));
      await fs.writeFile(output, zip.toBuffer());
      return;
    }
    await fs.writeFile(output, target === 'pdf' ? '%PDF-1.4 fake' : 'fake-office');
  };
}

async function testExportAppliesThePassForEveryFormat() {
  const source = documentWith([
    header('present', 'Present'),
    {
      t: 'Para',
      c: [
        link([text('valid')], '#present'),
        { t: 'Space' },
        link([text('broken')], '#missing'),
      ],
    },
  ]);
  for (const format of ['pdf', 'docx', 'odt'] as const) {
    const service = new DocumentExportService();
    const captured: Array<{ target: string; ast: any }> = [];
    installFakePandoc(service, source, captured);
    const result = await service.exportMarkdown('# Present\n\n[valid](#present) [broken](#missing)', format, 'Notes');
    assert.equal(result.extension, format);
    assert.equal(captured.length, 1, format);
    assert.equal(captured[0].target, format);
    assert.deepEqual(linksOf(captured[0].ast), ['#present']);
    assert.ok(stringsOf(captured[0].ast).includes('broken'));
    if (format === 'pdf') {
      assert.equal(result.buffer.subarray(0, 5).toString('utf8'), '%PDF-');
    }
  }
}

function toolOnPath(name: string): boolean {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function zipEntry(buffer: Buffer, name: string): string {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry(name);
  assert.ok(entry, name);
  return entry.getData().toString('utf8');
}

/** Visible characters of an office XML part, with tags removed. */
function visibleText(xml: string): string {
  return xml
    .replace(/<text:s\b[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '');
}

async function testRealConvertersKeepTheValidLink() {
  if (!toolOnPath('pandoc') || !toolOnPath('typst')) {
    console.log('internal links: pandoc or typst is not on PATH, real export skipped');
    return;
  }
  const service = new DocumentExportService();
  const brokenOnly = 'See [x](#missing).';
  for (const format of ['pdf', 'docx', 'odt'] as const) {
    const result = await service.exportMarkdown(brokenOnly, format, 'Broken');
    assert.equal(result.extension, format);
    assert.ok(result.buffer.length > 20, format);
    if (format === 'pdf') {
      assert.equal(result.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
    }
  }

  const mixed = [
    '# Budget review',
    '',
    'See the [review](#budget-review) and the [old name](#missing).',
  ].join('\n');
  const pdf = await service.exportMarkdown(mixed, 'pdf', 'Notes');
  assert.equal(pdf.buffer.subarray(0, 5).toString('latin1'), '%PDF-');

  const docx = zipEntry((await service.exportMarkdown(mixed, 'docx', 'Notes')).buffer, 'word/document.xml');
  assert.match(docx, /w:anchor="budget-review"/);
  assert.doesNotMatch(docx, /w:anchor="missing"/);
  assert.match(visibleText(docx), /old\s*name/);

  const odt = zipEntry((await service.exportMarkdown(mixed, 'odt', 'Notes')).buffer, 'content.xml');
  assert.match(odt, /xlink:href="#budget-review"/);
  assert.doesNotMatch(odt, /xlink:href="#missing"/);
  assert.match(visibleText(odt), /old\s*name/);
}

async function run() {
  testThePassRewritesOnlyMissingInternalLinks();
  await testExportAppliesThePassForEveryFormat();
  await testRealConvertersKeepTheValidLink();
  console.log('document-export-internal-links.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
