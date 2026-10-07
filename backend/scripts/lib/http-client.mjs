// HTTP client of the Fromage & Co fixture loader (no dependencies).
//
// Built on node:http instead of fetch because fetch drops a custom `Host`
// header, and the API resolves the tenant from it: the server mode calls the
// API on 127.0.0.1 with the tenant's host name. Same approach as
// scripts/perf/lib/http.mjs: a keep-alive agent and a multipart body built by
// hand.
//
// One retry at most, and only when it cannot apply a change twice: a GET that
// failed (no answer, or 502/503/504), or any request whose connection was
// refused (nothing was sent). A write cut off before its answer is not sent
// again, even on a kept-alive socket: the client cannot tell a socket the
// server had closed while idle from a server that read the write and dropped
// it (the spec shows the second case), and a duplicated write would go
// unnoticed where a failed load is visible. The calls run one after the other,
// so a socket is never idle long enough to meet the server's keep-alive limit.
//
// With `followRedirect` (CLI mode: a public URL, where a proxy may send http to
// https), one redirect to the same host name is followed, with the same method,
// body and headers (303: a GET without body). When only the origin changed,
// the later calls go there directly. A redirect to another host is not
// followed: the request carries the administrator's token.

import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

const RETRIED_GET_STATUSES = new Set([502, 503, 504]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRY_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The multipart body of one file part (`file`) plus text parts. */
export function buildMultipart({ bytes, filename, contentType = 'text/csv; charset=utf-8', fields = {} }) {
  const boundary = `----kanap${randomBytes(12).toString('hex')}`;
  const safeName = String(filename ?? 'file.csv').replace(/["\r\n]/g, '_');
  const parts = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\n`
      + `Content-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8'),
  ];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`));
    parts.push(Buffer.from(String(value), 'utf8'));
  }
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Whether a failed attempt may be sent again (see the top of this file). */
export function mayRetry(method, attempt) {
  if (attempt.status === 0) {
    if (method === 'GET') return true;
    return attempt.error === 'ECONNREFUSED' && !attempt.responseBytes;
  }
  return method === 'GET' && RETRIED_GET_STATUSES.has(attempt.status);
}

/** The protocol module, keep-alive agent and path prefix of an API root. */
function endpoint(rootUrl) {
  const base = new URL(rootUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error(`Unsupported protocol in ${base.origin}`);
  }
  const lib = base.protocol === 'https:' ? https : http;
  return { base, lib, agent: new lib.Agent({ keepAlive: true, maxSockets: 1 }), prefix: base.pathname.replace(/\/$/, '') };
}

/**
 * `baseUrl` is the API root (`http://127.0.0.1:8080`, or a public URL with its
 * `/api` prefix). `host`, when given, is sent as the `Host` header; otherwise
 * Node derives it from the URL. `followRedirect`: see the top of this file.
 */
export function createHttpClient({ baseUrl, host = null, followRedirect = false }) {
  let current = endpoint(baseUrl);
  const agents = [current.agent];
  const stats = { requests: 0, retries: 0 };

  function attempt(method, url, headers, body, at = current) {
    const reqHeaders = { Accept: 'application/json', ...headers };
    if (host) reqHeaders.Host = host;
    if (body) reqHeaders['Content-Length'] = body.length;
    stats.requests += 1;
    return new Promise((resolve) => {
      let settled = false;
      let responseBytes = 0;
      const done = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const req = at.lib.request(url, { method, headers: reqHeaders, agent: at.agent }, (res) => {
        const chunks = [];
        responseBytes = 1; // the status line arrived
        res.on('data', (chunk) => {
          chunks.push(chunk);
          responseBytes += chunk.length;
        });
        res.on('end', () => done({
          status: res.statusCode ?? 0,
          text: Buffer.concat(chunks).toString('utf8'),
          location: res.headers.location ?? null,
        }));
        res.on('error', (error) => done({ status: 0, error: error.code || error.message, responseBytes }));
        res.on('close', () => {
          if (!res.complete) done({ status: 0, error: 'ECONNRESET', responseBytes });
        });
      });
      req.on('error', (error) => done({
        status: 0,
        error: error.code || error.message,
        responseBytes,
        reusedSocket: req.reusedSocket,
      }));
      if (body) req.write(body);
      req.end();
    });
  }

  /** The redirect answered to `url`, when it is to be followed: the target and its endpoint. */
  function redirectTarget(url, result) {
    if (!followRedirect || !REDIRECT_STATUSES.has(result.status) || !result.location) return null;
    let target;
    try {
      target = new URL(result.location, url);
    } catch {
      return null;
    }
    if (target.hostname !== url.hostname) return null;
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (target.pathname === url.pathname && target.search === url.search) {
      // Only the origin changed (http to https): later calls go there directly.
      current = endpoint(`${target.origin}${current.prefix}`);
      agents.push(current.agent);
      return { url: target, at: current };
    }
    const at = endpoint(target.origin);
    agents.push(at.agent);
    return { url: target, at };
  }

  /**
   * Resolves to `{ status, text }` for every answer, whatever its status.
   * Rejects only when no answer came back (after the retry, when allowed).
   */
  async function request(method, route, { headers = {}, json, form } = {}) {
    let body = null;
    const reqHeaders = { ...headers };
    if (form) {
      const multipart = buildMultipart(form);
      body = multipart.body;
      reqHeaders['Content-Type'] = multipart.contentType;
    } else if (json !== undefined) {
      body = Buffer.from(JSON.stringify(json), 'utf8');
      reqHeaders['Content-Type'] = 'application/json';
    }

    const url = new URL(current.prefix + route, current.base);
    let result = await attempt(method, url, reqHeaders, body);
    if (mayRetry(method, result)) {
      stats.retries += 1;
      await sleep(RETRY_DELAY_MS);
      result = await attempt(method, url, reqHeaders, body);
    }
    const redirect = redirectTarget(url, result);
    if (redirect) {
      const seeOther = result.status === 303;
      const redirectedHeaders = { ...reqHeaders };
      if (seeOther) {
        delete redirectedHeaders['Content-Type'];
      }
      result = await attempt(seeOther ? 'GET' : method, redirect.url, redirectedHeaders, seeOther ? null : body, redirect.at);
    }
    if (result.status === 0) {
      const error = new Error(`${method} ${url.pathname}${url.search}: no answer from ${url.origin} (${result.error})`);
      error.status = 0;
      throw error;
    }
    return result;
  }

  return { request, stats, close: () => agents.forEach((agent) => agent.destroy()) };
}
