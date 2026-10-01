#!/usr/bin/env node
// Generates the budget part of the Fromage & Co fixture: cost centres,
// analytics values, working-day calendars, OPEX and CAPEX items, costed lines
// (quantity × price) and monthly budget rows. Deterministic: the same input
// always gives the same files, so the CSVs can be reviewed in a diff.
//
//   node fixtures/fromage-co/tools/generate-budget.mjs
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
for (const [code, name, country] of [['FR', 'France', 'FR'], ['NL', 'Pays-Bas', 'NL'], ['IT', 'Italie', 'IT'], ['US', 'États-Unis', 'US']]) {
  calendarRows.push([code, name, 'Calendrier standard, jours fériés officiels', country, '', 'enabled', '', ...Array(12).fill('')]);
}
for (const y of YEARS) calendarRows.push(['CAD218', 'Cadre 218 jours', 'Cadres au forfait : 218 jours travaillés par an, congés répartis sur l\'année', '', '', 'enabled', y, ...CAD218[y]]);
for (const y of YEARS) calendarRows.push(['SANSCONGES', 'Sans congés', 'Jours ouvrés hors jours fériés, sans congés : prestations facturées au jour réellement travaillé', '', '', 'enabled', y, ...WORKING[y]]);
out('28-working-day-calendars.csv', calendarRows);

// ── Organisation ─────────────────────────────────────────────────────────────
const FR = 'Fromage & Co SA', NL = 'Kaasmeester BV', IT = 'Formaggio Supremo SRL', US = 'Fromage & Co Inc.';
const COUNTRY = { [FR]: 'FR', [NL]: 'NL', [IT]: 'IT', [US]: 'US' };
const CURRENCY = { [FR]: 'EUR', [NL]: 'EUR', [IT]: 'EUR', [US]: 'USD' };
const STAFF_CAL = { [FR]: 'CAD218', [NL]: 'NL', [IT]: 'IT', [US]: 'US' };

const GROUPS = [
  ['DSI-GRP', 'DSI Groupe', '', 'La direction des systèmes d\'information du groupe'],
  ['DIV-DIS', 'Division Distribution & restauration', 'DSI-GRP', 'Systèmes des ventes aux distributeurs et à la restauration'],
  ['DIV-BOU', 'Division Boutiques & e-commerce', 'DSI-GRP', 'Systèmes des boutiques et de la vente en ligne'],
  ['DIV-TRV', 'Fonctions transverses', 'DSI-GRP', 'Infrastructure, poste de travail, sécurité et pilotage'],
];
const CC = [
  // code, name, group, company, owner, description
  ['FR-DIS-100', 'Direction de projets Distribution', 'DIV-DIS', FR, 'clara.dupont@fromage-co.com', 'Projets des systèmes de vente B2B, EDI et portail distributeurs'],
  ['FR-DIS-200', 'Ingénierie et déploiement Distribution', 'DIV-DIS', FR, 'lucas.bernard@fromage-co.com', 'Construction et déploiement des applications de la division'],
  ['FR-DIS-300', 'Exploitation back office Distribution', 'DIV-DIS', FR, 'pierre.martin@fromage-co.com', 'Exploitation des systèmes de gestion commerciale et logistique'],
  ['NL-DIS-300', 'Exploitation Distribution Benelux', 'DIV-DIS', NL, 'jan.bakker@kaasmeester.nl', 'Exploitation des systèmes de la filiale néerlandaise'],
  ['FR-BOU-100', 'Direction de projets Boutiques & e-commerce', 'DIV-BOU', FR, 'amelie.rousseau@fromage-co.com', 'Projets boutiques, e-commerce et abonnements'],
  ['FR-BOU-310', 'Exploitation front office (boutiques et e-commerce)', 'DIV-BOU', FR, 'nadia.lemaire@fromage-co.com', 'Exploitation des caisses, du site marchand et des outils boutique'],
  ['IT-BOU-310', 'Exploitation front office Italie', 'DIV-BOU', IT, 'luca.ferrari@formaggio-supremo.it', 'Exploitation des boutiques et systèmes de la filiale italienne'],
  ['US-BOU-310', 'E-commerce Amérique du Nord', 'DIV-BOU', US, 'mike.johnson@fromage-co.com', 'Site marchand et systèmes de la filiale américaine'],
  ['FR-TRV-400', 'Infrastructure et cloud', 'DIV-TRV', FR, 'marc.petit@fromage-co.com', 'Centres de données, cloud, réseau et télécoms du groupe'],
  ['FR-TRV-500', 'Poste de travail et support', 'DIV-TRV', FR, 'olivier.garnier@fromage-co.com', 'Postes de travail, outils collaboratifs et centre de services'],
  ['FR-TRV-600', 'Sécurité', 'DIV-TRV', FR, 'ines.chevalier@fromage-co.com', 'Sécurité des systèmes d\'information et conformité'],
  ['FR-TRV-700', 'Pilotage DSI et contrôle de gestion', 'DIV-TRV', FR, 'marie.fontaine@fromage-co.com', 'Pilotage, contrôle de gestion, achats IT, formation'],
];
const ccRows = [['code', 'kind', 'name', 'parent_code', 'company_name', 'owner_email', 'description', 'status']];
for (const [code, name, parent, description] of GROUPS) ccRows.push([code, 'group', name, parent, '', '', description, 'enabled']);
for (const [code, name, parent, company, owner, description] of CC) ccRows.push([code, 'cost_center', name, parent, company, owner, description, 'enabled']);
out('26-cost-centers.csv', ccRows);
const ccCompany = Object.fromEntries(CC.map((c) => [c[0], c[3]]));
const ccOwner = Object.fromEntries(CC.map((c) => [c[0], c[4]]));

// ── Analytics dimensions (values; the axes are created by the runner) ───────
const NATURE = {
  licence: 'Licences et maintenance', saas: 'Abonnements SaaS', cloud: 'Cloud et hébergement', telecom: 'Télécoms et réseau',
  staff: 'Assistance technique', cdc: 'Centre de compétences', managed: 'Infogérance', hardware: 'Matériel',
  consulting: 'Conseil et audit', training: 'Formation', travel: 'Frais et déplacements',
};
const REFERENCE = {
  ecom: ['REF-ECOM-CDC', 'Centre de compétences e-commerce : squad externalisée, lignes OPEX et CAPEX, fournisseur variable'],
  sap: ['REF-SAP-S4', 'Programme S/4HANA : régie fonctionnelle et technique, matériel et développement capitalisé'],
  data: ['REF-DATA', 'Plateforme data groupe : licences, hébergement et ingénierie'],
  zt: ['REF-SECU-ZT', 'Programme Zero Trust : audits, outillage et déploiement'],
};
const RECURRENCE = { yes: 'Récurrent', no: 'Non récurrent' };
const valueRows = [['axis_code', 'name', 'description', 'status']];
for (const v of Object.values(NATURE)) valueRows.push(['nature', v, '', 'enabled']);
for (const [code, description] of Object.values(REFERENCE)) valueRows.push(['reference', code, description, 'enabled']);
for (const v of Object.values(RECURRENCE)) valueRows.push(['recurrence', v, '', 'enabled']);
out('27-analytics-values.csv', valueRows);

// ── Accounts per legal entity ───────────────────────────────────────────────
const ACCOUNT = {
  [FR]: { saas: '612100', licence: '612200', cloud: '613100', security: '613200', data: '613300', maint: '615100', telecom: '616100', dc: '616200', staff: '621100', consulting: '622100', dev: '622200', training: '618100', travel: '625100' },
  [NL]: { saas: '45100', licence: '45200', cloud: '45300', security: '45400', data: '45500', maint: '46100', telecom: '46200', dc: '46300', staff: '47100', consulting: '47200', dev: '47100', training: '48100', travel: '48200' },
  [IT]: { saas: '6501', licence: '6502', cloud: '6503', security: '6504', data: '6505', maint: '6601', telecom: '6602', dc: '6603', staff: '6701', consulting: '6702', dev: '6701', training: '6801', travel: '6802' },
  [US]: { saas: '7110', licence: '7120', cloud: '7130', security: '7140', data: '7150', maint: '7210', telecom: '7220', dc: '7230', staff: '7310', consulting: '7320', dev: '7310', training: '7410', travel: '7420' },
};

// ── OPEX items ──────────────────────────────────────────────────────────────
// Existing lines of the fixture, now attached to a cost centre and classified.
// [product_name, cost centre, run/build, nature, recurrence, reference]
const EXISTING = [
  ['Microsoft Enterprise (M365 + Azure + GitHub)', 'FR-TRV-500', 'run', 'licence', 'yes', ''],
  ['SAP S/4HANA Maintenance', 'FR-DIS-300', 'run', 'licence', 'yes', ''],
  ['SAP BW/4HANA License', 'FR-TRV-700', 'run', 'licence', 'yes', 'data'],
  ['Salesforce (Sales + Service Cloud)', 'FR-DIS-300', 'run', 'saas', 'yes', ''],
  ['ServiceNow ITSM Platform', 'FR-TRV-500', 'run', 'saas', 'yes', ''],
  ['Workday HCM', 'FR-TRV-500', 'run', 'saas', 'yes', ''],
  ['OVHcloud Infrastructure', 'FR-TRV-400', 'run', 'cloud', 'yes', ''],
  ['AWS Cloud Hosting', 'FR-BOU-310', 'run', 'cloud', 'yes', 'ecom'],
  ['Datadog Monitoring', 'FR-TRV-400', 'run', 'saas', 'yes', ''],
  ['Okta Workforce Identity', 'FR-TRV-600', 'run', 'saas', 'yes', 'zt'],
  ['Sophos Enterprise Security', 'FR-TRV-600', 'run', 'licence', 'yes', ''],
  ['VMware vSphere Licensing', 'FR-TRV-400', 'run', 'licence', 'yes', ''],
  ['CaveGuard IoT Platform', 'FR-DIS-300', 'run', 'saas', 'yes', ''],
  ['CheeseTrack SaaS', 'FR-DIS-300', 'run', 'saas', 'yes', ''],
  ['Network & Telecom Services', 'FR-TRV-400', 'run', 'telecom', 'yes', ''],
  ['IT Staff Augmentation', 'FR-TRV-700', 'run', 'staff', 'no', ''],
  ['Managed Services — Axians Infogérance', 'FR-TRV-400', 'run', 'managed', 'yes', ''],
  ['Cybersecurity Consulting & Audits', 'FR-TRV-600', 'build', 'consulting', 'no', 'zt'],
  ['Various SaaS Bundle', 'FR-TRV-500', 'run', 'saas', 'yes', ''],
  ['Fortinet FortiCare & FortiGuard', 'FR-TRV-600', 'run', 'licence', 'yes', ''],
  ['IT Training & Certification', 'FR-TRV-700', 'run', 'training', 'yes', ''],
  ['IT Travel & Events', 'FR-TRV-700', 'run', 'travel', 'yes', ''],
  ['Sage X3 Licenties — Kaasmeester', 'NL-DIS-300', 'run', 'licence', 'yes', ''],
  ['Sage X3 Licenze — Formaggio Supremo', 'IT-BOU-310', 'run', 'licence', 'yes', ''],
  ['US Office IT Services', 'US-BOU-310', 'run', 'managed', 'yes', ''],
  ['US Managed IT Services', 'US-BOU-310', 'run', 'managed', 'yes', ''],
  ['US Telecom & Internet', 'US-BOU-310', 'run', 'telecom', 'yes', ''],
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
  'owner_it_email', 'owner_business_email', 'analytics_category', 'analytics:nature', 'analytics:reference', 'analytics:recurrence', 'cost_center_code', 'run_build', 'notes',
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
for (const [name, cc, runBuild, nature, recurrence, reference] of EXISTING) {
  const r = byName[name];
  if (!r) throw new Error(`Existing line not found: ${name}`);
  const budget = Number(r.y_budget);
  const ratio = EXISTING_LANDING[name] ?? between(0.98, 1.03);
  const landing = round(budget * ratio, 500);
  const revision = rnd() < 0.5 ? round(budget * between(0.98, 1.02), 500) : '';
  opexRows.push([r.product_name, r.description, r.supplier_name, r.company_name, r.account_number, r.currency, r.effective_start, r.status, r.disabled_at,
    r.owner_it_email, r.owner_business_email, r.analytics_category, NATURE[nature], reference ? REFERENCE[reference][0] : '', RECURRENCE[recurrence], cc, runBuild, r.notes,
    r.y_minus1_budget, r.y_minus1_landing, budget, '', landing, revision, '', '']);
  const endMonth = r.disabled_at?.startsWith('2026-') ? Number(r.disabled_at.slice(5, 7)) : 12;
  const landingMonths = flat(landing, 1, endMonth);
  pushActuals('opex', name, landingMonths);
  if (rnd() < 0.3) pushForecast('opex', name, flat(round(budget * between(0.98, 1.04), 500)));
}

// New non-staffing lines. [name, description, supplier, cost centre, account key, domaine, nature, run/build, recurrence, reference, budget 2026, start, end, landing ratio]
const NEW_LINES = [
  // Distribution & restauration
  ['Generix EDI Platform', 'Échanges EDI avec la grande distribution et la restauration collective', 'Generix Group', 'FR-DIS-300', 'saas', 'Supply Chain', 'saas', 'run', 'yes', '', 96000, '2023-01-01', '', 1.0],
  ['Fromage B2B Portal hosting', 'Hébergement et exploitation du portail distributeurs', '', 'FR-DIS-300', 'cloud', 'E-commerce', 'cloud', 'run', 'yes', '', 42000, '2024-01-01', '', 1.05],
  ['Akeneo PIM', 'Référentiel produit groupe : fiches, allergènes, photos', 'Akeneo', 'FR-DIS-300', 'saas', 'Supply Chain', 'saas', 'run', 'yes', '', 58000, '2025-01-01', '', 1.0],
  ['SAP support externe — Distribution', 'Tierce maintenance applicative SAP SD/MM, forfait mensuel', 'Fromatech Consulting', 'FR-DIS-300', 'maint', 'ERP', 'managed', 'run', 'yes', 'sap', 144000, '2024-01-01', '', 1.0],
  ['Coupa Procurement', 'Achats indirects et notes de frais', 'Coupa', 'FR-DIS-300', 'saas', 'ERP', 'saas', 'run', 'yes', '', 64000, '2024-07-01', '', 0.97],
  ['Salesforce CPQ add-on', 'Devis et grilles tarifaires restauration', 'Salesforce', 'FR-DIS-200', 'saas', 'CRM', 'saas', 'run', 'yes', '', 36000, '2026-01-01', '', 1.0],
  ['Distribution — tests de performance', 'Campagnes de tests de charge avant les pics de fin d\'année', '', 'FR-DIS-200', 'consulting', 'General', 'consulting', 'build', 'no', '', 24000, '2026-01-01', '', 1.1],
  ['Distribution — formation utilisateurs', 'Formation des forces de vente aux nouveaux outils', '', 'FR-DIS-100', 'training', 'Training', 'training', 'build', 'no', '', 18000, '2025-01-01', '', 0.8],
  ['Kaasmeester WMS — licenties', 'Gestion d\'entrepôt de Gouda, licences et maintenance', '', 'NL-DIS-300', 'licence', 'Supply Chain', 'licence', 'run', 'yes', '', 41000, '2023-01-01', '', 1.0],
  ['Kaasmeester — KPN connectivity', 'Liaisons entrepôt et bureaux de Gouda', 'KPN', 'NL-DIS-300', 'telecom', 'Infrastructure', 'telecom', 'run', 'yes', '', 22000, '2023-01-01', '', 1.0],
  ['Kaasmeester — werkplekbeheer', 'Infogérance du poste de travail Benelux', 'Benelux IT Partners', 'NL-DIS-300', 'maint', 'Managed Services', 'managed', 'run', 'yes', '', 54000, '2024-01-01', '', 1.02],
  // Boutiques & e-commerce
  ['Cegid Retail POS', 'Logiciel de caisse des boutiques France, licences et maintenance', 'Cegid', 'FR-BOU-310', 'licence', 'Retail', 'licence', 'run', 'yes', '', 88000, '2022-01-01', '', 0.88],
  ['La Boutique — paiement et fraude', 'Frais de plateforme de paiement et de détection de fraude', '', 'FR-BOU-310', 'saas', 'E-commerce', 'saas', 'run', 'yes', 'ecom', 54000, '2025-06-01', '', 1.25],
  ['La Boutique — CDN et sécurité applicative', 'Diffusion de contenu, WAF et protection anti-robots du site marchand', '', 'FR-BOU-310', 'cloud', 'E-commerce', 'cloud', 'run', 'yes', 'ecom', 30000, '2025-06-01', '', 1.1],
  ['La Boutique — emailing et CRM abonnés', 'Plateforme d\'emailing des abonnés aux box fromage', 'HubSpot', 'FR-BOU-310', 'saas', 'CRM', 'saas', 'run', 'yes', '', 26000, '2025-09-01', '', 1.0],
  ['Boutiques — connectivité 4G de secours', 'Routeurs 4G et abonnements de secours des boutiques', 'Orange Business', 'FR-BOU-310', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 19000, '2024-01-01', '', 1.0],
  ['Boutiques — maintenance des caisses et imprimantes', 'Maintenance sur site du matériel de caisse et des imprimantes d\'étiquettes', '', 'FR-BOU-310', 'maint', 'Retail', 'hardware', 'run', 'yes', '', 33000, '2023-01-01', '', 1.0],
  ['E-commerce — UX research et tests utilisateurs', 'Tests utilisateurs du parcours d\'abonnement', '', 'FR-BOU-100', 'consulting', 'E-commerce', 'consulting', 'build', 'no', 'ecom', 28000, '2026-01-01', '', 1.0],
  ['E-commerce — photos et contenus produits', 'Prises de vue et fiches produit du site marchand', '', 'FR-BOU-100', 'consulting', 'E-commerce', 'consulting', 'build', 'no', '', 22000, '2026-01-01', '', 1.15],
  ['Formaggio — software punti vendita', 'Caisses des boutiques italiennes, licences et maintenance', 'Cegid', 'IT-BOU-310', 'licence', 'Retail', 'licence', 'run', 'yes', '', 31000, '2023-01-01', '', 1.0],
  ['Formaggio — connettività TIM', 'Liaisons des boutiques et de l\'usine de Parme', 'TIM Business', 'IT-BOU-310', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 17000, '2023-01-01', '', 1.0],
  ['Formaggio — assistenza IT', 'Infogérance locale du poste de travail et des boutiques', 'DevHouse Milano', 'IT-BOU-310', 'maint', 'Managed Services', 'managed', 'run', 'yes', '', 46000, '2024-01-01', '', 1.0],
  ['US e-commerce — Shopify Plus', 'Site marchand américain, abonnement et frais de plateforme', 'Shopify', 'US-BOU-310', 'saas', 'E-commerce', 'saas', 'run', 'yes', '', 48000, '2025-03-01', '', 1.08],
  ['US e-commerce — AWS hosting', 'Hébergement des services de commande et de logistique US', '', 'US-BOU-310', 'cloud', 'Infrastructure', 'cloud', 'run', 'yes', '', 36000, '2025-03-01', '', 1.1],
  ['US — Verizon connectivity', 'Liaisons des bureaux et de l\'entrepôt US', 'Verizon Business', 'US-BOU-310', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 21000, '2024-01-01', '', 1.0],
  // Infrastructure et cloud
  ['Paris DC — colocation et énergie', 'Colocation, énergie et maintenance du centre de données de Paris', '', 'FR-TRV-400', 'dc', 'Infrastructure', 'cloud', 'run', 'yes', '', 210000, '2022-01-01', '', 1.03],
  ['Veeam Backup & Replication', 'Sauvegarde des environnements virtualisés, licences et support', 'Veeam', 'FR-TRV-400', 'licence', 'Infrastructure', 'licence', 'run', 'yes', '', 38000, '2024-01-01', '', 1.0],
  ['Cisco Meraki — réseau des sites', 'Réseau et Wi-Fi des usines, caves et bureaux, licences cloud', 'Cisco', 'FR-TRV-400', 'telecom', 'Network', 'licence', 'run', 'yes', '', 72000, '2024-01-01', '', 1.0],
  ['Orange Business — WAN groupe', 'Réseau étendu des sites français et interconnexion des filiales', 'Orange Business', 'FR-TRV-400', 'telecom', 'Network', 'telecom', 'run', 'yes', '', 165000, '2023-01-01', '', 0.98],
  ['Serveurs et stockage — maintenance constructeur', 'Extensions de garantie et support des hôtes et baies', 'Dell Technologies', 'FR-TRV-400', 'maint', 'Infrastructure', 'hardware', 'run', 'yes', '', 46000, '2023-01-01', '', 1.0],
  ['Azure — consommation data', 'Hébergement de la plateforme data et des traitements', 'Microsoft', 'FR-TRV-400', 'cloud', 'Analytics', 'cloud', 'run', 'yes', 'data', 95000, '2025-01-01', '', 1.12],
  ['Snowflake', 'Entrepôt de données groupe, consommation', 'Snowflake', 'FR-TRV-700', 'data', 'Analytics', 'saas', 'run', 'yes', 'data', 84000, '2025-09-01', '', 1.2],
  ['Talend Data Integration', 'Intégration de données, licences et support', '', 'FR-TRV-700', 'data', 'Analytics', 'licence', 'run', 'yes', 'data', 42000, '2023-01-01', '', 1.0],
  ['Power BI Premium', 'Capacité Premium pour les tableaux de bord groupe', 'Microsoft', 'FR-TRV-700', 'saas', 'Analytics', 'saas', 'run', 'yes', 'data', 60000, '2024-01-01', '', 1.0],
  // Poste de travail et support
  ['Postes de travail — location', 'Location des ordinateurs portables et fixes du groupe (parc France)', 'Lenovo', 'FR-TRV-500', 'maint', 'Workplace', 'hardware', 'run', 'yes', '', 186000, '2023-01-01', '', 1.0],
  ['Impression — contrat de pages', 'Copieurs et imprimantes des sites, coût à la page', '', 'FR-TRV-500', 'maint', 'Workplace', 'hardware', 'run', 'yes', '', 34000, '2022-01-01', '', 0.92],
  ['Téléphonie mobile', 'Abonnements mobiles des collaborateurs France', 'Orange Business', 'FR-TRV-500', 'telecom', 'Workplace', 'telecom', 'run', 'yes', '', 98000, '2023-01-01', '', 1.0],
  ['Centre de services — infogérance de niveau 1', 'Accueil téléphonique et traitement de niveau 1 des demandes', 'Axians', 'FR-TRV-500', 'maint', 'ITSM', 'managed', 'run', 'yes', '', 132000, '2024-01-01', '', 1.0],
  ['Adobe Creative Cloud', 'Licences création pour le marketing et le e-commerce', 'Adobe', 'FR-TRV-500', 'saas', 'Workplace', 'saas', 'run', 'yes', '', 24000, '2024-01-01', '', 1.0],
  ['Atlassian Cloud (Jira, Confluence)', 'Outils de gestion de projet et de documentation', 'Atlassian', 'FR-TRV-500', 'saas', 'Productivity', 'saas', 'run', 'yes', '', 52000, '2023-01-01', '', 1.0],
  ['Lotus Notes — support de fin de vie', 'Support éditeur résiduel jusqu\'au décommissionnement', '', 'FR-TRV-500', 'maint', 'Productivity', 'licence', 'run', 'yes', '', 15000, '2022-01-01', '2026-12-31', 1.0],
  ['Legacy HR System (PeopleSoft) — maintenance', 'Maintenance du SIRH historique jusqu\'à la bascule Workday', '', 'FR-TRV-500', 'maint', 'HR', 'licence', 'run', 'yes', '', 62000, '2020-01-01', '2026-12-31', 1.0],
  ['Old Intranet — hébergement', 'Hébergement de l\'intranet historique, arrêté en juin 2026', '', 'FR-TRV-500', 'cloud', 'Productivity', 'cloud', 'run', 'yes', '', 9000, '2019-01-01', '2026-06-30', 0.5],
  // Sécurité
  ['Tenable.io', 'Gestion des vulnérabilités, abonnement', '', 'FR-TRV-600', 'security', 'Security', 'saas', 'run', 'yes', 'zt', 36000, '2024-01-01', '', 1.0],
  ['SOC externalisé', 'Surveillance 24/7 et réponse à incident', 'Axians', 'FR-TRV-600', 'security', 'Security', 'managed', 'run', 'yes', '', 144000, '2025-01-01', '', 1.0],
  ['Sensibilisation phishing', 'Campagnes de sensibilisation et plateforme d\'entraînement', '', 'FR-TRV-600', 'saas', 'Security', 'saas', 'run', 'yes', '', 18000, '2025-01-01', '', 1.0],
  ['Tests d\'intrusion annuels', 'Tests d\'intrusion externes et internes, deux campagnes', '', 'FR-TRV-600', 'consulting', 'Security', 'consulting', 'build', 'no', 'zt', 45000, '2024-01-01', '', 1.0],
  ['Certificats et PKI', 'Certificats TLS, signature de code et PKI interne', 'DocuSign', 'FR-TRV-600', 'security', 'Security', 'saas', 'run', 'yes', '', 12000, '2023-01-01', '', 1.0],
  // Pilotage DSI
  ['Cabinet de conseil — schéma directeur', 'Accompagnement du schéma directeur SI 2027-2030', '', 'FR-TRV-700', 'consulting', 'General', 'consulting', 'build', 'no', '', 90000, '2026-01-01', '', 1.1],
  ['Audit des licences', 'Revue annuelle des droits d\'usage éditeurs', '', 'FR-TRV-700', 'consulting', 'General', 'consulting', 'run', 'no', '', 25000, '2024-01-01', '', 1.0],
  ['Veille et abonnements analystes', 'Abonnements d\'études et de veille technologique', '', 'FR-TRV-700', 'travel', 'General', 'travel', 'run', 'yes', '', 28000, '2023-01-01', '', 1.0],
  ['Recrutement IT', 'Honoraires de cabinets pour les recrutements de la DSI', '', 'FR-TRV-700', 'consulting', 'General', 'consulting', 'run', 'no', '', 40000, '2024-01-01', '', 1.3],
];
const OWNER_IT = { 'FR-DIS-100': 'clara.dupont@fromage-co.com', 'FR-DIS-200': 'lucas.bernard@fromage-co.com', 'FR-DIS-300': 'pierre.martin@fromage-co.com', 'NL-DIS-300': 'jan.bakker@kaasmeester.nl',
  'FR-BOU-100': 'amelie.rousseau@fromage-co.com', 'FR-BOU-310': 'nadia.lemaire@fromage-co.com', 'IT-BOU-310': 'luca.ferrari@formaggio-supremo.it', 'US-BOU-310': 'mike.johnson@fromage-co.com',
  'FR-TRV-400': 'marc.petit@fromage-co.com', 'FR-TRV-500': 'olivier.garnier@fromage-co.com', 'FR-TRV-600': 'ines.chevalier@fromage-co.com', 'FR-TRV-700': 'marie.fontaine@fromage-co.com' };
const OWNER_BUSINESS = { 'DIV-DIS': 'isabelle.moreau@fromage-co.com', 'DIV-BOU': 'isabelle.moreau@fromage-co.com', 'DIV-TRV': 'thomas.berger@fromage-co.com' };
const ccGroup = Object.fromEntries(CC.map((c) => [c[0], c[2]]));

for (const [name, description, supplier, cc, accountKey, domaine, nature, runBuild, recurrence, reference, budget, start, end, landingRatio] of NEW_LINES) {
  const company = ccCompany[cc];
  const budget2025 = start >= '2026-01-01' ? '' : round(budget * between(0.9, 0.97), 500);
  const landing2025 = budget2025 === '' ? '' : round(budget2025 * between(0.97, 1.04), 500);
  const landing = round(budget * landingRatio, 500);
  const revision = rnd() < 0.5 ? round(budget * between(0.98, 1.03), 500) : '';
  opexRows.push([name, description, supplier, company, ACCOUNT[company][accountKey], CURRENCY[company], start, 'enabled', end,
    OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], domaine, NATURE[nature], reference ? REFERENCE[reference][0] : '', RECURRENCE[recurrence], cc, runBuild,
    end ? `Fin de validité ${end}` : '', budget2025, landing2025, budget, '', landing, revision, '', '']);
  const endMonth = end?.startsWith('2026-') ? Number(end.slice(5, 7)) : 12;
  pushActuals('opex', name, flat(landing, 1, endMonth));
  if (rnd() < 0.3) pushForecast('opex', name, flat(round(budget * between(0.98, 1.04), 500), 1, endMonth));
}

// External staffing: people priced per working day, computed from a calendar.
// [cost centre, profile, supplier, unit price, quantity, run/build, nature, reference, budget period, landing period (null = same)]
const STAFFING = [
  ['FR-DIS-100', 'Chef de projet EDI', 'Fromatech Consulting', 850, 1, 'build', 'staff', '', ['01-01', '12-31'], null],
  ['FR-DIS-100', 'Business analyst ventes', 'Fromatech Consulting', 720, 1, 'build', 'staff', '', ['01-01', '12-31'], null],
  ['FR-DIS-200', 'Développeur senior SAP SD', 'Fromatech Consulting', 790, 1, 'build', 'cdc', 'sap', ['01-01', '12-31'], null],
  ['FR-DIS-200', 'Développeur SAP MM', 'Nearshore Digital Lisboa', 480, 2, 'build', 'cdc', 'sap', ['01-01', '12-31'], null],
  ['FR-DIS-200', 'Architecte intégration', 'Fromatech Consulting', 950, 1, 'build', 'staff', '', ['02-01', '12-31'], ['04-01', '12-31']],   // arrived two months late
  ['FR-DIS-200', 'Développeur portail B2B', 'Nearshore Digital Lisboa', 460, 1, 'build', 'staff', '', ['01-01', '12-31'], null],
  ['FR-DIS-300', 'Administrateur SAP Basis', 'Fromatech Consulting', 820, 1, 'run', 'staff', 'sap', ['01-01', '12-31'], null],
  ['FR-DIS-300', 'Analyste support applicatif', 'Nearshore Digital Lisboa', 410, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['NL-DIS-300', 'Applicatiebeheerder Sage X3', 'Benelux IT Partners', 690, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['NL-DIS-300', 'Projectleider WMS', 'Benelux IT Partners', 820, 1, 'build', 'staff', '', ['01-01', '09-30'], null],
  ['FR-BOU-100', 'Product owner e-commerce', 'Fromatech Consulting', 880, 1, 'build', 'cdc', 'ecom', ['01-01', '12-31'], null],
  ['FR-BOU-100', 'Développeur front e-commerce', 'Nearshore Digital Lisboa', 470, 2, 'build', 'cdc', 'ecom', ['01-01', '12-31'], null],
  ['FR-BOU-100', 'Développeur back e-commerce', 'Nearshore Digital Lisboa', 490, 2, 'build', 'cdc', 'ecom', ['01-01', '12-31'], null],
  ['FR-BOU-100', 'Développeur mobile', 'DevHouse Milano', 560, 1, 'build', 'cdc', 'ecom', ['05-01', '12-31'], ['05-01', '12-31']],
  ['FR-BOU-100', 'UX designer', 'Fromatech Consulting', 760, 1, 'build', 'staff', 'ecom', ['01-01', '06-30'], ['01-01', '10-31']],   // extended: project accelerated
  ['FR-BOU-310', 'Ingénieur DevOps e-commerce', 'Fromatech Consulting', 840, 1, 'run', 'cdc', 'ecom', ['01-01', '12-31'], null],
  ['FR-BOU-310', 'Support caisses niveau 2', 'Fromatech Consulting', 580, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-BOU-310', 'Analyste exploitation e-commerce', 'Nearshore Digital Lisboa', 430, 1, 'run', 'staff', 'ecom', ['01-01', '12-31'], null],
  ['FR-BOU-310', 'Administrateur plateforme paiement', 'Fromatech Consulting', 700, 1, 'run', 'staff', 'ecom', ['07-01', '12-31'], ['06-01', '12-31']],
  ['IT-BOU-310', 'Sistemista punti vendita', 'DevHouse Milano', 520, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['IT-BOU-310', 'Sviluppatore integrazioni', 'DevHouse Milano', 540, 1, 'build', 'staff', '', ['03-01', '12-31'], null],
  ['US-BOU-310', 'E-commerce engineer', 'Atlantic IT Solutions', 900, 1, 'build', 'staff', '', ['01-01', '12-31'], null],
  ['US-BOU-310', 'Site reliability engineer', 'Atlantic IT Solutions', 950, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Ingénieur système Windows', 'Fromatech Consulting', 650, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Ingénieur système Linux', 'Fromatech Consulting', 680, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Ingénieur réseau', 'Alpine Data Experts', 720, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Ingénieur cloud Azure', 'Alpine Data Experts', 820, 1, 'build', 'staff', 'data', ['01-01', '12-31'], null],
  ['FR-TRV-400', 'Chef de projet refonte DC', 'Alpine Data Experts', 860, 1, 'build', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'Technicien support de proximité Paris', 'Axians', 380, 2, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'Technicien support de proximité usines', 'Axians', 380, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'Administrateur M365', 'Fromatech Consulting', 620, 1, 'run', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'Chef de projet Workday', 'Alpine Data Experts', 880, 1, 'build', 'staff', '', ['01-01', '12-31'], null],
  ['FR-TRV-500', 'Consultant Workday paie', 'Alpine Data Experts', 1050, 1, 'build', 'staff', '', ['01-01', '09-30'], ['01-01', '12-31']],
  ['FR-TRV-600', 'Analyste SOC interne', 'Fromatech Consulting', 700, 1, 'run', 'staff', 'zt', ['01-01', '12-31'], null],
  ['FR-TRV-600', 'Ingénieur sécurité réseau', 'Alpine Data Experts', 820, 1, 'build', 'staff', 'zt', ['01-01', '12-31'], null],
  ['FR-TRV-600', 'Consultant IAM', 'Fromatech Consulting', 900, 1, 'build', 'staff', 'zt', ['02-01', '10-31'], null],
  ['FR-TRV-700', 'Data engineer', 'Alpine Data Experts', 760, 1, 'build', 'cdc', 'data', ['01-01', '12-31'], null],
  ['FR-TRV-700', 'Data analyst', 'Nearshore Digital Lisboa', 440, 1, 'run', 'cdc', 'data', ['01-01', '12-31'], null],
  ['FR-TRV-700', 'Contrôleur de gestion IT en renfort', 'Alpine Data Experts', 700, 1, 'run', 'staff', '', ['01-01', '06-30'], ['01-01', '08-31']],
];
const SHORT = Object.fromEntries(CC.map((c) => [c[0], c[0].slice(3)]));

/** Monthly amounts of a person-days line over a period, on a calendar. */
function staffMonths(year, calendarCode, quantity, unitPrice, [start, end]) {
  const days = calendarCode === 'CAD218' ? CAD218[year] : WORKING[year]; // foreign standard calendars approximated by the French one
  const s = Number(start.slice(0, 2)), e = Number(end.slice(0, 2));
  return MONTHS.map((_, i) => (i + 1 >= s && i + 1 <= e ? Math.round(days[i] * quantity * unitPrice * 100) / 100 : 0));
}
const sum = (a) => Math.round(a.reduce((x, y) => x + y, 0));

for (const [cc, profile, supplier, price, quantity, runBuild, nature, reference, budgetPeriod, landingPeriodRaw] of STAFFING) {
  const company = ccCompany[cc];
  const calendar = STAFF_CAL[company];
  const name = `Régie · ${profile} · ${SHORT[cc]}`;
  const landingPeriod = landingPeriodRaw ?? budgetPeriod;
  const budgetMonths = staffMonths(2026, calendar, quantity, price, budgetPeriod);
  const landingMonths = staffMonths(2026, calendar, quantity, price, landingPeriod);
  const budget2025 = round(sum(budgetMonths) * between(0.85, 0.97), 500);
  const qtyText = quantity > 1 ? `${quantity} personnes` : '1 personne';
  const description = `${profile} en assistance technique : ${qtyText} × ${price} ${CURRENCY[company]} par jour, calendrier ${calendar}`;
  opexRows.push([name, description, supplier, company, ACCOUNT[company].staff, CURRENCY[company], '2025-01-01', 'enabled', '',
    OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], 'Professional Services', NATURE[nature], reference ? REFERENCE[reference][0] : '', RECURRENCE.no, cc, runBuild,
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
const CAPEX_HEADER = ['item_number', 'description', 'ppe_type', 'investment_type', 'priority', 'currency', 'effective_start', 'status', 'disabled_at', 'notes',
  'company_name', 'owner_it_email', 'owner_business_email', 'analytics_category', 'analytics:nature', 'analytics:reference', 'analytics:recurrence', 'cost_center_code', 'run_build',
  'y_minus1_budget', 'y_minus1_landing', 'y_budget', 'y_follow_up', 'y_landing', 'y_revision', 'y_plus1_budget', 'y_plus1_revision', 'y_plus2_budget'];
const capexRows = [CAPEX_HEADER];
// Existing CAPEX lines, re-attached: [description, cost centre, nature, reference, landing ratio]
const EXISTING_CAPEX = [
  ['SAP Cheddar Migration — S/4HANA upgrade', 'FR-DIS-200', 'cdc', 'sap', 1.09],
  ['Data Center Refresh — Paris DC', 'FR-TRV-400', 'hardware', '', 1.04],
  ['D2C E-commerce Platform — La Boutique', 'FR-BOU-100', 'cdc', 'ecom', 0.96],
];
const capexExisting = parseCsv(readFileSync(path.join(ROOT, '15-capex-items.csv'), 'utf8'));
for (const [description, cc, nature, reference, ratio] of EXISTING_CAPEX) {
  const r = capexExisting.find((x) => x.description === description);
  if (!r) throw new Error(`Existing CAPEX line not found: ${description}`);
  const budget = Number(r.y_budget);
  const landing = round(budget * ratio, 1000);
  capexRows.push(['', r.description, r.ppe_type, r.investment_type, r.priority, r.currency, r.effective_start, r.status, r.disabled_at, r.notes,
    r.company_name, OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], r.analytics_category, NATURE[nature], reference ? REFERENCE[reference][0] : '', RECURRENCE.no, cc, 'build',
    r.y_minus1_budget, r.y_minus1_landing, budget, '', landing, round(budget * between(0.98, 1.05), 1000), '', '', '']);
  const endMonth = r.disabled_at?.startsWith('2026-') ? Number(r.disabled_at.slice(5, 7)) : 12;
  pushActuals('capex', description, flat(landing, 1, endMonth));
}
// New CAPEX lines. [description, ppe_type, investment_type, priority, cost centre, domaine, nature, reference, budget 2026, start, end, landing ratio, staffing line | null]
const NEW_CAPEX = [
  ['S/4HANA — développements spécifiques capitalisés', 'software', 'replacement', 'mandatory', 'FR-DIS-200', 'ERP', 'cdc', 'sap', 0, '2026-01-01', '2027-06-30', 1.0,
    ['Développeur SAP ABAP', 'Nearshore Digital Lisboa', 520, 2, ['01-01', '12-31'], ['01-01', '12-31']]],
  ['S/4HANA — serveurs HANA', 'hardware', 'replacement', 'mandatory', 'FR-TRV-400', 'ERP', 'hardware', 'sap', 180000, '2026-01-01', '2026-12-31', 1.02, null],
  ['La Boutique — version 2 (abonnements et marketplace)', 'software', 'business_growth', 'high', 'FR-BOU-100', 'E-commerce', 'cdc', 'ecom', 0, '2026-01-01', '2027-03-31', 1.0,
    ['Développeur full stack e-commerce', 'Nearshore Digital Lisboa', 480, 2, ['01-01', '12-31'], ['01-01', '12-31']]],
  ['Boutiques — renouvellement des caisses', 'hardware', 'replacement', 'high', 'FR-BOU-310', 'Retail', 'hardware', '', 140000, '2026-01-01', '2026-12-31', 0.9, null],
  ['Formaggio — nuove casse punti vendita', 'hardware', 'replacement', 'high', 'IT-BOU-310', 'Retail', 'hardware', '', 45000, '2026-03-01', '2026-12-31', 1.0, null],
  ['US — warehouse management system', 'software', 'business_growth', 'high', 'US-BOU-310', 'Supply Chain', 'licence', '', 95000, '2026-01-01', '2026-12-31', 1.15, null],
  ['Kaasmeester — WMS upgrade', 'software', 'replacement', 'high', 'NL-DIS-300', 'Supply Chain', 'licence', '', 60000, '2026-01-01', '2026-09-30', 1.0, null],
  ['CaveGuard — déploiement sur les 8 caves', 'hardware', 'business_growth', 'high', 'FR-DIS-300', 'IoT', 'hardware', '', 75000, '2026-01-01', '2026-12-31', 1.0, null],
  ['Plateforme data — construction', 'software', 'business_growth', 'high', 'FR-TRV-700', 'Analytics', 'cdc', 'data', 0, '2026-01-01', '2026-12-31', 1.0,
    ['Data engineer plateforme', 'Alpine Data Experts', 780, 2, ['01-01', '12-31'], ['01-01', '12-31']]],
  ['Zero Trust — segmentation réseau des usines', 'hardware', 'replacement', 'mandatory', 'FR-TRV-600', 'Security', 'hardware', 'zt', 120000, '2026-01-01', '2026-12-31', 1.05, null],
  ['Postes de travail — renouvellement usines', 'hardware', 'replacement', 'high', 'FR-TRV-500', 'Workplace', 'hardware', '', 85000, '2026-01-01', '2026-12-31', 1.0, null],
  ['Réseau Wi-Fi des caves et entrepôts', 'hardware', 'replacement', 'high', 'FR-TRV-400', 'Network', 'hardware', '', 55000, '2026-01-01', '2026-12-31', 1.0, null],
];
for (const [description, ppe, inv, prio, cc, domaine, nature, reference, budgetRaw, start, end, ratio, staffing] of NEW_CAPEX) {
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
  capexRows.push(['', description, ppe, inv, prio, CURRENCY[company], start, 'enabled', end, '',
    company, OWNER_IT[cc], OWNER_BUSINESS[ccGroup[cc]], domaine, NATURE[nature], reference ? REFERENCE[reference][0] : '', RECURRENCE.no, cc, 'build',
    '', '', budget, '', landing, rnd() < 0.5 ? round(budget * between(0.98, 1.05), 1000) : '', '', '', '']);
}
out('15-capex-items.csv', capexRows);
out('29-budget-rows.csv', budgetRows);
out('30-costed-lines.csv', lineRows);

// ── Summary ─────────────────────────────────────────────────────────────────
const opexData = opexRows.slice(1);
const total = (rows, i) => rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);
const colIndex = OPEX_HEADER.indexOf('y_budget');
const staffing = opexData.filter((r) => r[0].startsWith('Régie'));
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
