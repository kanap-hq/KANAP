import * as assert from 'node:assert/strict';
import { readTableAttachment } from '../attachments/table-attachment';
import { buildImportMapping, namesARow } from '../import/ai-import-mapping';

// Lot I6a of 26.12.1, passe 2: the model's assumptions are about the whole file. The pilot's replay
// with the real model still saw, on a budget file's first card, an assumption that named a row by its
// number ("… de la colonne Domaine IT (ligne 2) …"), while the card said otherwise. The card leaves out
// an assumption that names a row by its number, in the four languages, the whole sentence, unchanged
// otherwise; the mapping's input keeps it. A card whose assumptions are all left out has none.

const NAMED = [
  'La valeur « Delivery » de la colonne Domaine IT (ligne 2) n\'a pas d\'équivalent dans la liste.',
  'Les lignes 2 et 3 sont des sous-totaux.',
  'The amount of row 2 is in dollars.',
  'Zeile 2 hat kein Datum.',
  'La fila 2 no tiene proveedor.',
  'La línea 2 no tiene proveedor.',
  'La ligne n° 4 est un total.',
  'La ligne n°4 est un total.',
  'Row #7 repeats row #6.',
  'Zeile Nr. 3 ist leer.',
  'Line 12 holds the totals.',
  'Las líneas 4 y 5 se repiten.',
];

const KEPT = [
  'Les montants sont en euros.',
  'La première ligne est une ligne d\'en-tête.',
  'Les lignes vides sont ignorées.',
  'Le fichier a 2 lignes de titre avant les en-têtes.',
  'The header row holds the column names.',
  'Die Kopfzeile 1 enthält die Titel.',
  'Las filas vacías se ignoran.',
  'Dates are written day first (31/12/2026).',
  'The pipeline 2 column is left out.',
];

function testTheSixFormsAndTheirNeighbours() {
  for (const text of NAMED) assert.equal(namesARow(text), true, `names a row: ${text}`);
  for (const text of KEPT) assert.equal(namesARow(text), false, `names no row: ${text}`);
  console.log(`  ${NAMED.length} assumptions naming a row by its number, ${KEPT.length} that name none: OK`);
}

async function testTheCardLeavesThemOut() {
  const grid = await readTableAttachment(Buffer.from(['Name;Description', 'Atlas;Cartes'].join('\n'), 'utf8'));
  const template = [
    { column: 'name', title: 'Name', required: true, kind: 'text' as const },
    { column: 'description', title: 'Description', required: false, kind: 'text' as const },
  ];
  const columns = [{ column: 'name', source: 1, confidence: 'high' as const }, { column: 'description', source: 2, confidence: 'high' as const }];
  const request = { importKey: 'contacts', filename: 'f.csv', columns, assumptions: [NAMED[0], KEPT[0], NAMED[2], KEPT[1]] };
  const { preview } = buildImportMapping(grid, template, request, 'fr');
  assert.deepEqual(preview.assumptions, [KEPT[0], KEPT[1]], 'the sentences that name a row are left out whole, the others kept as written');
  assert.equal(request.assumptions.length, 4, 'the input keeps them');
  const none = buildImportMapping(grid, template, { ...request, assumptions: [NAMED[1], NAMED[3]] }, 'fr');
  assert.deepEqual(none.preview.assumptions, [], 'every assumption left out: the card has none');
  console.log('  the card leaves out the assumptions that name a row; the input keeps them: OK');
}

(async () => {
  testTheSixFormsAndTheirNeighbours();
  await testTheCardLeavesThemOut();
  console.log('ai-import-row-assumptions.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
