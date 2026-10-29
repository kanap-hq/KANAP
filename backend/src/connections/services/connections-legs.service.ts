import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Connection } from '../connection.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { Asset } from '../../assets/asset.entity';
import { AuditService } from '../../audit/audit.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { ConnectionsBaseService, ServiceOpts } from './connections-base.service';

/**
 * Service for managing connection path hops (per-hop CRUD).
 * A "hop" is one intermediary in the network path between the connection's
 * source and destination (NAT, VIP, WAF, reverse proxy, etc.).
 */
@Injectable()
export class ConnectionsLegsService extends ConnectionsBaseService {
  constructor(
    @InjectRepository(Connection) connRepo: Repository<Connection>,
    @InjectRepository(ConnectionServer) connServers: Repository<ConnectionServer>,
    @InjectRepository(ConnectionProtocol) connProtocols: Repository<ConnectionProtocol>,
    @InjectRepository(ConnectionLeg) connLegs: Repository<ConnectionLeg>,
    @InjectRepository(Asset) assets: Repository<Asset>,
    itOpsSettings: ItOpsSettingsService,
    private readonly audit: AuditService,
  ) {
    super(connRepo, connServers, connProtocols, connLegs, assets, itOpsSettings);
  }

  async listLegs(connectionId: string, tenantId: string, opts?: ServiceOpts) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = opts?.manager ?? this.connRepo.manager;
    await this.ensureConnection(connectionId, mg);
    const legRepo = this.getLegRepo(mg);
    const legs = await legRepo.find({
      where: { connection_id: connectionId, tenant_id: tenant } as any,
      order: { order_index: 'ASC', created_at: 'ASC' },
    });
    return this.attachEquipmentAssets(legs, tenant, mg);
  }

  /**
   * Append a new hop at the end of the path. No DB cap; UI shows a soft warning past 5 hops.
   */
  async createLeg(
    connectionId: string,
    tenantId: string,
    body: any,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = opts?.manager ?? this.connRepo.manager;
    await this.ensureConnection(connectionId, mg);

    const legRepo = this.getLegRepo(mg);
    const existing = await legRepo.find({
      where: { connection_id: connectionId, tenant_id: tenant } as any,
      order: { order_index: 'ASC' },
    });

    const usedOrders = new Set(existing.map((l) => l.order_index));
    const maxOrder = existing.reduce((m, l) => Math.max(m, l.order_index), 0);
    const requestedOrder = body?.order_index != null
      ? this.normalizeLegOrderIndex(body.order_index)
      : maxOrder + 1;
    if (usedOrders.has(requestedOrder)) {
      throw new BadRequestException(`Hop order ${requestedOrder} already exists for this connection`);
    }

    const function_code = await this.normalizeHopFunctionCode(body?.function_code, tenant, mg);
    const protocol_codes = await this.normalizeLegProtocols(
      body?.protocol_codes ?? body?.protocol_code,
      tenant,
      mg,
    );
    const equipment = await this.normalizeHopEquipment(
      {
        equipment_asset_id: body?.equipment_asset_id ?? body?.equipment_server_id,
        equipment_entity_code: body?.equipment_entity_code,
      },
      tenant,
      mg,
    );

    const row = legRepo.create({
      tenant_id: tenant,
      connection_id: connectionId,
      order_index: requestedOrder,
      function_code,
      protocol_codes,
      port_override: this.normalizeNullable(body?.port_override),
      notes: this.normalizeNullable(body?.notes),
      ...equipment,
    });
    const saved = await legRepo.save(row);

    await this.audit.log(
      {
        table: 'connection_legs',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    const [leg] = await this.attachEquipmentAssets([saved], tenant, mg);
    return leg;
  }

  /**
   * Patch a single hop with a partial payload.
   */
  async updateLeg(
    connectionId: string,
    legId: string,
    tenantId: string,
    body: any,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = opts?.manager ?? this.connRepo.manager;
    await this.ensureConnection(connectionId, mg);

    const legRepo = this.getLegRepo(mg);
    const leg = await legRepo.findOne({
      where: { id: legId, connection_id: connectionId, tenant_id: tenant } as any,
    });
    if (!leg) throw new NotFoundException('Connection hop not found');
    const before = { ...leg };

    if (body?.hasOwnProperty('order_index')) {
      const nextOrder = this.normalizeLegOrderIndex(body.order_index);
      if (nextOrder !== leg.order_index) {
        const conflict = await legRepo.findOne({
          where: { connection_id: connectionId, tenant_id: tenant, order_index: nextOrder } as any,
        });
        if (conflict && conflict.id !== leg.id) {
          throw new BadRequestException(`Hop order ${nextOrder} already exists for this connection`);
        }
        leg.order_index = nextOrder;
      }
    }

    if (body?.hasOwnProperty('function_code')) {
      leg.function_code = await this.normalizeHopFunctionCode(body.function_code, tenant, mg);
    }

    if (body?.hasOwnProperty('protocol_codes') || body?.hasOwnProperty('protocol_code')) {
      leg.protocol_codes = await this.normalizeLegProtocols(
        body.protocol_codes ?? body.protocol_code,
        tenant,
        mg,
      );
    }

    if (body?.hasOwnProperty('port_override')) {
      leg.port_override = this.normalizeNullable(body.port_override);
    }

    if (body?.hasOwnProperty('notes')) {
      leg.notes = this.normalizeNullable(body.notes);
    }

    const equipmentTouched =
      body?.hasOwnProperty('equipment_asset_id') ||
      body?.hasOwnProperty('equipment_server_id') ||
      body?.hasOwnProperty('equipment_entity_code');
    if (equipmentTouched) {
      const equipment = await this.normalizeHopEquipment(
        {
          equipment_asset_id: body.hasOwnProperty('equipment_asset_id') || body.hasOwnProperty('equipment_server_id')
            ? body.equipment_asset_id ?? body.equipment_server_id
            : leg.equipment_asset_id,
          equipment_entity_code: body.hasOwnProperty('equipment_entity_code')
            ? body.equipment_entity_code
            : leg.equipment_entity_code,
        },
        tenant,
        mg,
      );
      leg.equipment_asset_id = equipment.equipment_asset_id;
      leg.equipment_entity_code = equipment.equipment_entity_code;
    }

    leg.updated_at = new Date();
    const saved = await legRepo.save(leg);

    await this.audit.log(
      {
        table: 'connection_legs',
        recordId: legId,
        action: 'update',
        before,
        after: saved,
        userId,
      },
      { manager: mg },
    );

    const [legWithEquipment] = await this.attachEquipmentAssets([saved], tenant, mg);
    return legWithEquipment;
  }

  /**
   * Swap two hops' order_index (used by the UI's move-up/down arrows).
   * The frontend sends `{ swap_with_leg_id: string }` to atomically reorder.
   */
  async reorderLegSwap(
    connectionId: string,
    legId: string,
    swapWithLegId: string,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = opts?.manager ?? this.connRepo.manager;
    await this.ensureConnection(connectionId, mg);
    if (legId === swapWithLegId) {
      throw new BadRequestException('Cannot swap a hop with itself');
    }
    const legRepo = this.getLegRepo(mg);
    const a = await legRepo.findOne({
      where: { id: legId, connection_id: connectionId, tenant_id: tenant } as any,
    });
    const b = await legRepo.findOne({
      where: { id: swapWithLegId, connection_id: connectionId, tenant_id: tenant } as any,
    });
    if (!a || !b) throw new NotFoundException('One of the hops to swap was not found');
    const before = [{ ...a }, { ...b }];

    // Two-step swap to avoid the unique-index conflict on (tenant_id, connection_id, order_index).
    const orderA = a.order_index;
    const orderB = b.order_index;
    a.order_index = -Math.abs(orderA) - 1000; // temporary negative slot
    await legRepo.save(a);
    b.order_index = orderA;
    await legRepo.save(b);
    a.order_index = orderB;
    await legRepo.save(a);

    await this.audit.log(
      {
        table: 'connection_legs',
        recordId: legId,
        action: 'update',
        before,
        after: [{ id: a.id, order_index: a.order_index }, { id: b.id, order_index: b.order_index }],
        userId,
        // The swap writes two legs and no `connection_id` key: hand the parent.
        parent: { table: 'connections', id: connectionId },
      },
      { manager: mg },
    );

    return { a: { id: a.id, order_index: a.order_index }, b: { id: b.id, order_index: b.order_index } };
  }

  async deleteLeg(
    connectionId: string,
    legId: string,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const mg = opts?.manager ?? this.connRepo.manager;
    await this.ensureConnection(connectionId, mg);
    const legRepo = this.getLegRepo(mg);
    const leg = await legRepo.findOne({
      where: { id: legId, connection_id: connectionId, tenant_id: tenant } as any,
    });
    if (!leg) throw new NotFoundException('Connection hop not found');
    await legRepo.delete(legId);
    await this.audit.log(
      {
        table: 'connection_legs',
        recordId: legId,
        action: 'delete',
        before: leg,
        after: null,
        userId,
      },
      { manager: mg },
    );
    return { success: true };
  }

  async deleteLegsForConnection(connectionId: string, opts?: ServiceOpts) {
    const legRepo = this.getLegRepo(opts?.manager);
    await legRepo.delete({ connection_id: connectionId } as any);
  }
}
