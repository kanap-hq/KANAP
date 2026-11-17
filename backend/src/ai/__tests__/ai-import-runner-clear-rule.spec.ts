import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AiImportRunnerService } from '../import/ai-import-runner.service';

// Kad calls the eleven imports of lot I4 of 26.11.9 as their routes do, with the clearing rule of
// every import route (D21, `mode: 'enrich'`): a blank cell keeps, `-` clears. The check's count of
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

async function main() {
  const runner = Object.create(AiImportRunnerService.prototype) as any;
  const calls: Record<string, any> = {};
  for (const [key, { field, method }] of Object.entries(SERVICES)) {
    runner[field] ??= {};
    runner[field][method] = async (args: any) => {
      calls[key] = args;
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
  console.log(`ai-import-runner-clear-rule.spec: ${Object.keys(SERVICES).length} calls with the rule: ok`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
