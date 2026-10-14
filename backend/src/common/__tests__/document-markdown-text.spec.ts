import * as assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DocumentExportService } from '../document-export.service';
import {
  convertHtmlTableToGfm,
  escapeMarkdownTableCell,
  findImportedImageReferences,
  sanitizeForMdxEditor,
} from '../document-import-markdown';
import { DocumentImportService } from '../document-import.service';

function importer(): any {
  return new DocumentImportService({} as any);
}

/** The Markdown image the import writes for the `<img>` tag of `html`. */
function importedImage(html: string, target: string): string {
  const [reference] = findImportedImageReferences(html);
  return importer().buildMarkdownImage(reference, target);
}

function decodesImportedHtmlTextOnce() {
  const paragraph = (html: string): string => sanitizeForMdxEditor(`<p>${html}</p>`).trim();
  const tableCell = (html: string): string => {
    const markdown: string = sanitizeForMdxEditor(
      `<table><tr><th>Header</th></tr><tr><td>${html}</td></tr></table>`,
    );
    return markdown.trim().split('\n')[2].slice(2, -2);
  };
  const cases: Array<[string, string]> = [
    ['A&nbsp;&amp;&nbsp;B &quot;C&quot; D&#39;s E&#039;s', 'A & B "C" D\'s E\'s'],
    ['R&amp;D &amp;quot;draft&amp;quot; &amp;#39;x&amp;#39;', 'R&D &quot;draft&quot; &#39;x&#39;'],
    ['&amp;quot;x&amp;quot; &amp;nbsp;', '&quot;x&quot; &nbsp;'],
    ['&AMP; &lt;kept&gt;', '&AMP; &lt;kept&gt;'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(paragraph(input), expected, `paragraph: ${input}`);
    assert.equal(tableCell(input), expected, `table cell: ${input}`);
  }
}

function escapesTableCellText() {
  const cases: Array<[string, string]> = [
    ['plain text', 'plain text'],
    ['a|b', 'a\\|b'],
    ['C:\\temp\\file', 'C:\\temp\\file'],
    ['a\\|b', 'a\\\\\\|b'],
    ['a\\\\|b', 'a\\\\\\\\\\|b'],
    ['ends with \\', 'ends with \\'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(escapeMarkdownTableCell(input), expected, input);
  }
  // A long run of backslashes is escaped in linear time, with or without a pipe after it.
  const run = '\\'.repeat(200 * 1024);
  const startedAt = performance.now();
  assert.equal(escapeMarkdownTableCell(run), run);
  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < 50, `200 KB of backslashes escaped in ${elapsedMs.toFixed(0)} ms`);
  assert.equal(escapeMarkdownTableCell(`${run}|`), `${run}${run}\\|`);

  const table = convertHtmlTableToGfm(
    '<table><tr><th>Pattern</th><th>Path</th></tr><tr><td>a\\|b</td><td>C:\\temp</td></tr></table>',
  );
  assert.match(table, /^\| a\\\\\\\|b \| C:\\temp \|$/m);
}

function escapesImageTitle() {
  assert.equal(
    importedImage('<img src="a.png" alt="Chart" title="Monthly view">', 'img/a.png'),
    '![Chart](img/a.png "Monthly view")',
  );
  assert.equal(
    importedImage('<img src="a.png" alt="Chart" title=\'Say \\"hi\\" \\\'>', 'img/a.png'),
    '![Chart](img/a.png "Say \\\\\\"hi\\\\\\" \\\\")',
  );
}

function decodesExportedImageAttributeOnce() {
  const service = new DocumentExportService() as any;
  assert.equal(
    service.readHtmlAttribute('<img src="/files/a?x=1&amp;y=&#39;2&#39;">', 'src'),
    '/files/a?x=1&y=\'2\'',
  );
  assert.equal(
    service.readHtmlAttribute('<img src="/files/a?x=1&amp;amp;y=2&amp;lt;3">', 'src'),
    '/files/a?x=1&amp;y=2&lt;3',
  );
  assert.equal(service.readHtmlAttribute('<img src="/files/a?x=1&AMP;y=2">', 'src'), '/files/a?x=1&AMP;y=2');
}

function stripsTagsAndCommentsUntilNoneIsLeft() {
  for (const input of ['<scr<b>ipt>alert(1)</script>', '<<b>script>alert(1)<</b>/script>']) {
    const paragraph = sanitizeForMdxEditor(`<p>${input}</p>`);
    assert.ok(!/<script/i.test(paragraph), `paragraph: ${paragraph}`);
    const table = convertHtmlTableToGfm(`<table><tr><td>${input}</td></tr></table>`);
    assert.ok(!/<script/i.test(table), `table cell: ${table}`);
  }
  assert.equal(sanitizeForMdxEditor('<<b>script>x').trim(), 'x');

  const comment = sanitizeForMdxEditor('a <!<!-- a -->-- b --> z');
  assert.ok(!comment.includes('<!--'), comment);
  assert.equal(comment.trim(), 'a  z');

  // An opener left without its closer, alone or rebuilt by a pass.
  for (const input of ['a <!-- never closed', 'a <!<!---- b', 'a <!-- x --> b <!-- open']) {
    const unclosed = sanitizeForMdxEditor(input);
    assert.ok(!unclosed.includes('<!--'), `${input} -> ${unclosed}`);
  }

  assert.equal(
    sanitizeForMdxEditor('<p>One <b>bold</b> word.</p><!-- bookmark --><table><tr><th>A</th><th>B</th></tr><tr><td><i>1</i></td><td>2</td></tr></table>'),
    'One bold word.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n',
  );
}

decodesImportedHtmlTextOnce();
stripsTagsAndCommentsUntilNoneIsLeft();
escapesTableCellText();
escapesImageTitle();
decodesExportedImageAttributeOnce();
