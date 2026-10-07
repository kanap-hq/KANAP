import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { format } from '@fast-csv/format';
import {
  denormalizeCsvFormulaValue,
  denormalizeCsvRow,
  neutralizeCsvFormulaValue,
  neutralizeCsvRow,
} from '../csv-export.service';
import { backendPath } from '../../__tests__/backend-root';

/**
 * Every export that hand-rolls its own fast-csv formatter now passes
 * `transform: neutralizeCsvRow`. These tests cover the row transform itself and the exact
 * formatter configuration those call sites use, because the previous arrangement protected
 * only hand-picked columns: the engine neutralised its fields, and the raw exporters did
 * nothing at all.
 */

function formatRows(rows: Array<Record<string, unknown>>): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    // Same configuration as the raw export call sites.
    const stream = format({ headers: ['name', 'notes'], delimiter: ';', transform: neutralizeCsvRow });
    stream.on('data', (chunk) => chunks.push(chunk.toString()));
    stream.on('end', () => resolve(chunks.join('')));
    stream.on('error', reject);
    for (const row of rows) stream.write(row);
    stream.end();
  });
}

function testNeutralizesEveryStringFieldOfARow() {
  const row = { name: '=cmd|calc', notes: 'plain', count: 3, missing: null, flag: true };
  const out = neutralizeCsvRow(row) as Record<string, unknown>;

  assert.equal(out.name, "'=cmd|calc");
  assert.equal(out.notes, 'plain');
  // Non-strings are untouched.
  assert.equal(out.count, 3);
  assert.equal(out.missing, null);
  assert.equal(out.flag, true);
  // The input row is not mutated.
  assert.equal(row.name, '=cmd|calc');
}

function testNeutralizesArrayRows() {
  const out = neutralizeCsvRow(['+1', 'ok', 42]) as unknown[];
  assert.deepEqual(out, ["'+1", 'ok', 42]);
}

function testPassesThroughScalars() {
  assert.equal(neutralizeCsvRow('=x'), '=x'); // a bare scalar is not a row
  assert.equal(neutralizeCsvRow(null), null);
}

function testCoversFieldsTheCallerDidNotHandPick() {
  // The point of neutralising the row rather than chosen columns: a newly added export
  // field is protected without anyone remembering to add it to a list.
  const out = neutralizeCsvRow({ a_new_field_nobody_listed: '@SUM(1)' }) as Record<string, string>;
  assert.equal(out.a_new_field_nobody_listed, "'@SUM(1)");
}

function testIsIdempotent() {
  const once = neutralizeCsvFormulaValue('=SUM(A1)');
  const twice = neutralizeCsvFormulaValue(once);
  assert.equal(once, "'=SUM(A1)");
  assert.equal(twice, once, 'neutralising twice must not stack apostrophes');
}

async function testFormatterEmitsNeutralizedValues() {
  const csv = await formatRows([{ name: '=cmd|calc', notes: '=2+2' }]);

  // Both fields protected, including the one an export might not have listed.
  assert.ok(csv.includes("'=cmd|calc"), `expected the formula to be neutralised, got: ${csv}`);
  assert.ok(csv.includes("'=2+2"), `expected the second formula to be neutralised, got: ${csv}`);
  // Header row still written.
  assert.ok(csv.startsWith('name;notes'), `expected headers first, got: ${csv}`);
  // The dangerous unescaped form must not appear.
  assert.ok(!/;=2\+2/.test(csv), 'a formula must never reach the cell unquoted and unescaped');
}

async function testFormatterLeavesOrdinaryTextAlone() {
  const csv = await formatRows([{ name: 'Acme Corp', notes: 'renewal in March' }]);
  assert.ok(csv.includes('Acme Corp'));
  assert.ok(csv.includes('renewal in March'));
  assert.ok(!csv.includes("'"), 'ordinary text must not gain an apostrophe');
}

function testLeavesPlainNegativeNumbersAlone() {
  // Amounts come out of formatCents and numeric columns as strings. A prefixed negative
  // becomes text in a spreadsheet and drops out of every SUM.
  assert.equal(neutralizeCsvFormulaValue('-1200.50'), '-1200.50');
  assert.equal(neutralizeCsvFormulaValue('-1200,5'), '-1200,5');
  assert.equal(neutralizeCsvFormulaValue('-7'), '-7');
  // Anything else starting with a trigger stays protected.
  assert.equal(neutralizeCsvFormulaValue('-1+cmd|calc'), "'-1+cmd|calc");
  assert.equal(neutralizeCsvFormulaValue('-x'), "'-x");
  assert.equal(neutralizeCsvFormulaValue('- bullet'), "'- bullet");
  assert.equal(neutralizeCsvFormulaValue('+33 6 12 34 56 78'), "'+33 6 12 34 56 78");
  assert.equal(neutralizeCsvFormulaValue('+33612345678'), "'+33612345678");
}

function testRowRoundTripsThroughExportAndImport() {
  const original = {
    phone: '+33 6 12 34 56 78',
    notes: '- first point',
    name: '=cmd|calc',
    handle: '@team',
    amount: '-1200.50',
    plain: "l'apostrophe",
    quoted: "'kept",
    count: 3,
  };
  const exported = neutralizeCsvRow(original) as Record<string, unknown>;
  assert.equal(exported.phone, "'+33 6 12 34 56 78");
  assert.deepEqual(denormalizeCsvRow(exported), original);
  // A user value that merely starts with an apostrophe is not ours to strip.
  assert.equal(denormalizeCsvFormulaValue("'kept"), "'kept");
  // Files exported before plain negatives were exempted still import cleanly.
  assert.equal(denormalizeCsvFormulaValue("'-1200.50"), '-1200.50');
}

async function run() {
  testLeavesPlainNegativeNumbersAlone();
  testRowRoundTripsThroughExportAndImport();
  testNeutralizesEveryStringFieldOfARow();
  testNeutralizesArrayRows();
  testPassesThroughScalars();
  testCoversFieldsTheCallerDidNotHandPick();
  testIsIdempotent();
  await testFormatterEmitsNeutralizedValues();
  await testFormatterLeavesOrdinaryTextAlone();
  testEveryCsvWriterNeutralizesFormulas();
  testEveryNeutralizingWriterDenormalizesItsImport();
}

void run();

/**
 * The other half of the guard below: an exporter that neutralises and whose module also
 * parses CSV must strip the apostrophe on the way back in. Without it, re-importing an
 * unmodified export stores "'+33 6 12..." and "'- first point".
 */
function testEveryNeutralizingWriterDenormalizesItsImport() {
  // The TypeScript sources, also when this spec runs compiled (the compiled tree has no .ts file).
  const srcRoot = backendPath('src');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'migrations' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (!source.includes('transform: neutralizeCsvRow') || !source.includes('parseString(')) continue;
      if (!source.includes('denormalizeCsvRow(')) {
        offenders.push(path.relative(srcRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, [], `CSV importers must call denormalizeCsvRow:\n${offenders.join('\n')}`);
}

/**
 * Source-level guard. The unit tests above prove the transform works when it is attached;
 * this proves it *is* attached at every CSV writer, so a new export cannot quietly ship
 * unprotected the way these ones did.
 */
function testEveryCsvWriterNeutralizesFormulas() {
  // Writers that protect their output another way, or that only emit a header line.
  const EXEMPT = new Set([
    'common/csv/csv-export.service.ts', // the shared engine neutralises each field itself
    'common/csv/csv-import.service.ts',
    'users/users.service.ts', // neutralises every exported field explicitly
    'applications/applications-csv.service.ts', // template export: headers only, no values
    // Encodes the stored template payload (coa_templates.csv_payload), read back by the same
    // service. Neutralising there would persist the apostrophe; it is storage, not an export.
    'admin/coa-templates/admin-coa-templates.service.ts',
  ]);

  // The TypeScript sources, also when this spec runs compiled (the compiled tree has no .ts file).
  const srcRoot = backendPath('src');
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'migrations' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;

      const relative = path.relative(srcRoot, full).split(path.sep).join('/');
      if (EXEMPT.has(relative)) continue;

      const source = fs.readFileSync(full, 'utf8');
      // Any fast-csv formatter that writes rows must carry the row transform.
      const formatters = source.match(/format\(\{\s*headers[\s\S]{0,120}?\}\)/g) ?? [];
      for (const call of formatters) {
        if (!call.includes('transform: neutralizeCsvRow')) {
          offenders.push(`${relative}: ${call.replace(/\s+/g, ' ')}`);
        }
      }
    }
  };
  walk(srcRoot);

  assert.deepEqual(
    offenders,
    [],
    `CSV writers must pass \`transform: neutralizeCsvRow\`:\n${offenders.join('\n')}`,
  );

  // The one writer that hand-rolls its CSV must neutralise inside its own escaper.
  const weekly = fs.readFileSync(
    path.join(srcRoot, 'portfolio', 'services', 'portfolio-weekly-report.service.ts'),
    'utf8',
  );
  const escaper = weekly.slice(weekly.indexOf('const csvEscape'), weekly.indexOf('const columnNumberToName'));
  assert.ok(
    escaper.includes('neutralizeCsvFormulaValue'),
    'portfolio-weekly-report.service.ts hand-rolls its CSV and must neutralise in csvEscape',
  );
}
