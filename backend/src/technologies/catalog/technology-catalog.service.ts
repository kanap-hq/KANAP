import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { addedCpeProducts, TechnologyCpeEvents } from '../technology-cpe-events';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { Features } from '../../config/features';
import { languageOf } from '../../common/csv-sheet/request-options';
import { allocateItemNumbers } from '../../common/item-number.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { hostingTypeOfMode, resolveHostingType } from '../hosting-type';
import { readTechnology, technologyReference } from '../technology-rows';
import { mergeProduct, offeredState, validCatalogVersion } from './catalog-releases';
// The JSON file has its own name: under ts-node, Node resolves `./x` to `x.json` before `x.ts`.
import * as shipped from './technologies.catalog.json';
// Written for KANAP and kept apart from the catalog, which the script rebuilds from endoflife.date.
import * as shippedDescriptions from './technologies.descriptions.json';

export type CatalogVersion = {
  key: string;
  label: string;
  cpe_version: string | null;
  build_prefixes: string[];
  release_date: string | null;
  standard_support_end: string | null;
  extended_support_end: string | null;
};

export type CatalogProduct = {
  key: string;
  name: string;
  editor: string;
  family: string;
  /** Installed or subscribed: the adoption writes the hosting type it stands for (`hosting-type.ts`). */
  mode: 'installed' | 'subscribed';
  /** A code of the default hosting types, when the entry names one: it wins over `mode`. */
  hosting_type?: string;
  cpe_products: string[];
  source_url: string | null;
  versions: CatalogVersion[];
};

type Opts = { manager: EntityManager; tenantId: string; userId?: string | null };

/** A cached product read longer ago than this (a product that keeps failing) gives way to the shipped file. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The languages of the catalog descriptions. */
export type CatalogLanguage = 'en' | 'fr' | 'de' | 'es';
type Descriptions = Record<string, Partial<Record<CatalogLanguage, string>>>;

/**
 * The starting catalog of technologies KANAP ships (`technologies.catalog.json`, built from
 * endoflife.date by `scripts/technologies/build-catalog.mjs`, MIT license). It is offered, never
 * imposed: nothing is written until a tenant adopts an entry, which creates the technology, its
 * versions and its CPE identifiers. The catalog is living (lot C4): the versions endoflife.date
 * published since the shipped file was built come from the platform cache
 * `technology_catalog_products` (`effectiveProducts`), and the scheduled task `technology-catalog`
 * (`technology-catalog-sync.service.ts`) keeps the adopted technologies up to date
 * (`technologies.catalog_key`, `technologies.catalog_state`, `technology_versions.catalog_key`).
 */
@Injectable()
export class TechnologyCatalogService {
  private readonly products: CatalogProduct[] = (shipped as unknown as { products: CatalogProduct[] }).products;
  private readonly byKey = new Map(this.products.map((product) => [product.key, product]));
  private readonly descriptions = (shippedDescriptions as unknown as { descriptions: Descriptions }).descriptions;
  /** The end of the day the shipped file was read from endoflife.date (`source.retrieved_on`). */
  private readonly shippedAt = Date.parse(`${(shipped as unknown as { source?: { retrieved_on?: string } }).source?.retrieved_on ?? '1970-01-01'}T23:59:59.999Z`);

  constructor(
    private readonly audit: AuditService,
    private readonly itOps: ItOpsSettingsService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {}

  /** The hosting type an entry stands for: its own, else the one of its mode. */
  private hostingTypeOf(product: CatalogProduct): string {
    return product.hosting_type?.trim().toLowerCase() || hostingTypeOfMode(product.mode);
  }

  /** Every product of the shipped catalog. */
  all(): readonly CatalogProduct[] {
    return this.products;
  }

  /** The shipped entry `key`. */
  shippedProduct(key: string): CatalogProduct | undefined {
    return this.byKey.get(key);
  }

  /**
   * The entries of the living catalog by key: the shipped ones, with the versions and dates of the
   * platform cache (`mergeProduct`) when it holds them. `keys` limits the read to those entries.
   * The cache names no tenant: any manager reads it.
   *
   * The shipped file stays the base: a cached product counts only while the gate
   * `TECHNOLOGY_CATALOG_SYNC_ENABLED` is on, when it was read after the day the shipped file was
   * built (a newer KANAP version brings newer data), and when it was read less than
   * `CACHE_MAX_AGE_MS` before `now` (a product that keeps failing falls back to the shipped file).
   */
  async effectiveProducts(manager: EntityManager, keys?: readonly string[], opts: { now?: number } = {}): Promise<Map<string, CatalogProduct>> {
    const wanted = keys ? keys.filter((key) => this.byKey.has(key)) : this.products.map((p) => p.key);
    const since = Math.max(this.shippedAt, (opts.now ?? Date.now()) - CACHE_MAX_AGE_MS);
    const rows: Array<{ catalog_key: string; versions: CatalogVersion[] }> = wanted.length && Features.TECHNOLOGY_CATALOG_SYNC_ENABLED
      ? await manager.query(
        `SELECT catalog_key, versions FROM technology_catalog_products
          WHERE catalog_key = ANY($1::text[]) AND last_success_at > $2`,
        [wanted, new Date(since)],
      )
      : [];
    // Only versions that can be written as they stand: an adoption or a sync never fails on the cache.
    const live = new Map(rows.map((row) => [row.catalog_key, Array.isArray(row.versions) ? row.versions.filter(validCatalogVersion) : null]));
    return new Map(wanted.map((key) => [key, mergeProduct(this.byKey.get(key)!, live.get(key) ?? null)]));
  }

  /** The short description of an entry in `language`, in English when that one is missing. */
  description(key: string, language: CatalogLanguage): string | null {
    const texts = this.descriptions[key];
    return texts?.[language]?.trim() || texts?.en?.trim() || null;
  }

  /** The editors the catalog names, once each. */
  editors(): string[] {
    return Array.from(new Set(this.products.map((product) => product.editor)));
  }

  /**
   * The entries the tenant has not adopted (no technology with its catalog key or its name),
   * filtered by `q` (name, editor) and `family`, sorted by name.
   */
  async notAdopted(filters: { q?: string; family?: string; language?: unknown }, opts: Opts) {
    const language = await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, filters.language);
    const rows: Array<{ catalog_key: string | null; name: string }> = await opts.manager.query(
      `SELECT catalog_key, name FROM technologies WHERE tenant_id = $1`,
      [opts.tenantId],
    );
    const keys = new Set(rows.map((row) => row.catalog_key).filter(Boolean));
    const names = new Set(rows.map((row) => row.name.trim().toLowerCase()));
    const needle = String(filters.q ?? '').trim().toLowerCase();
    const family = String(filters.family ?? '').trim();
    const { hostingTypes } = await this.itOps.getSettings(opts.tenantId, { manager: opts.manager });
    const living = await this.effectiveProducts(opts.manager);
    const items = Array.from(living.values())
      .filter((product) => !keys.has(product.key) && !names.has(product.name.toLowerCase()))
      .filter((product) => !family || product.family === family)
      .filter((product) => !needle || product.name.toLowerCase().includes(needle) || product.editor.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      .map((product) => ({
        key: product.key,
        name: product.name,
        editor: product.editor,
        family: product.family,
        hosting_type: resolveHostingType(hostingTypes, this.hostingTypeOf(product)),
        cpe_products: product.cpe_products,
        versions: product.versions.length,
        latest_version: product.versions[0]?.label ?? null,
        description: this.description(product.key, language),
      }));
    return { items };
  }

  /**
   * Adopt the entry `key` of the living catalog: the technology with its catalog key, editor,
   * family (`other` when the tenant's catalog no longer has it), hosting type (the entry's, else the
   * one its mode stands for, resolved against the tenant's hosting types), CPE identifiers and short
   * description, and its versions with their dates; `catalog_state` records what was offered, for
   * the sync that follows (`technology-catalog-sync.service.ts`). The description is in `opts.language`, failing that the user's
   * stored language, failing that English. Idempotent: an entry already adopted returns its
   * technology and adds nothing (a version the tenant deleted stays deleted); a technology of the
   * same name (typed before) receives the key, the identifiers it lacks, the missing versions, and
   * the description when it has none. Two
   * adoptions of one entry at once run one after the other (transaction-level advisory lock).
   */
  async adopt(key: string, opts: Opts & { language?: unknown }) {
    const { manager: mg, tenantId } = opts;
    const shippedEntry = this.byKey.get(String(key || '').trim());
    if (!shippedEntry) throw new NotFoundException('Catalog entry not found');
    const product = (await this.effectiveProducts(mg, [shippedEntry.key])).get(shippedEntry.key)!;
    const description = this.description(product.key, await languageOf(mg, tenantId, opts.userId ?? null, opts.language));
    const state = JSON.stringify({ ...offeredState(product), description });
    await mg.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`technology-adopt:${tenantId}:${product.key}`]);

    const existing: Array<{ id: string; catalog_key: string | null }> = await mg.query(
      `SELECT id, catalog_key FROM technologies
        WHERE tenant_id = $1 AND (catalog_key = $2 OR lower(name) = lower($3))
        ORDER BY (catalog_key = $2) DESC NULLS LAST LIMIT 1`,
      [tenantId, product.key, product.name],
    );
    let technologyId: string;
    let created = false;
    if (existing[0]?.catalog_key === product.key) {
      // Adopted already: nothing is added, so a version the tenant deleted does not come back.
      const tech = await readTechnology(mg, tenantId, existing[0].id);
      return { ok: true, created: false, versions_added: 0, technology: { id: tech.id, name: tech.name, reference: technologyReference(tech.item_number) } };
    } else if (existing[0]) {
      technologyId = existing[0].id;
      const before = await readTechnology(mg, tenantId, technologyId, true);
      if (before.catalog_key && before.catalog_key !== product.key) {
        throw new BadRequestException('A technology of this name is already linked to another catalog entry.');
      }
      await mg.query(
        `UPDATE technologies
            SET catalog_key = $3,
                cpe_products = ARRAY(SELECT DISTINCT unnest(cpe_products || $4::text[]) ORDER BY 1),
                editor = COALESCE(editor, $5),
                description = COALESCE(NULLIF(btrim(description), ''), $6), catalog_state = $7::jsonb, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, technologyId, product.key, product.cpe_products, product.editor, description, state],
      );
      const after = await readTechnology(mg, tenantId, technologyId);
      await this.audit.log({ table: 'technologies', recordId: technologyId, action: 'update', before, after, userId: opts.userId ?? null }, { manager: mg });
      await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId, products: addedCpeProducts(before.cpe_products, after.cpe_products) });
    } else {
      const settings = await this.itOps.getSettings(tenantId, { manager: mg });
      const family = (settings.technologyFamilies ?? []).some((item) => item.code === product.family) ? product.family : 'other';
      const hostingType = resolveHostingType(settings.hostingTypes, this.hostingTypeOf(product));
      const itemNumber = await allocateItemNumbers('technology', tenantId, 1, mg);
      const [row]: Array<{ id: string }> = await mg.query(
        `INSERT INTO technologies (tenant_id, item_number, name, editor, family, hosting_type, catalog_key, cpe_products, description, catalog_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
        [tenantId, itemNumber, product.name, product.editor, family, hostingType, product.key, product.cpe_products, description, state],
      );
      technologyId = row.id;
      created = true;
      const after = await readTechnology(mg, tenantId, technologyId);
      await this.audit.log({ table: 'technologies', recordId: technologyId, action: 'create', before: null, after, userId: opts.userId ?? null }, { manager: mg });
      await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId, products: addedCpeProducts([], after.cpe_products) });
    }

    const versions = product.versions;
    const inserted: Array<{ id: string }> = versions.length
      ? await mg.query(
        `INSERT INTO technology_versions (tenant_id, technology_id, label, cpe_version, build_prefixes, standard_support_end, extended_support_end, catalog_key)
         SELECT $1, $2, v.label, v.cpe_version, ARRAY(SELECT jsonb_array_elements_text(v.build_prefixes)), v.standard_support_end::date,
                v.extended_support_end::date, $3 || ':' || v.key
           FROM jsonb_to_recordset($4::jsonb) AS v(key text, label text, cpe_version text, build_prefixes jsonb, standard_support_end text, extended_support_end text)
         ON CONFLICT (tenant_id, technology_id, lower(label)) DO NOTHING
         RETURNING id`,
        [tenantId, technologyId, product.key, JSON.stringify(versions)],
      )
      : [];
    if (inserted.length) {
      await this.audit.log({
        table: 'technology_versions', recordId: technologyId, action: 'create', before: null,
        after: { catalog_key: product.key, versions_added: inserted.length }, userId: opts.userId ?? null,
      }, { manager: mg });
    }
    const tech = await readTechnology(mg, tenantId, technologyId);
    return {
      ok: true,
      created,
      versions_added: inserted.length,
      technology: { id: tech.id, name: tech.name, reference: technologyReference(tech.item_number) },
    };
  }
}
