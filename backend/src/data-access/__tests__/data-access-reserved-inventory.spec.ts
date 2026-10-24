import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { backendPath } from '../../common/__tests__/backend-root';
import { DATA_ACCESS_PATHS } from '../data-access-paths.inventory';
import { DATA_ACCESS_RESERVED_ROUTES } from '../data-access-reserved.inventory';
import { RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY } from '../reserved-operations';

/**
 * Data-scoped access, lot 3: the inventory of the operations reserved to unscoped persons
 * (planning/data-scoped-access/spec.md §2.7, §6.7), read from the route metadata Nest uses (no
 * database):
 * 1. every route of each listed controller is either reserved (the decorator on the handler, or on
 *    the controller) or allowed with a reason, and the inventory names exactly the decorated ones;
 * 2. every controller that uses the decorator is listed, and so is every controller of a listed file;
 * 3. the sites `data-access-paths.inventory.ts` classifies `reserved` in these controllers are
 *    reserved routes.
 */

const SRC = backendPath('src');

type ControllerClass = { name: string; prototype: Record<string, unknown> };

/** The controller classes a source file exports (compiled next to this spec in CI). */
function controllersOf(file: string): Map<string, ControllerClass> {
  const mod = require(path.resolve(__dirname, '..', '..', file.replace(/\.ts$/, ''))) as Record<string, unknown>;
  const out = new Map<string, ControllerClass>();
  for (const value of Object.values(mod)) {
    if (typeof value !== 'function') continue;
    if (Reflect.getMetadata(PATH_METADATA, value) === undefined) continue;
    out.set((value as ControllerClass).name, value as ControllerClass);
  }
  return out;
}

function routeMethods(controller: ControllerClass): string[] {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .filter((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, name);
      return typeof descriptor?.value === 'function' && Reflect.getMetadata(METHOD_METADATA, descriptor.value) !== undefined;
    })
    .sort();
}

function isReservedRoute(controller: ControllerClass, method: string): boolean {
  return Reflect.getMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, controller.prototype[method] as object) === true
    || Reflect.getMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, controller) === true;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

/** Source files of `src` (relative, without the tests) that use the decorator in their code. */
function filesUsingTheDecorator(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
      const code = fs.readFileSync(full, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
      if (/@ReservedToUnscopedDataAccess\s*\(/.test(code)) out.push(path.relative(SRC, full).split(path.sep).join('/'));
    }
  };
  walk(SRC);
  return out.sort();
}

function run(): void {
  console.log('data access reserved operations inventory');
  const byFile = new Map<string, Map<string, ControllerClass>>();
  const seen = new Set<string>();
  let reservedCount = 0;
  let allowedCount = 0;

  // 1. Each listed controller: reserved and allowed routes, nothing else, nothing twice.
  for (const entry of DATA_ACCESS_RESERVED_ROUTES) {
    const key = `${entry.file}#${entry.controller}`;
    assert.ok(!seen.has(key), `${key}: listed twice`);
    seen.add(key);
    if (!byFile.has(entry.file)) byFile.set(entry.file, controllersOf(entry.file));
    const controller = byFile.get(entry.file)!.get(entry.controller);
    assert.ok(controller, `${key}: no such controller exported by the file`);

    const routes = routeMethods(controller);
    const classLevel = Reflect.getMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, controller) === true;
    assert.equal(classLevel, Boolean(entry.reservedClass), `${key}: reservedClass matches the decorator on the controller`);
    const decorated = routes.filter((method) => isReservedRoute(controller, method));
    assert.deepEqual(sorted(entry.reserved), decorated, `${key}: the reserved routes are exactly the decorated ones`);

    const allowed = Object.keys(entry.allowed);
    for (const method of allowed) {
      assert.ok(!entry.reserved.includes(method), `${key}.${method}: both reserved and allowed`);
      assert.ok(entry.allowed[method]?.trim(), `${key}.${method}: an allowed route needs a reason`);
    }
    assert.deepEqual(
      sorted([...entry.reserved, ...allowed]),
      routes,
      `${key}: every route is classified (reserved or allowed with a reason), and only routes are`,
    );
    reservedCount += entry.reserved.length;
    allowedCount += allowed.length;
  }
  console.log(`  ${seen.size} controllers, ${reservedCount} reserved routes, ${allowedCount} allowed with a reason: OK`);

  // 2. Every controller that uses the decorator, and every controller of a listed file, is listed.
  const listedFiles = new Set(DATA_ACCESS_RESERVED_ROUTES.map((entry) => entry.file));
  for (const file of filesUsingTheDecorator()) {
    assert.ok(listedFiles.has(file), `${file} uses @ReservedToUnscopedDataAccess() and is not in data-access-reserved.inventory.ts`);
  }
  for (const [file, controllers] of byFile) {
    for (const name of controllers.keys()) {
      assert.ok(seen.has(`${file}#${name}`), `${file}#${name}: a controller of a listed file is not listed`);
    }
  }
  console.log('  every controller using the decorator is listed: OK');

  // 3. The `reserved` sites of the paths inventory that are routes of these controllers.
  let crossChecked = 0;
  for (const site of DATA_ACCESS_PATHS) {
    if (site.class !== 'reserved') continue;
    const controllers = byFile.get(site.file);
    if (!controllers) continue;
    for (const [name, controller] of controllers) {
      const methods = site.member === name ? (site.routes ?? []) : routeMethods(controller).filter((m) => m === site.member);
      for (const method of methods) {
        assert.ok(isReservedRoute(controller, method), `${site.file}#${name}.${method}: classified reserved in the paths inventory, not decorated`);
        crossChecked += 1;
      }
    }
  }
  console.log(`  ${crossChecked} reserved sites of the paths inventory are reserved routes: OK`);
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
