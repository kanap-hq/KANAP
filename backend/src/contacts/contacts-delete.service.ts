import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ExternalContact } from './external-contact.entity';
import { SupplierContactLink } from './supplier-contact.entity';
import { BaseDeleteService } from '../common/base-delete.service';
import { AuditService } from '../audit/audit.service';
import { BulkDeleteResult } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

@Injectable()
export class ContactsDeleteService extends BaseDeleteService<ExternalContact> {
  protected override readonly logger = new Logger(ContactsDeleteService.name);

  constructor(
    @InjectRepository(ExternalContact) repository: Repository<ExternalContact>,
    @InjectRepository(SupplierContactLink) private readonly linksRepo: Repository<SupplierContactLink>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'Contact',
      cascadeRelations: [
        {
          repository: SupplierContactLink,
          foreignKey: 'contact_id',
          deleteStrategy: 'cascade',
        },
      ],
    });
  }

  /**
   * Delete a single contact (legacy method for backwards compatibility)
   */
  async deleteOne(contactId: string, opts?: { manager?: EntityManager }): Promise<void> {
    await this.delete(contactId, { manager: opts?.manager, skipAudit: true });
  }

  /**
   * Bulk delete multiple contacts
   */
  async bulkDelete(ids: string[], opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of ids) {
      try {
        await withSavepoint(manager, () => this.delete(id, { manager, skipAudit: true }));
        result.deleted.push(id);
      } catch (e: any) {
        let name = 'Unknown';
        try {
          const c = await withSavepoint(manager, () => repo.findOne({ where: { id } }));
          if (c) name = c.email;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch contact name for error reporting: ${err?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: e?.message || 'Unknown error' });
      }
    }
    return result;
  }
}
