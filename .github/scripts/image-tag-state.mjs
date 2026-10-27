// What release-images.yml may do with an image tag. A published tag is never rewritten:
//
//   free   the tag does not exist: build and push it.
//   same   the tag exists and its index carries org.opencontainers.image.revision = the commit of
//          this run and org.opencontainers.image.version = the expected version: a previous run of
//          the same commit published it. Nothing is built; its digest is read from the registry.
//   other  the tag exists from another commit or another version: refused.
//
//   node .github/scripts/image-tag-state.mjs <revision> <version> <key>=<name:tag>...
//
// for example `... "$GITHUB_SHA" 26.11.1 api=ghcr.io/kanap-hq/kanap-api:26.11.1`. Writes
// `<key>=free|same` and `<key>-digest=<sha256:...>` (empty when free) to $GITHUB_OUTPUT, checks
// every reference, then exits 1 when one is `other` or cannot be checked.
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REVISION = 'org.opencontainers.image.revision';
const VERSION = 'org.opencontainers.image.version';
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * The state of a tag from the result of `docker buildx imagetools inspect <ref> --format
 * '{{json .Manifest}}'` ({ status, stdout, stderr }). Returns { state, digest, reason }, state one
 * of free, same, other, error. Never throws.
 */
export function tagState(inspect, revision, version) {
  const output = `${inspect?.stderr ?? ''}\n${inspect?.stdout ?? ''}`;
  if (inspect?.status !== 0) {
    if (/not found|manifest unknown|name unknown/i.test(output)) return { state: 'free', digest: '', reason: 'not published yet' };
    // A package this token cannot read is one it cannot write either: the push that follows
    // fails rather than rewrite it. GHCR may also answer 403 for a package that does not exist.
    if (/403 forbidden|denied/i.test(output)) return { state: 'free', digest: '', reason: 'not readable with this token, the push decides' };
    return { state: 'error', digest: '', reason: `cannot be checked: ${output.trim() || `exit ${inspect?.status}`}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(inspect.stdout);
  } catch {
    return { state: 'error', digest: '', reason: `cannot be checked: the registry answered "${String(inspect.stdout).trim()}"` };
  }
  const digest = manifest?.digest;
  if (!DIGEST.test(String(digest ?? ''))) return { state: 'error', digest: '', reason: 'cannot be checked: no digest in the answer of the registry' };
  const annotations = manifest.annotations ?? {};
  const foundRevision = annotations[REVISION] ?? '(none)';
  const foundVersion = annotations[VERSION] ?? '(none)';
  if (foundRevision === revision && foundVersion === version) {
    return { state: 'same', digest, reason: `already published by ${revision}: reused, not built again` };
  }
  return {
    state: 'other',
    digest,
    reason: `already published from revision ${foundRevision}, version ${foundVersion} (this run: ${revision}, ${version}). `
      + 'A published tag is never rewritten: find out why it exists. A version whose images cannot be published ships as a new version.',
  };
}

function main(argv) {
  const [revision, version, ...pairs] = argv;
  if (!revision || !version || pairs.length === 0 || pairs.some((pair) => !/^[a-z]+=\S+$/.test(pair))) {
    console.error('usage: image-tag-state.mjs <revision> <version> <key>=<name:tag>...');
    return 2;
  }
  let status = 0;
  const lines = [];
  for (const pair of pairs) {
    const key = pair.slice(0, pair.indexOf('='));
    const ref = pair.slice(pair.indexOf('=') + 1);
    const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Manifest}}'], { encoding: 'utf8' });
    if (result.error) {
      console.log(`::error::${ref} cannot be checked: ${result.error.message}`);
      status = 1;
      continue;
    }
    const found = tagState(result, revision, version);
    if (found.state === 'free' || found.state === 'same') {
      console.log(`${found.state.padEnd(5)} ${ref}: ${found.reason}${found.digest ? ` (${found.digest})` : ''}`);
      lines.push(`${key}=${found.state}`, `${key}-digest=${found.digest}`);
    } else {
      console.log(`::error::${ref} ${found.reason}`);
      status = 1;
    }
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
