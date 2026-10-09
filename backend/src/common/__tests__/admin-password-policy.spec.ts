import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BOOTSTRAP_PASSWORD_MIN_LENGTH,
  BOOTSTRAP_PASSWORD_WARNING,
  PUBLISHED_EXAMPLE_PASSWORDS,
  isWeakBootstrapPassword,
} from '../startup-secrets';
import { backendPath } from './backend-root';

// The start-up administrator password (ADMIN_PASSWORD): a value printed in the example .env or in
// the on-premise guides, or shorter than 12 characters, is reported. The list of printed values is
// one constant, kept in line with those files: a value added to them later must be added to it.

const REPO_ROOT = path.dirname(backendPath());
const GUIDE_LANGUAGES = ['en', 'fr', 'de', 'es'];

const ENV_LINE = /^\s*#?\s*ADMIN_PASSWORD\s*=\s*(.*?)\s*$/;
// Configuration tables: | `ADMIN_PASSWORD` | description | `value` |
const TABLE_ROW = /^\|\s*`ADMIN_PASSWORD`\s*\|.*\|\s*`([^`]+)`\s*\|\s*$/;

type Found = { file: string; value: string };

function valuesIn(file: string): Found[] {
  const found: Found[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const value = (ENV_LINE.exec(line)?.[1] ?? TABLE_ROW.exec(line)?.[1] ?? '').trim();
    // Empty values and placeholders such as <output of ...> are not passwords.
    if (value && !value.startsWith('<')) found.push({ file: path.relative(REPO_ROOT, file), value });
  }
  return found;
}

function exampleFiles(): string[] {
  const files = [path.join(REPO_ROOT, 'infra', '.env.onprem.example')];
  for (const language of GUIDE_LANGUAGES) {
    const dir = path.join(REPO_ROOT, 'doc', 'help', 'docs', language, 'on-premise');
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.md')).sort()) {
      files.push(path.join(dir, name));
    }
  }
  return files;
}

function testEveryPrintedValueIsListed() {
  const files = exampleFiles();
  for (const file of files) assert.ok(fs.existsSync(file), `${file} exists`);
  const found = files.flatMap(valuesIn);

  // The files are read: the example .env and every guide language give at least one value.
  assert.ok(found.some((entry) => entry.file === path.join('infra', '.env.onprem.example')), 'the example .env has a value');
  for (const language of GUIDE_LANGUAGES) {
    const prefix = path.join('doc', 'help', 'docs', language, 'on-premise') + path.sep;
    assert.ok(found.some((entry) => entry.file.startsWith(prefix)), `the ${language} guide has a value`);
  }
  assert.ok(found.some((entry) => entry.file.endsWith('installation-example.md')), 'the installation example is read');

  const listed = new Set(PUBLISHED_EXAMPLE_PASSWORDS);
  const missing = found.filter((entry) => !listed.has(entry.value));
  assert.deepEqual(missing, [], 'every ADMIN_PASSWORD value printed in the examples and guides is in PUBLISHED_EXAMPLE_PASSWORDS');
  for (const entry of found) assert.equal(isWeakBootstrapPassword(entry.value), true, `${entry.value} (${entry.file}) is reported`);
}

function testPolicy() {
  for (const value of PUBLISHED_EXAMPLE_PASSWORDS) {
    assert.equal(isWeakBootstrapPassword(value), true, value);
    assert.equal(isWeakBootstrapPassword(value.toUpperCase()), true, `${value} in capitals`);
    assert.equal(isWeakBootstrapPassword(`  ${value} `), true, `${value} inside spaces`);
  }
  assert.equal(BOOTSTRAP_PASSWORD_MIN_LENGTH, 12);
  assert.equal(isWeakBootstrapPassword('Qz7#mWp2vLx'), true, '11 characters');
  assert.equal(isWeakBootstrapPassword('Qz7#mWp2vLxR'), false, '12 characters');
  assert.equal(isWeakBootstrapPassword('  Qz7#mWp2vLx  '), true, '11 characters inside spaces');
  assert.equal(isWeakBootstrapPassword('vT9!rK2#pQ8$wL5^zN3&'), false, 'a long value of its own');
  assert.equal(isWeakBootstrapPassword(''), false, 'no value: nothing to report');
  assert.equal(isWeakBootstrapPassword('   '), false, 'spaces only: nothing to report');
}

function testWarningLine() {
  assert.ok(BOOTSTRAP_PASSWORD_WARNING.startsWith('[SECURITY] '));
  assert.ok(BOOTSTRAP_PASSWORD_WARNING.includes('ADMIN_EMAIL'));
  for (const value of PUBLISHED_EXAMPLE_PASSWORDS) {
    assert.ok(!BOOTSTRAP_PASSWORD_WARNING.includes(value), 'the line names no password');
  }
}

function run() {
  testEveryPrintedValueIsListed();
  testPolicy();
  testWarningLine();
  console.log('admin-password-policy.spec: ok');
}

run();
