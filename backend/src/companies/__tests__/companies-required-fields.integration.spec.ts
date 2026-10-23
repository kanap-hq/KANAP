import 'dotenv/config';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { CompaniesService } from '../companies.service';
import { Company } from '../company.entity';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  underSavepoint,
} from '../../spend/__tests__/round-inputs.fixtures';

// Name, country and city are NOT NULL columns: create without one of them, or update with one of
// them null or empty, is refused with a 400 naming the field (`code: 'required'`) before the
// database, instead of the 500 a NOT NULL violation used to give.

function service(runner: QueryRunner) {
  return new CompaniesService(runner.manager.getRepository(Company), captureAudit() as any, undefined as any);
}

const base = { name: 'Acme', country_iso: 'FR', city: 'Lyon', base_currency: 'EUR' };
const FIELDS = ['name', 'country_iso', 'city'] as const;

async function expectRequired(field: string, fn: () => Promise<unknown>) {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof BadRequestException, `${field}: expected a 400, got ${String(caught)}`);
  const body = (caught as BadRequestException).getResponse() as { code?: string; field?: string; statusCode?: number };
  assert.strictEqual(body.statusCode, 400);
  assert.strictEqual(body.code, 'required');
  assert.strictEqual(body.field, field);
}

void runSpecs('companies required fields', [
  ['create refuses a missing, null or blank name, country or city', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service(runner);
      await seedTenant(runner, 'company-required-create');
      const opts = { manager: runner.manager };
      for (const field of FIELDS) {
        const { [field]: _omitted, ...without } = base;
        await underSavepoint(runner, () => expectRequired(field, () => svc.create(without, undefined, opts)));
        for (const empty of [null, '', '  ']) {
          await underSavepoint(runner, () => expectRequired(field, () => svc.create({ ...base, [field]: empty }, undefined, opts)));
        }
      }
      const rows: unknown[] = await runner.query(`SELECT id FROM companies`);
      assert.strictEqual(rows.length, 0, 'no company created');
      // A complete body is still created.
      const created = await svc.create(base, undefined, opts);
      assert.strictEqual(created.city, 'Lyon');
    });
  }],
  ['update refuses a null or blank name, country or city, and leaves out the fields it does not send', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service(runner);
      await seedTenant(runner, 'company-required-update');
      const opts = { manager: runner.manager };
      const acme = await svc.create(base, undefined, opts);
      for (const field of FIELDS) {
        for (const empty of [null, '', '  ']) {
          await underSavepoint(runner, () => expectRequired(field, () => svc.update(acme.id, { [field]: empty }, undefined, opts)));
        }
      }
      // A body without the three fields is not refused, and valid values are saved.
      await svc.update(acme.id, { notes: 'Holding' }, undefined, opts);
      await svc.update(acme.id, { city: 'Paris', name: 'Acme SA' }, undefined, opts);
      const rows: Array<{ name: string; country_iso: string; city: string; notes: string }> = await runner.query(
        `SELECT name, country_iso, city, notes FROM companies`,
      );
      assert.deepStrictEqual(rows, [{ name: 'Acme SA', country_iso: 'FR', city: 'Paris', notes: 'Holding' }]);
    });
  }],
]);
