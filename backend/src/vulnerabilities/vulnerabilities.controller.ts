import { Body, CanActivate, Controller, Get, Injectable, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { resolveBusinessContributorScopeForUser } from '../auth/business-contributor-scope';
import { contentDisposition } from '../common/content-disposition';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { throwFeatureDisabled } from '../common/feature-gates';
import { Features } from '../config/features';
import { hasLevel } from '../technologies/technologies.controller';
import { requireManager } from '../technologies/technology-rows';
import { VulnerabilitiesService, type ApplicationsAccess, type VulnerabilityFilters, type VulnOpts } from './vulnerabilities.service';

/** Every vulnerability route answers 403 `FEATURE_DISABLED` while `VULNERABILITY_FEED_ENABLED` is off. */
@Injectable()
export class VulnerabilityFeedGuard implements CanActivate {
  canActivate(): boolean {
    if (!Features.VULNERABILITY_FEED_ENABLED) throwFeatureDisabled('vulnerabilityFeed');
    return true;
  }
}

function opts(ctx: TenantRequest): VulnOpts {
  return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
}

/** The applications the caller reads: none without `applications:reader`, a Business Contributor's own only. */
async function applicationsAccess(ctx: TenantRequest): Promise<ApplicationsAccess> {
  if (!hasLevel(ctx, 'applications', 'reader')) return null;
  const scope = await resolveBusinessContributorScopeForUser(
    { manager: requireManager(ctx.manager), userId: ctx.userId, tenantId: ctx.tenantId, isAdmin: ctx.isAdmin },
    'applications',
    'reader',
  );
  return { scope };
}

/** The vulnerabilities of the tenant (lot T6a), under the `infrastructure` permission. `export` before `:cveId`. */
@UseGuards(JwtAuthGuard, VulnerabilityFeedGuard, PermissionGuard)
@Controller('vulnerabilities')
export class VulnerabilitiesController {
  constructor(private readonly svc: VulnerabilitiesService) {}

  @RequireLevel('infrastructure', 'reader')
  @Get()
  async list(@Query() query: VulnerabilityFilters, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query ?? {}, opts(ctx), await applicationsAccess(ctx));
  }

  /** The list as a CSV file (a path ending with /export: recorded as an export in the audit log). */
  @RequireLevel('infrastructure', 'reader')
  @Get('export')
  async export(
    @Query() query: VulnerabilityFilters & { language?: string },
    @Res({ passthrough: true }) res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const file = await this.svc.exportCsv(query ?? {}, query?.language, opts(ctx), await applicationsAccess(ctx));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(file.filename));
    return file.content;
  }

  @RequireLevel('infrastructure', 'reader')
  @Get(':cveId')
  async detail(@Param('cveId') cveId: string, @Tenant() ctx: TenantRequest) {
    return this.svc.detail(cveId, opts(ctx), await applicationsAccess(ctx));
  }
}

/** The vulnerabilities seen from a technology, mounted under `technologies/:id/vulnerabilities`. */
@UseGuards(JwtAuthGuard, VulnerabilityFeedGuard, PermissionGuard)
@Controller('technologies/:id/vulnerabilities')
export class TechnologyVulnerabilitiesController {
  constructor(private readonly svc: VulnerabilitiesService) {}

  @RequireLevel('infrastructure', 'reader')
  @Get()
  async list(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.ofTechnology(id, opts(ctx));
  }

  @RequireLevel('infrastructure', 'member')
  @Post('rematch')
  async rematch(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.rematch(id, opts(ctx));
  }

  @RequireLevel('infrastructure', 'member')
  @Patch(':cveId')
  async update(@Param('id') id: string, @Param('cveId') cveId: string, @Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.update(id, cveId, body ?? {}, opts(ctx));
  }
}
