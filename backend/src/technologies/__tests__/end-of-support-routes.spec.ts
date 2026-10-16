import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { EndOfSupportController } from '../reports/end-of-support.controller';
import { TechnologiesController } from '../technologies.controller';
import { TechnologiesModule } from '../technologies.module';

// The routes of the "End of support" report (lot T4) live in their own controller under
// `technologies/reports/end-of-support`: no route of `TechnologiesController` (`technologies/:id`,
// `technologies/:id/...`) may capture them, and the report's controller is registered first.

type Route = { method: RequestMethod; path: string };

function routesOf(controller: any): Route[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto).flatMap((name) => {
    if (name === 'constructor') return [];
    const handler = proto[name];
    const path = Reflect.getMetadata(PATH_METADATA, handler);
    if (path === undefined) return [];
    const full = `/${base}/${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    return [{ method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod, path: full }];
  });
}

const matches = (pattern: string, path: string) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}/?$`).test(path);

function testReportRoutes() {
  const report = routesOf(EndOfSupportController);
  assert.deepEqual(
    report.map((r) => `${RequestMethod[r.method]} ${r.path}`).sort(),
    [
      'GET /technologies/reports/end-of-support',
      'GET /technologies/reports/end-of-support/export',
      'GET /technologies/reports/end-of-support/gaps',
    ],
  );
  const technologyRoutes = routesOf(TechnologiesController);
  assert.ok(technologyRoutes.some((r) => r.path === '/technologies/:id'), 'the record route is seen');
  for (const route of report) {
    const captors = technologyRoutes.filter((r) => r.method === route.method && matches(r.path, route.path));
    assert.deepEqual(captors, [], `${route.path} is captured by ${captors.map((c) => c.path).join(', ')}`);
  }
}

function testRegistrationOrder() {
  const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, TechnologiesModule);
  assert.ok(controllers.indexOf(EndOfSupportController) >= 0, 'the report controller is registered');
  assert.ok(controllers.indexOf(EndOfSupportController) < controllers.indexOf(TechnologiesController), 'and before technologies/:id');
}

const tests: Array<[string, () => void]> = [
  ['report routes are not captured by technologies/:id', testReportRoutes],
  ['report controller registered first', testRegistrationOrder],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}
if (failed) process.exit(1);
