// Minimal HTTP client for the perf scripts (no dependencies).
//
// Built on node:http instead of fetch so that each caller controls its own
// connection pool (a browser opens at most 6 connections per host over
// HTTP/1.1) and its timeouts (fetch caps response headers at 300 s).

import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

export function createClient({ baseUrl, maxSockets = 6, timeoutMs = 0 } = {}) {
  const base = new URL(baseUrl);
  const lib = base.protocol === 'https:' ? https : http;
  const agent = new lib.Agent({ keepAlive: true, maxSockets, maxFreeSockets: maxSockets });
  const prefix = base.pathname.replace(/\/$/, '');

  // A kept-alive socket can be closed by the server (keepAliveTimeout, 5 s in Node) at the moment
  // it is reused: the request then fails with ECONNRESET before any byte. Browsers retry such a
  // request once on a new connection; so does this client (counted in `retriedReset`).
  async function request(method, route, options = {}) {
    const first = await attempt(method, route, options);
    if (first.status === 0 && first.reusedSocket && first.bytes === 0 && ['ECONNRESET', 'EPIPE'].includes(first.error)) {
      const second = await attempt(method, route, options);
      return { ...second, ms: first.ms + second.ms, retriedReset: true };
    }
    return first;
  }

  function attempt(method, route, { json, form, token, headers = {}, parse = true } = {}) {
    const url = new URL(prefix + route, base);
    const reqHeaders = { Accept: 'application/json', ...headers };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    let body = null;
    if (json !== undefined) {
      body = Buffer.from(JSON.stringify(json));
      reqHeaders['Content-Type'] = 'application/json';
    } else if (form) {
      const boundary = `----perf${randomBytes(8).toString('hex')}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${form.filename}"\r\n` +
        `Content-Type: text/csv; charset=utf-8\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      // Extra text parts, after the file (the budget file route takes `snapshot` beside `file`).
      const fields = Object.entries(form.fields ?? {}).map(([name, value]) => Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`,
      ));
      body = Buffer.concat([head, Buffer.isBuffer(form.bytes) ? form.bytes : Buffer.from(form.bytes), ...fields, tail]);
      reqHeaders['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    }
    if (body) reqHeaders['Content-Length'] = body.length;

    return new Promise((resolve) => {
      const started = process.hrtime.bigint();
      const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        resolve({ method, route, ...result, ms: elapsed() });
      };
      const req = lib.request(url, { method, headers: reqHeaders, agent }, (res) => {
        const chunks = [];
        let ttfb = elapsed();
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let data = null;
          if (parse && buf.length) {
            try { data = JSON.parse(buf.toString('utf8')); } catch { data = buf.toString('utf8'); }
          }
          done({ status: res.statusCode, bytes: buf.length, ttfbMs: ttfb, data });
        });
        res.on('error', (err) => done({ status: 0, bytes: 0, error: err.code || err.message }));
      });
      if (timeoutMs > 0) {
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error('timeout'));
          done({ status: 0, bytes: 0, error: 'timeout' });
        });
      }
      req.on('error', (err) => done({ status: 0, bytes: 0, error: err.code || err.message, reusedSocket: req.reusedSocket }));
      if (body) req.write(body);
      req.end();
    });
  }

  return { request, agent, close: () => agent.destroy() };
}

/** Run `worker(item)` over `list` with at most `concurrency` in flight. */
export async function pool(list, concurrency, worker) {
  const results = new Array(list.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await worker(list[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export function parseCsv(content, delimiter = ';') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) { row.push(field); field = ''; continue; }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && content[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = []; field = '';
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((v) => v.length > 0)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()])));
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
