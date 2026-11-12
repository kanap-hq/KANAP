// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { applyDataAccess } from '../data-access';
import { PgClient, roleExists } from './data-access-test-helpers';
import { Label, Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access: the budget lines of a project or of a request (`POST
 * /portfolio/projects/:id/opex|capex/bulk-replace`, the same routes of the requests, and the
 * assistant's relation writes) are replaced under the person's access, as every request of the
 * tenant interceptor (`applyDataAccess`, `common/tenant.interceptor.ts`). On the reference example
 * (`data-access-line-seed.ts`), Rita (INF-FR edit, INF read) modifies L1, reads L3, does not read L5:
 * - she links L1 and L3 (a read-only line can be linked) to a project and to a request;
 * - she does not link L5: the line reads as missing (400), and no link is written;
 * - her replacement keeps a link to L5 that someone else made: she neither sees nor removes it;
 * - Ulla, with access to all data, links L5.
 * One transaction on one connection, rolled back; each write under a savepoint.
 *
 * Needs the role kanap_data_limited (CI installs it).
 */

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'data-access-project-request-lines-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Family = 'project' | 'request';
type Harness = { app: any; dataSource: DataSource; services: Record<Family, any> };
type Objects = Record<Family, string>;

const LINKS: Record<Family, { table: string; column: string }> = {
  project: { table: 'portfolio_project_opex', column: 'project_id' },
  request: { table: 'portfolio_request_opex', column: 'request_id' },
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for data-access-project-request-lines.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { PortfolioProjectsService } = require('../../portfolio/services/portfolio-projects.service');
  const { PortfolioRequestsService } = require('../../portfolio/portfolio-requests.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    services: { project: app.get(PortfolioProjectsService), request: app.get(PortfolioRequestsService) },
  };
}

async function natureOf(client: PgClient, line: string): Promise<'opex' | 'capex'> {
  return (await client.query(`SELECT nature FROM spend_items WHERE id = $1`, [line])).rows[0].nature;
}

async function linkedLines(client: PgClient, family: Family, objectId: string): Promise<string[]> {
  const { table, column } = LINKS[family];
  const rows = (await client.query(`SELECT opex_id FROM ${table} WHERE ${column} = $1 ORDER BY opex_id`, [objectId])).rows;
  return rows.map((row: { opex_id: string }) => row.opex_id);
}

/** Replaces the lines of `nature` of the object as `userId`, under their access, in a savepoint kept on success. */
async function replaceAs(
  h: Harness,
  runner: QueryRunner,
  client: PgClient,
  family: Family,
  objectId: string,
  userId: string,
  nature: 'opex' | 'capex',
  lines: string[],
): Promise<unknown> {
  await client.query('SAVEPOINT da_lines');
  try {
    await applyDataAccess(runner, userId);
    const service = h.services[family];
    const opts = { manager: runner.manager, userId };
    const result = nature === 'opex' ? await service.bulkReplaceOpex(objectId, lines, opts) : await service.bulkReplaceCapex(objectId, lines, opts);
    // Back to the owner's role, the writes kept.
    await client.query('RESET ROLE');
    await client.query('RELEASE SAVEPOINT da_lines');
    return result;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT da_lines');
    throw error;
  }
}

async function testLimitedPerson(h: Harness, runner: QueryRunner, client: PgClient, s: Seed, objects: Objects) {
  const { lines, persons } = s;
  const nature = async (label: Label) => natureOf(client, lines[label]);
  for (const family of ['project', 'request'] as Family[]) {
    const objectId = objects[family];
    // L5, out of Rita's access: reads as missing, nothing written.
    const error = await replaceAs(h, runner, client, family, objectId, persons.rita, await nature('L5'), [lines.L5])
      .then(() => null, (caught: any) => caught);
    assert.ok(error, `${family}: L5 refused`);
    assert.equal(error.getStatus?.(), 400, `${family}: L5 reads as missing (${error?.message})`);
    assert.deepEqual(await linkedLines(client, family, objectId), [], `${family}: no link to L5`);

    // L1 (editable) and L3 (read-only) are linked.
    for (const label of ['L1', 'L3'] as Label[]) {
      const kept = await linkedLines(client, family, objectId);
      const sameNature = [];
      for (const id of kept) if ((await natureOf(client, id)) === (await nature(label))) sameNature.push(id);
      await replaceAs(h, runner, client, family, objectId, persons.rita, await nature(label), [...sameNature, lines[label]]);
    }
    assert.deepEqual(await linkedLines(client, family, objectId), [lines.L1, lines.L3].sort(), `${family}: L1 and L3 linked`);

    // Ulla (all data) links L5; Rita's later replacement keeps it.
    const l5 = await nature('L5');
    await replaceAs(h, runner, client, family, objectId, persons.ulla, l5, [lines.L5, ...(l5 === (await nature('L1')) ? [lines.L1] : []), ...(l5 === (await nature('L3')) ? [lines.L3] : [])]);
    await replaceAs(h, runner, client, family, objectId, persons.rita, l5, []);
    const after = await linkedLines(client, family, objectId);
    assert.ok(after.includes(lines.L5), `${family}: the link to L5 stays after Rita's replacement`);
  }
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    // The connection TypeORM runs the services on: the seed and the checks share its transaction.
    const client = (runner as any).databaseConnection as PgClient;
    assert.ok(await roleExists(client), 'the role kanap_data_limited exists');
    await runner.startTransaction();
    try {
      const s = await seed(client);
      const one = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0].id as string;
      const objects: Objects = {
        project: await one(`INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES (app_current_tenant(), 'DA lines project', 910001) RETURNING id`, []),
        request: await one(`INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES (app_current_tenant(), 'DA lines request', 910001) RETURNING id`, []),
      };
      await testLimitedPerson(harness, runner, client, s, objects);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('data-access-project-request-lines.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
