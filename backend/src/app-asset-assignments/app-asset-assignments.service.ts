import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AppAssetAssignment } from './app-asset-assignment.entity';
import { AppInstance } from '../app-instances/app-instance.entity';
import { Asset } from '../assets/asset.entity';
import { AuditService } from '../audit/audit.service';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import {
  applicationParticipantCondition,
  ParticipationAccessScope,
} from '../auth/business-contributor-scope';
import { applicationBadRequest, applicationConflict } from '../applications/application-rules';
import { effectiveAssignmentsSql, groupableAssignmentsSql, ViaCluster } from './effective-assignments';
import {
  assertNotInherited,
  inheritingMembersOf,
  lockAssignmentClusters,
  mergeAbsorbed,
  normalizeServerRole,
} from './cluster-assignment-rules';

type AssignmentRow = {
  id: string;
  app_instance_id: string;
  asset_id: string;
  role: string;
  since_date: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  asset_name: string;
  asset_reference: string | null;
  asset_kind: string;
  asset_provider: string;
  asset_environment: string;
  asset_region: string | null;
  asset_zone: string | null;
  asset_status: string;
  asset_is_cluster: boolean | null;
  location_hosting_type: string | null;
  inherited: boolean;
  via_clusters: ViaCluster[];
};

/** A member in service of a cluster, inheriting the cluster's row (Deployments tab). */
type InheritingMember = {
  asset_id: string;
  name: string;
  asset_reference: string | null;
  kind: string;
  environment: string;
  status: string;
};

/** A deployment and role assigned directly to every member in service of a cluster (A7). */
type GroupableAssignment = {
  cluster_id: string;
  cluster_name: string;
  app_instance_id: string;
  role: string;
  member_ids: string[];
};

/** The effective rows (`effectiveAssignmentsSql` as `e`) with their server (`a`) and its location (`l`). */
const EFFECTIVE_SERVER_COLUMNS = `e.assignment_id AS id, e.app_instance_id, e.asset_id, e.role, e.since_date, e.notes, e.created_at, e.updated_at,
              e.inherited, e.via_clusters,
              a.name AS asset_name, a.asset_reference AS asset_reference, a.kind AS asset_kind, a.provider AS asset_provider,
              a.environment AS asset_environment, a.region AS asset_region, a.zone AS asset_zone, a.status AS asset_status,
              a.is_cluster AS asset_is_cluster, l.hosting_type AS location_hosting_type`;

const EFFECTIVE_SERVER_JOINS = `JOIN assets a ON a.tenant_id = e.tenant_id AND a.id = e.asset_id
       LEFT JOIN locations l ON l.tenant_id = a.tenant_id AND l.id = a.location_id`;

type ServiceOpts = { manager?: EntityManager; tenantId?: string | null };

/** A member whose direct row a cluster's row replaced (A4), for the message of the screen. */
export type AbsorbedMember = { asset_id: string; name: string };

@Injectable()
export class AppAssetAssignmentsService {
  constructor(
    @InjectRepository(AppAssetAssignment) private readonly repo: Repository<AppAssetAssignment>,
    @InjectRepository(AppInstance) private readonly instances: Repository<AppInstance>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    private readonly audit: AuditService,
    private readonly itOpsSettings: ItOpsSettingsService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(AppAssetAssignment) : this.repo;
  }

  private getInstanceRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(AppInstance) : this.instances;
  }

  private getAssetRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Asset) : this.assets;
  }

  private deriveHosting(
    row: { location_hosting_type?: string | null; asset_provider?: string | null },
    hostingTypes: Array<{ code: string; label: string; category?: string; deprecated?: boolean }>,
  ): { code: string | null; label: string | null; source: 'location' | 'provider' | null } {
    const map = new Map(hostingTypes.map((h) => [h.code, h]));
    const pick = (code?: string | null) => {
      if (!code) return null;
      const opt = map.get(code);
      return {
        code,
        label: opt?.label ?? code,
      };
    };
    const fromLocation = pick(row.location_hosting_type);
    if (fromLocation) {
      return { ...fromLocation, source: 'location' };
    }
    const cloudDefault =
      map.get('public_cloud') ||
      hostingTypes.find((h) => h.category === 'cloud') ||
      hostingTypes[0];
    if (cloudDefault) {
      return { code: cloudDefault.code, label: cloudDefault.label, source: 'provider' };
    }
    return { code: null, label: null, source: null };
  }

  /** The request's tenant: the one the controller names, else the transaction's (`app.current_tenant`). */
  private async tenantOf(manager: EntityManager, tenantId?: string | null): Promise<string> {
    if (tenantId) return tenantId;
    const [row] = await manager.query(`SELECT app_current_tenant() AS id`);
    if (!row?.id) throw new InternalServerErrorException('Deployment servers need the request transaction.');
    return String(row.id);
  }

  private async ensureInstance(instanceId: string, tenantId: string, manager?: EntityManager) {
    const repo = this.getInstanceRepo(manager);
    const instance = await repo.findOne({ where: { id: instanceId, tenant_id: tenantId } });
    if (!instance) throw new NotFoundException('App instance not found');
    return instance;
  }

  private async assertApplicationVisible(
    applicationId: string,
    tenantId: string,
    accessScope?: ParticipationAccessScope,
    manager?: EntityManager,
  ) {
    if (!accessScope) return;
    const rows: Array<{ id: string }> = await (manager ?? this.repo.manager).query(
      `SELECT a.id
       FROM applications a
       WHERE a.id = $1
         AND a.tenant_id = $3
         AND ${applicationParticipantCondition('a', '$2')}
       LIMIT 1`,
      [applicationId, accessScope.userId, tenantId],
    );
    if (!rows[0]) throw new NotFoundException('Application not found');
  }

  private async ensureAsset(assetId: string, tenantId: string, manager?: EntityManager) {
    const repo = this.getAssetRepo(manager);
    const asset = await repo.findOne({ where: { id: assetId, tenant_id: tenantId } });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  private async normalizeRole(value: unknown, tenantId: string, manager?: EntityManager): Promise<string> {
    if (!String(value || '').trim()) return normalizeServerRole(value, []);
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    return normalizeServerRole(value, settings.serverRoles);
  }

  /** No date when none is given; a refusal (`date_invalid`) when one is given that is not a date. */
  private parseDate(value: unknown, field: string): Date | null {
    if (value == null || value === '') return null;
    const date = new Date(value as any);
    if (Number.isNaN(date.getTime())) {
      throw applicationBadRequest('date_invalid', `${field} is not a valid date`, { field, value: String(value) });
    }
    return date;
  }

  private duplicateRefusal() {
    return applicationConflict('assignment_duplicate', 'Asset already assigned with this role');
  }

  /** Saves `row`; two writers racing on one server and role meet the unique key: `assignment_duplicate`. */
  private async saveRow(repo: Repository<AppAssetAssignment>, row: AppAssetAssignment): Promise<AppAssetAssignment> {
    try {
      return await repo.save(row);
    } catch (error: any) {
      if ((error?.code ?? error?.driverError?.code) === '23505') throw this.duplicateRefusal();
      throw error;
    }
  }

  /**
   * The cluster rules (`cluster-assignment-rules.ts`) for `row`, about to be saved on its server,
   * after `lockAssignmentClusters`:
   * - on a member, A3: no direct row for what one of its clusters carries (`assignment_inherited`);
   * - on a cluster, A4: the direct rows of the same deployment and role on its members are deleted
   *   (each audited as a deletion), `row` takes the earliest date and their notes after its own.
   * Returns the members absorbed, by name.
   */
  private async applyClusterRules(
    mg: EntityManager,
    tenantId: string,
    row: AppAssetAssignment,
    isCluster: boolean,
    userId: string | null,
  ): Promise<AbsorbedMember[]> {
    if (!isCluster) {
      await assertNotInherited(mg, tenantId, row.app_instance_id, row.asset_id, row.role);
      return [];
    }
    const members = (await inheritingMembersOf(mg, tenantId, [row.asset_id])).get(row.asset_id) ?? [];
    if (members.length === 0) return [];
    const repo = this.getRepo(mg);
    const rows = await repo.find({
      where: { tenant_id: tenantId, app_instance_id: row.app_instance_id, role: row.role, asset_id: In(members.map((m) => m.id)) },
    });
    const absorbed = members.flatMap((member) => rows
      .filter((candidate) => candidate.asset_id === member.id && candidate.id !== row.id)
      .map((candidate) => ({ member, row: candidate })));
    if (absorbed.length === 0) return [];
    const merged = mergeAbsorbed(row, absorbed.map((item) => item.row));
    row.since_date = merged.since_date as any;
    row.notes = merged.notes;
    await repo.delete({ tenant_id: tenantId, id: In(absorbed.map((item) => item.row.id)) } as any);
    for (const { row: gone } of absorbed) {
      await this.audit.log(
        { table: 'app_asset_assignments', recordId: gone.id, action: 'delete', before: gone, after: null, userId },
        { manager: mg },
      );
    }
    return absorbed.map(({ member }) => ({ asset_id: member.id, name: member.name }));
  }

  private normalizeNotes(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  private async mapRows(rows: AssignmentRow[], tenantId: string, mg: EntityManager) {
    // A read: the plain settings, without the share lock a write takes on the tenant row.
    const settings = await this.itOpsSettings.getSettings(tenantId, { manager: mg });
    return rows.map((row) => ({
      id: row.id,
      app_instance_id: row.app_instance_id,
      asset_id: row.asset_id,
      role: row.role,
      since_date: row.since_date,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      inherited: !!row.inherited,
      via_clusters: row.via_clusters ?? [],
      members: [] as InheritingMember[],
      hosting: this.deriveHosting(
        { location_hosting_type: row.location_hosting_type, asset_provider: row.asset_provider },
        settings.hostingTypes || [],
      ),
      asset: {
        id: row.asset_id,
        name: row.asset_name,
        asset_reference: row.asset_reference,
        kind: row.asset_kind,
        provider: row.asset_provider,
        environment: row.asset_environment,
        region: row.asset_region,
        zone: row.asset_zone,
        status: row.asset_status,
        is_cluster: !!row.asset_is_cluster,
      },
      // Backwards compatibility: include server alias
      server: {
        id: row.asset_id,
        name: row.asset_name,
        asset_reference: row.asset_reference,
        kind: row.asset_kind,
        provider: row.asset_provider,
        environment: row.asset_environment,
        region: row.asset_region,
        zone: row.asset_zone,
        status: row.asset_status,
      },
      server_id: row.asset_id,
    }));
  }

  async list(instanceId: string, opts?: ServiceOpts & { accessScope?: ParticipationAccessScope }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.tenantOf(mg, opts?.tenantId);
    const instance = await this.ensureInstance(instanceId, tenantId, mg);
    await this.assertApplicationVisible(instance.application_id, tenantId, opts?.accessScope, mg);
    return this.deploymentServers(mg, tenantId, { instances: '$2' }, [instanceId]);
  }

  /**
   * The servers of deployments as the Deployments tab lists them (`effectiveAssignmentsSql`), and
   * the direct rows that could move to their cluster. `scope` names `$2`, an array of deployment
   * or application ids.
   *
   * - `items`: the rows stored on the deployments, `inherited` false. A member never comes as a
   *   row of its own for what it inherits: a cluster's row carries the members in service that
   *   inherit it (`members`, by name; `[]` on any other row). `via_clusters` names the clusters
   *   that also give a direct row (older data); that member then also shows in their `members`.
   * - `groupable`: a deployment and role assigned directly to every member in service of a cluster
   *   that has at least two (`groupableAssignmentsSql`).
   */
  private async deploymentServers(
    mg: EntityManager,
    tenantId: string,
    scope: { instances: string } | { applications: string },
    ids: string[],
  ) {
    const rows: AssignmentRow[] = await mg.query(
      `SELECT ${EFFECTIVE_SERVER_COLUMNS}
       FROM (${effectiveAssignmentsSql({ tenant: '$1', ...scope })}) e
       ${EFFECTIVE_SERVER_JOINS}
       ORDER BY a.name ASC, a.id, e.role`,
      [tenantId, ids],
    );
    const items = await this.mapRows(rows.filter((row) => !row.inherited), tenantId, mg);
    const byKey = new Map(items.map((item) => [`${item.app_instance_id}|${item.asset_id}|${item.role}`, item]));
    for (const row of rows) {
      for (const via of row.via_clusters ?? []) {
        byKey.get(`${row.app_instance_id}|${via.id}|${row.role}`)?.members.push({
          asset_id: row.asset_id,
          name: row.asset_name,
          asset_reference: row.asset_reference,
          kind: row.asset_kind,
          environment: row.asset_environment,
          status: row.asset_status,
        });
      }
    }
    const instances = 'instances' in scope
      ? scope.instances
      : `ARRAY(SELECT gi.id FROM app_instances gi WHERE gi.tenant_id = $1 AND gi.application_id = ANY(${scope.applications}::uuid[]))`;
    const groupable: GroupableAssignment[] = await mg.query(groupableAssignmentsSql({ tenant: '$1', instances }), [tenantId, ids]);
    return { items, groupable };
  }

  /**
   * The servers of every deployment of an application, in one answer (each row names its
   * `app_instance_id`). The application is found by id or by reference (`APP-12`).
   */
  async listByApplication(applicationId: string, opts?: ServiceOpts & { accessScope?: ParticipationAccessScope }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.tenantOf(mg, opts?.tenantId);
    const key = String(applicationId || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    const reference = key.match(/^(APP-[0-9]+)(?:-.+)?$/i)?.[1] ?? null;
    if (!isUuid && !reference) throw new NotFoundException('Application not found');
    const apps: Array<{ id: string }> = await mg.query(
      `SELECT a.id
       FROM applications a
       WHERE a.tenant_id = $1
         AND (($2::uuid IS NOT NULL AND a.id = $2::uuid) OR ($3::text IS NOT NULL AND upper(a.sequential_id) = upper($3)))
       LIMIT 1`,
      [tenantId, isUuid ? key : null, reference],
    );
    if (!apps[0]) throw new NotFoundException('Application not found');
    await this.assertApplicationVisible(apps[0].id, tenantId, opts?.accessScope, mg);
    return this.deploymentServers(mg, tenantId, { applications: '$2' }, [apps[0].id]);
  }

  async create(instanceId: string, payload: any, userId: string | null, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const tenantId = await this.tenantOf(mg, opts?.tenantId);
    const instance = await this.ensureInstance(instanceId, tenantId, mg);
    if (!payload || typeof payload !== 'object') {
      throw applicationBadRequest('body_required', 'Body is required');
    }
    // Accept both asset_id and server_id for backwards compatibility
    const assetId = this.normalizeNullableId(payload.asset_id ?? payload.assetId ?? payload.server_id ?? payload.serverId);
    if (!assetId) throw applicationBadRequest('asset_required', 'asset_id is required');
    const role = await this.normalizeRole(payload.role, instance.tenant_id, mg);
    const sinceDate = this.parseDate(payload.since_date, 'since_date');
    // The cluster, or the clusters of a member, are locked before the server and its rows are read.
    await lockAssignmentClusters(mg, tenantId, [assetId]);
    const asset = await this.ensureAsset(assetId, tenantId, mg);
    const existing = await repo.findOne({ where: { tenant_id: tenantId, app_instance_id: instanceId, asset_id: assetId, role } as any });
    if (existing) {
      throw this.duplicateRefusal();
    }
    const assignment = repo.create({
      tenant_id: tenantId,
      app_instance_id: instanceId,
      asset_id: assetId,
      role,
      since_date: sinceDate,
      notes: this.normalizeNotes(payload.notes),
    });
    const absorbed = await this.applyClusterRules(mg, tenantId, assignment, !!asset.is_cluster, userId);
    const saved = await this.saveRow(repo, assignment);
    await this.audit.log(
      { table: 'app_asset_assignments', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return { ...saved, absorbed };
  }

  async update(
    instanceId: string,
    assignmentId: string,
    payload: any,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const tenantId = await this.tenantOf(mg, opts?.tenantId);
    const assignment = await repo.findOne({ where: { id: assignmentId, tenant_id: tenantId } });
    if (!assignment || assignment.app_instance_id !== instanceId) {
      throw new NotFoundException('Assignment not found');
    }
    const instance = await this.ensureInstance(instanceId, tenantId, mg);
    const patch: Partial<AppAssetAssignment> = {};
    // Accept both asset_id and server_id for backwards compatibility
    if (payload.asset_id !== undefined || payload.server_id !== undefined) {
      const assetId = this.normalizeNullableId(payload.asset_id ?? payload.server_id);
      if (!assetId) {
        throw applicationBadRequest('asset_required', 'asset_id is required');
      }
      await this.ensureAsset(assetId, tenantId, mg);
      patch.asset_id = assetId;
    }
    if (payload.role !== undefined) {
      patch.role = await this.normalizeRole(payload.role, instance.tenant_id, mg);
    }
    if (payload.since_date !== undefined) {
      patch.since_date = this.parseDate(payload.since_date, 'since_date');
    }
    if (payload.notes !== undefined) {
      patch.notes = this.normalizeNotes(payload.notes);
    }
    const nextAssetId = patch.asset_id ?? assignment.asset_id;
    const nextRole = patch.role ?? assignment.role;
    const moved = nextAssetId !== assignment.asset_id || nextRole !== assignment.role;
    let nextIsCluster = false;
    if (moved) {
      // As in create: the clusters first, then the server and the rows.
      await lockAssignmentClusters(mg, tenantId, [nextAssetId]);
      nextIsCluster = !!(await this.ensureAsset(nextAssetId, tenantId, mg)).is_cluster;
      const duplicate = await repo.findOne({
        where: { tenant_id: tenantId, app_instance_id: instanceId, asset_id: nextAssetId, role: nextRole } as any,
      });
      if (duplicate && duplicate.id !== assignment.id) {
        throw this.duplicateRefusal();
      }
    }
    const before = { ...assignment };
    Object.assign(assignment, patch);
    // A row that changes server or role follows the cluster rules of a new row (A3, A4).
    const absorbed = moved ? await this.applyClusterRules(mg, tenantId, assignment, nextIsCluster, userId) : [];
    const saved = await this.saveRow(repo, assignment);
    await this.audit.log(
      { table: 'app_asset_assignments', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return { ...saved, absorbed };
  }

  /**
   * The Operations tab of a server: its effective rows (`effectiveAssignmentsSql`), its own and,
   * for a member, those of its clusters (`inherited`, `via_clusters`; `id` is then the cluster's
   * row, which only the cluster edits). A Business Contributor sees the rows of the applications
   * they take part in, inherited or not. `groupable`, on a direct row of a member: the set that
   * could move to its cluster (`groupableAssignmentsSql`), else null.
   *
   * Answer: `{ items, groupable }`. `groupable`, for a cluster: the sets of direct rows on its
   * members that could move to it (`groupableAssignmentsSql`, limited to the applications a
   * Business Contributor takes part in); `[]` for any other server.
   */
  async listByAsset(assetId: string, opts?: ServiceOpts & { accessScope?: ParticipationAccessScope }) {
    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.tenantOf(mg, opts?.tenantId);
    const asset = await this.ensureAsset(assetId, tenantId, mg);
    const params: unknown[] = [assetId, tenantId];
    const accessScopeSql = opts?.accessScope
      ? (() => {
        params.push(opts.accessScope.userId);
        return `AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
      })()
      : '';
    const rows: Array<{
      id: string;
      app_instance_id: string;
      asset_id: string;
      role: string;
      since_date: Date | null;
      notes: string | null;
      created_at: Date;
      updated_at: Date;
      inherited: boolean;
      via_clusters: ViaCluster[];
      app_id: string;
      app_name: string;
      environment: string;
    }> = await mg.query(
      `SELECT e.assignment_id AS id, e.app_instance_id, e.asset_id, e.role, e.since_date, e.notes, e.created_at, e.updated_at,
              e.inherited, e.via_clusters, ai.application_id AS app_id, ai.environment, a.name AS app_name
       FROM (${effectiveAssignmentsSql({ tenant: '$2', assets: 'ARRAY[$1::uuid]' })}) e
       JOIN app_instances ai ON ai.id = e.app_instance_id AND ai.tenant_id = e.tenant_id
       JOIN applications a ON a.id = ai.application_id AND a.tenant_id = ai.tenant_id
       WHERE ai.tenant_id = $2
        ${accessScopeSql}
       ORDER BY ai.environment ASC, a.name ASC, e.inherited, e.role`,
      params,
    );
    const groupable: GroupableAssignment[] = rows.some((row) => !row.inherited)
      ? await mg.query(
        groupableAssignmentsSql({
          tenant: '$1',
          clusters: 'ARRAY(SELECT gm.cluster_id FROM asset_cluster_members gm WHERE gm.tenant_id = $1 AND gm.asset_id = $2)',
        }),
        [tenantId, assetId],
      )
      : [];
    const groupableOf = (row: { inherited: boolean; app_instance_id: string; role: string }) => {
      if (row.inherited) return null;
      const set = groupable.find((g) => g.app_instance_id === row.app_instance_id && g.role === row.role && g.member_ids.includes(assetId));
      return set ? { cluster_id: set.cluster_id, cluster_name: set.cluster_name, member_ids: set.member_ids } : null;
    };
    const items = rows.map((row) => ({
      id: row.id,
      app_instance_id: row.app_instance_id,
      asset_id: row.asset_id,
      server_id: row.asset_id, // backwards compatibility
      role: row.role,
      since_date: row.since_date,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
      application: { id: row.app_id, name: row.app_name },
      environment: row.environment,
      inherited: !!row.inherited,
      via_clusters: row.via_clusters ?? [],
      groupable: groupableOf(row),
    }));
    const clusterGroupable: GroupableAssignment[] = asset.is_cluster
      ? await mg.query(
        groupableAssignmentsSql({
          tenant: '$1',
          clusters: 'ARRAY[$2::uuid]',
          ...(opts?.accessScope
            ? {
              instances: `ARRAY(SELECT gi.id FROM app_instances gi
                 JOIN applications a ON a.tenant_id = gi.tenant_id AND a.id = gi.application_id
                WHERE gi.tenant_id = $1 AND ${applicationParticipantCondition('a', '$3')})`,
            }
            : {}),
        }),
        opts?.accessScope ? [tenantId, assetId, opts.accessScope.userId] : [tenantId, assetId],
      )
      : [];
    return { items, groupable: clusterGroupable };
  }

  // Backwards compatibility alias
  async listByServer(serverId: string, opts?: ServiceOpts) {
    return this.listByAsset(serverId, opts);
  }

  async delete(instanceId: string, assignmentId: string, userId: string | null, opts?: ServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const tenantId = await this.tenantOf(mg, opts?.tenantId);
    const assignment = await repo.findOne({ where: { id: assignmentId, tenant_id: tenantId } });
    if (!assignment || assignment.app_instance_id !== instanceId) {
      throw new NotFoundException('Assignment not found');
    }
    await repo.delete({ id: assignmentId, tenant_id: tenantId } as any);
    await this.audit.log(
      { table: 'app_asset_assignments', recordId: assignmentId, action: 'delete', before: assignment, after: null, userId },
      { manager: mg },
    );
    return { deleted: true };
  }

  /**
   * Returns unique assets assigned to app instances for the given applications and environments,
   * as effective (`effectiveAssignmentsSql`): a cluster and its members in service.
   * Used by the Connection Map to pre-select assets based on application selection.
   */
  async listAssetsByApps(
    applicationIds: string[],
    environments: string[],
    opts?: ServiceOpts & { accessScope?: ParticipationAccessScope },
  ) {
    if (!applicationIds || applicationIds.length === 0 || !environments || environments.length === 0) {
      return { items: [] };
    }

    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = await this.tenantOf(mg, opts?.tenantId);
    const params: unknown[] = [applicationIds, environments, tenantId];
    const accessScopeSql = opts?.accessScope
      ? (() => {
        params.push(opts.accessScope.userId);
        return `AND ${applicationParticipantCondition('app_scope', `$${params.length}`)}`;
      })()
      : '';

    const rows: Array<{
      id: string;
      name: string;
      environment: string;
      kind: string;
      provider: string;
      is_cluster: boolean;
    }> = await mg.query(
      `
      SELECT DISTINCT
        a.id,
        a.name,
        a.environment,
        a.kind,
        a.provider,
        a.is_cluster
      FROM (${effectiveAssignmentsSql({ tenant: '$3', applications: '$1' })}) e
      INNER JOIN assets a ON a.id = e.asset_id AND a.tenant_id = e.tenant_id
      INNER JOIN app_instances ai ON ai.id = e.app_instance_id AND ai.tenant_id = e.tenant_id
      INNER JOIN applications app_scope ON app_scope.id = ai.application_id AND app_scope.tenant_id = ai.tenant_id
      WHERE a.tenant_id = $3
        AND ai.application_id = ANY($1)
        AND ai.environment = ANY($2)
        AND a.status <> 'retired'
        ${accessScopeSql}
      ORDER BY a.name ASC
      `,
      params,
    );

    return { items: rows };
  }

  // Backwards compatibility alias
  async listServersByApps(
    applicationIds: string[],
    environments: string[],
    opts?: ServiceOpts,
  ) {
    return this.listAssetsByApps(applicationIds, environments, opts);
  }

  private normalizeNullableId(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }
}
