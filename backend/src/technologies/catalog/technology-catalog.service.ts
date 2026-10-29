import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { addedCpeProducts, TechnologyCpeEvents } from '../technology-cpe-events';
import type { EntityManager } from 'typeorm';
import { AuditService, type AuditSourceOptions } from '../../audit/audit.service';
import { Features } from '../../config/features';
import { languageOf } from '../../common/csv-sheet/request-options';
import { allocateItemNumbers } from '../../common/item-number.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { catalogCveNames, cveNameIdentity, sortCveNames, type CveName } from '../../vulnerabilities/cve-affected-rules';
import { defaultVulnerabilityAlerts } from '../../vulnerabilities/vulnerability-alerts';
import { hostingTypeOfMode, isCloudHostingType, resolveHostingType } from '../hosting-type';
import { readTechnology, technologyReference } from '../technology-rows';
import { catalogFamilyForTenant, lowerSorted, mergeProduct, offeredState, validCatalogVersion } from './catalog-releases';
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
  /** Page this version's dates were read from. Present on a product maintained by KANAP. */
  source_url?: string;
  /** Day those dates were last checked (`YYYY-MM-DD`). Present on a product maintained by KANAP. */
  checked_on?: string;
  /** The vendor states there is no planned end of support. Both end dates are then null. */
  no_planned_end?: boolean;
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
  /**
   * CVE.org names the publisher writes, copied onto an adopted technology and kept by the sync
   * the same way as `cpe_products`. Absent: the entry names none.
   */
  cve_names?: CveName[];
  /**
   * Set when the entry has no CPE identifier on purpose (the reason). An empty `cpe_products`
   * without it is not a withdrawal: the sync keeps the identifiers and logs the pass.
   */
  noCpe?: string | true;
  source_url: string | null;
  /**
   * Day the vendor last updated the lifecycle page. Present on a product maintained by KANAP,
   * null when the page states none. Absent on an endoflife.date entry.
   */
  source_updated?: string | null;
  /**
   * Page where the distributor tracks vulnerabilities of an operating system. Copied into the
   * shipped file. Absent for Windows Server, CentOS, AIX, IBM i and Solaris.
   */
  security_tracker?: string;
  versions: CatalogVersion[];
};

type Opts = {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  /** The audit row's source: the screen leaves it out (`user`), Plaid names its preview. */
  audit?: AuditSourceOptions;
};

/**
 * What an assistant adoption announced, checked again under the advisory lock before anything is
 * written: a new record, or the hand-typed record the card said the adoption completes.
 */
export type AdoptExpectation =
  | { mode: 'create' }
  | { mode: 'complete'; technologyId: string };

/** A cached product read longer ago than this (a product that keeps failing) gives way to the shipped file. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The languages of the catalog descriptions. */
export type CatalogLanguage = 'en' | 'fr' | 'de' | 'es';
type Descriptions = Record<string, Partial<Record<CatalogLanguage, string>>>;

/**
 * The starting catalog of technologies KANAP ships (`technologies.catalog.json`, built by
 * `scripts/technologies/build-catalog.mjs` from endoflife.date and from the KANAP-maintained files
 * in `curated/`, MIT license for the endoflife.date part). It is offered, never
 * imposed: nothing is written until a tenant adopts an entry, which creates the technology, its
 * versions and its CPE identifiers. The catalog is living (lot C4): the versions endoflife.date
 * published since the shipped file was built come from the platform cache
 * `technology_catalog_products` (`effectiveProducts`), and the scheduled task `technology-catalog`
 * (`technology-catalog-sync.service.ts`) keeps the adopted technologies up to date
 * (`technologies.catalog_key`, `technologies.catalog_state`, `technology_versions.catalog_key`).
 */
const SHIPPED_PRODUCTS = (shipped as unknown as { products: CatalogProduct[] }).products;

/**
 * `product:version` keys whose shipped version says the vendor plans no end and stores both
 * dates empty. The end-of-support report leaves those versions out of the missing-date gaps.
 */
export function shippedKeysWithoutPlannedEnd(): readonly string[] {
  const keys: string[] = [];
  for (const product of SHIPPED_PRODUCTS) {
    for (const version of product.versions) {
      if (version.no_planned_end === true && version.standard_support_end == null && version.extended_support_end == null) {
        keys.push(`${product.key}:${version.key}`);
      }
    }
  }
  return keys;
}

@Injectable()
export class TechnologyCatalogService {
  private readonly products: CatalogProduct[] = SHIPPED_PRODUCTS;
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

  /** The short description written in `language` only, null when that language has none. */
  textIn(key: string, language: CatalogLanguage): string | null {
    return this.descriptions[key]?.[language]?.trim() || null;
  }

  /** The editors the catalog names, once each. */
  editors(): string[] {
    return Array.from(new Set(this.products.map((product) => product.editor)));
  }

  /**
   * The entries the tenant has not adopted (`items`): no technology with its catalog key, nor a
   * technology of its name already tied to the catalog. A technology typed by hand under the entry's
   * name keeps the entry on offer: adopting it completes that technology (`adopt`). Each item carries
   * `completes`, the reference (`TEC-<item_number>`) of that hand-typed technology, compared without
   * case, or null. Filtered by `q` (name, editor) and `family`, sorted by name. `family` is the family
   * an adoption would write (`catalogFamilyForTenant`), so a catalog family the tenant does not list
   * is offered under the code the tenant would actually receive.
   *
   * `adopted` is the same search over the entries the tenant already holds by catalog key
   * (`{ key, name, editor, family, family_label, reference, id }`, sorted by name). `reference` and
   * `id` are that technology. It is empty when `q` is blank, so an empty search does not list every
   * technology the tenant already has. `items` stays the entries still on offer.
   */
  async notAdopted(filters: { q?: string; family?: string; language?: unknown }, opts: Opts) {
    const language = await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, filters.language);
    const rows: Array<{ id: string; catalog_key: string | null; name: string; item_number: number | null; description: string | null }> = await opts.manager.query(
      `SELECT id, catalog_key, name, item_number, description FROM technologies WHERE tenant_id = $1`,
      [opts.tenantId],
    );
    const versionRows: Array<{ technology_id: string; label: string }> = await opts.manager.query(
      `SELECT technology_id, label FROM technology_versions WHERE tenant_id = $1`,
      [opts.tenantId],
    );
    const labelsByTechnology = new Map<string, string[]>();
    for (const row of versionRows) {
      const labels = labelsByTechnology.get(row.technology_id) ?? [];
      labels.push(row.label);
      labelsByTechnology.set(row.technology_id, labels);
    }
    const keys = new Set(rows.map((row) => row.catalog_key).filter(Boolean));
    const names = new Set(rows.filter((row) => row.catalog_key).map((row) => row.name.trim().toLowerCase()));
    const adoptedByKey = new Map<string, { id: string; reference: string }>();
    for (const row of rows) {
      if (!row.catalog_key) continue;
      const reference = technologyReference(row.item_number);
      if (!reference) continue;
      adoptedByKey.set(row.catalog_key, { id: row.id, reference });
    }
    const completesByName = new Map<string, { ref: string; id: string; labels: Set<string>; description: string | null }>();
    for (const row of rows) {
      if (row.catalog_key) continue;
      completesByName.set(row.name.trim().toLowerCase(), {
        ref: technologyReference(row.item_number)!,
        id: row.id,
        labels: new Set((labelsByTechnology.get(row.id) ?? []).map((label) => label.trim().toLowerCase())),
        description: row.description,
      });
    }
    const needle = String(filters.q ?? '').trim().toLowerCase();
    const family = String(filters.family ?? '').trim();
    const { hostingTypes, technologyFamilies } = await this.itOps.getSettings(opts.tenantId, { manager: opts.manager });
    const living = await this.effectiveProducts(opts.manager);
    const items = Array.from(living.values())
      .filter((product) => !keys.has(product.key) && !names.has(product.name.toLowerCase()))
      .map((product) => ({ product, family: catalogFamilyForTenant(product.family, technologyFamilies) }))
      .filter((row) => !family || row.family === family)
      .filter((row) => !needle || row.product.name.toLowerCase().includes(needle) || row.product.editor.toLowerCase().includes(needle))
      .sort((a, b) => a.product.name.localeCompare(b.product.name, 'en', { sensitivity: 'base' }))
      .map(({ product, family: resolved }) => {
        const completes = completesByName.get(product.name.trim().toLowerCase()) ?? null;
        // What adopting under an existing hand-typed record adds: the missing catalog versions and,
        // when the record has none, the description. The card lists them beside the key.
        const missingVersions = completes
          ? product.versions.filter((version) => !completes.labels.has(version.label.trim().toLowerCase())).map((version) => version.label)
          : [];
        return {
          key: product.key,
          name: product.name,
          editor: product.editor,
          family: resolved,
          family_label: technologyFamilies.find((option) => option.code === resolved)?.label ?? resolved,
          hosting_type: resolveHostingType(hostingTypes, this.hostingTypeOf(product)),
          cpe_products: product.cpe_products,
          versions: product.versions.length,
          latest_version: product.versions[0]?.label ?? null,
          // The end-of-support range of the versions an adoption would write: the assistant's card.
          ...this.supportRange(product.versions),
          description: this.description(product.key, language),
          completes: completes?.ref ?? null,
          completes_id: completes?.id ?? null,
          completes_missing_versions: missingVersions,
          completes_description_empty: !!completes && !String(completes.description ?? '').trim(),
        };
      });
    const adopted = needle
      ? Array.from(living.values()).flatMap((product) => {
        const tech = adoptedByKey.get(product.key);
        if (!tech) return [];
        const resolved = catalogFamilyForTenant(product.family, technologyFamilies);
        if (family && resolved !== family) return [];
        if (!product.name.toLowerCase().includes(needle) && !product.editor.toLowerCase().includes(needle)) return [];
        return [{
          key: product.key,
          name: product.name,
          editor: product.editor,
          family: resolved,
          family_label: technologyFamilies.find((option) => option.code === resolved)?.label ?? resolved,
          reference: tech.reference,
          id: tech.id,
        }];
      }).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      : [];
    return { items, adopted };
  }

  /** The earliest and latest end of support among `versions` (extended when it is later). */
  private supportRange(versions: CatalogVersion[]): { support_from: string | null; support_to: string | null } {
    const dates = versions
      .map((version) => version.extended_support_end ?? version.standard_support_end)
      .filter((date): date is string => !!date)
      .sort();
    return { support_from: dates[0] ?? null, support_to: dates[dates.length - 1] ?? null };
  }

  /**
   * Adopt the entry `key` of the living catalog: the technology with its catalog key, editor,
   * family (`other` when the tenant's catalog no longer has it), hosting type (the entry's, else the
   * one its mode stands for, resolved against the tenant's hosting types), CPE identifiers, CVE.org
   * names and short description, and its versions with their dates; `catalog_state` records what was
   * offered, for the sync that follows (`technology-catalog-sync.service.ts`), including `shipped_cpe`,
   * the identifiers this adoption actually added (`cpe_written`), `shipped_cve_names`, the names this
   * adoption actually added (`cve_names_written`), and `description_language` (the
   * language of the description this adoption writes). The description is in `opts.language`, failing that the user's
   * stored language, failing that English. Idempotent: an entry already adopted returns its
   * technology and adds nothing (a version the tenant deleted stays deleted); a technology of the
   * same name (typed before) receives the key, the identifiers it lacks, the CVE.org names it lacks
   * (a name already held, by normalized vendor, product and version, stays, including its text),
   * the missing versions, and the description when it has none. A new technology takes the default alert setting
   * (`defaultVulnerabilityAlerts`: an operating system or a cloud service, an entry of mode
   * `subscribed` or a hosting type of the cloud category, starts excluded); a technology of the
   * same name that receives the key of an operating system is excluded from vulnerability alerts,
   * as if it had been created from the entry (its version exceptions stay). Its hosting type does
   * not change, so its setting does not follow a `subscribed` entry. Two
   * adoptions of one entry at once run one after the other (transaction-level advisory lock).
   */
  async adopt(key: string, opts: Opts & { language?: unknown; expect?: AdoptExpectation }) {
    const { manager: mg, tenantId } = opts;
    const shippedEntry = this.byKey.get(String(key || '').trim());
    if (!shippedEntry) throw new NotFoundException('Catalog entry not found');
    const product = (await this.effectiveProducts(mg, [shippedEntry.key])).get(shippedEntry.key)!;
    const descriptionLanguage = await languageOf(mg, tenantId, opts.userId ?? null, opts.language);
    const description = this.description(product.key, descriptionLanguage);
    // `shipped_cpe` is the file, not the cache. `cpe_written` is only what this adoption adds:
    // an identifier the technology already holds stays the tenant's and is never withdrawn.
    // CVE.org names follow the same split: `shipped_cve_names` is the file, `cve_names_written`
    // is only a name this adoption adds. `description_language` is the language of the text this adoption writes.
    const catalogNames = catalogCveNames(product.cve_names ?? null);
    const stateFor = (heldBefore: readonly string[], heldNames: readonly CveName[]) => {
      const held = new Set(heldBefore.map((id) => id.toLowerCase()));
      const heldNameIds = new Set(heldNames.map((name) => cveNameIdentity(name)));
      return JSON.stringify({
        ...offeredState(product),
        shipped_cpe: lowerSorted(shippedEntry.cpe_products),
        cpe_written: lowerSorted(product.cpe_products.filter((id) => !held.has(id.toLowerCase()))),
        shipped_cve_names: catalogCveNames(shippedEntry.cve_names ?? null),
        cve_names_written: catalogNames.filter((name) => !heldNameIds.has(cveNameIdentity(name))),
        description,
        description_language: descriptionLanguage,
      });
    };
    const mergedNames = (held: unknown) => {
      const current = catalogCveNames(Array.isArray(held) ? held : []);
      const have = new Set(current.map((name) => cveNameIdentity(name)));
      return sortCveNames([...current, ...catalogNames.filter((name) => !have.has(cveNameIdentity(name)))]);
    };
    await mg.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`technology-adopt:${tenantId}:${product.key}`]);

    const existing: Array<{ id: string; catalog_key: string | null }> = await mg.query(
      `SELECT id, catalog_key FROM technologies
        WHERE tenant_id = $1 AND (catalog_key = $2 OR lower(name) = lower($3))
        ORDER BY (catalog_key = $2) DESC NULLS LAST LIMIT 1`,
      [tenantId, product.key, product.name],
    );
    // The card announced a new record: a record of this name or this catalog key means the screen
    // adopted or typed it between the preview and the approval. Nothing is written.
    if (opts.expect?.mode === 'create' && existing[0]) {
      throw new ConflictException(`A technology of this name appeared after the preview was created: TEC-${(
        await mg.query(`SELECT item_number FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, existing[0].id])
      )[0]?.item_number ?? '?'}.`);
    }
    // The card announced the hand-typed record it completes: the row is still there, still without a
    // catalog key, still under the same name, and it is the one the card named.
    if (opts.expect?.mode === 'complete') {
      const target: Array<{ id: string; catalog_key: string | null; name: string }> = await mg.query(
        `SELECT id, catalog_key, name FROM technologies WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
        [tenantId, opts.expect.technologyId],
      );
      const row = target[0];
      if (!row
        || row.catalog_key != null
        || row.name.trim().toLowerCase() !== product.name.trim().toLowerCase()
        || existing[0]?.id !== row.id) {
        throw new ConflictException(`Technology "${product.name}" changed after the preview was created.`);
      }
    }
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
      const heldNames = catalogCveNames(Array.isArray(before.cve_names) ? before.cve_names : []);
      await mg.query(
        `UPDATE technologies
            SET catalog_key = $3,
                cpe_products = ARRAY(SELECT DISTINCT unnest(cpe_products || $4::text[]) ORDER BY 1),
                cve_names = $5::jsonb,
                editor = COALESCE(editor, $6),
                description = COALESCE(NULLIF(btrim(description), ''), $7), catalog_state = $8::jsonb,
                vulnerability_alerts = vulnerability_alerts AND $9::boolean, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, technologyId, product.key, product.cpe_products, JSON.stringify(mergedNames(before.cve_names)), product.editor, description, stateFor(before.cpe_products, heldNames),
          defaultVulnerabilityAlerts({ catalogKey: product.key })],
      );
      const after = await readTechnology(mg, tenantId, technologyId);
      await this.audit.log({ table: 'technologies', recordId: technologyId, action: 'update', before, after, userId: opts.userId ?? null, ...opts.audit }, { manager: mg });
      await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId, products: addedCpeProducts(before.cpe_products, after.cpe_products) });
    } else {
      const settings = await this.itOps.getSettings(tenantId, { manager: mg });
      const family = catalogFamilyForTenant(product.family, settings.technologyFamilies);
      const hostingType = resolveHostingType(settings.hostingTypes, this.hostingTypeOf(product));
      const itemNumber = await allocateItemNumbers('technology', tenantId, 1, mg);
      const [row]: Array<{ id: string }> = await mg.query(
        `INSERT INTO technologies (tenant_id, item_number, name, editor, family, hosting_type, catalog_key, cpe_products, cve_names, description, catalog_state, vulnerability_alerts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12) RETURNING id`,
        [tenantId, itemNumber, product.name, product.editor, family, hostingType, product.key, product.cpe_products, JSON.stringify(mergedNames([])), description, stateFor([], []),
          defaultVulnerabilityAlerts({
            family,
            catalogKey: product.key,
            cloudService: product.mode === 'subscribed' || isCloudHostingType(settings.hostingTypes, hostingType),
          })],
      );
      technologyId = row.id;
      created = true;
      const after = await readTechnology(mg, tenantId, technologyId);
      await this.audit.log({ table: 'technologies', recordId: technologyId, action: 'create', before: null, after, userId: opts.userId ?? null, ...opts.audit }, { manager: mg });
      await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId, products: addedCpeProducts([], after.cpe_products) });
    }

    // The service created the record the card announced, or completed the one it named; anything
    // else would write where the card did not look.
    if (opts.expect?.mode === 'create' && !created) {
      throw new ConflictException(`Technology "${product.name}" changed after the preview was created.`);
    }
    if (opts.expect?.mode === 'complete' && technologyId !== opts.expect.technologyId) {
      throw new ConflictException(`Technology "${product.name}" changed after the preview was created.`);
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
        after: { catalog_key: product.key, versions_added: inserted.length }, userId: opts.userId ?? null, ...opts.audit,
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
