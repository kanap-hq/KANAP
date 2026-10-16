import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Shared reads and input checks of the technologies module: the row of a technology by id or
 * reference (TEC-n) under the tenant, its row lock, and the resolution of a version label.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEC_REF_RE = /^TEC-(\d+)$/i;

export type TechnologyRow = {
  id: string;
  tenant_id: string;
  item_number: number;
  name: string;
  editor: string | null;
  family: string;
  mode: 'installed' | 'subscribed';
  lifecycle: string;
  description: string | null;
  notes: string | null;
  catalog_key: string | null;
  cpe_products: string[];
  replaced_by_id: string | null;
  cyber_criticality: string | null;
  recovery_wave: string | null;
  rto_minutes: number | null;
  rpo_minutes: number | null;
  created_at: Date;
  updated_at: Date;
};

export type TechnologyVersionRow = {
  id: string;
  technology_id: string;
  label: string;
  cpe_version: string | null;
  build_prefixes: string[];
  standard_support_end: string | null;
  extended_support_end: string | null;
  notes: string | null;
  catalog_key: string | null;
};

export const TECHNOLOGY_COLUMNS = `t.id, t.tenant_id, t.item_number, t.name, t.editor, t.family, t.mode, t.lifecycle, t.description, t.notes,
  t.catalog_key, t.cpe_products, t.replaced_by_id, t.cyber_criticality, t.recovery_wave, t.rto_minutes, t.rpo_minutes,
  t.created_at, t.updated_at`;

export const VERSION_COLUMNS = `v.id, v.technology_id, v.label, v.cpe_version, v.build_prefixes,
  to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
  to_char(v.extended_support_end, 'YYYY-MM-DD') AS extended_support_end, v.notes, v.catalog_key`;

export function technologyReference(itemNumber: number | null | undefined): string | null {
  return itemNumber == null ? null : `TEC-${itemNumber}`;
}

export function technologyNotFound(): NotFoundException {
  return new NotFoundException('Technology not found');
}

/** The technology `idOrRef` (uuid or TEC-n) of the tenant, or a 404. `lock`: FOR NO KEY UPDATE. */
export async function readTechnology(mg: EntityManager, tenantId: string, idOrRef: string, lock = false): Promise<TechnologyRow> {
  const raw = String(idOrRef || '').trim();
  const ref = raw.match(TEC_REF_RE);
  let rows: TechnologyRow[] = [];
  if (UUID_RE.test(raw) || ref) {
    const number = ref ? Number(ref[1]) : null;
    if (number != null && (!Number.isSafeInteger(number) || number > 2147483647)) throw technologyNotFound();
    rows = await mg.query(
      `SELECT ${TECHNOLOGY_COLUMNS} FROM technologies t
        WHERE t.tenant_id = $1 AND ${ref ? 't.item_number = $2' : 't.id = $2'}${lock ? ' FOR NO KEY UPDATE' : ''}`,
      [tenantId, ref ? number : raw.toLowerCase()],
    );
  }
  if (!rows[0]) throw technologyNotFound();
  return rows[0];
}

/** Trimmed text, null when blank; a 400 over `max` characters. */
export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new BadRequestException(`${field} is longer than ${max} characters.`);
  return text;
}

/** A calendar day YYYY-MM-DD, null when blank; a 400 otherwise. */
export function optionalDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new BadRequestException(`${field} must be a date (YYYY-MM-DD).`);
  }
  return text;
}

/** A list of short texts, trimmed, deduplicated without case; a 400 on a malformed one. */
export function textList(value: unknown, field: string, pattern: RegExp, max = 50): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException(`${field} must be a list.`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item ?? '').trim().toLowerCase();
    if (!text) continue;
    if (!pattern.test(text)) throw new BadRequestException(`Invalid ${field}: ${text}`);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  if (out.length > max) throw new BadRequestException(`${field} holds more than ${max} values.`);
  return out;
}

/** A CPE product prefix `part:vendor:product` (part a, o or h), as NVD names it. */
export const CPE_PRODUCT_RE = /^[aoh]:[a-z0-9._\-~%!]{1,100}:[a-z0-9._\-~%!]{1,100}$/;
/** A build prefix (`15.0`) an agent's raw version starts with. */
export const BUILD_PREFIX_RE = /^[0-9a-z][0-9a-z._\-]{0,49}$/;

/**
 * The version of `technologyId` labelled `label` (compared without case, trimmed): its id, created
 * when missing and `create` is set (null otherwise). Shared by the pickers, the CSV, the assistant
 * and an agent: they all write a label. The unique index on lower(label) makes a concurrent
 * creation of the same label land once (the second insert does nothing and reads the first).
 */
export async function resolveVersionLabel(
  mg: EntityManager,
  tenantId: string,
  technologyId: string,
  label: string,
  opts: { create: boolean },
): Promise<{ id: string; created: boolean } | null> {
  const text = optionalText(label, 'Version', 100);
  if (!text) return null;
  const found: Array<{ id: string }> = await mg.query(
    `SELECT id FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND lower(label) = lower($3)`,
    [tenantId, technologyId, text],
  );
  if (found[0]) return { id: found[0].id, created: false };
  if (!opts.create) return null;
  const inserted: Array<{ id: string }> = await mg.query(
    `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, technology_id, lower(label)) DO NOTHING RETURNING id`,
    [tenantId, technologyId, text],
  );
  if (inserted[0]) return { id: inserted[0].id, created: true };
  const again: Array<{ id: string }> = await mg.query(
    `SELECT id FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND lower(label) = lower($3)`,
    [tenantId, technologyId, text],
  );
  return again[0] ? { id: again[0].id, created: false } : null;
}

/**
 * The version a link names: `technology_version_id` (a version of this technology, 400 otherwise),
 * else `version_label` resolved and created when missing, else null (unknown).
 */
export async function versionOfInput(
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
  if (body.version_label !== undefined && body.version_label !== null && String(body.version_label).trim() !== '') {
    return (await resolveVersionLabel(mg, tenantId, technologyId, String(body.version_label), { create: true }))?.id ?? null;
  }
  return null;
}

export function requireManager(mg: EntityManager | undefined): EntityManager {
  if (!mg) throw new BadRequestException('Tenant context is not available');
  return mg;
}
