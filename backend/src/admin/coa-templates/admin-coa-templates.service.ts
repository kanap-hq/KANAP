import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, Repository } from 'typeorm';
import { CoaTemplate } from './coa-template.entity';
import { parseString } from '@fast-csv/parse';
import { format } from '@fast-csv/format';
import { AuditService } from '../../audit/audit.service';
import { denormalizeCsvRow } from '../../common/csv/csv-export.service';

/** The OPEX/CAPEX nature of a template account (`nature` column, optional, empty = both). */
const NATURES = ['opex', 'capex'] as const;
/** Headers a payload may leave out: older payloads have no `nature` column. */
const OPTIONAL_HEADERS = ['nature'];

function natureOf(value: unknown): 'opex' | 'capex' | null | undefined {
  const text = (value ?? '').toString().trim().toLowerCase();
  if (text === '') return null;
  return (NATURES as readonly string[]).includes(text) ? (text as 'opex' | 'capex') : undefined;
}

function invalidNature(value: unknown): string {
  return `Invalid nature '${(value ?? '').toString().trim()}'. Use 'opex', 'capex' or leave it empty.`;
}

@Injectable()
export class AdminCoaTemplatesService {
  constructor(
    @InjectRepository(CoaTemplate) private readonly repo: Repository<CoaTemplate>,
    private readonly audit: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) { return manager ? manager.getRepository(CoaTemplate) : this.repo; }

  private toTemplateAuditSnapshot(template: CoaTemplate | null) {
    if (!template) return null;
    const { csv_payload, ...rest } = template as any;
    return {
      ...rest,
      csv_payload_length: typeof csv_payload === 'string' ? csv_payload.length : 0,
    };
  }

  private csvHeaders(): string[] {
    return [
      'account_number',
      'account_name',
      'native_name',
      'description',
      'consolidation_account_number',
      'consolidation_account_name',
      'consolidation_account_description',
      'status',
      'nature',
    ];
  }

  private async parseTemplateRows(csv: string): Promise<Array<Record<string, any>>> {
    const delimiter = ';';
    const rows: Record<string, any>[] = [];
    await new Promise<void>((resolve, reject) => {
      parseString(csv, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('data', (rawRow: Record<string, string>) => {
          // A payload uploaded from a neutralised accounts export carries the protective
          // apostrophe; accounts.importCsv strips it too, so both readers agree.
          const row = denormalizeCsvRow(rawRow);
          const toInt = (v: any): number | null => {
            const s = (v ?? '').toString().trim();
            if (s === '') return null;
            const n = Number(s);
            return Number.isInteger(n) ? n : null;
          };
          const statusRaw = (row['status'] ?? 'enabled').toString().trim().toLowerCase();
          rows.push({
            account_number: toInt(row['account_number']) ?? 0,
            account_name: (row['account_name'] ?? '').toString().trim(),
            native_name: ((row['native_name'] ?? '').toString().trim()) || null,
            description: ((row['description'] ?? '').toString().trim()) || null,
            consolidation_account_number: toInt(row['consolidation_account_number']),
            consolidation_account_name: ((row['consolidation_account_name'] ?? '').toString().trim()) || null,
            consolidation_account_description: ((row['consolidation_account_description'] ?? '').toString().trim()) || null,
            status: statusRaw === 'disabled' ? 'disabled' : 'enabled',
            // A stored value outside the list reads as empty (the editors only write valid ones).
            nature: natureOf(row['nature']) ?? null,
          });
        })
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });
    return rows;
  }

  private async encodeTemplateRows(rows: Array<Record<string, any>>): Promise<string> {
    const delimiter = ';';
    const headers = this.csvHeaders();
    // Ensure deterministic order: account_number ASC
    const sorted = [...rows].sort((a, b) => Number(a.account_number) - Number(b.account_number));
    const chunks: string[] = [];
    return await new Promise<string>((resolve, reject) => {
      try {
        // No formula neutralisation here: this encodes the payload stored in
        // coa_templates.csv_payload, which parseTemplateRows reads back. It is not an export.
        const stream = format({ headers, delimiter });
        stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
        stream.on('end', () => resolve('\ufeff' + chunks.join('')));
        for (const r of sorted) {
          stream.write({
            account_number: r.account_number ?? '',
            account_name: r.account_name ?? '',
            native_name: r.native_name ?? '',
            description: r.description ?? '',
            consolidation_account_number: r.consolidation_account_number ?? '',
            consolidation_account_name: r.consolidation_account_name ?? '',
            consolidation_account_description: r.consolidation_account_description ?? '',
            status: r.status ?? 'enabled',
            nature: r.nature ?? '',
          });
        }
        stream.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private async getTemplateCsv(id: string, opts?: { manager?: EntityManager }): Promise<string> {
    const found = await this.get(id, opts);
    return found.csv_payload || ('\ufeff' + this.csvHeaders().join(';') + '\n');
  }

  private validateRowPayload(body: any) {
    const toInt = (v: any): number | null => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isInteger(n) ? n : null;
    };
    const account_number = toInt(body?.account_number);
    const account_name = (body?.account_name ?? '').toString().trim();
    const status = (body?.status ?? 'enabled').toString().trim().toLowerCase();
    if (account_number == null) throw new BadRequestException('account_number is required and must be an integer');
    if (!account_name) throw new BadRequestException('account_name is required');
    if (status && status !== 'enabled' && status !== 'disabled') throw new BadRequestException(`Invalid status '${status}'. Use 'enabled' or 'disabled'.`);
    const nature = natureOf(body?.nature);
    if (nature === undefined) throw new BadRequestException(invalidNature(body?.nature));
    return {
      account_number,
      account_name,
      native_name: ((body?.native_name ?? '').toString().trim()) || null,
      description: ((body?.description ?? '').toString().trim()) || null,
      consolidation_account_number: toInt(body?.consolidation_account_number),
      consolidation_account_name: ((body?.consolidation_account_name ?? '').toString().trim()) || null,
      consolidation_account_description: ((body?.consolidation_account_description ?? '').toString().trim()) || null,
      status: status === 'disabled' ? 'disabled' : 'enabled',
      nature,
    };
  }

  async list(query: any, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10) || 20));
    const skip = (page - 1) * limit;
    const sortParam: string = query.sort ?? 'updated_at:DESC';
    const [field, dir] = String(sortParam).split(':');
    const direction = (dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const q: string | undefined = query.q?.toString();
    const where: any = {};
    if (q) {
      // quick search on code/name/country/version
      Object.assign(where, { template_name: ILike(`%${q}%`) });
    }
    const [items, total] = await repo.findAndCount({
      where: q ? [
        { template_name: ILike(`%${q}%`) },
        { template_code: ILike(`%${q}%`) },
        { country_iso: ILike(`%${q}%`) },
        { version: ILike(`%${q}%`) },
      ] : where,
      order: { [field]: direction as any },
      skip,
      take: limit,
      select: ['id','country_iso','template_code','template_name','version','is_global','loaded_by_default','created_at','updated_at'],
    });
    return { items, total, page, limit };
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Template not found');
    return found;
  }

  async create(
    body: { country_iso?: string; template_code?: string; template_name?: string; version?: string; is_global?: boolean; loaded_by_default?: boolean },
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const repo = this.getRepo(opts?.manager);
    const is_global = !!body.is_global;
    const country_iso_raw = (body.country_iso || '').toUpperCase();
    const country_iso = is_global ? null : country_iso_raw;
    const template_code = String(body.template_code || '').trim();
    const template_name = String(body.template_name || '').trim();
    const version = String(body.version || '').trim();
    if (!is_global) {
      if (!country_iso || country_iso.length !== 2) throw new BadRequestException('country_iso is required and must be 2 letters');
    }
    if (!template_code) throw new BadRequestException('template_code is required');
    if (!template_name) throw new BadRequestException('template_name is required');
    if (!version) throw new BadRequestException('version is required');
    try {
      if (is_global && body.loaded_by_default) {
        await repo.manager.query(`UPDATE coa_templates SET loaded_by_default = false WHERE is_global = true AND loaded_by_default = true`);
      }
      const saved = await repo.save(repo.create({ country_iso, template_code, template_name, version, is_global, loaded_by_default: !!body.loaded_by_default }));
      await this.audit.log(
        {
          table: 'coa_templates',
          recordId: saved.id,
          action: 'create',
          before: null,
          after: this.toTemplateAuditSnapshot(saved),
          userId: userId ?? null,
        },
        { manager: opts?.manager ?? repo.manager },
      );
      return saved;
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('Template version already exists for this country and code');
      throw e;
    }
  }

  async update(
    id: string,
    body: Partial<{ country_iso: string | null; template_code: string; template_name: string; version: string; csv_payload: string | null; is_global: boolean; loaded_by_default: boolean }>,
    userId?: string | null,
    opts?: { manager?: EntityManager; skipAudit?: boolean },
  ) {
    const repo = this.getRepo(opts?.manager);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Template not found');
    const before = this.toTemplateAuditSnapshot(existing);
    if (body.is_global != null) {
      existing.is_global = !!body.is_global;
      if (existing.is_global) existing.country_iso = null;
    }
    if (body.country_iso !== undefined && !existing.is_global) existing.country_iso = (body.country_iso ?? '').toString().toUpperCase();
    if (body.template_code != null) existing.template_code = String(body.template_code);
    if (body.template_name != null) existing.template_name = String(body.template_name);
    if (body.version != null) existing.version = String(body.version);
    if (body.csv_payload !== undefined) existing.csv_payload = body.csv_payload;
    if (body.loaded_by_default != null) {
      const nextLoaded = !!body.loaded_by_default;
      if (nextLoaded && existing.is_global) {
        await repo.manager.query(`UPDATE coa_templates SET loaded_by_default = false WHERE is_global = true AND loaded_by_default = true AND id <> $1`, [existing.id]);
      }
      existing.loaded_by_default = nextLoaded;
    }
    try {
      const saved = await repo.save(existing);
      if (!opts?.skipAudit) {
        await this.audit.log(
          {
            table: 'coa_templates',
            recordId: saved.id,
            action: 'update',
            before,
            after: this.toTemplateAuditSnapshot(saved),
            userId: userId ?? null,
          },
          { manager: opts?.manager ?? repo.manager },
        );
      }
      return saved;
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('Template version already exists for this country and code');
      throw e;
    }
  }

  async delete(id: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Template not found');
    await repo.delete({ id });
    await this.audit.log(
      {
        table: 'coa_templates',
        recordId: id,
        action: 'delete',
        before: this.toTemplateAuditSnapshot(existing),
        after: null,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
  }

  async exportCsv(id: string) {
    const found = await this.get(id);
    const filename = `${found.template_code}_${found.version}.csv`;
    const content = found.csv_payload || ('\ufeff' + this.csvHeaders().join(';') + '\n');
    return { filename, content };
  }

  async importCsv(id: string, file: Express.Multer.File, dryRun = true, userId?: string | null, opts?: { manager?: EntityManager }) {
    if (!file) throw new BadRequestException('No file uploaded');
    const buf = file.buffer ?? ((file as any).path ? require('fs').readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    const content = buf.toString('utf8');
    const delimiter = ';';
    const expected = this.csvHeaders();
    let headerOk = false;
    let total = 0;
    const errors: Array<{ row: number; message: string }> = [];
    await new Promise<void>((resolve, reject) => {
      parseString(content, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('headers', (headers: string[]) => {
          const missing = expected.filter((h) => !headers.includes(h) && !OPTIONAL_HEADERS.includes(h));
          const extras = headers.filter((h) => !expected.includes(h));
          headerOk = missing.length === 0 && extras.length === 0;
          if (!headerOk) reject(new BadRequestException(`Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}`));
        })
        .on('data', (row: Record<string, string>) => {
          total += 1;
          const raw = denormalizeCsvRow(row)['nature'];
          if (natureOf(raw) === undefined) errors.push({ row: total + 1, message: invalidNature(raw) });
        })
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });
    if (!headerOk) throw new BadRequestException('Invalid header');
    if (errors.length > 0) {
      return { ok: false, dryRun, total, inserted: 0, updated: 0, errors };
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total, inserted: total, updated: 0, errors: [] };
    }
    await this.update(id, { csv_payload: content }, userId, { manager: opts?.manager, skipAudit: false });
    return { ok: true, dryRun: false, total, inserted: total, updated: 0, processed: total, errors: [] };
  }

  // Accounts within a template
  async listAccounts(id: string, query: any, opts?: { manager?: EntityManager; exportAll?: boolean }) {
    const csv = await this.getTemplateCsv(id, opts);
    const rows = await this.parseTemplateRows(csv);
    // Basic search/sort/pagination
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    // 100 is the browsing page size. The "select all" path asks for every account, and this
    // inline cap used to truncate it to 100 rows without saying so.
    const maxLimit = opts?.exportAll ? 50_000 : 100;
    const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit ?? '20', 10) || 20));
    const sortParam: string = query.sort ?? 'account_number:ASC';
    const [field, dirRaw] = String(sortParam).split(':');
    const direction = (dirRaw || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
    const q = (query.q ?? '').toString().trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) =>
          String(r.account_number ?? '').includes(q) ||
          (r.account_name ?? '').toString().toLowerCase().includes(q),
        )
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[field as keyof typeof a];
      const bv = b[field as keyof typeof b];
      if (av == null && bv == null) return 0;
      if (av == null) return -direction;
      if (bv == null) return direction;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
    const start = (page - 1) * limit;
    const items = sorted.slice(start, start + limit);
    const total = sorted.length;
    return { items, total, page, limit };
  }

  async listAccountIds(id: string, query: any, opts?: { manager?: EntityManager }) {
    const { items } = await this.listAccounts(id, { ...query, page: 1, limit: 100000 }, { ...opts, exportAll: true });
    return { ids: items.map((r) => String(r.account_number)) };
  }

  async getAccount(id: string, accountNumber: string, opts?: { manager?: EntityManager }) {
    const csv = await this.getTemplateCsv(id, opts);
    const rows = await this.parseTemplateRows(csv);
    const num = Number(accountNumber);
    const found = rows.find((r) => Number(r.account_number) === num);
    if (!found) throw new NotFoundException('Account not found in template');
    return found;
  }

  async createAccount(id: string, body: any, userId?: string | null, opts?: { manager?: EntityManager }) {
    const csv = await this.getTemplateCsv(id, opts);
    const rows = await this.parseTemplateRows(csv);
    const payload = this.validateRowPayload(body);
    if (rows.some((r) => Number(r.account_number) === Number(payload.account_number))) {
      throw new ConflictException('An account with this account_number already exists in the template');
    }
    const next = [...rows, payload];
    const encoded = await this.encodeTemplateRows(next);
    await this.update(id, { csv_payload: encoded }, userId, { manager: opts?.manager, skipAudit: true });
    await this.audit.log(
      {
        table: 'coa_template_accounts',
        recordId: id,
        action: 'create',
        before: null,
        after: payload,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? this.repo.manager },
    );
    return { account_number: payload.account_number };
  }

  async updateAccount(id: string, accountNumber: string, body: any, userId?: string | null, opts?: { manager?: EntityManager }) {
    const csv = await this.getTemplateCsv(id, opts);
    const rows = await this.parseTemplateRows(csv);
    const current = Number(accountNumber);
    const idx = rows.findIndex((r) => Number(r.account_number) === current);
    if (idx < 0) throw new NotFoundException('Account not found in template');
    const before = { ...rows[idx] };
    const payload = this.validateRowPayload({ ...rows[idx], ...body });
    const newNum = Number(payload.account_number);
    if (newNum !== current && rows.some((r, i) => i !== idx && Number(r.account_number) === newNum)) {
      throw new ConflictException('Another account with this account_number already exists');
    }
    rows[idx] = payload;
    const encoded = await this.encodeTemplateRows(rows);
    await this.update(id, { csv_payload: encoded }, userId, { manager: opts?.manager, skipAudit: true });
    await this.audit.log(
      {
        table: 'coa_template_accounts',
        recordId: id,
        action: 'update',
        before,
        after: payload,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? this.repo.manager },
    );
    return this.getAccount(id, String(payload.account_number), opts);
  }

  async deleteAccount(id: string, accountNumber: string, userId?: string | null, opts?: { manager?: EntityManager }) {
    const csv = await this.getTemplateCsv(id, opts);
    const rows = await this.parseTemplateRows(csv);
    const num = Number(accountNumber);
    const before = rows.find((r) => Number(r.account_number) === num) ?? null;
    const next = rows.filter((r) => Number(r.account_number) !== num);
    if (next.length === rows.length) throw new NotFoundException('Account not found in template');
    const encoded = await this.encodeTemplateRows(next);
    await this.update(id, { csv_payload: encoded }, userId, { manager: opts?.manager, skipAudit: true });
    await this.audit.log(
      {
        table: 'coa_template_accounts',
        recordId: id,
        action: 'delete',
        before,
        after: null,
        userId: userId ?? null,
      },
      { manager: opts?.manager ?? this.repo.manager },
    );
    return { ok: true };
  }

  async bulkDeleteAccounts(id: string, ids: string[], userId?: string | null, opts?: { manager?: EntityManager }) {
    const csv = await this.getTemplateCsv(id, opts);
    const rows = await this.parseTemplateRows(csv);
    const toDelete = new Set(ids.map((x) => Number(x)));
    const deleted: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    const next: typeof rows = [];
    const removedRows: typeof rows = [];
    for (const r of rows) {
      const num = Number(r.account_number);
      if (toDelete.has(num)) {
        deleted.push(String(num));
        removedRows.push(r);
      } else {
        next.push(r);
      }
    }
    // Mark missing ones as failed
    for (const idNum of toDelete) {
      if (!deleted.includes(String(idNum))) failed.push({ id: String(idNum), reason: 'Not found' });
    }
    const encoded = await this.encodeTemplateRows(next);
    await this.update(id, { csv_payload: encoded }, userId, { manager: opts?.manager, skipAudit: true });
    if (removedRows.length > 0) {
      await this.audit.log(
        {
          table: 'coa_template_accounts',
          recordId: id,
          action: 'delete',
          before: removedRows,
          after: null,
          userId: userId ?? null,
        },
        { manager: opts?.manager ?? this.repo.manager },
      );
    }
    return { deleted, failed };
  }
}
