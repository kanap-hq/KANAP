import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { addedCpeProducts, TechnologyCpeEvents } from '../technology-cpe-events';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { allocateItemNumbers } from '../../common/item-number.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { readTechnology, technologyReference } from '../technology-rows';
// The JSON file has its own name: under ts-node, Node resolves `./x` to `x.json` before `x.ts`.
import * as shipped from './technologies.catalog.json';

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
  mode: 'installed' | 'subscribed';
  cpe_products: string[];
  source_url: string | null;
  versions: CatalogVersion[];
};

type Opts = { manager: EntityManager; tenantId: string; userId?: string | null };

/**
 * The starting catalog of technologies KANAP ships (`technologies.catalog.json`, built from
 * endoflife.date by `scripts/technologies/build-catalog.mjs`, MIT license). It is offered, never
 * imposed: nothing is written until a tenant adopts an entry, which creates the technology, its
 * versions and its CPE identifiers. A later KANAP version can offer new dates to adopted rows
 * (`technologies.catalog_key`, `technology_versions.catalog_key`).
 */
@Injectable()
export class TechnologyCatalogService {
  private readonly products: CatalogProduct[] = (shipped as unknown as { products: CatalogProduct[] }).products;
  private readonly byKey = new Map(this.products.map((product) => [product.key, product]));

  constructor(
    private readonly audit: AuditService,
    private readonly itOps: ItOpsSettingsService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {}

  /** Every product of the catalog. */
  all(): readonly CatalogProduct[] {
    return this.products;
  }

  /** The editors the catalog names, once each. */
  editors(): string[] {
    return Array.from(new Set(this.products.map((product) => product.editor)));
  }

  /**
   * The entries the tenant has not adopted (no technology with its catalog key or its name),
   * filtered by `q` (name, editor) and `family`, sorted by name.
   */
  async notAdopted(filters: { q?: string; family?: string }, opts: Opts) {
    const rows: Array<{ catalog_key: string | null; name: string }> = await opts.manager.query(
      `SELECT catalog_key, name FROM technologies WHERE tenant_id = $1`,
      [opts.tenantId],
    );
    const keys = new Set(rows.map((row) => row.catalog_key).filter(Boolean));
    const names = new Set(rows.map((row) => row.name.trim().toLowerCase()));
    const needle = String(filters.q ?? '').trim().toLowerCase();
    const family = String(filters.family ?? '').trim();
    const items = this.products
      .filter((product) => !keys.has(product.key) && !names.has(product.name.toLowerCase()))
      .filter((product) => !family || product.family === family)
      .filter((product) => !needle || product.name.toLowerCase().includes(needle) || product.editor.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      .map((product) => ({
        key: product.key,
        name: product.name,
        editor: product.editor,
        family: product.family,
        mode: product.mode,
        cpe_products: product.cpe_products,
        versions: product.versions.length,
        latest_version: product.versions[0]?.label ?? null,
      }));
    return { items };
  }

  /**
   * Adopt the entry `key`: the technology with its catalog key, editor, family (`other` when the
   * tenant's catalog no longer has it), mode and CPE identifiers, and its versions with their dates.
   * Idempotent: an entry already adopted returns its technology and adds nothing (a version the
   * tenant deleted stays deleted); a technology of the same name (typed before) receives the key,
   * the identifiers it lacks and the missing versions. Two
   * adoptions of one entry at once run one after the other (transaction-level advisory lock).
   */
  async adopt(key: string, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const product = this.byKey.get(String(key || '').trim());
    if (!product) throw new NotFoundException('Catalog entry not found');
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
                editor = COALESCE(editor, $5), updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, technologyId, product.key, product.cpe_products, product.editor],
      );
      const after = await readTechnology(mg, tenantId, technologyId);
      await this.audit.log({ table: 'technologies', recordId: technologyId, action: 'update', before, after, userId: opts.userId ?? null }, { manager: mg });
      await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId, products: addedCpeProducts(before.cpe_products, after.cpe_products) });
    } else {
      const settings = await this.itOps.getSettings(tenantId, { manager: mg });
      const family = (settings.technologyFamilies ?? []).some((item) => item.code === product.family) ? product.family : 'other';
      const itemNumber = await allocateItemNumbers('technology', tenantId, 1, mg);
      const [row]: Array<{ id: string }> = await mg.query(
        `INSERT INTO technologies (tenant_id, item_number, name, editor, family, mode, catalog_key, cpe_products)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [tenantId, itemNumber, product.name, product.editor, family, product.mode, product.key, product.cpe_products],
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
