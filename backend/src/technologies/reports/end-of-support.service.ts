import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { applicationParticipantCondition } from '../../auth/business-contributor-scope';
import { languageOf, writeCsv } from '../../common/csv-sheet';
import { ItOpsSettingsService, type OperatingSystemOption } from '../../it-ops-settings/it-ops-settings.service';
import type { ApplicationsReach } from '../technology-links.service';
import { assetInServiceSql, inServiceSql, TechnologyReachService } from '../technology-reach.service';
import { technologyReference } from '../technology-rows';

/**
 * The "End of support" report (lot T4 of planning/cartographie-technologies): what reaches or has
 * reached its end of support within a horizon, what it touches, and the missing data that keeps the
 * report from answering. Servers and applications touched by a technology version come from the
 * deductions of `TechnologyReachService`; an operating system or a piece of hardware touches its
 * assets and what they carry (`assetsCarriedBy`), then the applications assigned to them; an
 * application touches the servers it is assigned to. Retired assets take no part.
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
  /** The technology, application or asset; null for an operating system (no record of its own yet). */
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
};

export type ReportWindow = { today: string; until: string };

const DAY = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD')`;

/**
 * The versions in use: named by a link to an asset in service, or declared by an application in
 * service (the rule of `countsOfTechnologies`).
 */
const USED_VERSIONS = `
  used AS (
    SELECT at.technology_version_id AS version_id FROM asset_technologies at
      JOIN assets a ON a.tenant_id = $1 AND a.id = at.asset_id AND ${assetInServiceSql('a')}
     WHERE at.tenant_id = $1 AND at.technology_version_id IS NOT NULL
    UNION
    SELECT d.technology_version_id FROM application_technologies d
      JOIN applications ap ON ap.tenant_id = $1 AND ap.id = d.application_id AND ${inServiceSql('ap')}
     WHERE d.tenant_id = $1 AND d.technology_version_id IS NOT NULL
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

/**
 * Where a support period stands on `today`, kept when it ended or ends by `until`. A standard end
 * passed with an extended end to come is extended support (dated by the extended end); both passed
 * is out of support (dated by the last end); a standard end within the horizon is upcoming. With
 * one date only, that date is the end.
 */
export function supportState(
  standard: string | null,
  extended: string | null,
  window: ReportWindow,
): { state: DeadlineState; date: string } | null {
  const first = standard ?? extended;
  if (!first) return null;
  const last = extended && extended > first ? extended : first;
  if (last < window.today) return { state: 'out_of_support', date: last };
  if (first < window.today) return { state: 'extended_support', date: last };
  if (first <= window.until) return { state: 'upcoming', date: first };
  return null;
}

/**
 * The operating systems of the assets, read from the IT Ops catalog `operatingSystems` (with its
 * support dates) and `assets.operating_system`. Isolated on purpose: lot T3 turns the operating
 * systems into technologies and replaces this source.
 */
export async function operatingSystemDeadlines(
  mg: EntityManager,
  tenantId: string,
  catalog: OperatingSystemOption[],
  window: ReportWindow,
): Promise<Candidate[]> {
  const ending = new Map<string, { os: OperatingSystemOption; state: DeadlineState; date: string }>();
  for (const os of catalog) {
    const support = supportState(os.standardSupportEnd ?? null, os.extendedSupportEnd ?? null, window);
    if (support) ending.set(os.code, { os, ...support });
  }
  if (ending.size === 0) return [];
  const rows: Array<{ code: string; ids: string[] }> = await mg.query(
    `SELECT a.operating_system AS code, array_agg(a.id::text ORDER BY a.name) AS ids
       FROM assets a
      WHERE a.tenant_id = $1 AND a.operating_system = ANY($2::text[]) AND ${assetInServiceSql('a')}
      GROUP BY a.operating_system`,
    [tenantId, Array.from(ending.keys())],
  );
  return rows.map((row) => {
    const { os, state, date } = ending.get(row.code)!;
    return {
      key: `operating_system:${row.code}`,
      type: 'operating_system' as const,
      item_id: null,
      item_name: os.label,
      item_reference: null,
      version_id: null,
      version: null,
      milestone: null,
      date,
      standard_support_end: os.standardSupportEnd ?? null,
      extended_support_end: os.extendedSupportEnd ?? null,
      state,
      serverIds: row.ids,
      applicationIds: [],
    };
  });
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
    const settings = wants('operating_system') || wants('hardware') ? await this.itOps.getSettings(tenantId, { manager: mg }) : null;
    if (wants('technology')) candidates.push(...await this.technologyDeadlines(mg, tenantId, window));
    if (settings && wants('operating_system')) candidates.push(...await operatingSystemDeadlines(mg, tenantId, settings.operatingSystems ?? [], window));
    if (wants('application') && applications) candidates.push(...await this.applicationDeadlines(mg, tenantId, window, applications));
    if (settings && wants('hardware')) {
      const physical = (settings.serverKinds ?? []).filter((kind) => kind.is_physical === true).map((kind) => kind.code);
      candidates.push(...await this.hardwareDeadlines(mg, tenantId, window, physical));
    }

    // An operating system or a piece of hardware touches its assets and what they carry (the VMs of
    // a host), then the applications assigned to all of them.
    const named = candidates.filter((c) => c.type === 'operating_system' || c.type === 'hardware');
    if (named.length) {
      const carried = new Map<string, string[]>();
      for (const row of await this.reach.assetsCarriedBy(mg, tenantId, named.flatMap((c) => c.serverIds))) {
        if (!carried.has(row.asset_id)) carried.set(row.asset_id, []);
        carried.get(row.asset_id)!.push(row.carried_id);
      }
      for (const c of named) c.serverIds = Array.from(new Set([...c.serverIds, ...c.serverIds.flatMap((id) => carried.get(id) ?? [])]));
      if (applications) {
        const hosted = await this.applicationsOnAssets(mg, tenantId, named.flatMap((c) => c.serverIds));
        for (const c of named) c.applicationIds = Array.from(new Set(c.serverIds.flatMap((id) => hosted.get(id) ?? [])));
      }
    }

    const servers = await this.assetNames(mg, tenantId, candidates.flatMap((c) => c.serverIds));
    const apps = applications ? await this.visibleApplications(mg, tenantId, candidates.flatMap((c) => c.applicationIds), applications) : null;
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    const items: DeadlineRow[] = candidates.map(({ serverIds, applicationIds, ...row }) => {
      const serverRefs = Array.from(new Set(serverIds)).flatMap((id) => (servers.has(id) ? [{ id, name: servers.get(id)! }] : [])).sort(byName);
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

    const lonely: Array<{ id: string; name: string; item_number: number }> = await mg.query(
      `SELECT t.id, t.name, t.item_number FROM technologies t
        WHERE t.tenant_id = $1 AND t.mode = 'installed' AND t.lifecycle <> 'retired'
          AND NOT EXISTS (SELECT 1 FROM asset_technologies at WHERE at.tenant_id = $1 AND at.technology_id = t.id)`,
      [tenantId],
    );
    items.push(...lonely.map((r) => subject('technology_not_installed', 'technology', r.id, r.name, technologyReference(r.item_number))));

    // Servers with a database role: a technology of the database family installed on them or carried to them.
    const dbServers: Array<{ id: string; name: string }> = await mg.query(
      `SELECT a.id, a.name FROM assets a
        WHERE a.tenant_id = $1 AND ${assetInServiceSql('a')}
          AND EXISTS (
            SELECT 1 FROM app_asset_assignments x
              JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
              JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
             WHERE x.tenant_id = $1 AND x.asset_id = a.id AND x.role = 'db'
          )`,
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

    // Links without a version, on installed technologies and on those that have versions (a
    // subscribed service without versions is complete without one).
    {
      const params: unknown[] = [tenantId];
      const appLinks = applications
        ? `UNION ALL
           SELECT 'application' AS side, t.id, t.name, t.item_number, ap.id AS related_id, ap.name AS related_name
             FROM application_technologies d
             JOIN technologies t ON t.tenant_id = $1 AND t.id = d.technology_id
             JOIN applications ap ON ap.tenant_id = $1 AND ap.id = d.application_id AND ${inServiceSql('ap')} ${this.scopeSql('ap', params, applications)}
            WHERE d.tenant_id = $1 AND d.technology_version_id IS NULL
              AND (t.mode = 'installed' OR EXISTS (SELECT 1 FROM technology_versions v WHERE v.tenant_id = $1 AND v.technology_id = t.id))`
        : '';
      const rows: Array<{ side: 'asset' | 'application'; id: string; name: string; item_number: number; related_id: string; related_name: string }> = await mg.query(
        `SELECT 'asset' AS side, t.id, t.name, t.item_number, a.id AS related_id, a.name AS related_name
           FROM asset_technologies at
           JOIN technologies t ON t.tenant_id = $1 AND t.id = at.technology_id
           JOIN assets a ON a.tenant_id = $1 AND a.id = at.asset_id AND ${assetInServiceSql('a')}
          WHERE at.tenant_id = $1 AND at.technology_version_id IS NULL
            AND (t.mode = 'installed' OR EXISTS (SELECT 1 FROM technology_versions v WHERE v.tenant_id = $1 AND v.technology_id = t.id))
         ${appLinks}`,
        params,
      );
      items.push(...rows.map((r) => subject('link_without_version', 'technology', r.id, r.name, technologyReference(r.item_number), {
        related_type: r.side, related_id: r.related_id, related_name: r.related_name,
      })));
    }

    const undated: Array<{ id: string; name: string; item_number: number; label: string }> = await mg.query(
      `WITH ${USED_VERSIONS}
       SELECT t.id, t.name, t.item_number, v.label
         FROM used u
         JOIN technology_versions v ON v.tenant_id = $1 AND v.id = u.version_id
         JOIN technologies t ON t.tenant_id = $1 AND t.id = v.technology_id
        WHERE v.standard_support_end IS NULL AND v.extended_support_end IS NULL`,
      [tenantId],
    );
    items.push(...undated.map((r) => subject('version_without_end_date', 'technology', r.id, r.name, technologyReference(r.item_number), { version: r.label })));

    items.sort((a, b) => GAP_KINDS.indexOf(a.gap) - GAP_KINDS.indexOf(b.gap)
      || a.subject_name.localeCompare(b.subject_name, 'en', { sensitivity: 'base' })
      || String(a.related_name ?? a.version ?? '').localeCompare(String(b.related_name ?? b.version ?? ''), 'en', { sensitivity: 'base' }));
    return { applications_visible: !!applications, items };
  }

  /** One of the two lists as a CSV file (`list`: deadlines or gaps). */
  async csv(query: { list?: unknown; horizon_months?: unknown; type?: unknown; language?: unknown }, opts: ReportOpts, applications: ApplicationsReach) {
    const language = await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, query.language);
    const list = String(query.list ?? 'deadlines');
    if (list === 'gaps') {
      const { items } = await this.gaps(opts, applications);
      const headers = ['Missing data', 'Record type', 'Reference', 'Record', 'Linked to', 'Version'];
      const rows = items.map((r) => [GAP_LABELS[r.gap], RECORD_LABELS[r.subject_type], r.subject_reference ?? '', r.subject_name, r.related_name ?? '', r.version ?? '']);
      return { filename: 'end-of-support-gaps.csv', content: writeCsv({ language, headers, rows }) };
    }
    if (list !== 'deadlines') throw new BadRequestException('list must be deadlines or gaps.');
    const report = await this.deadlines(query, opts, applications);
    const headers = ['Type', 'Reference', 'Item', 'Version', 'Date', 'State', 'Servers', ...(applications ? ['Applications'] : []), 'Server names', ...(applications ? ['Application names'] : [])];
    const rows = report.items.map((r) => [
      TYPE_LABELS[r.type],
      r.item_reference ?? '',
      r.item_name,
      r.version ?? (r.milestone ? MILESTONE_LABELS[r.milestone] : ''),
      r.date,
      STATE_LABELS[r.state],
      String(r.server_count),
      ...(applications ? [String(r.application_count ?? 0)] : []),
      r.servers.map((s) => s.name).join(', '),
      ...(applications ? [(r.applications ?? []).map((a) => a.name).join(', ')] : []),
    ]);
    return { filename: `end-of-support-${report.horizon_months}-months.csv`, content: writeCsv({ language, headers, rows }) };
  }

  /** The versions in use whose support ended or ends within the window, with what they reach. */
  private async technologyDeadlines(mg: EntityManager, tenantId: string, window: ReportWindow): Promise<Candidate[]> {
    const rows: Array<{ version_id: string; label: string; technology_id: string; name: string; item_number: number; standard: string | null; extended: string | null }> = await mg.query(
      `WITH ${USED_VERSIONS}
       SELECT v.id AS version_id, v.label, t.id AS technology_id, t.name, t.item_number,
              ${DAY('v.standard_support_end')} AS standard, ${DAY('v.extended_support_end')} AS extended
         FROM used u
         JOIN technology_versions v ON v.tenant_id = $1 AND v.id = u.version_id
         JOIN technologies t ON t.tenant_id = $1 AND t.id = v.technology_id
        WHERE COALESCE(v.standard_support_end, v.extended_support_end) <= $2::date`,
      [tenantId, window.until],
    );
    const kept = rows.flatMap((row) => {
      const support = supportState(row.standard, row.extended, window);
      return support ? [{ row, support }] : [];
    });
    if (kept.length === 0) return [];
    const techIds = Array.from(new Set(kept.map((k) => k.row.technology_id)));
    const assets = await this.reach.assetsOfTechnologies(mg, tenantId, techIds);
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
    const serversByVersion = group(assets.map((a) => [a.technology_version_id, a.asset_id]));
    const appsByVersion = group(apps.map((a) => [a.technology_version_id, a.application_id]));
    return kept.map(({ row, support }) => ({
      key: `technology:${row.version_id}`,
      type: 'technology' as const,
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
    }));
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
         JOIN app_asset_assignments x ON x.tenant_id = $1 AND x.app_instance_id = i.id
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

  /** The applications in service assigned to each asset of `assetIds` (direct assignments). */
  private async applicationsOnAssets(mg: EntityManager, tenantId: string, assetIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const wanted = Array.from(new Set(assetIds));
    if (wanted.length === 0) return out;
    const rows: Array<{ asset_id: string; application_id: string }> = await mg.query(
      `SELECT DISTINCT x.asset_id, i.application_id
         FROM app_asset_assignments x
         JOIN app_instances i ON i.tenant_id = $1 AND i.id = x.app_instance_id
         JOIN applications ap ON ap.tenant_id = $1 AND ap.id = i.application_id AND ${inServiceSql('ap', 'i')}
        WHERE x.tenant_id = $1 AND x.asset_id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    for (const row of rows) {
      if (!out.has(row.asset_id)) out.set(row.asset_id, []);
      out.get(row.asset_id)!.push(row.application_id);
    }
    return out;
  }

  private async assetNames(mg: EntityManager, tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const wanted = Array.from(new Set(ids));
    if (wanted.length === 0) return new Map();
    const rows: Array<{ id: string; name: string }> = await mg.query(
      `SELECT id, name FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    return new Map(rows.map((row) => [row.id, row.name]));
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

const TYPE_LABELS: Record<DeadlineType, string> = {
  technology: 'Technology',
  operating_system: 'Operating system',
  application: 'Application',
  hardware: 'Hardware',
};

const RECORD_LABELS: Record<GapRow['subject_type'], string> = {
  application: 'Application',
  asset: 'Asset',
  technology: 'Technology',
};

const STATE_LABELS: Record<DeadlineState, string> = {
  out_of_support: 'Out of support',
  extended_support: 'Extended support',
  upcoming: 'Ends within the horizon',
};

const MILESTONE_LABELS: Record<'end_of_life' | 'support_contract', string> = {
  end_of_life: 'End of life',
  support_contract: 'Support contract',
};

const GAP_LABELS: Record<GapKind, string> = {
  application_without_server: 'Hosted application without a server',
  vm_without_host: 'Virtual machine without a host',
  technology_not_installed: 'Installed technology on no server',
  database_server_without_dbms: 'Database server without a database technology',
  sso_application_without_identity: 'Application with SSO without an identity technology',
  link_without_version: 'Technology link without a version',
  version_without_end_date: 'Version in use without an end of support date',
};
