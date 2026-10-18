import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { allocateItemNumbers } from '../common/item-number.service';
import { linkProvenance, provenanceParams, type LinkSource } from '../common/link-provenance';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { resolveHostingType } from './hosting-type';
import { TechnologyCatalogService, type CatalogProduct, type CatalogVersion } from './catalog/technology-catalog.service';
import { TechnologyCpeEvents } from './technology-cpe-events';
import {
  operatingSystemLabel,
  shippedOperatingSystemCode,
  splitOperatingSystemLabel,
  type OperatingSystemCode,
} from './operating-system-codes';
import { readTechnology, resolveVersionLabel, UUID_RE } from './technology-rows';

/**
 * The operating system of a server is one technology link marked `is_operating_system`
 * (lot T3). One mark per server: the partial unique index `uq_asset_technologies_one_os`.
 * The family `operating_system` only decides which technologies the screen offers first and
 * how the end-of-support report types the row. ESXi can be the operating system of a host.
 *
 * `resolve` turns a label, or one of the 19 old shipped codes, into a technology and an
 * optional version. `setOperatingSystem` writes the mark. Both are the only writers the
 * CSV, the assistant, Netbox, the API and the screen use.
 */

export type ResolvedOperatingSystem = {
  technology_id: string;
  technology_version_id: string | null;
};

export type ResolveOptions = {
  /**
   * Gates step 6 only (a technology that is not in the tenant and not in the shipped catalog).
   * A missing version of a technology already matched is created either way. A shipped code
   * adopts its product either way.
   */
  create: boolean;
  /** Recorded on the link by `setOperatingSystem`, not on the technology. */
  source?: LinkSource;
};

type Dates = { standard: string | null; extended: string | null };

const EMPTY_DATES: Dates = { standard: null, extended: null };

@Injectable()
export class OperatingSystemService {
  constructor(
    private readonly audit: AuditService,
    private readonly itOps: ItOpsSettingsService,
    private readonly catalog: TechnologyCatalogService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {}

  /**
   * The operating system of one asset: `Windows Server 2019`, `Cisco Meraki` when the link
   * has no version, null when the server has none. Prefer `labelsOf` for a list.
   */
  async labelOf(mg: EntityManager, tenantId: string, assetId: string): Promise<string | null> {
    const labels = await this.labelsOf(mg, tenantId, [assetId]);
    return labels.get(assetId) ?? null;
  }

  /**
   * The operating system of each asset, in one query. Assets with no marked link are absent
   * from the map. Never one query per asset.
   */
  async labelsOf(mg: EntityManager, tenantId: string, assetIds: readonly string[]): Promise<Map<string, string>> {
    const ids = Array.from(new Set(assetIds.filter((id) => UUID_RE.test(id))));
    if (ids.length === 0) return new Map();
    const rows: Array<{ asset_id: string; name: string; version: string | null }> = await mg.query(
      `SELECT at.asset_id, t.name, v.label AS version
         FROM asset_technologies at
         JOIN technologies t ON t.tenant_id = at.tenant_id AND t.id = at.technology_id
         LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
        WHERE at.tenant_id = $1 AND at.is_operating_system AND at.asset_id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return new Map(rows.map((row) => [row.asset_id, operatingSystemLabel(row.name, row.version)]));
  }

  /**
   * Choices a Netbox platform can be matched to. `code` and `label` are the same readable text,
   * which is what the map stores and what the resolver writes. Tenant technologies of family
   * `operating_system` come first (the name, then each version), then shipped operating-system
   * products the tenant has not adopted. A technology of another family is not offered here.
   */
  async mappingChoices(mg: EntityManager, tenantId: string): Promise<Array<{ code: string; label: string }>> {
    const choices: Array<{ code: string; label: string }> = [];
    const seen = new Set<string>();
    const push = (label: string | null | undefined) => {
      const text = String(label ?? '').trim();
      const key = text.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      choices.push({ code: text, label: text });
    };

    const rows: Array<{ name: string; version: string | null }> = await mg.query(
      `SELECT t.name, v.label AS version
         FROM technologies t
         LEFT JOIN technology_versions v ON v.tenant_id = t.tenant_id AND v.technology_id = t.id
        WHERE t.tenant_id = $1 AND t.family = 'operating_system'
        ORDER BY lower(t.name), lower(v.label) NULLS FIRST`,
      [tenantId],
    );
    let lastName: string | null = null;
    for (const row of rows) {
      if (row.name !== lastName) {
        push(row.name);
        lastName = row.name;
      }
      if (row.version?.trim()) push(operatingSystemLabel(row.name, row.version));
    }

    const adopted: Array<{ catalog_key: string }> = await mg.query(
      `SELECT catalog_key FROM technologies WHERE tenant_id = $1 AND catalog_key IS NOT NULL`,
      [tenantId],
    );
    const adoptedKeys = new Set(adopted.map((row) => row.catalog_key));
    for (const product of this.catalog.all()) {
      if (product.family !== 'operating_system' || adoptedKeys.has(product.key)) continue;
      push(product.name);
      for (const version of product.versions) push(operatingSystemLabel(product.name, version.label));
    }
    return choices;
  }

  /**
   * A label or an old shipped code, as a technology of the tenant:
   * 1. empty → null;
   * 2. a shipped code (`windows_server_2019`) → that catalog product and its version;
   * 3. a technology whose name is the whole label → it, with no version;
   * 4. the longest technology name that prefixes the label, then a space → it, and the
   *    remainder is the version (found without case, created when missing);
   * 5. the same two steps against the shipped catalog, adopting the product;
   * 6. with `create`, a new technology of family `operating_system` (or `other` when the
   *    tenant's catalog no longer has that family, the same rule as adoption). A last token
   *    that starts with a digit becomes the version.
   */
  async resolve(
    mg: EntityManager,
    tenantId: string,
    label: string | null | undefined,
    opts: ResolveOptions,
  ): Promise<ResolvedOperatingSystem | null> {
    const text = String(label ?? '').trim().replace(/\s+/g, ' ');
    if (!text) return null;

    const shipped = shippedOperatingSystemCode(text);
    if (shipped) return this.resolveShipped(mg, tenantId, shipped, opts);

    const exact: Array<{ id: string }> = await mg.query(
      `SELECT id FROM technologies WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
      [tenantId, text],
    );
    if (exact[0]) return { technology_id: exact[0].id, technology_version_id: null };

    const prefixed = await this.prefixTechnology(mg, tenantId, text);
    if (prefixed) {
      const versionId = await this.ensureVersion(mg, tenantId, prefixed.id, prefixed.remainder, true, EMPTY_DATES);
      return { technology_id: prefixed.id, technology_version_id: versionId };
    }

    const fromCatalog = this.prefixProduct(text);
    if (fromCatalog) {
      const technologyId = await this.adopt(mg, tenantId, fromCatalog.product.key);
      if (!fromCatalog.remainder) return { technology_id: technologyId, technology_version_id: null };
      const versionId = await this.ensureVersion(mg, tenantId, technologyId, fromCatalog.remainder, true, EMPTY_DATES);
      return { technology_id: technologyId, technology_version_id: versionId };
    }

    if (!opts.create) return null;
    const split = splitOperatingSystemLabel(text);
    if (!split.name) return null;
    const technologyId = await this.createTechnology(mg, tenantId, split.name);
    const versionId = split.version
      ? await this.ensureVersion(mg, tenantId, technologyId, split.version, true, EMPTY_DATES)
      : null;
    return { technology_id: technologyId, technology_version_id: versionId };
  }

  /**
   * Mark `resolved` as the asset's operating system, or clear it when `resolved` is null.
   * The asset row is locked first (`SELECT … FOR UPDATE`), so two writes on one server run
   * one after the other and the partial unique index never sees two marks.
   *
   * The previous mark: we cannot tell a link created only to hold the operating system from
   * a link that also means "this technology is installed". When the new operating system is
   * another technology, or when the operating system is cleared, the marked link is deleted.
   * When it is the same technology, the link stays and only loses the mark, and the rule
   * below picks it up again.
   *
   * Reuse: a link of the same technology whose version is the one asked (null included) is
   * marked. Otherwise a link of that technology with no version takes the version asked,
   * then the mark. Otherwise a new link is created and marked. A link that already names
   * another version is left as it is.
   */
  async setOperatingSystem(
    mg: EntityManager,
    tenantId: string,
    assetId: string,
    resolved: ResolvedOperatingSystem | null,
    source: LinkSource,
    userId?: string | null,
  ): Promise<{ ok: true; link_id: string | null; changed: boolean }> {
    const id = await this.lockAsset(mg, tenantId, assetId);
    const provenance = linkProvenance(source);
    const [marked]: Array<LinkRow> = await mg.query(
      `SELECT id, technology_id, technology_version_id, source, source_ref, notes
         FROM asset_technologies
        WHERE tenant_id = $1 AND asset_id = $2 AND is_operating_system`,
      [tenantId, id],
    );
    const versionId = resolved?.technology_version_id ?? null;

    if (!resolved) {
      if (!marked) return { ok: true, link_id: null, changed: false };
      await this.deleteLink(mg, tenantId, marked, userId);
      return { ok: true, link_id: null, changed: true };
    }

    if (
      marked
      && marked.technology_id === resolved.technology_id
      && marked.technology_version_id === versionId
      && marked.source === provenance.source
      && marked.source_ref === provenance.source_ref
    ) {
      return { ok: true, link_id: marked.id, changed: false };
    }

    if (marked && marked.technology_id !== resolved.technology_id) {
      await this.deleteLink(mg, tenantId, marked, userId);
    } else if (marked) {
      await mg.query(
        `UPDATE asset_technologies SET is_operating_system = false, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, marked.id],
      );
    }

    const [same]: Array<LinkRow> = await mg.query(
      `SELECT id, technology_id, technology_version_id, source, source_ref, notes
         FROM asset_technologies
        WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3
          AND technology_version_id IS NOT DISTINCT FROM $4`,
      [tenantId, id, resolved.technology_id, versionId],
    );
    if (same) {
      await this.markLink(mg, tenantId, same, versionId, provenance, userId);
      return { ok: true, link_id: same.id, changed: true };
    }

    if (versionId) {
      const [blank]: Array<LinkRow> = await mg.query(
        `SELECT id, technology_id, technology_version_id, source, source_ref, notes
           FROM asset_technologies
          WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3 AND technology_version_id IS NULL
          LIMIT 1`,
        [tenantId, id, resolved.technology_id],
      );
      if (blank) {
        await this.markLink(mg, tenantId, blank, versionId, provenance, userId);
        await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId: resolved.technology_id, products: [] });
        return { ok: true, link_id: blank.id, changed: true };
      }
    }

    const [inserted]: Array<{ id: string }> = await mg.query(
      `INSERT INTO asset_technologies (
         tenant_id, asset_id, technology_id, technology_version_id, is_operating_system, source, source_ref, observed_at
       ) VALUES ($1, $2, $3, $4, true, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT asset_technologies_key DO UPDATE
         SET is_operating_system = true, source = EXCLUDED.source, source_ref = EXCLUDED.source_ref,
             observed_at = EXCLUDED.observed_at, updated_at = now()
       RETURNING id`,
      [tenantId, id, resolved.technology_id, versionId, ...provenanceParams(provenance)],
    );
    await this.audit.log({
      table: 'asset_technologies', recordId: resolved.technology_id, action: 'create', before: null,
      after: { id: inserted.id, asset_id: id, technology_version_id: versionId, is_operating_system: true, source: provenance.source },
      userId: userId ?? null,
    }, { manager: mg });
    await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId: resolved.technology_id, products: [] });
    return { ok: true, link_id: inserted.id, changed: true };
  }

  /**
   * Mark the link `linkId` (already installed on the asset) as the operating system.
   * The screen posts the link, then marks it.
   */
  async markLinkById(
    mg: EntityManager,
    tenantId: string,
    linkId: string,
    source: LinkSource,
    userId?: string | null,
  ): Promise<{ ok: true; link_id: string | null; changed: boolean }> {
    const id = String(linkId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new NotFoundException('Link not found');
    const [row]: Array<{ asset_id: string; technology_id: string; technology_version_id: string | null }> = await mg.query(
      `SELECT asset_id, technology_id, technology_version_id FROM asset_technologies WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (!row) throw new NotFoundException('Link not found');
    return this.setOperatingSystem(
      mg, tenantId, row.asset_id,
      { technology_id: row.technology_id, technology_version_id: row.technology_version_id },
      source, userId,
    );
  }

  /** `technology_id` plus a version id or a label, the body of PUT `/assets/:id/operating-system`. */
  async setFromBody(
    mg: EntityManager,
    tenantId: string,
    assetId: string,
    body: { technology_id?: unknown; technology_version_id?: unknown; version_label?: unknown } | null,
    source: LinkSource,
    userId?: string | null,
  ): Promise<{ ok: true; link_id: string | null; changed: boolean }> {
    const technologyId = String(body?.technology_id ?? '').trim();
    if (!technologyId) return this.setOperatingSystem(mg, tenantId, assetId, null, source, userId);
    const tech = await readTechnology(mg, tenantId, technologyId);
    const versionId = await this.versionFromBody(mg, tenantId, tech.id, body ?? {});
    return this.setOperatingSystem(
      mg, tenantId, assetId,
      { technology_id: tech.id, technology_version_id: versionId },
      source, userId,
    );
  }

  private async resolveShipped(
    mg: EntityManager,
    tenantId: string,
    shipped: OperatingSystemCode,
    opts: ResolveOptions,
  ): Promise<ResolvedOperatingSystem> {
    const product = this.catalog.shippedProduct(shipped.product);
    if (!product) throw new BadRequestException(`Unknown operating system product: ${shipped.product}.`);
    const technologyId = await this.adopt(mg, tenantId, product.key);
    const version = product.versions.find((item) => item.label.toLowerCase() === shipped.version.toLowerCase());
    const dates = this.datesOf(version, shipped);
    const versionId = await this.ensureVersion(
      mg, tenantId, technologyId, version?.label ?? shipped.version, true, dates,
      version ? { ...version, catalog_key: `${product.key}:${version.key}` } : undefined,
    );
    return { technology_id: technologyId, technology_version_id: versionId };
  }

  /** Shipped dates first; the old catalog fills a side the shipped version leaves empty. */
  private datesOf(version: CatalogVersion | undefined, shipped: OperatingSystemCode): Dates {
    return {
      standard: version?.standard_support_end || shipped.standardSupportEnd || null,
      extended: version?.extended_support_end || shipped.extendedSupportEnd || null,
    };
  }

  private async adopt(mg: EntityManager, tenantId: string, key: string): Promise<string> {
    const result = await this.catalog.adopt(key, { manager: mg, tenantId, userId: null, language: 'en' });
    return result.technology.id;
  }

  private async prefixTechnology(
    mg: EntityManager,
    tenantId: string,
    label: string,
  ): Promise<{ id: string; remainder: string } | null> {
    const rows: Array<{ id: string; name: string }> = await mg.query(
      `SELECT id, name FROM technologies
        WHERE tenant_id = $1
          AND char_length($2) > char_length(name)
          AND lower(left($2, char_length(name))) = lower(name)
          AND substr($2, char_length(name) + 1, 1) = ' '
        ORDER BY char_length(name) DESC
        LIMIT 1`,
      [tenantId, label],
    );
    if (!rows[0]) return null;
    return { id: rows[0].id, remainder: label.slice(rows[0].name.length).trim() };
  }

  private prefixProduct(label: string): { product: CatalogProduct; remainder: string | null } | null {
    const products = this.catalog.all();
    const exact = products.find((product) => product.name.toLowerCase() === label.toLowerCase());
    if (exact) return { product: exact, remainder: null };
    const matches = products.filter((product) => {
      if (label.length <= product.name.length) return false;
      return label.slice(0, product.name.length).toLowerCase() === product.name.toLowerCase()
        && label[product.name.length] === ' ';
    });
    matches.sort((a, b) => b.name.length - a.name.length);
    if (!matches[0]) return null;
    return { product: matches[0], remainder: label.slice(matches[0].name.length).trim() };
  }

  private async createTechnology(mg: EntityManager, tenantId: string, name: string): Promise<string> {
    if (name.length > 200) throw new BadRequestException('Name is longer than 200 characters.');
    const settings = await this.itOps.getSettings(tenantId, { manager: mg });
    const family = (settings.technologyFamilies ?? []).some((item) => item.code === 'operating_system')
      ? 'operating_system'
      : 'other';
    const hostingType = resolveHostingType(settings.hostingTypes, 'on_prem');
    const itemNumber = await allocateItemNumbers('technology', tenantId, 1, mg);
    const inserted: Array<{ id: string }> = await mg.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, lower(name)) DO NOTHING
       RETURNING id`,
      [tenantId, itemNumber, name, family, hostingType],
    );
    const id = inserted[0]?.id ?? (await mg.query(
      `SELECT id FROM technologies WHERE tenant_id = $1 AND lower(name) = lower($2)`,
      [tenantId, name],
    ))[0]?.id;
    if (!id) throw new BadRequestException('The operating system could not be created.');
    if (inserted[0]) {
      const after = await readTechnology(mg, tenantId, id);
      await this.audit.log({
        table: 'technologies', recordId: id, action: 'create', before: null, after, userId: null,
      }, { manager: mg });
    }
    return id;
  }

  /**
   * The version `label` of the technology. Created when missing and `create` is set.
   * Empty date columns take `dates` (never a date already set). A shipped version also
   * receives its `cpe_version`, build prefixes and catalog key when the row is created.
   */
  private async ensureVersion(
    mg: EntityManager,
    tenantId: string,
    technologyId: string,
    label: string,
    create: boolean,
    dates: Dates,
    shipped?: CatalogVersion & { catalog_key: string },
  ): Promise<string | null> {
    const text = shipped?.label ?? label.trim();
    if (!text) return null;
    if (text.length > 100) throw new BadRequestException('Version is longer than 100 characters.');
    const found: Array<{ id: string; standard_support_end: string | null; extended_support_end: string | null }> = await mg.query(
      `SELECT id, to_char(standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
              to_char(extended_support_end, 'YYYY-MM-DD') AS extended_support_end
         FROM technology_versions
        WHERE tenant_id = $1 AND technology_id = $2 AND lower(label) = lower($3)`,
      [tenantId, technologyId, text],
    );
    if (found[0]) {
      await this.fillEmptyDates(mg, tenantId, found[0], dates);
      return found[0].id;
    }
    if (!create) return null;
    const standard = dates.standard;
    const extended = dates.extended && (!standard || dates.extended >= standard) ? dates.extended : null;
    const inserted: Array<{ id: string }> = await mg.query(
      `INSERT INTO technology_versions (
         tenant_id, technology_id, label, cpe_version, build_prefixes, standard_support_end, extended_support_end, catalog_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, technology_id, lower(label)) DO NOTHING
       RETURNING id`,
      [
        tenantId, technologyId, text,
        shipped?.cpe_version ?? null,
        shipped?.build_prefixes ?? [],
        standard, extended,
        shipped?.catalog_key ?? null,
      ],
    );
    if (inserted[0]) return inserted[0].id;
    const resolved = await resolveVersionLabel(mg, tenantId, technologyId, text, { create: false });
    return resolved?.id ?? null;
  }

  private async fillEmptyDates(
    mg: EntityManager,
    tenantId: string,
    row: { id: string; standard_support_end: string | null; extended_support_end: string | null },
    dates: Dates,
  ) {
    const standard = row.standard_support_end || dates.standard || null;
    let extended = row.extended_support_end || dates.extended || null;
    if (standard && extended && extended < standard) extended = row.extended_support_end;
    if (standard === row.standard_support_end && extended === row.extended_support_end) return;
    await mg.query(
      `UPDATE technology_versions
          SET standard_support_end = $3, extended_support_end = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, row.id, standard, extended],
    );
  }

  private async versionFromBody(
    mg: EntityManager,
    tenantId: string,
    technologyId: string,
    body: { technology_version_id?: unknown; version_label?: unknown },
  ): Promise<string | null> {
    const rawId = body.technology_version_id;
    if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
      const id = String(rawId).trim().toLowerCase();
      if (!UUID_RE.test(id)) throw new BadRequestException('Version not found.');
      const rows = await mg.query(
        `SELECT 1 FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
        [tenantId, technologyId, id],
      );
      if (rows.length === 0) throw new BadRequestException('Version not found.');
      return id;
    }
    const versionLabel = body.version_label;
    if (versionLabel !== undefined && versionLabel !== null && String(versionLabel).trim() !== '') {
      return this.ensureVersion(mg, tenantId, technologyId, String(versionLabel), true, EMPTY_DATES);
    }
    return null;
  }

  private async lockAsset(mg: EntityManager, tenantId: string, assetId: string): Promise<string> {
    const raw = String(assetId || '').trim();
    const rows: Array<{ id: string }> = UUID_RE.test(raw)
      ? await mg.query(`SELECT id FROM assets WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, raw.toLowerCase()])
      : await mg.query(
        `SELECT id FROM assets WHERE tenant_id = $1 AND upper(asset_reference) = upper($2) FOR UPDATE`,
        [tenantId, raw],
      );
    if (!rows[0]) throw new NotFoundException('Asset not found');
    return rows[0].id;
  }

  private async markLink(
    mg: EntityManager,
    tenantId: string,
    row: LinkRow,
    versionId: string | null,
    provenance: ReturnType<typeof linkProvenance>,
    userId?: string | null,
  ) {
    await mg.query(
      `UPDATE asset_technologies
          SET technology_version_id = $3, is_operating_system = true,
              source = $4, source_ref = $5, observed_at = $6, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, row.id, versionId, ...provenanceParams(provenance)],
    );
    await this.audit.log({
      table: 'asset_technologies', recordId: row.technology_id, action: 'update',
      before: { id: row.id, technology_version_id: row.technology_version_id, source: row.source, is_operating_system: false },
      after: { id: row.id, technology_version_id: versionId, source: provenance.source, is_operating_system: true },
      userId: userId ?? null,
    }, { manager: mg });
  }

  private async deleteLink(mg: EntityManager, tenantId: string, row: LinkRow, userId?: string | null) {
    const removed: Array<Record<string, unknown>> = await mg.query(
      `WITH d AS (
         DELETE FROM asset_technologies WHERE tenant_id = $1 AND id = $2 RETURNING *
       ) SELECT * FROM d`,
      [tenantId, row.id],
    );
    if (removed[0]) {
      await this.audit.log({
        table: 'asset_technologies', recordId: row.technology_id, action: 'delete',
        before: removed[0], after: null, userId: userId ?? null,
      }, { manager: mg });
      await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId: row.technology_id, products: [] });
    }
  }
}

type LinkRow = {
  id: string;
  technology_id: string;
  technology_version_id: string | null;
  source: string;
  source_ref: string | null;
  notes: string | null;
};

