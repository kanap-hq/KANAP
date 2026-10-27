import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { effectiveAssignmentsSql } from '../../app-asset-assignments/effective-assignments';
import { applicationParticipantCondition } from '../../auth/business-contributor-scope';
import type { CsvLanguage } from '../../common/csv-sheet/types';
import { fillLabel, type ReportCell, type ReportExport } from '../../common/report-export';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { shippedKeysWithoutPlannedEnd } from '../catalog/technology-catalog.service';
import type { ApplicationsReach } from '../technology-links.service';
import { assetInServiceSql, inServiceSql, TechnologyReachService } from '../technology-reach.service';
import { onPremHostingTypes } from '../hosting-type';
import { technologyReference } from '../technology-rows';
import { versionInUseSql, versionSupportSql } from './version-support';
import { END_OF_SUPPORT_EXPORT_LABELS } from './end-of-support-export-labels';

/**
 * The "End of support" report (lot T4 of planning/cartographie-technologies): what reaches or has
 * reached its end of support within a horizon, what it touches, and the missing data that keeps the
 * report from answering. Servers and applications touched by a technology version come from the
 * deductions of `TechnologyReachService`, its servers are those it is installed on
 * (`serversOfTechnologies`); an operating system or a piece of hardware touches its
 * assets and what they carry (`assetsCarriedBy`), then the applications that run on them; an
 * application touches the servers it runs on. Where an application runs is its effective
 * assignments (`effectiveAssignmentsSql`): on a cluster, the cluster and its members in service.
 * Retired assets take no part.
 *
 * Every statement is static SQL, carries `tenant_id` on every table and join besides RLS, and
 * reads a batch (`= ANY($n)`), never a query per row. Applications show only to a caller who reads
 * them, a Business Contributor's own only (`ApplicationsReach`): otherwise the application columns
 * are `null`, and the application rows and gaps are left out.
 */

export const HORIZONS = [6, 12, 24, 36] as const;
export const DEFAULT_HORIZON = 12;
export const DEADLINE_TYPES = ['technology', 'operating_system', 'application', 'hardware'] as const;
export const GAP_KINDS = [
  'application_without_server',
  'vm_without_host',
  'technology_not_installed',
  'technology_without_hosting_type',
  'database_server_without_dbms',
  'sso_application_without_identity',
  'link_without_version',
  'version_without_end_date',
] as const;

export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export type DeadlineState = 'out_of_support' | 'extended_support' | 'upcoming';
export type GapKind = (typeof GAP_KINDS)[number];
export type ReportOpts = { manager: EntityManager; tenantId: string; userId?: string | null };

export type ServerRef = { id: string; name: string };
export type ApplicationRef = { id: string; name: string; reference: string | null };

export type DeadlineRow = {
  key: string;
  type: DeadlineType;
  /** The technology, application or asset. An operating system is its technology. */
  item_id: string | null;
  item_name: string;
  item_reference: string | null;
  /** The technology version, null otherwise. */
  version_id: string | null;
  version: string | null;
  /** Hardware: the asset's end of life, or the end of its support contract. */
  milestone: 'end_of_life' | 'support_contract' | null;
  /** The date that matters: the end passed, or the next one to come. YYYY-MM-DD. */
  date: string;
  standard_support_end: string | null;
  extended_support_end: string | null;
  state: DeadlineState;
  server_count: number;
  servers: ServerRef[];
  application_count: number | null;
  applications: ApplicationRef[] | null;
};

export type GapRow = {
  key: string;
  gap: GapKind;
  /** The record to complete. */
  subject_type: 'application' | 'asset' | 'technology';
  subject_id: string;
  subject_name: string;
  subject_reference: string | null;
  /** The other end of a link without version. */
  related_type: 'asset' | 'application' | null;
  related_id: string | null;
  related_name: string | null;
  version: string | null;
};

/** One deadline before its servers and applications are named. */
type Candidate = Omit<DeadlineRow, 'server_count' | 'servers' | 'application_count' | 'applications'> & {
  serverIds: string[];
  applicationIds: string[];
  /** An operating system: the assets it reaches (installed or carried), whose applications it touches. */
  touchedIds?: string[];
};

export type ReportWindow = { today: string; until: string };

const DAY = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD')`;

/** The versions in use (`versionInUseSql`, shared with the assistant's technology reads). */
const USED_VERSIONS = `
  used AS (
    SELECT uv.id AS version_id FROM technology_versions uv
     WHERE uv.tenant_id = $1 AND ${versionInUseSql('uv')}
  )`;

export function horizonOf(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_HORIZON;
  const n = Number(value);
  if (!(HORIZONS as readonly number[]).includes(n)) throw new BadRequestException(`horizon_months must be one of ${HORIZONS.join(', ')}.`);
  return n;
}

export function typeOf(value: unknown): DeadlineType | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!(DEADLINE_TYPES as readonly string[]).includes(text)) throw new BadRequestException(`type must be one of ${DEADLINE_TYPES.join(', ')}.`);
  return text as DeadlineType;
}

@Injectable()
export class EndOfSupportService {
  constructor(
    private readonly reach: TechnologyReachService,
    private readonly itOps: ItOpsSettingsService,
  ) {}

  async window(mg: EntityManager, horizon: number): Promise<ReportWindow> {
    const [row]: Array<{ today: string; until: string }> = await mg.query(
      `SELECT ${DAY('CURRENT_DATE')} AS today, ${DAY(`(CURRENT_DATE + make_interval(months => $1::int))`)} AS until`,
      [horizon],
    );
    return row;
  }

  /** The deadlines within `horizon_months` (6, 12, 24 or 36; 12 by default), optionally of one `type`. */
  async deadlines(query: { horizon_months?: unknown; type?: unknown }, opts: ReportOpts, applications: ApplicationsReach) {
    const horizon = horizonOf(query.horizon_months);
    const type = typeOf(query.type);
    const { manager: mg, tenantId } = opts;
    const window = await this.window(mg, horizon);
    const wants = (t: DeadlineType) => !type || type === t;

    const candidates: Candidate[] = [];
    // An operating system is a technology version whose family is `operating_system`. One query
    // covers both types; the filter keeps the view the caller asked for.
    if (wants('technology') || wants('operating_system')) {
      candidates.push(...(await this.technologyDeadlines(mg, tenantId, window)).filter((row) => wants(row.type)));
    }
    const settings = wants('hardware') ? await this.itOps.getSettings(tenantId, { manager: mg }) : null;
    if (wants('application') && applications) candidates.push(...await this.applicationDeadlines(mg, tenantId, window, applications));
    if (settings && wants('hardware')) {
      const physical = (settings.serverKinds ?? []).filter((kind) => kind.is_physical === true).map((kind) => kind.code);
      candidates.push(...await this.hardwareDeadlines(mg, tenantId, window, physical));
    }

    // An operating system or a piece of hardware touches its assets and what they carry (the VMs of
    // a host), then the applications assigned to all of them.
    const named = candidates.filter((c) => c.type === 'operating_system' || c.type === 'hardware');
    if (named.length) {
      const touched = (c: Candidate) => c.touchedIds ?? c.serverIds;
      const carried = new Map<string, string[]>();
      for (const row of await this.reach.assetsCarriedBy(mg, tenantId, named.flatMap(touched))) {
        if (!carried.has(row.asset_id)) carried.set(row.asset_id, []);
        carried.get(row.asset_id)!.push(row.carried_id);
      }
      for (const c of named) {
        c.touchedIds = Array.from(new Set([...touched(c), ...touched(c).flatMap((id) => carried.get(id) ?? [])]));
        // A piece of hardware has no installation: its servers are the assets it carries.
        if (c.type === 'hardware') c.serverIds = c.touchedIds;
      }
      if (applications) {
        const hosted = await this.applicationsOnAssets(mg, tenantId, named.flatMap(touched));
        for (const c of named) c.applicationIds = Array.from(new Set(touched(c).flatMap((id) => hosted.get(id) ?? [])));
      }
    }

    // The servers of a version or an operating system are those of the list and the record
    // (`TechnologyReachService.serversOfTechnologies`, decision of 2026-10-24): in service, the
    // version installed on them, clusters excluded; the applications above still went through the
    // graph. Those of a piece of hardware: the assets it carries, clusters excluded, never itself
    // (K2-7). An application keeps the servers it is assigned to.
    const servers = await this.assetNames(mg, tenantId, candidates.flatMap((c) => c.serverIds));
    const apps = applications ? await this.visibleApplications(mg, tenantId, candidates.flatMap((c) => c.applicationIds), applications) : null;
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    const items: DeadlineRow[] = candidates.map(({ serverIds, applicationIds, touchedIds: _touched, ...row }) => {
      const counts = (id: string) => row.type === 'application' || (!servers.get(id)!.is_cluster && id !== row.item_id);
      const serverRefs = Array.from(new Set(serverIds)).flatMap((id) => (servers.has(id) && counts(id) ? [{ id, name: servers.get(id)!.name }] : [])).sort(byName);
      const appRefs = apps ? Array.from(new Set(applicationIds)).flatMap((id) => (apps.has(id) ? [apps.get(id)!] : [])).sort(byName) : null;
      return { ...row, server_count: serverRefs.length, servers: serverRefs, application_count: appRefs ? appRefs.length : null, applications: appRefs };
    });
    items.sort((a, b) => a.date.localeCompare(b.date)
      || DEADLINE_TYPES.indexOf(a.type) - DEADLINE_TYPES.indexOf(b.type)
      || a.item_name.localeCompare(b.item_name, 'en', { sensitivity: 'base' })
      || String(a.version ?? '').localeCompare(String(b.version ?? '')));
    return { horizon_months: horizon, today: window.today, until: window.until, applications_visible: !!applications, items };
  }

  /** The missing data, one row per record to complete. */
  async gaps(opts: ReportOpts, applications: ApplicationsReach) {
    const { manager: mg, tenantId } = opts;
    const items: GapRow[] = [];
    const subject = (gap: GapKind, type: GapRow['subject_type'], id: string, name: string, reference: string | null, extra: Partial<GapRow> = {}): GapRow => ({
      key: `${gap}:${id}${extra.related_id ? `:${extra.related_id}` : ''}${extra.version ? `:${extra.version}` : ''}`,
      gap,
      subject_type: type,
      subject_id: id,
      subject_name: name,
      subject_reference: reference,
      related_type: null,
      related_id: null,
      related_name: null,
      version: null,
      ...extra,
    });

    if (applications) {
      const params: unknown[] = [tenantId];
      const scope = this.scopeSql('ap', params, applications);
      const rows: Array<{ id: string; name: string; sequential_id: string | null }> = await mg.query(
        `SELECT ap.id, ap.name, ap.sequential_id FROM applications ap
          WHERE ap.tenant_id = $1 AND ${inServiceSql('ap')} AND ap.hosting_model IN ('on_premise', 'private_cloud') ${scope}
            -- The stored rows: an instance has an effective server exactly when it has a stored
            -- row (a member inherits only what its cluster carries), so this reads them directly.
            AND NOT EXISTS (
              SELECT 1 FROM app_instances i
                JOIN app_asset_assignments x ON x.tenant_id = $1 AND x.app_instance_id = i.id
               WHERE i.tenant_id = $1 AND i.application_id = ap.id AND ${inServiceSql('i')}
            )`,
        params,
      );
      items.push(...rows.map((r) => subject('application_without_server', 'application', r.id, r.name, r.sequential_id)));
    }

    const vms: Array<{ id: string; name: string }> = await mg.query(
      `SELECT a.id, a.name FROM assets a
        WHERE a.tenant_id = $1 AND a.kind = 'virtual_machine' AND ${assetInServiceSql('a')}
          AND NOT EXISTS (
            SELECT 1 FROM asset_relations r
             WHERE r.tenant_id = $1 AND r.relation_type = 'contains' AND r.related_asset_id = a.id
          )`,
      [tenantId],
    );
    items.push(...vms.map((r) => subject('vm_without_host', 'asset', r.id, r.name, null)));

    // A technology hosted on premises (a type of the `on_prem` category) runs on servers of the tenant.
    const { hostingTypes } = await this.itOps.getSettings(tenantId, { manager: mg });
    const onPrem = onPremHostingTypes(hostingTypes);
    const lonely: Array<{ id: string; name: string; item_number: number }> = await mg.query(
      `SELECT t.id, t.name, t.item_number FROM technologies t
        WHERE t.tenant_id = $1 AND t.hosting_type = ANY($2::text[]) AND t.lifecycle <> 'retired'
          AND NOT EXISTS (SELECT 1 FROM asset_technologies at WHERE at.tenant_id = $1 AND at.technology_id = t.id)`,
      [tenantId, onPrem],
    );
    items.push(...lonely.map((r) => subject('technology_not_installed', 'technology', r.id, r.name, technologyReference(r.item_number))));

    // A hosting type out of the tenant's catalog (a catalog emptied, a code removed by hand).
    const untyped: Array<{ id: string; name: string; item_number: number }> = await mg.query(
      `SELECT t.id, t.name, t.item_number FROM technologies t
        WHERE t.tenant_id = $1 AND t.lifecycle <> 'retired' AND NOT (t.hosting_type = ANY($2::text[]))`,
      [tenantId, (hostingTypes ?? []).map((item) => item.code)],
    );
    items.push(...untyped.map((r) => subject('technology_without_hosting_type', 'technology', r.id, r.name, technologyReference(r.item_number))));

    // Servers with a database role (effective: the members of a cluster that holds it too): a
    // technology of the database family installed on them or carried to them.
    const dbServers: Array<{ id: string; name: string }> = await mg.query(
      `SELECT DISTINCT a.id, a.name
         FROM (${effectiveAssignmentsSql({ tenant: '$1' })}) x
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
         JOIN assets a ON a.tenant_id = $1 AND a.id = x.asset_id AND ${assetInServiceSql('a')}
        WHERE x.role = 'db'`,
      [tenantId],
    );
    if (dbServers.length) {
      const reached = await this.reach.technologiesOfAssets(mg, tenantId, dbServers.map((r) => r.id));
      const families = await this.families(mg, tenantId, reached.map((r) => r.technology_id));
      const covered = new Set(reached.filter((r) => families.get(r.technology_id) === 'database').map((r) => r.subject_id));
      items.push(...dbServers.filter((r) => !covered.has(r.id)).map((r) => subject('database_server_without_dbms', 'asset', r.id, r.name, null)));
    }

    if (applications) {
      const params: unknown[] = [tenantId];
      const scope = this.scopeSql('ap', params, applications);
      const sso: Array<{ id: string; name: string; sequential_id: string | null }> = await mg.query(
        `SELECT ap.id, ap.name, ap.sequential_id FROM applications ap
          WHERE ap.tenant_id = $1 AND ${inServiceSql('ap')} ${scope}
            AND EXISTS (
              SELECT 1 FROM app_instances i
               WHERE i.tenant_id = $1 AND i.application_id = ap.id AND i.sso_enabled = true AND ${inServiceSql('i')}
            )`,
        params,
      );
      if (sso.length) {
        const reached = await this.reach.technologiesOfApplications(mg, tenantId, sso.map((r) => r.id));
        const families = await this.families(mg, tenantId, reached.map((r) => r.technology_id));
        const covered = new Set(reached.filter((r) => families.get(r.technology_id) === 'directory').map((r) => r.subject_id));
        items.push(...sso.filter((r) => !covered.has(r.id)).map((r) => subject('sso_application_without_identity', 'application', r.id, r.name, r.sequential_id)));
      }
    }

    // Links without a version, on technologies hosted on premises and on those that have versions
    // (a cloud service without versions is complete without one).
    {
      const params: unknown[] = [tenantId, onPrem];
      const appLinks = applications
        ? `UNION ALL
           SELECT 'application' AS side, t.id, t.name, t.item_number, ap.id AS related_id, ap.name AS related_name
             FROM application_technologies d
             JOIN technologies t ON t.tenant_id = $1 AND t.id = d.technology_id
             JOIN applications ap ON ap.tenant_id = $1 AND ap.id = d.application_id AND ${inServiceSql('ap')} ${this.scopeSql('ap', params, applications)}
            WHERE d.tenant_id = $1 AND d.technology_version_id IS NULL
              AND (t.hosting_type = ANY($2::text[]) OR EXISTS (SELECT 1 FROM technology_versions v WHERE v.tenant_id = $1 AND v.technology_id = t.id))`
        : '';
      const rows: Array<{ side: 'asset' | 'application'; id: string; name: string; item_number: number; related_id: string; related_name: string }> = await mg.query(
        `SELECT 'asset' AS side, t.id, t.name, t.item_number, a.id AS related_id, a.name AS related_name
           FROM asset_technologies at
           JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id
           JOIN assets a ON a.tenant_id = $1 AND a.id = at.asset_id AND ${assetInServiceSql('a')}
          WHERE at.tenant_id = $1 AND at.technology_version_id IS NULL
            AND (t.hosting_type = ANY($2::text[]) OR EXISTS (SELECT 1 FROM technology_versions v WHERE v.tenant_id = $1 AND v.technology_id = t.id))
         ${appLinks}`,
        params,
      );
      items.push(...rows.map((r) => subject('link_without_version', 'technology', r.id, r.name, technologyReference(r.item_number), {
        related_type: r.side, related_id: r.related_id, related_name: r.related_name,
      })));
    }

    // A shipped version the vendor marks with no planned end is not a missing date.
    const undated: Array<{ id: string; name: string; item_number: number; label: string }> = await mg.query(
      `WITH ${USED_VERSIONS}
       SELECT t.id, t.name, t.item_number, v.label
         FROM used u
         JOIN technology_versions v ON v.tenant_id = $1 AND v.id = u.version_id
         JOIN technologies t ON t.tenant_id = $1 AND t.id = v.technology_id
        WHERE v.standard_support_end IS NULL AND v.extended_support_end IS NULL
          AND (v.catalog_key IS NULL OR v.catalog_key <> ALL($2::text[]))`,
      [tenantId, shippedKeysWithoutPlannedEnd()],
    );
    items.push(...undated.map((r) => subject('version_without_end_date', 'technology', r.id, r.name, technologyReference(r.item_number), { version: r.label })));

    items.sort((a, b) => GAP_KINDS.indexOf(a.gap) - GAP_KINDS.indexOf(b.gap)
      || a.subject_name.localeCompare(b.subject_name, 'en', { sensitivity: 'base' })
      || String(a.related_name ?? a.version ?? '').localeCompare(String(b.related_name ?? b.version ?? ''), 'en', { sensitivity: 'base' }));
    return { applications_visible: !!applications, items };
  }

  /**
   * One of the two lists as a report table export (`list`: deadlines or gaps; common/report-export), in
   * the screen's words and order: the columns the CSV always had, the end date a date, the counts numbers,
   * and the application columns only for a caller who reads applications. `horizon_months` and `type`
   * belong to the deadlines.
   */
  async exportTable(
    query: { list?: unknown; horizon_months?: unknown; type?: unknown },
    language: CsvLanguage,
    opts: ReportOpts,
    applications: ApplicationsReach,
  ): Promise<ReportExport> {
    const labels = END_OF_SUPPORT_EXPORT_LABELS[language];
    const list = query.list === undefined || query.list === '' ? 'deadlines' : String(query.list);
    if (list === 'gaps') {
      if ((query.horizon_months ?? '') !== '' || (query.type ?? '') !== '') {
        throw new BadRequestException('horizon_months and type apply to the deadlines list only.');
      }
      const { items } = await this.gaps(opts, applications);
      const record = { application: labels.type_application, asset: labels.record_asset, technology: labels.type_technology };
      return {
        fileBase: 'end-of-support-gaps',
        limited: false,
        parameters: [[labels.view, labels.gapsSheet]],
        tables: [{
          key: 'gaps',
          sheet: labels.gapsSheet,
          columns: [
            { header: labels.missing, kind: 'text' },
            { header: labels.recordType, kind: 'text' },
            { header: labels.reference, kind: 'text' },
            { header: labels.record, kind: 'text' },
            { header: labels.linkedTo, kind: 'text' },
            { header: labels.version, kind: 'text' },
          ],
          rows: items.map((r): ReportCell[] => [
            labels[`gap_${r.gap}`], record[r.subject_type], r.subject_reference, r.subject_name, r.related_name, r.version,
          ]),
        }],
      };
    }
    if (list !== 'deadlines') throw new BadRequestException('list must be deadlines or gaps.');
    const report = await this.deadlines(query, opts, applications);
    const type = typeOf(query.type);
    const months = fillLabel(report.horizon_months === 1 ? labels.monthsOne : labels.monthsOther, 'count', String(report.horizon_months));
    const count = (value: number | null): ReportCell => ({ kind: 'number', value: value ?? 0 });
    return {
      fileBase: `end-of-support-${report.horizon_months}-months`,
      limited: false,
      parameters: [
        [labels.view, labels.deadlinesSheet],
        [labels.horizon, months],
        [labels.typeFilter, type ? labels[`type_${type}`] : labels.allTypes],
      ],
      tables: [{
        key: 'deadlines',
        sheet: labels.deadlinesSheet,
        columns: [
          { header: labels.type, kind: 'text' },
          { header: labels.reference, kind: 'text' },
          { header: labels.item, kind: 'text' },
          { header: labels.version, kind: 'text' },
          { header: labels.date, kind: 'date' },
          { header: labels.state, kind: 'text' },
          { header: labels.servers, kind: 'number' },
          ...(applications ? [{ header: labels.applications, kind: 'number' as const }] : []),
          { header: labels.serverNames, kind: 'text' },
          ...(applications ? [{ header: labels.applicationNames, kind: 'text' as const }] : []),
        ],
        rows: report.items.map((r): ReportCell[] => [
          labels[`type_${r.type}`],
          r.item_reference,
          r.item_name,
          r.version ?? (r.milestone ? labels[`milestone_${r.milestone}`] : null),
          { kind: 'date', iso: r.date },
          labels[`state_${r.state}`],
          count(r.server_count),
          ...(applications ? [count(r.application_count)] : []),
          r.servers.map((s) => s.name).join(', '),
          ...(applications ? [(r.applications ?? []).map((a) => a.name).join(', ')] : []),
        ]),
      }],
    };
  }

  /**
   * The versions in use whose support ended or ends within the window, with what they reach. The
   * state and its date follow `versionSupportSql`: a version still supported is upcoming here.
   */
  private async technologyDeadlines(mg: EntityManager, tenantId: string, window: ReportWindow): Promise<Candidate[]> {
    const support = versionSupportSql('v', '$3::date');
    const rows: Array<{
      version_id: string; label: string; technology_id: string; name: string; item_number: number; family: string;
      standard: string | null; extended: string | null; state: 'out_of_support' | 'extended_support' | 'supported'; date: string;
    }> = await mg.query(
      `WITH ${USED_VERSIONS}
       SELECT v.id AS version_id, v.label, t.id AS technology_id, t.name, t.item_number, t.family,
              ${DAY('v.standard_support_end')} AS standard, ${DAY('v.extended_support_end')} AS extended,
              ${support.state} AS state, ${DAY(support.date)} AS date
         FROM used u
         JOIN technology_versions v ON v.tenant_id = $1 AND v.id = u.version_id
         JOIN technologies t ON t.tenant_id = $1 AND t.id = v.technology_id
        WHERE ${support.first} <= $2::date`,
      [tenantId, window.until, window.today],
    );
    const kept = rows.map((row) => ({
      row,
      support: { state: row.state === 'supported' ? 'upcoming' as const : row.state, date: row.date },
    }));
    if (kept.length === 0) return [];
    const techIds = Array.from(new Set(kept.map((k) => k.row.technology_id)));
    const servers = await this.reach.serversOfTechnologies(mg, tenantId, techIds);
    // The assets an operating system reaches, whose applications it touches.
    const osIds = Array.from(new Set(kept.filter((k) => k.row.family === 'operating_system').map((k) => k.row.technology_id)));
    const assets = await this.reach.assetsOfTechnologies(mg, tenantId, osIds);
    const apps = await this.reach.applicationsOfTechnologies(mg, tenantId, techIds);
    const group = (pairs: Array<[string | null, string]>) => {
      const out = new Map<string, Set<string>>();
      for (const [version, id] of pairs) {
        if (!version) continue;
        if (!out.has(version)) out.set(version, new Set());
        out.get(version)!.add(id);
      }
      return out;
    };
    const serversByVersion = group(servers.map((a) => [a.technology_version_id, a.asset_id]));
    const touchedByVersion = group(assets.map((a) => [a.technology_version_id, a.asset_id]));
    const appsByVersion = group(apps.map((a) => [a.technology_version_id, a.application_id]));
    return kept.map(({ row, support }) => {
      const type = row.family === 'operating_system' ? 'operating_system' as const : 'technology' as const;
      return {
      key: `${type}:${row.version_id}`,
      type,
      item_id: row.technology_id,
      item_name: row.name,
      item_reference: technologyReference(row.item_number),
      version_id: row.version_id,
      version: row.label,
      milestone: null,
      date: support.date,
      standard_support_end: row.standard,
      extended_support_end: row.extended,
      state: support.state,
      serverIds: Array.from(serversByVersion.get(row.version_id) ?? []),
      applicationIds: Array.from(appsByVersion.get(row.version_id) ?? []),
      ...(type === 'operating_system' ? { touchedIds: Array.from(touchedByVersion.get(row.version_id) ?? []) } : {}),
      };
    });
  }

  /** Applications in service whose end of support passed or falls within the window. */
  private async applicationDeadlines(mg: EntityManager, tenantId: string, window: ReportWindow, applications: NonNullable<ApplicationsReach>): Promise<Candidate[]> {
    const params: unknown[] = [tenantId, window.until];
    const scope = this.scopeSql('ap', params, applications);
    const rows: Array<{ id: string; name: string; sequential_id: string | null; day: string }> = await mg.query(
      `SELECT ap.id, ap.name, ap.sequential_id, ${DAY('ap.end_of_support_date')} AS day
         FROM applications ap
        WHERE ap.tenant_id = $1 AND ${inServiceSql('ap')} AND ap.end_of_support_date <= $2::date ${scope}`,
      params,
    );
    if (rows.length === 0) return [];
    const servers: Array<{ application_id: string; asset_id: string }> = await mg.query(
      `SELECT DISTINCT i.application_id, x.asset_id
         FROM app_instances i
         JOIN (${effectiveAssignmentsSql({ tenant: '$1', applications: '$2' })}) x ON x.tenant_id = $1 AND x.app_instance_id = i.id
        WHERE i.tenant_id = $1 AND i.application_id = ANY($2::uuid[]) AND ${inServiceSql('i')}`,
      [tenantId, rows.map((r) => r.id)],
    );
    return rows.map((row) => ({
      key: `application:${row.id}`,
      type: 'application' as const,
      item_id: row.id,
      item_name: row.name,
      item_reference: row.sequential_id,
      version_id: null,
      version: null,
      milestone: null,
      date: row.day,
      standard_support_end: row.day,
      extended_support_end: null,
      state: row.day < window.today ? 'out_of_support' as const : 'upcoming' as const,
      serverIds: servers.filter((s) => s.application_id === row.id).map((s) => s.asset_id),
      applicationIds: [row.id],
    }));
  }

  /**
   * Physical assets in service (a kind marked physical in the IT Ops catalog `serverKinds`, not a
   * cluster) at their end of life, or at the end of their support contract, within the window.
   */
  private async hardwareDeadlines(mg: EntityManager, tenantId: string, window: ReportWindow, physicalKinds: string[]): Promise<Candidate[]> {
    if (physicalKinds.length === 0) return [];
    const rows: Array<{ id: string; name: string; milestone: 'end_of_life' | 'support_contract'; day: string }> = await mg.query(
      `SELECT a.id, a.name, 'end_of_life' AS milestone, ${DAY('a.end_of_life_date')} AS day
         FROM assets a
        WHERE a.tenant_id = $1 AND ${assetInServiceSql('a')} AND a.end_of_life_date <= $2::date
          AND a.kind = ANY($3::text[]) AND a.is_cluster IS NOT TRUE
       UNION ALL
       SELECT a.id, a.name, 'support_contract', ${DAY('s.support_expiry')}
         FROM asset_support_info s
         JOIN assets a ON a.tenant_id = $1 AND a.id = s.asset_id AND ${assetInServiceSql('a')}
                      AND a.kind = ANY($3::text[]) AND a.is_cluster IS NOT TRUE
        WHERE s.tenant_id = $1 AND s.support_expiry <= $2::date`,
      [tenantId, window.until, physicalKinds],
    );
    return rows.map((row) => ({
      key: `hardware:${row.milestone}:${row.id}`,
      type: 'hardware' as const,
      item_id: row.id,
      item_name: row.name,
      item_reference: null,
      version_id: null,
      version: null,
      milestone: row.milestone,
      date: row.day,
      standard_support_end: null,
      extended_support_end: null,
      state: row.day < window.today ? 'out_of_support' as const : 'upcoming' as const,
      serverIds: [row.id],
      applicationIds: [],
    }));
  }

  /**
   * The applications in service that run on each asset of `assetIds` (effective assignments: a
   * member runs what its clusters carry).
   */
  private async applicationsOnAssets(mg: EntityManager, tenantId: string, assetIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const wanted = Array.from(new Set(assetIds));
    if (wanted.length === 0) return out;
    const rows: Array<{ asset_id: string; application_id: string }> = await mg.query(
      `SELECT DISTINCT x.asset_id, i.application_id
         FROM (${effectiveAssignmentsSql({ tenant: '$1', assets: '$2' })}) x
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}`,
      [tenantId, wanted],
    );
    for (const row of rows) {
      if (!out.has(row.asset_id)) out.set(row.asset_id, []);
      out.get(row.asset_id)!.push(row.application_id);
    }
    return out;
  }

  private async assetNames(mg: EntityManager, tenantId: string, ids: string[]): Promise<Map<string, { name: string; is_cluster: boolean }>> {
    const wanted = Array.from(new Set(ids));
    if (wanted.length === 0) return new Map();
    const rows: Array<{ id: string; name: string; is_cluster: boolean }> = await mg.query(
      `SELECT id, name, COALESCE(is_cluster, false) AS is_cluster FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    return new Map(rows.map((row) => [row.id, { name: row.name, is_cluster: row.is_cluster }]));
  }

  /** The applications of `ids` the caller sees, with their name and reference. */
  private async visibleApplications(mg: EntityManager, tenantId: string, ids: string[], applications: NonNullable<ApplicationsReach>): Promise<Map<string, ApplicationRef>> {
    const wanted = Array.from(new Set(ids));
    if (wanted.length === 0) return new Map();
    const params: unknown[] = [tenantId, wanted];
    const scope = this.scopeSql('ap', params, applications);
    const rows: Array<{ id: string; name: string; sequential_id: string | null }> = await mg.query(
      `SELECT ap.id, ap.name, ap.sequential_id FROM applications ap WHERE ap.tenant_id = $1 AND ap.id = ANY($2::uuid[]) ${scope}`,
      params,
    );
    return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name, reference: row.sequential_id }]));
  }

  private async families(mg: EntityManager, tenantId: string, technologyIds: string[]): Promise<Map<string, string>> {
    const wanted = Array.from(new Set(technologyIds));
    if (wanted.length === 0) return new Map();
    const rows: Array<{ id: string; family: string }> = await mg.query(
      `SELECT id, family FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    return new Map(rows.map((row) => [row.id, row.family]));
  }

  /** A Business Contributor's participation condition on `alias`, its parameter appended to `params`. */
  private scopeSql(alias: string, params: unknown[], applications: NonNullable<ApplicationsReach>): string {
    if (!applications.scope) return '';
    params.push(applications.scope.userId);
    return `AND ${applicationParticipantCondition(alias, `$${params.length}`)}`;
  }
}
