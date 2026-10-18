import * as assert from 'node:assert/strict';
import { assetCsvConfig } from '../../assets/asset-csv.config';
import { findCatalogOption, resolveCatalogCode } from '../catalog-resolve';
import { resolveClassificationOption } from '../classification-catalog';
import { withShippedLabels } from '../catalog-shipped-labels';

// Imports accept a shipped catalog value under the label the app shows for it in any language
// ("Serveur physique" for the shipped "Physical Server") while the tenant keeps the shipped label.
// A value the tenant renamed answers to its own name only, and a tenant value whose own name or
// code matches wins over a shipped label, so nothing that resolved before becomes ambiguous.

const settings: any = {
  serverKinds: [
    { code: 'physical_server', label: 'Physical Server', is_physical: true },
    { code: 'virtual_machine', label: 'VM', is_physical: false },
    { code: 'access_point', label: 'Access Point', is_physical: true },
    { code: 'borne', label: "Point d'accès", is_physical: true },
  ],
  lifecycleStates: [
    { code: 'proposed', label: 'Proposed' },
    { code: 'active', label: 'Active' },
  ],
  dataClasses: [
    { code: 'internal', label: 'Internal', rank: 2 },
    { code: 'confidential', label: 'Confidential', rank: 3 },
  ],
  domains: [],
  ipAddressTypes: [{ code: 'management', label: 'Management' }],
};

async function run() {
  const shipped = withShippedLabels(settings);

  assert.equal(findCatalogOption('Serveur physique', shipped.serverKinds)?.code, 'physical_server', 'French label of a shipped value');
  assert.equal(findCatalogOption('physischer server', shipped.serverKinds)?.code, 'physical_server', 'German label, any case');
  assert.equal(findCatalogOption('Physical server', shipped.serverKinds)?.code, 'physical_server', 'the English display label');
  assert.equal(findCatalogOption('Machine virtuelle', shipped.serverKinds), null, 'a renamed value answers to its own name only');
  assert.equal(findCatalogOption('VM', shipped.serverKinds)?.code, 'virtual_machine');
  assert.equal(findCatalogOption("Point d'accès", shipped.serverKinds)?.code, 'borne', 'a tenant value named like a translation wins');
  assert.equal(resolveCatalogCode('Machine virtuelle', shipped.serverKinds), 'Machine virtuelle', 'an unknown value is returned as typed, as before');
  assert.equal(findCatalogOption('Serveur physique', settings.serverKinds), null, 'the raw catalogs carry no shipped labels');

  assert.equal(resolveClassificationOption('Confidentiel', shipped.dataClasses), 'confidential', 'classification levels too');

  // The asset import resolves the type and the status typed as a French user sees them.
  const entities = [{ name: 'srv-01', kind: 'Serveur physique', status: 'Actif', ip_addresses: [{ ip: '10.0.0.1', type: 'Administration' }] }];
  await assetCsvConfig.beforeCommit!(entities, { itOpsSettings: settings, manager: { query: async () => [] }, tenantId: 't' } as any);
  assert.equal(entities[0].kind, 'physical_server');
  assert.equal(entities[0].status, 'active');
  assert.equal((entities[0].ip_addresses as any)[0].type, 'management');
  console.log('catalog-shipped-labels.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
