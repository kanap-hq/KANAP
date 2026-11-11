import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxJsxFromMarkdown } from 'mdast-util-mdx-jsx';
import { describe, expect, it } from 'vitest';
import { mdxJsx } from 'micromark-extension-mdx-jsx';
import { hasPotentiallyUnsafeMdxPaste, sanitizeMarkdownForMdxPaste, toEditorDisplayMarkdown } from './mdxPaste';

function expectMarkdownToParse(markdown: string) {
  expect(() => fromMarkdown(markdown, {
    extensions: [mdxJsx()],
    mdastExtensions: [mdxJsxFromMarkdown()],
  })).not.toThrow();
}

describe('mdxPaste', () => {
  it('detects plain-text paste that MDX misinterprets as JSX', () => {
    expect(hasPotentiallyUnsafeMdxPaste('172.30.2.1 <-> 10.18.199.11 : SMB')).toBe(true);
    expect(hasPotentiallyUnsafeMdxPaste('x<y')).toBe(true);
    expect(hasPotentiallyUnsafeMdxPaste('a < b')).toBe(false);
  });

  it('escapes literal angle-bracket text so it parses as markdown', () => {
    const markdown = sanitizeMarkdownForMdxPaste('172.30.2.1 <-> 10.18.199.11 : SMB');

    expect(markdown).toBe('172.30.2.1 \\<-> 10.18.199.11 : SMB');
    expectMarkdownToParse(markdown);
  });

  it('converts autolinks into markdown links', () => {
    const markdown = sanitizeMarkdownForMdxPaste('Docs: <https://example.com/docs>');

    expect(markdown).toBe('Docs: [https://example.com/docs](https://example.com/docs)');
    expectMarkdownToParse(markdown);
  });

  it('converts email autolinks into mailto links', () => {
    const markdown = sanitizeMarkdownForMdxPaste('Contact: <user@example.com>');

    expect(markdown).toBe('Contact: [user@example.com](mailto:user@example.com)');
    expectMarkdownToParse(markdown);
  });

  it('converts an automatic link with a web or mail scheme only', () => {
    expect(sanitizeMarkdownForMdxPaste('<HTTP://example.com/a> <mailto:user@example.com>'))
      .toBe('[HTTP://example.com/a](HTTP://example.com/a) [mailto:user@example.com](mailto:user@example.com)');

    const markdown = sanitizeMarkdownForMdxPaste('<ftp://example.com/a> <tel:+33123456789> <x-app:user@example.com>');

    expect(markdown).toBe('\\<ftp://example.com/a> \\<tel:+33123456789> \\<x-app:user@example.com>');
    expectMarkdownToParse(markdown);
  });

  it('leaves fenced and inline code untouched', () => {
    const markdown = sanitizeMarkdownForMdxPaste([
      'Inline: `<tag>` and `172.30.2.1 <-> 10.18.199.11`',
      '',
      '```txt',
      '172.30.2.1 <-> 10.18.199.11',
      '<tag>',
      '```',
    ].join('\n'));

    expect(markdown).toContain('`<tag>`');
    expect(markdown).toContain('`172.30.2.1 <-> 10.18.199.11`');
    expect(markdown).toContain('```txt\n172.30.2.1 <-> 10.18.199.11\n<tag>\n```');
    expectMarkdownToParse(markdown);
  });

  it('does not rewrite angle-bracket link destinations', () => {
    const markdown = sanitizeMarkdownForMdxPaste('[docs](<https://example.com/a path>)');

    expect(markdown).toBe('[docs](<https://example.com/a path>)');
    expectMarkdownToParse(markdown);
  });

  it('escapes a less-than sign right after an opening parenthesis', () => {
    const markdown = sanitizeMarkdownForMdxPaste('f(<y) et (voir <https://example.com/a>)');

    expect(markdown).toBe('f(\\<y) et (voir [https://example.com/a](https://example.com/a))');
    expectMarkdownToParse(markdown);
  });

  it('escapes a tag that only looks like a link destination', () => {
    const markdown = sanitizeMarkdownForMdxPaste('[docs](<section>texte</section>) et [docs](<https://example.com/a b> "titre")');

    expect(markdown).toBe('[docs](\\<section>texte\\</section>) et [docs](<https://example.com/a b> "titre")');
    expectMarkdownToParse(markdown);
  });

  it('leaves a fenced block untouched wherever it sits', () => {
    const blocks = [
      '1. Lancer :\n\n   ```bash\n   cat <<EOF > out.txt\n\n   <config a="1">\n   EOF\n   ```\n\n2. Suite',
      '* Lancer :\n  ```xml\n  <config a="1">\n\n  </config>\n  ```\n* Suite',
      '- ```xml\n  <config a="1">\n\n  </config>\n  ```',
      '> ```html\n> <div>x</div>\n>\n> <p>y</p>\n> ```',
      'Texte\n\n  ```html\n  <div>x</div>\n\n  <p>y</p>\n  ```\n\nSuite',
      '~~~html\n<div>x</div>\n\n<p>y</p>\n~~~',
      '````md\n```html\n<div>x</div>\n```\n\n<p>y</p>\n````',
      '```html\n<div>x</div>\n\n<p>y</p>\n`````',
    ];
    for (const block of blocks) {
      expect(toEditorDisplayMarkdown(block)).toBe(block);
      expect(toEditorDisplayMarkdown(`${block}\n\naprès <section>`)).toBe(`${block}\n\naprès \\<section>`);
    }
  });

  it('reads a fence left open as code to the end of the text', () => {
    const markdown = 'avant <section>\n\n```html\n<div>x</div>\n\n<p>y</p>';

    expect(toEditorDisplayMarkdown(markdown)).toBe('avant \\<section>\n\n```html\n<div>x</div>\n\n<p>y</p>');
  });

  it('reads no fence in a line of backticks followed by more backticks', () => {
    expect(toEditorDisplayMarkdown('```a``` <section>\n\n<div>')).toBe('```a``` \\<section>\n\n\\<div>');
  });

  it('closes an inline code span with a run of as many backticks', () => {
    expect(toEditorDisplayMarkdown('``a ` <b>`` <i>')).toBe('``a ` <b>`` \\<i>');
    expect(toEditorDisplayMarkdown('`` a ` <b> ` <i>')).toBe('`` a ` <b> ` \\<i>');
    expect(toEditorDisplayMarkdown('` a `` <b> ` <i> ``')).toBe('` a `` <b> ` \\<i> ``');
  });

  it('ends an inline code span at the end of its paragraph', () => {
    const markdown = sanitizeMarkdownForMdxPaste('un accent ` seul\n\n<section>texte</section>\n\nun autre ` plus loin');

    expect(markdown).toBe('un accent ` seul\n\n\\<section>texte\\</section>\n\nun autre ` plus loin');
    expectMarkdownToParse(markdown);
  });

  it('escapes the accepted rich text elements too, unless asked to keep them', () => {
    expect(sanitizeMarkdownForMdxPaste('<u>a</u> H<sub>2</sub>O<br>x<sup>2</sup>'))
      .toBe('\\<u>a\\</u> H\\<sub>2\\</sub>O\\<br>x\\<sup>2\\</sup>');
  });
});

describe('mdxPaste, accepted rich text elements kept', () => {
  const keep = (markdown: string) => sanitizeMarkdownForMdxPaste(markdown, { keepRichTextElements: true });

  it('keeps underline, subscript and superscript tags without attribute', () => {
    const markdown = keep('<u>a</u> H<sub>2</sub>O x<sup>2</sup>');

    expect(markdown).toBe('<u>a</u> H<sub>2</sub>O x<sup>2</sup>');
    expectMarkdownToParse(markdown);
  });

  it('writes every form of the line break as a closed tag', () => {
    const markdown = keep('a<br>b<br/>c<br />d');

    expect(markdown).toBe('a<br />b<br />c<br />d');
    expectMarkdownToParse(markdown);
  });

  it('keeps an image with its accepted attributes, as a closed tag', () => {
    expect(keep('<img height="40" width="60" alt="a" src="/api/x.png" />'))
      .toBe('<img height="40" width="60" alt="a" src="/api/x.png" />');
    const markdown = keep("<img src='https://example.com/x.png' title=\"t\">");

    expect(markdown).toBe("<img src='https://example.com/x.png' title=\"t\" />");
    expectMarkdownToParse(markdown);
  });

  it.each([
    ['an attribute on an accepted tag', '<u class="x">a</u>', '\\<u class="x">a\\</u>'],
    ['an attribute on a line break', 'a<br class="x">b', 'a\\<br class="x">b'],
    ['an accepted tag in capitals', '<U>a</U>', '\\<U>a\\</U>'],
    ['an accepted tag closed on itself', '<u/>a', '\\<u/>a'],
    ['a closing line break', 'a</br>b', 'a\\</br>b'],
    ['an image with another attribute', '<img src="/x.png" class="x">', '\\<img src="/x.png" class="x">'],
    ['an image without a source', '<img alt="a">', '\\<img alt="a">'],
    ['an image with a source that is no address', '<img src="x:y">', '\\<img src="x:y">'],
    ['an image with a size that is no number', '<img src="/x.png" width="100%">', '\\<img src="/x.png" width="100%">'],
    ['an image with an attribute without quotes', '<img src=/x.png>', '\\<img src=/x.png>'],
    ['another element', '<section>a</section>', '\\<section>a\\</section>'],
    ['an accepted tag that is never closed', 'H<sub>2</sub>O <u>a<br>b', 'H<sub>2</sub>O \\<u>a<br />b'],
    ['an accepted tag closed in another paragraph', '<u>a\n\nb</u>', '\\<u>a\n\nb\\</u>'],
    ['a closing tag without its opening tag', 'a</u> b', 'a\\</u> b'],
    ['accepted tags closed in the wrong order', '<u>a<sub>b</u>c</sub>', '\\<u>a<sub>b\\</u>c</sub>'],
  ])('escapes %s', (_name, given, expected) => {
    const markdown = keep(given);

    expect(markdown).toBe(expected);
    expectMarkdownToParse(markdown);
  });
});

describe('toEditorDisplayMarkdown', () => {
  it('keeps the accepted elements and escapes every other less-than sign', () => {
    const markdown = toEditorDisplayMarkdown(
      'si x <y alors <u>oui</u><br>voir <https://example.com/a> <!-- note -->',
    );

    expect(markdown).toBe(
      'si x \\<y alors <u>oui</u><br />voir [https://example.com/a](https://example.com/a) \\<!-- note -->',
    );
    expectMarkdownToParse(markdown);
  });

  it('escapes the accepted elements too in its plain form', () => {
    const markdown = toEditorDisplayMarkdown('**<u>gras**</u><br>', { plain: true });

    expect(markdown).toBe('**\\<u>gras**\\</u>\\<br>');
    expectMarkdownToParse(markdown);
  });

  it('escapes a less-than sign that ends the text or its line and leaves one before a space', () => {
    expect(toEditorDisplayMarkdown('a <')).toBe('a \\<');
    expect(toEditorDisplayMarkdown('a < b <\nc <\u00a05')).toBe('a < b \\<\nc \\<\u00a05');
  });

  it('leaves a text whose only tags are in code as it is', () => {
    const markdown = '# Titre\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n* [x] fait\n\n```html\n<form action="x"></form>\n```\n\n`<b>`';

    expect(toEditorDisplayMarkdown(markdown)).toBe(markdown);
  });
});

describe('the display form of a long text', () => {
  const size = 200 * 1024;
  const LONG_TEXTS: Array<[string, string]> = [
    ['less-than signs', '<'.repeat(size)],
    ['the start of an e-mail address followed by dots', `<a@${'.'.repeat(size)}`],
    ['openings of a tag', '<a'.repeat(size / 2)],
    ['openings of a link destination', '](<'.repeat(Math.floor(size / 3))],
    ['underline tags that are never closed', '<u>'.repeat(Math.floor(size / 3))],
    ['openings of an automatic link', '<x://'.repeat(Math.floor(size / 5))],
    ['an e-mail address followed by dotted names', `<a@b${'.c'.repeat(size / 2)}`],
    ['openings of an image attribute', '<img a="'.repeat(size / 8)],
    ['backtick runs of growing lengths', Array.from({ length: 630 }, (_, index) => `${'`'.repeat(index + 1)}a`).join(' ')],
  ];

  it.each(LONG_TEXTS)('is ready in less than 200 ms for 200 KB of %s', (_name, text) => {
    const start = performance.now();
    const display = toEditorDisplayMarkdown(text);
    const elapsed = performance.now() - start;

    expect(display.length).toBeGreaterThanOrEqual(text.length);
    expect(elapsed).toBeLessThan(200);
  });

  it('escapes each less-than sign and each tag left open of a long text', () => {
    expect(toEditorDisplayMarkdown('<'.repeat(1000))).toBe('\\<'.repeat(1000));
    expect(toEditorDisplayMarkdown('<u>'.repeat(1000))).toBe('\\<u>'.repeat(1000));
    expect(toEditorDisplayMarkdown(`<a@${'.'.repeat(1000)}`)).toBe(`\\<a@${'.'.repeat(1000)}`);
    expect(toEditorDisplayMarkdown('](<'.repeat(1000))).toBe('](\\<'.repeat(1000));
  });
});
