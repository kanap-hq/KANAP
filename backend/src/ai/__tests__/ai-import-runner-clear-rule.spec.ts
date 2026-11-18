import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AI_IMPORT_CLEARING_RULE, AI_IMPORT_KEYS } from '../import/ai-import-access';
import { AiImportRunnerService } from '../import/ai-import-runner.service';

// Kad calls the imports as their routes do, with the clearing rule of every import (D21 of 26.11.9):
// a blank cell keeps, `-` clears. The twelve imports of lot I4 still take it as `mode: 'enrich'`;
// the six of the shared import (lot I6) have no mode left, the rule is theirs. The check's count of
// the values cleared reaches the card (`cleared`).

const SERVICES: Record<string, { field: string; method: string }> = {
  suppliers: { field: 'suppliers', method: 'importCsv' },
  contacts: { field: 'contacts', method: 'importCsv' },
  contracts: { field: 'contracts', method: 'importCsv' },
  companies: { field: 'companies', method: 'importCsv' },
  departments: { field: 'departments', method: 'importCsv' },
  cost_centers: { field: 'costCenters', method: 'importCsv' },
  accounts: { field: 'accounts', method: 'importCsv' },
  analytics_categories: { field: 'analytics', method: 'importCsv' },
  business_processes: { field: 'businessProcesses', method: 'importCsv' },
  working_day_calendars: { field: 'calendars', method: 'importCsv' },
  technology_asset_links: { field: 'technologyLinks', method: 'importAssetLinks' },
  technology_application_links: { field: 'technologyLinks', method: 'importApplicationLinks' },
};

/** The six imports of the shared import (lot I6): called without a mode. */
const SHARED: Record<string, { field: string; method: string }> = {
  applications: { field: 'applications', method: 'import' },
  assets: { field: 'assets', method: 'import' },
  portfolio_projects: { field: 'projects', method: 'import' },
  portfolio_requests: { field: 'requests', method: 'import' },
  tasks: { field: 'tasks', method: 'import' },
  incidents: { field: 'incidents', method: 'import' },
};

async function main() {
  const runner = Object.create(AiImportRunnerService.prototype) as any;
  const calls: Record<string, any> = {};
  for (const [key, { field, method }] of Object.entries({ ...SERVICES, ...SHARED })) {
    runner[field] ??= {};
    // The shared import takes the file first, then its options.
    runner[field][method] = async (...args: any[]) => {
      calls[key] = method === 'import' ? args[1] : args[0];
      return { ok: true, total: 1, inserted: 0, updated: 1, unchanged: 0, cleared: 2, errors: [] };
    };
  }
  runner.policy = { effectiveAccess: async () => ({ isAdmin: true }) };
  const context = { tenantId: 't', userId: 'u', manager: { query: async () => [] } };
  for (const key of Object.keys(SERVICES)) {
    const card = await runner.run(key, Buffer.from(''), { dryRun: true, language: 'en', lines: [2] }, context);
    assert.equal(calls[key]?.mode, 'enrich', `${key}: Kad applies the rule of the route`);
    assert.equal(card.cleared, 2, `${key}: the card counts the values cleared`);
  }
  for (const key of Object.keys(SHARED)) {
    const card = await runner.run(key, Buffer.from(''), { dryRun: true, language: 'en', lines: [2] }, context);
    assert.ok(calls[key], `${key}: called`);
    assert.equal('mode' in calls[key], false, `${key}: no mode, the rule is the import's own`);
    assert.equal(card.cleared, 2, `${key}: the card counts the values cleared`);
  }
  // Every import Kad maps a row file onto follows the rule; the budget file reads `-` by its own reader.
  assert.deepEqual(
    AI_IMPORT_KEYS.filter((key) => !AI_IMPORT_CLEARING_RULE.has(key)),
    ['budget_lines'],
    'every row import follows the clearing rule',
  );
  console.log(`ai-import-runner-clear-rule.spec: ${Object.keys(SERVICES).length + Object.keys(SHARED).length} calls with the rule: ok`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
