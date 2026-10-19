import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CompanyMetric } from './company-metric.entity';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';

@Injectable()
export class CompanyMetricsService {
  constructor(
    @InjectRepository(CompanyMetric) private readonly repo: Repository<CompanyMetric>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
  ) {}

  async list(year: number, opts?: { manager?: EntityManager }) {
    if (!Number.isInteger(year)) throw new BadRequestException('year is required');
    const repo = opts?.manager ? opts.manager.getRepository(CompanyMetric) : this.repo;
    const items = await repo.find({ where: { fiscal_year: year } as any, order: { created_at: 'DESC' as any } });
    return { items, total: items.length };
  }

  async getForCompany(companyId: string, year: number, opts?: { manager?: EntityManager }) {
    const repo = opts?.manager ? opts.manager.getRepository(CompanyMetric) : this.repo;
    const found = await repo.findOne({ where: { company_id: companyId, fiscal_year: year } as any });
    return found || null;
  }

  /** Refuses a write of company metrics for a frozen year (`DATA_FROZEN`). */
  async assertYearOpen(year: number, opts?: { manager?: EntityManager }) {
    await this.freeze.assertNotFrozen({ scope: 'companies', year }, opts);
  }

  async upsertForCompany(
    companyId: string,
    year: number,
    body: Partial<CompanyMetric>,
    userId?: string,
    opts?: { manager?: EntityManager; audit?: AuditSourceOptions },
  ) {
    if (!Number.isInteger(year)) throw new BadRequestException('year is required');
    if (body.headcount == null || !Number.isInteger(Number(body.headcount)) || Number(body.headcount) < 0) {
      throw new BadRequestException('headcount is required and must be a non-negative integer');
    }
    await this.freeze.assertNotFrozen({ scope: 'companies', year }, opts);
    const repo = opts?.manager ? opts.manager.getRepository(CompanyMetric) : this.repo;
    const existing = await this.getForCompany(companyId, year, opts);
    // Validate integers and decimals
    if (body.it_users != null) {
      const iu = Number(body.it_users);
      if (!Number.isInteger(iu) || iu < 0) throw new BadRequestException('it_users must be a non-negative integer');
    }
    if (body.turnover != null) {
      const tv = Number(body.turnover);
      if (!Number.isFinite(tv) || tv < 0) throw new BadRequestException('turnover must be a non-negative number');
      const decimals = (String(body.turnover).split('.')[1] || '').length;
      if (decimals > 3) throw new BadRequestException('turnover allows at most 3 decimals');
    }
    const next = repo.create({
      ...(existing ?? {}),
      company_id: companyId,
      fiscal_year: year,
      headcount: Number(body.headcount),
      it_users: body.it_users != null ? Number(body.it_users) : null,
      turnover: body.turnover != null ? Number(body.turnover) : null,
    });
    const saved = await repo.save(next);
    await this.audit.log({
      table: 'company_metrics',
      recordId: saved.id,
      action: existing ? 'update' : 'create',
      before: existing,
      after: saved,
      userId,
      source: opts?.audit?.source,
      sourceRef: opts?.audit?.sourceRef,
    }, { manager: opts?.manager ?? repo.manager });
    return saved;
  }
}
