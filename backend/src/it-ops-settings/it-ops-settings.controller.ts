import { CLASSIFICATION_CATALOG_KEYS } from './classification-catalog';
import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ItOpsSettings, ItOpsSettingsService } from './it-ops-settings.service';

type FieldReader = (row: any) => unknown;
/** A code may be absent: the server generates it from the name (absent code = new entry). */
const code: FieldReader = (row) => row.code === undefined || row.code === null ? undefined : String(row.code).trim().toLowerCase();
const label: FieldReader = (row) => String(row.label ?? '').trim();
const deprecated: FieldReader = (row) => !!row.deprecated;
const text = (name: string, fallback?: string): FieldReader => (row) => {
  const value = row[name] ?? (fallback ? row[fallback] : undefined);
  return value === undefined || value === null ? undefined : String(value).trim();
};
const translations: FieldReader = (row) => row.translations === undefined || row.translations === null ? undefined : row.translations;
const base = { code, label, deprecated, translations };
const tiered = { ...base, graph_tier: (row: any) => row.graph_tier };

/** Fields accepted per list on PATCH; anything else in the body is ignored. */
const LIST_FIELDS: Record<string, Record<string, FieldReader>> = {
  applicationCategories: base, networkSegments: base, serverProviders: base, lifecycleStates: base,
  interfaceProtocols: base, interfaceDataCategories: base, interfaceTriggerTypes: base, interfacePatterns: base,
  interfaceFormats: base, interfaceAuthModes: base, ipAddressTypes: base, accessMethods: base, pathHopFunctions: base, incidentCategories: base, technologyFamilies: base,
  entities: tiered, serverRoles: tiered,
  serverKinds: { ...base, is_physical: (row) => row.is_physical === undefined ? undefined : !!row.is_physical },
  hostingTypes: { ...base, category: (row) => row.category === 'on_prem' || row.category === 'cloud' ? row.category : undefined },
  operatingSystems: { ...base, standardSupportEnd: text('standardSupportEnd', 'standard_support_end'), extendedSupportEnd: text('extendedSupportEnd', 'extended_support_end') },
  connectionTypes: { ...base, category: text('category'), typicalPorts: text('typicalPorts', 'typical_ports') },
  domains: {
    ...base, dns_suffix: (row) => String(row.dns_suffix ?? '').trim().toLowerCase(), system: (row) => !!row.system,
    forest: text('forest'), account_count: (row) => row.account_count, machine_count: (row) => row.machine_count,
    trusts: (row) => Array.isArray(row.trusts) ? row.trusts.map((trust: any) => ({ domain: trust?.domain, direction: trust?.direction })) : row.trusts,
  },
  adminZones: { ...base, admin_group: text('admin_group'), privilege_level: text('privilege_level'), secrets_location: text('secrets_location'), description: text('description') },
  subnets: {
    location_id: (row) => String(row.location_id ?? '').trim(), cidr: (row) => String(row.cidr ?? '').trim(), vlan_number: (row) => row.vlan_number,
    network_zone: (row) => String(row.network_zone ?? '').trim().toLowerCase(), description: (row) => row.description, deprecated,
  },
};

@UseGuards(JwtAuthGuard)
@Controller('it-ops')
export class ItOpsSettingsController {
  constructor(private readonly settings: ItOpsSettingsService) {}

  private requireTenantId(req: any): string {
    const tenantId: string | undefined = req?.tenant?.id;
    if (!tenantId) {
      throw new Error('Tenant context is required for IT Ops settings');
    }
    return tenantId;
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('settings', 'reader')
  @Get('settings')
  async getSettings(@Req() req: any): Promise<ItOpsSettings> {
    const tenantId = this.requireTenantId(req);
    return this.settings.getSettings(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('settings', 'admin')
  @Patch('settings')
  async updateSettings(@Body() body: any, @Req() req: any): Promise<ItOpsSettings> {
    const tenantId = this.requireTenantId(req);
    const patch: Partial<ItOpsSettings> = {};
    for (const [key, fields] of Object.entries(LIST_FIELDS)) {
      if (!Array.isArray(body?.[key])) continue;
      (patch as any)[key] = body[key].map((row: any) => {
        const mapped: Record<string, unknown> = {};
        for (const [field, read] of Object.entries(fields)) {
          const value = read(row ?? {});
          if (value !== undefined) mapped[field] = value;
        }
        return mapped;
      });
    }
    for (const key of CLASSIFICATION_CATALOG_KEYS) if (body?.[key] !== undefined) (patch as any)[key] = body[key];
    return this.settings.updateSettings(tenantId, patch, { manager: req?.queryRunner?.manager, userId: req.user?.sub ?? req.user?.id });
  }

  /** Records referencing one catalog value; the same counts protect removal on PATCH. */
  @UseGuards(PermissionGuard)
  @RequireLevel('settings', 'reader')
  @Get('settings/usage')
  async getUsage(@Query('list') list: string, @Query('code') code: string | undefined, @Query('location_id') locationId: string | undefined, @Query('cidr') cidr: string | undefined, @Req() req: any) {
    const tenantId = this.requireTenantId(req);
    const key = list === 'subnets' ? { location_id: String(locationId ?? ''), cidr: String(cidr ?? '') } : { code: String(code ?? '').trim().toLowerCase() };
    return this.settings.getCatalogUsage(tenantId, String(list ?? ''), key, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('settings', 'admin')
  @Post('settings/reset')
  async resetSettings(@Req() req: any): Promise<ItOpsSettings> {
    const tenantId = this.requireTenantId(req);
    return this.settings.resetToDefaults(tenantId, { manager: req?.queryRunner?.manager, userId: req.user?.sub ?? req.user?.id });
  }
}
