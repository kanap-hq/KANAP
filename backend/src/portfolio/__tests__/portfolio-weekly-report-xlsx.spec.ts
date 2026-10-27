import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import AdmZip = require('adm-zip');
import { backendPath } from '../../common/__tests__/backend-root';
import { PortfolioWeeklyReportService } from '../services/portfolio-weekly-report.service';

/**
 * Golden test of the weekly report's workbook: every part of the .xlsx is compared, byte for byte,
 * with the files under `fixtures/weekly-xlsx/<case>/`. The goldens were written once from the writer
 * private to the service, before it moved to the common xlsx writer; they must not change with it.
 *
 * `WRITE_GOLDEN=1 npx ts-node <this file>` rewrites them (only for a deliberate change of the format).
 */

const GOLDEN_ROOT = backendPath('src', 'portfolio', '__tests__', 'fixtures', 'weekly-xlsx');

type Cell = string | number | { kind: 'date'; iso: string } | null;
type Sheet = { name: string; headers: string[]; rows: Array<{ cells: Cell[]; linkPath: string | null }>; linkColumnNumber?: number };

const day = (iso: string): Cell => ({ kind: 'date', iso });

const SHEETS: Sheet[] = [
  {
    name: 'Requests',
    headers: ['Event', 'Reference', 'Name', 'Days', 'Cost', 'Due', 'Notes'],
    rows: [
      { cells: ['Created', 'REQ-1', 'Café & <crème> "brûlée"', 3, 1.5, day('2026-09-15'), 'plain'], linkPath: '/portfolio/requests/1' },
      { cells: ['Closed', 'REQ-2', "L'été à Noël", 0, 0.1 + 0.2, null, 'two\nlines'], linkPath: null },
      { cells: ['Modified', '', 'Empty reference', -4, 1000000, day('2026-01-01'), ''], linkPath: '/portfolio/requests/3?tab=a&b=c' },
      { cells: ['Created', 'REQ-4', '  leading and trailing  ', 12, 1e21, day('1999-12-31'), null], linkPath: 'https://elsewhere.example.com/x' },
    ],
  },
  {
    name: 'Projects',
    headers: ['Event', 'Reference', 'Name', 'Start', 'End'],
    rows: [
      { cells: ['Created', 'PRJ-1', 'Ünïcode — dash “quotes” 日本語', day('2026-03-01'), day('2026-04-30')], linkPath: '/portfolio/projects/1' },
      { cells: ['Closed', 'PRJ-2', 'No dates', null, null], linkPath: '/portfolio/projects/2' },
    ],
  },
  {
    name: 'Tasks by person',
    headers: ['Team', 'Person', 'List', 'Reference', 'Task'],
    rows: [
      { cells: ['Operations', 'Thomas Berger', 'Created', 'T-1', 'Tune the cellar probes'], linkPath: '/portfolio/tasks/1' },
      { cells: ['', 'Unassigned', 'Closed', 'T-2', 'Second line\r\nwith CRLF'], linkPath: '/portfolio/tasks/2' },
    ],
    linkColumnNumber: 4,
  },
];

const CASES: Array<{ name: string; language: 'en' | 'fr' | 'de' | 'es'; appBaseUrl: string | null }> = [
  { name: 'en-no-base', language: 'en', appBaseUrl: null },
  { name: 'fr-base', language: 'fr', appBaseUrl: 'https://app.example.com/' },
  { name: 'de-base', language: 'de', appBaseUrl: 'https://app.example.com' },
  { name: 'es-no-base', language: 'es', appBaseUrl: null },
];

function partsOf(buffer: Buffer): Map<string, Buffer> {
  const parts = new Map<string, Buffer>();
  for (const entry of new AdmZip(buffer).getEntries()) {
    if (!entry.isDirectory) parts.set(entry.entryName, entry.getData());
  }
  return parts;
}

function listFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? listFiles(path.join(dir, item.name), `${prefix}${item.name}/`) : [`${prefix}${item.name}`],
  );
}

function run() {
  const service = new PortfolioWeeklyReportService() as any;
  const write = process.env.WRITE_GOLDEN === '1';

  for (const testCase of CASES) {
    const buffer: Buffer = service.buildXlsx(SHEETS, testCase.appBaseUrl, testCase.language);
    const parts = partsOf(buffer);
    const dir = path.join(GOLDEN_ROOT, testCase.name);

    if (write) {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const [name, data] of parts) {
        const target = path.join(dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
      continue;
    }

    assert.deepEqual([...parts.keys()].sort(), listFiles(dir).sort(), `${testCase.name}: the same parts`);
    for (const [name, data] of parts) {
      const golden = fs.readFileSync(path.join(dir, name));
      assert.ok(data.equals(golden), `${testCase.name}: ${name} is byte-identical to its golden`);
    }
  }

  console.log(write ? 'portfolio-weekly-report-xlsx.spec.ts: goldens written' : 'portfolio-weekly-report-xlsx.spec.ts: ok');
}

run();
