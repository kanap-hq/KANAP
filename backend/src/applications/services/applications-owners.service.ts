import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Application } from '../application.entity';
import { ApplicationOwner } from '../application-owner.entity';
import { ApplicationCompany } from '../application-company.entity';
import { ApplicationDepartment } from '../application-department.entity';
import { ApplicationSupportContact } from '../application-support-contact.entity';
import { ExternalContact } from '../../contacts/external-contact.entity';
import { AuditService } from '../../audit/audit.service';
import { ApplicationsBaseService, ServiceOpts } from './applications-base.service';
import { lockApplicationRow } from '../application-rules';

/**
 * Service for managing application owners, companies, departments, and support contacts.
 */
@Injectable()
export class ApplicationsOwnersService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
    private readonly audit: AuditService,
  ) {
    super(appRepo);
  }

  // Owners
  async listOwners(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const app = await this.ensureApp(appId, mg, opts?.accessScope);
    return this.listOwnersInternal(app.id, app.tenant_id, mg);
  }

  async bulkReplaceOwners(appId: string, owners: Array<{ user_id: string; owner_type: 'business' | 'it' }>, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedAppId } });
    if (!app) throw new NotFoundException('Application not found');
    // The application, then its owners (`lockApplicationRow`): read and replaced under its lock.
    if (!(await lockApplicationRow(mg, app.tenant_id, resolvedAppId))) throw new NotFoundException('Application not found');
    const repo = mg.getRepository(ApplicationOwner);
    const existing = await repo.find({ where: { application_id: resolvedAppId } as any });
    const beforeState = existing.map((o) => `${o.owner_type}:${o.user_id}`).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    let afterRows: ApplicationOwner[] = [];
    if (owners && owners.length) {
      const uniqueOwners: Array<{ user_id: string; owner_type: 'business' | 'it' }> = [];
      const seen = new Set<string>();
      for (const owner of owners) {
        const userId = String(owner?.user_id || '').trim();
        const ownerType = owner?.owner_type;
        if (!userId || (ownerType !== 'business' && ownerType !== 'it')) continue;
        const key = `${ownerType}:${userId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueOwners.push({ user_id: userId, owner_type: ownerType });
      }
      if (uniqueOwners.length) {
        const userIds = Array.from(new Set(uniqueOwners.map((o) => o.user_id)));
        const found = await mg.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [app.tenant_id, userIds],
        );
        if (found.length !== userIds.length) throw new BadRequestException('One or more owners not found');
      }
      const rows = uniqueOwners.map((o) => repo.create({ tenant_id: app.tenant_id, application_id: resolvedAppId, user_id: o.user_id, owner_type: o.owner_type }));
      afterRows = await repo.save(rows);
    }
    const afterState = afterRows.map((o) => `${o.owner_type}:${o.user_id}`).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'application_owners',
          recordId: resolvedAppId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return this.listOwnersInternal(resolvedAppId, app.tenant_id, mg);
  }

  private async listOwnersInternal(appId: string, tenantId: string, mg: EntityManager) {
    const rows = await mg.query(
      `SELECT o.id,
              o.tenant_id,
              o.application_id,
              o.user_id,
              o.owner_type,
              o.created_at,
              u.email,
              u.first_name,
              u.last_name,
              NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS full_name
       FROM application_owners o
       LEFT JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
       WHERE o.application_id = $1 AND o.tenant_id = $2
       ORDER BY o.owner_type ASC, full_name ASC NULLS LAST, u.email ASC NULLS LAST, o.created_at ASC`,
      [appId, tenantId],
    );
    return (rows as Array<ApplicationOwner & { email?: string | null; first_name?: string | null; last_name?: string | null; full_name?: string | null }>).map((row) => ({
      ...row,
      full_name: row.full_name || row.email || row.user_id,
    }));
  }

  // Companies (Audience)
  async listCompanies(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const app = await this.ensureApp(appId, mg, opts?.accessScope);
    return mg.getRepository(ApplicationCompany).find({ where: { application_id: app.id, tenant_id: app.tenant_id } as any });
  }

  async bulkReplaceCompanies(appId: string, companyIds: string[], userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedAppId } });
    if (!app) throw new NotFoundException('Application not found');
    const repo = mg.getRepository(ApplicationCompany);
    const existing = await repo.find({ where: { application_id: resolvedAppId, tenant_id: app.tenant_id } as any });
    const beforeState = existing.map((c) => c.company_id).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    let afterRows: ApplicationCompany[] = [];
    if (companyIds && companyIds.length) {
      const uniqueCompanyIds = Array.from(new Set(companyIds.map((id) => String(id || '').trim()).filter(Boolean)));
      if (uniqueCompanyIds.length) {
        const found = await mg.query(
          `SELECT id FROM companies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [app.tenant_id, uniqueCompanyIds],
        );
        if (found.length !== uniqueCompanyIds.length) throw new BadRequestException('One or more companies not found');
      }
      const rows = uniqueCompanyIds.map((cid) => repo.create({ tenant_id: app.tenant_id, application_id: resolvedAppId, company_id: cid }));
      afterRows = await repo.save(rows);
    }
    const afterState = afterRows.map((c) => c.company_id).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'application_companies',
          recordId: resolvedAppId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return this.listCompanies(resolvedAppId, { manager: mg });
  }

  // Departments (Audience)
  async listDepartments(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const app = await this.ensureApp(appId, mg, opts?.accessScope);
    return mg.getRepository(ApplicationDepartment).find({ where: { application_id: app.id, tenant_id: app.tenant_id } as any });
  }

  async bulkReplaceDepartments(appId: string, departmentIds: string[], userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedAppId } });
    if (!app) throw new NotFoundException('Application not found');
    const repo = mg.getRepository(ApplicationDepartment);
    const existing = await repo.find({ where: { application_id: resolvedAppId, tenant_id: app.tenant_id } as any });
    const beforeState = existing.map((d) => d.department_id).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    let afterRows: ApplicationDepartment[] = [];
    if (departmentIds && departmentIds.length) {
      const uniqueDepartmentIds = Array.from(new Set(departmentIds.map((id) => String(id || '').trim()).filter(Boolean)));
      if (uniqueDepartmentIds.length) {
        const found = await mg.query(
          `SELECT id FROM departments WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [app.tenant_id, uniqueDepartmentIds],
        );
        if (found.length !== uniqueDepartmentIds.length) throw new BadRequestException('One or more departments not found');
      }
      const rows = uniqueDepartmentIds.map((did) => repo.create({ tenant_id: app.tenant_id, application_id: resolvedAppId, department_id: did }));
      afterRows = await repo.save(rows);
    }
    const afterState = afterRows.map((d) => d.department_id).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'application_departments',
          recordId: resolvedAppId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return this.listDepartments(resolvedAppId, { manager: mg });
  }

  // Support contacts
  async listSupportContacts(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const app = await this.ensureApp(appId, mg, opts?.accessScope);
    const rows = await mg.query(
      `SELECT sc.id, sc.contact_id, sc.role, c.first_name, c.last_name, c.email, c.phone, c.mobile
       FROM application_support_contacts sc
       JOIN contacts c ON c.id = sc.contact_id
       WHERE sc.application_id = $1
       ORDER BY sc.created_at ASC, sc.id ASC`,
      [app.id],
    );
    return rows.map((r: any) => ({
      id: r.id,
      contact_id: r.contact_id,
      role: r.role,
      contact: {
        id: r.contact_id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        phone: r.phone,
        mobile: r.mobile,
      },
    }));
  }

  async bulkReplaceSupportContacts(appId: string, contacts: Array<{ contact_id: string; role?: string | null }>, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedAppId } });
    if (!app) throw new NotFoundException('Application not found');

    const repo = mg.getRepository(ApplicationSupportContact);
    const filtered = (contacts || [])
      .map((c) => ({ contact_id: String(c.contact_id || '').trim(), role: (c.role ?? '').toString().trim() || null }))
      .filter((c) => !!c.contact_id);

    if (filtered.length) {
      const uniqueIds = Array.from(new Set(filtered.map((c) => c.contact_id)));
      const found = await mg.getRepository(ExternalContact).find({ where: { id: In(uniqueIds) } as any });
      if (found.length !== uniqueIds.length) throw new BadRequestException('One or more contacts not found');
      const invalid = found.find((c) => (c as any).tenant_id !== app.tenant_id);
      if (invalid) throw new BadRequestException('Contact does not belong to tenant');
    }

    const existing = await repo.find({ where: { application_id: resolvedAppId } as any });
    const beforeState = existing.map((c) => `${c.contact_id}:${c.role ?? ''}`).sort();
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    let afterRows: ApplicationSupportContact[] = [];
    if (filtered.length) {
      const rows = filtered.map((c) => repo.create({ tenant_id: app.tenant_id, application_id: resolvedAppId, contact_id: c.contact_id, role: c.role ?? null }));
      afterRows = await repo.save(rows);
    }
    const afterState = afterRows.map((c) => `${c.contact_id}:${c.role ?? ''}`).sort();
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await this.audit.log(
        {
          table: 'application_support_contacts',
          recordId: resolvedAppId,
          action: 'update',
          before: beforeState,
          after: afterState,
          userId: userId ?? null,
        },
        { manager: mg },
      );
    }
    return this.listSupportContacts(resolvedAppId, { manager: mg });
  }
}
