import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import {
  cellOf,
  formatCsvBoolean,
  parseCsvBoolean,
  readMasterDataFile,
  rowError,
  rowProblemErrors,
  type CsvDataRow,
  type CsvLanguage,
  type ImportReportError,
} from '../common/csv-sheet';
import { linkProvenance, SOURCE_REF_MAX, type LinkProvenance, type LinkSource } from '../common/link-provenance';
import { parseItemNumber } from '../common/parse-item-number';
import { fixMulterFilename, uploadedBytes } from '../common/upload';
import { clustersWithMembers } from '../assets/asset-rules';
import { OperatingSystemService } from './operating-system.service';
import { TechnologyLinksService, type LinkOpts } from './technology-links.service';
import { ListExportFile, writeListExport } from '../common/csv/list-export';
import type { ExportFileFormat } from '../common/xlsx/format';
import type { CsvCallerAccess } from '../common/csv/csv-field.types';
import { hasLevel } from '../common/relations/relations-access';
import {
  findRecordByName,
  listedMatches,
  listedRefusedProposals,
  noteNameMatch,
  noteRefusedProposal,
  proposalFor,
  takeProposal,
  undoneMatch,
  type ImportMatchState,
  type ImportNameMatch,
  type ImportProposals,
  type ImportRefusedProposal,
} from '../common/name-matching';
import { matchVersionLabel, type VersionLabelMatch } from './version-label-match';

export const ASSET_LINK_CSV_HEADERS = [
  'asset_reference', 'asset_name', 'technology_reference', 'technology_name', 'version', 'operating_system', 'notes', 'source',
] as const;

export const APPLICATION_LINK_CSV_HEADERS = [
  'application_reference', 'application_name', 'technology_reference', 'technology_name', 'version', 'notes', 'source',
] as const;

/** `source` is written by the export, in the file's language, and ignored on import: a file without it still reads. */
const OPTIONAL_COLUMNS = ['source'] as const;
const VERSION_MAX = 100;
const NOTES_MAX = 2000;
const OS_FAMILY = 'operating_system';
const TEC_REF_RE = /^TEC-(\d+)$/i;
const APP_REF_RE = /^APP-\d+$/i;

/** Where a link comes from, in the words of each export language. */
const SOURCE_LABELS: Record<CsvLanguage, Record<LinkSource, string>> = {
  en: { manual: 'Manual entry', import: 'Import', ai: 'Assistant', agent: 'Agent', netbox: 'Netbox' },
  fr: { manual: 'Saisie manuelle', import: 'Import', ai: 'Assistant', agent: 'Agent', netbox: 'Netbox' },
  de: { manual: 'Manuelle Eingabe', import: 'Import', ai: 'Assistent', agent: 'Agent', netbox: 'Netbox' },
  es: { manual: 'Entrada manual', import: 'Importación', ai: 'Asistente', agent: 'Agente', netbox: 'Netbox' },
};

function sourceLabel(source: string, language: CsvLanguage): string {
  return SOURCE_LABELS[language][source as LinkSource] ?? source;
}

export const ASSET_LINKS_CSV_FILENAME = 'servers-technologies.csv';
export const ASSET_LINKS_CSV_TEMPLATE = 'servers-technologies-template.csv';
export const APPLICATION_LINKS_CSV_FILENAME = 'applications-technologies.csv';
export const APPLICATION_LINKS_CSV_TEMPLATE = 'applications-technologies-template.csv';

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
  /** The names and versions found beyond case (lot I3 of 26.11.9), each undoable; absent when none. */
  matches?: ImportNameMatch[];
  matchesTotal?: number;
  /** Kad's proposals the check refused (lot I3 of 26.11.9); absent when none. */
  refusedProposals?: ImportRefusedProposal[];
  refusedProposalsTotal?: number;
}

export type TechnologyLinksCsvContext = { manager: EntityManager; tenantId: string; userId?: string | null };

/** The applications the caller reads: all of them, or a Business Contributor's own (`scope`). */
export type ApplicationsScope = { scope?: ParticipationAccessScope };

/** A file of links to check or load, as the route and Kad's import hand it. */
export type LinkFileImportRequest = {
  file: Express.Multer.File;
  dryRun: boolean;
  language: CsvLanguage;
  /**
   * The person's rights (lot I3 of 26.11.9): a server or a technology is found accents aside when they
   * read the infrastructure, an application when they read the applications. Absent: case aside only.
   */
  access?: CsvCallerAccess;
  /** The matches the person undid, by file column and value: found case aside (a version: as written). */
  unmatched?: Array<{ column: string; value: string }>;
  /** Kad's proposals, by file column: taken for a record the person reads, exactly or case aside. */
  proposals?: ImportProposals;
};
type ImportRequest = LinkFileImportRequest;

/** How a row's name finds its record: the request's say, and the matches noted so far. */
type NameLookup = { request: ImportRequest; state: ImportMatchState };
type LinkSide = 'asset' | 'application';

/** The server or application a row names. `is_cluster` is the asset's, false for an application. */
type Subject = { id: string; is_cluster: boolean };
type SubjectRow = Subject & { name: string; name_key: string; reference_key: string | null };
type Subjects = { all: SubjectRow[]; byReference: Map<string, SubjectRow> };
type TechRow = { id: string; name: string; item_number: number; family: string };
type Technologies = { byItem: Map<number, TechRow>; all: TechRow[] };
type StoredLink = { id: string; subject_id: string; notes: string | null; is_operating_system: boolean };

type PlannedLink = {
  subjectId: string;
  technologyId: string;
  /** Trimmed label, empty when the link has no version. */
  versionLabel: string;
  notes: string;
  /** Insert the link, or replace its notes. An operating-system mark alone does not. */
  writeLink: boolean;
  /**
   * `yes` on a server link that is not the operating system yet, or an empty cell on a link the
   * import creates, when the server page would mark it (see `plan`).
   */
  markOperatingSystem: boolean;
  outcome: 'inserted' | 'updated' | 'unchanged';
  /** The version the label finds (as written or by a prefix rule); null: created as written. */
  versionId: string | null;
};

type SideSpec = {
  side: LinkSide;
  headers: readonly string[];
  /** The subject of each usable row, or the row's error. */
  resolve: (rows: CsvDataRow[], lookup: NameLookup) => Promise<(row: CsvDataRow) => Subject | ImportReportError>;
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
  async exportAssetLinks<F extends ExportFileFormat = 'csv'>(
    scope: 'data' | 'template',
    ctx: TechnologyLinksCsvContext,
    language: CsvLanguage = 'en',
    format: F = 'csv' as F,
  ): Promise<ListExportFile<F>> {
    const rows: string[][] = [];
    if (scope === 'data') {
      const stored: Array<{
        asset_reference: string | null; asset_name: string; item_number: number; technology_name: string; version: string | null;
        is_operating_system: boolean; notes: string | null; source: string;
      }> = await ctx.manager.query(
        `SELECT a.asset_reference, a.name AS asset_name, t.item_number, t.name AS technology_name, v.label AS version,
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
          row.asset_reference ?? '', row.asset_name, `TEC-${row.item_number}`, row.technology_name, row.version ?? '',
          formatCsvBoolean(row.is_operating_system, language), row.notes ?? '', sourceLabel(row.source, language),
        ]);
      }
    }
    return writeListExport({
      format,
      language,
      filename: scope === 'template' ? ASSET_LINKS_CSV_TEMPLATE : ASSET_LINKS_CSV_FILENAME,
      sheetNames: { en: 'Server technologies', fr: 'Technologies des serveurs', de: 'Server-Technologien', es: 'Tecnologías de servidores' },
      headers: [...ASSET_LINK_CSV_HEADERS],
      rows,
    });
  }

  /**
   * Add or update server links. The server matches by `asset_reference` (`AST-n`) when the cell is
   * filled, otherwise by name (unknown or several: a row error; a retired asset is accepted). A
   * reference and a name that name two different servers are a row error. `operating_system`
   * `yes` asks for the mark, `no` never sets one. An empty cell on a link the import creates
   * follows the server page: the link is marked when its technology is of family
   * `operating_system`, the asset is not a cluster and the server has no mark yet. The import
   * never clears a mark.
   */
  async importAssetLinks(request: ImportRequest, ctx: TechnologyLinksCsvContext): Promise<TechnologyLinksImportResult> {
    return this.importLinks(request, ctx, {
      side: 'asset',
      headers: ASSET_LINK_CSV_HEADERS,
      resolve: async (rows, lookup) => {
        const assets = await this.assetsByKey(
          ctx,
          rows.map((row) => cellOf(row, 'asset_reference').toUpperCase()),
          rows.some((row) => !cellOf(row, 'asset_reference') && cellOf(row, 'asset_name')),
        );
        const reads = readsInfrastructure(request.access);
        return (row) => {
          const reference = cellOf(row, 'asset_reference');
          const name = cellOf(row, 'asset_name');
          if (reference) {
            const hit = assets.byReference.get(reference.toUpperCase());
            if (!hit) return notFound(row.line, 'asset_reference', reference);
            if (name && name.toLowerCase() !== hit.name_key) {
              return rowError(
                row.line, 'asset_name', 'CSV_ASSET_REFERENCE_MISMATCH',
                `"${reference}" is the server "${hit.name}". Fix the reference or the name, or leave one of them empty.`,
                { value: reference, name: hit.name },
              );
            }
            return { id: hit.id, is_cluster: hit.is_cluster };
          }
          if (!name) {
            return rowError(row.line, 'asset_reference', 'CSV_ASSET_REQUIRED', 'Name the server by its reference (AST-n) or its name.');
          }
          return subjectByName(row.line, 'asset_name', name, assets.all, reads, lookup);
        };
      },
    });
  }

  // ==================== APPLICATIONS ====================

  /** Every declared application link the caller reads, by application, technology, version. */
  async exportApplicationLinks<F extends ExportFileFormat = 'csv'>(
    scope: 'data' | 'template',
    ctx: TechnologyLinksCsvContext,
    applications: ApplicationsScope,
    language: CsvLanguage = 'en',
    format: F = 'csv' as F,
  ): Promise<ListExportFile<F>> {
    const rows: string[][] = [];
    if (scope === 'data') {
      const params: unknown[] = [ctx.tenantId];
      const scopeSql = applications.scope
        ? (params.push(applications.scope.userId), `AND ${applicationParticipantCondition('a', `$${params.length}`)}`)
        : '';
      const stored: Array<{
        reference: string | null; application_name: string; item_number: number; technology_name: string;
        version: string | null; notes: string | null; source: string;
      }> = await ctx.manager.query(
        `SELECT a.sequential_id AS reference, a.name AS application_name, t.item_number, t.name AS technology_name,
                v.label AS version, l.notes, l.source
           FROM application_technologies l
           JOIN applications a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
           JOIN technologies t ON t.tenant_id = l.tenant_id AND t.id = l.technology_id
           LEFT JOIN technology_versions v ON v.tenant_id = l.tenant_id AND v.id = l.technology_version_id
          WHERE l.tenant_id = $1 ${scopeSql}
          ORDER BY lower(a.name), a.id, lower(t.name), t.id, lower(v.label) NULLS FIRST, l.id`,
        params,
      );
      for (const row of stored) {
        rows.push([
          row.reference ?? '', row.application_name, `TEC-${row.item_number}`, row.technology_name,
          row.version ?? '', row.notes ?? '', sourceLabel(row.source, language),
        ]);
      }
    }
    return writeListExport({
      format,
      language,
      filename: scope === 'template' ? APPLICATION_LINKS_CSV_TEMPLATE : APPLICATION_LINKS_CSV_FILENAME,
      sheetNames: { en: 'Application technologies', fr: 'Technologies des applications', de: 'Anwendungstechnologien', es: 'Tecnologías de aplicaciones' },
      headers: [...APPLICATION_LINK_CSV_HEADERS],
      rows,
    });
  }

  /**
   * Add or update application declarations. The application matches by `APP-n` when the reference
   * is filled, otherwise by name. One the caller does not read is unknown, as one that does not
   * exist.
   */
  async importApplicationLinks(
    request: ImportRequest,
    ctx: TechnologyLinksCsvContext,
    applications: ApplicationsScope,
  ): Promise<TechnologyLinksImportResult> {
    return this.importLinks(request, ctx, {
      side: 'application',
      headers: APPLICATION_LINK_CSV_HEADERS,
      resolve: async (rows, lookup) => {
        const apps = await this.applicationsByKey(
          ctx,
          applications,
          rows.map((row) => cellOf(row, 'application_reference')).filter((ref) => APP_REF_RE.test(ref)).map((ref) => ref.toUpperCase()),
          rows.some((row) => !cellOf(row, 'application_reference') && cellOf(row, 'application_name')),
        );
        const reads = !!request.access && hasLevel(request.access, 'applications', 'reader');
        return (row) => {
          const reference = cellOf(row, 'application_reference');
          if (reference) {
            const hit = APP_REF_RE.test(reference) ? apps.byReference.get(reference.toUpperCase()) : undefined;
            return hit ?? notFound(row.line, 'application_reference', reference);
          }
          const name = cellOf(row, 'application_name');
          if (!name) {
            return rowError(row.line, 'application_reference', 'CSV_APPLICATION_REQUIRED', 'Name the application by its reference (APP-n) or its name.');
          }
          return subjectByName(row.line, 'application_name', name, apps.all, reads, lookup);
        };
      },
    });
  }

  // ==================== SHARED ====================

  private async importLinks(
    request: ImportRequest,
    ctx: TechnologyLinksCsvContext,
    spec: SideSpec,
  ): Promise<TechnologyLinksImportResult> {
    const { file, dryRun, language } = request;
    const read = await readMasterDataFile({ file: uploadedBytes(file), fields: spec.headers, optional: OPTIONAL_COLUMNS, language });
    const lookup: NameLookup = { request, state: { matches: new Map(), refused: new Map() } };
    const report = (errors: ImportReportError[], warnings: ImportReportError[], counts = { inserted: 0, updated: 0, unchanged: 0 }) => ({
      ok: errors.length === 0, dryRun, total: read.rows.length, ...counts, errors, warnings,
      ignoredColumns: read.ignoredColumns, notices: read.notices,
      ...listedMatches(lookup.state.matches), ...listedRefusedProposals(lookup.state.refused),
    });
    if (read.headerError) return report([read.headerError], []);

    const planned = await this.plan(read.rows, ctx, spec, lookup);
    if (planned.errors.length > 0) return report(planned.errors, planned.warnings);
    const counts = { inserted: 0, updated: 0, unchanged: 0 };
    for (const row of planned.rows) counts[row.outcome] += 1;
    if (!dryRun) await this.write(spec.side, planned.rows, importProvenance(fixMulterFilename(file.originalname)), ctx);
    return report([], planned.warnings, counts);
  }

  /** Every row checked against the stored data, nothing written. Errors and warnings by physical line. */
  private async plan(
    rows: CsvDataRow[],
    ctx: TechnologyLinksCsvContext,
    spec: SideSpec,
    lookup: NameLookup,
  ): Promise<{ rows: PlannedLink[]; errors: ImportReportError[]; warnings: ImportReportError[] }> {
    const errors: ImportReportError[] = [];
    const warnings: ImportReportError[] = [];
    const usable = rows.filter((row) => rowProblemErrors(row).length === 0);
    const subjectOf = await spec.resolve(usable, lookup);
    const techs = await this.technologies(
      ctx,
      usable.map((row) => technologyItemNumber(cellOf(row, 'technology_reference'))).filter((n): n is number => n != null),
      usable.some((row) => !cellOf(row, 'technology_reference') && cellOf(row, 'technology_name')),
    );
    const versions = await this.versionsOf(ctx, [...techs.byItem.values()].map((tech) => tech.id));
    const subjects = new Map(usable.map((row) => [row, subjectOf(row)] as const));
    const stored = await this.storedLinks(ctx, spec.side, [...subjects.values()].flatMap((s) => ('row' in s ? [] : [s.id])));
    // A cluster with members has no operating system (a cluster without member may have one).
    const clustersWithMembersIds = spec.side === 'asset'
      ? await clustersWithMembers(ctx.manager, ctx.tenantId, [...subjects.values()].flatMap((s) => ('row' in s || !s.is_cluster ? [] : [s.id])))
      : new Set<string>();

    const seen = new Map<string, number>();
    const osClaim = new Map<string, string>();
    const markedSubjects = new Set([...stored.values()].filter((link) => link.is_operating_system).map((link) => link.subject_id));
    /** The first created OS link with an empty cell, per server: marked unless a `yes` row claims the server. */
    const autoMark = new Map<string, { index: number; line: number }>();
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
      const tech = resolveTechnology(line, cellOf(row, 'technology_reference'), cellOf(row, 'technology_name'), techs, errors, lookup);
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
      // The version the label finds: as written (case aside), else by a prefix rule unless the person
      // undid that match (lot I3 of 26.11.9); none, it is created as written.
      const versionMatch = versionLabel ? this.versionOfRow(line, tech, versionLabel, versions.get(tech.id) ?? [], lookup) : null;
      const versionId = versionMatch && versionMatch.kind !== 'none' ? versionMatch.row.id : null;
      // "No version" and a named version are two links (the key is NULLS NOT DISTINCT).
      const linkKey = `${subject.id}|${tech.id}|${versionId ?? `label:${versionLabel.toLowerCase()}`}`;
      const firstRow = seen.get(linkKey);
      if (firstRow != null) {
        errors.push(rowError(line, spec.side === 'asset' ? 'asset_name' : 'application_name', 'CSV_LINK_DUPLICATE', `This link is already on row ${firstRow}.`, { firstRow }));
        continue;
      }
      seen.set(linkKey, line);
      if (versionMatch?.kind === 'prefix' && !versionMatch.proposed) {
        noteNameMatch(lookup.state.matches, {
          column: 'version', name: null, value: versionLabel, target: versionMatch.row.label, ref: null,
          origin: 'server', reason: 'version', undoable: true,
        }, line);
      }
      // A label the technology does not have yet is a new link: it never matches the link without version.
      const link = versionLabel && !versionId ? null : stored.get(`${subject.id}|${tech.id}|${versionId ?? ''}`) ?? null;

      let markOperatingSystem = false;
      let autoCandidate = false;
      if (spec.side === 'asset') {
        // Yes and no in any of the four languages, as the other files read them.
        const raw = cellOf(row, 'operating_system');
        const os = parseCsvBoolean(raw);
        if (os === undefined) {
          errors.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_VALUE', `"${raw}" is not valid. Use yes or no.`, { value: raw }));
          continue;
        }
        if (os === true && !link?.is_operating_system) {
          const refused = refuseOperatingSystem(line, subject, tech, clustersWithMembersIds, markedSubjects, osClaim, linkKey);
          if (refused.length > 0) {
            errors.push(...refused);
            continue;
          }
          osClaim.set(subject.id, linkKey);
          markOperatingSystem = true;
        } else if (
          os === null && !link && tech.family === OS_FAMILY && !subject.is_cluster
          && !markedSubjects.has(subject.id) && !autoMark.has(subject.id)
        ) {
          autoCandidate = true;
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
        versionId,
      });
      if (autoCandidate) autoMark.set(subject.id, { index: planned.length - 1, line });
    }
    // As the server page: a new operating system on a server without one becomes its mark. An
    // explicit `yes` elsewhere in the file for that server wins.
    for (const [subjectId, { index, line }] of autoMark) {
      if (osClaim.has(subjectId)) continue;
      planned[index].markOperatingSystem = true;
      warnings.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_MARKED', 'Marked as the server\'s operating system: the server has none yet.'));
    }
    return { rows: planned, errors: errors.sort((a, b) => a.row - b.row), warnings: warnings.sort((a, b) => a.row - b.row) };
  }

  /**
   * The version a row's label finds (`matchVersionLabel`): Kad's proposal first, a version of the
   * technology by its label, case aside (a match of origin model, noted; otherwise refused); then the
   * label as written, else by a prefix rule unless the person undid that match.
   */
  private versionOfRow(
    line: number,
    tech: TechRow,
    label: string,
    versions: Array<{ id: string; label: string }>,
    { request, state }: NameLookup,
  ): (VersionLabelMatch<{ id: string; label: string }> & { proposed?: boolean }) {
    const undone = undoneMatch(request.unmatched, 'version', label);
    const proposal = undone ? undefined : proposalFor(request.proposals, 'version', label);
    if (proposal !== undefined) {
      const proposed = readsInfrastructure(request.access) ? matchVersionLabel(versions, proposal, { prefix: false }) : { kind: 'none' as const };
      if (proposed.kind !== 'none') {
        noteNameMatch(state.matches, {
          column: 'version', name: null, value: label, target: proposed.row.label, ref: null, origin: 'model', reason: 'model', undoable: true,
        }, line);
        return { ...proposed, proposed: true };
      }
      noteRefusedProposal(state.refused, { column: 'version', name: null, value: label, target: proposal, reason: 'missing' }, line);
    }
    return matchVersionLabel(versions, label, { prefix: !undone });
  }

  /** Through the screens' services. An existing link keeps its provenance (`keepExistingProvenance`). */
  private async write(side: LinkSide, rows: PlannedLink[], provenance: LinkProvenance, ctx: TechnologyLinksCsvContext) {
    const opts: LinkOpts = { manager: ctx.manager, tenantId: ctx.tenantId, userId: ctx.userId ?? null };
    for (const row of rows) {
      if (!row.writeLink && !row.markOperatingSystem) continue;
      // The version the check found, or the label it announced as created, written as it is.
      const body = {
        ...(row.versionId
          ? { technology_version_id: row.versionId }
          : row.versionLabel ? { version_label: row.versionLabel, version_label_as_written: true } : {}),
        ...(row.notes !== '' ? { notes: row.notes } : {}),
      };
      if (side === 'application') {
        if (row.writeLink) {
          await this.links.setApplicationTechnology(row.subjectId, row.technologyId, true, body, opts, provenance, { keepExistingProvenance: true });
        }
        continue;
      }
      // A mark alone: the call finds the existing link and leaves it as stored.
      const written = await this.links.addAssetLink(row.technologyId, row.subjectId, body, opts, provenance, { keepExistingProvenance: true });
      if (row.markOperatingSystem && written.link_id) {
        // Not requested: the service marks the link when the server has no mark, never deletes one.
        await this.operatingSystems.onAssetLinkAdded(ctx.manager, ctx.tenantId, row.subjectId, written.link_id, provenance.source, opts.userId, false);
      }
    }
  }

  /** The servers the rows name by reference, and every server when a row names one by name (found beyond case in JS). */
  private async assetsByKey(ctx: TechnologyLinksCsvContext, references: string[], byName: boolean): Promise<Subjects> {
    const refs = unique(references);
    if (refs.length === 0 && !byName) return indexSubjects([]);
    const rows: SubjectRow[] = await ctx.manager.query(
      `SELECT id::text AS id, btrim(name) AS name, lower(btrim(name)) AS name_key, upper(asset_reference) AS reference_key,
              COALESCE(is_cluster, false) AS is_cluster
         FROM assets
        WHERE tenant_id = $1 AND (upper(asset_reference) = ANY($2::text[]) OR $3::boolean)
        ORDER BY lower(btrim(name)), id`,
      [ctx.tenantId, refs, byName],
    );
    return indexSubjects(rows);
  }

  private async applicationsByKey(
    ctx: TechnologyLinksCsvContext,
    applications: ApplicationsScope,
    references: string[],
    byName: boolean,
  ): Promise<Subjects> {
    const refs = unique(references);
    if (refs.length === 0 && !byName) return indexSubjects([]);
    const params: unknown[] = [ctx.tenantId, refs, byName];
    const scopeSql = applications.scope
      ? (params.push(applications.scope.userId), `AND ${applicationParticipantCondition('a', `$${params.length}`)}`)
      : '';
    const rows: SubjectRow[] = await ctx.manager.query(
      `SELECT a.id::text AS id, btrim(a.name) AS name, lower(btrim(a.name)) AS name_key, upper(a.sequential_id) AS reference_key, false AS is_cluster
         FROM applications a
        WHERE a.tenant_id = $1
          AND (upper(a.sequential_id) = ANY($2::text[]) OR $3::boolean)
          ${scopeSql}
        ORDER BY lower(btrim(a.name)), a.id`,
      params,
    );
    return indexSubjects(rows);
  }

  private async technologies(
    ctx: TechnologyLinksCsvContext,
    itemNumbers: number[],
    byName: boolean,
  ): Promise<Technologies> {
    const byItem = new Map<number, TechRow>();
    const numbers = [...new Set(itemNumbers)];
    if (numbers.length === 0 && !byName) return { byItem, all: [] };
    const rows: TechRow[] = await ctx.manager.query(
      `SELECT id::text AS id, btrim(name) AS name, item_number, family
         FROM technologies
        WHERE tenant_id = $1 AND (item_number = ANY($2::int[]) OR $3::boolean)
        ORDER BY lower(btrim(name)), id`,
      [ctx.tenantId, numbers, byName],
    );
    for (const row of rows) byItem.set(Number(row.item_number), row);
    return { byItem, all: rows };
  }

  /** The versions of each technology, by technology id (the version rule reads them all). */
  private async versionsOf(ctx: TechnologyLinksCsvContext, technologyIds: string[]): Promise<Map<string, Array<{ id: string; label: string }>>> {
    const wanted = unique(technologyIds);
    const rows: Array<{ id: string; technology_id: string; label: string }> = wanted.length
      ? await ctx.manager.query(
        `SELECT id::text AS id, technology_id::text AS technology_id, label
           FROM technology_versions WHERE tenant_id = $1 AND technology_id = ANY($2::uuid[])
          ORDER BY lower(label), id`,
        [ctx.tenantId, wanted],
      )
      : [];
    const byTechnology = new Map<string, Array<{ id: string; label: string }>>();
    for (const row of rows) byTechnology.set(row.technology_id, [...(byTechnology.get(row.technology_id) ?? []), row]);
    return byTechnology;
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
  const byReference = new Map<string, SubjectRow>();
  for (const row of rows) {
    if (row.reference_key) byReference.set(row.reference_key, row);
  }
  return { all: rows, byReference };
}

function readsInfrastructure(access: CsvCallerAccess | undefined): boolean {
  return !!access && hasLevel(access, 'infrastructure', 'reader');
}

function notFound(line: number, column: string, value: string): ImportReportError {
  return rowError(line, column, 'CSV_REFERENCE_NOT_FOUND', `"${value}" was not found.`, { value });
}

/**
 * The record of `rows` a name of the file finds (lot I3 of 26.11.9): Kad's proposal first, for a
 * person who `reads` the family; then the name exactly or case aside (several: refused, as before);
 * then accents aside for a person who reads the family and has not undone that match (several:
 * `CSV_NAME_AMBIGUOUS_AMONG`, named by reference). A match beyond case is noted. `missing` is the
 * error of a name nothing finds.
 */
function recordByName<T extends { name: string }>(
  line: number,
  column: string,
  name: string,
  rows: readonly T[],
  reads: boolean,
  { request, state }: NameLookup,
  ref: (row: T) => string | null,
  missing: () => ImportReportError,
): T | ImportReportError {
  const proposed = takeProposal(state, {
    proposals: request.proposals, unmatched: request.unmatched, column, value: name, line, rows, reads, caseBlind: false, ref,
  });
  if (proposed) return proposed;
  const key = name.trim().toLowerCase();
  const hits = rows.filter((row) => row.name.trim().toLowerCase() === key);
  if (hits.length > 1) return rowError(line, column, 'CSV_NAME_AMBIGUOUS', `Several records are named "${name}".`, { value: name });
  if (hits.length === 1) return hits[0];
  if (!reads || undoneMatch(request.unmatched, column, name)) return missing();
  const found = findRecordByName(rows, name, { beyondCase: true, caseBlind: false, label: ref });
  if (found.kind === 'many') {
    const names = found.names.join(', ');
    return rowError(line, column, 'CSV_NAME_AMBIGUOUS_AMONG', `"${name}" may designate several records: ${names}`, { value: name, names });
  }
  if (found.kind === 'none') return missing();
  noteNameMatch(state.matches, {
    column, name: null, value: name.trim(), target: found.row.name.trim(), ref: ref(found.row), origin: 'server', reason: 'accents', undoable: true,
  }, line);
  return found.row;
}

/** The server or application a row names by name (`recordByName`). */
function subjectByName(line: number, column: string, name: string, rows: SubjectRow[], reads: boolean, lookup: NameLookup): Subject | ImportReportError {
  const found = recordByName(line, column, name, rows, reads, lookup, (row) => row.reference_key, () => notFound(line, column, name));
  return 'row' in found ? found : { id: found.id, is_cluster: found.is_cluster };
}

/**
 * By `TEC-n` when the reference is filled, otherwise by name. Unknown: adopt it from the catalog
 * first. A filled cell that is not a `TEC-n` reference is an error of its own.
 */
function resolveTechnology(
  line: number,
  reference: string,
  name: string,
  techs: Technologies,
  errors: ImportReportError[],
  lookup: NameLookup,
): TechRow | null {
  const notAdopted = (column: string, value: string) => rowError(
    line, column, 'CSV_TECHNOLOGY_NOT_ADOPTED', `Unknown technology "${value}". Adopt it from the catalog first.`, { value },
  );
  if (reference) {
    const number = technologyItemNumber(reference);
    if (number == null) {
      errors.push(rowError(
        line, 'technology_reference', 'CSV_TECHNOLOGY_REFERENCE_INVALID',
        `"${reference}" is not a technology reference. Use TEC-n, or leave the cell empty and fill technology_name.`, { value: reference },
      ));
      return null;
    }
    const tech = techs.byItem.get(number);
    if (!tech) errors.push(notAdopted('technology_reference', reference));
    return tech ?? null;
  }
  if (!name) {
    errors.push(rowError(line, 'technology_reference', 'CSV_TECHNOLOGY_REQUIRED', 'Name the technology by its reference (TEC-n) or its name.'));
    return null;
  }
  const found = recordByName(
    line, 'technology_name', name, techs.all, readsInfrastructure(lookup.request.access), lookup,
    (row) => `TEC-${row.item_number}`, () => notAdopted('technology_name', name),
  );
  if ('row' in found && 'code' in found) {
    errors.push(found);
    return null;
  }
  return found as TechRow;
}

/**
 * `yes` on a server link: refused when the technology is not an operating system, the asset is a
 * cluster with members, or the server has another mark (stored, or asked by an earlier row of the file). The
 * import never deletes a link, so it cannot move a mark the way the server screen does.
 */
function refuseOperatingSystem(
  line: number,
  subject: Subject,
  tech: TechRow,
  clustersWithMembersIds: Set<string>,
  markedSubjects: Set<string>,
  osClaim: Map<string, string>,
  linkKey: string,
): ImportReportError[] {
  const problems: ImportReportError[] = [];
  if (tech.family !== OS_FAMILY) {
    problems.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_FAMILY', 'Only a technology of the Operating system family can be marked as the server\'s operating system.'));
  }
  if (clustersWithMembersIds.has(subject.id)) {
    problems.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_CLUSTER', 'A cluster with members has no operating system.'));
  }
  if (problems.length > 0) return problems;
  // The row's own link is not marked (the caller checks), so a stored mark is another link's.
  const markedElsewhere = markedSubjects.has(subject.id);
  const claimedElsewhere = osClaim.has(subject.id) && osClaim.get(subject.id) !== linkKey;
  if (markedElsewhere || claimedElsewhere) {
    problems.push(rowError(line, 'operating_system', 'CSV_OPERATING_SYSTEM_TAKEN', 'This server already has another operating system. Remove it or unmark it in the Technologies section of the server page, or leave the cell empty.'));
  }
  return problems;
}

/**
 * The file name (already decoded from multer's latin1), trimmed and cut to the provenance limit
 * (`linkProvenance` refuses a longer one), whole code points only so a surrogate pair is never split.
 */
function importProvenance(originalName: string | undefined): LinkProvenance {
  let trimmed = '';
  for (const char of (originalName ?? '').trim()) {
    if (trimmed.length + char.length > SOURCE_REF_MAX) break;
    trimmed += char;
  }
  return linkProvenance('import', trimmed || null);
}

/** `TEC-n` to n, or null when the cell is not that reference. `TEC-01` is item 1. */
function technologyItemNumber(reference: string): number | null {
  const match = reference.trim().match(TEC_REF_RE);
  if (!match) return null;
  return parseItemNumber(match[1]);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}
