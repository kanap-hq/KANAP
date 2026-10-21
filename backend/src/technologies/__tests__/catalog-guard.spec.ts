import * as assert from 'node:assert/strict';
import { DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { CPE_PRODUCT_RE } from '../technology-rows';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { cpeProduct } from '../../vulnerabilities/vulnerability-rules';

// Guards of the shipped catalog: unique keys, families the tenants can list, and the fields that
// separate a KANAP-maintained product from an endoflife.date entry. The slash test is the matcher:
// an NVD criterion written `purity\/\/fa` is the same identifier a technology stores.

const shipped = new TechnologyCatalogService({} as any, {} as any).all();
const FAMILY_CODES = new Set(DEFAULT_TECHNOLOGY_FAMILIES.map((item) => item.code));

function testUniqueKeys() {
  const keys = shipped.map((product) => product.key);
  assert.equal(new Set(keys).size, keys.length, 'product keys');
  assert.ok(keys.length >= 186, `the shipped catalog has its products (${keys.length})`);
  for (const product of shipped) {
    const versionKeys = product.versions.map((version) => version.key);
    assert.equal(new Set(versionKeys).size, versionKeys.length, `${product.key} version keys`);
    const labels = product.versions.map((version) => version.label.toLowerCase());
    assert.equal(new Set(labels).size, labels.length, `${product.key} labels`);
  }
}

function testFamilies() {
  assert.ok(FAMILY_CODES.has('network'));
  assert.ok(FAMILY_CODES.has('network_security'));
  for (const product of shipped) {
    assert.ok(FAMILY_CODES.has(product.family), `${product.key} family ${product.family}`);
  }
}

function testCuratedFields() {
  let curated = 0;
  for (const product of shipped) {
    const maintained = Object.prototype.hasOwnProperty.call(product, 'source_updated');
    const endoflife = (product.source_url ?? '').startsWith('https://endoflife.date/');
    if (maintained) {
      curated += 1;
      assert.equal(endoflife, false, `${product.key} source`);
      assert.ok(product.source_url && /^https?:\/\//.test(product.source_url), `${product.key} lifecycle`);
      assert.ok(product.versions.length > 0, product.key);
      for (const version of product.versions) {
        assert.match(version.source_url ?? '', /^https?:\/\/\S+$/, `${product.key} ${version.label} source_url`);
        assert.match(version.checked_on ?? '', /^\d{4}-\d{2}-\d{2}$/, `${product.key} ${version.label} checked_on`);
      }
    } else {
      for (const version of product.versions) {
        assert.equal(version.source_url, undefined, `${product.key} ${version.label}`);
        assert.equal(version.checked_on, undefined, `${product.key} ${version.label}`);
        assert.equal(version.no_planned_end, undefined, `${product.key} ${version.label}`);
      }
    }
  }
  assert.equal(curated, 17);
}

/**
 * The page where the distributor tracks vulnerabilities. Windows Server, CentOS, AIX, IBM i and
 * Solaris have none. No other family carries the field.
 */
function testSecurityTrackers() {
  const trackers: Record<string, string> = {
    ubuntu: 'https://ubuntu.com/security/cves',
    rhel: 'https://access.redhat.com/security/security-updates/cve',
    debian: 'https://security-tracker.debian.org/tracker/',
    sles: 'https://www.suse.com/security/cve/',
    'rocky-linux': 'https://errata.rockylinux.org/',
    almalinux: 'https://errata.almalinux.org/',
    'oracle-linux': 'https://linux.oracle.com/security/',
    'amazon-linux': 'https://alas.aws.amazon.com/',
    'alpine-linux': 'https://security.alpinelinux.org/',
  };
  const none = new Set(['windows-server', 'centos', 'ibm-aix', 'ibm-i', 'oracle-solaris']);
  for (const product of shipped) {
    if (product.family !== 'operating_system') {
      assert.equal(product.security_tracker, undefined, product.key);
      continue;
    }
    if (none.has(product.key)) assert.equal(product.security_tracker, undefined, product.key);
    else assert.equal(product.security_tracker, trackers[product.key], product.key);
  }
}

/** `a:purestorage:purity\/\/fa` read from a criterion that writes the slash the same way. */
function testEscapedSlashIdentifier() {
  const stored = 'a:purestorage:purity\\/\\/fa';
  const parsed = cpeProduct(`cpe:2.3:${stored}:6.5.0:*:*:*:*:*:*:*`);
  assert.deepEqual(parsed, { product: stored, version: '6.5.0' });
  assert.equal(CPE_PRODUCT_RE.test(stored), true);
  assert.equal(parsed!.product, stored);
}

function main() {
  testUniqueKeys();
  testFamilies();
  testCuratedFields();
  testSecurityTrackers();
  testEscapedSlashIdentifier();
  console.log('catalog-guard.spec: ok');
}

main();
