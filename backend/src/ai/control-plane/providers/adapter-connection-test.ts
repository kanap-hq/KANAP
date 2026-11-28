import { EntityManager } from 'typeorm';

/**
 * The last connection test of an external system kept on its `ai_adapter_configs` row
 * (`metadata_json.last_connection_test`), as the integration cards show it after a reload.
 * A test is kept only when it ran on the saved address and secret, and is never audited.
 */
export type StoredConnectionTest = {
  ok: boolean;
  tested_at: string;
  /** A failure: the cause as a code the card translates (`errors:<code>`), never the remote message. */
  code?: string;
  /** A success: what the system answered, as the card shows it right after the test. */
  latency_ms?: number;
  version?: string;
  sensor_count?: number;
};

export const LAST_CONNECTION_TEST_KEY = 'last_connection_test';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** The last connection test stored in the configuration, or null when it is not usable. */
export function readLastConnectionTest(metadata: Record<string, unknown> | null | undefined): StoredConnectionTest | null {
  const raw = asRecord(metadata?.[LAST_CONNECTION_TEST_KEY]);
  if (!raw || typeof raw.ok !== 'boolean') return null;
  const testedAt = typeof raw.tested_at === 'string' ? raw.tested_at.trim() : '';
  if (!testedAt || Number.isNaN(Date.parse(testedAt))) return null;
  return { ok: raw.ok, tested_at: testedAt, ...storedTestDetail(raw) };
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** A version as a system names it (`4.1.2`, `24.1.92.1554+`); anything else is not kept. */
const VERSION_PATTERN = /^[\w.+-]{1,32}$/;

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The detail of a test that may be kept and shown again: a failure's code, a success's response
 * time, version and sensor count. Free text from the remote system is never kept.
 */
export function storedTestDetail(raw: Record<string, unknown>): Omit<StoredConnectionTest, 'ok' | 'tested_at'> {
  const detail: Omit<StoredConnectionTest, 'ok' | 'tested_at'> = {};
  if (raw.ok === false && typeof raw.code === 'string' && CODE_PATTERN.test(raw.code)) detail.code = raw.code;
  if (raw.ok === true) {
    const latency = count(raw.latency_ms);
    if (latency !== undefined) detail.latency_ms = latency;
    if (typeof raw.version === 'string' && VERSION_PATTERN.test(raw.version)) detail.version = raw.version;
    const sensors = count(raw.sensor_count);
    if (sensors !== undefined) detail.sensor_count = sensors;
  }
  return detail;
}

/** The JSON a kept test is written as: its outcome, its date and its detail. */
export function storedTestJson(result: StoredConnectionTest): string {
  return JSON.stringify({ ok: result.ok, tested_at: result.tested_at, ...storedTestDetail(result as unknown as Record<string, unknown>) });
}

/**
 * Keeps the outcome of a connection test on the configuration it ran on. Writes only
 * `metadata_json.last_connection_test`: the call to the external system can take long, and a
 * save made meanwhile (address, secret, other settings) must survive. The row must still hold
 * the address and secret the test used, otherwise the outcome describes values that are gone
 * and is dropped. Returns whether the outcome was written.
 */
export async function recordAdapterConnectionTest(
  manager: EntityManager,
  config: { id: string; tenant_id: string; base_url?: string | null; credential_ref_json?: Record<string, unknown> | null },
  result: StoredConnectionTest,
): Promise<boolean> {
  const rows = await manager.query(
    `WITH changed AS (
       UPDATE ai_adapter_configs
       SET metadata_json = jsonb_set(coalesce(metadata_json, '{}'::jsonb), '{last_connection_test}', $1::jsonb)
       WHERE id = $2 AND tenant_id = $3
         AND base_url IS NOT DISTINCT FROM $4
         AND credential_ref_json IS NOT DISTINCT FROM $5::jsonb
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM changed`,
    [
      storedTestJson(result),
      config.id,
      config.tenant_id,
      config.base_url ?? null,
      config.credential_ref_json == null ? null : JSON.stringify(config.credential_ref_json),
    ],
  );
  return Number(rows?.[0]?.n ?? 0) > 0;
}

/**
 * Drops the stored test after a save that changed the address or the secret. Only this key: the
 * save may have copied the previous test into its snapshot, and removing it here leaves every
 * other metadata key as it stands now, including one written while the save was in flight.
 */
export async function clearAdapterConnectionTest(manager: EntityManager, id: string, tenantId: string): Promise<void> {
  await manager.query(
    `UPDATE ai_adapter_configs
        SET metadata_json = coalesce(metadata_json, '{}'::jsonb) - 'last_connection_test'
      WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
}
