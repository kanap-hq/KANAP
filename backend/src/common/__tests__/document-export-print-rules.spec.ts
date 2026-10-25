import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { DocumentExportService } from '../document-export.service';

// Every PDF goes through Pandoc's Typst engine, not HTML: the print rules that keep a heading
// with what follows and a table row on one page are raw Typst, handed to Pandoc through
// `--include-in-header`. This spec replaces the two Pandoc calls and inspects the command lines
// and the header file, so it runs without Pandoc or Typst installed.

type Call = { args: string[]; header: string | null; headerPath: string | null };

function fakeExport(service: DocumentExportService, calls: Call[]) {
  (service as any).runPandoc = async (args: string[]) => {
    const output = args[args.indexOf('--output') + 1];
    const headerArg = args.find((arg) => arg.startsWith('--include-in-header='));
    const headerPath = headerArg ? headerArg.slice('--include-in-header='.length) : null;
    const header = headerPath ? await fs.readFile(headerPath, 'utf8') : null;
    calls.push({ args, header, headerPath });
    if (args[args.indexOf('--to') + 1] === 'json') {
      await fs.writeFile(output, JSON.stringify({
        'pandoc-api-version': [1, 23, 1],
        meta: {},
        blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hello' }] }],
      }), 'utf8');
    } else {
      await fs.writeFile(output, Buffer.from('%PDF-1.4 fake'));
    }
  };
}

async function testPdfCarriesThePrintRules() {
  const service = new DocumentExportService();
  const calls: Call[] = [];
  fakeExport(service, calls);
  const result = await service.exportMarkdown('# Hello\n\n## Journal\n\n| A | B |\n|---|---|\n| 1 | 2 |', 'pdf', 'Report');
  assert.equal(result.extension, 'pdf');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headerPath, null, 'the reading pass carries no header');
  assert.ok(calls[1].headerPath, 'the PDF pass names its header file');
  assert.match(calls[1].header || '', /#show heading: set block\(sticky: true\)/);
  assert.match(calls[1].header || '', /#show figure\.where\(kind: table\): set block\(breakable: true\)/);
  assert.match(calls[1].header || '', /#set table\.cell\(breakable: false\)/);
  assert.match(calls[1].header || '', /#show table\.cell: set text\(hyphenate: false\)/);
  assert.ok(calls[1].args.includes('--pdf-engine=typst'));
  assert.equal(await fs.access(calls[1].headerPath!).then(() => true, () => false), false, 'the temporary file is removed');
}

async function testOtherFormatsCarryNoTypstRules() {
  const service = new DocumentExportService();
  const calls: Call[] = [];
  fakeExport(service, calls);
  const result = await service.exportMarkdown('# Hello', 'docx', 'Report');
  assert.equal(result.extension, 'docx');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headerPath, null);
  assert.equal(calls[1].headerPath, null);
  assert.equal(calls[1].args.some((arg) => arg.startsWith('--include-in-header=')), false);
}

function testTableWidthMarkerBecomesPandocWidths() {
  const service = new DocumentExportService();
  const colspec = () => [{ t: 'AlignDefault' }, { t: 'ColWidthDefault' }];
  const table = {
    t: 'Table',
    c: [['', [], []], [null, []], [colspec(), colspec(), colspec(), colspec(), colspec()], [], [], []],
  };
  const ast = {
    blocks: [
      { t: 'RawBlock', c: ['html', '<!-- kanap:table-widths=3,3,3,3,10 -->'] },
      table,
    ],
  };
  (service as any).applyDeclaredTableWidths(ast);
  assert.equal(ast.blocks.length, 1, 'the marker is removed');
  const applied = (ast.blocks[0] as any).c[2].map((spec: any) => spec[1]);
  assert.deepEqual(applied, [
    { t: 'ColWidth', c: 3 / 22 },
    { t: 'ColWidth', c: 3 / 22 },
    { t: 'ColWidth', c: 3 / 22 },
    { t: 'ColWidth', c: 3 / 22 },
    { t: 'ColWidth', c: 10 / 22 },
  ]);

  // A marker with another number of columns is ignored, and the table stays as Pandoc wrote it.
  const mismatched = {
    blocks: [
      { t: 'RawBlock', c: ['html', '<!-- kanap:table-widths=3,3,10 -->'] },
      { t: 'Table', c: [['', [], []], [null, []], [colspec(), colspec()], [], [], []] },
    ],
  };
  (service as any).applyDeclaredTableWidths(mismatched);
  assert.equal(mismatched.blocks.length, 1);
  assert.deepEqual((mismatched.blocks[0] as any).c[2][0][1], { t: 'ColWidthDefault' });

  // A marker in the review text, not followed by a table, is left alone.
  const prose = { blocks: [{ t: 'Paragraph', c: [{ t: 'Str', c: 'kanap:table-widths=3,10' }] }] };
  (service as any).applyDeclaredTableWidths(prose);
  assert.equal(prose.blocks.length, 1);
}

async function run() {
  await testPdfCarriesThePrintRules();
  await testOtherFormatsCarryNoTypstRules();
  testTableWidthMarkerBecomesPandocWidths();
  console.log('document-export-print-rules.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
