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
import type { CsvDateOrder, CsvLanguage, DecimalMark } from '../common/csv-sheet';
import { auditChangedAccounts, CURRENT_TENANT, resyncFromChart } from './consolidation';

/** The chart flags a grid can filter and sort on, with its columns. */
const LIST_FIELDS = ['code', 'name', 'country_iso', 'scope', 'is_default', 'is_global_default', 'is_consolidation', 'created_at', 'updated_at'];

/** A chart role: one holder per tenant at most (partial unique indexes). */
type ChartRole = 'is_global_default' | 'is_consolidation';

type ChartCounts = {
  companies_count: number;
  accounts_count: number;
  accounts_unmapped_count: number;
  accounts_outside_count: number;
};

const NO_COUNTS: ChartCounts = { companies_count: 0, accounts_count: 0, accounts_unmapped_count: 0, accounts_outside_count: 0 };

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
    const where: any = {};
    if (filters && Object.keys(filters).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filters, LIST_FIELDS));
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

    const counts = await this.countsByChart(baseItems.map((i) => i.id), mg);
    const items = baseItems.map((i) => ({ ...i, ...(counts.get(i.id) ?? NO_COUNTS) }));
    return { items, total, page, limit };
  }

  /**
   * Per chart, in one query: companies using it, its accounts, those without a consolidation
   * number (unmapped) and those whose number is absent from the tenant's consolidation chart
   * (outside; 0 when the tenant has no consolidation chart). Disabled accounts count too.
   */
  private async countsByChart(ids: string[], mg: EntityManager): Promise<Map<string, ChartCounts>> {
    if (ids.length === 0) return new Map();
    const rows: Array<{ id: string } & ChartCounts> = await mg.query(
      `SELECT c.id::text AS id,
              COALESCE(co.n, 0)::int AS companies_count,
              COALESCE(ac.total, 0)::int AS accounts_count,
              COALESCE(ac.unmapped, 0)::int AS accounts_unmapped_count,
              COALESCE(ac.outside, 0)::int AS accounts_outside_count
       FROM chart_of_accounts c
       LEFT JOIN chart_of_accounts cons
         ON cons.tenant_id = c.tenant_id AND cons.is_consolidation
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n FROM companies co
         WHERE co.tenant_id = c.tenant_id AND co.coa_id = c.id
       ) co ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE a.consolidation_account_number IS NULL) AS unmapped,
                COUNT(*) FILTER (
                  WHERE a.consolidation_account_number IS NOT NULL
                    AND cons.id IS NOT NULL
                    AND NOT EXISTS (
                      SELECT 1 FROM accounts ca
                      WHERE ca.tenant_id = a.tenant_id
                        AND ca.coa_id = cons.id
                        AND ca.account_number = a.consolidation_account_number
                    )
                ) AS outside
         FROM accounts a
         WHERE a.tenant_id = c.tenant_id AND a.coa_id = c.id
       ) ac ON true
       WHERE c.tenant_id = ${CURRENT_TENANT} AND c.id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map(({ id, ...counts }) => [id, counts]));
  }

  async listIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const { sort, q, filters } = parsePagination(query);
    assertSetFilterModes(filters);
    const where: any = {};
    if (filters && Object.keys(filters).length > 0) {
      Object.assign(where, buildWhereFromAgFilters(filters, LIST_FIELDS));
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

  /** The chart with its counts (see `list`). */
  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const found = await this.findOrFail(id, mg);
    const counts = await this.countsByChart([found.id], mg);
    return { ...found, ...(counts.get(found.id) ?? NO_COUNTS) };
  }

  private async findOrFail(id: string, mg: EntityManager): Promise<ChartOfAccounts> {
    const found = await this.getRepo(mg).findOne({ where: { id } });
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
        // "Default for other countries" belongs to GLOBAL charts only.
        existing.is_global_default = false;
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

  /**
   * "Default for other countries": a GLOBAL chart used for companies in a country without a
   * default chart. Clears the previous holder; companies without a chart get this one.
   */
  async setGlobalDefault(coaId: string, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.repo.manager;
    await this.lockTenantCharts(mg);
    const target = await this.findOrFail(coaId, mg);
    if (target.scope !== 'GLOBAL') {
      throw new BadRequestException('Only GLOBAL-scoped CoAs can be set as Global Default');
    }
    await this.assignRole('is_global_default', coaId, userId, mg, opts?.audit);
    // Also backfill companies that have no CoA yet to this global default
    await mg.query(`UPDATE companies SET coa_id = $1 WHERE coa_id IS NULL AND tenant_id = ${CURRENT_TENANT}`, [coaId]);
  }

  /** Removes "Default for other countries" from this chart; a no-op when it does not hold it. */
  async clearGlobalDefault(coaId: string, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.repo.manager;
    await this.findOrFail(coaId, mg);
    const cleared = await this.clearRole('is_global_default', coaId, userId, mg, opts?.audit);
    return { cleared };
  }

  /**
   * Makes this chart (any scope) the tenant's consolidation chart, clearing the previous one,
   * then resyncs the derived fields: every account whose consolidation number matches an
   * account of this chart takes that account's name and description. Accounts are never
   * remapped. Returns the accounts rewritten (`resynced`) and the accounts of the other charts
   * whose consolidation number is absent from this chart (`outside`).
   */
  async setConsolidation(coaId: string, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.repo.manager;
    await this.lockTenantCharts(mg);
    await this.findOrFail(coaId, mg);
    await this.assignRole('is_consolidation', coaId, userId, mg, opts?.audit);
    const changed = await resyncFromChart(mg, coaId);
    await auditChangedAccounts(this.audit, mg, changed, userId, opts?.audit);
    const { outside } = await this.consolidationImpact(coaId, { manager: mg });
    return { resynced: changed.length, outside };
  }

  /** Removes the consolidation role from this chart; a no-op when it does not hold it. */
  async clearConsolidation(coaId: string, userId?: string | null, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const mg = opts?.manager ?? this.repo.manager;
    await this.findOrFail(coaId, mg);
    const cleared = await this.clearRole('is_consolidation', coaId, userId, mg, opts?.audit);
    return { cleared };
  }

  /**
   * What making this chart the consolidation chart would mean, without writing: among the
   * accounts of the other charts, those whose consolidation number exists in this chart
   * (`matched`), is set but absent from it (`outside`), or is not set (`unmapped`).
   */
  async consolidationImpact(coaId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    await this.findOrFail(coaId, mg);
    const [row]: Array<{ matched: number; outside: number; unmapped: number }> = await mg.query(
      `SELECT COUNT(*) FILTER (WHERE a.consolidation_account_number IS NOT NULL AND t.id IS NOT NULL)::int AS matched,
              COUNT(*) FILTER (WHERE a.consolidation_account_number IS NOT NULL AND t.id IS NULL)::int AS outside,
              COUNT(*) FILTER (WHERE a.consolidation_account_number IS NULL)::int AS unmapped
       FROM accounts a
       LEFT JOIN accounts t
         ON t.tenant_id = a.tenant_id AND t.coa_id = $1::uuid AND t.account_number = a.consolidation_account_number
       WHERE a.tenant_id = ${CURRENT_TENANT} AND a.coa_id <> $1::uuid`,
      [coaId],
    );
    return { matched: row?.matched ?? 0, outside: row?.outside ?? 0, unmapped: row?.unmapped ?? 0 };
  }

  /** Serializes role changes of a tenant: two at once would otherwise both pass the clear step. */
  private async lockTenantCharts(mg: EntityManager) {
    await mg.query(`SELECT id FROM chart_of_accounts WHERE tenant_id = ${CURRENT_TENANT} ORDER BY id FOR UPDATE`);
  }

  /** Gives `role` to `holderId` and takes it from every other chart of the tenant (audited per chart). */
  private async assignRole(role: ChartRole, holderId: string, userId: string | null | undefined, mg: EntityManager, audit?: AuditSourceOptions) {
    // Clear first: the partial unique index checks each row as it is written.
    const cleared = await this.writeRole(role, false, `${role} AND id <> $1::uuid`, holderId, mg);
    const given = await this.writeRole(role, true, `NOT ${role} AND id = $1::uuid`, holderId, mg);
    await this.auditCharts([...cleared, ...given], userId, mg, audit);
  }

  /** Takes `role` from this chart when it holds it; true when it did. */
  private async clearRole(role: ChartRole, coaId: string, userId: string | null | undefined, mg: EntityManager, audit?: AuditSourceOptions) {
    const cleared = await this.writeRole(role, false, `${role} AND id = $1::uuid`, coaId, mg);
    await this.auditCharts(cleared, userId, mg, audit);
    return cleared.length > 0;
  }

  /** Writes `role` on the tenant's charts matching `condition` ($1 is `id`); returns them before and after. */
  private async writeRole(role: ChartRole, value: boolean, condition: string, id: string, mg: EntityManager) {
    const rows: Array<{ before: any; after: any }> = await mg.query(
      `WITH prev AS (
         SELECT * FROM chart_of_accounts
         WHERE tenant_id = ${CURRENT_TENANT} AND ${condition}
       ),
       changed AS (
         UPDATE chart_of_accounts c
         SET ${role} = ${value ? 'true' : 'false'}, updated_at = now()
         FROM prev
         WHERE c.id = prev.id AND c.tenant_id = ${CURRENT_TENANT}
         RETURNING to_jsonb(prev) AS before, to_jsonb(c) AS after
       )
       SELECT before, after FROM changed`,
      [id],
    );
    return rows;
  }

  private async auditCharts(changed: Array<{ before: any; after: any }>, userId: string | null | undefined, mg: EntityManager, audit?: AuditSourceOptions) {
    for (const row of changed) {
      await this.audit.log(
        {
          table: 'chart_of_accounts',
          recordId: row.after?.id ?? null,
          action: 'update',
          before: row.before,
          after: row.after,
          userId: userId ?? null,
          source: audit?.source,
          sourceRef: audit?.sourceRef ?? null,
        },
        { manager: mg },
      );
    }
  }

  async loadTemplateIntoCoa(
    coaId: string,
    templateId: string,
    { dryRun, userId, overwrite }: { dryRun?: boolean; userId?: string | null; overwrite?: boolean } = {},
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const coa = await this.findOrFail(coaId, mg);
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

  async exportAccountsCsv(
    coaId: string,
    opts?: { manager?: EntityManager; scope?: 'template' | 'data'; language?: CsvLanguage },
  ) {
    // Validate CoA belongs to tenant and exists
    await this.findOrFail(coaId, opts?.manager ?? this.repo.manager);
    const scope = opts?.scope ?? 'data';
    return this.accountsSvc.exportCsv(scope, { manager: opts?.manager, coaId, includeCoaCode: false, language: opts?.language });
  }

  async importAccountsCsv(
    coaId: string,
    file: Express.Multer.File,
    dryRun: boolean,
    userId?: string | null,
    opts?: { manager?: EntityManager; language?: CsvLanguage; dateOrder?: CsvDateOrder; decimalMark?: DecimalMark },
  ) {
    await this.findOrFail(coaId, opts?.manager ?? this.repo.manager);
    return this.accountsSvc.importCsv(
      { file, dryRun, userId: userId ?? null, language: opts?.language, dateOrder: opts?.dateOrder, decimalMark: opts?.decimalMark },
      { manager: opts?.manager, targetCoaId: coaId, allowCoaCodeColumn: false },
    );
  }
}
