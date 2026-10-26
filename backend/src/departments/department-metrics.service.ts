import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DepartmentMetric } from './department-metric.entity';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { FreezeService } from '../freeze/freeze.service';
import { parseCompanyYear } from '../companies/company-year';

/** A missing year stays "year is required". Any other value must be four digits, 1900 to 2999. */
function requireMetricYear(year: number): void {
  if (!Number.isInteger(year)) throw new BadRequestException('year is required');
  parseCompanyYear(year);
}

@Injectable()
export class DepartmentMetricsService {
  constructor(
    @InjectRepository(DepartmentMetric) private readonly repo: Repository<DepartmentMetric>,
    private readonly audit: AuditService,
    private readonly freeze: FreezeService,
  ) {}

  async getForDepartment(departmentId: string, year: number, opts?: { manager?: EntityManager }) {
    requireMetricYear(year);
    const repo = opts?.manager ? opts.manager.getRepository(DepartmentMetric) : this.repo;
    return repo.findOne({ where: { department_id: departmentId, fiscal_year: year } as any });
  }

  async upsertForDepartment(
    departmentId: string,
    year: number,
    body: Partial<DepartmentMetric>,
    userId?: string,
    opts?: { manager?: EntityManager; audit?: AuditSourceOptions },
  ) {
    requireMetricYear(year);
    const hc = Number(body.headcount);
    if (!Number.isInteger(hc) || hc < 0) throw new BadRequestException('headcount is required and must be a non-negative integer');
    await this.freeze.assertNotFrozen({ scope: 'departments', year }, opts);
    const repo = opts?.manager ? opts.manager.getRepository(DepartmentMetric) : this.repo;
    const existing = await this.getForDepartment(departmentId, year, opts);
    const next = repo.create({
      ...(existing ?? {}),
      department_id: departmentId,
      fiscal_year: year,
      headcount: hc,
    });
    const saved = await repo.save(next);
    await this.audit.log({
      table: 'department_metrics',
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
