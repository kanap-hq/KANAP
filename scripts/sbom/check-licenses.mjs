// Fails when a production dependency of backend, frontend or marketing/web has a refused license
// (GPL, AGPL or SSPL family, UNLICENSED, a custom reference) or no readable license, unless
// scripts/sbom/license-exceptions.json lists that exact name and version with a reason. LGPL and MPL
// (copyleft limited to the library or the file) are accepted. Reads the
// package-lock.json files only: no installed packages, no network. Run by the `build (onprem)`
// job of the merge queue.
//
//   node scripts/sbom/check-licenses.mjs [--exceptions <file>] [<folder or package-lock.json> ...]
//
// Folders default to backend, frontend and marketing/web. Exit status: 0 every license accepted,
// 1 at least one refused, 2 an input could not be read.

import path from 'node:path';
import {
  DEFAULT_EXCEPTIONS, FOLDERS, InputError, ROOT, evaluateLicense, loadExceptions, lockfilePath,
  productionPackages, readJsonFile,
} from './lib.mjs';

function parseArgs(argv) {
  const targets = [];
  let exceptionsFile = DEFAULT_EXCEPTIONS;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exceptions') {
      if (!argv[i + 1]) throw new InputError('--exceptions needs a file');
      exceptionsFile = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith('--')) {
      throw new InputError(`unknown option: ${argv[i]}`);
    } else {
      targets.push(lockfilePath(argv[i], process.cwd()));
    }
  }
  return { targets: targets.length ? targets : FOLDERS.map((f) => lockfilePath(f)), exceptionsFile };
}

function main() {
  const { targets, exceptionsFile } = parseArgs(process.argv.slice(2));
  const exceptions = loadExceptions(exceptionsFile);
  const used = new Set();
  const refused = [];

  for (const file of targets) {
    const label = path.relative(ROOT, path.dirname(file)) || path.dirname(file);
    const packages = productionPackages(readJsonFile(file), file);
    let excepted = 0;
    for (const pkg of packages) {
      const result = evaluateLicense(pkg.license);
      if (result.ok) continue;
      if (exceptions.has(pkg.id)) {
        used.add(pkg.id);
        excepted += 1;
        continue;
      }
      refused.push(`  ${label}: ${pkg.id} (${pkg.path}): ${result.problem}`);
    }
    console.log(`${label}: ${packages.length} production packages, ${excepted} accepted by an exception`);
  }

  for (const [id, exception] of exceptions) {
    if (used.has(id)) console.log(`Exception used: ${id} (${exception.license}): ${exception.reason}`);
  }
  const unused = [...exceptions.keys()].filter((id) => !used.has(id));
  if (unused.length) {
    console.log(`Exceptions no longer needed (remove them from ${path.relative(ROOT, exceptionsFile)}): ${unused.join(', ')}`);
  }

  if (refused.length) {
    console.log(`\n${refused.length} production dependencies have a refused or unreadable license:`);
    for (const line of refused) console.log(line);
    console.log(`Replace the dependency, or add an exception with its reason to ${path.relative(ROOT, exceptionsFile)}.`);
    process.exit(1);
  }
  console.log('Every production dependency has an accepted license.');
}

try {
  main();
} catch (err) {
  console.error(err instanceof InputError ? err.message : err);
  process.exit(2);
}
