import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { Application } from '../application.entity';
import { ApplicationOwner } from '../application-owner.entity';
import { ApplicationCompany } from '../application-company.entity';
import { ApplicationDepartment } from '../application-department.entity';
import { ApplicationLink } from '../application-link.entity';
import { ApplicationAttachment } from '../application-attachment.entity';
import { ApplicationDataResidency } from '../application-data-residency.entity';
import { ApplicationsListService } from './applications-list.service';
import { ApplicationsCrudService } from './applications-crud.service';
import { ApplicationsOwnersService } from './applications-owners.service';
import { ApplicationsInstancesService } from './applications-instances.service';
import { ApplicationsResidencyService } from './applications-residency.service';
import { ApplicationsStructureService } from './applications-structure.service';
import { ApplicationsLifecycleService } from './applications-lifecycle.service';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';

/**
 * Options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
  tenantId?: string;
  accessScope?: ParticipationAccessScope;
  projectAccessScope?: ParticipationAccessScope;
}

/**
 * Main facade service for applications that delegates to specialized sub-services.
 * This maintains backward compatibility with the existing controller API.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly listService: ApplicationsListService,
    private readonly crudService: ApplicationsCrudService,
    private readonly ownersService: ApplicationsOwnersService,
    private readonly instancesService: ApplicationsInstancesService,
    private readonly residencyService: ApplicationsResidencyService,
    private readonly structureService: ApplicationsStructureService,
    private readonly lifecycleService: ApplicationsLifecycleService,
  ) {}

  // =========================================================================
  // List Operations (delegated to ApplicationsListService)
  // =========================================================================

  list(query: any, opts?: ServiceOpts) {
    return this.listService.list(query, opts);
  }

  listIds(query: any, opts?: ServiceOpts) {
    return this.listService.listIds(query, opts);
  }

  classificationSummary(query: any, opts?: ServiceOpts) {
    return this.listService.classificationSummary(query, opts);
  }

  listRecoveryDependencies(id: string, opts?: ServiceOpts) {
    return this.listService.listRecoveryDependencies(id, opts);
  }

  listFilterValues(query: any, opts?: ServiceOpts) {
    return this.listService.listFilterValues(query, opts);
  }

  mapSummary(id: string, opts?: ServiceOpts) {
    return this.listService.mapSummary(id, opts);
  }

  listWithServerAssignments(opts?: ServiceOpts) {
    return this.listService.listWithServerAssignments(opts);
  }

  assertVisible(id: string, opts?: ServiceOpts) {
    return this.crudService.ensureApp(id, opts?.manager, opts?.accessScope).then(() => undefined);
  }

  // =========================================================================
  // CRUD Operations (delegated to ApplicationsCrudService)
  // =========================================================================

  get(id: string, opts?: ServiceOpts & { include?: string | string[] }) {
    return this.crudService.get(id, opts);
  }

  copyApplication(id: string, name: string, userId: string | null, opts?: ServiceOpts) { return this.crudService.copyApplication(id, name, userId, opts); }

  getClassificationCatalog(opts?: ServiceOpts) { return this.crudService.getClassificationCatalog(opts); }

  reviewClassification(id: string, expectedRevision: number, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.reviewClassification(id, expectedRevision, userId, opts);
  }

  create(body: Partial<Application>, userId?: string | null, opts?: ServiceOpts) {
    return this.crudService.create(body, userId, opts);
  }

  update(id: string, body: Partial<Application>, userId?: string | null, opts?: ServiceOpts) {
    return this.crudService.update(id, body, userId, opts);
  }

  shareApplication(id: string, body: ShareItemDto, tenantId: string, userId: string, opts?: ServiceOpts) {
    return this.crudService.shareApplication(id, body, tenantId, userId, opts);
  }

  relationCounts(id: string, opts?: ServiceOpts) {
    return this.crudService.relationCounts(id, opts);
  }

  // Links
  listLinks(appId: string, opts?: ServiceOpts) {
    return this.crudService.listLinks(appId, opts);
  }

  createLink(appId: string, body: Partial<ApplicationLink>, userId?: string | null, opts?: ServiceOpts) {
    return this.crudService.createLink(appId, body, userId, opts);
  }

  updateLink(appId: string, linkId: string, body: Partial<ApplicationLink>, userId?: string | null, opts?: ServiceOpts) {
    return this.crudService.updateLink(appId, linkId, body, userId, opts);
  }

  deleteLink(appId: string, linkId: string, userId?: string | null, opts?: ServiceOpts) {
    return this.crudService.deleteLink(appId, linkId, userId, opts);
  }

  // Attachments
  listAttachments(appId: string, opts?: ServiceOpts) {
    return this.crudService.listAttachments(appId, opts);
  }

  uploadAttachment(appId: string, file: Express.Multer.File, userId?: string | null, opts?: ServiceOpts) {
    return this.crudService.uploadAttachment(appId, file, userId, opts);
  }

  downloadAttachment(attachmentId: string, opts?: ServiceOpts) {
    return this.crudService.downloadAttachment(attachmentId, opts);
  }

  deleteAttachment(attachmentId: string, userId?: string | null, opts?: ServiceOpts) {
    return this.crudService.deleteAttachment(attachmentId, userId, opts);
  }

  // Derived users
  getTotalUsers(appId: string, yearOverride?: number, opts?: ServiceOpts) {
    return this.crudService.getTotalUsers(appId, yearOverride, opts);
  }

  computeDerivedUsers(appId: string, year: number, mode: 'manual' | 'it_users' | 'headcount', opts?: ServiceOpts) {
    return this.crudService.computeDerivedUsers(appId, year, mode, opts);
  }

  // =========================================================================
  // Owner Operations (delegated to ApplicationsOwnersService)
  // =========================================================================

  listOwners(appId: string, opts?: ServiceOpts) {
    return this.ownersService.listOwners(appId, opts);
  }

  bulkReplaceOwners(appId: string, owners: Array<{ user_id: string; owner_type: 'business' | 'it' }>, userId?: string | null, opts?: ServiceOpts) {
    return this.ownersService.bulkReplaceOwners(appId, owners, userId, opts);
  }

  // Companies (Audience)
  listCompanies(appId: string, opts?: ServiceOpts) {
    return this.ownersService.listCompanies(appId, opts);
  }

  bulkReplaceCompanies(appId: string, companyIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.ownersService.bulkReplaceCompanies(appId, companyIds, userId, opts);
  }

  // Departments (Audience)
  listDepartments(appId: string, opts?: ServiceOpts) {
    return this.ownersService.listDepartments(appId, opts);
  }

  bulkReplaceDepartments(appId: string, departmentIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.ownersService.bulkReplaceDepartments(appId, departmentIds, userId, opts);
  }

  // Support contacts
  listSupportContacts(appId: string, opts?: ServiceOpts) {
    return this.ownersService.listSupportContacts(appId, opts);
  }

  bulkReplaceSupportContacts(appId: string, contacts: Array<{ contact_id: string; role?: string | null }>, userId?: string | null, opts?: ServiceOpts) {
    return this.ownersService.bulkReplaceSupportContacts(appId, contacts, userId, opts);
  }

  // =========================================================================
  // Instance/Relations Operations (delegated to ApplicationsInstancesService)
  // =========================================================================

  listLinkedSpendItems(appId: string, opts?: ServiceOpts) {
    return this.instancesService.listLinkedSpendItems(appId, opts);
  }

  bulkReplaceLinkedSpendItems(appId: string, spendItemIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.instancesService.bulkReplaceLinkedSpendItems(appId, spendItemIds, userId, opts);
  }

  listLinkedCapexItems(appId: string, opts?: ServiceOpts) {
    return this.instancesService.listLinkedCapexItems(appId, opts);
  }

  bulkReplaceLinkedCapexItems(appId: string, capexItemIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.instancesService.bulkReplaceLinkedCapexItems(appId, capexItemIds, userId, opts);
  }

  listLinkedContracts(appId: string, opts?: ServiceOpts) {
    return this.instancesService.listLinkedContracts(appId, opts);
  }

  bulkReplaceLinkedContracts(appId: string, contractIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.instancesService.bulkReplaceLinkedContracts(appId, contractIds, userId, opts);
  }

  listProjects(applicationId: string, opts?: ServiceOpts) {
    return this.instancesService.listProjects(applicationId, opts);
  }

  bulkReplaceProjects(applicationId: string, projectIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.instancesService.bulkReplaceProjects(applicationId, projectIds, userId, opts);
  }

  // =========================================================================
  // Data Residency (delegated to ApplicationsResidencyService)
  // =========================================================================

  listDataResidency(appId: string, opts?: ServiceOpts) {
    return this.residencyService.listDataResidency(appId, opts);
  }

  bulkReplaceDataResidency(appId: string, countryCodes: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.residencyService.bulkReplaceDataResidency(appId, countryCodes, userId, opts);
  }

  // =========================================================================
  // Structure Operations (delegated to ApplicationsStructureService)
  // =========================================================================

  listSuites(appId: string, opts?: ServiceOpts) {
    return this.structureService.listSuites(appId, opts);
  }

  bulkReplaceSuites(appId: string, suiteIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.structureService.bulkReplaceSuites(appId, suiteIds, userId, opts);
  }

  listComponents(suiteId: string, opts?: ServiceOpts) {
    return this.structureService.listComponents(suiteId, opts);
  }

  // =========================================================================
  // Lifecycle Operations (delegated to ApplicationsLifecycleService)
  // =========================================================================

  createVersion(
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
    opts?: ServiceOpts,
  ) {
    return this.lifecycleService.createVersion(sourceId, body, userId, opts);
  }

  getVersionLineage(id: string, opts?: ServiceOpts) {
    return this.lifecycleService.getVersionLineage(id, opts);
  }

  getInterfacesForMigration(id: string, opts?: ServiceOpts) {
    return this.lifecycleService.getInterfacesForMigration(id, opts);
  }
}
