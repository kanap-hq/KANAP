/**
 * The registry of the environment variables Kadratis reads: one entry per name, or per family of
 * names built by the code (`KANAP_TENANT_*`). It is written by hand and checked by
 * `config/__tests__/env-registry.spec.ts`: every variable the API reads has its entry, and every
 * entry is read somewhere.
 *
 * It produces `infra/.env.onprem.example` and the example block of the on-premise configuration
 * pages of the manual (`env-registry-render.ts`, `npm run env:generate` in `backend/`). A new
 * variable gets its entry here and its description in `env-registry.labels.json`, then
 * `npm run env:generate`.
 *
 * The shape of an entry is an interface: the settings service, the configuration file page and
 * the reference of the manual read it. Add fields; do not rename them.
 *
 * Do not import `features.ts` here: it reads the environment when it loads.
 */
import * as labelsJson from './env-registry.labels.json';

export const ENV_LANGUAGES = ['en', 'fr', 'de', 'es'] as const;
export type EnvLanguage = (typeof ENV_LANGUAGES)[number];
export type EnvText = Partial<Record<EnvLanguage, string>>;

export type EnvMode = 'cloud' | 'onprem';

/**
 * Who sets the variable:
 * - `operator`: the person who runs the installation, in its `.env`;
 * - `internal`: the application itself, for a process it starts (`KANAP_WORKER_*`, `KANAP_DEMO_*`);
 * - `tooling`: development, tests, benches, maintenance scripts; never needed on an installation;
 * - `build`: read outside the code of the API (Compose, a Dockerfile, the web image, Node, a
 *   library); `readBy` names that place;
 * - `deprecated`: an older name of another variable, still accepted; that variable lists it in
 *   its `aliases`.
 */
export type EnvKind = 'operator' | 'internal' | 'tooling' | 'build' | 'deprecated';

/**
 * Why the variable stays in the file (brainstorm of 2026-11-07, section 2.1):
 * - `before-database`: needed to reach the database or to start;
 * - `root-of-trust`: decides who the installation is and whom it talks to;
 * - `security-boundary`: a screen that widened it would contradict itself;
 * - `outside-node`: read by Compose, nginx, PostgreSQL, Node itself, or fixed at build;
 * - `bootstrap`: creates what the installation starts with (its workspace, its first
 *   administrator) and changes nothing once that exists;
 * - `tooling`: development, QA, transition;
 * - `tuning`: fine tuning with no business meaning.
 * `null`: none of the seven; a screen may offer the setting later, the file staying master.
 */
export type EnvReason =
  | 'before-database'
  | 'root-of-trust'
  | 'security-boundary'
  | 'outside-node'
  | 'bootstrap'
  | 'tooling'
  | 'tuning';

/**
 * When a new value applies. A value set in the file reaches the API when its container is created
 * again, whatever moment the code reads it at:
 * - `restart`: the value comes from the file and changes at the restart;
 * - `first-start`: read only while the thing it creates does not exist yet (the workspace of a
 *   single-tenant installation); a later change is ignored;
 * - `next-run` (the next run of a scheduled task) and `immediate` (the next use): for a value a
 *   screen can change, set by the changes that bring that screen.
 * `null` for a variable the running API does not read (`build`, `internal`).
 */
export type EnvTakesEffect = 'first-start' | 'restart' | 'next-run' | 'immediate';

/** The sections of `infra/.env.onprem.example` and of the manual block, in their order. */
export const ENV_EXAMPLE_SECTION_IDS = [
  'deployment-mode',
  'tenant',
  'admin',
  'security',
  'run-mode',
  'app-url',
  'cors',
  'client-address',
  'database',
  'certificates',
  'storage',
  'email',
  'sso',
  'technology-catalog',
  'vulnerabilities',
  'excel-imports',
  'exchange-rates',
  'ai',
  'ai-tuning',
  'security-boundaries',
  'advanced',
  'start-up',
  'email-tuning',
  'capacity',
  'database-tuning',
] as const;
export type EnvExampleSectionId = (typeof ENV_EXAMPLE_SECTION_IDS)[number];

/**
 * The place of a variable in the example file and in the manual block:
 * - `absent`: not written (a cloud variable, or `why`, for an operator variable of an
 *   installation, says why it is left out);
 * - `active`: written as `NAME=value`;
 * - `commented`: written as `# NAME=value`.
 * `comment` lines come just before the variable, in the example file only.
 */
export type EnvExample =
  | { state: 'absent'; why?: string }
  | { state: 'active' | 'commented'; value: string; section: EnvExampleSectionId; comment?: readonly string[] };

export type EnvVariable = {
  /** The name, or the pattern of a family: `*` stands for one or more of `A-Z`, `0-9`, `_`. */
  name: string;
  family: boolean;
  /** Older names still read for this variable, each a `deprecated` entry of its own. */
  aliases: readonly string[];
  domain: EnvDomain;
  modes: readonly EnvMode[];
  kind: EnvKind;
  /** The place that reads a `build` or library variable, when the code of the API does not. */
  readBy: string | null;
  secret: boolean;
  /** The value carries a secret although the variable is not one (`DATABASE_URL`). */
  credentialsInValue: boolean;
  /** The value used when the variable is unset, as text; `null` when there is none. */
  default: string | null;
  /** An installation of its modes needs it set: the API stops, or a core feature fails, without it. */
  required: boolean;
  takesEffect: EnvTakesEffect | null;
  reason: EnvReason | null;
  /** The page of the settings registry that offers the setting; `null` while no screen does. */
  screen: string | null;
  example: EnvExample;
};

export type EnvDomain =
  | 'deployment'
  | 'addresses'
  | 'auth'
  | 'security'
  | 'database'
  | 'process'
  | 'storage'
  | 'email'
  | 'entra'
  | 'ai'
  | 'billing'
  | 'trial'
  | 'feeds'
  | 'exchange-rates'
  | 'imports';

type EntryInput = Partial<Omit<EnvVariable, 'name' | 'domain' | 'modes' | 'kind'>> & {
  domain: EnvDomain;
  modes: readonly EnvMode[];
  kind: EnvKind;
};

const BOTH: readonly EnvMode[] = ['cloud', 'onprem'];
const CLOUD: readonly EnvMode[] = ['cloud'];
const ONPREM: readonly EnvMode[] = ['onprem'];

function entry(name: string, input: EntryInput): EnvVariable {
  const internalOrBuild = input.kind === 'internal' || input.kind === 'build';
  return {
    name,
    family: name.includes('*'),
    aliases: [],
    readBy: null,
    secret: false,
    credentialsInValue: false,
    default: null,
    required: false,
    takesEffect: internalOrBuild ? null : 'restart',
    reason: null,
    screen: null,
    example: { state: 'absent' },
    ...input,
  };
}

const active = (section: EnvExampleSectionId, value: string, comment?: readonly string[]): EnvExample => ({ state: 'active', value, section, comment });
const commented = (section: EnvExampleSectionId, value: string, comment?: readonly string[]): EnvExample => ({ state: 'commented', value, section, comment });

/** The entries, grouped by subject. The order inside a section of the example is the order here. */
export const ENV_REGISTRY: readonly EnvVariable[] = [
  // Deployment mode, tenant, first administrator, platform.
  entry('DEPLOYMENT_MODE', { domain: 'deployment', modes: BOTH, kind: 'operator', reason: 'root-of-trust', default: 'multi-tenant', required: true, example: active('deployment-mode', 'single-tenant') }),
  entry('DEFAULT_TENANT_SLUG', { domain: 'deployment', modes: BOTH, kind: 'operator', reason: 'root-of-trust', default: 'default', example: active('tenant', 'default') }),
  entry('DEFAULT_TENANT_NAME', { domain: 'deployment', modes: ONPREM, kind: 'operator', reason: 'bootstrap', takesEffect: 'first-start', default: 'My Organization', example: active('tenant', 'My Organization') }),
  entry('DEFAULT_TENANT_LANGUAGE', { domain: 'deployment', modes: ONPREM, kind: 'operator', reason: 'bootstrap', takesEffect: 'first-start', default: 'en', example: active('tenant', 'en') }),
  entry('ADMIN_EMAIL', { domain: 'deployment', modes: BOTH, kind: 'operator', reason: 'bootstrap', required: true, example: active('admin', 'admin@company.com') }),
  entry('ADMIN_PASSWORD', { domain: 'deployment', modes: BOTH, kind: 'operator', reason: 'bootstrap', required: true, secret: true, example: active('admin', 'ChangeThisPassword123!') }),
  entry('SEED_ADMIN', { domain: 'deployment', modes: CLOUD, kind: 'operator', reason: 'bootstrap', default: 'false' }),
  entry('PLATFORM_ADMIN_HOST', { domain: 'deployment', modes: CLOUD, kind: 'operator', reason: 'root-of-trust' }),
  entry('PLATFORM_ADMIN_EMAILS', { domain: 'deployment', modes: CLOUD, kind: 'operator', reason: 'root-of-trust' }),
  entry('KANAP_VERSION', { domain: 'deployment', modes: BOTH, kind: 'build', readBy: 'infra/compose.onprem.yml', reason: 'outside-node', default: 'the version of the checkout' }),

  // Run mode.
  entry('APP_ENV', {
    domain: 'deployment', modes: BOTH, kind: 'operator', reason: 'root-of-trust', default: 'unset: production rules, with start-up warnings instead of refusals',
    example: commented('run-mode', 'production'),
  }),
  entry('NODE_ENV', { domain: 'deployment', modes: BOTH, kind: 'build', readBy: 'Node.js and its libraries; the API reads it as the run mode when APP_ENV is unset', reason: 'outside-node', takesEffect: 'restart' }),

  // Secrets and token keys.
  entry('JWT_SECRET', { domain: 'auth', modes: BOTH, kind: 'operator', reason: 'root-of-trust', required: true, secret: true, example: active('security', '', ['Generate with: openssl rand -hex 32']) }),
  entry('PASSWORD_RESET_SECRET', {
    domain: 'auth', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true, default: 'a key derived from JWT_SECRET',
    example: commented('security', '', [
      'TOKEN FAMILY KEYS (optional, see doc/on-premise/technical-design.md)',
      'Password-reset links, Entra SSO states, MCP connections and the "Cancel creation" option of a',
      'record just created derive their own key from JWT_SECRET when unset. Changing a value',
      "invalidates that family's outstanding tokens (reset links, SSO states, MCP access tokens).",
    ]),
  }),
  entry('ENTRA_STATE_SECRET', { domain: 'auth', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true, default: 'a key derived from JWT_SECRET', example: commented('security', '') }),
  entry('MCP_OAUTH_CODE_SECRET', { domain: 'auth', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true, default: 'a key derived from JWT_SECRET', example: commented('security', '') }),
  entry('MCP_ACCESS_TOKEN_SECRET', { domain: 'auth', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true, default: 'a key derived from JWT_SECRET', example: commented('security', '') }),
  entry('CREATION_TOKEN_SECRET', { domain: 'auth', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true, default: 'a key derived from JWT_SECRET', example: commented('security', '') }),
  entry('PROVISIONING_TOKEN_SECRET', {
    domain: 'auth', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true, default: 'JWT_SECRET',
    example: commented('security', '', [
      'Provisioning tokens come from a service outside this repository: their default stays JWT_SECRET.',
      'Set this only in lockstep with that issuer: it then becomes the only accepted key.',
    ]),
  }),

  // Token lifetimes.
  entry('JWT_ACCESS_TOKEN_TTL', { domain: 'auth', modes: BOTH, kind: 'operator', default: '15m', example: commented('advanced', '15m') }),
  entry('JWT_REFRESH_TOKEN_TTL', { domain: 'auth', modes: BOTH, kind: 'operator', default: '4h', example: commented('advanced', '4h') }),
  entry('PASSWORD_RESET_TTL', { domain: 'auth', modes: BOTH, kind: 'operator', default: '1h', example: commented('advanced', '1h', ['Password reset link lifetime: a number of seconds or a duration such as 30m or 2h.']) }),
  entry('INVITE_LINK_TTL', { domain: 'auth', modes: BOTH, kind: 'operator', default: '7d', example: commented('advanced', '7d', ['Invitation link lifetime (the link that sets the password), same format.']) }),
  entry('JWT_LEGACY_ACCESS_TOKEN_DEADLINE', { domain: 'auth', modes: BOTH, kind: 'operator', reason: 'tooling', example: commented('advanced', '<YYYY-MM-DDTHH:MM:SSZ>', [
    'Access tokens carry a purpose marker; tokens without it, issued by older builds, are refused.',
    'To keep accepting them until a given instant, set an ISO-8601 instant with an offset (`Z` or',
    '+HH:MM). Leave it unset unless an older instance still issues tokens.',
  ]) }),

  // Addresses and browser origins.
  entry('APP_BASE_URL', { domain: 'addresses', modes: BOTH, kind: 'operator', reason: 'root-of-trust', required: true, aliases: ['PUBLIC_APP_URL'], example: active('app-url', 'https://kadratis.your-domain.com') }),
  entry('PUBLIC_APP_URL', { domain: 'addresses', modes: BOTH, kind: 'deprecated', reason: 'tooling' }),
  entry('APP_URL', {
    domain: 'addresses', modes: BOTH, kind: 'operator', reason: 'root-of-trust',
    example: { state: 'absent', why: 'APP_BASE_URL gives the address of an installation; EXPORT_MEDIA_BASE_URL sets the base of the exported images.' },
  }),
  entry('TENANT_BASE_DOMAINS', { domain: 'addresses', modes: CLOUD, kind: 'operator', reason: 'root-of-trust', default: 'the domains of the Kadratis cloud' }),
  entry('MARKETING_BASE_URL', { domain: 'addresses', modes: CLOUD, kind: 'operator', reason: 'root-of-trust', default: 'the public Kadratis website' }),
  entry('CORS_ORIGINS', { domain: 'addresses', modes: BOTH, kind: 'operator', reason: 'root-of-trust', required: true, example: active('cors', 'https://kadratis.your-domain.com') }),
  entry('VITE_API_URL', { domain: 'addresses', modes: BOTH, kind: 'build', readBy: 'frontend/Dockerfile', reason: 'outside-node', default: '/api' }),

  // Request limits and the client address.
  entry('RATE_LIMIT_TRUST_PROXY', {
    domain: 'security', modes: BOTH, kind: 'operator', reason: 'security-boundary', default: 'one proxy on single-tenant, with a start-up warning; none on multi-tenant',
    example: active('client-address', 'true'),
  }),
  entry('RATE_LIMIT_ENABLED', { domain: 'security', modes: BOTH, kind: 'operator', reason: 'security-boundary', default: 'true', example: commented('advanced', 'true') }),
  entry('CAPTCHA_MODE', { domain: 'security', modes: CLOUD, kind: 'operator', default: 'off on single-tenant; on multi-tenant, enforce in production mode, off otherwise' }),
  entry('TURNSTILE_SITE_KEY', { domain: 'security', modes: CLOUD, kind: 'operator' }),
  entry('TURNSTILE_SECRET_KEY', { domain: 'security', modes: CLOUD, kind: 'operator', secret: true }),
  entry('SSRF_ALLOWED_HOSTS', { domain: 'security', modes: BOTH, kind: 'operator', reason: 'security-boundary', example: commented('security-boundaries', '') }),
  entry('EXPORT_ALLOWED_IMAGE_HOSTS', { domain: 'security', modes: BOTH, kind: 'operator', reason: 'security-boundary', example: commented('security-boundaries', '') }),
  entry('EXPORT_ALLOW_LOOPBACK_IMAGE_HOSTS', { domain: 'security', modes: BOTH, kind: 'operator', reason: 'security-boundary', default: 'true in development mode, false otherwise', example: commented('security-boundaries', 'false') }),
  entry('EXPORT_MEDIA_BASE_URL', { domain: 'security', modes: BOTH, kind: 'operator', reason: 'security-boundary', default: 'the address of APP_URL, else APP_BASE_URL, else PUBLIC_APP_URL', example: commented('security-boundaries', '') }),

  // Database.
  entry('DATABASE_URL', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', required: true, credentialsInValue: true, example: active('database', 'postgres://kanap:password@your-postgres:5432/kanap?sslmode=require') }),
  entry('DB_POOL_MIN', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '2', example: commented('database-tuning', '2') }),
  entry('DB_POOL_IDLE_TIMEOUT', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '30000', example: commented('database-tuning', '30000') }),
  entry('DB_POOL_CONNECTION_TIMEOUT', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '10000', example: commented('database-tuning', '10000') }),
  entry('DB_APP_NAME', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: 'cio-api', example: commented('database-tuning', 'cio-api') }),
  entry('DB_LOCK_TIMEOUT_MS', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '5000', example: commented('database-tuning', '5000') }),
  entry('DB_STATEMENT_TIMEOUT_MS', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '30000', example: commented('database-tuning', '30000') }),
  entry('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '60000', example: commented('database-tuning', '60000') }),
  entry('SKIP_MIGRATIONS', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: 'false', example: commented('start-up', 'false') }),
  entry('MIGRATION_MAX_ATTEMPTS', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '30', example: commented('start-up', '30') }),
  entry('MIGRATION_RETRY_DELAY_MS', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '2000', example: commented('start-up', '2000') }),
  entry('DEBUG_MIGRATIONS', { domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', example: commented('start-up', '') }),

  // Processes, logs, maintenance at start.
  entry('PORT', { domain: 'process', modes: BOTH, kind: 'operator', reason: 'before-database', default: '8080', example: { state: 'absent', why: 'compose.onprem.yml publishes and probes port 8080 of the API container.' } }),
  entry('NODE_EXTRA_CA_CERTS', {
    domain: 'process', modes: BOTH, kind: 'build', readBy: 'Node.js', reason: 'outside-node', takesEffect: 'restart',
    example: commented('certificates', '/etc/kanap/certs/company-ca.pem'),
  }),
  entry('API_WORKERS', {
    domain: 'process', modes: BOTH, kind: 'operator', reason: 'before-database', default: '1',
    example: commented('capacity', '1', ['API processes in the API container (1 to 16). Each uses up to about 300 MB under load.']),
  }),
  entry('DB_POOL_MAX', {
    domain: 'database', modes: BOTH, kind: 'operator', reason: 'before-database', default: '20',
    example: commented('capacity', '20', [
      "Database connections per API process (2 at least). API_WORKERS x DB_POOL_MAX must stay under",
      "PostgreSQL's max_connections minus about 15 (the API warns at start when it does not).",
    ]),
  }),
  entry('SHUTDOWN_DRAIN_TIMEOUT_MS', {
    domain: 'process', modes: BOTH, kind: 'operator', reason: 'before-database', default: '20000',
    example: commented('capacity', '20000', [
      'On stop or upgrade, time given to the requests in progress, their notifications, running jobs',
      'and queued emails (ms; the container stops after 30 s).',
    ]),
  }),
  entry('OPS_METRICS_TOKEN', {
    domain: 'process', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true,
    example: commented('capacity', '', ['Enables GET /api/ops/metrics for a monitoring tool (24+ characters: openssl rand -hex 32).']),
  }),
  entry('LOG_LEVEL', {
    domain: 'process', modes: BOTH, kind: 'operator', reason: 'tuning',
    example: commented('advanced', '', ['LOG_LEVEL: debug or verbose adds the details of each scheduled job run to the log.']),
  }),
  entry('NO_COLOR', {
    domain: 'process', modes: BOTH, kind: 'operator', reason: 'tuning',
    example: commented('advanced', '', ['NO_COLOR: any non-empty value turns off the colours of the log on a terminal.']),
  }),
  entry('INTEGRATED_DOCS_AUTO_ROLLOUT', { domain: 'process', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'off', example: commented('start-up', 'off') }),
  entry('INTEGRATED_DOCS_AUTO_ROLLOUT_STRICT', { domain: 'process', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'false', example: commented('start-up', 'false') }),
  entry('INTEGRATED_DOCS_BATCH_SIZE', { domain: 'process', modes: BOTH, kind: 'operator', reason: 'tuning', default: '100', example: commented('start-up', '100') }),
  entry('INTEGRATED_DOCS_BATCH_PAUSE_MS', { domain: 'process', modes: BOTH, kind: 'operator', reason: 'tuning', default: '0', example: commented('start-up', '0') }),
  entry('INTEGRATED_DOCS_VERIFY_BATCH_SIZE', { domain: 'process', modes: BOTH, kind: 'operator', reason: 'tuning', default: '200', example: commented('start-up', '200') }),
  entry('INTEGRATED_DOCS_TENANT_ID', { domain: 'process', modes: BOTH, kind: 'tooling', reason: 'tooling' }),
  entry('INTEGRATED_DOCS_TENANT_SLUG', { domain: 'process', modes: BOTH, kind: 'tooling', reason: 'tooling' }),
  entry('KANAP_WORKER_*', { domain: 'process', modes: BOTH, kind: 'internal' }),
  entry('KANAP_CLUSTER_STARTED_AT', { domain: 'process', modes: BOTH, kind: 'internal' }),
  entry('TS_NODE_DEV', { domain: 'process', modes: BOTH, kind: 'tooling', reason: 'tooling' }),

  // Storage of the files (stays in the file: decision of 2026-11-27).
  entry('S3_ENDPOINT', { domain: 'storage', modes: BOTH, kind: 'operator', required: true, example: active('storage', 'https://s3.amazonaws.com') }),
  entry('S3_BUCKET', { domain: 'storage', modes: BOTH, kind: 'operator', required: true, example: active('storage', 'kanap-files') }),
  entry('S3_REGION', { domain: 'storage', modes: BOTH, kind: 'operator', default: 'nbg1', example: active('storage', 'us-east-1') }),
  entry('AWS_ACCESS_KEY_ID', { domain: 'storage', modes: BOTH, kind: 'operator', required: true, example: active('storage', '') }),
  entry('AWS_SECRET_ACCESS_KEY', { domain: 'storage', modes: BOTH, kind: 'operator', required: true, secret: true, example: active('storage', '') }),
  entry('S3_FORCE_PATH_STYLE', { domain: 'storage', modes: BOTH, kind: 'operator', default: 'false', example: active('storage', 'false') }),
  entry('FILES_STORAGE', {
    domain: 'storage', modes: BOTH, kind: 'operator', default: 's3',
    example: commented('storage', 's3', ['FILES_STORAGE: s3 is the only storage; any other value also uses S3.']),
  }),
  entry('ATTACHMENT_CLEANUP_DRY_RUN', {
    domain: 'storage', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'false',
    example: commented('advanced', 'false', ['true: the cleanup of orphaned attachments lists the files it would delete and deletes none.']),
  }),

  // Email.
  entry('RESEND_API_KEY', { domain: 'email', modes: BOTH, kind: 'operator', secret: true, example: commented('email', 're_xxxxx', ['Resend:']) }),
  entry('RESEND_FROM_EMAIL', { domain: 'email', modes: BOTH, kind: 'operator', default: 'Kadratis <no-reply@kadratis.com>', example: commented('email', 'Kadratis <noreply@your-domain.com>') }),
  entry('RESEND_BASE_URL', { domain: 'email', modes: BOTH, kind: 'tooling', readBy: 'backend/node_modules/resend/dist/index.cjs', reason: 'tooling' }),
  entry('SMTP_HOST', {
    domain: 'email', modes: ONPREM, kind: 'operator',
    example: commented('email', 'smtp.your-domain.com', [
      'SMTP (single-tenant only, wins over Resend when both are set).',
      'SMTP_USER and SMTP_PASSWORD go together: set both or neither.',
    ]),
  }),
  entry('SMTP_PORT', { domain: 'email', modes: ONPREM, kind: 'operator', default: '587', example: commented('email', '587') }),
  entry('SMTP_SECURE', { domain: 'email', modes: ONPREM, kind: 'operator', default: 'true on port 465, false otherwise', example: commented('email', 'false') }),
  entry('SMTP_USER', { domain: 'email', modes: ONPREM, kind: 'operator', example: commented('email', '') }),
  entry('SMTP_PASSWORD', { domain: 'email', modes: ONPREM, kind: 'operator', secret: true, aliases: ['SMTP_PASS'], example: commented('email', '') }),
  entry('SMTP_PASS', { domain: 'email', modes: ONPREM, kind: 'deprecated', reason: 'tooling', secret: true }),
  entry('SMTP_FROM', { domain: 'email', modes: ONPREM, kind: 'operator', example: commented('email', 'Kadratis <noreply@your-domain.com>') }),
  entry('EMAIL_QUEUE_MIN_INTERVAL_MS', { domain: 'email', modes: BOTH, kind: 'operator', reason: 'tuning', default: '700 with Resend, 2100 with SMTP', example: commented('email-tuning', '') }),
  entry('EMAIL_RATE_LIMIT_MAX_RETRIES', { domain: 'email', modes: BOTH, kind: 'operator', reason: 'tuning', default: '5', example: commented('email-tuning', '5') }),
  entry('EMAIL_RATE_LIMIT_RETRY_BASE_MS', { domain: 'email', modes: BOTH, kind: 'operator', reason: 'tuning', default: '1500', example: commented('email-tuning', '1500') }),
  entry('EMAIL_RATE_LIMIT_RETRY_MAX_MS', { domain: 'email', modes: BOTH, kind: 'operator', reason: 'tuning', default: '30000', example: commented('email-tuning', '30000') }),
  entry('EMAIL_RATE_LIMIT_RETRY_JITTER_MS', { domain: 'email', modes: BOTH, kind: 'operator', reason: 'tuning', default: '250', example: commented('email-tuning', '250') }),
  entry('EMAIL_OVERRIDE', { domain: 'email', modes: BOTH, kind: 'tooling', reason: 'tooling' }),

  // Microsoft Entra ID.
  entry('ENTRA_CLIENT_ID', { domain: 'entra', modes: BOTH, kind: 'operator', example: commented('sso', '') }),
  entry('ENTRA_CLIENT_SECRET', { domain: 'entra', modes: BOTH, kind: 'operator', secret: true, example: commented('sso', '') }),
  entry('ENTRA_AUTHORITY', { domain: 'entra', modes: BOTH, kind: 'operator', example: commented('sso', 'https://login.microsoftonline.com/<tenant-id>') }),
  entry('ENTRA_REDIRECT_URI', { domain: 'entra', modes: BOTH, kind: 'operator', example: commented('sso', 'https://kadratis.your-domain.com/api/auth/entra/callback') }),
  entry('ENTRA_ENRICH_PROFILE', {
    domain: 'entra', modes: BOTH, kind: 'operator', default: 'true',
    example: commented('sso', 'true', ['false: the sign-in no longer reads the profile of the person in Microsoft Graph.']),
  }),

  // Technology catalog and vulnerabilities.
  entry('TECHNOLOGY_CATALOG_SYNC_ENABLED', { domain: 'feeds', modes: BOTH, kind: 'operator', default: 'false on-premise, true in the cloud', example: commented('technology-catalog', 'false') }),
  entry('ENDOFLIFE_API_BASE_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://endoflife.date/api/v1', example: commented('technology-catalog', '') }),
  entry('VULNERABILITY_FEED_ENABLED', { domain: 'feeds', modes: BOTH, kind: 'operator', default: 'false on-premise, true in the cloud', example: commented('vulnerabilities', 'false') }),
  entry('NVD_API_KEY', { domain: 'feeds', modes: BOTH, kind: 'operator', secret: true, example: commented('vulnerabilities', '') }),
  entry('NVD_API_BASE_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://services.nvd.nist.gov/rest/json/cves/2.0', example: commented('vulnerabilities', '') }),
  entry('KEV_FEED_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', default: "CISA's GitHub mirror (raw.githubusercontent.com)", example: commented('vulnerabilities', '') }),
  entry('EPSS_FEED_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://epss.empiricalsecurity.com/epss_scores-current.csv.gz', example: commented('vulnerabilities', '') }),
  entry('EUVD_BASE_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://euvdservices.enisa.europa.eu', example: commented('vulnerabilities', '') }),
  entry('CVE_LIST_FEED_ENABLED', { domain: 'feeds', modes: BOTH, kind: 'operator', default: 'the value of VULNERABILITY_FEED_ENABLED', example: commented('vulnerabilities', '') }),
  entry('CVE_LIST_EXPORT_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', example: commented('vulnerabilities', '') }),
  entry('CVE_LIST_RELEASES_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://api.github.com/repos/CVEProject/cvelistV5/releases', example: commented('vulnerabilities', '') }),
  entry('CVE_LIST_DOWNLOAD_URL', { domain: 'feeds', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://github.com/CVEProject/cvelistV5/releases/download', example: commented('vulnerabilities', '') }),

  // Imports.
  entry('IMPORT_XLSX', { domain: 'imports', modes: BOTH, kind: 'operator', reason: 'root-of-trust', default: 'true', example: commented('excel-imports', 'true') }),

  // Exchange rates.
  entry('FX_SPOT_API_KEY', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', secret: true, example: commented('exchange-rates', '') }),
  entry('FX_SPOT_BASE_URL', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://open.er-api.com/v6/latest', example: commented('exchange-rates', '') }),
  entry('FX_SPOT_CACHE_TTL_MS', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: '2592000000 (30 days)', example: commented('exchange-rates', '') }),
  entry('FX_LOGIN_REFRESH_INTERVAL_MS', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: '30 days', example: commented('exchange-rates', '') }),
  entry('FX_LOGIN_REFRESH_INTERVAL_DAYS', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: '30', example: commented('exchange-rates', '') }),
  entry('WB_BASE_URL', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'https://api.worldbank.org/v2', example: commented('exchange-rates', '') }),
  entry('WB_CSV_URL', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'the CSV download of the World Bank indicator PA.NUS.FCRF', example: commented('exchange-rates', '') }),
  entry('WB_CACHE_DIR', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'a folder of the temporary directory', example: commented('exchange-rates', '') }),
  entry('WB_CACHE_TTL_MS', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: '21600000 (6 hours)', example: commented('exchange-rates', '') }),
  entry('WB_CSV_CACHE_TTL_MS', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', default: '2592000000 (30 days)', example: commented('exchange-rates', '') }),
  entry('WB_RETRY_DELAY_MS', { domain: 'exchange-rates', modes: BOTH, kind: 'operator', reason: 'tuning', example: commented('exchange-rates', '') }),

  // Artificial intelligence.
  entry('AI_CHAT_ENABLED', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'root-of-trust', default: 'false', example: commented('ai', 'false') }),
  entry('AI_MCP_ENABLED', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'root-of-trust', default: 'false', example: commented('ai', 'false') }),
  entry('AI_SETTINGS_ENABLED', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'root-of-trust', default: 'false', example: commented('ai', 'false') }),
  entry('AI_SETTINGS_ENCRYPTION_SECRET', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true, example: commented('ai', '') }),
  entry('BRAVE_SEARCH_API_KEY', {
    domain: 'ai', modes: BOTH, kind: 'operator', secret: true,
    example: commented('ai', '', [
      'BRAVE_SEARCH_API_KEY: lets Kad search the web. Each search sends its words to the Brave Search',
      'API (api.search.brave.com): open that host on the firewall.',
    ]),
  }),
  entry('AI_CHAT_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '16384', example: commented('ai-tuning', '16384') }),
  entry('AI_CHAT_REASONING_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '16384, and never less than AI_CHAT_MAX_TOKENS', example: commented('ai-tuning', '16384') }),
  entry('AI_CHAT_PROVIDER_TIMEOUT_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '300000', example: commented('ai-tuning', '300000') }),
  entry('AI_CHAT_MAX_TOOL_ITERATIONS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '40', example: commented('ai-tuning', '40') }),
  entry('AI_CHAT_SEARCH_ALL_NO_PROGRESS_CALL_THRESHOLD', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '4', example: commented('ai-tuning', '4') }),
  entry('AI_RETENTION_PURGE_GRACE_DAYS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '30', example: commented('ai-tuning', '30') }),
  entry('AI_AGENT_NEED_BUILDER_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '5000', example: commented('ai-tuning', '5000') }),
  entry('AI_AGENT_KNOWLEDGE_PLANNER_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '4000', example: commented('ai-tuning', '4000') }),
  entry('AI_AGENT_KNOWLEDGE_INTERPRETER_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '4000', example: commented('ai-tuning', '4000') }),
  entry('AI_AGENT_ACTION_PLANNER_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '6000', example: commented('ai-tuning', '6000') }),
  entry('AI_AGENT_ADMINISTRATIVE_REPLY_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '3000', example: commented('ai-tuning', '3000') }),
  entry('AI_AGENT_SYNTHESIS_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '8000', example: commented('ai-tuning', '8000') }),
  entry('AI_AGENT_TECHNICIAN_BRIEF_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '3000', example: commented('ai-tuning', '3000') }),
  entry('AI_AGENT_DIAGNOSTIC_BRIEF_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '6000', example: commented('ai-tuning', '6000') }),
  entry('AI_AGENT_VISION_EXTRACTION_MAX_TOKENS', { domain: 'ai', modes: BOTH, kind: 'operator', default: '12000', example: commented('ai-tuning', '12000') }),
  entry('AI_AGENT_ACTION_PLANNER_TIMEOUT_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '120000', example: commented('ai-tuning', '120000') }),
  entry('AI_AGENT_DIAGNOSTIC_BRIEF_TIMEOUT_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '120000', example: commented('ai-tuning', '120000') }),
  entry('AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '120000', example: commented('ai-tuning', '120000') }),
  entry('AI_AGENT_REPLY_SYNTHESIS_TIMEOUT_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '120000', example: commented('ai-tuning', '120000') }),
  entry('AI_AGENT_VISION_EXTRACTION_TIMEOUT_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '120000', example: commented('ai-tuning', '120000') }),
  entry('AI_AGENT_VISION_MAX_IMAGES', { domain: 'ai', modes: BOTH, kind: 'operator', default: '5', example: commented('ai-tuning', '5') }),
  entry('AI_AGENT_VISION_MAX_IMAGE_BYTES', { domain: 'ai', modes: BOTH, kind: 'operator', default: '20971520', example: commented('ai-tuning', '20971520') }),
  entry('AI_AGENT_INGESTION_PROCESS_BUDGET_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '210000', example: commented('ai-tuning', '210000') }),
  entry('AI_AGENT_MONITORING_PROCESS_BUDGET_MS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: '210000', example: commented('ai-tuning', '210000') }),
  entry('AI_AGENT_ACTION_PLANNER', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'on', example: commented('ai-tuning', '') }),
  entry('AI_AGENT_DIAGNOSTIC_BRIEF', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'on', example: commented('ai-tuning', '') }),
  entry('AI_AGENT_KNOWLEDGE_LLM_PLANNER', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'on', example: commented('ai-tuning', '') }),
  entry('AI_AGENT_NEED_BUILDER_LLM', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'on', example: commented('ai-tuning', '') }),
  entry('AI_AGENT_REPLY_SYNTHESIS', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'tuning', default: 'on', example: commented('ai-tuning', '') }),
  entry('KANAP_TENANT_*', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true }),
  entry('KANAP_SECRET_REF_*', { domain: 'ai', modes: BOTH, kind: 'operator', reason: 'root-of-trust', secret: true }),
  entry('AI_SEARCH_INDEX_ENABLED', { domain: 'ai', modes: BOTH, kind: 'tooling', reason: 'tooling', default: 'true' }),
  entry('AI_CHAT_DEBUG_TRACE', { domain: 'ai', modes: BOTH, kind: 'tooling', reason: 'tooling' }),
  entry('KANAP_LIVE_*', { domain: 'ai', modes: BOTH, kind: 'tooling', reason: 'tooling' }),
  entry('KANAP_*_LIVE_*', { domain: 'ai', modes: BOTH, kind: 'tooling', reason: 'tooling' }),
  entry('KANAP_AWX_TEST_*', { domain: 'ai', modes: BOTH, kind: 'tooling', reason: 'tooling' }),

  // Billing (cloud).
  entry('STRIPE_SECRET_KEY', { domain: 'billing', modes: CLOUD, kind: 'operator', secret: true, aliases: ['STRIPE_SECRET'] }),
  entry('STRIPE_SECRET', { domain: 'billing', modes: CLOUD, kind: 'deprecated', reason: 'tooling', secret: true }),
  entry('STRIPE_PUBLISHABLE_KEY', { domain: 'billing', modes: CLOUD, kind: 'operator' }),
  entry('STRIPE_WEBHOOK_SECRET', { domain: 'billing', modes: CLOUD, kind: 'operator', secret: true }),
  entry('STRIPE_WEBHOOK_ALLOW_INSECURE', { domain: 'billing', modes: CLOUD, kind: 'tooling', reason: 'tooling', default: 'false' }),
  entry('STRIPE_API_VERSION', { domain: 'billing', modes: CLOUD, kind: 'operator', reason: 'tuning', default: 'the version the code is written for' }),
  entry('STRIPE_PRICE_MAX_MONTHLY', { domain: 'billing', modes: CLOUD, kind: 'operator' }),
  entry('STRIPE_PRICE_MAX_ANNUAL', { domain: 'billing', modes: CLOUD, kind: 'operator' }),
  entry('STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL', { domain: 'billing', modes: CLOUD, kind: 'operator' }),
  entry('STRIPE_EU_BANK_TRANSFER_COUNTRY', { domain: 'billing', modes: CLOUD, kind: 'operator' }),
  entry('STRIPE_CHECKOUT_SUCCESS_URL', { domain: 'billing', modes: CLOUD, kind: 'operator', default: 'APP_URL' }),
  entry('STRIPE_CHECKOUT_CANCEL_URL', { domain: 'billing', modes: CLOUD, kind: 'operator', default: 'APP_URL' }),
  entry('STRIPE_PORTAL_RETURN_URL', { domain: 'billing', modes: CLOUD, kind: 'operator', default: 'APP_URL' }),
  entry('ENTERPRISE_SUPPORT_NOTIFY_EMAIL', { domain: 'billing', modes: CLOUD, kind: 'operator' }),

  // Trial workspaces and sample data (cloud).
  entry('DISCOVERY_CALL_URL', { domain: 'trial', modes: CLOUD, kind: 'operator' }),
  entry('DISCOVERY_CALL_FALLBACK_EMAIL', { domain: 'trial', modes: CLOUD, kind: 'operator' }),
  entry('DISCOVERY_CALL_WEBHOOK_SECRET', { domain: 'trial', modes: CLOUD, kind: 'operator', secret: true }),
  entry('TRIAL_MAIL_FOUNDER_ADDRESS', { domain: 'trial', modes: CLOUD, kind: 'operator', default: 'the address built into the code' }),
  entry('DEMO_LOAD_MAX_CONCURRENT', { domain: 'trial', modes: CLOUD, kind: 'operator', reason: 'tuning', default: '2' }),
  entry('KANAP_DEMO_*', { domain: 'trial', modes: CLOUD, kind: 'internal' }),
];

/** A section of the example file and of the manual block. */
export type EnvExampleSection = {
  id: EnvExampleSectionId;
  /** Lines written under the title, in the example file only (English). The note of the labels goes to the manual block. */
  comment: readonly string[];
  /** Each variable of the section gets its English description as a comment, in the example file. */
  describeEntries: boolean;
};

const section = (id: EnvExampleSectionId, comment: readonly string[] = [], describeEntries = false): EnvExampleSection => ({ id, comment, describeEntries });

export const ENV_EXAMPLE_SECTIONS: readonly EnvExampleSection[] = [
  section('deployment-mode', ['single-tenant or multi-tenant. Any other value stops the API. Unset means multi-tenant.']),
  section('tenant', [
    'Set DEFAULT_TENANT_SLUG before the first start. Changing it later creates a second, empty',
    "workspace. DEFAULT_TENANT_NAME is your organization's name at the first start: change it later",
    'on the Branding page of the administration. DEFAULT_TENANT_LANGUAGE (en, fr, de or es) names',
    'the analytics dimensions the workspace starts with, read at the first start only.',
  ]),
  section('admin', [
    'These two lines create the first administrator account at the first start, and create or',
    'restore it at a later start when no active administrator remains. Changing them changes',
    'nothing while an active administrator exists.',
    'Replace the example password with a value of your own, 12 characters or more',
    '(for example the output of: openssl rand -base64 18). An example value or a shorter one makes',
    "the API print a [SECURITY] warning at each start until the account's password is changed.",
  ]),
  section('security'),
  section('run-mode', [
    'Set APP_ENV=production as soon as users reach Kadratis over HTTPS.',
    'Unset, production rules apply to links, browser origins and platform administration, and a',
    'missing APP_BASE_URL or CORS_ORIGINS is a start-up warning. Set to production, start-up then',
    'requires APP_BASE_URL and CORS_ORIGINS and the session cookie is always marked Secure (it no',
    'longer works over plain HTTP).',
    'The public-form CAPTCHA stays off on single-tenant installs, whatever the run mode, unless CAPTCHA_MODE is set.',
  ]),
  section('app-url', [
    "Password reset and invitation links, notification links and the Entra sign-in redirect are",
    "built from it, not from the request's Host headers. Without it these features answer",
    '"application URL is not configured".',
  ]),
  section('cors', [
    'The address of APP_BASE_URL and the address of the request itself are always allowed; other',
    "browser origins get a 403. Unless APP_ENV=production, the request's address is compared on",
    'the host name when the proxy forwards Host without the port. A pattern such as',
    'https://*.your-domain.com is still accepted in this version with a start-up warning; use the',
    'exact address. If CORS_ORIGINS and APP_BASE_URL are both unset and APP_ENV is not production,',
    'every origin is still allowed in this version, with a start-up warning; a later version',
    'allows only the configured addresses.',
  ]),
  section('client-address', [
    'Kadratis reads the client address from X-Forwarded-For for its sign-in and request limits.',
    '  true   one reverse proxy in front of the API that sends X-Forwarded-For (the nginx of the guide)',
    '  false  nothing in front of the API: the address of the connection is used',
    '  2, 3   that many proxies in a row',
    'Unset, a single-tenant installation trusts one proxy and the API prints a [RATE-LIMIT] warning',
    'at each start. Keep the API port bound to 127.0.0.1 (compose.onprem.yml does).',
  ]),
  section('database', [
    'PostgreSQL 16 or later with the citext, pgcrypto, uuid-ossp, pg_trgm and unaccent extensions.',
    'Use a dedicated application role (not postgres or another cluster-admin role).',
    'sslmode=disable    PostgreSQL on the same server as Kadratis',
    'sslmode=require    the API checks the server certificate: it must come from a public authority',
    '                   (a private or self-signed certificate keeps the API from starting)',
    'sslmode=no-verify  encrypted connection without checking the certificate',
    'A password with @ : / # ? or % must be percent-encoded in the URL: use letters and digits',
    '(openssl rand -hex 24) and there is nothing to encode.',
  ]),
  section('certificates', [
    'Set it when your SMTP relay, PostgreSQL (sslmode=require or verify-full) or S3 store over HTTPS',
    "uses a certificate from your company's own authority. Put the PEM file in infra/certs/.",
  ]),
  section('storage', [
    'S3_FORCE_PATH_STYLE: true for RustFS, MinIO, Garage and most self-hosted stores; false for AWS S3 and Cloudflare R2.',
    'S3_REGION: nbg1 when unset. Use us-east-1 for RustFS, the region of your provider otherwise.',
  ]),
  section('email', ['Enables: password reset, user invitations, notification digests']),
  section('sso', ['See doc/help/docs/en/on-premise/sso-entra.md']),
  section('technology-catalog', [
    'TECHNOLOGY_CATALOG_SYNC_ENABLED: reads the versions and end-of-support dates of the catalog',
    'entries your technologies come from (endoflife.date), every day, between two Kadratis versions.',
    'Off, each Kadratis version brings its own catalog at start. Needs outbound HTTPS to endoflife.date.',
    'Both go through the scheduled task "technology-catalog": disabled in the administration, nothing',
    'is synced, at start or daily.',
    'ENDOFLIFE_API_BASE_URL: optional mirror of the endoflife.date API v1.',
  ]),
  section('vulnerabilities', [
    'VULNERABILITY_FEED_ENABLED: reads the published vulnerabilities (NVD) of the products your',
    'technologies name, every 6 hours, and the exploitation signals (CISA, EU, EPSS, EUVD).',
    'Needs outbound HTTPS to services.nvd.nist.gov, raw.githubusercontent.com, epss.empiricalsecurity.com',
    'and euvdservices.enisa.europa.eu, or to your mirrors. One switch for every source.',
    'A source that cannot be reached leaves its columns and is named in the task summary.',
    'NVD_API_KEY: optional, raises the request rate (https://nvd.nist.gov/developers/request-an-api-key).',
    'NVD_API_BASE_URL: optional mirror of the NVD CVE API 2.0.',
    'KEV_FEED_URL, EPSS_FEED_URL, EUVD_BASE_URL: optional mirrors. Empty keeps the default address.',
    "KEV_FEED_URL defaults to CISA's GitHub mirror (raw.githubusercontent.com); www.cisa.gov answers",
    '403 to data-centre addresses.',
    'An EPSS mirror may serve the file gzip or as plain CSV. An EUVD mirror serves both files under',
    'EUVD_BASE_URL: /api/kev/dump and /api/dump/cve-euvd-mapping.',
    'See EPSS at https://www.first.org/epss',
    'CVE_LIST_FEED_ENABLED: the CVE.org list, on with VULNERABILITY_FEED_ENABLED unless set to false.',
    'Without a mirror it needs outbound HTTPS to api.github.com, github.com and',
    'release-assets.githubusercontent.com.',
    'CVE_LIST_EXPORT_URL: a mirror of the full export (an http(s) address or the path of a file in',
    'the api container). CVE_LIST_RELEASES_URL, CVE_LIST_DOWNLOAD_URL: change them only behind a',
    'proxy that rewrites them.',
  ]),
  section('excel-imports', [
    'IMPORT_XLSX: the data imports read an Excel workbook (.xlsx, its first sheet) as well as a CSV',
    'file. Set to false to accept CSV files only.',
  ]),
  section('exchange-rates', [], true),
  section('ai', [
    'AI_CHAT_ENABLED: the Kad chat assistant. AI_MCP_ENABLED: MCP access and AI API keys.',
    'AI_SETTINGS_ENABLED: the Artificial intelligence page of the administration (providers, models)',
    'and the agents.',
    'AI_SETTINGS_ENCRYPTION_SECRET: needed to store provider keys (openssl rand -hex 32). Changing',
    'it makes the stored keys unreadable: back it up with this file.',
  ]),
  section('ai-tuning', [], true),
  section('security-boundaries', [], true),
  section('advanced', [
    'Token lifetimes: a number followed by s, m, h or d (another format keeps the default).',
  ]),
  section('start-up', [], true),
  section('email-tuning', [], true),
  section('capacity', [
    'See doc/help/docs/en/on-premise/configuration.md, "Capacity and performance".',
  ]),
  section('database-tuning', [], true),
];

/** The labels: descriptions of the entries, titles and notes of the sections, in four languages. */
export type EnvLabels = {
  block: { header: EnvText };
  sections: Record<string, { title: EnvText; note?: EnvText }>;
  entries: Record<string, EnvText>;
};

export const ENV_LABELS: EnvLabels = labelsJson as unknown as EnvLabels;

/** The text in a language, English when the language has none yet. */
export function envText(text: EnvText | undefined, language: EnvLanguage): string {
  return (text?.[language] ?? text?.en ?? '').trim();
}

export function envDescription(name: string, language: EnvLanguage): string {
  return envText(ENV_LABELS.entries[name], language);
}

/** The regular expression of a name or family: `*` stands for one or more of `A-Z`, `0-9`, `_`. */
export function envNamePattern(name: string): RegExp {
  return new RegExp(`^${name.split('*').map((part) => part.replace(/[^A-Z0-9_]/g, '')).join('[A-Z0-9_]+')}$`);
}

/** The entry of a variable name: its own, or the family it belongs to. */
export function findEnvVariable(name: string): EnvVariable | null {
  const exact = ENV_REGISTRY.find((variable) => variable.name === name);
  if (exact) return exact;
  return ENV_REGISTRY.find((variable) => variable.family && envNamePattern(variable.name).test(name)) ?? null;
}
