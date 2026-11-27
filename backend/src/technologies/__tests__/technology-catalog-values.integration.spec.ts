import { TechnologiesService } from '../technologies.service';
import { assert, inP7Tenant, refusedAsRetired, retiredCode, runP7Specs, type P7Harness } from '../../it-ops-settings/__tests__/catalog-p7.fixtures';

// Lot K2c of 26.12.1, third pass: rule P7 (maintainer, 2026-11-23) on the family, the hosting type,
// the lifecycle and the administration zone of a technology. A retired value is refused on a new
// technology and on one that does not hold it, and kept on the technology that holds it; an unknown
// value is refused with the values allowed.
// @database-spec: boots the app context through catalog-p7.fixtures, so run-ci-tests.js runs this file on a database lane.

const FIELDS = [
  ['family', 'technologyFamilies'],
  ['hosting_type', 'hostingTypes'],
  ['lifecycle', 'lifecycleStates'],
  ['admin_zone', 'adminZones'],
] as const;

async function testTechnologyValues(harness: P7Harness) {
  const technologies = harness.get<TechnologiesService>(TechnologiesService);
  await inP7Tenant(harness, async ({ tenantId, runner }) => {
    const opts = { manager: runner.manager, tenantId };
    const other = await technologies.create({ name: 'PostgreSQL' } as any, opts);
    for (const [field, list] of FIELDS) {
      const retired = retiredCode(list);
      // API, creation and modification of a technology that does not hold it.
      await refusedAsRetired(() => technologies.create({ name: `New ${field}`, [field]: retired } as any, opts), `a new technology, ${field}`);
      await refusedAsRetired(() => technologies.update(other.id, { [field]: retired } as any, opts), `a technology that does not hold its ${field}`);
    }

    // The technology that holds them keeps them: saved with its values and a new name.
    const [{ id: holder }] = await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle, admin_zone)
       VALUES ($1, 900, 'Old tech', $2, $3, $4, $5) RETURNING id`,
      [tenantId, ...FIELDS.map(([, list]) => retiredCode(list))]);
    const kept = await technologies.update(String(holder), {
      name: 'Old tech 2', ...Object.fromEntries(FIELDS.map(([field, list]) => [field, retiredCode(list)])),
    } as any, opts);
    assert.equal(kept.name, 'Old tech 2');
    for (const [field, list] of FIELDS) assert.equal((kept as any)[field], retiredCode(list), `${field} kept`);

    // By its name, as the list shows it; an unknown value is refused with the values allowed.
    const named = await technologies.update(other.id, { hosting_type: 'Public Cloud', lifecycle: 'Active' } as any, opts);
    assert.deepEqual([(named as any).hosting_type, (named as any).lifecycle], ['public_cloud', 'active']);
    let unknown: any = null;
    try {
      await technologies.update(other.id, { family: 'mainframe' } as any, opts);
    } catch (error) {
      unknown = error;
    }
    assert.equal(unknown?.getResponse?.().code, 'catalog_value_unknown');
    assert.doesNotMatch(String(unknown?.getResponse?.().params?.allowed), new RegExp(retiredCode('technologyFamilies')));
  });
}

runP7Specs('technology-catalog-values.integration.spec.ts', [['technology catalog values', testTechnologyValues]]).catch((error) => {
  console.error(error);
  process.exit(1);
});
