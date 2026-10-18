import * as assert from 'node:assert/strict';
import { OS_PRODUCTS, SHIPPED_OS_CODES } from '../../migrations/1854330000000-operating-system-technology';
import * as shipped from '../catalog/technologies.catalog.json';
import * as descriptions from '../catalog/technologies.descriptions.json';
import {
  OPERATING_SYSTEM_CODES,
  humanizeOperatingSystemCode,
  operatingSystemLabel,
  operatingSystemLabelSql,
  snakeCaseOperatingSystemLabel,
  splitOperatingSystemLabel,
} from '../operating-system-codes';

// The migration carries its own copy of the shipped codes and of the operating-system products.
// A migration does not import application code, so the two copies are checked here.

const catalog = (shipped as { products: Array<{ key: string; name: string; editor: string; family: string; versions: Array<{ key: string; label: string; cpe_version: string | null; standard_support_end: string | null; extended_support_end: string | null }> }> }).products;
const texts = (descriptions as { descriptions: Record<string, { en?: string }> }).descriptions;

function testCodesMatch() {
  assert.equal(OPERATING_SYSTEM_CODES.length, 19);
  assert.deepEqual(OPERATING_SYSTEM_CODES, SHIPPED_OS_CODES);
  for (const entry of OPERATING_SYSTEM_CODES) {
    const product = catalog.find((item) => item.key === entry.product);
    assert.ok(product, entry.product);
    assert.ok(product!.versions.some((version) => version.label === entry.version), `${entry.code} → ${entry.version}`);
  }
}

function testLabels() {
  assert.deepEqual(splitOperatingSystemLabel('VMware ESXi 8.0'), { name: 'VMware ESXi', version: '8.0' });
  assert.deepEqual(splitOperatingSystemLabel('FortiOS 7.4'), { name: 'FortiOS', version: '7.4' });
  assert.deepEqual(splitOperatingSystemLabel('Cisco Meraki'), { name: 'Cisco Meraki', version: null });
  assert.deepEqual(splitOperatingSystemLabel('Ubuntu 22.04 LTS'), { name: 'Ubuntu 22.04 LTS', version: null });
  assert.equal(humanizeOperatingSystemCode('foo_bar_2'), 'foo bar 2');
  assert.equal(snakeCaseOperatingSystemLabel('VMware ESXi 8.0'), 'vmware_esxi_8_0');
  assert.equal(operatingSystemLabel('Windows Server', '2019'), 'Windows Server 2019');
  assert.equal(operatingSystemLabel('Cisco Meraki', null), 'Cisco Meraki');
  const sql = operatingSystemLabelSql('a');
  assert.match(sql, /at\.is_operating_system/);
  assert.match(sql, /at\.asset_id = a\.id/);
  assert.throws(() => operatingSystemLabelSql('a;drop'), /Unsafe asset alias/);
}

function testFrozenProductsMatchTheCatalog() {
  assert.equal(OS_PRODUCTS.length, 9);
  for (const frozen of OS_PRODUCTS) {
    const product = catalog.find((item) => item.key === frozen.key);
    assert.ok(product, frozen.key);
    assert.equal(frozen.name, product!.name);
    assert.equal(frozen.editor, product!.editor);
    assert.equal(frozen.family, 'operating_system');
    assert.equal(frozen.description, texts[frozen.key]?.en);
    assert.deepEqual(
      frozen.versions.map((version) => ({
        key: version.key,
        label: version.label,
        cpe_version: version.cpe_version,
        standard_support_end: version.standard_support_end,
        extended_support_end: version.extended_support_end,
      })),
      product!.versions.map((version) => ({
        key: version.key,
        label: version.label,
        cpe_version: version.cpe_version,
        standard_support_end: version.standard_support_end,
        extended_support_end: version.extended_support_end,
      })),
    );
  }
}

testCodesMatch();
testLabels();
testFrozenProductsMatchTheCatalog();
console.log('operating-system-codes.spec: ok');
