import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SpendItemContactLink, ContactOrigin } from './spend-item-contact.entity';
import { ExternalContact } from '../contacts/external-contact.entity';
import { SupplierContactLink, SupplierContactRole } from '../contacts/supplier-contact.entity';
import { SpendItem } from './spend-item.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SpendItemContactsService {
  constructor(
    @InjectRepository(SpendItemContactLink)
    private readonly linkRepo: Repository<SpendItemContactLink>,
    @InjectRepository(ExternalContact)
    private readonly contactRepo: Repository<ExternalContact>,
    @InjectRepository(SupplierContactLink)
    private readonly supplierContactRepo: Repository<SupplierContactLink>,
    @InjectRepository(SpendItem)
    private readonly itemRepo: Repository<SpendItem>,
    private readonly audit: AuditService,
  ) {}

  private getLinkRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(SpendItemContactLink) : this.linkRepo;
  }
  private getContactRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(ExternalContact) : this.contactRepo;
  }
  private getSupplierContactRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(SupplierContactLink) : this.supplierContactRepo;
  }
  private getItemRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(SpendItem) : this.itemRepo;
  }

  async listForItem(itemId: string, opts?: { manager?: EntityManager }) {
    const repo = this.getLinkRepo(opts?.manager);
    const items = await repo.find({
      where: { spend_item_id: itemId },
      order: { role: 'ASC', created_at: 'DESC' } as any,
      relations: ['contact'],
    });
    return items;
  }

  async attachManual(
    itemId: string,
    params: { contactId: string; role: SupplierContactRole },
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const repo = this.getLinkRepo(opts?.manager);
    const contactRepo = this.getContactRepo(opts?.manager);
    const itemRepo = this.getItemRepo(opts?.manager);

    const item = await itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Spend item not found');

    const contact = await contactRepo.findOne({ where: { id: params.contactId } });
    if (!contact) throw new NotFoundException('Contact not found');

    // Check duplicate by (item, contact, role)
    const existing = await repo.findOne({
      where: { spend_item_id: itemId, contact_id: params.contactId, role: params.role },
    });
    if (existing) return existing;

    const link = repo.create({
      tenant_id: item.tenant_id,
      spend_item_id: itemId,
      contact_id: params.contactId,
      role: params.role,
      origin: ContactOrigin.MANUAL,
    });
    const saved = await repo.save(link);
    await this.audit.log(
      {
        table: 'spend_item_contacts',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
  }

  /** Remove one contact link of the item; a link of another item is not found. */
  async detach(itemId: string, linkId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getLinkRepo(opts?.manager);
    const existing = await repo.findOne({ where: { id: linkId, spend_item_id: itemId } });
    if (!existing) throw new NotFoundException('Link not found');
    await repo.delete({ id: linkId, spend_item_id: itemId });
    await this.audit.log(
      {
        table: 'spend_item_contacts',
        recordId: linkId,
        action: 'delete',
        before: existing,
        after: null,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return { ok: true };
  }

  /**
   * Sync contacts from supplier. Called when supplier_id changes on the item.
   * 1. Remove all contacts with origin='supplier'
   * 2. If newSupplierId is not null, fetch supplier's contacts and add them with origin='supplier'
   */
  async syncFromSupplier(itemId: string, newSupplierId: string | null, userId?: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getLinkRepo(opts?.manager);
    const supplierContactRepo = this.getSupplierContactRepo(opts?.manager);
    const itemRepo = this.getItemRepo(opts?.manager);

    const item = await itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Spend item not found');
    const before = await repo.find({ where: { spend_item_id: itemId, origin: ContactOrigin.SUPPLIER } });

    // 1. Remove all supplier-derived contacts
    await repo.delete({ spend_item_id: itemId, origin: ContactOrigin.SUPPLIER });

    // 2. If new supplier exists, fetch and add their contacts
    if (newSupplierId) {
      const supplierContacts = await supplierContactRepo.find({
        where: { supplier_id: newSupplierId },
      });

      for (const sc of supplierContacts) {
        // Check if this contact+role already exists (could be manually added)
        const existing = await repo.findOne({
          where: { spend_item_id: itemId, contact_id: sc.contact_id, role: sc.role },
        });
        if (existing) continue;

        const link = repo.create({
          tenant_id: item.tenant_id,
          spend_item_id: itemId,
          contact_id: sc.contact_id,
          role: sc.role,
          origin: ContactOrigin.SUPPLIER,
        });
        await repo.save(link);
      }
    }

    const after = await repo.find({ where: { spend_item_id: itemId, origin: ContactOrigin.SUPPLIER } });
    const beforeState = before.map((r) => `${r.contact_id}:${r.role}`).sort();
    const afterState = after.map((r) => `${r.contact_id}:${r.role}`).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'spend_item_contacts',
          recordId: itemId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: opts?.manager ?? repo.manager },
      );
    }
  }

  /**
   * Called when supplier_id on item changes. Fetches item's supplier and syncs.
   */
  async syncFromSupplierForItem(itemId: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const itemRepo = this.getItemRepo(opts?.manager);
    const item = await itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Spend item not found');
    await this.syncFromSupplier(itemId, item.supplier_id, userId, opts);
  }

  /**
   * Add a single supplier contact to an item. Called when a contact is added to a supplier.
   */
  async addSupplierContact(
    itemId: string,
    contactId: string,
    role: SupplierContactRole,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const repo = this.getLinkRepo(opts?.manager);
    const itemRepo = this.getItemRepo(opts?.manager);

    const item = await itemRepo.findOne({ where: { id: itemId } });
    if (!item) return;

    // Check if already exists
    const existing = await repo.findOne({
      where: { spend_item_id: itemId, contact_id: contactId, role: role },
    });
    if (existing) return;

    const link = repo.create({
      tenant_id: item.tenant_id,
      spend_item_id: itemId,
      contact_id: contactId,
      role: role,
      origin: ContactOrigin.SUPPLIER,
    });
    const saved = await repo.save(link);
    await this.audit.log(
      {
        table: 'spend_item_contacts',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
  }

  /**
   * Remove a supplier-derived contact from an item. Called when a contact is removed from a supplier.
   */
  async removeSupplierContact(
    itemId: string,
    contactId: string,
    role: SupplierContactRole,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const repo = this.getLinkRepo(opts?.manager);
    const existing = await repo.findOne({
      where: {
        spend_item_id: itemId,
        contact_id: contactId,
        role: role,
        origin: ContactOrigin.SUPPLIER,
      },
    });
    await repo.delete({
      spend_item_id: itemId,
      contact_id: contactId,
      role: role,
      origin: ContactOrigin.SUPPLIER,
    });
    if (existing) {
      await this.audit.log(
        {
          table: 'spend_item_contacts',
          recordId: existing.id,
          action: 'delete',
          before: existing,
          after: null,
          userId: userId ?? null,
        },
        { manager: opts?.manager ?? repo.manager },
      );
    }
  }
}
