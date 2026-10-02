import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, ILike, Repository } from 'typeorm';
import { ChartOfAccounts } from './chart-of-accounts.entity';
import { parsePagination, buildWhereFromAgFilters } from '../common/pagination';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { ChartOfAccountsUpsertDto } from './dto/chart-of-accounts.dto';
import { Company } from '../companies/company.entity';
import { Account } from './account.entity';
import { AccountsService } from './accounts.service';
import { parseString } from '@fast-csv/parse';
import { assertSetFilterModes } from '../common/ag-grid-filtering';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    @InjectRepository(ChartOfAccounts) private readonly repo: Repository<ChartOfAccounts>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    private readonly audit: AuditService,
    private readonly accountsSvc: AccountsService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(ChartOfAccounts) : this.repo;
  }

  async list(query: any, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const { page, limit, skip, sort, q, filters } = parsePagination(query);
    assertSetFilterModes(filters);
    const allowed = ['code','name','country_iso','scope','is_default','is_global_default','created_at','updated_at'];
    const where: any = {};
    if (filters && Object.keys(filters).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filters, allowed));
    }
    if (q) {
      // quick search on code or name
      where.code = where.code ?? ILike(`%${q}%`);
      // If both need to be applied as OR, use array form; otherwise keep simple where
    }
    // If q present, use find with OR where array to combine code/name
    const whereArr = q ? [{ ...where, code: ILike(`%${q}%`) }, { ...where, name: ILike(`%${q}%`) }] : undefined;

    const [baseItems, total] = await repo.findAndCount({
      where: whereArr ?? where,
      order: { [sort.field]: sort.direction as any },
      skip,
      take: limit,
    });

    // Enrich with counts
    const ids = baseItems.map((i) => i.id);
    const counts: Record<string, { companies: number; accounts: number }> = {};
    if (ids.length > 0) {
      const companyCounts: Array<{ coa_id: string; count: string }>
        = await mg.query(`SELECT coa_id, COUNT(*)::text AS count FROM companies WHERE coa_id = ANY($1) GROUP BY coa_id`, [ids]);
      const accountCounts: Array<{ coa_id: string; count: string }>
        = await mg.query(`SELECT coa_id, COUNT(*)::text AS count FROM accounts WHERE coa_id = ANY($1) GROUP BY coa_id`, [ids]);
      companyCounts.forEach((r) => { counts[r.coa_id] = { ...(counts[r.coa_id] || { companies: 0, accounts: 0 }), companies: Number(r.count) }; });
      accountCounts.forEach((r) => { counts[r.coa_id] = { ...(counts[r.coa_id] || { companies: 0, accounts: 0 }), accounts: Number(r.count) }; });
    }
    const items = baseItems.map((i) => ({
      ...i,
      companies_count: counts[i.id]?.companies ?? 0,
      accounts_count: counts[i.id]?.accounts ?? 0,
    }));
    return { items, total, page, limit };
  }

  async listIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const { sort, q, filters } = parsePagination(query);
    assertSetFilterModes(filters);
    const allowed = ['code','name','country_iso','scope','is_default','is_global_default','created_at','updated_at'];
    const where: any = {};
    if (filters && Object.keys(filters).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filters, allowed));
    }
    const whereArr = q ? [{ ...where, code: ILike(`%${q}%`) }, { ...where, name: ILike(`%${q}%`) }] : undefined;
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const total = await repo.count({ where: whereArr ?? where });
    const rows = await repo.find({
      where: whereArr ?? where,
      order: { [sort.field]: sort.direction as any },
      take: limit,
      skip: 0,
      select: ['id'],
    });
    return { ids: rows.map((row) => row.id), total };
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Chart of Accounts not found');
    return found;
  }

  private async ensureUniqueDefault(countryIso: string, mg: EntityManager) {
    await mg.query(
      `UPDATE chart_of_accounts SET is_default = false WHERE country_iso = $1 AND is_default = true AND tenant_id = current_setting('app.current_tenant', true)::uuid`,
      [countryIso],
    );
  }

  async create(body: ChartOfAccountsUpsertDto, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.repo.manager;
    if (!body.code) throw new BadRequestException('code is required');
    if (!body.name) throw new BadRequestException('name is required');
    // Back-compat: treat country_iso='ZZ' as GLOBAL scope when scope not provided
    let scope: 'GLOBAL' | 'COUNTRY' = (body.scope as any) || undefined as any;
    if (!scope) {
      scope = (body.country_iso && body.country_iso.toUpperCase() === 'ZZ') ? 'GLOBAL' : 'COUNTRY';
    }
    const toCreate: DeepPartial<ChartOfAccounts> = {
      code: String(body.code),
      name: String(body.name),
      scope,
      is_default: !!body.is_default,
    };
    if (scope === 'GLOBAL') {
      toCreate.country_iso = null;
      toCreate.is_default = false; // enforce by design
    } else {
      const c = body.country_iso?.toUpperCase();
      if (!c || c.length !== 2) throw new BadRequestException('country_iso is required and must be 2 letters for COUNTRY-scoped CoA');
      toCreate.country_iso = c;
      if (toCreate.is_default) {
        await this.ensureUniqueDefault(toCreate.country_iso!, mg);
      }
    }
    try {
      const entity = this.getRepo(mg).create(toCreate);
      const saved = await this.getRepo(mg).save(entity);
      await this.audit.log(
        {
          table: 'chart_of_accounts',
          recordId: saved.id,
          action: 'create',
          before: null,
          after: saved,
          userId: userId ?? null,
          source: opts?.audit?.source,
          sourceRef: opts?.audit?.sourceRef ?? null,
        },
        { manager: mg },
      );
      return saved;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException('A Chart of Accounts with this code already exists');
      }
      throw e;
    }
  }

  async update(id: string, body: ChartOfAccountsUpsertDto, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Chart of Accounts not found');
    const before = { ...existing };
    if (body.code !== undefined && body.code !== null) existing.code = String(body.code);
    if (body.name !== undefined && body.name !== null) existing.name = String(body.name);
    // Scope transition handling and country validation
    if (body.scope !== undefined && body.scope !== null) {
      if (body.scope === 'GLOBAL') {
        existing.scope = 'GLOBAL';
        existing.country_iso = null;
        existing.is_default = false;
      } else if (body.scope === 'COUNTRY') {
        existing.scope = 'COUNTRY';
        const nextCountry = body.country_iso?.toUpperCase() || existing.country_iso?.toUpperCase();
        if (!nextCountry || nextCountry.length !== 2) throw new BadRequestException('country_iso is required and must be 2 letters when scope is COUNTRY');
        existing.country_iso = nextCountry;
      }
    }
    if (body.country_iso !== undefined && body.country_iso !== null) {
      const next = body.country_iso.toUpperCase();
      if (existing.scope === 'GLOBAL') {
        throw new BadRequestException('GLOBAL-scoped CoA cannot have a country');
      }
      existing.country_iso = next;
    }
    if (body.is_default !== undefined && body.is_default !== null) {
      existing.is_default = !!body.is_default;
      if (existing.scope === 'GLOBAL' && existing.is_default) {
        throw new BadRequestException('GLOBAL-scoped CoA cannot be set as country default');
      }
      if (existing.is_default && existing.country_iso) {
        await this.ensureUniqueDefault(existing.country_iso, mg);
      }
    }
    try {
      const saved = await repo.save(existing);
      await this.audit.log(
        {
          table: 'chart_of_accounts',
          recordId: saved.id,
          action: 'update',
          before,
          after: saved,
          userId: userId ?? null,
          source: opts?.audit?.source,
          sourceRef: opts?.audit?.sourceRef ?? null,
        },
        { manager: mg },
      );
      return saved;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException('A Chart of Accounts with this code already exists');
      }
      throw e;
    }
  }

  async delete(id: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = this.getRepo(mg);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Chart of Accounts not found');

    // Companies referencing this CoA block deletion
    const companyCount = await mg.getRepository(Company).count({ where: { coa_id: id } as any });
    if (companyCount > 0) {
      throw new ConflictException(`Cannot delete CoA "${existing.code} - ${existing.name}": ${companyCount} compan${companyCount === 1 ? 'y' : 'ies'} reference it.`);
    }
    // OPEX usage of accounts under this CoA
    const opexUsageRows = await mg.query(
      `SELECT COUNT(*)::int AS count
       FROM spend_items si
       JOIN accounts a ON a.id = si.account_id
       WHERE a.coa_id = $1`,
      [id],
    );
    const opexCount = Number(opexUsageRows?.[0]?.count ?? 0);
    const capexUsageRows = await mg.query(
      `SELECT COUNT(*)::int AS count
       FROM capex_items ci
       JOIN accounts a ON a.id = ci.account_id
       WHERE a.coa_id = $1`,
      [id],
    );
    const capexCount = Number(capexUsageRows?.[0]?.count ?? 0);
    if (opexCount + capexCount > 0) {
      throw new ConflictException(`Cannot delete CoA "${existing.code} - ${existing.name}": ${opexCount} OPEX and ${capexCount} CAPEX item(s) reference its accounts.`);
    }

    // Safe to delete: remove accounts in this CoA first
    await mg.getRepository(Account).delete({ coa_id: id } as any);
    await repo.delete({ id });
    await this.audit.log({ table: 'chart_of_accounts', recordId: id, action: 'delete', before: existing, after: null, userId: userId ?? null }, { manager: mg });
  }

  async listTemplates(opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const rows = await mg.query(`
      SELECT id, country_iso, template_code, template_name, version, is_global, loaded_by_default, updated_at
      FROM coa_templates
      ORDER BY (country_iso IS NULL) ASC, country_iso, template_code, version
    `);
    return { items: rows };
  }

  async setGlobalDefault(coaId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    // Ensure target CoA is GLOBAL-scoped
    const target = await this.get(coaId, { manager: mg });
    if (target.scope !== 'GLOBAL') {
      throw new BadRequestException('Only GLOBAL-scoped CoAs can be set as Global Default');
    }
    // Clear any existing global default in this tenant, then set the requested one
    await mg.query(`UPDATE chart_of_accounts SET is_global_default = false WHERE tenant_id = current_setting('app.current_tenant', true)::uuid AND is_global_default = true`);
    await mg.query(`UPDATE chart_of_accounts SET is_global_default = true WHERE id = $1`, [coaId]);
    // Also backfill companies that have no CoA yet to this global default
    await mg.query(`UPDATE companies SET coa_id = $1 WHERE coa_id IS NULL`, [coaId]);
  }

  async loadTemplateIntoCoa(
    coaId: string,
    templateId: string,
    { dryRun, userId, overwrite }: { dryRun?: boolean; userId?: string | null; overwrite?: boolean } = {},
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const coa = await this.get(coaId, { manager: mg });
    const tmplRows = await mg.query(`SELECT csv_payload FROM coa_templates WHERE id = $1`, [templateId]);
    const csv = tmplRows?.[0]?.csv_payload as string | undefined;
    if (!csv) throw new BadRequestException('Template has no CSV payload');
    // Parse CSV using AccountsService import logic by constructing a fake file-like object is awkward; instead parse and re-encode to Buffer
    const file: Express.Multer.File = { fieldname: 'file', originalname: 'template.csv', encoding: '7bit', mimetype: 'text/csv', size: Buffer.byteLength(csv), buffer: Buffer.from(csv, 'utf8'), stream: undefined as any, destination: undefined as any, filename: undefined as any, path: undefined as any } as any;
    const result = await this.accountsSvc.importCsv(
      { file, dryRun: !!dryRun, userId: userId ?? null },
      { manager: mg, targetCoaId: coa.id, allowCoaCodeColumn: false, updateExisting: overwrite !== false },
    );
    return result;
  }

  async preflightTemplateImport(
    templateId: string,
    targetCoaId?: string,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const tmplRows = await mg.query(`SELECT csv_payload FROM coa_templates WHERE id = $1`, [templateId]);
    const csv = tmplRows?.[0]?.csv_payload as string | undefined;
    if (!csv) throw new BadRequestException('Template has no CSV payload');

    if (targetCoaId) {
      // Use existing dryRun path to compute inserts/updates for a specific CoA
      const file: Express.Multer.File = { fieldname: 'file', originalname: 'template.csv', encoding: '7bit', mimetype: 'text/csv', size: Buffer.byteLength(csv), buffer: Buffer.from(csv, 'utf8'), stream: undefined as any, destination: undefined as any, filename: undefined as any, path: undefined as any } as any;
      return this.accountsSvc.importCsv({ file, dryRun: true, userId: null }, { manager: mg, targetCoaId, allowCoaCodeColumn: false });
    }
    // For new CoA scenario (no target yet), parse CSV and return totals; all rows will be inserts
    const delimiter = ';';
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      parseString(csv, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('data', () => { total += 1; })
        .on('error', (err) => reject(err))
        .on('end', () => resolve());
    });
    return { ok: true, dryRun: true, total, inserted: total, updated: 0, errors: [] };
  }

  async exportAccountsCsv(coaId: string, opts?: { manager?: EntityManager; scope?: 'template' | 'data' }) {
    // Validate CoA belongs to tenant and exists
    await this.get(coaId, { manager: opts?.manager });
    const scope = opts?.scope ?? 'data';
    return this.accountsSvc.exportCsv(scope, { manager: opts?.manager, coaId, includeCoaCode: false });
  }

  async importAccountsCsv(coaId: string, file: Express.Multer.File, dryRun: boolean, userId?: string | null, opts?: { manager?: EntityManager }) {
    await this.get(coaId, { manager: opts?.manager });
    return this.accountsSvc.importCsv({ file, dryRun, userId: userId ?? null }, { manager: opts?.manager, targetCoaId: coaId, allowCoaCodeColumn: false });
  }
}
