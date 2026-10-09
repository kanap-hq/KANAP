import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CONVERTER_FOLDER_VARIABLES, CONVERTER_INHERITED_VARIABLES, converterEnv, converterHome } from '../converter-env';
import { DocumentExportService } from '../document-export.service';
import { DocumentImportService } from '../document-import.service';
import { VectorImageConversionService } from '../vector-image-conversion.service';

// The document converters (pandoc, Typst through pandoc, Inkscape, `which`) get an environment
// built explicitly: the search path and locale of the API, their folders in a dedicated empty
// folder inside the temporary folder of the call (apart from the input files and the extracted
// media), and no other variable of the API process.

const API_ONLY_VARIABLES: Record<string, string> = {
  JWT_SECRET: 'spec-jwt-secret',
  DATABASE_URL: 'postgres://spec:spec@db.example.test:5432/spec',
  AWS_SECRET_ACCESS_KEY: 'spec-aws-secret',
  AI_SETTINGS_ENCRYPTION_SECRET: 'spec-ai-secret',
  SMTP_PASSWORD: 'spec-smtp-password',
  NODE_OPTIONS: '--max-old-space-size=64',
};

const LOCALE: Record<string, string> = {
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  LC_COLLATE: 'C',
  CHARSET: 'UTF-8',
};

/** Variables a POSIX shell may add on its own when it runs the stand-in tool. */
const SHELL_VARIABLES = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);

const ALLOWED = new Set<string>([...CONVERTER_INHERITED_VARIABLES, ...CONVERTER_FOLDER_VARIABLES]);

async function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function testBuiltEnvironment() {
  const callDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanap-converter-built-'));
  try {
    const parent: NodeJS.ProcessEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', ...LOCALE, ...API_ONLY_VARIABLES, USER: 'node' };
    const env = await converterEnv(callDir, parent);
    const home = converterHome(callDir);

    for (const key of Object.keys(API_ONLY_VARIABLES)) {
      assert.equal(key in env, false, `${key} stays in the API process`);
    }
    assert.equal('USER' in env, false, 'only the listed variables are copied');
    assert.equal(env.PATH, parent.PATH);
    for (const [key, value] of Object.entries(LOCALE)) assert.equal(env[key], value, `${key} is copied`);
    for (const key of CONVERTER_FOLDER_VARIABLES) assert.equal(env[key], home, `${key} is the tool folder`);
    assert.deepEqual(Object.keys(env).sort(), [...ALLOWED].sort());

    // The tool folder is a new empty folder directly inside the call folder, not the call folder.
    assert.notEqual(home, callDir);
    assert.equal(path.dirname(home), callDir);
    assert.ok((await fs.stat(home)).isDirectory(), 'the tool folder is created');
    assert.deepEqual(await fs.readdir(home), []);

    // A second call reuses it.
    await fs.writeFile(path.join(home, 'kept'), 'x');
    await converterEnv(callDir, parent);
    assert.deepEqual(await fs.readdir(home), ['kept']);

    // A variable the API does not have is left out, not set empty.
    const bare = await converterEnv(callDir, { PATH: '/usr/bin', LANG: '' });
    assert.deepEqual(Object.keys(bare).sort(), ['HOME', 'PATH', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME']);

    // The default parent is the API process, read at call time.
    const fromProcess = await converterEnv(callDir);
    assert.equal(fromProcess.PATH, process.env.PATH);
  } finally {
    await fs.rm(callDir, { recursive: true, force: true });
  }
  // The tool folder goes away with the call folder.
  await assert.rejects(fs.stat(converterHome(callDir)));
}

/**
 * A folder of stand-in tools placed first on the search path: each one writes the environment it
 * received to `<records>/<tool>.env`, then exits 0.
 */
async function standInTools(tools: string[]): Promise<{ binDir: string; records: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kanap-converter-env-spec-'));
  const binDir = path.join(root, 'bin');
  const records = path.join(root, 'records');
  await fs.mkdir(binDir);
  await fs.mkdir(records);
  for (const tool of tools) {
    const file = path.join(binDir, tool);
    await fs.writeFile(file, `#!/bin/sh\n/usr/bin/env > "${path.join(records, `${tool}.env`)}"\nexit 0\n`, 'utf8');
    await fs.chmod(file, 0o755);
  }
  return { binDir, records, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

async function readRecord(records: string, tool: string): Promise<Record<string, string>> {
  const text = await fs.readFile(path.join(records, `${tool}.env`), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

function assertReceived(received: Record<string, string>, label: string, callDir: string) {
  for (const key of Object.keys(API_ONLY_VARIABLES)) {
    assert.equal(key in received, false, `${label}: ${key} is not passed`);
  }
  for (const key of Object.keys(received)) {
    assert.ok(ALLOWED.has(key) || SHELL_VARIABLES.has(key), `${label}: unexpected variable ${key}`);
  }
  assert.equal(received.PATH, process.env.PATH, `${label}: PATH of the API`);
  assert.equal(received.LANG, LOCALE.LANG, `${label}: locale of the API`);
  for (const key of CONVERTER_FOLDER_VARIABLES) {
    assert.equal(received[key], converterHome(callDir), `${label}: ${key} is the tool folder of the call`);
  }
}

async function testServicesPassOnlyTheBuiltEnvironment() {
  const tools = await standInTools(['pandoc', 'inkscape', 'which']);
  const callDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanap-converter-call-'));
  try {
    await withEnv({ ...API_ONLY_VARIABLES, ...LOCALE, PATH: `${tools.binDir}${path.delimiter}${process.env.PATH ?? ''}` }, async () => {
      // Export: pandoc (and Typst, which pandoc runs with the same environment).
      await (new DocumentExportService() as any).runPandoc(['--version'], callDir);
      assertReceived(await readRecord(tools.records, 'pandoc'), 'export pandoc', callDir);
      await fs.rm(path.join(tools.records, 'pandoc.env'));

      // Import: pandoc reading the DOCX.
      const vector = new VectorImageConversionService();
      await (new DocumentImportService(vector) as any).convertInputToMarkdown(
        path.join(callDir, 'input.docx'),
        path.join(callDir, 'output.md'),
        callDir,
      );
      assertReceived(await readRecord(tools.records, 'pandoc'), 'import pandoc', callDir);

      // Vector images: `which` finds Inkscape, then Inkscape converts. The stand-in writes no
      // image, so the conversion reports a failure; only the environments matter here.
      const svg = path.join(callDir, 'drawing.svg');
      await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
      await vector.convertToPng(svg, '.svg', callDir);
      assertReceived(await readRecord(tools.records, 'which'), 'which', callDir);
      assertReceived(await readRecord(tools.records, 'inkscape'), 'inkscape', callDir);
    });
  } finally {
    await tools.cleanup();
    await fs.rm(callDir, { recursive: true, force: true });
  }
}

async function run() {
  await testBuiltEnvironment();
  await testServicesPassOnlyTheBuiltEnvironment();
  console.log('converter-env.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
