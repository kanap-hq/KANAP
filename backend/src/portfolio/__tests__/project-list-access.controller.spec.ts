import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { PortfolioProjectsController } from '../portfolio-projects.controller';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

// A business contributor who also reads every project through a second role.
const ROLE_ROWS = [
  { role_id: 'role-bc', role_name: 'business contributor', level: 'contributor' },
  { role_id: 'role-reader', role_name: 'portfolio reader', level: 'reader' },
];

function makeController() {
  const calls: Array<{ method: string; accessScope: unknown }> = [];
  const svc = {
    list: async (_query: unknown, opts: any) => {
      calls.push({ method: 'list', accessScope: opts.accessScope });
      return { items: [] };
    },
    listIds: async (_query: unknown, opts: any) => {
      calls.push({ method: 'listIds', accessScope: opts.accessScope });
      return { ids: [], refs: [], total: 0 };
    },
  };
  const controller = new PortfolioProjectsController(
    svc as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  const ctx = {
    userId: USER_ID,
    tenantId: TENANT_ID,
    manager: { query: async () => ROLE_ROWS },
  } as any;
  return { controller, ctx, calls };
}

async function testReaderListIsUnrestricted() {
  const { controller, ctx, calls } = makeController();
  await controller.list({} as any, ctx);
  await controller.listIds({} as any, ctx);
  assert.deepEqual(calls.map((c) => c.accessScope), [undefined, undefined]);
}

async function testContributorListKeepsOnlyWritableProjects() {
  const { controller, ctx, calls } = makeController();
  await controller.list({ access: 'contributor' } as any, ctx);
  await controller.listIds({ access: 'contributor' } as any, ctx);
  assert.deepEqual(calls.map((c) => c.accessScope), [{ userId: USER_ID }, { userId: USER_ID }]);
}

async function run() {
  await testReaderListIsUnrestricted();
  await testContributorListKeepsOnlyWritableProjects();
}

void run();
