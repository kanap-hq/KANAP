/**
 * The application version: the `version` field of backend/package.json, read once.
 * The relative path resolves to backend/package.json from `src/config/` (ts-node) and from
 * `dist/config/` (compiled), since both sit next to that file.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg: { version?: unknown } = require('../../package.json');

export const APP_VERSION: string =
  typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : 'unknown';
