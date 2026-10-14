import * as assert from 'node:assert/strict';
import { decodeHtmlEntities, decodeNumericHtmlEntities, HTML_TEXT_ENTITIES } from '../html-entities';

function run() {
  assert.equal(decodeNumericHtmlEntities('A &#38; B &#60; C &#62; D'), 'A & B < C > D');
  assert.equal(decodeNumericHtmlEntities('Quote: &#34;hello&#34;'), 'Quote: "hello"');
  assert.equal(decodeNumericHtmlEntities('Hex &#x26; mixed &#X3c;'), 'Hex & mixed <');
  assert.equal(decodeNumericHtmlEntities('A&#160;B'), 'A B');
  assert.equal(decodeNumericHtmlEntities('Keep &#0; and &#1114112; and &#x110000; and &#55296;'), 'Keep &#0; and &#1114112; and &#x110000; and &#55296;');
  assert.equal(decodeNumericHtmlEntities('&amp; &lt; &nbsp;'), '&amp; &lt; &nbsp;');
  assert.equal(decodeNumericHtmlEntities('&#38;lt; &#x26;#60;'), '&lt; &#60;');
}

function decodesEachReferenceOnce() {
  const text = { entities: HTML_TEXT_ENTITIES, ignoreCase: true };
  const cases: Array<[string, Parameters<typeof decodeHtmlEntities>[1], string]> = [
    ['Tom &amp; Jerry &lt;3 &quot;cats&quot; it&#39;s&nbsp;fine &gt;', text, 'Tom & Jerry <3 "cats" it\'s fine >'],
    ['&amp;lt;b&amp;gt; stays escaped', text, '&lt;b&gt; stays escaped'],
    ['&amp;amp; &amp;quot; &amp;#39; &amp;nbsp;', text, '&amp; &quot; &#39; &nbsp;'],
    ['&AMP; &Lt; &QUOT;', text, '& < "'],
    ['&AMP; &amp;', { entities: { amp: '&' } }, '&AMP; &'],
    ['&copy; &unknown; &amp &#39 & ; &;', text, '&copy; &unknown; &amp &#39 & ; &;'],
    ['&#60; &#x3C; &#039;', text, '&#60; &#x3C; &#039;'],
    ['&#60;&#X3c;&#x1F600;&#233;', { numeric: true }, '<<\u{1F600}é'],
    ['&#38;lt; stays &#x26;amp;', { numeric: true }, '&lt; stays &amp;'],
    ['&#0; &#xD800; &#1114112; &#x110000; &#xZZ; &#;', { numeric: true }, '&#0; &#xD800; &#1114112; &#x110000; &#xZZ; &#;'],
    ['&#60; &#039; &lt;', { entities: { '#60': '<', '#039': '\'' } }, '< \' &lt;'],
    ['a &lt; b', { entities: { ...HTML_TEXT_ENTITIES, lt: '[' }, ignoreCase: true }, 'a [ b'],
    ['&toString; &constructor;', text, '&toString; &constructor;'],
  ];
  for (const [input, options, expected] of cases) {
    assert.equal(decodeHtmlEntities(input, options), expected, input);
  }
  assert.equal(decodeHtmlEntities(null as unknown as string), '');
}

run();
decodesEachReferenceOnce();
