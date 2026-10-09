import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { backendPath } from './backend-root';

/**
 * The image entrypoint (`scripts/migrate-and-start.js`) runs the integrated-doc repair and its
 * verification as compiled scripts, with the node binary of the entrypoint: the runtime image
 * holds no TypeScript tooling and no sources. A failed step never stops the start-up (unless
 * strict) and prints one error line that names the step.
 */

type Step = { label: string; script: string };
type Entrypoint = {
  integratedDocsRolloutSteps(backendDir?: string): Step[];
  integratedDocsFailureLine(label: string, error: unknown): string;
  runIntegratedDocsSteps(
    steps: Step[],
    options?: { strict?: boolean; logError?: (line: string) => void },
  ): Promise<boolean>;
};

// Requiring the entrypoint starts nothing: it runs only as the main module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const entrypoint: Entrypoint = require(backendPath('scripts', 'migrate-and-start.js'));

async function main(): Promise<void> {
  // 1. Both steps are compiled scripts of dist/, built from sources under src/.
  const steps = entrypoint.integratedDocsRolloutSteps('/app');
  assert.deepEqual(
    steps.map((step) => step.label),
    ['integrated-doc repair', 'integrated-doc verification'],
  );
  for (const step of steps) {
    assert.match(step.script, /^\/app\/dist\/knowledge\/scripts\/[a-z-]+\.js$/, `${step.label} runs from dist/`);
    const source = path.relative('/app/dist', step.script).replace(/\.js$/, '.ts');
    assert.ok(fs.existsSync(backendPath('src', source)), `src/${source} exists, so the build compiles it`);
  }
  const buildConfig = JSON.parse(fs.readFileSync(backendPath('tsconfig.build.json'), 'utf8'));
  for (const pattern of buildConfig.exclude as string[]) {
    assert.ok(!/knowledge|scripts/.test(pattern), `the build does not exclude the rollout scripts (${pattern})`);
  }

  // 2. Real child processes: a passing step, a failing step, a missing script.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-spec-'));
  const trace = path.join(dir, 'trace.txt');
  const write = (name: string, body: string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return file;
  };
  const passing = (tag: string) =>
    write(`${tag}.js`, `require('node:fs').appendFileSync(${JSON.stringify(trace)}, '${tag}\\n');`);
  const failing = write('failing.js', 'process.exit(3);');
  const ran = () => (fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n') : []);

  try {
    let lines: string[] = [];
    const logError = (line: string) => lines.push(line);

    // Every step passes: both run, in order, and nothing is logged as an error.
    const allPassed = await entrypoint.runIntegratedDocsSteps(
      [{ label: 'first step', script: passing('first') }, { label: 'second step', script: passing('second') }],
      { logError },
    );
    assert.equal(allPassed, true);
    assert.deepEqual(ran(), ['first', 'second']);
    assert.deepEqual(lines, []);

    // A step fails: the start-up goes on, one error line names the step, the next step is skipped.
    fs.rmSync(trace, { force: true });
    lines = [];
    const afterFailure = await entrypoint.runIntegratedDocsSteps(
      [{ label: 'integrated-doc repair', script: failing }, { label: 'integrated-doc verification', script: passing('verify') }],
      { logError },
    );
    assert.equal(afterFailure, false);
    assert.deepEqual(ran(), []);
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('\n'), 'a single line');
    assert.match(lines[0], /^\[entrypoint\] Integrated-doc rollout: the integrated-doc repair step failed \(exit code 3\)\./);
    assert.match(lines[0], /The API starts anyway/);

    // A missing compiled script is a failure of that step, reported the same way.
    lines = [];
    const missing = await entrypoint.runIntegratedDocsSteps(
      [{ label: 'integrated-doc verification', script: path.join(dir, 'absent.js') }],
      { logError },
    );
    assert.equal(missing, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /the integrated-doc verification step failed \(exit code 1\)/);

    // Strict: the failure stops the start-up, names the step and is not turned into a log line.
    lines = [];
    await assert.rejects(
      entrypoint.runIntegratedDocsSteps([{ label: 'integrated-doc repair', script: failing }], { strict: true, logError }),
      /the integrated-doc repair step failed \(exit code 3\)/,
    );
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 3. The failure line of the rollout check names it too.
  assert.match(
    entrypoint.integratedDocsFailureLine('rollout check', new Error('connection refused')),
    /^\[entrypoint\] Integrated-doc rollout: the rollout check step failed \(connection refused\)\. The API starts anyway/,
  );

  console.log('startup-entrypoint.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
