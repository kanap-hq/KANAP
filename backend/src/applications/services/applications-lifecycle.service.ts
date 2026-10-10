import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { copyClassification } from './application-classification';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Application } from '../application.entity';
import { ApplicationOwner } from '../application-owner.entity';
import { ApplicationCompany } from '../application-company.entity';
import { ApplicationDepartment } from '../application-department.entity';
import { ApplicationDataResidency } from '../application-data-residency.entity';
import { ApplicationLink } from '../application-link.entity';
import { ApplicationSupportContact } from '../application-support-contact.entity';
import { ApplicationSpendItemLink } from '../application-spend-item.entity';
import { ApplicationCapexItemLink } from '../application-capex-item.entity';
import { SpendItem } from '../../spend/spend-item.entity';
import { ApplicationContractLink } from '../application-contract.entity';
import { AppInstance } from '../../app-instances/app-instance.entity';
import { InterfaceEntity } from '../../interfaces/interface.entity';
import { InterfaceMiddlewareApplication } from '../../interfaces/interface-middleware-application.entity';
import { InterfaceLeg } from '../../interfaces/interface-leg.entity';
import { InterfaceOwner } from '../../interfaces/interface-owner.entity';
import { InterfaceCompany } from '../../interfaces/interface-company.entity';
import { InterfaceKeyIdentifier } from '../../interfaces/interface-key-identifier.entity';
import { InterfaceLink } from '../../interfaces/interface-link.entity';
import { InterfaceDataResidency } from '../../interfaces/interface-data-residency.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { AuditService } from '../../audit/audit.service';
import { ApplicationsBaseService, ServiceOpts } from './applications-base.service';
import { InterfaceMappingsService } from '../../interfaces/services';
import { applicationParticipantCondition } from '../../auth/business-contributor-scope';

/**
 * Service for managing application lifecycle transitions and version management.
 */
@Injectable()
export class ApplicationsLifecycleService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
    private readonly audit: AuditService,
    private readonly interfaceMappings: InterfaceMappingsService,
    private readonly itOpsSettings: ItOpsSettingsService,
  ) {
    super(appRepo);
  }

  /**
   * Create a new version of an application with lineage tracking.
   */
  async createVersion(sourceId: string, body: Parameters<ApplicationsLifecycleService['createVersionLocked']>[1], userId: string | null, opts?: ServiceOpts): Promise<Application> {
    return this.getManager(opts).transaction((manager) => this.createVersionLocked(sourceId, body, userId, { ...opts, manager }));
  }

  private async createVersionLocked(
    sourceId: string,
    body: {
      name: string;
      version?: string;
      go_live_date?: string;
      end_of_support_date?: string;
      copyOwners?: boolean;
      copyCompanies?: boolean;
      copyDepartments?: boolean;
      copyDataResidency?: boolean;
      copyLinks?: boolean;
      copySupportContacts?: boolean;
      copySpendItems?: boolean;
      copyCapexItems?: boolean;
      copyContracts?: boolean;
      copyInstances?: boolean;
      copyBindings?: boolean;
      interfaceIds?: string[];
    },
    userId: string | null,
    opts?: ServiceOpts
  ): Promise<Application> {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(Application);

    const catalog = await this.itOpsSettings.lockClassificationCatalog(await this.getCurrentTenantId(mg), mg);
    const source = await repo.findOne({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('Application not found');

    const nowYear = new Date().getFullYear();
    const newApp = repo.create({
      tenant_id: source.tenant_id,
      name: body.name,
      supplier_id: source.supplier_id,
      category: source.category,
      description: source.description,
      editor: source.editor,
      lifecycle: 'proposed',
      environment: source.environment,
      ...copyClassification(source, catalog),
      data_class: source.data_class,
      hosting_model: source.hosting_model,
      external_facing: source.external_facing,
      is_suite: source.is_suite,
      etl_enabled: source.etl_enabled,
      contains_pii: source.contains_pii,
      sso_enabled: source.sso_enabled,
      mfa_supported: source.mfa_supported,
      licensing: source.licensing,
      notes: source.notes,
      support_notes: source.support_notes,
      users_mode: source.users_mode,
      users_year: nowYear,
      users_override: null,
      version: body.version ?? null,
      go_live_date: body.go_live_date ? new Date(body.go_live_date) : null,
      end_of_support_date: body.end_of_support_date ? new Date(body.end_of_support_date) : null,
      predecessor_id: sourceId,
      status: 'enabled',
      disabled_at: null,
    });

    const saved = await repo.save(newApp as any) as Application;

    const copyOpts = {
      copyOwners: body.copyOwners !== false,
      copyCompanies: body.copyCompanies !== false,
      copyDepartments: body.copyDepartments !== false,
      copyDataResidency: body.copyDataResidency !== false,
      copyLinks: body.copyLinks !== false,
      copySupportContacts: body.copySupportContacts !== false,
      copySpendItems: body.copySpendItems !== false,
      copyCapexItems: body.copyCapexItems !== false,
      copyContracts: body.copyContracts !== false,
      copyInstances: body.copyInstances === true,
      copyBindings: body.copyBindings === true,
    };

    if (copyOpts.copyOwners) await this.copyOwnersInternal(sourceId, saved.id, mg);
    if (copyOpts.copyCompanies) await this.copyCompaniesInternal(sourceId, saved.id, mg);
    if (copyOpts.copyDepartments) await this.copyDepartmentsInternal(sourceId, saved.id, mg);
    if (copyOpts.copyDataResidency) await this.copyDataResidencyInternal(sourceId, saved.id, mg);
    if (copyOpts.copyLinks) await this.copyLinksInternal(sourceId, saved.id, mg);
    if (copyOpts.copySupportContacts) await this.copySupportContactsInternal(sourceId, saved.id, mg);
    if (copyOpts.copySpendItems) await this.copySpendItemsInternal(sourceId, saved.id, mg);
    if (copyOpts.copyCapexItems) await this.copyCapexItemsInternal(sourceId, saved.id, mg);
    if (copyOpts.copyContracts) await this.copyContractsInternal(sourceId, saved.id, mg);

    let instanceMapping = new Map<string, string>();
    if (copyOpts.copyInstances) {
      instanceMapping = await this.copyInstancesInternal(sourceId, saved.id, mg);
    }

    if (body.interfaceIds?.length) {
      await this.migrateInterfacesInternal(
        sourceId,
        saved.id,
        body.interfaceIds,
        mg,
        instanceMapping,
        copyOpts.copyBindings && copyOpts.copyInstances
      );
    }

    await this.audit.log({
      table: 'applications',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  /**
   * Get all successors of an application.
   */
  async getSuccessors(id: string, opts?: ServiceOpts): Promise<Application[]> {
    const mg = this.getManager(opts);
    const qb = mg.getRepository(Application)
      .createQueryBuilder('a')
      .where('a.predecessor_id = :id', { id })
      .orderBy('a.created_at', 'ASC');
    if (opts?.accessScope) {
      qb.andWhere(applicationParticipantCondition('a', ':accessScopeUserId'), {
        accessScopeUserId: opts.accessScope.userId,
      });
    }
    return qb.getMany();
  }

  /**
   * Get full version lineage for an application.
   */
  async getVersionLineage(id: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(Application);
    const resolvedId = await this.resolveApplicationIdentifier(id, mg);
    await this.assertVisible(resolvedId, opts?.accessScope, mg);

    const current = await repo.findOne({ where: { id: resolvedId } });
    if (!current) throw new NotFoundException('Application not found');

    const predecessors: Application[] = [];
    let walkId = current.predecessor_id;
    while (walkId) {
      const pred = await repo.findOne({ where: { id: walkId } });
      if (!pred) break;
      try {
        await this.assertVisible(pred.id, opts?.accessScope, mg);
      } catch {
        break;
      }
      predecessors.unshift(pred);
      walkId = pred.predecessor_id;
      if (predecessors.length > 50) break;
    }

    const successors = await this.getSuccessors(resolvedId, { manager: mg, accessScope: opts?.accessScope });

    return { predecessors, current, successors };
  }

  /**
   * Get interfaces for migration wizard.
   */
  async getInterfacesForMigration(id: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = await this.resolveTenantId(mg);
    const resolvedId = await this.resolveApplicationIdentifier(id, mg);
    await this.assertVisible(resolvedId, opts?.accessScope, mg);
    if (opts?.accessScope) return [];

    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedId } });
    if (!app) throw new NotFoundException('Application not found');
    const includeMiddleware = !!app.etl_enabled;

    const directInterfaces = await mg.query(`
      SELECT i.id, i.name, i.interface_reference, i.interface_id, i.lifecycle,
             sa.name as source_app_name, ta.name as target_app_name,
             CASE
               WHEN i.source_application_id = $2 AND i.target_application_id = $2 THEN 'both'
               WHEN i.source_application_id = $2 THEN 'source'
               WHEN i.target_application_id = $2 THEN 'target'
             END as app_role
      FROM interfaces i
      LEFT JOIN applications sa ON sa.id = i.source_application_id
      LEFT JOIN applications ta ON ta.id = i.target_application_id
      WHERE i.tenant_id = $1
        AND (i.source_application_id = $2 OR i.target_application_id = $2)
      ORDER BY i.name
    `, [tenantId, resolvedId]);

    if (!includeMiddleware) {
      return directInterfaces;
    }

    const middlewareInterfaces = await mg.query(`
      SELECT DISTINCT i.id, i.name, i.interface_reference, i.interface_id, i.lifecycle,
             sa.name as source_app_name, ta.name as target_app_name,
             'via_middleware' as app_role
      FROM interfaces i
      LEFT JOIN applications sa ON sa.id = i.source_application_id
      LEFT JOIN applications ta ON ta.id = i.target_application_id
      WHERE i.tenant_id = $1
        AND i.source_application_id != $2
        AND i.target_application_id != $2
        AND (
          EXISTS (
            SELECT 1 FROM interface_middleware_applications mw
            WHERE mw.interface_id = i.id
              AND mw.tenant_id = $1
              AND mw.application_id = $2
          )
          OR EXISTS (
            SELECT 1 FROM interface_bindings ib
            WHERE ib.interface_id = i.id
              AND ib.tenant_id = $1
              AND ib.integration_tool_application_id = $2
          )
        )
      ORDER BY i.name
    `, [tenantId, resolvedId]);

    const directIds = new Set(directInterfaces.map((i: any) => i.id));
    const combined = [
      ...directInterfaces,
      ...middlewareInterfaces.filter((i: any) => !directIds.has(i.id)),
    ];

    const rolePriority: Record<string, number> = { source: 0, target: 1, both: 2, via_middleware: 3 };
    combined.sort((a, b) => {
      const priorityDiff = (rolePriority[a.app_role] ?? 99) - (rolePriority[b.app_role] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    return combined;
  }

  // Copy helper methods
  private async copyOwnersInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationOwner).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationOwner).save(items.map(o => ({ ...o, id: undefined, application_id: targetId })));
    }
  }

  private async copyCompaniesInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationCompany).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationCompany).save(items.map(c => ({ ...c, id: undefined, application_id: targetId })));
    }
  }

  private async copyDepartmentsInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationDepartment).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationDepartment).save(items.map(d => ({ ...d, id: undefined, application_id: targetId })));
    }
  }

  private async copyDataResidencyInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationDataResidency).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationDataResidency).save(items.map(r => ({ ...r, id: undefined, application_id: targetId })));
    }
  }

  private async copyLinksInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationLink).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationLink).save(items.map(l => ({ ...l, id: undefined, application_id: targetId })));
    }
  }

  private async copySupportContactsInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationSupportContact).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationSupportContact).save(items.map(c => ({ ...c, id: undefined, application_id: targetId })));
    }
  }

  /** The source's links to OPEX lines (`spend/budget-nature.ts`); the CAPEX links are copied below. */
  private async copySpendItemsInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationSpendItemLink).createQueryBuilder('l')
      .innerJoin(SpendItem, 'i', `i.id = l.spend_item_id AND i.tenant_id = l.tenant_id AND i.nature = 'opex'`)
      .where('l.application_id = :sourceId', { sourceId })
      .getMany();
    if (items.length) {
      await mg.getRepository(ApplicationSpendItemLink).save(items.map(s => ({ ...s, id: undefined, application_id: targetId })));
    }
  }

  private async copyCapexItemsInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationCapexItemLink).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationCapexItemLink).save(items.map(c => ({ ...c, id: undefined, application_id: targetId })));
    }
  }

  private async copyContractsInternal(sourceId: string, targetId: string, mg: EntityManager) {
    const items = await mg.getRepository(ApplicationContractLink).find({ where: { application_id: sourceId } as any });
    if (items.length) {
      await mg.getRepository(ApplicationContractLink).save(items.map(c => ({ ...c, id: undefined, application_id: targetId })));
    }
  }

  private async copyInstancesInternal(sourceId: string, targetId: string, mg: EntityManager): Promise<Map<string, string>> {
    const instanceMapping = new Map<string, string>();
    const repo = mg.getRepository(AppInstance);
    const items = await repo.find({ where: { application_id: sourceId } as any });
    if (items.length) {
      for (const item of items) {
        const oldId = item.id;
        const newInstance = repo.create({ ...item, id: undefined, application_id: targetId });
        const saved = await repo.save(newInstance as any);
        instanceMapping.set(oldId, saved.id);
      }
    }
    return instanceMapping;
  }

  private async migrateInterfacesInternal(
    sourceAppId: string,
    targetAppId: string,
    interfaceIds: string[],
    mg: EntityManager,
    instanceMapping: Map<string, string> = new Map(),
    copyBindings: boolean = false
  ) {
    const repo = mg.getRepository(InterfaceEntity);
    const legRepo = mg.getRepository(InterfaceLeg);
    const bindingRepo = mg.getRepository(InterfaceBinding);
    const middlewareRepo = mg.getRepository(InterfaceMiddlewareApplication);
    const ownerRepo = mg.getRepository(InterfaceOwner);
    const companyRepo = mg.getRepository(InterfaceCompany);
    const keyIdRepo = mg.getRepository(InterfaceKeyIdentifier);
    const linkRepo = mg.getRepository(InterfaceLink);
    const dataResRepo = mg.getRepository(InterfaceDataResidency);

    const targetApp = await mg.getRepository(Application).findOne({ where: { id: targetAppId } });
    const targetAppName = targetApp?.name || 'new version';

    for (const ifaceId of interfaceIds) {
      const original = await repo.findOne({ where: { id: ifaceId } });
      if (!original) continue;

      const isSource = original.source_application_id === sourceAppId;
      const isTarget = original.target_application_id === sourceAppId;
      const isViaMiddleware = !isSource && !isTarget;

      let nameSuffix: string;
      if (isViaMiddleware) {
        nameSuffix = `(via ${targetAppName})`;
      } else {
        nameSuffix = '(new version)';
      }

      const copy = repo.create({
        ...original,
        id: undefined,
        interface_id: `${original.interface_id} ${nameSuffix}`,
        name: original.name ? `${original.name} ${nameSuffix}` : undefined,
        source_application_id: isSource ? targetAppId : original.source_application_id,
        target_application_id: isTarget ? targetAppId : original.target_application_id,
        lifecycle: 'proposed',
        created_at: undefined,
        updated_at: undefined,
      });

      const savedCopy = await repo.save(copy as any);

      const legMapping = new Map<string, string>();
      const originalLegs = await legRepo.find({
        where: { interface_id: ifaceId } as any,
        order: { order_index: 'ASC' } as any,
      });
      if (originalLegs.length > 0) {
        for (const leg of originalLegs) {
          const oldLegId = leg.id;
          const newLeg = legRepo.create({
            tenant_id: leg.tenant_id,
            interface_id: savedCopy.id,
            leg_type: leg.leg_type,
            from_role: leg.from_role,
            to_role: leg.to_role,
            trigger_type: leg.trigger_type,
            integration_pattern: leg.integration_pattern,
            data_format: leg.data_format,
            job_name: leg.job_name,
            order_index: leg.order_index,
          });
          const savedLeg = await legRepo.save(newLeg as any);
          legMapping.set(oldLegId, savedLeg.id);
        }
      }

      const originalMiddlewareApps = await middlewareRepo.find({ where: { interface_id: ifaceId } as any });
      if (originalMiddlewareApps.length > 0) {
        const copiedMiddlewareApps = originalMiddlewareApps.map(mw => middlewareRepo.create({
          tenant_id: mw.tenant_id,
          interface_id: savedCopy.id,
          application_id: mw.application_id === sourceAppId ? targetAppId : mw.application_id,
        }));
        await middlewareRepo.save(copiedMiddlewareApps);
      }

      const originalOwners = await ownerRepo.find({ where: { interface_id: ifaceId } as any });
      if (originalOwners.length > 0) {
        const copiedOwners = originalOwners.map(o => ownerRepo.create({
          tenant_id: o.tenant_id,
          interface_id: savedCopy.id,
          user_id: o.user_id,
          owner_type: o.owner_type,
        }));
        await ownerRepo.save(copiedOwners);
      }

      const originalCompanies = await companyRepo.find({ where: { interface_id: ifaceId } as any });
      if (originalCompanies.length > 0) {
        const copiedCompanies = originalCompanies.map(c => companyRepo.create({
          tenant_id: c.tenant_id,
          interface_id: savedCopy.id,
          company_id: c.company_id,
        }));
        await companyRepo.save(copiedCompanies);
      }

      const originalKeyIds = await keyIdRepo.find({ where: { interface_id: ifaceId } as any });
      if (originalKeyIds.length > 0) {
        const copiedKeyIds = originalKeyIds.map(k => keyIdRepo.create({
          tenant_id: k.tenant_id,
          interface_id: savedCopy.id,
          source_identifier: k.source_identifier,
          destination_identifier: k.destination_identifier,
          identifier_notes: k.identifier_notes,
        }));
        await keyIdRepo.save(copiedKeyIds);
      }

      const originalLinks = await linkRepo.find({ where: { interface_id: ifaceId } as any });
      if (originalLinks.length > 0) {
        const copiedLinks = originalLinks.map(l => linkRepo.create({
          tenant_id: l.tenant_id,
          interface_id: savedCopy.id,
          kind: l.kind,
          description: l.description,
          url: l.url,
        }));
        await linkRepo.save(copiedLinks);
      }

      const originalDataRes = await dataResRepo.find({ where: { interface_id: ifaceId } as any });
      if (originalDataRes.length > 0) {
        const copiedDataRes = originalDataRes.map(r => dataResRepo.create({
          tenant_id: r.tenant_id,
          interface_id: savedCopy.id,
          country_iso: r.country_iso,
        }));
        await dataResRepo.save(copiedDataRes);
      }

      await this.interfaceMappings.cloneInterfaceMappings(
        ifaceId,
        savedCopy.id,
        savedCopy.tenant_id,
        null,
        {
          manager: mg,
          audit: false,
          legMapping,
        },
      );

      if (copyBindings && legMapping.size > 0) {
        const originalBindings = await bindingRepo.find({ where: { interface_id: ifaceId } as any });

        for (const binding of originalBindings) {
          const newLegId = legMapping.get(binding.interface_leg_id);
          if (!newLegId) continue;

          let newSourceInstanceId: string | null = null;
          let newTargetInstanceId: string | null = null;

          if (isViaMiddleware) {
            newSourceInstanceId = instanceMapping.get(binding.source_instance_id) || binding.source_instance_id;
            newTargetInstanceId = instanceMapping.get(binding.target_instance_id) || binding.target_instance_id;
          } else {
            if (isSource) {
              newSourceInstanceId = instanceMapping.get(binding.source_instance_id) || null;
              newTargetInstanceId = binding.target_instance_id;
            } else if (isTarget) {
              newSourceInstanceId = binding.source_instance_id;
              newTargetInstanceId = instanceMapping.get(binding.target_instance_id) || null;
            }
          }

          if (!newSourceInstanceId || !newTargetInstanceId) continue;

          const newBinding = bindingRepo.create({
            tenant_id: binding.tenant_id,
            interface_id: savedCopy.id,
            interface_leg_id: newLegId,
            environment: binding.environment,
            source_instance_id: newSourceInstanceId,
            target_instance_id: newTargetInstanceId,
            integration_tool_application_id: binding.integration_tool_application_id === sourceAppId
              ? targetAppId
              : binding.integration_tool_application_id,
            status: 'proposed',
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
    }
  }
}
