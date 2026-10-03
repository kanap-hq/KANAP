#!/usr/bin/env node
// Performance dataset generator for KANAP (step 0.1 of the perf plan).
//
// Writes CSV files in the formats of the Fromage fixture (fixtures/fromage-co),
// scaled to a large IT department: by default 5,000 OPEX lines, 1,000 CAPEX
// lines, 1,500 suppliers, 800 accounts, 300 cost centres, 4 analytics
// dimensions, 800 contracts, 5 budget years. Deterministic: same parameters,
// same files. No dependencies (Node >= 20).
//
//   node scripts/perf/generate-dataset.mjs --out /path/to/dataset [--opex 5000] [--seed 42]
//
// The files are loaded by scripts/perf/load-tenant.mjs. Budget rows, costed
// lines, allocations and links are keyed by item name (item numbers only exist
// once the items are imported); the loader resolves them.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ── Parameters ──────────────────────────────────────────────────────────────
const P = {
  out: '',
  year: 2026,
  seed: 20261001,
  opex: 5000,
  capex: 1000,
  suppliers: 1500,
  accounts: 800,
  users: 60,
  costCenters: 300,
  contracts: 800,
  projects: 100,
  tasks: 400,
  departments: 10,
  costedShare: 0.2,
  allocationShare: 0.2,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!(key in P)) throw new Error(`Unknown argument: ${argv[i]}`);
  const raw = argv[++i];
  P[key] = typeof P[key] === 'number' ? Number(raw) : raw;
}
if (!P.out) throw new Error('--out <directory> is required');
mkdirSync(P.out, { recursive: true });

const Y = P.year;
const YEARS = [Y - 2, Y - 1, Y, Y + 1, Y + 2];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// The dataset is "end of September" of the current year: actuals run January to September.
const ACTUAL_MONTHS_CURRENT_YEAR = 9;

// ── Deterministic pseudo-random (mulberry32) ────────────────────────────────
let state = P.seed >>> 0;
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + (b - a) * rnd();
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];
const chance = (p) => rnd() < p;
const pad = (n, w) => String(n).padStart(w, '0');

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const counts = {};
function out(name, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n') + '\n';
  writeFileSync(path.join(P.out, name), text, 'utf8');
  counts[name] = rows.length;
}
const money = (v) => (Math.round(v * 100) / 100).toFixed(2);

// ── Word lists ──────────────────────────────────────────────────────────────
const FIRST = ['Alice', 'Bruno', 'Camille', 'David', 'Emma', 'Fabien', 'Gaëlle', 'Hugo', 'Inès', 'Julien', 'Karim', 'Léa', 'Marc', 'Nadia', 'Olivier', 'Pauline', 'Quentin', 'Rachel', 'Samuel', 'Théo', 'Ursula', 'Victor', 'Wendy', 'Xavier', 'Yasmine', 'Zoé'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand'];
const VENDOR_A = ['Nova', 'Axi', 'Data', 'Cloud', 'Secu', 'Net', 'Info', 'Logi', 'Tech', 'Sys', 'Digi', 'Opti', 'Inno', 'Proto', 'Cyber', 'Meta', 'Hyper', 'Quantum', 'Blue', 'Green'];
const VENDOR_B = ['soft', 'link', 'ware', 'tel', 'core', 'path', 'gate', 'base', 'wave', 'line', 'point', 'stack', 'scale', 'bridge', 'forge'];
const VENDOR_C = ['SA', 'SAS', 'GmbH', 'Ltd', 'Inc.', 'BV', 'SpA', 'Group', 'Services', 'Solutions'];
const PRODUCTS = ['Licences', 'Maintenance', 'Abonnement SaaS', 'Support', 'Hébergement', 'Infogérance', 'Réseau WAN', 'Téléphonie', 'Sauvegarde', 'Supervision', 'Sécurité EDR', 'Messagerie', 'Stockage', 'Postes de travail', 'Imprimantes', 'Formation', 'Conseil', 'Assistance technique', 'Cloud IaaS', 'Base de données', 'ERP', 'CRM', 'Paie', 'BI', 'GED', 'ITSM', 'Pare-feu', 'VPN', 'Annuaire', 'Mobilité'];
const ROLES_STAFF = ['Chef de projet', 'Développeur', 'Architecte', 'Administrateur système', 'Analyste', 'Expert sécurité', 'Consultant fonctionnel', 'Testeur', 'Scrum master', 'Data engineer'];
const CC_DOMAINS = ['Distribution', 'Boutiques', 'Finance', 'RH', 'Production', 'Logistique', 'Infrastructure', 'Poste de travail', 'Sécurité', 'Pilotage'];

// ── Companies (two files: year columns are relative to the import year) ────
const COMPANIES = [
  { name: 'Perf Groupe SA', country: 'FR', city: 'Paris', currency: 'EUR', headcount: 4200, it: 3600, turnover: 820 },
  { name: 'Perf Nederland BV', country: 'NL', city: 'Rotterdam', currency: 'EUR', headcount: 1500, it: 1200, turnover: 260 },
  { name: 'Perf UK Ltd', country: 'GB', city: 'London', currency: 'GBP', headcount: 900, it: 700, turnover: 150 },
];
const companyHeader = (base) => ['name', 'country_iso', 'address1', 'address2', 'postal_code', 'city', 'state', 'reg_number', 'vat_number', 'base_currency', 'status', 'disabled_at', 'notes',
  ...[base - 1, base, base + 1].flatMap((y) => [`headcount_${y}`, `it_users_${y}`, `turnover_${y}`])];
for (const base of [Y - 1, Y + 1]) {
  out(`01-companies-${base}.csv`, companyHeader(base), COMPANIES.map((c, i) => [
    c.name, c.country, `${10 + i} avenue des Tests`, '', `7500${i}`, c.city, '', `REG-${1000 + i}`, `VAT-${2000 + i}`, c.currency, 'enabled', '', 'Perf dataset company',
    ...[base - 1, base, base + 1].flatMap((y) => {
      const g = 1 + 0.03 * (y - Y);
      return [Math.round(c.headcount * g), Math.round(c.it * g), Math.round(c.turnover * g)];
    }),
  ]));
}

// ── Chart of accounts (one chart, shared by the three companies) ───────────
const accounts = [];
for (let i = 0; i < P.accounts; i += 1) {
  const number = 600000 + i * 7 + int(0, 6);
  accounts.push({ number: String(number), name: `${pick(PRODUCTS)} ${pad(i, 4)}` });
}
out('02-accounts.csv', ['account_number', 'account_name', 'native_name', 'description', 'consolidation_account_number', 'consolidation_account_name', 'consolidation_account_description', 'status'],
  accounts.map((a) => [a.number, a.name, '', 'Perf dataset account', '', '', '', 'enabled']));

// ── Suppliers ───────────────────────────────────────────────────────────────
const suppliers = [];
const supplierNames = new Set();
while (suppliers.length < P.suppliers) {
  const name = `${pick(VENDOR_A)}${pick(VENDOR_B)} ${pick(VENDOR_C)} ${pad(suppliers.length + 1, 4)}`;
  if (supplierNames.has(name)) continue;
  supplierNames.add(name);
  suppliers.push(name);
}
out('07-suppliers.csv', ['name', 'erp_supplier_id', 'commercial_contact', 'technical_contact', 'support_contact', 'notes', 'status'],
  suppliers.map((s, i) => [s, `SUP-${pad(i + 1, 5)}`, '', '', '', '', 'enabled']));
// A long tail: a few suppliers carry many lines (Zipf-like weights).
const supplierWeights = suppliers.map((_, i) => 1 / Math.pow(i + 1, 0.8));
const supplierTotal = supplierWeights.reduce((a, b) => a + b, 0);
function pickSupplier() {
  let r = rnd() * supplierTotal;
  for (let i = 0; i < suppliers.length; i += 1) {
    r -= supplierWeights[i];
    if (r <= 0) return suppliers[i];
  }
  return suppliers[suppliers.length - 1];
}

// ── Departments ─────────────────────────────────────────────────────────────
const departments = [];
for (let i = 0; i < P.departments; i += 1) {
  const company = COMPANIES[i % COMPANIES.length];
  departments.push({ company: company.name, name: `${CC_DOMAINS[i % CC_DOMAINS.length]} ${company.country}` });
}
out('08-departments.csv', ['company_name', 'name', 'description', 'status', 'disabled_at'],
  departments.map((d) => [d.company, d.name, 'Perf dataset department', 'enabled', '']));

// ── Users (created through POST /users so they get a password) ─────────────
// Role mix: a few budget administrators, most users budget members, some readers.
const users = [];
for (let i = 0; i < P.users; i += 1) {
  const first = FIRST[i % FIRST.length];
  const last = LAST[Math.floor(i / FIRST.length + i) % LAST.length];
  let role = 'Budget Member';
  if (i < 2) role = 'Administrator';
  else if (i < 6) role = 'Budget Administrator';
  else if (i < 40) role = 'Budget Member';
  else if (i < 50) role = 'Budget Reader';
  else role = 'Portfolio Member';
  const dept = departments[i % departments.length];
  users.push({ email: `perf.user${pad(i + 1, 3)}@perf.invalid`, first, last, role, company: dept.company, department: dept.name });
}
out('10-users.csv', ['email', 'first_name', 'last_name', 'role', 'company_name', 'department_name', 'status'],
  users.map((u) => [u.email, u.first, u.last, u.role, u.company, u.department, 'enabled']));
const owners = users.filter((u) => u.role !== 'Portfolio Member');

// ── Cost centres: 3 levels (1 root, divisions, cost centres) ───────────────
const ccRows = [];
const divisions = 9;
ccRows.push(['DSI', 'group', 'DSI Groupe Perf', '', '', '', 'Racine', 'enabled']);
for (let d = 0; d < divisions; d += 1) ccRows.push([`DIV-${pad(d + 1, 2)}`, 'group', `Division ${CC_DOMAINS[d % CC_DOMAINS.length]} ${d + 1}`, 'DSI', '', '', 'Division', 'enabled']);
const costCenters = [];
for (let i = 0; i < P.costCenters - divisions - 1; i += 1) {
  const div = `DIV-${pad((i % divisions) + 1, 2)}`;
  const company = COMPANIES[i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0];
  const code = `${company.country}-${pad(i + 1, 4)}`;
  const owner = owners[i % owners.length];
  costCenters.push({ code, company: company.name });
  ccRows.push([code, 'cost_center', `Centre ${CC_DOMAINS[i % CC_DOMAINS.length]} ${pad(i + 1, 4)}`, div, company.name, owner.email, 'Centre de coût perf', 'enabled']);
}
out('26-cost-centers.csv', ['code', 'kind', 'name', 'parent_code', 'company_name', 'owner_email', 'description', 'status'], ccRows);

// ── Analytics: default category dimension + 4 axes ─────────────────────────
const CATEGORIES = Array.from({ length: 20 }, (_, i) => `Catégorie ${pad(i + 1, 2)}`);
const AXES = [
  { code: 'nature', name: 'Nature de coût', size: 12 },
  { code: 'reference', name: 'Référence budget', size: 50 },
  { code: 'recurrence', name: 'Récurrence', size: 10 },
  { code: 'programme', name: 'Programme', size: 30 },
];
const axisValues = Object.fromEntries(AXES.map((a) => [a.code, Array.from({ length: a.size }, (_, i) => `${a.name} ${pad(i + 1, 2)}`)]));
out('27-analytics-values.csv', ['axis_code', 'name', 'description', 'status'],
  AXES.flatMap((a) => axisValues[a.code].map((v) => [a.code, v, '', 'enabled'])));
writeFileSync(path.join(P.out, 'analytics.json'), JSON.stringify({ categories: CATEGORIES, axes: AXES.map(({ code, name }, i) => ({ code, name, sort_order: (i + 1) * 10 })) }, null, 2));

// ── Working-day calendars: country calendars + one custom per year ─────────
const calRows = [
  ['FR', 'France', 'Jours fériés officiels', 'FR', '', 'enabled', '', ...MONTHS.map(() => '')],
  ['NL', 'Pays-Bas', 'Jours fériés officiels', 'NL', '', 'enabled', '', ...MONTHS.map(() => '')],
  ['GB', 'Royaume-Uni', 'Jours fériés officiels', 'GB', '', 'enabled', '', ...MONTHS.map(() => '')],
];
const CAD = [19.1, 17.4, 18.2, 18.2, 16.5, 17.4, 19.1, 17.4, 19.1, 20, 16.5, 19.1];
for (const y of YEARS) calRows.push(['FORFAIT', 'Forfait 218 jours', 'Cadres au forfait', '', '', 'enabled', String(y), ...CAD.map((v) => String(v))]);
out('28-working-day-calendars.csv', ['code', 'name', 'description', 'country', 'region', 'status', 'year', ...MONTHS], calRows);

// ── Contracts ───────────────────────────────────────────────────────────────
const contracts = [];
for (let i = 0; i < P.contracts; i += 1) {
  const supplier = pickSupplier();
  const company = pick(COMPANIES);
  contracts.push({
    name: `Contrat ${pad(i + 1, 4)} ${supplier.split(' ')[0]}`,
    row: [`Contrat ${pad(i + 1, 4)} ${supplier.split(' ')[0]}`, company.name, supplier, `${Y - int(0, 4)}-${pad(int(1, 12), 2)}-01`, String(pick([12, 24, 36, 48])),
      pick(['yes', 'no']), String(pick([1, 3, 6])), String(int(5, 500) * 1000), company.currency === 'GBP' ? 'GBP' : 'EUR', pick(['annual', 'monthly', 'quarterly']), 'enabled', pick(owners).email, ''],
  });
}
out('13-contracts.csv', ['name', 'company_name', 'supplier_name', 'start_date', 'duration_months', 'auto_renewal', 'notice_period_months', 'yearly_amount_at_signature', 'currency', 'billing_frequency', 'status', 'owner_email', 'notes'],
  contracts.map((c) => c.row));

// ── Monthly shapes ──────────────────────────────────────────────────────────
// Each line has a shape that spreads an annual amount over 12 months.
const SHAPES = {
  flat: () => Array(12).fill(1 / 12),
  annual: () => { const m = int(0, 11); return Array.from({ length: 12 }, (_, i) => (i === m ? 1 : 0)); },
  quarterly: () => Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? 0.25 : 0)),
  ramp: () => { const w = Array.from({ length: 12 }, (_, i) => 0.6 + i * 0.07); const s = w.reduce((a, b) => a + b, 0); return w.map((v) => v / s); },
  seasonal: () => { const w = CAD.map((d) => d); const s = w.reduce((a, b) => a + b, 0); return w.map((v) => v / s); },
};
const SHAPE_NAMES = ['flat', 'flat', 'flat', 'annual', 'quarterly', 'ramp', 'seasonal'];
function spread(total, weights, noise = 0) {
  const months = weights.map((w) => (w === 0 ? 0 : total * w * (1 + (noise ? between(-noise, noise) : 0))));
  return months.map((v) => money(Math.max(0, v)));
}

// ── Budget items (OPEX + CAPEX) ─────────────────────────────────────────────
const budgetRows = [];
const costedLines = [];
const allocations = [];
const contractLinks = [];
const projectLinks = [];
const opexItems = [];
const capexItems = [];

function lifetime() {
  // 85 % live over the five years, 7 % started recently, 8 % ended last year.
  const r = rnd();
  if (r < 0.85) return { start: `${Y - 3}-01-01`, firstYear: Y - 2, lastYear: Y + 2, end: '' };
  if (r < 0.92) { const s = pick([Y - 1, Y]); return { start: `${s}-${pad(int(1, 6), 2)}-01`, firstYear: s, lastYear: Y + 2, end: '' }; }
  return { start: `${Y - 4}-01-01`, firstYear: Y - 2, lastYear: Y - 1, end: `${Y - 1}-12-31` };
}

// The status cell follows the end of validity, as the imports require (a line whose end has passed
// is disabled; an enabled one is refused). The imports read a bare day as noon UTC. The lines that
// ended last year are therefore disabled whenever --year is the current year or earlier (the
// default), so the files do not depend on the day they are written; only a future --year makes them
// enabled lines with an end still to come.
const GENERATED_AT = Date.now();
const lineStatus = (life) => (life.end && Date.parse(`${life.end}T12:00:00Z`) <= GENERATED_AT ? 'disabled' : 'enabled');

function currency() {
  const r = rnd();
  return r < 0.85 ? 'EUR' : r < 0.95 ? 'USD' : 'GBP';
}

function itemBudget(kind, name, annual, life, isCosted) {
  const shape = SHAPES[pick(SHAPE_NAMES)]();
  for (const year of YEARS) {
    if (year < life.firstYear || year > life.lastYear) continue;
    const growth = Math.pow(1 + between(-0.02, 0.06), year - (Y - 2));
    const base = annual * growth;
    const row = (measure, values, start = `${year}-01-01`, end = `${year}-12-31`) =>
      budgetRows.push([kind, name, String(year), measure, start, end, ...values]);
    const planned = spread(base, shape);
    const committed = spread(base * between(0.95, 1.05), shape);
    if (year <= Y) {
      const costedNow = isCosted && year === Y;
      if (!costedNow) row('planned', planned);
      row('committed', committed);
      row('forecast', spread(base * between(0.92, 1.08), shape));
      if (year < Y) {
        const actual = spread(base * between(0.9, 1.05), shape, 0.08);
        row('actual', actual);
        row('expected_landing', actual);
      } else {
        const actual = spread(base * between(0.9, 1.05), shape, 0.08).map((v, i) => (i < ACTUAL_MONTHS_CURRENT_YEAR ? v : '0'));
        row('actual', actual, `${year}-01-01`, `${year}-${pad(ACTUAL_MONTHS_CURRENT_YEAR, 2)}-30`);
        if (!costedNow) row('expected_landing', spread(base * between(0.95, 1.04), shape));
      }
    } else if (year === Y + 1) {
      row('planned', planned);
      row('committed', committed);
    } else {
      row('planned', planned);
    }
  }
  if (isCosted && life.firstYear <= Y && life.lastYear >= Y) {
    const people = int(1, 4);
    for (const measure of ['planned', 'expected_landing']) {
      for (let p = 0; p < people; p += 1) {
        const role = pick(ROLES_STAFF);
        costedLines.push([kind, name, String(Y), measure, `${role} ${p + 1}`, 'people', String(pick([0.5, 1, 1, 1, 2])), String(int(450, 1100)), 'per_day', 'per_month', '',
          `${Y}-01-01`, `${Y}-12-31`, pick(['FORFAIT', 'FR', 'FR', 'NL'])]);
      }
    }
  }
  if (rnd() < P.allocationShare) {
    for (const year of YEARS) {
      if (year < life.firstYear || year > life.lastYear) continue;
      if (chance(0.6)) {
        const picked = COMPANIES.filter(() => chance(0.7));
        const list = picked.length >= 2 ? picked : COMPANIES.slice(0, 2);
        allocations.push([kind, name, String(year), 'manual_company', list.map((c) => c.name).join('|'), '']);
      } else {
        const a = int(40, 80); const b = 100 - a;
        allocations.push([kind, name, String(year), 'manual_pct', `${COMPANIES[0].name}|${COMPANIES[1].name}`, `${a}|${b}`]);
      }
    }
  }
}

const usedOpexNames = new Set();
for (let i = 0; i < P.opex; i += 1) {
  const supplier = pickSupplier();
  const isStaff = chance(0.25);
  const product = isStaff ? `Régie ${pick(ROLES_STAFF)}` : pick(PRODUCTS);
  let name = `${product} · ${supplier.split(' ')[0]} · ${pad(i + 1, 5)}`;
  while (usedOpexNames.has(name)) name += '+';
  usedOpexNames.add(name);
  const cc = pick(costCenters);
  const life = lifetime();
  const cur = currency();
  const annual = Math.round(Math.exp(between(Math.log(2000), Math.log(900000))));
  opexItems.push([
    name, `Ligne de dépense perf ${i + 1}`, supplier, cc.company, pick(accounts).number, cur, life.start, lineStatus(life), life.end,
    pick(owners).email, pick(owners).email, pick(CATEGORIES),
    ...AXES.map((a) => (chance(0.85) ? pick(axisValues[a.code]) : '')),
    cc.code, isStaff || chance(0.6) ? 'run' : 'build', chance(0.3) ? `Note ${i + 1} : renouvellement à prévoir` : '',
    '', '', '', '', '', '', '', '',
  ]);
  const isCosted = isStaff ? chance(Math.min(1, P.costedShare * 3)) : chance(P.costedShare * 0.35);
  itemBudget('opex', name, annual, life, isCosted);
}
out('14-spend-items.csv', ['product_name', 'description', 'supplier_name', 'company_name', 'account_number', 'currency', 'effective_start', 'status', 'disabled_at', 'owner_it_email', 'owner_business_email', 'analytics_category',
  ...AXES.map((a) => `analytics:${a.code}`), 'cost_center_code', 'run_build', 'notes',
  'y_minus1_budget', 'y_minus1_landing', 'y_budget', 'y_follow_up', 'y_landing', 'y_revision', 'y_plus1_budget', 'y_plus1_revision'], opexItems);

for (let i = 0; i < P.capex; i += 1) {
  const cc = pick(costCenters);
  const life = lifetime();
  const cur = currency();
  const description = `Investissement ${pick(PRODUCTS)} ${pad(i + 1, 5)}`;
  capexItems.push([
    '', description, pick(['software', 'hardware']), pick(['replacement', 'business_growth']), pick(['mandatory', 'high', 'medium', 'low']), cur, life.start, lineStatus(life), life.end, 'Projet CAPEX perf',
    cc.company, pick(owners).email, pick(owners).email, pick(CATEGORIES),
    ...AXES.map((a) => (chance(0.8) ? pick(axisValues[a.code]) : '')),
    cc.code, 'build', '', '', '', '', '', '', '', '', '',
  ]);
  itemBudget('capex', description, Math.round(Math.exp(between(Math.log(10000), Math.log(2000000)))), life, chance(P.costedShare * 0.5));
}
out('15-capex-items.csv', ['item_number', 'description', 'ppe_type', 'investment_type', 'priority', 'currency', 'effective_start', 'status', 'disabled_at', 'notes', 'company_name', 'owner_it_email', 'owner_business_email', 'analytics_category',
  ...AXES.map((a) => `analytics:${a.code}`), 'cost_center_code', 'run_build',
  'y_minus1_budget', 'y_minus1_landing', 'y_budget', 'y_follow_up', 'y_landing', 'y_revision', 'y_plus1_budget', 'y_plus1_revision', 'y_plus2_budget'], capexItems);

// Every contract covers 1 to 3 OPEX lines (800 contracts → about 1,600 linked lines).
for (const c of contracts) {
  const n = int(1, 3);
  for (let k = 0; k < n; k += 1) contractLinks.push([c.name, pick(opexItems)[0]]);
}
out('32-contract-links.csv', ['contract_name', 'item_name'], contractLinks);

// ── Portfolio: projects + links to OPEX ─────────────────────────────────────
const PROJECT_STATUS = ['planned', 'in_progress', 'in_progress', 'in_testing', 'done', 'waiting_list'];
const projects = [];
for (let i = 0; i < P.projects; i += 1) {
  const company = pick(COMPANIES);
  const dept = departments.find((d) => d.company === company.name) ?? departments[0];
  const s = `${Y - int(0, 2)}-${pad(int(1, 12), 2)}-01`;
  const status = pick(PROJECT_STATUS);
  projects.push([`Projet perf ${pad(i + 1, 3)}`, status, 'Projet du jeu de données de performance', 'standard', 'Plan stratégique', 'Applications métier', 'Socle SI', company.name, dept.name,
    s, `${Y + int(0, 2)}-12-31`, status === 'planned' || status === 'waiting_list' ? '' : s, status === 'done' ? `${Y}-06-30` : '', status === 'done' ? '100' : String(int(0, 90)),
    String(int(10, 200)), String(int(5, 100)), pick(owners).email, pick(owners).email, pick(owners).email, pick(owners).email]);
  for (let k = 0; k < 3; k += 1) projectLinks.push([`Projet perf ${pad(i + 1, 3)}`, pick(opexItems)[0]]);
}
out('16-portfolio-projects.csv', ['name', 'status', 'purpose', 'origin', 'source_name', 'category_name', 'stream_name', 'company_name', 'department_name', 'planned_start', 'planned_end', 'actual_start', 'actual_end', 'execution_progress',
  'estimated_effort_it', 'estimated_effort_business', 'business_sponsor_email', 'business_lead_email', 'it_sponsor_email', 'it_lead_email'], projects);
out('33-project-links.csv', ['project_name', 'item_name'], projectLinks);

// ── Tasks: mostly on OPEX lines (the list shows the last task) ─────────────
const tasks = [];
for (let i = 0; i < P.tasks; i += 1) {
  const r = rnd();
  const [type, target] = r < 0.6 ? ['spend_item', pick(opexItems)[0]] : r < 0.75 ? ['capex_item', pick(capexItems)[1]] : r < 0.9 ? ['contract', pick(contracts).name] : ['project', pick(projects)[0]];
  tasks.push([`Tâche perf ${pad(i + 1, 4)}`, 'Suivi du jeu de données de performance', 'Task', pick(['open', 'open', 'in_progress', 'done']), pick(['low', 'normal', 'normal', 'high']), type, target, pick(owners).email, COMPANIES[0].name,
    `${Y}-${pad(int(1, 9), 2)}-01`, `${Y}-${pad(int(9, 12), 2)}-28`, 'perf']);
}
out('19-tasks.csv', ['title', 'description', 'task_type_name', 'status', 'priority_level', 'related_object_type', 'related_object_name', 'assignee_email', 'company_name', 'start_date', 'due_date', 'labels'], tasks);

// ── Budget files ────────────────────────────────────────────────────────────
out('29-budget-rows.csv', ['item_type', 'item_name', 'year', 'measure', 'period_start', 'period_end', ...MONTHS], budgetRows);
out('30-costed-lines.csv', ['item_type', 'item_name', 'year', 'measure', 'label', 'quantity_unit', 'quantity', 'unit_price', 'price_basis', 'frequency', 'days_per_month', 'period_start', 'period_end', 'calendar_code'], costedLines);
out('31-allocations.csv', ['item_type', 'item_name', 'year', 'method', 'companies', 'pcts'], allocations);

const manifest = { params: P, years: YEARS, files: counts };
writeFileSync(path.join(P.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const [name, n] of Object.entries(counts)) console.log(`${name.padEnd(32)} ${n} rows`);
