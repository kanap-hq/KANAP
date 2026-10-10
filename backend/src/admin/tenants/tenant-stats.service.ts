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
      const [companiesRow, departmentsRow, suppliersRow, opexRow, capexRow, usersTotalRow, usersEnabledRow] = await Promise.all([
        manager.query(`SELECT COUNT(*)::int AS count FROM companies`),
        manager.query(`SELECT COUNT(*)::int AS count FROM departments`),
        manager.query(`SELECT COUNT(*)::int AS count FROM suppliers`),
        manager.query(`SELECT COUNT(*)::int AS count FROM spend_items WHERE nature = 'opex'`),
        manager.query(`SELECT COUNT(*)::int AS count FROM spend_items WHERE nature = 'capex'`),
        manager.query(`SELECT COUNT(*)::int AS count FROM users`),
        manager.query(`SELECT COUNT(*)::int AS count FROM users WHERE status = 'enabled'`),
      ]);

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

