import { describe, expect, it } from 'vitest';
import { matchRichTextHtmlTag, RICH_TEXT_HTML_ELEMENTS } from './richTextHtmlElements';

/**
 * The list and the forms below are a copy of what the server accepts and refuses when a rich text
 * is saved (`backend/src/common/__tests__/rich-text-html-rule.spec.ts` holds the same copy). A
 * change of the list or of a form is made on both sides, in the code and in both tests.
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

describe('the HTML elements of a rich text', () => {
  it('are the list the server accepts', () => {
    expect(RICH_TEXT_HTML_ELEMENTS).toEqual(ACCEPTED_LIST);
  });

  it.each(ACCEPTED_FORMS)('reads %s as an element', (form) => {
    expect(matchRichTextHtmlTag(form)?.length).toBe(form.length);
  });

  it.each(REFUSED_FORMS)('reads %s as text', (form) => {
    expect(matchRichTextHtmlTag(form)).toBeNull();
  });

  it('reads the tag at the start of a longer text', () => {
    expect(matchRichTextHtmlTag('<u>souligné</u>')).toEqual({ length: 3, tag: '<u>', name: 'u', closing: false });
    expect(matchRichTextHtmlTag('</sub> suite')).toEqual({ length: 6, tag: '</sub>', name: 'sub', closing: true });
    expect(matchRichTextHtmlTag('<br>suite')?.tag).toBe('<br />');
    expect(matchRichTextHtmlTag('<img src="/a.png" alt="a">suite')?.tag).toBe('<img src="/a.png" alt="a" />');
  });
});
