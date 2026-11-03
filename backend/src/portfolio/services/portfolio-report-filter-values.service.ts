import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export type ReportFilterProject = { id: string; ref: string; name: string; status: string };
export type ReportFilterTeam = { id: string; name: string };
export type ReportFilterValues = { projects: ReportFilterProject[]; teams: ReportFilterTeam[] };

/** The project statuses still in play, listed first: a closed project is rarely the one sought. */
const OPEN_PROJECT_STATUSES = ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'];

/**
 * The projects and teams the portfolio reports can be narrowed to. They are served under the
 * reports' own permission: a report reader may have no access to the project list or to the
 * team settings, and still needs the options. Two statements, both filtered on the tenant.
 */
@Injectable()
export class PortfolioReportFilterValuesService {
  async list(tenantId: string, opts: { manager?: EntityManager }): Promise<ReportFilterValues> {
    const manager = opts.manager;
    if (!manager) throw new Error('A tenant-bound EntityManager is required');

    // One after the other: the request's single connection runs its queries in turn anyway.
    const projects = await manager.query(
        `
        SELECT p.id::text AS id, p.item_number, p.name, p.status
        FROM portfolio_projects p
        WHERE p.tenant_id = $1
        ORDER BY
          CASE
            WHEN p.status = ANY($2::text[]) THEN 0
            WHEN p.status = 'done' THEN 1
            WHEN p.status = 'cancelled' THEN 2
            ELSE 3
          END,
          p.name ASC,
          p.item_number ASC
        `,
        [tenantId, OPEN_PROJECT_STATUSES],
      ) as Array<{ id: string; item_number: number | string | null; name: string | null; status: string }>;
    const teams = await manager.query(
        `
        SELECT t.id::text AS id, t.name
        FROM portfolio_teams t
        WHERE t.tenant_id = $1
          AND t.is_active = TRUE
        ORDER BY t.display_order ASC, t.name ASC
        `,
        [tenantId],
      ) as Array<{ id: string; name: string | null }>;

    return {
      projects: projects.map((row) => ({
        id: row.id,
        ref: row.item_number != null ? `PRJ-${row.item_number}` : '',
        name: row.name ?? '',
        status: row.status,
      })),
      teams: teams.map((row) => ({ id: row.id, name: row.name ?? '' })),
    };
  }
}
