import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { normalizeNetboxBaseUrl } from '../netbox.client';
import { NETBOX_ADDRESS_MAX_LENGTH, normalizeNetboxAddress } from '../netbox-config.service';

// The Netbox address an administrator types: trimmed, trailing slashes removed,
// and limited in length with a clear message.

// Trailing slashes go, the rest of the address stays as typed.
assert.equal(normalizeNetboxBaseUrl('https://netbox.example.test/'), 'https://netbox.example.test');
assert.equal(normalizeNetboxBaseUrl('  https://netbox.example.test/api///  '), 'https://netbox.example.test/api');
assert.equal(normalizeNetboxBaseUrl('https://netbox.example.test/a//b'), 'https://netbox.example.test/a//b');
assert.equal(normalizeNetboxBaseUrl('https://netbox.example.test'), 'https://netbox.example.test');
assert.equal(normalizeNetboxBaseUrl('///'), '');
assert.equal(normalizeNetboxBaseUrl(''), '');
assert.equal(normalizeNetboxBaseUrl(undefined as unknown as string), '');

assert.equal(normalizeNetboxAddress('https://netbox.example.test/netbox/'), 'https://netbox.example.test/netbox');

// An address of exactly the maximum length is accepted.
const prefix = 'https://netbox.example.test/';
const atLimit = prefix + 'a'.repeat(NETBOX_ADDRESS_MAX_LENGTH - prefix.length);
assert.equal(atLimit.length, NETBOX_ADDRESS_MAX_LENGTH);
assert.equal(normalizeNetboxAddress(atLimit), atLimit);
// Surrounding spaces do not count.
assert.equal(normalizeNetboxAddress(`  ${atLimit}  `), atLimit);

// One character more is refused with a message that states the limit.
assert.throws(
  () => normalizeNetboxAddress(`${atLimit}a`),
  (err: unknown) =>
    err instanceof BadRequestException
    && /at most 2048 characters/.test(String((err as BadRequestException).message)),
  'an address longer than the limit is refused',
);
// Trailing slashes past the limit count too: the length is checked before normalisation.
assert.throws(
  () => normalizeNetboxAddress(`${atLimit}/`),
  (err: unknown) => err instanceof BadRequestException,
);

assert.equal(NETBOX_ADDRESS_MAX_LENGTH, 2048);

console.log('netbox address normalisation: ok');
