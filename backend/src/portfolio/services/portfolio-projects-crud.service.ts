import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PortfolioProject, ProjectStatus, ProjectOrigin } from '../portfolio-project.entity';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioRequestProject } from '../portfolio-request-project.entity';
import { PortfolioProjectTeam } from '../portfolio-project-team.entity';
import { PortfolioProjectContact } from '../portfolio-project-contact.entity';
import { PortfolioProjectCapex } from '../portfolio-project-capex.entity';
import { PortfolioProjectOpex } from '../portfolio-project-opex.entity';
import { PortfolioProjectDependency } from '../portfolio-project-dependency.entity';
import { TeamRole } from '../portfolio-request-team.entity';
import { AuditService } from '../../audit/audit.service';
import { resolveRecordCreators } from '../../audit/record-creator.util';
import { ItemNumberService } from '../../common/item-number.service';
import { PortfolioCriteriaService } from '../portfolio-criteria.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';
import { computeAutoAllocations } from '../utils/allocation-utils';
import { formatItemLabel } from '../utils/activity-labels';
import { detectChanges, PROJECT_TRACKED_FIELDS, resolveDisplayNames } from '../../common/change-detection';
import { normalizeMarkdownRichText } from '../../common/markdown-rich-text';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { ParticipationAccessScope, projectParticipantCondition } from '../../auth/business-contributor-scope';
import { budgetLineIdsOfKind, insertProjectBudgetLinks, lockProject, OPEX_ITEMS_NOT_FOUND } from '../project-budget-links.util';

/**
 * Service for core CRUD operations on portfolio projects.
 */
@Injectable()
export class PortfolioProjectsCrudService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
    @InjectRepository(PortfolioRequest)
    private readonly requestRepo: Repository<PortfolioRequest>,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => PortfolioCriteriaService))
    private readonly criteriaService: PortfolioCriteriaService,
    private readonly notifications: NotificationsService,
    private readonly itemNumberService: ItemNumberService,
    private readonly integratedDocuments: IntegratedDocumentsService,
  ) {
    super(projectRepo);
  }

  private requireActivityAuthor(userId?: string | null): string {
    if (!userId) throw new BadRequestException('userId is required for change activity logging');
    return userId;
  }

  private async resolveUserNamesByIds(mg: EntityManager, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }>>(
      `SELECT id, first_name, last_name, email
       FROM users
       WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      byId.set(row.id, fullName || row.email || row.id);
    }
    return userIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveCapexLabelsByIds(mg: EntityManager, capexIds: string[]): Promise<string[]> {
    if (capexIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; description: string | null }>>(
      `SELECT id, description
       FROM capex_items
       WHERE id = ANY($1::uuid[])`,
      [capexIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.description || row.id);
    }
    return capexIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveOpexLabelsByIds(mg: EntityManager, opexIds: string[]): Promise<string[]> {
    if (opexIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; product_name: string | null; description: string | null }>>(
      `SELECT id, product_name, description
       FROM spend_items
       WHERE id = ANY($1::uuid[]) AND nature = 'opex'`,
      [opexIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.product_name || row.description || row.id);
    }
    return opexIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Get a single project by ID with optional related data.
   */
  async assertVisible(
    id: string,
    accessScope: ParticipationAccessScope | undefined,
    opts?: ServiceOpts,
  ): Promise<void> {
    if (!accessScope) return;
    const mg = this.getManager(opts);
    const rows = await mg.query(
      `SELECT 1
       FROM portfolio_projects p
       WHERE p.id = $1
         AND ${projectParticipantCondition('p', '$2')}
       LIMIT 1`,
      [id, accessScope.userId],
    );
    if (rows.length === 0) throw new NotFoundException('Project not found');
  }

  async get(id: string, query: any, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProject);

    const includeRaw = typeof query === 'string' ? query : (query?.include || '');
    const include = new Set(
      includeRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
    );

    await this.assertVisible(id, opts?.accessScope, { manager: mg });

    const project = await repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');

    const result: any = { ...project };

    // Load team members
    if (include.has('team')) {
      const team = await mg.query(
        `SELECT pt.*, u.email, u.first_name, u.last_name
         FROM portfolio_project_team pt
         JOIN users u ON u.id = pt.user_id
         WHERE pt.project_id = $1`,
        [id]
      );
      result.business_team = team.filter((t: any) => t.role === 'business_team');
      result.it_team = team.filter((t: any) => t.role === 'it_team');
    }

    // Load sponsors/leads
    if (include.has('sponsors') || include.has('team')) {
      const userIds = [
        project.business_sponsor_id,
        project.business_lead_id,
        project.it_sponsor_id,
        project.it_lead_id,
      ].filter(Boolean) as string[];

      if (userIds.length > 0) {
        const users = await mg.query(
          `SELECT id, email, first_name, last_name FROM users WHERE id = ANY($1)`,
          [userIds]
        );
        const userMap = Object.fromEntries(users.map((u: any) => [u.id, u]));
        result.business_sponsor = project.business_sponsor_id ? userMap[project.business_sponsor_id] : null;
        result.business_lead = project.business_lead_id ? userMap[project.business_lead_id] : null;
        result.it_sponsor = project.it_sponsor_id ? userMap[project.it_sponsor_id] : null;
        result.it_lead = project.it_lead_id ? userMap[project.it_lead_id] : null;
      }
    }

    // Load external contacts
    if (include.has('contacts')) {
      result.external_contacts = await mg.query(
        `SELECT c.* FROM portfolio_project_contacts pc
         JOIN contacts c ON c.id = pc.contact_id
         WHERE pc.project_id = $1`,
        [id]
      );
    }

    // Load company/department
    if (include.has('company') && project.company_id) {
      const companies = await mg.query(`SELECT id, name FROM companies WHERE id = $1`, [project.company_id]);
      result.company = companies[0] || null;
    }
    if (include.has('department') && project.department_id) {
      const departments = await mg.query(`SELECT id, name FROM departments WHERE id = $1`, [project.department_id]);
      result.department = departments[0] || null;
    }

    // Load source requests
    if (include.has('source_requests')) {
      result.source_requests = await mg.query(
        `SELECT r.id, r.item_number, r.name, r.status, r.priority_score
         FROM portfolio_request_projects rp
         JOIN portfolio_requests r ON r.id = rp.request_id
         WHERE rp.project_id = $1`,
        [id]
      );
    }

    // Load URLs
    if (include.has('urls')) {
      result.urls = await mg.query(
        `SELECT * FROM portfolio_project_urls WHERE project_id = $1 ORDER BY created_at`,
        [id]
      );
    }

    // Load dependencies
    if (include.has('dependencies')) {
      const rawDeps = await mg.query(
        `SELECT d.*, p.name as project_name, p.status as project_status
         FROM portfolio_project_dependencies d
         LEFT JOIN portfolio_projects p ON p.id = d.depends_on_project_id
         WHERE d.project_id = $1`,
        [id]
      );
      result.dependencies = rawDeps.map((d: any) => ({
        id: d.id,
        target_type: 'project' as const,
        target_id: d.depends_on_project_id,
        target_name: d.project_name,
        target_status: d.project_status,
      }));
    }

    // Load attachments (exclude inline images)
    if (include.has('attachments')) {
      result.attachments = await mg.query(
        `SELECT id, original_filename, mime_type, size, created_at
         FROM portfolio_project_attachments WHERE project_id = $1 AND source_field IS NULL ORDER BY created_at`,
        [id]
      );
    }

    // Load activity history
    if (include.has('activities')) {
      result.activities = await mg.query(
        `SELECT a.*, u.email, u.first_name, u.last_name
         FROM portfolio_activities a
         LEFT JOIN users u ON u.id = a.author_id
         WHERE a.project_id = $1
           AND a.tenant_id = app_current_tenant()
         ORDER BY a.created_at DESC, a.id`,
        [id]
      );
      const creators = await resolveRecordCreators(mg, 'portfolio_projects', [id]);
      result.created_by_name = creators.get(id) ?? null;
    }

    // Load phases
    if (include.has('phases')) {
      result.phases = await mg.query(
        `SELECT * FROM portfolio_project_phases
         WHERE project_id = $1
         ORDER BY sequence`,
        [id]
      );
    }

    // Load milestones
    if (include.has('milestones')) {
      result.milestones = await mg.query(
        `SELECT m.*, p.name as phase_name
         FROM portfolio_project_milestones m
         LEFT JOIN portfolio_project_phases p ON p.id = m.phase_id
         WHERE m.project_id = $1
         ORDER BY COALESCE(p.sequence, 999999), m.target_date NULLS LAST`,
        [id]
      );
    }

    // Load time entries
    if (include.has('time_entries')) {
      result.time_entries = await mg.query(
        `SELECT te.*,
                u.email as user_email, u.first_name as user_first_name, u.last_name as user_last_name,
                lb.email as logged_by_email, lb.first_name as logged_by_first_name, lb.last_name as logged_by_last_name
         FROM portfolio_project_time_entries te
         LEFT JOIN users u ON u.id = te.user_id
         LEFT JOIN users lb ON lb.id = te.logged_by_id
         WHERE te.project_id = $1
         ORDER BY te.logged_at DESC`,
        [id]
      );
    }

    // Load CAPEX items
    if (include.has('capex') || include.has('financials')) {
      result.capex_items = await mg.query(
        `SELECT c.id, c.description, c.ppe_type, c.investment_type, c.priority, c.currency, c.status,
                sup.name as supplier_name
         FROM portfolio_project_capex pc
         JOIN capex_items c ON c.id = pc.capex_id
         LEFT JOIN suppliers sup ON sup.id = c.supplier_id
         WHERE pc.project_id = $1`,
        [id]
      );
    }

    // Load OPEX items
    if (include.has('opex') || include.has('financials')) {
      result.opex_items = await mg.query(
        `SELECT s.id, s.product_name, s.description, s.currency, s.status,
                sup.name as supplier_name
         FROM portfolio_project_opex po
         JOIN spend_items s ON s.id = po.opex_id AND s.nature = 'opex'
         LEFT JOIN suppliers sup ON sup.id = s.supplier_id
         WHERE po.project_id = $1`,
        [id]
      );
    }

    return result;
  }

  /**
   * Create a new project (fast-track/legacy only).
   */
  async create(
    body: Partial<PortfolioProject>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProject);

    if (!tenantId) throw new BadRequestException('Tenant context is required');

    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    // Origin must be fast_track or legacy for direct creation
    const origin = this.normalizeOrigin(body.origin);
    if (origin === 'standard') {
      throw new BadRequestException(
        'Standard projects must be created via Request conversion. Use origin: fast_track or legacy.'
      );
    }
    const purposeContent = this.normalizeNullable(body.purpose);

    const entity = repo.create({
      tenant_id: tenantId,
      name,
      source_id: body.source_id || null,
      category_id: body.category_id || null,
      stream_id: body.stream_id || null,
      company_id: body.company_id || null,
      department_id: body.department_id || null,
      origin,
      status: 'waiting_list' as ProjectStatus,
      scheduling_mode: body.scheduling_mode || 'independent',
      priority_score: body.priority_score ?? null,
      execution_progress: 0,
      planned_start: body.planned_start || null,
      planned_end: body.planned_end || null,
      estimated_effort_it: body.estimated_effort_it ?? null,
      estimated_effort_business: body.estimated_effort_business ?? null,
      business_sponsor_id: body.business_sponsor_id || null,
      business_lead_id: body.business_lead_id || null,
      it_sponsor_id: body.it_sponsor_id || null,
      it_lead_id: body.it_lead_id || null,
    });

    entity.item_number = await this.itemNumberService.nextItemNumber('project', tenantId, mg);
    const saved = await repo.save(entity);

    await this.integratedDocuments.provisionForProject(
      {
        id: saved.id,
        tenant_id: saved.tenant_id,
        item_number: saved.item_number,
        name: saved.name,
      },
      {
        purpose: purposeContent,
      },
      userId,
      { manager: mg },
    );

    await this.audit.log({
      table: 'portfolio_projects',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  /**
   * Convert a request to a project.
   */
  async convertFromRequest(
    requestId: string,
    overrides: Partial<PortfolioProject>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const projectRepo = mg.getRepository(PortfolioProject);
    const requestRepo = mg.getRepository(PortfolioRequest);
    const linkRepo = mg.getRepository(PortfolioRequestProject);

    const request = await requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    if (request.status !== 'approved' && request.status !== 'converted') {
      throw new BadRequestException(
        `Cannot convert request with status '${request.status}'. Request must be Approved.`
      );
    }

    // Calculate effort from Time estimation criteria values
    const effortFromCriteria = await this.criteriaService.calculateEffortFromCriteria(
      request.criteria_values || {},
      tenantId,
      { manager: mg }
    );

    const project = projectRepo.create({
      tenant_id: tenantId,
      name: overrides.name || request.name,
      source_id: overrides.source_id ?? request.source_id,
      category_id: overrides.category_id ?? request.category_id,
      stream_id: overrides.stream_id ?? request.stream_id,
      company_id: request.company_id,
      department_id: overrides.department_id ?? request.department_id,
      origin: 'standard' as ProjectOrigin,
      status: 'waiting_list' as ProjectStatus,
      scheduling_mode: overrides.scheduling_mode ?? 'independent',
      priority_score: request.priority_override
        ? request.override_value
        : request.priority_score,
      criteria_values: request.criteria_values || {},
      priority_override: request.priority_override,
      override_value: request.override_value,
      override_justification: request.override_justification,
      execution_progress: 0,
      planned_start: overrides.planned_start || null,
      planned_end: overrides.planned_end || null,
      estimated_effort_it: overrides.estimated_effort_it ?? effortFromCriteria.estimated_effort_it,
      estimated_effort_business: overrides.estimated_effort_business ?? effortFromCriteria.estimated_effort_business,
      business_sponsor_id: overrides.business_sponsor_id ?? request.business_sponsor_id,
      business_lead_id: overrides.business_lead_id ?? request.business_lead_id,
      it_sponsor_id: overrides.it_sponsor_id ?? request.it_sponsor_id,
      it_lead_id: overrides.it_lead_id ?? request.it_lead_id,
    });

    project.item_number = await this.itemNumberService.nextItemNumber('project', tenantId, mg);
    const savedProject = await projectRepo.save(project);

    // Create bidirectional link
    await linkRepo.save(linkRepo.create({
      tenant_id: tenantId,
      request_id: requestId,
      project_id: savedProject.id,
    }));

    // Update request status to 'converted' if not already
    if (request.status === 'approved') {
      const requestBefore = { ...request };
      request.status = 'converted';
      request.converted_date = new Date();
      request.updated_at = new Date();
      await requestRepo.save(request);
      await this.audit.log({
        table: 'portfolio_requests',
        recordId: request.id,
        action: 'update',
        before: requestBefore,
        after: request,
        userId,
      }, { manager: mg });

      await this.logActivity(mg, {
        request_id: requestId,
        tenant_id: tenantId,
        author_id: userId,
        type: 'change',
        changed_fields: { status: ['approved', 'converted'] },
      });
    }

    await this.integratedDocuments.createProjectPurposeFromRequest(
      {
        id: request.id,
        tenant_id: request.tenant_id,
        item_number: request.item_number,
        name: request.name,
      },
      {
        id: savedProject.id,
        tenant_id: savedProject.tenant_id,
        item_number: savedProject.item_number,
        name: savedProject.name,
      },
      userId,
      { manager: mg },
    );

    // Copy related data from request to project
    await this.copyTeamFromRequest(requestId, savedProject.id, tenantId, mg);
    await this.copyContactsFromRequest(requestId, savedProject.id, tenantId, mg);
    await this.copyCapexFromRequest(requestId, savedProject.id, tenantId, mg);
    await this.copyOpexFromRequest(requestId, savedProject.id, tenantId, mg);
    await this.copyDependenciesFromRequest(requestId, savedProject.id, tenantId, mg);

    // The new project starts with a single history entry: where it came from.
    await this.logActivity(mg, {
      project_id: savedProject.id,
      tenant_id: tenantId,
      author_id: userId,
      type: 'change',
      changed_fields: {
        created_from_request: [null, formatItemLabel('REQ', request.item_number, request.name)],
      },
    });

    await this.audit.log({
      table: 'portfolio_projects',
      recordId: savedProject.id,
      action: 'create',
      before: null,
      after: savedProject,
      userId,
    }, { manager: mg });

    return savedProject;
  }

  /**
   * Update an existing project.
   */
  async update(
    id: string,
    body: Partial<PortfolioProject> & {
      is_decision?: boolean;
      decision_outcome?: string;
      decision_context?: string;
      decision_rationale?: string;
    },
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProject);

    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Project not found');

    const before = { ...existing };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const nextPurpose = has('purpose') ? this.normalizeNullable(body.purpose) : undefined;

    // Status transition handling
    if (has('status')) {
      const newStatus = this.normalizeStatus(body.status);
      if (newStatus !== existing.status) {
        this.validateStatusTransition(existing.status, newStatus);
      }

      // Transition to 'in_progress' - capture baseline
      if (newStatus === 'in_progress' && existing.status !== 'in_progress') {
        this.validateInProgressRequirements(existing, body);

        // Normalize null business effort to 0
        if (existing.estimated_effort_business == null) {
          existing.estimated_effort_business = 0;
        }

        existing.baseline_start_date = existing.planned_start;
        existing.baseline_end_date = existing.planned_end;
        existing.baseline_effort_it = existing.estimated_effort_it;
        existing.baseline_effort_business = existing.estimated_effort_business;
        existing.actual_start = new Date();
      }

      // Set actual end date when transitioning to 'done'
      if (newStatus === 'done' && existing.status !== 'done') {
        existing.actual_end = new Date();
      }

      existing.status = newStatus;
    }

    // Overview fields
    if (has('name')) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      existing.name = name;
    }
    if (has('source_id')) existing.source_id = body.source_id || null;
    if (has('category_id')) {
      existing.category_id = body.category_id || null;
      if (existing.stream_id && body.category_id !== existing.category_id) {
        existing.stream_id = null;
      }
    }
    if (has('stream_id')) existing.stream_id = body.stream_id || null;
    if (has('company_id')) existing.company_id = body.company_id || null;
    if (has('department_id')) existing.department_id = body.department_id || null;
    if (has('scheduling_mode')) existing.scheduling_mode = body.scheduling_mode || 'independent';
    if (has('priority_score')) existing.priority_score = body.priority_score ?? null;
    if (has('execution_progress')) {
      const progress = Number(body.execution_progress);
      if (isNaN(progress) || progress < 0 || progress > 100) {
        throw new BadRequestException('execution_progress must be between 0 and 100');
      }
      existing.execution_progress = progress;
    }

    // Timeline fields
    if (has('planned_start')) existing.planned_start = body.planned_start || null;
    if (has('planned_end')) existing.planned_end = body.planned_end || null;

    // Effort fields
    if (has('estimated_effort_it')) existing.estimated_effort_it = body.estimated_effort_it ?? null;
    if (has('estimated_effort_business')) existing.estimated_effort_business = body.estimated_effort_business ?? null;
    if (has('actual_effort_it')) existing.actual_effort_it = body.actual_effort_it ?? null;
    if (has('actual_effort_business')) existing.actual_effort_business = body.actual_effort_business ?? null;

    // Team
    if (has('business_sponsor_id')) existing.business_sponsor_id = body.business_sponsor_id || null;
    if (has('business_lead_id')) existing.business_lead_id = body.business_lead_id || null;
    if (has('it_sponsor_id')) existing.it_sponsor_id = body.it_sponsor_id || null;
    if (has('it_lead_id')) existing.it_lead_id = body.it_lead_id || null;

    existing.updated_at = new Date();

    const saved = await repo.save(existing);
    const sourceDescriptor = {
      id: saved.id,
      tenant_id: saved.tenant_id,
      item_number: saved.item_number,
      name: saved.name,
    };

    if (has('purpose')) {
      await this.integratedDocuments.writeSourceSlotContent(
        'projects',
        sourceDescriptor,
        'purpose',
        nextPurpose,
        userId,
        { manager: mg, logSourceActivity: true },
      );
    }
    if (before.name !== saved.name) {
      await this.integratedDocuments.syncTitles('projects', sourceDescriptor, userId, { manager: mg });
    }

    // Log status change as activity (optionally as decision)
    if (has('status') && before.status !== saved.status) {
      const isDecision = body.is_decision === true;
      await this.logActivity(mg, {
        project_id: id,
        tenant_id: tenantId,
        author_id: userId,
        type: isDecision ? 'decision' : 'change',
        content: isDecision
          ? normalizeMarkdownRichText(body.decision_rationale, { fieldName: 'decision_rationale' })
          : null,
        context: isDecision ? (body.decision_context || null) : null,
        decision_outcome: isDecision ? (body.decision_outcome as any || null) : null,
        changed_fields: { status: [before.status, saved.status] },
      });

      // Notify status change (fire-and-forget)
      const recipients = await this.notifications.getProjectRecipients(id, mg);
      this.notifications.notifyStatusChange({
        itemType: 'project',
        itemId: id,
        itemName: saved.name,
        oldStatus: before.status,
        newStatus: saved.status,
        recipients,
        tenantId,
        excludeUserId: userId ?? undefined,
        manager: mg,
      });
    }

    // Notify when lead/sponsor roles are assigned to new users
    const roleChanges: Array<{ field: string; oldId: string | null; newId: string | null; role: string }> = [
      { field: 'business_sponsor_id', oldId: before.business_sponsor_id, newId: saved.business_sponsor_id, role: 'Business Sponsor' },
      { field: 'business_lead_id', oldId: before.business_lead_id, newId: saved.business_lead_id, role: 'Business Lead' },
      { field: 'it_sponsor_id', oldId: before.it_sponsor_id, newId: saved.it_sponsor_id, role: 'IT Sponsor' },
      { field: 'it_lead_id', oldId: before.it_lead_id, newId: saved.it_lead_id, role: 'IT Lead' },
    ];
    for (const change of roleChanges) {
      // Only notify if a NEW user is assigned (not when clearing or same user)
      // Exclude users with system roles (e.g., Contact) who cannot log in
      if (change.newId && change.newId !== change.oldId) {
        const user = await mg.query(
          `SELECT u.id, u.email, u.first_name, u.last_name, u.locale FROM users u
           JOIN roles ro ON ro.id = u.role_id
           WHERE u.id = $1 AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [change.newId],
        );
        if (user.length > 0) {
          // Notify the added user
          this.notifications.notifyTeamAdded({
            itemType: 'project',
            itemId: id,
            itemName: saved.name,
            role: change.role,
            addedUser: { userId: user[0].id, email: user[0].email, locale: user[0].locale },
            tenantId,
          });
          // Notify IT Lead about the team change
          const addedUserName = [user[0].first_name, user[0].last_name].filter(Boolean).join(' ') || 'Unknown';
          this.notifications.notifyItLeadOfTeamChange({
            itemType: 'project',
            itemId: id,
            itemName: saved.name,
            addedUserName,
            role: change.role,
            itLeadId: saved.it_lead_id,
            actorId: userId,
            addedUserId: user[0].id,
            tenantId,
          });
        }
      }
    }

    const changes = detectChanges(
      before as unknown as Record<string, unknown>,
      saved as unknown as Record<string, unknown>,
      PROJECT_TRACKED_FIELDS,
    );
    if (changes.length > 0) {
      const changedFields = await resolveDisplayNames(changes, PROJECT_TRACKED_FIELDS, mg);
      await this.logActivity(mg, {
        project_id: id,
        tenant_id: tenantId,
        author_id: userId,
        type: 'change',
        changed_fields: changedFields,
      });
    }

    await this.audit.log({
      table: 'portfolio_projects',
      recordId: id,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  /**
   * Bulk replace team members for a role.
   */
  async bulkReplaceTeam(
    projectId: string,
    role: TeamRole,
    userIds: string[],
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectTeam);
    const actorId = this.requireActivityAuthor(opts?.userId);

    const unique = Array.from(new Set((userIds || []).filter(Boolean)));
    const existing = await repo.find({ where: { project_id: projectId, role } });
    const beforeIds = Array.from(new Set(existing.map((e) => e.user_id)));

    const toDelete = existing.filter((e) => !unique.includes(e.user_id));
    const existingSet = new Set(existing.map((e) => e.user_id));

    const project = await this.ensureProject(projectId, mg);

    const newUserIds = unique.filter((id) => !existingSet.has(id));
    const toInsert = newUserIds.map((id) => repo.create({
      tenant_id: project.tenant_id,
      project_id: projectId,
      user_id: id,
      role,
    }));

    if (toDelete.length > 0) await repo.remove(toDelete);
    if (toInsert.length > 0) await repo.save(toInsert);

    // Notify newly added team members (fire-and-forget)
    // Exclude users with system roles (e.g., Contact) who cannot log in
    if (newUserIds.length > 0) {
      const users = await mg.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.locale FROM users u
         JOIN roles ro ON ro.id = u.role_id
         WHERE u.id = ANY($1) AND u.status = 'enabled'
           AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
        [newUserIds]
      );
      for (const user of users) {
        // Notify the added user
        this.notifications.notifyTeamAdded({
          itemType: 'project',
          itemId: projectId,
          itemName: project.name,
          role,
          addedUser: { userId: user.id, email: user.email, locale: user.locale },
          tenantId: project.tenant_id,
          manager: mg,
        });
        // Notify IT Lead about the team change
        const addedUserName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
        this.notifications.notifyItLeadOfTeamChange({
          itemType: 'project',
          itemId: projectId,
          itemName: project.name,
          addedUserName,
          role,
          itLeadId: project.it_lead_id,
          actorId,
          addedUserId: user.id,
          tenantId: project.tenant_id,
        });
      }
    }

    const afterIds = Array.from(new Set(unique));
    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...afterIds].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeNames, afterNames] = await Promise.all([
        this.resolveUserNamesByIds(mg, beforeSorted),
        this.resolveUserNamesByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        project_id: projectId,
        tenant_id: project.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { [role]: [beforeNames, afterNames] },
      });
    }

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  /**
   * Bulk replace external contacts.
   */
  async bulkReplaceContacts(
    projectId: string,
    contactIds: string[],
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectContact);

    const unique = Array.from(new Set((contactIds || []).filter(Boolean)));
    const existing = await repo.find({ where: { project_id: projectId } });

    const toDelete = existing.filter((e) => !unique.includes(e.contact_id));
    const existingSet = new Set(existing.map((e) => e.contact_id));

    const project = await this.ensureProject(projectId, mg);

    const toInsert = unique
      .filter((id) => !existingSet.has(id))
      .map((id) => repo.create({
        tenant_id: project.tenant_id,
        project_id: projectId,
        contact_id: id,
      }));

    if (toDelete.length > 0) await repo.remove(toDelete);
    if (toInsert.length > 0) await repo.save(toInsert);

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  /**
   * Bulk replace CAPEX items.
   */
  async bulkReplaceCapex(
    projectId: string,
    capexIds: string[],
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectCapex);
    const actorId = this.requireActivityAuthor(opts?.userId);

    const unique = Array.from(new Set((capexIds || []).filter(Boolean)));
    const project = await this.ensureProject(projectId, mg);
    // Two saves of the project's lines take turns (the last one wins) and the set is read
    // under the lock; a link the line side stored meanwhile is kept, never a unique
    // violation. See project-budget-links.util.ts.
    if (!(await lockProject(mg, project.tenant_id, projectId))) throw new NotFoundException('Project not found');
    const existing = await repo.find({ where: { project_id: projectId } });
    const beforeIds = Array.from(new Set(existing.map((e) => e.capex_id)));

    const toDelete = existing.filter((e) => !unique.includes(e.capex_id));
    const existingSet = new Set(existing.map((e) => e.capex_id));
    const toInsert = unique.filter((id) => !existingSet.has(id));

    if (toDelete.length > 0) await repo.remove(toDelete);
    await insertProjectBudgetLinks(mg, 'capex', project.tenant_id, toInsert.map((itemId) => ({ projectId, itemId })));

    const afterIds = Array.from(new Set(unique));
    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...afterIds].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveCapexLabelsByIds(mg, beforeSorted),
        this.resolveCapexLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        project_id: projectId,
        tenant_id: project.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { capex_items: [beforeLabels, afterLabels] },
      });
    }

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  /**
   * Bulk replace OPEX items.
   */
  async bulkReplaceOpex(
    projectId: string,
    opexIds: string[],
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProjectOpex);
    const actorId = this.requireActivityAuthor(opts?.userId);

    // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
    const unique = Array.from(new Set((opexIds || []).filter(Boolean).map((id) => String(id).toLowerCase())));
    const project = await this.ensureProject(projectId, mg);
    // Two saves of the project's lines take turns (the last one wins) and the set is read
    // under the lock; a link the line side stored meanwhile is kept, never a unique
    // violation. See project-budget-links.util.ts.
    if (!(await lockProject(mg, project.tenant_id, projectId))) throw new NotFoundException('Project not found');
    // The project's links to OPEX lines only (`spend/budget-nature.ts`): a link to a line of another
    // nature is neither replaced nor removed. Every id given names an OPEX line of the tenant, or
    // the request is refused before anything is written.
    const stored = await repo.find({ where: { project_id: projectId } });
    const opexLines = await budgetLineIdsOfKind(mg, 'opex', project.tenant_id, [...stored.map((e) => e.opex_id), ...unique]);
    if (unique.some((id) => !opexLines.has(id))) throw new BadRequestException(OPEX_ITEMS_NOT_FOUND);
    const existing = stored.filter((e) => opexLines.has(e.opex_id));
    const beforeIds = Array.from(new Set(existing.map((e) => e.opex_id)));

    const toDelete = existing.filter((e) => !unique.includes(e.opex_id));
    const existingSet = new Set(existing.map((e) => e.opex_id));
    const toInsert = unique.filter((id) => !existingSet.has(id));

    if (toDelete.length > 0) await repo.remove(toDelete);
    await insertProjectBudgetLinks(mg, 'opex', project.tenant_id, toInsert.map((itemId) => ({ projectId, itemId })));

    const afterIds = Array.from(new Set(unique));
    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...afterIds].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveOpexLabelsByIds(mg, beforeSorted),
        this.resolveOpexLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        project_id: projectId,
        tenant_id: project.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { opex_items: [beforeLabels, afterLabels] },
      });
    }

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // ==================== EFFORT ALLOCATIONS ====================

  /**
   * Get effort allocations for a project.
   * In auto mode: computes allocations based on business rules.
   * In manual mode: returns stored allocations with orphan detection.
   */
  async getEffortAllocations(
    projectId: string,
    effortType: 'it' | 'business',
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const project = await this.ensureProject(projectId, mg);

    const mode = effortType === 'it'
      ? project.it_effort_allocation_mode
      : project.business_effort_allocation_mode;

    const estimatedEffort = effortType === 'it'
      ? project.estimated_effort_it
      : project.estimated_effort_business;

    // Get eligible users: lead + team members (deduplicated)
    const leadId = effortType === 'it' ? project.it_lead_id : project.business_lead_id;
    const teamRole = effortType === 'it' ? 'it_team' : 'business_team';

    const teamMembers = await mg.query(
      `SELECT pt.user_id, u.email, u.first_name, u.last_name
       FROM portfolio_project_team pt
       JOIN users u ON u.id = pt.user_id
       WHERE pt.project_id = $1 AND pt.role = $2`,
      [projectId, teamRole]
    );

    // Build eligible users map (lead + team, deduplicated)
    const eligibleUsers = new Map<string, { id: string; email: string; first_name: string; last_name: string }>();
    let leadUser: { id: string; email: string; first_name: string; last_name: string } | null = null;

    // Add lead if it exists and is a valid user
    if (leadId) {
      const leadData = await mg.query(
        `SELECT id, email, first_name, last_name FROM users WHERE id = $1`,
        [leadId]
      );
      if (leadData.length > 0) {
        leadUser = {
          id: leadData[0].id,
          email: leadData[0].email,
          first_name: leadData[0].first_name,
          last_name: leadData[0].last_name,
        };
        eligibleUsers.set(leadId, leadUser);
      }
    }

    // Add team members
    const teamContributors: Array<{ id: string; email: string; first_name: string; last_name: string }> = [];
    for (const member of teamMembers) {
      if (!eligibleUsers.has(member.user_id)) {
        eligibleUsers.set(member.user_id, {
          id: member.user_id,
          email: member.email,
          first_name: member.first_name,
          last_name: member.last_name,
        });
      }
      teamContributors.push({
        id: member.user_id,
        email: member.email,
        first_name: member.first_name,
        last_name: member.last_name,
      });
    }

    if (mode === 'auto') {
      const autoAllocations = computeAutoAllocations(
        leadUser,
        teamContributors,
      );
      const allocations = autoAllocations.map((allocation) => {
        const user = eligibleUsers.get(allocation.user_id) ?? {
          id: allocation.user_id,
          email: '',
          first_name: '',
          last_name: '',
        };
        return {
          user_id: allocation.user_id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          allocation_pct: allocation.allocation_pct,
          is_lead: allocation.user_id === leadId,
        };
      });
      return {
        mode: 'auto',
        allocations,
        total_pct: allocations.reduce((sum, a) => sum + a.allocation_pct, 0),
        estimated_effort: estimatedEffort ?? 0,
      };
    }

    // Manual mode - get stored allocations
    const storedAllocations = await mg.query(
      `SELECT ea.user_id, ea.allocation_pct, u.email, u.first_name, u.last_name
       FROM portfolio_project_effort_allocations ea
       JOIN users u ON u.id = ea.user_id
       WHERE ea.project_id = $1 AND ea.effort_type = $2`,
      [projectId, effortType]
    );

    // Mark orphaned users (in stored but no longer eligible)
    const allocations = storedAllocations.map((a: any) => ({
      user_id: a.user_id,
      email: a.email,
      first_name: a.first_name,
      last_name: a.last_name,
      allocation_pct: a.allocation_pct,
      is_lead: a.user_id === leadId,
      is_orphaned: !eligibleUsers.has(a.user_id),
    }));

    return {
      mode: 'manual',
      allocations,
      total_pct: allocations.reduce((sum: number, a: any) => sum + a.allocation_pct, 0),
      estimated_effort: estimatedEffort ?? 0,
    };
  }

  /**
   * Set manual effort allocations for a project.
   * Validates: sum = 100%, all integers, users are valid (lead OR team member).
   */
  async setEffortAllocations(
    projectId: string,
    effortType: 'it' | 'business',
    allocations: Array<{ user_id: string; allocation_pct: number }>,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const project = await this.ensureProject(projectId, mg);

    // Validate sum = 100%
    const total = allocations.reduce((sum, a) => sum + a.allocation_pct, 0);
    if (total !== 100) {
      throw new BadRequestException(`Allocations must sum to 100%, got ${total}%`);
    }

    // Validate all are integers between 0-100
    for (const alloc of allocations) {
      if (!Number.isInteger(alloc.allocation_pct) || alloc.allocation_pct < 0 || alloc.allocation_pct > 100) {
        throw new BadRequestException('All allocation percentages must be integers between 0 and 100');
      }
    }

    // Get eligible users
    const leadId = effortType === 'it' ? project.it_lead_id : project.business_lead_id;
    const teamRole = effortType === 'it' ? 'it_team' : 'business_team';

    const teamMembers = await mg.query(
      `SELECT user_id FROM portfolio_project_team WHERE project_id = $1 AND role = $2`,
      [projectId, teamRole]
    );

    const eligibleUserIds = new Set<string>();
    if (leadId) eligibleUserIds.add(leadId);
    for (const m of teamMembers) eligibleUserIds.add(m.user_id);

    // Validate all users are eligible
    for (const alloc of allocations) {
      if (!eligibleUserIds.has(alloc.user_id)) {
        throw new BadRequestException(`User ${alloc.user_id} is not eligible (must be lead or team member)`);
      }
    }

    // Delete existing allocations
    await mg.query(
      `DELETE FROM portfolio_project_effort_allocations WHERE project_id = $1 AND effort_type = $2`,
      [projectId, effortType]
    );

    // Insert new allocations
    for (const alloc of allocations) {
      await mg.query(
        `INSERT INTO portfolio_project_effort_allocations (tenant_id, project_id, user_id, effort_type, allocation_pct)
         VALUES (app_current_tenant(), $1, $2, $3, $4)`,
        [projectId, alloc.user_id, effortType, alloc.allocation_pct]
      );
    }

    // Set mode to manual
    const modeColumn = effortType === 'it' ? 'it_effort_allocation_mode' : 'business_effort_allocation_mode';
    await mg.query(
      `UPDATE portfolio_projects SET ${modeColumn} = 'manual', updated_at = now() WHERE id = $1`,
      [projectId]
    );

    return { ok: true };
  }

  /**
   * Reset effort allocations to auto mode.
   */
  async resetEffortAllocations(
    projectId: string,
    effortType: 'it' | 'business',
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    await this.ensureProject(projectId, mg);

    // Delete stored allocations
    await mg.query(
      `DELETE FROM portfolio_project_effort_allocations WHERE project_id = $1 AND effort_type = $2`,
      [projectId, effortType]
    );

    // Set mode back to auto
    const modeColumn = effortType === 'it' ? 'it_effort_allocation_mode' : 'business_effort_allocation_mode';
    await mg.query(
      `UPDATE portfolio_projects SET ${modeColumn} = 'auto', updated_at = now() WHERE id = $1`,
      [projectId]
    );

    return { ok: true };
  }

  // ==================== HELPER METHODS ====================

  private async copyTeamFromRequest(
    requestId: string,
    projectId: string,
    tenantId: string,
    mg: EntityManager,
  ) {
    const requestTeam = await mg.query(
      `SELECT user_id, role FROM portfolio_request_team WHERE request_id = $1`,
      [requestId]
    );

    const projectTeamRepo = mg.getRepository(PortfolioProjectTeam);
    for (const member of requestTeam) {
      await projectTeamRepo.save(projectTeamRepo.create({
        tenant_id: tenantId,
        project_id: projectId,
        user_id: member.user_id,
        role: member.role,
      }));
    }
  }

  private async copyContactsFromRequest(
    requestId: string,
    projectId: string,
    tenantId: string,
    mg: EntityManager,
  ) {
    const contacts = await mg.query(
      `SELECT contact_id FROM portfolio_request_contacts WHERE request_id = $1`,
      [requestId]
    );

    const projectContactRepo = mg.getRepository(PortfolioProjectContact);
    for (const c of contacts) {
      await projectContactRepo.save(projectContactRepo.create({
        tenant_id: tenantId,
        project_id: projectId,
        contact_id: c.contact_id,
      }));
    }
  }

  private async copyCapexFromRequest(
    requestId: string,
    projectId: string,
    tenantId: string,
    mg: EntityManager,
  ) {
    const capexItems = await mg.query(
      `SELECT capex_id FROM portfolio_request_capex WHERE request_id = $1`,
      [requestId]
    );

    const projectCapexRepo = mg.getRepository(PortfolioProjectCapex);
    for (const item of capexItems) {
      await projectCapexRepo.save(projectCapexRepo.create({
        tenant_id: tenantId,
        project_id: projectId,
        capex_id: item.capex_id,
      }));
    }
  }

  private async copyOpexFromRequest(
    requestId: string,
    projectId: string,
    tenantId: string,
    mg: EntityManager,
  ) {
    // The request's links to OPEX lines only (`spend/budget-nature.ts`).
    const opexItems = await mg.query(
      `SELECT ro.opex_id FROM portfolio_request_opex ro
        WHERE ro.request_id = $1
          AND EXISTS (SELECT 1 FROM spend_items s WHERE s.tenant_id = ro.tenant_id AND s.id = ro.opex_id AND s.nature = 'opex')`,
      [requestId]
    );

    const projectOpexRepo = mg.getRepository(PortfolioProjectOpex);
    for (const item of opexItems) {
      await projectOpexRepo.save(projectOpexRepo.create({
        tenant_id: tenantId,
        project_id: projectId,
        opex_id: item.opex_id,
      }));
    }
  }

  private async copyDependenciesFromRequest(
    requestId: string,
    projectId: string,
    tenantId: string,
    mg: EntityManager,
  ) {
    const deps = await mg.query(
      `SELECT depends_on_request_id, depends_on_project_id, dependency_type, notes
       FROM portfolio_request_dependencies WHERE request_id = $1`,
      [requestId]
    );

    const projectDepRepo = mg.getRepository(PortfolioProjectDependency);

    for (const dep of deps) {
      let targetProjectId: string | null = null;

      if (dep.depends_on_project_id) {
        targetProjectId = dep.depends_on_project_id;
      } else if (dep.depends_on_request_id) {
        const converted = await mg.query(
          `SELECT project_id FROM portfolio_request_projects WHERE request_id = $1 LIMIT 1`,
          [dep.depends_on_request_id]
        );
        if (converted.length > 0) {
          targetProjectId = converted[0].project_id;
        }
      }

      if (targetProjectId) {
        const existing = await projectDepRepo.findOne({
          where: { project_id: projectId, depends_on_project_id: targetProjectId },
        });

        if (!existing) {
          await projectDepRepo.save(projectDepRepo.create({
            tenant_id: tenantId,
            project_id: projectId,
            depends_on_project_id: targetProjectId,
            dependency_type: dep.dependency_type || 'blocks',
            notes: dep.notes || null,
          }));
        }
      }
    }
  }

  async shareProject(
    projectId: string,
    dto: ShareItemDto,
    tenantId: string,
    userId: string,
    opts?: ServiceOpts,
  ) {
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }

    const mg = this.getManager(opts);

    const project = await mg.findOne(PortfolioProject, {
      where: { id: projectId },
      select: ['id', 'name'],
    });
    if (!project) throw new NotFoundException('Project not found');

    const senderRows = await mg.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [userId],
    );
    const senderName = senderRows.length > 0
      ? `${senderRows[0].first_name} ${senderRows[0].last_name}`.trim() || 'Someone'
      : 'Someone';

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
        itemType: 'project',
        itemId: projectId,
        itemName: project.name,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
      });
    }

    return { success: true };
  }
}
