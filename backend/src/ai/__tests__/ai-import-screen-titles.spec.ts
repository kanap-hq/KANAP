import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import type { CsvEntityConfig } from '../../common/csv/csv-field.types';
import { applicationCsvConfig } from '../../applications/application-csv.config';
import { assetCsvConfig } from '../../assets/asset-csv.config';
import { incidentCsvConfig } from '../../incidents/incident-csv.config';
import { portfolioProjectCsvConfig } from '../../portfolio/portfolio-project-csv.config';
import { portfolioRequestCsvConfig } from '../../portfolio/portfolio-request-csv.config';
import { taskCsvConfig } from '../../tasks/task-csv.config';
import { AI_IMPORT_KEYS, AI_IMPORT_TARGETS, importColumnTitle, type AiImportKey } from '../import/ai-import-targets';

/**
 * Kad's import card and the import screen name every column alike (P11 of 26.12.1): for each import
 * Kad maps a file onto, in the four languages, each column of the card has the screen's label
 * (`csv.fields.<entity>.<column>` in the interface's `common.json`, a column of one year by the label
 * of its base and the year, as `csvFieldLabel` reads it). A column added to one side only fails: a
 * card column the screen does not name, or a screen label of the import that names no card column
 * (other than the export's own columns, which the card leaves out).
 *
 * It reads files outside its own folder: `backendPath()`, never `__dirname`.
 */

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;

/** The screen's entity of each import: its list endpoint as `csvEntityOf` names it. */
const SCREEN_ENTITY: Record<Exclude<AiImportKey, 'budget_lines'>, string> = {
  applications: 'applications',
  assets: 'assets',
  portfolio_projects: 'portfolio_projects',
  portfolio_requests: 'portfolio_requests',
  tasks: 'tasks',
  incidents: 'incidents',
  contracts: 'contracts',
  suppliers: 'suppliers',
  contacts: 'contacts',
  companies: 'companies',
  departments: 'departments',
  cost_centers: 'cost-centers',
  accounts: 'accounts',
  analytics_categories: 'analytics-categories',
  business_processes: 'business-processes',
  working_day_calendars: 'working-day-profiles',
  technology_asset_links: 'technologies_asset-links',
  technology_application_links: 'technologies_application-links',
};

/**
 * The budget file is left out: its dialog names a column as the budget grid does (the workspace's
 * columns and dimensions, `BudgetFileImportDialog`), which no locale file holds.
 */
const NOT_COMPARED: Partial<Record<AiImportKey, string>> = {
  budget_lines: 'the budget file dialog names its columns as the budget grid does, from the workspace settings',
};

/** The imports whose screen labels also name the export's own columns (an id, a computed score). */
const EXPORTED_CONFIGS: Partial<Record<AiImportKey, CsvEntityConfig>> = {
  applications: applicationCsvConfig,
  assets: assetCsvConfig,
  portfolio_projects: portfolioProjectCsvConfig,
  portfolio_requests: portfolioRequestCsvConfig,
  tasks: taskCsvConfig,
  incidents: incidentCsvConfig,
};

const YEARLY = /^(.+)_(\d{4})$/;

/** The screen's label of a column, as `csvFieldLabel` reads it; undefined when it has none. */
function screenLabel(labels: Record<string, string>, column: string): string | undefined {
  if (labels[column] !== undefined) return labels[column];
  const yearly = YEARLY.exec(column);
  return yearly && labels[yearly[1]] !== undefined ? `${labels[yearly[1]]} ${yearly[2]}` : undefined;
}

async function everyImportIsCompared() {
  for (const key of AI_IMPORT_KEYS) {
    assert.ok(key in SCREEN_ENTITY || key in NOT_COMPARED, `${key}: name its import screen here, or say why it is not compared`);
  }
  console.log('  every import of Kad has its import screen, the budget file aside: OK');
}

async function cardColumnsAsTheScreenNamesThem() {
  const gaps: string[] = [];
  let compared = 0;
  for (const language of LANGUAGES) {
    const common = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', language, 'common.json'), 'utf8'));
    for (const [key, entity] of Object.entries(SCREEN_ENTITY) as Array<[Exclude<AiImportKey, 'budget_lines'>, string]>) {
      const labels = (common.csv?.fields?.[entity] ?? {}) as Record<string, string>;
      // Their columns come from the import's settings alone: no database read.
      const specs = await AI_IMPORT_TARGETS[key].columns({} as any);
      const columns = new Set(specs.map((spec) => spec.column));
      for (const spec of specs) {
        compared += 1;
        const card = importColumnTitle(spec, language);
        const screen = screenLabel(labels, spec.column);
        if (card !== screen) gaps.push(`${language} ${key}.${spec.column}: card "${card}", screen "${screen ?? '(the column key)'}"`);
      }
      // The other way: a screen label names a card column, a base of the card's yearly columns, or
      // a column the export writes and the card leaves out.
      const config = EXPORTED_CONFIGS[key];
      const exportOnly = new Set((config?.fields ?? []).map((field) => field.csvColumn).filter((column) => !columns.has(column)));
      const yearlyBases = new Set([...columns].map((column) => YEARLY.exec(column)?.[1]).filter((base): base is string => !!base));
      for (const column of Object.keys(labels)) {
        if (columns.has(column) || yearlyBases.has(column) || exportOnly.has(column)) continue;
        gaps.push(`${language} ${key}.${column}: the screen names it, the card has no such column`);
      }
    }
  }
  assert.ok(compared > 1000, `columns compared: ${compared}`);
  assert.deepEqual(gaps, [], 'the card and the import screen name the columns alike');
  console.log(`  ${compared} column titles of ${Object.keys(SCREEN_ENTITY).length} imports in four languages, as the import screen names them: OK`);
}

async function main() {
  await everyImportIsCompared();
  await cardColumnsAsTheScreenNamesThem();
  console.log('ai-import-screen-titles.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
