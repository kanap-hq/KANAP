import * as assert from 'node:assert/strict';
import { readTableAttachment } from '../attachments/table-attachment';
import { buildImportMapping } from '../import/ai-import-mapping';
import { AiImportMappingService } from '../import/ai-import-mapping.service';
import { AI_IMPORT_TARGETS } from '../import/ai-import-targets';
import { DEFAULT_HOSTING_TYPES } from '../../it-ops-settings/it-ops-settings.service';

// Lot I3 of 26.11.9, fixes D (T-I3f): in English, Kad converted "Cloud" to "Container" in the servers'
// type column, saying so, against its instructions. A hosting word (a hosting type of the catalog, by
// code, name or a shipped name in any language, or a hosting category: on site, cloud) is never
// converted by the model's values in that column: the cell stays as written, and the import reads it
// as the screen does ("Unknown asset type: Cloud"). The column's own reading is unchanged.

const SETTINGS = {
  serverKinds: [
    { code: 'physical_server', label: 'Physical Server' },
    { code: 'virtual_machine', label: 'Virtual Machine' },
    { code: 'container', label: 'Container' },
    { code: 'saas', label: 'SaaS' },
  ],
  hostingTypes: [...DEFAULT_HOSTING_TYPES, { code: 'ovh', label: 'OVH Cloud', category: 'cloud' }],
};

async function testHostingWordsStayAsWritten() {
  const mapping = new AiImportMappingService({} as any, { getSettings: async () => SETTINGS } as any, {} as any, {} as any);
  const { columns } = await mapping.templateColumns({ tenantId: 't1', manager: {} } as any, AI_IMPORT_TARGETS.assets, 'en');
  const cells = ['Cloud', 'Cloud privé', 'Sur site', 'on-prem', 'Public cloud', 'OVH Cloud', 'local', 'VM', 'Conteneur', 'SaaS'];
  const grid = await readTableAttachment(Buffer.from(['Name;Type', ...cells.map((cell, index) => `srv${index + 1};${cell}`)].join('\n'), 'utf8'));
  const values = {
    Cloud: 'container', 'Cloud privé': 'virtual_machine', 'Sur site': 'physical_server', 'on-prem': 'physical_server',
    'Public cloud': 'container', 'OVH Cloud': 'virtual_machine', local: 'physical_server', VM: 'virtual_machine', SaaS: 'container',
  };
  const { file, preview } = buildImportMapping(grid, columns, {
    importKey: 'assets', filename: 'srv.csv', assumptions: [], columns: [
      { column: 'name', source: 1, confidence: 'high' },
      { column: 'kind', source: 2, confidence: 'medium', values },
    ],
  }, 'en');
  const kinds = file.rows.map((row) => row[file.columns.findIndex((column) => column.column === 'kind')]);
  assert.deepEqual(kinds, [
    { unread: 'Cloud' }, { unread: 'Cloud privé' }, { unread: 'Sur site' }, { unread: 'on-prem' }, { unread: 'Public cloud' },
    { unread: 'OVH Cloud' }, { unread: 'local' },
    'virtual_machine', 'container',
    // A catalog type that is also a hosting type keeps its own reading.
    'saas',
  ]);
  const kind = preview.columns.find((column) => column.column === 'kind');
  assert.equal(kind?.unread, 7, 'the card counts the hosting words as values the column does not read');

  // Another column of the servers, and the type column of a workspace without hosting types, read the values as before.
  const bare = new AiImportMappingService({} as any, { getSettings: async () => ({ serverKinds: SETTINGS.serverKinds }) } as any, {} as any, {} as any);
  const plain = await bare.templateColumns({ tenantId: 't1', manager: {} } as any, AI_IMPORT_TARGETS.assets, 'en');
  const one = await readTableAttachment(Buffer.from(['Name;Type', 'srv1;VM'].join('\n'), 'utf8'));
  const read = buildImportMapping(one, plain.columns, {
    importKey: 'assets', filename: 'srv.csv', assumptions: [], columns: [
      { column: 'name', source: 1, confidence: 'high' },
      { column: 'kind', source: 2, confidence: 'high', values: { VM: 'virtual_machine' } },
    ],
  }, 'en');
  assert.deepEqual(read.file.rows, [['srv1', 'virtual_machine']]);
  console.log('  a hosting word in the servers\' type column stays as written: OK');
}

(async () => {
  await testHostingWordsStayAsWritten();
  console.log('ai-import-hosting-words.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
