import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { Contract } from './contract.entity';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../common/storage/storage.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';
import { currentTenantId, deleteBlobs, unreferencedPaths } from '../spend/item-delete-cleanup';

/**
 * What deleting contracts removes, for the confirmation: the linked objects that lose their link
 * (each once, however many of the contracts name it) and what belongs to the contracts and goes
 * with them. Only contracts of the session tenant count.
 */
export type ContractDeleteImpact = {
  contracts: number;
  budget_lines: number;
  applications: number;
  assets: number;
  contacts: number;
  tasks: number;
  links: number;
  attachments: number;
  compliance_items: number;
};

/** Both natures of `spend_items` (`spend/budget-nature.ts`). */
const LINE_NATURES = naturesAnd('i', BUDGET_NATURES);
const NATURES = naturesAnd(null, BUDGET_NATURES);

/**
 * Deletes contracts. Their links go and the linked objects stay: budget lines (the link rows and
 * a line's own `contract_id`), applications, assets (links and support contract), contacts, and
 * the contract's tasks, which stay as tasks without a contract. What belongs to the contract goes
 * with it: its website links, attachments and recorded compliance requirements. Every statement
 * names the tenant; the links are removed here rather than left to foreign keys, as most link
 * tables have none. The search entry goes with the row (trigger). Attachment files go last, once
 * no attachment row of the tenant uses them.
 */
@Injectable()
export class ContractsDeleteService extends BaseDeleteService<Contract> {
  protected override readonly logger = new Logger(ContractsDeleteService.name);

  constructor(
    @InjectRepository(Contract) repository: Repository<Contract>,
    storage: StorageService,
    audit: AuditService,
  ) {
    super(repository, storage, audit, {
      entityName: 'Contract',
      auditTable: 'contracts',
      cascadeRelations: [],
    });
  }

  async deleteImpact(ids: string[], opts?: { manager?: EntityManager }): Promise<ContractDeleteImpact> {
    const manager = opts?.manager ?? this.repository.manager;
    const tenantId = await currentTenantId(manager);
    const wanted = Array.from(new Set((ids || []).map((id) => String(id || '').trim().toLowerCase()).filter((id) => isUuid(id))));
    const [row]: Array<Record<keyof ContractDeleteImpact, number>> = await manager.query(
      `WITH c AS (SELECT id FROM contracts WHERE tenant_id = $1 AND id = ANY($2::uuid[]))
       SELECT
         (SELECT count(*)::int FROM c) AS contracts,
         (SELECT count(*)::int FROM (
            SELECT l.spend_item_id FROM contract_spend_items l
              JOIN spend_items i ON i.tenant_id = l.tenant_id AND i.id = l.spend_item_id${LINE_NATURES}
             WHERE l.tenant_id = $1 AND l.contract_id IN (SELECT id FROM c)
            UNION
            SELECT i.id FROM spend_items i WHERE i.tenant_id = $1 AND i.contract_id IN (SELECT id FROM c)${LINE_NATURES}
          ) x) AS budget_lines,
         (SELECT count(DISTINCT application_id)::int FROM application_contracts WHERE tenant_id = $1 AND contract_id IN (SELECT id FROM c)) AS applications,
         (SELECT count(*)::int FROM (
            SELECT asset_id FROM asset_contracts WHERE tenant_id = $1 AND contract_id IN (SELECT id FROM c)
            UNION
            SELECT asset_id FROM asset_support_info WHERE tenant_id = $1 AND support_contract_id IN (SELECT id FROM c)
          ) x) AS assets,
         (SELECT count(DISTINCT contact_id)::int FROM contract_contacts WHERE tenant_id = $1 AND contract_id IN (SELECT id FROM c)) AS contacts,
         (SELECT count(*)::int FROM tasks WHERE tenant_id = $1 AND related_object_type = 'contract' AND related_object_id IN (SELECT id FROM c)) AS tasks,
         (SELECT count(*)::int FROM contract_links WHERE tenant_id = $1 AND contract_id IN (SELECT id FROM c)) AS links,
         (SELECT count(*)::int FROM contract_attachments WHERE tenant_id = $1 AND contract_id IN (SELECT id FROM c)) AS attachments,
         (SELECT count(*)::int FROM contract_compliance_items WHERE tenant_id = $1 AND contract_id IN (SELECT id FROM c)) AS compliance_items`,
      [tenantId, wanted],
    );
    return {
      contracts: row.contracts,
      budget_lines: row.budget_lines,
      applications: row.applications,
      assets: row.assets,
      contacts: row.contacts,
      tasks: row.tasks,
      links: row.links,
      attachments: row.attachments,
      compliance_items: row.compliance_items,
    };
  }

  override async delete(id: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const paths = await this.deleteOne(id, manager, opts?.userId ?? null, opts?.skipAudit);
    await deleteBlobs(this.storage, paths, this.logger);
  }

  async bulkDelete(ids: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const result: BulkDeleteResult = { deleted: [], failed: [] };
    const paths: string[] = [];

    for (const id of ids || []) {
      try {
        paths.push(...await withSavepoint(manager, () => this.deleteOne(id, manager, userId)));
        result.deleted.push(id);
      } catch (error: any) {
        let name = 'Unknown';
        if (isUuid(String(id))) {
          try {
            const found = await withSavepoint(manager, () => manager.getRepository(Contract).findOne({ where: { id } as any }));
            if (found) name = found.name;
          } catch (err: any) {
            this.logger.warn(`Failed to fetch contract name for error reporting: ${err?.message || 'Unknown error'}`);
          }
        }
        result.failed.push({ id, name, reason: error?.message || 'Unknown error' });
      }
    }

    await deleteBlobs(this.storage, paths, this.logger);
    return result;
  }

  /** Removes one contract and its links; returns the attachment files no row uses any more. */
  private async deleteOne(id: string, manager: EntityManager, userId: string | null, skipAudit = false): Promise<string[]> {
    const tenantId = await currentTenantId(manager);
    if (!isUuid(String(id))) throw new NotFoundException('Contract not found.');
    // Locked first: a relation replacement of the same contract waits, then finds it gone.
    const locked = await manager.query(`SELECT id FROM contracts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
    if (locked.length === 0) throw new NotFoundException('Contract not found.');
    const contract = await manager.getRepository(Contract).findOne({ where: { id, tenant_id: tenantId } as any });
    if (!contract) throw new NotFoundException('Contract not found.');
    const params = [tenantId, id];

    const attachments: Array<{ storage_path: string }> = await manager.query(
      `SELECT storage_path FROM contract_attachments WHERE tenant_id = $1 AND contract_id = $2`,
      params,
    );
    for (const table of [
      'contract_attachments',
      'contract_links',
      'contract_compliance_items',
      'contract_contacts',
      'contract_spend_items',
      'application_contracts',
      'asset_contracts',
      // The former task table: nothing writes it any more, its rows would outlive the contract.
      'contract_tasks',
    ]) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND contract_id = $2`, params);
    }
    await manager.query(
      `UPDATE asset_support_info SET support_contract_id = NULL, updated_at = now() WHERE tenant_id = $1 AND support_contract_id = $2`,
      params,
    );
    await manager.query(`UPDATE spend_items SET contract_id = NULL WHERE tenant_id = $1 AND contract_id = $2${NATURES}`, params);
    await manager.query(
      `UPDATE tasks SET related_object_type = NULL, related_object_id = NULL, updated_at = now()
        WHERE tenant_id = $1 AND related_object_type = 'contract' AND related_object_id = $2`,
      params,
    );
    await manager.query(`DELETE FROM contracts WHERE tenant_id = $1 AND id = $2`, params);

    if (!skipAudit) {
      await this.audit.log(
        { table: 'contracts', recordId: id, action: 'delete', before: contract, after: null, userId },
        { manager },
      );
    }

    return unreferencedPaths(manager, tenantId, [...new Set(attachments.map((a) => a.storage_path).filter(Boolean))]);
  }
}
