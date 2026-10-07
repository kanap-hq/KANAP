import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { DataSource, EntityManager } from 'typeorm';
import { TENANT_RESET_RUNNING_CODE, TenantResetService } from '../admin/tenants/tenant-reset.service';
import { AuthService } from '../auth/auth.service';
import { StripeConfigService } from '../billing/stripe/stripe.config';
import { Subscription } from '../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../billing/subscription-freeze.util';
import { trackBackgroundWork } from '../common/background-work';
import { throwNotAvailableInMode } from '../common/feature-gates';
import { tenantSlugFromHost } from '../common/tenancy/request-tenancy.middleware';
import { withTenant } from '../common/tenant-runner';
import { Features } from '../config/features';
import { TenantBaselineService } from '../tenants/tenant-baseline.service';
import { TenantStatus } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';

/**
 * Sample data (the Fromage & Co set) in a cloud tenant.
 *
 * The loader is the fixture script `fixtures/fromage-co/setup-tenant.mjs` in server mode, run
 * as a child process of the API. It calls the API of this installation on 127.0.0.1 with the
 * tenant's Host and an access token of the administrator who asked for the load, passed in its
 * environment only. The load is visible and not atomic: when it fails, the tenant is reset to
 * its post-activation state (TenantResetService) once the process has ended.
 *
 * The state lives in `tenants.metadata.demo` (every API process reads the same one), written by
 * conditional updates of that key alone:
 *   idle → loading → loaded            the load succeeded
 *          loading → resetting → failed the load failed, timed out or its process died
 *   loaded | failed → resetting → idle  a reset asked for by an administrator
 * While the status is `resetting`, the tenancy middleware refuses the tenant's write requests
 * (409 `tenant_resetting`). Each run carries an id: a run only moves the state it claimed, so a
 * late write of an old run never moves a newer one.
 */

export const DEMO_STATUSES = ['idle', 'loading', 'loaded', 'failed', 'resetting'] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];

/** Why a load ended in `failed` (read by the interface, never a raw message). */
export type DemoErrorCode =
  | 'load_failed' // the loader reported an error or a warning
  | 'load_timeout' // the loader ran longer than the time limit and was stopped
  | 'load_not_started' // the loader process could not be started
  | 'load_interrupted' // the API process that ran the load stopped
  | 'reset_failed'; // the automatic reset after a failed load failed too

/** The state of the sample data of a tenant, as `getStatus` returns it. */
export type DemoDataState = {
  status: DemoStatus;
  /** The step the running load is at (a loader step name), null otherwise. */
  step: string | null;
  started_at: string | null;
  heartbeat_at: string | null;
  loaded_at: string | null;
  /** The user who started the last load. */
  loaded_by: string | null;
  failed_at: string | null;
  error_code: DemoErrorCode | null;
  /** When an administrator hid the home banner (written by the interface). */
  dismissed_at: string | null;
};

/** The stored state: the public one plus the id of the run that owns it. */
type StoredDemoState = DemoDataState & { run_id: string | null };

/**
 * The main business tables of a workspace. Sample data is loaded only into a workspace where
 * they are all empty: what trial activation creates (the starting company, the document
 * templates) aside. A reset later erases everything, so a workspace with real content never
 * gets sample data.
 */
export const DEMO_LOAD_EMPTY_TABLES = [
  'applications',
  'app_instances',
  'assets',
  'business_processes',
  'capex_items',
  'connections',
  'contacts',
  'contracts',
  'cost_centers',
  'departments',
  'incidents',
  'interfaces',
  'locations',
  'portfolio_projects',
  'portfolio_requests',
  'spend_items',
  'suppliers',
  'tasks',
] as const;

/** The loader, from the backend directory (`src/`, `dist/` and `ci-dist/` all sit below it). */
export const DEMO_SCRIPT_RELATIVE_PATH = path.join('fixtures', 'fromage-co', 'setup-tenant.mjs');

/** The environment variables the loader gets besides its own `KANAP_DEMO_*` inputs. */
export const LOADER_INHERITED_ENV = ['PATH', 'NODE_ENV'] as const;

const STEP_LINE = /^KANAP_DEMO_STEP ([a-z0-9-]{1,64})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Lines of loader output kept in memory for the server log of a failed load. */
const OUTPUT_LINES_KEPT = 40;
const OUTPUT_LINE_MAX = 400;

/**
 * The advisory lock namespace of the load claim ("DEMO"): the two-key form, apart from the
 * tenant reset lock and the other namespaces.
 */
const DEMO_LOCK_NAMESPACE = 0x44454d4f;
const DEMO_CLAIM_LOCK_KEY = 'demo-load-claim';

export type DemoLoaderConfig = {
  /** The loader script; null when it is not found below the backend directory. */
  scriptPath: string | null;
  /** The API root the loader calls: this installation, on the loopback address. */
  apiUrl: string;
  /** Loads running at once over every tenant (`DEMO_LOAD_MAX_CONCURRENT`, default 2). */
  maxConcurrent: number;
  heartbeatMs: number;
  /** A load or a reset whose heartbeat is older is dead: its API process stopped. */
  staleMs: number;
  /** A load running longer is stopped and counts as failed. */
  timeoutMs: number;
  spawn: typeof nodeSpawn;
};

/** The loader script, looked up from `from` towards the root of the file system. */
export function findDemoScript(from: string = __dirname): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, DEMO_SCRIPT_RELATIVE_PATH);
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return fallback;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 1 ? value : fallback;
}

export function readDemoLoaderConfig(env: NodeJS.ProcessEnv = process.env): DemoLoaderConfig {
  return {
    scriptPath: findDemoScript(),
    apiUrl: `http://127.0.0.1:${positiveInt(env.PORT, 8080)}`,
    maxConcurrent: positiveInt(env.DEMO_LOAD_MAX_CONCURRENT, 2),
    heartbeatMs: 15_000,
    staleMs: 2 * 60_000,
    timeoutMs: 12 * 60_000,
    spawn: nodeSpawn,
  };
}

export type LoaderInputs = {
  apiUrl: string;
  host: string;
  token: string;
  startingCompany: string;
  year: number;
};

/**
 * The loader's whole environment: PATH and NODE_ENV of the API, its five inputs, nothing else
 * (no database address, no secret of the API). The token travels only here.
 */
export function buildLoaderEnv(inputs: LoaderInputs, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of LOADER_INHERITED_ENV) {
    const value = parent[key];
    if (value) env[key] = value;
  }
  env.KANAP_DEMO_API_URL = inputs.apiUrl;
  env.KANAP_DEMO_HOST = inputs.host;
  env.KANAP_DEMO_TOKEN = inputs.token;
  env.KANAP_DEMO_STARTING_COMPANY = inputs.startingCompany;
  env.KANAP_DEMO_YEAR = String(inputs.year);
  return env;
}

/** The host name of a request Host header: lower case, without the port; null when malformed. */
export function normalizeTenantHost(host: unknown): string | null {
  const name = String(host ?? '').trim().toLowerCase().split(':')[0] ?? '';
  return HOST_NAME.test(name) && name.length <= 253 ? name : null;
}

/**
 * Tables of `DEMO_LOAD_EMPTY_TABLES` that hold a row, plus `companies` beyond the starting
 * company, `documents` outside the templates library, and `users` on `.example` addresses
 * (sample data users). Empty: the workspace is still in its starting state. Runs under the
 * tenant's RLS context.
 */
export async function findTenantContent(manager: EntityManager, tenantId: string): Promise<string[]> {
  const checks = [
    ...DEMO_LOAD_EMPTY_TABLES.map((table) =>
      `SELECT '${table}' AS t WHERE EXISTS (SELECT 1 FROM ${table} WHERE tenant_id = $1)`),
    `SELECT 'companies' AS t WHERE (SELECT count(*) FROM companies WHERE tenant_id = $1) > 1`,
    `SELECT 'documents' AS t WHERE EXISTS (
       SELECT 1 FROM documents d LEFT JOIN document_libraries l ON l.id = d.library_id AND l.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND l.slug IS DISTINCT FROM 'templates')`,
    `SELECT 'users' AS t WHERE EXISTS (SELECT 1 FROM users WHERE tenant_id = $1 AND lower(email) LIKE '%.example')`,
  ];
  const rows: Array<{ t: string }> = await manager.query(checks.join(' UNION ALL '), [tenantId]);
  return rows.map((row) => row.t);
}

function isDemoStatus(value: unknown): value is DemoStatus {
  return typeof value === 'string' && (DEMO_STATUSES as readonly string[]).includes(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The stored state read leniently: anything malformed reads as missing (status `idle`). */
export function readDemoState(raw: unknown): StoredDemoState {
  const demo = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    status: isDemoStatus(demo.status) ? demo.status : 'idle',
    step: text(demo.step),
    started_at: text(demo.started_at),
    heartbeat_at: text(demo.heartbeat_at),
    loaded_at: text(demo.loaded_at),
    loaded_by: text(demo.loaded_by),
    failed_at: text(demo.failed_at),
    error_code: text(demo.error_code) as DemoErrorCode | null,
    dismissed_at: text(demo.dismissed_at),
    run_id: text(demo.run_id),
  };
}

function publicState(state: StoredDemoState): DemoDataState {
  const { run_id: _runId, ...rest } = state;
  return rest;
}

const nowIso = () => new Date().toISOString();

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type TenantRow = { id: string; slug: string; name: string; status: string; is_system_tenant: boolean | null; demo: unknown };

/** What the stored state must be for a conditional update to apply. */
type StateCondition = {
  statuses: readonly DemoStatus[];
  /** The run that owns the state; undefined: any run. */
  runId?: string | null;
  /** The stored heartbeat; undefined: any. */
  heartbeatAt?: string | null;
};

type ExitOutcome = { code: number | null; signal: NodeJS.Signals | null; error?: Error };

type RunningLoad = {
  runId: string;
  child: ChildProcess | null;
  /** The API process is stopping: the run leaves its state for the reconciliation. */
  stopped: boolean;
  timedOut: boolean;
};

const DEMO_SQL = `(CASE WHEN jsonb_typeof(metadata->'demo') = 'object' THEN metadata->'demo' ELSE '{}'::jsonb END)`;
const STATUS_SQL = `COALESCE(metadata->'demo'->>'status', 'idle')`;

@Injectable()
export class DemoDataService implements OnApplicationShutdown {
  private readonly logger = new Logger(DemoDataService.name);
  /** Read once at construction; specs replace fields (script, API address, delays, spawn). */
  readonly config: DemoLoaderConfig = readDemoLoaderConfig();
  /** Loads this API process runs, by tenant. */
  private readonly running = new Map<string, RunningLoad>();
  private stopping = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantReset: TenantResetService,
    private readonly baseline: TenantBaselineService,
    private readonly auth: AuthService,
    private readonly stripeConfig: StripeConfigService,
  ) {}

  /** The tenant's sample data state. A load or a reset left by a stopped API process is taken over. */
  async getStatus(tenantId: string): Promise<DemoDataState> {
    const tenant = await this.readTenant(tenantId);
    return publicState(await this.reconcile(tenant.id, readDemoState(tenant.demo)));
  }

  /**
   * Starts loading the sample data into the tenant and returns at once (status `loading`).
   * Only into a workspace still in its starting state, by one of its administrators, from a
   * host of the tenant, with a subscription in good standing, and while fewer than
   * `DEMO_LOAD_MAX_CONCURRENT` loads run over every tenant.
   */
  async load(params: { tenantId: string; actorId: string; host: string }): Promise<DemoDataState> {
    const tenant = await this.readTenant(params.tenantId);
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException({ code: 'tenant_not_active', message: 'This workspace is not active.' });
    }
    const host = normalizeTenantHost(params.host);
    if (!host || !SLUG.test(tenant.slug) || tenantSlugFromHost(host) !== tenant.slug) {
      throw new BadRequestException({ code: 'host_mismatch', message: 'The request does not come from this workspace.' });
    }
    if (this.stopping) {
      throw new ServiceUnavailableException({ code: 'demo_data_unavailable', message: 'The server is restarting. Try again in a minute.' });
    }
    const scriptPath = this.config.scriptPath;
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      this.logger.error(`Sample data loader not found (${DEMO_SCRIPT_RELATIVE_PATH} below the backend directory)`);
      throw new ServiceUnavailableException({ code: 'demo_data_unavailable', message: 'Sample data is not available on this server.' });
    }

    const actor = await withTenant(this.dataSource, tenant.id, (manager) =>
      this.requireAdministrator(manager, tenant.id, params.actorId));
    const state = await this.reconcile(tenant.id, readDemoState(tenant.demo));
    if (state.status !== 'idle' && state.status !== 'failed') throw this.statusConflict(state.status);

    const startingCompany = await withTenant(this.dataSource, tenant.id, async (manager) => {
      await this.assertSubscriptionAllowsLoad(manager, tenant.id);
      const content = await findTenantContent(manager, tenant.id);
      if (content.length > 0) {
        throw new ConflictException({
          code: 'tenant_not_empty',
          message: 'Sample data can only be loaded into a workspace that holds no data yet.',
          tables: content,
        });
      }
      return (await this.baseline.resolveStartingCompany(manager, tenant)).companyName;
    });

    // The access token of the administrator, for the loader only (its environment, never an
    // argument, never logged). Signed before the claim: a claimed load always starts its run.
    const token = this.auth.signToken({ id: actor.id, email: actor.email, role: actor.role, tenant_id: tenant.id }).access_token;
    const runId = randomUUID();
    const claimed = await this.claim(tenant.id, actor.id, runId);
    this.runInBackground(`load of tenant ${tenant.id}`, () => this.runLoad({
      tenantId: tenant.id,
      actorId: actor.id,
      runId,
      scriptPath,
      env: buildLoaderEnv({
        apiUrl: this.config.apiUrl,
        host,
        token,
        startingCompany,
        year: new Date().getFullYear(),
      }),
      token,
    }));
    return publicState(claimed);
  }

  /**
   * Erases the tenant back to its post-activation state (TenantResetService) after a load,
   * loaded or failed, by one of its administrators; then the status is `idle` again. Allowed
   * with a frozen subscription or an expired trial. Waits for the reset.
   */
  async reset(params: { tenantId: string; actorId: string }): Promise<DemoDataState> {
    const tenant = await this.readTenant(params.tenantId);
    await withTenant(this.dataSource, tenant.id, (manager) => this.requireAdministrator(manager, tenant.id, params.actorId));
    const state = await this.reconcile(tenant.id, readDemoState(tenant.demo));
    if (state.status !== 'loaded' && state.status !== 'failed') throw this.statusConflict(state.status);

    const runId = randomUUID();
    const moved = await this.update(tenant.id, { statuses: [state.status], runId: state.run_id }, {
      status: 'resetting',
      run_id: runId,
      heartbeat_at: nowIso(),
      step: null,
      error_code: null,
    });
    if (!moved) throw this.statusConflict((await this.readState(tenant.id)).status);

    try {
      await this.withHeartbeat(tenant.id, runId, () => this.tenantReset.reset(tenant.id, params.actorId));
    } catch (error) {
      // The reset is one transaction: nothing changed, the state goes back to what it was.
      await this.update(tenant.id, { statuses: ['resetting'], runId }, { ...state }).catch((restoreError) => {
        this.logger.error(`Sample data state of tenant ${tenant.id} not restored after a failed reset: ${errorMessage(restoreError)}`);
      });
      throw error;
    }
    const settled = await this.update(tenant.id, { statuses: ['resetting'], runId }, this.idleState());
    this.logger.log(`Tenant ${tenant.id} reset to its starting state after sample data`);
    return publicState(settled ?? (await this.readState(tenant.id)));
  }

  /**
   * At the start of the API (lead process): loads and resets left by a stopped API process are
   * taken over (reset, then `failed` or `idle`), once now and once more when the heartbeat of
   * those that were still fresh has gone stale. A load another API process runs is never touched.
   * Resolves when the first pass has claimed what it takes over (the resets run in the
   * background); never rejects.
   */
  reconcileOnStartup(): Promise<void> {
    if (Features.SINGLE_TENANT) return Promise.resolve();
    const sweep = async () => {
      try {
        const rows: Array<{ id: string; demo: unknown }> = await this.dataSource.query(
          `SELECT id, metadata->'demo' AS demo FROM tenants
            WHERE ${STATUS_SQL} IN ('loading', 'resetting') AND is_system_tenant IS NOT TRUE`,
        );
        for (const row of rows) {
          await this.reconcile(row.id, readDemoState(row.demo));
        }
      } catch (error) {
        this.logger.warn(`Sample data states not checked at start-up: ${errorMessage(error)}`);
      }
    };
    const later = setTimeout(() => { if (!this.stopping) void sweep(); }, this.config.staleMs + 5_000);
    later.unref();
    return sweep();
  }

  /**
   * At a stop of the API: the loads of this process are stopped and leave their state as it is
   * (`loading`); the next start takes them over once their heartbeat is stale. A reset already
   * running goes on (tracked background work).
   */
  stop(): void {
    this.stopping = true;
    for (const run of this.running.values()) {
      run.stopped = true;
      run.child?.kill('SIGKILL');
    }
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────

  private async readTenant(tenantId: string): Promise<TenantRow> {
    if (Features.SINGLE_TENANT) throwNotAvailableInMode();
    if (!UUID.test(String(tenantId ?? ''))) throw new NotFoundException('Tenant not found');
    const [tenant]: TenantRow[] = await this.dataSource.query(
      `SELECT id, slug, name, status, is_system_tenant, metadata->'demo' AS demo FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.is_system_tenant) throw new BadRequestException('System tenants cannot be modified');
    if (tenant.status === TenantStatus.DELETED || tenant.status === TenantStatus.DELETING) {
      throw new BadRequestException('Tenant already deleted');
    }
    return tenant;
  }

  private async readState(tenantId: string, executor: Pick<EntityManager, 'query'> = this.dataSource): Promise<StoredDemoState> {
    const [row] = await executor.query(`SELECT metadata->'demo' AS demo FROM tenants WHERE id = $1`, [tenantId]);
    return readDemoState(row?.demo);
  }

  /**
   * Merges `patch` into `metadata.demo` when the stored state meets `condition`, in one
   * statement on that key alone. Returns the new state, or null when the condition failed.
   */
  private async update(
    tenantId: string,
    condition: StateCondition,
    patch: Partial<StoredDemoState>,
    executor: Pick<EntityManager, 'query'> = this.dataSource,
  ): Promise<StoredDemoState | null> {
    const params: unknown[] = [tenantId, JSON.stringify(patch), [...condition.statuses]];
    let where = `id = $1 AND ${STATUS_SQL} = ANY($3::text[])`;
    if (condition.runId !== undefined) {
      params.push(condition.runId);
      where += ` AND (metadata->'demo'->>'run_id') IS NOT DISTINCT FROM $${params.length}::text`;
    }
    if (condition.heartbeatAt !== undefined) {
      params.push(condition.heartbeatAt);
      where += ` AND (metadata->'demo'->>'heartbeat_at') IS NOT DISTINCT FROM $${params.length}::text`;
    }
    // In a CTE: TypeORM answers a bare UPDATE with [rows, count], a SELECT with its rows.
    const rows: Array<{ demo: unknown }> = await executor.query(
      `WITH updated AS (
         UPDATE tenants
            SET metadata = (CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END)
                           || jsonb_build_object('demo', ${DEMO_SQL} || $2::jsonb)
          WHERE ${where}
          RETURNING metadata->'demo' AS demo
       )
       SELECT demo FROM updated`,
      params,
    );
    return rows[0] ? readDemoState(rows[0].demo) : null;
  }

  private idleState(): Partial<StoredDemoState> {
    return {
      status: 'idle',
      run_id: null,
      step: null,
      started_at: null,
      heartbeat_at: null,
      loaded_at: null,
      loaded_by: null,
      failed_at: null,
      error_code: null,
    };
  }

  /**
   * The claim of a load: under a lock shared by every API process, count the live loads of all
   * tenants, then move this tenant from `idle` or `failed` to `loading`. A double click, or two
   * API processes at once, get one claim; the other is refused.
   */
  private async claim(tenantId: string, actorId: string, runId: string): Promise<StoredDemoState> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock($1::int, hashtext($2))`, [DEMO_LOCK_NAMESPACE, DEMO_CLAIM_LOCK_KEY]);
      const loading: Array<{ id: string; heartbeat_at: string | null }> = await manager.query(
        `SELECT id, metadata->'demo'->>'heartbeat_at' AS heartbeat_at FROM tenants WHERE ${STATUS_SQL} = 'loading'`,
      );
      const live = loading.filter((row) => row.id !== tenantId && !this.isStale(row.heartbeat_at));
      if (live.length >= this.config.maxConcurrent) {
        throw new ConflictException({
          code: 'demo_load_capacity',
          message: 'Other workspaces are loading sample data. Try again in a few minutes.',
        });
      }
      const now = nowIso();
      const claimed = await this.update(tenantId, { statuses: ['idle', 'failed'] }, {
        status: 'loading',
        run_id: runId,
        step: null,
        started_at: now,
        heartbeat_at: now,
        loaded_at: null,
        loaded_by: actorId,
        failed_at: null,
        error_code: null,
      }, manager);
      if (!claimed) throw this.statusConflict((await this.readState(tenantId, manager)).status);
      return claimed;
    });
  }

  private statusConflict(status: DemoStatus): ConflictException {
    const messages: Record<DemoStatus, string> = {
      idle: 'No sample data has been loaded into this workspace.',
      loading: 'Sample data is being loaded into this workspace.',
      loaded: 'Sample data is already loaded into this workspace.',
      failed: 'The last sample data load failed.',
      resetting: 'This workspace is being reset.',
    };
    return new ConflictException({ statusCode: HttpStatus.CONFLICT, code: 'demo_status_conflict', status, message: messages[status] });
  }

  private isStale(heartbeatAt: string | null | undefined): boolean {
    const at = Date.parse(String(heartbeatAt ?? ''));
    return !Number.isFinite(at) || Date.now() - at > this.config.staleMs;
  }

  /**
   * A load or a reset whose heartbeat is stale was left by a stopped API process: claimed (one
   * claimer wins), then the tenant is reset in the background and ends `failed` (a load, or the
   * reset after a failed load) or `idle` (a reset an administrator asked for). Returns the state
   * as it stands.
   */
  private async reconcile(tenantId: string, state: StoredDemoState): Promise<StoredDemoState> {
    if (state.status !== 'loading' && state.status !== 'resetting') return state;
    if (!this.isStale(state.heartbeat_at)) return state;
    const local = this.running.get(tenantId);
    if (local && local.runId === state.run_id) return state;

    const runId = randomUUID();
    const now = nowIso();
    const errorCode: DemoErrorCode | null = state.status === 'loading' ? 'load_interrupted' : state.error_code;
    const claimed = await this.update(
      tenantId,
      { statuses: [state.status], runId: state.run_id, heartbeatAt: state.heartbeat_at },
      {
        status: 'resetting',
        run_id: runId,
        heartbeat_at: now,
        step: null,
        ...(state.status === 'loading' ? { error_code: errorCode, failed_at: now } : {}),
      },
    );
    if (!claimed) return this.readState(tenantId);
    this.logger.warn(`Sample data ${state.status === 'loading' ? 'load' : 'reset'} of tenant ${tenantId} was left by a stopped API process: resetting the tenant`);
    const actorId = state.loaded_by && UUID.test(state.loaded_by) ? state.loaded_by : null;
    this.runInBackground(`reset of tenant ${tenantId}`, () =>
      this.resetThenSettle(tenantId, runId, actorId, errorCode));
    return claimed;
  }

  // ── Checks ────────────────────────────────────────────────────────────────────────────────

  /** The acting user: enabled, of this tenant, with the Administrator role (not a module level). */
  private async requireAdministrator(manager: EntityManager, tenantId: string, actorId: string): Promise<User> {
    const refused = () => new ForbiddenException({
      code: 'administrator_required',
      message: 'Only an administrator of this workspace can do this.',
    });
    if (!UUID.test(String(actorId ?? ''))) throw refused();
    const [row]: Array<{ is_administrator: boolean }> = await manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM users u
           JOIN roles r ON r.tenant_id = u.tenant_id
          WHERE u.id = $1 AND u.tenant_id = $2 AND u.status = 'enabled'
            AND lower(coalesce(r.role_name, '')) = 'administrator'
            AND (r.id = u.role_id OR EXISTS (
                  SELECT 1 FROM user_roles ur WHERE ur.tenant_id = $2 AND ur.user_id = u.id AND ur.role_id = r.id))
       ) AS is_administrator`,
      [actorId, tenantId],
    );
    if (!row?.is_administrator) throw refused();
    const user = await manager.getRepository(User).findOne({ where: { id: actorId, tenant_id: tenantId }, relations: ['role'] });
    if (!user) throw refused();
    return user;
  }

  /** Frozen subscriptions and expired trials get no sample data, like the AI features. */
  private async assertSubscriptionAllowsLoad(manager: EntityManager, tenantId: string): Promise<void> {
    const configured = this.stripeConfig.isConfigured();
    const subscription = configured
      ? await manager.getRepository(Subscription).findOne({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' } })
      : null;
    const decision = evaluateSubscriptionAccess(subscription, Date.now(), configured);
    if (!decision.allowed) {
      throw new ForbiddenException({ error: decision.reason, code: decision.reason, message: decision.message });
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────────────────────────

  /** Work started by a call and not awaited: tracked for the stop, never rejects. */
  private runInBackground(label: string, work: () => Promise<void>): void {
    trackBackgroundWork((async () => {
      try {
        await work();
      } catch (error) {
        this.logger.error(`Sample data ${label} ended unexpectedly: ${errorMessage(error)}`);
      }
    })());
  }

  /** Writes the run's heartbeat every `heartbeatMs` while `fn` runs. */
  private async withHeartbeat<T>(tenantId: string, runId: string, fn: () => Promise<T>): Promise<T> {
    const timer = setInterval(() => { void this.beat(tenantId, runId); }, this.config.heartbeatMs);
    timer.unref();
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  private async beat(tenantId: string, runId: string): Promise<void> {
    try {
      await this.update(tenantId, { statuses: ['loading', 'resetting'], runId }, { heartbeat_at: nowIso() });
    } catch (error) {
      this.logger.warn(`Sample data heartbeat of tenant ${tenantId} not written: ${errorMessage(error)}`);
    }
  }

  private async runLoad(run: {
    tenantId: string;
    actorId: string;
    runId: string;
    scriptPath: string;
    env: NodeJS.ProcessEnv;
    token: string;
  }): Promise<void> {
    const { tenantId, runId } = run;
    const record: RunningLoad = { runId, child: null, stopped: false, timedOut: false };
    this.running.set(tenantId, record);
    const startedAt = Date.now();
    this.logger.log(`Sample data load started for tenant ${tenantId}`);
    try {
      await this.withHeartbeat(tenantId, runId, async () => {
        const output: string[] = [];
        const outcome = await this.runLoader(run, record, output);

        if (record.stopped) {
          this.logger.warn(`Sample data load of tenant ${tenantId} stopped with the API process; the next start takes it over`);
          return;
        }
        if (outcome.code === 0 && !outcome.error) {
          const loaded = await this.update(tenantId, { statuses: ['loading'], runId }, {
            status: 'loaded',
            loaded_at: nowIso(),
            heartbeat_at: null,
            step: null,
          });
          if (loaded) {
            this.logger.log(`Sample data loaded into tenant ${tenantId} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
          } else {
            this.logger.warn(`Sample data load of tenant ${tenantId} finished, but its state was taken over meanwhile`);
          }
          return;
        }

        const errorCode: DemoErrorCode = !record.child?.pid ? 'load_not_started' : record.timedOut ? 'load_timeout' : 'load_failed';
        const how = outcome.error ? outcome.error.message : outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`;
        this.logger.warn(
          `Sample data load of tenant ${tenantId} failed (${errorCode}, ${how}); last loader output:\n${output.join('\n')}`,
        );

        // The process has ended: no request of the loader is left to write after the reset.
        const now = nowIso();
        const moved = await this.update(tenantId, { statuses: ['loading'], runId }, {
          status: 'resetting',
          heartbeat_at: now,
          failed_at: now,
          error_code: errorCode,
          step: null,
        });
        if (!moved) {
          this.logger.warn(`Sample data state of tenant ${tenantId} was taken over meanwhile: no reset from this run`);
          return;
        }
        await this.resetThenSettle(tenantId, runId, run.actorId, errorCode, { heartbeat: false });
      });
    } finally {
      if (this.running.get(tenantId) === record) this.running.delete(tenantId);
    }
  }

  /**
   * Runs the loader to its end: steps from stdout into the state, the last lines of output kept
   * (token masked) for the server log, a time limit. Resolves once the process has exited and its output
   * streams have closed.
   */
  private async runLoader(
    run: { tenantId: string; runId: string; scriptPath: string; env: NodeJS.ProcessEnv; token: string },
    record: RunningLoad,
    output: string[],
  ): Promise<ExitOutcome> {
    let child: ChildProcess;
    try {
      child = this.config.spawn(process.execPath, [run.scriptPath, '--server-mode'], {
        shell: false,
        env: run.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      return { code: null, signal: null, error: error as Error };
    }
    record.child = child;
    if (record.stopped) child.kill('SIGKILL');

    // The loader never prints the token; masked all the same, before anything else is done with the line.
    const keep = (raw: string) => {
      const line = raw.split(run.token).join('[token]');
      output.push(line.length > OUTPUT_LINE_MAX ? `${line.slice(0, OUTPUT_LINE_MAX)}...` : line);
      if (output.length > OUTPUT_LINES_KEPT) output.shift();
    };
    // An unhandled `error` event would end the API process: every one is handled.
    child.stdout?.on('error', (error) => this.logger.warn(`Sample data loader output of tenant ${run.tenantId}: ${errorMessage(error)}`));
    child.stderr?.on('error', (error) => this.logger.warn(`Sample data loader output of tenant ${run.tenantId}: ${errorMessage(error)}`));
    let steps: Promise<unknown> = Promise.resolve();
    if (child.stdout) {
      readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
        const match = STEP_LINE.exec(line);
        if (!match) {
          keep(line);
          return;
        }
        steps = steps.then(() => this.update(run.tenantId, { statuses: ['loading'], runId: run.runId }, {
          step: match[1],
          heartbeat_at: nowIso(),
        })).catch((error) => {
          this.logger.warn(`Sample data step of tenant ${run.tenantId} not written: ${errorMessage(error)}`);
        });
      });
    }
    if (child.stderr) {
      readline.createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', keep);
    }

    const timer = setTimeout(() => {
      record.timedOut = true;
      child.kill('SIGKILL');
    }, this.config.timeoutMs);
    timer.unref();
    try {
      const outcome = await new Promise<ExitOutcome>((resolve) => {
        let spawnError: Error | undefined;
        child.on('error', (error) => {
          spawnError ??= error;
          if (child.pid === undefined) resolve({ code: null, signal: null, error });
        });
        child.once('close', (code, signal) => resolve({ code, signal, error: spawnError }));
      });
      await steps;
      return outcome;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The reset of a tenant in `resetting` owned by `runId`, then the final state: `failed` with
   * `errorCode` when there is one (a load that failed), `idle` otherwise. A reset that fails
   * leaves `failed` / `reset_failed`, which an administrator can reset again; a reset refused
   * because another one runs leaves the state to that one.
   */
  private async resetThenSettle(
    tenantId: string,
    runId: string,
    actorId: string | null,
    errorCode: DemoErrorCode | null,
    opts: { heartbeat?: boolean } = {},
  ): Promise<void> {
    const resetOnce = () => this.tenantReset.reset(tenantId, actorId);
    try {
      await (opts.heartbeat === false ? resetOnce() : this.withHeartbeat(tenantId, runId, resetOnce));
    } catch (error) {
      if ((error as any)?.getResponse?.()?.code === TENANT_RESET_RUNNING_CODE) {
        this.logger.warn(`Sample data reset of tenant ${tenantId} skipped: another reset of the tenant is running`);
        return;
      }
      this.logger.error(`Sample data reset of tenant ${tenantId} failed: ${errorMessage(error)}`);
      await this.update(tenantId, { statuses: ['resetting'], runId }, {
        status: 'failed',
        heartbeat_at: null,
        failed_at: nowIso(),
        error_code: 'reset_failed',
      });
      return;
    }
    const settled = await this.update(
      tenantId,
      { statuses: ['resetting'], runId },
      errorCode ? { status: 'failed', heartbeat_at: null, error_code: errorCode } : this.idleState(),
    );
    if (settled) {
      this.logger.log(`Tenant ${tenantId} reset to its starting state after ${errorCode ? `a failed sample data load (${errorCode})` : 'sample data'}`);
    }
  }
}
