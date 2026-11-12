#!/usr/bin/env node
// Knowledge search bench of the support agents (R2). See README.md next to this file.
//
//   node bench.mjs setup   --tenant bench --accounts <file> --glpi-url <url the API reaches>
//   node bench.mjs run     --tenant bench --accounts <file> --glpi-listen <host:port> [--glpi-url ..] [--only 1-5] [--family a,b] [--out dir]
//   node bench.mjs serve-glpi --glpi-listen <host:port>      (one fake GLPI for runs started with --external-glpi)
//   node bench.mjs replay  <run dir> --tenant .. --accounts .. [--external-glpi | --glpi-listen ..]  (tickets cut by an API outage)
//   node bench.mjs report  <run dir>
//   node bench.mjs compare <run dir A> <run dir B>
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadDataset, selectTickets } from './lib/dataset.mjs';
import { KanapApi, TenantDb } from './lib/kanap.mjs';
import { BENCH_AGENT_NAME, setupTenant } from './lib/setup.mjs';
import { glpiTicketId, startFakeGlpi } from './fake-glpi.mjs';
import { playTicket } from './lib/player.mjs';
import { scoreResults } from './lib/score.mjs';
import { buildCompareReport, buildRunReport } from './lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, 'data');

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tenant: { type: 'string' },
    'base-url': { type: 'string' },
    accounts: { type: 'string' },
    account: { type: 'string', default: 'claude' },
    'database-url': { type: 'string' },
    'glpi-listen': { type: 'string' },
    'glpi-url': { type: 'string' },
    only: { type: 'string' },
    family: { type: 'string' },
    out: { type: 'string' },
    label: { type: 'string' },
    'external-glpi': { type: 'boolean', default: false },
  },
});

const command = positionals[0];

function fail(message) {
  console.error(message);
  process.exit(2);
}

function credentials() {
  if (process.env.KB_EMAIL && process.env.KB_PASSWORD) return { email: process.env.KB_EMAIL, password: process.env.KB_PASSWORD };
  if (!opts.accounts) fail('give --accounts <file> (JSON {"<account>": {"email", "password"}}) or KB_EMAIL and KB_PASSWORD');
  const accounts = JSON.parse(fs.readFileSync(opts.accounts, 'utf8'));
  const account = accounts[opts.account];
  if (!account?.email || !account?.password) fail(`no account "${opts.account}" in ${opts.accounts}`);
  return account;
}

function connect({ withDb = false } = {}) {
  if (!opts.tenant) fail('give --tenant <slug>');
  const baseUrl = opts['base-url'] ?? `http://${opts.tenant}.lvh.me/api`;
  const api = new KanapApi({ baseUrl, ...credentials() });
  if (!withDb) return { api, db: null, baseUrl };
  const databaseUrl = opts['database-url'] ?? process.env.KB_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) fail('give --database-url or KB_DATABASE_URL (read-only use: setup checks)');
  const db = new TenantDb({ databaseUrl, tenantSlug: opts.tenant });
  return { api, db, baseUrl };
}

function glpiUrlFromOptions() {
  const url = opts['glpi-url'] ?? (opts['glpi-listen'] ? `http://${opts['glpi-listen']}/` : null);
  if (!url) fail('give --glpi-url (the address the API uses to reach the fake GLPI) or --glpi-listen');
  return url;
}

function servedCommit(baseUrl) {
  // The version the API serves; the commit comes from the operator (--label) or the dev tool.
  return fetch(`${baseUrl}/config/public`).then((r) => r.json()).then((j) => j.version ?? null).catch(() => null);
}

async function cmdSetup() {
  const dataset = loadDataset(DATA_DIR);
  const { api, db } = connect({ withDb: true });
  await db.init();
  try {
    const result = await setupTenant({ api, db, dataset, glpiUrl: glpiUrlFromOptions() });
    console.log(JSON.stringify(result));
  } finally {
    await db.close();
  }
}

async function cmdRun() {
  const dataset = loadDataset(DATA_DIR);
  const tickets = selectTickets(dataset.tickets, { only: opts.only, families: opts.family });
  if (!tickets.length) fail('no ticket selected');
  if (!opts['glpi-listen'] && !opts['external-glpi']) fail('give --glpi-listen <host:port>: where the fake GLPI listens');
  const [listenHost, listenPort] = (opts['glpi-listen'] ?? '').split(/:(?=\d+$)/);
  const { api, baseUrl } = connect();
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(opts.out ?? path.join(os.homedir(), '.cache', 'kadratis-knowledge-bench'), `${opts.tenant}-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  const glpiLog = fs.createWriteStream(path.join(outDir, 'fake-glpi.log'));
  // With --external-glpi, a `serve-glpi` process already serves the tickets (several runs at once).
  const fake = opts['external-glpi'] ? null : await startFakeGlpi({
    ticketsByNumber: new Map(dataset.tickets.map((t) => [t.n, t])),
    host: listenHost,
    port: Number(listenPort),
    log: (line) => glpiLog.write(`${new Date().toISOString()} ${line}\n`),
  });
  // A run sequence unique enough for a day of runs: GLPI ids never repeat between runs.
  const runSequence = Math.floor(startedAt.getTime() / 1000) % 10_000_000;
  let benchCommit = null;
  try { benchCommit = execFileSync('git', ['-C', HERE, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch { /* n/a */ }
  const meta = {
    tenant: opts.tenant,
    label: opts.label ?? null,
    served_version: await servedCommit(baseUrl),
    bench_commit: benchCommit,
    started_at: startedAt.toISOString(),
    run_sequence: runSequence,
    tickets: tickets.map((t) => t.n),
  };
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(meta, null, 2));
  const agents = (await api.get('/ai/admin/control-plane/agents'))?.items ?? [];
  const agent = agents.find((a) => a.name === BENCH_AGENT_NAME);
  if (!agent) fail('no bench agent on this tenant: run setup first');
  const resultsFile = path.join(outDir, 'results.jsonl');
  console.log(`run ${outDir}: ${tickets.length} tickets`);
  try {
    for (const ticket of tickets) {
      const glpiId = glpiTicketId(runSequence, ticket.n);
      const result = await playTicket({ api, ticket, glpiId, agentId: agent.id, dataset, rawDir: outDir, log: console.log });
      fs.appendFileSync(resultsFile, `${JSON.stringify(result)}\n`);
      console.log(`#${ticket.n} ${ticket.family}: top5=${result.verdict.top5} cited=${result.verdict.cited} abstain=${result.verdict.abstention ?? '-'} ${result.duration_ms} ms ${result.error ? `ERROR ${result.error}` : ''}`);
    }
  } finally {
    meta.finished_at = new Date().toISOString();
    meta.served_version_end = await servedCommit(baseUrl);
    meta.fake_glpi_writes = fake ? fake.writes : 'see the serve-glpi log';
    fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(meta, null, 2));
    fake?.server.close();
    glpiLog.end();
  }
  writeReport(outDir, dataset);
}

const TRANSIENT_MESSAGE = /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|aborted|timeout|HTTP 50[234]\b/i;

/** Replays the tickets of a run that failed on an API outage (not on the chain) and rebuilds its report. */
async function cmdReplay(dir) {
  const dataset = loadDataset(DATA_DIR);
  const { meta, results } = readRun(dir);
  if (meta.tenant !== opts.tenant) fail(`this run was played on "${meta.tenant}"`);
  const cut = results.filter((r) => r.error && (r.transient || TRANSIENT_MESSAGE.test(r.error)));
  if (!cut.length) { console.log('no ticket to replay'); return; }
  const { api, baseUrl } = connect();
  const [listenHost, listenPort] = (opts['glpi-listen'] ?? '').split(/:(?=\d+$)/);
  const fake = opts['external-glpi'] ? null : await startFakeGlpi({
    ticketsByNumber: new Map(dataset.tickets.map((t) => [t.n, t])), host: listenHost, port: Number(listenPort),
  });
  const agents = (await api.get('/ai/admin/control-plane/agents'))?.items ?? [];
  const agent = agents.find((a) => a.name === BENCH_AGENT_NAME);
  const runSequence = Math.floor(Date.now() / 1000) % 10_000_000;
  const replaced = new Map();
  try {
    for (const old of cut) {
      const ticket = dataset.tickets.find((t) => t.n === old.n);
      const result = await playTicket({ api, ticket, glpiId: glpiTicketId(runSequence, ticket.n), agentId: agent.id, dataset, rawDir: dir, log: console.log });
      result.interruptions = [...(old.interruptions ?? []), { glpi_id: old.glpi_id, error: old.error, replayed_at: new Date().toISOString() }, ...(result.interruptions ?? [])];
      replaced.set(old.n, result);
      console.log(`#${ticket.n} replayed: top5=${result.verdict.top5} cited=${result.verdict.cited} abstain=${result.verdict.abstention ?? '-'}`);
    }
  } finally {
    fake?.server.close();
  }
  fs.writeFileSync(path.join(dir, 'results.jsonl'), results.map((r) => JSON.stringify(replaced.get(r.n) ?? r)).join('\n') + '\n');
  meta.replayed = [...(meta.replayed ?? []), { at: new Date().toISOString(), tickets: [...replaced.keys()], served_version: await servedCommit(baseUrl) }];
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta, null, 2));
  writeReport(dir, dataset);
}

function readRun(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const results = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { meta, results };
}

function writeReport(dir, dataset = loadDataset(DATA_DIR)) {
  const { meta, results } = readRun(dir);
  const markdown = buildRunReport({ meta, results, scores: scoreResults(results), dataset });
  fs.writeFileSync(path.join(dir, 'report.md'), markdown);
  console.log(`report: ${path.join(dir, 'report.md')}`);
}

async function cmdServeGlpi() {
  const dataset = loadDataset(DATA_DIR);
  if (!opts['glpi-listen']) fail('give --glpi-listen <host:port>');
  const [host, port] = opts['glpi-listen'].split(/:(?=\d+$)/);
  const fake = await startFakeGlpi({
    ticketsByNumber: new Map(dataset.tickets.map((t) => [t.n, t])),
    host,
    port: Number(port),
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  console.log(`fake GLPI listening on ${host}:${fake.port}; Ctrl+C to stop`);
}

async function main() {
  if (command === 'setup') return cmdSetup();
  if (command === 'serve-glpi') return cmdServeGlpi();
  if (command === 'run') return cmdRun();
  if (command === 'replay') {
    if (!positionals[1]) fail('give the run directory');
    return cmdReplay(path.resolve(positionals[1]));
  }
  if (command === 'report') {
    if (!positionals[1]) fail('give the run directory');
    return writeReport(path.resolve(positionals[1]));
  }
  if (command === 'compare') {
    if (!positionals[2]) fail('give two run directories');
    const a = readRun(path.resolve(positionals[1]));
    const b = readRun(path.resolve(positionals[2]));
    process.stdout.write(buildCompareReport({
      a: { ...a, scores: scoreResults(a.results) },
      b: { ...b, scores: scoreResults(b.results) },
    }));
    return undefined;
  }
  fail('usage: node bench.mjs setup|run|report|compare (see README.md)');
  return undefined;
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
