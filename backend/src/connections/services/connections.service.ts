import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ConnectionsListService } from './connections-list.service';
import { ConnectionsCrudService } from './connections-crud.service';
import { ConnectionsLegsService } from './connections-legs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ShareItemDto } from '../../notifications/dto/share-item.dto';

/**
 * Options for service methods.
 */
export interface ServiceOpts {
  manager?: EntityManager;
}

/**
 * Main facade service for connections that delegates to specialized sub-services.
 */
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly listService: ConnectionsListService,
    private readonly crudService: ConnectionsCrudService,
    private readonly legsService: ConnectionsLegsService,
    private readonly notifications: NotificationsService,
  ) {}

  // List Operations
  list(tenantId: string, query: any, opts?: ServiceOpts) {
    return this.listService.list(tenantId, query, opts);
  }

  listIds(tenantId: string, query: any, opts?: ServiceOpts) {
    return this.listService.listIds(tenantId, query, opts);
  }

  effectiveRiskByIds(tenantId: string, ids: string[], opts?: ServiceOpts) {
    return this.listService.effectiveRiskByIds(tenantId, ids, opts);
  }

  listFilterValues(tenantId: string, query: { fields?: string }, opts?: ServiceOpts) {
    return this.listService.listFilterValues(tenantId, query, opts);
  }

  listByAsset(assetId: string, tenantId: string, opts?: ServiceOpts) {
    return this.listService.listByAsset(assetId, tenantId, opts);
  }

  listByServer(serverId: string, tenantId: string, opts?: ServiceOpts) {
    return this.listService.listByServer(serverId, tenantId, opts);
  }

  listInterfaceLinks(connectionId: string, tenantId: string, opts?: ServiceOpts) {
    return this.listService.listInterfaceLinks(connectionId, tenantId, opts);
  }

  listInterfaceLinkOptions(connectionId: string, tenantId: string, query: any, opts?: ServiceOpts) {
    return this.listService.listInterfaceLinkOptions(connectionId, tenantId, query, opts);
  }

  bulkLinkInterfaceBindings(
    connectionId: string,
    tenantId: string,
    bindingIds: string[],
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.listService.bulkLinkInterfaceBindings(connectionId, tenantId, bindingIds, userId, opts);
  }

  map(tenantId: string, query: any, opts?: ServiceOpts) {
    return this.listService.map(tenantId, query, opts);
  }

  // CRUD Operations
  get(id: string, tenantId: string, opts?: ServiceOpts & { includeLegs?: boolean }) {
    return this.crudService.get(id, tenantId, opts);
  }

  create(body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.create(body, tenantId, userId, opts);
  }

  update(id: string, body: any, tenantId: string, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.update(id, body, tenantId, userId, opts);
  }

  delete(id: string, userId: string | null, opts?: ServiceOpts) {
    return this.crudService.delete(id, userId, opts);
  }

  bulkDelete(ids: string[], userId: string | null, opts?: ServiceOpts) {
    return this.crudService.bulkDelete(ids, userId, opts);
  }

  // Per-leg CRUD
  listLegs(connectionId: string, tenantId: string, opts?: ServiceOpts) {
    return this.legsService.listLegs(connectionId, tenantId, opts);
  }

  createLeg(connectionId: string, tenantId: string, body: any, userId: string | null, opts?: ServiceOpts) {
    return this.legsService.createLeg(connectionId, tenantId, body, userId, opts);
  }

  updateLeg(
    connectionId: string,
    legId: string,
    tenantId: string,
    body: any,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.legsService.updateLeg(connectionId, legId, tenantId, body, userId, opts);
  }

  deleteLeg(
    connectionId: string,
    legId: string,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.legsService.deleteLeg(connectionId, legId, tenantId, userId, opts);
  }

  reorderLegSwap(
    connectionId: string,
    legId: string,
    swapWithLegId: string,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    return this.legsService.reorderLegSwap(connectionId, legId, swapWithLegId, tenantId, userId, opts);
  }

  deleteLegsForConnection(connectionId: string, opts?: ServiceOpts) {
    return this.legsService.deleteLegsForConnection(connectionId, opts);
  }

  /**
   * Share a connection by email to a list of users and/or external addresses.
   */
  async shareConnection(
    connectionId: string,
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
    const conn: any = await this.get(connectionId, tenant, opts);
    if (!conn) throw new BadRequestException('Connection not found');
    const mg = opts?.manager ?? (this.crudService as any).connRepo.manager;

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
        itemType: 'connection',
        itemId: conn.id,
        itemName: conn.name,
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
}
