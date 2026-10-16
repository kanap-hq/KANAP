import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { applicationParticipantCondition, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { languageOf, writeCsv } from '../common/csv-sheet';
import { readTechnology, technologyReference, UUID_RE } from '../technologies/technology-rows';
import { TechnologyReachService } from '../technologies/technology-reach.service';
import { VulnerabilityMatchService } from './vulnerability-match.service';
import { severityOf, VULNERABILITY_STATES, type MatchBasis, type VulnerabilityState } from './vulnerability-rules';

export type VulnOpts = { manager: EntityManager; tenantId: string; userId?: string | null };
/** The applications the caller reads: null without the `applications` read right, a Business Contributor's own only. */
export type ApplicationsAccess = { scope?: ParticipationAccessScope } | null;

export type VulnerabilityFilters = {
  severity?: unknown;
  state?: unknown;
  editor?: unknown;
  technology?: unknown;
  from?: unknown;
  to?: unknown;
  q?: unknown;
  limit?: unknown;
  offset?: unknown;
};

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITY_ORDER = `CASE c.severity WHEN 'critical' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 WHEN 'none' THEN 1 ELSE 0 END`;

type Row = {
  id: string;
  technology_id: string;
  technology_version_id: string | null;
  cve_id: string;
  state: VulnerabilityState;
  note: string | null;
  match_basis: MatchBasis;
  matching: boolean;
  detected_at: Date;
  state_changed_at: Date | null;
  state_changed_by_name: string | null;
  technology_name: string;
  technology_item_number: number;
  editor: string | null;
  version_label: string | null;
};

type Cve = {
  cve_id: string;
  summary: string | null;
  cvss_score: string | null;
  severity: string | null;
  cvss_version: string | null;
  cvss_vector: string | null;
  published_at: Date | null;
  last_modified_at: Date | null;
  nvd_status: string | null;
  reference_urls: string[];
};

function commaList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return Array.from(new Set(raw.split(',').map((v) => v.trim()).filter(Boolean)));
}

function cveIdOrThrow(value: unknown): string {
  const id = String(value ?? '').trim().toUpperCase();
  if (!CVE_RE.test(id)) throw new NotFoundException('Vulnerability not found');
  return id;
}

function presentCve(c: Cve) {
  return {
    cve_id: c.cve_id,
    summary: c.summary,
    cvss_score: c.cvss_score == null ? null : Number(c.cvss_score),
    severity: c.severity,
    cvss_version: c.cvss_version,
    published_at: c.published_at,
    last_modified_at: c.last_modified_at,
    nvd_status: c.nvd_status,
  };
}

function presentRow(r: Row) {
  return {
    id: r.id,
    technology_version_id: r.technology_version_id,
    version_label: r.version_label,
    /** No version named: the technology is in use with links that name none. */
    potential: r.match_basis === 'version_unknown',
    match_basis: r.match_basis,
    matching: r.matching,
    state: r.state,
    note: r.note,
    state_changed_at: r.state_changed_at,
    state_changed_by_name: r.state_changed_by_name,
    detected_at: r.detected_at,
  };
}

/** Rows of one CVE grouped per technology, versions by label (unknown version last). */
function groupByTechnology(rows: Row[]) {
  const byTech = new Map<string, { technology_id: string; reference: string | null; name: string; editor: string | null; versions: ReturnType<typeof presentRow>[] }>();
  for (const r of rows) {
    const entry = byTech.get(r.technology_id) ?? {
      technology_id: r.technology_id,
      reference: technologyReference(r.technology_item_number),
      name: r.technology_name,
      editor: r.editor,
      versions: [],
    };
    entry.versions.push(presentRow(r));
    byTech.set(r.technology_id, entry);
  }
  const list = Array.from(byTech.values());
  for (const t of list) {
    t.versions.sort((a, b) => (a.version_label == null ? 1 : 0) - (b.version_label == null ? 1 : 0)
      || String(a.version_label ?? '').localeCompare(String(b.version_label ?? ''), 'en', { numeric: true }));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

const rowKey = (technologyId: string, versionId: string | null) => `${technologyId}|${versionId ?? ''}`;

/**
 * The vulnerabilities of a tenant (lot T6a): the rows of `technology_vulnerabilities` with the
 * CVE of the platform cache, and the servers and applications they reach through the deductions
 * of the technology layer (`TechnologyReachService`). A row with a version reaches the servers and
 * applications whose link names that version; a row without version, those whose link names none.
 */
@Injectable()
export class VulnerabilitiesService {
  constructor(
    private readonly reach: TechnologyReachService,
    private readonly matcher: VulnerabilityMatchService,
    private readonly audit: AuditService,
  ) {}

  /** The WHERE clause of the filters, on `tv` (rows), `t` (technologies) and `c` (cache). */
  private async filterSql(mg: EntityManager, tenantId: string, filters: VulnerabilityFilters, params: unknown[]): Promise<string> {
    const where: string[] = [];
    const push = (value: unknown) => { params.push(value); return `$${params.length}`; };
    const severities = commaList(filters.severity);
    if (severities.length) {
      const valid = severities.map(severityOf);
      if (valid.some((s) => !s)) throw new BadRequestException('severity must be critical, high, medium, low or none.');
      where.push(`c.severity = ANY(${push(valid)}::text[])`);
    }
    const states = commaList(filters.state);
    if (states.length) {
      if (states.some((s) => !(VULNERABILITY_STATES as readonly string[]).includes(s))) {
        throw new BadRequestException('state must be to_review, handled or not_affected.');
      }
      where.push(`tv.state = ANY(${push(states)}::text[])`);
    }
    const editors = commaList(filters.editor).map((e) => e.toLowerCase());
    if (editors.length) where.push(`lower(t.editor) = ANY(${push(editors)}::text[])`);
    const technologies = commaList(filters.technology);
    if (technologies.length) {
      const ids: string[] = [];
      for (const ref of technologies) ids.push((await readTechnology(mg, tenantId, ref)).id);
      where.push(`tv.technology_id = ANY(${push(ids)}::uuid[])`);
    }
    for (const [key, op] of [['from', '>='], ['to', '<']] as const) {
      const value = String(filters[key] ?? '').trim();
      if (!value) continue;
      if (!DAY_RE.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequestException(`${key} must be a day (YYYY-MM-DD).`);
      // `to` is inclusive: before the next day.
      where.push(key === 'from' ? `c.published_at ${op} ${push(value)}::date` : `c.published_at ${op} (${push(value)}::date + 1)`);
    }
    const q = String(filters.q ?? '').trim();
    if (q) {
      const like = push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`(tv.cve_id ILIKE ${like} OR t.name ILIKE ${like} OR c.summary ILIKE ${like})`);
    }
    return where.length ? `AND ${where.join(' AND ')}` : '';
  }

  private readonly rowsFrom = `
    FROM technology_vulnerabilities tv
    JOIN technologies t ON t.tenant_id = tv.tenant_id AND t.id = tv.technology_id
    JOIN vulnerability_cves c ON c.cve_id = tv.cve_id`;

  private async rowsOf(mg: EntityManager, tenantId: string, extraWhere: string, params: unknown[]): Promise<Row[]> {
    return mg.query(
      `SELECT tv.id, tv.technology_id, tv.technology_version_id, tv.cve_id, tv.state, tv.note, tv.match_basis, tv.matching,
              tv.detected_at, tv.state_changed_at,
              NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS state_changed_by_name,
              t.name AS technology_name, t.item_number AS technology_item_number, t.editor, v.label AS version_label
         ${this.rowsFrom}
         LEFT JOIN technology_versions v ON v.tenant_id = tv.tenant_id AND v.id = tv.technology_version_id
         LEFT JOIN users u ON u.tenant_id = tv.tenant_id AND u.id = tv.state_changed_by
        WHERE tv.tenant_id = $1 ${extraWhere}
        ORDER BY t.name, v.label NULLS LAST`,
      params,
    );
  }

  private async cves(mg: EntityManager, ids: string[]): Promise<Map<string, Cve>> {
    const rows: Cve[] = ids.length
      ? await mg.query(
        `SELECT cve_id, summary, cvss_score, severity, cvss_version, cvss_vector, published_at, last_modified_at, nvd_status, reference_urls
           FROM vulnerability_cves WHERE cve_id = ANY($1::text[])`,
        [ids],
      )
      : [];
    return new Map(rows.map((r) => [r.cve_id, r]));
  }

  private async visibleApplicationIds(mg: EntityManager, tenantId: string, ids: string[], scope?: ParticipationAccessScope): Promise<Set<string>> {
    const wanted = Array.from(new Set(ids));
    if (wanted.length === 0) return new Set();
    const params: unknown[] = [tenantId, wanted];
    const scopeSql = scope ? (params.push(scope.userId), `AND ${applicationParticipantCondition('a', `$${params.length}`)}`) : '';
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT a.id::text AS id FROM applications a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[]) ${scopeSql}`,
      params,
    );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * What the rows reach: per (technology, version) key, the servers (reached assets) and the
   * visible applications (hosted or declared). Applications are null without the read right.
   */
  private async reachOf(mg: EntityManager, tenantId: string, rows: Row[], applications: ApplicationsAccess) {
    const techIds = Array.from(new Set(rows.map((r) => r.technology_id)));
    const assets = await this.reach.assetsOfTechnologies(mg, tenantId, techIds);
    const servers = new Map<string, typeof assets>();
    for (const a of assets) {
      const key = rowKey(a.technology_id, a.technology_version_id);
      servers.set(key, [...(servers.get(key) ?? []), a]);
    }
    if (!applications) return { servers, apps: null };
    const reached = await this.reach.applicationsOfTechnologies(mg, tenantId, techIds);
    const visible = await this.visibleApplicationIds(mg, tenantId, reached.map((r) => r.application_id), applications.scope);
    const apps = new Map<string, typeof reached>();
    for (const a of reached) {
      if (!visible.has(a.application_id)) continue;
      const key = rowKey(a.technology_id, a.technology_version_id);
      apps.set(key, [...(apps.get(key) ?? []), a]);
    }
    return { servers, apps };
  }

  /** Counts of distinct servers and applications reached by a set of rows. */
  private counts(rows: Row[], reach: Awaited<ReturnType<VulnerabilitiesService['reachOf']>>) {
    const servers = new Set<string>();
    const apps = new Set<string>();
    for (const r of rows) {
      const key = rowKey(r.technology_id, r.technology_version_id);
      for (const a of reach.servers.get(key) ?? []) servers.add(a.asset_id);
      for (const a of reach.apps?.get(key) ?? []) apps.add(a.application_id);
    }
    return { servers: servers.size, applications: reach.apps ? apps.size : null };
  }

  /** The CVE that concern the tenant, filtered, most severe first, paged by CVE. */
  async list(filters: VulnerabilityFilters, opts: VulnOpts, applications: ApplicationsAccess) {
    const { items, total, limit, offset } = await this.listWithRows(filters, opts, applications, true);
    return { items, total, limit, offset };
  }

  private async listWithRows(filters: VulnerabilityFilters, opts: VulnOpts, applications: ApplicationsAccess, paging: boolean) {
    const { manager: mg, tenantId } = opts;
    const limit = paging ? Math.min(Math.max(Number(filters.limit) || 50, 1), 200) : 10000;
    const offset = paging ? Math.max(Number(filters.offset) || 0, 0) : 0;
    const params: unknown[] = [tenantId];
    const where = await this.filterSql(mg, tenantId, filters, params);
    const page: Array<{ cve_id: string; total: string }> = await mg.query(
      `SELECT c.cve_id, count(*) OVER () AS total
         FROM (SELECT DISTINCT tv.cve_id ${this.rowsFrom} WHERE tv.tenant_id = $1 ${where}) x
         JOIN vulnerability_cves c ON c.cve_id = x.cve_id
        ORDER BY ${SEVERITY_ORDER} DESC, c.cvss_score DESC NULLS LAST, c.published_at DESC NULLS LAST, c.cve_id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const total = Number(page[0]?.total ?? 0);
    const ids = page.map((p) => p.cve_id);
    if (ids.length === 0) return { items: [], total, limit, offset, rows: [] as Row[], reach: null };
    params.push(ids);
    const rows = await this.rowsOf(mg, tenantId, `${where} AND tv.cve_id = ANY($${params.length}::text[])`, params);
    const cves = await this.cves(mg, ids);
    const reach = await this.reachOf(mg, tenantId, rows, applications);
    const items = ids.map((id) => {
      const cveRows = rows.filter((r) => r.cve_id === id);
      return {
        ...presentCve(cves.get(id)!),
        technologies: groupByTechnology(cveRows),
        ...this.counts(cveRows, reach),
      };
    });
    return { items, total, limit, offset, rows, reach };
  }

  /** One CVE: its record, the technologies and versions it concerns, the servers and applications reached. */
  async detail(cveIdRaw: string, opts: VulnOpts, applications: ApplicationsAccess) {
    const { manager: mg, tenantId } = opts;
    const cveId = cveIdOrThrow(cveIdRaw);
    const rows = await this.rowsOf(mg, tenantId, `AND tv.cve_id = $2`, [tenantId, cveId]);
    const cve = (await this.cves(mg, [cveId])).get(cveId);
    if (!cve || rows.length === 0) throw new NotFoundException('Vulnerability not found');
    const reach = await this.reachOf(mg, tenantId, rows, applications);
    const versionOf = new Map(rows.map((r) => [rowKey(r.technology_id, r.technology_version_id), r]));

    const reachedAssets = rows.flatMap((r) => reach.servers.get(rowKey(r.technology_id, r.technology_version_id)) ?? []);
    const assetIds = Array.from(new Set(reachedAssets.flatMap((a) => [a.asset_id, a.via_asset_id]).filter((id): id is string => !!id)));
    const assetRows: Array<{ id: string; name: string; asset_reference: string | null; environment: string | null }> = assetIds.length
      ? await mg.query(`SELECT id, name, asset_reference, environment FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, assetIds])
      : [];
    const assetsById = new Map(assetRows.map((a) => [a.id, a]));
    const servers = reachedAssets.map((a) => {
      const row = versionOf.get(rowKey(a.technology_id, a.technology_version_id))!;
      const asset = assetsById.get(a.asset_id);
      return {
        asset_id: a.asset_id,
        name: asset?.name ?? null,
        reference: asset?.asset_reference ?? null,
        environment: asset?.environment ?? null,
        technology_id: a.technology_id,
        technology_name: row.technology_name,
        version_label: row.version_label,
        via_asset_name: a.via_asset_id ? assetsById.get(a.via_asset_id)?.name ?? null : null,
      };
    }).sort((x, y) => String(x.name ?? '').localeCompare(String(y.name ?? ''), 'en', { sensitivity: 'base' }));

    let apps: Array<Record<string, unknown>> | null = null;
    if (reach.apps) {
      const reachedApps = rows.flatMap((r) => reach.apps!.get(rowKey(r.technology_id, r.technology_version_id)) ?? []);
      const appIds = Array.from(new Set(reachedApps.map((a) => a.application_id)));
      const appRows: Array<{ id: string; name: string; sequential_id: string | null; criticality: string | null }> = appIds.length
        ? await mg.query(`SELECT id, name, sequential_id, criticality FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, appIds])
        : [];
      const appsById = new Map(appRows.map((a) => [a.id, a]));
      apps = reachedApps.map((a) => {
        const row = versionOf.get(rowKey(a.technology_id, a.technology_version_id))!;
        const app = appsById.get(a.application_id);
        return {
          application_id: a.application_id,
          name: app?.name ?? null,
          reference: app?.sequential_id ?? null,
          criticality: app?.criticality ?? null,
          kind: a.kind,
          environment: a.environment,
          server_name: a.asset_id ? assetsById.get(a.asset_id)?.name ?? null : null,
          technology_id: a.technology_id,
          technology_name: row.technology_name,
          version_label: row.version_label,
        };
      }).sort((x, y) => String(x.name ?? '').localeCompare(String(y.name ?? ''), 'en', { sensitivity: 'base' }));
    }
    return {
      ...presentCve(cve),
      cvss_vector: cve.cvss_vector,
      reference_urls: cve.reference_urls ?? [],
      technologies: groupByTechnology(rows),
      ...this.counts(rows, reach),
      servers_list: servers,
      applications_list: apps,
    };
  }

  /** The vulnerabilities of one technology, one item per version and CVE, most severe first. */
  async ofTechnology(idOrRef: string, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const rows = await this.rowsOf(mg, tenantId, `AND tv.technology_id = $2`, [tenantId, tech.id]);
    const cves = await this.cves(mg, Array.from(new Set(rows.map((r) => r.cve_id))));
    const rank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, none: 1 };
    const items = rows.map((r) => ({ ...presentCve(cves.get(r.cve_id)!), ...presentRow(r) }))
      .sort((a, b) => (rank[b.severity ?? ''] ?? 0) - (rank[a.severity ?? ''] ?? 0)
        || (b.cvss_score ?? -1) - (a.cvss_score ?? -1)
        || b.cve_id.localeCompare(a.cve_id));
    return { technology: { id: tech.id, name: tech.name, reference: technologyReference(tech.item_number) }, items };
  }

  /**
   * Sets the state and the note of the technology's rows for the CVE: every version, or the one
   * `technology_version_id` names (`null`: the unknown version). Each changed row is audited.
   */
  async update(idOrRef: string, cveIdRaw: string, body: Record<string, unknown>, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef);
    const cveId = cveIdOrThrow(cveIdRaw);
    const patch: { state?: VulnerabilityState; note?: string | null } = {};
    if (body.state !== undefined) {
      if (!(VULNERABILITY_STATES as readonly string[]).includes(String(body.state))) {
        throw new BadRequestException('state must be to_review, handled or not_affected.');
      }
      patch.state = body.state as VulnerabilityState;
    }
    if (body.note !== undefined) {
      if (body.note !== null && typeof body.note !== 'string') throw new BadRequestException('note must be text.');
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (note.length > 4000) throw new BadRequestException('note must be at most 4000 characters.');
      patch.note = note || null;
    }
    if (patch.state === undefined && patch.note === undefined) throw new BadRequestException('Nothing to change: send state or note.');
    const params: unknown[] = [tenantId, tech.id, cveId];
    let versionSql = '';
    if (Object.prototype.hasOwnProperty.call(body, 'technology_version_id')) {
      const versionId = body.technology_version_id;
      if (versionId === null) versionSql = 'AND technology_version_id IS NULL';
      else if (typeof versionId === 'string' && UUID_RE.test(versionId)) { params.push(versionId); versionSql = `AND technology_version_id = $4`; }
      else throw new BadRequestException('technology_version_id must be a version id or null.');
    }
    const before: Array<Record<string, unknown>> = await mg.query(
      `SELECT id, technology_id, technology_version_id, cve_id, state, note, state_changed_by, state_changed_at
         FROM technology_vulnerabilities
        WHERE tenant_id = $1 AND technology_id = $2 AND cve_id = $3 ${versionSql}
        ORDER BY id FOR UPDATE`,
      params,
    );
    if (before.length === 0) throw new NotFoundException('Vulnerability not found');
    let changed = 0;
    for (const row of before) {
      const stateChanges = patch.state !== undefined && patch.state !== row.state;
      const noteChanges = patch.note !== undefined && patch.note !== row.note;
      if (!stateChanges && !noteChanges) continue;
      // An UPDATE answers [rows, rowCount], RETURNING included.
      const [[after]] = await mg.query(
        `UPDATE technology_vulnerabilities
            SET state = COALESCE($3, state),
                note = CASE WHEN $4::boolean THEN $5 ELSE note END,
                state_changed_by = CASE WHEN $6::boolean THEN $7::uuid ELSE state_changed_by END,
                state_changed_at = CASE WHEN $6::boolean THEN now() ELSE state_changed_at END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING id, technology_id, technology_version_id, cve_id, state, note, state_changed_by, state_changed_at`,
        [tenantId, row.id, stateChanges ? patch.state : null, noteChanges, patch.note ?? null, stateChanges, opts.userId ?? null],
      );
      await this.audit.log(
        { table: 'technology_vulnerabilities', recordId: String(row.id), action: 'update', before: row, after, userId: opts.userId ?? null },
        { manager: mg },
      );
      changed += 1;
    }
    return { ok: true, changed, ...(await this.ofTechnology(tech.id, opts)) };
  }

  /** Matches the technology again with the cache, under a lock of its row. */
  async rematch(idOrRef: string, opts: VulnOpts) {
    const { manager: mg, tenantId } = opts;
    const tech = await readTechnology(mg, tenantId, idOrRef, true);
    const result = await this.matcher.matchTenant(mg, tenantId, tech.id);
    return { ok: true, added: result.added, updated: result.updated, removed: result.removed, unmatched: result.unmatched };
  }

  /** The list as a CSV file, one line per technology version and CVE, with the same filters. */
  async exportCsv(filters: VulnerabilityFilters, language: unknown, opts: VulnOpts, applications: ApplicationsAccess) {
    const result = await this.listWithRows(filters, opts, applications, false);
    const cves = await this.cves(opts.manager, result.items.map((i) => i.cve_id));
    const headers = ['CVE', 'Severity', 'Score', 'Published', 'Technology reference', 'Technology', 'Editor', 'Version', 'Match', 'State', 'Note', 'Servers', 'Applications'];
    const basisLabel: Record<MatchBasis, string> = {
      version_in_range: 'Version in range',
      version_not_comparable: 'Version not comparable',
      version_unknown: 'Version unknown',
    };
    const stateLabel: Record<VulnerabilityState, string> = { to_review: 'To review', handled: 'Handled', not_affected: 'Not affected' };
    const lines: string[][] = [];
    for (const item of result.items) {
      const cve = cves.get(item.cve_id);
      const cveRows = (result.rows ?? []).filter((r) => r.cve_id === item.cve_id);
      for (const r of cveRows) {
        const counts = this.counts([r], result.reach!);
        lines.push([
          item.cve_id,
          item.severity ?? '',
          item.cvss_score == null ? '' : String(item.cvss_score),
          cve?.published_at ? new Date(cve.published_at).toISOString().slice(0, 10) : '',
          technologyReference(r.technology_item_number) ?? '',
          r.technology_name,
          r.editor ?? '',
          r.version_label ?? 'Unknown',
          basisLabel[r.match_basis],
          stateLabel[r.state],
          r.note ?? '',
          String(counts.servers),
          counts.applications == null ? '' : String(counts.applications),
        ]);
      }
    }
    const content = writeCsv({ language: await languageOf(opts.manager, opts.tenantId, opts.userId ?? null, language), headers, rows: lines });
    return { filename: 'vulnerabilities.csv', content };
  }
}
