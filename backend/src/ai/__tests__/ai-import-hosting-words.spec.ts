import * as assert from 'node:assert/strict';
import { readTableAttachment } from '../attachments/table-attachment';
import { columnReader } from '../import/ai-import-convert';
import { buildImportMapping } from '../import/ai-import-mapping';
import { AiImportMappingService } from '../import/ai-import-mapping.service';
import { AI_IMPORT_TARGETS } from '../import/ai-import-targets';
import { DEFAULT_HOSTING_TYPES } from '../../it-ops-settings/it-ops-settings.service';

// Lot I3 of 26.11.9, fixes D (T-I3f): in English, Kad converted "Cloud" to "Container" in the servers'
// type column, saying so, against its instructions. A hosting word (a hosting type of the catalog, by
// code, name or a shipped name in any language, or a hosting category: on site, cloud) is never
// converted by the model's values in that column: the column's reader keeps it as written.
// D31 of 26.11.9 (option A): the model's values for a hosting word are proposals, as for a record's
// name: the file keeps the person's text, and the import takes the proposal only when it names a type
// of the catalog, listed on the card and undoable. The column's own reading is unchanged.

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
    'Cloud', 'Cloud privé', 'Sur site', 'on-prem', 'Public cloud', 'OVH Cloud', 'local',
    'virtual_machine', 'container',
    // A catalog type that is also a hosting type keeps its own reading.
    'saas',
  ]);
  // Only the hosting words are proposals; the other values convert as in any catalog column.
  assert.deepEqual(file.proposals, {
    kind: {
      Cloud: 'container', 'Cloud privé': 'virtual_machine', 'Sur site': 'physical_server', 'on-prem': 'physical_server',
      'Public cloud': 'container', 'OVH Cloud': 'virtual_machine', local: 'physical_server', SaaS: 'container',
    },
  });
  const kind = preview.columns.find((column) => column.column === 'kind');
  assert.equal(kind?.unread, 0, 'a hosting word with a proposal is left to the check, which lists it or refuses it');

  // Without a proposal, a hosting word is a value the column does not read.
  const bareCard = buildImportMapping(grid, columns, {
    importKey: 'assets', filename: 'srv.csv', assumptions: [], columns: [
      { column: 'name', source: 1, confidence: 'high' },
      { column: 'kind', source: 2, confidence: 'medium', values: { VM: 'virtual_machine', Cloud: '' } },
    ],
  }, 'en');
  assert.equal(bareCard.file.proposals, undefined);
  assert.equal(bareCard.preview.columns.find((column) => column.column === 'kind')?.unread, 7);

  // The column's reader alone (the value map) never converts a hosting word, whatever the map says.
  const kindColumn = columns.find((column) => column.column === 'kind')!;
  const cloud = { kind: 'text' as const, value: 'Cloud' };
  const reader = columnReader(kindColumn, [cloud], { values: { Cloud: 'virtual_machine' } }, 'en');
  assert.deepEqual(reader.read(cloud), { status: 'unread', raw: 'Cloud' });

  // What Kad reads: the type comes from the person, asked first; the hosting from the site.
  const about = AI_IMPORT_TARGETS.assets.about;
  assert.match(about, /ask the person which type/);
  assert.match(about, /location_reference, LOC-n/);
  assert.match(about, /only once the person has named the type/);
  assert.match(about, /never say that a value is read as a type/);
  const specs = await AI_IMPORT_TARGETS.assets.columns({} as any);
  assert.match(specs.find((spec) => spec.column === 'kind')?.hint ?? '', /only to the type the person named/);

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
  console.log('  a hosting word in the servers\' type column: a proposal of Kad, never converted by the value map: OK');
}

(async () => {
  await testHostingWordsStayAsWritten();
  console.log('ai-import-hosting-words.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
