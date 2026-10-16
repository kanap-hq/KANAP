// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { context, inRolledBackTransaction, relationsService, runSpecs, seedRelations, setTenant } from './application-relations.fixtures';

// Tenant isolation of the Relations tab service (lot R1): under another tenant, an application
// is not found, for reading and for writing, and nothing of the first tenant shows in the
// second tenant's tab, suggestions included.

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedRelations(runner, 'iso-a');
    const b = await seedRelations(runner, 'iso-b');
    const svc = relationsService();

    // The session is on B: A's application does not exist here.
    await assert.rejects(svc.getRelations(a.appId, context(runner.manager, b)), NotFoundException);
    await assert.rejects(svc.setLink('contracts', a.appId, a.contracts.sameSupplier, true, context(runner.manager, b)), NotFoundException);
    await assert.rejects(svc.bulkReplaceRequests(a.appId, [], context(runner.manager, b)), NotFoundException);

    // B's tab holds B's rows only.
    const resB = await svc.getRelations(b.appId, context(runner.manager, b));
    const aIds = new Set([
      ...Object.values(a.lines), ...Object.values(a.contracts), ...Object.values(a.projects),
      ...Object.values(a.requests), ...Object.values(a.tasks),
    ]);
    const shown = [
      ...(resB.budget_lines ?? []), ...(resB.contracts ?? []), ...(resB.projects ?? []),
      ...(resB.requests ?? []), ...(resB.tasks ?? []), ...resB.suggestions,
    ].map((row) => row.id);
    assert.ok(shown.length > 0);
    assert.ok(shown.every((id) => !aIds.has(id)));

    // Linking one of A's objects to B's application is refused as unknown.
    await assert.rejects(svc.setLink('budget_lines', b.appId, a.lines.sameSupplier, true, context(runner.manager, b)));
    await assert.rejects(svc.setLink('requests', b.appId, a.requests.free, true, context(runner.manager, b)));

    // Back on A, its tab is whole.
    await setTenant(runner, a.tenantId);
    const resA = await svc.getRelations(a.appId, context(runner.manager, a));
    assert.equal(resA.budget_lines?.length, 2);
  });
}

runSpecs('application-relations-tenant-isolation.integration.spec', [testTenantIsolation]).catch((err) => {
  console.error(err);
  process.exit(1);
});
