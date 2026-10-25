import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Asset } from '../asset.entity';
import { AssetSupportInfo } from '../asset-support-info.entity';
import { AssetSupportContact } from '../asset-support-contact.entity';
import { ExternalContact } from '../../contacts/external-contact.entity';
import { AuditService } from '../../audit/audit.service';
import { isLimitedTransaction } from '../../data-access/line-write-checks';
import { assertContractReadable } from '../../data-access/contract-write-checks';
import { AssetsBaseService, ServiceOpts } from './assets-base.service';

/**
 * Service for managing asset support information and contacts.
 */
@Injectable()
export class AssetsSupportService extends AssetsBaseService {
  constructor(
    @InjectRepository(Asset) assetRepo: Repository<Asset>,
    @InjectRepository(AssetSupportInfo) private readonly supportInfoRepo: Repository<AssetSupportInfo>,
    @InjectRepository(AssetSupportContact) private readonly supportContactsRepo: Repository<AssetSupportContact>,
    private readonly audit: AuditService,
  ) {
    super(assetRepo);
  }

  private getSupportInfoRepo(opts?: ServiceOpts) {
    return opts?.manager ? opts.manager.getRepository(AssetSupportInfo) : this.supportInfoRepo;
  }

  private getSupportContactsRepo(opts?: ServiceOpts) {
    return opts?.manager ? opts.manager.getRepository(AssetSupportContact) : this.supportContactsRepo;
  }

  // =========================================================================
  // Support Info Methods
  // =========================================================================

  /**
   * Get support information for an asset.
   */
  async getSupportInfo(assetId: string, opts?: ServiceOpts) {
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, opts?.manager, tenantId);
    const repo = this.getSupportInfoRepo(opts);
    const info = await repo.findOne({ where: { asset_id: assetId, tenant_id: tenantId } as any });
    return this.concealSupportContract(opts?.manager ?? repo.manager, info);
  }

  /**
   * The support contract of an asset (spec §5.4 "Champ simple"): a limited person who cannot read
   * it gets neither its id nor its name, and `support_contract_hidden` for the label. The same
   * answer on a write, as on the GET.
   */
  private async concealSupportContract(manager: EntityManager, info: AssetSupportInfo | null) {
    if (!info?.support_contract_id) return info;
    if (!(await isLimitedTransaction(manager))) return info;
    const [row]: Array<{ visible: boolean }> = await manager.query(
      `SELECT data_access_contract_visible($1::uuid) AS visible`, [info.support_contract_id],
    );
    if (row?.visible === true) return info;
    return { ...info, support_contract_id: null, support_contract_hidden: true };
  }

  /**
   * Create or update support information for an asset.
   */
  async upsertSupportInfo(
    assetId: string,
    data: Partial<AssetSupportInfo>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const tenant = this.ensureTenantId(tenantId);
    const asset = await this.ensureAsset(assetId, opts?.manager, tenant);
    const repo = this.getSupportInfoRepo(opts);
    const manager = opts?.manager ?? repo.manager;

    let existing = await repo.findOne({ where: { asset_id: assetId, tenant_id: tenant } as any });
    const before = existing ? { ...existing } : null;

    // Setting or changing the support contract is a link to it: a limited person links only a
    // contract they can read, and a hidden one answers as a missing one (the same 404), never the
    // foreign key's 409. A hidden contract already stored stays when the field does not change.
    const nextContract = data.support_contract_id === undefined ? undefined : this.normalizeNullable(data.support_contract_id);
    const storedContract = existing?.support_contract_id ?? null;
    const contractChanged = nextContract !== undefined
      && (nextContract?.toLowerCase() ?? null) !== (storedContract?.toLowerCase() ?? null);
    if (contractChanged) await assertContractReadable(manager, nextContract);

    if (existing) {
      if (data.vendor_id !== undefined) existing.vendor_id = this.normalizeNullable(data.vendor_id);
      if (nextContract !== undefined) existing.support_contract_id = nextContract;
      if (data.support_tier !== undefined) existing.support_tier = this.normalizeNullable(data.support_tier);
      if (data.support_expiry !== undefined) existing.support_expiry = data.support_expiry;
      if (data.notes !== undefined) existing.notes = this.normalizeNullable(data.notes);
      existing.updated_at = new Date();
    } else {
      existing = repo.create({
        tenant_id: asset.tenant_id,
        asset_id: assetId,
        vendor_id: this.normalizeNullable(data.vendor_id),
        support_contract_id: nextContract ?? null,
        support_tier: this.normalizeNullable(data.support_tier),
        support_expiry: data.support_expiry ?? null,
        notes: this.normalizeNullable(data.notes),
      });
    }

    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'asset_support_info', recordId: saved.id, action: before ? 'update' : 'create', before, after: saved, userId },
      { manager: opts?.manager },
    );
    return this.concealSupportContract(manager, saved);
  }

  /**
   * Delete support information for an asset.
   */
  async deleteSupportInfo(assetId: string, userId: string | null, opts?: ServiceOpts) {
    const repo = this.getSupportInfoRepo(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, opts?.manager, tenantId);
    const existing = await repo.findOne({ where: { asset_id: assetId, tenant_id: tenantId } as any });
    if (existing) {
      await repo.delete({ asset_id: assetId, tenant_id: tenantId } as any);
      await this.audit.log(
        { table: 'asset_support_info', recordId: existing.id, action: 'delete', before: existing, after: null, userId },
        { manager: opts?.manager },
      );
    }
  }

  // =========================================================================
  // Support Contacts Methods
  // =========================================================================

  /**
   * List support contacts for an asset.
   */
  async listSupportContacts(assetId: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureAsset(assetId, mg, tenantId);

    const rows = await mg.query(
      `SELECT sc.id, sc.contact_id, sc.role, c.first_name, c.last_name, c.email, c.phone, c.mobile
       FROM asset_support_contacts sc
       JOIN contacts c ON c.id = sc.contact_id
       WHERE sc.asset_id = $1 AND sc.tenant_id = $2 AND c.tenant_id = $2
       ORDER BY sc.created_at ASC, sc.id ASC`,
      [assetId, tenantId],
    );

    return (rows as any[]).map((r) => ({
      id: r.id,
      contact_id: r.contact_id,
      role: r.role,
      contact: {
        id: r.contact_id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        phone: r.phone,
        mobile: r.mobile,
      },
    }));
  }

  /**
   * Bulk replace support contacts for an asset.
   */
  async bulkReplaceSupportContacts(
    assetId: string,
    contacts: Array<{ contact_id: string; role?: string | null }>,
    tenantId: string,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const tenant = this.ensureTenantId(tenantId);
    const asset = await this.ensureAsset(assetId, mg, tenant);
    const repo = this.getSupportContactsRepo(opts);

    const filtered = (contacts || [])
      .map((c) => ({ contact_id: String(c.contact_id || '').trim(), role: (c.role ?? '').toString().trim() || null }))
      .filter((c) => !!c.contact_id);

    if (filtered.length) {
      const uniqueIds = Array.from(new Set(filtered.map((c) => c.contact_id)));
      const found = await mg.getRepository(ExternalContact).find({ where: { id: In(uniqueIds) } as any });
      if (found.length !== uniqueIds.length) throw new BadRequestException('One or more contacts not found');
      const invalid = found.find((c) => (c as any).tenant_id !== asset.tenant_id);
      if (invalid) throw new BadRequestException('Contact does not belong to tenant');
    }

    const existing = await repo.find({ where: { asset_id: assetId, tenant_id: asset.tenant_id } as any });
    if (existing.length) await repo.delete({ id: In(existing.map((x) => x.id)) as any });
    if (filtered.length) {
      const rows = filtered.map((c) => repo.create({ tenant_id: asset.tenant_id, asset_id: assetId, contact_id: c.contact_id, role: c.role }));
      await repo.save(rows);
    }

    return this.listSupportContacts(assetId, { manager: mg, tenantId: tenant });
  }
}
