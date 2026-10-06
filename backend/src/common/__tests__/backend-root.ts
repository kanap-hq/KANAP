import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The backend directory (the one holding package.json and tsconfig.json),
 * found by walking up from this file. Specs that read source files, fixtures
 * or scripts resolve them from here, so they work both under ts-node (this
 * file in `src/`) and from the compiled output of `npm run test:ci` (this
 * file in `ci-dist/backend/src/`, where no `.ts` file or fixture is copied).
 */
function findBackendRoot(): string {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'tsconfig.json'))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`backend root not found above ${__dirname}`);
  }
}

export const BACKEND_ROOT = findBackendRoot();

/** A path inside the backend directory, e.g. `backendPath('src', 'migrations')`. */
export function backendPath(...parts: string[]): string {
  return path.join(BACKEND_ROOT, ...parts);
}
