#!/usr/bin/env node
// KANAP smoke test: checks that an instance works after an update.
// Node 20+, no npm dependency. Usage and options: scripts/smoke/README.md.

const REQUEST_TIMEOUT_MS = 30_000;
const EXPORT_TIMEOUT_MS = 90_000;
const DETAIL_MAX = 160;

class Skip extends Error {}

const argv = process.argv.slice(2);
const jsonOutput = argv.includes('--json');
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    'Usage: KANAP_URL=... KANAP_EMAIL=... KANAP_PASSWORD=... node scripts/smoke/recette.mjs [--json]\n'
      + 'Optional: KANAP_INSECURE_TLS=1 (self-signed certificate), KANAP_WRITE=1 (create and delete a temporary task).\n'
      + 'See scripts/smoke/README.md.\n',
  );
  process.exit(0);
}
const unknownArgs = argv.filter((a) => a !== '--json');
if (unknownArgs.length > 0) usageError(`unknown argument: ${unknownArgs.join(' ')}`);

if (typeof fetch !== 'function' || typeof FormData !== 'function') {
  usageError('Node 20 or later is required (global fetch and FormData).');
}

const env = process.env;
const email = (env.KANAP_EMAIL || '').trim();
const password = env.KANAP_PASSWORD || '';
if (!env.KANAP_URL) usageError('KANAP_URL is required (for example http://fromage.lvh.me).');
if (!email) usageError('KANAP_EMAIL is required.');
if (!password) usageError('KANAP_PASSWORD is required.');

let origin;
try {
  const parsed = new URL(env.KANAP_URL);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
  origin = parsed.origin;
} catch {
  usageError('KANAP_URL must be an http:// or https:// URL.');
}

if (env.KANAP_INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  process.stderr.write('WARNING: KANAP_INSECURE_TLS=1: TLS certificates are not verified for this run.\n');
}
const writeEnabled = env.KANAP_WRITE === '1';

// Values that must never appear in the output.
const secrets = [password, email];
function redact(text) {
  let out = String(text ?? '');
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('<redacted>');
  }
  return out;
}

function usageError(message) {
  process.stderr.write(`recette: ${message}\nRun with --help for usage.\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// HTTP

const session = { accessToken: null, refreshCookie: null };

function setRefreshCookie(res) {
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  for (const c of cookies) {
    const m = /^\s*refresh_token=([^;]*)/.exec(c);
    if (m && m[1]) {
      session.refreshCookie = m[1];
      secrets.push(m[1]);
    }
  }
}

function errorReason(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [body.code || body.error, body.message].filter((v) => typeof v === 'string' && v);
  return parts.join(': ');
}

/**
 * One API call. Returns { status, headers, json, buffer }. Throws Skip on 403 (the account lacks
 * the right) and Error on network errors, 5xx, other unexpected statuses and malformed JSON.
 * `accept` lists extra statuses the caller handles itself.
 */
async function api(method, path, opts = {}) {
  const url = `${origin}/api${path}`;
  const headers = { Accept: opts.raw ? '*/*' : 'application/json' };
  if (opts.auth !== false && session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  if (method !== 'GET') headers.Origin = origin;
  if (opts.cookie) headers.Cookie = opts.cookie;
  let body;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res;
  let buffer;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const cause = String(err?.cause?.code || err?.cause?.message || err?.name || err?.message || err);
    const hint = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(cause) && env.KANAP_INSECURE_TLS !== '1'
      ? '; for a self-signed certificate set KANAP_INSECURE_TLS=1'
      : '';
    throw new Error(`${method} /api${path}: request failed (${redact(cause)}${hint})`);
  }

  const contentType = res.headers.get('content-type') || '';
  let json;
  if (contentType.includes('application/json') && buffer.length > 0) {
    try {
      json = JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new Error(`${method} /api${path}: HTTP ${res.status}, malformed JSON`);
    }
  }
  const out = { status: res.status, headers: res.headers, json, buffer, contentType, res };
  if (opts.accept?.includes(res.status)) return out;

  if (res.status === 403) {
    throw new Skip(`no permission (403${errorReason(json) ? `, ${errorReason(json)}` : ''})`);
  }
  if (res.status < 200 || res.status >= 300) {
    const reason = errorReason(json) || (json ? '' : buffer.toString('utf8').slice(0, 80).replace(/\s+/g, ' '));
    throw new Error(`${method} /api${path}: HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  if (!opts.raw && !json) {
    throw new Error(`${method} /api${path}: expected JSON, got ${contentType || 'no content type'}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check runner

const results = [];
let interrupted = false;

async function check(name, route, fn, { cleanup = false } = {}) {
  const started = performance.now();
  let status = 'OK';
  let detail = '';
  if (interrupted && !cleanup) {
    status = 'SKIP';
    detail = 'interrupted';
  } else {
    try {
      detail = (await fn()) ?? '';
    } catch (err) {
      status = err instanceof Skip ? 'SKIP' : 'FAIL';
      detail = err?.message || String(err);
    }
  }
  const result = {
    name,
    route,
    status,
    durationMs: Math.round(performance.now() - started),
    detail: redact(detail).slice(0, DETAIL_MAX),
  };
  results.push(result);
  if (!jsonOutput) printRow(result);
  return status === 'OK';
}

function needs(condition, reason) {
  if (!condition) throw new Skip(reason);
}

function printRow(r) {
  const time = `${r.durationMs} ms`.padStart(8);
  process.stdout.write(`${r.status.padEnd(4)} ${time}  ${r.name.padEnd(26)} ${r.detail}\n`);
}

function listCheck(name, path) {
  return check(name, `GET /api${path}`, async () => {
    needs(session.accessToken, 'requires login');
    const { json } = await api('GET', `${path}${path.includes('?') ? '&' : '?'}limit=5`);
    if (!Array.isArray(json?.items)) throw new Error('malformed response: no items array');
    return Number.isFinite(json.total) ? `${json.total} rows` : `${json.items.length} rows`;
  });
}

// ---------------------------------------------------------------------------
// Checks

const state = { canAdminTasks: null, documentId: null, documentRef: null };

async function readChecks() {
  await check('Health', 'GET /api/health', async () => {
    const { json } = await api('GET', '/health', { auth: false });
    if (json?.status !== 'ok') throw new Error(`unexpected body: ${JSON.stringify(json).slice(0, 60)}`);
    return 'status ok';
  });

  await check('Public config', 'GET /api/config/public', async () => {
    const { json } = await api('GET', '/config/public', { auth: false });
    const mode = json?.deploymentMode;
    if (mode !== 'multi-tenant' && mode !== 'single-tenant') throw new Error(`unknown deployment mode: ${mode}`);
    if (typeof json?.version !== 'string' || !json.version) throw new Error('version missing');
    return `${mode}, version ${json.version}`;
  });

  await check('Login', 'POST /api/auth/login', async () => {
    const { status, json, res } = await api('POST', '/auth/login', {
      auth: false,
      body: { email, password },
      accept: [401, 403, 429],
    });
    if (status === 429) throw new Error('rate limited (5 logins per minute): wait a minute and run again');
    if (status === 401 || status === 403) throw new Error(`login refused (${status}${errorReason(json) ? `, ${errorReason(json)}` : ''})`);
    if (typeof json?.access_token !== 'string' || !json.access_token) throw new Error('no access token in response');
    session.accessToken = json.access_token;
    secrets.push(json.access_token);
    setRefreshCookie(res);
    return session.refreshCookie ? 'access token and refresh cookie received' : 'access token received, no refresh cookie';
  });

  await check('Current user', 'GET /api/auth/me', async () => {
    needs(session.accessToken, 'requires login');
    const { json } = await api('GET', '/auth/me');
    const profileEmail = String(json?.profile?.email || '').toLowerCase();
    if (profileEmail !== email.toLowerCase()) throw new Error('profile does not match the account that logged in');
    const perms = json?.claims?.permissions;
    if (perms && typeof perms === 'object') state.canAdminTasks = perms.tasks === 'admin';
    const role = json?.profile?.role?.role_name || json?.profile?.role?.name || json?.profile?.role;
    return typeof role === 'string' && role ? `role ${role}` : 'profile matches';
  });

  await check('Token refresh (cookie)', 'POST /api/auth/refresh', async () => {
    needs(session.accessToken, 'requires login');
    needs(session.refreshCookie, 'no refresh cookie from login');
    const { json, res } = await api('POST', '/auth/refresh', {
      auth: false,
      cookie: `refresh_token=${session.refreshCookie}`,
    });
    if (typeof json?.access_token !== 'string' || !json.access_token) throw new Error('no access token in response');
    // Use the refreshed token from here on: every later check proves it works.
    session.accessToken = json.access_token;
    secrets.push(json.access_token);
    setRefreshCookie(res);
    return 'new access token received';
  });

  await listCheck('Companies', '/companies');
  await listCheck('OPEX items', '/spend-items');
  await listCheck('CAPEX items', '/capex-items');
  await listCheck('Portfolio projects', '/portfolio/projects');
  await listCheck('Portfolio requests', '/portfolio/requests');

  await check('Knowledge documents', 'GET /api/knowledge', async () => {
    needs(session.accessToken, 'requires login');
    const { json } = await api('GET', '/knowledge?limit=5');
    if (!Array.isArray(json?.items)) throw new Error('malformed response: no items array');
    const first = json.items.find((d) => d && typeof d.id === 'string');
    if (first) {
      state.documentId = first.id;
      state.documentRef = Number.isFinite(first.item_number) ? `DOC-${first.item_number}` : 'first document';
    }
    return `${json.total ?? json.items.length} rows`;
  });

  await listCheck('Tasks', '/tasks');
  await listCheck('Audit log', '/audit-logs');

  await check('CSV export (companies)', 'GET /api/companies/export', async () => {
    needs(session.accessToken, 'requires login');
    const { buffer, contentType } = await api('GET', '/companies/export?scope=data', { raw: true });
    if (!contentType.startsWith('text/csv')) throw new Error(`unexpected Content-Type: ${contentType || 'none'}`);
    const header = buffer.toString('utf8').replace(/^﻿/, '').split(/\r?\n/, 1)[0] || '';
    const columns = header.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!columns.includes('name')) throw new Error('header line has no "name" column');
    return `${columns.length} columns, ${buffer.length} bytes`;
  });

  await check('DOCX export (knowledge)', 'POST /api/knowledge/:id/export', async () => {
    needs(session.accessToken, 'requires login');
    needs(state.documentId, 'no knowledge document to export');
    const { buffer } = await api('POST', `/knowledge/${encodeURIComponent(state.documentId)}/export`, {
      body: { format: 'docx' },
      raw: true,
      timeoutMs: EXPORT_TIMEOUT_MS,
    });
    const zip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    if (!zip) throw new Error('response is not a DOCX file (no ZIP signature)');
    return `${state.documentRef}, ${buffer.length} bytes`;
  });

  await check('AI capabilities', 'GET /api/ai/capabilities', async () => {
    needs(session.accessToken, 'requires login');
    const { json } = await api('GET', '/ai/capabilities');
    const surfaces = json?.surfaces;
    if (!surfaces || typeof surfaces !== 'object') throw new Error('malformed response: no surfaces');
    return Object.entries(surfaces)
      .map(([k, v]) => `${k} ${v?.available ? 'available' : `off${v?.reasons?.length ? ` (${v.reasons.join(', ')})` : ''}`}`)
      .join(', ');
  });

  await check('AI settings', 'GET /api/ai/settings', async () => {
    needs(session.accessToken, 'requires login');
    const { json } = await api('GET', '/ai/settings');
    if (!json?.instance_features || typeof json.instance_features !== 'object') {
      throw new Error('malformed response: no instance_features');
    }
    const providers = Array.isArray(json.available_providers) ? json.available_providers.length : 0;
    return `settings readable, ${providers} providers available`;
  });
}

async function writeChecks() {
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const title = `recette ${stamp}`;
  const fileContent = `KANAP smoke test attachment, ${stamp}\n`;
  const task = { id: null, ref: null, attachmentId: null };

  const ready = () => {
    needs(session.accessToken, 'requires login');
    needs(state.canAdminTasks !== false, 'needs tasks admin (to delete the temporary task)');
  };

  try {
    await check('Create task', 'POST /api/tasks/standalone', async () => {
      ready();
      const { json } = await api('POST', '/tasks/standalone', { body: { title } });
      if (typeof json?.id !== 'string') throw new Error('malformed response: no task id');
      task.id = json.id;
      task.ref = Number.isFinite(json.item_number) ? `T-${json.item_number}` : json.id;
      return `${task.ref} "${title}"`;
    });

    await check('Attach file', 'POST /api/tasks/:id/attachments', async () => {
      needs(task.id, 'no temporary task');
      const form = new FormData();
      form.append('file', new Blob([fileContent], { type: 'text/plain' }), 'recette.txt');
      const { json } = await api('POST', `/tasks/${task.id}/attachments`, { form });
      if (typeof json?.id !== 'string') throw new Error('malformed response: no attachment id');
      task.attachmentId = json.id;
      return `recette.txt, ${Buffer.byteLength(fileContent)} bytes`;
    });

    await check('Read task back', 'GET /api/tasks/:id', async () => {
      needs(task.id, 'no temporary task');
      const { json } = await api('GET', `/tasks/${task.id}`);
      if (json?.title !== title) throw new Error('title does not match');
      return `${task.ref} title matches`;
    });

    await check('List attachments', 'GET /api/tasks/:id/attachments', async () => {
      needs(task.attachmentId, 'no attachment');
      const { json } = await api('GET', `/tasks/${task.id}/attachments`);
      const items = Array.isArray(json) ? json : json?.items;
      if (!Array.isArray(items)) throw new Error('malformed response: no attachment list');
      if (!items.some((a) => a?.id === task.attachmentId)) throw new Error('uploaded attachment not listed');
      return `${items.length} attachment(s)`;
    });

    await check('Download attachment', 'GET /api/tasks/attachments/:id', async () => {
      needs(task.attachmentId, 'no attachment');
      const { buffer } = await api('GET', `/tasks/attachments/${task.attachmentId}`, { raw: true });
      if (buffer.toString('utf8') !== fileContent) throw new Error('downloaded content differs from upload');
      return `${buffer.length} bytes, content matches`;
    });
  } finally {
    // Cleanup runs whatever happened above, including an interruption.
    await check('Delete attachment', 'PATCH /api/tasks/attachments/:id/delete', async () => {
      needs(task.attachmentId, 'nothing to delete');
      const { status } = await api('PATCH', `/tasks/attachments/${task.attachmentId}/delete`, { body: {}, accept: [403] });
      if (status === 403) throw new Error('403: attachment left behind');
      return 'deleted';
    }, { cleanup: true });

    await check('Delete task', 'DELETE /api/tasks/bulk', async () => {
      needs(task.id, 'nothing to delete');
      const { status, json } = await api('DELETE', '/tasks/bulk', { body: { ids: [task.id] }, accept: [403] });
      if (status === 403) throw new Error(`403: task ${task.ref} left behind, delete it by hand`);
      if (!Array.isArray(json?.deleted) || !json.deleted.includes(task.id)) {
        const reason = json?.failed?.[0]?.reason;
        throw new Error(`task ${task.ref} not deleted${reason ? ` (${reason})` : ''}, delete it by hand`);
      }
      return `${task.ref} deleted`;
    }, { cleanup: true });

    await check('Task is gone', 'GET /api/tasks/:id', async () => {
      needs(task.id, 'nothing to verify');
      const { status } = await api('GET', `/tasks/${task.id}`, { accept: [404] });
      if (status !== 404) throw new Error(`task ${task.ref} still readable (HTTP ${status})`);
      return '404 as expected';
    }, { cleanup: true });
  }
}

async function logout() {
  await check('Logout', 'POST /api/auth/logout', async () => {
    needs(session.refreshCookie, 'no session to close');
    await api('POST', '/auth/logout', { auth: false, cookie: `refresh_token=${session.refreshCookie}`, body: {} });
    return 'refresh token revoked';
  }, { cleanup: true });
}

// ---------------------------------------------------------------------------
// Main

process.on('SIGINT', () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  process.stderr.write('\nInterrupted: running cleanup (press Ctrl+C again to quit now).\n');
});

const runStarted = performance.now();
if (!jsonOutput) {
  process.stdout.write(`KANAP smoke test: ${origin}${writeEnabled ? ' (write checks on)' : ''}\n\n`);
}

try {
  await readChecks();
  if (writeEnabled) {
    await writeChecks();
  } else {
    await check('Write checks', '-', async () => {
      throw new Skip('off (set KANAP_WRITE=1 to enable)');
    });
  }
} finally {
  await logout();
}

const summary = {
  ok: results.filter((r) => r.status === 'OK').length,
  skipped: results.filter((r) => r.status === 'SKIP').length,
  failed: results.filter((r) => r.status === 'FAIL').length,
};
const totalMs = Math.round(performance.now() - runStarted);

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify({ url: origin, write: writeEnabled, interrupted, durationMs: totalMs, summary, checks: results }, null, 2)}\n`);
} else {
  process.stdout.write(`\n${summary.ok} OK, ${summary.skipped} skipped, ${summary.failed} failed (${(totalMs / 1000).toFixed(1)} s)${interrupted ? ', interrupted' : ''}\n`);
}
process.exitCode = summary.failed > 0 || interrupted ? 1 : 0;
