import 'dotenv/config';
import dataSource from '../../data-source';
import { resolveToUuid } from '../resolve-item-id';
import { assert, Kind, runSpecs, seedItem, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { withRlsLifted } from './rls-bypass.fixtures';

// OPX-N and CPX-N are numbered per tenant: two tenants both have OPX-1. With
// RLS lifted on the item tables, the reference still resolves to the line of
// the request's tenant, by the explicit tenant predicate. RLS is lifted for
// `app` (see `withRlsLifted`: never against a database a live API uses).
// Since lot Z1 both natures are lines of `spend_items`; a CAPEX line's CPX number
// is its legacy number (`legacy_number`), its own number a BL number.

const KINDS: Kind[] = ['opex', 'capex'];
const PREFIX = { opex: 'OPX', capex: 'CPX' } as const;
const SCOPE = { opex: 'spend', capex: 'capex' } as const;

async function testReferenceResolvesInTheRequestTenant() {
  await withRlsLifted(['spend_items'], async (runner) => {
    // Tenant B's lines first, so an unfiltered `LIMIT 1` would likely find them.
    const tenantB = await seedTenant(runner, 'ref-b');
    const linesB = { opex: await seedItem(runner, 'opex', tenantB, 1), capex: await seedItem(runner, 'capex', tenantB, 1) };
    const tenantA = await seedTenant(runner, 'ref-a');
    const linesA = { opex: await seedItem(runner, 'opex', tenantA, 1), capex: await seedItem(runner, 'capex', tenantA, 1) };

    for (const [tenantId, lines] of [[tenantA, linesA], [tenantB, linesB]] as const) {
      await setTenant(runner, tenantId);
      for (const kind of KINDS) {
        const numberOne = kind === 'opex' ? `nature = 'opex' AND item_number = 1` : `nature = 'capex' AND legacy_number = 'CPX-1'`;
        const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM spend_items WHERE ${numberOne} AND id = ANY($1::uuid[])`, [[linesA[kind], linesB[kind]]]);
        assert.equal(n, 2, `${kind}: with RLS lifted, both tenants' lines number 1 are visible`);
        assert.equal(await resolveToUuid(`${PREFIX[kind]}-1`, SCOPE[kind], runner.manager), lines[kind], `${kind}: ${PREFIX[kind]}-1 is the line of the session tenant`);
        assert.equal(await resolveToUuid('1', SCOPE[kind], runner.manager), lines[kind], `${kind}: a plain number too`);
      }
    }
  });
}

void runSpecs('resolve-item-id-tenant.integration.spec', [
  ['testReferenceResolvesInTheRequestTenant', testReferenceResolvesInTheRequestTenant],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
