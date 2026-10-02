import { QueryRunner } from 'typeorm';

/**
 * The differential fixture of the list engine (lot 2B): a deterministic OPEX
 * tenant seeded by SQL in the caller's transaction, shaped like the perf
 * dataset (`scripts/perf/generate-dataset.mjs`) at a small scale, with the
 * edge rows the parity contract names (design section 3.4):
 * - names equal but for case or accents, `%`, `_`, `\`, `, ` in names,
 *   padded, astral, Turkish and Greek letters, empty descriptions;
 * - currencies EUR, USD, GBP, CHF (one year only) and JPY (no rate), a
 *   snapshot rate set without GBP, two live sets of one year;
 * - ends of validity in the past, at a UTC year boundary, mid-window and in
 *   the future, a stale stored status;
 * - missing versions, zero and negative amounts, all months deleted (a zero
 *   totals row), months outside the version's year, a later year;
 * - FTE 0 and unknown; every allocation method and an unknown one, a tenant
 *   rule in manual company mode;
 * - a cost centre tree with a cycle; users without names, with padded names;
 *   an account from another chart than its paying company;
 * - lines linked to several projects (one named "Alpha, Beta"), a legacy
 *   project, ties on task and contract creation time;
 * - created_at ties and sub-millisecond differences.
 *
 * Every id comes from the seed too (`uuidFrom`): the same seed gives the same
 * tenant, rows, order and cases on every run.
 */

/** mulberry32: the generator of the perf dataset. */
export function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    chance: (p: number) => next() < p,
  };
}

/** A version 4 uuid drawn from `r`. */
export function uuidFrom(r: ReturnType<typeof prng>): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(r.next() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The tables the fixture writes, analysed once seeded (see the end of `seedListFixture`). */
const SEEDED_TABLES = [
  'tenants', 'roles', 'users', 'chart_of_accounts', 'companies', 'company_metrics', 'accounts', 'suppliers', 'cost_centers',
  'analytics_axes', 'analytics_categories', 'portfolio_categories', 'portfolio_streams', 'portfolio_projects', 'contracts',
  'currency_rate_sets', 'allocation_rules', 'spend_items', 'spend_item_analytics_values', 'contract_spend_items',
  'portfolio_project_opex', 'tasks', 'spend_versions', 'spend_amounts', 'spend_version_totals', 'spend_round_inputs',
];

type Column = [name: string, type: string];

async function insert(runner: QueryRunner, table: string, columns: Column[], rows: unknown[][]): Promise<void> {
  if (!rows.length) return;
  const arrays = columns.map((_, i) => rows.map((row) => row[i] ?? null));
  const select = columns.map(([, type], i) => `$${i + 1}::${type}[]`).join(', ');
  await runner.query(`INSERT INTO ${table} (${columns.map(([name]) => name).join(', ')}) SELECT * FROM unnest(${select})`, arrays);
}

const PRODUCT_NAMES = [
  'Électricité', 'Electricite', 'électricité', 'ELECTRICITÉ', 'Licences Microsoft', 'licences microsoft', 'LICENCES MICROSOFT',
  '50% remise', '50_percent', 'back\\slash', 'Comma, separated', 'Œuvre collective', 'Straße Nord', 'İstanbul ofis', 'ΣΟΦΟΣ ΟΔΟΣ',
  '𝒜stral line', '  leading space', 'trailing space  ', 'Ångström', 'Zébu', 'zebu', 'Ébène', 'ebene', 'Hébergement', 'Hebergement',
  'Cyber sécurité', 'cybersecurite', 'Supervision', 'Sauvegarde', 'Téléphonie', 'Maintenance', 'Abonnement SaaS', 'Support',
  'ÆON license', 'Æon license', 'naïve', 'naive', 'Ça marche', 'ca marche', 'x', 'X', 'Z', 'a', 'A',
];
const WORDS = ['Licences', 'Maintenance', 'Support', 'Hébergement', 'Réseau', 'Téléphonie', 'Sécurité', 'Cloud', 'Postes', 'Conseil'];
const SUPPLIER_NAMES = [
  'Électricité de France', 'Electricite de France', 'électricité de france', 'ACME', 'acme', 'Acme', '%Percent & Co', 'Under_score SA',
  'Comma, Inc', 'Back\\slash GmbH', 'Œuvre SARL', 'Straße AG', 'İnci Holding', 'ΣΟΦΟΣ ΕΠΕ', '𝒜stral Ltd', 'Zébu Tech', 'zebu tech',
  'Nova soft', 'Cyber core', 'Cybercore', 'Data link SA', 'Hébergeur', 'Hebergeur', 'Blue gate', 'Green wave', 'Opti base',
];
const FIRST = ['Alice', 'Élodie', 'elodie', 'Gaëlle', 'Inès', 'Léa', 'Zoé', 'Zoe', 'İsmail', 'ΣΟΦΙΑ', 'Ångel', 'marc', 'Marc'];
const LAST = ['Martin', 'Dubois', 'André', 'Lefèvre', 'Lefevre', 'Şahin', 'ΠΑΠΑΣ', 'Ångström', "O'Brien", 'du Pont'];
// Unique per dimension, case-insensitively: case variants live in other names (suppliers, products).
const CATEGORY_NAMES = ['Licences', 'Licençes', 'Services', 'Sécurité', 'Securite', 'Matériel', 'Réseau', 'Énergie', 'Comma, value'];
const PROJECT_NAMES = ['Atlas', 'atlas', 'Borealis', 'Alpha, Beta', 'Ébène', 'Zénith', 'Nebula', 'Orion', 'Ω mega', 'Ζeta'];
const CONTRACT_NAMES = ['Accord cadre', 'accord cadre', 'Zephyr agreement', 'Contrat Électricité', 'Contrat electricite', 'Licence 2024', 'Support, maintenance'];
const TASK_TITLES = ['Renouveler licence', 'renouveler licence', 'Vérifier facture', 'Verifier facture', 'Négocier', 'Clôturer'];

export interface ListFixture {
  tenantId: string;
  emptyTenantId: string;
  itemCount: number;
}

/** Seeds the fixture tenant (and an empty tenant) in the runner's transaction; leaves the fixture tenant current. */
export async function seedListFixture(runner: QueryRunner, seed: number, itemCount = 300): Promise<ListFixture> {
  const r = prng(seed);
  // Ids from their own stream: the values drawn from `r` stay those of earlier runs of the same seed.
  const ids = prng(seed ^ 0x5bd1e995);
  const uuid = () => uuidFrom(ids);
  const Y = new Date().getFullYear();
  const tenantId = uuid();
  const emptyTenantId = uuid();
  for (const [id, tag] of [[tenantId, 'list'], [emptyTenantId, 'empty']] as const) {
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [id, `${tag}-diff-${id.slice(0, 8)}`, `List differential ${tag}`],
    );
  }
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const t = tenantId;

  // Users (owners and budget holders).
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'List differential role', 'test', false, false, now(), now()) RETURNING id`,
    [t],
  );
  const userRows: unknown[][] = [];
  const userIds: string[] = [];
  const odd: Array<[string | null, string | null]> = [[null, null], ['', ''], ['  Padded ', ' Name  '], [' ', null], [' Nbsp', 'Space '], ['Élise', null], [null, 'Seul']];
  for (let i = 0; i < 22; i++) {
    const id = uuid();
    userIds.push(id);
    const [first, last] = i < odd.length ? odd[i] : [r.pick(FIRST), r.pick(LAST)];
    userRows.push([id, t, role.id, `user${i}.${r.int(100, 999)}@list.test`, first, last, 'enabled']);
  }
  await insert(runner, 'users', [['id', 'uuid'], ['tenant_id', 'uuid'], ['role_id', 'uuid'], ['email', 'text'], ['first_name', 'text'], ['last_name', 'text'], ['status', 'text']], userRows);

  // Charts, companies (one without a chart), accounts in both charts.
  const charts = [uuid(), uuid()];
  await insert(runner, 'chart_of_accounts', [['id', 'uuid'], ['tenant_id', 'uuid'], ['code', 'text'], ['name', 'text'], ['country_iso', 'text']],
    charts.map((id, i) => [id, t, `LD${i}${id.slice(0, 6)}`, `Chart ${i}`, 'FR']));
  const companyIds = [uuid(), uuid(), uuid(), uuid()];
  await insert(runner, 'companies', [['id', 'uuid'], ['tenant_id', 'uuid'], ['name', 'text'], ['country_iso', 'text'], ['city', 'text'], ['coa_id', 'uuid']],
    [[companyIds[0], t, 'Société Générale IT', 'FR', 'Paris', charts[0]], [companyIds[1], t, 'Societe generale it', 'FR', 'Lyon', charts[1]],
      [companyIds[2], t, 'Ünited Holding', 'DE', 'Berlin', charts[0]], [companyIds[3], t, 'No chart Ltd', 'GB', 'London', null]]);
  await insert(runner, 'company_metrics', [['tenant_id', 'uuid'], ['company_id', 'uuid'], ['fiscal_year', 'int'], ['headcount', 'int'], ['it_users', 'int'], ['turnover', 'numeric']],
    companyIds.slice(0, 3).flatMap((id, i) => [Y - 1, Y, Y + 1].map((year) => [t, id, year, 100 * (i + 1) + year % 7, 50 * (i + 1), String(1000 * (i + 2))])));
  const accountIds: string[] = [];
  const accountRows: unknown[][] = [];
  for (let i = 0; i < 30; i++) {
    const id = uuid();
    accountIds.push(id);
    accountRows.push([id, t, charts[i % 2], 600000 + i * 7, `${r.pick(WORDS)} ${r.pick(['été', 'hiver', 'Ête', 'base'])} ${i}`]);
  }
  await insert(runner, 'accounts', [['id', 'uuid'], ['tenant_id', 'uuid'], ['coa_id', 'uuid'], ['account_number', 'int'], ['account_name', 'text']], accountRows);

  const supplierIds: string[] = [];
  await insert(runner, 'suppliers', [['id', 'uuid'], ['tenant_id', 'uuid'], ['name', 'text']],
    SUPPLIER_NAMES.map((name) => { const id = uuid(); supplierIds.push(id); return [id, t, name]; }));

  // Cost centres: groups, cost centres, and a cycle of two groups (never written by the service).
  const ccRows: unknown[][] = [];
  const groups: string[] = [];
  const leaves: string[] = [];
  const group = (code: string, name: string, parent: string | null, owner: string | null) => {
    const id = uuid();
    groups.push(id);
    ccRows.push([id, t, code, name, 'group', parent, null, owner, ccRows.length]);
    return id;
  };
  const leaf = (code: string, name: string, parent: string | null, owner: string | null) => {
    const id = uuid();
    leaves.push(id);
    ccRows.push([id, t, code, name, 'cost_center', parent, companyIds[leaves.length % 3], owner, ccRows.length]);
    return id;
  };
  const it = group('IT', 'Direction informatique', null, userIds[8]);
  const apps = group('IT-APPS', 'Applications', it, null);
  const infra = group('IT-INF', 'Infrastructure', it, userIds[2]);
  leaf('IT-200', 'Apps métier', apps, userIds[9]);
  leaf('IT-201', 'Apps metier', apps, null);
  leaf('IT-300', 'Réseau', infra, userIds[3]);
  leaf('LG-10', 'Logistique', null, userIds[0]);
  leaf('FIN-1', 'Finance › Contrôle', null, userIds[10]);
  const cycleA = group('CYC-A', 'Cycle A', null, null);
  const cycleB = group('CYC-B', 'Cycle B', cycleA, userIds[11]);
  leaf('CYC-1', 'Sous cycle', cycleB, userIds[12]);
  await insert(runner, 'cost_centers', [['id', 'uuid'], ['tenant_id', 'uuid'], ['code', 'text'], ['name', 'text'], ['kind', 'text'], ['parent_id', 'uuid'], ['company_id', 'uuid'], ['owner_user_id', 'uuid'], ['sort_order', 'int']], ccRows);
  await runner.query(`UPDATE cost_centers SET parent_id = $2 WHERE tenant_id = $1 AND id = $3`, [t, cycleB, cycleA]);

  // Analytics: the default dimension (no name) and two named ones.
  const axes = [uuid(), uuid(), uuid()];
  await insert(runner, 'analytics_axes', [['id', 'uuid'], ['tenant_id', 'uuid'], ['code', 'text'], ['name', 'text'], ['is_default', 'bool'], ['sort_order', 'int']],
    [[axes[0], t, 'default', null, true, 0], [axes[1], t, 'nature', 'Nature', false, 1], [axes[2], t, 'region', 'Région', false, 2]]);
  const categoriesByAxis = axes.map(() => [] as string[]);
  const categoryRows: unknown[][] = [];
  axes.forEach((axis, a) => {
    for (const name of CATEGORY_NAMES.slice(a, a + 6)) {
      const id = uuid();
      categoriesByAxis[a].push(id);
      categoryRows.push([id, t, axis, `${name}${a ? ` ${a}` : ''}`]);
    }
  });
  await insert(runner, 'analytics_categories', [['id', 'uuid'], ['tenant_id', 'uuid'], ['axis_id', 'uuid'], ['name', 'text']], categoryRows);

  // Projects with streams and categories (one empty stream name).
  const pCats = [uuid(), uuid(), uuid()];
  await insert(runner, 'portfolio_categories', [['id', 'uuid'], ['tenant_id', 'uuid'], ['name', 'text']],
    [[pCats[0], t, 'Run'], [pCats[1], t, 'Transformation'], [pCats[2], t, 'Éphémère']]);
  const streams = [uuid(), uuid(), uuid(), uuid()];
  await insert(runner, 'portfolio_streams', [['id', 'uuid'], ['tenant_id', 'uuid'], ['category_id', 'uuid'], ['name', 'text']],
    [[streams[0], t, pCats[0], 'Digital'], [streams[1], t, pCats[0], 'Infra'], [streams[2], t, pCats[1], 'Données'], [streams[3], t, pCats[1], '']]);
  const projectIds: string[] = [];
  await insert(runner, 'portfolio_projects', [['id', 'uuid'], ['tenant_id', 'uuid'], ['name', 'text'], ['item_number', 'int'], ['stream_id', 'uuid'], ['category_id', 'uuid']],
    PROJECT_NAMES.map((name, i) => {
      const id = uuid();
      projectIds.push(id);
      return [id, t, name, i + 1, i % 5 === 4 ? null : streams[i % 4], i % 3 === 2 ? null : pCats[i % 3]];
    }));

  // Contracts.
  const contractIds: string[] = [];
  await insert(runner, 'contracts', [['id', 'uuid'], ['tenant_id', 'uuid'], ['name', 'text'], ['company_id', 'uuid'], ['supplier_id', 'uuid'], ['start_date', 'date']],
    CONTRACT_NAMES.map((name, i) => { const id = uuid(); contractIds.push(id); return [id, t, name, companyIds[i % 3], supplierIds[i], '2024-01-01']; }));

  // FX: live sets per year (two for Y, the later wins), a snapshot of Y without GBP, CHF in Y+1 only, JPY nowhere.
  const snapshot = uuid();
  const rateRows: unknown[][] = [];
  for (const year of [Y - 2, Y - 1, Y, Y + 1, Y + 2]) {
    const rates: Record<string, number> = { USD: 0.9 + (year % 5) / 100 + 0.0013, ...(year === Y - 1 ? {} : { GBP: 1.17 + (year % 3) / 100 }) };
    if (year === Y + 1) rates.CHF = 1.0471;
    rateRows.push([uuid(), t, year, 'EUR', JSON.stringify(rates), `${year}-06-01T00:00:00Z`]);
  }
  rateRows.push([uuid(), t, Y, 'EUR', JSON.stringify({ USD: 0.5, GBP: 0.5 }), `${Y - 1}-01-01T00:00:00Z`]);
  rateRows.push([snapshot, t, Y, 'EUR', JSON.stringify({ USD: 0.913579 }), `${Y}-02-01T00:00:00Z`]);
  await insert(runner, 'currency_rate_sets', [['id', 'uuid'], ['tenant_id', 'uuid'], ['fiscal_year', 'int'], ['base_currency', 'text'], ['rates', 'jsonb'], ['captured_at', 'timestamptz']], rateRows);

  // Allocation rules: Y in manual company mode, Y+1 on turnover.
  await runner.query(
    `INSERT INTO allocation_rules (tenant_id, fiscal_year, method, mode, company_ids, status) VALUES ($1, $2, 'headcount', 'manual_company', $3::uuid[], 'enabled'), ($1, $4, 'turnover', 'auto', NULL, 'enabled')`,
    [t, Y, [companyIds[0], companyIds[1]], Y + 1],
  );

  // Items (currency codes reference the shared currency table).
  await runner.query(
    `INSERT INTO currencies (code, name) VALUES ('EUR', 'Euro'), ('USD', 'US dollar'), ('GBP', 'Pound sterling'), ('CHF', 'Swiss franc'), ('JPY', 'Yen')
     ON CONFLICT (code) DO NOTHING`,
  );
  const base = Date.UTC(Y - 1, 10, 5, 9, 30, 0);
  const endsOfValidity = [
    `${Y - 3}-03-01T12:00:00Z`, `${Y - 2}-06-30T12:00:00Z`, `${Y - 1}-12-31T23:30:00Z`, `${Y}-01-01T00:00:00Z`,
    `${Y}-03-15T12:00:00Z`, `${Y + 1}-03-31T12:00:00Z`, `${Y + 2}-12-31T12:00:00Z`,
  ];
  const itemRows: unknown[][] = [];
  const items: Array<{ id: string; currency: string; disabledYear: number | null }> = [];
  const numbers = Array.from({ length: itemCount }, (_, i) => i + 1 + (i > itemCount / 2 ? 7 : 0));
  for (let i = 0; i < itemCount; i++) {
    const id = uuid();
    const name = i < PRODUCT_NAMES.length ? PRODUCT_NAMES[i] : `${r.pick(WORDS)} ${r.pick(['été', 'Ete', 'ÉTÉ', 'hiver', 'Hiver', '100%', 'a_b'])} ${String(i).padStart(3, '0')}`;
    const currency = r.chance(0.7) ? 'EUR' : r.pick(['USD', 'USD', 'GBP', 'CHF', 'JPY']);
    const disabled = r.chance(0.22) ? r.pick(endsOfValidity) : null;
    const disabledAt = disabled ? new Date(disabled) : null;
    // The stored status follows the end of validity, except a few stale ones (the hourly sync has not run yet).
    let status = disabledAt && disabledAt.getTime() <= Date.now() ? 'disabled' : 'enabled';
    if (r.chance(0.04)) status = status === 'enabled' ? 'disabled' : 'enabled';
    // Bulk-created ties, distinct times and sub-millisecond differences.
    const createdMicros = i % 4 === 0 ? 0 : i % 4 === 1 ? i * 1000 : i % 4 === 2 ? i * 1000 + 250 : Math.floor(i / 8) * 1000;
    const created = new Date(base + Math.floor(createdMicros / 1000)).toISOString().replace('Z', `${String(createdMicros % 1000).padStart(3, '0')}Z`);
    items.push({ id, currency, disabledYear: disabledAt ? disabledAt.getUTCFullYear() : null });
    itemRows.push([
      id, t, numbers[i], name,
      r.chance(0.3) ? null : r.chance(0.15) ? '' : `${r.pick(WORDS)} ${r.pick(['détail', 'detail', '%', '_x_', 'Ça'])}`,
      r.chance(0.5) ? null : `Note ${r.pick(['urgente', 'Urgente', 'URGENTE', 'été', 'ete'])} ${i}`,
      currency,
      `${r.int(2019, Y + 1)}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`,
      disabled, status,
      r.chance(0.8) ? r.pick(supplierIds) : null,
      r.chance(0.8) ? r.pick(accountIds) : null,
      r.chance(0.85) ? r.pick(companyIds) : null,
      r.chance(0.7) ? r.pick(userIds) : null,
      r.chance(0.6) ? r.pick(userIds) : null,
      r.chance(0.7) ? r.pick([...leaves, ...leaves, groups[1]]) : null,
      r.chance(0.6) ? r.pick(['run', 'build']) : null,
      r.chance(0.05) ? r.pick(projectIds) : null,
      created,
      new Date(base + r.int(0, 300) * 86_400_000 + r.int(0, 999)).toISOString(),
    ]);
  }
  await insert(runner, 'spend_items', [
    ['id', 'uuid'], ['tenant_id', 'uuid'], ['item_number', 'int'], ['product_name', 'text'], ['description', 'text'], ['notes', 'text'],
    ['currency', 'text'], ['effective_start', 'date'], ['disabled_at', 'timestamptz'], ['status', 'status_state'],
    ['supplier_id', 'uuid'], ['account_id', 'uuid'], ['paying_company_id', 'uuid'], ['owner_it_id', 'uuid'], ['owner_business_id', 'uuid'],
    ['cost_center_id', 'uuid'], ['run_build', 'run_build'], ['project_id', 'uuid'], ['created_at', 'timestamptz'], ['updated_at', 'timestamptz'],
  ], itemRows);

  // Links: analytics, contracts (ties on creation time), projects, tasks (ties on creation time).
  const analyticsRows: unknown[][] = [];
  const contractRows: unknown[][] = [];
  const projectRows: unknown[][] = [];
  const taskRows: unknown[][] = [];
  let taskNumber = 1;
  const linkTime = `${Y - 1}-02-03T04:05:06.789Z`;
  for (const item of items) {
    axes.forEach((axis, a) => {
      if (r.chance(a === 0 ? 0.7 : 0.45)) analyticsRows.push([t, item.id, axis, r.pick(categoriesByAxis[a])]);
    });
    if (r.chance(0.4)) {
      const linked = r.chance(0.2) ? [r.pick(contractIds), r.pick(contractIds)] : [r.pick(contractIds)];
      const tie = r.chance(0.5);
      Array.from(new Set(linked)).forEach((contract, k) => contractRows.push([uuid(), t, contract, item.id, tie ? linkTime : new Date(base + k * 1000).toISOString()]));
    }
    if (r.chance(0.25)) {
      const count = r.int(1, 3);
      new Set(Array.from({ length: count }, () => r.pick(projectIds))).forEach((project) => projectRows.push([t, project, item.id]));
    }
    if (r.chance(0.2)) {
      const tie = r.chance(0.4);
      for (let k = 0; k < r.int(1, 3); k++) {
        taskRows.push([uuid(), t, `${r.pick(TASK_TITLES)} ${k}`, taskNumber++, r.pick(['open', 'in_progress', 'pending', 'in_testing', 'done', 'cancelled']),
          'spend_item', item.id, tie ? linkTime : new Date(base + k * 60_000).toISOString()]);
      }
    }
  }
  await insert(runner, 'spend_item_analytics_values', [['tenant_id', 'uuid'], ['item_id', 'uuid'], ['axis_id', 'uuid'], ['category_id', 'uuid']], analyticsRows);
  await insert(runner, 'contract_spend_items', [['id', 'uuid'], ['tenant_id', 'uuid'], ['contract_id', 'uuid'], ['spend_item_id', 'uuid'], ['created_at', 'timestamptz']], contractRows);
  await insert(runner, 'portfolio_project_opex', [['tenant_id', 'uuid'], ['project_id', 'uuid'], ['opex_id', 'uuid']], projectRows);
  await insert(runner, 'tasks', [['id', 'uuid'], ['tenant_id', 'uuid'], ['title', 'text'], ['item_number', 'int'], ['status', 'text'], ['related_object_type', 'text'], ['related_object_id', 'uuid'], ['created_at', 'timestamptz']], taskRows);

  // Versions, months, rounds.
  const methods = ['default', 'default', 'default', 'default', 'manual_pct', 'manual_company', 'manual_department', 'headcount', 'it_users', 'turnover', 'legacy_method'];
  const versionRows: unknown[][] = [];
  const amountRows: unknown[][] = [];
  const roundRows: unknown[][] = [];
  const emptied: string[] = [];
  const money = () => {
    const kind = r.next();
    if (kind < 0.1) return '0';
    if (kind < 0.18) return (-r.int(1, 99999) / 100).toFixed(2);
    if (kind < 0.2) return (r.int(1, 999_999_999) / 100 + 9_000_000).toFixed(2);
    return (r.int(1, 2_000_000) / 100).toFixed(2);
  };
  for (const item of items) {
    for (const year of [Y - 2, Y - 1, Y, Y + 1, Y + 2, Y + 3]) {
      if (!r.chance(year === Y + 3 ? 0.2 : 0.78)) continue;
      const versionId = uuid();
      versionRows.push([versionId, t, item.id, `Y${year}`, r.pick(['monthly', 'monthly', 'monthly', 'annual', 'quarterly']), `${year}-01-01`, year,
        r.pick(methods), year === Y && r.chance(0.15) ? snapshot : null]);
      const shape = r.next();
      if (shape < 0.1) continue; // a version without months: no totals row
      const months = shape < 0.2 ? [1] : Array.from({ length: 12 }, (_, m) => m + 1);
      for (const month of months) {
        amountRows.push([t, versionId, `${year}-${String(month).padStart(2, '0')}-01`, money(), money(), money(), r.chance(0.5) ? money() : '0', money()]);
      }
      if (r.chance(0.03)) amountRows.push([t, versionId, `${year + 1}-01-01`, '1000.00', '1000.00', '1000.00', '1000.00', '1000.00']);
      if (r.chance(0.04)) emptied.push(versionId);
      for (const measure of ['planned', 'committed', 'forecast', 'actual', 'expected_landing']) {
        if (!r.chance(0.12)) continue;
        roundRows.push([t, versionId, measure, `${year}-01-01`, `${year}-12-31`, r.chance(0.3) ? 'spread' : 'computed',
          r.chance(0.25) ? null : r.chance(0.2) ? '0' : (r.int(1, 1200) / 100).toFixed(2)]);
      }
    }
  }
  await insert(runner, 'spend_versions', [['id', 'uuid'], ['tenant_id', 'uuid'], ['spend_item_id', 'uuid'], ['version_name', 'text'], ['input_grain', 'input_grain'],
    ['as_of_date', 'date'], ['budget_year', 'int'], ['allocation_method', 'text'], ['fx_rate_set_id', 'uuid']], versionRows.map((row) => row));
  await insert(runner, 'spend_amounts', [['tenant_id', 'uuid'], ['version_id', 'uuid'], ['period', 'date'], ['planned', 'numeric'], ['committed', 'numeric'],
    ['forecast', 'numeric'], ['actual', 'numeric'], ['expected_landing', 'numeric']], amountRows);
  // Every month of a few versions deleted: their totals row stays, all zero.
  if (emptied.length) await runner.query(`DELETE FROM spend_amounts WHERE tenant_id = $1 AND version_id = ANY($2::uuid[])`, [t, emptied]);
  await insert(runner, 'spend_round_inputs', [['tenant_id', 'uuid'], ['version_id', 'uuid'], ['measure', 'text'], ['period_start', 'date'], ['period_end', 'date'],
    ['method', 'text'], ['fte', 'numeric']], roundRows);
  // Statistics, as on a loaded database: without them the planner reads the fixture tenant as unknown
  // (one row per table) and joins by nested loops, slower than at 5,000 lines. ANALYZE sees the
  // transaction's own rows, and its statistics roll back with it.
  await runner.query(`ANALYZE ${SEEDED_TABLES.join(', ')}`);
  return { tenantId, emptyTenantId, itemCount };
}
