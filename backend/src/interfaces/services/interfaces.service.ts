import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { InterfacesListService } from './interfaces-list.service';
import { InterfacesCrudService } from './interfaces-crud.service';
import { InterfaceBindingsManagementService } from './interface-bindings.service';
import { InterfaceSyncService } from './interface-sync.service';
import { InterfaceLink } from '../interface-link.entity';

/**
 * Options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
}

/**
 * Main facade service for interfaces that delegates to specialized sub-services.
 * This maintains backward compatibility with the existing controller API.
 */
@Injectable()
export class InterfacesService {
  constructor(
    private readonly listService: InterfacesListService,
    private readonly crudService: InterfacesCrudService,
    private readonly bindingsService: InterfaceBindingsManagementService,
    private readonly syncService: InterfaceSyncService,
  ) {}

  // =========================================================================
  // List Operations (delegated to InterfacesListService)
  // =========================================================================

  list(query: any, opts?: ServiceOpts) {
    return this.listService.list(query, opts);
  }

  listIds(query: any, opts?: ServiceOpts) {
    return this.listService.listIds(query, opts);
  }

  businessProcessFilterValues(opts?: ServiceOpts) {
    return this.listService.businessProcessFilterValues(opts);
  }

  listByApplication(applicationId: string, tenantId: string, opts?: ServiceOpts) {
    return this.listService.listByApplication(applicationId, tenantId, opts);
  }

  getMap(query: any, tenantId: string, opts?: ServiceOpts) {
    return this.listService.getMap(query, tenantId, opts);
  }

  // =========================================================================
  // CRUD Operations (delegated to InterfacesCrudService)
  // =========================================================================

  get(id: string, query: any, opts?: ServiceOpts) {
    return this.crudService.get(id, query, opts);
  }

  create(body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.create(body, tenantId, userId, opts);
  }

  update(id: string, body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.update(id, body, tenantId, userId, opts);
  }

  delete(id: string, userId: string | null, opts?: ServiceOpts & { deleteRelatedBindings?: boolean }) {
    return this.crudService.delete(id, userId, opts);
  }

  bulkDelete(ids: string[], userId: string | null, opts?: ServiceOpts & { deleteRelatedBindings?: boolean }) {
    return this.crudService.bulkDelete(ids, userId, opts);
  }

  duplicate(id: string, tenantId: string, userId: string | null, opts?: ServiceOpts & { copyBindings?: boolean }) {
    return this.crudService.duplicate(id, tenantId, userId, opts);
  }

  shareInterface(id: string, body: any, tenantId: string, userId: string, opts?: ServiceOpts) {
    return this.crudService.shareInterface(id, body, tenantId, userId, opts);
  }

  // =========================================================================
  // Binding & Leg Operations (delegated to InterfaceBindingsManagementService)
  // =========================================================================

  listLegs(interfaceId: string, opts?: ServiceOpts) {
    return this.bindingsService.listLegs(interfaceId, opts);
  }

  updateLegs(
    interfaceId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.updateLegs(interfaceId, body, tenantId, userId, opts);
  }

  listConnectionLinksForInterface(
    interfaceId: string,
    tenantId: string,
    query: any,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.listConnectionLinksForInterface(interfaceId, tenantId, query, opts);
  }

  // =========================================================================
  // Owner Operations (delegated to InterfaceBindingsManagementService)
  // =========================================================================

  listOwners(interfaceId: string, opts?: ServiceOpts) {
    return this.bindingsService.listOwners(interfaceId, opts);
  }

  bulkReplaceOwners(
    interfaceId: string,
    owners: Array<{ user_id: string; owner_type: 'business' | 'it' }>,
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.bulkReplaceOwners(interfaceId, owners, userId, opts);
  }

  // =========================================================================
  // Company Operations (delegated to InterfaceBindingsManagementService)
  // =========================================================================

  listCompanies(interfaceId: string, opts?: ServiceOpts) {
    return this.bindingsService.listCompanies(interfaceId, opts);
  }

  bulkReplaceCompanies(interfaceId: string, companyIds: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.bindingsService.bulkReplaceCompanies(interfaceId, companyIds, userId, opts);
  }

  // =========================================================================
  // Dependency Operations (delegated to InterfaceBindingsManagementService)
  // =========================================================================

  listDependencies(interfaceId: string, opts?: ServiceOpts) {
    return this.bindingsService.listDependencies(interfaceId, opts);
  }

  bulkReplaceDependencies(
    interfaceId: string,
    upstreamIds: string[],
    downstreamIds: string[],
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.bulkReplaceDependencies(interfaceId, upstreamIds, downstreamIds, userId, opts);
  }

  // =========================================================================
  // Key Identifier Operations (delegated to InterfaceBindingsManagementService)
  // =========================================================================

  listKeyIdentifiers(interfaceId: string, opts?: ServiceOpts) {
    return this.bindingsService.listKeyIdentifiers(interfaceId, opts);
  }

  bulkReplaceKeyIdentifiers(
    interfaceId: string,
    items: Array<{ source_identifier: string; destination_identifier: string; identifier_notes?: string | null }>,
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.bulkReplaceKeyIdentifiers(interfaceId, items, userId, opts);
  }

  // =========================================================================
  // Data Residency Operations (delegated to InterfaceBindingsManagementService)
  // =========================================================================

  listDataResidency(interfaceId: string, opts?: ServiceOpts) {
    return this.bindingsService.listDataResidency(interfaceId, opts);
  }

  bulkReplaceDataResidency(interfaceId: string, countryCodes: string[], userId?: string | null, opts?: ServiceOpts) {
    return this.bindingsService.bulkReplaceDataResidency(interfaceId, countryCodes, userId, opts);
  }

  // =========================================================================
  // Link Operations (delegated to InterfaceBindingsManagementService)
  // =========================================================================

  listLinks(interfaceId: string, opts?: ServiceOpts) {
    return this.bindingsService.listLinks(interfaceId, opts);
  }

  bulkReplaceLinks(
    interfaceId: string,
    links: Array<{ kind?: string; description?: string | null; url: string }>,
    userId?: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.bulkReplaceLinks(interfaceId, links, userId, opts);
  }

  createLink(
    interfaceId: string,
    body: Partial<InterfaceLink>,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.createLink(interfaceId, body, userId, opts);
  }

  updateLink(
    interfaceId: string,
    linkId: string,
    body: Partial<InterfaceLink>,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.updateLink(interfaceId, linkId, body, userId, opts);
  }

  deleteLink(
    interfaceId: string,
    linkId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.bindingsService.deleteLink(interfaceId, linkId, userId, opts);
  }

  // =========================================================================
  // Attachment Operations (delegated to InterfaceSyncService)
  // =========================================================================

  listAttachments(interfaceId: string, opts?: ServiceOpts) {
    return this.syncService.listAttachments(interfaceId, opts);
  }

  uploadAttachment(
    interfaceId: string,
    file: Express.Multer.File,
    body: any,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.syncService.uploadAttachment(interfaceId, file, body, userId, opts);
  }

  downloadAttachment(attachmentId: string, opts?: ServiceOpts) {
    return this.syncService.downloadAttachment(attachmentId, opts);
  }

  deleteAttachment(attachmentId: string, userId: string | null, opts?: ServiceOpts) {
    return this.syncService.deleteAttachment(attachmentId, userId, opts);
  }
}
