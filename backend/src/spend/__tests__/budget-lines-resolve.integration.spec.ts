// @database-spec: uses the PostgreSQL transaction harness.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { resolveBudgetLine } from '../../common/resolve-item-id';
import { assert, inRolledBackTransaction, runSpecs } from './round-inputs.fixtures';
import { seedBudgetLines } from './budget-lines.fixtures';

runSpecs('budget-lines-resolve.integration.spec', [['native and legacy references across tenants and a reclassified line', async () => {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, lines, foreign } = await seedBudgetLines(runner);
    for (const line of lines) {
      for (const ref of [line.itemId, `BL-${line.number}`, `bl-${line.number}`, String(line.number), line.legacy, line.legacy.toLowerCase()]) {
        assert.deepEqual(await resolveBudgetLine(ref, runner.manager), { id: line.itemId, nature: line.nature, reference: `BL-${line.number}` }, ref);
      }
    }
    // Same persisted state as an in-place change of type: an OPX legacy ref on a CAPEX line.
    const line = lines[0];
    await runner.query(`UPDATE spend_items SET nature = 'capex' WHERE tenant_id = $1 AND id = $2 AND nature = 'opex'`, [tenantId, line.itemId]);
    for (const ref of [line.itemId, `BL-${line.number}`, line.legacy]) {
      assert.deepEqual(await resolveBudgetLine(ref, runner.manager), { id: line.itemId, nature: 'capex', reference: `BL-${line.number}` });
    }
    for (const ref of [foreign.itemId, randomUUID(), 'BL-999999', '999999', 'OPX-999999', 'CPX-999999']) {
      await assert.rejects(resolveBudgetLine(ref, runner.manager), NotFoundException, ref);
    }
    for (const ref of ['', 'T-1', 'BL-abc', '-1', '1.2', 'BL-1-extra', '9223372036854775808']) {
      await assert.rejects(resolveBudgetLine(ref, runner.manager), BadRequestException, ref);
    }
    console.log('ok - UUID, BL, bare number, OPX, CPX, reclassification, malformed and missing references');
  });
}]]).catch((err) => { console.error(err); process.exit(1); });
