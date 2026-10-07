import * as assert from 'node:assert/strict';
import { sanitizeRichHtmlForEmail } from '../html-sanitizer';
import { renderMarkdownToHtml } from '../markdown-to-html';

// Mirrors the allow lists in ../html-sanitizer.ts.
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 'span', 'strong',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'name', 'target', 'rel']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
};

function assertOnlyAllowedMarkup(input: string, output: string) {
  const tagPattern = /<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(output)) !== null) {
    const tag = match[1].toLowerCase();
    assert.ok(ALLOWED_TAGS.has(tag), `tag <${tag}> is outside the allow list (input ${input}, output ${output})`);
    const attributePattern = /([^\s=/"']+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributePattern.exec(match[2])) !== null) {
      const attribute = attributeMatch[1].toLowerCase();
      assert.ok(
        ALLOWED_ATTRIBUTES[tag]?.has(attribute) ?? false,
        `attribute ${attribute} on <${tag}> is outside the allow list (input ${input}, output ${output})`,
      );
    }
  }
}

function run() {
  const sanitized = sanitizeRichHtmlForEmail('<p onclick="alert(1)">Hi <a href="javascript:alert(1)">bad</a><script>x</script></p>');
  assert.equal(sanitized.includes('onclick'), false);
  assert.equal(sanitized.includes('javascript:'), false);
  assert.equal(sanitized.includes('<script'), false);

  const markdown = renderMarkdownToHtml('[bad](javascript:alert(1))');
  assert.equal(markdown.includes('javascript:'), false);

  // Elements outside the allow list whose content the HTML parser reads as raw text.
  for (const element of ['xmp', 'noembed', 'noframes', 'iframe', 'noscript', 'textarea', 'title', 'style', 'script']) {
    const input = `<p>Before</p><${element}><img src="photo.png" title="Photo"><span class="note">Note</span></${element}><p>After</p>`;
    const output = sanitizeRichHtmlForEmail(input);
    assertOnlyAllowedMarkup(input, output);
    assert.ok(output.includes('<p>Before</p>'), `content before <${element}> is kept`);
    assert.ok(output.includes('<p>After</p>'), `content after <${element}> is kept`);
  }

  const unclosed = '<p>Text</p><plaintext><img src="photo.png"><b>bold</b>';
  assertOnlyAllowedMarkup(unclosed, sanitizeRichHtmlForEmail(unclosed));

  // Attributes outside the allow list are dropped; allowed ones are kept.
  const attributes = sanitizeRichHtmlForEmail(
    '<p class="lead" style="color:red" data-id="1" id="intro">Text</p>'
    + '<a href="https://example.com/page" title="Page" style="color:red" data-track="1">Link</a>'
    + '<table><tbody><tr><td colspan="2" width="10" bgcolor="#fff">Cell</td></tr></tbody></table>',
  );
  assertOnlyAllowedMarkup('attributes', attributes);
  assert.ok(attributes.includes('<p>Text</p>'));
  assert.ok(attributes.includes('href="https://example.com/page"'));
  assert.ok(attributes.includes('rel="noopener noreferrer"'));
  assert.ok(attributes.includes('<td colspan="2">Cell</td>'));

  // Ordinary content stays as written.
  assert.equal(
    sanitizeRichHtmlForEmail('<ul><li>Réunion à <strong>jeudi</strong></li><li><code>x &lt; y</code></li></ul>'),
    '<ul><li>Réunion à <strong>jeudi</strong></li><li><code>x &lt; y</code></li></ul>',
  );
}

run();
