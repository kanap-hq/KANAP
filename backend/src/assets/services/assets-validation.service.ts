import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { findCatalogOption } from '../../it-ops-settings/catalog-resolve';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { assetBadRequest, assetFqdnOf } from '../asset-rules';
import { isValidHostname } from '../hostname.util';
import { isValidIpAddress } from '../ip-address.util';

/**
 * Service for validating asset fields against IT Ops settings.
 */
@Injectable()
export class AssetsValidationService {
  constructor(private readonly itOpsSettings: ItOpsSettingsService) {}

  normalizeNullable(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  async resolveKind(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const code = String(value || '').trim().toLowerCase();
    if (!code) {
      throw new BadRequestException('kind is required');
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.serverKinds || []).map((o) => o.code));
    if (!allowed.has(code)) {
      throw new BadRequestException(`Invalid kind "${value}"`);
    }
    return code;
  }

  async resolveProvider(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const code = String(value || '').trim().toLowerCase();
    if (!code) {
      throw new BadRequestException('provider is required');
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set((settings.serverProviders || []).map((o) => o.code));
    if (!allowed.has(code)) {
      throw new BadRequestException(`Invalid provider "${value}"`);
    }
    return code;
  }

  /**
   * The provider the screen stores when the site changes and the request does not name one.
   * A cloud site keeps its provider when that code is in the catalog. Anything else, including an
   * on-premises site, falls back to `other`, or to the first provider when `other` is absent.
   */
  async providerForSite(locationId: string, tenantId: string, manager: EntityManager): Promise<string | null> {
    const rows: Array<{ hosting_type: string | null; provider: string | null }> = await manager.query(
      `SELECT hosting_type, provider
       FROM locations
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [locationId, tenantId],
    );
    const site = rows[0];
    if (!site) return null;
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const hosting = (settings.hostingTypes || []).find((item) => item.code === site.hosting_type);
    const onPrem = hosting?.category === 'on_prem';
    const providers = settings.serverProviders || [];
    const fallback = providers.find((item) => item.code === 'other')?.code || providers[0]?.code || null;
    if (!onPrem) {
      const code = String(site.provider || '').trim().toLowerCase();
      if (code && providers.some((item) => item.code === code)) return code;
    }
    return fallback;
  }

  async resolveDomain(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const normalized = this.normalizeNullable(value);
    if (!normalized) return null;
    const code = normalized.toLowerCase();
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = new Set(((settings as any).domains || []).map((d: any) => d.code));
    if (!allowed.has(code)) {
      throw new BadRequestException(`Invalid domain "${value}"`);
    }
    return code;
  }

  async resolveAdminZone(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const normalized = this.normalizeNullable(value);
    if (!normalized) return null;
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const option = findCatalogOption(normalized, settings.adminZones || []);
    if (!option) {
      throw new BadRequestException(`Unknown administration zone: ${normalized}.`);
    }
    return option.code;
  }

  validateHostname(value: string | null): boolean {
    if (!value) return true;
    const hostname = value.trim();
    if (hostname.length === 0) return true;
    return isValidHostname(hostname);
  }

  async computeFqdn(
    hostname: string | null,
    domainCode: string | null,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    if (!hostname || !hostname.trim()) return null;
    if (!domainCode || domainCode === 'workgroup' || domainCode === 'n-a') {
      return assetFqdnOf(hostname, { code: domainCode });
    }

    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const domain = ((settings as any).domains || []).find((d: any) => d.code === domainCode);
    return assetFqdnOf(hostname, { code: domainCode, dns_suffix: domain?.dns_suffix });
  }

  normalizeAliases(value: unknown): string[] | null {
    if (!value) return null;
    if (!Array.isArray(value)) return null;
    const aliases = value
      .map((v) => String(v || '').trim().toLowerCase())
      .filter((v) => v.length > 0);
    return aliases.length > 0 ? aliases : null;
  }

  ipBelongsToSubnet(ip: string, cidr: string): boolean {
    try {
      const [networkAddr, prefixStr] = cidr.split('/');
      const prefix = parseInt(prefixStr, 10);
      if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

      const ipToInt = (addr: string): number => {
        const parts = addr.split('.').map(Number);
        if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
          return -1;
        }
        return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
      };

      const ipInt = ipToInt(ip);
      const networkInt = ipToInt(networkAddr);
      if (ipInt === -1 || networkInt === -1) return false;

      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      return ((ipInt >>> 0) & mask) === ((networkInt >>> 0) & mask);
    } catch {
      return false;
    }
  }

  async validateIpAddresses(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    excludeAssetId?: string,
  ): Promise<Array<{ type: string; ip: string; subnet_cidr: string | null }> | null> {
    if (value == null) return null;
    if (!Array.isArray(value)) return null;

    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowedTypes = new Set((settings.ipAddressTypes || []).map((t) => t.code));
    const allowedSubnets = new Set((settings.subnets || []).map((s) => s.cidr));

    const normalized: Array<{ type: string; ip: string; subnet_cidr: string | null }> = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const type = String((item as any).type || '').trim().toLowerCase();
      const ip = String((item as any).ip || '').trim();
      const subnet_cidr = (item as any).subnet_cidr ? String((item as any).subnet_cidr).trim() : null;

      if (!ip) continue;

      if (!isValidIpAddress(ip)) {
        throw assetBadRequest('asset_ip_invalid', `"${ip}" is not a valid IP address.`, { value: ip });
      }

      if (!type || !allowedTypes.has(type)) {
        throw new BadRequestException(`Invalid IP address type "${type}"`);
      }

      if (subnet_cidr && !allowedSubnets.has(subnet_cidr)) {
        throw new BadRequestException(`Invalid subnet "${subnet_cidr}"`);
      }

      if (subnet_cidr && !this.ipBelongsToSubnet(ip, subnet_cidr)) {
        throw new BadRequestException(
          `IP address "${ip}" does not belong to subnet "${subnet_cidr}"`,
        );
      }

      normalized.push({ type, ip, subnet_cidr: subnet_cidr || null });
    }

    if (normalized.length > 0 && manager) {
      await this.checkDuplicateIps(normalized, tenantId, manager, excludeAssetId);
    }

    return normalized.length > 0 ? normalized : null;
  }

  private async checkDuplicateIps(
    entries: Array<{ ip: string; subnet_cidr: string | null }>,
    tenantId: string,
    manager: EntityManager,
    excludeAssetId?: string,
  ): Promise<void> {
    const withSubnet = entries.filter((e) => e.subnet_cidr != null);
    if (withSubnet.length === 0) return;

    for (const entry of withSubnet) {
      const rows: Array<{ id: string; name: string }> = await manager.query(
        `SELECT a.id, a.name
         FROM assets a, jsonb_array_elements(a.ip_addresses) AS elem
         WHERE a.tenant_id = $1
           AND ($2::uuid IS NULL OR a.id != $2)
           AND elem->>'ip' = $3
           AND elem->>'subnet_cidr' = $4
         LIMIT 1`,
        [tenantId, excludeAssetId || null, entry.ip, entry.subnet_cidr],
      );

      if (rows.length > 0) {
        throw assetBadRequest(
          'asset_ip_taken',
          `IP address "${entry.ip}" is already used by asset "${rows[0].name}" in subnet "${entry.subnet_cidr}"`,
          { value: entry.ip, name: rows[0].name, subnet: entry.subnet_cidr as string },
        );
      }
    }
  }

  async normalizeLifecycleStatus(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
    fallback: string = 'active',
  ): Promise<string> {
    const settings = await this.itOpsSettings.getSettingsForWrite(tenantId, manager);
    const allowed = (settings.lifecycleStates || []).map((item) => item.code);
    const fallbackCode = this.pickLifecycleFallback(fallback, allowed);
    if (value === undefined || value === null || String(value).trim() === '') {
      return fallbackCode;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`Invalid lifecycle "${value}"`);
    }
    return normalized;
  }

  private pickLifecycleFallback(candidate: string | undefined, allowed: string[]): string {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (normalized && allowed.includes(normalized)) {
      return normalized;
    }
    if (allowed.includes('active')) {
      return 'active';
    }
    return allowed[0] || 'active';
  }
}
