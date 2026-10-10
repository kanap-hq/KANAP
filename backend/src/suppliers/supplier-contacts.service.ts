import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SupplierContactLink, SupplierContactRole } from '../contacts/supplier-contact.entity';
import { ExternalContact } from '../contacts/external-contact.entity';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { Supplier } from './supplier.entity';
import { natureAnd, type BudgetNature } from '../spend/budget-nature';

/** The request's tenant and user; every statement filters on the tenant, every change is audited for the user. */
export type SupplierContactsContext = {
  manager?: EntityManager;
  tenantId: string;
  userId?: string | null;
  audit?: AuditSourceOptions;
};

// The item link tables a supplier contact propagates to, with the item table and its key.
// Table names come only from here, never from a caller. `nature`: the lines of `spend_items`
// this entry covers (`spend/budget-nature.ts`); the CAPEX lines have their own entry.
const ITEM_LINKS: ReadonlyArray<{ links: string; items: string; itemColumn: string; nature?: BudgetNature }> = [
  { links: 'spend_item_contacts', items: 'spend_items', itemColumn: 'spend_item_id', nature: 'opex' },
  { links: 'capex_item_contacts', items: 'capex_items', itemColumn: 'capex_item_id' },
  { links: 'contract_contacts', items: 'contracts', itemColumn: 'contract_id' },
];

/** Rows of an INSERT … RETURNING (rows) or a DELETE … RETURNING (TypeORM answers [rows, count]). */
function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as T[];
}

@Injectable()
export class SupplierContactsService {
  constructor(
    @InjectRepository(SupplierContactLink)
    private readonly linkRepo: Repository<SupplierContactLink>,
    private readonly audit: AuditService,
  ) {}

  private manager(ctx: SupplierContactsContext): EntityManager {
    return ctx.manager ?? this.linkRepo.manager;
  }

  private async log(
    ctx: SupplierContactsContext,
    table: string,
    action: 'create' | 'update' | 'delete',
    recordId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.audit.log(
      {
        table,
        recordId,
        action,
        before: before ?? null,
        after: after ?? null,
        userId: ctx.userId ?? null,
        source: ctx.audit?.source,
        sourceRef: ctx.audit?.sourceRef ?? null,
      },
      { manager: this.manager(ctx) },
    );
  }

  async listForSupplier(supplierId: string, ctx: SupplierContactsContext) {
    return this.manager(ctx).getRepository(SupplierContactLink).find({
      where: { tenant_id: ctx.tenantId, supplier_id: supplierId },
      order: { created_at: 'DESC' as any } as any,
      relations: ['contact'],
    });
  }

  async attach(supplierId: string, params: { contactId: string; role: SupplierContactRole; isPrimary?: boolean }, ctx: SupplierContactsContext) {
    const mg = this.manager(ctx);
    const repo = mg.getRepository(SupplierContactLink);
    const contactRepo = mg.getRepository(ExternalContact);
    const supplier = await mg.getRepository(Supplier).findOne({ where: { tenant_id: ctx.tenantId, id: supplierId } as any });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    const contact = await contactRepo.findOne({ where: { tenant_id: ctx.tenantId, id: params.contactId } });
    if (!contact) throw new NotFoundException('Contact not found.');

    // One link per (supplier, contact, role).
    const existing = await repo.findOne({
      where: { tenant_id: ctx.tenantId, supplier_id: supplierId, contact_id: params.contactId, role: params.role },
    });
    if (existing) return existing;
    const saved = await repo.save(repo.create({
      tenant_id: ctx.tenantId,
      supplier_id: supplierId,
      contact_id: params.contactId,
      role: params.role,
      is_primary: !!params.isPrimary,
    }));
    await this.log(ctx, 'supplier_contacts', 'create', saved.id, null, saved);

    // A contact without a supplier takes this one.
    if (!contact.supplier_id) {
      await contactRepo.update({ tenant_id: ctx.tenantId, id: contact.id }, { supplier_id: supplierId });
      await this.log(ctx, 'contacts', 'update', contact.id, contact, { ...contact, supplier_id: supplierId });
    }

    await this.propagateContactToItems(supplierId, params.contactId, params.role, ctx);
    return saved;
  }

  /** Remove one contact link of the supplier; a link of another supplier is not found. */
  async detach(supplierId: string, linkId: string, ctx: SupplierContactsContext) {
    const mg = this.manager(ctx);
    const repo = mg.getRepository(SupplierContactLink);
    const existing = await repo.findOne({ where: { tenant_id: ctx.tenantId, supplier_id: supplierId, id: linkId } });
    if (!existing) throw new NotFoundException('Link not found.');

    const { supplier_id, contact_id, role } = existing;
    await repo.delete({ tenant_id: ctx.tenantId, id: linkId });
    await this.log(ctx, 'supplier_contacts', 'delete', linkId, existing, null);

    await this.removeContactFromItems(supplier_id, contact_id, role, ctx);

    // A contact whose supplier was this one takes the supplier of its next link, if any.
    const contactRepo = mg.getRepository(ExternalContact);
    const contact = await contactRepo.findOne({ where: { tenant_id: ctx.tenantId, id: contact_id } });
    if (contact && contact.supplier_id === supplier_id) {
      const nextLink = await repo.findOne({ where: { tenant_id: ctx.tenantId, contact_id } });
      const nextSupplierId = nextLink?.supplier_id ?? null;
      // Another link to the same supplier keeps it: no change, no audit row.
      if (nextSupplierId !== supplier_id) {
        await contactRepo.update({ tenant_id: ctx.tenantId, id: contact_id }, { supplier_id: nextSupplierId });
        await this.log(ctx, 'contacts', 'update', contact_id, contact, { ...contact, supplier_id: nextSupplierId });
      }
    }

    return { ok: true };
  }

  /**
   * Add a supplier contact to every OPEX line, CAPEX line and contract of the
   * supplier in the tenant, with origin 'supplier'. An existing link of the same
   * contact and role is kept. One audit row per link added.
   */
  async propagateContactToItems(supplierId: string, contactId: string, role: SupplierContactRole, ctx: SupplierContactsContext) {
    const mg = this.manager(ctx);
    for (const t of ITEM_LINKS) {
      const added = returnedRows<{ id: string }>(await mg.query(
        `INSERT INTO ${t.links} (tenant_id, ${t.itemColumn}, contact_id, role, origin)
         SELECT $1::uuid, i.id, $3::uuid, $4::supplier_contact_role, 'supplier'
           FROM ${t.items} i
          WHERE i.tenant_id = $1 AND i.supplier_id = $2${natureAnd('i', t.nature)}
         ON CONFLICT (tenant_id, ${t.itemColumn}, contact_id, role) DO NOTHING
         RETURNING *`,
        [ctx.tenantId, supplierId, contactId, role],
      ));
      for (const row of added) await this.log(ctx, t.links, 'create', row.id, null, row);
    }
  }

  /**
   * Remove a supplier-derived contact (origin 'supplier', same role) from every
   * OPEX line, CAPEX line and contract of the supplier in the tenant. Manual
   * links stay. One audit row per link removed.
   */
  async removeContactFromItems(supplierId: string, contactId: string, role: SupplierContactRole, ctx: SupplierContactsContext) {
    const mg = this.manager(ctx);
    for (const t of ITEM_LINKS) {
      const removed = returnedRows<{ id: string }>(await mg.query(
        `DELETE FROM ${t.links} l
          WHERE l.tenant_id = $1 AND l.contact_id = $2 AND l.role = $3::supplier_contact_role AND l.origin = 'supplier'
            AND l.${t.itemColumn} IN (SELECT i.id FROM ${t.items} i WHERE i.tenant_id = $1 AND i.supplier_id = $4${natureAnd('i', t.nature)})
         RETURNING l.*`,
        [ctx.tenantId, contactId, role, supplierId],
      ));
      for (const row of removed) await this.log(ctx, t.links, 'delete', row.id, row, null);
    }
  }
}
