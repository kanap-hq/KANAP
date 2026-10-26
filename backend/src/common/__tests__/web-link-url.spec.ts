import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { assertWebLinkUrl, webLinkUrlsOf } from '../web-link-url';

function refused(value: string): { code: string; params: { value: string } } {
  try {
    assertWebLinkUrl(value);
  } catch (err) {
    assert.ok(err instanceof BadRequestException, String(err));
    return (err as BadRequestException).getResponse() as { code: string; params: { value: string } };
  }
  assert.fail(`expected a refusal for ${value}`);
}

const accepted = ['https://example.com/qa-c4', 'HTTP://intranet/sql', 'https://learn.microsoft.com/sql', 'http://[2001:db8::1]/path'];
for (const url of accepted) {
  assert.equal(assertWebLinkUrl(` ${url} `), url, url);
}

assert.equal(assertWebLinkUrl(''), '');
assert.equal(assertWebLinkUrl('   '), '');
assert.equal(assertWebLinkUrl(null), '');

// An address typed without a scheme gets https://, a host and its port included.
assert.equal(assertWebLinkUrl('www.vmware.com'), 'https://www.vmware.com');
assert.equal(assertWebLinkUrl(' www.vmware.com/support '), 'https://www.vmware.com/support');
assert.equal(assertWebLinkUrl('intranet:8080/wiki'), 'https://intranet:8080/wiki');
assert.equal(assertWebLinkUrl('localhost:3000'), 'https://localhost:3000');

for (const url of [
  'pas une url', 'javascript:alert(1)', 'JavaScript:void(0)', 'data:text/html,<b>x</b>', 'ftp://files.example.test',
  'vbscript:msgbox', 'mailto:someone@example.com', 'http://', 'https://', 'https:evil.example', 'http:\\\\evil',
  'http:/evil.example', 'https:///evil.example', 'http://evil\\@good.example', '//evil.example', '/relative/path',
]) {
  const error = refused(url);
  assert.equal(error.code, 'link_url_invalid', url);
  assert.equal(error.params.value, url, url);
}

// A list of links: each address checked, a blank one dropped, a bad one refuses the whole list.
assert.deepEqual(
  webLinkUrlsOf([{ url: 'www.vmware.com', label: 'VMware' }, { url: '  ' }, { url: 'https://example.com' }]),
  [{ url: 'https://www.vmware.com', label: 'VMware' }, { url: 'https://example.com' }],
);
assert.throws(() => webLinkUrlsOf([{ url: 'https://example.com' }, { url: 'javascript:alert(1)' }]), BadRequestException);

console.log('web link url tests passed');
