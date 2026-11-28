import 'reflect-metadata';
import * as assert from 'node:assert/strict';

// Non-regression of the AI installation settings (lot S3 of the Paramétrage sprint): an
// installation whose database holds no installation setting behaves as before, variable by
// variable. The expected values are today's behaviour, written before the settings service
// existed and run first on the code before it (the values a module read once at load are read
// again from a fresh load of that module, for each state of the environment).
//
// One change is intended and is not in this table: a web search key made of spaces no longer
// counts as configured (installation-settings.spec.ts).
//
// With the settings service, each state the file defines is also run with a database row that
// says otherwise: the file wins, the result is the same.

const VARIABLES = [
  'BRAVE_SEARCH_API_KEY',
  'AI_CHAT_MAX_TOKENS',
  'AI_CHAT_REASONING_MAX_TOKENS',
  'AI_AGENT_VISION_MAX_IMAGES',
  'AI_AGENT_VISION_MAX_IMAGE_BYTES',
] as const;
type Variable = (typeof VARIABLES)[number];
type EnvState = Partial<Record<Variable, string>>;

const ORCHESTRATOR = '../../ai/ai-chat-orchestrator.service';
const FEATURES = '../../config/features';
const EVIDENCE = '../../ai/control-plane/agent-control/ai-ticket-evidence-extraction.service';
const SNAPSHOT = '../installation-settings.snapshot';

/** A database row that disagrees with every file value of the table. */
const DATABASE_ROW = {
  web_search_api_key: 'database-key',
  chat_max_tokens: 777,
  ticket_max_images: 2,
  ticket_max_image_bytes: 4321,
};

type Snapshot = { setRow(domain: string, row: Record<string, unknown> | null): void };

/** The snapshot of the settings service, when the code has one. */
function settingsSnapshot(): Snapshot | null {
  try {
    return require(SNAPSHOT).installationSettingsSnapshot as Snapshot;
  } catch {
    return null;
  }
}

function setEnv(state: EnvState): () => void {
  const previous = new Map<string, string | undefined>(VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of VARIABLES) {
    if (Object.prototype.hasOwnProperty.call(state, name)) process.env[name] = state[name];
    else delete process.env[name];
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

function withEnv<T>(state: EnvState, fn: () => T): T {
  const restore = setEnv(state);
  try {
    return fn();
  } finally {
    restore();
  }
}

/** A module loaded again, so that what it reads at load is read under the current environment. */
function freshModule<T>(path: string): T {
  delete require.cache[require.resolve(path)];
  return require(path) as T;
}

function maxTokens(state: EnvState) {
  return withEnv(state, () => {
    const { resolveProviderMaxTokens } = freshModule<{ resolveProviderMaxTokens(p: string, m: string): number }>(ORCHESTRATOR);
    return {
      openaiReasoning: resolveProviderMaxTokens('openai', 'gpt-5.4'),
      openaiChat: resolveProviderMaxTokens('openai', 'gpt-4o'),
      other: resolveProviderMaxTokens('anthropic', 'claude-sonnet-4-5'),
    };
  });
}

function webSearchReady(state: EnvState): boolean {
  return withEnv(state, () => freshModule<{ Features: { AI_WEB_SEARCH_READY: boolean } }>(FEATURES).Features.AI_WEB_SEARCH_READY);
}

/** The key the web search sends to Brave (header X-Subscription-Token), or the refusal. */
async function braveKey(state: EnvState): Promise<string | 'refused'> {
  const { BraveSearchService } = require('../../ai/web-search/brave-search.service');
  const originalFetch = globalThis.fetch;
  let sent: string | null = null;
  globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    sent = init?.headers?.['X-Subscription-Token'] ?? null;
    return new Response(JSON.stringify({ web: { results: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const restore = setEnv(state);
  try {
    await new BraveSearchService().search('public question');
    return sent ?? 'refused';
  } catch {
    return 'refused';
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
}

function evidenceService() {
  const { AiTicketEvidenceExtractionService } = require(EVIDENCE);
  return new AiTicketEvidenceExtractionService({ resolveRuntime: async () => ({ supportsVision: true }) } as any);
}

function imageCount(state: EnvState): number {
  return withEnv(state, () => evidenceService().maxImageCount());
}

/** The size above which an image of a ticket is skipped, read from the skip warning. */
async function imageBytes(state: EnvState): Promise<number> {
  const restore = setEnv(state);
  try {
    const ref = { id: 'img-1', kind: 'image', source: 'ticket_description', target: 'attachment-1' };
    const result = await evidenceService().extractImageEvidence({} as any, {
      ticket: { id: 'T-1', attachments: [ref] },
      notes: [],
      readAttachment: async () => ({ attachment: ref, filename: 'a.png', mimeType: 'image/png', sizeBytes: 1e15, base64Data: '' }),
    });
    const warning = (result.warnings as string[]).find((line) => line.includes('image exceeds'));
    assert.ok(warning, `a size warning (${JSON.stringify(result.warnings)})`);
    return Number(/exceeds (\d+) bytes/.exec(warning)![1]);
  } finally {
    restore();
  }
}

type Row<T> = { label: string; env: EnvState; expected: T; fileDefines: boolean };

const BRAVE: Array<Row<{ ready: boolean; key: string }>> = [
  { label: 'absent', env: {}, expected: { ready: false, key: 'refused' }, fileDefines: false },
  { label: "''", env: { BRAVE_SEARCH_API_KEY: '' }, expected: { ready: false, key: 'refused' }, fileDefines: false },
  { label: 'a key', env: { BRAVE_SEARCH_API_KEY: 'file-key' }, expected: { ready: true, key: 'file-key' }, fileDefines: true },
];

const TOKENS = (value: number, reasoning = Math.max(value, 16384)) => ({ openaiReasoning: reasoning, openaiChat: value, other: value });
const MAX_TOKENS: Array<Row<ReturnType<typeof TOKENS>>> = [
  { label: 'absent', env: {}, expected: TOKENS(16384), fileDefines: false },
  { label: "''", env: { AI_CHAT_MAX_TOKENS: '' }, expected: TOKENS(16384), fileDefines: false },
  { label: "'   '", env: { AI_CHAT_MAX_TOKENS: '   ' }, expected: TOKENS(16384), fileDefines: false },
  { label: "'0'", env: { AI_CHAT_MAX_TOKENS: '0' }, expected: TOKENS(16384), fileDefines: false },
  { label: "'-5'", env: { AI_CHAT_MAX_TOKENS: '-5' }, expected: TOKENS(16384), fileDefines: false },
  { label: "'abc'", env: { AI_CHAT_MAX_TOKENS: 'abc' }, expected: TOKENS(16384), fileDefines: false },
  { label: "'12abc'", env: { AI_CHAT_MAX_TOKENS: '12abc' }, expected: TOKENS(12), fileDefines: true },
  { label: "'1.9'", env: { AI_CHAT_MAX_TOKENS: '1.9' }, expected: TOKENS(1), fileDefines: true },
  { label: "'32768'", env: { AI_CHAT_MAX_TOKENS: '32768' }, expected: TOKENS(32768), fileDefines: true },
  { label: 'very large', env: { AI_CHAT_MAX_TOKENS: '99999999999999999999' }, expected: TOKENS(1e20), fileDefines: true },
];

const REASONING: Array<Row<ReturnType<typeof TOKENS>>> = [
  { label: 'absent, small length', env: { AI_CHAT_MAX_TOKENS: '4000' }, expected: TOKENS(4000, 16384), fileDefines: true },
  { label: 'absent, large length', env: { AI_CHAT_MAX_TOKENS: '50000' }, expected: TOKENS(50000, 50000), fileDefines: true },
  { label: 'set', env: { AI_CHAT_REASONING_MAX_TOKENS: '9000' }, expected: TOKENS(16384, 9000), fileDefines: false },
  { label: 'set, length set', env: { AI_CHAT_MAX_TOKENS: '50000', AI_CHAT_REASONING_MAX_TOKENS: '9000' }, expected: TOKENS(50000, 9000), fileDefines: true },
  { label: "'0'", env: { AI_CHAT_REASONING_MAX_TOKENS: '0' }, expected: TOKENS(16384, 16384), fileDefines: false },
];

const IMAGES: Array<Row<number>> = [
  { label: 'absent', env: {}, expected: 5, fileDefines: false },
  { label: "'3'", env: { AI_AGENT_VISION_MAX_IMAGES: '3' }, expected: 3, fileDefines: true },
  { label: "'10'", env: { AI_AGENT_VISION_MAX_IMAGES: '10' }, expected: 10, fileDefines: true },
  { label: "'11'", env: { AI_AGENT_VISION_MAX_IMAGES: '11' }, expected: 10, fileDefines: true },
  { label: "'0'", env: { AI_AGENT_VISION_MAX_IMAGES: '0' }, expected: 5, fileDefines: false },
  { label: "'abc'", env: { AI_AGENT_VISION_MAX_IMAGES: 'abc' }, expected: 5, fileDefines: false },
  { label: "''", env: { AI_AGENT_VISION_MAX_IMAGES: '' }, expected: 5, fileDefines: false },
];

const IMAGE_BYTES: Array<Row<number>> = [
  { label: 'absent', env: {}, expected: 20 * 1024 * 1024, fileDefines: false },
  { label: "'1048576'", env: { AI_AGENT_VISION_MAX_IMAGE_BYTES: '1048576' }, expected: 1048576, fileDefines: true },
  { label: "'1'", env: { AI_AGENT_VISION_MAX_IMAGE_BYTES: '1' }, expected: 1, fileDefines: true },
  { label: "'209715200'", env: { AI_AGENT_VISION_MAX_IMAGE_BYTES: '209715200' }, expected: 209715200, fileDefines: true },
  { label: "'abc'", env: { AI_AGENT_VISION_MAX_IMAGE_BYTES: 'abc' }, expected: 20 * 1024 * 1024, fileDefines: false },
  { label: "'-1'", env: { AI_AGENT_VISION_MAX_IMAGE_BYTES: '-1' }, expected: 20 * 1024 * 1024, fileDefines: false },
];

const lines: string[] = [];

async function check<T>(variable: string, rows: Array<Row<T>>, read: (env: EnvState) => T | Promise<T>, snapshot: Snapshot | null) {
  for (const row of rows) {
    snapshot?.setRow('ai', null);
    const actual = await read(row.env);
    assert.deepEqual(actual, row.expected, `${variable} ${row.label}`);
    let withRow = '';
    if (snapshot && row.fileDefines) {
      snapshot.setRow('ai', DATABASE_ROW);
      try {
        assert.deepEqual(await read(row.env), row.expected, `${variable} ${row.label}, with a database row`);
      } finally {
        snapshot.setRow('ai', null);
      }
      withRow = ', same with a database row';
    }
    lines.push(`${variable} ${row.label}: ${JSON.stringify(actual)}${withRow}`);
  }
}

async function run() {
  const snapshot = settingsSnapshot();
  await check('BRAVE_SEARCH_API_KEY', BRAVE, async (env) => ({ ready: webSearchReady(env), key: await braveKey(env) }), snapshot);
  await check('AI_CHAT_MAX_TOKENS', MAX_TOKENS, maxTokens, snapshot);
  await check('AI_CHAT_REASONING_MAX_TOKENS', REASONING, maxTokens, snapshot);
  await check('AI_AGENT_VISION_MAX_IMAGES', IMAGES, imageCount, snapshot);
  await check('AI_AGENT_VISION_MAX_IMAGE_BYTES', IMAGE_BYTES, imageBytes, snapshot);
  for (const line of lines) console.log(`  ${line}`);
  console.log(`installation-ai-nonregression.spec: ok (${snapshot ? 'with the settings service' : 'code before the settings service'})`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
