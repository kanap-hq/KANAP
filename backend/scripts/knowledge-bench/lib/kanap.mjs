// Access to Kadratis for the bench: the HTTP API on `http://<tenant>.lvh.me/api` (Node's fetch
// drops a custom Host header, so the tenant is in the host name), one login reused, and read-only
// SQL on the tenant with app.current_tenant set (oracles: run steps, queries, tool results).
import pg from 'pg';

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const tokenExpiry = (token) => {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp * 1000; } catch { return 0; }
};

export class KanapApi {
  constructor({ baseUrl, email, password }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.email = email;
    this.password = password;
    this.accessToken = null;
  }

  async token() {
    if (this.accessToken && tokenExpiry(this.accessToken) - Date.now() > 120_000) return this.accessToken;
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!response.ok) throw new HttpError(response.status, `login: HTTP ${response.status}`);
    this.accessToken = (await response.json()).access_token;
    return this.accessToken;
  }

  async request(method, route, body, { timeoutMs = 120_000 } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${this.baseUrl}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await this.token()}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 401 && attempt === 0) { this.accessToken = null; continue; }
      const text = await response.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      if (!response.ok) {
        throw new HttpError(response.status, `${method} ${route}: HTTP ${response.status} ${String(text).slice(0, 300)}`, parsed);
      }
      return parsed;
    }
    throw new HttpError(401, `${method} ${route}: unauthorized`);
  }

  get(route, opts) { return this.request('GET', route, undefined, opts); }
  post(route, body, opts) { return this.request('POST', route, body, opts); }
  patch(route, body, opts) { return this.request('PATCH', route, body, opts); }
  delete(route, opts) { return this.request('DELETE', route, undefined, opts); }
}

/** Read-only queries on one tenant: each call runs in a READ ONLY transaction with the tenant set. */
export class TenantDb {
  constructor({ databaseUrl, tenantSlug }) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    this.tenantSlug = tenantSlug;
    this.tenantId = null;
  }

  async init() {
    const { rows } = await this.pool.query('SELECT id FROM tenants WHERE slug = $1', [this.tenantSlug]);
    if (!rows[0]) throw new Error(`tenant "${this.tenantSlug}" not found in the database`);
    this.tenantId = rows[0].id;
    return this;
  }

  async query(sql, params = []) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [this.tenantId]);
      const { rows } = await client.query(sql, params);
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }
}
