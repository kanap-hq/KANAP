import * as assert from 'node:assert/strict';
import { readTableAttachment } from '../attachments/table-attachment';
import { buildImportMapping, type AiImportTemplateColumn } from '../import/ai-import-mapping';
import { buildImportFile } from '../import/ai-import-file';
import { AI_IMPORT_TARGETS, importColumnTitle, type AiImportKey } from '../import/ai-import-targets';

// Lot I6c of 26.12.1. A technology link names its server, its application and its technology by
// reference (`AST-n`, `APP-n`, `TEC-n`): Kad reads a reference column only with its prefix, so a
// column numbering the rows 1 to N names no record; the card says the column is not read, and the
// rows keep their names. The file Kad builds names the zone of a date-time column in its header.

/** The template of an import as the mapping reads it, from its columns alone (no catalog). */
async function templateOf(key: AiImportKey): Promise<AiImportTemplateColumn[]> {
  const specs = await AI_IMPORT_TARGETS[key].columns({} as any);
  return specs.map((spec) => ({
    column: spec.column, title: importColumnTitle(spec, 'en'), required: spec.required === true, kind: spec.kind,
    ...(spec.prefix ? { prefix: spec.prefix } : {}),
  }));
}

async function testLinkReferencesNeedTheirPrefix() {
  for (const [key, subject, prefix] of [
    ['technology_asset_links', 'asset_reference', 'AST'],
    ['technology_application_links', 'application_reference', 'APP'],
  ] as const) {
    const template = await templateOf(key);
    const name = subject.replace('_reference', '_name');
    for (const [refs, techs] of [[['1', '2'], ['3', '4']], [[`${prefix}-1`, '2'], ['TEC-3', '4']]]) {
      const grid = await readTableAttachment(Buffer.from([
        'N°;Nom;Techno N°;Techno',
        `${refs[0]};srv-a;${techs[0]};PostgreSQL`,
        `${refs[1]};srv-b;${techs[1]};Redis`,
      ].join('\n'), 'utf8'));
      const { preview, file } = buildImportMapping(grid, template, {
        importKey: key, filename: 'liens.csv', assumptions: [], columns: [
          { column: subject, source: 1, confidence: 'medium' },
          { column: name, source: 2, confidence: 'high' },
          { column: 'technology_reference', source: 3, confidence: 'medium' },
          { column: 'technology_name', source: 4, confidence: 'high' },
        ],
      }, 'en');
      assert.deepEqual(preview.read_errors, { [subject]: 'reference-without-prefix', technology_reference: 'reference-without-prefix' }, `${key} ${refs}`);
      // No cell of a number names a record: the rows keep their names.
      assert.deepEqual(file.rows, [['', 'srv-a', '', 'PostgreSQL'], ['', 'srv-b', '', 'Redis']], `${key} ${refs}`);
    }
    // References with their prefix, any case, are read as the import reads them.
    const grid = await readTableAttachment(Buffer.from(['Ref;Techno', `${prefix.toLowerCase()}-7;tec-3`].join('\n'), 'utf8'));
    const { preview, file } = buildImportMapping(grid, template, {
      importKey: key, filename: 'liens.csv', assumptions: [], columns: [
        { column: subject, source: 1, confidence: 'high' }, { column: 'technology_reference', source: 2, confidence: 'high' },
      ],
    }, 'en');
    assert.deepEqual(preview.read_errors, {});
    assert.deepEqual(file.rows, [[`${prefix}-7`, 'TEC-3']]);
  }
  console.log('  a technology link names a server, an application or a technology only by its prefixed reference: OK');
}

async function testZoneOfTheFile() {
  const template = await templateOf('incidents');
  const grid = await readTableAttachment(Buffer.from([
    'Titre;Gravité;Détecté (Europe/Paris);Résolu;Clôturé',
    'Porte ouverte;Majeure;02/11/2026 14:30;03/11/2026 09:00;2026-11-04T10:00:00Z',
  ].join('\n'), 'utf8'));
  const { preview, file } = buildImportMapping(grid, template, {
    importKey: 'incidents', filename: 'incidents.csv', assumptions: ['Une ligne par incident.'], timeZone: 'America/New_York', columns: [
      { column: 'title', source: 1, confidence: 'high' }, { column: 'severity', source: 2, confidence: 'high' },
      { column: 'detected_at', source: 3, confidence: 'high', date_order: 'day-first' },
      { column: 'resolved_at', source: 4, confidence: 'high', date_order: 'day-first' },
      { column: 'closed_at', source: 5, confidence: 'high' },
    ],
  }, 'en');
  // The header's zone is kept; the column without one is read in the person's zone, said first.
  assert.deepEqual(file.columns.filter((column) => column.kind === 'datetime').map((column) => [column.column, column.timeZone]), [
    ['detected_at', 'Europe/Paris'], ['resolved_at', 'America/New_York'], ['closed_at', 'America/New_York'],
  ]);
  assert.deepEqual(preview.assumptions, ['Times without a time zone are read in your time zone, America/New_York.', 'Une ligne par incident.']);
  const built = await readTableAttachment(buildImportFile(file, 'en'));
  const headers = built.header.map((cell) => (cell && cell.kind === 'text' ? cell.value : ''));
  assert.deepEqual(headers.slice(2), ['detected_at (Europe/Paris)', 'resolved_at (America/New_York)', 'closed_at (America/New_York)']);

  // Every header names its zone: nothing supposed. No zone known (another import): nothing said.
  const named = await readTableAttachment(Buffer.from(['Titre;Gravité;Détecté (UTC)', 'Panne;Faible;02/11/2026 14:30'].join('\n'), 'utf8'));
  const columns = [
    { column: 'title', source: 1, confidence: 'high' as const }, { column: 'severity', source: 2, confidence: 'high' as const },
    { column: 'detected_at', source: 3, confidence: 'high' as const, date_order: 'day-first' as const },
  ];
  assert.deepEqual(buildImportMapping(named, template, { importKey: 'incidents', filename: 'a.csv', assumptions: [], timeZone: 'Europe/Paris', columns }, 'fr').preview.assumptions, []);
  assert.deepEqual(buildImportMapping(named, template, { importKey: 'incidents', filename: 'a.csv', assumptions: [], columns }, 'fr').file.columns[2].timeZone, undefined);
  console.log('  the file keeps a header\'s zone, reads the others in the person\'s zone and names it in its header: OK');
}

async function main() {
  await testLinkReferencesNeedTheirPrefix();
  await testZoneOfTheFile();
  console.log('ai-import-link-references.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
