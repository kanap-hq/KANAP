import { IncidentsService } from '../services/incidents.service';
import { assert, inP7Tenant, refusedAsRetired, retiredCode, runP7Specs, type P7Harness } from '../../it-ops-settings/__tests__/catalog-p7.fixtures';

// Lot K2c of 26.12.1, third pass: rule P7 (maintainer, 2026-11-23) on the category of an incident,
// through the API. A retired category is refused on a new incident and on one that does not hold
// it, and kept on the incident that holds it; a name resolves to its code; an unknown category is
// refused with the categories allowed.
// @database-spec: boots the app context through catalog-p7.fixtures, so run-ci-tests.js runs this file on a database lane.

async function testIncidentCategory(harness: P7Harness) {
  const incidents = harness.get<IncidentsService>(IncidentsService);
  await inP7Tenant(harness, async ({ tenantId, runner }) => {
    const opts = { manager: runner.manager, tenantId };
    const retired = retiredCode('incidentCategories');

    await refusedAsRetired(() => incidents.create({ title: 'New outage', severity: 'minor', category: retired }, null, opts), 'a new incident');
    // Seeded rows: the creation itself provisions the review document, which this tenant has no slot for.
    const seed = async (number: number, title: string, category: string | null) => String((await runner.query(
      `INSERT INTO incidents (tenant_id, item_number, title, severity, status, detected_at, category)
       VALUES ($1, $2, $3, 'minor', 'open', now(), $4) RETURNING id`, [tenantId, number, title, category]))[0].id);
    const other = await seed(901, 'Disk full', null);
    const named = await incidents.update(other, { category: 'Security' }, null, opts);
    assert.equal(named.category, 'security', 'a category by its name is stored as its code');
    await refusedAsRetired(() => incidents.update(other, { category: retired }, null, opts), 'an incident that does not hold it');

    // The incident that holds it keeps it: saved with its category and a new severity.
    const holder = await seed(902, 'Old one', retired);
    const kept = await incidents.update(holder, { severity: 'major', category: retired }, null, opts);
    assert.deepEqual([kept.severity, kept.category], ['major', retired]);

    let unknown: any = null;
    try {
      await incidents.update(other, { category: 'meteor strike' }, null, opts);
    } catch (error) {
      unknown = error;
    }
    assert.equal(unknown?.getResponse?.().code, 'category_invalid');
    assert.match(String(unknown?.getResponse?.().params?.allowed), /security \(Security\)/);
    assert.doesNotMatch(String(unknown?.getResponse?.().params?.allowed), new RegExp(retired));

    const cleared = await incidents.update(other, { category: null }, null, opts);
    assert.equal(cleared.category, null, 'empty clears the category');
  });
}

runP7Specs('incident-category-catalog.integration.spec.ts', [['incident category', testIncidentCategory]]).catch((error) => {
  console.error(error);
  process.exit(1);
});
