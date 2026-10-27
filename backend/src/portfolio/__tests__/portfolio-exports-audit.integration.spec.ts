// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { from, lastValueFrom } from 'rxjs';
import type { EntityManager, QueryRunner } from 'typeorm';
import { ExportEventsInterceptor } from '../../audit/export-events.interceptor';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { parseRoadmapGenerate } from '../dto/roadmap.dto';
import { PortfolioRoadmapController } from '../portfolio-roadmap.controller';
import { TeamMemberConfigController } from '../team-member-config.controller';

/**
 * The audit rows of the two portfolio exports the server now builds: the skills matrix
 * (`GET /portfolio/team-members/skills-matrix/export`) and the roadmap occupation
 * (`POST /portfolio/reports/roadmap/occupation/export`). Each request through ExportEventsInterceptor
 * writes one `export` row with the format and the count of data rows the file holds (footers left out).
 * The data comes from stubs (the rows themselves are checked by `skills-matrix-export.spec.ts` and
 * `roadmap-occupation-export.spec.ts`); the audit row and the user are real, in a rolled-back transaction.
 */

type World = { tenantId: string; userId: string };

async function seedWorld(runner: QueryRunner): Promise<World> {
  const tenantId = await seedTenant(runner, 'pfexport');
  const [{ id: roleId }] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Portfolio reader') RETURNING id`, [tenantId]);
  const [{ id: userId }] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Portfolio', 'Export', $3, 'enabled') RETURNING id`,
    [tenantId, roleId, `pf-export-${randomUUID()}@example.invalid`],
  );
  return { tenantId, userId };
}

function response(req: unknown) {
  const headers: Record<string, string> = {};
  const res: any = {
    req,
    headersSent: false,
    setHeader: (name: string, value: string) => { headers[name] = value; },
    getHeader: (name: string) => headers[name],
    send: () => { res.headersSent = true; },
  };
  return res;
}

/** Runs `handler` as Nest would, through the export interceptor, then reads the export row of `path`. */
async function auditRow(
  m: EntityManager,
  w: World,
  path: string,
  query: Record<string, unknown>,
  controller: object,
  handler: (...args: any[]) => Promise<unknown>,
  call: (res: unknown, ctx: unknown) => Promise<unknown>,
) {
  const req = { queryRunner: { manager: m, isReleased: false }, tenant: { id: w.tenantId }, user: { sub: w.userId }, query, path };
  const res = response(req);
  const ctx = { tenantId: w.tenantId, userId: w.userId, userRoles: [], isAdmin: false, permissions: {}, manager: m };
  const context: any = {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  };
  await lastValueFrom(new ExportEventsInterceptor().intercept(context, { handle: () => from(call(res, ctx)) }), { defaultValue: undefined });
  const rows: Array<{ after: any }> = await m.query(
    `SELECT after_json AS after FROM audit_log WHERE tenant_id = $1 AND table_name = 'export' AND after_json->>'path' = $2`,
    [w.tenantId, path],
  );
  assert.equal(rows.length, 1, `one export row for ${path}`);
  return { format: rows[0].after.format, rows: rows[0].after.rows };
}

async function testSkillsMatrix() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const members = [
      { id: 'c-ann', item_number: 3, user_display_name: 'Ann Durand', team_id: null, skills: [{ skill_id: 's-sql', proficiency: 4 }] },
      { id: 'c-bob', item_number: 7, user_display_name: 'Bob Klein', team_id: null, skills: [{ skill_id: 's-sql', proficiency: 2 }] },
    ];
    const skills = [
      { id: 's-sql', category: 'Data', name: 'SQL', enabled: true },
      { id: 's-bi', category: 'Data', name: 'BI', enabled: true },
    ];
    const http = new TeamMemberConfigController(
      { list: async () => ({ items: members }) } as any,
      {} as any,
      { list: async () => [] } as any,
      { list: async () => ({ items: skills }) } as any,
    );
    const query = { format: 'xlsx', language: 'en', tz: 'UTC', orientation: 'skills', showUnused: 'true' };
    const row = await auditRow(
      runner.manager, w, '/portfolio/team-members/skills-matrix/export', query,
      TeamMemberConfigController, TeamMemberConfigController.prototype.exportSkillsMatrix,
      (res, ctx) => http.exportSkillsMatrix(query, ctx as any, res as any),
    );
    // Two contributors as rows; the coverage line is a footer.
    assert.deepEqual(row, { format: 'xlsx', rows: 2 });
  });
  console.log('  skills matrix: the export row carries the format and the row count');
}

async function testRoadmapOccupation() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const payload = { startDate: '2026-01-05' };
    const entry = (contributorId: string, teamId: string | null, week: string, occupationPct: number) => ({
      contributorId, contributorName: contributorId, teamId, teamName: teamId, week, effortDays: 1, capacityDays: 1, occupationPct, projects: [],
    });
    const occupation = [
      entry('Ann', 'Apps', '2026-01-05', 80), entry('Ann', 'Apps', '2026-01-12', 60),
      entry('Bob', 'Data', '2026-01-05', 100), entry('Cyd', 'Data', '2026-01-12', 40),
    ];
    const teamOccupation = [
      { teamId: 'Apps', teamName: 'Apps', week: '2026-01-05', effortDays: 1, capacityDays: 1, occupationPct: 80 },
      { teamId: 'Data', teamName: 'Data', week: '2026-01-05', effortDays: 1, capacityDays: 1, occupationPct: 100 },
    ];
    const http = new PortfolioRoadmapController({
      generateRoadmap: async (_tenantId: string, body: unknown, _opts: unknown, runOpts: unknown) => {
        assert.deepEqual(runOpts, { skipSensitivity: true }, 'the export skips the sensitivity reruns');
        return { occupation, teamOccupation, options: parseRoadmapGenerate(body) };
      },
    } as any);
    for (const [format, table, rows] of [['xlsx', 'contributors', 5], ['csv', 'teams', 2]] as const) {
      await inSavepoint(runner, async () => {
        const query = { format, language: 'en', tz: 'UTC', table };
        const row = await auditRow(
          runner.manager, w, '/portfolio/reports/roadmap/occupation/export', query,
          PortfolioRoadmapController, PortfolioRoadmapController.prototype.exportRoadmapOccupation,
          (res, ctx) => http.exportRoadmapOccupation(query, payload as any, ctx as any, res as any),
        );
        // xlsx: three contributors and two teams; CSV: the teams table only. Average rows are footers.
        assert.deepEqual(row, { format, rows });
      });
    }
  });
  console.log('  roadmap occupation: the export row carries the format and the row count');
}

async function inSavepoint(runner: QueryRunner, fn: () => Promise<void>) {
  await runner.query('SAVEPOINT pf_export_case');
  try {
    await fn();
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT pf_export_case');
  }
}

void runSpecs('portfolio-exports-audit.integration.spec', [
  ['skills matrix', testSkillsMatrix],
  ['roadmap occupation', testRoadmapOccupation],
]);
