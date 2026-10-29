#!/usr/bin/env node
// Generates the budget part of the Fromage & Co fixture: cost centres,
// analytics values, working-day calendars, OPEX and CAPEX items, costed lines
// (quantity × price) and monthly budget rows. Deterministic: the same input
// always gives the same files, so the CSVs can be reviewed in a diff.
//
//   node backend/fixtures/fromage-co/tools/generate-budget.mjs
//
// Story: end of September 2026. The IT division of Fromage & Co budgets like a
// mid-sized group: three divisions, twelve cost centres over four legal
// entities, about 40 % of the OPEX in external staffing priced per working
// day, four budget rounds a year. 2027 is left empty on purpose: the demo
// initialises it by copying the 2026 landing.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (name, rows) => {
  const text = rows.map((r) => r.map(csvCell).join(';')).join('\n') + '\n';
  writeFileSync(path.join(ROOT, name), text, 'utf8');
  console.log(`${name}: ${rows.length - 1} rows`);
};
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ── Deterministic pseudo-random ─────────────────────────────────────────────
let seed = 20261001;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const between = (a, b) => a + (b - a) * rnd();
const pick = (list) => list[Math.floor(rnd() * list.length)];
const round = (v, step = 1) => Math.round(v / step) * step;

// ── Calendars ───────────────────────────────────────────────────────────────
const YEARS = [2025, 2026, 2027];
// The story is told at the end of September 2026: an item whose end of validity is before this date imports as disabled.
const STORY_DATE = '2026-10-01';
const statusFor = (end) => (end && end < STORY_DATE ? 'disabled' : 'enabled');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
function frenchHolidays(y) {
  const e = easter(y);
  return new Set([`${y}-01-01`, iso(addDays(e, 1)), `${y}-05-01`, `${y}-05-08`, iso(addDays(e, 39)), iso(addDays(e, 50)),
    `${y}-07-14`, `${y}-08-15`, `${y}-11-01`, `${y}-11-11`, `${y}-12-25`]);
}
/** Weekdays minus French public holidays, per month. */
function frenchWorkingDays(y) {
  const holidays = frenchHolidays(y);
  const days = Array(12).fill(0);
  for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y; d = addDays(d, 1)) {
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || holidays.has(iso(d))) continue;
    days[d.getUTCMonth()] += 1;
  }
  return days;
}
/** Scale a year's working days to a yearly total (leave spread evenly), one decimal, exact total. */
function scaleTo(days, total) {
  const sum = days.reduce((a, b) => a + b, 0);
  const scaled = days.map((d) => Math.round((d * total / sum) * 10) / 10);
  const diff = Math.round((total - scaled.reduce((a, b) => a + b, 0)) * 10) / 10;
  scaled[11] = Math.round((scaled[11] + diff) * 10) / 10;
  return scaled;
}
const WORKING = Object.fromEntries(YEARS.map((y) => [y, frenchWorkingDays(y)]));
const CAD218 = Object.fromEntries(YEARS.map((y) => [y, scaleTo(WORKING[y], 218)]));

const calendarRows = [['code', 'name', 'description', 'country', 'region', 'status', 'year', ...MONTHS]];
for (const [code, name, country] of [['FR', 'France', 'FR'], ['NL', 'Netherlands', 'NL'], ['IT', 'Italy', 'IT'], ['US', 'United States', 'US']]) {
  calendarRows.push([code, name, 'Standard calendar, public holidays', country, '', 'enabled', '', ...Array(12).fill('')]);
}
for (const y of YEARS) calendarRows.push(['CAD218', '218 working days', 'French managers on a days-based contract: 218 working days a year, leave spread over the year', '', '', 'enabled', y, ...CAD218[y]]);
for (const y of YEARS) calendarRows.push(['SANSCONGES', 'No leave', 'Weekdays less public holidays, no leave: services billed per day actually worked', '', '', 'enabled', y, ...WORKING[y]]);
out('28-working-day-calendars.csv', calendarRows);

// ── Organisation ─────────────────────────────────────────────────────────────
const FR = 'Fromage & Co SA', NL = 'Kaasmeester BV', IT = 'Formaggio Supremo SRL', US = 'Fromage & Co Inc.';
const COUNTRY = { [FR]: 'FR', [NL]: 'NL', [IT]: 'IT', [US]: 'US' };
const CURRENCY = { [FR]: 'EUR', [NL]: 'EUR', [IT]: 'EUR', [US]: 'USD' };
const STAFF_CAL = { [FR]: 'CAD218', [NL]: 'NL', [IT]: 'IT', [US]: 'US' };

const GROUPS = [
  ['DSI-GRP', 'Group IT', '', 'The group information systems department'],
  ['DIV-DIS', 'Distribution & food service division', 'DSI-GRP', 'Systems for sales to distributors and food service'],
  ['DIV-BOU', 'Shops & e-commerce division', 'DSI-GRP', 'Shop and online sales systems'],
  ['DIV-TRV', 'Shared functions', 'DSI-GRP', 'Infrastructure, workplace, security and IT management'],
];
const CC = [
  // code, name, group, company, owner, description
  ['FR-DIS-100', 'Distribution project management', 'DIV-DIS', FR, 'clara.dupont@fromage-co.example', 'Projects for B2B sales systems, EDI and the distributor portal'],
  ['FR-DIS-200', 'Distribution engineering and deployment', 'DIV-DIS', FR, 'lucas.bernard@fromage-co.example', 'Build and deployment of the division applications'],
  ['FR-DIS-300', 'Distribution back-office operations', 'DIV-DIS', FR, 'pierre.martin@fromage-co.example', 'Operation of the sales management and logistics systems'],
  ['NL-DIS-300', 'Distribution operations Benelux', 'DIV-DIS', NL, 'jan.bakker@kaasmeester.example', 'Operation of the Dutch subsidiary systems'],
  ['FR-BOU-100', 'Shops & e-commerce project management', 'DIV-BOU', FR, 'amelie.rousseau@fromage-co.example', 'Shop, e-commerce and subscription projects'],
  ['FR-BOU-310', 'Front-office operations (shops and e-commerce)', 'DIV-BOU', FR, 'nadia.lemaire@fromage-co.example', 'Operation of the tills, the online shop and the shop tools'],
  ['IT-BOU-310', 'Front-office operations Italy', 'DIV-BOU', IT, 'luca.ferrari@formaggio-supremo.example', 'Operation of the Italian subsidiary shops and systems'],
  ['US-BOU-310', 'E-commerce North America', 'DIV-BOU', US, 'mike.johnson@fromage-co.example', 'Online shop and systems of the US subsidiary'],
  ['FR-TRV-400', 'Infrastructure and cloud', 'DIV-TRV', FR, 'marc.petit@fromage-co.example', 'Group data centers, cloud, network and telecom'],
  ['FR-TRV-500', 'Workplace and support', 'DIV-TRV', FR, 'olivier.garnier@fromage-co.example', 'Workstations, collaboration tools and service desk'],
  ['FR-TRV-600', 'Security', 'DIV-TRV', FR, 'ines.chevalier@fromage-co.example', 'Information security and compliance'],
  ['FR-TRV-700', 'IT management and controlling', 'DIV-TRV', FR, 'maria.casanova@fromage-co.example', 'IT management, controlling, IT procurement, training'],
];
const ccRows = [['code', 'kind', 'name', 'parent_code', 'company_name', 'owner_email', 'description', 'status']];
for (const [code, name, parent, description] of GROUPS) ccRows.push([code, 'group', name, parent, '', '', description, 'enabled']);
for (const [code, name, parent, company, owner, description] of CC) ccRows.push([code, 'cost_center', name, parent, company, owner, description, 'enabled']);
out('26-cost-centers.csv', ccRows);
const ccCompany = Object.fromEntries(CC.map((c) => [c[0], c[3]]));
const ccOwner = Object.fromEntries(CC.map((c) => [c[0], c[4]]));

// ── Analytics dimensions ────────────────────────────────────────────────────
// Cost pool (the default dimension), IT tower, purpose, priority and recurrence are the
// recommended dimensions a tenant starts with (backend/src/analytics/recommended-dimensions.seed.ts,
// recurrence added by the runner): the files name their values in English, as the seed of an
// English tenant does, and the runner maps them to the tenant's language. Business domain and
// budget reference are the fixture's own dimensions: 27-analytics-values.csv holds their values
// in English, and the runner names the axes and the values in the tenant's language.
//
// Each line still carries the kind of expense of the earlier fixture (licence, saas, cloud…):
// it gives the cost pool, and its domain gives the IT tower and the business domain, unless the
// line's name says otherwise (CLASSIFY_LINE).
const COST_POOLS = ['Hardware', 'Software', 'Internal labor', 'External labor', 'Outside services', 'Facilities and power', 'Telecom', 'Other'];
const IT_TOWERS = ['Data center', 'Compute', 'Storage', 'Network', 'Platform', 'Output', 'End user', 'Application', 'Delivery', 'Security and compliance', 'IT management'];
const PURPOSES = ['Replacement', 'Capacity', 'Productivity', 'Security', 'Compliance', 'Business growth', 'Other'];
const PRIORITIES = ['Mandatory', 'High', 'Medium', 'Low'];
const POOL_OF_KIND = {
  licence: 'Software', saas: 'Software', cloud: 'Outside services', telecom: 'Telecom', staff: 'External labor',
  cdc: 'External labor', managed: 'Outside services', hardware: 'Hardware', consulting: 'External labor', training: 'Other', travel: 'Other',
};
const BUSINESS_DOMAINS = [
  ['ERP', 'Finance, purchasing, sales administration and logistics on SAP and Sage'],
  ['CRM', 'Customer relationship management for distribution and subscribers'],
  ['E-commerce', 'Online shops, B2B portal and payment'],
  ['Retail', 'Shops and points of sale'],
  ['Supply chain', 'Warehouses, EDI, product information and logistics'],
  ['Traceability', 'Cold chain, cave monitoring and product traceability'],
  ['HR', 'Human capital management and payroll'],
  ['Data and analytics', 'Data platform, BI and reporting'],
  ['Shared IT', 'Infrastructure, workplace, security and IT management that serve every business'],
];
// The domain of a line (the earlier fixture's default dimension) -> [IT tower, business domain].
const OF_DOMAIN = {
  Productivity: ['End user', 'Shared IT'],
  ERP: ['Application', 'ERP'],
  CRM: ['Application', 'CRM'],
  'E-commerce': ['Application', 'E-commerce'],
  Retail: ['Application', 'Retail'],
  'Supply Chain': ['Application', 'Supply chain'],
  Traceability: ['Application', 'Traceability'],
  ITSM: ['Delivery', 'Shared IT'],
  HR: ['Application', 'HR'],
  Security: ['Security and compliance', 'Shared IT'],
  Infrastructure: ['Compute', 'Shared IT'],
  Network: ['Network', 'Shared IT'],
  Workplace: ['End user', 'Shared IT'],
  Monitoring: ['Delivery', 'Shared IT'],
  IoT: ['Application', 'Traceability'],
  Analytics: ['Platform', 'Data and analytics'],
  'IT Management': ['IT management', 'Shared IT'],
};
// Lines (by name, or by profile for external staffing) whose name, supplier or account says more
// than their kind and domain.
const CLASSIFY_LINE = {
  'Paris data center — hosting and power': { pool: 'Facilities and power', tower: 'Data center' },
  'Printing — cost-per-page contract': { pool: 'Outside services', tower: 'Output' },
  'Annual penetration tests': { pool: 'Outside services' },
  'License audit': { pool: 'Outside services' },
  'E-commerce — UX research and user testing': { pool: 'Outside services' },
  'E-commerce — product photos and content': { pool: 'Outside services' },
  'Distribution — performance testing': { pool: 'Outside services' },
  'Analyst research subscriptions': { pool: 'Outside services' },
  'IT recruitment': { pool: 'Internal labor' },
  'US Office IT Services': { pool: 'Software' },
  'Veeam Backup & Replication': { tower: 'Storage' },
  'Network & Telecom Services': { tower: 'Network' },
  'Kaasmeester — KPN connectivity': { tower: 'Network' },
  'US Telecom & Internet': { tower: 'Network' },
  'Generix EDI Platform': { tower: 'Platform' },
  'Fromage B2B Portal hosting': { tower: 'Compute' },
  'La Boutique — CDN and application security': { tower: 'Network' },
  'Shops — till and printer maintenance': { tower: 'End user' },
  'Shops — 4G backup': { business: 'Retail' },
  'AWS Cloud Hosting': { business: 'E-commerce' },
  'US e-commerce — AWS hosting': { business: 'E-commerce' },
  'Managed services — Axians': { tower: 'Delivery' },
  'Old Intranet — hosting': { tower: 'Compute' },
  'IT Staff Augmentation': { tower: 'Application' },
  'Power BI Premium': { tower: 'Application' },
  'Azure — data consumption': { tower: 'Compute' },
  'Data analyst': { tower: 'Application' },
  'Level 2 till support': { tower: 'End user' },
  'Sistemista punti vendita': { tower: 'End user' },
  'Sviluppatore integrazioni': { tower: 'Platform' },
  'Integration architect': { tower: 'Platform' },
  'SAP Basis administrator': { tower: 'Platform' },
  'E-commerce DevOps engineer': { tower: 'Platform' },
  'Site reliability engineer': { tower: 'Platform' },
  'S/4HANA — HANA servers': { tower: 'Compute' },
  'Shops — till replacement': { tower: 'End user' },
  'Formaggio — nuove casse punti vendita': { tower: 'End user' },
  'CaveGuard — rollout to all 8 caves': { tower: 'End user' },
  'Data platform — build': { tower: 'Platform' },
};
// Why an OPEX project line (run/build = build) is spent: by its budget reference, else by name.
// Run lines have no purpose.
const PURPOSE_OF_REFERENCE = { sap: 'Replacement', ecom: 'Business growth', zt: 'Security', data: 'Business growth' };
const PURPOSE_OF_LINE = {
  'Cybersecurity Consulting & Audits': 'Security',
  'Distribution — performance testing': 'Capacity',
  'Distribution — user training': 'Productivity',
  'E-commerce — product photos and content': 'Business growth',
  'Consulting — IT master plan': 'Other',
  'EDI project manager': 'Productivity',
  'Sales business analyst': 'Business growth',
  'Integration architect': 'Replacement',
  'B2B portal developer': 'Business growth',
  'Projectleider WMS': 'Replacement',
  'Sviluppatore integrazioni': 'Productivity',
  'E-commerce engineer': 'Business growth',
  'DC refresh project manager': 'Replacement',
  'Workday project manager': 'Replacement',
  'Workday payroll consultant': 'Replacement',
};
const oneOf = (list, value, what, key) => {
  if (!list.includes(value)) throw new Error(`${key}: '${value}' is no ${what}`);
  return value;
};
/** [cost pool, IT tower, business domain] of a line, from its kind of expense, its domain and its name. */
function classify(key, kind, domain) {
  const line = CLASSIFY_LINE[key] ?? {};
  const [tower, business] = OF_DOMAIN[domain] ?? [];
  return [
    oneOf(COST_POOLS, line.pool ?? POOL_OF_KIND[kind], 'cost pool', key),
    oneOf(IT_TOWERS, line.tower ?? tower, 'IT tower', key),
    oneOf(BUSINESS_DOMAINS.map(([name]) => name), line.business ?? business, 'business domain', key),
  ];
}
/** The purpose of an OPEX line: project lines only. */
function opexPurpose(key, runBuild, reference) {
  if (runBuild !== 'build') return '';
  return oneOf(PURPOSES, PURPOSE_OF_LINE[key] ?? PURPOSE_OF_REFERENCE[reference], 'purpose', key);
}
const REFERENCE = {
  ecom: ['REF-ECOM-CDC', 'E-commerce competence center: outsourced squad, OPEX and CAPEX lines, changing suppliers'],
  sap: ['REF-SAP-S4', 'S/4HANA program: functional and technical contractors, hardware and capitalized development'],
  data: ['REF-DATA', 'Group data platform: licenses, hosting and engineering'],
  zt: ['REF-SECU-ZT', 'Zero Trust program: audits, tooling and rollout'],
};
const RECURRENCE = { yes: 'Recurring', no: 'One-off' };
const valueRows = [['axis_code', 'name', 'description', 'status']];
for (const [name, description] of BUSINESS_DOMAINS) valueRows.push(['business_domain', name, description, 'enabled']);
for (const [code, description] of Object.values(REFERENCE)) valueRows.push(['reference', code, description, 'enabled']);
out('27-analytics-values.csv', valueRows);

// ── Accounts per legal entity ───────────────────────────────────────────────
const ACCOUNT = {
  [FR]: { saas: '612100', licence: '612200', cloud: '613100', security: '613200', data: '613300', maint: '615100', telecom: '616100', dc: '616200', staff: '621100', consulting: '622100', dev: '622200', training: '618100', travel: '625100' },
  [NL]: { saas: '45100', licence: '45200', cloud: '45300', security: '45400', data: '45500', maint: '46100', telecom: '46200', dc: '46300', staff: '47100', consulting: '47200', dev: '47100', training: '48100', travel: '48200' },
  [IT]: { saas: '6501', licence: '6502', cloud: '6503', security: '6504', data: '6505', maint: '6601', telecom: '6602', dc: '6603', staff: '6701', consulting: '6702', dev: '6701', training: '6801', travel: '6802' },
  [US]: { saas: '7110', licence: '7120', cloud: '7130', security: '7140', data: '7150', maint: '7210', telecom: '7220', dc: '7230', staff: '7310', consulting: '7320', dev: '7310', training: '7410', travel: '7420' },
};

// Capitalised accounts of each legal entity, for the CAPEX lines: software and
// licences go to the intangible one, hardware and infrastructure to equipment.
// The numbers exist in that entity's chart (02- to 06-accounts-*.csv).
const ASSET = {
  [FR]: { intangible: '205000', tangible: '218300' },
  [NL]: { intangible: '01100', tangible: '02100' },
  [IT]: { intangible: '205000', tangible: '215000' },
  [US]: { intangible: '151000', tangible: '161000' },
};
const assetAccount = (company, asset) => ASSET[company][asset === 'Hardware' ? 'tangible' : 'intangible'];

// ── OPEX items ──────────────────────────────────────────────────────────────
// Existing lines of the fixture, now attached to a cost centre and classified.
// [product_name, cost centre, run/build, kind, recurrence, reference, domain]
const EXISTING = [
  ['Microsoft Enterprise (M365 + Azure + GitHub)', 'FR-TRV-500', 'run', 'licence', 'yes', '', 'Productivity'],
  ['SAP S/4HANA Maintenance', 'FR-DIS-300', 'run', 'licence', 'yes', '', 'ERP'],
  ['SAP BW/4HANA License', 'FR-TRV-700', 'run', 'licence', 'yes', 'data', 'Analytics'],
  ['Salesforce (Sales + Service Cloud)', 'FR-DIS-300', 'run', 'saas', 'yes', '', 'CRM'],
  ['ServiceNow ITSM Platform', 'FR-TRV-500', 'run', 'saas', 'yes', '', 'ITSM'],
  ['Workday HCM', 'FR-TRV-500', 'run', 'saas', 'yes', '', 'HR'],
  ['OVHcloud Infrastructure', 'FR-TRV-400', 'run', 'cloud', 'yes', '', 'Infrastructure'],
  ['AWS Cloud Hosting', 'FR-BOU-310', 'run', 'cloud', 'yes', 'ecom', 'Infrastructure'],
  ['Datadog Monitoring', 'FR-TRV-400', 'run', 'saas', 'yes', '', 'Monitoring'],
  ['Okta Workforce Identity', 'FR-TRV-600', 'run', 'saas', 'yes', 'zt', 'Security'],
  ['Sophos Enterprise Security', 'FR-TRV-600', 'run', 'licence', 'yes', '', 'Security'],
  ['VMware vSphere Licensing', 'FR-TRV-400', 'run', 'licence', 'yes', '', 'Infrastructure'],
  ['CaveGuard IoT Platform', 'FR-DIS-300', 'run', 'saas', 'yes', '', 'IoT'],
  ['CheeseTrack SaaS', 'FR-DIS-300', 'run', 'saas', 'yes', '', 'Traceability'],
  ['Network & Telecom Services', 'FR-TRV-400', 'run', 'telecom', 'yes', '', 'Infrastructure'],
  ['IT Staff Augmentation', 'FR-TRV-700', 'run', 'staff', 'no', '', 'IT Management'],
  ['Managed services — Axians', 'FR-TRV-400', 'run', 'managed', 'yes', '', 'Workplace'],
  ['Cybersecurity Consulting & Audits', 'FR-TRV-600', 'build', 'consulting', 'no', 'zt', 'Security'],
  ['Various SaaS Bundle', 'FR-TRV-500', 'run', 'saas', 'yes', '', 'Productivity'],
  ['Fortinet FortiCare & FortiGuard', 'FR-TRV-600', 'run', 'licence', 'yes', '', 'Security'],
  ['IT Training & Certification', 'FR-TRV-700', 'run', 'training', 'yes', '', 'IT Management'],
  ['IT Travel & Events', 'FR-TRV-700', 'run', 'travel', 'yes', '', 'IT Management'],
  ['Sage X3 Licenties — Kaasmeester', 'NL-DIS-300', 'run', 'licence', 'yes', '', 'ERP'],
  ['Sage X3 Licenze — Formaggio Supremo', 'IT-BOU-310', 'run', 'licence', 'yes', '', 'ERP'],
  ['US Office IT Services', 'US-BOU-310', 'run', 'managed', 'yes', '', 'Productivity'],
  ['US Managed IT Services', 'US-BOU-310', 'run', 'managed', 'yes', '', 'Workplace'],
  ['US Telecom & Internet', 'US-BOU-310', 'run', 'telecom', 'yes', '', 'Infrastructure'],
];
// Landing stories on existing lines (ratio landing / budget 2026), else a small drift.
const EXISTING_LANDING = {
  'AWS Cloud Hosting': 1.18,                 // e-commerce accelerated
  'Various SaaS Bundle': 0.9,                // bundle renegotiated
  'OVHcloud Infrastructure': 0.55,           // ends in June 2026 (contract not renewed)
};

const existingHeader = readFileSync(path.join(ROOT, '14-spend-items.csv'), 'utf8').split('\n')[0].split(';');
const existingRows = parseCsv(readFileSync(path.join(ROOT, '14-spend-items.csv'), 'utf8'));
const byName = Object.fromEntries(existingRows.map((r) => [r.product_name, r]));

const OPEX_HEADER = ['product_name', 'description', 'supplier_name', 'company_name', 'account_number', 'currency', 'effective_start', 'status', 'disabled_at',
  'owner_it_email', 'owner_business_email', 'analytics:default', 'analytics:it_tower', 'analytics:business_domain', 'analytics:purpose',
  'analytics:reference', 'analytics:recurrence', 'cost_center_code', 'run_build', 'notes',
  'y_minus1_budget', 'y_minus1_landing', 'y_budget', 'y_follow_up', 'y_landing', 'y_revision', 'y_plus1_budget', 'y_plus1_revision'];

const opexRows = [OPEX_HEADER];
const budgetRows = [['item_type', 'item_name', 'year', 'measure', 'period_start', 'period_end', ...MONTHS]];
const lineRows = [['item_type', 'item_name', 'year', 'measure', 'label', 'quantity_unit', 'quantity', 'unit_price', 'price_basis', 'frequency', 'days_per_month', 'period_start', 'period_end', 'calendar_code']];

/** Monthly amounts of a flat yearly total within [startMonth, endMonth] (1-based, inclusive). */
function flat(total, startMonth = 1, endMonth = 12) {
  const n = endMonth - startMonth + 1;
  const per = Math.round((total / n) * 100) / 100;
  return MONTHS.map((_, i) => (i + 1 >= startMonth && i + 1 <= endMonth ? per : 0));
}
/** Actuals January to August from monthly landing values, with small noise. */
function actuals(landingMonths) {
  return landingMonths.map((v, i) => (i < 8 ? round(v * between(0.97, 1.03), 1) : 0));
}
function pushActuals(type, name, landingMonths) {
  budgetRows.push([type, name, 2026, 'actual', '2026-01-01', '2026-08-31', ...actuals(landingMonths)]);
}
function pushForecast(type, name, months) {
  budgetRows.push([type, name, 2026, 'forecast', '2026-01-01', '2026-12-31', ...months]);
}

// Existing lines: keep every value, attach the organisation, empty 2027.
for (const [name, cc, runBuild, kind, recurrence, reference, domain] of EXISTING) {
  const r = byName[name];
  if (!r) throw new Error(`Existing line not found: ${name}`);
  const budget = Number(r.y_budget);
  const ratio = EXISTING_LANDING[name] ?? between(0.98, 1.03);
  const landing = round(budget * ratio, 500);
  const revision = rnd() < 0.5 ? round(budget * between(0.98, 1.02), 500) : '';
  opexRows.push([r.product_name, r.description, r.supplier_name, r.company_name, r.account_number, r.currency, r.effective_start, statusFor(r.disabled_at), r.disabled_at,
    r.owner_it_email, r.owner_business_email, ...classify(name, kind, domain), opexPurpose(name, runBuild, reference),
    reference ? REFERENCE[reference][0] : '', RECURRENCE[recurrence], cc, runBuild, r.notes,
    r.y_minus1_budget, r.y_minus1_landing, budget, '', landing, revision, '', '']);
  const endMonth = r.disabled_at?.startsWith('2026-') ? Number(r.disabled_at.slice(5, 7)) : 12;
  const landingMonths = flat(landing, 1, endMonth);
  pushActuals('opex', name, landingMonths);
  if (rnd() < 0.3) pushForecast('opex', name, flat(round(budget * between(0.98, 1.04), 500)));
}

// New non-staffing lines. [name, description, supplier, cost centre, account key, domain, kind, run/build, recurrence, reference, budget 2026, start, end, landing ratio]
const NEW_LINES = [
  // Distribution & food service
  ['Generix EDI Platform', 'EDI exchanges with retail chains and contract catering', 'Generix Group', 'FR-DIS-300', 'saas', 'Supply Chain', 'saas', 'run', 'yes', '', 96000, '2023-01-01', '', 1.0],
  ['Fromage B2B Portal hosting', 'Hosting and operation of the distributor portal', '', 'FR-DIS-300', 'cloud', 'E-commerce', 'cloud', 'run', 'yes', '', 42000, '2024-01-01', '', 1.05],
  ['Akeneo PIM', 'Group product information: product sheets, allergens, photos', 'Akeneo', 'FR-DIS-300', 'saas', 'Supply Chain', 'saas', 'run', 'yes', '', 58000, '2025-01-01', '', 1.0],
  ['SAP external support — Distribution', 'SAP SD/MM application maintenance, monthly fixed fee', 'Fromatech Consulting', 'FR-DIS-300', 'maint', 'ERP', 'managed', 'run', 'yes', 'sap', 144000, '2024-01-01', '', 1.0],
  ['Coupa Procurement', 'Indirect purchasing and expense reports', 'Coupa', 'FR-DIS-300', 'saas', 'ERP', 'saas', 'run', 'yes', '', 64000, '2024-07-01', '', 0.97],
  ['Salesforce CPQ add-on', 'Quotes and price lists for food service', 'Salesforce', 'FR-DIS-200', 'saas', 'CRM', 'saas', 'run', 'yes', '', 36000, '2026-01-01', '', 1.0],
  ['Distribution — performance testing', 'Load testing campaigns before the year-end peaks', '', 'FR-DIS-200', 'consulting', 'ERP', 'consulting', 'build', 'no', '', 24000, '2026-01-01', '', 1.1],
  ['Distribution — user training', 'Sales force training on the new tools', '', 'FR-DIS-100', 'training', 'CRM', 'training', 'build', 'no', '', 18000, '2025-01-01', '', 0.8],
  ['Kaasmeester WMS — licenties', 'Gouda warehouse management, licenses and maintenance', '', 'NL-DIS-300', 'licence', 'Supply Chain', 'licence', 'run', 'yes', '', 41000, '2023-01-01', '', 1.0],
  ['Kaasmeester — KPN connectivity', 'Links for the Gouda warehouse and offices', 'KPN', 'NL-DIS-300', 'telecom', 'Infrastructure', 'telecom', 'run', 'yes', '', 22000, '2023-01-01', '', 1.0],
  ['Kaasmeester — werkplekbeheer', 'Managed workplace services for Benelux', 'Benelux IT Partners', 'NL-DIS-300', 'maint', 'Workplace', 'managed', 'run', 'yes', '', 54000, '2024-01-01', '', 1.02],
  // Shops & e-commerce
  ['Cegid Retail POS', 'Point-of-sale software for the French shops, licenses and maintenance', 'Cegid', 'FR-BOU-310', 'licence', 'Retail', 'licence', 'run', 'yes', '', 88000, '2022-01-01', '', 0.88],
  ['La Boutique — payments and fraud', 'Payment platform and fraud detection fees', '', 'FR-BOU-310', 'saas', 'E-commerce', 'saas', 'run', 'yes', 'ecom', 54000, '2025-06-01', '', 1.25],
  ['La Boutique — CDN and application security', 'Content delivery, WAF and bot protection for the online shop', '', 'FR-BOU-310', 'cloud', 'E-commerce', 'cloud', 'run', 'yes', 'ecom', 30000, '2025-06-01', '', 1.1],
  ['La Boutique — subscriber email and CRM', 'Email platform for the cheese box subscribers', 'HubSpot', 'FR-BOU-310', 'saas', 'CRM', 'saas', 'run', 'yes', '', 26000, '2025-09-01', '', 1.0],
  ['Shops — 4G backup', '4G routers and backup plans for the shops', 'Orange Business', 'FR-BOU-310', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 19000, '2024-01-01', '', 1.0],
  ['Shops — till and printer maintenance', 'On-site maintenance of tills and label printers', '', 'FR-BOU-310', 'maint', 'Retail', 'hardware', 'run', 'yes', '', 33000, '2023-01-01', '', 1.0],
  ['E-commerce — UX research and user testing', 'User testing of the subscription journey', '', 'FR-BOU-100', 'consulting', 'E-commerce', 'consulting', 'build', 'no', 'ecom', 28000, '2026-01-01', '', 1.0],
  ['E-commerce — product photos and content', 'Photo shoots and product sheets for the online shop', '', 'FR-BOU-100', 'consulting', 'E-commerce', 'consulting', 'build', 'no', '', 22000, '2026-01-01', '', 1.15],
  ['Formaggio — software punti vendita', 'Tills for the Italian shops, licenses and maintenance', 'Cegid', 'IT-BOU-310', 'licence', 'Retail', 'licence', 'run', 'yes', '', 31000, '2023-01-01', '', 1.0],
  ['Formaggio — connettività TIM', 'Links for the shops and the Parma plant', 'TIM Business', 'IT-BOU-310', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 17000, '2023-01-01', '', 1.0],
  ['Formaggio — assistenza IT', 'Local managed services for workstations and shops', 'DevHouse Milano', 'IT-BOU-310', 'maint', 'Workplace', 'managed', 'run', 'yes', '', 46000, '2024-01-01', '', 1.0],
  ['US e-commerce — Shopify Plus', 'US online shop, subscription and platform fees', 'Shopify', 'US-BOU-310', 'saas', 'E-commerce', 'saas', 'run', 'yes', '', 48000, '2025-03-01', '', 1.08],
  ['US e-commerce — AWS hosting', 'Hosting of the US order and logistics services', '', 'US-BOU-310', 'cloud', 'Infrastructure', 'cloud', 'run', 'yes', '', 36000, '2025-03-01', '', 1.1],
  ['US — Verizon connectivity', 'Links for the US offices and warehouse', 'Verizon Business', 'US-BOU-310', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 21000, '2024-01-01', '', 1.0],
  // Infrastructure and cloud
  ['Paris data center — hosting and power', 'Rack rental, power and maintenance of the Paris data center', '', 'FR-TRV-400', 'dc', 'Infrastructure', 'cloud', 'run', 'yes', '', 210000, '2022-01-01', '', 1.03],
  ['Veeam Backup & Replication', 'Backup of the virtualized environments, licenses and support', 'Veeam', 'FR-TRV-400', 'licence', 'Infrastructure', 'licence', 'run', 'yes', '', 38000, '2024-01-01', '', 1.0],
  ['Cisco Meraki — site networks', 'Network and Wi-Fi for the plants, caves and offices, cloud licenses', 'Cisco', 'FR-TRV-400', 'telecom', 'Network', 'licence', 'run', 'yes', '', 72000, '2024-01-01', '', 1.0],
  ['Orange Business — group WAN', 'Wide area network of the French sites and subsidiary interconnection', 'Orange Business', 'FR-TRV-400', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 165000, '2023-01-01', '', 0.98],
  ['Servers and storage — vendor maintenance', 'Extended warranty and support for hosts and storage arrays', 'Dell Technologies', 'FR-TRV-400', 'maint', 'Infrastructure', 'hardware', 'run', 'yes', '', 46000, '2023-01-01', '', 1.0],
  ['Azure — data consumption', 'Hosting of the data platform and its processing', 'Microsoft', 'FR-TRV-400', 'cloud', 'Analytics', 'cloud', 'run', 'yes', 'data', 95000, '2025-01-01', '', 1.12],
  ['Snowflake', 'Group data warehouse, consumption', 'Snowflake', 'FR-TRV-700', 'data', 'Analytics', 'saas', 'run', 'yes', 'data', 84000, '2025-09-01', '', 1.2],
  ['Talend Data Integration', 'Data integration, licenses and support', '', 'FR-TRV-700', 'data', 'Analytics', 'licence', 'run', 'yes', 'data', 42000, '2023-01-01', '', 1.0],
  ['Power BI Premium', 'Premium capacity for the group dashboards', 'Microsoft', 'FR-TRV-700', 'saas', 'Analytics', 'saas', 'run', 'yes', 'data', 60000, '2024-01-01', '', 1.0],
  // Workplace and support
  ['Workstations — leasing', 'Leasing of the group laptops and desktops (France fleet)', 'Lenovo', 'FR-TRV-500', 'maint', 'Workplace', 'hardware', 'run', 'yes', '', 186000, '2023-01-01', '', 1.0],
  ['Printing — cost-per-page contract', 'Copiers and printers at the sites, billed per page', '', 'FR-TRV-500', 'maint', 'Workplace', 'hardware', 'run', 'yes', '', 34000, '2022-01-01', '', 0.92],
  ['Mobile telephony', 'Mobile plans for staff in France', 'Orange Business', 'FR-TRV-500', 'telecom', 'Workplace', 'telecom', 'run', 'yes', '', 98000, '2023-01-01', '', 1.0],
  ['Service desk — level 1 managed service', 'Phone reception and level 1 handling of requests', 'Axians', 'FR-TRV-500', 'maint', 'ITSM', 'managed', 'run', 'yes', '', 132000, '2024-01-01', '', 1.0],
  ['Adobe Creative Cloud', 'Creative licenses for marketing and e-commerce', 'Adobe', 'FR-TRV-500', 'saas', 'Workplace', 'saas', 'run', 'yes', '', 24000, '2024-01-01', '', 1.0],
  ['Atlassian Cloud (Jira, Confluence)', 'Project management and documentation tools', 'Atlassian', 'FR-TRV-500', 'saas', 'Productivity', 'saas', 'run', 'yes', '', 52000, '2023-01-01', '', 1.0],
  ['Lotus Notes — end-of-life support', 'Residual vendor support until decommissioning', '', 'FR-TRV-500', 'maint', 'Productivity', 'licence', 'run', 'yes', '', 15000, '2022-01-01', '2026-12-31', 1.0],
  ['Legacy HR System (PeopleSoft) — maintenance', 'Maintenance of the legacy HR system until the Workday cutover', '', 'FR-TRV-500', 'maint', 'HR', 'licence', 'run', 'yes', '', 62000, '2020-01-01', '2026-12-31', 1.0],
  ['Old Intranet — hosting', 'Hosting of the legacy intranet, shut down in June 2026', '', 'FR-TRV-500', 'cloud', 'Productivity', 'cloud', 'run', 'yes', '', 9000, '2019-01-01', '2026-06-30', 0.5],
  // Security
  ['Tenable.io', 'Vulnerability management, subscription', '', 'FR-TRV-600', 'security', 'Security', 'saas', 'run', 'yes', 'zt', 36000, '2024-01-01', '', 1.0],
  ['Outsourced SOC', '24/7 monitoring and incident response', 'Axians', 'FR-TRV-600', 'security', 'Security', 'managed', 'run', 'yes', '', 144000, '2025-01-01', '', 1.0],
  ['Phishing awareness', 'Awareness campaigns and training platform', '', 'FR-TRV-600', 'saas', 'Security', 'saas', 'run', 'yes', '', 18000, '2025-01-01', '', 1.0],
  ['Annual penetration tests', 'External and internal penetration tests, two campaigns', '', 'FR-TRV-600', 'consulting', 'Security', 'consulting', 'build', 'no', 'zt', 45000, '2024-01-01', '', 1.0],
  ['Certificates and PKI', 'TLS certificates, code signing and internal PKI', 'DocuSign', 'FR-TRV-600', 'security', 'Security', 'saas', 'run', 'yes', '', 12000, '2023-01-01', '', 1.0],
  // IT management
  ['Consulting — IT master plan', 'Support for the 2027-2030 IT master plan', '', 'FR-TRV-700', 'consulting', 'IT Management', 'consulting', 'build', 'no', '', 90000, '2026-01-01', '', 1.1],
  ['License audit', 'Annual review of vendor usage rights', '', 'FR-TRV-700', 'consulting', 'IT Management', 'consulting', 'run', 'no', '', 25000, '2024-01-01', '', 1.0],
  ['Analyst research subscriptions', 'Research and technology watch subscriptions', '', 'FR-TRV-700', 'travel', 'IT Management', 'travel', 'run', 'yes', '', 28000, '2023-01-01', '', 1.0],
  ['IT recruitment', 'Recruitment firm fees for IT roles', '', 'FR-TRV-700', 'consulting', 'IT Management', 'consulting', 'run', 'no', '', 40000, '2024-01-01', '', 1.3],
];
const OWNER_IT = { 'FR-DIS-100': 'clara.dupont@fromage-co.example', 'FR-DIS-200': 'lucas.bernard@fromage-co.example', 'FR-DIS-300': 'pierre.martin@fromage-co.example', 'NL-DIS-300': 'jan.bakker@kaasmeester.example',
  'FR-BOU-100': 'amelie.rousseau@fromage-co.example', 'FR-BOU-310': 'nadia.lemaire@fromage-co.example', 'IT-BOU-310': 'luca.ferrari@formaggio-supremo.example', 'US-BOU-310': 'mike.johnson@fromage-co.example',
  'FR-TRV-400': 'marc.petit@fromage-co.example', 'FR-TRV-500': 'olivier.garnier@fromage-co.example', 'FR-TRV-600': 'ines.chevalier@fromage-co.example', 'FR-TRV-700': 'maria.casanova@fromage-co.example' };
const OWNER_BUSINESS = { 'DIV-DIS': 'isabelle.moreau@fromage-co.example', 'DIV-BOU': 'isabelle.moreau@fromage-co.example', 'DIV-TRV': 'thomas.berger@fromage-co.example' };
const ccGroup = Object.fromEntries(CC.map((c) => [c[0], c[2]]));

for (const [name, description, supplier, cc, accountKey, domain, kind, runBuild, recurrence, reference, budget, start, end, landingRatio] of NEW_LINES) {
  const company = ccCompany[cc];
  const budget2025 = start >= '2026-01-01' ? '' : round(budget * between(0.9, 0.97), 500);
  const landing2025 = budget2025 === '' ? '' : round(budget2025 * between(0.97, 1.04), 500);
  const landing = round(budget * landingRatio, 500);
  const revision = rnd() < 0.5 ? round(budget * between(0.98, 1.03), 500) : '';
  opexRows.push([name, description, supplier, company, ACCOUNT[company][accountKey], CURRENCY[company], start, statusFor(end), end,
    OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], ...classify(name, kind, domain), opexPurpose(name, runBuild, reference),
    reference ? REFERENCE[reference][0] : '', RECURRENCE[recurrence], cc, runBuild,
    end ? `End of validity ${end}` : '', budget2025, landing2025, budget, '', landing, revision, '', '']);
  const endMonth = end?.startsWith('2026-') ? Number(end.slice(5, 7)) : 12;
  pushActuals('opex', name, flat(landing, 1, endMonth));
  if (rnd() < 0.3) pushForecast('opex', name, flat(round(budget * between(0.98, 1.04), 500), 1, endMonth));
}

// External staffing: people priced per working day, computed from a calendar.
// [cost centre, profile, supplier, unit price, quantity, run/build, kind, reference, domain, budget period, landing period (null = same)]
const STAFFING = [
  ['FR-DIS-100', 'EDI project manager', 'Fromatech Consulting', 850, 1, 'build', 'staff', '', 'Supply Chain', ['01-01', '12-31'], null],
  ['FR-DIS-100', 'Sales business analyst', 'Fromatech Consulting', 720, 1, 'build', 'staff', '', 'CRM', ['01-01', '12-31'], null],
  ['FR-DIS-200', 'Senior SAP SD developer', 'Fromatech Consulting', 790, 1, 'build', 'cdc', 'sap', 'ERP', ['01-01', '12-31'], null],
  ['FR-DIS-200', 'SAP MM developer', 'Nearshore Digital Lisboa', 480, 2, 'build', 'cdc', 'sap', 'ERP', ['01-01', '12-31'], null],
  ['FR-DIS-200', 'Integration architect', 'Fromatech Consulting', 950, 1, 'build', 'staff', '', 'ERP', ['02-01', '12-31'], ['04-01', '12-31']],   // arrived two months late
  ['FR-DIS-200', 'B2B portal developer', 'Nearshore Digital Lisboa', 460, 1, 'build', 'staff', '', 'E-commerce', ['01-01', '12-31'], null],
  ['FR-DIS-300', 'SAP Basis administrator', 'Fromatech Consulting', 820, 1, 'run', 'staff', 'sap', 'ERP', ['01-01', '12-31'], null],
  ['FR-DIS-300', 'Application support analyst', 'Nearshore Digital Lisboa', 410, 1, 'run', 'staff', '', 'ERP', ['01-01', '12-31'], null],
  ['NL-DIS-300', 'Applicatiebeheerder Sage X3', 'Benelux IT Partners', 690, 1, 'run', 'staff', '', 'ERP', ['01-01', '12-31'], null],
  ['NL-DIS-300', 'Projectleider WMS', 'Benelux IT Partners', 820, 1, 'build', 'staff', '', 'Supply Chain', ['01-01', '09-30'], null],
  ['FR-BOU-100', 'E-commerce product owner', 'Fromatech Consulting', 880, 1, 'build', 'cdc', 'ecom', 'E-commerce', ['01-01', '12-31'], null],
  ['FR-BOU-100', 'E-commerce front-end developer', 'Nearshore Digital Lisboa', 470, 2, 'build', 'cdc', 'ecom', 'E-commerce', ['01-01', '12-31'], null],
  ['FR-BOU-100', 'E-commerce back-end developer', 'Nearshore Digital Lisboa', 490, 2, 'build', 'cdc', 'ecom', 'E-commerce', ['01-01', '12-31'], null],
  ['FR-BOU-100', 'Mobile developer', 'DevHouse Milano', 560, 1, 'build', 'cdc', 'ecom', 'E-commerce', ['05-01', '12-31'], ['05-01', '12-31']],
  ['FR-BOU-100', 'UX designer', 'Fromatech Consulting', 760, 1, 'build', 'staff', 'ecom', 'E-commerce', ['01-01', '06-30'], ['01-01', '10-31']],   // extended: project accelerated
  ['FR-BOU-310', 'E-commerce DevOps engineer', 'Fromatech Consulting', 840, 1, 'run', 'cdc', 'ecom', 'E-commerce', ['01-01', '12-31'], null],
  ['FR-BOU-310', 'Level 2 till support', 'Fromatech Consulting', 580, 1, 'run', 'staff', '', 'Retail', ['01-01', '12-31'], null],
  ['FR-BOU-310', 'E-commerce operations analyst', 'Nearshore Digital Lisboa', 430, 1, 'run', 'staff', 'ecom', 'E-commerce', ['01-01', '12-31'], null],
  ['FR-BOU-310', 'Payment platform administrator', 'Fromatech Consulting', 700, 1, 'run', 'staff', 'ecom', 'E-commerce', ['07-01', '12-31'], ['06-01', '12-31']],
  ['IT-BOU-310', 'Sistemista punti vendita', 'DevHouse Milano', 520, 1, 'run', 'staff', '', 'Retail', ['01-01', '12-31'], null],
  ['IT-BOU-310', 'Sviluppatore integrazioni', 'DevHouse Milano', 540, 1, 'build', 'staff', '', 'Retail', ['03-01', '12-31'], null],
  ['US-BOU-310', 'E-commerce engineer', 'Atlantic IT Solutions', 900, 1, 'build', 'staff', '', 'E-commerce', ['01-01', '12-31'], null],
  ['US-BOU-310', 'Site reliability engineer', 'Atlantic IT Solutions', 950, 1, 'run', 'staff', '', 'E-commerce', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Windows system engineer', 'Fromatech Consulting', 650, 1, 'run', 'staff', '', 'Infrastructure', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Linux system engineer', 'Fromatech Consulting', 680, 1, 'run', 'staff', '', 'Infrastructure', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Network engineer', 'Alpine Data Experts', 720, 1, 'run', 'staff', '', 'Network', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Azure cloud engineer', 'Alpine Data Experts', 820, 1, 'build', 'staff', 'data', 'Infrastructure', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'DC refresh project manager', 'Alpine Data Experts', 860, 1, 'build', 'staff', '', 'Infrastructure', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'On-site support technician, Paris', 'Axians', 380, 2, 'run', 'staff', '', 'Workplace', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'On-site support technician, plants', 'Axians', 380, 1, 'run', 'staff', '', 'Workplace', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'M365 administrator', 'Fromatech Consulting', 620, 1, 'run', 'staff', '', 'Productivity', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'Workday project manager', 'Alpine Data Experts', 880, 1, 'build', 'staff', '', 'HR', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'Workday payroll consultant', 'Alpine Data Experts', 1050, 1, 'build', 'staff', '', 'HR', ['01-01', '09-30'], ['01-01', '12-31']],
  ['FR-TRV-600', 'In-house SOC analyst', 'Fromatech Consulting', 700, 1, 'run', 'staff', 'zt', 'Security', ['01-01', '12-31'], null],
  ['FR-TRV-600', 'Network security engineer', 'Alpine Data Experts', 820, 1, 'build', 'staff', 'zt', 'Security', ['01-01', '12-31'], null],
  ['FR-TRV-600', 'IAM consultant', 'Fromatech Consulting', 900, 1, 'build', 'staff', 'zt', 'Security', ['02-01', '10-31'], null],
  ['FR-TRV-700', 'Data engineer', 'Alpine Data Experts', 760, 1, 'build', 'cdc', 'data', 'Analytics', ['01-01', '12-31'], null],
  ['FR-TRV-700', 'Data analyst', 'Nearshore Digital Lisboa', 440, 1, 'run', 'cdc', 'data', 'Analytics', ['01-01', '12-31'], null],
  ['FR-TRV-700', 'Interim IT controller', 'Alpine Data Experts', 700, 1, 'run', 'staff', '', 'IT Management', ['01-01', '06-30'], ['01-01', '08-31']],
];
const SHORT = Object.fromEntries(CC.map((c) => [c[0], c[0].slice(3)]));

/** Monthly amounts of a person-days line over a period, on a calendar. */
function staffMonths(year, calendarCode, quantity, unitPrice, [start, end]) {
  const days = calendarCode === 'CAD218' ? CAD218[year] : WORKING[year]; // foreign standard calendars approximated by the French one
  const s = Number(start.slice(0, 2)), e = Number(end.slice(0, 2));
  return MONTHS.map((_, i) => (i + 1 >= s && i + 1 <= e ? Math.round(days[i] * quantity * unitPrice * 100) / 100 : 0));
}
const sum = (a) => Math.round(a.reduce((x, y) => x + y, 0));

for (const [cc, profile, supplier, price, quantity, runBuild, kind, reference, domain, budgetPeriod, landingPeriodRaw] of STAFFING) {
  const company = ccCompany[cc];
  const calendar = STAFF_CAL[company];
  const name = `Contractor · ${profile} · ${SHORT[cc]}`;
  const landingPeriod = landingPeriodRaw ?? budgetPeriod;
  const budgetMonths = staffMonths(2026, calendar, quantity, price, budgetPeriod);
  const landingMonths = staffMonths(2026, calendar, quantity, price, landingPeriod);
  const budget2025 = round(sum(budgetMonths) * between(0.85, 0.97), 500);
  const qtyText = quantity > 1 ? `${quantity} people` : '1 person';
  const description = `${profile}, staff augmentation: ${qtyText} × ${price} ${CURRENCY[company]} per day, ${calendar} calendar`;
  opexRows.push([name, description, supplier, company, ACCOUNT[company].staff, CURRENCY[company], '2025-01-01', 'enabled', '',
    OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], ...classify(profile, kind, domain), opexPurpose(profile, runBuild, reference),
    reference ? REFERENCE[reference][0] : '', RECURRENCE.no, cc, runBuild,
    '', budget2025, round(budget2025 * between(0.97, 1.03), 500), sum(budgetMonths), '', sum(landingMonths), '', '', '']);
  for (const [measure, period] of [['planned', budgetPeriod], ['expected_landing', landingPeriod]]) {
    lineRows.push(['opex', name, 2026, measure, profile, 'people', quantity, price, 'per_day', 'per_month', '', `2026-${period[0]}`, `2026-${period[1]}`, calendar]);
  }
  pushActuals('opex', name, landingMonths);
  if (rnd() < 0.3) {
    const forecastMonths = staffMonths(2026, calendar, quantity, price, landingPeriod).map((v) => round(v * between(0.98, 1.02), 1));
    pushForecast('opex', name, forecastMonths);
  }
}
out('14-spend-items.csv', opexRows);

// ── CAPEX items ──────────────────────────────────────────────────────────────
// The asset type (hardware or software) only chooses the capitalised account; the purpose and the
// priority are the values of the recommended dimensions of those codes, written by name.
const CAPEX_HEADER = ['item_number', 'product_name', 'description', 'currency', 'effective_start', 'status', 'disabled_at', 'notes',
  'company_name', 'account_number', 'owner_it_email', 'owner_business_email', 'analytics:default', 'analytics:it_tower', 'analytics:business_domain',
  'analytics:purpose', 'analytics:priority', 'analytics:reference', 'analytics:recurrence', 'cost_center_code', 'run_build',
  'y_minus1_budget', 'y_minus1_landing', 'y_budget', 'y_follow_up', 'y_landing', 'y_revision', 'y_plus1_budget', 'y_plus1_revision', 'y_plus2_budget'];
const capexRows = [CAPEX_HEADER];
// Existing CAPEX lines, re-attached: [description, asset type, purpose, priority, currency, effective start,
// end of validity, notes, company, domain, cost centre, kind, reference, landing ratio, budget Y-1, landing Y-1, budget]
const EXISTING_CAPEX = [
  ['SAP Cheddar Migration — S/4HANA upgrade', 'Software', 'Replacement', 'Mandatory', 'EUR', '2025-07-01', '2027-12-31',
    'Migration from SAP ECC to S/4HANA with cheese industry customizations — 2.5 year program', FR, 'ERP', 'FR-DIS-200', 'cdc', 'sap', 1.09, 50000, 45000, 350000],
  ['Data Center Refresh — Paris DC', 'Hardware', 'Replacement', 'Mandatory', 'EUR', '2026-01-01', '2026-12-31',
    'Server and storage refresh for Paris data center — replace aging ESXi hosts and SAN', FR, 'Infrastructure', 'FR-TRV-400', 'hardware', '', 1.04, 0, 0, 250000],
  ['D2C E-commerce Platform — La Boutique', 'Software', 'Business growth', 'High', 'EUR', '2025-06-01', '2026-09-30',
    'Fromage-as-a-Service — custom e-commerce platform on AWS (React + Node.js)', FR, 'E-commerce', 'FR-BOU-100', 'cdc', 'ecom', 0.96, 80000, 90000, 120000],
];
for (const [description, asset, purpose, prio, currency, start, end, notes, company, domain, cc, kind, reference, ratio, budgetBefore, landingBefore, budget] of EXISTING_CAPEX) {
  const landing = round(budget * ratio, 1000);
  capexRows.push(['', description, notes, currency, start, statusFor(end), end, '',
    company, assetAccount(company, asset), OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], ...classify(description, kind, domain),
    oneOf(PURPOSES, purpose, 'purpose', description), oneOf(PRIORITIES, prio, 'priority', description),
    reference ? REFERENCE[reference][0] : '', RECURRENCE.no, cc, 'build',
    budgetBefore, landingBefore, budget, '', landing, round(budget * between(0.98, 1.05), 1000), '', '', '']);
  const endMonth = end?.startsWith('2026-') ? Number(end.slice(5, 7)) : 12;
  pushActuals('capex', description, flat(landing, 1, endMonth));
}
// New CAPEX lines. [description, asset type, purpose, priority, cost centre, domain, kind, reference, budget 2026, start, end, landing ratio, staffing line | null]
const NEW_CAPEX = [
  ['S/4HANA — capitalized custom development', 'Software', 'Replacement', 'Mandatory', 'FR-DIS-200', 'ERP', 'cdc', 'sap', 0, '2026-01-01', '2027-06-30', 1.0,
    ['SAP ABAP developer', 'Nearshore Digital Lisboa', 520, 2, ['01-01', '12-31'], ['01-01', '12-31']]],
  ['S/4HANA — HANA servers', 'Hardware', 'Replacement', 'Mandatory', 'FR-TRV-400', 'ERP', 'hardware', 'sap', 180000, '2026-01-01', '2026-12-31', 1.02, null],
  ['La Boutique — version 2 (subscriptions and marketplace)', 'Software', 'Business growth', 'High', 'FR-BOU-100', 'E-commerce', 'cdc', 'ecom', 0, '2026-01-01', '2027-03-31', 1.0,
    ['E-commerce full-stack developer', 'Nearshore Digital Lisboa', 480, 2, ['01-01', '12-31'], ['01-01', '12-31']]],
  ['Shops — till replacement', 'Hardware', 'Replacement', 'High', 'FR-BOU-310', 'Retail', 'hardware', '', 140000, '2026-01-01', '2026-12-31', 0.9, null],
  ['Formaggio — nuove casse punti vendita', 'Hardware', 'Replacement', 'High', 'IT-BOU-310', 'Retail', 'hardware', '', 45000, '2026-03-01', '2026-12-31', 1.0, null],
  ['US — warehouse management system', 'Software', 'Business growth', 'High', 'US-BOU-310', 'Supply Chain', 'licence', '', 95000, '2026-01-01', '2026-12-31', 1.15, null],
  ['Kaasmeester — WMS upgrade', 'Software', 'Replacement', 'High', 'NL-DIS-300', 'Supply Chain', 'licence', '', 60000, '2026-01-01', '2026-09-30', 1.0, null],
  ['CaveGuard — rollout to all 8 caves', 'Hardware', 'Business growth', 'High', 'FR-DIS-300', 'IoT', 'hardware', '', 75000, '2026-01-01', '2026-12-31', 1.0, null],
  ['Data platform — build', 'Software', 'Business growth', 'High', 'FR-TRV-700', 'Analytics', 'cdc', 'data', 0, '2026-01-01', '2026-12-31', 1.0,
    ['Platform data engineer', 'Alpine Data Experts', 780, 2, ['01-01', '12-31'], ['01-01', '12-31']]],
  ['Zero Trust — plant network segmentation', 'Hardware', 'Security', 'Mandatory', 'FR-TRV-600', 'Security', 'hardware', 'zt', 120000, '2026-01-01', '2026-12-31', 1.05, null],
  ['Workstations — plant refresh', 'Hardware', 'Replacement', 'High', 'FR-TRV-500', 'Workplace', 'hardware', '', 85000, '2026-01-01', '2026-12-31', 1.0, null],
  ['Cave and warehouse Wi-Fi', 'Hardware', 'Replacement', 'High', 'FR-TRV-400', 'Network', 'hardware', '', 55000, '2026-01-01', '2026-12-31', 1.0, null],
];
for (const [description, asset, purpose, prio, cc, domain, kind, reference, budgetRaw, start, end, ratio, staffing] of NEW_CAPEX) {
  const company = ccCompany[cc];
  let budget = budgetRaw, landing;
  if (staffing) {
    const [profile, supplier, price, quantity, budgetPeriod, landingPeriod] = staffing;
    const calendar = STAFF_CAL[company];
    const budgetMonths = staffMonths(2026, calendar, quantity, price, budgetPeriod);
    const landingMonths = staffMonths(2026, calendar, quantity, price, landingPeriod);
    budget = sum(budgetMonths); landing = sum(landingMonths);
    for (const [measure, period] of [['planned', budgetPeriod], ['expected_landing', landingPeriod]]) {
      lineRows.push(['capex', description, 2026, measure, `${profile} (${supplier})`, 'people', quantity, price, 'per_day', 'per_month', '', `2026-${period[0]}`, `2026-${period[1]}`, calendar]);
    }
    pushActuals('capex', description, landingMonths);
  } else {
    landing = round(budget * ratio, 1000);
    const endMonth = end?.startsWith('2026-') ? Number(end.slice(5, 7)) : 12;
    pushActuals('capex', description, flat(landing, 1, endMonth));
  }
  capexRows.push(['', description, '', CURRENCY[company], start, statusFor(end), end, '',
    company, assetAccount(company, asset), OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], ...classify(description, kind, domain),
    oneOf(PURPOSES, purpose, 'purpose', description), oneOf(PRIORITIES, prio, 'priority', description),
    reference ? REFERENCE[reference][0] : '', RECURRENCE.no, cc, 'build',
    '', '', budget, '', landing, rnd() < 0.5 ? round(budget * between(0.98, 1.05), 1000) : '', '', '', '']);
}
out('15-capex-items.csv', capexRows);
out('29-budget-rows.csv', budgetRows);
out('30-costed-lines.csv', lineRows);

// ── Summary ─────────────────────────────────────────────────────────────────
const opexData = opexRows.slice(1);
const total = (rows, i) => rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);
const colIndex = OPEX_HEADER.indexOf('y_budget');
const staffing = opexData.filter((r) => r[0].startsWith('Contractor · '));
console.log(`OPEX lines: ${opexData.length} (${staffing.length} staffing), CAPEX lines: ${capexRows.length - 1}`);
console.log(`OPEX budget 2026: ${total(opexData, colIndex)} ; staffing share: ${Math.round(100 * total(staffing, colIndex) / total(opexData, colIndex))} %`);
const rb = OPEX_HEADER.indexOf('run_build');
console.log(`Run share (lines): ${Math.round(100 * opexData.filter((r) => r[rb] === 'run').length / opexData.length)} %`);
const names = new Set(); for (const r of opexData) { const k = `${r[0]}|${r[2]}`; if (names.has(k)) throw new Error(`Duplicate OPEX line: ${k}`); names.add(k); }

// ── Minimal CSV parser (semicolon, quotes) ───────────────────────────────────
function parseCsv(content) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) { if (ch === '"') { if (content[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; continue; }
    if (ch === '"') quoted = true;
    else if (ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...data] = rows.filter((r) => r.length > 1 || r[0]);
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
