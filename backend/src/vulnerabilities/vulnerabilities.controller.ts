import { Body, CanActivate, Controller, Get, Injectable, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { resolveBusinessContributorScopeForUser } from '../auth/business-contributor-scope';
import { csvExportBody } from '../common/csv/send-csv-export';
import { parseExportFormat } from '../common/xlsx/format';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { throwFeatureDisabled } from '../common/feature-gates';
import { Features } from '../config/features';
import { hasLevel } from '../technologies/technologies.controller';
import { requireManager } from '../technologies/technology-rows';
import { CveNamesService } from './cve-names.service';
import { vulnerabilityHomeSummary } from './vulnerability-home-summary';
import { VulnerabilitiesService, type ApplicationsAccess, type VulnerabilityFilters, type VulnOpts } from './vulnerabilities.service';
import { VulnerabilityReachService } from './vulnerability-reach.service';

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

/** The vulnerabilities of the tenant (lot T6a), under the `infrastructure` permission. `export`, `filter-values`, `cve-names`, `sources` and `home-summary` before `:cveId`. */
@UseGuards(JwtAuthGuard, VulnerabilityFeedGuard, PermissionGuard)
@Controller('vulnerabilities')
export class VulnerabilitiesController {
  constructor(
    private readonly svc: VulnerabilitiesService,
    private readonly cveNames: CveNamesService,
  ) {}

  @RequireLevel('infrastructure', 'reader')
  @Get()
  async list(@Query() query: VulnerabilityFilters, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query ?? {}, opts(ctx), await applicationsAccess(ctx));
  }

  /** The list as a CSV file or a workbook (`format`); a path ending with /export: recorded as an export in the audit log. */
  @RequireLevel('infrastructure', 'reader')
  @Get('export')
  async export(
    @Query() query: VulnerabilityFilters & { language?: string; format?: string },
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const format = parseExportFormat(query?.format);
    const file = await this.svc.exportCsv(query ?? {}, query?.language, opts(ctx), await applicationsAccess(ctx), format);
    res.send(await csvExportBody(res, file));
  }

  /** The values of the page's filters: the version labels under the other filters, the assets and applications with vulnerabilities that count. */
  @RequireLevel('infrastructure', 'reader')
  @Get('filter-values')
  async filterValues(@Query() query: VulnerabilityFilters & { fields?: string }, @Tenant() ctx: TenantRequest) {
    return this.svc.filterValues(query ?? {}, opts(ctx), await applicationsAccess(ctx));
  }

  /** The state (and a common note) of many rows at once: chosen ones, or all of the filter. */
  @RequireLevel('infrastructure', 'member')
  @Post('bulk-state')
  async bulkState(@Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.bulkState(body ?? {}, opts(ctx), await applicationsAccess(ctx));
  }

  /** Published CVE.org vendor and product names. A static path, declared before `:cveId`. */
  @RequireLevel('infrastructure', 'reader')
  @Get('cve-names')
  cveNameDirectory(@Query('q') q: string | undefined, @Query('vendor') vendor: string | undefined, @Tenant() ctx: TenantRequest) {
    return this.cveNames.directory(requireManager(ctx.manager), q, vendor);
  }

  /** How fresh the NVD, CVE.org and the exploitation catalogues are. A static path, declared before `:cveId`. */
  @RequireLevel('infrastructure', 'reader')
  @Get('sources')
  sources(@Tenant() ctx: TenantRequest) {
    return this.svc.sources(opts(ctx));
  }

  /** The home tile's figures (lot 6). A static path, declared before `:cveId`. */
  @RequireLevel('infrastructure', 'reader')
  @Get('home-summary')
  async homeSummary(@Tenant() ctx: TenantRequest) {
    return vulnerabilityHomeSummary(opts(ctx), await applicationsAccess(ctx), (o) => this.svc.sources(o));
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

  /** One row per version (lot V4). Declared before `:cveId`. */
  @RequireLevel('infrastructure', 'reader')
  @Get('summary')
  async summary(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.summary(id, opts(ctx));
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

/** The vulnerabilities of an asset (id or `AST-n`), for its record and badge, under `infrastructure`. */
@UseGuards(JwtAuthGuard, VulnerabilityFeedGuard, PermissionGuard)
@Controller('assets/:id/vulnerabilities')
export class AssetVulnerabilitiesController {
  constructor(private readonly svc: VulnerabilityReachService) {}

  @RequireLevel('infrastructure', 'reader')
  @Get()
  list(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.ofAsset(id, opts(ctx));
  }
}

/**
 * The vulnerabilities of an application (id or `APP-n`), for its record and badge, under
 * `applications`, among the applications the user reads (outside them: 404).
 */
@UseGuards(JwtAuthGuard, VulnerabilityFeedGuard, PermissionGuard)
@Controller('applications/:id/vulnerabilities')
export class ApplicationVulnerabilitiesController {
  constructor(private readonly svc: VulnerabilityReachService) {}

  @RequireLevel('applications', 'reader')
  @Get()
  async list(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.ofApplication(id, opts(ctx), await applicationsAccess(ctx));
  }
}
