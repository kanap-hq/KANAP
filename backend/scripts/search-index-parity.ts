import 'dotenv/config';
import dataSource from '../src/data-source';
import { AiEntityService } from '../src/ai/ai-entity.service';

/**
 * Phase B rollout gate (planning/search-revamp.md §B7.2): runs a set of
 * representative queries through BOTH search paths (legacy per-entity-type
 * scans vs unified search_index) for one tenant and diffs the top-10 result
 * sets by (entity_type, entity_id).
 *
 * The new path finding MORE is expected (typo/stemming/accent gains).
 * Investigate every query where the LEGACY path found something the new path
 * missed.
 *
 * Usage:
 *   DATABASE_URL=... npx ts-node scripts/search-index-parity.ts <tenant-id> [user-id] [query ...]
 */

const DEFAULT_QUERIES = [
  'PRJ-1',
  'T-1',
  'DOC-1',
  'SUP-1',
  'COMP-1',
  'CTCT-1',
  'DEPT-1',
  'CTR-1',
  '12',
  'migration',
  'serveur',
  'imprimante',
  'sauvegarde',
  'budget',
  'licence',
  'contrat',
  'support',
  'réseau',
  'firewall',
  'admin',
  'audit',
  'erp',
  'backup',
  'maintenance',
  'production',
];

type ResultKey = string;

/**
 * The families numbered by the database (migration 1856240000000): a query that is one of their
 * references must bring that record first on the indexed path when the tenant holds it.
 */
const NUMBERED_FAMILIES: Record<string, { type: string; table: string }> = {
  SUP: { type: 'suppliers', table: 'suppliers' },
  COMP: { type: 'companies', table: 'companies' },
  CTCT: { type: 'contacts', table: 'contacts' },
  DEPT: { type: 'departments', table: 'departments' },
  CTR: { type: 'contracts', table: 'contracts' },
};

function keysOf(result: any): ResultKey[] {
  return (result.items || [])
    .slice(0, 10)
    .map((item: any) => `${item.type}:${item.id}`);
}

async function main() {
  const [tenantId, maybeUserId, ...queryArgs] = process.argv.slice(2);
  if (!tenantId) {
    console.error('Usage: ts-node scripts/search-index-parity.ts <tenant-id> [user-id] [query ...]');
    process.exit(1);
  }
  const userId = maybeUserId && /^[0-9a-f-]{36}$/i.test(maybeUserId) ? maybeUserId : null;
  const explicitQueries = [...(!userId && maybeUserId ? [maybeUserId] : []), ...queryArgs];
  const queries = explicitQueries.length > 0 ? explicitQueries : DEFAULT_QUERIES;

  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  // Legacy searchAll wraps each per-type query in a SAVEPOINT, which needs an
  // open transaction. Read-only; rolled back on exit.
  await runner.startTransaction();

  let regressions = 0;
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    // Documents need a fully-wired KnowledgeService on the legacy path, so the
    // parity diff covers the 20 SQL entity types and leaves documents to the
    // dedicated knowledge-search and search-index-sync specs.
    const service = new AiEntityService(
      {
        search: async () => ({ items: [], total: 0 }),
        searchMentionOptions: async () => ({ items: [], total: 0 }),
        listReadableLibraryIdsForUser: async () => null,
        getKnowledgeContextForEntity: async () => ({ access: 'granted', total: 0, groups: [] }),
      } as any,
      {
        listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
        canReadKnowledge: async () => true,
        assertEntityTypeReadAccess: async () => undefined,
        canReadEntityType: async () => true,
        // The script reads as a person who reads every family, the admin ones included.
        adminFamiliesGap: async () => null,
      } as any,
    );

    const context = {
      tenantId,
      userId,
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      manager: runner.manager,
    };

    for (const query of queries) {
      process.env.AI_SEARCH_INDEX_ENABLED = 'false';
      const legacy = await service.searchAll(context as any, { query, limit: 10 });
      process.env.AI_SEARCH_INDEX_ENABLED = 'true';
      const indexed = await service.searchAll(context as any, { query, limit: 10 });
      // Recall is judged against a deep page of the new path: with more than
      // 10 matches on both sides, top-10 set differences are just the (known,
      // intentional) cross-type re-ranking, not lost results.
      const indexedDeep = await service.searchAll(context as any, { query, limit: 100 });

      const legacyKeys = new Set(keysOf(legacy));
      const indexedKeys = new Set(keysOf(indexed));
      const indexedDeepKeys = new Set((indexedDeep.items || []).map((item: any) => `${item.type}:${item.id}`));
      const missing = [...legacyKeys].filter((key) => !indexedDeepKeys.has(key));
      const rankedOut = [...legacyKeys].filter((key) => !indexedKeys.has(key) && indexedDeepKeys.has(key));
      const gained = [...indexedKeys].filter((key) => !legacyKeys.has(key));

      // A reference of a numbered family: the record it names, when the tenant holds it, comes first.
      const reference = query.match(/^([A-Z]+)-(\d+)$/i);
      const family = reference ? NUMBERED_FAMILIES[reference[1].toUpperCase()] : undefined;
      let referenceMiss: string | null = null;
      if (family) {
        const [row] = await runner.query(
          `SELECT id::text AS id FROM ${family.table} WHERE tenant_id = $1 AND item_number = $2`,
          [tenantId, Number(reference![2])],
        );
        const first = (indexed.items || [])[0];
        if (row && (first?.type !== family.type || first?.id !== row.id || String(first?.ref).toUpperCase() !== query.toUpperCase())) {
          referenceMiss = `${family.type}:${row.id} not first (first: ${first ? `${first.type}:${first.ref ?? first.id}` : 'none'})`;
        }
      }

      const flag = missing.length > 0 || referenceMiss ? 'REGRESSION' : 'ok';
      if (missing.length > 0 || referenceMiss) regressions += 1;
      console.log(`[${flag}] "${query}" legacy=${legacyKeys.size} indexed=${indexedKeys.size}`
        + (missing.length ? ` | NOT FOUND by new path: ${missing.join(', ')}` : '')
        + (referenceMiss ? ` | REFERENCE: ${referenceMiss}` : '')
        + (rankedOut.length ? ` | re-ranked out of top-10: ${rankedOut.length}` : '')
        + (gained.length ? ` | new-path gains: ${gained.length}` : ''));
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }

  console.log(regressions === 0
    ? 'Parity check passed: the new path found everything the legacy path found.'
    : `Parity check found ${regressions} quer${regressions === 1 ? 'y' : 'ies'} with legacy-only results — investigate before deleting the legacy path.`);
  process.exit(regressions === 0 ? 0 : 2);
}

void main();
