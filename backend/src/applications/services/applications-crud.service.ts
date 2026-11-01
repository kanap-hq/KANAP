import { TechnologyCpeEvents } from '../../technologies/technology-cpe-events';
import { linkedLineOf } from '../../spend/budget-nature';
import { hiddenLineCount } from '../../data-access/hidden-links';
import { copyClassification } from './application-classification';
import { classificationPatch, classificationReadState } from './application-classification';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { assertMarkdownSize } from '../../common/markdown-limits';
import { assertWebLinkUrl } from '../../common/web-link-url';
import { Application } from '../application.entity';
import { ApplicationOwner } from '../application-owner.entity';
import { ApplicationCompany } from '../application-company.entity';
import { ApplicationDepartment } from '../application-department.entity';
import { ApplicationLink } from '../application-link.entity';
import { ApplicationAttachment } from '../application-attachment.entity';
import { ApplicationDataResidency } from '../application-data-residency.entity';
import { AuditService } from '../../audit/audit.service';
import { formatApplicationCategoryOptions, ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { StorageService } from '../../common/storage/storage.service';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { ApplicationsBaseService, ServiceOpts } from './applications-base.service';
import { validateUploadedFile } from '../../common/upload-validation';
import { fixMulterFilename } from '../../common/upload';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';
import { shareRecipientsOf } from '../../notifications/share-recipients';
import { displayName } from '../../common/display-name';
import { NotificationsService } from '../../notifications/notifications.service';
import { projectParticipantCondition, requestParticipantCondition } from '../../auth/business-contributor-scope';
import { buildDerivedUsersByApp } from './derived-users';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import {
  applicationBadRequest,
  applicationNameKey,
  assertApplicationDates,
  assertApplicationNameFree,
  assertSuiteHasNoChildren,
  fitApplicationName,
  freeApplicationName,
  lockApplicationNames,
  normalizeApplicationName,
} from '../application-rules';

type OwnerQueryRow = ApplicationOwner & {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
};

/**
 * Service for core CRUD operations on applications.
 */
@Injectable()
export class ApplicationsCrudService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
    @Optional() private readonly integratedDocuments?: IntegratedDocumentsService,
  ) {
    super(appRepo);
  }

  /**
   * Get a single application by ID with optional expansions.
   */
  async get(id: string, opts?: ServiceOpts & { include?: string | string[] }) {
    const mg = this.getManager(opts);
    const appId = await this.resolveApplicationIdentifier(id, mg);
    await this.assertVisible(appId, opts?.accessScope, mg);
    const includeRaw = Array.isArray(opts?.include) ? opts?.include.join(',') : String(opts?.include ?? '').trim();
    const include = new Set(includeRaw.split(',').map((s) => s.trim()).filter(Boolean));
    const app = await mg.getRepository(Application).findOne({ where: { id: appId } });
    if (!app) throw new NotFoundException('Application not found');
    const owners = await mg.query(
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
      [appId, app.tenant_id],
    ).then((rows: OwnerQueryRow[]) => rows.map((row) => ({ ...row, full_name: row.full_name || row.email || row.user_id })));
    const companies = await mg.getRepository(ApplicationCompany).find({ where: { application_id: appId } as any });
    const departments = await mg.getRepository(ApplicationDepartment).find({ where: { application_id: appId } as any });
    const links = await mg.getRepository(ApplicationLink).find({ where: { application_id: appId } as any });
    const attachments = await mg.getRepository(ApplicationAttachment).find({ where: { application_id: appId } as any, order: { uploaded_at: 'DESC' as any } });
    const data_residency = await mg.getRepository(ApplicationDataResidency).find({ where: { application_id: appId } as any });
    const includeSupport = include.has('support') || include.has('support_contacts') || include.has('supportContacts');
    let support_contacts: Array<{ id: string; contact_id: string; role: string | null; contact?: any }> = [];
    if (includeSupport) {
      support_contacts = await this.listSupportContactsInternal(appId, mg);
    }
    const derived_total_users = await this.computeDerivedUsers(app.id, null, app.users_mode, { manager: mg });
    let instances: Array<any> = [];
    if (include.has('instances') || include.has('deployments')) {
      instances = await mg.query(
        `SELECT id, application_id, environment, lifecycle, status, base_url, region, zone, notes, sso_enabled, mfa_supported, disabled_at, created_at, updated_at
         FROM app_instances
         WHERE application_id = $1
         ORDER BY environment ASC, created_at ASC`,
        [appId],
      );
    }
    const classification_reviewer_name = await this.classificationReviewerName(app, mg);
    const result: any = { ...app, ...classificationReadState(app), classification_reviewer_name, owners, companies, departments, links, attachments, data_residency, derived_total_users };
    if (includeSupport) {
      result.support_contacts = support_contacts;
    }
    if (include.has('instances')) {
      result.instances = instances;
    }
    if (include.has('deployments')) {
      result.deployments = instances;
    }
    return result;
  }

  async shareApplication(
    applicationId: string,
    dto: ShareItemDto,
    tenantId: string,
    userId: string,
    opts?: ServiceOpts,
  ) {
    const { userIds, rawEmails } = shareRecipientsOf(dto);

    const mg = this.getManager(opts);
    if (opts?.accessScope) {
      throw new ForbiddenException('Business Contributor can only read assigned applications');
    }
    const appId = await this.resolveApplicationIdentifier(applicationId, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: appId } });
    if (!app) throw new NotFoundException('Application not found');

    const senderRows = await mg.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    const senderName = displayName(senderRows[0], 'Someone');

    const recipientRows = userIds.length > 0
      ? await mg.query(
          `SELECT u.id AS "userId", u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.locale
           FROM users u
           JOIN roles ro ON ro.id = u.role_id
           WHERE u.id = ANY($1) AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [userIds],
        )
      : [];

    if (recipientRows.length > 0 || rawEmails.length > 0) {
      this.notifications.notifyShare({
        itemType: 'application',
        itemId: app.id,
        itemName: app.name,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
        manager: mg,
      });
    }

    return { ok: true };
  }

  async getClassificationCatalog(opts?: ServiceOpts) {
    const manager = this.getManager(opts);
    return this.itOpsSettings.getClassificationCatalog(await this.getCurrentTenantId(manager), { manager });
  }

  async create(body: Partial<Application>, userId?: string | null, opts?: ServiceOpts) {
    return this.getManager(opts).transaction((manager) => this.createLocked(body, userId, { ...opts, manager }));
  }

  async update(id: string, body: Partial<Application>, userId?: string | null, opts?: ServiceOpts) {
    return this.getManager(opts).transaction((manager) => this.updateLocked(id, body, userId, { ...opts, manager }));
  }

  async reviewClassification(id: string, expectedRevision: number, userId: string | null, opts?: ServiceOpts) {
    if (!userId) throw new ForbiddenException('A signed-in reviewer is required');
    return this.getManager(opts).transaction(async (manager) => {
      const tenantId = await this.getCurrentTenantId(manager);
      const appId = await this.resolveApplicationIdentifier(id, manager);
      await this.assertVisible(appId, opts?.accessScope, manager);
      await manager.query('SELECT id FROM applications WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [appId, tenantId]);
      const repo = manager.getRepository(Application);
      const app = await repo.findOne({ where: { id: appId, tenant_id: tenantId } });
      if (!app) throw new NotFoundException('Application not found');
      if (!Number.isInteger(expectedRevision) || app.classification_revision !== expectedRevision) throw new ConflictException('Classification changed; reload before marking as reviewed');
      if (classificationReadState(app).classification_review_state === 'incomplete') throw new BadRequestException('Set business criticality, cyber criticality, data confidentiality, recovery wave and a brief justification before review');
      const actor = await manager.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
      if (!actor.length) throw new ForbiddenException('Reviewer must belong to this tenant');
      const before = { ...app };
      app.classification_review = { user_id: userId, reviewed_at: new Date().toISOString(), revision: app.classification_revision };
      await repo.save(app);
      await this.audit.log({ table: 'applications', recordId: app.id, action: 'update', before, after: app, userId }, { manager });
      return Object.assign(app, classificationReadState(app));
    });
  }

  private async classificationReviewerName(app: Pick<Application, 'tenant_id' | 'classification_review'>, manager: any): Promise<string | null> {
    const reviewerId = app.classification_review?.user_id;
    if (!reviewerId) return null;
    const rows = await manager.query(
      `SELECT first_name, last_name FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [reviewerId, app.tenant_id],
    );
    if (!rows.length) return null;
    return [rows[0].first_name, rows[0].last_name].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()).join(' ') || null;
  }

  /**
   * Create a new application.
   */
  private async createLocked(body: Partial<Application>, userId?: string | null, opts?: ServiceOpts) {
    // The description is the source of the overview document (integrated documents): Markdown size limit.
    assertMarkdownSize(body.description, 'description');
    const mg = this.getManager(opts);
    const repo = mg.getRepository(Application);
    const tenantId = await this.getCurrentTenantId(mg);
    const catalog = await this.itOpsSettings.lockClassificationCatalog(tenantId, mg);
    const name = normalizeApplicationName(body.name);
    const classification = classificationPatch(body, null, catalog);
    const nowYear = new Date().getFullYear();
    const lifecycle = await this.normalizeLifecycle(body.lifecycle, tenantId, mg, 'active');
    const category = await this.normalizeCategory((body as any).category, tenantId, mg, { useDefaultForEmpty: true });
    assertApplicationDates(body as any);
    await lockApplicationNames(mg, tenantId);
    await assertApplicationNameFree(mg, tenantId, name);
    const entity = repo.create({
      name,
      supplier_id: body.supplier_id ?? null,
      description: body.description ?? null,
      editor: (body.editor ?? null) as any,
      environment: ((body as any).environment || 'prod') as any,
      category,
      lifecycle,
      ...classification,
      hosting_model: (body.hosting_model ?? null) as any,
      external_facing: !!body.external_facing,
      is_suite: !!(body as any).is_suite,
      retired_date: (body as any).retired_date ? new Date((body as any).retired_date as any) : null,
      version: body.version ?? null,
      end_of_support_date: body.end_of_support_date ? new Date(body.end_of_support_date as any) : null,
      go_live_date: body.go_live_date ? new Date(body.go_live_date as any) : null,
      predecessor_id: body.predecessor_id ?? null,
      last_dr_test: body.last_dr_test ? new Date(body.last_dr_test as any) : null,
      sso_enabled: !!body.sso_enabled,
      mfa_supported: !!body.mfa_supported,
      etl_enabled: !!(body as any).etl_enabled,
      contains_pii: !!body.contains_pii,
      licensing: body.licensing ?? null,
      notes: body.notes ?? null,
      support_notes: (body as any).support_notes ?? null,
      users_mode: (body.users_mode || 'it_users') as any,
      users_year: typeof body.users_year === 'number' ? body.users_year : nowYear,
      users_override: body.users_override ?? null,
      status: 'enabled',
      disabled_at: null,
    });
    const saved = (await repo.save(entity as any)) as Application;
    // The reference (`APP-n`) is given by the database on insert: the page opens the new
    // application under it, with the reference in its header.
    const [{ sequential_id }] = await mg.query(`SELECT sequential_id FROM applications WHERE id = $1 AND tenant_id = $2`, [saved.id, tenantId]);
    saved.sequential_id = sequential_id;
    await this.audit.log({ table: 'applications', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return Object.assign(saved, classificationReadState(saved));
  }

  /**
   * Update an existing application.
   */
  private async updateLocked(id: string, body: Partial<Application>, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(Application);
    const appId = await this.resolveApplicationIdentifier(id, mg);
    const tenantId = await this.getCurrentTenantId(mg);
    const catalog = await this.itOpsSettings.lockClassificationCatalog(tenantId, mg);
    await mg.query('SELECT id FROM applications WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [appId, tenantId]);
    const existing = await repo.findOne({ where: { id: appId, tenant_id: tenantId } });
    if (!existing) throw new NotFoundException('Application not found');
    // A changed description gets the Markdown size limit; a stored one is kept as it is.
    if (body.description !== undefined && body.description !== existing.description) {
      assertMarkdownSize(body.description, 'description');
    }
    const before = { ...existing };
    const classification = classificationPatch(body, existing, catalog);
    const patch: any = { ...body, ...classification };
    for (const key of ['id', 'tenant_id', 'created_at', 'sequential_id']) delete patch[key];
    if (patch.last_dr_test !== undefined) patch.last_dr_test = patch.last_dr_test ? new Date(patch.last_dr_test as any) : null;
    if (patch.retired_date !== undefined) patch.retired_date = patch.retired_date ? new Date(patch.retired_date as any) : null;
    if (patch.end_of_support_date !== undefined) patch.end_of_support_date = patch.end_of_support_date ? new Date(patch.end_of_support_date as any) : null;
    if (patch.go_live_date !== undefined) patch.go_live_date = patch.go_live_date ? new Date(patch.go_live_date as any) : null;
    if (patch.lifecycle !== undefined) {
      patch.lifecycle = await this.normalizeLifecycle(patch.lifecycle, existing.tenant_id, mg, existing.lifecycle);
    }
    if (patch.category !== undefined) {
      patch.category = await this.normalizeCategory(patch.category, existing.tenant_id, mg);
    }
    if (patch.name !== undefined) {
      patch.name = normalizeApplicationName(patch.name);
      // Only a changed name is checked: an application sharing its name with another (older data) stays editable.
      if (applicationNameKey(patch.name) !== applicationNameKey(existing.name)) {
        await lockApplicationNames(mg, tenantId);
        await assertApplicationNameFree(mg, tenantId, patch.name, existing.id);
      }
    }
    if (['go_live_date', 'end_of_support_date', 'retired_date'].some((field) => patch[field] !== undefined)) {
      assertApplicationDates({ ...existing, ...patch });
    }
    if (patch.is_suite !== undefined && !patch.is_suite && existing.is_suite) {
      await assertSuiteHasNoChildren(mg, tenantId, existing.id);
    }
    Object.assign(existing, patch, { updated_at: new Date() });
    const saved = (await repo.save(existing as any)) as Application;
    await this.audit.log({ table: 'applications', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager: mg });
    // A renamed application: its description document's title follows (`APP-4 - New name - Overview`).
    if ((before as any).name !== saved.name) {
      await this.integratedDocuments?.syncTitles('applications', {
        id: saved.id,
        tenant_id: saved.tenant_id,
        item_number: null,
        name: saved.name,
        reference_label: String((saved as any).sequential_id || '').trim() || saved.id,
      }, userId ?? null, { manager: mg });
    }
    // Entering or leaving service: its declared technologies are matched again with the vulnerabilities.
    const instant = (value: unknown) => (value ? new Date(value as string).getTime() : null);
    if ((before as any).status !== saved.status || instant((before as any).disabled_at) !== instant(saved.disabled_at)) {
      await this.cpeEvents?.emitForSubjects(mg, tenantId, 'application', [saved.id]);
    }
    return Object.assign(saved, classificationReadState(saved));
  }

  async relationCounts(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    await this.assertVisible(resolvedAppId, opts?.accessScope, mg);
    // Projects count only for a caller who reads them, within a Business Contributor's scope.
    const readsProjects = opts?.readsProjects !== false;
    const projectCountSql = !readsProjects
      ? 'SELECT 0'
      : opts?.projectAccessScope
      ? `SELECT COUNT(*)
         FROM application_projects l
         JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = l.tenant_id
         WHERE l.application_id = $1
           AND l.tenant_id = app_current_tenant()
           AND ${projectParticipantCondition('p', '$2')}`
      : `SELECT COUNT(*) FROM application_projects l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()`;
    const params: unknown[] = readsProjects && opts?.projectAccessScope ? [resolvedAppId, opts.projectAccessScope.userId] : [resolvedAppId];
    // Requests count only for a caller who reads them, within a Business Contributor's scope.
    const requestScope = opts?.requestsAccess?.scope;
    if (requestScope) params.push(requestScope.userId);
    const requestCountSql = !opts?.requestsAccess
      ? 'SELECT 0'
      : requestScope
        ? `SELECT COUNT(*)
           FROM portfolio_request_applications l
           JOIN portfolio_requests r ON r.id = l.request_id AND r.tenant_id = l.tenant_id
           WHERE l.application_id = $1
             AND l.tenant_id = app_current_tenant()
             AND ${requestParticipantCondition('r', `$${params.length}`)}`
        : `SELECT COUNT(*) FROM portfolio_request_applications l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()`;
    // Budget lines and contracts count only for a caller who reads them (the Relations tab hides them otherwise).
    const readsBudget = opts?.readsBudget !== false;
    const readsContracts = opts?.readsContracts !== false;
    const readsProcesses = opts?.readsProcesses !== false;
    const readsTechnologies = opts?.readsTechnologies !== false;
    const rows: Array<{
      opex_count: string | number;
      capex_count: string | number;
      contracts_count: string | number;
      projects_count: string | number;
      requests_count: string | number;
      technologies_count: string | number;
      processes_count: string | number;
      links_count: string | number;
      attachments_count: string | number;
    }> = await mg.query(
      `SELECT
         (${readsBudget ? `SELECT COUNT(*) FROM application_spend_items l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()${linkedLineOf('l.tenant_id', 'l.spend_item_id', 'opex')}` : 'SELECT 0'}) AS opex_count,
         (${readsBudget ? `SELECT COUNT(*) FROM application_spend_items l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()${linkedLineOf('l.tenant_id', 'l.spend_item_id', 'capex')}` : 'SELECT 0'}) AS capex_count,
         (${readsContracts ? 'SELECT COUNT(*) FROM application_contracts l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()' : 'SELECT 0'}) AS contracts_count,
         (${projectCountSql}) AS projects_count,
         (${requestCountSql}) AS requests_count,
         (${readsTechnologies ? 'SELECT COUNT(DISTINCT l.technology_id) FROM application_technologies l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()' : 'SELECT 0'}) AS technologies_count,
         (${readsProcesses ? 'SELECT COUNT(*) FROM application_business_processes l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()' : 'SELECT 0'}) AS processes_count,
         (SELECT COUNT(*) FROM application_links l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()) AS links_count,
         (SELECT COUNT(*) FROM application_attachments l WHERE l.application_id = $1 AND l.tenant_id = app_current_tenant()) AS attachments_count`,
      params,
    );
    const row: Partial<{
      opex_count: string | number;
      capex_count: string | number;
      contracts_count: string | number;
      projects_count: string | number;
      requests_count: string | number;
      technologies_count: string | number;
      processes_count: string | number;
      links_count: string | number;
      attachments_count: string | number;
    }> = rows[0] || {};
    // The linked lines the Relations tab counts without listing them (`budget_lines_hidden`): those
    // outside a limited person's data access. Without the budget right, the family is not counted.
    const budgetLinesHidden = readsBudget ? await hiddenLineCount(mg, 'application', resolvedAppId) : 0;
    const counts = {
      opex: Number(row.opex_count || 0),
      capex: Number(row.capex_count || 0),
      contracts: Number(row.contracts_count || 0),
      projects: Number(row.projects_count || 0),
      requests: Number(row.requests_count || 0),
      // Still reported. The Relations badge (`total`) leaves these out: technologies are on the
      // Operations tab, business processes in the properties panel (lot R1b).
      technologies: Number(row.technologies_count || 0),
      processes: Number(row.processes_count || 0),
      links: Number(row.links_count || 0),
      attachments: Number(row.attachments_count || 0),
      budget_lines_hidden: budgetLinesHidden,
    };
    return {
      ...counts,
      // The badge counts requests and leaves tasks out (fried, 2026-10-21); the incidents are added by the page.
      total: counts.opex + counts.capex + counts.budget_lines_hidden + counts.contracts + counts.projects + counts.requests + counts.links + counts.attachments,
    };
  }

  // Links
  async listLinks(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    await this.assertVisible(resolvedAppId, opts?.accessScope, mg);
    return mg.getRepository(ApplicationLink).find({ where: { application_id: resolvedAppId } as any, order: { created_at: 'DESC' as any } });
  }

  async createLink(appId: string, body: Partial<ApplicationLink>, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const repo = mg.getRepository(ApplicationLink);
    const url = assertWebLinkUrl(body.url);
    if (!url) throw new BadRequestException('url is required');
    const entity = repo.create({ application_id: resolvedAppId, description: body.description ?? null, purpose: body.purpose ?? 'general', url });
    const saved = await repo.save(entity);
    await this.audit.log({ table: 'application_links', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
  }

  async updateLink(appId: string, linkId: string, body: Partial<ApplicationLink>, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const repo = mg.getRepository(ApplicationLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || existing.application_id !== resolvedAppId) throw new NotFoundException('Link not found');
    const before = { ...existing };
    if (body.purpose !== undefined) existing.purpose = body.purpose;
    if (body.description !== undefined) existing.description = body.description as any;
    if (body.url !== undefined) existing.url = assertWebLinkUrl(body.url);
    const saved = await repo.save(existing);
    await this.audit.log({ table: 'application_links', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager: mg });
    return saved;
  }

  async deleteLink(appId: string, linkId: string, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    const repo = mg.getRepository(ApplicationLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || existing.application_id !== resolvedAppId) return { ok: true };
    await repo.delete({ id: linkId } as any);
    await this.audit.log({ table: 'application_links', recordId: linkId, action: 'delete', before: existing, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // Attachments
  async listAttachments(appId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    await this.assertVisible(resolvedAppId, opts?.accessScope, mg);
    return mg.getRepository(ApplicationAttachment).find({ where: { application_id: resolvedAppId } as any, order: { uploaded_at: 'DESC' as any } });
  }

  async uploadAttachment(appId: string, file: Express.Multer.File, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    if (!file) throw new BadRequestException('No file uploaded');
    const tenant_id = await this.resolveTenantId(mg);
    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    if (!buf) throw new BadRequestException('Empty upload');
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: (file as any).mimetype,
      buffer: buf as Buffer,
      size: (file as any).size,
    });
    const originalName = decodedName || `attachment${validated.extension}`;
    const stored = `${randomUUID()}_${originalName}`;
    const key = path.posix.join('files', tenant_id, 'applications', resolvedAppId, stored);
    await this.storage.putObject({ key, body: buf as Buffer, contentType: validated.mimeType, contentLength: validated.size, sse: 'AES256' });
    const repo = mg.getRepository(ApplicationAttachment);
    const saved = await repo.save(repo.create({ application_id: resolvedAppId, original_filename: originalName, stored_filename: stored, mime_type: validated.mimeType || null, size: validated.size, storage_path: key }));
    await this.audit.log({ table: 'application_attachments', recordId: (saved as any).id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
  }

  async downloadAttachment(attachmentId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(ApplicationAttachment);
    const found = await repo.findOne({ where: { id: attachmentId } });
    if (!found) throw new NotFoundException('Attachment not found');
    await this.assertVisible(found.application_id, opts?.accessScope, mg);
    return found;
  }

  async deleteAttachment(attachmentId: string, userId?: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(ApplicationAttachment);
    const found = await repo.findOne({ where: { id: attachmentId } });
    if (!found) return { ok: true };
    await repo.delete({ id: attachmentId } as any);
    try { await this.storage.deleteObject((found as any).storage_path); } catch {}
    await this.audit.log({ table: 'application_attachments', recordId: found.id, action: 'update', before: found, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  async copyApplication(id: string, name: string, userId: string | null, opts?: ServiceOpts) {
    return this.getManager(opts).transaction(async (manager) => {
      const tenantId = await this.getCurrentTenantId(manager);
      const catalog = await this.itOpsSettings.lockClassificationCatalog(tenantId, manager);
      const source = await this.ensureApp(id, manager, opts?.accessScope);
      const { id: sourceId, sequential_id, created_at, updated_at, ...properties } = source;
      // A name already taken gets a numbered variant (`CRM (copy 2)`): copying twice never fails.
      await lockApplicationNames(manager, tenantId);
      const requested = normalizeApplicationName(String(name ?? '').trim() || fitApplicationName(source.name, ' (copy)'));
      const copyName = await freeApplicationName(manager, tenantId, requested);
      const entity = manager.getRepository(Application).create({ ...properties, ...copyClassification(source, catalog), name: copyName });
      const saved = await manager.getRepository(Application).save(entity);
      await this.audit.log({ table: 'applications', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager });
      return saved;
    });
  }

  async normalizeLifecycle(
    value: unknown,
    tenantId: string,
    manager?: any,
    fallback?: string,
  ): Promise<string> {
    const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
    const codes = (settings.lifecycleStates || []).map((item: any) => item.code);
    const fallbackCode = this.pickLifecycleFallback(fallback ?? 'active', codes);
    if (value === undefined || value === null || String(value).trim() === '') {
      return fallbackCode;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!codes.includes(normalized)) {
      const allowed = formatApplicationCategoryOptions(settings.lifecycleStates || []);
      throw applicationBadRequest('lifecycle_invalid', `Invalid lifecycle "${value}". Use one of: ${allowed}.`, { value: String(value), allowed });
    }
    return normalized;
  }

  private pickLifecycleFallback(candidate: string, allowed: string[]): string {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (normalized && allowed.includes(normalized)) {
      return normalized;
    }
    if (allowed.includes('active')) {
      return 'active';
    }
    return allowed[0] || 'active';
  }

  async normalizeCategory(
    value: unknown,
    tenantId: string,
    manager?: any,
    opts?: { useDefaultForEmpty?: boolean },
  ): Promise<string> {
    try {
      return await this.itOpsSettings.resolveApplicationCategoryCode(tenantId, value, {
        manager,
        useDefaultForEmpty: opts?.useDefaultForEmpty,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        const options = await this.itOpsSettings.getApplicationCategoryOptions(tenantId, { manager });
        const allowed = formatApplicationCategoryOptions(options);
        throw applicationBadRequest('category_invalid', error.message, { value: String(value ?? ''), allowed });
      }
      throw error;
    }
  }

  // Derived users
  async computeDerivedUsers(appId: string, year: number | null, mode: 'manual' | 'it_users' | 'headcount' | null, opts?: ServiceOpts): Promise<number> {
    const mg = this.getManager(opts);
    await this.assertVisible(appId, opts?.accessScope, mg);
    // One rule for the grid column and this total: see buildDerivedUsersByApp. `year` is an
    // optional reference year; without it the current year is used.
    let usersOverride: number | null = null;
    if (mode === 'manual') {
      const app = await mg.getRepository(Application).findOne({ where: { id: appId } });
      usersOverride = app?.users_override ?? null;
    }
    const totals = await buildDerivedUsersByApp(
      [{ id: appId, users_mode: mode, users_override: usersOverride, reference_year: year }],
      mg,
    );
    return totals[appId] ?? 0;
  }

  async getTotalUsers(appId: string, yearOverride?: number, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(appId, mg);
    await this.assertVisible(resolvedAppId, opts?.accessScope, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedAppId } });
    if (!app) throw new NotFoundException('Application not found');
    const year = typeof yearOverride === 'number' && !isNaN(yearOverride) ? yearOverride : new Date().getFullYear();
    const total = await this.computeDerivedUsers(resolvedAppId, year, app.users_mode, { manager: mg });
    return { total, year };
  }

  // Support contacts internal helper (for get method)
  private async listSupportContactsInternal(appId: string, mg: any) {
    const rows = await mg.query(
      `SELECT sc.id, sc.contact_id, sc.role, c.first_name, c.last_name, c.email, c.phone, c.mobile
       FROM application_support_contacts sc
       JOIN contacts c ON c.id = sc.contact_id
       WHERE sc.application_id = $1
       ORDER BY sc.created_at ASC, sc.id ASC`,
      [appId],
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
}
