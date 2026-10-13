import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { APP_VERSION } from '../version';

// The version shown by the application (start-up log, public config) is the one of backend/package.json.

const pkg = JSON.parse(fs.readFileSync(backendPath('package.json'), 'utf8')) as { version: string };

assert.equal(typeof APP_VERSION, 'string');
assert.ok(APP_VERSION.length > 0, 'APP_VERSION is empty');
assert.equal(APP_VERSION, pkg.version);

console.log('version.spec: ok');
