import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Shared by the data-access specs: a raw `pg` connection and a small seeded tenant. */

export const LIMITED_ROLE = 'kanap_data_limited';
export const APP_URL = process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/appdb';

// `pg` ships no type declarations (and `@types/pg` is not a dependency): typed here instead.
export type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
};

const { Client: PgClientConstructor } = require('pg') as {
  Client: new (config: { connectionString: string }) => PgClient;
};

export async function connect(url: string): Promise<PgClient> {
  const client = new PgClientConstructor({ connectionString: url });
  await client.connect();
  return client;
}

export function appRoleName(): string {
  return decodeURIComponent(new URL(APP_URL).username || 'app');
}

/**
 * The admin connection of the exclusive specs, on the database the specs use (the lane copy in
 * CI): the credentials of DATA_ACCESS_ADMIN_DATABASE_URL, the database of DATABASE_URL. Null when
 * the variable is not set (the specs that need it then skip).
 */
export function adminUrlForAppDatabase(): string | null {
  const admin = process.env.DATA_ACCESS_ADMIN_DATABASE_URL;
  if (!admin) return null;
  const url = new URL(admin);
  url.pathname = new URL(APP_URL).pathname;
  return url.toString();
}

export async function roleExists(client: PgClient): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regrole($1) IS NOT NULL AS present`, [LIMITED_ROLE]);
  return rows[0].present === true;
}

/** The SQLSTATE of the error `fn` throws; fails when it does not throw. */
export async function sqlState(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error: any) {
    return String(error?.code ?? '');
  }
  assert.fail('expected an error');
}

/** As sqlState, inside the caller's transaction: under a savepoint, so the transaction goes on. */
export async function sqlStateIn(client: PgClient, fn: () => Promise<unknown>): Promise<string> {
  await client.query('SAVEPOINT data_access_spec_expect');
  const state = await sqlState(fn);
  await client.query('ROLLBACK TO SAVEPOINT data_access_spec_expect');
  return state;
}

export type Tree = {
  tenantId: string;
  companies: { c1: string; c2: string; c3: string };
  nodes: { g1: string; g1a: string; g2: string; k1: string; k2: string; k3: string; k4: string; k5: string };
};

/**
 * Inside the caller's transaction: a tenant (app.current_tenant set to it), three companies and
 * the tree
 *   G1 (group)
 *     G1a (group)
 *       K3 (centre, C2)
 *     K1 (centre, C1)
 *     K2 (centre, C2, disabled)
 *   G2 (group)
 *     K4 (centre, C1)
 *   K5 (centre, C3, no parent)
 */
export async function seedTree(client: PgClient): Promise<Tree> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await client.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `da-spec-${tag}`, `Data access spec ${tag}`],
  );
  await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const company = async (name: string) => {
    const { rows } = await client.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled') RETURNING id`,
      [tenantId, `${name} ${tag}`],
    );
    return rows[0].id as string;
  };
  const c1 = await company('C1');
  const c2 = await company('C2');
  const c3 = await company('C3');

  const node = async (code: string, kind: 'group' | 'cost_center', parent: string | null, companyId: string | null, status = 'enabled') => {
    const { rows } = await client.query(
      `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status)
       VALUES ($1, $2, $3, $2, $4, $5, $6::status_state) RETURNING id`,
      [tenantId, code, kind, parent, companyId, status],
    );
    return rows[0].id as string;
  };
  const g1 = await node('G1', 'group', null, null);
  const g1a = await node('G1A', 'group', g1, null);
  const k3 = await node('K3', 'cost_center', g1a, c2);
  const k1 = await node('K1', 'cost_center', g1, c1);
  const k2 = await node('K2', 'cost_center', g1, c2, 'disabled');
  const g2 = await node('G2', 'group', null, null);
  const k4 = await node('K4', 'cost_center', g2, c1);
  const k5 = await node('K5', 'cost_center', null, c3);

  return { tenantId, companies: { c1, c2, c3 }, nodes: { g1, g1a, g2, k1, k2, k3, k4, k5 } };
}

/** A role of the tenant; returns its id. */
export async function seedRole(client: PgClient, tenantId: string, name: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in)
     VALUES ($1, $2, 'data access spec', false, false) RETURNING id`,
    [tenantId, name],
  );
  return rows[0].id as string;
}

/** A person of the tenant with this mode and primary role; returns its id. */
export async function seedPerson(
  client: PgClient,
  tenantId: string,
  mode: 'all' | 'limited',
  roleId: string,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO users (id, tenant_id, email, role_id, status, data_access_mode)
     VALUES ($1, $2, $3, $4, 'enabled', $5)`,
    [id, tenantId, `da-${id.slice(0, 8)}@example.invalid`, roleId, mode],
  );
  return id;
}

export type NodeSpec =
  | { type: 'all'; access: 'read' | 'edit' }
  | { type: 'company'; id: string; access: 'read' | 'edit' }
  | { type: 'cost_center'; id: string; access: 'read' | 'edit' };

export async function seedNodes(client: PgClient, tenantId: string, userId: string, nodes: NodeSpec[]): Promise<void> {
  for (const node of nodes) {
    await client.query(
      `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, cost_center_id, access)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        userId,
        node.type,
        node.type === 'company' ? node.id : null,
        node.type === 'cost_center' ? node.id : null,
        node.access,
      ],
    );
  }
}

const SETTINGS = [
  'app.da_mode',
  'app.da_user',
  'app.da_read_all',
  'app.da_edit_all',
  'app.da_read_companies',
  'app.da_edit_companies',
  'app.da_read_nodes',
  'app.da_edit_nodes',
  'app.da_edit_node_companies',
] as const;

/** The nine settings as read in the transaction ('' or null when not set). */
export async function readSettings(client: PgClient): Promise<Record<string, string | null>> {
  const { rows } = await client.query(
    `SELECT ${SETTINGS.map((name, i) => `current_setting('${name}', true) AS s${i}`).join(', ')}`,
  );
  const out: Record<string, string | null> = {};
  SETTINGS.forEach((name, i) => { out[name] = rows[0][`s${i}`]; });
  return out;
}

/** A PostgreSQL array literal of uuids, as a sorted list. */
export function parseUuidArray(literal: string | null): string[] {
  assert.ok(literal !== null && /^\{.*\}$/.test(literal), `array literal expected, got ${literal}`);
  const inner = literal.slice(1, -1);
  return inner ? inner.split(',').sort() : [];
}

export function sorted(values: string[]): string[] {
  return [...values].sort();
}
