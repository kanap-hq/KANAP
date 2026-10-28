import * as assert from 'node:assert/strict';
import { PortfolioCapacityReportService } from '../services/portfolio-capacity-report.service';

/**
 * The capacity heatmap's team grouping: the people without a team come as one `no-team` row, and
 * the answer names it null so that the screen and the exports write their own translated label.
 * The fake manager answers the two reads of a report without projects; no database.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const TEAM_A = '11111111-1111-4111-8111-111111111111';

function managerStub() {
  const queries: string[] = [];
  const manager = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM portfolio_team_member_configs tmc')) {
        return [
          {
            config_id: 'c1', user_id: 'u1', team_id: TEAM_A, project_availability: 10,
            user_display_name: 'Ann Durand', user_email: 'ann@example.com', team_name: 'Applications',
          },
          {
            config_id: 'c2', user_id: 'u2', team_id: null, project_availability: 8,
            user_display_name: 'Bob Klein', user_email: 'bob@example.com', team_name: null,
          },
          {
            config_id: 'c3', user_id: 'u3', team_id: null, project_availability: 6,
            user_display_name: 'Cyd Moreau', user_email: 'cyd@example.com', team_name: null,
          },
        ];
      }
      if (sql.includes('FROM portfolio_projects p')) return [];
      throw new Error(`Unexpected statement: ${sql}`);
    },
  } as any;
  return { manager, queries };
}

async function run() {
  const { manager } = managerStub();
  const service = new PortfolioCapacityReportService(
    {} as any,
    { getAllTimeStats: async () => ({ stats: {} }) } as any,
  );
  const result = await service.getHeatmap(TENANT, { capacityMode: 'theoretical' }, { manager });
  assert.deepEqual(
    result.teams.map((team) => [team.teamId, team.teamName]),
    [[TEAM_A, 'Applications'], ['no-team', null]],
    'the no-team row keeps its place after the named teams and carries no label',
  );
  assert.equal(result.teams[1].memberCount, 2);
  assert.ok(!JSON.stringify(result).includes('No team'), 'no English label in the answer');
  console.log('portfolio-capacity-report.service.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
