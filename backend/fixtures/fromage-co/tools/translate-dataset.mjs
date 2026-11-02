#!/usr/bin/env node
// Builds the French, German and Spanish sets of the Fromage & Co data set from the English files
// and the translation memories (translations/translate.mjs), into fr/, de/ and es/.
//
//   node backend/fixtures/fromage-co/tools/translate-dataset.mjs
//       writes each language's set and rewrites its memory sorted, without the entries no file
//       uses any more. When a memory lacks texts, nothing is written for that language and the
//       command fails; with --missing <dir>, the lacking texts go to <dir>/<language>.json
//       (English text -> ""), to translate and add to the memory.
//   node backend/fixtures/fromage-co/tools/translate-dataset.mjs --check
//       writes nothing and fails when a set or a memory is not what the command above would
//       write: an English file changed without regeneration, or a text without translation.
//
// After a change to an English file, the runner's `t('…')` texts or fields.mjs: run the first
// command, translate what it lists (glossary: frontend/src/locales/glossary.json), run it again.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TRANSLATED_LANGUAGES } from '../translations/fields.mjs';
import { DATASET_DIR, buildLanguageSet, listFiles, loadMemory, memoryPath, memoryText } from '../translations/translate.mjs';

function parseArgs(argv) {
  const options = { check: false, missingDir: null, root: DATASET_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--missing') options.missingDir = argv[++i];
    else if (arg === '--root') options.root = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

/** What a language's run finds: the files to write or remove, and the memory to write. */
export function planLanguage(language, root = DATASET_DIR) {
  const memory = loadMemory(language, root);
  const { files, used, missing } = buildLanguageSet(language, { root, memory });
  const dir = path.join(root, language);
  const stale = listFiles(dir).filter((name) => !files.has(name));
  const changed = [...files].filter(([name, content]) => {
    const target = path.join(dir, name);
    return !existsSync(target) || readFileSync(target, 'utf8') !== content;
  }).map(([name]) => name);
  const kept = Object.fromEntries(Object.entries(memory).filter(([key]) => used.has(key)));
  const nextMemory = memoryText(kept);
  const memoryChanged = readFileSync(memoryPath(language, root), 'utf8') !== nextMemory;
  return { dir, files, stale, changed, missing: [...missing].sort(), nextMemory, memoryChanged, unused: Object.keys(memory).length - Object.keys(kept).length };
}

export function run(argv) {
  const options = parseArgs(argv);
  let failed = false;
  for (const language of TRANSLATED_LANGUAGES) {
    const plan = planLanguage(language, options.root);
    if (plan.missing.length) {
      failed = true;
      console.error(`${language}: ${plan.missing.length} text(s) without translation in translations/${language}.json`);
      for (const text of plan.missing.slice(0, 20)) console.error(`  ${JSON.stringify(text).slice(0, 160)}`);
      if (options.missingDir) {
        mkdirSync(options.missingDir, { recursive: true });
        const target = path.join(options.missingDir, `${language}.json`);
        writeFileSync(target, memoryText(Object.fromEntries(plan.missing.map((text) => [text, '']))));
        console.error(`  the full list is in ${target}`);
      }
      continue;
    }
    if (options.check) {
      for (const name of plan.changed) console.error(`${language}/${name} is not up to date`);
      for (const name of plan.stale) console.error(`${language}/${name} is no longer generated`);
      if (plan.memoryChanged) console.error(`translations/${language}.json is not sorted or holds ${plan.unused} unused entr${plan.unused === 1 ? 'y' : 'ies'}`);
      if (plan.changed.length || plan.stale.length || plan.memoryChanged) failed = true;
      continue;
    }
    for (const name of plan.changed) {
      const target = path.join(plan.dir, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, plan.files.get(name));
    }
    for (const name of plan.stale) rmSync(path.join(plan.dir, name));
    if (plan.memoryChanged) writeFileSync(memoryPath(language, options.root), plan.nextMemory);
    console.log(`${language}: ${plan.changed.length} file(s) written, ${plan.stale.length} removed, ${plan.unused} unused entr${plan.unused === 1 ? 'y' : 'ies'} dropped`);
  }
  if (failed && options.check) {
    console.error('Run node backend/fixtures/fromage-co/tools/translate-dataset.mjs and commit its output.');
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2));
}
