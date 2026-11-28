import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PortfolioEmploymentType, DEFAULT_EMPLOYMENT_TYPES } from './portfolio-employment-type.entity';
import { checkIds, RecordInUseException, refusalsFrom, type DeleteRefusal } from '../common/record-in-use';
import { writeAuditLog, writeAuditLogs } from '../audit/audit.service';
import { assignFields } from './settings-fields';

interface CreateEmploymentTypeDto {
  name: string;
  is_active?: boolean;
  display_order?: number;
}

interface UpdateEmploymentTypeDto {
  name?: string;
  is_active?: boolean;
  display_order?: number;
}

export interface EmploymentTypeWithUsage extends PortfolioEmploymentType {
  usage_count: number;
}

@Injectable()
export class PortfolioEmploymentTypesService {
  constructor(
    @InjectRepository(PortfolioEmploymentType)
    private typeRepo: Repository<PortfolioEmploymentType>,
  ) {}

  async list(tenantId: string, opts?: { manager?: EntityManager }): Promise<EmploymentTypeWithUsage[]> {
    const mg = opts?.manager ?? this.typeRepo.manager;
    // The count travels with the list so the settings page can disable Delete
    // without a second round trip, the same way teams carry member_count.
    return mg.query(`
      SELECT
        et.*,
        COALESCE(uc.usage_count, 0)::int as usage_count
      FROM portfolio_employment_types et
      LEFT JOIN (
        SELECT employment_type_id, COUNT(*) as usage_count
        FROM portfolio_team_member_configs
        WHERE employment_type_id IS NOT NULL
        GROUP BY employment_type_id
      ) uc ON uc.employment_type_id = et.id
      WHERE et.tenant_id = $1
      ORDER BY et.display_order ASC, et.name ASC
    `, [tenantId]);
  }

  async get(id: string, tenantId: string, opts?: { manager?: EntityManager }): Promise<PortfolioEmploymentType | null> {
    const mg = opts?.manager ?? this.typeRepo.manager;
    const repo = mg.getRepository(PortfolioEmploymentType);
    return repo.findOne({ where: { id, tenant_id: tenantId } });
  }

  async create(
    tenantId: string,
    data: CreateEmploymentTypeDto,
    opts?: { manager?: EntityManager; userId?: string | null },
  ): Promise<PortfolioEmploymentType> {
    const mg = opts?.manager ?? this.typeRepo.manager;
    const repo = mg.getRepository(PortfolioEmploymentType);

    const existing = await repo.findOne({ where: { tenant_id: tenantId, name: data.name } });
    if (existing) {
      throw new BadRequestException(`Contract type "${data.name}" already exists`);
    }

    let displayOrder = data.display_order;
    if (displayOrder === undefined) {
      const maxResult = await repo
        .createQueryBuilder('et')
        .select('MAX(et.display_order)', 'max')
        .where('et.tenant_id = :tenantId', { tenantId })
        .getRawOne();
      displayOrder = (maxResult?.max ?? -1) + 1;
    }

    const type = repo.create({
      tenant_id: tenantId,
      name: data.name,
      is_active: data.is_active ?? true,
      display_order: displayOrder,
      is_system: false,
    });

    const saved = await repo.save(type);
    await writeAuditLog(mg, { table: 'portfolio_employment_types', recordId: saved.id, action: 'create', before: null, after: saved, userId: opts?.userId ?? null });
    return saved;
  }

  async update(
    id: string,
    tenantId: string,
    data: UpdateEmploymentTypeDto,
    opts?: { manager?: EntityManager; userId?: string | null },
  ): Promise<PortfolioEmploymentType> {
    const mg = opts?.manager ?? this.typeRepo.manager;
    const repo = mg.getRepository(PortfolioEmploymentType);

    const type = await repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!type) {
      throw new NotFoundException('Contract type not found');
    }

    if (data.name && data.name !== type.name) {
      const existing = await repo.findOne({ where: { tenant_id: tenantId, name: data.name } });
      if (existing) {
        throw new BadRequestException(`Contract type "${data.name}" already exists`);
      }
    }

    const before = { ...type };
    assignFields(type, data, ['name', 'is_active', 'display_order']);
    type.updated_at = new Date();

    const saved = await repo.save(type);
    await writeAuditLog(mg, { table: 'portfolio_employment_types', recordId: id, action: 'update', before, after: saved, userId: opts?.userId ?? null });
    return saved;
  }

  async delete(id: string, tenantId: string, opts?: { manager?: EntityManager; userId?: string | null }): Promise<void> {
    const mg = opts?.manager ?? this.typeRepo.manager;
    const repo = mg.getRepository(PortfolioEmploymentType);

    const type = await repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!type) {
      throw new NotFoundException('Contract type not found');
    }

    const refusal = await this.refusalOf(type, tenantId, mg);
    if (refusal) throw refusal;

    await repo.delete(id);
    await writeAuditLog(mg, { table: 'portfolio_employment_types', recordId: id, action: 'delete', before: type, after: null, userId: opts?.userId ?? null });
  }

  /**
   * The refusal the delete of a contract type would throw, or null: a built-in type
   * (`BUILT_IN_RECORD`), or one contributors still have (`RECORD_USED_BY`). The delete and its check both ask it.
   */
  private async refusalOf(type: { id: string; name: string; is_system: boolean }, tenantId: string, mg: EntityManager): Promise<RecordInUseException | null> {
    if (type.is_system) {
      return new RecordInUseException('BUILT_IN_RECORD', 'contract type', type.name, [],
        `Cannot delete a built-in contract type ("${type.name}"). Disable it instead.`);
    }
    const [usage] = await mg.query(
      `SELECT count(*)::int AS n FROM portfolio_team_member_configs WHERE tenant_id = $1 AND employment_type_id = $2`,
      [tenantId, type.id],
    );
    if (!(usage?.n > 0)) return null;
    return new RecordInUseException('RECORD_USED_BY', 'contract type', type.name, [{ type: 'contributors', total: usage.n }],
      `Cannot delete contract type "${type.name}": it is assigned to contributors. Disable it instead.`);
  }

  /** The check before a delete (`POST /portfolio/employment-types/delete-check`): the types of `ids` the delete would refuse, and why. Nothing is written. */
  async deleteCheck(ids: unknown[], tenantId: string, opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const mg = opts?.manager ?? this.typeRepo.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: Array<{ id: string; name: string; is_system: boolean }> = await mg.query(
      `SELECT id::text AS id, name, is_system FROM portfolio_employment_types WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    return refusalsFrom(wanted, rows, (row) => row.name, (row) => this.refusalOf(row, tenantId, mg));
  }

  /** Creates the default contract types a workspace lacks; each one gets its audit row, in the name of `userId`. */
  async seedDefaults(tenantId: string, manager?: EntityManager, userId: string | null = null): Promise<{ created: number }> {
    const mg = manager ?? this.typeRepo.manager;
    const repo = mg.getRepository(PortfolioEmploymentType);
    const created: PortfolioEmploymentType[] = [];

    for (const def of DEFAULT_EMPLOYMENT_TYPES) {
      const existing = await repo.findOne({ where: { tenant_id: tenantId, name: def.name } });
      if (!existing) {
        created.push(await repo.save(repo.create({ tenant_id: tenantId, ...def })));
      }
    }

    if (created.length > 0) {
      await writeAuditLogs(mg, created.map((type) => ({ table: 'portfolio_employment_types', recordId: type.id, action: 'create', before: null, after: type, userId })));
    }
    return { created: created.length };
  }
}
