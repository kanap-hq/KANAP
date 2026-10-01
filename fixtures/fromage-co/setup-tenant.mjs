#!/usr/bin/env node
// Fromage & Co demo tenant setup — single idempotent runner.
//
// Creates the tenant (trial flow), seeds settings/classification, imports all
// CSVs, wires relations (suites, departments, instances, interfaces,
// connections, contracts↔spend, portfolio timeline/teams, allocations), sets
// demo user passwords, and provisions a demo AI agent on the mock ticketing
// provider.
//
// Usage:
//   node fixtures/fromage-co/setup-tenant.mjs \
//     --base-url https://fromage.dev.kanap.net \
//     --email fried@kanap.net --password '<admin password>'
//
// See SETUP-GUIDE.md for the full procedure per environment.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  baseUrl: 'https://fromage.dev.kanap.net',
  email: 'fried@kanap.net',
  org: 'Fromage & Co',
  countryIso: 'FR',
  demoPassword: 'Fromage2026!',
  year: 2026,
};

const argv = process.argv.slice(2);
const options = {
  baseUrl: DEFAULTS.baseUrl,
  email: DEFAULTS.email,
  password: '',
  org: DEFAULTS.org,
  countryIso: DEFAULTS.countryIso,
  activationToken: '',
  demoPassword: DEFAULTS.demoPassword,
  year: DEFAULTS.year,
  skipRelations: false,
  skipAgents: false,
  netboxTestCases: false,
};

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--base-url') options.baseUrl = argv[++i] ?? options.baseUrl;
  else if (arg === '--email') options.email = argv[++i] ?? options.email;
  else if (arg === '--password') options.password = argv[++i] ?? options.password;
  else if (arg === '--org') options.org = argv[++i] ?? options.org;
  else if (arg === '--country') options.countryIso = argv[++i] ?? options.countryIso;
  else if (arg === '--activation-token') {
    // Accepts either the bare token or the full activation link from the email.
    const raw = argv[++i] ?? '';
    options.activationToken = raw.includes('#token=') ? raw.split('#token=')[1] : raw;
  }
  else if (arg === '--demo-password') options.demoPassword = argv[++i] ?? '';
  else if (arg === '--year') options.year = Number(argv[++i] ?? options.year);
  else if (arg === '--skip-relations') options.skipRelations = true;
  else if (arg === '--skip-agents') options.skipAgents = true;
  // Dev only: adds the deliberately duplicated asset used by the Netbox sync tests.
  else if (arg === '--netbox-test-cases') options.netboxTestCases = true;
  else throw new Error(`Unknown argument: ${arg}`);
}

options.baseUrl = options.baseUrl.replace(/\/$/, '');
if (!options.password) {
  console.error('[ERR]  --password is required (tenant admin password; also used when bootstrapping the tenant).');
  process.exit(1);
}

const tenantHost = new URL(options.baseUrl).hostname;
const slug = tenantHost.split('.')[0];
// Public (pre-tenant) routes are served on the marketing apex; unknown tenant
// subdomains answer TENANT_NOT_FOUND for everything else.
const publicBaseUrl = options.baseUrl.replace(`//${tenantHost}`, `//${tenantHost.split('.').slice(1).join('.')}`);

let token = '';
let apiPrefix = '';

const info = (message) => console.log(`[INFO] ${message}`);
const ok = (message) => console.log(`[OK]   ${message}`);
const warn = (message) => console.warn(`[WARN] ${message}`);

function file(name) {
  return path.join(ROOT_DIR, name);
}

function normalizeValue(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseCsv(content, delimiter = ';') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some((v) => v.length > 0)) rows.push(row);

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => normalizeValue(h));
  return rows.slice(1).map((values) => {
    const out = {};
    for (let i = 0; i < headers.length; i += 1) {
      out[headers[i]] = normalizeValue(values[i] ?? '');
    }
    return out;
  });
}

function readCsv(name) {
  return parseCsv(readFileSync(file(name), 'utf8'));
}

function splitList(value) {
  return normalizeValue(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolValue(value) {
  return ['true', '1', 'yes', 'y'].includes(normalizeValue(value).toLowerCase());
}

function lower(value) {
  return normalizeValue(value).toLowerCase();
}

async function request(method, route, body, { uploadPath, uploadBytes, uploadName, noAuth, publicHost } = {}) {
  const headers = {};
  const init = { method, headers };

  if (token && !noAuth) headers.Authorization = `Bearer ${token}`;

  if (uploadPath || uploadBytes) {
    const bytes = uploadBytes ?? readFileSync(uploadPath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'text/csv;charset=utf-8' }), uploadName ?? path.basename(uploadPath));
    init.body = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const url = `${publicHost ? publicBaseUrl : options.baseUrl}${apiPrefix}${route}`;
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const details = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    const error = new Error(`${method} ${apiPrefix}${route} failed (${response.status})\n${details}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload === '' ? null : payload;
}

async function apiGet(route) {
  return request('GET', route);
}

async function apiPost(route, body) {
  return request('POST', route, body);
}

async function apiPatch(route, body) {
  return request('PATCH', route, body);
}

async function apiDelete(route) {
  return request('DELETE', route);
}

async function uploadCsv(route, csvPath) {
  return request('POST', route, undefined, { uploadPath: csvPath });
}

function items(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['items', 'agent_definitions', 'profiles', 'actions']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function getAll(route) {
  return items(await apiGet(route));
}

function firstBy(list, predicate) {
  return list.find(predicate)?.id ?? '';
}

async function idByName(route, name, field = 'name') {
  const needle = normalizeValue(name);
  return firstBy(await getAll(route), (item) => normalizeValue(item[field]) === needle);
}

// ── API prefix detection + tenant bootstrap ─────────────────────────────────

async function detectApiPrefix() {
  for (const prefix of ['/api', '']) {
    apiPrefix = prefix;
    try {
      const payload = await request('GET', '/health', undefined, { noAuth: true, publicHost: true });
      if (payload && typeof payload === 'object') {
        ok(`API reachable via ${prefix || '(root)'}`);
        return;
      }
    } catch {
      // try next prefix
    }
  }
  throw new Error(`Could not reach the API health endpoint at ${publicBaseUrl} (tried /api/health and /health)`);
}

async function tryLogin() {
  try {
    const payload = await apiPost('/auth/login', { email: options.email, password: options.password });
    token = payload.access_token;
    if (!token) throw new Error('No access_token in login response');
    ok(`Authenticated as ${options.email}`);
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 404 || error.status === 400) return false;
    throw error;
  }
}

async function ensureTenant() {
  info(`Trying to authenticate as ${options.email} on ${options.baseUrl}`);
  if (await tryLogin()) return;

  info(`Login failed — bootstrapping tenant '${slug}' via the trial flow`);
  let activationToken = options.activationToken;

  if (!activationToken) {
    let response;
    try {
      response = await request('POST', '/public/start-trial', {
        org: options.org,
        slug,
        email: options.email,
        country_iso: options.countryIso,
      }, { publicHost: true });
    } catch (error) {
      if (String(error.payload?.code) === 'SUBDOMAIN_NOT_AVAILABLE') {
        throw new Error(
          `Tenant '${slug}' already exists but the credentials were rejected. ` +
          'Fix --email/--password, or delete the tenant from platform-admin first.',
        );
      }
      if (error.status === 400 && /captcha/i.test(JSON.stringify(error.payload ?? ''))) {
        throw new Error(
          'Trial signup is CAPTCHA-protected on this environment. Sign up in the browser ' +
          `(slug '${slug}', email ${options.email}), then re-run with --activation-token <token from the activation link>.`,
        );
      }
      throw error;
    }

    const activationUrl = response?.activation_url;
    if (activationUrl) {
      activationToken = activationUrl.split('#token=')[1];
    } else {
      info(`Activation email sent to ${options.email}.`);
      info('Open the link, copy the token after "#token=", and re-run with --activation-token <token>.');
      process.exit(1);
    }
  }

  const activation = await request('POST', '/public/activate-trial', { token: activationToken }, { publicHost: true });
  ok(`Tenant activated: ${activation.tenant_url ?? options.baseUrl}`);
  await apiPost('/auth/password-reset/complete', { token: activation.reset_token, password: options.password });
  ok(`Admin password set for ${options.email}`);

  if (!(await tryLogin())) throw new Error('Login still failing after tenant activation');
}

// ── Lookups ──────────────────────────────────────────────────────────────────

async function companyIdByName(name) {
  return idByName('/companies?limit=500', name);
}

async function departmentIdByName(name, companyName = '') {
  const depts = await getAll('/departments?limit=1000');
  if (!companyName) return firstBy(depts, (item) => item.name === name);
  const companyId = await companyIdByName(companyName);
  return firstBy(depts, (item) => item.name === name && item.company_id === companyId);
}

async function userIdByEmail(email) {
  const needle = lower(email);
  return firstBy(await getAll('/users?limit=1000'), (item) => lower(item.email) === needle);
}

async function appIdByName(name) {
  return idByName('/applications?limit=1000', name);
}

async function projectIdByName(name) {
  const list = await getAll('/portfolio/projects?limit=1000');
  const project = list.find((item) => item.name === name);
  return project?.id ?? project?.project_id ?? '';
}

async function spendIdByName(name) {
  return idByName('/spend-items?limit=1000', name, 'product_name');
}

async function capexIdByDescription(description) {
  return idByName('/capex-items?limit=500', description, 'description');
}

async function contractIdByName(name) {
  return idByName('/contracts?limit=500', name);
}

async function locationIdByName(name) {
  return idByName('/locations?limit=500', name);
}

async function assetIdByName(name) {
  return idByName('/assets?limit=1000', name);
}

async function interfaceIdByCode(code) {
  return firstBy(await getAll('/interfaces?limit=1000'), (item) => item.interface_id === code);
}

async function connectionIdByName(name) {
  return idByName('/connections?limit=500', name);
}

async function portfolioTeamIdByName(name) {
  return idByName('/portfolio/teams', name);
}

async function appIdsFromNames(names) {
  const ids = [];
  for (const name of names) {
    const id = await appIdByName(name);
    if (id) ids.push(id);
    else warn(`Application '${name}' not found while resolving app IDs`);
  }
  return [...new Set(ids)];
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function setupSettings() {
  info('Configuring base settings');
  await apiPatch('/currency/settings', {
    reportingCurrency: 'EUR',
    defaultSpendCurrency: 'EUR',
    defaultCapexCurrency: 'EUR',
    allowedCurrencies: ['EUR', 'USD'],
  });

  const current = await apiGet('/it-ops/settings');
  const mergeByCode = (existing, additions) => {
    const map = new Map((existing ?? []).map((item) => [item.code, item]));
    for (const item of additions) map.set(item.code, { ...map.get(item.code), ...item });
    return [...map.values()];
  };
  await apiPatch('/it-ops/settings', {
    serverKinds: mergeByCode(current.serverKinds, [
      { code: 'storage', label: 'Storage' },
      { code: 'network_switch', label: 'Network Switch' },
      { code: 'iot_gateway', label: 'IoT Gateway' },
      { code: 'edge_node', label: 'Edge Node' },
      { code: 'cloud_instance', label: 'Cloud Instance' },
      { code: 'cloud_database', label: 'Cloud Database' },
    ]),
    operatingSystems: mergeByCode(current.operatingSystems, [
      { code: 'vmware_esxi_8_0', label: 'VMware ESXi 8.0' },
      { code: 'suse_linux_enterprise_15', label: 'SUSE Linux Enterprise 15' },
      { code: 'fortios_7_4', label: 'FortiOS 7.4' },
      { code: 'cisco_meraki', label: 'Cisco Meraki' },
      { code: 'schneider_ecostruxure', label: 'Schneider EcoStruxure' },
      { code: 'amazon_linux_2023', label: 'Amazon Linux 2023' },
      { code: 'amazon_rds', label: 'Amazon RDS' },
    ]),
    domains: mergeByCode(current.domains, [
      { code: 'fromage-co-local', label: 'fromage-co.local', dns_suffix: 'fromage-co.local' },
      { code: 'kaasmeester-local', label: 'kaasmeester.local', dns_suffix: 'kaasmeester.local' },
      { code: 'formaggio-supremo-local', label: 'formaggio-supremo.local', dns_suffix: 'formaggio-supremo.local' },
    ]),
    entities: mergeByCode(current.entities, [
      { code: 'par_dc1', label: 'PAR-DC1' },
      { code: 'gou_dc1', label: 'GOU-DC1' },
      { code: 'prm_site', label: 'PRM-SITE' },
      { code: 'nyc_off', label: 'NYC-OFF' },
      { code: 'aws_eu', label: 'AWS-EU' },
    ]),
    serverProviders: mergeByCode(current.serverProviders, [
      { code: 'on_prem', label: 'On-premise' },
    ]),
  });
  ok('Base settings configured');
}

async function ensurePortfolioClassification() {
  info('Ensuring portfolio classification');
  const ensure = async (route, entries, extra = () => ({})) => {
    const existing = await getAll(route);
    for (const entry of entries) {
      if (existing.some((item) => lower(item.name) === lower(entry.name))) continue;
      await apiPost(route, { ...entry, ...(await extra(entry)) });
      ok(`Created ${route.split('/').pop()} '${entry.name}'`);
    }
  };

  await ensure('/portfolio/classification/sources', [
    { name: 'Strategic Plan', description: 'Multi-year strategic roadmap initiatives' },
    { name: 'IT Modernization', description: 'Technical debt reduction and platform upgrades' },
    { name: 'Business Request', description: 'Ad-hoc requests from business stakeholders' },
    { name: 'Regulatory Compliance', description: 'Regulatory and legal requirements' },
  ]);

  await ensure('/portfolio/classification/categories', [
    { name: 'Digital Transformation', description: 'Innovation and digital business capabilities' },
    { name: 'Business Applications', description: 'ERP, CRM, HR and core business systems' },
    { name: 'Infrastructure', description: 'Servers, networks, cloud and datacenter' },
    { name: 'Security & Compliance', description: 'Cybersecurity, identity and compliance' },
    { name: 'Data & Analytics', description: 'BI, data platforms and advanced analytics' },
  ]);

  const categories = await getAll('/portfolio/classification/categories');
  const categoryId = (name) => firstBy(categories, (item) => lower(item.name) === lower(name));
  const streams = await getAll('/portfolio/classification/streams');
  for (const [name, description, category] of [
    ['Cheese Production Excellence', 'Optimize production, aging and quality', 'Digital Transformation'],
    ['Customer Experience', 'Improve B2B and B2C customer interactions', 'Business Applications'],
    ['IT Foundation', 'Core IT infrastructure and shared services', 'Infrastructure'],
  ]) {
    if (streams.some((item) => lower(item.name) === lower(name))) continue;
    const category_id = categoryId(category);
    if (!category_id) {
      warn(`Category '${category}' not found; skipping stream '${name}'`);
      continue;
    }
    await apiPost('/portfolio/classification/streams', { name, description, category_id });
    ok(`Created stream '${name}'`);
  }
}

async function ensureAnalyticsCategories() {
  info('Ensuring analytics categories');
  const existing = await getAll('/analytics-categories?limit=200');
  for (const [name, description] of [
    ['Productivity', 'Email, collaboration, office suites'],
    ['ERP', 'Enterprise resource planning'],
    ['CRM', 'Customer relationship management'],
    ['ITSM', 'IT service management'],
    ['HR', 'Human capital management'],
    ['Security', 'Cybersecurity and identity'],
    ['Infrastructure', 'Hosting, cloud and virtualization'],
    ['Monitoring', 'Observability and alerting'],
    ['IoT', 'Internet of Things platforms'],
    ['Traceability', 'Supply chain and cold chain'],
    ['Analytics', 'BI, data platforms and reporting'],
    ['Managed Services', 'Outsourced IT services'],
    ['Professional Services', 'Consulting and staff augmentation'],
    ['Training', 'Learning and certifications'],
    ['General', 'Miscellaneous IT expenses'],
  ]) {
    if (existing.some((item) => lower(item.name) === lower(name))) continue;
    await apiPost('/analytics-categories', { name, description });
    ok(`Created analytics category '${name}'`);
  }
}


// ── Budget: analytics dimensions, costed lines, monthly rows ─────────────────
//
// The budget files (26-30) come from tools/generate-budget.mjs. Cost centres,
// dimension values and calendars import like any master data. Costed lines
// (quantity × price, file 30) and monthly amounts (file 29) are keyed by item
// name in the files, because item numbers only exist once the items are
// imported: both steps resolve the names against the tenant first.

const ANALYTICS_AXES = [
  { code: 'nature', name: 'Nature de coût', description: 'Ce que la dépense paie : licences, assistance technique, cloud, matériel…', sort_order: 10 },
  { code: 'reference', name: 'Référence budget', description: "Regroupe les lignes OPEX et CAPEX d'une même commande ou d'un même centre de compétences, quel que soit le fournisseur", sort_order: 20 },
  { code: 'recurrence', name: 'Récurrence', description: 'Dépense récurrente ou ponctuelle', sort_order: 30 },
];

async function ensureAnalyticsAxes() {
  info('Ensuring analytics dimensions');
  const existing = items(await apiGet('/analytics-axes'));
  for (const axis of ANALYTICS_AXES) {
    if (existing.some((item) => lower(item.code) === axis.code)) continue;
    await apiPost('/analytics-axes', axis);
    ok(`Created analytics dimension '${axis.name}'`);
  }
}

const CSV_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

async function listAllPages(route) {
  const all = [];
  for (let offset = 0; ; offset += 200) {
    const page = items(await apiGet(`${route}${route.includes('?') ? '&' : '?'}limit=200&offset=${offset}`));
    all.push(...page);
    if (page.length < 200) return all;
  }
}

async function budgetItemIndex() {
  // Items whose end of validity has passed list as disabled: fetch both.
  const spend = [...(await listAllPages('/spend-items?status=enabled')), ...(await listAllPages('/spend-items?status=disabled'))];
  const capex = [...(await listAllPages('/capex-items?status=enabled')), ...(await listAllPages('/capex-items?status=disabled'))];
  return {
    opex: new Map(spend.map((item) => [item.product_name, item])),
    capex: new Map(capex.map((item) => [item.description, item])),
  };
}

async function ensureCostedLines(index) {
  info('Writing costed lines (quantity × price)');
  const calendars = await listAllPages('/working-day-profiles');
  const calendarId = (code) => firstBy(calendars, (item) => lower(item.code) === lower(code));
  const groups = new Map();
  for (const row of readCsv('30-costed-lines.csv')) {
    const key = `${row.item_type}|${row.item_name}|${row.year}|${row.measure}`;
    if (!groups.has(key)) groups.set(key, { ...row, lines: [] });
    groups.get(key).lines.push(row);
  }
  let written = 0;
  for (const group of groups.values()) {
    const item = index[group.item_type]?.get(group.item_name);
    if (!item) { warn(`Costed lines: ${group.item_type} '${group.item_name}' not found`); continue; }
    const itemBase = group.item_type === 'opex' ? '/spend-items' : '/capex-items';
    const versionBase = group.item_type === 'opex' ? '/spend-versions' : '/capex-versions';
    const year = Number(group.year);
    const versions = items(await apiGet(`${itemBase}/${item.id}/versions`));
    let version = versions.find((v) => Number(v.budget_year) === year);
    if (!version) version = await apiPost(`${itemBase}/${item.id}/versions`, { budget_year: year });
    const lines = group.lines.map((line) => {
      const calendar = line.calendar_code ? calendarId(line.calendar_code) : null;
      if (line.calendar_code && !calendar) throw new Error(`Costed lines: calendar '${line.calendar_code}' not found`);
      return {
        label: line.label,
        quantity_unit: line.quantity_unit,
        quantity: line.quantity,
        unit_price: line.unit_price,
        price_basis: line.price_basis,
        frequency: line.frequency,
        days_per_month: line.days_per_month || null,
        period_start: line.period_start,
        period_end: line.period_end,
        working_day_profile_id: calendar,
      };
    });
    await apiPost(`${versionBase}/${version.id}/amounts/bulk-upsert`, { kind: 'lines', year, measure: group.measure, lines });
    written += 1;
  }
  ok(`Costed lines written on ${written} item columns`);
}

async function importBudgetRows(index) {
  info('Importing monthly budget rows');
  const header = ['item_type', 'item_number', 'year', 'measure', 'period_start', 'period_end', ...CSV_MONTHS, 'method'];
  const out = [header.join(';')];
  let skipped = 0;
  for (const row of readCsv('29-budget-rows.csv')) {
    const item = index[row.item_type]?.get(row.item_name);
    if (!item) { warn(`Budget rows: ${row.item_type} '${row.item_name}' not found`); skipped += 1; continue; }
    out.push([row.item_type, item.item_number, row.year, row.measure, row.period_start, row.period_end, ...CSV_MONTHS.map((m) => row[m]), ''].join(';'));
  }
  const bytes = Buffer.from(out.join('\n') + '\n', 'utf8');
  const result = await request('POST', '/budget-rows/import?dryRun=false', undefined, { uploadBytes: bytes, uploadName: '29-budget-rows.csv' });
  if (result?.ok === false) throw new Error(`Budget rows import returned ok=false:\n${JSON.stringify(result, null, 2)}`);
  ok(`Imported budget rows (${out.length - 1} rows${skipped ? `, ${skipped} skipped` : ''})`);
}

async function runBudget() {
  const index = await budgetItemIndex();
  await ensureCostedLines(index);
  await importBudgetRows(index);
}

// ── Chart of accounts ────────────────────────────────────────────────────────

async function ensureCoa(name, code, scope, countryIso = undefined) {
  const coas = await apiGet('/chart-of-accounts?limit=500');
  const existing = items(coas).find((coa) => coa.name === name);
  if (existing) return existing.id;
  await apiPost('/chart-of-accounts', {
    code,
    name,
    scope,
    ...(countryIso ? { country_iso: countryIso } : {}),
  });
  const refreshed = await apiGet('/chart-of-accounts?limit=500');
  const created = items(refreshed).find((coa) => coa.name === name);
  if (!created) throw new Error(`Failed to create CoA '${name}'`);
  return created.id;
}

async function importCsv(name, route, extraQuery = '') {
  info(`Importing ${name}`);
  const result = await uploadCsv(`${route}?dryRun=false${extraQuery}`, file(name));
  if (result?.ok === false) throw new Error(`${name} import returned ok=false:\n${JSON.stringify(result, null, 2)}`);
  ok(`Imported ${name}`);
  return result;
}

async function importAccounts(coaId, name) {
  info(`Importing ${name} into CoA ${coaId}`);
  const result = await uploadCsv(`/chart-of-accounts/${coaId}/accounts/import?dryRun=false`, file(name));
  if (result?.ok === false) throw new Error(`${name} import returned ok=false:\n${JSON.stringify(result, null, 2)}`);
  ok(`Imported ${name}`);
}

async function assignCompanyCoa(companyName, coaId) {
  const companyId = await companyIdByName(companyName);
  if (!companyId) {
    warn(`Company '${companyName}' not found; skipping CoA assignment`);
    return;
  }
  await apiPatch(`/companies/${companyId}`, { coa_id: coaId });
}

async function setupCoas() {
  const ifrs = await ensureCoa('IFRS Group Chart', 'IFRS-GROUP', 'GLOBAL');
  const fr = await ensureCoa('France PCG', 'FR-PCG', 'COUNTRY', 'FR');
  const nl = await ensureCoa('Netherlands RGS', 'NL-RGS', 'COUNTRY', 'NL');
  const it = await ensureCoa('Italy PDC', 'IT-PDC', 'COUNTRY', 'IT');
  const us = await ensureCoa('US GAAP', 'US-GAAP', 'COUNTRY', 'US');

  await importAccounts(ifrs, '02-accounts-ifrs.csv');
  await importAccounts(fr, '03-accounts-fr.csv');
  await importAccounts(nl, '04-accounts-nl.csv');
  await importAccounts(it, '05-accounts-it.csv');
  await importAccounts(us, '06-accounts-us.csv');

  await assignCompanyCoa('Fromage & Co SA', fr);
  await assignCompanyCoa('Kaasmeester BV', nl);
  await assignCompanyCoa('Formaggio Supremo SRL', it);
  await assignCompanyCoa('Fromage & Co Inc.', us);
  ok('CoA setup complete');
}

// ── Companies / locations ────────────────────────────────────────────────────

async function cleanupBootstrapCompany() {
  // Trial activation seeds a company named after the org; the CSV import
  // brings the real legal entities, so drop the placeholder if both exist.
  const companies = await getAll('/companies?limit=500');
  const csvNames = new Set(readCsv('01-companies.csv').map((row) => row.name));
  const placeholder = companies.find((item) => item.name === options.org && !csvNames.has(item.name));
  if (!placeholder) return;
  try {
    await apiDelete(`/companies/${placeholder.id}`);
    ok(`Removed bootstrap placeholder company '${options.org}'`);
  } catch {
    try {
      await apiPatch(`/companies/${placeholder.id}`, { status: 'disabled' });
      warn(`Could not delete placeholder company '${options.org}'; disabled it instead`);
    } catch {
      warn(`Could not delete or disable placeholder company '${options.org}'`);
    }
  }
}

// Fixture site codes (used by 18-assets.csv and the connection entities) mapped
// to real locations. Location references are server-generated, so lookups are
// by name.
const LOCATIONS = {
  'PAR-DC1': { name: 'Paris Data Center', hosting_type: 'on_prem', company: 'Fromage & Co SA', country_iso: 'FR', city: 'Paris' },
  'GOU-DC1': { name: 'Gouda Server Room', hosting_type: 'on_prem', company: 'Kaasmeester BV', country_iso: 'NL', city: 'Gouda' },
  'PRM-SITE': { name: 'Parma Server Room', hosting_type: 'on_prem', company: 'Formaggio Supremo SRL', country_iso: 'IT', city: 'Parma' },
  'PAR-CAVE': { name: 'Paris Cheese Caves', hosting_type: 'on_prem', company: 'Fromage & Co SA', country_iso: 'FR', city: 'Paris' },
  'NYC-OFF': { name: 'New York Office', hosting_type: 'on_prem', company: 'Fromage & Co Inc.', country_iso: 'US', city: 'New York' },
  'AWS-EU': { name: 'AWS eu-west-1', hosting_type: 'public_cloud', provider: 'aws', country_iso: 'IE', city: 'Dublin', region: 'eu-west-1', additional_info: 'AWS Ireland region' },
};

async function ensureLocations() {
  info('Ensuring locations');
  const locationIdByFixtureCode = new Map();
  for (const [code, def] of Object.entries(LOCATIONS)) {
    const { company, ...fields } = def;
    const body = { ...fields, operating_company_id: company ? await companyIdByName(company) : undefined };
    let id = await locationIdByName(def.name);
    if (id) {
      await apiPatch(`/locations/${id}`, body);
    } else {
      const created = await apiPost('/locations', body);
      id = created?.id ?? (await locationIdByName(def.name));
      ok(`Created location ${def.name}`);
    }
    locationIdByFixtureCode.set(code, id);
  }
  return locationIdByFixtureCode;
}

// Assets are created through POST /assets (the CSV import resolves locations by
// their server-generated reference, which a fixture cannot know upfront).
async function ensureAssets(locationIdByFixtureCode) {
  info('Ensuring assets');
  const settings = await apiGet('/it-ops/settings');
  const codeByLabel = (list) => {
    const map = new Map();
    for (const item of list ?? []) {
      map.set(lower(item.code), item.code);
      map.set(lower(item.label), item.code);
    }
    return map;
  };
  const kindCodes = codeByLabel(settings.serverKinds);
  const osCodes = codeByLabel(settings.operatingSystems);
  const locations = await getAll('/locations?limit=500');
  const locationById = new Map(locations.map((item) => [item.id, item]));
  const existing = new Set((await getAll('/assets?limit=1000')).map((item) => item.name));
  // CSV hostnames are FQDNs; the API wants a bare hostname + a domain code.
  const domainBySuffix = new Map((settings.domains ?? []).filter((d) => d.dns_suffix).map((d) => [lower(d.dns_suffix), d.code]));
  const splitFqdn = (value) => {
    if (!value || !value.includes('.')) return { hostname: value || null, domain: null };
    const [hostname, ...rest] = value.split('.');
    const domain = domainBySuffix.get(lower(rest.join('.')));
    if (!domain) warn(`No DNS domain matches '${rest.join('.')}'; keeping bare hostname '${hostname}'`);
    return { hostname, domain: domain ?? null };
  };

  for (const row of readCsv('18-assets.csv')) {
    if (existing.has(row.name)) continue;
    const locationId = locationIdByFixtureCode.get(row.location_code);
    if (!locationId) {
      warn(`Unknown location code '${row.location_code}' for asset '${row.name}'`);
      continue;
    }
    const location = locationById.get(locationId);
    const kind = kindCodes.get(lower(row.kind));
    if (!kind) {
      warn(`Unknown asset kind '${row.kind}' for '${row.name}'`);
      continue;
    }
    const operating_system = row.operating_system ? osCodes.get(lower(row.operating_system)) ?? null : null;
    if (row.operating_system && !operating_system) warn(`Unknown OS '${row.operating_system}' for '${row.name}'`);
    await apiPost('/assets', {
      name: row.name,
      kind,
      environment: row.environment,
      provider: location?.hosting_type === 'public_cloud' ? (location?.provider || 'other') : 'on_prem',
      location_id: locationId,
      is_cluster: boolValue(row.is_cluster),
      status: lower(row.status) || 'active',
      go_live_date: row.go_live_date || null,
      end_of_life_date: row.end_of_life_date || null,
      ...splitFqdn(row.hostname),
      operating_system,
      notes: row.notes || null,
    });
  }
  ok('Assets ensured');
}

// Hardware info on a few physical assets. The Netbox test inventory
// (fixtures/fromage-co/netbox) relies on these serials: GOU-NAS-01 carries the
// serial of the Netbox device GOU-SYNO-01, so the sync matches by serial and
// renames the asset. PAR-SAN-02 carries the serial Netbox already has, so
// nothing changes. PRM-ESX-01 carries a stale serial and model that Netbox
// overwrites.
const ASSET_HARDWARE = [
  { name: 'GOU-NAS-01', serial_number: 'SYN-GOU-NAS01', manufacturer: 'Synology', model: 'RS1221+' },
  { name: 'PAR-SAN-02', serial_number: 'NTAP-PAR-SAN02', manufacturer: 'NetApp', model: 'FAS2720' },
  { name: 'PRM-ESX-01', serial_number: 'OLD-PRM-ESX01', manufacturer: 'Dell', model: 'PowerEdge R640' },
];

async function ensureAssetHardwareInfo() {
  info('Ensuring asset hardware info');
  for (const { name, ...fields } of ASSET_HARDWARE) {
    const assetId = await assetIdByName(name);
    if (!assetId) {
      warn(`Asset '${name}' not found while setting hardware info`);
      continue;
    }
    const current = await apiGet(`/assets/${assetId}/hardware-info`);
    const unchanged = current && Object.entries(fields).every(([key, value]) => normalizeValue(current[key]) === value);
    if (unchanged) continue;
    await apiPost(`/assets/${assetId}/hardware-info`, fields);
    ok(`Hardware info set on ${name}`);
  }
}

// Two assets share the name NYC-SW-01 on purpose. The Netbox device of the same
// name then has two candidates at the same deduplication level, which the sync
// must report as ambiguous instead of merging.
async function ensureDuplicateAssetName() {
  info('Ensuring the duplicate asset name used by the Netbox ambiguity case');
  const duplicates = (await getAll('/assets?limit=1000')).filter((item) => normalizeValue(item.name) === 'NYC-SW-01');
  if (duplicates.length >= 2) return;
  if (duplicates.length === 0) {
    warn("Asset 'NYC-SW-01' not found; skipping the duplicate");
    return;
  }
  const template = await apiGet(`/assets/${duplicates[0].id}`);
  await apiPost('/assets', {
    name: 'NYC-SW-01',
    kind: template.kind,
    environment: template.environment,
    provider: template.provider,
    location_id: template.location_id,
    status: 'active',
    operating_system: template.operating_system ?? null,
    notes: 'Duplicate name kept on purpose for the Netbox sync ambiguity case',
  });
  ok('Created the second asset named NYC-SW-01');
}

// Two assets the Netbox inventory knows under another name. The first one
// shares its IP address with the Netbox device, the second shares nothing and
// can only be tied by hand in the preview.
async function ensureRenamedAssets() {
  info('Ensuring the renamed assets used by the Netbox address and manual link cases');
  const assets = await getAll('/assets?limit=1000');
  const template = assets.find((item) => normalizeValue(item.name) === 'PAR-ESX-01');
  if (!template) {
    warn("Asset 'PAR-ESX-01' not found; skipping the renamed assets");
    return;
  }
  const wanted = [
    { name: 'SRV-COMPTA-OLD', ip_addresses: [{ type: 'host', ip: '10.10.10.95', subnet_cidr: null }], notes: 'Netbox knows it as PAR-APP-09; only the IP address ties them' },
    { name: 'SRV-PAIE-OLD', ip_addresses: null, notes: 'Netbox knows it as PAR-APP-10; nothing ties them, link it by hand in the preview' },
  ];
  for (const entry of wanted) {
    if (assets.some((item) => normalizeValue(item.name) === entry.name)) continue;
    await apiPost('/assets', {
      ...entry,
      kind: template.kind,
      environment: template.environment,
      provider: template.provider,
      location_id: template.location_id,
      status: 'active',
    });
    ok(`Created asset ${entry.name}`);
  }
}

// ── Demo users ───────────────────────────────────────────────────────────────
// Created via POST /users (not the CSV import) because that is the only
// endpoint that accepts an initial password — the demo needs known logins.

async function ensureDemoUsers() {
  info('Ensuring demo users');
  const existing = await getAll('/users?limit=1000');
  const byEmail = new Map(existing.map((user) => [lower(user.email), user]));
  const companies = await getAll('/companies?limit=500');
  const departments = await getAll('/departments?limit=1000');
  const companyId = (name) => firstBy(companies, (item) => item.name === name);

  for (const row of readCsv('10-users.csv')) {
    const found = byEmail.get(lower(row.email));
    if (found) {
      if (options.demoPassword) warn(`User '${row.email}' already exists — password left unchanged (re-runs cannot set passwords)`);
      continue;
    }
    const cid = companyId(row.company_name);
    const did = firstBy(departments, (item) => item.name === row.department_name && item.company_id === cid);
    await apiPost('/users', {
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      role_name: row.role,
      company_id: cid || null,
      department_id: did || null,
      status: row.status || 'enabled',
      ...(options.demoPassword ? { password: options.demoPassword } : {}),
    });
    ok(`Created user ${row.email}`);
  }
}

// ── App instances / interfaces ───────────────────────────────────────────────

async function ensureAppInstances() {
  info('Ensuring app instances');
  for (const row of readCsv('20-app-instances.csv')) {
    const appId = await appIdByName(row.application_name);
    if (!appId) {
      warn(`Skipping app instance for missing app '${row.application_name}'`);
      continue;
    }
    const existing = items(await apiGet(`/applications/${appId}/instances`))
      .find((instance) => instance.environment === row.environment);
    const body = {
      environment: row.environment,
      lifecycle: lower(row.lifecycle) || 'active',
      region: row.region || null,
      zone: row.zone || null,
      base_url: row.base_url || null,
      sso_enabled: boolValue(row.sso_enabled),
      mfa_supported: boolValue(row.mfa_supported),
      notes: row.notes || null,
    };
    if (existing) await apiPatch(`/app-instances/${existing.id}`, body);
    else await apiPost(`/applications/${appId}/instances`, body);
  }
  ok('App instances ensured');
}

async function ensureMiddlewareEtlEnabled() {
  const names = new Set();
  for (const row of readCsv('21-interfaces.csv')) {
    if (lower(row.integration_route_type) === 'via_middleware') {
      for (const name of splitList(row.middleware_application_names)) names.add(name);
    }
  }
  for (const name of names) {
    const id = await appIdByName(name);
    if (!id) warn(`Middleware app '${name}' not found; cannot set etl_enabled`);
    else await apiPatch(`/applications/${id}`, { etl_enabled: true });
  }
}

async function ensureInterfaces() {
  info('Ensuring interfaces');
  for (const row of readCsv('21-interfaces.csv')) {
    const sourceId = await appIdByName(row.source_application_name);
    const targetId = await appIdByName(row.target_application_name);
    if (!sourceId || !targetId) {
      warn(`Skipping interface '${row.interface_id}' because source or target app is missing`);
      continue;
    }
    const body = {
      interface_id: row.interface_id,
      name: row.name,
      business_purpose: row.business_purpose,
      source_application_id: sourceId,
      target_application_id: targetId,
      data_category: lower(row.data_category),
      integration_route_type: lower(row.integration_route_type),
      data_class: lower(row.data_class),
      contains_pii: boolValue(row.contains_pii),
      lifecycle: lower(row.lifecycle),
      middleware_application_ids: await appIdsFromNames(splitList(row.middleware_application_names)),
    };
    const existingId = await interfaceIdByCode(row.interface_id);
    if (existingId) await apiPatch(`/interfaces/${existingId}`, body);
    else await apiPost('/interfaces', body);
  }
  ok('Interfaces ensured');
}

// ── Connections (current model: entity endpoints + intermediary hops) ────────

async function ensureConnections() {
  info('Ensuring connections');
  const refToId = new Map();
  for (const row of readCsv('23-connections.csv')) {
    const body = {
      name: row.name,
      description: row.description || null,
      topology: lower(row.topology) || 'server_to_server',
      source_entity_code: lower(row.source_entity_code),
      destination_entity_code: lower(row.destination_entity_code),
      protocol_codes: splitList(row.protocol_codes).map(lower),
      lifecycle: lower(row.lifecycle) || 'active',
      criticality: lower(row.criticality) || 'medium',
      data_class: lower(row.data_class) || 'internal',
      contains_pii: boolValue(row.contains_pii),
    };
    const existingId = await connectionIdByName(row.name);
    if (existingId) {
      await apiPatch(`/connections/${existingId}`, body);
      refToId.set(row.ref, existingId);
    } else {
      const created = await apiPost('/connections', body);
      if (!created?.id) throw new Error(`Connection '${row.name}' creation returned no id`);
      refToId.set(row.ref, created.id);
    }
  }
  ok('Connections ensured');
  return refToId;
}

async function ensureConnectionLegs(refToId) {
  info('Ensuring connection legs (intermediary hops)');
  for (const row of readCsv('24-connection-legs.csv')) {
    const connectionId = refToId.get(row.connection_ref);
    if (!connectionId) {
      warn(`Skipping leg for unknown connection ref '${row.connection_ref}'`);
      continue;
    }
    const equipmentAssetId = row.equipment_asset_name ? await assetIdByName(row.equipment_asset_name) : '';
    if (row.equipment_asset_name && !equipmentAssetId) {
      warn(`Asset '${row.equipment_asset_name}' not found for leg on '${row.connection_ref}'`);
    }
    const body = {
      order_index: Number(row.order_index || 1),
      function_code: lower(row.function_code) || null,
      equipment_asset_id: equipmentAssetId || null,
      protocol_codes: splitList(row.protocol_codes).map(lower),
      port_override: row.port_override || null,
      notes: row.notes || null,
    };
    const legs = items(await apiGet(`/connections/${connectionId}/legs`));
    const existing = legs.find((leg) => Number(leg.order_index) === body.order_index);
    if (existing) await apiPatch(`/connections/${connectionId}/legs/${existing.id}`, body);
    else await apiPost(`/connections/${connectionId}/legs`, body);
  }
  ok('Connection legs ensured');
}

async function instanceIdByAppEnv(appName, environment) {
  const appId = await appIdByName(appName);
  if (!appId) return '';
  return firstBy(items(await apiGet(`/applications/${appId}/instances`)), (item) => item.environment === environment);
}

async function ensureInterfaceBindings() {
  info('Ensuring interface bindings');
  for (const row of readCsv('22-interface-bindings.csv')) {
    const interfaceId = await interfaceIdByCode(row.interface_id);
    if (!interfaceId) {
      warn(`Skipping binding for missing interface '${row.interface_id}'`);
      continue;
    }
    const sourceInstanceId = await instanceIdByAppEnv(row.source_application_name, row.environment);
    const targetInstanceId = await instanceIdByAppEnv(row.target_application_name, row.environment);
    if (!sourceInstanceId || !targetInstanceId) {
      warn(`Skipping binding for missing instance '${row.source_application_name}' -> '${row.target_application_name}'/${row.environment}`);
      continue;
    }
    const legs = items(await apiGet(`/interfaces/${interfaceId}/legs`));
    const leg = legs.find((item) => Number(item.order_index ?? 1) === Number(row.leg_order || 1));
    if (!leg) {
      warn(`Skipping binding for '${row.interface_id}' because leg ${row.leg_order || 1} is missing`);
      continue;
    }
    const bindings = items(await apiGet(`/interfaces/${interfaceId}/bindings`));
    const existing = bindings.find((item) => item.interface_leg_id === leg.id && item.environment === row.environment);
    const integrationToolId = row.integration_tool_application_name
      ? await appIdByName(row.integration_tool_application_name)
      : '';
    const body = {
      interface_leg_id: leg?.id ?? null,
      source_instance_id: sourceInstanceId,
      target_instance_id: targetInstanceId,
      source_endpoint: row.source_endpoint || null,
      target_endpoint: row.target_endpoint || null,
      trigger_details: row.trigger_details || null,
      env_job_name: row.env_job_name || null,
      authentication_mode: lower(row.authentication_mode) || null,
      monitoring_url: row.monitoring_url || null,
      env_notes: row.env_notes || null,
      status: lower(row.status) || 'active',
      integration_tool_application_id: integrationToolId || null,
    };
    if (existing) await apiPatch(`/interface-bindings/${existing.id}`, body);
    else await apiPost(`/interfaces/${interfaceId}/bindings`, body);
  }
  ok('Interface bindings ensured');
}

async function ensureInterfaceConnectionLinks(refToId) {
  info('Ensuring interface connection links');
  for (const row of readCsv('25-interface-connection-links.csv')) {
    const interfaceId = await interfaceIdByCode(row.interface_id);
    const connectionId = refToId.get(row.connection_ref);
    if (!interfaceId || !connectionId) {
      warn(`Skipping interface/connection link '${row.interface_id}' -> '${row.connection_ref}'`);
      continue;
    }
    const bindings = items(await apiGet(`/interfaces/${interfaceId}/bindings`));
    const legs = items(await apiGet(`/interfaces/${interfaceId}/legs`));
    const leg = legs.find((item) => Number(item.order_index ?? 1) === Number(row.leg_order || 1));
    const binding = bindings.find((item) => item.environment === row.environment && item.interface_leg_id === leg?.id);
    if (!binding) {
      warn(`Skipping connection link for '${row.interface_id}' (${row.environment}); binding missing`);
      continue;
    }
    await apiPost(`/interface-bindings/${binding.id}/connection-links`, {
      connection_id: connectionId,
      notes: row.notes || null,
    });
  }
  ok('Interface connection links ensured');
}

// ── Business links ───────────────────────────────────────────────────────────

const SUITE_MEMBERS = {
  'Microsoft 365': ['Exchange Online', 'Microsoft Teams', 'SharePoint Online', 'OneDrive for Business'],
};

async function linkSuites() {
  info('Linking suite members');
  for (const [suiteName, componentNames] of Object.entries(SUITE_MEMBERS)) {
    const suiteId = await appIdByName(suiteName);
    if (!suiteId) {
      warn(`Suite '${suiteName}' not found`);
      continue;
    }
    for (const componentName of componentNames) {
      const componentId = await appIdByName(componentName);
      if (componentId) await apiPost(`/applications/${componentId}/suites/bulk-replace`, { suite_ids: [suiteId] });
      else warn(`Suite member '${componentName}' not found`);
    }
  }
  ok('Suites linked');
}

// company::department pairs per application
const APP_DEPARTMENTS = {
  'Microsoft 365': [
    'Fromage & Co SA::Direction Générale', 'Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::IT & Digital',
    'Fromage & Co SA::Human Resources', 'Fromage & Co SA::Sales & Marketing', 'Fromage & Co SA::Production',
    'Fromage & Co SA::Procurement', 'Fromage & Co SA::Logistics', 'Fromage & Co SA::Quality & R&D',
    'Kaasmeester BV::Management', 'Kaasmeester BV::Finance', 'Kaasmeester BV::IT', 'Kaasmeester BV::Sales', 'Kaasmeester BV::Operations',
    'Formaggio Supremo SRL::Direzione', 'Formaggio Supremo SRL::Amministrazione', 'Formaggio Supremo SRL::IT',
    'Formaggio Supremo SRL::Commerciale', 'Formaggio Supremo SRL::Produzione',
    'Fromage & Co Inc.::Management', 'Fromage & Co Inc.::Finance', 'Fromage & Co Inc.::IT', 'Fromage & Co Inc.::Sales', 'Fromage & Co Inc.::Operations',
  ],
  'SAP S/4HANA': ['Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::Production', 'Fromage & Co SA::Procurement', 'Fromage & Co SA::Logistics'],
  'SAP BW/4HANA': ['Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::Direction Générale'],
  'Salesforce Sales Cloud': ['Fromage & Co SA::Sales & Marketing', 'Kaasmeester BV::Sales', 'Formaggio Supremo SRL::Commerciale', 'Fromage & Co Inc.::Sales'],
  'Salesforce Service Cloud': ['Fromage & Co SA::Sales & Marketing'],
  'Workday HCM': ['Fromage & Co SA::Human Resources'],
  'ServiceNow ITSM': ['Fromage & Co SA::IT & Digital'],
  'Okta Workforce Identity': ['Fromage & Co SA::IT & Digital'],
  'QuickBooks Online': ['Fromage & Co Inc.::Finance'],
  'Sage X3': ['Kaasmeester BV::Finance', 'Formaggio Supremo SRL::Amministrazione'],
  'CheeseTrack': ['Fromage & Co SA::Production', 'Fromage & Co SA::Quality & R&D', 'Formaggio Supremo SRL::Produzione'],
  'CaveGuard IoT': ['Fromage & Co SA::Production'],
  'Power BI': ['Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::Direction Générale', 'Fromage & Co SA::Sales & Marketing'],
  'La Boutique du Fromage': ['Fromage & Co SA::Sales & Marketing', 'Fromage & Co SA::IT & Digital'],
  'Fromage B2B Portal': ['Fromage & Co SA::Sales & Marketing', 'Fromage & Co SA::Logistics'],
};

async function linkApplicationDepartments() {
  info('Linking applications to departments');
  const departments = await getAll('/departments?limit=1000');
  const companies = await getAll('/companies?limit=500');
  const companyId = (name) => firstBy(companies, (item) => item.name === name);
  for (const [appName, pairs] of Object.entries(APP_DEPARTMENTS)) {
    const appId = await appIdByName(appName);
    if (!appId) {
      warn(`Application '${appName}' not found; skipping department links`);
      continue;
    }
    const ids = [];
    for (const pair of pairs) {
      const [companyName, departmentName] = pair.split('::');
      const cid = companyId(companyName);
      const id = firstBy(departments, (item) => item.name === departmentName && item.company_id === cid);
      if (id) ids.push(id);
      else warn(`Department '${pair}' not found for '${appName}'`);
    }
    if (ids.length) await apiPost(`/applications/${appId}/departments/bulk-replace`, { department_ids: [...new Set(ids)] });
  }
  ok('Application departments linked');
}

// Contracts link to their spend lines (the contract↔application relation no longer exists).
const CONTRACT_SPEND_ITEMS = {
  'Microsoft Enterprise Agreement': ['Microsoft Enterprise (M365 + Azure + GitHub)'],
  'SAP Maintenance & Support': ['SAP S/4HANA Maintenance', 'SAP BW/4HANA License'],
  'Salesforce Subscription': ['Salesforce (Sales + Service Cloud)'],
  'ServiceNow Platform': ['ServiceNow ITSM Platform'],
  'Workday HCM': ['Workday HCM'],
  'OVHcloud Infrastructure': ['OVHcloud Infrastructure'],
  'Okta Workforce Identity': ['Okta Workforce Identity'],
  'Sophos Enterprise Agreement': ['Sophos Enterprise Security'],
  'Broadcom VMware ELA': ['VMware vSphere Licensing'],
  'Schneider IoT Services': ['CaveGuard IoT Platform'],
  'Sage X3 Subscription': ['Sage X3 Licenties — Kaasmeester', 'Sage X3 Licenze — Formaggio Supremo'],
  'CheeseTrack SaaS': ['CheeseTrack SaaS'],
  'Fortinet FortiCare': ['Fortinet FortiCare & FortiGuard'],
  'Axians Infogérance': ['Managed Services — Axians Infogérance'],
  'US Managed IT Services': ['US Managed IT Services', 'US Office IT Services'],
};

async function linkContractsToSpend() {
  info('Linking contracts to spend items');
  for (const [contractName, spendNames] of Object.entries(CONTRACT_SPEND_ITEMS)) {
    const contractId = await contractIdByName(contractName);
    if (!contractId) {
      warn(`Contract '${contractName}' not found`);
      continue;
    }
    const ids = [];
    for (const name of spendNames) {
      const id = await spendIdByName(name);
      if (id) ids.push(id);
      else warn(`Spend item '${name}' not found for contract '${contractName}'`);
    }
    if (ids.length) await apiPost(`/contracts/${contractId}/spend-items/bulk-replace`, { spend_item_ids: ids });
  }
  ok('Contracts linked to spend items');
}

const SPEND_APPLICATIONS = {
  'Microsoft Enterprise (M365 + Azure + GitHub)': ['Microsoft 365', 'GitHub Enterprise'],
  'SAP S/4HANA Maintenance': ['SAP S/4HANA'],
  'SAP BW/4HANA License': ['SAP BW/4HANA'],
  'Salesforce (Sales + Service Cloud)': ['Salesforce Sales Cloud', 'Salesforce Service Cloud'],
  'ServiceNow ITSM Platform': ['ServiceNow ITSM'],
  'Workday HCM': ['Workday HCM'],
  'OVHcloud Infrastructure': ['VMware vSphere'],
  'AWS Cloud Hosting': ['La Boutique du Fromage'],
  'Datadog Monitoring': ['Datadog'],
  'Okta Workforce Identity': ['Okta Workforce Identity'],
  'Sophos Enterprise Security': ['Sophos Intercept X'],
  'VMware vSphere Licensing': ['VMware vSphere'],
  'CaveGuard IoT Platform': ['CaveGuard IoT'],
  'CheeseTrack SaaS': ['CheeseTrack'],
  'Various SaaS Bundle': ['HubSpot Marketing Hub', 'Zoom Workplace', 'Figma', 'Coupa Procurement', 'PagerDuty', 'Adobe Acrobat Pro'],
  'Fortinet FortiCare & FortiGuard': ['Fortinet FortiGate'],
};

async function linkSpendToApps() {
  info('Linking spend items to applications');
  for (const [spendName, appNames] of Object.entries(SPEND_APPLICATIONS)) {
    const spendId = await spendIdByName(spendName);
    if (!spendId) {
      warn(`Spend item '${spendName}' not found`);
      continue;
    }
    const appIds = await appIdsFromNames(appNames);
    if (appIds.length) await apiPost(`/spend-items/${spendId}/applications/bulk-replace`, { application_ids: appIds });
  }
  ok('Spend items linked to applications');
}

// ── Portfolio teams, timeline, allocations ───────────────────────────────────

async function ensurePortfolioTeamsAndCapacity() {
  info('Ensuring portfolio teams and capacity');
  for (const name of ['Business Applications', 'Development', 'Infrastructure']) {
    const existingId = await portfolioTeamIdByName(name);
    const body = { name, description: `${name} delivery team`, is_active: true };
    if (existingId) await apiPatch(`/portfolio/teams/${existingId}`, body);
    else await apiPost('/portfolio/teams', body);
  }
  const teamByEmail = [
    ['sophie.laurent@fromage-co.com', 'Business Applications'],
    ['marc.petit@fromage-co.com', 'Development'],
    ['pierre.martin@fromage-co.com', 'Infrastructure'],
    ['lucas.bernard@fromage-co.com', 'Infrastructure'],
    ['clara.dupont@fromage-co.com', 'Business Applications'],
  ];
  for (const [email, team] of teamByEmail) {
    const userId = await userIdByEmail(email);
    const teamId = await portfolioTeamIdByName(team);
    if (userId && teamId) {
      await apiPost(`/portfolio/team-members/by-user/${userId}`, {
        team_id: teamId,
        project_availability: 10,
      });
    }
  }
  ok('Portfolio teams and capacity ensured');
}

const PROJECT_PHASES = {
  'Fromage-as-a-Service': [
    ['Discovery & UX Design', '2025-06-01', '2025-09-30', 'completed'],
    ['MVP Development', '2025-09-01', '2026-03-31', 'in_progress'],
    ['Beta Testing', '2026-03-01', '2026-06-30', 'pending'],
    ['Launch & Scale', '2026-06-01', '2026-09-30', 'pending'],
  ],
  'Zero Trust Fromage': [
    ['Assessment & Architecture', '2025-04-01', '2025-08-31', 'completed'],
    ['Network Segmentation', '2025-09-01', '2026-02-28', 'in_progress'],
    ['Identity Hardening', '2026-02-01', '2026-05-31', 'pending'],
    ['Validation & Audit', '2026-05-01', '2026-06-30', 'pending'],
  ],
  'Workday Global Rollout': [
    ['France Go-Live', '2025-04-01', '2025-07-31', 'completed'],
    ['Netherlands Rollout', '2025-09-01', '2026-03-31', 'in_progress'],
    ['Italy Rollout', '2026-03-01', '2026-08-31', 'pending'],
    ['US Rollout', '2026-08-01', '2026-12-31', 'pending'],
  ],
};

async function ensureProjectPhases() {
  info('Ensuring project phases');
  for (const [projectName, phases] of Object.entries(PROJECT_PHASES)) {
    const projectId = await projectIdByName(projectName);
    if (!projectId) {
      warn(`Project '${projectName}' not found; skipping phases`);
      continue;
    }
    const existing = items(await apiGet(`/portfolio/projects/${projectId}/phases`));
    for (const [name, planned_start, planned_end, status] of phases) {
      const phase = existing.find((item) => item.name === name);
      if (phase) {
        await apiPatch(`/portfolio/projects/${projectId}/phases/${phase.id}`, { name, planned_start, planned_end, status });
      } else {
        const created = await apiPost(`/portfolio/projects/${projectId}/phases`, { name, planned_start, planned_end });
        await apiPatch(`/portfolio/projects/${projectId}/phases/${created.id}`, { status });
      }
    }
    ok(`Phases ensured for '${projectName}'`);
  }
}

const IT_TEAM_EMAILS = new Set([
  'sophie.laurent@fromage-co.com', 'lucas.bernard@fromage-co.com', 'pierre.martin@fromage-co.com',
  'thomas.berger@fromage-co.com', 'amelie.rousseau@fromage-co.com', 'clara.dupont@fromage-co.com',
  'jan.bakker@kaasmeester.nl', 'luca.ferrari@formaggio-supremo.it', 'hugo.mercier@fromage-co.com',
]);

const PROJECT_TEAMS = {
  'Fromage-as-a-Service': ['amelie.rousseau@fromage-co.com', 'clara.dupont@fromage-co.com', 'isabelle.moreau@fromage-co.com', 'hugo.mercier@fromage-co.com'],
  'Zero Trust Fromage': ['lucas.bernard@fromage-co.com', 'pierre.martin@fromage-co.com', 'thomas.berger@fromage-co.com'],
  'Workday Global Rollout': ['sophie.laurent@fromage-co.com', 'jan.bakker@kaasmeester.nl', 'luca.ferrari@formaggio-supremo.it', 'marie.fontaine@fromage-co.com'],
  'Territory Planning Cockpit': ['isabelle.moreau@fromage-co.com', 'marie.fontaine@fromage-co.com'],
  'Supplier Contract Workspace': ['marie.fontaine@fromage-co.com', 'isabelle.moreau@fromage-co.com'],
  'Pricing Rules API Refactor': ['amelie.rousseau@fromage-co.com', 'clara.dupont@fromage-co.com', 'hugo.mercier@fromage-co.com'],
  'Customer 360 Data Contracts': ['clara.dupont@fromage-co.com', 'jan.bakker@kaasmeester.nl', 'luca.ferrari@formaggio-supremo.it'],
  'Branch Network Segmentation': ['lucas.bernard@fromage-co.com', 'pierre.martin@fromage-co.com', 'thomas.berger@fromage-co.com'],
  'Endpoint Compliance Automation': ['sophie.laurent@fromage-co.com', 'pierre.martin@fromage-co.com', 'lucas.bernard@fromage-co.com'],
};

async function ensureProjectTeams() {
  info('Ensuring project team members');
  for (const [projectName, emails] of Object.entries(PROJECT_TEAMS)) {
    const projectId = await projectIdByName(projectName);
    if (!projectId) {
      warn(`Project '${projectName}' not found; skipping teams`);
      continue;
    }
    const itIds = [];
    const bizIds = [];
    for (const email of emails) {
      const userId = await userIdByEmail(email);
      if (!userId) {
        warn(`User '${email}' not found for project '${projectName}'`);
        continue;
      }
      (IT_TEAM_EMAILS.has(email) ? itIds : bizIds).push(userId);
    }
    if (itIds.length) await apiPost(`/portfolio/projects/${projectId}/it-team/bulk-replace`, { user_ids: [...new Set(itIds)] });
    if (bizIds.length) await apiPost(`/portfolio/projects/${projectId}/business-team/bulk-replace`, { user_ids: [...new Set(bizIds)] });
  }
  ok('Project teams ensured');
}

const COMPANY_ALLOCATIONS = [
  ['spend', 'Microsoft Enterprise (M365 + Azure + GitHub)', ['Fromage & Co SA', 'Kaasmeester BV', 'Formaggio Supremo SRL', 'Fromage & Co Inc.']],
  ['spend', 'Okta Workforce Identity', ['Fromage & Co SA', 'Kaasmeester BV', 'Formaggio Supremo SRL', 'Fromage & Co Inc.']],
  ['spend', 'Sophos Enterprise Security', ['Fromage & Co SA', 'Kaasmeester BV', 'Formaggio Supremo SRL', 'Fromage & Co Inc.']],
  ['spend', 'Network & Telecom Services', ['Fromage & Co SA', 'Kaasmeester BV', 'Formaggio Supremo SRL', 'Fromage & Co Inc.']],
  ['capex', 'SAP Cheddar Migration — S/4HANA upgrade', ['Fromage & Co SA', 'Kaasmeester BV', 'Formaggio Supremo SRL']],
];

async function ensureCompanyAllocations() {
  info('Applying company allocations to spend/CAPEX versions');
  for (const [kind, name, companyNames] of COMPANY_ALLOCATIONS) {
    const itemId = kind === 'spend' ? await spendIdByName(name) : await capexIdByDescription(name);
    if (!itemId) {
      warn(`Allocation target not found: [${kind}] ${name}`);
      continue;
    }
    const companyIds = [];
    for (const companyName of companyNames) {
      const id = await companyIdByName(companyName);
      if (id) companyIds.push(id);
      else warn(`Company '${companyName}' not found for [${kind}] ${name}`);
    }
    if (!companyIds.length) continue;

    const itemBase = kind === 'spend' ? '/spend-items' : '/capex-items';
    const versionBase = kind === 'spend' ? '/spend-versions' : '/capex-versions';
    const versions = items(await apiGet(`${itemBase}/${itemId}/versions`));
    if (!versions.length) {
      warn(`No versions found for [${kind}] ${name}`);
      continue;
    }
    for (const version of versions) {
      try {
        await apiPatch(`${itemBase}/${itemId}/versions`, {
          id: version.id,
          allocation_method: 'manual_company',
          allocation_driver: 'headcount',
        });
        await apiPost(`${versionBase}/${version.id}/allocations/bulk-upsert`, {
          items: companyIds.map((company_id) => ({ company_id, department_id: null })),
        });
      } catch (error) {
        warn(`Allocation failed for [${kind}] ${name} version ${version.id}: ${error.message.split('\n')[0]}`);
      }
    }
    ok(`Allocations applied for [${kind}] ${name}`);
  }
}

// ── Service Desk Docs knowledge library ──────────────────────────────────────

const SERVICE_DESK_LIBRARY = 'Service Desk Docs';
const SERVICE_DESK_DOCS = [
  { title: 'VPN & Remote Access Guide', file: 'docs/vpn-remote-access.md', summary: 'FortiClient VPN setup, Okta MFA, and the classic "credentials rejected" fix.' },
  { title: 'SAP Access Request Process', file: 'docs/sap-access-request.md', summary: 'SAP role matrix, approvers, SLAs and the expedited month-end close path.' },
  { title: 'CaveGuard Alert Runbook — Cheese Cave Sensors', file: 'docs/caveguard-alert-runbook.md', summary: 'Alert severities, humidity profiles per cheese family, and when to call the on-call affineur.' },
  { title: 'Guest Wi-Fi & Visitor Access', file: 'docs/guest-wifi-visitors.md', summary: 'FromageGuest Wi-Fi codes, visitor badges, and how to book a cave visit.' },
  { title: 'Label Printer Troubleshooting (Zebra)', file: 'docs/label-printer-troubleshooting.md', summary: 'Curled labels, humidity, calibration, and when to call Axians.' },
];

async function ensureServiceDeskDocs() {
  info('Ensuring Service Desk Docs knowledge library');
  const libraries = items(await apiGet('/knowledge-libraries'));
  let library = libraries.find((item) => item.name === SERVICE_DESK_LIBRARY);
  if (!library) {
    const created = await apiPost('/knowledge-libraries', { name: SERVICE_DESK_LIBRARY });
    library = created?.library ?? created;
    ok(`Created knowledge library '${SERVICE_DESK_LIBRARY}'`);
  }
  const existing = items(await apiGet('/knowledge?limit=500'));
  for (const doc of SERVICE_DESK_DOCS) {
    if (existing.some((item) => item.title === doc.title)) continue;
    await apiPost('/knowledge', {
      title: doc.title,
      library_id: library.id,
      summary: doc.summary,
      content_markdown: readFileSync(file(doc.file), 'utf8'),
      status: 'published',
    });
    ok(`Published '${doc.title}'`);
  }
}

// ── Demo AI agent (mock ticketing provider) ──────────────────────────────────

const AGENT_NAME = 'Fromage Service Desk Agent';
const SHARED_CONTEXT_NAME = 'Fromage & Co Company Context';

async function ensureDemoAgent() {
  info('Ensuring demo AI agent');
  const cp = '/ai/admin/control-plane';

  let profiles = [];
  try {
    profiles = items(await apiGet(`${cp}/shared-context-profiles`));
  } catch (error) {
    warn(`AI control plane unavailable (${error.message.split('\n')[0]}); skipping agent setup`);
    return;
  }

  let profile = profiles.find((item) => item.name === SHARED_CONTEXT_NAME);
  if (!profile) {
    const created = await apiPost(`${cp}/shared-context-profiles`, {
      name: SHARED_CONTEXT_NAME,
      description: 'Shared facts about Fromage & Co for all agents',
      lines: [
        'Fromage & Co is a European cheese group: Fromage & Co SA (France, HQ), Kaasmeester BV (Netherlands), Formaggio Supremo SRL (Italy), Fromage & Co Inc. (US).',
        'Core systems: SAP S/4HANA (ERP, production), Salesforce (CRM), Microsoft 365 (collaboration), Workday HCM (HR), ServiceNow (ITSM).',
        'The Paris Data Center (PAR-DC1) hosts SAP production; site firewalls are FortiGate appliances.',
        'Business hours are 08:00-18:00 CET; the production sites in Paris and Parma run until 22:00.',
        'IT service desk language is English; requesters may write in French, Dutch or Italian.',
      ],
    });
    profile = created?.profile ?? created;
    ok(`Created shared context profile '${SHARED_CONTEXT_NAME}'`);
  }

  const agentBody = {
    name: AGENT_NAME,
    agent_type: 'helpdesk',
    description: 'Demo helpdesk triage agent bound to the built-in mock ticketing provider.',
    provider_bindings_json: { ticketing: { provider_kind: 'ticketing', provider_key: 'mock' } },
    // Scope follows the template shape: manual safe targets stay allowed (a
    // hard requirement of the triage runtime) and the bounded new-tickets
    // watcher is enabled for the fromage mock helpdesk entity.
    scope_policy_json: {
      mode: 'manual_safe_target',
      allowed_modes: ['manual_safe_target', 'new_tickets_only'],
      provider_kind: 'ticketing',
      provider_key: 'mock',
      target_kind: 'ticket',
      required_safe_target_effect: 'read',
      new_tickets_only: {
        enabled: true,
        entity_id: 'fromage-helpdesk',
        max_tickets_per_cycle: 5,
        max_provider_requests_per_cycle: 10,
        hard_backfill_horizon_hours: 24 * 30,
      },
      all_matching: { enabled: false },
      freeform_live_object_ids: false,
    },
    trigger_policy_json: {
      manual_safe_target: { enabled: true },
      scheduled_poll: { enabled: true },
      saved_filter: { enabled: false },
      provider_webhook: { enabled: false },
      ticket_update: { enabled: false },
      production_polling_enabled: false,
      automatic_writes_enabled: false,
    },
    persona_json: {
      mission: 'Support the Fromage & Co IT service desk: triage incoming tickets, investigate using the IT landscape, and prepare source-cited replies for technician approval.',
      instructions: [
        'Always cite the evidence used for a conclusion.',
        'Prefer an internal note when evidence is incomplete or confidence is low.',
        'Never promise delivery dates; route scheduling questions to the service desk lead.',
      ],
      output_style: { tone: 'Professional, concise and friendly; address requesters by first name.', language: 'en' },
      escalation_guidance: 'Escalate security incidents and anything touching SAP production to Pierre Martin.',
      shared_context: { enabled: true, profile_id: profile.id },
    },
  };

  const agents = items(await apiGet(`${cp}/agents`));
  let agent = agents.find((item) => item.name === AGENT_NAME);
  if (agent) {
    const updated = await apiPost(`${cp}/agents/${agent.id}`, agentBody);
    agent = updated?.agent_definition ?? agent;
    ok(`Updated agent '${AGENT_NAME}'`);
  } else {
    const created = await apiPost(`${cp}/agents`, agentBody);
    agent = created?.agent_definition ?? created;
    ok(`Created agent '${AGENT_NAME}'`);
  }

  if (agent.status !== 'enabled') {
    await apiPost(`${cp}/agents/${agent.id}/status`, { status: 'enabled' });
    ok(`Agent '${AGENT_NAME}' enabled`);
  }

  // Agent triage runs on the tenant AI surface, which is disabled by default.
  await apiPatch('/ai/settings', { chat_enabled: true });

  try {
    await apiPost(`${cp}/helpdesk/ticketing-ingestion/poll`, {});
    ok('Ingestion poll ran — fromage demo tickets should appear in the agent work queue');
  } catch (error) {
    warn(`Ingestion poll failed (${error.message.split('\n')[0]}); trigger it from the agent cockpit instead`);
  }

  try {
    await apiPost(`${cp}/uat/mock-triage`, { provider_key: 'mock', ticket_id: 'FRO-2213' });
    ok('Ran a mock triage — a pending approval is now waiting on the Approvals page');
  } catch (error) {
    warn(`Mock triage failed (${error.message.split('\n')[0]}); the agent is created but has no demo run yet`);
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function runImports() {
  await importCsv('01-companies.csv', '/companies/import', `&year=${options.year}`);
  await cleanupBootstrapCompany();
  await setupCoas();
  await importCsv('07-suppliers.csv', '/suppliers/import');
  await importCsv('08-departments.csv', '/departments/import');
  await importCsv('09-contacts.csv', '/contacts/import');
  await ensureDemoUsers();
  await importCsv('26-cost-centers.csv', '/cost-centers/import');
  await importCsv('27-analytics-values.csv', '/analytics-categories/import');
  await importCsv('28-working-day-calendars.csv', '/working-day-profiles/import');
  await importCsv('11-business-processes.csv', '/business-processes/import');
  await importCsv('12-applications.csv', '/applications/import');
  await importCsv('13-contracts.csv', '/contracts/import');
  await importCsv('14-spend-items.csv', '/spend-items/import');
  await importCsv('15-capex-items.csv', '/capex-items/import');
  await runBudget();
  await importCsv('16-portfolio-projects.csv', '/portfolio/projects/import');
  await importCsv('17-portfolio-requests.csv', '/portfolio/requests/import');
  const locationIdByFixtureCode = await ensureLocations();
  await ensureAssets(locationIdByFixtureCode);
  await ensureAssetHardwareInfo();
  if (options.netboxTestCases) await ensureDuplicateAssetName();
  if (options.netboxTestCases) await ensureRenamedAssets();
  await importCsv('19-tasks.csv', '/tasks/import');
}

async function runRelations() {
  await linkSuites();
  await linkApplicationDepartments();
  await ensureAppInstances();
  await ensureMiddlewareEtlEnabled();
  await ensureInterfaces();
  const refToId = await ensureConnections();
  await ensureConnectionLegs(refToId);
  await ensureInterfaceBindings();
  await ensureInterfaceConnectionLinks(refToId);
  await linkContractsToSpend();
  await linkSpendToApps();
  await ensurePortfolioTeamsAndCapacity();
  await ensureProjectPhases();
  await ensureProjectTeams();
  await ensureCompanyAllocations();
}

async function main() {
  await detectApiPrefix();
  await ensureTenant();
  await setupSettings();
  await ensurePortfolioClassification();
  await ensureAnalyticsCategories();
  await ensureAnalyticsAxes();
  await runImports();
  if (!options.skipRelations) await runRelations();
  await ensureServiceDeskDocs();
  if (!options.skipAgents) await ensureDemoAgent();

  ok('Fromage & Co fixture setup complete');
  console.log('');
  console.log(`  App URL:      ${options.baseUrl}`);
  console.log(`  Tenant admin: ${options.email}`);
  if (options.demoPassword) {
    console.log(`  Demo users:   thomas.berger@fromage-co.com (and 18 others) / ${options.demoPassword}`);
  }
  if (!options.skipAgents) {
    console.log(`  Demo agent:   '${AGENT_NAME}' (mock ticketing) — check the Agents pages`);
    console.log(`  Knowledge:    '${SERVICE_DESK_LIBRARY}' library — the demo tickets find their answers there`);
  }
}

main().catch((error) => {
  console.error(`[ERR]  ${error.message}`);
  process.exitCode = 1;
});
