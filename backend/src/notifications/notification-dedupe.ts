import { DataSource } from 'typeorm';
import { withTenant } from '../common/tenant-runner';

/**
 * Event notifications (status change, comment, team, assignment) are sent at most once per
 * recipient, item and trigger within a window (5 minutes). The window used to live in each API
 * process's memory: with several processes, two quick changes of one item answered by two
 * processes both mailed. It now lives in `notification_dedupe` (tenant-scoped, RLS), one row per
 * key holding when it was last sent.
 *
 * A claim is one upsert: a key never sent, or last sent before the window, is (re)stamped and
 * returned; a key sent within the window is left alone and not returned. Two processes claiming
 * the same key at once take turns on its row, and the second finds it just stamped. The claim
 * commits in its own transaction, before any email goes out (the notifications run after the
 * request, its transaction may be gone). Rows older than a day are purged on the way.
 */
export const NOTIFICATION_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export function notificationDedupeKey(userId: string, itemType: string, itemId: string, trigger: string): string {
  return `${userId}:${itemType}:${itemId}:${trigger}`;
}

/** The keys this caller may send now (each marked as sent). */
export async function claimNotificationKeys(
  dataSource: DataSource,
  tenantId: string,
  keys: string[],
  windowMs: number = NOTIFICATION_DEDUPE_WINDOW_MS,
): Promise<Set<string>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Set();
  return withTenant(dataSource, tenantId, async (manager) => {
    const rows: Array<{ dedupe_key: string }> = await manager.query(
      `INSERT INTO notification_dedupe AS d (tenant_id, dedupe_key, sent_at)
       SELECT $1::uuid, k, clock_timestamp() FROM unnest($2::text[]) AS k
       ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET sent_at = EXCLUDED.sent_at
         WHERE d.sent_at <= EXCLUDED.sent_at - make_interval(secs => $3::double precision / 1000)
       RETURNING d.dedupe_key`,
      [tenantId, unique, windowMs],
    );
    await manager.query(
      `DELETE FROM notification_dedupe WHERE tenant_id = $1 AND sent_at < now() - interval '1 day'`,
      [tenantId],
    );
    return new Set(rows.map((row) => row.dedupe_key));
  });
}
