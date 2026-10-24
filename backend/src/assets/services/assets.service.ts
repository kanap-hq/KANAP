import { Injectable } from '@nestjs/common';
import { Asset } from '../asset.entity';
import { AssetHardwareInfo } from '../asset-hardware-info.entity';
import { AssetSupportInfo } from '../asset-support-info.entity';
import { AssetLink } from '../asset-link.entity';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';
import { AssetsListService } from './assets-list.service';
import { AssetsCrudService } from './assets-crud.service';
import { AssetsHardwareService } from './assets-hardware.service';
import { AssetsSupportService } from './assets-support.service';
import { AssetsRelationsService } from './assets-relations.service';
import { AssetsAttachmentsService } from './assets-attachments.service';
import { ServiceOpts } from './assets-base.service';

// Same options the sub-services take (manager, tenant, audit attribution).
export { ServiceOpts } from './assets-base.service';

/**
 * Main facade service for assets that delegates to specialized sub-services.
 * This maintains backward compatibility with the existing controller API.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly listService: AssetsListService,
    private readonly crudService: AssetsCrudService,
    private readonly hardwareService: AssetsHardwareService,
    private readonly supportService: AssetsSupportService,
    private readonly relationsService: AssetsRelationsService,
    private readonly attachmentsService: AssetsAttachmentsService,
  ) {}

  // =========================================================================
  // List Operations (delegated to AssetsListService)
  // =========================================================================

  list(query: any, opts?: ServiceOpts) {
    return this.listService.list(query, opts);
  }

  listIds(query: any, opts?: ServiceOpts) {
    return this.listService.listIds(query, opts);
  }

  mapSummary(id: string, opts?: ServiceOpts) {
    return this.listService.mapSummary(id, opts);
  }

  listFilterValues(query: any, opts?: ServiceOpts) {
    return this.listService.listFilterValues(query, opts);
  }

  // =========================================================================
  // CRUD Operations (delegated to AssetsCrudService)
  // =========================================================================

  get(id: string, opts?: ServiceOpts) {
    return this.crudService.get(id, opts);
  }

  getByReference(reference: string, opts?: ServiceOpts) {
    return this.crudService.getByReference(reference, opts);
  }

  create(body: Partial<Asset>, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.create(body, tenantId, userId, opts);
  }

  update(id: string, body: Partial<Asset>, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.update(id, body, tenantId, userId, opts);
  }

  shareAsset(id: string, body: ShareItemDto, tenantId: string, userId: string, opts?: ServiceOpts) {
    return this.crudService.shareAsset(id, body, tenantId, userId, opts);
  }

  // =========================================================================
  // Cluster Operations (delegated to AssetsCrudService)
  // =========================================================================

  listClusterMembers(clusterId: string, opts?: ServiceOpts) {
    return this.crudService.listClusterMembers(clusterId, opts);
  }

  listClustersForAsset(assetId: string, opts?: ServiceOpts) {
    return this.crudService.listClustersForAsset(assetId, opts);
  }

  replaceClusterMembers(
    clusterId: string,
    assetIds: unknown,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
    options?: { removeOperatingSystem?: unknown },
  ) {
    return this.crudService.replaceClusterMembers(clusterId, assetIds, tenantId, userId, opts, options);
  }

  // =========================================================================
  // Hardware Info (delegated to AssetsHardwareService)
  // =========================================================================

  getHardwareInfo(assetId: string, opts?: ServiceOpts) {
    return this.hardwareService.getHardwareInfo(assetId, opts);
  }

  upsertHardwareInfo(
    assetId: string,
    data: Partial<AssetHardwareInfo>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.hardwareService.upsertHardwareInfo(assetId, data, tenantId, userId, opts);
  }

  deleteHardwareInfo(assetId: string, userId: string | null, opts?: ServiceOpts) {
    return this.hardwareService.deleteHardwareInfo(assetId, userId, opts);
  }

  // =========================================================================
  // Support Info (delegated to AssetsSupportService)
  // =========================================================================

  getSupportInfo(assetId: string, opts?: ServiceOpts) {
    return this.supportService.getSupportInfo(assetId, opts);
  }

  upsertSupportInfo(
    assetId: string,
    data: Partial<AssetSupportInfo>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.supportService.upsertSupportInfo(assetId, data, tenantId, userId, opts);
  }

  deleteSupportInfo(assetId: string, userId: string | null, opts?: ServiceOpts) {
    return this.supportService.deleteSupportInfo(assetId, userId, opts);
  }

  // =========================================================================
  // Support Contacts (delegated to AssetsSupportService)
  // =========================================================================

  listSupportContacts(assetId: string, opts?: ServiceOpts) {
    return this.supportService.listSupportContacts(assetId, opts);
  }

  bulkReplaceSupportContacts(
    assetId: string,
    contacts: Array<{ contact_id: string; role?: string | null }>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.supportService.bulkReplaceSupportContacts(assetId, contacts, tenantId, userId, opts);
  }

  // =========================================================================
  // Asset Relations (delegated to AssetsRelationsService)
  // =========================================================================

  listRelations(assetId: string, opts?: ServiceOpts) {
    return this.relationsService.listRelations(assetId, opts);
  }

  bulkReplaceRelations(
    assetId: string,
    relations: Array<{ related_asset_id: string; relation_type: string; notes?: string }>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.relationsService.bulkReplaceRelations(assetId, relations, tenantId, userId, opts);
  }

  addRelation(
    assetId: string,
    relatedAssetId: string,
    relationType: 'contains' | 'depends_on',
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.relationsService.addRelation(assetId, relatedAssetId, relationType, tenantId, userId, opts);
  }

  // =========================================================================
  // Financial Links (delegated to AssetsRelationsService)
  // =========================================================================

  listLinkedSpendItems(assetId: string, opts?: ServiceOpts) {
    return this.relationsService.listLinkedSpendItems(assetId, opts);
  }

  bulkReplaceLinkedSpendItems(
    assetId: string,
    spendItemIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.relationsService.bulkReplaceLinkedSpendItems(assetId, spendItemIds, tenantId, userId, opts);
  }

  listLinkedCapexItems(assetId: string, opts?: ServiceOpts) {
    return this.relationsService.listLinkedCapexItems(assetId, opts);
  }

  bulkReplaceLinkedCapexItems(
    assetId: string,
    capexItemIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.relationsService.bulkReplaceLinkedCapexItems(assetId, capexItemIds, tenantId, userId, opts);
  }

  listLinkedContracts(assetId: string, opts?: ServiceOpts) {
    return this.relationsService.listLinkedContracts(assetId, opts);
  }

  bulkReplaceLinkedContracts(
    assetId: string,
    contractIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.relationsService.bulkReplaceLinkedContracts(assetId, contractIds, tenantId, userId, opts);
  }

  // =========================================================================
  // Links (delegated to AssetsAttachmentsService)
  // =========================================================================

  listLinks(assetId: string, opts?: ServiceOpts) {
    return this.attachmentsService.listLinks(assetId, opts);
  }

  createLink(assetId: string, body: Partial<AssetLink>, userId?: string | null, opts?: ServiceOpts) {
    return this.attachmentsService.createLink(assetId, body, userId, opts);
  }

  updateLink(assetId: string, linkId: string, body: Partial<AssetLink>, userId?: string | null, opts?: ServiceOpts) {
    return this.attachmentsService.updateLink(assetId, linkId, body, userId, opts);
  }

  deleteLink(assetId: string, linkId: string, userId?: string | null, opts?: ServiceOpts) {
    return this.attachmentsService.deleteLink(assetId, linkId, userId, opts);
  }

  // =========================================================================
  // Attachments (delegated to AssetsAttachmentsService)
  // =========================================================================

  listAttachments(assetId: string, opts?: ServiceOpts) {
    return this.attachmentsService.listAttachments(assetId, opts);
  }

  uploadAttachment(assetId: string, file: Express.Multer.File, userId?: string | null, opts?: ServiceOpts) {
    return this.attachmentsService.uploadAttachment(assetId, file, userId, opts);
  }

  downloadAttachment(attachmentId: string, opts?: ServiceOpts) {
    return this.attachmentsService.downloadAttachment(attachmentId, opts);
  }

  deleteAttachment(attachmentId: string, userId?: string | null, opts?: ServiceOpts) {
    return this.attachmentsService.deleteAttachment(attachmentId, userId, opts);
  }

  // =========================================================================
  // Projects (delegated to AssetsAttachmentsService)
  // =========================================================================

  listProjects(assetId: string, opts?: ServiceOpts) {
    return this.attachmentsService.listProjects(assetId, opts);
  }

  bulkReplaceProjects(
    assetId: string,
    projectIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.attachmentsService.bulkReplaceProjects(assetId, projectIds, tenantId, userId, opts);
  }
}
