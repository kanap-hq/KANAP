import { describe, expect, it } from 'vitest';
import { RICH_TEXT_LINK_SCHEMES, richTextLinkAddress } from './richTextLinkAddress';

describe('richTextLinkAddress', () => {
  it('holds the schemes of the addresses a link opens', () => {
    expect(RICH_TEXT_LINK_SCHEMES).toEqual(['http', 'https', 'mailto', 'tel']);
  });

  it.each([
    'https://example.com/a?b=1#c',
    'HTTP://EXAMPLE.COM',
    'mailto:support@example.com',
    'tel:+33123456789',
    'TEL:+33123456789',
    '/portfolio/tasks/T-1/overview',
    '#deployment',
  ])('opens %s', (address) => {
    expect(richTextLinkAddress(` ${address} `)).toBe(address);
  });

  it.each([
    'sms:+33123456789',
    'ftp://example.com/a',
    'file:///etc/hosts',
    'data:text/plain,abc',
    'javascript:void 0',
    'x-app:open?id=1',
    'telephone:+33123456789',
    'page.md',
    '',
  ])('opens no address for %s', (address) => {
    expect(richTextLinkAddress(address)).toBeNull();
  });

  it('opens no address for a missing one', () => {
    expect(richTextLinkAddress(null)).toBeNull();
    expect(richTextLinkAddress(undefined)).toBeNull();
  });
});
