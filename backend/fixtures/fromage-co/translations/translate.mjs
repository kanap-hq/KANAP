// The translation of the Fromage & Co data set (fields.mjs says what is translated).
//
// Each language has a translation memory, translations/<language>.json: one entry per English
// text (a cell, a Markdown block, a runner text) and its translation, sorted by English text.
// The generator (tools/translate-dataset.mjs) builds the language's set from the English files
// with it, into <language>/; the runner (setup-tenant.mjs) reads that set, and looks its own
// texts up in the same memory with `t('…')`, so a name it looks up is the name the set holds.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldSpans, unquote } from '../../../scripts/lib/fixture-csv.mjs';
import { RUNNER_FILES, TRANSLATED_COLUMNS, TRANSLATED_DOCS, TRANSLATED_LANGUAGES } from './fields.mjs';

/** The data set's directory (backend/fixtures/fromage-co). */
export const DATASET_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The languages the data set loads in. Any other language loads English. */
export const DATASET_LANGUAGES = ['en', ...TRANSLATED_LANGUAGES];

/** The data set language for a requested one (`fr-FR` gives `fr`); English for anything else. */
export function resolveDatasetLanguage(raw) {
  const base = String(raw ?? '').trim().toLowerCase().split(/[-_]/, 1)[0];
  return DATASET_LANGUAGES.includes(base) ? base : 'en';
}

/** The path of a language's translation memory. */
export function memoryPath(language, root = DATASET_DIR) {
  return path.join(root, 'translations', `${language}.json`);
}

/** A language's translation memory (English text -> translation); empty for English. */
export function loadMemory(language, root = DATASET_DIR) {
  if (language === 'en') return {};
  return JSON.parse(readFileSync(memoryPath(language, root), 'utf8'));
}

/** A memory as written on disk: sorted by English text, two-space JSON, final newline. */
export function memoryText(memory) {
  const sorted = Object.fromEntries(Object.keys(memory).sort().map((key) => [key, memory[key]]));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

const HAS_LETTER = /\p{L}/u;

/**
 * The translation function of a memory: `t(text)` is the text's translation, or the text itself
 * when it has no letter or the memory has no entry. `used` and `missing` collect the texts asked.
 */
export function createTranslator(memory) {
  const used = new Set();
  const missing = new Set();
  const t = (text) => {
    const value = String(text ?? '');
    if (!HAS_LETTER.test(value)) return value;
    if (Object.hasOwn(memory, value)) {
      used.add(value);
      return memory[value];
    }
    missing.add(value);
    return value;
  };
  return { t, used, missing };
}

/** The runner's `t` for a language: the language's memory, English text when it has none. */
export function datasetTranslator(language, root = DATASET_DIR) {
  return createTranslator(loadMemory(resolveDatasetLanguage(language), root)).t;
}

/** Whether a data set file has a translated version (`<language>/<name>`). */
export function isTranslatedFile(name) {
  return Object.hasOwn(TRANSLATED_COLUMNS, name) || TRANSLATED_DOCS.includes(name);
}

/**
 * A Markdown text with each block (lines between blank lines) translated whole. A fenced code
 * block stays as it is, and so do the blank lines between blocks.
 */
export function translateMarkdown(text, t) {
  const lineBreak = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(lineBreak);
  const out = [];
  let block = [];
  let inFence = false;
  const flush = () => {
    if (!block.length) return;
    const joined = block.join(lineBreak);
    out.push(/^\s*(```|~~~)/.test(block[0]) ? joined : t(joined));
    block = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) flush();
      block.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }
    if (!inFence && line.trim() === '') {
      flush();
      out.push(line);
      continue;
    }
    block.push(line);
  }
  flush();
  return out.join(lineBreak);
}

function csvCell(value, wasQuoted) {
  return wasQuoted || /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A `;` CSV text with the listed columns translated (`columns` as in TRANSLATED_COLUMNS). Every
 * other byte stays as it is. An empty cell stays empty.
 */
export function translateCsv(content, columns, t) {
  const plain = new Set(columns.filter((entry) => typeof entry === 'string'));
  const markdown = new Set(columns.filter((entry) => typeof entry === 'object').map((entry) => entry.column));
  const fields = fieldSpans(content, ';');
  const headerRow = fields[0]?.row ?? 0;
  const headers = fields.filter((field) => field.row === headerRow).map((field) => unquote(content.slice(field.start, field.end)).trim());
  for (const column of [...plain, ...markdown]) {
    if (!headers.includes(column)) throw new Error(`Column '${column}' is not in the file`);
  }
  let out = '';
  let cursor = 0;
  for (const field of fields) {
    if (field.row === headerRow) continue;
    const header = headers[field.col];
    if (!plain.has(header) && !markdown.has(header)) continue;
    const raw = content.slice(field.start, field.end);
    const value = unquote(raw);
    if (value.trim() === '') continue;
    const translated = markdown.has(header) ? translateMarkdown(value, t) : t(value.trim());
    out += content.slice(cursor, field.start) + csvCell(translated, raw.trimStart().startsWith('"'));
    cursor = field.end;
  }
  return out + content.slice(cursor);
}

/** The JavaScript string literal's value (single or double quotes, simple escapes). */
function literalValue(literal) {
  const escapes = { n: '\n', r: '\r', t: '\t' };
  return literal.slice(1, -1).replace(/\\(.)/g, (_, ch) => escapes[ch] ?? ch);
}

const T_CALL = /(?<![\w$.])t\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")\s*\)/g;

/** The texts a runner source translates: the literal argument of each `t('…')` call. */
export function runnerTexts(source) {
  return [...source.matchAll(T_CALL)].map((match) => literalValue(match[1]));
}

/**
 * A language's set built from the English files: `files` maps each translated file's path in
 * `<language>/` to its content; `used` and `missing` are the memory entries read and the texts
 * the memory lacks (the runner's texts included).
 */
export function buildLanguageSet(language, { root = DATASET_DIR, memory = loadMemory(language, root) } = {}) {
  const { t, used, missing } = createTranslator(memory);
  const files = new Map();
  for (const [name, columns] of Object.entries(TRANSLATED_COLUMNS)) {
    files.set(name, translateCsv(readFileSync(path.join(root, name), 'utf8'), columns, t));
  }
  for (const name of TRANSLATED_DOCS) {
    files.set(name, translateMarkdown(readFileSync(path.join(root, name), 'utf8'), t));
  }
  for (const name of RUNNER_FILES) {
    for (const text of runnerTexts(readFileSync(path.join(root, name), 'utf8'))) t(text);
  }
  return { files, used, missing };
}

/** Every file below a directory, as paths relative to it ('/' separators). */
export function listFiles(dir) {
  const out = [];
  const walk = (current, prefix) => {
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else out.push(relative);
    }
  };
  walk(dir, '');
  return out.sort();
}
