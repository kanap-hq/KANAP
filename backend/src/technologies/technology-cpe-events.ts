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
}

/** The products of `after` that `before` did not have, in lower case. */
export function addedCpeProducts(before: unknown, after: unknown): string[] {
  const list = (value: unknown) => (Array.isArray(value) ? value : []).map((p) => String(p).toLowerCase());
  const had = new Set(list(before));
  return Array.from(new Set(list(after).filter((p) => !had.has(p))));
}
