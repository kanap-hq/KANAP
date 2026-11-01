#!/usr/bin/env node
// Fromage & Co demo tenant setup — single idempotent runner.
//
// Creates the tenant (trial flow), seeds settings/classification, imports all
// CSVs, wires relations (suites, departments, instances, interfaces,
// connections, contracts↔spend, portfolio timeline/teams, allocations), sets
// demo user passwords, and provisions a demo AI agent on the mock ticketing
// provider.
//
// Usage (CLI mode, for the maintainer):
//   node backend/fixtures/fromage-co/setup-tenant.mjs \
//     --base-url https://fromage.dev.kanap.net \
//     --email <your email> --password '<admin password>' \
//     --demo-password '<private value>'
//
// --demo-password is required: it is the password every imported demo user
// gets. Use a private value on any tenant reachable from outside the machine,
// or pass --demo-password '' to create the users without a password.
//
// --contact-suppliers-only: on a tenant already loaded, only links the demo contacts
// to their suppliers (09b-contact-suppliers.csv), then stops. --demo-password is not needed.
//
// --accept-included-model: on a cloud tenant that falls back on the KANAP included
// model, confirms its provider and processing location as the tenant administrator
// (the account of --email), in the request that turns the assistant on. Without it,
// the assistant stays off and the demo agent has no demo run until an administrator
// confirms the included model in Admin > Plaid.
//
// Server mode (`--server-mode`, no other argument) is for the API, which runs
// the script on a tenant that was just activated. Its inputs come from the
// environment only:
//   KANAP_DEMO_API_URL           the API root, e.g. http://127.0.0.1:8080
//   KANAP_DEMO_HOST              the tenant's host name (the API resolves the tenant from it)
//   KANAP_DEMO_TOKEN             an access token of the tenant administrator
//   KANAP_DEMO_STARTING_COMPANY  the company the activation created, replaced by the dataset
//   KANAP_DEMO_YEAR              the year the dataset is moved to
// It skips the tenant bootstrap, the login, the demo passwords, the AI agent
// and the Netbox test cases. Each step starts with a `KANAP_DEMO_STEP <name>`
// line on stdout; the rest of the output goes to stderr. The exit code is not
// zero when a step failed or warned: a partial load is a failure.
//
// See SETUP-GUIDE.md for the full procedure per environment.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLinesFile, buildMonthlyFile, loadBudgetFile } from '../../scripts/lib/budget-file.mjs';
import { DATASET_YEAR, parseCsv, shiftCsvText, shiftIsoDate } from '../../scripts/lib/fixture-csv.mjs';
import { createHttpClient } from '../../scripts/lib/http-client.mjs';
import { analyticsValuesText, fixtureDimensions, resolveFixtureLanguage, withFixtureDimensionValues } from './fixture-dimensions.mjs';
import { planDemandScores, sameCriteriaValues } from './demand-scores.mjs';
import { rewriteIncidentTaskLinks } from './incident-task-links.mjs';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  baseUrl: 'https://fromage.dev.kanap.net',
  org: 'Fromage & Co',
  countryIso: 'FR',
  year: DATASET_YEAR,
};

const argv = process.argv.slice(2);
const serverMode = argv.includes('--server-mode');
const options = {
  baseUrl: DEFAULTS.baseUrl,
  email: '',
  password: '',
  org: DEFAULTS.org,
  countryIso: DEFAULTS.countryIso,
  activationToken: '',
  demoPassword: null, // required: set by --demo-password ('' = no password)
  year: DEFAULTS.year,
  yearShift: null, // --shift-years; null = the dataset's dates as written
  skipRelations: false,
  skipAgents: false,
  netboxTestCases: false,
  acceptIncludedModel: false,
  contactSuppliersOnly: false,
};

/** Stops before any request, with one line per problem. */
function refuseToStart(messages) {
  for (const message of messages) console.error(`[ERR]  ${message}`);
  process.exit(1);
}

let token = '';
let apiPrefix = '';
let tenantHost = '';
let publicBaseUrl = '';

if (serverMode) {
  if (argv.length !== 1) refuseToStart(['--server-mode takes no other argument: its inputs come from the KANAP_DEMO_* environment variables.']);
  const env = process.env;
  const problems = [];
  const apiUrl = String(env.KANAP_DEMO_API_URL ?? '').trim();
  try {
    if (!['http:', 'https:'].includes(new URL(apiUrl).protocol)) problems.push('KANAP_DEMO_API_URL must be an http(s) URL.');
  } catch {
    problems.push('KANAP_DEMO_API_URL must be an http(s) URL.');
  }
  const host = String(env.KANAP_DEMO_HOST ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?$/.test(host)) {
    problems.push('KANAP_DEMO_HOST must be the host name of the tenant.');
  }
  const accessToken = String(env.KANAP_DEMO_TOKEN ?? '').trim();
  if (!accessToken) problems.push('KANAP_DEMO_TOKEN is required.');
  const startingCompany = String(env.KANAP_DEMO_STARTING_COMPANY ?? '').trim();
  if (!startingCompany) problems.push('KANAP_DEMO_STARTING_COMPANY is required.');
  const year = Number(String(env.KANAP_DEMO_YEAR ?? '').trim());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) problems.push('KANAP_DEMO_YEAR must be a year between 2000 and 2100.');
  if (problems.length) refuseToStart(problems);

  options.baseUrl = apiUrl.replace(/\/$/, '');
  options.org = startingCompany;
  options.demoPassword = '';
  options.yearShift = year - DATASET_YEAR;
  options.skipAgents = true;
  tenantHost = host;
  token = accessToken;
} else {
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
    // Moves every date of the dataset by N years (N = target year - 2026), as the server mode does.
    else if (arg === '--shift-years') options.yearShift = Number(argv[++i]);
    else if (arg === '--skip-relations') options.skipRelations = true;
    else if (arg === '--skip-agents') options.skipAgents = true;
    // Confirms the KANAP included model as the tenant administrator (see the header).
    else if (arg === '--accept-included-model') options.acceptIncludedModel = true;
    // Dev only: adds the deliberately duplicated asset used by the Netbox sync tests.
    else if (arg === '--netbox-test-cases') options.netboxTestCases = true;
    // Repair of a tenant already loaded: only links the demo contacts to their suppliers.
    else if (arg === '--contact-suppliers-only') options.contactSuppliersOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.baseUrl = options.baseUrl.replace(/\/$/, '');
  const missingArgs = [];
  if (!options.email) {
    missingArgs.push('--email is required (the tenant administrator; also used when bootstrapping the tenant).');
  }
  if (!options.password) {
    missingArgs.push('--password is required (tenant admin password; also used when bootstrapping the tenant).');
  }
  if (options.demoPassword === null && !options.contactSuppliersOnly) {
    missingArgs.push(
      "--demo-password is required (password given to every imported demo user). "
      + "Pass --demo-password <value> with a private value, or --demo-password '' to create the users without a password.",
    );
  }
  if (options.yearShift !== null && !Number.isInteger(options.yearShift)) {
    missingArgs.push('--shift-years takes a whole number of years (target year - 2026).');
  }
  if (missingArgs.length > 0) refuseToStart(missingArgs);

  tenantHost = new URL(options.baseUrl).hostname;
  // Public (pre-tenant) routes are served on the marketing apex; unknown tenant
  // subdomains answer TENANT_NOT_FOUND for everything else.
  publicBaseUrl = options.baseUrl.replace(`//${tenantHost}`, `//${tenantHost.split('.').slice(1).join('.')}`);
}

const slug = tenantHost.split('.')[0];

/** Years added to every date of the dataset (0: the files as written). */
const YEAR_SHIFT = options.yearShift ?? 0;

// Server mode: steps on stdout, everything a person reads on stderr.
const say = serverMode ? (message) => process.stderr.write(`${message}\n`) : (message) => console.log(message);
let warnings = 0;
const info = (message) => say(`[INFO] ${message}`);
const ok = (message) => say(`[OK]   ${message}`);
const warn = (message) => {
  warnings += 1;
  if (serverMode) process.stderr.write(`[WARN] ${message}\n`);
  else console.warn(`[WARN] ${message}`);
};

/** Marks the start of a step (server mode: one `KANAP_DEMO_STEP <name>` line on stdout). */
function step(name) {
  if (serverMode) process.stdout.write(`KANAP_DEMO_STEP ${name}\n`);
}

function file(name) {
  return path.join(ROOT_DIR, name);
}

function normalizeValue(value) {
  if (value == null) return '';
  return String(value).trim();
}

/** A dataset file as loaded: its dates moved by YEAR_SHIFT. */
function fixtureText(name) {
  return shiftCsvText(readFileSync(file(name), 'utf8'), YEAR_SHIFT);
}

function readCsv(name) {
  return parseCsv(fixtureText(name));
}

/** A date written in this script, moved like the dataset. */
function shiftedDate(value) {
  return shiftIsoDate(value, YEAR_SHIFT) ?? value;
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

// The tenant's API (server mode: on 127.0.0.1 with the tenant's Host) and, in
// CLI mode, the public routes on the marketing apex.
// CLI mode follows one redirect to the same host (a proxy that sends http to https).
const tenantClient = createHttpClient({ baseUrl: options.baseUrl, host: serverMode ? tenantHost : null, followRedirect: !serverMode });
const publicClient = serverMode ? null : createHttpClient({ baseUrl: publicBaseUrl, followRedirect: true });

async function request(method, route, body, { uploadBytes, uploadName, uploadFields, noAuth, publicHost } = {}) {
  const headers = {};
  if (token && !noAuth) headers.Authorization = `Bearer ${token}`;
  const client = publicHost ? publicClient : tenantClient;
  const response = await client.request(method, `${apiPrefix}${route}`, {
    headers,
    ...(uploadBytes !== undefined
      ? { form: { bytes: uploadBytes, filename: uploadName, fields: uploadFields ?? {} } }
      : { json: body }),
  });
  const text = response.text;
  let payload = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (response.status < 200 || response.status >= 300) {
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

async function apiPut(route, body) {
  return request('PUT', route, body);
}

async function apiDelete(route) {
  return request('DELETE', route);
}

/** Sends a dataset file as loaded (dates moved by YEAR_SHIFT). */
async function uploadCsv(route, name) {
  return request('POST', route, undefined, { uploadBytes: Buffer.from(fixtureText(name), 'utf8'), uploadName: name });
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

// Items whose end of validity has passed import as disabled, and the lists default to enabled
// items only: include the disabled ones so their links still resolve.
async function spendIdByName(name) {
  return idByName('/spend-items?limit=1000&includeDisabled=true', name, 'product_name');
}

async function capexIdByDescription(description) {
  return idByName('/capex-items?limit=500&includeDisabled=true', description, 'description');
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

/**
 * EUR for one USD when a refresh leaves a sample year without a rate.
 * About 0.9, the order of magnitude of the euro-dollar rate. A manual rate
 * wins over a later automatic fetch, so the sample amounts stay convertible
 * on a machine that cannot reach the rate sources.
 */
const SAMPLE_USD_RATE_EUR = 0.9;

/** Currencies the sample spends, and the manual rate used when no source provides one. USD only. */
const SAMPLE_FX_FALLBACK = { USD: SAMPLE_USD_RATE_EUR };

function usableStoredRate(rates, currency) {
  if (!rates || typeof rates !== 'object') return null;
  for (const [key, value] of Object.entries(rates)) {
    if (key.toUpperCase() !== currency) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * The sample spends USD in years N-1, N and N+1. The settings save refreshes
 * the current year only, and the lines are imported later, so the refresh
 * answer's still-missing list cannot name those USD years yet. N+2 is included
 * as well: contract amounts are read through the year after next, and the USD
 * contract renews on, so that year would stay missing. Each of these years
 * without a usable USD rate, and each reported pair that has a documented
 * rate, gets that manual rate. A failed or still-running refresh is logged
 * with info: a warning would fail the load.
 */
async function ensureSampleExchangeRates() {
  const years = [BUDGET_YEAR - 1, BUDGET_YEAR, BUDGET_YEAR + 1, BUDGET_YEAR + 2];
  let reported = [];
  try {
    const refresh = await apiPost('/currency/rates/refresh', { years });
    reported = Array.isArray(refresh?.stillMissing) ? refresh.stillMissing : [];
    if (refresh?.completed === false) {
      info('Exchange-rate refresh is still running; years without a rate get the documented manual rate');
    } else if (refresh?.failed) {
      info('Exchange rates were not fetched; years without a rate get the documented manual rate');
    }
  } catch (error) {
    const reason = String(error?.message ?? error).split('\n')[0];
    info(`Exchange-rate refresh did not answer (${reason}); years without a rate get the documented manual rate`);
  }

  let matrix = { rates: [] };
  try {
    matrix = await apiGet('/currency/rates');
  } catch (error) {
    const reason = String(error?.message ?? error).split('\n')[0];
    info(`Exchange-rate list did not answer (${reason}); the documented manual rate is stored for each sample year`);
  }

  const rateFor = (year, currency) => {
    const row = (matrix?.rates ?? []).find((item) => Number(item?.fiscalYear) === year);
    return usableStoredRate(row?.rates, currency);
  };

  const pending = new Map();
  for (const pair of reported) {
    const currency = String(pair?.currency ?? '').trim().toUpperCase();
    const year = Number(pair?.year);
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isInteger(year)) continue;
    pending.set(`${currency}:${year}`, { currency, year });
  }
  for (const year of years) {
    if (rateFor(year, 'USD') == null) pending.set(`USD:${year}`, { currency: 'USD', year });
  }

  const stored = [];
  for (const pair of [...pending.values()].sort((a, b) => a.year - b.year || a.currency.localeCompare(b.currency))) {
    if (rateFor(pair.year, pair.currency) != null) continue;
    const rate = SAMPLE_FX_FALLBACK[pair.currency];
    if (rate == null) {
      info(`No documented fallback rate for ${pair.currency} ${pair.year}`);
      continue;
    }
    await apiPut('/currency/rates/manual', { currency: pair.currency, year: pair.year, rate });
    stored.push(`${pair.currency} ${pair.year}`);
  }
  if (stored.length) info(`Manual exchange rate ${SAMPLE_USD_RATE_EUR} EUR stored for ${stored.join(', ')}`);
  else ok('Exchange rates cover USD for the sample years');
}

async function setupSettings() {
  info('Configuring base settings');
  await apiPatch('/currency/settings', {
    reportingCurrency: 'EUR',
    defaultSpendCurrency: 'EUR',
    defaultCapexCurrency: 'EUR',
    allowedCurrencies: ['EUR', 'USD'],
  });
  await ensureSampleExchangeRates();

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

// The recommended dimensions every tenant starts with (cost pool on the default dimension, IT
// tower, purpose, priority) and the optional recurrence pack come from the tenant's own seed, in
// its language: the runner adds the ones the tenant lacks (POST /analytics-axes/recommended, in
// the tenant's seed language), which names the default dimension only while it has neither a
// name nor a value. The budget files name their values in English, as an English tenant's seed
// does; GET /analytics-axes/recommended gives the tenant's value of each one ("Matériel" for
// "Hardware" on a French tenant), so the budget import never creates an English value next to
// the tenant's own.

/** The `analytics:<code>` columns of the budget files that hold a recommended dimension -> its key. */
const RECOMMENDED_COLUMNS = { default: 'cost_pool', it_tower: 'it_tower', purpose: 'purpose', priority: 'priority', recurrence: 'recurrence' };

/**
 * Adds the recommended dimensions the tenant lacks, in its seed language, and returns that
 * language. The data set's own dimensions are named in it too.
 */
async function ensureRecommendedDimensions() {
  info('Ensuring the recommended analytics dimensions');
  const state = await apiGet('/analytics-axes/recommended');
  const language = resolveFixtureLanguage(state.language);
  const missing = state.items.filter((item) => !item.present).map((item) => item.code);
  if (!missing.length) return language;
  const result = await apiPost('/analytics-axes/recommended', { codes: missing, language: state.language });
  for (const created of result.created) ok(`Created analytics dimension '${created.name}' (${created.values_created} values)`);
  return language;
}

/**
 * Per budget file column code, the tenant's dimension that stands for the recommended one (its
 * code, the nature it is restricted to) and its value name for each English seed name; and the
 * code of an older tenant's PP&E type dimension, if it has one.
 */
async function recommendedColumns() {
  const state = await apiGet('/analytics-axes/recommended');
  const axes = items(await apiGet('/analytics-axes'));
  const byKey = new Map(state.items.map((item) => [item.code, item]));
  const dimensions = {};
  for (const [column, key] of Object.entries(RECOMMENDED_COLUMNS)) {
    const item = byKey.get(key);
    if (!item?.present || !item.axis_code) throw new Error(`The tenant has no ${key} dimension`);
    const axis = axes.find((candidate) => candidate.id === item.axis_id);
    const names = new Map();
    for (const value of item.values) {
      // A value the administrator renamed or deleted: the import creates the English one.
      if (!value.name) info(`${item.name}: no value stands for '${value.english_name}'; the budget import creates it`);
      names.set(lower(value.english_name), value.name ?? value.english_name);
    }
    dimensions[column] = { code: item.axis_code, name: item.name, appliesTo: axis?.applies_to ?? null, names };
  }
  const ppeType = axes.find((axis) => lower(axis.code) === 'ppe_type');
  if (ppeType) info(`${ppeType.name}: filled on the CAPEX lines from the cost pool (Hardware, else Software)`);
  return { dimensions, ppeType: ppeType ? ppeType.code : null };
}

/**
 * The rows of a budget file with the recommended dimensions' columns renamed to the tenant's
 * dimension codes and their English values replaced by the tenant's. A value that is not in the
 * seed is a fixture error. A dimension restricted to the other nature (the investment type of an
 * older tenant standing for the purpose) leaves its column empty on these rows.
 *
 * A tenant created before the recommended dimensions still has the PP&E type dimension, required
 * on CAPEX lines (backend/src/analytics/capex-dimensions.seed.ts). The files carry no PP&E type:
 * it follows the cost pool there, Hardware for hardware and Software for the rest.
 */
function withTenantDimensions(rows, scope, { dimensions, ppeType }) {
  const skipped = new Set();
  const mapped = rows.map((row) => {
    const out = {};
    if (scope === 'capex' && ppeType) {
      out[`analytics:${ppeType}`] = lower(row['analytics:default']) === 'hardware' ? 'Hardware' : 'Software';
    }
    for (const [column, value] of Object.entries(row)) {
      const dimension = column.startsWith('analytics:') ? dimensions[column.slice('analytics:'.length)] : null;
      if (!dimension) {
        out[column] = value;
        continue;
      }
      const text = normalizeValue(value);
      let name = '';
      if (text && dimension.appliesTo && dimension.appliesTo !== scope) skipped.add(dimension.name);
      else if (text) {
        name = dimension.names.get(lower(text));
        if (!name) throw new Error(`${BUDGET_ITEM_FILES[scope]}: '${text}' is no value of the recommended ${column}`);
      }
      out[`analytics:${dimension.code}`] = name;
    }
    return out;
  });
  for (const name of skipped) info(`${name} applies to ${scope === 'opex' ? 'CAPEX' : 'OPEX'} lines only: left empty on the ${scope === 'opex' ? 'OPEX' : 'CAPEX'} lines`);
  return mapped;
}

// ── Budget: analytics dimensions, costed lines, monthly rows ─────────────────
//
// The budget files (26-30) come from tools/generate-budget.mjs. Cost centres,
// dimension values and calendars import like any master data. The two item
// files (14, 15) and the monthly amounts (29) keep their old shape: they are
// converted at load time by backend/scripts/lib/budget-file.mjs and sent through the
// budget file routes (preflight, then import), one file per list. Costed lines
// (quantity × price, file 30) still go through the versions API. The item files
// and the monthly rows are keyed by item name, because item numbers only exist
// once the lines are imported: both steps resolve the names against the tenant
// first.

// The fixture's own dimensions, after the recommended ones, in the tenant's seed language
// (fixture-dimensions.mjs). The business domain says which part of the business a line serves
// (the IT tower says which part of IT); the budget reference groups the lines of one order or
// program. A dimension already there keeps its name: a sample data load creates these two.

async function ensureAnalyticsAxes(language) {
  info('Ensuring analytics dimensions');
  const existing = items(await apiGet('/analytics-axes'));
  for (const axis of fixtureDimensions(language)) {
    if (existing.some((item) => lower(item.code) === axis.code)) continue;
    await apiPost('/analytics-axes', { code: axis.code, name: axis.name, description: axis.description, sort_order: axis.sort_order });
    ok(`Created analytics dimension '${axis.name}'`);
  }
}

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

/**
 * The fixture's HTTP client, reduced to what the budget file helper needs:
 * `{ status, data }` for every answer. The fixture's `request` throws on a
 * non-2xx, so its status and payload are turned back into a result.
 */
async function budgetRequest(method, route, { bytes, filename, snapshot } = {}) {
  try {
    const data = await request(method, route, undefined, {
      uploadBytes: bytes,
      uploadName: filename,
      uploadFields: snapshot === undefined ? undefined : { snapshot: JSON.stringify(snapshot) },
    });
    return { status: 200, data };
  } catch (error) {
    return { status: error.status ?? 0, data: error.payload ?? null };
  }
}

/**
 * Y: the calendar year the source files' relative `y_*` columns are read against. The dataset's
 * year moved by the shift when one is given (server mode, --shift-years), else the current year.
 */
const BUDGET_YEAR = options.yearShift === null ? new Date().getFullYear() : DATASET_YEAR + YEAR_SHIFT;

const BUDGET_ITEM_FILES = { opex: '14-spend-items.csv', capex: '15-capex-items.csv' };

/**
 * Line name -> the line's reference (`BL-n`), for the lines that already exist in the tenant. A
 * budget file names a line by it; the CAPEX list's `item_number` is the line's CPX number, which a
 * bare number no longer names (a bare number is a BL number since lot C1b).
 */
function numbersByName(index, scope) {
  const field = scope === 'opex' ? 'product_name' : 'description';
  return new Map([...index[scope].values()].map((item) => [item[field], String(item.reference)]));
}

/** The rows the old files marked disabled without an end date. */
function disabledWithoutDate(rows) {
  return rows.filter((row) => lower(row.status) === 'disabled' && !normalizeValue(row.disabled_at));
}

/** One item file, converted to a lines file and loaded through the two routes. */
async function importBudgetLines(scope, tenantDimensions, existingNumbers, language) {
  const name = BUDGET_ITEM_FILES[scope];
  const rows = withFixtureDimensionValues(withTenantDimensions(readCsv(name), scope, tenantDimensions), language);
  const dated = disabledWithoutDate(rows);
  if (dated.length) {
    info(`${name}: ${dated.length} disabled rows without a date are written as ended on ${BUDGET_YEAR - 1}-12-31`);
  }
  info(`Importing ${name} as the ${scope === 'opex' ? 'OPEX' : 'CAPEX'} budget file`);
  const csvText = buildLinesFile(scope, rows, { year: BUDGET_YEAR, existingNumbers });
  const result = await loadBudgetFile({ request: budgetRequest, scope, csvText, filename: name });
  ok(`Imported ${name}: ${result.rows} rows, ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged ` +
    `(preflight ${(result.preflightMs / 1000).toFixed(1)} s, import ${(result.importMs / 1000).toFixed(1)} s)`);
  return result;
}

/** The OPEX and CAPEX lines through the budget file, then the refreshed index. */
async function importBudgetItems(language) {
  const before = await budgetItemIndex();
  const tenantDimensions = await recommendedColumns();
  for (const scope of ['opex', 'capex']) {
    await importBudgetLines(scope, tenantDimensions, numbersByName(before, scope), language);
  }
  return budgetItemIndex();
}

/** The monthly amounts (file 29), one budget file per scope. */
async function importMonthlyBudgetFiles(index) {
  info('Importing monthly budget rows');
  const rows = readCsv('29-budget-rows.csv');
  const partial = rows.filter((row) => !/^\d{4}-01-01$/.test(row.period_start) || !/^\d{4}-12-31$/.test(row.period_end));
  if (partial.length) {
    info(`${partial.length} of ${rows.length} budget rows cover part of the year only (the file has no period column)`);
  }
  const counts = {};
  for (const scope of ['opex', 'capex']) {
    const scopeRows = rows.filter((row) => row.item_type === scope);
    const missing = scopeRows.filter((row) => !index[scope].has(row.item_name));
    if (missing.length) warn(`Budget rows: ${missing.length} ${scope} rows without an item, skipped`);
    const csvText = buildMonthlyFile(scope, scopeRows, { numbersByName: numbersByName(index, scope) });
    const result = await loadBudgetFile({ request: budgetRequest, scope, csvText, filename: `29-budget-rows-${scope}.csv` });
    ok(`Imported monthly ${scope === 'opex' ? 'OPEX' : 'CAPEX'} rows: ${result.rows} rows, ${result.created} created, ` +
      `${result.updated} updated, ${result.unchanged} unchanged (preflight ${(result.preflightMs / 1000).toFixed(1)} s, ` +
      `import ${(result.importMs / 1000).toFixed(1)} s)`);
    counts[scope] = result;
  }
  return { rows: rows.length, partial: partial.length, ...counts };
}

async function runBudget(index) {
  await ensureCostedLines(index);
  await importMonthlyBudgetFiles(index);
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
  const result = await uploadCsv(`${route}?dryRun=false${extraQuery}`, name);
  if (result?.ok === false) throw new Error(`${name} import returned ok=false:\n${JSON.stringify(result, null, 2)}`);
  ok(`Imported ${name}`);
  return result;
}

/**
 * Fills the default English criteria of three demands, so the list shows distinct scores.
 * The criterion ids belong to the tenant: they are resolved by name and label. A tenant
 * whose criteria are not that set is left as it is. A demand that already holds these
 * values is left as it is, so a re-run changes nothing.
 */
async function scoreRequests() {
  const payload = await apiGet('/portfolio/criteria');
  const criteria = Array.isArray(payload) ? payload : items(payload);
  const requests = await getAll('/portfolio/requests?limit=1000&status=all');
  const plan = planDemandScores(criteria, requests);
  if (plan.skipped) {
    info(`Demand scores left as they are: ${plan.reason}.`);
    return;
  }
  for (const name of plan.missing) warn(`Demand '${name}' not found; its score was not set`);
  let updated = 0;
  let unchanged = 0;
  for (const assignment of plan.assignments) {
    if (sameCriteriaValues(assignment.current, assignment.criteria_values)) {
      unchanged += 1;
      continue;
    }
    try {
      await apiPost(`/portfolio/criteria/requests/${assignment.requestId}/score`, {
        criteria_values: assignment.criteria_values,
      });
      updated += 1;
    } catch (error) {
      const payloadText = typeof error?.payload === 'string' ? error.payload : JSON.stringify(error?.payload ?? '');
      if (error?.status === 400 && /converted/i.test(`${error.message}\n${payloadText}`)) {
        warn(`Demand '${assignment.name}' is converted; its score was left as it is`);
        continue;
      }
      throw error;
    }
  }
  ok(`Demand scores: ${updated} set, ${unchanged} already set`);
}

/** The data set's own dimension values, named in the tenant's seed language. English sends the file as it is. */
async function importAnalyticsValues(language) {
  const name = '27-analytics-values.csv';
  info(`Importing ${name}`);
  const text = analyticsValuesText(language, fixtureText(name));
  const result = await request('POST', '/analytics-categories/import?dryRun=false', undefined, {
    uploadBytes: Buffer.from(text, 'utf8'),
    uploadName: name,
  });
  if (result?.ok === false) throw new Error(`${name} import returned ok=false:\n${JSON.stringify(result, null, 2)}`);
  ok(`Imported ${name}`);
  return result;
}

async function importAccounts(coaId, name) {
  info(`Importing ${name} into CoA ${coaId}`);
  const result = await uploadCsv(`/chart-of-accounts/${coaId}/accounts/import?dryRun=false`, name);
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

// Earlier versions of the fixture built their own group chart (accounts 6100-6400)
// and copied those accounts into every local chart. Group reporting now uses the
// IFRS chart the tenant is provisioned with: each local account maps to one of its
// 14 consolidation accounts. Remove the old group accounts on tenants built before.
const LEGACY_GROUP_COA = 'IFRS Group Chart';
const LEGACY_GROUP_ACCOUNTS = new Set(['6100', '6200', '6300', '6400']);

async function removeLegacyGroupAccounts(coaIds) {
  const accounts = await getAll('/accounts?limit=1000');
  const legacy = accounts.filter((account) => coaIds.includes(account.coa_id) && LEGACY_GROUP_ACCOUNTS.has(String(account.account_number)));
  for (const account of legacy) {
    try {
      await apiDelete(`/accounts/${account.id}`);
    } catch (error) {
      warn(`Could not remove legacy group account ${account.account_number}: ${error.message}`);
    }
  }
  if (legacy.length) ok(`Removed ${legacy.length} legacy group account(s) from the local charts`);

  const coas = items(await apiGet('/chart-of-accounts?limit=500'));
  const legacyCoa = coas.find((coa) => coa.name === LEGACY_GROUP_COA);
  if (legacyCoa) {
    try {
      await apiDelete(`/chart-of-accounts/${legacyCoa.id}`);
      ok(`Removed legacy chart '${LEGACY_GROUP_COA}'`);
    } catch (error) {
      warn(`Could not remove legacy chart '${LEGACY_GROUP_COA}': ${error.message}`);
    }
  }
}

// Chart roles: each local chart is its country's default chart, and the IFRS chart the
// tenant is provisioned with is both the default for other countries and the
// consolidation chart every local account maps to.
async function ensureChartRoles(localCharts) {
  let coas = items(await apiGet('/chart-of-accounts?limit=500'));
  for (const [country, coaId] of Object.entries(localCharts)) {
    const chart = coas.find((coa) => coa.id === coaId);
    if (chart?.is_default) continue;
    await apiPatch(`/chart-of-accounts/${coaId}`, { is_default: true });
    ok(`${chart?.code ?? coaId} is the default chart for ${country}`);
  }

  const ifrs = coas.find((coa) => coa.scope === 'GLOBAL' && coa.code === 'IFRS');
  if (!ifrs) {
    warn('No IFRS chart (GLOBAL scope, code IFRS): load the IFRS template, then re-run so the local accounts have a consolidation chart');
    return;
  }
  if (!ifrs.is_global_default) {
    await apiPatch(`/chart-of-accounts/${ifrs.id}/global-default`);
    ok('IFRS is the default chart for other countries');
  }
  // Always: the call is idempotent and resyncs the consolidation names of the local accounts
  // from IFRS (an import or an older tenant may hold names typed by hand).
  const result = await apiPatch(`/chart-of-accounts/${ifrs.id}/consolidation`);
  ok(`IFRS is the consolidation chart (${result?.resynced ?? 0} account(s) resynced, ${result?.outside ?? 0} outside it)`);

  coas = items(await apiGet('/chart-of-accounts?limit=500'));
  for (const coaId of Object.values(localCharts)) {
    const chart = coas.find((coa) => coa.id === coaId);
    const outside = chart?.accounts_outside_count ?? 0;
    const unmapped = chart?.accounts_unmapped_count ?? 0;
    if (outside || unmapped) {
      warn(`${chart?.code ?? coaId}: ${outside} account(s) outside the consolidation chart, ${unmapped} without consolidation account`);
    }
  }
}

async function setupCoas() {
  const fr = await ensureCoa('France PCG', 'FR-PCG', 'COUNTRY', 'FR');
  const nl = await ensureCoa('Netherlands RGS', 'NL-RGS', 'COUNTRY', 'NL');
  const it = await ensureCoa('Italy PDC', 'IT-PDC', 'COUNTRY', 'IT');
  const us = await ensureCoa('US GAAP', 'US-GAAP', 'COUNTRY', 'US');

  await removeLegacyGroupAccounts([fr, nl, it, us]);
  await importAccounts(fr, '03-accounts-fr.csv');
  await importAccounts(nl, '04-accounts-nl.csv');
  await importAccounts(it, '05-accounts-it.csv');
  await importAccounts(us, '06-accounts-us.csv');

  await assignCompanyCoa('Fromage & Co SA', fr);
  await assignCompanyCoa('Kaasmeester BV', nl);
  await assignCompanyCoa('Formaggio Supremo SRL', it);
  await assignCompanyCoa('Fromage & Co Inc.', us);
  await ensureChartRoles({ FR: fr, NL: nl, IT: it, US: us });
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

// Notes this fixture wrote before lot C3, replaced on a tenant loaded by an older fixture. A note
// someone edited by hand is never overwritten. The cluster note was written with two hosts before
// lot C3 and with the third host after the upgrade; both values are the fixture's own.
const REPLACED_ASSET_NOTES = {
  'PAR-VSPHERE-CL01': [
    'vSphere cluster of PAR-ESX-01 and PAR-ESX-02 — HA and DRS',
    'vSphere cluster of PAR-ESX-01, PAR-ESX-02 and PAR-ESX-05 — HA and DRS',
  ],
  'PAR-SAN-01': ['NetApp FAS2750 — 50TB usable, primary SAN for all VMs'],
};

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
  const locations = await getAll('/locations?limit=500');
  const locationById = new Map(locations.map((item) => [item.id, item]));
  const existingAssets = await getAll('/assets?limit=1000');
  const existing = new Set(existingAssets.map((item) => item.name));
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
    if (existing.has(row.name)) {
      const asset = existingAssets.find((item) => item.name === row.name);
      const replaced = REPLACED_ASSET_NOTES[row.name];
      if (asset && replaced) {
        const current = await apiGet(`/assets/${asset.id}`);
        if (replaced.includes(current?.notes)) {
          await apiPatch(`/assets/${asset.id}`, { notes: row.notes || null });
          ok(`Replaced the notes of '${row.name}'`);
        }
      }
      // Older fixtures marked the firewalls PAR-FW-01 and PAR-FW-02 as clusters (with no member):
      // an asset the file no longer calls a cluster becomes a plain asset again, unless someone
      // gave it members since (the server refuses the switch then).
      if (asset?.is_cluster && !boolValue(row.is_cluster)) {
        const members = items(await apiGet(`/assets/${asset.id}/members`));
        if (members.length > 0) warn(`'${row.name}' has members; it stays a cluster`);
        else await apiPatch(`/assets/${asset.id}`, { is_cluster: false });
      }
      continue;
    }
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
    const operating_system = row.operating_system?.trim() ? row.operating_system.trim() : null;
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
// (backend/fixtures/fromage-co/netbox) relies on these serials: GOU-NAS-01 carries the
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
    // A connection between two assets names them (the Veeam backup of the vSphere cluster); the four
    // site-to-site links keep their entity codes.
    const sourceAssetId = row.source_asset_name ? await assetIdByName(row.source_asset_name) : '';
    const destinationAssetId = row.destination_asset_name ? await assetIdByName(row.destination_asset_name) : '';
    if (row.source_asset_name && !sourceAssetId) {
      warn(`Asset '${row.source_asset_name}' not found for connection '${row.name}'`);
      continue;
    }
    if (row.destination_asset_name && !destinationAssetId) {
      warn(`Asset '${row.destination_asset_name}' not found for connection '${row.name}'`);
      continue;
    }
    const body = {
      name: row.name,
      description: row.description || null,
      topology: lower(row.topology) || 'server_to_server',
      source_entity_code: sourceAssetId ? null : lower(row.source_entity_code),
      destination_entity_code: destinationAssetId ? null : lower(row.destination_entity_code),
      ...(sourceAssetId ? { source_asset_id: sourceAssetId } : {}),
      ...(destinationAssetId ? { destination_asset_id: destinationAssetId } : {}),
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
    'Fromage & Co SA::Executive Management', 'Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::IT & Digital',
    'Fromage & Co SA::Human Resources', 'Fromage & Co SA::Sales & Marketing', 'Fromage & Co SA::Production',
    'Fromage & Co SA::Procurement', 'Fromage & Co SA::Logistics', 'Fromage & Co SA::Quality & R&D',
    'Kaasmeester BV::Management', 'Kaasmeester BV::Finance', 'Kaasmeester BV::IT', 'Kaasmeester BV::Sales', 'Kaasmeester BV::Operations',
    'Formaggio Supremo SRL::Direzione', 'Formaggio Supremo SRL::Amministrazione', 'Formaggio Supremo SRL::IT',
    'Formaggio Supremo SRL::Commerciale', 'Formaggio Supremo SRL::Produzione',
    'Fromage & Co Inc.::Management', 'Fromage & Co Inc.::Finance', 'Fromage & Co Inc.::IT', 'Fromage & Co Inc.::Sales', 'Fromage & Co Inc.::Operations',
  ],
  'SAP S/4HANA': ['Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::Production', 'Fromage & Co SA::Procurement', 'Fromage & Co SA::Logistics'],
  'SAP BW/4HANA': ['Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::Executive Management'],
  'Salesforce Sales Cloud': ['Fromage & Co SA::Sales & Marketing', 'Kaasmeester BV::Sales', 'Formaggio Supremo SRL::Commerciale', 'Fromage & Co Inc.::Sales'],
  'Salesforce Service Cloud': ['Fromage & Co SA::Sales & Marketing'],
  'Workday HCM': ['Fromage & Co SA::Human Resources'],
  'ServiceNow ITSM': ['Fromage & Co SA::IT & Digital'],
  'Okta Workforce Identity': ['Fromage & Co SA::IT & Digital'],
  'QuickBooks Online': ['Fromage & Co Inc.::Finance'],
  'Sage X3': ['Kaasmeester BV::Finance', 'Formaggio Supremo SRL::Amministrazione'],
  'CheeseTrack': ['Fromage & Co SA::Production', 'Fromage & Co SA::Quality & R&D', 'Formaggio Supremo SRL::Produzione'],
  'CaveGuard IoT': ['Fromage & Co SA::Production'],
  'Power BI': ['Fromage & Co SA::Finance & Controlling', 'Fromage & Co SA::Executive Management', 'Fromage & Co SA::Sales & Marketing'],
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
  'Axians managed services': ['Managed services — Axians'],
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
    ['sophie.laurent@fromage-co.example', 'Business Applications'],
    ['marc.petit@fromage-co.example', 'Development'],
    ['pierre.martin@fromage-co.example', 'Infrastructure'],
    ['lucas.bernard@fromage-co.example', 'Infrastructure'],
    ['clara.dupont@fromage-co.example', 'Business Applications'],
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

// Dates of the dataset year (2026), moved by YEAR_SHIFT when they are sent.
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
    for (const [name, start, end, status] of phases) {
      const planned_start = shiftedDate(start);
      const planned_end = shiftedDate(end);
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
  'sophie.laurent@fromage-co.example', 'lucas.bernard@fromage-co.example', 'pierre.martin@fromage-co.example',
  'thomas.berger@fromage-co.example', 'amelie.rousseau@fromage-co.example', 'clara.dupont@fromage-co.example',
  'jan.bakker@kaasmeester.example', 'luca.ferrari@formaggio-supremo.example', 'hugo.mercier@fromage-co.example',
]);

const PROJECT_TEAMS = {
  'Fromage-as-a-Service': ['amelie.rousseau@fromage-co.example', 'clara.dupont@fromage-co.example', 'isabelle.moreau@fromage-co.example', 'hugo.mercier@fromage-co.example'],
  'Zero Trust Fromage': ['lucas.bernard@fromage-co.example', 'pierre.martin@fromage-co.example', 'thomas.berger@fromage-co.example'],
  'Workday Global Rollout': ['sophie.laurent@fromage-co.example', 'jan.bakker@kaasmeester.example', 'luca.ferrari@formaggio-supremo.example', 'maria.casanova@fromage-co.example'],
  'Territory Planning Cockpit': ['isabelle.moreau@fromage-co.example', 'maria.casanova@fromage-co.example'],
  'Espace contrats fournisseurs': ['maria.casanova@fromage-co.example', 'isabelle.moreau@fromage-co.example'],
  'Facturation électronique 2026': ['maria.casanova@fromage-co.example', 'sophie.laurent@fromage-co.example', 'pierre.martin@fromage-co.example'],
  'Pricing Rules API Refactor': ['amelie.rousseau@fromage-co.example', 'clara.dupont@fromage-co.example', 'hugo.mercier@fromage-co.example'],
  'Customer 360 Data Contracts': ['clara.dupont@fromage-co.example', 'jan.bakker@kaasmeester.example', 'luca.ferrari@formaggio-supremo.example'],
  'Branch Network Segmentation': ['lucas.bernard@fromage-co.example', 'pierre.martin@fromage-co.example', 'thomas.berger@fromage-co.example'],
  'Endpoint Compliance Automation': ['sophie.laurent@fromage-co.example', 'pierre.martin@fromage-co.example', 'lucas.bernard@fromage-co.example'],
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
  if (!(await turnAssistantOn())) return;

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

/**
 * Turns the assistant on. When the tenant falls back on the KANAP included model, an
 * administrator confirms its provider first: with --accept-included-model, the key the
 * API shows (GET /ai/settings) goes in the same request. Returns false when the
 * assistant stays off.
 */
async function turnAssistantOn() {
  const includedModelToConfirm = async () => {
    if (!options.acceptIncludedModel) return null;
    const provider = (await apiGet('/ai/settings'))?.settings?.builtin_provider;
    return provider?.in_use && !provider.accepted && provider.key ? provider : null;
  };

  let provider = await includedModelToConfirm();
  for (let attempt = 1; ; attempt += 1) {
    const body = provider ? { chat_enabled: true, accept_builtin_provider_key: provider.key } : { chat_enabled: true };
    try {
      await apiPatch('/ai/settings', body);
      if (provider) ok(`Confirmed the KANAP included model: ${provider.name}, processing location ${provider.location}`);
      return true;
    } catch (error) {
      const code = error.payload?.code;
      if (code === 'BUILTIN_PROVIDER_CHANGED' && attempt === 1) {
        // The platform changed the included model meanwhile: read it once more.
        provider = await includedModelToConfirm();
        continue;
      }
      if (code === 'BUILTIN_PROVIDER_CONFIRMATION_REQUIRED' || code === 'BUILTIN_PROVIDER_CHANGED') {
        const hint = !options.acceptIncludedModel
          ? ', or rerun with --accept-included-model'
          : code === 'BUILTIN_PROVIDER_CHANGED' ? ' (it changed again while the runner confirmed it)' : '';
        warn(`The assistant stays off and the demo agent has no demo run: confirm the KANAP included model in Admin > Plaid${hint}`);
        return false;
      }
      throw error;
    }
  }
}

// ── Contacts ↔ suppliers ─────────────────────────────────────────────────────

const CONTACT_SUPPLIER_ROLES = new Set(['commercial', 'technical', 'support', 'other']);

/**
 * Gives every demo contact its supplier and contact type (09b-contact-suppliers.csv). The contacts
 * import has no supplier column, so this goes through PATCH /contacts/:id, which links the contact
 * to the supplier and adds it to the supplier's contracts and budget lines: it runs once those
 * exist. Contacts are found by first and last name (their e-mail domain changed between versions
 * of the data set). A contact that already has a supplier is left as it is: a rerun changes
 * nothing, and a supplier or type someone chose on a loaded tenant stays.
 */
async function linkContactsToSuppliers() {
  const rows = readCsv('09b-contact-suppliers.csv');
  const suppliers = await getAll('/suppliers?limit=1000');
  const contacts = await getAll('/contacts?limit=1000');
  const key = (first, last) => `${lower(first)}|${lower(last)}`;
  let linked = 0;
  const kept = [];
  for (const row of rows) {
    const name = `${normalizeValue(row.first_name)} ${normalizeValue(row.last_name)}`;
    const role = lower(row.role);
    if (!CONTACT_SUPPLIER_ROLES.has(role)) throw new Error(`09b-contact-suppliers.csv: '${row.role}' is no contact type (${name})`);
    const supplierId = firstBy(suppliers, (item) => lower(item.name) === lower(row.supplier));
    if (!supplierId) throw new Error(`09b-contact-suppliers.csv: supplier '${row.supplier}' not found (${name})`);
    const matches = contacts.filter((item) => key(item.first_name, item.last_name) === key(row.first_name, row.last_name));
    if (matches.length !== 1) {
      throw new Error(`09b-contact-suppliers.csv: ${matches.length === 0 ? 'no contact' : `${matches.length} contacts`} named ${name}`);
    }
    const contact = await apiGet(`/contacts/${matches[0].id}`);
    if (contact.supplier_id) {
      if (contact.supplier_id !== supplierId || contact.supplier_role !== role) kept.push(name);
      continue;
    }
    // The update requires the e-mail: the contact's own, unchanged.
    await apiPatch(`/contacts/${contact.id}`, { email: contact.email, supplier_id: supplierId, supplier_role: role });
    linked += 1;
  }
  ok(`Contacts linked to their suppliers: ${linked} updated, ${rows.length - linked} already had one`);
  if (kept.length) info(`Kept the supplier or type already set on: ${kept.join(', ')}`);
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function runImports(language) {
  step('companies');
  // The metric columns of 01-companies.csv (headcount_2025 ...) are read against this year.
  await importCsv('01-companies.csv', '/companies/import', `&year=${options.year + YEAR_SHIFT}`);
  await cleanupBootstrapCompany();
  step('charts-of-accounts');
  await setupCoas();
  step('master-data');
  await importCsv('07-suppliers.csv', '/suppliers/import');
  await importCsv('08-departments.csv', '/departments/import');
  await importCsv('09-contacts.csv', '/contacts/import');
  step('users');
  await ensureDemoUsers();
  step('budget-setup');
  await importCsv('26-cost-centers.csv', '/cost-centers/import');
  await importAnalyticsValues(language);
  await importCsv('28-working-day-calendars.csv', '/working-day-profiles/import');
  step('applications');
  await importCsv('11-business-processes.csv', '/business-processes/import');
  await importCsv('12-applications.csv', '/applications/import');
  step('contracts');
  await importCsv('13-contracts.csv', '/contracts/import');
  step('budget');
  const budgetIndex = await importBudgetItems(language);
  await runBudget(budgetIndex);
  await linkContactsToSuppliers();
  step('portfolio');
  await importCsv('16-portfolio-projects.csv', '/portfolio/projects/import');
  await importCsv('17-portfolio-requests.csv', '/portfolio/requests/import');
  await scoreRequests();
  step('assets');
  const locationIdByFixtureCode = await ensureLocations();
  await ensureAssets(locationIdByFixtureCode);
  // The hardware info and the two cases below only serve the Netbox sync tests (dev).
  if (!serverMode) await ensureAssetHardwareInfo();
  if (options.netboxTestCases) await ensureDuplicateAssetName();
  if (options.netboxTestCases) await ensureRenamedAssets();
  step('tasks');
  await importCsv('19-tasks.csv', '/tasks/import');
}

// ── Technologies (lot S) ──────────────────────────────────────────────────────
//
// The examples of the technology layer: two domain controllers carry Active Directory; Entra ID is
// subscribed and declared by several applications; a vSphere cluster of three ESXi hosts contains the
// VMs, which belong to the cluster and can move between its hosts; its hosts depend on the shared
// storage array; a SQL Server cluster runs two versions; the application server carries Tomcat and a
// SQL Server Express; the RDS database carries PostgreSQL. With the hosting of applications on these
// servers, business processes linked to applications, an unknown version (Active Directory) and
// versions past their end of support (PostgreSQL 13, SQL Server 2017). The demo stories on top:
// the cave edge node and gateways carry CaveGuard and its dashboard; the IT tools (PRTG, Veeam,
// vSphere) run on their own servers, Veeam on the backup SAN that reaches end of life; a Veeam
// connection backs up the vSphere cluster; the two aging hosts carry Talend and the S/4HANA QA
// server; S/4HANA prod and QA run on separate servers.
// An application on a cluster is assigned to the cluster, and its members inherit it.
// Every step is idempotent, and brings a tenant built by an older fixture to the same state.

const ASSET_CLUSTERS = {
  'PAR-VSPHERE-CL01': ['PAR-ESX-01', 'PAR-ESX-02', 'PAR-ESX-05'],
  'PAR-SQL-CL01': ['PAR-SQL-01', 'PAR-SQL-02'],
};

/**
 * Each content sits in one container. A container visited here loses its `contains` relations to an
 * asset the map puts in another container: PAR-ESX-01 and PAR-ESX-02 held the VMs of the vSphere
 * cluster in older fixtures, and now contain nothing; PAR-ESX-05 joins the cluster with no VM of its
 * own. The cluster contains the VMs, and the two aging hosts keep their isolated server.
 */
const ASSET_CONTAINS = {
  'PAR-VSPHERE-CL01': [
    'PAR-ERP-01', 'PAR-ERP-02', 'PAR-AD-01', 'PAR-SQL-01', 'PAR-VCENTER-01',
    'PAR-DB-01', 'PAR-APP-01', 'PAR-WEB-01', 'PAR-AD-02', 'PAR-SQL-02',
    'PAR-MON-01', 'PAR-BKP-01',
  ],
  'PAR-ESX-01': [],
  'PAR-ESX-02': [],
  'PAR-ESX-05': [],
  // The aging hosts, scheduled for the DC refresh.
  'PAR-ESX-03': ['PAR-ETL-01'],
  'PAR-ESX-04': ['PAR-ERP-QA-01'],
};

/**
 * The storage each host depends on (`asset_id` the host, `related_asset_id` the array). The two
 * aging hosts keep local storage: they depend on no array.
 */
const ASSET_DEPENDS_ON = {
  'PAR-ESX-01': ['PAR-SAN-01'],
  'PAR-ESX-02': ['PAR-SAN-01'],
  'PAR-ESX-05': ['PAR-SAN-01'],
};

/** [application, environment, server, role]: the instances of 20-app-instances.csv on their servers. */
const APP_SERVERS = [
  ['SAP S/4HANA', 'prod', 'PAR-ERP-01', 'app'],
  ['SAP S/4HANA', 'qa', 'PAR-ERP-QA-01', 'app'],
  ['SAP BW/4HANA', 'prod', 'PAR-ERP-02', 'app'],
  ['Fromage B2B Portal', 'prod', 'PAR-WEB-01', 'web'],
  ['Fromage B2B Portal', 'prod', 'PAR-APP-01', 'app'],
  ['Fromage B2B Portal', 'prod', 'PAR-DB-01', 'db'],
  ['QualityLab LIMS', 'prod', 'PAR-APP-01', 'app'],
  ['La Boutique du Fromage', 'prod', 'AWS-EC2-BOUTIQUE', 'web'],
  ['La Boutique du Fromage', 'prod', 'AWS-RDS-BOUTIQUE', 'db'],
  // On a cluster, the row of the cluster replaces those of its members (an older fixture's rows on
  // PAR-SQL-01, PAR-SQL-02, PAR-ESX-01 and PAR-ESX-02 are deleted when it is written).
  ['CheeseTrack', 'prod', 'PAR-SQL-CL01', 'db'],
  ['Sage X3', 'prod', 'GOU-SAGE-01', 'app'],
  ['Sage X3', 'prod', 'PRM-SAGE-01', 'app'],
  ['Sage X3', 'prod', 'PAR-SQL-CL01', 'db'],
  ['CaveGuard IoT', 'prod', 'CAVE-EDGE-01', 'app'],
  ['CaveGuard IoT', 'prod', 'CAVE-GW-01', 'proxy'],
  ['CaveGuard IoT', 'prod', 'CAVE-GW-02', 'proxy'],
  ['Cave Monitoring Dashboard', 'prod', 'CAVE-EDGE-01', 'web'],
  ['Talend Data Integration', 'prod', 'PAR-ETL-01', 'app'],
  ['PRTG Network Monitor', 'prod', 'PAR-MON-01', 'monitoring'],
  ['Veeam Backup & Replication', 'prod', 'PAR-BKP-01', 'backup'],
  ['Veeam Backup & Replication', 'prod', 'PAR-SAN-02', 'backup'],
  ['VMware vSphere', 'prod', 'PAR-VCENTER-01', 'app'],
  ['VMware vSphere', 'prod', 'PAR-VSPHERE-CL01', 'virtualization'],
  ['VMware vSphere', 'prod', 'PAR-ESX-03', 'virtualization'],
  ['VMware vSphere', 'prod', 'PAR-ESX-04', 'virtualization'],
];

/**
 * Technologies adopted from the shipped catalog (`catalog`) or typed (`create`), where they are
 * installed ([server, version label or null, notes]), the applications that declare them, their
 * contracts and their owners ([email, type]).
 */
const TECHNOLOGIES = [
  {
    catalog: 'active-directory',
    installed: [['PAR-AD-01', null, null], ['PAR-AD-02', null, null]],
    declaredBy: ['SAP S/4HANA', 'Sage X3', 'QualityLab LIMS', 'PRTG Network Monitor'],
    owners: [['sophie.laurent@fromage-co.example', 'it']],
  },
  {
    catalog: 'entra-id',
    declaredBy: ['Microsoft 365', 'Salesforce Sales Cloud', 'Workday HCM', 'ServiceNow ITSM', 'Jira Software', 'Confluence'],
    contracts: ['Microsoft Enterprise Agreement'],
    owners: [['sophie.laurent@fromage-co.example', 'it'], ['thomas.berger@fromage-co.example', 'business']],
  },
  {
    catalog: 'vsphere',
    installed: [['PAR-VCENTER-01', '8.0', 'vCenter Server']],
    contracts: ['Broadcom VMware ELA'],
    owners: [['marc.petit@fromage-co.example', 'it']],
  },
  {
    catalog: 'mssqlserver',
    installed: [
      ['PAR-SQL-01', '2019', null],
      ['PAR-SQL-02', '2022', 'Upgraded first; PAR-SQL-01 follows in the next window'],
      ['PAR-APP-01', '2017', 'Express edition, embedded in QualityLab LIMS'],
    ],
  },
  { catalog: 'tomcat', installed: [['PAR-APP-01', '9.0', null]] },
  { catalog: 'postgresql', installed: [['AWS-RDS-BOUTIQUE', '16', 'Amazon RDS, Multi-AZ'], ['PAR-DB-01', '13', null]] },
  { catalog: 'veeam-backup-and-replication', installed: [['PAR-BKP-01', '12', null]] },
];

// Installations an older fixture wrote and the list above no longer declares, removed when the
// setup runs again: an installation someone added by hand stays.
const REMOVED_INSTALLATIONS = {
  vsphere: ['PAR-ESX-01', 'PAR-ESX-02', 'PAR-ESX-05'],
};

const PROCESS_APPLICATIONS = {
  'Order-to-Cash': ['SAP S/4HANA', 'La Boutique du Fromage', 'Salesforce Sales Cloud', 'Fromage B2B Portal'],
  'Procure-to-Pay': ['SAP S/4HANA', 'Coupa Procurement'],
  'Quality Control & Certification': ['QualityLab LIMS'],
  'Cheese Aging & Maturation': ['CaveGuard IoT', 'CheeseTrack'],
};

async function ensureAssetGraph() {
  info('Linking assets: clusters, contained VMs and storage dependencies');
  const assets = await getAll('/assets?limit=1000');
  const idOf = (name) => assets.find((item) => item.name === name)?.id ?? '';
  for (const [cluster, members] of Object.entries(ASSET_CLUSTERS)) {
    const clusterId = idOf(cluster);
    const memberIds = members.map(idOf);
    if (!clusterId || memberIds.some((id) => !id)) {
      warn(`Cluster '${cluster}' or one of its members is missing`);
      continue;
    }
    // The route replaces every membership row and writes an audit entry on each pass: write only
    // when the set of members differs.
    const current = new Set(items(await apiGet(`/assets/${clusterId}/members`)).map((item) => item.id));
    const wanted = new Set(memberIds);
    if (current.size === wanted.size && [...wanted].every((id) => current.has(id))) continue;
    await apiPost(`/assets/${clusterId}/members`, { asset_ids: [...wanted] });
  }
  const containerOf = new Map();
  for (const [container, contents] of Object.entries(ASSET_CONTAINS)) {
    for (const name of contents) containerOf.set(idOf(name), container);
  }
  containerOf.delete('');
  // The cluster comes before its hosts (`ASSET_CONTAINS` order): a host's `contains` is refused once
  // the cluster holds the VM, and the cluster's write absorbs the host links of older fixtures.
  const containers = [...new Set([...Object.keys(ASSET_CONTAINS), ...Object.keys(ASSET_DEPENDS_ON)])];
  for (const container of containers) {
    const containerId = idOf(container);
    if (!containerId) {
      warn(`Asset '${container}' not found`);
      continue;
    }
    // The relations already there stay, except a `contains` of an asset placed in another container:
    // the route replaces the whole set.
    const current = (await apiGet(`/assets/${containerId}/relations`))?.outgoing ?? [];
    const currentKeys = new Set();
    const relations = new Map();
    for (const relation of current) {
      if (!relation?.related_asset_id || !relation?.relation_type) continue;
      currentKeys.add(`${relation.relation_type}:${relation.related_asset_id}`);
      const placedIn = containerOf.get(relation.related_asset_id);
      if (relation.relation_type === 'contains' && placedIn && placedIn !== container) continue;
      relations.set(`${relation.relation_type}:${relation.related_asset_id}`, relation);
    }
    for (const name of ASSET_CONTAINS[container] ?? []) {
      const id = idOf(name);
      if (!id) {
        warn(`Asset '${name}' not found`);
        continue;
      }
      relations.set(`contains:${id}`, { related_asset_id: id, relation_type: 'contains' });
    }
    for (const name of ASSET_DEPENDS_ON[container] ?? []) {
      const id = idOf(name);
      if (!id) {
        warn(`Asset '${name}' not found`);
        continue;
      }
      relations.set(`depends_on:${id}`, { related_asset_id: id, relation_type: 'depends_on' });
    }
    // The route replaces every relation and writes an audit entry on each pass: write only when
    // the set of `type:id` keys differs.
    if (relations.size === currentKeys.size && [...relations.keys()].every((key) => currentKeys.has(key))) continue;
    await apiPost(`/assets/${containerId}/relations`, {
      relations: [...relations.values()].map((r) => ({ related_asset_id: r.related_asset_id, relation_type: r.relation_type, notes: r.notes ?? undefined })),
    });
  }
  ok('Asset graph ensured');
}

async function ensureApplicationServers() {
  info('Assigning applications to their servers');
  const assets = await getAll('/assets?limit=1000');
  for (const [appName, environment, server, role] of APP_SERVERS) {
    const assetId = assets.find((item) => item.name === server)?.id;
    const instanceId = await instanceIdByAppEnv(appName, environment);
    if (!assetId || !instanceId) {
      warn(`Cannot assign '${appName}' (${environment}) to '${server}'`);
      continue;
    }
    const current = items(await apiGet(`/app-instances/${instanceId}/servers`));
    if (current.some((row) => (row.asset_id ?? row.server_id) === assetId && row.role === role)) continue;
    await apiPost(`/app-instances/${instanceId}/servers`, { asset_id: assetId, role });
  }
  ok('Applications assigned to servers');
}

async function ensureTechnologies() {
  info('Ensuring technologies');
  const assets = await getAll('/assets?limit=1000');
  const assetId = (name) => assets.find((item) => item.name === name)?.id ?? '';
  for (const spec of TECHNOLOGIES) {
    const adopted = await apiPost('/technologies/adopt', { catalog_key: spec.catalog });
    const technologyId = adopted?.technology?.id;
    if (!technologyId) {
      warn(`Catalog entry '${spec.catalog}' could not be adopted`);
      continue;
    }
    const installed = spec.installed ?? [];
    for (const [server, version, notes] of installed) {
      const id = assetId(server);
      if (!id) {
        warn(`Asset '${server}' not found for '${spec.catalog}'`);
        continue;
      }
      await apiPost(`/technologies/${technologyId}/assets`, { asset_id: id, version_label: version ?? undefined, notes: notes ?? undefined });
    }
    // A technology carried from another server is another row (`kind: carried`).
    const removed = new Set(REMOVED_INSTALLATIONS[spec.catalog] ?? []);
    for (const row of removed.size ? items(await apiGet(`/technologies/${technologyId}/assets`)) : []) {
      if (row.kind !== 'installed' || !row.link_id || !removed.has(row.asset_name)) continue;
      await apiDelete(`/technologies/${technologyId}/assets/${row.link_id}`);
      ok(`Removed the installation of '${spec.catalog}' on '${row.asset_name}'`);
    }
    if (spec.declaredBy?.length) {
      const ids = await appIdsFromNames(spec.declaredBy);
      if (ids.length) await apiPost(`/technologies/${technologyId}/applications`, { application_ids: ids });
    }
    for (const contract of spec.contracts ?? []) {
      const contractId = await contractIdByName(contract);
      if (!contractId) {
        warn(`Contract '${contract}' not found`);
        continue;
      }
      await apiPost(`/technologies/${technologyId}/relations/contracts`, { id: contractId });
    }
    if (spec.owners?.length) {
      const owners = [];
      for (const [email, ownerType] of spec.owners) {
        const userId = await userIdByEmail(email);
        if (userId) owners.push({ user_id: userId, owner_type: ownerType });
        else warn(`User '${email}' not found`);
      }
      await apiPost(`/technologies/${technologyId}/owners/bulk-replace`, { owners });
    }
  }
  ok('Technologies ensured');
}

// ── Incidents ─────────────────────────────────────────────────────────────────
//
// The register of 31-incidents.csv, tied to the landscape: the cave gateway, the B2B portal
// database (PostgreSQL 13), the backup SAN near its end of life, the SQL Server cluster, the LIMS
// on SQL Server Express. One confidential incident, one with personal data notified to the
// authority, six with an incident review (five closed, the LIMS still in progress).
// 32-incident-journal.csv adds the human timeline of the B2B portal, the SAP close and the LIMS.
// 19b-incident-tasks.csv names those corrective tasks as INC-N. The import resolves that name as
// the tenant's own item number, which is a different incident once numbering has moved on, so the
// runner rewrites each row with the id of the incident whose title is row N of this register.

/** The incidents of 31-incidents.csv (by title) and what they affected. */
const INCIDENT_LINKS = {
  'Cave B humidity readings lost overnight': {
    applications: ['CaveGuard IoT', 'Cave Monitoring Dashboard'],
    assets: ['CAVE-GW-02', 'CAVE-SW-01'],
    technologies: ['Schneider EcoStruxure'],
  },
  'Phishing campaign against accounts payable': {
    applications: ['Okta Workforce Identity', 'Exchange Online'],
  },
  'SAP month-end close slowed down by host memory contention': {
    applications: ['SAP S/4HANA', 'SAP BW/4HANA'],
    assets: ['PAR-ESX-01', 'PAR-ERP-01', 'PAR-ERP-02'],
    technologies: ['VMware ESXi'],
  },
  'B2B portal down: database disk full': {
    applications: ['Fromage B2B Portal'],
    assets: ['PAR-DB-01'],
    technologies: ['PostgreSQL'],
  },
  'Order confirmations sent to the wrong customers': {
    applications: ['La Boutique du Fromage'],
  },
  'Veeam backup jobs failing on the backup SAN': {
    applications: ['Veeam Backup & Replication'],
    assets: ['PAR-SAN-02', 'PAR-BKP-01'],
  },
  'CheeseTrack offline during SQL Server cluster failover': {
    applications: ['CheeseTrack'],
    assets: ['PAR-SQL-01', 'PAR-SQL-02'],
    technologies: ['Microsoft SQL Server'],
  },
  'Microsoft Teams outage in Western Europe': {
    applications: ['Microsoft Teams'],
  },
  'Lab results cannot be saved in QualityLab LIMS': {
    applications: ['QualityLab LIMS'],
    assets: ['PAR-APP-01'],
    technologies: ['Microsoft SQL Server'],
  },
  'VPN to the Gouda site keeps dropping': {
    applications: ['Sage X3'],
    assets: ['GOU-FW-01', 'PAR-FW-01'],
    technologies: ['FortiOS'],
  },
};

const csvCell = (value) => (/[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Imports CSV rows built here ([headers, ...rows]) into the incident register. */
async function importIncidentRows(table, label) {
  const text = table.map((cells) => cells.map((cell) => csvCell(cell ?? '')).join(';')).join('\n');
  const result = await request('POST', '/incidents/import?dryRun=false&mode=enrich', undefined, {
    uploadBytes: Buffer.from(text, 'utf8'),
    uploadName: '31-incidents.csv',
  });
  if (result?.ok === false) throw new Error(`Incident import (${label}) returned ok=false:\n${JSON.stringify(result, null, 2)}`);
}

/**
 * Creates the incidents of 31-incidents.csv that the register does not hold yet (a rerun creates
 * none) and links them. A closed incident refuses every change, so the new ones are imported as
 * resolved, linked, then closed by a second import that names them by reference.
 */
async function ensureIncidents() {
  const name = '31-incidents.csv';
  info(`Importing ${name}`);
  const existing = new Set((await getAll('/incidents?limit=1000')).map((item) => lower(item.title)));
  const rows = readCsv(name).filter((row) => !existing.has(lower(row.title)));
  if (rows.length === 0) {
    ok(`${name}: every incident is already there`);
    return;
  }
  const headers = Object.keys(rows[0]);
  const closedAt = headers.find((header) => header.startsWith('closed_at'));
  const isClosed = (row) => lower(row.status) === 'closed';
  await importIncidentRows([
    headers,
    ...rows.map((row) => headers.map((header) => {
      if (isClosed(row) && header === 'status') return 'resolved';
      if (isClosed(row) && header === closedAt) return '';
      return row[header];
    })),
  ], 'new incidents');

  info('Linking incidents to applications, assets and technologies');
  const incidents = await getAll('/incidents?limit=1000');
  const assets = await getAll('/assets?limit=1000');
  const technologies = await getAll('/technologies?limit=1000');
  const idsOf = (list, names, kind, title) => names.map((item) => {
    const id = list.find((candidate) => candidate.name === item)?.id;
    if (!id) warn(`${kind} '${item}' not found for incident '${title}'`);
    return id;
  }).filter(Boolean);
  const incidentOf = (title) => incidents.find((item) => item.title === title);
  for (const row of rows) {
    const incident = incidentOf(row.title);
    if (!incident) {
      warn(`Incident '${row.title}' not found after the import`);
      continue;
    }
    const links = INCIDENT_LINKS[row.title] ?? {};
    if (links.applications?.length) {
      await apiPost(`/incidents/${incident.id}/applications/bulk-replace`, { application_ids: await appIdsFromNames(links.applications) });
    }
    if (links.assets?.length) {
      await apiPost(`/incidents/${incident.id}/assets/bulk-replace`, { asset_ids: idsOf(assets, links.assets, 'Asset', row.title) });
    }
    if (links.technologies?.length) {
      await apiPost(`/incidents/${incident.id}/technologies/bulk-replace`, { technology_ids: idsOf(technologies, links.technologies, 'Technology', row.title) });
    }
  }

  const closing = rows.filter(isClosed).filter((row) => incidentOf(row.title)?.item_number);
  if (closing.length) {
    await importIncidentRows([
      ['ref', 'title', 'severity', 'status', closedAt],
      ...closing.map((row) => [`INC-${incidentOf(row.title).item_number}`, row.title, row.severity, 'closed', row[closedAt]]),
    ], 'closure');
  }
  ok(`Imported and linked ${rows.length} incident(s)`);
}

/**
 * Imports 19b-incident-tasks.csv with each INC-N replaced by the id of the incident whose title
 * is row N of 31-incidents.csv. The file on disk stays as INC-N. A title the tenant does not
 * hold is a warning, and the other tasks are still imported. A re-run sends the same ids: the
 * task import matches on the title and leaves an unchanged task as it is.
 */
async function importIncidentTasks() {
  const name = '19b-incident-tasks.csv';
  info(`Importing ${name}`);
  const tasks = readCsv(name);
  const titles = readCsv('31-incidents.csv').map((row) => row.title);
  const incidents = await getAll('/incidents?limit=1000');
  const linked = rewriteIncidentTaskLinks(tasks, titles, incidents);
  for (const message of linked.warnings) warn(message);
  if (linked.rows.length === 0) {
    if (linked.warnings.length === 0) warn(`${name}: no task to import`);
    return;
  }
  const headers = Object.keys(linked.rows[0]).filter((header) => header !== 'related_object_id');
  const nameAt = headers.indexOf('related_object_name');
  headers.splice(nameAt >= 0 ? nameAt : headers.length, 0, 'related_object_id');
  const table = [headers, ...linked.rows.map((row) => headers.map((header) => row[header] ?? ''))];
  const text = table.map((cells) => cells.map((cell) => csvCell(String(cell ?? ''))).join(';')).join('\n');
  const result = await request('POST', '/tasks/import?dryRun=false', undefined, {
    uploadBytes: Buffer.from(text, 'utf8'),
    uploadName: name,
  });
  if (result?.ok === false) throw new Error(`${name} import returned ok=false:\n${JSON.stringify(result, null, 2)}`);
  ok(`Imported ${name}`);
}

/**
 * Imports the human timeline of 32-incident-journal.csv. The server route takes the author and
 * the event time from each row, so the entries are signed by the incident people and backdated
 * to the facts; `created_at` stays the load time. A row already there is skipped, so a re-run
 * adds nothing. The route only accepts the file while the tenant's sample data is loading: a
 * manual run on the dev stack gets a 409 `SAMPLE_DATA_LOAD_ONLY` and continues without the
 * journal, which the lead then completes by hand.
 */
async function importIncidentJournal() {
  const name = '32-incident-journal.csv';
  info(`Importing ${name}`);
  try {
    const result = await uploadCsv('/incidents/import-journal', name);
    if (result?.ok === false) throw new Error(`${name} import returned ok=false:\n${JSON.stringify(result, null, 2)}`);
    const imported = Number(result?.imported ?? 0);
    const skipped = Number(result?.skipped ?? 0);
    ok(`Imported ${imported} journal entr${imported === 1 ? 'y' : 'ies'} (${skipped} already there)`);
  } catch (error) {
    if (error?.status === 409 && error?.payload?.code === 'SAMPLE_DATA_LOAD_ONLY') {
      info(`Skipped ${name}: the journal is imported only while the sample data of the tenant loads.`);
      return;
    }
    throw error;
  }
}

async function linkProcessesToApplications() {
  info('Linking business processes to applications');
  const processes = await getAll('/business-processes?limit=500');
  for (const [processName, appNames] of Object.entries(PROCESS_APPLICATIONS)) {
    const processId = processes.find((item) => item.name === processName)?.id;
    if (!processId) {
      warn(`Business process '${processName}' not found`);
      continue;
    }
    for (const applicationId of await appIdsFromNames(appNames)) {
      await apiPost(`/business-processes/${processId}/applications`, { application_id: applicationId });
    }
  }
  ok('Business processes linked to applications');
}

async function runRelations() {
  step('application-links');
  await linkSuites();
  await linkApplicationDepartments();
  step('landscape');
  await ensureAppInstances();
  await ensureMiddlewareEtlEnabled();
  await ensureInterfaces();
  const refToId = await ensureConnections();
  await ensureConnectionLegs(refToId);
  await ensureInterfaceBindings();
  await ensureInterfaceConnectionLinks(refToId);
  await ensureAssetGraph();
  await ensureApplicationServers();
  await ensureTechnologies();
  await linkProcessesToApplications();
  await ensureIncidents();
  step('incident-tasks');
  await importIncidentTasks();
  step('incident-journal');
  await importIncidentJournal();
  step('budget-links');
  await linkContractsToSpend();
  await linkSpendToApps();
  step('portfolio-teams');
  await ensurePortfolioTeamsAndCapacity();
  await ensureProjectPhases();
  await ensureProjectTeams();
  step('allocations');
  await ensureCompanyAllocations();
}

async function main() {
  if (options.contactSuppliersOnly) {
    // An existing tenant only: no trial bootstrap when the login fails.
    await detectApiPrefix();
    info(`Trying to authenticate as ${options.email} on ${options.baseUrl}`);
    if (!(await tryLogin())) throw new Error(`Login failed as ${options.email}: --contact-suppliers-only needs an existing tenant`);
    await linkContactsToSuppliers();
    return;
  }
  if (!serverMode) {
    await detectApiPrefix();
    await ensureTenant();
  }
  step('settings');
  await setupSettings();
  step('classification');
  await ensurePortfolioClassification();
  const language = await ensureRecommendedDimensions();
  await ensureAnalyticsAxes(language);
  await runImports(language);
  if (!options.skipRelations) await runRelations();
  step('knowledge');
  await ensureServiceDeskDocs();
  if (!options.skipAgents) await ensureDemoAgent();

  const users = readCsv('10-users.csv');
  const others = `${users[0]?.email} (and ${users.length - 1} others)`;
  if (serverMode) {
    if (warnings > 0) throw new Error(`The load is incomplete: ${warnings} warning(s) above.`);
    ok('Fromage & Co demo data loaded');
    say(`  Demo users:   ${others}, no password, no invitation`);
    return;
  }
  ok('Fromage & Co fixture setup complete');
  console.log('');
  console.log(`  App URL:      ${options.baseUrl}`);
  console.log(`  Tenant admin: ${options.email}`);
  console.log(options.demoPassword
    ? `  Demo users:   ${others}, password passed with --demo-password`
    : `  Demo users:   ${others}, no password set (--demo-password was empty)`);
  if (!options.skipAgents) {
    console.log(`  Demo agent:   '${AGENT_NAME}' (mock ticketing) — check the Agents pages`);
    console.log(`  Knowledge:    '${SERVICE_DESK_LIBRARY}' library — the demo tickets find their answers there`);
  }
}

const startedAt = Date.now();
main()
  .catch((error) => {
    // The message names the route and the server's answer, never the request headers.
    if (serverMode) process.stderr.write(`[ERR]  ${error.message}\n`);
    else console.error(`[ERR]  ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    const requests = tenantClient.stats.requests + (publicClient?.stats.requests ?? 0);
    const retries = tenantClient.stats.retries + (publicClient?.stats.retries ?? 0);
    info(`${requests} HTTP requests (${retries} retried) in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    tenantClient.close();
    publicClient?.close();
  });
