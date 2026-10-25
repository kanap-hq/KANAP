import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { linkedLineOf } from '../../spend/budget-nature';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Asset } from '../asset.entity';
import { AssetRelation } from '../asset-relation.entity';
import { AssetSpendItemLink } from '../asset-spend-item.entity';
import { AssetContractLink } from '../asset-contract.entity';
import { AuditService } from '../../audit/audit.service';
import { AssetsBaseService, ServiceOpts } from './assets-base.service';
import { auditedLinkSet, hiddenLineCount } from '../../data-access/hidden-links';

/**
 * Service for managing asset relations and financial links (spend, capex, contracts).
 */
@Injectable()
export class AssetsRelationsService extends AssetsBaseService {
  constructor(
    @InjectRepository(Asset) assetRepo: Repository<Asset>,
    @InjectRepository(AssetRelation) private readonly relationsRepo: Repository<AssetRelation>,
    @InjectRepository(AssetSpendItemLink) private readonly spendItemsRepo: Repository<AssetSpendItemLink>,
    @InjectRepository(AssetContractLink) private readonly contractsRepo: Repository<AssetContractLink>,
    private readonly audit: AuditService,
  ) {
    super(assetRepo);
  }

  // =========================================================================
  // Asset Relations Methods
  // =========================================================================

  /**
   * List relations for an asset.
   */
  async listRelations(assetId: string, opts?: ServiceOpts) {
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, opts?.manager, tenantId);
    const mg = this.getManager(opts);

    // Get relations where this asset is the source
    const outgoing: Array<{
      id: string;
      related_asset_id: string;
      relation_type: string;
      notes: string | null;
      related_name: string;
    }> = await mg.query(
      `SELECT ar.id, ar.related_asset_id, ar.relation_type, ar.notes, a.name AS related_name
       FROM asset_relations ar
       JOIN assets a ON a.id = ar.related_asset_id
       WHERE ar.asset_id = $1 AND ar.tenant_id = $2 AND a.tenant_id = $2
       ORDER BY ar.relation_type, a.name`,
      [assetId, tenantId],
    );

    // Get relations where this asset is the target (reverse relations)
    const incoming: Array<{
      id: string;
      asset_id: string;
      relation_type: string;
      notes: string | null;
      source_name: string;
    }> = await mg.query(
      `SELECT ar.id, ar.asset_id, ar.relation_type, ar.notes, a.name AS source_name
       FROM asset_relations ar
       JOIN assets a ON a.id = ar.asset_id
       WHERE ar.related_asset_id = $1 AND ar.tenant_id = $2 AND a.tenant_id = $2
       ORDER BY ar.relation_type, a.name`,
      [assetId, tenantId],
    );

    return { outgoing, incoming };
  }

  /**
   * Bulk replace relations for an asset.
   */
  async bulkReplaceRelations(
    assetId: string,
    relations: Array<{ related_asset_id: string; relation_type: string; notes?: string }>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const asset = await this.ensureAsset(assetId, opts?.manager, tenant);
    const repo = opts?.manager ? opts.manager.getRepository(AssetRelation) : this.relationsRepo;
    const mg = this.getManager(opts);
    // Same lock as `addRelation`, taken before reading: a relation added at the
    // same moment is either committed and listed in `before`, or waits for this
    // replacement to commit.
    await this.lockSourceAsset(mg, asset.tenant_id, assetId);

    const existing = await repo.find({ where: { asset_id: assetId, tenant_id: asset.tenant_id } as any });
    const before = existing.map((r) => ({ related_asset_id: r.related_asset_id, relation_type: r.relation_type }));

    // Validate relation types
    const validTypes = ['contains', 'depends_on'];
    for (const rel of relations) {
      if (!validTypes.includes(rel.relation_type)) {
        throw new BadRequestException(`Invalid relation_type "${rel.relation_type}"`);
      }
      if (rel.related_asset_id === assetId) {
        throw new BadRequestException('Asset cannot have a relation to itself');
      }
    }

    // Validate related assets exist
    const relatedIds = [...new Set(relations.map((r) => r.related_asset_id))];
    if (relatedIds.length > 0) {
      const found = await mg.query(
        `SELECT id FROM assets WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [relatedIds, asset.tenant_id],
      );
      if (found.length !== relatedIds.length) {
        throw new BadRequestException('One or more related assets were not found');
      }
    }

    // Replace relations
    await repo.delete({ asset_id: assetId, tenant_id: asset.tenant_id } as any);
    if (relations.length > 0) {
      const entities = relations.map((rel) =>
        repo.create({
          tenant_id: asset.tenant_id,
          asset_id: assetId,
          related_asset_id: rel.related_asset_id,
          relation_type: rel.relation_type as 'contains' | 'depends_on',
          notes: this.normalizeNullable(rel.notes),
        }),
      );
      await repo.save(entities);
    }

    await this.audit.log(
      {
        table: 'asset_relations',
        recordId: assetId,
        action: 'update',
        before: { relations: before },
        after: { relations: relations.map((r) => ({ related_asset_id: r.related_asset_id, relation_type: r.relation_type })) },
        userId,
      },
      { manager: opts?.manager },
    );

    return this.listRelations(assetId, { ...(opts || {}), tenantId: tenant });
  }

  /**
   * Adds one relation and leaves every other relation of the asset as it is. For a writer that
   * only ever adds, such as the Netbox import attaching a virtual machine to its cluster:
   * `bulkReplaceRelations` would drop whatever that writer does not know about. Returns false
   * when the relation was already there, which writes nothing and logs nothing.
   *
   * The asset row is locked first with the lock `bulkReplaceRelations` takes, so the two run one
   * after the other: a replacement that started first commits before this reads the relations, and
   * one that starts later lists the added relation in its `before`. The insert then never meets an
   * uncommitted row, and the audit entry lists the relations as they really are.
   */
  async addRelation(
    assetId: string,
    relatedAssetId: string,
    relationType: 'contains' | 'depends_on',
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ): Promise<boolean> {
    const tenant = this.ensureTenantId(tenantId);
    const mg = this.getManager(opts);
    if (relatedAssetId === assetId) {
      throw new BadRequestException('Asset cannot have a relation to itself');
    }
    await this.lockSourceAsset(mg, tenant, assetId);
    const related = await mg.query(
      `SELECT id FROM assets WHERE tenant_id = $1 AND id = $2`,
      [tenant, relatedAssetId],
    );
    if (related.length === 0) {
      throw new BadRequestException('One or more related assets were not found');
    }

    const existing: Array<{ related_asset_id: string; relation_type: string }> = await mg.query(
      `SELECT related_asset_id, relation_type FROM asset_relations
       WHERE tenant_id = $1 AND asset_id = $2
       ORDER BY created_at, id`,
      [tenant, assetId],
    );
    const added: Array<{ count: number }> = await mg.query(
      `WITH added AS (
         INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, asset_id, related_asset_id, relation_type) DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::int AS count FROM added`,
      [tenant, assetId, relatedAssetId, relationType],
    );
    if (Number(added[0]?.count ?? 0) === 0) return false;

    const before = existing.map((r) => ({ related_asset_id: r.related_asset_id, relation_type: r.relation_type }));
    await this.audit.log(
      {
        table: 'asset_relations',
        recordId: assetId,
        action: 'update',
        before: { relations: before },
        after: { relations: [...before, { related_asset_id: relatedAssetId, relation_type: relationType }] },
        userId,
        ...this.auditSource(opts),
      },
      { manager: opts?.manager },
    );
    return true;
  }

  /**
   * Removes one relation and leaves every other relation of the asset as it is, the reverse of
   * `addRelation`: the same refusals, the same lock on the source asset, and the same audit entry
   * (`asset_relations`, `recordId` the source asset, `{ relations }` before and after). Returns
   * false when the relation was not there, which writes nothing and logs nothing.
   */
  async removeRelation(
    assetId: string,
    relatedAssetId: string,
    relationType: 'contains' | 'depends_on',
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ): Promise<boolean> {
    const tenant = this.ensureTenantId(tenantId);
    const mg = this.getManager(opts);
    if (relatedAssetId === assetId) {
      throw new BadRequestException('Asset cannot have a relation to itself');
    }
    await this.lockSourceAsset(mg, tenant, assetId);
    const related = await mg.query(
      `SELECT id FROM assets WHERE tenant_id = $1 AND id = $2`,
      [tenant, relatedAssetId],
    );
    if (related.length === 0) {
      throw new BadRequestException('One or more related assets were not found');
    }

    const existing: Array<{ related_asset_id: string; relation_type: string }> = await mg.query(
      `SELECT related_asset_id, relation_type FROM asset_relations
       WHERE tenant_id = $1 AND asset_id = $2
       ORDER BY created_at, id`,
      [tenant, assetId],
    );
    const removed: Array<{ count: number }> = await mg.query(
      `WITH removed AS (
         DELETE FROM asset_relations
          WHERE tenant_id = $1 AND asset_id = $2 AND related_asset_id = $3 AND relation_type = $4
         RETURNING 1
       )
       SELECT count(*)::int AS count FROM removed`,
      [tenant, assetId, relatedAssetId, relationType],
    );
    if (Number(removed[0]?.count ?? 0) === 0) return false;

    const before = existing.map((r) => ({ related_asset_id: r.related_asset_id, relation_type: r.relation_type }));
    const after = before.filter((r) => !(r.related_asset_id === relatedAssetId && r.relation_type === relationType));
    await this.audit.log(
      {
        table: 'asset_relations',
        recordId: assetId,
        action: 'update',
        before: { relations: before },
        after: { relations: after },
        userId,
        ...this.auditSource(opts),
      },
      { manager: opts?.manager },
    );
    return true;
  }

  /**
   * Locks the asset whose relations are about to change, for the rest of the transaction.
   * `FOR NO KEY UPDATE` is enough to stop a delete or a change of the row, and it still lets
   * other transactions insert rows that reference the asset (their key share lock).
   */
  private async lockSourceAsset(mg: EntityManager, tenantId: string, assetId: string): Promise<void> {
    const locked = await mg.query(
      `SELECT id FROM assets WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
      [tenantId, assetId],
    );
    if (locked.length === 0) throw new NotFoundException('Asset not found');
  }

  // =========================================================================
  // Financial Links - OPEX (Spend Items)
  // =========================================================================

  /**
   * List linked spend items for an asset.
   */
  async listLinkedSpendItems(assetId: string, opts?: ServiceOpts) {
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, opts?.manager, tenantId);
    const mg = this.getManager(opts);

    const rows: Array<{ id: string; product_name: string; item_number: number }> = await mg.query(
      `SELECT si.id, si.product_name, si.item_number
       FROM asset_spend_items asi
       JOIN spend_items si ON si.id = asi.spend_item_id
       WHERE asi.asset_id = $1 AND asi.tenant_id = $2 AND si.tenant_id = $2 AND si.nature = 'opex'
       ORDER BY si.product_name`,
      [assetId, tenantId],
    );
    return { items: rows };
  }

  /**
   * Bulk replace linked spend items for an asset.
   */
  async bulkReplaceLinkedSpendItems(
    assetId: string,
    spendItemIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const asset = await this.ensureAsset(assetId, opts?.manager, tenant);
    const repo = opts?.manager ? opts.manager.getRepository(AssetSpendItemLink) : this.spendItemsRepo;
    const mg = this.getManager(opts);

    // The links to OPEX lines only (`spend/budget-nature.ts`): the asset's links to lines of
    // another nature are neither listed, nor replaced, nor removed here.
    const opexLink = linkedLineOf('l.tenant_id', 'l.spend_item_id', 'opex');
    const existing: Array<{ spend_item_id: string }> = await mg.query(
      `SELECT l.spend_item_id FROM asset_spend_items l WHERE l.asset_id = $1 AND l.tenant_id = $2${opexLink}`,
      [assetId, asset.tenant_id],
    );
    const before = existing.map((r) => r.spend_item_id);

    const normalizedIds = [...new Set(spendItemIds.filter((id) => id))];

    // Validate spend items exist
    if (normalizedIds.length > 0) {
      const found = await mg.query(
        `SELECT id FROM spend_items WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND nature = 'opex'`,
        [normalizedIds, asset.tenant_id],
      );
      if (found.length !== normalizedIds.length) {
        throw new BadRequestException('One or more spend items were not found');
      }
    }

    await mg.query(`DELETE FROM asset_spend_items l WHERE l.asset_id = $1 AND l.tenant_id = $2${opexLink}`, [assetId, asset.tenant_id]);
    if (normalizedIds.length > 0) {
      const entities = normalizedIds.map((id) =>
        repo.create({ tenant_id: asset.tenant_id, asset_id: assetId, spend_item_id: id }),
      );
      await repo.save(entities);
    }

    // The lines a limited person cannot read stayed linked: the audit row says how many (spec §6.6).
    const hidden = await hiddenLineCount(mg, 'asset', assetId);
    await this.audit.log(
      {
        table: 'asset_spend_items',
        recordId: assetId,
        action: 'update',
        before: auditedLinkSet({ ids: before }, hidden),
        after: auditedLinkSet({ ids: normalizedIds }, hidden),
        userId,
      },
      { manager: opts?.manager },
    );

    return this.listLinkedSpendItems(assetId, { ...(opts || {}), tenantId: tenant });
  }

  // =========================================================================
  // Financial Links - CAPEX
  // =========================================================================

  /**
   * List linked capex items for an asset.
   */
  async listLinkedCapexItems(assetId: string, opts?: ServiceOpts) {
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, opts?.manager, tenantId);
    const mg = this.getManager(opts);

    // The CAPEX lines (the same link table as the OPEX ones since lot Z1); the title as `description`.
    const rows: Array<{ id: string; description: string; item_number: number }> = await mg.query(
      `SELECT ci.id, ci.product_name AS description, ci.item_number
       FROM asset_spend_items aci
       JOIN spend_items ci ON ci.id = aci.spend_item_id
       WHERE aci.asset_id = $1 AND aci.tenant_id = $2 AND ci.tenant_id = $2 AND ci.nature = 'capex'
       ORDER BY ci.product_name`,
      [assetId, tenantId],
    );
    return { items: rows };
  }

  /**
   * Bulk replace linked capex items for an asset.
   */
  async bulkReplaceLinkedCapexItems(
    assetId: string,
    capexItemIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const asset = await this.ensureAsset(assetId, opts?.manager, tenant);
    const repo = opts?.manager ? opts.manager.getRepository(AssetSpendItemLink) : this.spendItemsRepo;
    const mg = this.getManager(opts);

    // The links to CAPEX lines only (`spend/budget-nature.ts`): the asset's links to OPEX lines,
    // in the same table since lot Z1, are neither listed, nor replaced, nor removed here.
    const capexLink = linkedLineOf('l.tenant_id', 'l.spend_item_id', 'capex');
    const existing: Array<{ spend_item_id: string }> = await mg.query(
      `SELECT l.spend_item_id FROM asset_spend_items l WHERE l.asset_id = $1 AND l.tenant_id = $2${capexLink}`,
      [assetId, asset.tenant_id],
    );
    const before = existing.map((r) => r.spend_item_id);

    const normalizedIds = [...new Set(capexItemIds.filter((id) => id))];

    if (normalizedIds.length > 0) {
      const found = await mg.query(
        `SELECT id FROM spend_items WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND nature = 'capex'`,
        [normalizedIds, asset.tenant_id],
      );
      if (found.length !== normalizedIds.length) {
        throw new BadRequestException('One or more CAPEX items were not found');
      }
    }

    await mg.query(`DELETE FROM asset_spend_items l WHERE l.asset_id = $1 AND l.tenant_id = $2${capexLink}`, [assetId, asset.tenant_id]);
    if (normalizedIds.length > 0) {
      const entities = normalizedIds.map((id) =>
        repo.create({ tenant_id: asset.tenant_id, asset_id: assetId, spend_item_id: id }),
      );
      await repo.save(entities);
    }

    // The lines a limited person cannot read stayed linked: the audit row says how many (spec §6.6).
    const hidden = await hiddenLineCount(mg, 'asset', assetId);
    await this.audit.log(
      {
        table: 'asset_capex_items',
        recordId: assetId,
        action: 'update',
        before: auditedLinkSet({ ids: before }, hidden),
        after: auditedLinkSet({ ids: normalizedIds }, hidden),
        userId,
      },
      { manager: opts?.manager },
    );

    return this.listLinkedCapexItems(assetId, { ...(opts || {}), tenantId: tenant });
  }

  // =========================================================================
  // Financial Links - Contracts
  // =========================================================================

  /**
   * List linked contracts for an asset.
   */
  async listLinkedContracts(assetId: string, opts?: ServiceOpts) {
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, opts?.manager, tenantId);
    const mg = this.getManager(opts);

    const rows: Array<{ id: string; name: string }> = await mg.query(
      `SELECT c.id, c.name
       FROM asset_contracts ac
       JOIN contracts c ON c.id = ac.contract_id
       WHERE ac.asset_id = $1 AND ac.tenant_id = $2 AND c.tenant_id = $2
       ORDER BY c.name`,
      [assetId, tenantId],
    );
    return { items: rows };
  }

  /**
   * Bulk replace linked contracts for an asset.
   */
  async bulkReplaceLinkedContracts(
    assetId: string,
    contractIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const asset = await this.ensureAsset(assetId, opts?.manager, tenant);
    const repo = opts?.manager ? opts.manager.getRepository(AssetContractLink) : this.contractsRepo;
    const mg = this.getManager(opts);

    const existing = await repo.find({ where: { asset_id: assetId, tenant_id: asset.tenant_id } as any });
    const before = existing.map((r) => r.contract_id);

    const normalizedIds = [...new Set(contractIds.filter((id) => id))];

    if (normalizedIds.length > 0) {
      const found = await mg.query(
        `SELECT id FROM contracts WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [normalizedIds, asset.tenant_id],
      );
      if (found.length !== normalizedIds.length) {
        throw new BadRequestException('One or more contracts were not found');
      }
    }

    await repo.delete({ asset_id: assetId, tenant_id: asset.tenant_id } as any);
    if (normalizedIds.length > 0) {
      const entities = normalizedIds.map((id) =>
        repo.create({ tenant_id: asset.tenant_id, asset_id: assetId, contract_id: id }),
      );
      await repo.save(entities);
    }

    await this.audit.log(
      { table: 'asset_contracts', recordId: assetId, action: 'update', before: { ids: before }, after: { ids: normalizedIds }, userId },
      { manager: opts?.manager },
    );

    return this.listLinkedContracts(assetId, { ...(opts || {}), tenantId: tenant });
  }
}
