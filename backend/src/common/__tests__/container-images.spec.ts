import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BACKEND_ROOT } from './backend-root';

/**
 * Container images. Every base image of the Dockerfiles and every image of the development
 * compose file is pinned as name:tag@sha256:<digest> with the date of the digest in a comment
 * (the CI `images` job checks that each digest is a multi-architecture index). The API image
 * takes its packages from the Alpine release of its base only. Its last stage, `runtime`, is the
 * default build: compiled code and production dependencies, no sources or development tools.
 * The server compose files build it explicitly; the development compose file builds `dev`.
 */

const REPO_ROOT = path.dirname(BACKEND_ROOT);
const read = (relative: string) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

const DOCKERFILES = ['backend/Dockerfile', 'frontend/Dockerfile', 'frontend/Dockerfile.dev', 'marketing/Dockerfile'];
const PINNED = /^[a-z0-9./_-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/;
const DATED_COMMENT = /^#.*\b\d{4}-\d{2}-\d{2}\b/;

type Stage = { name: string | null; from: string; body: string[] };

function stages(dockerfile: string): Stage[] {
  const result: Stage[] = [];
  for (const line of dockerfile.split('\n')) {
    const from = /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(line);
    if (from) {
      result.push({ from: from[1], name: from[2] ?? null, body: [] });
    } else if (result.length > 0) {
      result[result.length - 1].body.push(line);
    }
  }
  return result;
}

// 1. Base images: pinned to a digest, dated, never a floating tag.
for (const file of DOCKERFILES) {
  const text = read(file);
  const lines = text.split('\n');
  const names = new Set(stages(text).map((stage) => stage.name).filter(Boolean));
  let images = 0;
  lines.forEach((line, index) => {
    const from = /^FROM\s+(?:--\S+\s+)*(\S+)/i.exec(line);
    if (!from || names.has(from[1])) return;
    images += 1;
    assert.match(from[1], PINNED, `${file}: ${from[1]} is pinned to a digest`);
    assert.match(lines[index - 1] ?? '', DATED_COMMENT, `${file}: the line above ${from[1]} dates the digest`);
  });
  assert.ok(images > 0, `${file} has a base image`);
}

// 2. Development compose file: every image pinned the same way.
const devCompose = read('infra/docker-compose.example.yml');
const composeImages = [...devCompose.matchAll(/^\s+image:\s*["']?([^"'\s]+)/gm)].map((match) => match[1]);
assert.ok(composeImages.length >= 5, 'the development compose file lists its images');
for (const image of composeImages) {
  assert.match(image, PINNED, `infra/docker-compose.example.yml: ${image} is pinned to a digest`);
}

// 3. API image packages: only the repositories of the base image's Alpine release.
const apiDockerfile = read('backend/Dockerfile');
assert.ok(!/--repository|--repositories-file|\/edge\//.test(apiDockerfile), 'no package comes from another repository');
for (const tool of ['pandoc', 'typst', 'inkscape', 'fontconfig']) {
  assert.match(apiDockerfile, new RegExp(`apk add[^\\n]*(\\\\\\n[^\\n]*)*\\b${tool}\\b`), `${tool} is installed`);
}

// 4. API image stages: runtime last, built from the pruned tree, without sources.
const apiStages = stages(apiDockerfile);
const byName = new Map(apiStages.map((stage) => [stage.name, stage]));
assert.equal(apiStages[apiStages.length - 1].name, 'runtime', 'runtime is the last stage, the default build');
assert.ok(byName.has('dev'), 'a dev stage exists');
assert.equal((apiDockerfile.match(/\bnpm ci\b/g) ?? []).length, 1, 'dependencies are installed once');
assert.ok(/npm prune --omit=dev/.test(apiDockerfile), 'production dependencies are pruned from the build tree');
const runtime = byName.get('runtime')!;
const runtimeCopies = runtime.body.filter((line) => /^COPY\b/.test(line));
assert.ok(runtimeCopies.length > 0, 'the runtime stage copies its files');
for (const line of runtimeCopies) {
  assert.ok(/--from=\S+/.test(line), `runtime copies from a build stage: ${line}`);
  assert.ok(!/\/src\b|tsconfig|__tests__|\.spec\./.test(line), `runtime takes no sources: ${line}`);
}
assert.ok(runtimeCopies.some((line) => /\/app\/dist\b/.test(line)), 'runtime takes the compiled dist/');
assert.ok(runtime.body.some((line) => /^USER node\s*$/.test(line)), 'runtime runs as node');
assert.ok(
  runtime.body.some((line) => line.trim() === 'CMD ["node", "./scripts/migrate-and-start.js"]'),
  'runtime starts the entrypoint in exec form',
);

// 5. Compose files: explicit API stage.
function apiTarget(relative: string): string | null {
  const lines = read(relative).split('\n');
  const start = lines.findIndex((line) => /^ {2}api:\s*$/.test(line));
  assert.ok(start >= 0, `${relative} has an api service`);
  for (let i = start + 1; i < lines.length && !/^ {0,2}\S/.test(lines[i]); i += 1) {
    const target = /^\s+target:\s*(\S+)/.exec(lines[i]);
    if (target) return target[1];
  }
  return null;
}
for (const file of ['infra/compose.onprem.yml', 'infra/compose.qa.yml', 'infra/compose.prod.yml']) {
  assert.equal(apiTarget(file), 'runtime', `${file} builds the runtime stage`);
}
assert.equal(apiTarget('infra/docker-compose.example.yml'), 'dev', 'the development compose file builds the dev stage');

console.log('container-images.spec: ok');
