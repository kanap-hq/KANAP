import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CapexItemContactLink, ContactOrigin } from './capex-item-contact.entity';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactRole } from '../contacts/supplier-contact.entity';
import { CapexItem } from './capex-item.entity';
import { AuditService } from '../audit/audit.service';
import { attachManualContactLink, LINK_REMOVED } from '../contacts/contact-link-attach.util';

/** The request's tenant: every statement filters on it. */
type ItemContactsOpts = { manager?: EntityManager; tenantId: string };

@Injectable()
export class CapexItemContactsService {
  constructor(
    @InjectRepository(CapexItemContactLink)
    private readonly linkRepo: Repository<CapexItemContactLink>,
    @InjectRepository(ExternalContact)
    private readonly contactRepo: Repository<ExternalContact>,
    @InjectRepository(CapexItem)
    private readonly itemRepo: Repository<CapexItem>,
    private readonly audit: AuditService,
  ) {}

  private getLinkRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(CapexItemContactLink) : this.linkRepo;
  }
  private getContactRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(ExternalContact) : this.contactRepo;
  }
  private getItemRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(CapexItem) : this.itemRepo;
  }

  async listForItem(itemId: string, opts: ItemContactsOpts) {
    const repo = this.getLinkRepo(opts.manager);
    const items = await repo.find({
      where: { tenant_id: opts.tenantId, capex_item_id: itemId },
      order: { role: 'ASC', created_at: 'DESC' } as any,
      relations: ['contact'],
    });
    return items;
  }

  async attachManual(
    itemId: string,
    params: { contactId: string; role: SupplierContactRole },
    userId: string | null | undefined,
    opts: ItemContactsOpts,
  ) {
    const repo = this.getLinkRepo(opts.manager);
    const contactRepo = this.getContactRepo(opts.manager);
    const itemRepo = this.getItemRepo(opts.manager);

    const item = await itemRepo.findOne({ where: { tenant_id: opts.tenantId, id: itemId } as any });
    if (!item) throw new NotFoundException('Capex item not found');

    const contact = await contactRepo.findOne({ where: { tenant_id: opts.tenantId, id: params.contactId } });
    if (!contact) throw new NotFoundException('Contact not found');

    // Idempotent: the link of (item, contact, role) committed first is returned as it is.
    const { id, created } = await attachManualContactLink(repo.manager, 'capex_item_contacts', {
      tenantId: item.tenant_id,
      ownerId: itemId,
      contactId: params.contactId,
      role: params.role,
    });
    const saved = await repo.findOne({ where: { tenant_id: item.tenant_id, id } });
    if (!saved) throw new ConflictException(LINK_REMOVED);
    if (!created) return saved;
    await this.audit.log(
      {
        table: 'capex_item_contacts',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId: userId ?? null,
      },
      { manager: opts.manager ?? repo.manager },
    );
    return saved;
  }

  /** Remove one contact link of the item; a link of another item is not found. */
  async detach(itemId: string, linkId: string, userId: string | null | undefined, opts: ItemContactsOpts) {
    const repo = this.getLinkRepo(opts.manager);
    const existing = await repo.findOne({ where: { tenant_id: opts.tenantId, id: linkId, capex_item_id: itemId } });
    if (!existing) throw new NotFoundException('Link not found');
    await repo.delete({ tenant_id: opts.tenantId, id: linkId, capex_item_id: itemId });
    await this.audit.log(
      {
        table: 'capex_item_contacts',
        recordId: linkId,
        action: 'delete',
        before: existing,
        after: null,
        userId: userId ?? null,
      },
      { manager: opts.manager ?? repo.manager },
    );
    return { ok: true };
  }

  /**
   * Sync contacts from supplier. Called when supplier_id changes on the item.
   * 1. Remove all contacts with origin='supplier'
   * 2. If newSupplierId is not null, fetch supplier's contacts and add them with origin='supplier'
   */
  async syncFromSupplier(itemId: string, newSupplierId: string | null, userId: string | null | undefined, opts: ItemContactsOpts) {
    const repo = this.getLinkRepo(opts.manager);
    const itemRepo = this.getItemRepo(opts.manager);

    const item = await itemRepo.findOne({ where: { tenant_id: opts.tenantId, id: itemId } as any });
    if (!item) throw new NotFoundException('Capex item not found');
    const tenantId = item.tenant_id;
    const before = await repo.find({ where: { tenant_id: tenantId, capex_item_id: itemId, origin: ContactOrigin.SUPPLIER } });

    // 1. Remove all supplier-derived contacts
    await repo.delete({ tenant_id: tenantId, capex_item_id: itemId, origin: ContactOrigin.SUPPLIER });

    // 2. Add the new supplier's contacts in one statement; a contact and role already on the line (manual) is kept.
    if (newSupplierId) {
      await repo.manager.query(
        `INSERT INTO capex_item_contacts (tenant_id, capex_item_id, contact_id, role, origin)
         SELECT sc.tenant_id, $2::uuid, sc.contact_id, sc.role, 'supplier'
           FROM supplier_contacts sc
          WHERE sc.tenant_id = $1 AND sc.supplier_id = $3
         ON CONFLICT (tenant_id, capex_item_id, contact_id, role) DO NOTHING`,
        [tenantId, itemId, newSupplierId],
      );
    }

    const after = await repo.find({ where: { tenant_id: tenantId, capex_item_id: itemId, origin: ContactOrigin.SUPPLIER } });
    const beforeState = before.map((r) => `${r.contact_id}:${r.role}`).sort();
    const afterState = after.map((r) => `${r.contact_id}:${r.role}`).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'capex_item_contacts',
          recordId: itemId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: opts.manager ?? repo.manager },
      );
    }
  }

  /**
   * Called when supplier_id on item changes. Fetches item's supplier and syncs.
   */
  async syncFromSupplierForItem(itemId: string, userId: string | null | undefined, opts: ItemContactsOpts) {
    const itemRepo = this.getItemRepo(opts.manager);
    const item = await itemRepo.findOne({ where: { tenant_id: opts.tenantId, id: itemId } as any });
    if (!item) throw new NotFoundException('Capex item not found');
    await this.syncFromSupplier(itemId, item.supplier_id, userId, opts);
  }
}
