/**
 * Writes the files the variable registry produces (backend/src/config/env-registry.ts):
 * infra/.env.onprem.example and the generated block of doc/help/docs/<language>/on-premise/configuration.md.
 *
 *   npm run env:generate               writes the files that differ
 *   npm run env:generate -- --check    writes nothing, names the files that differ, exits 1 if any
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runEnvReferenceCommand } from '../src/config/env-registry-render';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

process.exitCode = runEnvReferenceCommand(process.argv.slice(2).includes('--check'), {
  read: (file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'),
  write: (file, content) => fs.writeFileSync(path.join(REPO_ROOT, file), content),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
