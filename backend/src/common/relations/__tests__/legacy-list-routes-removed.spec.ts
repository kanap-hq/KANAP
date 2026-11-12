import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { LocationsController } from '../../../locations/locations.controller';
import { IncidentsController } from '../../../incidents/incidents.controller';

// A location's linked records and an incident's linked assets and applications are read through
// their Relations tab (`GET /locations/:id/relations`, `GET /incidents/:id/relations`), which
// applies the reads of each module and the applications a Business Contributor may see. The
// separate list routes `GET /locations/:id/servers|applications` and `GET
// /incidents/:id/assets|applications` are not served; the Relations routes and the incident link
// writes stay.

type Route = { method: string; path: string };

function routesOf(Controller: any): Route[] {
  const proto = Controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .map((name) => proto[name])
    .filter((handler) => typeof handler === 'function' && Reflect.hasMetadata(PATH_METADATA, handler))
    .map((handler) => ({
      method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)],
      path: Reflect.getMetadata(PATH_METADATA, handler),
    }));
}

function has(routes: Route[], method: string, path: string): boolean {
  return routes.some((route) => route.method === method && route.path === path);
}

function run() {
  const locations = routesOf(LocationsController);
  for (const path of [':id/servers', ':id/applications']) {
    assert.ok(!has(locations, 'GET', path), `GET /locations/${path} is not served`);
  }
  assert.ok(has(locations, 'GET', ':id/relations'), 'GET /locations/:id/relations stays');

  const incidents = routesOf(IncidentsController);
  for (const path of [':id/assets', ':id/applications']) {
    assert.ok(!has(incidents, 'GET', path), `GET /incidents/${path} is not served`);
  }
  for (const path of [':id/assets/bulk-replace', ':id/applications/bulk-replace', ':id/relations/:kind']) {
    assert.ok(has(incidents, 'POST', path), `POST /incidents/${path} stays`);
  }
  assert.ok(has(incidents, 'GET', ':id/relations'), 'GET /incidents/:id/relations stays');
  console.log('legacy-list-routes-removed.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
