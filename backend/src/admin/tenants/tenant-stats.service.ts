import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { withTenant } from '../../common/tenant-runner';

export type TenantStats = {
  companies: number;
  headcount: number;
  departments: number;
  suppliers: number;
  opexEntries: number;
  capexEntries: number;
  users: {
    total: number;
    enabled: number;
  };
};

@Injectable()
export class TenantStatsService {
  constructor(private readonly dataSource: DataSource) {}

  async compute(tenantId: string): Promise<TenantStats> {
    return withTenant(this.dataSource, tenantId, async (manager) => {
      // One after the other: the tenant's single connection runs its queries in turn anyway.
      const companiesRow = await manager.query(`SELECT COUNT(*)::int AS count FROM companies`);
      const departmentsRow = await manager.query(`SELECT COUNT(*)::int AS count FROM departments`);
      const suppliersRow = await manager.query(`SELECT COUNT(*)::int AS count FROM suppliers`);
      const opexRow = await manager.query(`SELECT COUNT(*)::int AS count FROM spend_items WHERE nature = 'opex'`);
      const capexRow = await manager.query(`SELECT COUNT(*)::int AS count FROM spend_items WHERE nature = 'capex'`);
      const usersTotalRow = await manager.query(`SELECT COUNT(*)::int AS count FROM users`);
      const usersEnabledRow = await manager.query(`SELECT COUNT(*)::int AS count FROM users WHERE status = 'enabled'`);

      const headcountRows = await manager.query(`
        SELECT COALESCE(SUM(latest.headcount), 0)::int AS total_headcount
        FROM (
          SELECT DISTINCT ON (company_id) company_id, headcount
          FROM company_metrics
          ORDER BY company_id, fiscal_year DESC
        ) AS latest
      `);

      return {
        companies: Number(companiesRow?.[0]?.count ?? 0),
        headcount: Number(headcountRows?.[0]?.total_headcount ?? 0),
        departments: Number(departmentsRow?.[0]?.count ?? 0),
        suppliers: Number(suppliersRow?.[0]?.count ?? 0),
        opexEntries: Number(opexRow?.[0]?.count ?? 0),
        capexEntries: Number(capexRow?.[0]?.count ?? 0),
        users: {
          total: Number(usersTotalRow?.[0]?.count ?? 0),
          enabled: Number(usersEnabledRow?.[0]?.count ?? 0),
        },
      };
    });
  }
}

