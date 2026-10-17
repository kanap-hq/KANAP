import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AdministrationViewController } from '../reports/administration-view.controller';
import { AdministrationViewModule } from '../reports/administration-view.module';
import { TechnologiesController } from '../technologies.controller';
import { EndOfSupportController } from '../reports/end-of-support.controller';
import { TechnologyVulnerabilitiesController, VulnerabilitiesController } from '../../vulnerabilities/vulnerabilities.controller';

// The administration view (lot A1a) lives in its own module under `technologies/reports/administration`,
// registered after `TechnologiesModule`: no route of `TechnologiesController` (`technologies/:id`,
// `technologies/:id/...`), of the end of support report or of the vulnerabilities (which has
// `technologies/:id/vulnerabilities`) may capture its paths, whatever the order. A new `technologies/:id/:x`
// route would fail here instead of silently answering for the view.

type Route = { method: RequestMethod; path: string };

function routesOf(controller: any): Route[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto).flatMap((name) => {
    if (name === 'constructor') return [];
    const path = Reflect.getMetadata(PATH_METADATA, proto[name]);
    if (path === undefined) return [];
    const full = `/${base}/${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    return [{ method: Reflect.getMetadata(METHOD_METADATA, proto[name]) as RequestMethod, path: full }];
  });
}

const matches = (pattern: string, path: string) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}/?$`).test(path);

function testNotCaptured() {
  const view = routesOf(AdministrationViewController);
  assert.deepEqual(view.map((r) => `${RequestMethod[r.method]} ${r.path}`).sort(), [
    'GET /technologies/reports/administration',
    'GET /technologies/reports/administration/export',
  ]);
  const technologyRoutes = [TechnologiesController, EndOfSupportController, VulnerabilitiesController, TechnologyVulnerabilitiesController].flatMap(routesOf);
  assert.ok(technologyRoutes.some((r) => r.path === '/technologies/:id'), 'the record route is seen');
  assert.ok(technologyRoutes.some((r) => r.path === '/technologies/:id/relations'), 'the sub-routes are seen');
  assert.ok(technologyRoutes.some((r) => r.path === '/technologies/reports/end-of-support/gaps'), 'the end of support report is seen');
  assert.ok(technologyRoutes.some((r) => r.path.startsWith('/technologies/:id/vulnerabilities')), 'the vulnerabilities of a technology are seen');
  for (const route of view) {
    const captors = technologyRoutes.filter((r) => r.method === route.method && matches(r.path, route.path));
    assert.deepEqual(captors, [], `${route.path} is captured by ${captors.map((c) => c.path).join(', ')}`);
  }
}

function testRegistered() {
  // Read from the source: importing the application module would load every module of the API.
  const appModule = readFileSync(backendPath('src/app.module.ts'), 'utf8');
  assert.match(appModule, /^\s+AdministrationViewModule,$/m, 'the module is registered in the application');
  const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AdministrationViewModule);
  assert.deepEqual(controllers, [AdministrationViewController]);
}

const tests: Array<[string, () => void]> = [
  ['administration view routes are not captured by technologies/:id', testNotCaptured],
  ['administration view module registered', testRegistered],
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
