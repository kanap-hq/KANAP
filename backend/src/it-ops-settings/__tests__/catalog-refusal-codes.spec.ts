import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';

// Rule P7 (lot K2c of 26.12.1): every refusal of a catalog value is coded, so that the screens say
// it in the person's language (`catalog_value_retired`, with the value and the values allowed in
// its params) instead of showing the server's English sentence. The shared refusal
// (`catalogValueRefusal`, `resolveOfferedCatalogCode`) is coded by construction; this spec holds the
// places that word a retired value themselves: each English sentence that refuses a retired value
// sits in a coded refusal.

const RETIRED_SENTENCE = /is retired: only|is no longer offered/;
const CODED = /catalog_value_retired|catalogValueRefusal\(/;
const WINDOW = 8;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'migrations' ? [] : sources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

const root = backendPath('src');
const uncoded: string[] = [];
let sentences = 0;
for (const file of sources(root)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (!RETIRED_SENTENCE.test(line)) return;
    sentences += 1;
    const around = lines.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).join('\n');
    if (!CODED.test(around)) uncoded.push(`${path.relative(root, file)}:${index + 1}`);
  });
}

assert.ok(sentences >= 5, `the scan finds the refusals of retired values (found ${sentences})`);
assert.deepEqual(uncoded, [], `a refusal of a retired catalog value without the code catalog_value_retired: ${uncoded.join(', ')}`);

console.log('catalog-refusal-codes.spec.ts passed');
