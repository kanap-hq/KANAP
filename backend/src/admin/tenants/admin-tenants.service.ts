import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Tenant, TenantBranding, TenantStatus } from '../../tenants/tenant.entity';
import { parsePagination } from '../../common/pagination';
import { TenantStatsService } from './tenant-stats.service';
import { BillingService } from '../../billing/billing.service';
import { withTenant } from '../../common/tenant-runner';
import { UpdateTenantPlanDto } from './dto/update-tenant-plan.dto';
import { FreezeTenantDto } from './dto/freeze-tenant.dto';
import { DeleteTenantDto } from './dto/delete-tenant.dto';
import { AuditService } from '../../audit/audit.service';
import { PaymentMode, Subscription, SubscriptionStatus } from '../../billing/subscription.entity';
import { INTERNAL_PLAN_NAME } from '../../billing/plans.config';
import { TrialSignup } from '../../public/trial-signup.entity';
import { StorageService } from '../../common/storage/storage.service';
import {
  assertTenantPurgeConfiguration,
  TENANT_PURGE_ATTACHMENT_TABLES,
  TENANT_PURGE_TABLES,
} from './tenant-purge.inventory';

@Injectable()
export class AdminTenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(TrialSignup)
    private readonly trialSignups: Repository<TrialSignup>,
    private readonly dataSource: DataSource,
    private readonly stats: TenantStatsService,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async listTenants(query: any) {
    const { page, limit, skip, sort, status, q } = parsePagination(query);
    const qb = this.tenants
      .createQueryBuilder('tenant')
      .where('tenant.deleted_at IS NULL')
      .andWhere('tenant.is_system_tenant IS NOT TRUE');
    if (status) {
      qb.andWhere('tenant.status = :status', { status });
    }
    if (q) {
      qb.andWhere('(tenant.slug ILIKE :term OR tenant.name ILIKE :term)', { term: `%${q}%` });
    }
    const sortable = new Set(['created_at', 'updated_at', 'slug', 'name', 'status']);
    const orderField = sortable.has(sort.field) ? sort.field : 'created_at';
    const total = await qb.getCount();
    const rows = await qb
      .orderBy(`tenant.${orderField}`, sort.direction as 'ASC' | 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    const items = await Promise.all(rows.map(async (tenant) => this.buildTenantSummary(tenant)));
    return { items, total, page, limit };
  }

  async getTenantDetail(id: string) {
    const tenant = await this.findTenantOrFail(id);
    const summary = await this.buildTenantSummary(tenant, { includeInternal: true });
    return summary;
  }

  async updatePlan(tenantId: string, actorId: string | null, dto: UpdateTenantPlanDto) {
    const tenant = await this.findTenantOrFail(tenantId);
    this.ensureNotSystemTenant(tenant);
    await withTenant(this.dataSource, tenantId, async (manager) => {
      await this.applyPlanUpdate(manager, tenantId, actorId, dto);
    });
    return this.getTenantDetail(tenantId);
  }

  /**
   * Turns a tenant into an internal tenant (demonstration, test): active, no trial end,
   * unlimited seats, no money flow. Reactivates a tenant whose trial has expired.
   *
   * Refused when the subscription row carries a Stripe subscription id, whatever its
   * status. A live one belongs to a paying customer, who must never be masked. An ended
   * one (canceled, incomplete_expired) would not hold either: the billing page refreshes
   * any linked subscription from Stripe and would write the Stripe status back over it.
   * Stripe ids are never touched here.
   */
  async markInternal(tenantId: string, actorId: string | null) {
    const tenant = await this.findTenantOrFail(tenantId);
    this.ensureNotSystemTenant(tenant);
    if (tenant.status === TenantStatus.DELETED || tenant.status === TenantStatus.DELETING) {
      throw new BadRequestException('Tenant already deleted');
    }
    await withTenant(this.dataSource, tenantId, async (manager) => {
      await this.applyInternalPlan(manager, actorId, new Date());
    });
    return this.getTenantDetail(tenantId);
  }

  async freezeTenant(tenantId: string, actorId: string | null, body: FreezeTenantDto) {
    const tenant = await this.findTenantOrFail(tenantId);
    this.ensureNotSystemTenant(tenant);
    if (tenant.status === TenantStatus.DELETED) {
      throw new BadRequestException('Tenant already deleted');
    }
    if (tenant.status === TenantStatus.FROZEN) {
      return this.getTenantDetail(tenantId);
    }
    const before = this.serializeTenant(tenant);
    tenant.status = TenantStatus.FROZEN;
    tenant.frozen_at = new Date();
    tenant.frozen_by = actorId ?? null;
    if (body?.reason) {
      tenant.notes = body.reason;
    }
    await this.tenants.save(tenant);
    await this.logTenantAction(tenantId, actorId, 'freeze', before, this.serializeTenant(tenant));
    return this.getTenantDetail(tenantId);
  }

  async unfreezeTenant(tenantId: string, actorId: string | null) {
    const tenant = await this.findTenantOrFail(tenantId);
    this.ensureNotSystemTenant(tenant);
    if (tenant.status !== TenantStatus.FROZEN) {
      return this.getTenantDetail(tenantId);
    }
    const before = this.serializeTenant(tenant);
    tenant.status = TenantStatus.ACTIVE;
    tenant.frozen_at = null;
    tenant.frozen_by = null;
    await this.tenants.save(tenant);
    await this.logTenantAction(tenantId, actorId, 'unfreeze', before, this.serializeTenant(tenant));
    return this.getTenantDetail(tenantId);
  }

  private async buildTenantSummary(tenant: Tenant, opts?: { includeInternal?: boolean }) {
    const stats = await this.stats.compute(tenant.id);
    let plan: any = null;
    if (tenant.status !== TenantStatus.DELETED) {
      plan = await withTenant(this.dataSource, tenant.id, (manager) => this.billing.getSubscriptionSummary({ manager }));
    }

    const base: any = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      is_system_tenant: tenant.is_system_tenant === true,
      frozen_at: tenant.frozen_at,
      frozen_by: tenant.frozen_by,
      deletion_requested_at: tenant.deletion_requested_at,
      deletion_requested_by: tenant.deletion_requested_by,
      deletion_confirmed_at: tenant.deletion_confirmed_at,
      deleted_at: tenant.deleted_at,
      created_at: tenant.created_at,
      updated_at: tenant.updated_at,
      stats,
      plan,
    };

    if (opts?.includeInternal) {
      base.deletion_reason = tenant.deletion_reason;
      base.notes = tenant.notes;
      base.metadata = tenant.metadata ?? {};
    }
    return base;
  }

  private async findTenantOrFail(id: string): Promise<Tenant> {
    const tenant = await this.tenants.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private ensureNotSystemTenant(tenant: Tenant) {
    if (tenant.is_system_tenant) {
      throw new BadRequestException('System tenants cannot be modified');
    }
  }

  private async applyPlanUpdate(
    manager: EntityManager,
    tenantId: string,
    actorId: string | null,
    dto: UpdateTenantPlanDto,
  ) {
    const subsRepo = manager.getRepository(Subscription);
    let sub = await subsRepo.findOne({ where: {} });
    if (!sub) {
      sub = subsRepo.create({ plan_name: 'Trial', seat_limit: null });
      sub = await subsRepo.save(sub);
    }
    const before = this.serializeSubscription(sub);
    if (dto.plan_name !== undefined) {
      sub.plan_name = dto.plan_name ?? null;
    }
    if (dto.seat_limit !== undefined) {
      if (dto.seat_limit !== null && dto.seat_limit < 0) throw new BadRequestException('seat_limit must be >= 0');
      sub.seat_limit = dto.seat_limit; // null = unlimited
    }
    if (dto.active_seats !== undefined) {
      if (dto.active_seats < 0) throw new BadRequestException('active_seats must be >= 0');
      sub.active_seats = dto.active_seats;
    }
    if (dto.subscription_type !== undefined) {
      sub.subscription_type = dto.subscription_type;
    }
    if (dto.payment_mode !== undefined) {
      sub.payment_mode = dto.payment_mode;
    }
    if (dto.next_payment_at !== undefined) {
      sub.next_payment_at = dto.next_payment_at ? new Date(dto.next_payment_at) : null;
    }
    if (dto.status != null) {
      sub.status = dto.status;
    }
    if (dto.trial_end !== undefined) {
      sub.trial_end = dto.trial_end ? new Date(dto.trial_end) : null;
    }
    if (dto.notes !== undefined) {
      sub.notes = dto.notes ?? null;
    }
    sub.last_synced_at = new Date();
    sub = await subsRepo.save(sub);
    const after = this.serializeSubscription(sub);

    await this.audit.log(
      {
        table: 'tenants_plan',
        recordId: sub.id,
        action: 'update',
        before,
        after,
        userId: actorId ?? null,
      },
      { manager },
    );
  }

  private async applyInternalPlan(manager: EntityManager, actorId: string | null, now: Date) {
    const subsRepo = manager.getRepository(Subscription);
    // Same row as the access gates (latest first), locked against a concurrent webhook write.
    let sub = await subsRepo.findOne({
      where: {},
      order: { created_at: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!sub) {
      sub = subsRepo.create({ plan_name: 'Trial', seat_limit: null });
      sub = await subsRepo.save(sub);
    }
    if (sub.stripe_subscription_id) {
      throw new ConflictException(
        'This tenant has a Stripe subscription. Internal tenants are for demonstration and test tenants without one.',
      );
    }

    const alreadyInternal =
      sub.plan_name === INTERNAL_PLAN_NAME &&
      sub.status === SubscriptionStatus.ACTIVE &&
      sub.trial_end == null &&
      sub.seat_limit == null &&
      sub.payment_mode === PaymentMode.BANK_TRANSFER &&
      sub.next_payment_at == null;
    if (alreadyInternal) return;

    const before = this.serializeSubscription(sub);
    sub.status = SubscriptionStatus.ACTIVE;
    sub.trial_end = null;
    sub.plan_name = INTERNAL_PLAN_NAME;
    sub.seat_limit = null;
    sub.payment_mode = PaymentMode.BANK_TRANSFER;
    sub.next_payment_at = null;
    const noteLine = `Tenant interne (démonstration, test), marqué le ${now.toISOString().slice(0, 10)}`;
    const existingNotes = sub.notes?.trim() ? sub.notes : null;
    if (!existingNotes) {
      sub.notes = noteLine;
    } else if (!existingNotes.includes(noteLine)) {
      sub.notes = `${existingNotes}\n${noteLine}`;
    }
    sub.last_synced_at = now;
    sub = await subsRepo.save(sub);

    await this.audit.log(
      {
        table: 'tenants_plan',
        recordId: sub.id,
        action: 'update',
        before,
        after: this.serializeSubscription(sub),
        userId: actorId ?? null,
        sourceRef: 'mark-internal',
      },
      { manager },
    );
  }

  async deleteTenant(tenantId: string, actorId: string | null, dto: DeleteTenantDto) {
    const tenant = await this.findTenantOrFail(tenantId);
    this.ensureNotSystemTenant(tenant);
    if (tenant.status === TenantStatus.DELETED) {
      throw new BadRequestException('Tenant already deleted');
    }
    // Keep the original slug to clean up trial signups later
    const originalSlug = tenant.slug;
    const confirm = dto.confirmSlug?.trim();
    if (!confirm || confirm !== tenant.slug) {
      throw new BadRequestException('Confirmation slug does not match tenant');
    }

    const reason = dto.reason?.trim() || null;
    const beforeRequest = this.serializeTenant(tenant);
    tenant.status = TenantStatus.DELETING;
    tenant.deletion_requested_at = new Date();
    tenant.deletion_requested_by = actorId ?? null;
    tenant.deletion_reason = reason;
    await this.tenants.save(tenant);
    await this.logTenantAction(tenantId, actorId, 'delete-request', beforeRequest, this.serializeTenant(tenant));

    let purgeReport: Array<{ table: string; deleted: number }> = [];
    try {
      purgeReport = await this.purgeTenantData(tenantId, tenant.branding);
    } catch (error) {
      const beforeFail = this.serializeTenant(tenant);
      tenant.status = TenantStatus.FROZEN;
      await this.tenants.save(tenant);
      await this.logTenantAction(tenantId, actorId, 'delete-failed', beforeFail, this.serializeTenant(tenant));
      throw error;
    }

    const beforeComplete = this.serializeTenant(tenant);
    const completedAt = new Date();
    tenant.status = TenantStatus.DELETED;
    tenant.deletion_confirmed_at = completedAt;
    tenant.deleted_at = completedAt;
    tenant.frozen_at = null;
    tenant.frozen_by = null;
    tenant.notes = null;
    // Clear slug to free reuse and avoid ambiguity for deleted tenants
    tenant.slug = `deleted-${tenant.slug}-${completedAt.getTime()}`;
    await this.tenants.save(tenant);
    await this.logTenantAction(tenantId, actorId, 'delete-complete', beforeComplete, this.serializeTenant(tenant));

    // Clean up any trial signup for the original slug to allow clean re-signup
    try {
      await this.trialSignups.delete({ slug: originalSlug });
    } catch (e) {
      // Non-fatal; log and continue
      console.warn('[tenants] Failed to delete trial_signup for slug', originalSlug, (e as Error)?.message);
    }

    const detail = await this.getTenantDetail(tenantId);
    return { tenant: detail, purgeReport };
  }

  private async logTenantAction(
    tenantId: string,
    actorId: string | null,
    action: 'freeze' | 'unfreeze' | 'plan-update' | 'delete-request' | 'delete-complete' | 'delete-failed',
    before: any,
    after: any,
  ) {
    await withTenant(this.dataSource, tenantId, async (manager) => {
      await this.audit.log(
        {
          table: 'tenants_admin',
          recordId: tenantId,
          action: 'update',
          before,
          after,
          userId: actorId ?? null,
        },
        { manager },
      );
    });
  }

  private async purgeTenantData(tenantId: string, branding?: TenantBranding | Record<string, any> | null) {
    assertTenantPurgeConfiguration();
    const tablesInOrder = TENANT_PURGE_TABLES;

    return withTenant(this.dataSource, tenantId, async (manager) => {
      const report: Array<{ table: string; deleted: number }> = [];
      const tenantTables = new Set<string>(
        (await manager.query(
          `SELECT table_name
           FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
        )).map((row: { table_name: string }) => row.table_name),
      );
      const missingTenantId = tablesInOrder.filter((table) => !tenantTables.has(table));
      if (missingTenantId.length > 0) {
        throw new BadRequestException(
          `Tenant purge misconfigured: missing tenant_id on tables: ${missingTenantId.join(', ')}`,
        );
      }

      const deleteTable = async (table: string) => {
        const res = await manager.query(
          `WITH deleted AS (
            DELETE FROM ${table}
            WHERE tenant_id = app_current_tenant()
            RETURNING 1
          )
          SELECT COUNT(*)::int AS count FROM deleted`,
        );
        const count = Number(res?.[0]?.count ?? 0);
        report.push({ table, deleted: count });
      };

      // Branding logo lives on tenants.branding (no tenant_id column), so clean it explicitly.
      const brandingLogoPath = typeof (branding as any)?.logo_storage_path === 'string'
        ? (branding as any).logo_storage_path as string
        : null;
      if (brandingLogoPath) {
        try {
          await this.storage.deleteObject(brandingLogoPath);
          report.push({ table: 'tenant_branding_logo', deleted: 1 });
        } catch {
          // Keep purge resilient if object is already missing.
          report.push({ table: 'tenant_branding_logo', deleted: 0 });
        }
      } else {
        report.push({ table: 'tenant_branding_logo', deleted: 0 });
      }

      // For attachment tables, delete remote S3 objects first
      const attachmentTables = new Set<string>(TENANT_PURGE_ATTACHMENT_TABLES);

      for (const table of tablesInOrder) {
        if (attachmentTables.has(table)) {
          try {
            const rows: Array<{ storage_path: string }> = await manager.query(
              `SELECT storage_path FROM ${table} WHERE tenant_id = app_current_tenant()`
            );
            for (const row of rows) {
              if (row?.storage_path) {
                try { await this.storage.deleteObject(row.storage_path); } catch {}
              }
            }
          } catch (e) {
            // Non-fatal; proceed with DB purge
            console.warn(`[purge] Failed to list objects for ${table}:`, (e as Error)?.message);
          }
        }
        await deleteTable(table);
      }

      return report;
    });
  }

  private serializeTenant(tenant: Tenant) {
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      frozen_at: tenant.frozen_at?.toISOString() ?? null,
      frozen_by: tenant.frozen_by ?? null,
      deletion_requested_at: tenant.deletion_requested_at?.toISOString() ?? null,
      deletion_requested_by: tenant.deletion_requested_by ?? null,
      deletion_confirmed_at: tenant.deletion_confirmed_at?.toISOString() ?? null,
      deleted_at: tenant.deleted_at?.toISOString() ?? null,
      deletion_reason: tenant.deletion_reason ?? null,
      notes: tenant.notes ?? null,
      stripe_customer_id: tenant.stripe_customer_id ?? null,
      billing_email: tenant.billing_email ?? null,
      billing_company_name: tenant.billing_company_name ?? null,
      billing_phone: tenant.billing_phone ?? null,
      billing_tax_id: tenant.billing_tax_id ?? null,
      billing_address: tenant.billing_address ?? null,
      billing_customer_info: tenant.billing_customer_info ?? null,
      billing_invoice_info: tenant.billing_invoice_info ?? null,
      metadata: tenant.metadata ?? {},
    };
  }

  private serializeSubscription(sub: Subscription) {
    return {
      id: sub.id,
      plan_name: sub.plan_name ?? null,
      seat_limit: sub.seat_limit,
      active_seats: sub.active_seats,
      subscription_type: sub.subscription_type,
      payment_mode: sub.payment_mode,
      next_payment_at: sub.next_payment_at ? sub.next_payment_at.toISOString() : null,
      last_synced_at: sub.last_synced_at ? sub.last_synced_at.toISOString() : null,
      status: sub.status ?? null,
      collection_method: sub.collection_method ?? null,
      current_period_start: sub.current_period_start ? sub.current_period_start.toISOString() : null,
      current_period_end: sub.current_period_end ? sub.current_period_end.toISOString() : null,
      trial_end: sub.trial_end ? sub.trial_end.toISOString() : null,
      cancel_at: sub.cancel_at ? sub.cancel_at.toISOString() : null,
      canceled_at: sub.canceled_at ? sub.canceled_at.toISOString() : null,
      currency: sub.currency ?? null,
      amount: sub.amount ?? null,
      amount_currency: sub.currency ?? null,
      estimated_amount: sub.amount ?? null,
      estimated_currency: sub.currency ?? null,
      stripe_product_id: sub.stripe_product_id ?? null,
      stripe_price_id: sub.stripe_price_id ?? null,
      default_payment_method_id: sub.default_payment_method_id ?? null,
      default_payment_method_brand: sub.default_payment_method_brand ?? null,
      default_payment_method_last4: sub.default_payment_method_last4 ?? null,
      latest_invoice_id: sub.latest_invoice_id ?? null,
      latest_invoice_status: sub.latest_invoice_status ?? null,
      latest_invoice_number: sub.latest_invoice_number ?? null,
      latest_invoice_url: sub.latest_invoice_url ?? null,
      latest_invoice_pdf: sub.latest_invoice_pdf ?? null,
      latest_invoice_amount: sub.latest_invoice_amount ?? null,
      latest_invoice_currency: sub.latest_invoice_currency ?? null,
      latest_invoice_created: sub.latest_invoice_created ? sub.latest_invoice_created.toISOString() : null,
      days_until_due: sub.days_until_due ?? null,
      last_payment_error_code: sub.last_payment_error_code ?? null,
      last_payment_error_message: sub.last_payment_error_message ?? null,
      stripe_subscription_id: sub.stripe_subscription_id ?? null,
      stripe_customer_id: sub.stripe_customer_id ?? null,
      canceled_at_effective: sub.canceled_at_effective ? sub.canceled_at_effective.toISOString() : null,
      notes: sub.notes ?? null,
    };
  }
}
