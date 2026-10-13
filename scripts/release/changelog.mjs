// Pure functions of the release tooling (scripts/release/release.mjs): KANAP version numbers,
// CHANGELOG.md entries and the "Release notes" section of a pull request description.
// No I/O and no dependency.
//
// A version is YY.M.N (26.10.1, then 26.10.2, then 26.11.1; January 2027 is 27.1.1): two-digit
// year, month 1 to 12 and a number from 1, without leading zeros. Its tag is v26.10.1. A
// CHANGELOG.md entry starts with "## <version> (<date>)", followed by " · Action required" when an
// existing installation must do something, and runs to the next "## " heading.

export class InputError extends Error {}

const VERSION = /^(\d{2})\.([1-9]|1[0-2])\.([1-9]\d*)$/;
const ACTION_REQUIRED = /·\s*Action required\s*$/i;
export const SUMMARY_PLACEHOLDER = 'One or two lines on what this version brings.';

export function parseVersion(text) {
  const match = VERSION.exec(String(text ?? '').trim());
  if (!match) {
    throw new InputError(`invalid version "${text}": expected YY.M.N, for example 26.10.1 (no leading zero, N from 1)`);
  }
  return { year: Number(match[1]), month: Number(match[2]), n: Number(match[3]) };
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return x.year - y.year || x.month - y.month || x.n - y.n;
}

export function tagOf(version) {
  parseVersion(version);
  return `v${version}`;
}

// The version of a tag, or null for any other tag.
export function versionOfTag(tag) {
  const match = /^v(.+)$/.exec(String(tag ?? ''));
  if (!match) return null;
  try {
    parseVersion(match[1]);
    return match[1];
  } catch {
    return null;
  }
}

// The highest version among tags (other tags ignored), or null.
export function latestVersion(tags) {
  let latest = null;
  for (const tag of tags) {
    const version = versionOfTag(tag);
    if (version && (latest === null || compareVersions(version, latest) > 0)) latest = version;
  }
  return latest;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The entry of a version: { heading, title, body, actionRequired }, or null.
export function extractEntry(changelogText, version) {
  parseVersion(version);
  const lines = String(changelogText ?? '').split('\n');
  const headingPattern = new RegExp(`^## ${escapeRegExp(version)}(\\s|$)`);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  const heading = lines[start].trimEnd();
  const actionRequired = ACTION_REQUIRED.test(heading);
  return {
    heading,
    title: `KANAP ${version}${actionRequired ? ' · Action required' : ''}`,
    body: lines.slice(start + 1, end).join('\n').trim(),
    actionRequired,
  };
}

// Inserts an entry before the first entry, or after the header when there is none.
export function insertEntry(changelogText, entryText) {
  const text = String(changelogText ?? '');
  const entry = entryText.trim();
  const match = /^## /m.exec(text);
  if (!match) return text.trim() ? `${text.trimEnd()}\n\n${entry}\n` : `${entry}\n`;
  const header = text.slice(0, match.index).trimEnd();
  const rest = text.slice(match.index).trimEnd();
  return `${header ? `${header}\n\n` : ''}${entry}\n\n${rest}\n`;
}

// The "## Release notes" section of a pull request description, trimmed and without HTML
// comments, or null when it is absent or says nothing: empty, "None", "None (internal)" (any
// words in the parentheses), or only the subsection headings of the template. The section ends
// at the next "## " heading or at the agent attribution line that closes many descriptions.
export function extractReleaseNotes(prBody) {
  const lines = String(prBody ?? '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^##\s+release notes\s*$/i.test(line.trim()));
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && (/^##\s/.test(line) || /^\W*Generated with \[/.test(line.trim())));
  if (end < 0) end = lines.length;
  const notes = lines.slice(start + 1, end).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
  const meaningful = notes.split('\n').filter((line) => {
    const text = line.trim();
    if (/^#{3,}\s/.test(text)) return false;
    return !/^([-*]\s*)?(none(\s*\([^)]*\))?\.?)?$/i.test(text);
  });
  return meaningful.length ? notes : null;
}

// The pull request numbers of squash-merge subjects ("Title (#123)"), in order, unique.
export function prNumbersOf(subjects) {
  const numbers = [];
  for (const subject of subjects) {
    const match = /\(#(\d+)\)\s*$/.exec(subject);
    if (match && !numbers.includes(Number(match[1]))) numbers.push(Number(match[1]));
  }
  return numbers;
}

// The entry an agent fills in: summary placeholder, empty Changes and Fixes, On-premise block.
export function entrySkeleton({ version, date, migrations = [] }) {
  parseVersion(version);
  const migrationLine = migrations.length
    ? `Migrations: run automatically at start (${migrations.join(', ')}).`
    : 'Migrations: none';
  return [
    `## ${version} (${date})`,
    '',
    SUMMARY_PLACEHOLDER,
    '',
    '### Changes',
    '',
    '### Fixes',
    '',
    '### On-premise',
    '- Action required: none',
    `- ${migrationLine}`,
    '- Recommended: none',
    '',
  ].join('\n');
}

function listItems(entryBody, section) {
  const lines = entryBody.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `### ${section}`);
  if (start < 0) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s/.test(line)) break;
    if (/^\s*[-*]\s+\S/.test(line)) items.push(line.trim());
  }
  return items;
}

// True while an entry is still the skeleton: no Changes or Fixes item and the summary
// placeholder unchanged.
export function isUnchangedSkeleton(entryBody) {
  return listItems(entryBody, 'changes').length === 0
    && listItems(entryBody, 'fixes').length === 0
    && entryBody.split('\n').some((line) => line.trim() === SUMMARY_PLACEHOLDER);
}

// The pull request numbers an entry does not cite as #NNN.
export function missingPrNumbers(entryBody, prNumbers) {
  const cited = new Set([...String(entryBody ?? '').matchAll(/#(\d+)\b/g)].map((match) => Number(match[1])));
  return prNumbers.filter((number) => !cited.has(Number(number)));
}
