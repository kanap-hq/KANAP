import * as assert from 'node:assert/strict';
import { offeredCatalogList, offeredCatalogOptions, resolveOfferedCatalogCode, resolveOfferedCatalogCodes } from '../catalog-resolve';

// Rule P7 (maintainer, 2026-11-23): a value retired from a catalog is refused everywhere, except on
// the record that already holds it. A value the catalog does not know is refused with the list of
// the values the record may take, unless the record already holds it.

const options = [
  { code: 'web', label: 'Web' },
  { code: 'vdi', label: 'VDI / Remote Desktop', translations: { fr: { label: 'Bureau à distance' } } },
  { code: 'kiosk', label: 'Kiosk', deprecated: true },
];

// The offered entries: active ones, plus a retired one only for the record that holds it.
assert.deepEqual(offeredCatalogOptions(options).map((o) => o.code), ['web', 'vdi']);
assert.deepEqual(offeredCatalogOptions(options, 'kiosk').map((o) => o.code), ['web', 'vdi', 'kiosk']);
assert.deepEqual(offeredCatalogOptions(options, ['web', 'KIOSK']).map((o) => o.code), ['web', 'vdi', 'kiosk']);
assert.equal(offeredCatalogList(options), 'web (Web), vdi (VDI / Remote Desktop)');

// A code, a name, a tenant translation resolve to the code.
assert.equal(resolveOfferedCatalogCode('VDI', options, { what: 'access method' }), 'vdi');
assert.equal(resolveOfferedCatalogCode('Bureau à distance', options, { what: 'access method' }), 'vdi');
assert.equal(resolveOfferedCatalogCode(' web ', options, { what: 'access method' }), 'web');

// Unknown: refused with the list of offered values.
assert.throws(
  () => resolveOfferedCatalogCode('Citrix', options, { what: 'access method' }),
  /Unknown access method "Citrix"\. Use one of: web \(Web\), vdi \(VDI \/ Remote Desktop\)\./,
);
// Retired: refused on a record that does not hold it, kept on the one that does.
assert.throws(
  () => resolveOfferedCatalogCode('Kiosk', options, { what: 'access method', held: 'web' }),
  /The access method "Kiosk" is retired: only a record that already holds it keeps it\. Use one of: web \(Web\), vdi/,
);
assert.equal(resolveOfferedCatalogCode('kiosk', options, { what: 'access method', held: ['kiosk'] }), 'kiosk');
assert.equal(resolveOfferedCatalogCode('Kiosk', options, { what: 'access method', held: 'kiosk' }), 'kiosk');
// A value stored before the catalog changed stays on its record, as stored.
assert.equal(resolveOfferedCatalogCode('citrix', options, { what: 'access method', held: ['Citrix'] }), 'Citrix');
assert.throws(() => resolveOfferedCatalogCode('Citrix', options, { what: 'access method', held: ['web'] }), /Unknown access method/);

// A coded refusal built by the caller, which knows whether the value was retired.
const refusals: Array<{ retired: boolean; value: string; allowed: string }> = [];
const refuse = (message: string, refusal: { retired: boolean; value: string; allowed: string }) => {
  refusals.push(refusal);
  return new Error(`coded: ${message}`);
};
assert.throws(() => resolveOfferedCatalogCode('kiosk', options, { what: 'access method', refuse }), /^Error: coded: The access method/);
assert.throws(() => resolveOfferedCatalogCode('nope', options, { what: 'access method', refuse }), /^Error: coded: Unknown/);
assert.deepEqual(refusals.map((r) => [r.retired, r.value]), [[true, 'kiosk'], [false, 'nope']]);

// Lists: each value resolved, duplicates and blanks dropped; the record's held values kept.
assert.deepEqual(resolveOfferedCatalogCodes(['Web', 'web', '', 'Bureau à distance'], options, { what: 'access method' }), ['web', 'vdi']);
assert.deepEqual(resolveOfferedCatalogCodes(['kiosk', 'web'], options, { what: 'access method', held: ['kiosk'] }), ['kiosk', 'web']);
assert.throws(() => resolveOfferedCatalogCodes(['web', 'kiosk'], options, { what: 'access method', held: ['web'] }), /retired/);
assert.deepEqual(resolveOfferedCatalogCodes(null, options, { what: 'access method' }), []);

console.log('catalog-offered.spec.ts passed');
