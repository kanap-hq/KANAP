import * as assert from 'node:assert/strict';
import { contentDisposition } from '../content-disposition';

// The Content-Disposition value of a download: a plain ASCII name stays a single
// quoted `filename`; a name with `\`, `"` or a non-ASCII character keeps a quoted
// form where `\` and `"` are escaped, plus a `filename*` form with the exact name.

assert.equal(contentDisposition(''), 'attachment');
assert.equal(contentDisposition('', 'inline'), 'inline');
assert.equal(contentDisposition('report 2026.csv'), 'attachment; filename="report 2026.csv"');
assert.equal(contentDisposition('logo.png', 'inline'), 'inline; filename="logo.png"');

assert.equal(
  contentDisposition('say "hi".txt'),
  `attachment; filename="say \\"hi\\".txt"; filename*=UTF-8''say%20%22hi%22.txt`,
);
assert.equal(
  contentDisposition('dir\\name.txt'),
  `attachment; filename="dir\\\\name.txt"; filename*=UTF-8''dir%5Cname.txt`,
  'a backslash is escaped in the quoted form and kept exactly in filename*',
);
assert.equal(
  contentDisposition('end\\'),
  `attachment; filename="end\\\\"; filename*=UTF-8''end%5C`,
  'a trailing backslash does not escape the closing quote',
);
assert.equal(
  contentDisposition('a\\"b'),
  `attachment; filename="a\\\\\\"b"; filename*=UTF-8''a%5C%22b`,
);
assert.equal(
  contentDisposition("Budget été l'an.xlsx"),
  `attachment; filename="Budget _t_ l'an.xlsx"; filename*=UTF-8''Budget%20%C3%A9t%C3%A9%20l%27an.xlsx`,
);

// The quoted form never ends on an unescaped backslash and holds no bare quote.
for (const name of ['a\\', 'a"', '\\"', '"\\', 'x\\\\"y', 'naïve\\']) {
  const value = contentDisposition(name);
  const quoted = /filename="((?:[^"\\]|\\.)*)"/.exec(value);
  assert.ok(quoted, `the quoted form is well formed for ${JSON.stringify(name)}: ${value}`);
  assert.ok(value.includes("filename*=UTF-8''"), `filename* is present for ${JSON.stringify(name)}`);
  const unescaped = quoted![1].replace(/\\(.)/g, '$1');
  assert.equal(unescaped, name.replace(/[^\x20-\x7E]/g, '_'), `the quoted form reads back to the name for ${JSON.stringify(name)}`);
}

console.log('content-disposition.spec: ok');
