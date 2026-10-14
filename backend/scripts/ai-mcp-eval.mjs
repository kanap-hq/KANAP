#!/usr/bin/env node
// Asks realistic questions through `claude -p` against a KANAP MCP endpoint and prints each
// answer next to the facts read straight from the database. Not run in CI: it calls a model.
//
//   KANAP_MCP_KEY=kanap_mcp_... node scripts/ai-mcp-eval.mjs
//
// Environment:
//   KANAP_MCP_KEY     required, an MCP key of the tenant (never commit it)
//   KANAP_MCP_URL     default http://fromage.lvh.me/api/ai/mcp
//   KANAP_TENANT      tenant slug for the expected facts, default fromage
//   DATABASE_URL      default postgres://app:app@localhost:5432/appdb
//   EVAL_ONLY         comma-separated question ids to run
//   EVAL_MODEL        model passed to claude (default: claude's own)
//   EVAL_PAUSE        seconds between two questions, default 0
//   EVAL_CONCURRENCY  questions asked at once, default 1 (a key allows 60 MCP requests a minute,
//                     and each claude session sends several)
//   EVAL_REPORT       path of the Markdown report, default <tmp>/kanap-mcp-eval-<time>.md
//
// A question passes (`ok`) when the answer contains every value its facts list under
// `mustInclude`; `check` means read it yourself; `limited` means the key's rate limit answered. The facts come from SQL on the tenant
// (RLS: app.current_tenant set), independently of the tool layer under test.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import pg from 'pg';

const KEY = process.env.KANAP_MCP_KEY;
const URL = process.env.KANAP_MCP_URL || 'http://fromage.lvh.me/api/ai/mcp';
const TENANT = process.env.KANAP_TENANT || 'fromage';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/appdb';
const ONLY = process.env.EVAL_ONLY ? new Set(process.env.EVAL_ONLY.split(',').map((id) => id.trim())) : null;
const PAUSE = Math.max(0, Number(process.env.EVAL_PAUSE) || 0);
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY) || 1);
const REPORT = process.env.EVAL_REPORT || path.join(os.tmpdir(), `kanap-mcp-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);

if (!KEY) {
  console.error('KANAP_MCP_KEY is required (an MCP key of the tenant, created in Plaid settings).');
  process.exit(2);
}

const names = (rows, key = 'name') => rows.map((row) => row[key]);
const list = (values) => values.join(', ');

/** Each question: what is asked, and how to read the true answer from the database. */
const QUESTIONS = [
  {
    id: 'latest-application',
    q: 'Which is the last application created in KANAP?',
    facts: async (sql) => {
      const rows = await sql(`SELECT name, sequential_id, created_at FROM applications
        WHERE created_at = (SELECT max(created_at) FROM applications) ORDER BY sequential_id`);
      if (rows.length === 1) return { text: `${rows[0].sequential_id} ${rows[0].name} (${rows[0].created_at.toISOString()})`, mustInclude: [rows[0].sequential_id] };
      return { text: `${rows.length} applications share the latest creation time ${rows[0].created_at.toISOString()}: a good answer says they were created together` };
    },
  },
  {
    id: 'application-count',
    q: 'How many applications do we have, retired ones included?',
    facts: async (sql) => {
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM applications`);
      return { text: `${n} applications`, mustInclude: [String(n)] };
    },
  },
  {
    id: 'deprecated-applications',
    q: 'How many applications are deprecated, and which ones?',
    facts: async (sql) => {
      const rows = await sql(`SELECT name FROM applications WHERE lifecycle = 'deprecated' ORDER BY name`);
      return { text: `${rows.length}: ${list(names(rows))}`, mustInclude: [String(rows.length), ...names(rows)] };
    },
  },
  {
    id: 'pii-applications',
    q: 'How many applications contain personal data?',
    facts: async (sql) => {
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM applications WHERE contains_pii`);
      return { text: `${n} applications`, mustInclude: [String(n)] };
    },
  },
  {
    id: 'top-application-supplier',
    q: 'Which supplier provides the most applications, and which applications are they?',
    facts: async (sql) => {
      const [top] = await sql(`SELECT s.id, s.name, count(*)::int AS n FROM applications a JOIN suppliers s ON s.id = a.supplier_id
        GROUP BY s.id, s.name ORDER BY n DESC, s.name LIMIT 1`);
      const apps = await sql(`SELECT name FROM applications WHERE supplier_id = $1 ORDER BY name`, [top.id]);
      return { text: `${top.name} (${top.n}): ${list(names(apps))}`, mustInclude: [top.name, ...names(apps)] };
    },
  },
  {
    id: 'it-owner',
    q: 'Who is the IT owner of APP-1?',
    facts: async (sql) => {
      const rows = await sql(`SELECT trim(concat(u.first_name, ' ', u.last_name)) AS name FROM application_owners o
        JOIN applications a ON a.id = o.application_id JOIN users u ON u.id = o.user_id
        WHERE a.sequential_id = 'APP-1' AND o.owner_type = 'it' ORDER BY 1`);
      return rows.length ? { text: list(names(rows)), mustInclude: names(rows) } : { text: 'APP-1 has no IT owner' };
    },
  },
  {
    id: 'interfaces-from-app',
    q: 'Which application is the source of the most interfaces, and where do they go?',
    facts: async (sql) => {
      const [top] = await sql(`SELECT a.id, a.name, count(*)::int AS n FROM interfaces i JOIN applications a ON a.id = i.source_application_id
        GROUP BY a.id, a.name ORDER BY n DESC, a.name LIMIT 1`);
      const targets = await sql(`SELECT DISTINCT t.name FROM interfaces i JOIN applications t ON t.id = i.target_application_id
        WHERE i.source_application_id = $1 ORDER BY 1`, [top.id]);
      return { text: `${top.name} (${top.n}) to ${list(names(targets))}`, mustInclude: [top.name, ...names(targets)] };
    },
  },
  {
    id: 'production-vms',
    q: 'How many virtual machines do we run in production?',
    facts: async (sql) => {
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM assets WHERE kind = 'virtual_machine' AND environment = 'prod'`);
      return { text: `${n}`, mustInclude: [String(n)] };
    },
  },
  {
    id: 'locations-france',
    q: 'Which of our locations are in France?',
    facts: async (sql) => {
      const rows = await sql(`SELECT name FROM locations WHERE country_iso = 'FR' ORDER BY name`);
      return { text: list(names(rows)), mustInclude: names(rows) };
    },
  },
  {
    id: 'contracts-per-supplier',
    q: 'Which supplier has the most contracts?',
    facts: async (sql) => {
      const rows = await sql(`SELECT s.name, count(*)::int AS n FROM contracts c JOIN suppliers s ON s.id = c.supplier_id
        GROUP BY s.name ORDER BY n DESC, s.name`);
      const top = rows.filter((row) => row.n === rows[0].n);
      return top.length === 1
        ? { text: `${top[0].name} (${top[0].n})`, mustInclude: [top[0].name] }
        : { text: `a tie at ${rows[0].n} contract(s) each between ${top.length} suppliers: a good answer says so` };
    },
  },
  {
    id: 'oldest-contract',
    q: 'Which contract started first, and when?',
    facts: async (sql) => {
      const [row] = await sql(`SELECT name, start_date::text AS start FROM contracts ORDER BY start_date, name LIMIT 1`);
      return { text: `${row.name}, ${row.start}`, mustInclude: [row.name] };
    },
  },
  {
    id: 'projects-in-progress',
    q: 'How many projects are in progress right now?',
    facts: async (sql) => {
      const rows = await sql(`SELECT name FROM portfolio_projects WHERE status = 'in_progress' ORDER BY name`);
      return { text: `${rows.length}: ${list(names(rows))}`, mustInclude: [String(rows.length)] };
    },
  },
  {
    id: 'recently-updated-projects',
    q: 'List the three most recently updated projects.',
    facts: async (sql) => {
      const rows = await sql(`SELECT name, updated_at FROM portfolio_projects ORDER BY updated_at DESC LIMIT 4`);
      const tie = rows[3] && rows[3].updated_at.getTime() === rows[2].updated_at.getTime();
      return { text: `${list(names(rows.slice(0, 3)))}${tie ? ' (the third ties with others)' : ''}`, mustInclude: names(rows.slice(0, tie ? 2 : 3)) };
    },
  },
  {
    id: 'requests-by-status',
    q: 'Give me the number of portfolio requests by status.',
    facts: async (sql) => {
      const rows = await sql(`SELECT status, count(*)::int AS n FROM portfolio_requests GROUP BY status ORDER BY status`);
      return { text: list(rows.map((row) => `${row.status} ${row.n}`)) };
    },
  },
  {
    id: 'open-tasks',
    q: 'How many tasks are open (not started yet)?',
    facts: async (sql) => {
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM tasks WHERE status = 'open'`);
      return { text: `${n}`, mustInclude: [String(n)] };
    },
  },
  {
    id: 'busiest-assignee',
    q: 'Who has the most tasks assigned, and how many?',
    facts: async (sql) => {
      const [row] = await sql(`SELECT trim(concat(u.first_name, ' ', u.last_name)) AS name, count(*)::int AS n FROM tasks t
        JOIN users u ON u.id = t.assignee_user_id GROUP BY 1 ORDER BY n DESC, 1 LIMIT 1`);
      return { text: `${row.name} (${row.n})`, mustInclude: [row.name, String(row.n)] };
    },
  },
  {
    id: 'latest-task',
    q: 'What is the most recently created task?',
    facts: async (sql) => {
      const rows = await sql(`SELECT title, item_number FROM tasks WHERE created_at = (SELECT max(created_at) FROM tasks) ORDER BY item_number`);
      return rows.length === 1
        ? { text: `T-${rows[0].item_number} ${rows[0].title}`, mustInclude: [`T-${rows[0].item_number}`] }
        : { text: `${rows.length} tasks share the latest creation time: a good answer says so` };
    },
  },
  {
    id: 'enabled-users',
    q: 'How many enabled users does KANAP have?',
    facts: async (sql) => {
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM users WHERE status = 'enabled'`);
      return { text: `${n}`, mustInclude: [String(n)] };
    },
  },
  {
    id: 'opex-lines',
    q: 'How many OPEX budget lines are there?',
    facts: async (sql) => {
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM spend_items WHERE nature = 'opex'`);
      return { text: `${n}`, mustInclude: [String(n)] };
    },
  },
  {
    id: 'usd-opex-lines',
    q: 'Which OPEX lines are in US dollars, and in which currency are the budget amounts you get for them?',
    facts: async (sql) => {
      const rows = await sql(`SELECT 'BL-' || item_number AS ref FROM spend_items WHERE nature = 'opex' AND currency = 'USD' ORDER BY item_number`);
      const [{ code }] = await sql(`SELECT coalesce(metadata->>'reporting_currency', 'EUR') AS code FROM tenants WHERE id = app_current_tenant()`);
      return { text: `${list(names(rows, 'ref'))}; their amounts come converted to ${code}`, mustInclude: [...names(rows, 'ref'), code] };
    },
  },
  {
    id: 'latest-document',
    q: 'Which knowledge document was updated most recently?',
    facts: async (sql) => {
      const [row] = await sql(`SELECT title FROM documents ORDER BY updated_at DESC LIMIT 1`);
      return { text: row.title, mustInclude: [row.title] };
    },
  },
];

async function loadFacts(questions) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const [tenant] = (await client.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT])).rows;
    if (!tenant) throw new Error(`No tenant "${TENANT}" in ${DATABASE_URL}.`);
    await client.query('BEGIN READ ONLY');
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
    const sql = async (text, params = []) => (await client.query(text, params)).rows;
    const facts = {};
    for (const question of questions) {
      try {
        facts[question.id] = await question.facts(sql);
      } catch (error) {
        facts[question.id] = { text: `facts failed: ${error.message}` };
      }
    }
    await client.query('ROLLBACK');
    return facts;
  } finally {
    await client.end();
  }
}

function ask(question, mcpConfigPath) {
  return new Promise((resolve) => {
    const args = [
      '-p', question.q,
      '--mcp-config', mcpConfigPath,
      '--strict-mcp-config',
      '--allowedTools', 'mcp__kanap',
      '--output-format', 'json',
      '--append-system-prompt', 'Answer from the KANAP MCP tools only, in two or three sentences. Name records by name and reference.',
      ...(process.env.EVAL_MODEL ? ['--model', process.env.EVAL_MODEL] : []),
    ];
    const started = Date.now();
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      const seconds = Math.round((Date.now() - started) / 1000);
      try {
        const parsed = JSON.parse(out);
        resolve({ answer: String(parsed.result ?? '').trim(), turns: parsed.num_turns ?? null, seconds, error: parsed.is_error ? 'error' : null });
      } catch {
        resolve({ answer: '', turns: null, seconds, error: `claude exited ${code}: ${(err || out).trim().slice(0, 300)}` });
      }
    });
  });
}

function verdict(facts, result) {
  if (result.error) return 'error';
  // A rate limit (the key's, or the built-in model budget MCP calls draw on) answered, or the
  // session could not connect to the server: not the tools. Ask that question again later.
  if (/MCP_RATE_LIMITED|rate limit exceeded|no KANAP MCP tools are connected/i.test(result.answer)) return 'limited';
  if (!facts.mustInclude?.length) return 'check';
  const answer = result.answer.toLowerCase();
  return facts.mustInclude.every((value) => answer.includes(String(value).toLowerCase())) ? 'ok' : 'MISS';
}

async function main() {
  const questions = QUESTIONS.filter((question) => !ONLY || ONLY.has(question.id));
  const facts = await loadFacts(questions);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanap-mcp-eval-'));
  const mcpConfigPath = path.join(dir, 'mcp.json');
  fs.writeFileSync(mcpConfigPath, JSON.stringify({
    mcpServers: { kanap: { type: 'http', url: URL, headers: { Authorization: `Bearer ${KEY}` } } },
  }), { mode: 0o600 });

  const results = {};
  try {
    let next = 0;
    const worker = async () => {
      while (next < questions.length) {
        const question = questions[next++];
        if (PAUSE && next > 1) await new Promise((resolve) => setTimeout(resolve, PAUSE * 1000));
        results[question.id] = await ask(question, mcpConfigPath);
        const v = verdict(facts[question.id], results[question.id]);
        console.log(`[${v.padEnd(5)}] ${question.id} (${results[question.id].seconds}s, ${results[question.id].turns ?? '?'} turns)`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, questions.length) }, worker));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const lines = [`# KANAP MCP eval`, '', `${URL}, tenant ${TENANT}, ${new Date().toISOString()}`, ''];
  const tally = {};
  for (const question of questions) {
    const result = results[question.id];
    const v = verdict(facts[question.id], result);
    tally[v] = (tally[v] ?? 0) + 1;
    lines.push(`## ${question.id}: ${v}`, '', `**Question**: ${question.q}`, '', `**Facts**: ${facts[question.id].text}`, '',
      `**Answer** (${result.turns ?? '?'} turns, ${result.seconds}s): ${result.error ?? result.answer}`, '');
  }
  lines.splice(3, 0, `Result: ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ')}`, '');
  fs.writeFileSync(REPORT, lines.join('\n'));

  console.log('');
  for (const question of questions) {
    const result = results[question.id];
    console.log(`${question.id}\n  facts:  ${facts[question.id].text}\n  answer: ${(result.error ?? result.answer).replace(/\s+/g, ' ').slice(0, 400)}\n`);
  }
  console.log(`Result: ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ')}. Report: ${REPORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
