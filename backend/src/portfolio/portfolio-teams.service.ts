import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PortfolioTeam, DEFAULT_TEAMS } from './portfolio-team.entity';
import { checkIds, RecordInUseException, refusalsFrom, type DeleteRefusal, type UsageCount } from '../common/record-in-use';

interface CreateTeamDto {
  name: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
  parent_id?: string;
}

interface UpdateTeamDto {
  name?: string;
  description?: string;
  is_active?: boolean;
  display_order?: number;
  parent_id?: string | null;
}

export interface TeamWithMemberCount extends PortfolioTeam {
  member_count: number;
}

@Injectable()
export class PortfolioTeamsService {
  constructor(
    @InjectRepository(PortfolioTeam)
    private teamRepo: Repository<PortfolioTeam>,
  ) {}

  async list(tenantId: string, opts?: { manager?: EntityManager }): Promise<TeamWithMemberCount[]> {
    const mg = opts?.manager ?? this.teamRepo.manager;
    const teams = await mg.query(`
      SELECT
        t.*,
        COALESCE(mc.member_count, 0)::int as member_count
      FROM portfolio_teams t
      LEFT JOIN (
        SELECT team_id, COUNT(*) as member_count
        FROM portfolio_team_member_configs
        WHERE team_id IS NOT NULL
        GROUP BY team_id
      ) mc ON mc.team_id = t.id
      WHERE t.tenant_id = $1
      ORDER BY t.display_order ASC, t.name ASC
    `, [tenantId]);

    return teams;
  }

  async get(id: string, tenantId: string, opts?: { manager?: EntityManager }): Promise<PortfolioTeam | null> {
    const mg = opts?.manager ?? this.teamRepo.manager;
    const repo = mg.getRepository(PortfolioTeam);
    return repo.findOne({
      where: { id, tenant_id: tenantId },
    });
  }

  async create(tenantId: string, data: CreateTeamDto, opts?: { manager?: EntityManager }): Promise<PortfolioTeam> {
    const mg = opts?.manager ?? this.teamRepo.manager;
    const repo = mg.getRepository(PortfolioTeam);

    // Check for duplicate name
    const existing = await repo.findOne({
      where: { tenant_id: tenantId, name: data.name },
    });
    if (existing) {
      throw new BadRequestException(`Team with name "${data.name}" already exists`);
    }

    // Validate parent if provided
    if (data.parent_id) {
      const parent = await repo.findOne({
        where: { id: data.parent_id, tenant_id: tenantId },
      });
      if (!parent) {
        throw new BadRequestException('Parent team not found');
      }
    }

    // Get max display_order if not provided
    let displayOrder = data.display_order;
    if (displayOrder === undefined) {
      const maxResult = await repo
        .createQueryBuilder('t')
        .select('MAX(t.display_order)', 'max')
        .where('t.tenant_id = :tenantId', { tenantId })
        .getRawOne();
      displayOrder = (maxResult?.max ?? -1) + 1;
    }

    const team = repo.create({
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? null,
      is_active: data.is_active ?? true,
      display_order: displayOrder,
      parent_id: data.parent_id ?? null,
      is_system: false,
    });

    return repo.save(team);
  }

  async update(id: string, tenantId: string, data: UpdateTeamDto, opts?: { manager?: EntityManager }): Promise<PortfolioTeam> {
    const mg = opts?.manager ?? this.teamRepo.manager;
    const repo = mg.getRepository(PortfolioTeam);

    const team = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // Check for duplicate name if changing
    if (data.name && data.name !== team.name) {
      const existing = await repo.findOne({
        where: { tenant_id: tenantId, name: data.name },
      });
      if (existing) {
        throw new BadRequestException(`Team with name "${data.name}" already exists`);
      }
    }

    // Validate parent if changing
    if (data.parent_id !== undefined && data.parent_id !== team.parent_id) {
      if (data.parent_id) {
        // Cannot set self as parent
        if (data.parent_id === id) {
          throw new BadRequestException('Team cannot be its own parent');
        }
        const parent = await repo.findOne({
          where: { id: data.parent_id, tenant_id: tenantId },
        });
        if (!parent) {
          throw new BadRequestException('Parent team not found');
        }
      }
    }

    Object.assign(team, {
      ...data,
      updated_at: new Date(),
    });

    return repo.save(team);
  }

  async delete(id: string, tenantId: string, opts?: { manager?: EntityManager }): Promise<void> {
    const mg = opts?.manager ?? this.teamRepo.manager;
    const repo = mg.getRepository(PortfolioTeam);

    const team = await repo.findOne({
      where: { id, tenant_id: tenantId },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }

    const refusal = await this.refusalOf(team, tenantId, mg);
    if (refusal) throw refusal;

    await repo.delete(id);
  }

  /**
   * The refusal the delete of a team would throw, or null: a built-in team (`BUILT_IN_RECORD`), or
   * one its members or sub-teams still keep (`TEAM_NOT_EMPTY`, counted). The delete and its check both ask it.
   */
  private async refusalOf(team: { id: string; name: string; is_system: boolean }, tenantId: string, mg: EntityManager): Promise<RecordInUseException | null> {
    if (team.is_system) {
      return new RecordInUseException('BUILT_IN_RECORD', 'team', team.name, [], `Cannot delete system team "${team.name}". Disable it instead.`);
    }
    const [held] = await mg.query(
      `SELECT (SELECT count(*)::int FROM portfolio_team_member_configs WHERE tenant_id = $1 AND team_id = $2) AS members,
              (SELECT count(*)::int FROM portfolio_teams WHERE tenant_id = $1 AND parent_id = $2) AS children`,
      [tenantId, team.id],
    );
    const usages: UsageCount[] = [];
    if (held?.members > 0) usages.push({ type: 'team_members', total: held.members });
    if (held?.children > 0) usages.push({ type: 'sub_teams', total: held.children });
    if (usages.length === 0) return null;
    return new RecordInUseException('TEAM_NOT_EMPTY', 'team', team.name, usages,
      `Cannot delete team "${team.name}": it still has members assigned or sub-teams. Move them to another team first.`);
  }

  /** The check before a delete (`POST /portfolio/teams/delete-check`): the teams of `ids` the delete would refuse, and why. Nothing is written. */
  async deleteCheck(ids: unknown[], tenantId: string, opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const mg = opts?.manager ?? this.teamRepo.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: Array<{ id: string; name: string; is_system: boolean }> = await mg.query(
      `SELECT id::text AS id, name, is_system FROM portfolio_teams WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, wanted],
    );
    return refusalsFrom(wanted, rows, (row) => row.name, (row) => this.refusalOf(row, tenantId, mg));
  }

  async seedDefaults(tenantId: string, manager?: EntityManager): Promise<{ created: number }> {
    const repo = manager ? manager.getRepository(PortfolioTeam) : this.teamRepo;
    let created = 0;

    for (const def of DEFAULT_TEAMS) {
      const existing = await repo.findOne({
        where: { tenant_id: tenantId, name: def.name },
      });
      if (!existing) {
        const team = repo.create({
          tenant_id: tenantId,
          ...def,
        });
        await repo.save(team);
        created++;
      }
    }

    return { created };
  }
}
