// node --test scripts/release/__tests__/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  InputError, compareVersions, entrySkeleton, extractEntry, extractReleaseNotes, insertEntry,
  isUnchangedSkeleton, latestVersion, missingPrNumbers, parseVersion, prNumbersOf, tagOf, versionOfTag,
} from '../changelog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HEADER = '# Changelog\n\nEvery published version of KANAP, newest first.\n';
const CHANGELOG = `${HEADER}
## 26.11.1 (2026-11-03) · Action required

Settings page for the application address.

### Changes
- The address is set in Administration (#501)

### On-premise
- Action required: set \`APP_BASE_URL\`.

## 26.10.2 (2026-10-20)

A fix.

### Fixes
- Exports keep their dates (#490)

## 26.10.1 (2026-10-11)

First version.
`;

describe('versions', () => {
  it('parses YY.M.N', () => {
    assert.deepEqual(parseVersion('26.10.1'), { year: 26, month: 10, n: 1 });
    assert.deepEqual(parseVersion('27.1.1'), { year: 27, month: 1, n: 1 });
    assert.deepEqual(parseVersion('26.12.14'), { year: 26, month: 12, n: 14 });
  });

  it('refuses leading zeros, four-digit years, month 13, N = 0 and other shapes', () => {
    for (const value of ['26.03.1', '2026.10.1', '26.10.0', '26.13.1', '26.0.1', '26.10.01', 'v26.10.1', '26.10', '26.10.1-rc1', '', undefined]) {
      assert.throws(() => parseVersion(value), InputError, String(value));
    }
  });

  it('compares as integer tuples, across months and years', () => {
    assert.ok(compareVersions('26.10.2', '26.10.1') > 0);
    assert.ok(compareVersions('26.10.10', '26.10.9') > 0);
    assert.ok(compareVersions('26.11.1', '26.10.9') > 0);
    assert.ok(compareVersions('27.1.1', '26.12.5') > 0);
    assert.ok(compareVersions('26.9.3', '26.10.1') < 0);
    assert.equal(compareVersions('26.10.1', '26.10.1'), 0);
  });

  it('maps versions and tags', () => {
    assert.equal(tagOf('26.10.1'), 'v26.10.1');
    assert.throws(() => tagOf('26.10'), InputError);
    assert.equal(versionOfTag('v26.10.1'), '26.10.1');
    assert.equal(versionOfTag('26.10.1'), null);
    assert.equal(versionOfTag('v1.2.3-beta'), null);
    assert.equal(versionOfTag('release-1'), null);
  });

  it('finds the latest version tag and ignores other tags', () => {
    assert.equal(latestVersion(['v26.10.1', 'v26.10.10', 'v26.10.9', 'old', 'v0.1.0']), '26.10.10');
    assert.equal(latestVersion(['v26.12.3', 'v27.1.1', 'v26.11.8']), '27.1.1');
    assert.equal(latestVersion(['old', 'v1.0']), null);
    assert.equal(latestVersion([]), null);
  });
});

describe('CHANGELOG.md entries', () => {
  it('extracts an entry marked Action required', () => {
    const entry = extractEntry(CHANGELOG, '26.11.1');
    assert.equal(entry.heading, '## 26.11.1 (2026-11-03) · Action required');
    assert.equal(entry.title, 'KANAP 26.11.1 · Action required');
    assert.equal(entry.actionRequired, true);
    assert.match(entry.body, /^Settings page for the application address\.\n/);
    assert.match(entry.body, /- Action required: set `APP_BASE_URL`\.$/);
    assert.doesNotMatch(entry.body, /26\.10\.2/);
  });

  it('extracts an entry without Action required, and the last entry of the file', () => {
    const entry = extractEntry(CHANGELOG, '26.10.2');
    assert.equal(entry.title, 'KANAP 26.10.2');
    assert.equal(entry.actionRequired, false);
    assert.equal(entry.body, 'A fix.\n\n### Fixes\n- Exports keep their dates (#490)');
    assert.equal(extractEntry(CHANGELOG, '26.10.1').body, 'First version.');
  });

  it('returns null for a missing version and does not match a longer one', () => {
    assert.equal(extractEntry(CHANGELOG, '26.10.3'), null);
    assert.equal(extractEntry('## 26.10.10 (2026-10-30)\n\nText.\n', '26.10.1'), null);
    assert.equal(extractEntry('', '26.10.1'), null);
  });

  it('inserts an entry after the header of a file with no entry', () => {
    const text = insertEntry(HEADER, '## 26.10.1 (2026-10-11)\n\nFirst version.\n');
    assert.equal(text, `${HEADER}\n## 26.10.1 (2026-10-11)\n\nFirst version.\n`);
    assert.equal(insertEntry('', '## 26.10.1 (2026-10-11)\n'), '## 26.10.1 (2026-10-11)\n');
  });

  it('inserts an entry before the first entry, one blank line around', () => {
    const text = insertEntry(CHANGELOG, '## 26.11.2 (2026-11-10)\n\nNext.\n\n');
    assert.ok(text.startsWith(`${HEADER}\n## 26.11.2 (2026-11-10)\n\nNext.\n\n## 26.11.1 (2026-11-03)`));
    assert.ok(text.endsWith('First version.\n'));
    assert.equal(extractEntry(text, '26.11.1').body, extractEntry(CHANGELOG, '26.11.1').body);
  });

  it('builds the skeleton, with or without migrations, and sees it as unchanged', () => {
    const skeleton = entrySkeleton({ version: '26.10.1', date: '2026-10-11', migrations: ['1853880000000-a', '1853890000000-b'] });
    assert.match(skeleton, /^## 26\.10\.1 \(2026-10-11\)\n/);
    assert.match(skeleton, /\n### Changes\n\n### Fixes\n\n### On-premise\n- Action required: none\n/);
    assert.match(skeleton, /- Migrations: run automatically at start \(1853880000000-a, 1853890000000-b\)\.\n- Recommended: none\n$/);
    assert.match(entrySkeleton({ version: '26.10.1', date: '2026-10-11' }), /- Migrations: none\n/);
    const entry = extractEntry(insertEntry(HEADER, skeleton), '26.10.1');
    assert.equal(entry.actionRequired, false);
    assert.equal(isUnchangedSkeleton(entry.body), true);
    assert.equal(isUnchangedSkeleton(entry.body.replace('### Fixes\n', '### Fixes\n- Exports keep their dates (#490)\n')), false);
    assert.equal(isUnchangedSkeleton(entry.body.replace(/^One or two lines.*$/m, 'Dependency updates.')), false);
  });

  it('has a CHANGELOG.md whose header holds no entry heading', () => {
    const text = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    assert.doesNotMatch(text, /^## /m);
    assert.match(insertEntry(text, '## 26.10.1 (2026-10-11)\n\nFirst.\n'), /\n\n## 26\.10\.1 \(2026-10-11\)\n\nFirst\.\n$/);
  });
});

describe('pull request notes', () => {
  const body = (notes) => `## Problem\n\nSomething.\n\n## Release notes\n\n${notes}\n\n## Verification\n\n- [x] tests\n`;

  it('extracts the section up to the next heading', () => {
    assert.equal(extractReleaseNotes(body('- Exports keep their dates.\n- Faster lists.')), '- Exports keep their dates.\n- Faster lists.');
    assert.equal(extractReleaseNotes('## RELEASE NOTES\nOn-premise: set `APP_BASE_URL`.'), 'On-premise: set `APP_BASE_URL`.');
  });

  it('stops at the attribution line that closes a description', () => {
    assert.equal(extractReleaseNotes('## Release notes\n\n- A fix.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n'), '- A fix.');
  });

  it('returns null when the section says nothing', () => {
    for (const notes of ['None', 'None.', 'None (internal)', 'none (documentation and website).', '', '- None']) {
      assert.equal(extractReleaseNotes(body(notes)), null, JSON.stringify(notes));
    }
    assert.equal(extractReleaseNotes('## Release notes\n\nNone.\n\n🤖 Generated with [Claude Code](x)\n'), null);
  });

  it('returns null when the section is absent', () => {
    assert.equal(extractReleaseNotes('## Problem\n\nx\n\n## Changes\n\ny\n'), null);
    assert.equal(extractReleaseNotes(null), null);
  });

  it('ignores the comment and the empty subsections of the template', () => {
    const template = readFileSync(path.join(ROOT, '.github', 'pull_request_template.md'), 'utf8');
    assert.equal(extractReleaseNotes(template), null);
    const filled = template.replace('### Visible changes\n', '### Visible changes\n\n- Budget lists open faster.\n');
    assert.equal(extractReleaseNotes(filled), '### Visible changes\n\n- Budget lists open faster.\n\n### On-premise');
    assert.equal(extractReleaseNotes(body('<!-- What users see. -->\nNone')), null);
  });

  it('reads pull request numbers from squash subjects, in order, once', () => {
    assert.deepEqual(prNumbersOf([
      'Release 26.10.1 (#480)',
      'ai: Plaid writes any dimension (#476)',
      'Revert "Faster lists (#470)" (#471)',
      'Merge branch main',
      'ai: Plaid writes any dimension (#476)',
      'deps: bump x from 1.0 to 1.1 (#460) ',
    ]), [480, 476, 471, 460]);
  });

  it('lists the pull requests an entry does not cite', () => {
    const entry = '### Changes\n- Lists (#476)\n- Pickers (#474, #4730)\n';
    assert.deepEqual(missingPrNumbers(entry, [476, 474, 473, 4730]), [473]);
    assert.deepEqual(missingPrNumbers(entry, []), []);
  });
});
