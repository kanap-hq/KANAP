import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interface-middleware-application.entity';
import { InterfaceOwner } from '../interface-owner.entity';
import { InterfaceCompany } from '../interface-company.entity';
import { InterfaceDependency } from '../interface-dependency.entity';
import { InterfaceKeyIdentifier } from '../interface-key-identifier.entity';
import { InterfaceLink } from '../interface-link.entity';
import { InterfaceAttachment } from '../interface-attachment.entity';
import { InterfaceDataResidency } from '../interface-data-residency.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { InterfaceConnectionLink } from '../../interface-connection-links/interface-connection-link.entity';
import { Application } from '../../applications/application.entity';
import { AuditService } from '../../audit/audit.service';
import { withSavepoint } from '../../common/savepoint.util';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { InterfaceMappingsService } from './interface-mappings.service';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  InterfacesBaseService,
  ServiceOpts,
} from './interfaces-base.service';

/**
 * Service for core CRUD operations on interfaces.
 */
@Injectable()
export class InterfacesCrudService extends InterfacesBaseService {
  constructor(
    @InjectRepository(InterfaceEntity) repo: Repository<InterfaceEntity>,
    @InjectRepository(InterfaceLeg) legs: Repository<InterfaceLeg>,
    @InjectRepository(InterfaceMiddlewareApplication) middlewareApps: Repository<InterfaceMiddlewareApplication>,
    @InjectRepository(Application) apps: Repository<Application>,
    @InjectRepository(InterfaceBinding) bindings: Repository<InterfaceBinding>,
    itOpsSettings: ItOpsSettingsService,
    private readonly audit: AuditService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly interfaceMappings: InterfaceMappingsService,
    private readonly notifications: NotificationsService,
  ) {
    super(repo, legs, middlewareApps, apps, bindings, itOpsSettings);
  }

  private buildSourceDescriptor(entity: InterfaceEntity) {
    return {
      id: entity.id,
      tenant_id: entity.tenant_id,
      item_number: null,
      name: entity.name,
      reference_label: entity.interface_reference || entity.interface_id || entity.id,
    };
  }

  /**
   * Get a single interface by ID with optional relations.
   */
  async get(id: string, query: any, opts?: ServiceOpts) {
    const repo = this.getRepo(opts?.manager);
    const mg = opts?.manager ?? repo.manager;
    const interfaceDbId = await this.resolveInterfaceIdentifier(id, mg);
    const include = this.parseInclude(query?.include);
    const qb = repo.createQueryBuilder('i');
    qb.leftJoin('applications', 'sa', 'sa.id = i.source_application_id');
    qb.leftJoin('applications', 'ta', 'ta.id = i.target_application_id');
    qb.leftJoin('business_processes', 'bp', 'bp.id = i.business_process_id');
    qb.addSelect('sa.name', 'source_name');
    qb.addSelect('ta.name', 'target_name');
    qb.addSelect('bp.name', 'business_process_name');
    qb.where('i.id = :id', { id: interfaceDbId });
    const { raw, entities } = await qb.getRawAndEntities();
    const entity = entities[0];
    if (!entity) throw new NotFoundException('Interface not found');
    const data: any = { ...entity };
    const r = (raw[0] || {}) as any;
    data.source_application_name = r.source_name || null;
    data.target_application_name = r.target_name || null;
    data.business_process_name = r.business_process_name || null;

    const includeRelations = include.has('relations');

    if (include.has('legs')) {
      const legRepo = this.getLegRepo(mg);
      data.legs = await legRepo.find({
        where: { interface_id: interfaceDbId } as any,
        order: { order_index: 'ASC' as any, created_at: 'ASC' as any },
      });
    }

    if (includeRelations || include.has('owners')) {
      const repoOwner = mg.getRepository(InterfaceOwner);
      data.owners = await repoOwner.find({ where: { interface_id: interfaceDbId } as any });
    }
    if (includeRelations || include.has('companies')) {
      const repoCompany = mg.getRepository(InterfaceCompany);
      data.companies = await repoCompany.find({ where: { interface_id: interfaceDbId } as any });
    }
    if (includeRelations || include.has('dependencies')) {
      const repoDep = mg.getRepository(InterfaceDependency);
      data.dependencies = await repoDep.find({ where: { interface_id: interfaceDbId } as any });
    }
    if (includeRelations || include.has('key_identifiers')) {
      const repoKey = mg.getRepository(InterfaceKeyIdentifier);
      data.key_identifiers = await repoKey.find({
        where: { interface_id: interfaceDbId } as any,
        order: { created_at: 'ASC' as any },
      });
    }
    if (includeRelations || include.has('data_residency')) {
      const repoResidency = mg.getRepository(InterfaceDataResidency);
      data.data_residency = await repoResidency.find({ where: { interface_id: interfaceDbId } as any });
    }
    if (includeRelations || include.has('links')) {
      const repoLink = mg.getRepository(InterfaceLink);
      data.links = await repoLink.find({
        where: { interface_id: interfaceDbId } as any,
        order: { created_at: 'DESC' as any },
      });
    }
    if (includeRelations || include.has('attachments')) {
      const repoAttachment = mg.getRepository(InterfaceAttachment);
      data.attachments = await repoAttachment.find({
        where: { interface_id: interfaceDbId } as any,
        order: { uploaded_at: 'DESC' as any },
      });
    }

    if (includeRelations || include.has('middleware_applications')) {
      const repoMw = this.getMiddlewareRepo(mg);
      const rows = await repoMw.find({ where: { interface_id: interfaceDbId } as any });
      data.middleware_application_ids = rows.map((row) => row.application_id);
    }

    return data;
  }

  async shareInterface(
    interfaceId: string,
    dto: ShareItemDto,
    tenantId: string,
    userId: string,
    opts?: ServiceOpts,
  ) {
    const tenant = String(tenantId || '').trim();
    if (!tenant) throw new BadRequestException('Tenant context is required');
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }

    const mg = opts?.manager ?? this.repo.manager;
    const id = await this.resolveInterfaceIdentifier(interfaceId, mg);
    const intf = await mg.getRepository(InterfaceEntity).findOne({ where: { id } });
    if (!intf) throw new NotFoundException('Interface not found');

    const senderRows = await mg.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
    const senderName = senderRows.length > 0
      ? `${senderRows[0].first_name || ''} ${senderRows[0].last_name || ''}`.trim() || 'Someone'
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
        itemType: 'interface',
        itemId: intf.id,
        itemName: intf.name,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId: tenant,
        manager: mg,
      });
    }

    return { ok: true };
  }

  /**
   * Create a new interface.
   */
  async create(body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    const repo = this.getRepo(opts?.manager);
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    if (!tenantId) throw new BadRequestException('Tenant context is required');

    const name = this.normalizeRequiredText(body.name, 'name');
    const interfaceId = this.normalizeNullable(body.interface_id);
    const businessPurpose = this.normalizeRequiredText(body.business_purpose, 'business_purpose');

    if (!body.source_application_id) throw new BadRequestException('source_application_id is required');
    if (!body.target_application_id) throw new BadRequestException('target_application_id is required');

    const sourceApp = await this.ensureApplication(body.source_application_id, opts?.manager);
    const targetApp = await this.ensureApplication(body.target_application_id, opts?.manager);

    const lifecycle = await this.normalizeLifecycle(
      body.lifecycle ?? this.computeDefaultLifecycle(sourceApp, targetApp),
      tenantId,
      opts?.manager,
    );
    const inheritedCriticality = await this.computeDefaultCriticality(sourceApp, targetApp, tenantId, opts?.manager);
    const criticality = Object.prototype.hasOwnProperty.call(body, 'criticality')
      ? await this.normalizeCriticality(body.criticality, tenantId, opts?.manager)
      : inheritedCriticality.code;

    const dataCategory = await this.normalizeDataCategory(body.data_category, tenantId, opts?.manager);
    const dataClass = await this.normalizeDataClass(body.data_class ?? null, tenantId, opts?.manager);
    const routeType = this.normalizeRouteType(body.integration_route_type ?? 'direct');

    const entity = repo.create({
      tenant_id: tenantId,
      interface_id: interfaceId,
      name,
      business_process_id: body.business_process_id ? String(body.business_process_id) : null,
      business_purpose: businessPurpose,
      source_application_id: sourceApp.id,
      target_application_id: targetApp.id,
      data_category: dataCategory,
      integration_route_type: routeType,
      lifecycle,
      overview_notes: this.normalizeNullable(body.overview_notes),
      criticality,
      classification_incomplete: Object.prototype.hasOwnProperty.call(body, 'criticality')
        ? false
        : inheritedCriticality.incomplete,
      impact_of_failure: this.normalizeNullable(body.impact_of_failure),
      business_objects: body.business_objects ?? null,
      main_use_cases: this.normalizeNullable(body.main_use_cases),
      functional_rules: this.normalizeNullable(body.functional_rules),
      core_transformations_summary: this.normalizeNullable(body.core_transformations_summary),
      error_handling_summary: this.normalizeNullable(body.error_handling_summary),
      data_class: dataClass,
      contains_pii: this.parseBoolean(body.contains_pii),
      pii_description: this.normalizeNullable(body.pii_description),
      typical_data: this.normalizeNullable(body.typical_data),
      audit_logging: this.normalizeNullable(body.audit_logging),
      security_controls_summary: this.normalizeNullable(body.security_controls_summary),
    });

    const saved = await repo.save(entity);
    await this.syncMiddlewareApplications(saved, body.middleware_application_ids as string[] | undefined, opts?.manager);
    await this.createDefaultLegs(saved, tenantId, opts?.manager);
    await this.interfaceMappings.ensureDefaultSetForInterface(saved.id, saved.tenant_id, userId, {
      manager: opts?.manager,
      audit: false,
    });
    await this.integratedDocuments.provisionForInterface(
      this.buildSourceDescriptor(saved),
      {
        specification: String(body?.specification_markdown || '').trim() || null,
      },
      userId,
      { manager: opts?.manager },
    );

    await this.audit.log(
      { table: 'interfaces', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: opts?.manager },
    );
    return saved;
  }

  /**
   * Update an existing interface.
   */
  async update(id: string, body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    const repo = this.getRepo(opts?.manager);
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const interfaceDbId = await this.resolveInterfaceIdentifier(id, opts?.manager);
    const existing = await repo.findOne({ where: { id: interfaceDbId } });
    if (!existing) throw new NotFoundException('Interface not found');
    const before = { ...existing };
    const has = (key: keyof InterfaceEntity | string) => Object.prototype.hasOwnProperty.call(body, key);
    if (has('name')) {
      existing.name = this.normalizeRequiredText(body.name, 'name');
    }
    if (has('interface_id')) {
      existing.interface_id = this.normalizeNullable(body.interface_id);
    }
    if (has('business_process_id')) {
      existing.business_process_id = body.business_process_id ? String(body.business_process_id) : null;
    }
    if (has('business_purpose')) {
      existing.business_purpose = this.normalizeRequiredText(body.business_purpose, 'business_purpose');
    }
    if (has('source_application_id')) {
      const app = await this.ensureApplication(body.source_application_id, opts?.manager);
      existing.source_application_id = app.id;
    }
    if (has('target_application_id')) {
      const app = await this.ensureApplication(body.target_application_id, opts?.manager);
      existing.target_application_id = app.id;
    }
    if (has('data_category')) {
      existing.data_category = await this.normalizeDataCategory(body.data_category, tenantId, opts?.manager);
    }
    if (has('integration_route_type')) {
      const nextRoute = this.normalizeRouteType(body.integration_route_type);
      if (nextRoute !== existing.integration_route_type) {
        // If route type changes, drop legs (bindings will cascade) and recreate defaults.
        existing.integration_route_type = nextRoute;
        await this.createDefaultLegs(existing, tenantId, opts?.manager);
      }
    }
    if (has('lifecycle')) {
      existing.lifecycle = await this.normalizeLifecycle(
        body.lifecycle,
        existing.tenant_id,
        opts?.manager,
        existing.lifecycle,
      );
    }
    if (has('overview_notes')) existing.overview_notes = this.normalizeNullable(body.overview_notes);
    if (has('criticality')) {
      existing.criticality = await this.normalizeCriticality(
        body.criticality,
        tenantId,
        opts?.manager,
        existing.criticality,
      );
      existing.classification_incomplete = false;
    }
    if (has('impact_of_failure')) existing.impact_of_failure = this.normalizeNullable(body.impact_of_failure);
    if (has('business_objects')) existing.business_objects = body.business_objects ?? null;
    if (has('main_use_cases')) existing.main_use_cases = this.normalizeNullable(body.main_use_cases);
    if (has('functional_rules')) existing.functional_rules = this.normalizeNullable(body.functional_rules);
    if (has('core_transformations_summary')) {
      existing.core_transformations_summary = this.normalizeNullable(body.core_transformations_summary);
    }
    if (has('error_handling_summary')) {
      existing.error_handling_summary = this.normalizeNullable(body.error_handling_summary);
    }
    if (has('data_class')) {
      existing.data_class = await this.normalizeDataClass(body.data_class, tenantId, opts?.manager, existing.data_class);
    }
    if (has('contains_pii')) existing.contains_pii = this.parseBoolean(body.contains_pii);
    if (has('pii_description')) existing.pii_description = this.normalizeNullable(body.pii_description);
    if (has('typical_data')) existing.typical_data = this.normalizeNullable(body.typical_data);
    if (has('audit_logging')) existing.audit_logging = this.normalizeNullable(body.audit_logging);
    if (has('security_controls_summary')) {
      existing.security_controls_summary = this.normalizeNullable(body.security_controls_summary);
    }

    if (Array.isArray(body.middleware_application_ids)) {
      await this.syncMiddlewareApplications(existing, body.middleware_application_ids, opts?.manager);
    }

    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    const titleFieldsChanged = before.name !== saved.name
      || before.interface_reference !== saved.interface_reference
      || before.interface_id !== saved.interface_id;
    if (titleFieldsChanged) {
      await this.integratedDocuments.syncTitles(
        'interfaces',
        this.buildSourceDescriptor(saved),
        userId,
        { manager: opts?.manager },
      );
    }
    await this.audit.log(
      { table: 'interfaces', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: opts?.manager },
    );
    return saved;
  }

  /**
   * Delete an interface.
   */
  async delete(id: string, userId: string | null, opts?: ServiceOpts & { deleteRelatedBindings?: boolean }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const bindingRepo = this.getBindingRepo(mg);
    const connectionLinkRepo = mg.getRepository(InterfaceConnectionLink);
    const interfaceDbId = await this.resolveInterfaceIdentifier(id, mg);
    const existing = await repo.findOne({ where: { id: interfaceDbId } });
    if (!existing) throw new NotFoundException('Interface not found');

    const bindings = await bindingRepo.find({ where: { interface_id: interfaceDbId } as any });

    if (bindings.length > 0) {
      if (!opts?.deleteRelatedBindings) {
        throw new BadRequestException('Cannot delete interface with bindings');
      }
      // Delete connection links first (they reference bindings)
      const bindingIds = bindings.map(b => b.id);
      if (bindingIds.length > 0) {
        await connectionLinkRepo.delete({ interface_binding_id: In(bindingIds) } as any);
      }
      // Delete bindings
      await bindingRepo.delete({ interface_id: interfaceDbId } as any);
    }

    await this.integratedDocuments.deleteForEntity('interfaces', interfaceDbId, userId, { manager: mg });
    await repo.delete({ id: interfaceDbId } as any);
    await this.audit.log(
      { table: 'interfaces', recordId: interfaceDbId, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { deleted: true, bindingsDeleted: bindings.length };
  }

  /**
   * Bulk delete interfaces.
   */
  async bulkDelete(ids: string[], userId: string | null, opts?: ServiceOpts & { deleteRelatedBindings?: boolean }): Promise<{
    deleted: string[];
    failed: Array<{ id: string; name: string; reason: string }>;
  }> {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);

    const result: { deleted: string[]; failed: Array<{ id: string; name: string; reason: string }> } = {
      deleted: [],
      failed: [],
    };

    for (const id of ids || []) {
      try {
        await withSavepoint(mg, () => this.delete(id, userId, { manager: mg, deleteRelatedBindings: opts?.deleteRelatedBindings }));
        result.deleted.push(id);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const row = await withSavepoint(mg, () => repo.findOne({ where: { id } }));
          if (row) name = row.name;
        } catch {}
        result.failed.push({
          id,
          name,
          reason: error?.message || 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Duplicate an interface.
   */
  async duplicate(id: string, tenantId: string, userId: string | null, opts?: ServiceOpts & { copyBindings?: boolean }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const legRepo = this.getLegRepo(mg);
    const bindingRepo = this.getBindingRepo(mg);

    // Fetch the source interface
    const sourceId = await this.resolveInterfaceIdentifier(id, mg);
    const source = await repo.findOne({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('Interface not found');

    // Fetch all related data
    const [
      legs,
      owners,
      companies,
      dependencies,
      keyIdentifiers,
      links,
      dataResidency,
      middlewareApps,
    ] = await Promise.all([
      legRepo.find({ where: { interface_id: sourceId } as any, order: { order_index: 'ASC' as any } }),
      mg.getRepository(InterfaceOwner).find({ where: { interface_id: sourceId } as any }),
      mg.getRepository(InterfaceCompany).find({ where: { interface_id: sourceId } as any }),
      mg.getRepository(InterfaceDependency).find({ where: { interface_id: sourceId } as any }),
      mg.getRepository(InterfaceKeyIdentifier).find({ where: { interface_id: sourceId } as any }),
      mg.getRepository(InterfaceLink).find({ where: { interface_id: sourceId } as any }),
      mg.getRepository(InterfaceDataResidency).find({ where: { interface_id: sourceId } as any }),
      this.getMiddlewareRepo(mg).find({ where: { interface_id: sourceId } as any }),
    ]);

    let newInterfaceId: string | null = null;
    if (source.interface_id) {
      newInterfaceId = `${source.interface_id}-copy`;
      let suffix = 1;
      while (await repo.findOne({ where: { tenant_id: tenantId, interface_id: newInterfaceId } as any })) {
        suffix++;
        newInterfaceId = `${source.interface_id}-copy-${suffix}`;
      }
    }

    // Generate new name
    const newName = `${source.name} - copy`;

    // Create the new interface entity
    const newInterface = repo.create({
      tenant_id: tenantId,
      interface_id: newInterfaceId,
      name: newName,
      business_process_id: source.business_process_id,
      business_purpose: source.business_purpose,
      source_application_id: source.source_application_id,
      target_application_id: source.target_application_id,
      data_category: source.data_category,
      integration_route_type: source.integration_route_type,
      lifecycle: source.lifecycle,
      overview_notes: source.overview_notes,
      criticality: source.criticality,
      classification_incomplete: source.classification_incomplete,
      impact_of_failure: source.impact_of_failure,
      business_objects: source.business_objects,
      main_use_cases: source.main_use_cases,
      functional_rules: source.functional_rules,
      core_transformations_summary: source.core_transformations_summary,
      error_handling_summary: source.error_handling_summary,
      data_class: source.data_class,
      contains_pii: source.contains_pii,
      pii_description: source.pii_description,
      typical_data: source.typical_data,
      audit_logging: source.audit_logging,
      security_controls_summary: source.security_controls_summary,
    });

    const savedInterface = await repo.save(newInterface);

    // Copy legs with their customizations (but new IDs)
    // Build leg mapping for binding copy
    const legMapping = new Map<string, string>();
    if (legs.length > 0) {
      for (const leg of legs) {
        const newLeg = legRepo.create({
          tenant_id: tenantId,
          interface_id: savedInterface.id,
          leg_type: leg.leg_type,
          from_role: leg.from_role,
          to_role: leg.to_role,
          trigger_type: leg.trigger_type,
          integration_pattern: leg.integration_pattern,
          data_format: leg.data_format,
          job_name: leg.job_name,
          order_index: leg.order_index,
        });
        const savedLeg = await legRepo.save(newLeg);
        legMapping.set(leg.id, savedLeg.id);
      }
    }

    await this.interfaceMappings.cloneInterfaceMappings(sourceId, savedInterface.id, tenantId, userId, {
      manager: mg,
      audit: false,
      legMapping,
    });

    // Copy middleware applications
    if (middlewareApps.length > 0) {
      const mwRepo = this.getMiddlewareRepo(mg);
      const newMwApps = middlewareApps.map((mw) =>
        mwRepo.create({
          tenant_id: tenantId,
          interface_id: savedInterface.id,
          application_id: mw.application_id,
        }),
      );
      await mwRepo.save(newMwApps);
    }

    // Copy owners
    if (owners.length > 0) {
      const ownerRepo = mg.getRepository(InterfaceOwner);
      const newOwners = owners.map((o) =>
        ownerRepo.create({
          interface_id: savedInterface.id,
          user_id: o.user_id,
          owner_type: o.owner_type,
        }),
      );
      await ownerRepo.save(newOwners);
    }

    // Copy companies
    if (companies.length > 0) {
      const companyRepo = mg.getRepository(InterfaceCompany);
      const newCompanies = companies.map((c) =>
        companyRepo.create({
          interface_id: savedInterface.id,
          company_id: c.company_id,
        }),
      );
      await companyRepo.save(newCompanies);
    }

    // Copy dependencies
    if (dependencies.length > 0) {
      const depRepo = mg.getRepository(InterfaceDependency);
      const newDeps = dependencies.map((d) =>
        depRepo.create({
          interface_id: savedInterface.id,
          related_interface_id: d.related_interface_id,
          direction: d.direction,
        }),
      );
      await depRepo.save(newDeps);
    }

    // Copy key identifiers
    if (keyIdentifiers.length > 0) {
      const keyRepo = mg.getRepository(InterfaceKeyIdentifier);
      const newKeys = keyIdentifiers.map((k) =>
        keyRepo.create({
          interface_id: savedInterface.id,
          source_identifier: k.source_identifier,
          destination_identifier: k.destination_identifier,
          identifier_notes: k.identifier_notes,
        }),
      );
      await keyRepo.save(newKeys);
    }

    // Copy links
    if (links.length > 0) {
      const linkRepo = mg.getRepository(InterfaceLink);
      const newLinks = links.map((l) =>
        linkRepo.create({
          interface_id: savedInterface.id,
          kind: l.kind,
          description: l.description,
          url: l.url,
        }),
      );
      await linkRepo.save(newLinks);
    }

    // Copy data residency
    if (dataResidency.length > 0) {
      const resRepo = mg.getRepository(InterfaceDataResidency);
      const newResidency = dataResidency.map((r) =>
        resRepo.create({
          interface_id: savedInterface.id,
          country_iso: r.country_iso,
        }),
      );
      await resRepo.save(newResidency);
    }

    // Copy bindings if requested (with cleared environment-specific fields)
    if (opts?.copyBindings && legMapping.size > 0) {
      const originalBindings = await bindingRepo.find({ where: { interface_id: sourceId } as any });
      for (const binding of originalBindings) {
        const newLegId = legMapping.get(binding.interface_leg_id);
        if (!newLegId) continue;

        const newBinding = bindingRepo.create({
          tenant_id: tenantId,
          interface_id: savedInterface.id,
          interface_leg_id: newLegId,
          environment: binding.environment,
          // Keep instance references (same apps, same instances)
          source_instance_id: binding.source_instance_id,
          target_instance_id: binding.target_instance_id,
          integration_tool_application_id: binding.integration_tool_application_id,
          // Reset status to proposed
          status: 'proposed',
          // Clear environment-specific fields (must be configured fresh)
          source_endpoint: null,
          target_endpoint: null,
          trigger_details: null,
          env_job_name: null,
          authentication_mode: null,
          monitoring_url: null,
          env_notes: null,
        });
        await bindingRepo.save(newBinding as any);
      }
    }

    // Audit log
    await this.audit.log(
      { table: 'interfaces', recordId: savedInterface.id, action: 'create', before: null, after: savedInterface, userId },
      { manager: mg },
    );

    return savedInterface;
  }
}
