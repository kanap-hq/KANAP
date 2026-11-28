import { BadRequestException, Body, ConflictException, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequireAnyLevel, RequireLevel } from './require-level.decorator';
import { TenantsService } from '../tenants/tenants.service';
import { EntraAuthService } from './entra-auth.service';
import { EntraDirectorySyncService } from './entra-directory-sync.service';
import { Features } from '../config/features';
import { BULK_WRITE_TIMEOUTS, LongRunningRequest, OUTSIDE_WORK_TIMEOUTS } from '../common/request-db-timeouts';
import { EntraDisconnectService } from './entra-disconnect.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The person administers the organisation: the Administrator role, or `organization:admin` (the
 * level PermissionGuard read for the route's `@RequireLevel('organization', …)`).
 */
function canAdministerOrganization(req: any): boolean {
  return req?.isAdmin === true || req?.permissionLevel === 'admin';
}

class DisconnectDto {
  /** The administrator's new password, when they have none (see EntraDisconnectService). */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  password?: string;
}

/**
 * Admin › Authentication. Reading needs `organization:reader` (the page opens read-only). The sync
 * and the disconnect write the persons of the whole workspace: they need `organization:admin` and
 * `users:admin` both, and access to all data.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly entra: EntraAuthService,
    private readonly directorySync: EntraDirectorySyncService,
    private readonly disconnection: EntraDisconnectService,
  ) {}

  @Get('settings')
  @RequireLevel('organization', 'reader')
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
    const manager = req?.queryRunner?.manager;
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
            kept_administrator: directorySync?.kept_administrator ?? null,
            // Signed in the person's name, and its return writes the workspace's connection: for
            // organization:admin only.
            consent_url: canAdministerOrganization(req)
              ? this.entra.buildAdminConsentUrl(tenant.entra_tenant_id as string, tenant.id, req?.user?.sub)
              : null,
          }
        : null,
      // What a disconnect would do to the accounts, for its confirmation.
      disconnect: connected && manager ? await this.disconnection.summary(manager, tenant.id, req?.user?.sub ?? null) : null,
    };
  }

  /**
   * Run the directory sync for this tenant now (same code path as the nightly task). 409
   * `DIRECTORY_SYNC_RUNNING` while another sync of the workspace runs.
   */
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @ReservedToUnscopedDataAccess()
  @Post('directory-sync')
  @RequireLevel('organization', 'admin')
  // A list of one entry next to `@RequireLevel`: PermissionGuard asks for both (the level and one
  // entry of the list), so this route needs organization:admin AND users:admin.
  @RequireAnyLevel([{ resource: 'users', level: 'admin' }])
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
    const result = await this.directorySync.syncTenant(tenantMeta.id);
    if (result.status === 'already_running') {
      throw new ConflictException({
        statusCode: 409,
        code: 'DIRECTORY_SYNC_RUNNING',
        message: 'A sync is already running. Wait for it to finish.',
      });
    }
    return result;
  }

  /**
   * Removes the workspace's Microsoft connection and makes every linked account local, in the
   * request's transaction (see EntraDisconnectService). 409 `SSO_NOT_CONNECTED` when it is not
   * connected; 400 `LOCAL_PASSWORD_REQUIRED` when the administrator has no password and gives none.
   * The waits of the bulk writes: one statement writes every linked account, and the search index
   * trigger of each account makes it long on a large workspace.
   */
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @ReservedToUnscopedDataAccess()
  @Post('disconnect')
  @RequireLevel('organization', 'admin')
  // A list of one entry next to `@RequireLevel`: PermissionGuard asks for both (the level and one
  // entry of the list), so this route needs organization:admin AND users:admin.
  @RequireAnyLevel([{ resource: 'users', level: 'admin' }])
  async disconnect(@Req() req: any, @Body() body: DisconnectDto) {
    if (req?.isPlatformHost) {
      throw new BadRequestException('SSO is not available on the platform admin host');
    }
    const tenantMeta = req?.tenant;
    if (!tenantMeta?.id) {
      throw new BadRequestException('TENANT_REQUIRED');
    }
    const manager = req?.queryRunner?.manager;
    if (!manager) {
      throw new BadRequestException('TENANT_REQUIRED');
    }
    const result = await this.disconnection.disconnect(manager, {
      tenantId: tenantMeta.id,
      actorId: req.user?.sub ?? null,
      password: body?.password,
    });
    // A token cached for the directory serves no one any more.
    this.entra.invalidateAppToken(result.entraTenantId);
    return { ok: true, accounts_made_local: result.unlinked };
  }
}
