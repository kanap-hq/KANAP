import { TechnologyCpeEvents } from '../technologies/technology-cpe-events';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Asset } from './asset.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { checkIds, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal, type UsageCount } from '../common/record-in-use';
import { assertNoHiddenLinks, hiddenLinksRefusals } from '../data-access/hidden-links';
import { effectiveAssignmentsSql } from '../app-asset-assignments/effective-assignments';

/** The relations a delete takes with it, in the shape of the relations audit (`assets-relations.service.ts`). */
type RelationRef = { related_asset_id: string; relation_type: string };

/**
 * What a delete would take away besides the asset, shown before the confirmation. It never refuses
 * the delete: `member_of` the clusters the asset is a member of, `member_count` its own members when
 * it is a cluster, `stops_hosting` the applications it hosts through its clusters (the inherited
 * assignments: a member in service of a cluster in service that carries them), `relations` the
 * assets it is related to (the first ten by name, `direction` `incoming` when the other asset holds
 * the relation) and `relations_total`. Words are the screen's.
 */
export type AssetDeleteWarning = {
  id: string;
  name: string;
  member_of: Array<{ id: string; name: string }>;
  member_count: number;
  stops_hosting: string[];
  relations: Array<{ id: string; name: string; relation_type: string; direction: 'incoming' | 'outgoing' }>;
  relations_total: number;
};

const WARNING_RELATIONS_LIMIT = 10;

@Injectable()
export class AssetsDeleteService extends BaseDeleteService<Asset> {
  protected override readonly logger = new Logger(AssetsDeleteService.name);

  constructor(
    @InjectRepository(Asset) repository: Repository<Asset>,
    audit: AuditService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {
    super(repository, null, audit, {
      entityName: 'Asset',
      auditTable: 'assets',
      cascadeRelations: [],
    });
  }

  private async ensureAsset(id: string, tenantId: string, manager: EntityManager) {
    const repo = this.getRepo(manager);
    const asset = await repo.findOne({ where: { id, tenant_id: tenantId } as any });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

  private async findAssignments(assetId: string, tenantId: string, manager: EntityManager) {
    const rows: Array<{ name: string; environment: string }> = await manager.query(
      `SELECT a.name, ai.environment
       FROM app_asset_assignments aaa
       JOIN app_instances ai ON ai.id = aaa.app_instance_id
       JOIN applications a ON a.id = ai.application_id
       WHERE aaa.asset_id = $1 AND aaa.tenant_id = $2
       ORDER BY ai.environment ASC, a.name ASC
       LIMIT 5`,
      [assetId, tenantId],
    );
    const [{ count }] = await manager.query(
      `SELECT COUNT(*)::int AS count
       FROM app_asset_assignments aaa
       WHERE aaa.asset_id = $1 AND aaa.tenant_id = $2`,
      [assetId, tenantId],
    );
    // The screen names the applications after its counts: the server sends their names once.
    const applications: Array<{ name: string }> = await manager.query(
      `SELECT DISTINCT a.name
       FROM app_asset_assignments aaa
       JOIN app_instances ai ON ai.tenant_id = aaa.tenant_id AND ai.id = aaa.app_instance_id
       JOIN applications a ON a.tenant_id = ai.tenant_id AND a.id = ai.application_id
       WHERE aaa.asset_id = $1 AND aaa.tenant_id = $2
       ORDER BY a.name ASC`,
      [assetId, tenantId],
    );
    return {
      count: Number(count || 0),
      samples: rows,
      applications: applications.map((application) => application.name),
    };
  }

  private async findConnections(assetId: string, tenantId: string, manager: EntityManager) {
    const baseIdsQuery = `
      SELECT DISTINCT c.id, c.name, c.created_at
      FROM connections c
      LEFT JOIN connection_servers cs ON cs.connection_id = c.id
      LEFT JOIN connection_legs cl ON cl.connection_id = c.id
      WHERE c.tenant_id = $1
        AND (
          c.source_asset_id = $2
          OR c.destination_asset_id = $2
          OR cs.asset_id = $2
          OR cl.equipment_asset_id = $2
        )`;

    const sampleQuery = `${baseIdsQuery}\n      ORDER BY c.created_at DESC\n      LIMIT 5`;
    const rows: Array<{ id: string; name: string }> = await manager.query(sampleQuery, [tenantId, assetId]);

    const countQuery = `SELECT COUNT(*)::int AS count FROM (${baseIdsQuery.replace(', c.name, c.created_at', '')}) sub`;
    const [{ count }] = await manager.query(countQuery, [tenantId, assetId]);
    return { count: Number(count || 0), samples: rows };
  }

  private buildConflictMessage(
    assetName: string,
    assignments: { count: number; samples: Array<{ name: string; environment: string }> },
    connections: { count: number; samples: Array<{ name: string }> },
  ): string {
    const parts: string[] = [];
    if (assignments.count > 0) {
      const list = assignments.samples.map((a) => `${a.name} (${a.environment?.toUpperCase?.() || a.environment || ''})`);
      const extra = assignments.count > list.length ? ` +${assignments.count - list.length} more` : '';
      parts.push(`has ${assignments.count} application assignment(s): ${list.join(', ')}${extra}`);
    }
    if (connections.count > 0) {
      const list = connections.samples.map((c) => c.name);
      const extra = connections.count > list.length ? ` +${connections.count - list.length} more` : '';
      parts.push(`is linked to ${connections.count} connection(s): ${list.join(', ')}${extra}`);
    }
    return `Cannot delete asset "${assetName}": ${parts.join('; ')}`;
  }

  /**
   * The refusal of an asset's delete (`ASSET_IN_USE`, with its application assignments and
   * connections counted), or null when nothing uses it. Removing those links frees the asset.
   */
  private async refusalOf(asset: Asset, tenantId: string, manager: EntityManager): Promise<RecordInUseException | null> {
    const assignments = await this.findAssignments(asset.id, tenantId, manager);
    const connections = await this.findConnections(asset.id, tenantId, manager);
    if (assignments.count === 0 && connections.count === 0) return null;
    const usages: UsageCount[] = [];
    if (assignments.count > 0) usages.push({ type: 'app_assignments', total: assignments.count });
    if (connections.count > 0) usages.push({ type: 'connections', total: connections.count });
    return new RecordInUseException(
      'ASSET_IN_USE',
      'asset',
      asset.name,
      usages,
      this.buildConflictMessage(asset.name, assignments, connections),
      undefined,
      assignments.applications.length > 0 ? assignments.applications : undefined,
    );
  }

  /**
   * The check before a delete (`POST /assets/delete-check`): which of `ids` would be refused, and why,
   * and what the others would take with them (`warnings`, which never refuse); for a limited person,
   * also those linked to lines outside their access (spec §5.4).
   */
  async deleteCheck(
    ids: string[],
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<{ refused: DeleteRefusal[]; warnings: AssetDeleteWarning[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [], warnings: [] };
    const rows: Asset[] = await manager.query(
      `SELECT id, name FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    const hidden = await hiddenLinksRefusals(manager, 'asset', rows.map((row) => row.id));
    const { refused } = await refusalsFrom(wanted, rows, (row) => row.name, async (row) => (await this.refusalOf(row, tenantId, manager)) ?? hidden.get(row.id) ?? null);
    return { refused, warnings: await this.warningsOf(wanted, rows, tenantId, manager) };
  }

  /** The warnings of `rows` (asked order kept), in grouped queries. */
  private async warningsOf(wanted: string[], rows: Asset[], tenantId: string, manager: EntityManager): Promise<AssetDeleteWarning[]> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const memberOf: Array<{ asset_id: string; id: string; name: string }> = await manager.query(
      `SELECT m.asset_id, c.id, c.name
         FROM asset_cluster_members m
         JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id
        WHERE m.tenant_id = $1 AND m.asset_id = ANY($2::uuid[])
        ORDER BY c.name, c.id`,
      [tenantId, ids],
    );
    const memberCounts: Array<{ cluster_id: string; count: number }> = await manager.query(
      `SELECT cluster_id, count(*)::int AS count
         FROM asset_cluster_members
        WHERE tenant_id = $1 AND cluster_id = ANY($2::uuid[])
        GROUP BY cluster_id`,
      [tenantId, ids],
    );
    // What each asset hosts through its clusters: the inherited rows only, so a member keeps what
    // it holds directly. One read of the effective assignments for every asset asked.
    const hosting: Array<{ asset_id: string; name: string }> = await manager.query(
      `SELECT DISTINCT e.asset_id, app.name
         FROM (${effectiveAssignmentsSql({ tenant: '$1', assets: '$2' })}) e
         JOIN app_instances ai ON ai.tenant_id = e.tenant_id AND ai.id = e.app_instance_id
         JOIN applications app ON app.tenant_id = ai.tenant_id AND app.id = ai.application_id
        WHERE e.inherited
        ORDER BY e.asset_id, app.name`,
      [tenantId, ids],
    );
    const relations: Array<{ asset_id: string; id: string; name: string; relation_type: string; direction: 'incoming' | 'outgoing'; total: number }> = await manager.query(
      `WITH lost AS (
         SELECT r.related_asset_id AS asset_id, r.asset_id AS other_id, r.relation_type, 'incoming' AS direction
           FROM asset_relations r
          WHERE r.tenant_id = $1 AND r.related_asset_id = ANY($2::uuid[])
         UNION ALL
         SELECT r.asset_id, r.related_asset_id, r.relation_type, 'outgoing'
           FROM asset_relations r
          WHERE r.tenant_id = $1 AND r.asset_id = ANY($2::uuid[])
       ), named AS (
         SELECT l.asset_id, l.other_id, a.name, l.relation_type, l.direction,
                row_number() OVER (PARTITION BY l.asset_id ORDER BY a.name, a.id, l.relation_type, l.direction) AS rn,
                count(*) OVER (PARTITION BY l.asset_id) AS total
           FROM lost l
           JOIN assets a ON a.tenant_id = $1 AND a.id = l.other_id
       )
       SELECT asset_id, other_id AS id, name, relation_type, direction, total::int AS total
         FROM named
        WHERE rn <= $3
        ORDER BY asset_id, rn`,
      [tenantId, ids, WARNING_RELATIONS_LIMIT],
    );

    const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
    const warnings: AssetDeleteWarning[] = [];
    for (const id of wanted) {
      const row = byId.get(id);
      if (!row) continue;
      const own = relations.filter((r) => r.asset_id === row.id);
      const warning: AssetDeleteWarning = {
        id: row.id,
        name: row.name,
        member_of: memberOf.filter((m) => m.asset_id === row.id).map((m) => ({ id: m.id, name: m.name })),
        member_count: Number(memberCounts.find((c) => c.cluster_id === row.id)?.count ?? 0),
        stops_hosting: hosting.filter((h) => h.asset_id === row.id).map((h) => h.name),
        relations: own.map((r) => ({ id: r.id, name: r.name, relation_type: r.relation_type, direction: r.direction })),
        relations_total: Number(own[0]?.total ?? 0),
      };
      if (warning.member_of.length > 0 || warning.member_count > 0 || warning.stops_hosting.length > 0 || warning.relations_total > 0) warnings.push(warning);
    }
    return warnings;
  }

  /**
   * The links the cascade of a delete removes, audited before it runs, as their own writers audit
   * them: each cluster the asset was a member of (`asset_cluster_members`, `members` before and
   * after), and each other asset that held a relation to it (`asset_relations`, its `relations`
   * before and after). Its own members and relations go into the asset's delete entry. Grouped
   * reads (`= ANY`), never one query per row.
   */
  private async auditCascade(
    asset: Asset,
    tenantId: string,
    userId: string | null,
    manager: EntityManager,
  ): Promise<{ members: string[]; relations: RelationRef[] }> {
    const id = asset.id;
    const memberRows: Array<{ cluster_id: string; asset_id: string }> = await manager.query(
      `SELECT cluster_id, asset_id
         FROM asset_cluster_members
        WHERE tenant_id = $1
          AND (cluster_id = ANY($2::uuid[])
               OR cluster_id IN (SELECT cluster_id FROM asset_cluster_members WHERE tenant_id = $1 AND asset_id = ANY($2::uuid[])))
        ORDER BY cluster_id, created_at, asset_id`,
      [tenantId, [id]],
    );
    const relationRows: Array<{ asset_id: string; related_asset_id: string; relation_type: string }> = await manager.query(
      `SELECT asset_id, related_asset_id, relation_type
         FROM asset_relations
        WHERE tenant_id = $1
          AND (asset_id = ANY($2::uuid[])
               OR asset_id IN (SELECT asset_id FROM asset_relations WHERE tenant_id = $1 AND related_asset_id = ANY($2::uuid[])))
        ORDER BY asset_id, created_at, id`,
      [tenantId, [id]],
    );

    const group = <R, K extends keyof R>(rows: R[], key: K) => {
      const map = new Map<string, R[]>();
      for (const row of rows) {
        const k = String(row[key]);
        map.set(k, [...(map.get(k) ?? []), row]);
      }
      return map;
    };

    for (const [clusterId, rows] of group(memberRows, 'cluster_id')) {
      if (clusterId === id) continue;
      const before = rows.map((row) => row.asset_id);
      await this.audit.log(
        {
          table: 'asset_cluster_members', recordId: clusterId, action: 'update',
          before: { members: before }, after: { members: before.filter((member) => member !== id) }, userId,
        },
        { manager },
      );
    }
    for (const [sourceId, rows] of group(relationRows, 'asset_id')) {
      if (sourceId === id) continue;
      const before: RelationRef[] = rows.map((row) => ({ related_asset_id: row.related_asset_id, relation_type: row.relation_type }));
      await this.audit.log(
        {
          table: 'asset_relations', recordId: sourceId, action: 'update',
          before: { relations: before }, after: { relations: before.filter((r) => r.related_asset_id !== id) }, userId,
        },
        { manager },
      );
    }
    return {
      members: memberRows.filter((row) => row.cluster_id === id).map((row) => row.asset_id),
      relations: relationRows
        .filter((row) => row.asset_id === id)
        .map((row) => ({ related_asset_id: row.related_asset_id, relation_type: row.relation_type })),
    };
  }

  /**
   * Delete an asset by ID with tenant context
   */
  async deleteAsset(id: string, tenantId: string, userId: string | null, opts?: { manager?: EntityManager }): Promise<{ deleted: boolean }> {
    const manager = opts?.manager ?? this.repository.manager;
    const asset = await this.ensureAsset(id, tenantId, manager);

    const refusal = await this.refusalOf(asset, tenantId, manager);
    if (refusal) throw refusal;
    // Its cascade would drop links to lines the person cannot read (spec §5.4).
    await assertNoHiddenLinks(manager, 'asset', asset.id);

    // Its memberships and relations go with it (ON DELETE CASCADE): audited first, on the other side.
    const cascade = await this.auditCascade(asset, tenantId, userId, manager);
    // Its technology links go with it: those technologies are matched again after the commit.
    await this.cpeEvents?.emitForSubjects(manager, tenantId, 'asset', [id]);
    await this.getRepo(manager).delete({ id, tenant_id: tenantId } as any);

    await this.audit.log(
      {
        table: 'assets', recordId: id, action: 'delete',
        before: {
          ...asset,
          ...(cascade.members.length > 0 ? { members: cascade.members } : {}),
          ...(cascade.relations.length > 0 ? { relations: cascade.relations } : {}),
        },
        after: null, userId,
      },
      { manager },
    );

    return { deleted: true };
  }

  /**
   * Bulk delete multiple assets
   */
  async bulkDelete(ids: string[], userId: string | null, tenantId: string, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of ids || []) {
      try {
        await withSavepoint(manager, () => this.deleteAsset(id, tenantId, userId, { manager }));
        result.deleted.push(id);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const s = await withSavepoint(manager, () => repo.findOne({ where: { id } as any }));
          if (s) name = s.name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch asset name for error reporting: ${err?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: error?.message || 'Unknown error', ...refusalDetails(error) });
      }
    }

    return result;
  }
}
