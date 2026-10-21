// @database-spec
import 'dotenv/config';
import type { EntityManager } from 'typeorm';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologiesController } from '../technologies.controller';
import { services, technology, version } from './technologies.fixtures';

// GET /technologies/:id reads the shipped catalog for the screen: the source of a version's dates
// while they still match a product KANAP maintains, and the distributor's vulnerability tracker.
// The service record (list, update, export, assistant) stays without either field.

function screen(technologies: ReturnType<typeof services>['technologies'], catalog: ReturnType<typeof services>['catalog']) {
  return new TechnologiesController(
    technologies,
    {} as never,
    {} as never,
    {} as never,
    catalog,
    {} as never,
    {} as never,
    {} as never,
  );
}

function ctxOf(manager: EntityManager, tenantId: string) {
  return { manager, tenantId, userId: null } as unknown as Parameters<TechnologiesController['get']>[1];
}

async function testCatalogScreen() {
  await inRolledBackTransaction(async (runner) => {
    const { technologies, catalog } = services();
    const controller = screen(technologies, catalog);
    const gaia = catalog.shippedProduct('check-point-gaia')!;
    const r8120 = gaia.versions.find((item) => item.key === 'R81.20')!;
    assert.equal(r8120.standard_support_end, '2027-05-31');
    assert.equal(r8120.extended_support_end, null);
    assert.equal(r8120.no_planned_end, false);

    const tenantId = await seedTenant(runner, 'cat-screen-gaia');
    const opts = { manager: runner.manager, tenantId };
    const adopted = await catalog.adopt('check-point-gaia', opts);
    const raw = await technologies.get(adopted.technology.id, opts);
    assert.equal('catalog_security_tracker' in raw, false, 'the service record has no tracker');
    assert.equal(raw.versions.every((item) => !('catalog_source' in item)), true, 'the service record has no date source');

    const shown = await controller.get(adopted.technology.id, ctxOf(runner.manager, tenantId));
    assert.equal(shown.catalog_security_tracker, null, 'Check Point publishes no package tracker');
    const match = shown.versions.find((item) => item.label === 'R81.20');
    assert.ok(match, 'R81.20 was adopted');
    assert.deepEqual(match.catalog_source, {
      source_url: r8120.source_url,
      checked_on: r8120.checked_on,
      editor: 'Check Point',
      no_planned_end: false,
    });

    await version(runner, tenantId, adopted.technology.id, 'site build', '2030-01-01');
    await runner.query(
      `UPDATE technology_versions SET standard_support_end = '2028-01-15'
        WHERE tenant_id = $1 AND technology_id = $2 AND label = 'R81.20'`,
      [tenantId, adopted.technology.id],
    );
    const edited = await controller.get(adopted.technology.id, ctxOf(runner.manager, tenantId));
    assert.equal(edited.versions.find((item) => item.label === 'R81.20')?.catalog_source, null, 'a date typed by hand clears the source');
    assert.equal(edited.versions.find((item) => item.label === 'site build')?.catalog_source, null, 'a version typed by hand has no source');
    assert.ok(edited.versions.find((item) => item.label === 'R82')?.catalog_source, 'a version whose dates still match keeps its source');

    await runner.query(
      `UPDATE technology_versions SET standard_support_end = $3
        WHERE tenant_id = $1 AND technology_id = $2 AND label = 'R81.20'`,
      [tenantId, adopted.technology.id, r8120.standard_support_end],
    );
    const restored = await controller.get(adopted.technology.id, ctxOf(runner.manager, tenantId));
    assert.equal(restored.versions.find((item) => item.label === 'R81.20')?.catalog_source?.source_url, r8120.source_url, 'dates equal to the catalog show the source again');

    await runner.query(
      `UPDATE technology_versions SET extended_support_end = '2031-01-01'
        WHERE tenant_id = $1 AND technology_id = $2 AND label = 'R81.20'`,
      [tenantId, adopted.technology.id],
    );
    const extended = await controller.get(adopted.technology.id, ctxOf(runner.manager, tenantId));
    assert.equal(extended.versions.find((item) => item.label === 'R81.20')?.catalog_source, null, 'the extended date counts as well');
  });
}

async function testDistributionTrackerAndHandTyped() {
  await inRolledBackTransaction(async (runner) => {
    const { technologies, catalog } = services();
    const controller = screen(technologies, catalog);
    const ubuntu = catalog.shippedProduct('ubuntu')!;
    assert.equal(ubuntu.security_tracker, 'https://ubuntu.com/security/cves');
    assert.equal(Object.prototype.hasOwnProperty.call(ubuntu, 'source_updated'), false, 'Ubuntu is not maintained by KANAP');

    const tenantId = await seedTenant(runner, 'cat-screen-ubuntu');
    const adopted = await catalog.adopt('ubuntu', { manager: runner.manager, tenantId });
    const shown = await controller.get(adopted.technology.id, ctxOf(runner.manager, tenantId));
    assert.equal(shown.catalog_security_tracker, 'https://ubuntu.com/security/cves');
    assert.ok(shown.versions.some((item) => item.catalog_key && item.standard_support_end), 'an Ubuntu version carries catalog dates');
    assert.equal(shown.versions.every((item) => item.catalog_source === null), true, 'endoflife.date dates have no KANAP source');

    const plainId = await seedTenant(runner, 'cat-screen-plain');
    const id = await technology(runner, plainId, 1, 'Homemade monitor', 'monitoring');
    const versionId = await version(runner, plainId, id, '1.0', '2030-01-01');
    await runner.query(
      `UPDATE technology_versions
          SET catalog_key = 'check-point-gaia:R81.20', standard_support_end = '2027-05-31', extended_support_end = NULL
        WHERE tenant_id = $1 AND id = $2`,
      [plainId, versionId],
    );
    const plain = await controller.get(id, ctxOf(runner.manager, plainId));
    assert.equal(plain.catalog_key, null);
    assert.equal(plain.catalog_security_tracker, null);
    assert.equal(plain.versions[0]?.catalog_source, null, 'a technology without a catalog key carries no source');
    const stored = await technologies.get(id, { manager: runner.manager, tenantId: plainId });
    assert.equal('catalog_security_tracker' in stored, false);
  });
}

/** IBM WebSphere 8.5 and 9.0: the vendor states no planned end, and both stored dates stay empty. */
async function testNoPlannedEnd() {
  await inRolledBackTransaction(async (runner) => {
    const { technologies, catalog } = services();
    const controller = screen(technologies, catalog);
    const tenantId = await seedTenant(runner, 'cat-screen-was');
    const adopted = await catalog.adopt('ibm-websphere', { manager: runner.manager, tenantId });
    const shown = await controller.get(adopted.technology.id, ctxOf(runner.manager, tenantId));
    assert.equal(shown.catalog_security_tracker, null);
    for (const label of ['9.0.x', '8.5.x']) {
      const row = shown.versions.find((item) => item.label === label);
      assert.equal(row?.standard_support_end, null, label);
      assert.equal(row?.extended_support_end, null, label);
      assert.equal(row?.catalog_source?.no_planned_end, true, label);
      assert.equal(row?.catalog_source?.editor, 'IBM', label);
    }
  });
}

runSpecs('technology-catalog-screen.integration.spec', [
  ['catalog date source', testCatalogScreen],
  ['distribution tracker and a hand-typed technology', testDistributionTrackerAndHandTyped],
  ['no planned end', testNoPlannedEnd],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
