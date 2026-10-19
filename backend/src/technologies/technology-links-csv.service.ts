import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  cellOf,
  readMasterDataFile,
  rowError,
  rowProblemErrors,
  writeCsv,
  type CsvDataRow,
  type CsvLanguage,
  type ImportReportError,
} from '../common/csv-sheet';
import { linkProvenance, SOURCE_REF_MAX, type LinkProvenance } from '../common/link-provenance';
import { uploadedBytes } from '../common/upload';
import { OperatingSystemService } from './operating-system.service';
import { TechnologyLinksService, type LinkOpts } from './technology-links.service';

export const ASSET_LINK_CSV_HEADERS = [
  'asset_name', 'technology_reference', 'technology_name', 'version', 'operating_system', 'notes', 'source',
] as const;

/** `source` is written by the export and ignored on import: a file without it still reads. */
const OPTIONAL_COLUMNS = ['source'] as const;
const VERSION_MAX = 100;
const NOTES_MAX = 2000;
const OS_FAMILY = 'operating_system';
const TEC_REF_RE = /^TEC-(\d+)$/i;

export const ASSET_LINKS_CSV_FILENAME = 'servers-technologies.csv';
export const ASSET_LINKS_CSV_TEMPLATE = 'servers-technologies-template.csv';

export interface TechnologyLinksImportResult {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: ImportReportError[];
  warnings: ImportReportError[];
  ignoredColumns: string[];
  notices: { dates: string | null; amounts: string | null };
}

export type TechnologyLinksCsvContext = { manager: EntityManager; tenantId: string; userId?: string | null };

type ImportRequest = { file: Express.Multer.File; dryRun: boolean; language: CsvLanguage };
type LinkSide = 'asset' | 'application';

/** The server or application a row names. `is_cluster` is the asset's, false for an application. */
type Subject = { id: string; is_cluster: boolean };
type SubjectRow = Subject & { name_key: string; reference_key: string | null };
type Subjects = { byName: Map<string, SubjectRow[]>; byReference: Map<string, SubjectRow> };
type TechRow = { id: string; name: string; item_number: number; family: string };
type StoredLink = { id: string; subject_id: string; notes: string | null; is_operating_system: boolean };

type PlannedLink = {
  subjectId: string;
  technologyId: string;
  /** Trimmed label, empty when the link has no version. */
  versionLabel: string;
  notes: string;
  /** Insert the link, or replace its notes. An operating-system mark alone does not. */
  writeLink: boolean;
  /** `yes` on a server link that is not the operating system yet. */
  markOperatingSystem: boolean;
  outcome: 'inserted' | 'updated' | 'unchanged';
};

type SideSpec = {
  side: LinkSide;
  headers: readonly string[];
  /** The subject of each usable row, or the row's error. */
  resolve: (rows: CsvDataRow[]) => Promise<(row: CsvDataRow) => Subject | ImportReportError>;
};

/**
 * The two files of links of the technology layer, from the technologies list: servers and
 * technologies (`asset_technologies`), applications and technologies (`application_technologies`,
 * declared links only). One row is one link. Import adds and updates: it never deletes a link and
 * never replaces the provenance of a link that exists already. A link it creates is
 * `source = 'import'`, `source_ref` the file name. A file with any row error writes nothing; a clean
 * file writes in the request transaction, through the services the screens use (audit, search,
 * vulnerability matching).
 */
@Injectable()
export class TechnologyLinksCsvService {
  constructor(
    private readonly links: TechnologyLinksService,
    private readonly operatingSystems: OperatingSystemService,
  ) {}

  // ==================== SERVERS ====================

  /** Every server link of the tenant, retired assets included, by server, technology, version. */
  async exportAssetLinks(
    scope: 'data' | 'template',
    ctx: TechnologyLinksCsvContext,
    language: CsvLanguage = 'en',
  ): Promise<{ filename: string; content: string }> {
    const rows: string[][] = [];
    if (scope === 'data') {
      const stored: Array<{
        asset_name: string; item_number: number; technology_name: string; version: string | null;
        is_operating_system: boolean; notes: string | null; source: string;
      }> = await ctx.manager.query(
        `SELECT a.name AS asset_name, t.item_number, t.name AS technology_name, v.label AS version,
                at.is_operating_system, at.notes, at.source
           FROM asset_technologies at
           JOIN assets a ON a.tenant_id = at.tenant_id AND a.id = at.asset_id
           JOIN technologies t ON t.tenant_id = at.tenant_id AND t.id = at.technology_id
           LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
          WHERE at.tenant_id = $1
          ORDER BY lower(a.name), a.id, lower(t.name), t.id, lower(v.label) NULLS FIRST, at.id`,
        [ctx.tenantId],
      );
      for (const row of stored) {
        rows.push([
          row.asset_name, `TEC-${row.item_number}`, row.technology_name, row.version ?? '',
          row.is_operating_system ? 'yes' : 'no', row.notes ?? '', row.source,
        ]);
      }
    }
    return {
      filename: scope === 'template' ? ASSET_LINKS_CSV_TEMPLATE : ASSET_LINKS_CSV_FILENAME,
      content: writeCsv({ language, headers: [...ASSET_LINK_CSV_HEADERS], rows }),
    };
  }

  /**
   * Add or update server links. The server matches by name (unknown or several: a row error; a
   * retired asset is accepted). `operating_system` `yes` asks for the mark; `no` and empty never
   * clear one.
   */
  async importAssetLinks(request: ImportRequest, ctx: TechnologyLinksCsvContext): Promise<TechnologyLinksImportResult> {
    return this.importLinks(request, ctx, {
      side: 'asset',
      headers: ASSET_LINK_CSV_HEADERS,
      resolve: async (rows) => {
        const assets = await this.assetsByName(ctx, rows.map((row) => cellOf(row, 'asset_name').toLowerCase()));
        return (row) => {
          const name = cellOf(row, 'asset_name');
          if (!name) return rowError(row.line, 'asset_name', 'CSV_VALUE_REQUIRED', 'A value is required.');
          return matchOne(row.line, 'asset_name', name, assets.byName.get(name.toLowerCase()) ?? []);
        };
      },
    });
  }

  // ==================== SHARED ====================

  private async importLinks(
    { file, dryRun, language }: ImportRequest,
    ctx: TechnologyLinksCsvContext,
    spec: SideSpec,
  ): Promise<TechnologyLinksImportResult> {
    const read = await readMasterDataFile({ file: uploadedBytes(file), fields: spec.headers, optional: OPTIONAL_COLUMNS, language });
    const report = (errors: ImportReportError[], warnings: ImportReportError[], counts = { inserted: 0, updated: 0, unchanged: 0 }) => ({
      ok: errors.length === 0, dryRun, total: read.rows.length, ...counts, errors, warnings,
      ignoredColumns: read.ignoredColumns, notices: read.notices,
    });
    if (read.headerError) return report([read.headerError], []);

    const planned = await this.plan(read.rows, ctx, spec);
    if (planned.errors.length > 0) return report(planned.errors, planned.warnings);
    const counts = { inserted: 0, updated: 0, unchanged: 0 };
    for (const row of planned.rows) counts[row.outcome] += 1;
    if (!dryRun) await this.write(spec.side, planned.rows, importProvenance(file.originalname), ctx);
    return report([], planned.warnings, counts);
  }

  /** Every row checked against the stored data, nothing written. Errors and warnings by physical line. */
  private async plan(
    rows: CsvDataRow[],
    ctx: TechnologyLinksCsvContext,
    spec: SideSpec,
  ): Promise<{ rows: PlannedLink[]; errors: ImportReportError[]; warnings: ImportReportError[] }> {
    const errors: ImportReportError[] = [];
    const warnings: ImportReportError[] = [];
    const usable = rows.filter((row) => rowProblemErrors(row).length === 0);
    const subjectOf = await spec.resolve(usable);
    const techs = await this.technologies(
      ctx,
      usable.map((row) => technologyItemNumber(cellOf(row, 'technology_reference'))).filter((n): n is number => n != null),
      usable.filter((row) => !cellOf(row, 'technology_reference')).map((row) => cellOf(row, 'technology_name').toLowerCase()),
    );
    const versions = await this.versionsByLabel(ctx, [...techs.byItem.values()].map((tech) => tech.id));
    const subjects = new Map(usable.map((row) => [row, subjectOf(row)] as const));
    const stored = await this.storedLinks(ctx, spec.side, [...subjects.values()].flatMap((s) => ('row' in s ? [] : [s.id])));

    const seen = new Map<string, number>();
    const osClaim = new Map<string, string>();
    const planned: PlannedLink[] = [];
    for (const row of rows) {
      const line = row.line;
      const problems = rowProblemErrors(row);
      if (problems.length > 0) {
        errors.push(...problems);
        continue;
      }
      const subject = subjects.get(row)!;
      if ('row' in subject) {
        errors.push(subject);
        continue;
      }
      const tech = resolveTechnology(line, cellOf(row, 'technology_reference'), cellOf(row, 'technology_name'), techs, errors);
      if (!tech) continue;

      const versionLabel = cellOf(row, 'version');
      if (versionLabel.length > VERSION_MAX) {
        errors.push(rowError(line, 'version', 'CSV_VERSION_TOO_LONG', `Version is longer than ${VERSION_MAX} characters.`, { max: VERSION_MAX }));
        continue;
      }
      const notes = cellOf(row, 'notes');
      if (notes.length > NOTES_MAX) {
        errors.push(rowError(line, 'notes', 'CSV_NOTES_TOO_LONG', `Notes are longer than ${NOTES_MAX} characters.`, { max: NOTES_MAX }));
        continue;
      }
      // "No version" and a named version are two links (the key is NULLS NOT DISTINCT).
      const linkKey = `${subject.id}|${tech.id}|${versionLabel.toLowerCase()}`;
      const firstRow = seen.get(linkKey);
      if (firstRow != null) {
        errors.push(rowError(line, spec.side === 'asset' ? 'asset_name' : 'application_name', 'CSV_LINK_DUPLICATE', `This link is already on row ${firstRow}.`, { firstRow }));
        continue;
      }
      seen.set(linkKey, line);

      const versionId = versionLabel ? versions.get(`${tech.id}|${versionLabel.toLowerCase()}`) ?? null : null;
      // A label the technology does not have yet is a new link: it never matches the link without version.
      const link = versionLabel && !versionId ? null : stored.get(`${subject.id}|${tech.id}|${versionId ?? ''}`) ?? null;

      let markOperatingSystem = false;
      if (spec.side === 'asset') {
        const raw = cellOf(row, 'operating_system');
        const os = raw.toLowerCase();
        if (os !== '' && os !== 'yes' && os !== 'no') {
          errors.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_VALUE', `"${raw}" is not valid. Use yes or no.`, { value: raw }));
          continue;
        }
        if (os === 'yes' && !link?.is_operating_system) {
          const refused = refuseOperatingSystem(line, subject, tech, stored, osClaim, linkKey);
          if (refused.length > 0) {
            errors.push(...refused);
            continue;
          }
          osClaim.set(subject.id, linkKey);
          markOperatingSystem = true;
        }
      }

      if (versionLabel && !versionId) {
        warnings.push(rowError(line, 'version', 'CSV_TECHNOLOGY_VERSION_CREATED', `Version "${versionLabel}" is created.`, { value: versionLabel }));
      }
      const notesChange = link != null && notes !== '' && notes !== (link.notes ?? '');
      planned.push({
        subjectId: subject.id,
        technologyId: tech.id,
        versionLabel,
        notes,
        writeLink: !link || notesChange,
        markOperatingSystem,
        outcome: !link ? 'inserted' : notesChange || markOperatingSystem ? 'updated' : 'unchanged',
      });
    }
    return { rows: planned, errors: errors.sort((a, b) => a.row - b.row), warnings };
  }

  /** Through the screens' services. An existing link keeps its provenance (`keepExistingProvenance`). */
  private async write(side: LinkSide, rows: PlannedLink[], provenance: LinkProvenance, ctx: TechnologyLinksCsvContext) {
    const opts: LinkOpts = { manager: ctx.manager, tenantId: ctx.tenantId, userId: ctx.userId ?? null };
    for (const row of rows) {
      if (!row.writeLink && !row.markOperatingSystem) continue;
      const body = {
        ...(row.versionLabel ? { version_label: row.versionLabel } : {}),
        ...(row.notes !== '' ? { notes: row.notes } : {}),
      };
      // A mark alone: the call finds the existing link and leaves it as stored.
      const written = await this.links.addAssetLink(row.technologyId, row.subjectId, body, opts, provenance, { keepExistingProvenance: true });
      if (row.markOperatingSystem && written.link_id) {
        // Not requested: the service marks the link when the server has no mark, never deletes one.
        await this.operatingSystems.onAssetLinkAdded(ctx.manager, ctx.tenantId, row.subjectId, written.link_id, provenance.source, opts.userId, false);
      }
    }
  }

  private async assetsByName(ctx: TechnologyLinksCsvContext, names: string[]): Promise<Subjects> {
    const wanted = unique(names);
    const rows: SubjectRow[] = wanted.length
      ? await ctx.manager.query(
        `SELECT id::text AS id, lower(btrim(name)) AS name_key, NULL::text AS reference_key,
                COALESCE(is_cluster, false) AS is_cluster
           FROM assets
          WHERE tenant_id = $1 AND lower(btrim(name)) = ANY($2::text[])`,
        [ctx.tenantId, wanted],
      )
      : [];
    return indexSubjects(rows);
  }

  private async technologies(
    ctx: TechnologyLinksCsvContext,
    itemNumbers: number[],
    names: string[],
  ): Promise<{ byItem: Map<number, TechRow>; byName: Map<string, TechRow[]> }> {
    const byItem = new Map<number, TechRow>();
    const byName = new Map<string, TechRow[]>();
    const numbers = [...new Set(itemNumbers)];
    const wanted = unique(names);
    if (numbers.length === 0 && wanted.length === 0) return { byItem, byName };
    const rows: Array<TechRow & { name_key: string }> = await ctx.manager.query(
      `SELECT id::text AS id, name, lower(btrim(name)) AS name_key, item_number, family
         FROM technologies
        WHERE tenant_id = $1 AND (item_number = ANY($2::int[]) OR lower(btrim(name)) = ANY($3::text[]))`,
      [ctx.tenantId, numbers, wanted],
    );
    for (const row of rows) {
      byItem.set(Number(row.item_number), row);
      byName.set(row.name_key, [...(byName.get(row.name_key) ?? []), row]);
    }
    return { byItem, byName };
  }

  /** `technology id|lower(label)` to the version id. */
  private async versionsByLabel(ctx: TechnologyLinksCsvContext, technologyIds: string[]): Promise<Map<string, string>> {
    const wanted = unique(technologyIds);
    const rows: Array<{ id: string; technology_id: string; label: string }> = wanted.length
      ? await ctx.manager.query(
        `SELECT id::text AS id, technology_id::text AS technology_id, label
           FROM technology_versions WHERE tenant_id = $1 AND technology_id = ANY($2::uuid[])`,
        [ctx.tenantId, wanted],
      )
      : [];
    return new Map(rows.map((row) => [`${row.technology_id}|${row.label.toLowerCase()}`, row.id]));
  }

  /** `subject id|technology id|version id or ''` to the stored link. */
  private async storedLinks(ctx: TechnologyLinksCsvContext, side: LinkSide, subjectIds: string[]): Promise<Map<string, StoredLink & { technology_id: string; technology_version_id: string | null }>> {
    const wanted = unique(subjectIds);
    const rows: Array<StoredLink & { technology_id: string; technology_version_id: string | null }> = wanted.length
      ? await ctx.manager.query(
        `SELECT id::text AS id, ${side}_id::text AS subject_id, technology_id::text AS technology_id,
                technology_version_id::text AS technology_version_id, notes,
                ${side === 'asset' ? 'is_operating_system' : 'false AS is_operating_system'}
           FROM ${side}_technologies
          WHERE tenant_id = $1 AND ${side}_id = ANY($2::uuid[])`,
        [ctx.tenantId, wanted],
      )
      : [];
    return new Map(rows.map((row) => [`${row.subject_id}|${row.technology_id}|${row.technology_version_id ?? ''}`, row]));
  }
}

function indexSubjects(rows: SubjectRow[]): Subjects {
  const byName = new Map<string, SubjectRow[]>();
  const byReference = new Map<string, SubjectRow>();
  for (const row of rows) {
    byName.set(row.name_key, [...(byName.get(row.name_key) ?? []), row]);
    if (row.reference_key) byReference.set(row.reference_key, row);
  }
  return { byName, byReference };
}

function notFound(line: number, column: string, value: string): ImportReportError {
  return rowError(line, column, 'CSV_REFERENCE_NOT_FOUND', `"${value}" was not found.`, { value });
}

/** One record by name: none is not found, several is ambiguous. */
function matchOne(line: number, column: string, name: string, hits: SubjectRow[]): Subject | ImportReportError {
  if (hits.length === 0) return notFound(line, column, name);
  if (hits.length > 1) return rowError(line, column, 'CSV_NAME_AMBIGUOUS', `Several records are named "${name}".`, { value: name });
  return { id: hits[0].id, is_cluster: hits[0].is_cluster };
}

/** By `TEC-n` when the reference is filled, otherwise by name. Unknown: adopt it from the catalog first. */
function resolveTechnology(
  line: number,
  reference: string,
  name: string,
  techs: { byItem: Map<number, TechRow>; byName: Map<string, TechRow[]> },
  errors: ImportReportError[],
): TechRow | null {
  const notAdopted = (column: string, value: string) => rowError(
    line, column, 'CSV_TECHNOLOGY_NOT_ADOPTED', `Unknown technology "${value}". Adopt it from the catalog first.`, { value },
  );
  if (reference) {
    const number = technologyItemNumber(reference);
    const tech = number == null ? undefined : techs.byItem.get(number);
    if (!tech) errors.push(notAdopted('technology_reference', reference));
    return tech ?? null;
  }
  if (!name) {
    errors.push(rowError(line, 'technology_reference', 'CSV_TECHNOLOGY_REQUIRED', 'Name the technology by its reference (TEC-n) or its name.'));
    return null;
  }
  const hits = techs.byName.get(name.toLowerCase()) ?? [];
  if (hits.length === 0) errors.push(notAdopted('technology_name', name));
  else if (hits.length > 1) errors.push(rowError(line, 'technology_name', 'CSV_NAME_AMBIGUOUS', `Several records are named "${name}".`, { value: name }));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * `yes` on a server link: refused when the technology is not an operating system, the asset is a
 * cluster, or the server has another mark (stored, or asked by an earlier row of the file). The
 * import never deletes a link, so it cannot move a mark the way the server screen does.
 */
function refuseOperatingSystem(
  line: number,
  subject: Subject,
  tech: TechRow,
  stored: Map<string, StoredLink>,
  osClaim: Map<string, string>,
  linkKey: string,
): ImportReportError[] {
  const problems: ImportReportError[] = [];
  if (tech.family !== OS_FAMILY) {
    problems.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_FAMILY', 'Only an operating system can be marked as the operating system.'));
  }
  if (subject.is_cluster) {
    problems.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_CLUSTER', 'A cluster has no operating system.'));
  }
  if (problems.length > 0) return problems;
  const markedElsewhere = [...stored.values()].some((link) => link.subject_id === subject.id && link.is_operating_system);
  const claimedElsewhere = osClaim.has(subject.id) && osClaim.get(subject.id) !== linkKey;
  if (markedElsewhere || claimedElsewhere) {
    problems.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_TAKEN', 'This server already has an operating system.'));
  }
  return problems;
}

/** The file name, trimmed and cut to the provenance limit (`linkProvenance` refuses a longer one). */
function importProvenance(originalName: string | undefined): LinkProvenance {
  const trimmed = (originalName ?? '').trim().slice(0, SOURCE_REF_MAX);
  return linkProvenance('import', trimmed || null);
}

/** `TEC-n` to n, or null when the cell is not that reference. `TEC-01` is item 1. */
function technologyItemNumber(reference: string): number | null {
  const match = reference.trim().match(TEC_REF_RE);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number <= 2147483647 ? number : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}
