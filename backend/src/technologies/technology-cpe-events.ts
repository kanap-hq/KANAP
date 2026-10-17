import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** CPE products a technology has just received (lot T6b), in the caller's transaction. */
export type CpeProductsAdded = { manager: EntityManager; tenantId: string; technologyId: string; products: string[] };

/**
 * The bridge from the technologies to the vulnerability feed, which imports this module (so the
 * technologies cannot import it back): the feed subscribes at start, the technologies emit when a
 * technology receives CPE products (creation, edition, adoption from the catalog). A listener runs
 * in the caller's transaction and is awaited.
 */
@Injectable()
export class TechnologyCpeEvents {
  private readonly listeners: Array<(event: CpeProductsAdded) => Promise<void>> = [];

  subscribe(listener: (event: CpeProductsAdded) => Promise<void>) {
    this.listeners.push(listener);
  }

  async emit(event: CpeProductsAdded) {
    if (event.products.length === 0) return;
    for (const listener of this.listeners) await listener(event);
  }
}

/** The products of `after` that `before` did not have, in lower case. */
export function addedCpeProducts(before: unknown, after: unknown): string[] {
  const list = (value: unknown) => (Array.isArray(value) ? value : []).map((p) => String(p).toLowerCase());
  const had = new Set(list(before));
  return Array.from(new Set(list(after).filter((p) => !had.has(p))));
}
