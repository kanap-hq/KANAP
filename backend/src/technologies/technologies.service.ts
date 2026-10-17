import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { AuditService } from '../audit/audit.service';
import { allocateItemNumbers } from '../common/item-number.service';
import { duplicateNameException } from '../common/duplicate-name';
import { StorageService } from '../common/storage/storage.service';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { TechnologyReachService } from './technology-reach.service';
import { sortVersions } from './version-order';
import {
  BUILD_PREFIX_RE,
  CPE_PRODUCT_RE,
  optionalDay,
  optionalText,
  readTechnology,
  technologyReference,
  TECHNOLOGY_COLUMNS,
  textList,
  UUID_RE,
  VERSION_COLUMNS,
  type TechnologyRow,
  type TechnologyVersionRow,
} from './technology-rows';

export type Opts = { manager: EntityManager; tenantId: string; userId?: string | null };

const SORTS: Record<string, string> = {
  name: 'lower(t.name)',
  editor: 'lower(t.editor)',
  family: 't.family',
  reference: 't.item_number',
  lifecycle: 't.lifecycle',
  updated_at: 't.updated_at',
};

/** Fields a create or a PATCH may carry; anything else in the body is ignored. */
type TechnologyInput = Partial<{
  name: unknown; editor: unknown; family: unknown; mode: unknown; lifecycle: unknown; description: unknown; notes: unknown;
  support_notes: unknown; cpe_products: unknown; replaced_by_id: unknown; cyber_criticality: unknown; recovery_wave: unknown;
  rto_minutes: unknown; rpo_minutes: unknown;
}>;

type VersionInput = Partial<{
  label: unknown; cpe_version: unknown; build_prefixes: unknown; standard_support_end: unknown; extended_support_end: unknown;
  notes: unknown;
}>;

const LINK_URL_MAX = 2000;

/** A scheme before the address (`javascript:`, `ftp:`), not a port after a host (`intranet:8080`). */
const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):(?!\d)/i;

/**
 * The address of a web link: trimmed, required, and http or https when it names a scheme (400
 * otherwise). An address without one (`www.vmware.com/support`) opens as https, as the screens do.
 */
export function webLinkUrl(value: unknown): string {
  const url = optionalText(value, 'URL', LINK_URL_MAX);
  if (!url) throw new BadRequestException('url is required');
  const scheme = URL_SCHEME_RE.exec(url)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new BadRequestException('A web link must be an http or https address.');
  return url;
}

/** Columns the list grid filters with a set filter. */
const GRID_SET_COLUMNS = ['family', 'editor', 'lifecycle'] as const;

/** Columns the list grid filters with a text filter, and what they compare. */
const GRID_TEXT_COLUMNS: Record<string, string> = { name: 't.name', reference: `('TEC-' || t.item_number)` };

function gridTextModel(raw: unknown, column: string): { type?: string; filter?: unknown } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const model = JSON.parse(raw)?.[column];
    return model && model.filterType === 'text' ? model : null;
  } catch {
    return null;
  }
}

/** A grid text filter (contains, equals, starts or ends with, blank) on `expr`, without case. */
function gridTextClause(expr: string, model: { type?: string; filter?: unknown } | null, bind: (value: unknown) => string): string | null {
  if (!model) return null;
  const type = model.type || 'contains';
  if (type === 'blank') return `(${expr} IS NULL OR ${expr} = '')`;
  if (type === 'notBlank') return `(${expr} IS NOT NULL AND ${expr} <> '')`;
  const text = String(model.filter ?? '');
  if (!text) return null;
  const escaped = text.replace(/[\\%_]/g, (c) => `\\${c}`);
  if (type === 'equals') return `lower(${expr}) = lower(${bind(text)})`;
  if (type === 'notEqual') return `lower(${expr}) <> lower(${bind(text)})`;
  if (type === 'startsWith') return `${expr} ILIKE ${bind(`${escaped}%`)}`;
  if (type === 'endsWith') return `${expr} ILIKE ${bind(`%${escaped}`)}`;
  if (type === 'notContains') return `${expr} NOT ILIKE ${bind(`%${escaped}%`)}`;
  return `${expr} ILIKE ${bind(`%${escaped}%`)}`;
}

type GridSetFilter = { values: string[]; blank: boolean };

/**
 * The list grid's set filters (`{ family: { filterType: 'set', values: [...] } }`), by column: the
 * ticked values and whether "blank" (`null`) is ticked; a column without a filter is absent. Any
 * other column or an unreadable model is ignored.
 */
function gridFilters(raw: unknown): Partial<Record<(typeof GRID_SET_COLUMNS)[number], GridSetFilter>> {
  const out: Partial<Record<(typeof GRID_SET_COLUMNS)[number], GridSetFilter>> = {};
  if (typeof raw !== 'string' || !raw.trim()) return out;
  let model: Record<string, { values?: unknown }>;
  try { model = JSON.parse(raw); } catch { return out; }
  if (!model || typeof model !== 'object') return out;
  for (const column of GRID_SET_COLUMNS) {
    const values = model[column]?.values;
    if (!Array.isArray(values)) continue;
    out[column] = {
      values: values.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()),
      blank: values.some((v) => v === null || v === ''),
    };
  }
  return out;
}

/**
 * The technologies of a tenant (lot S): list with its counters, record, versions, owners, web links
 * and attachments. Every statement carries the tenant besides RLS. Writes are audited on the table
 * they change, `recordId` the technology (or the row for links and attachments, as the
 * applications do).
 */
@Injectable()
export class TechnologiesService {
  constructor(
    private readonly audit: AuditService,
    private readonly itOps: ItOpsSettingsService,
    private readonly reach: TechnologyReachService,
    private readonly storage: StorageService,
  ) {}

  // ==================== LIST AND RECORD ====================

  /**
   * A page of technologies: filters `family`, `editor` (exact, without case), `lifecycle`, `q`
   * (name, editor, reference); counters of the page in one statement (`TechnologyReachService`).
   */
  async list(query: Record<string, any>, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const params: unknown[] = [tenantId];
    const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const where = ['t.tenant_id = $1'];
    const list = (value: unknown) => (Array.isArray(value) ? value : String(value ?? '').split(','))
      .map((v) => String(v).trim()).filter(Boolean);
    // The list grid's set filters (`filters`, JSON) narrow the same columns as the plain parameters.
    const grid = gridFilters(query.filters);
    for (const column of GRID_SET_COLUMNS) {
      const filter = grid[column];
      if (!filter) continue;
      const expr = column === 'editor' ? 'lower(t.editor)' : `t.${column}`;
      const values = column === 'editor' ? filter.values.map((v) => v.toLowerCase()) : filter.values;
      const parts = [
        ...(values.length ? [`${expr} = ANY(${bind(values)}::text[])`] : []),
        ...(filter.blank ? [`t.${column} IS NULL`] : []),
      ];
      where.push(parts.length ? `(${parts.join(' OR ')})` : 'false');
    }
    for (const [column, expr] of Object.entries(GRID_TEXT_COLUMNS)) {
      const clause = gridTextClause(expr, gridTextModel(query.filters, column), bind);
      if (clause) where.push(clause);
    }
    const families = list(query.family);
    if (families.length) where.push(`t.family = ANY(${bind(families)}::text[])`);
    const editors = list(query.editor).map((v) => v.toLowerCase());
    if (editors.length) where.push(`lower(t.editor) = ANY(${bind(editors)}::text[])`);
    const lifecycles = list(query.lifecycle);
    if (lifecycles.length) where.push(`t.lifecycle = ANY(${bind(lifecycles)}::text[])`);
    const q = String(query.q ?? '').trim().slice(0, 100);
    if (q) {
      const needle = bind(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(t.name ILIKE ${needle} OR t.editor ILIKE ${needle} OR ('TEC-' || t.item_number) ILIKE ${needle})`);
    }
    // `sort` takes a field (`name`) with `direction`, or the grid's `field:DIR` (`name:DESC`).
    const [sortField, sortDirection] = String(query.sort ?? 'name').split(':');
    const sort = SORTS[sortField] ?? SORTS.name;
    const direction = String(sortDirection ?? query.direction ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    // `offset`, or the grid's `page` (from 1).
    const offset = query.offset !== undefined
      ? Math.max(Number(query.offset) || 0, 0)
      : Math.max((Number(query.page) || 1) - 1, 0) * limit;
    const rows: Array<TechnologyRow & { total: string; owner_names: string[] | null; it_owner_names: string[] | null }> = await mg.query(
      `SELECT ${TECHNOLOGY_COLUMNS}, count(*) OVER () AS total,
              ARRAY(
                SELECT NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '')
                  FROM technology_owners o JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
                 WHERE o.tenant_id = t.tenant_id AND o.technology_id = t.id
                 ORDER BY o.owner_type DESC, lower(u.last_name), lower(u.first_name), u.id
              ) AS owner_names,
              ARRAY(
                SELECT NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '')
                  FROM technology_owners o JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
                 WHERE o.tenant_id = t.tenant_id AND o.technology_id = t.id AND o.owner_type = 'it'
                 ORDER BY lower(u.last_name), lower(u.first_name), u.id
              ) AS it_owner_names
         FROM technologies t
        WHERE ${where.join(' AND ')}
        ORDER BY ${sort} ${direction} NULLS LAST, t.id
        LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
      params,
    );
    const counts = await this.reach.countsOfTechnologies(mg, tenantId, rows.map((row) => row.id));
    return {
      items: rows.map(({ total: _total, owner_names, it_owner_names, ...row }) => ({
        ...this.present(row),
        owner_names: (owner_names ?? []).filter(Boolean),
        it_owner_names: (it_owner_names ?? []).filter(Boolean),
        servers: counts.get(row.id)?.servers ?? 0,
        applications: counts.get(row.id)?.applications ?? 0,
        versions_in_use: counts.get(row.id)?.versions_in_use ?? 0,
        next_support_end: counts.get(row.id)?.next_support_end ?? null,
        ended_versions: counts.get(row.id)?.ended_versions ?? 0,
      })),
      total: Number(rows[0]?.total ?? 0),
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
    };
  }

  /** The record: the technology, its versions, its owners and the technology it is replaced by. */
  async get(idOrRef: string, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const row = await readTechnology(mg, tenantId, idOrRef);
    const versions = await this.listVersionsOf(mg, tenantId, row.id);
    const owners = await this.listOwnersOf(mg, tenantId, row.id);
    const replacedBy: Array<{ id: string; name: string; item_number: number }> = row.replaced_by_id
      ? await mg.query(`SELECT id, name, item_number FROM technologies WHERE tenant_id = $1 AND id = $2`, [tenantId, row.replaced_by_id])
      : [];
    return {
      ...this.present(row),
      versions,
      owners,
      replaced_by: replacedBy[0] ? { id: replacedBy[0].id, name: replacedBy[0].name, reference: technologyReference(replacedBy[0].item_number) } : null,
    };
  }

  present(row: TechnologyRow) {
    return { ...row, reference: technologyReference(row.item_number) };
  }

  // ==================== CREATE AND UPDATE ====================

  async create(body: TechnologyInput, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const values = await this.validate(body, null, opts);
    if (!values.name) throw new BadRequestException('Name is required.');
    await this.assertNameFree(mg, tenantId, values.name as string, null);
    const itemNumber = await allocateItemNumbers('technology', tenantId, 1, mg);
    const columns = ['tenant_id', 'item_number', ...Object.keys(values)];
    const params = [tenantId, itemNumber, ...Object.values(values)];
    const [created]: Array<{ id: string }> = await mg.query(
      `INSERT INTO technologies (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      params,
    );
    const row = await readTechnology(mg, tenantId, created.id);
    await this.audit.log({ table: 'technologies', recordId: row.id, action: 'create', before: null, after: row, userId: opts.userId ?? null }, { manager: mg });
    return this.get(row.id, opts);
  }

  async update(idOrRef: string, body: TechnologyInput, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const before = await readTechnology(mg, tenantId, idOrRef, true);
    const values = await this.validate(body, before, opts);
    if ('name' in values) {
      if (!values.name) throw new BadRequestException('Name is required.');
      await this.assertNameFree(mg, tenantId, values.name as string, before.id);
    }
    const keys = Object.keys(values);
    if (keys.length) {
      await mg.query(
        `UPDATE technologies SET ${keys.map((key, i) => `${key} = $${i + 3}`).join(', ')}, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, before.id, ...Object.values(values)],
      );
      const after = await readTechnology(mg, tenantId, before.id);
      await this.audit.log({ table: 'technologies', recordId: before.id, action: 'update', before, after, userId: opts.userId ?? null }, { manager: mg });
    }
    return this.get(before.id, opts);
  }

  /** The columns a create or PATCH writes, checked against the tenant's catalogs. */
  private async validate(body: TechnologyInput, current: TechnologyRow | null, opts: Opts): Promise<Record<string, unknown>> {
    const { manager: mg, tenantId } = opts;
    const out: Record<string, unknown> = {};
    const has = (key: keyof TechnologyInput) => body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
    if (has('name')) out.name = optionalText(body.name, 'Name', 200);
    if (has('editor')) out.editor = optionalText(body.editor, 'Editor', 200);
    if (has('description')) out.description = optionalText(body.description, 'Description', 20000);
    if (has('notes')) out.notes = optionalText(body.notes, 'Notes', 20000);
    if (has('support_notes')) out.support_notes = optionalText(body.support_notes, 'Support notes', 20000);
    // `catalog_key` is written by the adoption only: a typed technology cannot take a catalog entry's key.
    if (has('mode')) {
      const mode = String(body.mode ?? '').trim();
      if (mode !== 'installed' && mode !== 'subscribed') throw new BadRequestException('Mode must be installed or subscribed.');
      out.mode = mode;
    }
    if (has('cpe_products')) out.cpe_products = textList(body.cpe_products, 'CPE product', CPE_PRODUCT_RE);
    for (const key of ['rto_minutes', 'rpo_minutes'] as const) {
      if (!has(key)) continue;
      const raw = body[key];
      if (raw === null || raw === '') { out[key] = null; continue; }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < (key === 'rto_minutes' ? 1 : 0) || n > 5256000) throw new BadRequestException(`Invalid ${key}.`);
      out[key] = n;
    }
    if (has('replaced_by_id')) {
      const raw = body.replaced_by_id;
      if (raw === null || raw === '') out.replaced_by_id = null;
      else {
        const replacement = await readTechnology(mg, tenantId, String(raw)).catch(() => {
          throw new BadRequestException('Replacement technology not found.');
        });
        if (current && replacement.id === current.id) throw new BadRequestException('A technology cannot replace itself.');
        if (current) await this.assertNoReplacementCycle(mg, tenantId, current.id, replacement.id);
        out.replaced_by_id = replacement.id;
      }
    }
    const needsSettings = has('family') || has('lifecycle') || has('cyber_criticality') || has('recovery_wave');
    if (needsSettings) {
      const settings = await this.itOps.getSettings(tenantId, { manager: mg });
      const codeIn = (list: Array<{ code: string }> | undefined, value: unknown, field: string, nullable: boolean) => {
        if ((value === null || value === '') && nullable) return null;
        const code = String(value ?? '').trim().toLowerCase();
        if (!(list ?? []).some((item) => item.code === code)) throw new BadRequestException(`Unknown ${field}: ${code || '(empty)'}.`);
        return code;
      };
      if (has('family')) out.family = codeIn(settings.technologyFamilies, body.family, 'family', false);
      if (has('lifecycle')) out.lifecycle = codeIn(settings.lifecycleStates, body.lifecycle, 'lifecycle', false);
      if (has('cyber_criticality')) out.cyber_criticality = codeIn((settings as any).cyberCriticalityLevels, body.cyber_criticality, 'cyber criticality', true);
      if (has('recovery_wave')) out.recovery_wave = codeIn((settings as any).recoveryWaves, body.recovery_wave, 'recovery wave', true);
    }
    return out;
  }

  /** Refuses a replacement that leads back to the technology (A replaced by B, B by A, or longer). */
  private async assertNoReplacementCycle(mg: EntityManager, tenantId: string, technologyId: string, replacementId: string) {
    const rows = await mg.query(
      `WITH RECURSIVE chain AS (
         SELECT t.id, t.replaced_by_id, 1 AS depth FROM technologies t WHERE t.tenant_id = $1 AND t.id = $2
         UNION ALL
         SELECT t.id, t.replaced_by_id, c.depth + 1
           FROM chain c JOIN technologies t ON t.tenant_id = $1 AND t.id = c.replaced_by_id
          WHERE c.depth < 100
       )
       SELECT 1 FROM chain WHERE id = $3 LIMIT 1`,
      [tenantId, replacementId, technologyId],
    );
    if (rows.length) throw new BadRequestException('This replacement would make a cycle.');
  }

  private async assertNameFree(mg: EntityManager, tenantId: string, name: string, exceptId: string | null) {
    const rows = await mg.query(
      `SELECT id FROM technologies WHERE tenant_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [tenantId, name, exceptId],
    );
    if (rows.length) throw duplicateNameException('A technology with this name already exists.');
  }

  // ==================== EDITORS ====================

  /**
   * The values of the list grid's set filters (`fields`: `editor`, `family`, `lifecycle`, comma
   * list), the tenant's own and all of them: editors deduplicated without case (one spelling per
   * editor, as the filter compares without case), `null` when a technology has none.
   */
  async filterValues(fields: unknown, opts: Opts): Promise<Record<string, Array<string | null>>> {
    const wanted = String(fields ?? '').split(',').map((f) => f.trim())
      .filter((f): f is (typeof GRID_SET_COLUMNS)[number] => (GRID_SET_COLUMNS as readonly string[]).includes(f));
    const out: Record<string, Array<string | null>> = {};
    for (const field of Array.from(new Set(wanted))) {
      // The column comes from the fixed list above, never from the request text.
      const key = field === 'editor' ? 'lower(editor)' : field;
      const rows: Array<{ value: string | null }> = await opts.manager.query(
        `SELECT DISTINCT ON (${key}) ${field} AS value FROM technologies
          WHERE tenant_id = $1 ORDER BY ${key} NULLS LAST, ${field}`,
        [opts.tenantId],
      );
      out[field] = rows.map((row) => row.value);
    }
    return out;
  }

  /**
   * Editors to offer: the tenant's and the catalog's (`extra`), deduplicated without case (the
   * tenant's spelling first), filtered by `q`, at most 50.
   */
  async editors(q: string, extra: string[], opts: Opts): Promise<{ items: string[] }> {
    const rows: Array<{ editor: string }> = await opts.manager.query(
      `SELECT DISTINCT ON (lower(editor)) editor FROM technologies
        WHERE tenant_id = $1 AND editor IS NOT NULL ORDER BY lower(editor), editor`,
      [opts.tenantId],
    );
    const seen = new Set<string>();
    const out: string[] = [];
    const needle = String(q ?? '').trim().toLowerCase();
    for (const editor of [...rows.map((r) => r.editor), ...extra]) {
      const key = editor.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (needle && !key.includes(needle)) continue;
      out.push(editor.trim());
    }
    out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    return { items: out.slice(0, 50) };
  }

  // ==================== VERSIONS ====================

  async listVersions(idOrRef: string, opts: Opts) {
    const row = await readTechnology(opts.manager, opts.tenantId, idOrRef);
    return { items: await this.listVersionsOf(opts.manager, opts.tenantId, row.id) };
  }

  /** The versions, newest first (`version-order.ts`), with how many servers and applications name each one directly. */
  private async listVersionsOf(mg: EntityManager, tenantId: string, technologyId: string) {
    const rows: Array<TechnologyVersionRow & { servers: number; applications: number }> = await mg.query(
      `SELECT ${VERSION_COLUMNS},
              (SELECT count(*)::int FROM asset_technologies a WHERE a.tenant_id = v.tenant_id AND a.technology_version_id = v.id AND a.technology_id = v.technology_id) AS servers,
              (SELECT count(*)::int FROM application_technologies a WHERE a.tenant_id = v.tenant_id AND a.technology_version_id = v.id AND a.technology_id = v.technology_id) AS applications
         FROM technology_versions v
        WHERE v.tenant_id = $1 AND v.technology_id = $2
        ORDER BY v.id`,
      [tenantId, technologyId],
    );
    // Newest number first, labels without a number last: one technology has few versions.
    return sortVersions(rows);
  }

  async createVersion(idOrRef: string, body: VersionInput, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const values = this.validateVersion(body);
    if (!values.label) throw new BadRequestException('Label is required.');
    await this.assertLabelFree(mg, tenantId, tech.id, values.label as string, null);
    const columns = ['tenant_id', 'technology_id', ...Object.keys(values)];
    const [created]: Array<{ id: string }> = await mg.query(
      `INSERT INTO technology_versions (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      [tenantId, tech.id, ...Object.values(values)],
    );
    const version = await this.readVersion(mg, tenantId, tech.id, created.id);
    await this.audit.log({ table: 'technology_versions', recordId: tech.id, action: 'create', before: null, after: version, userId: opts.userId ?? null }, { manager: mg });
    return version;
  }

  async updateVersion(idOrRef: string, versionId: string, body: VersionInput, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const before = await this.readVersion(mg, tenantId, tech.id, versionId);
    const values = this.validateVersion(body);
    if ('label' in values) {
      if (!values.label) throw new BadRequestException('Label is required.');
      await this.assertLabelFree(mg, tenantId, tech.id, values.label as string, before.id);
    }
    const keys = Object.keys(values);
    if (keys.length) {
      const merged = { ...before, ...values } as TechnologyVersionRow;
      if (merged.standard_support_end && merged.extended_support_end && merged.extended_support_end < merged.standard_support_end) {
        throw new BadRequestException('The extended support cannot end before the standard support.');
      }
      await mg.query(
        `UPDATE technology_versions SET ${keys.map((key, i) => `${key} = $${i + 4}`).join(', ')}, updated_at = now()
          WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
        [tenantId, tech.id, before.id, ...Object.values(values)],
      );
      const after = await this.readVersion(mg, tenantId, tech.id, before.id);
      await this.audit.log({ table: 'technology_versions', recordId: tech.id, action: 'update', before, after, userId: opts.userId ?? null }, { manager: mg });
      return after;
    }
    return before;
  }

  /**
   * Delete a version: the links that named it become "version unknown". A link whose asset or
   * application already names the technology with an unknown version is removed instead (the pair
   * would repeat), and counted.
   */
  async deleteVersion(idOrRef: string, versionId: string, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const before = await this.readVersion(mg, tenantId, tech.id, versionId);
    let merged = 0;
    for (const side of ['asset', 'application'] as const) {
      const [{ n }] = await mg.query(
        `WITH d AS (
           DELETE FROM ${side}_technologies l
            WHERE l.tenant_id = $1 AND l.technology_id = $2 AND l.technology_version_id = $3
              AND EXISTS (SELECT 1 FROM ${side}_technologies o
                           WHERE o.tenant_id = l.tenant_id AND o.${side}_id = l.${side}_id
                             AND o.technology_id = l.technology_id AND o.technology_version_id IS NULL)
            RETURNING 1)
         SELECT count(*)::int AS n FROM d`,
        [tenantId, tech.id, before.id],
      );
      merged += Number(n) || 0;
    }
    await mg.query(`DELETE FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`, [tenantId, tech.id, before.id]);
    await this.audit.log({ table: 'technology_versions', recordId: tech.id, action: 'delete', before, after: null, userId: opts.userId ?? null }, { manager: mg });
    return { ok: true, merged_links: merged };
  }

  private async readVersion(mg: EntityManager, tenantId: string, technologyId: string, versionId: string): Promise<TechnologyVersionRow> {
    const id = String(versionId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new NotFoundException('Version not found');
    const rows: TechnologyVersionRow[] = await mg.query(
      `SELECT ${VERSION_COLUMNS} FROM technology_versions v WHERE v.tenant_id = $1 AND v.technology_id = $2 AND v.id = $3`,
      [tenantId, technologyId, id],
    );
    if (!rows[0]) throw new NotFoundException('Version not found');
    return rows[0];
  }

  private validateVersion(body: VersionInput): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const has = (key: keyof VersionInput) => body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
    if (has('label')) out.label = optionalText(body.label, 'Label', 100);
    if (has('cpe_version')) out.cpe_version = optionalText(body.cpe_version, 'CPE version', 100);
    if (has('build_prefixes')) out.build_prefixes = textList(body.build_prefixes, 'build prefix', BUILD_PREFIX_RE);
    if (has('standard_support_end')) out.standard_support_end = optionalDay(body.standard_support_end, 'Standard support end');
    if (has('extended_support_end')) out.extended_support_end = optionalDay(body.extended_support_end, 'Extended support end');
    if (has('notes')) out.notes = optionalText(body.notes, 'Notes', 20000);
    const s = out.standard_support_end as string | null | undefined;
    const e = out.extended_support_end as string | null | undefined;
    if (s && e && e < s) throw new BadRequestException('The extended support cannot end before the standard support.');
    return out;
  }

  private async assertLabelFree(mg: EntityManager, tenantId: string, technologyId: string, label: string, exceptId: string | null) {
    const rows = await mg.query(
      `SELECT 1 FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND lower(label) = lower($3) AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      [tenantId, technologyId, label, exceptId],
    );
    if (rows.length) throw new ConflictException('This version already exists.');
  }

  // ==================== OWNERS ====================

  async listOwners(idOrRef: string, opts: Opts) {
    const row = await readTechnology(opts.manager, opts.tenantId, idOrRef);
    return this.listOwnersOf(opts.manager, opts.tenantId, row.id);
  }

  private async listOwnersOf(mg: EntityManager, tenantId: string, technologyId: string) {
    const rows: Array<{ id: string; user_id: string; owner_type: 'business' | 'it'; full_name: string | null }> = await mg.query(
      `SELECT o.id, o.user_id, o.owner_type, NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS full_name
         FROM technology_owners o
         LEFT JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
        WHERE o.tenant_id = $1 AND o.technology_id = $2
        ORDER BY o.owner_type DESC, full_name ASC NULLS LAST, o.created_at ASC`,
      [tenantId, technologyId],
    );
    return rows;
  }

  /**
   * Replace the owners (as `applications-owners.service.ts` does): deduplicated by type and user,
   * every user of the tenant (400 otherwise), one audit row when the set changes. The technology's
   * row is locked first, so a concurrent replacement waits and the last one wins.
   */
  async bulkReplaceOwners(idOrRef: string, owners: Array<{ user_id: string; owner_type: 'business' | 'it' }>, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const wanted: Array<{ user_id: string; owner_type: 'business' | 'it' }> = [];
    const seen = new Set<string>();
    for (const owner of Array.isArray(owners) ? owners : []) {
      const userId = String(owner?.user_id || '').trim().toLowerCase();
      const type = owner?.owner_type;
      if (!userId || (type !== 'business' && type !== 'it')) continue;
      if (!UUID_RE.test(userId)) throw new BadRequestException('One or more owners not found');
      const key = `${type}:${userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push({ user_id: userId, owner_type: type });
    }
    const userIds = Array.from(new Set(wanted.map((o) => o.user_id)));
    if (userIds.length) {
      const found = await mg.query(`SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, userIds]);
      if (found.length !== userIds.length) throw new BadRequestException('One or more owners not found');
    }
    const existing: Array<{ user_id: string; owner_type: string }> = await mg.query(
      `SELECT user_id, owner_type FROM technology_owners WHERE tenant_id = $1 AND technology_id = $2`,
      [tenantId, tech.id],
    );
    const before = existing.map((o) => `${o.owner_type}:${o.user_id}`).sort();
    const after = wanted.map((o) => `${o.owner_type}:${o.user_id}`).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await mg.query(`DELETE FROM technology_owners WHERE tenant_id = $1 AND technology_id = $2`, [tenantId, tech.id]);
      if (wanted.length) {
        await mg.query(
          `INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type)
           SELECT $1, $2, w.user_id, w.owner_type FROM unnest($3::uuid[], $4::text[]) AS w(user_id, owner_type)`,
          [tenantId, tech.id, wanted.map((o) => o.user_id), wanted.map((o) => o.owner_type)],
        );
      }
      await this.audit.log({ table: 'technology_owners', recordId: tech.id, action: 'update', before, after, userId: opts.userId ?? null }, { manager: mg });
    }
    return this.listOwnersOf(mg, tenantId, tech.id);
  }

  // ==================== SUPPORT CONTACTS ====================

  async listSupportContacts(idOrRef: string, opts: Opts) {
    const tech = await readTechnology(opts.manager, opts.tenantId, idOrRef);
    return this.listSupportContactsOf(opts.manager, opts.tenantId, tech.id);
  }

  /** The support contacts in the order they were added, with what the Operations tab shows of the contact. */
  private async listSupportContactsOf(mg: EntityManager, tenantId: string, technologyId: string) {
    const rows: Array<{ id: string; contact_id: string; role: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; mobile: string | null }> = await mg.query(
      `SELECT sc.id, sc.contact_id, sc.role, c.first_name, c.last_name, c.email, c.phone, c.mobile
         FROM technology_support_contacts sc
         JOIN contacts c ON c.tenant_id = sc.tenant_id AND c.id = sc.contact_id
        WHERE sc.tenant_id = $1 AND sc.technology_id = $2
        ORDER BY sc.created_at ASC, sc.id ASC`,
      [tenantId, technologyId],
    );
    return rows.map((r) => ({
      id: r.id,
      contact_id: r.contact_id,
      role: r.role,
      contact: { id: r.contact_id, first_name: r.first_name, last_name: r.last_name, email: r.email, phone: r.phone, mobile: r.mobile },
    }));
  }

  /**
   * Replace the support contacts (as the applications' `support-contacts/bulk-replace`): one row per
   * contact (the first role given wins), every contact of the tenant (400 otherwise), the order of
   * the list kept, one audit row when the set changes. The technology's row is locked first, so a
   * concurrent replacement waits and the last one wins.
   */
  async bulkReplaceSupportContacts(idOrRef: string, contacts: Array<{ contact_id?: unknown; role?: unknown }>, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const wanted: Array<{ contact_id: string; role: string | null }> = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(contacts) ? contacts : []) {
      const contactId = String(item?.contact_id ?? '').trim().toLowerCase();
      if (!contactId) continue;
      if (!UUID_RE.test(contactId)) throw new BadRequestException('One or more contacts not found');
      if (seen.has(contactId)) continue;
      seen.add(contactId);
      wanted.push({ contact_id: contactId, role: optionalText(item?.role, 'Role', 200) });
    }
    if (wanted.length) {
      const found = await mg.query(`SELECT id FROM contacts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, wanted.map((c) => c.contact_id)]);
      if (found.length !== wanted.length) throw new BadRequestException('One or more contacts not found');
    }
    const existing: Array<{ contact_id: string; role: string | null }> = await mg.query(
      `SELECT contact_id, role FROM technology_support_contacts WHERE tenant_id = $1 AND technology_id = $2 ORDER BY created_at ASC, id ASC`,
      [tenantId, tech.id],
    );
    const before = existing.map((c) => `${c.contact_id}:${c.role ?? ''}`);
    const after = wanted.map((c) => `${c.contact_id}:${c.role ?? ''}`);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await mg.query(`DELETE FROM technology_support_contacts WHERE tenant_id = $1 AND technology_id = $2`, [tenantId, tech.id]);
      if (wanted.length) {
        // created_at follows the list order, which is the display order.
        await mg.query(
          `INSERT INTO technology_support_contacts (tenant_id, technology_id, contact_id, role, created_at)
           SELECT $1, $2, w.contact_id, w.role, now() + (w.ord * interval '1 microsecond')
             FROM unnest($3::uuid[], $4::text[]) WITH ORDINALITY AS w(contact_id, role, ord)`,
          [tenantId, tech.id, wanted.map((c) => c.contact_id), wanted.map((c) => c.role)],
        );
      }
      await this.audit.log({ table: 'technology_support_contacts', recordId: tech.id, action: 'update', before, after, userId: opts.userId ?? null }, { manager: mg });
    }
    return this.listSupportContactsOf(mg, tenantId, tech.id);
  }

  // ==================== WEB LINKS ====================

  async listLinks(idOrRef: string, opts: Opts) {
    const tech = await readTechnology(opts.manager, opts.tenantId, idOrRef);
    return opts.manager.query(
      `SELECT id, technology_id, description, url, created_at FROM technology_links
        WHERE tenant_id = $1 AND technology_id = $2 ORDER BY created_at DESC, id`,
      [opts.tenantId, tech.id],
    );
  }

  async createLink(idOrRef: string, body: { url?: unknown; description?: unknown }, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const url = webLinkUrl(body?.url);
    const [saved] = await mg.query(
      `INSERT INTO technology_links (tenant_id, technology_id, description, url) VALUES ($1, $2, $3, $4)
       RETURNING id, technology_id, description, url, created_at`,
      [tenantId, tech.id, optionalText(body?.description, 'Description', 2000), url],
    );
    await this.audit.log({ table: 'technology_links', recordId: saved.id, action: 'create', before: null, after: saved, userId: opts.userId ?? null }, { manager: mg });
    return saved;
  }

  async updateLink(idOrRef: string, linkId: string, body: { url?: unknown; description?: unknown }, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const before = await this.readLink(mg, tenantId, tech.id, linkId);
    const url = body?.url !== undefined ? webLinkUrl(body.url) : before.url;
    const description = body?.description !== undefined ? optionalText(body.description, 'Description', 2000) : before.description;
    // Through a CTE: an UPDATE through the query runner answers [rows, count], not the rows.
    const [saved] = await mg.query(
      `WITH u AS (
         UPDATE technology_links SET url = $4, description = $5 WHERE tenant_id = $1 AND technology_id = $2 AND id = $3
         RETURNING id, technology_id, description, url, created_at)
       SELECT * FROM u`,
      [tenantId, tech.id, before.id, url, description],
    );
    await this.audit.log({ table: 'technology_links', recordId: before.id, action: 'update', before, after: saved, userId: opts.userId ?? null }, { manager: mg });
    return saved;
  }

  async deleteLink(idOrRef: string, linkId: string, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const before = await this.readLink(mg, tenantId, tech.id, linkId).catch(() => null);
    if (!before) return { ok: true };
    await mg.query(`DELETE FROM technology_links WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`, [tenantId, tech.id, before.id]);
    await this.audit.log({ table: 'technology_links', recordId: before.id, action: 'delete', before, after: null, userId: opts.userId ?? null }, { manager: mg });
    return { ok: true };
  }

  private async readLink(mg: EntityManager, tenantId: string, technologyId: string, linkId: string) {
    const id = String(linkId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new NotFoundException('Link not found');
    const rows = await mg.query(
      `SELECT id, technology_id, description, url, created_at FROM technology_links WHERE tenant_id = $1 AND technology_id = $2 AND id = $3`,
      [tenantId, technologyId, id],
    );
    if (!rows[0]) throw new NotFoundException('Link not found');
    return rows[0];
  }

  // ==================== ATTACHMENTS ====================

  async listAttachments(idOrRef: string, opts: Opts) {
    const tech = await readTechnology(opts.manager, opts.tenantId, idOrRef);
    return opts.manager.query(
      `SELECT id, technology_id, original_filename, mime_type, size, uploaded_at FROM technology_attachments
        WHERE tenant_id = $1 AND technology_id = $2 ORDER BY uploaded_at DESC, id`,
      [opts.tenantId, tech.id],
    );
  }

  /** Stored as the applications' attachments are: `files/<tenant>/technologies/<id>/<uuid>_<name>`. */
  async uploadAttachment(idOrRef: string, file: Express.Multer.File, opts: Opts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    if (!file) throw new BadRequestException('No file uploaded');
    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    if (!buf) throw new BadRequestException('Empty upload');
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({ originalName: decodedName, mimeType: (file as any).mimetype, buffer: buf, size: (file as any).size });
    const originalName = decodedName || `attachment${validated.extension}`;
    const stored = `${randomUUID()}_${originalName}`;
    const key = path.posix.join('files', tenantId, 'technologies', tech.id, stored);
    await this.storage.putObject({ key, body: buf, contentType: validated.mimeType, contentLength: validated.size, sse: 'AES256' });
    const [saved] = await mg.query(
      `INSERT INTO technology_attachments (tenant_id, technology_id, original_filename, stored_filename, mime_type, size, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, technology_id, original_filename, stored_filename, mime_type, size, storage_path, uploaded_at`,
      [tenantId, tech.id, originalName, stored, validated.mimeType || null, validated.size, key],
    );
    await this.audit.log({ table: 'technology_attachments', recordId: saved.id, action: 'create', before: null, after: saved, userId: opts.userId ?? null }, { manager: mg });
    return saved;
  }

  async readAttachment(attachmentId: string, opts: Opts) {
    const id = String(attachmentId || '').trim().toLowerCase();
    if (!UUID_RE.test(id)) throw new NotFoundException('Attachment not found');
    const rows = await opts.manager.query(
      `SELECT id, technology_id, original_filename, mime_type, size, storage_path FROM technology_attachments WHERE tenant_id = $1 AND id = $2`,
      [opts.tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('Attachment not found');
    return rows[0] as { id: string; technology_id: string; original_filename: string; mime_type: string | null; size: number; storage_path: string };
  }

  async deleteAttachment(attachmentId: string, opts: Opts) {
    const found = await this.readAttachment(attachmentId, opts).catch(() => null);
    if (!found) return { ok: true };
    await opts.manager.query(`DELETE FROM technology_attachments WHERE tenant_id = $1 AND id = $2`, [opts.tenantId, found.id]);
    try { await this.storage.deleteObject(found.storage_path); } catch { /* best effort, as the applications */ }
    await this.audit.log({ table: 'technology_attachments', recordId: found.id, action: 'delete', before: found, after: null, userId: opts.userId ?? null }, { manager: opts.manager });
    return { ok: true };
  }
}
