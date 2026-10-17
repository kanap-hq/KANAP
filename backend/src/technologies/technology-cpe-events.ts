import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * A technology changed in a way that matters to its vulnerabilities (lot T6b), in the caller's
 * transaction: CPE products received (`products`), a version created, renamed or deleted, a link to
 * a server or an application added, removed or moved to another version (`products` empty).
 */
export type CpeProductsAdded = { manager: EntityManager; tenantId: string; technologyId: string; products: string[] };

/**
 * The bridge from the technologies to the vulnerability feed, which imports this module (so the
 * technologies cannot import it back): the feed subscribes at start, the technologies emit when a
 * technology receives CPE products (creation, edition, adoption from the catalog), when its
 * versions change and when its links change. A listener is awaited in the caller's transaction; the
 * feed only queues the work there, done once the transaction has committed.
 */
@Injectable()
export class TechnologyCpeEvents {
  private readonly listeners: Array<(event: CpeProductsAdded) => Promise<void>> = [];

  subscribe(listener: (event: CpeProductsAdded) => Promise<void>) {
    this.listeners.push(listener);
  }

  async emit(event: CpeProductsAdded) {
    for (const listener of this.listeners) await listener(event);
  }

  /**
   * For every technology linked to these servers or applications: before they are deleted (the
   * links go with them), or after a change of their status (a server retired or back in service, an
   * application entering or leaving service). The links are read in the caller's transaction.
   */
  async emitForSubjects(mg: EntityManager, tenantId: string, side: 'asset' | 'application', ids: string[]) {
    if (ids.length === 0 || this.listeners.length === 0) return;
    const table = side === 'asset' ? 'asset_technologies' : 'application_technologies';
    const rows: Array<{ technology_id: string }> = await mg.query(
      `SELECT DISTINCT technology_id FROM ${table} WHERE tenant_id = $1 AND ${side}_id = ANY($2::uuid[]) ORDER BY technology_id`,
      [tenantId, ids],
    );
    for (const row of rows) await this.emit({ manager: mg, tenantId, technologyId: row.technology_id, products: [] });
  }
}

/** The products of `after` that `before` did not have, in lower case. */
export function addedCpeProducts(before: unknown, after: unknown): string[] {
  const list = (value: unknown) => (Array.isArray(value) ? value : []).map((p) => String(p).toLowerCase());
  const had = new Set(list(before));
  return Array.from(new Set(list(after).filter((p) => !had.has(p))));
}

const MATCH_TENANT_LOCK = 0x564d5431; // 'VMT1'
const MATCH_TECHNOLOGY_LOCK = 0x564d5432; // 'VMT2'

/**
 * Serialises the matchings of a technology with the vulnerabilities (lot T6b), for the rest of the
 * transaction: a tenant-wide advisory lock, shared by the matching of one technology and by the
 * deletion of a version, exclusive for the matching of the whole tenant; then the technology's own
 * lock. Always taken in this order, before any row: two matchings of one technology never overlap
 * (an older one cannot delete a row a newer one wrote), and a version is never deleted while a
 * matching writes rows that name it.
 */
export async function lockTechnologyMatching(mg: EntityManager, tenantId: string, technologyId?: string | null): Promise<void> {
  if (!technologyId) {
    await mg.query(`SELECT pg_advisory_xact_lock($1::int, hashtext($2))`, [MATCH_TENANT_LOCK, tenantId]);
    return;
  }
  await mg.query(`SELECT pg_advisory_xact_lock_shared($1::int, hashtext($2))`, [MATCH_TENANT_LOCK, tenantId]);
  await mg.query(`SELECT pg_advisory_xact_lock($1::int, hashtext($2))`, [MATCH_TECHNOLOGY_LOCK, technologyId]);
}
