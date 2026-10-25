import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { linkedLineOf } from '../../spend/budget-nature';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Asset } from '../asset.entity';
import { AssetRelation } from '../asset-relation.entity';
import { AssetSpendItemLink } from '../asset-spend-item.entity';
import { AssetContractLink } from '../asset-contract.entity';
import { AuditService } from '../../audit/audit.service';
import { lockAssignmentClusters } from '../../app-asset-assignments/cluster-assignment-rules';
import {
  assertNotPlacedByCluster,
  doubleContainersOf,
  replaceHostLinks,
  type DoubleContainer,
  type ReplacedHostLink,
} from '../placement-rules';
import { AssetsBaseService, ServiceOpts } from './assets-base.service';

/** What one relation write changed, with the placement rules applied (`placement-rules.ts`). */
export type RelationWriteResult = {
  changed: boolean;
  replaced: ReplacedHostLink[];
  doubles: DoubleContainer[];
};

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
   *
   * A replacement that carries a `contains` follows the placement rules (`placement-rules.ts`):
   * the clusters the source decides on are locked first, then the source asset; a host member of
   * a cluster that already contains one of the added assets is refused (`placement_inherited`),
   * and a cluster's added `contains` absorbs the links its members in service held towards the
   * same assets. Only the added `contains` are absorbed: saving the same set again removes
   * nothing. The response carries `replaced_host_links` and `double_containers` when they are not
   * empty.
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
    // The cluster rules take the same cluster lock, before the source asset: a cluster cannot
    // change while this write decides on its members.
    const writesContains = relations.some((rel) => rel.relation_type === 'contains');
    if (writesContains) await lockAssignmentClusters(mg, tenant, [assetId]);
    // Same lock as `addRelation`, taken before reading: a relation added at the
    // same moment is either committed and listed in `before`, or waits for this
    // replacement to commit.
    await this.lockSourceAsset(mg, asset.tenant_id, assetId);

    const existing = await repo.find({ where: { asset_id: assetId, tenant_id: asset.tenant_id } as any });
    const before = existing.map((r) => ({ related_asset_id: r.related_asset_id, relation_type: r.relation_type }));
    const storedContains = new Set(existing.filter((r) => r.relation_type === 'contains').map((r) => r.related_asset_id));
    const addedContains = Array.from(new Set(
      relations
        .filter((rel) => rel.relation_type === 'contains' && !storedContains.has(rel.related_asset_id))
        .map((rel) => rel.related_asset_id),
    ));

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

    // The source is read after the locks, in its own statement: a host member of a cluster that
    // already contains an added asset cannot write the duplicate container (R2).
    const source: Array<{ is_cluster: boolean; name: string }> = writesContains
      ? await mg.query(`SELECT is_cluster, name FROM assets WHERE tenant_id = $1 AND id = $2`, [asset.tenant_id, assetId])
      : [];
    const isCluster = source[0]?.is_cluster === true;
    if (writesContains && !isCluster && addedContains.length > 0) {
      await assertNotPlacedByCluster(mg, asset.tenant_id, assetId, addedContains);
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

    // R1 after the write: a cluster absorbs the links its members held towards the added assets.
    const replaced = writesContains && isCluster && addedContains.length > 0
      ? await replaceHostLinks(mg, this.audit, asset.tenant_id, { id: assetId, name: source[0].name }, addedContains, userId, this.auditSource(opts))
      : [];
    const doubles = writesContains && addedContains.length > 0
      ? await doubleContainersOf(mg, asset.tenant_id, addedContains)
      : [];

    const listed = await this.listRelations(assetId, { ...(opts || {}), tenantId: tenant });
    return {
      ...listed,
      ...(replaced.length > 0 ? { replaced_host_links: replaced } : {}),
      ...(doubles.length > 0 ? { double_containers: doubles } : {}),
    };
  }

  /**
   * Adds one relation and leaves every other relation of the asset as it is. For a writer that
   * only ever adds, such as the Netbox import attaching a virtual machine to its cluster:
   * `bulkReplaceRelations` would drop whatever that writer does not know about. Returns false
   * when the relation was already there and nothing was absorbed, which writes nothing and logs
   * nothing.
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
    return (await this.addRelationWithPlacement(assetId, relatedAssetId, relationType, tenantId, userId, opts)).changed;
  }

  /**
   * `addRelation`, with the placement rules of a `contains` (`placement-rules.ts`):
   * - the clusters the source decides on are locked before the source asset, as the members
   *   endpoint and the cluster switch do (`lockAssignmentClusters`), then the source row;
   * - a host member of a cluster in service that already contains the related asset is refused
   *   (`placement_inherited`), unless the very link already exists: re-posting it writes nothing
   *   and is never refused;
   * - a cluster absorbs the links its members in service held towards the related asset, even
   *   when its own link was already there; `changed` is then true when a link was removed.
   * Returns what was absorbed and the double containers the related asset has afterwards.
   */
  async addRelationWithPlacement(
    assetId: string,
    relatedAssetId: string,
    relationType: 'contains' | 'depends_on',
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ): Promise<RelationWriteResult> {
    const tenant = this.ensureTenantId(tenantId);
    const mg = this.getManager(opts);
    if (relatedAssetId === assetId) {
      throw new BadRequestException('Asset cannot have a relation to itself');
    }
    const placement = relationType === 'contains';
    // R1 and R2 decide on the clusters of the source: the same lock the members endpoint and the
    // cluster switch take, before the source asset, in one order shared by every writer.
    if (placement) await lockAssignmentClusters(mg, tenant, [assetId]);
    await this.lockSourceAsset(mg, tenant, assetId);
    const related = await mg.query(
      `SELECT id FROM assets WHERE tenant_id = $1 AND id = $2`,
      [tenant, relatedAssetId],
    );
    if (related.length === 0) {
      throw new BadRequestException('One or more related assets were not found');
    }

    // The source's kind is read after the locks, in its own statement.
    const source: Array<{ is_cluster: boolean; name: string }> = placement
      ? await mg.query(`SELECT is_cluster, name FROM assets WHERE tenant_id = $1 AND id = $2`, [tenant, assetId])
      : [];
    const isCluster = source[0]?.is_cluster === true;

    const existing: Array<{ related_asset_id: string; relation_type: string }> = await mg.query(
      `SELECT related_asset_id, relation_type FROM asset_relations
       WHERE tenant_id = $1 AND asset_id = $2
       ORDER BY created_at, id`,
      [tenant, assetId],
    );
    const exists = existing.some((row) => row.related_asset_id === relatedAssetId && row.relation_type === relationType);
    // R2: a member's new link is refused when one of its clusters already contains the asset. A
    // link already there is left as it is, so an older double stays and is only reported.
    if (placement && !isCluster && !exists) {
      await assertNotPlacedByCluster(mg, tenant, assetId, [relatedAssetId]);
    }

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
    const inserted = Number(added[0]?.count ?? 0) > 0;

    const before = existing.map((r) => ({ related_asset_id: r.related_asset_id, relation_type: r.relation_type }));
    if (inserted) {
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
    }

    // R1: a cluster absorbs its members' links towards the related asset, even when its own link
    // was already there (an older double, corrected by re-posting it).
    const replaced = placement && isCluster
      ? await replaceHostLinks(
        mg, this.audit, tenant, { id: assetId, name: source[0].name }, [relatedAssetId], userId, this.auditSource(opts),
      )
      : [];
    // R3: the doubles are reported, never refused.
    const doubles = placement ? await doubleContainersOf(mg, tenant, [relatedAssetId]) : [];
    return { changed: inserted || replaced.length > 0, replaced, doubles };
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

    await this.audit.log(
      { table: 'asset_spend_items', recordId: assetId, action: 'update', before: { ids: before }, after: { ids: normalizedIds }, userId },
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

    await this.audit.log(
      { table: 'asset_capex_items', recordId: assetId, action: 'update', before: { ids: before }, after: { ids: normalizedIds }, userId },
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
