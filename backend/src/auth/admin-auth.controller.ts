import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequireLevel } from './require-level.decorator';
import { TenantsService } from '../tenants/tenants.service';
import { AuditService } from '../audit/audit.service';
import { EntraAuthService } from './entra-auth.service';
import { EntraDirectorySyncService } from './entra-directory-sync.service';
import { Features } from '../config/features';
import { LongRunningRequest, OUTSIDE_WORK_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly entra: EntraAuthService,
    private readonly directorySync: EntraDirectorySyncService,
  ) {}

  @Get('settings')
  @RequireLevel('users', 'admin')
  async getSettings(@Req() req: any) {
    if (req?.isPlatformHost) {
      throw new BadRequestException('SSO is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }
    const tenant = await this.tenants.findById(tenantMeta.id);
    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }
    const connected = tenant.sso_provider === 'entra' && !!tenant.entra_tenant_id;
    const directorySync = ((tenant.entra_metadata as any)?.directory_sync ?? null) as Record<string, any> | null;
    return {
      sso_provider: tenant.sso_provider ?? 'none',
      entra_tenant_id: tenant.entra_tenant_id ?? null,
      sso_enabled: !!tenant.sso_enabled,
      entra_metadata: tenant.entra_metadata ?? null,
      directory_sync: connected && Features.ENTRA_SSO
        ? {
            status: directorySync?.status ?? 'never',
            message: directorySync?.message ?? null,
            last_attempt_at: directorySync?.last_attempt_at ?? null,
            last_success_at: directorySync?.last_success_at ?? null,
            synced: directorySync?.synced ?? null,
            disabled: directorySync?.disabled ?? null,
            removed: directorySync?.removed ?? null,
            consent_url: this.entra.buildAdminConsentUrl(tenant.entra_tenant_id as string, tenant.id),
          }
        : null,
    };
  }

  /** Run the directory sync for this tenant now (same code path as the nightly task). */
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('directory-sync')
  @RequireLevel('users', 'admin')
  async runDirectorySync(@Req() req: any) {
    if (req?.isPlatformHost) {
      throw new BadRequestException('SSO is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }
    if (!Features.ENTRA_SSO) {
      throw new BadRequestException('SSO_NOT_CONFIGURED');
    }
    return this.directorySync.syncTenant(tenantMeta.id);
  }

  @Post('disconnect')
  @RequireLevel('users', 'admin')
  async disconnect(@Req() req: any, @Body() _body: any) {
    if (req?.isPlatformHost) {
      throw new BadRequestException('SSO is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }

    const tenant = await this.tenants.findById(tenantMeta.id);
    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }

    await this.tenants.updateTenant(tenant.id, {
      sso_provider: 'none' as any,
      sso_enabled: false as any,
      entra_tenant_id: null as any,
      entra_metadata: null as any,
    });

    await this.audit.log(
      {
        table: 'tenants',
        recordId: tenant.id,
        action: 'update',
        before: {
          sso_provider: tenant.sso_provider ?? 'none',
          entra_tenant_id: tenant.entra_tenant_id ?? null,
          sso_enabled: !!tenant.sso_enabled,
        },
        after: { sso_provider: 'none', entra_tenant_id: null, sso_enabled: false },
        userId: req.user?.sub ?? null,
        sourceRef: 'entra-disconnect',
      },
      req?.queryRunner?.manager ? { manager: req.queryRunner.manager } : undefined,
    );

    return { ok: true };
  }
}
