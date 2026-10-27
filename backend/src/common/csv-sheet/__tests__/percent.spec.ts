import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatCsvPercent, writeCsv } from '../index';

/** Shares in a CSV file: points, two decimals, the language's decimal mark, a percent sign; read back as numbers by LibreOffice. */

function format() {
  assert.equal(formatCsvPercent(0.125, 'en'), '12.50%');
  assert.equal(formatCsvPercent(0.125, 'fr'), '12,50%');
  assert.equal(formatCsvPercent(0.125, 'de'), '12,50%');
  assert.equal(formatCsvPercent(0.125, 'es'), '12,50%');
  assert.equal(formatCsvPercent(0, 'en'), '0.00%');
  assert.equal(formatCsvPercent(1, 'fr'), '100,00%');
  assert.equal(formatCsvPercent(-0.0325, 'en'), '-3.25%');
  assert.equal(formatCsvPercent(2.5, 'en'), '250.00%', 'more than 100 %');
  assert.equal(formatCsvPercent(-0.00004, 'en'), '0.00%', 'no negative zero');
  assert.equal(formatCsvPercent(0.1235, 'en'), '12.35%', 'rounded on the hundredth of a point');
  assert.equal(formatCsvPercent(1 / 3, 'fr'), '33,33%');
  // Half away from zero on the decimal text, never through a float (0.01005 × 10000 is 100.49999… as a float).
  assert.equal(formatCsvPercent(0.01005, 'en'), '1.01%');
  assert.equal(formatCsvPercent(-0.01125, 'en'), '-1.13%');
  assert.equal(formatCsvPercent(0.01125, 'en'), '1.13%');
  assert.equal(formatCsvPercent(0.001 + 0.002, 'en'), '0.30%');
  assert.equal(formatCsvPercent(-0.00005, 'en'), '-0.01%', 'half away from zero below zero too');
  assert.equal(formatCsvPercent(1e-7, 'en'), '0.00%', 'an exponent form');
  for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => formatCsvPercent(bad, 'en'), /Invalid percent/);
}

function libreOffice() {
  if (spawnSync('which', ['soffice'], { encoding: 'utf8' }).status !== 0) {
    console.log('percent.spec.ts: LibreOffice round trip skipped (soffice not installed)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-percent-'));
  try {
    // The file as an export writes it, opened in the matching LibreOffice locale (en-US 1033, fr-FR 1036).
    const read = (language: 'en' | 'fr', locale: number): string => {
      const separator = language === 'en' ? 44 : 59;
      const file = path.join(dir, `${language}.csv`);
      const rows = [0.125, -0.0325, 0].map((value, index) => [`R${index}`, formatCsvPercent(value, language)]);
      fs.writeFileSync(file, writeCsv({ language, headers: ['Name', 'Share'], rows }), 'utf8');
      const out = path.join(dir, `out-${language}`);
      // Out: comma, double quote, UTF-8, text cells quoted: a number is the only unquoted cell.
      const run = spawnSync(
        'soffice',
        [
          `-env:UserInstallation=file://${path.join(dir, 'profile')}`,
          '--headless',
          `--infilter=CSV:${separator},34,76,1,,${locale}`,
          '--convert-to',
          'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,true,true,false,false,false',
          '--outdir',
          out,
          file,
        ],
        { encoding: 'utf8', timeout: 120_000 },
      );
      assert.equal(run.status, 0, `soffice exits 0 (${run.stderr})`);
      return fs.readFileSync(path.join(out, `${language}.csv`), 'utf8');
    };
    for (const [language, locale] of [['en', 1033], ['fr', 1036]] as const) {
      const csv = read(language, locale);
      assert.ok(csv.includes('"R0",12.5%') && csv.includes('"R1",-3.25%') && csv.includes('"R2",0%'), `${language}: shares read as percentages: ${csv}`);
    }
    console.log('percent.spec.ts: LibreOffice round trip ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

format();
libreOffice();
console.log('percent.spec.ts: ok');
