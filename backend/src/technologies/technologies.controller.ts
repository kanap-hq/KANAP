import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { resolveBusinessContributorScopeForUser, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { moduleRightRequired } from '../auth/module-right-required';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { contentDisposition } from '../common/content-disposition';
import { parseLookupRequest, runLookup, type LookupSpec } from '../common/lookup/reference-lookup';
import { StorageService } from '../common/storage/storage.service';
import { languageOf, type CsvLanguage } from '../common/csv-sheet';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { attachmentMulterOptions, csvImportMulterOptions } from '../common/upload';
import { incidentViewerFromContext } from '../incidents/incident-visibility';
import { buildRelationsAccess, hasLevel } from '../common/relations/relations-access';
import { CveNamesService } from '../vulnerabilities/cve-names.service';
import { TechnologiesService, type Opts } from './technologies.service';
import { TechnologiesDeleteService } from './technologies-delete.service';
import { TechnologiesRelationsService, technologyRelationKindOrThrow, type TechnologyRelationsContext } from './technologies-relations.service';
import { attachCatalogScreen, type CatalogScreen } from './catalog/catalog-screen';
import { TechnologyCatalogService } from './catalog/technology-catalog.service';
import { TechnologyLinksCsvService } from './technology-links-csv.service';
import { TechnologyLinksService, type ApplicationsReach, type LinkInput } from './technology-links.service';
import { requireManager } from './technology-rows';
import { csvExportFormat } from '../common/csv/csv-export.service';
import { csvExportBody } from '../common/csv/send-csv-export';
import type { ListExportFile } from '../common/csv/list-export';
import { parseExportFormat, type ExportFileFormat } from '../common/xlsx/format';

export { hasLevel };

/** The picker of technologies (`useLookupPicker`): name first, the editor and reference searched too; retired ones not offered. */
export const TECHNOLOGY_LOOKUP: LookupSpec = {
  table: 'technologies',
  columns: { id: 't.id', name: 't.name', editor: 't.editor', family: 't.family', reference: `'TEC-' || t.item_number`, lifecycle: 't.lifecycle' },
  label: 't.name',
  search: ['t.editor', `'TEC-' || t.item_number`],
  offered: `t.lifecycle <> 'retired'`,
};

/** `dry_run=true` on the query, or `dry_run: true` in the body. The query wins when it is sent. */
function dryRunRequested(query: string | undefined, body: unknown): boolean {
  if (query !== undefined && String(query).trim() !== '') {
    const value = String(query).trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new BadRequestException('dry_run must be true or false.');
  }
  if (body === true) return true;
  if (body === false || body === undefined || body === null) return false;
  throw new BadRequestException('dry_run must be true or false.');
}

/**
 * The technologies (lot S), under the `infrastructure` permission as the assets: read `reader`,
 * write `member`, delete `admin`. Static routes are declared before `:id` (Nest matches in order).
 */
@UseGuards(JwtAuthGuard)
@Controller('technologies')
export class TechnologiesController {
  constructor(
    private readonly svc: TechnologiesService,
    private readonly links: TechnologyLinksService,
    private readonly relations: TechnologiesRelationsService,
    private readonly deleteSvc: TechnologiesDeleteService,
    private readonly catalog: TechnologyCatalogService,
    private readonly storage: StorageService,
    private readonly linkFiles: TechnologyLinksCsvService,
    private readonly cveNames: CveNamesService,
  ) {}

  private opts(ctx: TenantRequest): Opts {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  /**
   * The applications the caller may see in the technology's rows: none without the `applications`
   * read right, a Business Contributor's own only (as `GET /assets/:assetId/assignments`).
   */
  private async applicationsReach(ctx: TenantRequest): Promise<ApplicationsReach> {
    if (!hasLevel(ctx, 'applications', 'reader')) return null;
    const scope = await resolveBusinessContributorScopeForUser({ manager: requireManager(ctx.manager), userId: ctx.userId, tenantId: ctx.tenantId, isAdmin: ctx.isAdmin }, 'applications', 'reader');
    return { scope };
  }

  /** A link file (`scope` `data` or `template`, 400 otherwise), written in `language` (the user's locale without it). */
  private async sendLinkFile(
    res: Response,
    scopeRaw: string | undefined,
    languageRaw: string | undefined,
    ctx: TenantRequest,
    formatRaw: unknown,
    produce: (scope: 'data' | 'template', language: CsvLanguage, format: ExportFileFormat) => Promise<ListExportFile>,
  ) {
    const scope = scopeRaw === 'template' ? 'template' : scopeRaw == null || scopeRaw === 'data' ? 'data' : null;
    if (!scope) throw new BadRequestException("scope must be 'data' or 'template'.");
    const format = csvExportFormat(formatRaw, scope);
    const language = await languageOf(requireManager(ctx.manager), ctx.tenantId, ctx.userId || null, languageRaw);
    res.send(await csvExportBody(res, await produce(scope, language, format)));
  }

  /** A link file import: `dryRun` unless the query says `false`. */
  private async importLinkFile(
    file: Express.Multer.File,
    dryRunRaw: string | undefined,
    languageRaw: string | undefined,
    ctx: TenantRequest,
    run: (file: Express.Multer.File, dryRun: boolean, language: CsvLanguage) => Promise<unknown>,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(requireManager(ctx.manager), ctx.tenantId, ctx.userId || null, languageRaw);
    return run(file, dryRun, language);
  }

  /** As `applicationsReach`, for a route that cannot answer without it: 403. */
  private async requireApplications(ctx: TenantRequest): Promise<{ scope?: ParticipationAccessScope }> {
    const reach = await this.applicationsReach(ctx);
    if (!reach) throw moduleRightRequired('applications', 'reader', 'You cannot read applications.');
    return reach;
  }

  private async relationsContext(ctx: TenantRequest): Promise<TechnologyRelationsContext> {
    const rights = buildRelationsAccess(ctx, {
      read: { budget_lines: 'budget', contracts: 'contracts', projects: 'portfolio_projects', incidents: 'incidents' },
      contribute: { incidents: 'incidents' },
    });
    const manager = requireManager(ctx.manager);
    const projectScope = await resolveBusinessContributorScopeForUser({ manager, userId: ctx.userId, tenantId: ctx.tenantId, isAdmin: ctx.isAdmin }, 'portfolio_projects', 'reader');
    return {
      manager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
      access: rights.access,
      writeIncidents: rights.contributes.incidents,
      projectScope,
      incidentViewer: incidentViewerFromContext(ctx),
    };
  }

  // ==================== STATIC ROUTES ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get()
  list(@Query() query: Record<string, any>, @Tenant() ctx: TenantRequest) {
    return this.svc.list(query, this.opts(ctx));
  }

  /** The ids and references of the whole list, with its sort and filters: the record's previous / next band. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('ids')
  listIds(@Query() query: Record<string, any>, @Tenant() ctx: TenantRequest) {
    return this.svc.listIds(query, this.opts(ctx));
  }

  /** Picker search (`q`) and hydration of chosen values (`ids`), see common/lookup. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('lookup')
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    return runLookup(requireManager(ctx.manager), ctx.tenantId, TECHNOLOGY_LOOKUP, parseLookupRequest(query));
  }

  /** The values the list grid's set filters offer: the tenant's own, every one of them. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('filter-values')
  filterValues(@Query('fields') fields: string, @Tenant() ctx: TenantRequest) {
    return this.svc.filterValues(fields, this.opts(ctx));
  }

  /** Editors to offer: the tenant's and the catalog's, deduplicated without case. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('editors')
  editors(@Query('q') q: string, @Tenant() ctx: TenantRequest) {
    return this.svc.editors(q, this.catalog.editors(), this.opts(ctx));
  }

  /** Catalog search: entries still on offer (`items`), and those already adopted when `q` is set. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('catalog')
  catalogEntries(@Query('q') q: string, @Query('family') family: string, @Query('language') language: string, @Tenant() ctx: TenantRequest) {
    return this.catalog.notAdopted({ q, family, language }, this.opts(ctx));
  }

  /** Adopt a catalog entry: the technology, its versions and its CPE identifiers. Idempotent. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post('adopt')
  adopt(@Body() body: { catalog_key?: string; language?: string }, @Tenant() ctx: TenantRequest) {
    return this.catalog.adopt(String(body?.catalog_key ?? ''), { ...this.opts(ctx), language: body?.language });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('attachments/:attachmentId')
  async downloadAttachment(@Param('attachmentId') attachmentId: string, @Res() res: Response, @Tenant() ctx: TenantRequest) {
    const meta = await this.svc.readAttachment(attachmentId, this.opts(ctx));
    const obj = await this.storage.getObjectStream(meta.storage_path);
    res.setHeader('Content-Type', obj.contentType || meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(meta.original_filename));
    if (obj.contentLength != null) res.setHeader('Content-Length', String(obj.contentLength));
    obj.stream.pipe(res);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete('attachments/:attachmentId')
  deleteAttachment(@Param('attachmentId') attachmentId: string, @Tenant() ctx: TenantRequest) {
    return this.svc.deleteAttachment(attachmentId, this.opts(ctx));
  }

  /** What a delete of `ids` takes with it, asked before the confirmation. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids?: string[] }, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.deleteCheck(Array.isArray(body?.ids) ? body.ids : [], this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids?: string[] }, @Tenant() ctx: TenantRequest) {
    return this.deleteSvc.bulkDelete(Array.isArray(body?.ids) ? body.ids : [], this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post()
  create(@Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.create(body, this.opts(ctx));
  }

  /** Every server ↔ technology link of the tenant, or the header row alone (`scope=template`). */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('asset-links/export')
  exportAssetLinks(
    @Query('scope') scopeRaw: string | undefined,
    @Query('language') languageRaw: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
    @Query('format') formatRaw?: unknown,
  ) {
    return this.sendLinkFile(res, scopeRaw, languageRaw, ctx, formatRaw, (scope, language, format) => this.linkFiles.exportAssetLinks(scope, this.opts(ctx), language, format));
  }

  /** Add or update server ↔ technology links. `dryRun` defaults to true and writes nothing. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('asset-links/import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  importAssetLinks(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string | undefined,
    @Query('language') languageRaw: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.importLinkFile(file, dryRunRaw, languageRaw, ctx, (uploaded, dryRun, language) => this.linkFiles.importAssetLinks({ file: uploaded, dryRun, language }, this.opts(ctx)));
  }

  /**
   * Every declared application ↔ technology link the caller reads, or the header row alone. The
   * applications rights of the single links (`requireApplications`): 403 without them.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('application-links/export')
  async exportApplicationLinks(
    @Query('scope') scopeRaw: string | undefined,
    @Query('language') languageRaw: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
    @Query('format') formatRaw?: unknown,
  ) {
    const applications = await this.requireApplications(ctx);
    return this.sendLinkFile(res, scopeRaw, languageRaw, ctx, formatRaw, (scope, language, format) => this.linkFiles.exportApplicationLinks(scope, this.opts(ctx), applications, language, format));
  }

  /** Add or update application declarations. `dryRun` defaults to true and writes nothing. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('application-links/import')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async importApplicationLinks(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string | undefined,
    @Query('language') languageRaw: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    const applications = await this.requireApplications(ctx);
    return this.importLinkFile(file, dryRunRaw, languageRaw, ctx, (uploaded, dryRun, language) => this.linkFiles.importApplicationLinks({ file: uploaded, dryRun, language }, this.opts(ctx), applications));
  }

  // ==================== RECORD ====================

  /**
   * The record, plus what this screen reads from the shipped catalog: the source of a version's
   * dates, and the distributor's vulnerability tracker. The service record stays free of both,
   * so the list, the export and the assistant do not carry them.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id')
  async get(@Param('id') id: string, @Tenant() ctx: TenantRequest): Promise<CatalogScreen<Awaited<ReturnType<TechnologiesService['get']>>>> {
    const record = await this.svc.get(id, this.opts(ctx));
    const product = record.catalog_key ? this.catalog.shippedProduct(record.catalog_key) : undefined;
    return attachCatalogScreen(record, product);
  }

  /** CVE.org names seen on the CVE of this technology's CPE products. Same right as reading the technology. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/cve-names/suggestions')
  cveNameSuggestions(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.cveNames.suggestions(requireManager(ctx.manager), ctx.tenantId, id);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.update(id, body, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Put(':id/vulnerability-alerts')
  setVulnerabilityAlerts(
    @Param('id') id: string,
    @Body() body: { enabled?: unknown; dry_run?: unknown },
    @Query('dry_run') dryRunRaw: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.setVulnerabilityAlerts(id, body?.enabled, this.opts(ctx), dryRunRequested(dryRunRaw, body?.dry_run));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Delete(':id')
  async delete(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    await this.deleteSvc.delete(id, this.opts(ctx));
    return { ok: true };
  }

  // ==================== VERSIONS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/versions')
  listVersions(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.listVersions(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/versions')
  createVersion(@Param('id') id: string, @Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.createVersion(id, body, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id/versions/:versionId')
  updateVersion(@Param('id') id: string, @Param('versionId') versionId: string, @Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.updateVersion(id, versionId, body, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/versions/:versionId')
  deleteVersion(@Param('id') id: string, @Param('versionId') versionId: string, @Tenant() ctx: TenantRequest) {
    return this.svc.deleteVersion(id, versionId, this.opts(ctx));
  }

  // ==================== OWNERS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/owners')
  listOwners(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.listOwners(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/owners/bulk-replace')
  replaceOwners(@Param('id') id: string, @Body() body: { owners?: Array<{ user_id: string; owner_type: 'business' | 'it' }> }, @Tenant() ctx: TenantRequest) {
    return this.svc.bulkReplaceOwners(id, body?.owners ?? [], this.opts(ctx));
  }

  // ==================== SUPPORT CONTACTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/support-contacts')
  listSupportContacts(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.listSupportContacts(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/support-contacts/bulk-replace')
  replaceSupportContacts(@Param('id') id: string, @Body() body: { contacts?: Array<{ contact_id?: string; role?: string | null }> }, @Tenant() ctx: TenantRequest) {
    return this.svc.bulkReplaceSupportContacts(id, body?.contacts ?? [], this.opts(ctx));
  }

  // ==================== WEB LINKS AND ATTACHMENTS ====================

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/links')
  listLinks(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.listLinks(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/links')
  createLink(@Param('id') id: string, @Body() body: { url?: string; description?: string }, @Tenant() ctx: TenantRequest) {
    return this.svc.createLink(id, body, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id/links/:linkId')
  updateLink(@Param('id') id: string, @Param('linkId') linkId: string, @Body() body: { url?: string; description?: string }, @Tenant() ctx: TenantRequest) {
    return this.svc.updateLink(id, linkId, body, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/links/:linkId')
  deleteLink(@Param('id') id: string, @Param('linkId') linkId: string, @Tenant() ctx: TenantRequest) {
    return this.svc.deleteLink(id, linkId, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.listAttachments(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  uploadAttachment(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Tenant() ctx: TenantRequest) {
    return this.svc.uploadAttachment(id, file, this.opts(ctx));
  }

  // ==================== RELATIONS (model of lot R1) ====================

  /** Budget lines, contracts, projects, incidents, documents and links in one round trip. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/relations')
  async getRelations(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.relations.getRelations(id, await this.relationsContext(ctx));
  }

  /** Link one object (`kind`: budget_lines, contracts, projects, incidents); the caller must read its module. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/relations/:kind')
  async linkRelation(@Param('id') id: string, @Param('kind') kind: string, @Body() body: { id?: string }, @Tenant() ctx: TenantRequest) {
    return this.relations.setLink(technologyRelationKindOrThrow(kind), id, String(body?.id ?? ''), true, await this.relationsContext(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/relations/:kind/:targetId')
  async unlinkRelation(@Param('id') id: string, @Param('kind') kind: string, @Param('targetId') targetId: string, @Tenant() ctx: TenantRequest) {
    return this.relations.setLink(technologyRelationKindOrThrow(kind), id, targetId, false, await this.relationsContext(ctx));
  }

  // ==================== SERVERS ====================

  /** The servers that carry the technology: installed (with version and provenance) and through the graph. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/assets')
  listAssets(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.links.assetsOfTechnology(id, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/assets')
  addAsset(@Param('id') id: string, @Body() body: LinkInput & { asset_id?: string }, @Tenant() ctx: TenantRequest) {
    return this.links.addAssetLink(id, String(body?.asset_id ?? ''), body ?? {}, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id/assets/:linkId')
  updateAsset(@Param('id') id: string, @Param('linkId') linkId: string, @Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.links.updateAssetLink(id, linkId, body ?? {}, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/assets/:linkId')
  removeAsset(@Param('id') id: string, @Param('linkId') linkId: string, @Tenant() ctx: TenantRequest) {
    return this.links.removeAssetLink(id, linkId, this.opts(ctx));
  }

  // ==================== APPLICATIONS ====================

  /** Hosted (through the servers) and declared applications. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/applications')
  async listApplications(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.links.applicationsOfTechnology(id, this.opts(ctx), await this.applicationsReach(ctx));
  }

  /** The same rows as a CSV file or a workbook (a path ending with /export: recorded as an export in the audit log). */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get(':id/applications/export')
  async exportApplications(
    @Param('id') id: string,
    @Query('language') language: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ) {
    const fileFormat = parseExportFormat(format);
    const file = await this.links.applicationsCsv(id, language, this.opts(ctx), await this.requireApplications(ctx), fileFormat);
    res.send(await csvExportBody(res, file));
  }

  /** Declare the technology on several applications at once (`{ application_ids }`). */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post(':id/applications')
  async addApplications(@Param('id') id: string, @Body() body: { application_ids?: string[] }, @Tenant() ctx: TenantRequest) {
    return this.links.addApplications(id, body?.application_ids ?? [], this.opts(ctx), await this.requireApplications(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Patch(':id/application-links/:linkId')
  async updateApplicationLink(@Param('id') id: string, @Param('linkId') linkId: string, @Body() body: LinkInput, @Tenant() ctx: TenantRequest) {
    await this.requireApplications(ctx);
    return this.links.updateApplicationLink(id, linkId, body ?? {}, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Delete(':id/applications/:appId')
  async removeApplication(@Param('id') id: string, @Param('appId') appId: string, @Tenant() ctx: TenantRequest) {
    return this.links.removeApplication(id, appId, this.opts(ctx), await this.requireApplications(ctx));
  }
}
