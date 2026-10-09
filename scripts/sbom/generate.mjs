// Component inventory (SBOM) and third-party notices of a KANAP version, to attach to its
// published release. No dependency: it reads the package-lock.json of backend, frontend and
// marketing/web (production dependencies, the packages `npm ci --omit=dev` installs) and writes,
// in the output folder:
//   sbom-backend.cdx.json, sbom-frontend.cdx.json, sbom-marketing-web.cdx.json
//                               CycloneDX 1.5 JSON, one component per package name and version
//   THIRD-PARTY-NOTICES.txt     name, version, license and author of each of those packages
//   api-image-packages.txt      with --image only: the Alpine packages of a built API image
//                               (`apk info -v`) and its Node.js version
//
//   node scripts/sbom/generate.mjs --out <folder outside the repository> [--image <api image>]
//
// Licenses come from the lockfiles, or from scripts/sbom/license-exceptions.json for a package
// whose lockfile entry has none. Authors are read from installed packages when the folder has a
// node_modules (run `npm ci` first to include them); without it the notices give name, version
// and license. --image runs `docker run --rm` on an image built from backend/Dockerfile, for
// example `docker build -t kanap-api:<version> backend`. The generated files are never committed.
//
// At a release: check out the tag, run the script with an output folder outside the repository,
// and attach every file of that folder to the GitHub release (see doc/sbom.md).

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_EXCEPTIONS, FOLDERS, InputError, ROOT, loadExceptions, lockfilePath, productionPackages,
  readJsonFile, reportedLicense, singleLicenseId,
} from './lib.mjs';

const HASH_ALGORITHMS = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

function parseArgs(argv) {
  const options = { out: null, image: null, exceptions: DEFAULT_EXCEPTIONS };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--out', '--image', '--exceptions'].includes(flag)) throw new InputError(`unknown argument: ${flag}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new InputError(`${flag} needs a value`);
    options[flag.slice(2)] = value;
    i += 1;
  }
  if (!options.out) throw new InputError('usage: node scripts/sbom/generate.mjs --out <folder> [--image <api image>]');
  options.out = path.resolve(options.out);
  options.exceptions = path.resolve(options.exceptions);
  const inside = path.relative(ROOT, options.out);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    throw new InputError(`--out must be outside the repository (${ROOT}): the files are attached to the release, never committed`);
  }
  return options;
}

// "Name <email> (url)" or { name } as package.json declares it: the name only.
function authorName(author) {
  const raw = typeof author === 'string' ? author : author?.name;
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/<[^>]*>|\([^)]*\)/g, '').trim();
  return name || null;
}

function installedAuthor(folder, pkg) {
  const file = path.join(folder, pkg.path, 'package.json');
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    return manifest.version === pkg.version ? authorName(manifest.author) : null;
  } catch {
    return null;
  }
}

function purl(name, version) {
  return `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(version)}`;
}

function cdxLicenses(license) {
  if (!license) return undefined;
  const id = singleLicenseId(license);
  if (id) return [{ license: { id } }];
  return [{ expression: license }];
}

function cdxHashes(integrity) {
  if (!integrity) return undefined;
  const hashes = integrity.split(/\s+/).map((item) => {
    const dash = item.indexOf('-');
    const alg = HASH_ALGORITHMS[item.slice(0, dash)];
    return alg ? { alg, content: Buffer.from(item.slice(dash + 1), 'base64').toString('hex') } : null;
  }).filter(Boolean);
  return hashes.length ? hashes : undefined;
}

function component(pkg, license, author) {
  const slash = pkg.name.startsWith('@') ? pkg.name.indexOf('/') : -1;
  const ref = purl(pkg.name, pkg.version);
  return {
    type: 'library',
    'bom-ref': ref,
    ...(author ? { author } : {}),
    ...(slash > 0 ? { group: pkg.name.slice(0, slash), name: pkg.name.slice(slash + 1) } : { name: pkg.name }),
    version: pkg.version,
    ...(cdxLicenses(license) ? { licenses: cdxLicenses(license) } : {}),
    purl: ref,
    ...(cdxHashes(pkg.integrity) ? { hashes: cdxHashes(pkg.integrity) } : {}),
    ...(pkg.resolved ? { externalReferences: [{ type: 'distribution', url: pkg.resolved }] } : {}),
  };
}

function inventory(folder, exceptions, timestamp) {
  const lockFile = lockfilePath(folder);
  const lock = readJsonFile(lockFile);
  const root = lock.packages?.[''] ?? {};
  const packages = productionPackages(lock, lockFile).map((pkg) => ({
    ...pkg,
    reportedLicense: reportedLicense(pkg, exceptions),
    author: installedAuthor(path.dirname(lockFile), pkg),
  }));
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp,
      tools: { components: [{ type: 'application', name: 'scripts/sbom/generate.mjs' }] },
      component: {
        type: 'application',
        'bom-ref': `kanap-${folder.replace(/\//g, '-')}`,
        name: root.name ?? lock.name ?? folder,
        version: root.version ?? lock.version ?? '0.0.0',
        ...(cdxLicenses(root.license) ? { licenses: cdxLicenses(root.license) } : {}),
      },
    },
    components: packages.map((pkg) => component(pkg, pkg.reportedLicense, pkg.author)),
  };
  return { bom, packages };
}

function notices(sections, timestamp) {
  const lines = [
    'KANAP third-party notices',
    '',
    'KANAP is licensed under the GNU Affero General Public License, version 3 (see LICENSE and NOTICE).',
    'It includes the open-source packages below: the production dependencies of each folder, read',
    'from its package-lock.json. Each package keeps its own license; its full text is in the package',
    'as published on the npm registry.',
    `Generated ${timestamp}.`,
  ];
  for (const { folder, packages } of sections) {
    lines.push('', `== ${folder} (${packages.length} packages) ==`, '');
    for (const pkg of packages) {
      lines.push(`${pkg.name} ${pkg.version}`);
      lines.push(`  License: ${pkg.reportedLicense ?? 'none declared'}`);
      if (pkg.author) lines.push(`  Author: ${pkg.author}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) throw new InputError(`cannot run docker: ${result.error.message}`);
  if (result.status !== 0) throw new InputError(`docker ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}

function imagePackages(image) {
  const packages = docker(['run', '--rm', '--entrypoint', 'apk', image, 'info', '-v'])
    .split('\n').map((line) => line.trim()).filter(Boolean).sort();
  const node = docker(['run', '--rm', '--entrypoint', 'node', image, '--version']).trim();
  return [
    `# Alpine packages of the API image ${image} (apk info -v): ${packages.length}`,
    `# Node.js ${node} comes from the official node image, not from an Alpine package.`,
    ...packages,
  ].join('\n').concat('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const exceptions = loadExceptions(options.exceptions);
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  // Every input is read before the first file is written.
  const sections = FOLDERS.map((folder) => ({ folder, ...inventory(folder, exceptions, timestamp) }));
  const image = options.image ? imagePackages(options.image) : null;

  mkdirSync(options.out, { recursive: true });
  const written = [];
  const write = (name, content) => {
    writeFileSync(path.join(options.out, name), content);
    written.push(name);
  };
  for (const { folder, bom } of sections) {
    write(`sbom-${folder.replace(/\//g, '-')}.cdx.json`, `${JSON.stringify(bom, null, 2)}\n`);
  }
  write('THIRD-PARTY-NOTICES.txt', notices(sections, timestamp));
  if (image) write('api-image-packages.txt', image);

  for (const { folder, packages } of sections) {
    const missing = packages.filter((pkg) => !pkg.reportedLicense).length;
    console.log(`${folder}: ${packages.length} components${missing ? `, ${missing} without a license` : ''}`);
  }
  console.log(`Written to ${options.out}: ${written.join(', ')}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof InputError ? err.message : err);
  process.exit(err instanceof InputError ? 2 : 1);
}
