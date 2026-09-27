import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Asset } from './asset.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

@Injectable()
export class AssetsDeleteService extends BaseDeleteService<Asset> {
  protected override readonly logger = new Logger(AssetsDeleteService.name);

  constructor(
    @InjectRepository(Asset) repository: Repository<Asset>,
    audit: AuditService,
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
    return { count: Number(count || 0), samples: rows };
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
   * Delete an asset by ID with tenant context
   */
  async deleteAsset(id: string, tenantId: string, userId: string | null, opts?: { manager?: EntityManager }): Promise<{ deleted: boolean }> {
    const manager = opts?.manager ?? this.repository.manager;
    const asset = await this.ensureAsset(id, tenantId, manager);

    const assignments = await this.findAssignments(id, tenantId, manager);
    const connections = await this.findConnections(id, tenantId, manager);

    if (assignments.count > 0 || connections.count > 0) {
      throw new ConflictException(this.buildConflictMessage(asset.name, assignments, connections));
    }

    await this.getRepo(manager).delete({ id } as any);

    await this.audit.log(
      { table: 'assets', recordId: id, action: 'delete', before: asset, after: null, userId },
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
        await withSavepoint(manager, async () => {
          const asset = await this.ensureAsset(id, tenantId, manager);
          const assignments = await this.findAssignments(id, tenantId, manager);
          const connections = await this.findConnections(id, tenantId, manager);
          if (assignments.count > 0 || connections.count > 0) {
            throw new ConflictException(this.buildConflictMessage(asset.name, assignments, connections));
          }

          await repo.delete({ id } as any);
          await this.audit.log(
            { table: 'assets', recordId: id, action: 'delete', before: asset, after: null, userId },
            { manager },
          );
        });
        result.deleted.push(id);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const s = await withSavepoint(manager, () => repo.findOne({ where: { id } as any }));
          if (s) name = s.name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch asset name for error reporting: ${err?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: error?.message || 'Unknown error' });
      }
    }

    return result;
  }
}
