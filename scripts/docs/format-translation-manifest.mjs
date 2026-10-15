#!/usr/bin/env node
// Writes the docs translation manifest (translation-state/docs-source-hashes.json) in its
// canonical form: keys sorted, one key per line, and an empty line between two keys.
//
//   node scripts/docs/format-translation-manifest.mjs          rewrite the file in place
//   node scripts/docs/format-translation-manifest.mjs --check  exit 1 when it is not canonical
//
// Why the empty lines: most docs pull requests update a few hashes of this one file. Git treats
// changes on two adjacent lines as one conflict, so two pull requests that update neighbouring
// pages conflicted, and the merge queue removed the second one. With an unchanged line between
// two keys, git merges such changes by itself (the merge queue too). JSON allows the blank lines.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), '../../translation-state/docs-source-hashes.json');

const entries = (map, indent) =>
  Object.keys(map)
    .sort()
    .map((key) => `${indent}${JSON.stringify(key)}: ${JSON.stringify(map[key])}`)
    .join(',\n\n');

const block = (map, indent) =>
  Object.keys(map).length === 0 ? '{}' : `{\n${entries(map, indent + '  ')}\n${indent}}`;

export function formatManifest(manifest) {
  const top = Object.keys(manifest)
    .sort()
    .map((key) => {
      const value = manifest[key];
      const text = value && typeof value === 'object' && !Array.isArray(value) ? block(value, '  ') : JSON.stringify(value);
      return `  ${JSON.stringify(key)}: ${text}`;
    })
    .join(',\n\n');
  return `{\n${top}\n}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = MANIFEST;
  const text = readFileSync(file, 'utf8');
  const canonical = formatManifest(JSON.parse(text));
  if (process.argv.includes('--check')) {
    if (text !== canonical) {
      console.error(`${file} is not in its canonical form: run node scripts/docs/format-translation-manifest.mjs`);
      process.exit(1);
    }
    console.log('The docs translation manifest is in its canonical form.');
  } else if (text !== canonical) {
    writeFileSync(file, canonical);
    console.log(`Rewrote ${file} in its canonical form.`);
  }
}
