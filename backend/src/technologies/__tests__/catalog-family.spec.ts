import * as assert from 'node:assert/strict';
import { catalogFamilyForTenant } from '../catalog/catalog-releases';

/** Codes of a tenant's technology family list, as adoption reads them. */
function families(...codes: string[]) {
  return codes.map((code) => ({ code }));
}

/**
 * Adoption keeps the catalog family when the tenant lists it. `network` falls back to
 * `network_security` on a list saved before that code existed. Any other missing family is `other`.
 */
function main() {
  assert.equal(catalogFamilyForTenant('network', families('network', 'network_security', 'other')), 'network');
  assert.equal(catalogFamilyForTenant('network', families('network_security', 'storage', 'other')), 'network_security');
  assert.equal(catalogFamilyForTenant('network', families('storage', 'other')), 'other');
  assert.equal(catalogFamilyForTenant('network', []), 'other');
  assert.equal(catalogFamilyForTenant('network', null), 'other');
  assert.equal(catalogFamilyForTenant('database', families('network_security', 'other')), 'other');
  assert.equal(catalogFamilyForTenant('storage', families('storage', 'other')), 'storage');
  assert.equal(catalogFamilyForTenant('network_security', families('network_security', 'other')), 'network_security');
  console.log('catalog-family.spec: ok');
}

main();
