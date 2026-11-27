// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { inRolledBackTransaction, seedCreationTenant } from '../../common/creation/__tests__/creation-cancel.fixtures';
import { User } from '../../users/user.entity';
import { EntraDirectorySyncService } from '../entra-directory-sync.service';
import type { DirectoryProfile } from '../entra-directory-sync.util';

// The department and company a Microsoft Entra profile sets on a person (lot I7a of 26.12.1): the
// directory's department is looked up in the person's company (the directory's, else the stored one);
// a name several companies share, with no company, changes nothing; a unique name is taken with its
// company; a company changed drops a department of another company; a name the company does not have
// leaves the department as it is. Every lookup names its tenant.

async function testDirectoryDepartment() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId } = await seedCreationTenant(runner, {});
    const ids = { alpha: randomUUID(), beta: randomUUID(), finA: randomUUID(), finB: randomUUID(), legalB: randomUUID() };
    await runner.query(
      `INSERT INTO companies (id, tenant_id, name, country_iso, city) VALUES ($1, $3, 'Alpha', 'FR', 'Lyon'), ($2, $3, 'Beta', 'FR', 'Brest')`,
      [ids.alpha, ids.beta, tenantId],
    );
    await runner.query(
      `INSERT INTO departments (id, tenant_id, company_id, name) VALUES ($1, $4, $5, 'Finance'), ($2, $4, $6, 'Finance'), ($3, $4, $6, 'Legal')`,
      [ids.finA, ids.finB, ids.legalB, tenantId, ids.alpha, ids.beta],
    );
    const sql: string[] = [];
    const manager = new Proxy(runner.manager, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop === 'getRepository') {
          return (entity: any) => {
            const repo = target.getRepository(entity);
            return new Proxy(repo, {
              get(repoTarget, repoProp) {
                const repoValue = Reflect.get(repoTarget, repoProp, repoTarget);
                if (repoProp !== 'createQueryBuilder') return typeof repoValue === 'function' ? repoValue.bind(repoTarget) : repoValue;
                return (...args: any[]) => {
                  const builder = (repoTarget as any).createQueryBuilder(...args);
                  const getOne = builder.getOne.bind(builder);
                  const getMany = builder.getMany.bind(builder);
                  builder.getOne = () => { sql.push(builder.getQuery()); return getOne(); };
                  builder.getMany = () => { sql.push(builder.getQuery()); return getMany(); };
                  return builder;
                };
              },
            });
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as EntityManager;
    const service = new EntraDirectorySyncService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const person = async (company: string | null, department: string | null) => {
      await runner.query(`UPDATE users SET company_id = $2, department_id = $3 WHERE id = $1`, [creatorId, company, department]);
      return runner.manager.getRepository(User).findOneByOrFail({ id: creatorId });
    };
    const apply = async (user: User, profile: DirectoryProfile) => {
      await service.applyDirectoryProfile(user, profile, manager);
      return { company: user.company_id ?? null, department: user.department_id ?? null };
    };

    assert.deepEqual(await apply(await person(ids.alpha, null), { department: 'Finance' }), { company: ids.alpha, department: ids.finA }, 'the department of the person company');
    assert.deepEqual(await apply(await person(null, null), { department: 'Finance' }), { company: null, department: null }, 'a shared name without a company changes nothing');
    assert.deepEqual(await apply(await person(null, null), { department: 'Legal' }), { company: ids.beta, department: ids.legalB }, 'a unique name gives its company');
    assert.deepEqual(await apply(await person(ids.alpha, ids.finA), { companyName: 'Beta' }), { company: ids.beta, department: null }, 'another company drops the department');
    assert.deepEqual(await apply(await person(ids.alpha, ids.finA), { companyName: 'Beta', department: 'Finance' }), { company: ids.beta, department: ids.finB }, 'the department of the new company');
    assert.deepEqual(await apply(await person(ids.alpha, ids.finA), { department: 'Legal' }), { company: ids.alpha, department: ids.finA }, 'a name the company lacks keeps the department');

    assert.ok(sql.length > 0, 'the lookups ran');
    for (const query of sql) assert.match(query.slice(query.indexOf(" WHERE ")), /tenant_id/, `a lookup without its tenant: ${query}`);
  });
}

async function main() {
  await dataSource.initialize();
  let failed = false;
  try {
    await testDirectoryDepartment();
    console.log('ok - the department a directory profile sets');
  } catch (error) {
    failed = true;
    console.error(`not ok - the department a directory profile sets\n${(error as Error).stack}`);
  } finally {
    await closeMarkdownWorkers();
    await dataSource.destroy();
  }
  if (failed) process.exit(1);
}

void main();
