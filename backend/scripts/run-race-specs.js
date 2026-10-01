#!/usr/bin/env node
/*
 * Runs the race specs (`src/** /__tests__/*-race.integration.spec.ts`) one
 * after the other and prints a summary. They reproduce the concurrent-write
 * races of planning/perf-scale (step 0.3): each fails until the lot named in
 * its header lands, so this runner reports every spec instead of stopping at
 * the first failure.
 *
 * The specs refuse `appdb`: point DATABASE_URL at a dedicated database, e.g.
 *   DATABASE_URL=postgres://app:app@localhost:5432/appdb_perf npm run test:races
 * Set RACE_TRACE=1 to print each race's choreography.
 *
 * Usage: node scripts/run-race-specs.js [path filter]
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const filter = process.argv[2] || '';

const specs = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('-race.integration.spec.ts') && path.basename(dir) === '__tests__') specs.push(path.relative(root, full));
  }
})(path.join(root, 'src'));
const selected = specs.sort().filter((file) => file.includes(filter));

const results = [];
for (const file of selected) {
  console.log(`\n── ${file}`);
  const started = Date.now();
  const run = spawnSync(path.join(root, 'node_modules', '.bin', 'ts-node'), [file], { cwd: root, stdio: 'inherit', env: process.env });
  results.push({ file, code: run.status, seconds: ((Date.now() - started) / 1000).toFixed(1) });
}

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} race specs pass`);
for (const r of results) console.log(`  ${r.code === 0 ? 'pass' : 'FAIL'}  ${r.file} (${r.seconds}s)`);
process.exit(failed.length ? 1 : 0);
