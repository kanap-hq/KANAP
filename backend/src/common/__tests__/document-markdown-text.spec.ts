import * as assert from 'node:assert/strict';
import { DocumentExportService } from '../document-export.service';
import { DocumentImportService, escapeMarkdownTableCell } from '../document-import.service';

function importer(): any {
  return new DocumentImportService({} as any);
}

function decodesImportedHtmlTextOnce() {
  const service = importer();
  const paragraph = (html: string): string => service.sanitizeForMdxEditor(`<p>${html}</p>`).trim();
  const tableCell = (html: string): string => {
    const markdown: string = service.sanitizeForMdxEditor(
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

  const table = importer().convertHtmlTableToGfm(
    '<table><tr><th>Pattern</th><th>Path</th></tr><tr><td>a\\|b</td><td>C:\\temp</td></tr></table>',
  );
  assert.match(table, /^\| a\\\\\\\|b \| C:\\temp \|$/m);
}

function escapesImageTitle() {
  const service = importer();
  assert.equal(
    service.buildMarkdownImage('<img src="a.png" alt="Chart" title="Monthly view">', 'img/a.png'),
    '![Chart](img/a.png "Monthly view")',
  );
  assert.equal(
    service.buildMarkdownImage('<img src="a.png" alt="Chart" title=\'Say \\"hi\\" \\\'>', 'img/a.png'),
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

decodesImportedHtmlTextOnce();
escapesTableCellText();
escapesImageTitle();
decodesExportedImageAttributeOnce();
