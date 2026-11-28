/**
 * Writes the files the variable registry produces (backend/src/config/env-registry.ts):
 * infra/.env.onprem.example and the generated block of doc/help/docs/<language>/on-premise/configuration.md.
 *
 *   npm run env:generate               writes the files that differ
 *   npm run env:generate -- --check    writes nothing, names the files that differ, exits 1 if any
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderEnvReferenceFiles } from '../src/config/env-registry-render';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const check = process.argv.slice(2).includes('--check');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

const differing = renderEnvReferenceFiles(read).filter(({ file, content }) => read(file) !== content);

if (check) {
  for (const { file } of differing) console.error(`${file} differs from the registry: run "npm run env:generate" in backend/.`);
  if (differing.length === 0) console.log('The example .env and the manual blocks match the registry.');
  process.exitCode = differing.length === 0 ? 0 : 1;
} else {
  for (const { file, content } of differing) {
    fs.writeFileSync(path.join(REPO_ROOT, file), content);
    console.log(`Wrote ${file}`);
  }
  if (differing.length === 0) console.log('Nothing to write: the files match the registry.');
}
