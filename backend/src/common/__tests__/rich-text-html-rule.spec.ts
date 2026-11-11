import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { backendPath } from './backend-root';
import { isAllowedMarkdownHtmlSnippet, RICH_TEXT_ALLOWED_HTML } from '../html-to-markdown';
import { MARKDOWN_HTML_NOT_ALLOWED } from '../markdown-limits';
import { normalizeMarkdownRichText } from '../markdown-rich-text';

/**
 * The rule of a rich-text write: the text is Markdown, and the only HTML tags it
 * holds are those of `RICH_TEXT_ALLOWED_HTML`, wherever they sit in the text.
 * Text shown as code (a fenced block, an inline code span) holds no tag.
 */

type Refusal = { code?: string; field?: string; example?: string; message?: string };

function refusalOf(text: string, fieldName = 'description'): Refusal | null {
  try {
    normalizeMarkdownRichText(text, { fieldName });
    return null;
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return error.getResponse() as Refusal;
  }
}

function assertRefused(name: string, text: string): void {
  const refusal = refusalOf(text);
  assert.equal(refusal?.code, MARKDOWN_HTML_NOT_ALLOWED, `${name} is refused`);
}

function assertAccepted(name: string, text: string): void {
  const refusal = refusalOf(text);
  assert.equal(refusal, null, `${name} is accepted (${refusal?.message})`);
  assert.equal(normalizeMarkdownRichText(text), text.trim(), `${name} is stored as written`);
}

const table = (cell: string) => `| Step | Detail |\n|---|---|\n| One | ${cell} |\n`;
const headerTable = (cell: string) => `| Step | ${cell} |\n|---|---|\n| One | Two |\n`;

function testElementsOutsideTheListAreRefusedEverywhere() {
  const elements = [
    '<form action="/search"><input name="q"></form>',
    '<div class="note">Note</div>',
    '<span style="color: red">red</span>',
    '<a href="https://example.com">link</a>',
    '<details open><summary>More</summary>Text</details>',
    '<iframe src="https://example.com"></iframe>',
    '<meta charset="utf-8">',
    '<style>p { color: red }</style>',
    '<b>bold</b>',
    '<!-- a comment -->',
  ];
  for (const element of elements) {
    assertRefused(`${element} on its own line`, `Introduction.\n\n${element}\n\nEnd.`);
    assertRefused(`${element} inside a sentence`, `A sentence with ${element} in it.`);
    assertRefused(`${element} in a table cell`, table(element));
    assertRefused(`${element} in a header cell`, headerTable(element));
    assertRefused(`${element} in a table inside a list`, `- item\n\n  ${table(element).replace(/\n(?=.)/g, '\n  ')}`);
    assertRefused(`${element} in a table inside a quote`, table(element).replace(/^/gm, '> '));
    assertRefused(`${element} in an indented block`, `Introduction.\n\n    ${element}\n\nEnd.`);
    assertRefused(`${element} in an indented block of a list item`, `- item\n\n      ${element}\n`);
    assertRefused(`${element} in a doubly indented block`, `Introduction.\n\n        ${element}\n\nEnd.`);
  }
  assertRefused('a closing tag alone', 'Text</form> after.');
  assertRefused('a tag left open', 'Introduction.\n\n<form action="/search"\n');
  assertRefused('a block opened by an accepted tag', '<u>\n<form action="/search">\n</u>\n');
}

function testAcceptedElementsTakeNoAttribute() {
  assertRefused('<u> with an attribute', 'An <u onclick="go()">underlined</u> word.');
  assertRefused('<u> with a class', 'An <u class="x">underlined</u> word.');
  assertRefused('<sub> with an attribute', 'H<sub id="two">2</sub>O');
  assertRefused('<sup> with an attribute', 'x<sup style="color: red">2</sup>');
  assertRefused('<br> with an attribute', 'Line one<br class="x">line two');
  assertRefused('<br> with an attribute in a cell', table('Line one<br class="x">line two'));
  assertRefused('<img> with an attribute outside its list', '<img src="/api/files/1" onerror="go()" />');
  assertRefused('<img> with a style', '<img src="/api/files/1" style="position: fixed" />');
  assertRefused('<img> with a script source', '<img src="javascript:go()" />');
  assertRefused('<img> without a source', '<img alt="nothing" />');
  assertRefused('an accepted name in upper case', 'An <U>underlined</U> word.');
}

/**
 * The list and the forms below are a copy of what the editor reads as an element and as text
 * (`frontend/src/lib/richTextHtmlElements.test.ts` holds the same copy). A change of the list
 * or of a form is made on both sides, in the code and in both tests.
 */
const ACCEPTED_LIST = {
  paired: ['u', 'sub', 'sup'],
  lineBreak: 'br',
  imageAttributes: ['src', 'alt', 'title', 'width', 'height'],
};

const ACCEPTED_FORMS = [
  '<u>', '</u>', '<sub>', '</sub>', '<sup>', '</sup>',
  '<br>', '<br/>', '<br />',
  '<img src="/api/files/1" />',
  '<img src="https://example.com/a.png">',
  '<img src="//example.com/a.png"/>',
  `<img height="40" width="60" alt="a > b" title='a "name"' src="/api/files/1" />`,
];

const REFUSED_FORMS = [
  '<u >', '<u/>', '<u />', '</u >', '<U>', '</SUB>', '<u class="x">', '<sup id="a">',
  '<br  />', '<br\t/>', '</br>', '<BR>', '<br class="x">', '<br class="x" />',
  '<img>', '<img />', '<img alt="a" />',
  '<IMG src="/api/files/1" />', '<img SRC="/api/files/1" />',
  '<img src=/api/files/1 />', '<img src = "/api/files/1" />', '<img src="/api/files/1"alt="a" />',
  '<img src="/api/files/1"\nalt="a" />', '<img src="/api/files/1" alt="a\nb" />',
  '<img src="/api/files/1" onerror="go()" />', '<img src="/api/files/1" style="position: fixed" />',
  '<img src="/api/files/1" data-x="1" />', '<img src="/api/files/1" alt />',
  '<img src="javascript:go()" />', '<img src="data:image/png;base64,AAAA" />', '<img src="a.png" />',
  '<img src="/api/files/1" width="60px" />', '<img src="/api/files/1" height="123456" />',
  '<img src="/api/files/1" width="" />',
];

function testTheListAndItsFormsAreThoseOfTheEditor() {
  assert.deepEqual(RICH_TEXT_ALLOWED_HTML, ACCEPTED_LIST);
  for (const form of ACCEPTED_FORMS) {
    assert.equal(isAllowedMarkdownHtmlSnippet(form), true, `${form} is an accepted form`);
    assertAccepted(`${form} in a sentence`, `Before ${form} after.`);
  }
  for (const form of REFUSED_FORMS) {
    assert.equal(isAllowedMarkdownHtmlSnippet(form), false, `${form} is not an accepted form`);
    assertRefused(`${form} in a sentence`, `Before ${form} after.`);
    assertRefused(`${form} in a cell`, table(`Before ${form} after.`));
  }
}

/**
 * A tag of the list written in another form is refused in prose too, where the parser reads
 * no tag: a reader of the same text that takes more forms of attributes would read one.
 */
function testAnAcceptedNameInAnotherFormIsRefusedInProse() {
  const code = '`"> <form action="/search"></form> `';
  assertRefused('<u> with an attribute the parser does not read', `<u $a="${code} end</u>`);
  assertRefused('<br> with an attribute the parser does not read', `<br $a="${code} end`);
  assertRefused('<img> with an attribute the parser does not read', `<img $a="${code} src="/api/files/1" />`);
  assertRefused('the same in a cell', table(`<sub $a="${code} end</sub>`));
  assertRefused('the same in an indented block', `Introduction.\n\n    <sup $a="${code} end</sup>\n`);
  assertRefused('the same in a link text', `[<u $a="${code}](https://example.com)`);
  assertRefused('<u> opened and left there', 'An <u underlined word.');
  assertRefused('<u> with a spread', 'An <u {...props}>underlined</u> word.');
  assertRefused('<br at the end of a line', 'Line one <br\nline two');
  assertRefused('<u at the end of the text', 'An underlined word <u');

  assertAccepted('the same text escaped', 'An \\<u $a="x"> word.');
  assertAccepted('the same text as code', 'Write `<u $a="x">` as it is.');
  assertAccepted('a longer name', 'Values: a<ub, x <sub1, y<supper and z<brx.');
  assertAccepted('a name followed by punctuation', 'If t<u, then x<sub. End (a<sup).');
}

function testTheAcceptedListIsAccepted() {
  assertAccepted('underline, subscript, superscript', 'An <u>underlined</u> word, H<sub>2</sub>O and x<sup>2</sup>.');
  assertAccepted('a paragraph that is one underlined text', '<u>Underlined</u>');
  assertAccepted('<br>', 'Line one<br>line two');
  assertAccepted('<br />', 'Line one<br />line two');
  assertAccepted('<br/>', 'Line one<br/>line two');
  assertAccepted('<br> alone on a line', 'Line one\n\n<br>\n\nLine two');
  assertAccepted('<br> in a cell', table('Line one<br>line two<br />line three'));
  assertAccepted('formats in a cell', table('<u>a</u> H<sub>2</sub>O x<sup>2</sup>'));
  assertAccepted('a resized image', '<img height="40" width="60" alt="Diagram" src="/api/knowledge/attachments/fromage/1/inline" />');
  assertAccepted('a resized image in a cell', table('<img width="60" alt="a > b" title="Diagram" src="https://example.com/a.png" />'));
  assertAccepted('formats in an indented block', 'Introduction.\n\n    An <u>underlined</u> word<br>and a line.\n');
}

function testMarkdownAndCodeAreAccepted() {
  assertAccepted('a fenced block that shows HTML', 'Example:\n\n```html\n<form action="/search"><input name="q"></form>\n```\n');
  assertAccepted('a tilde fence that shows HTML', 'Example:\n\n~~~\n<div class="note">Note</div>\n~~~\n');
  assertAccepted('a fenced block in a list', '- item\n\n  ```html\n  <details open>x</details>\n  ```\n');
  assertAccepted('inline code', 'Use the `<form>` element, or `<meta charset="utf-8">`.');
  assertAccepted('inline code in a cell', table('`<form action="/search">`'));
  assertAccepted('an automatic link', 'See <https://example.com/page?a=1&b=2> for details.');
  assertAccepted('an automatic e-mail link', 'Write to <support@example.com>.');
  assertAccepted('an escaped tag', 'The text \\<form action\\="/search"> is shown as written.');
  assertAccepted('a comparison', 'Keep it if a<b, or if x <y then stop. Above 3 > 2.');
  assertAccepted('a comparison in a cell', table('a<b'));
  assertAccepted('an arrow', 'Before -> after <- back, 1 < 2 > 0, <3, <-, <=, <>.');
  assertAccepted('an indented block of code', 'Run:\n\n    npm install\n    if (a < b && c > d) return;\n');
  assertAccepted('an indented comparison', 'Rule:\n\n    a<b\n    x <y\n');
  assertAccepted('usual Markdown', [
    '# Title', '', 'A **bold**, *italic*, ~~struck~~ and ==marked== text with a [link](https://example.com).', '',
    '- [x] done', '- [ ] to do', '', '> A quote', '', table('Value'), '', '![Diagram](/api/files/1 "Title")', '',
    '1. One', '2. Two', '', '---', '',
  ].join('\n'));
}

function testTheRefusalNamesTheFieldAndTheTag() {
  const refusal = refusalOf(`Text.\n\n${table('<form   action="/search">')}`, 'notes');
  assert.deepEqual(Object.keys(refusal ?? {}).sort(), ['code', 'example', 'field', 'message']);
  assert.equal(refusal?.code, MARKDOWN_HTML_NOT_ALLOWED);
  assert.equal(refusal?.field, 'notes');
  assert.equal(refusal?.example, '<form action="/search">');
  assert.match(String(refusal?.message), /^notes must be Markdown\. /);

  // The first refused tag is the example, cut short.
  const long = refusalOf(`An <u>underlined</u> word, then <div data-note="${'x'.repeat(400)}">`);
  assert.equal(long?.example?.length, 120);
  assert.ok(long?.example?.startsWith('<div data-note="xxx'));
}

function testStoredContentKeepsWhatItHolds() {
  const stored = `Introduction.\n\n${table('<details open>More</details>')}\n<div>Old</div>\n`;
  assert.equal(refusalOf(stored)?.code, MARKDOWN_HTML_NOT_ALLOWED);
  assert.equal(normalizeMarkdownRichText(stored, { fieldName: 'description', storedContent: true }), stored.trim());
  // An inline image is refused in a stored content as in a write, in a cell as elsewhere.
  const image = table('![x](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA)');
  assert.throws(() => normalizeMarkdownRichText(image, { storedContent: true }), /inline base64 images/);
  assert.throws(() => normalizeMarkdownRichText(image), /inline base64 images/);
}

/**
 * A text read from another system by an automatic import has nobody to correct it: a tag
 * outside the list stays in the text, written as text, and the result passes the rule.
 */
function testThirdPartyTextKeepsItsTagsAsText() {
  const kept = (text: string) => String(normalizeMarkdownRichText(text, { fieldName: 'description', thirdPartyText: true }));
  const assertKeptAsText = (name: string, text: string, ...holds: string[]) => {
    const stored = kept(text);
    assert.equal(refusalOf(stored), null, `${name}: the stored text passes the rule`);
    assert.equal(stored.replace(/\\</g, '<'), text.trim(), `${name}: nothing is lost`);
    for (const part of holds) assert.ok(stored.includes(part), `${name}: holds ${part} (${stored})`);
  };

  const trace = [
    'The service stops when it starts:', '',
    '    at com.example.Service.<init>(Service.java:12)',
    '    at java.util.HashMap.<clinit>(HashMap.java:3)', '',
    'The page shows <form action="/search"><input name="q"></form> twice.',
  ].join('\n');
  assert.equal(refusalOf(trace)?.code, MARKDOWN_HTML_NOT_ALLOWED);
  assertKeptAsText('a stack trace and a form', trace, '\\<init>', '\\<clinit>', '\\<form action="/search">', '\\</form>');

  assertKeptAsText('a tag in a cell', table('<details open>More</details>'), '\\<details open>');
  assertKeptAsText('a comment', 'Before <!-- a note --> after.', '\\<!-- a note -->');
  assertKeptAsText('a tag left open', 'Introduction.\n\n<div class="note"\n', '\\<div');
  assertKeptAsText('a listed tag in another form', 'An <u class="x">underlined</u> word.', '\\<u class="x">');
  assertKeptAsText('a listed tag with an attribute the parser does not read', 'An <u $a="`"> <form></form> ` end', '\\<u $a=');
  // Backticks that close no code span for the parser: the tag between them is prose.
  assertKeptAsText('a tag between the backticks of two list items', '- one `a\n- <b>bold</b>` end', '\\<b>bold\\</b>');

  // What the rule accepts stays as it is written.
  const accepted = [
    'An <u>underlined</u> word, H<sub>2</sub>O, x<sup>2</sup>, a line<br>and <br /> another.',
    'See <https://example.com/page?a=1> or write to <support@example.com>.',
    'Use `<form>` or ``a ` <meta charset="utf-8">``.',
    '```html\n<form action="/search">\n\n<input name="q"></form>\n```',
    '- item\n\n  ```xml\n  <config a="1">\n\n  </config>\n  ```',
    '<img height="40" width="60" alt="Diagram" src="/api/files/1" />',
    'Keep it if a<b, or if x <y then stop. Already \\<escaped>.',
  ];
  for (const text of accepted) assert.equal(kept(text), text, `${text} is kept as written`);
  const mixed = kept(`${accepted[2]} Then <b>bold</b>.\n\n${accepted[3]}\n\n${accepted[0]}`);
  assert.equal(mixed, `${accepted[2]} Then \\<b>bold\\</b>.\n\n${accepted[3]}\n\n${accepted[0]}`);

  // A person's write of the same text is refused, and an inline image is refused in both.
  assert.equal(refusalOf('Then <b>bold</b>.')?.code, MARKDOWN_HTML_NOT_ALLOWED);
  assert.throws(
    () => normalizeMarkdownRichText('![x](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA)', { thirdPartyText: true }),
    /inline base64 images/,
  );
}

/**
 * A link or an image opens an `http`, `https` or `mailto` address, or an address without a
 * scheme (a path, a query, an anchor). Any other address is refused on a write, with the code
 * of a refused tag.
 */
function testLinksAndImagesOpenWebMailOrRelativeAddresses() {
  const accepted: Array<[string, string]> = [
    ['a web link', '[page](https://example.com/a?b=1#c)'],
    ['a web link without encryption', '[page](http://example.com)'],
    ['a web link in capitals', '[page](HTTPS://EXAMPLE.COM/A)'],
    ['a mail link', '[write](mailto:support@example.com)'],
    ['an automatic web link', 'See <https://example.com/a>.'],
    ['an automatic mail link', 'Write to <support@example.com>.'],
    ['a web address in a sentence', 'See https://example.com/a or www.example.com for more.'],
    ['a path of the application', '[task](/portfolio/tasks/T-1/overview)'],
    ['an anchor', '[section](#deployment)'],
    ['a relative file', '[page](page.md)'],
    ['a relative path', '[page](./guides/page.md#part) and [up](../index.md)'],
    ['a relative path with an ampersand', '[page](R&D/page.md)'],
    ['a query', '[tab](?tab=history)'],
    ['a path with a colon after its first segment', '[time](/logs/12:30)'],
    ['an image of the application', '![Diagram](/api/files/1 "Title")'],
    ['a web image', '![Diagram](https://example.com/a.png)'],
    ['a link by reference', '[page][ref]\n\n[ref]: https://example.com/a "Title"'],
    ['a colon in a sentence', 'Ratio 3:4, see note: [none].'],
    ['another address written in a sentence', 'Upload to ftp://example.com/in then call tel:+33123456789.'],
  ];
  for (const [name, text] of accepted) assertAccepted(name, text);

  const refused: Array<[string, string, string]> = [
    ['a file transfer link', 'Read [the file](ftp://example.com/a).', '[the file](ftp://example.com/a)'],
    ['a phone link', '[call](tel:+33123456789)', '[call](tel:+33123456789)'],
    ['a local file link', '[hosts](file:///etc/hosts)', '[hosts](file:///etc/hosts)'],
    ['a link of another application', '[open](x-app:open?id=1)', '[open](x-app:open?id=1)'],
    ['a scheme in capitals', '[page](FTP://EXAMPLE.COM)', '[page](FTP://EXAMPLE.COM)'],
    ['an address between angle brackets', '[page](<ftp://example.com/a b>)', '[page](<ftp://example.com/a b>)'],
    ['an escaped colon', '[page](ftp\\://example.com)', '[page](ftp\\://example.com)'],
    ['a colon written as a character reference', '[page](ftp&#58;//example.com)', '[page](ftp&#58;//example.com)'],
    ['a colon written as a named reference', '[page](ftp&colon;//example.com)', '[page](ftp&colon;//example.com)'],
    ['an automatic link', 'See <ftp://example.com/a>.', '<ftp://example.com/a>'],
    ['an image', '![Diagram](ftp://example.com/a.png)', '![Diagram](ftp://example.com/a.png)'],
    ['an image that is no inline image', '![Diagram](data:text/plain,abc)', '![Diagram](data:text/plain,abc)'],
    ['a link by reference', '[page][ref]\n\n[ref]: ftp://example.com/a', '[page][ref]'],
    ['a link definition alone', 'Text.\n\n[ref]: ftp://example.com/a', '[ref]: ftp://example.com/a'],
    ['a link in a table cell', table('[the file](ftp://example.com/a)'), '[the file](ftp://example.com/a)'],
    ['a link in a list in a quote', '> - [the file](ftp://example.com/a)', '[the file](ftp://example.com/a)'],
  ];
  for (const [name, text, example] of refused) {
    const refusal = refusalOf(text, 'notes');
    assert.equal(refusal?.code, MARKDOWN_HTML_NOT_ALLOWED, `${name} is refused`);
    assert.equal(refusal?.field, 'notes', name);
    assert.equal(refusal?.example, example, name);
  }

  // Code shows an address, it opens none.
  assertAccepted('an address in code', 'Use `[a](ftp://example.com)` or:\n\n```\n[a](ftp://example.com)\n```');
  // A stored text keeps what it holds.
  const stored = 'Read [the file](ftp://example.com/a).';
  assert.equal(normalizeMarkdownRichText(stored, { storedContent: true }), stored);
  // An inline image keeps its own refusal.
  assert.throws(() => normalizeMarkdownRichText('![x](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA)'), /inline base64 images/);
}

/** In a text read from another system, a link or an image with another address stays, as text. */
function testThirdPartyTextKeepsItsOtherAddressesAsText() {
  const kept = (text: string) => String(normalizeMarkdownRichText(text, { fieldName: 'description', thirdPartyText: true }));
  const cases: Array<[string, string, string]> = [
    [
      'a link among others',
      'Read [the file](ftp://example.com/a) and [the page](https://example.com/b), then <b>stop</b>.',
      'Read \\[the file](ftp://example.com/a) and [the page](https://example.com/b), then \\<b>stop\\</b>.',
    ],
    ['an automatic link', 'See <ftp://example.com/a> or <https://example.com/a>.', 'See \\<ftp://example.com/a> or <https://example.com/a>.'],
    ['an image', 'Before ![Diagram](ftp://example.com/a.png) after.', 'Before !\\[Diagram](ftp://example.com/a.png) after.'],
    ['a link by reference', '[page][ref] and [other][web]\n\n[ref]: ftp://example.com/a\n[web]: https://example.com', '\\[page][ref] and [other][web]\n\n\\[ref]: ftp://example.com/a\n[web]: https://example.com'],
    ['a link in a cell', table('[the file](ftp://example.com/a)'), table('\\[the file](ftp://example.com/a)').trim()],
  ];
  for (const [name, text, expected] of cases) {
    const stored = kept(text);
    assert.equal(stored, expected, name);
    assert.equal(refusalOf(stored), null, `${name}: the stored text passes the rule`);
    assert.equal(kept(stored), stored, `${name}: read again, the text stays the same`);
  }
}

function testTimeIsBoundedOnLongTexts() {
  const cases: Array<[string, string]> = [
    ['opening characters', '<a'.repeat(100_000)],
    ['open quotes', '<u>\n' + '<a "'.repeat(50_000)],
    ['accepted tags', '<u>x</u><br>'.repeat(15_000)],
    ['indented blocks', 'Text\n\n' + '        a<b\n'.repeat(15_000)],
    ['backtick runs', Array.from({ length: 400 }, (_, i) => '`'.repeat(i + 1) + ' <b>').join(' ')],
    ['open fences', '```\n<b>\n'.repeat(10_000)],
  ];
  for (const [name, text] of cases) {
    const start = process.hrtime.bigint();
    refusalOf(text);
    try {
      normalizeMarkdownRichText(text, { thirdPartyText: true });
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 1500, `${name}: ${ms.toFixed(0)} ms`);
  }
}

/** Every text of the sample data: CSV cells, documents, translated values. */
function sampleDataTexts(): Array<{ name: string; text: string }> {
  const root = backendPath('fixtures', 'fromage-co');
  const texts: Array<{ name: string; text: string }> = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const name = path.relative(root, file);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') visit(file);
      } else if (entry.name.endsWith('.md')) {
        texts.push({ name, text: fs.readFileSync(file, 'utf8') });
      } else if (entry.name.endsWith('.csv')) {
        const rows = parse(fs.readFileSync(file, 'utf8'), {
          delimiter: [';', ','], relax_column_count: true, relax_quotes: true, skip_empty_lines: true, bom: true,
        }) as string[][];
        rows.forEach((row, line) => row.forEach((cell, column) => {
          if (cell.trim()) texts.push({ name: `${name}:${line + 1}:${column + 1}`, text: cell });
        }));
      } else if (entry.name.endsWith('.json')) {
        const collect = (value: unknown, at: string) => {
          if (typeof value === 'string') texts.push({ name: `${name}:${at}`, text: value });
          else if (value && typeof value === 'object') {
            for (const [key, nested] of Object.entries(value)) collect(nested, `${at}.${key}`);
          }
        };
        collect(JSON.parse(fs.readFileSync(file, 'utf8')), '');
      }
    }
  };
  visit(root);
  return texts;
}

function testSampleDataIsAccepted() {
  const texts = sampleDataTexts();
  assert.ok(texts.length > 2000, `the sample data is found (${texts.length} texts)`);
  assert.ok(texts.some(({ text }) => text.includes('\n|')), 'the sample data holds a table');
  assert.ok(texts.some(({ text }) => text.includes('```')), 'the sample data holds a code block');
  for (const { name, text } of texts) {
    assert.equal(refusalOf(text), null, `${name} is accepted`);
  }
}

function run() {
  testElementsOutsideTheListAreRefusedEverywhere();
  testAcceptedElementsTakeNoAttribute();
  testTheListAndItsFormsAreThoseOfTheEditor();
  testAnAcceptedNameInAnotherFormIsRefusedInProse();
  testTheAcceptedListIsAccepted();
  testMarkdownAndCodeAreAccepted();
  testTheRefusalNamesTheFieldAndTheTag();
  testStoredContentKeepsWhatItHolds();
  testThirdPartyTextKeepsItsTagsAsText();
  testLinksAndImagesOpenWebMailOrRelativeAddresses();
  testThirdPartyTextKeepsItsOtherAddressesAsText();
  testTimeIsBoundedOnLongTexts();
  testSampleDataIsAccepted();
  console.log('rich-text-html-rule.spec: ok');
}

run();
