import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOperator, ILike, In, Raw, Repository } from 'typeorm';
import { Location } from './location.entity';
import { LocationUserContact } from './location-user-contact.entity';
import { LocationContactLink } from './location-contact.entity';
import { LocationLink } from './location-link.entity';
import { LocationSubItem } from './location-sub-item.entity';
import { buildWhereFromAgFilters, parsePagination } from '../common/pagination';
import { compileAgFilterCondition, createParamNameGenerator, assertSetFilterModes } from '../common/ag-grid-filtering';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { ItOpsSettings, ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { Company } from '../companies/company.entity';
import { Asset } from '../assets/asset.entity';
import { User } from '../users/user.entity';
import { ExternalContact } from '../contacts/external-contact.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';

type HostingCategory = 'on_prem' | 'cloud';

/** Identity an inventory synchronisation gives a sub-location it manages. */
export type SubItemExternal = { source: string; id: string; url: string | null };

export type SubItemOpts = {
  manager?: EntityManager;
  /** Written to the three external columns; never read from a request body. */
  external?: SubItemExternal;
  audit?: AuditSourceOptions;
};

/**
 * The Created column's filter, compiled as the connections list compiles it: a text filter
 * reads the timestamp as text. buildWhereFromAgFilters cannot take this column (ILIKE does
 * not apply to a timestamp).
 */
function createdAtFilter(filters: any): FindOperator<Date> | undefined {
  const model = filters && typeof filters === 'object' ? filters.created_at : undefined;
  if (!model) return undefined;
  const column = '__created_at__';
  const condition = compileAgFilterCondition(model, { expression: column, textExpression: `CAST(${column} AS TEXT)` }, createParamNameGenerator('locCreated'));
  if (!condition) return undefined;
  return Raw((alias) => condition.sql.split(column).join(alias), condition.params);
}

@Injectable()
export class LocationsService {
  constructor(
    @InjectRepository(Location) private readonly repo: Repository<Location>,
    private readonly audit: AuditService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Location) : this.repo;
  }

  private requireTenantId(tenantId?: string): string {
    const normalized = String(tenantId || '').trim();
    if (!normalized) {
      throw new BadRequestException('Tenant context is required');
    }
    return normalized;
  }

  private normalizeNullable(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  }

  private normalizeRequired(value: unknown, fieldLabel: string): string {
    const text = String(value ?? '').trim();
    if (!text) {
      throw new BadRequestException(`${fieldLabel} is required`);
    }
    return text;
  }

  private async resolveLocationIdentifier(
    identifier: string,
    opts?: { manager?: EntityManager; tenantId?: string },
  ): Promise<string> {
    const normalized = String(identifier || '').trim();
    if (!normalized) throw new NotFoundException('Location not found');

    const uuidMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
    const referenceMatch = normalized.match(/^(LOC-\d+)(?:-.+)?$/i);
    if (!uuidMatch && !referenceMatch) {
      throw new NotFoundException('Location not found');
    }

    const mg = opts?.manager ?? this.repo.manager;
    const tenantId = String(opts?.tenantId || '').trim();
    const whereTenant = tenantId ? 'tenant_id = $2' : 'tenant_id = app_current_tenant()';
    const lookupValue = uuidMatch ? normalized : referenceMatch?.[1] || normalized;
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT id::text AS id
       FROM locations
       WHERE ${uuidMatch ? 'id = $1' : 'upper(location_reference) = upper($1)'}
         AND ${whereTenant}
       LIMIT 1`,
      tenantId ? [lookupValue, tenantId] : [lookupValue],
    );
    const id = rows[0]?.id;
    if (!id) throw new NotFoundException('Location not found');
    return id;
  }

  private normalizeCountryIso(value: unknown): string | null {
    const normalized = this.normalizeNullable(value);
    if (!normalized) return null;
    if (normalized.length !== 2) {
      throw new BadRequestException('country_iso must be a 2-letter code');
    }
    return normalized.toUpperCase();
  }

  private async ensureUniqueName(
    value: string,
    tenantId: string,
    excludeId: string | null,
    manager?: EntityManager,
  ) {
    const mg = manager ?? this.repo.manager;
    const rows = await mg.query(
      `SELECT id FROM locations WHERE tenant_id = $3 AND lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
      [value, excludeId, tenantId],
    );
    if (rows && rows.length > 0) {
      throw new BadRequestException(`Name already exists`);
    }
  }

  private async resolveHostingType(
    value: unknown,
    tenantId: string,
    opts?: { manager?: EntityManager; settings?: ItOpsSettings },
  ): Promise<string> {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('hosting_type is required');
    }
    const settings =
      opts?.settings ?? (await this.itOpsSettings.getSettingsForWrite(tenantId, opts?.manager));
    const allowed = new Set((settings.hostingTypes || []).map((item) => item.code));
    if (!allowed.has(normalized)) {
      throw new BadRequestException(`Invalid hosting_type "${value}"`);
    }
    return normalized;
  }

  private async getHostingCategory(
    hostingType: string,
    tenantId: string,
    opts?: { manager?: EntityManager; settings?: ItOpsSettings },
  ): Promise<HostingCategory> {
    const settings =
      opts?.settings ?? (await this.itOpsSettings.getSettingsForWrite(tenantId, opts?.manager));
    const option = (settings.hostingTypes || []).find((item) => item.code === hostingType);
    return option?.category === 'on_prem' ? 'on_prem' : 'cloud';
  }

  private async resolveProvider(
    value: unknown,
    tenantId: string,
    opts?: { manager?: EntityManager; settings?: ItOpsSettings },
  ): Promise<string | null> {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text) return null;
    const normalized = text.toLowerCase();
    const settings =
      opts?.settings ?? (await this.itOpsSettings.getSettingsForWrite(tenantId, opts?.manager));
    const allowed = new Set((settings.serverProviders || []).map((item) => item.code));
    if (!allowed.has(normalized)) {
      throw new BadRequestException(`Invalid provider "${value}"`);
    }
    return normalized;
  }

  private async resolveOperatingCompany(
    value: unknown,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<{ id: string; company: Company } | null> {
    const normalized = this.normalizeNullable(value);
    if (!normalized) return null;
    const mg = manager ?? this.repo.manager;
    const company = await mg.getRepository(Company).findOne({ where: { id: normalized, tenant_id: tenantId } as any });
    if (!company) {
      throw new BadRequestException('Operating company not found');
    }
    return { id: normalized, company };
  }

  private async loadLocationOrThrow(id: string, manager?: EntityManager): Promise<Location> {
    const repo = this.getRepo(manager);
    const location = await repo.findOne({ where: { id } });
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async list(query: any, opts?: { manager?: EntityManager; tenantId?: string }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, ['created_at']);
    const allowedFilters = ['location_reference', 'name', 'hosting_type', 'provider', 'country_iso', 'city'];
    const where: Record<string, any> = buildWhereFromAgFilters(filters, allowedFilters);
    const created = createdAtFilter(filters);
    if (created) where.created_at = created;
    // Explicit tenant_id filtering (defense-in-depth alongside RLS)
    if (opts?.tenantId) {
      where.tenant_id = opts.tenantId;
    }
    let whereArr: any[] | undefined;
    if (q) {
      const like = ILike(`%${q}%`);
      whereArr = [
        { ...where, location_reference: like },
        { ...where, name: like },
        { ...where, city: like },
        { ...where, region: like },
      ];
    }
    const allowedSortFields = ['location_reference', 'name', 'hosting_type', 'provider', 'country_iso', 'city', 'created_at'];
    const sortField = allowedSortFields.includes(sort.field) ? sort.field : 'created_at';
    const [rows, total] = await repo.findAndCount({
      where: whereArr ?? where,
      order: { [sortField]: sort.direction as any },
      skip,
      take: limit,
    });
    const mg = opts?.manager ?? repo.manager;
    const companyIds = Array.from(new Set(rows.map((row) => row.operating_company_id).filter(Boolean))) as string[];
    let companyMap: Record<string, string> = {};
    if (companyIds.length) {
      const companies = await mg.getRepository(Company).find({ where: { id: In(companyIds) } as any });
      companyMap = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    }
    const ids = rows.map((row) => row.id);
    let assetCounts: Record<string, number> = {};
    if (ids.length) {
      const tenantFilter = opts?.tenantId ? ` AND tenant_id = $2` : '';
      const countParams: any[] = [ids];
      if (opts?.tenantId) countParams.push(opts.tenantId);
      const rawCounts: Array<{ location_id: string; c: string }> = await mg.query(
        `SELECT location_id, COUNT(*)::text as c FROM assets WHERE location_id = ANY($1)${tenantFilter} GROUP BY location_id`,
        countParams,
      );
      assetCounts = Object.fromEntries(rawCounts.map((r) => [r.location_id, Number(r.c)]));
    }
    // Fetch sub-location names per location
    let subLocationMap: Record<string, string[]> = {};
    if (ids.length) {
      const tenantSubFilter = opts?.tenantId ? ` AND tenant_id = $2` : '';
      const subParams: any[] = [ids];
      if (opts?.tenantId) subParams.push(opts.tenantId);
      const subRows: Array<{ location_id: string; name: string }> = await mg.query(
        `SELECT location_id, name FROM location_sub_items WHERE location_id = ANY($1)${tenantSubFilter} ORDER BY name ASC`,
        subParams,
      );
      for (const r of subRows) {
        (subLocationMap[r.location_id] ??= []).push(r.name);
      }
    }
    const items = rows.map((row) => ({
      ...row,
      operating_company_name: row.operating_company_id ? companyMap[row.operating_company_id] ?? null : null,
      servers_count: assetCounts[row.id] ?? 0,
      sub_locations: subLocationMap[row.id] ?? [],
    }));
    return { items, total, page, limit };
  }

  async listIds(query: any, opts?: { manager?: EntityManager; tenantId?: string }): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const { sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, ['created_at']);
    const allowedFilters = ['location_reference', 'name', 'hosting_type', 'provider', 'country_iso', 'city'];
    const where: Record<string, any> = buildWhereFromAgFilters(filters, allowedFilters);
    const created = createdAtFilter(filters);
    if (created) where.created_at = created;
    if (opts?.tenantId) {
      where.tenant_id = opts.tenantId;
    }

    let whereArr: any[] | undefined;
    if (q) {
      const like = ILike(`%${q}%`);
      whereArr = [
        { ...where, location_reference: like },
        { ...where, name: like },
        { ...where, city: like },
        { ...where, region: like },
      ];
    }

    const allowedSortFields = ['location_reference', 'name', 'hosting_type', 'provider', 'country_iso', 'city', 'created_at'];
    const sortField = allowedSortFields.includes(sort.field) ? sort.field : 'created_at';
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const [rows, total] = await repo.findAndCount({
      where: whereArr ?? where,
      order: { [sortField]: sort.direction as any },
      take: limit,
      skip: 0,
      select: ['id', 'location_reference'],
    });
    const ids = rows.map((row) => row.id);
    const refs = rows.map((row) => row.location_reference || row.id);
    return { ids, refs, total };
  }

  async listFilterValues(query: any, opts?: { manager?: EntityManager; tenantId?: string }): Promise<Record<string, Array<string | null>>> {
    const tenantId = this.requireTenantId(opts?.tenantId);
    const mg = opts?.manager ?? this.repo.manager;
    const rawFields = String(query.fields || query.field || '').split(',').map((f: string) => f.trim()).filter(Boolean);

    const FILTER_VALUE_FIELDS: Record<string, string> = {
      hosting_type: 'hosting_type',
      provider: 'provider',
      country_iso: 'country_iso',
      city: 'city',
    };

    const fields = rawFields.filter((field: string) => Object.prototype.hasOwnProperty.call(FILTER_VALUE_FIELDS, field));
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | null>> = {};
    for (const field of fields) {
      const column = FILTER_VALUE_FIELDS[field];
      const rows: Array<{ value: string | null }> = await mg.query(
        `SELECT DISTINCT ${column} as value FROM locations WHERE tenant_id = $1 ORDER BY value ASC NULLS LAST`,
        [tenantId],
      );
      results[field] = rows.map((row) => row.value);
    }
    return results;
  }

  async get(id: string, opts?: { manager?: EntityManager; include?: string[]; tenantId?: string }) {
    const resolvedId = await this.resolveLocationIdentifier(id, opts);
    const repo = this.getRepo(opts?.manager);
    const where: Record<string, any> = { id: resolvedId };
    if (opts?.tenantId) {
      where.tenant_id = opts.tenantId;
    }
    const location = await repo.findOne({ where: where as any });
    if (!location) throw new NotFoundException('Location not found');
    const includeSet = new Set(
      (opts?.include ?? []).map((v) => String(v || '').trim()).filter((v) => !!v),
    );
    const result: any = { ...location };
    if (includeSet.has('internal_contacts')) {
      result.internal_contacts = await this.fetchInternalContacts(resolvedId, opts?.manager);
    }
    if (includeSet.has('external_contacts')) {
      result.external_contacts = await this.fetchExternalContacts(resolvedId, opts?.manager);
    }
    if (includeSet.has('links')) {
      result.links = await this.listLinks(resolvedId, { manager: opts?.manager });
    }
    return result;
  }

  async create(body: any, tenantId: string, userId: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const tenant = this.requireTenantId(tenantId);
    const repo = this.getRepo(opts?.manager);
    const mg = opts?.manager ?? repo.manager;
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const name = this.normalizeRequired(body.name, 'name');
    await this.ensureUniqueName(name, tenant, null, mg);
    const settings = await this.itOpsSettings.getSettingsForWrite(tenant, mg);
    const hostingType = await this.resolveHostingType(body.hosting_type, tenant, { manager: mg, settings });
    const category = await this.getHostingCategory(hostingType, tenant, { manager: mg, settings });
    const operatingCompany = category === 'on_prem' ? await this.resolveOperatingCompany(body.operating_company_id, tenant, mg) : null;
    let countryIso = this.normalizeCountryIso(body.country_iso);
    let city = this.normalizeNullable(body.city);
    if (category === 'on_prem' && operatingCompany?.company) {
      countryIso = countryIso ?? this.normalizeCountryIso(operatingCompany.company.country_iso);
      city = city ?? this.normalizeNullable(operatingCompany.company.city);
    }
    const provider = category === 'cloud' ? await this.resolveProvider(body.provider, tenant, { manager: mg, settings }) : null;
    const region = category === 'cloud' ? this.normalizeNullable(body.region) : null;
    const additionalInfo = this.normalizeNullable(body.additional_info);
    const entity = repo.create({
      name,
      hosting_type: hostingType,
      operating_company_id: operatingCompany?.id ?? null,
      country_iso: countryIso,
      city,
      provider,
      region,
      additional_info: additionalInfo,
    });
    const saved = await repo.save(entity);
    await this.audit.log(
      {
        table: 'locations',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: mg },
    );
    return saved;
  }

  async update(
    id: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager; audit?: AuditSourceOptions },
  ) {
    const tenant = this.requireTenantId(tenantId);
    const repo = this.getRepo(opts?.manager);
    const mg = opts?.manager ?? repo.manager;
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Location not found');
    const before = { ...existing };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    if (has('name')) {
      const name = this.normalizeRequired(body.name, 'name');
      await this.ensureUniqueName(name, tenant, existing.id, mg);
      existing.name = name;
    }
    const settings = await this.itOpsSettings.getSettingsForWrite(tenant, mg);
    let category = await this.getHostingCategory(existing.hosting_type, tenant, { manager: mg, settings });
    if (has('hosting_type')) {
      const nextType = await this.resolveHostingType(body.hosting_type, tenant, { manager: mg, settings });
      if (nextType !== existing.hosting_type) {
        existing.hosting_type = nextType;
        const nextCategory = await this.getHostingCategory(nextType, tenant, { manager: mg, settings });
        if (nextCategory !== category) {
          if (nextCategory === 'on_prem') {
            existing.provider = null;
            existing.region = null;
          } else {
            existing.operating_company_id = null;
          }
        }
        category = nextCategory;
      }
    }
    if (category === 'on_prem') {
      if (has('operating_company_id')) {
        const resolved = await this.resolveOperatingCompany(body.operating_company_id, tenant, mg);
        const prevCompany = existing.operating_company_id;
        existing.operating_company_id = resolved?.id ?? null;
        if (resolved?.company && resolved.id !== prevCompany) {
          if (!has('country_iso') && !existing.country_iso) {
            existing.country_iso = resolved.company.country_iso ?? null;
          }
          if (!has('city') && !existing.city) {
            existing.city = resolved.company.city ?? null;
          }
        }
      }
    } else {
      existing.operating_company_id = null;
    }

    if (category === 'cloud') {
      if (has('provider')) {
        existing.provider = await this.resolveProvider(body.provider, tenant, { manager: mg, settings });
      }
      if (has('region')) {
        existing.region = this.normalizeNullable(body.region);
      }
    } else {
      existing.provider = null;
      existing.region = null;
    }

    if (has('additional_info')) {
      existing.additional_info = this.normalizeNullable(body.additional_info);
    }

    if (has('country_iso')) {
      existing.country_iso = this.normalizeCountryIso(body.country_iso);
    }
    if (has('city')) {
      existing.city = this.normalizeNullable(body.city);
    }

    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      {
        table: 'locations',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: mg },
    );
    return saved;
  }

  async shareLocation(
    locationId: string,
    dto: ShareItemDto,
    tenantId: string,
    userId: string,
    opts?: { manager?: EntityManager },
  ) {
    const tenant = this.requireTenantId(tenantId);
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }
    const mg = opts?.manager ?? this.repo.manager;
    const location = await this.loadLocationOrThrow(locationId, opts?.manager);
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
        itemType: 'location',
        itemId: location.id,
        itemName: location.name,
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

  async delete(id: string, userId: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const mg = opts?.manager ?? repo.manager;
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Location not found');
    await mg
      .getRepository(Asset)
      .createQueryBuilder()
      .update(Asset)
      .set({ location_id: null, updated_at: () => 'now()' })
      .where('location_id = :id', { id })
      .execute();
    await repo.delete({ id } as any);
    await this.audit.log(
      { table: 'locations', recordId: id, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  async listInternalContacts(locationId: string, opts?: { manager?: EntityManager }) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    return this.fetchInternalContacts(locationId, opts?.manager);
  }

  private async fetchInternalContacts(locationId: string, manager?: EntityManager) {
    const mg = manager ?? this.repo.manager;
    const rows = await mg
      .getRepository(LocationUserContact)
      .find({ where: { location_id: locationId } as any, order: { created_at: 'DESC' as any } });
    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    let usersMap: Record<string, ReturnType<typeof this.serializeUser>> = {};
    if (userIds.length) {
      const users = await mg.getRepository(User).find({ where: { id: In(userIds) } as any });
      usersMap = Object.fromEntries(users.map((u) => [u.id, this.serializeUser(u)]));
    }
    return rows.map((row) => ({
      ...row,
      user: usersMap[row.user_id] ?? null,
    }));
  }

  async addInternalContact(
    locationId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const tenant = this.requireTenantId(tenantId);
    await this.loadLocationOrThrow(locationId, opts?.manager);
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const contactUserId = this.normalizeRequired(body.user_id, 'user_id');
    const role = this.normalizeNullable(body.role);
    const mg = opts?.manager ?? this.repo.manager;
    const user = await mg.getRepository(User).findOne({ where: { id: contactUserId, tenant_id: tenant } as any });
    if (!user) throw new BadRequestException('User not found');
    const repo = mg.getRepository(LocationUserContact);
    const existing = await repo.findOne({ where: { location_id: locationId, user_id: contactUserId } as any });
    if (existing) {
      throw new BadRequestException('User already linked to this location');
    }
    const entity = repo.create({ location_id: locationId, user_id: contactUserId, role });
    const saved = await repo.save(entity);
    await this.audit.log(
      { table: 'location_user_contacts', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async updateInternalContact(
    locationId: string,
    contactId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const tenant = this.requireTenantId(tenantId);
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationUserContact);
    const existing = await repo.findOne({ where: { id: contactId } });
    if (!existing || existing.location_id !== locationId) {
      throw new NotFoundException('Contact link not found');
    }
    const before = { ...existing };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body ?? {}, key);
    if (has('role')) {
      existing.role = this.normalizeNullable(body.role);
    }
    if (has('user_id')) {
      const contactUserId = this.normalizeRequired(body.user_id, 'user_id');
      const user = await mg.getRepository(User).findOne({ where: { id: contactUserId, tenant_id: tenant } as any });
      if (!user) throw new BadRequestException('User not found');
      if (contactUserId !== existing.user_id) {
        const duplicate = await repo.findOne({ where: { location_id: locationId, user_id: contactUserId } as any });
        if (duplicate) {
          throw new BadRequestException('User already linked to this location');
        }
        existing.user_id = contactUserId;
      }
    }
    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'location_user_contacts', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async removeInternalContact(
    locationId: string,
    contactId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationUserContact);
    const existing = await repo.findOne({ where: { id: contactId } });
    if (!existing || existing.location_id !== locationId) {
      return { ok: true };
    }
    await repo.delete({ id: contactId } as any);
    await this.audit.log(
      { table: 'location_user_contacts', recordId: contactId, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  async listExternalContacts(locationId: string, opts?: { manager?: EntityManager }) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    return this.fetchExternalContacts(locationId, opts?.manager);
  }

  private async fetchExternalContacts(locationId: string, manager?: EntityManager) {
    const mg = manager ?? this.repo.manager;
    const rows = await mg
      .getRepository(LocationContactLink)
      .find({ where: { location_id: locationId } as any, order: { created_at: 'DESC' as any } });
    const contactIds = Array.from(new Set(rows.map((row) => row.contact_id)));
    let contactsMap: Record<string, ReturnType<typeof this.serializeExternalContact>> = {};
    if (contactIds.length) {
      const contacts = await mg.getRepository(ExternalContact).find({ where: { id: In(contactIds) } as any });
      contactsMap = Object.fromEntries(contacts.map((c) => [c.id, this.serializeExternalContact(c)]));
    }
    return rows.map((row) => ({
      ...row,
      contact: contactsMap[row.contact_id] ?? null,
    }));
  }

  async addExternalContact(
    locationId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const tenant = this.requireTenantId(tenantId);
    await this.loadLocationOrThrow(locationId, opts?.manager);
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const contactId = this.normalizeRequired(body.contact_id, 'contact_id');
    const role = this.normalizeNullable(body.role);
    const mg = opts?.manager ?? this.repo.manager;
    const contact = await mg
      .getRepository(ExternalContact)
      .findOne({ where: { id: contactId, tenant_id: tenant } as any });
    if (!contact) throw new BadRequestException('External contact not found');
    const repo = mg.getRepository(LocationContactLink);
    const existing = await repo.findOne({ where: { location_id: locationId, contact_id: contactId } as any });
    if (existing) {
      throw new BadRequestException('External contact already linked to this location');
    }
    const entity = repo.create({ location_id: locationId, contact_id: contactId, role });
    const saved = await repo.save(entity);
    await this.audit.log(
      { table: 'location_contacts', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async updateExternalContact(
    locationId: string,
    linkId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const tenant = this.requireTenantId(tenantId);
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationContactLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || existing.location_id !== locationId) {
      throw new NotFoundException('External contact link not found');
    }
    const before = { ...existing };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body ?? {}, key);
    if (has('role')) {
      existing.role = this.normalizeNullable(body.role);
    }
    if (has('contact_id')) {
      const contactId = this.normalizeRequired(body.contact_id, 'contact_id');
      const contact = await mg
        .getRepository(ExternalContact)
        .findOne({ where: { id: contactId, tenant_id: tenant } as any });
      if (!contact) throw new BadRequestException('External contact not found');
      if (contactId !== existing.contact_id) {
        const duplicate = await repo.findOne({ where: { location_id: locationId, contact_id: contactId } as any });
        if (duplicate) {
          throw new BadRequestException('External contact already linked to this location');
        }
        existing.contact_id = contactId;
      }
    }
    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'location_contacts', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async removeExternalContact(
    locationId: string,
    linkId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationContactLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || existing.location_id !== locationId) {
      return { ok: true };
    }
    await repo.delete({ id: linkId } as any);
    await this.audit.log(
      { table: 'location_contacts', recordId: linkId, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  async listLinks(locationId: string, opts?: { manager?: EntityManager }) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    return mg
      .getRepository(LocationLink)
      .find({ where: { location_id: locationId } as any, order: { created_at: 'DESC' as any } });
  }

  async createLink(
    locationId: string,
    body: any,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const url = this.normalizeRequired(body.url, 'url');
    const description = this.normalizeNullable(body.description);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationLink);
    const entity = repo.create({ location_id: locationId, url, description });
    const saved = await repo.save(entity);
    await this.audit.log(
      { table: 'location_links', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async updateLink(
    locationId: string,
    linkId: string,
    body: any,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || existing.location_id !== locationId) {
      throw new NotFoundException('Location link not found');
    }
    const before = { ...existing };
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'description')) {
      existing.description = this.normalizeNullable(body.description);
    }
    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'url')) {
      existing.url = this.normalizeRequired(body.url, 'url');
    }
    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      { table: 'location_links', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return saved;
  }

  async deleteLink(locationId: string, linkId: string, userId: string | null, opts?: { manager?: EntityManager }) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationLink);
    const existing = await repo.findOne({ where: { id: linkId } });
    if (!existing || existing.location_id !== locationId) {
      return { ok: true };
    }
    await repo.delete({ id: linkId } as any);
    await this.audit.log(
      { table: 'location_links', recordId: linkId, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  async listAssets(locationId: string, opts?: { manager?: EntityManager }) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const rows: Array<Record<string, any>> = await mg.query(
      `SELECT a.id, a.name, a.kind, a.provider, a.environment,
              a.region, a.zone, a.status, a.created_at,
              a.sub_location_id,
              sl.name AS sub_location_name
       FROM assets a
       LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
       WHERE a.location_id = $1
       ORDER BY a.name ASC`,
      [locationId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      provider: r.provider,
      environment: r.environment,
      region: r.region,
      zone: r.zone,
      status: r.status,
      created_at: r.created_at,
      sub_location_id: r.sub_location_id ?? null,
      sub_location_name: r.sub_location_name ?? null,
    }));
  }

  async listApplications(locationId: string, opts?: { manager?: EntityManager }) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const rows: Array<{ id: string; name: string; environments: string[] | null }> = await mg.query(
      `
        SELECT a.id, a.name,
          ARRAY_AGG(DISTINCT ai.environment ORDER BY ai.environment) AS environments
        FROM assets s
        INNER JOIN app_asset_assignments asa ON asa.asset_id = s.id
        INNER JOIN app_instances ai ON ai.id = asa.app_instance_id
        INNER JOIN applications a ON a.id = ai.application_id
        WHERE s.location_id = $1
        GROUP BY a.id, a.name
        ORDER BY a.name
      `,
      [locationId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      environments: Array.isArray(row.environments)
        ? row.environments.filter((env) => env && env.length > 0)
        : [],
    }));
  }

  // ── Sub-item CRUD ──────────────────────────────────────────────────

  /**
   * External identity of a sub-location, as an inventory synchronisation knows
   * it. It is passed through `opts` and NEVER read from the request body: the
   * controller hands the raw HTTP body straight to these methods, so reading it
   * from there would let anyone with the locations permission forge the link
   * between a Netbox object and a KANAP sub-location.
   */
  private subItemExternal(
    external: SubItemExternal | undefined,
  ): Pick<LocationSubItem, 'external_source' | 'external_id' | 'external_url'> | null {
    if (!external) return null;
    const source = String(external.source || '').trim();
    const id = String(external.id || '').trim();
    if (!source || !id) return null;
    return {
      external_source: source,
      external_id: id,
      external_url: this.normalizeNullable(external.url),
    };
  }

  async listSubItems(locationId: string, opts?: { manager?: EntityManager }) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const rows: Array<{
      id: string;
      tenant_id: string;
      location_id: string;
      name: string;
      description: string | null;
      display_order: number;
      external_source: string | null;
      external_url: string | null;
      created_at: Date;
      updated_at: Date;
      usage_count: string | number;
    }> = await mg.query(
      `SELECT sl.id, sl.tenant_id, sl.location_id, sl.name, sl.description,
              sl.display_order, sl.external_source, sl.external_url,
              sl.created_at, sl.updated_at,
              (SELECT COUNT(*)::int FROM assets a WHERE a.sub_location_id = sl.id) AS usage_count
       FROM location_sub_items sl
       WHERE sl.location_id = $1
       ORDER BY sl.name ASC`,
      [locationId],
    );
    return rows.map((row) => ({
      ...row,
      usage_count: Number(row.usage_count) || 0,
    }));
  }

  async createSubItem(
    locationId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: SubItemOpts,
  ) {
    this.requireTenantId(tenantId);
    await this.loadLocationOrThrow(locationId, opts?.manager);
    if (!body || typeof body !== 'object') throw new BadRequestException('Body is required');
    const name = this.normalizeRequired(body.name, 'name');
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationSubItem);

    // Case-insensitive uniqueness within the location
    const duplicate = await repo
      .createQueryBuilder('si')
      .where('si.location_id = :locationId', { locationId })
      .andWhere('si.tenant_id = :tenantId', { tenantId })
      .andWhere('lower(si.name) = lower(:name)', { name })
      .getOne();
    if (duplicate) {
      throw new BadRequestException(`Sub-location "${name}" already exists at this location`);
    }

    // Assign display_order = MAX + 1
    const maxResult = await repo
      .createQueryBuilder('si')
      .select('COALESCE(MAX(si.display_order), -1)', 'max_order')
      .where('si.location_id = :locationId', { locationId })
      .andWhere('si.tenant_id = :tenantId', { tenantId })
      .getRawOne();
    const displayOrder = (maxResult?.max_order ?? -1) + 1;

    const description = this.normalizeNullable(body.description);
    const external = this.subItemExternal(opts?.external);
    const entity = repo.create({
      location_id: locationId,
      name,
      description,
      display_order: displayOrder,
      ...(external ?? {}),
    });
    const saved = await repo.save(entity);
    await this.audit.log(
      {
        table: 'location_sub_items',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: mg },
    );
    return saved;
  }

  async updateSubItem(
    locationId: string,
    subItemId: string,
    body: any,
    tenantId: string,
    userId: string | null,
    opts?: SubItemOpts,
  ) {
    this.requireTenantId(tenantId);
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationSubItem);
    const existing = await repo.findOne({ where: { id: subItemId } });
    if (!existing || existing.location_id !== locationId) {
      throw new NotFoundException('Sub-location not found');
    }
    const before = { ...existing };

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'name')) {
      const name = this.normalizeRequired(body.name, 'name');
      // Case-insensitive uniqueness check (exclude self)
      const duplicate = await repo
        .createQueryBuilder('si')
        .where('si.location_id = :locationId', { locationId })
        .andWhere('si.tenant_id = :tenantId', { tenantId })
        .andWhere('lower(si.name) = lower(:name)', { name })
        .andWhere('si.id != :id', { id: subItemId })
        .getOne();
      if (duplicate) {
        throw new BadRequestException(`Sub-location "${name}" already exists at this location`);
      }
      existing.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'description')) {
      existing.description = this.normalizeNullable(body.description);
    }

    // Identity travels through opts only. An adoption (a hand-made
    // sub-location Netbox takes over) sets it for the first time; every later
    // run refreshes the deep link.
    const external = this.subItemExternal(opts?.external);
    if (external) {
      existing.external_source = external.external_source;
      existing.external_id = external.external_id;
      existing.external_url = external.external_url;
    }

    existing.updated_at = new Date();
    const saved = await repo.save(existing);
    await this.audit.log(
      {
        table: 'location_sub_items',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: mg },
    );
    return saved;
  }

  async deleteSubItem(
    locationId: string,
    subItemId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    await this.loadLocationOrThrow(locationId, opts?.manager);
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationSubItem);
    const existing = await repo.findOne({ where: { id: subItemId } });
    if (!existing || existing.location_id !== locationId) {
      return { ok: true };
    }

    // Clear sub_location_id on affected assets before deleting
    await mg.query(
      `UPDATE assets SET sub_location_id = NULL, updated_at = now() WHERE sub_location_id = $1`,
      [subItemId],
    );

    await repo.delete({ id: subItemId } as any);
    await this.audit.log(
      { table: 'location_sub_items', recordId: subItemId, action: 'delete', before: existing, after: null, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  async reorderSubItems(
    locationId: string,
    orderedIds: string[],
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    this.requireTenantId(tenantId);
    await this.loadLocationOrThrow(locationId, opts?.manager);
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new BadRequestException('ordered_ids must be a non-empty array');
    }
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(LocationSubItem);

    const currentItems = await repo.find({
      where: { location_id: locationId } as any,
      select: ['id'],
    });
    const currentIds = new Set(currentItems.map((i) => i.id));

    // Validate orderedIds is an exact permutation
    if (orderedIds.length !== currentIds.size || !orderedIds.every((id) => currentIds.has(id))) {
      throw new BadRequestException('ordered_ids must be an exact permutation of current sub-location IDs');
    }

    // Batch update display_order
    for (let i = 0; i < orderedIds.length; i++) {
      await mg.query(
        `UPDATE location_sub_items SET display_order = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
        [i, orderedIds[i], tenantId],
      );
    }

    await this.audit.log(
      { table: 'location_sub_items', recordId: locationId, action: 'update', before: null, after: { ordered_ids: orderedIds }, userId },
      { manager: mg },
    );
    return { ok: true };
  }

  private serializeUser(user: User | undefined) {
    if (!user) return null;
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
    };
  }

  private serializeExternalContact(contact: ExternalContact | undefined) {
    if (!contact) return null;
    return {
      id: contact.id,
      first_name: contact.first_name,
      last_name: contact.last_name,
      job_title: contact.job_title,
      email: contact.email,
      phone: contact.phone,
    };
  }
}
