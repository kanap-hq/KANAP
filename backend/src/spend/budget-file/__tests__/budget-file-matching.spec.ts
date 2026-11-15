import * as assert from 'node:assert/strict';
import { readBudgetCsv } from '../interpret';
import { backendPath } from '../../../common/__tests__/backend-root';
import {
  closestNames,
  findFixtureDimensionsModule,
  fixtureValueKeysByName,
  parseBudgetFileChoices,
  recommendedKeyOf,
  similarity,
  translationTableOf,
} from '../matching';
import { BudgetFileAccess, planBudgetFile } from '../preflight';
import { BudgetCatalog, BudgetFileChoice, BudgetFileMatchOptions, CatalogDimension, emptyCatalog } from '../types';

// Lot I1 of 26.11.9, "match before create": the budget file's check finds an existing supplier or
// dimension value before it creates one (accents, the four languages of the recommended dimensions
// and of the sample data's business domain, Kad's proposals checked against the list), lists every match beyond case, and follows the person's
// choices (a match undone, the "Create missing suppliers" option). Pure: the check reads no database.

const value = (id: string, name: string, disabledAt: string | null = null) => ({ id, name, disabledAt });

function dimension(code: string, axisName: string | null, names: Array<ReturnType<typeof value>>, patch: Partial<CatalogDimension> = {}): CatalogDimension {
  return { code, name: axisName ?? code, axisName, required: false, openValues: true, values: names, ...patch };
}

/** A French workspace: its recommended dimensions in French, the sample data's own business domain, its suppliers. */
function frenchCatalog(patch: Partial<BudgetCatalog> = {}): BudgetCatalog {
  return emptyCatalog({
    companies: [
      { id: 'c1', name: 'Fromage & Co SA', coaId: null, disabledAt: null },
      { id: 'c2', name: 'Formaggio Supremo SRL', coaId: null, disabledAt: null },
    ],
    accounts: [{ id: 'a1', number: '612200', coaId: null, disabledAt: null }, { id: 'a2', number: '218300', coaId: null, disabledAt: null }],
    suppliers: [
      { id: 's1', name: 'Société Générale', erpId: null, disabledAt: null },
      { id: 's2', name: 'Cegid', erpId: null, disabledAt: null },
      { id: 's3', name: 'Orange Business', erpId: null, disabledAt: null },
      { id: 's4', name: 'Ancien prestataire', erpId: null, disabledAt: '2020-01-01T00:00:00.000Z' },
    ],
    dimensions: [
      dimension('default', 'Nature de coût', [value('d1', 'Matériel'), value('d2', 'Logiciel')]),
      dimension('priority', 'Priorité', [value('p1', 'Obligatoire'), value('p2', 'Haute'), value('p3', 'Moyenne')]),
      dimension('recurrence', 'Récurrence', [value('r1', 'Récurrent'), value('r2', 'Ponctuel')]),
      dimension('business_domain', 'Domaine métier', [
        value('b1', 'Magasins'), value('b2', 'IT partagée'), value('b3', 'Revue d\'affaires trimestrielle'), value('b4', 'Ancien domaine', '2020-01-01T00:00:00.000Z'),
        value('b5', 'Chaîne logistique'),
      ]),
    ],
    ...patch,
  });
}

const DIMENSIONS = ['default', 'priority', 'recurrence', 'business_domain'];
const HEADER = 'item_number,nature,name,company_name,account_number,supplier_name,currency,analytics:default,analytics:priority,analytics:recurrence,analytics:business_domain\n';

async function check(
  rows: string[],
  options: {
    cat?: BudgetCatalog; matching?: BudgetFileMatchOptions; createSuppliers?: boolean; canCreateSuppliers?: boolean; access?: BudgetFileAccess;
    canReadSuppliers?: boolean; canReadCompanies?: boolean;
  } = {},
) {
  const read = await readBudgetCsv(`${HEADER}${rows.join('\n')}\n`, { language: 'en', dimensionCodes: DIMENSIONS });
  return planBudgetFile({
    scope: 'opex', read, catalog: options.cat ?? frenchCatalog(), stored: [], names: [],
    createSuppliers: options.createSuppliers ?? true, canCreateSuppliers: options.canCreateSuppliers ?? true,
    canReadSuppliers: options.canReadSuppliers ?? true, canReadCompanies: options.canReadCompanies ?? true,
    currentYear: 2026, labels: {}, ...(options.access ? { access: options.access } : {}),
    ...(options.matching ? { matching: options.matching } : {}),
  });
}

function matchesOf(report: Awaited<ReturnType<typeof check>>['report']) {
  return report.matching!.matches.map((match) => [match.column, match.value, match.target, match.origin, match.reason, match.lines]);
}

// The recommended dimensions are found by their code, an older code, or the default dimension named as the cost pool.
function testRecommendedKeys() {
  assert.equal(recommendedKeyOf({ code: 'priority', axisName: 'Priorité' }), 'priority');
  assert.equal(recommendedKeyOf({ code: 'investment_type', axisName: 'Type' }), 'purpose');
  assert.equal(recommendedKeyOf({ code: 'default', axisName: 'Nature de coût' }), 'cost_pool');
  assert.equal(recommendedKeyOf({ code: 'default', axisName: 'Nature de coût (2)' }), 'cost_pool');
  assert.equal(recommendedKeyOf({ code: 'default', axisName: 'Centres' }), null);
  assert.equal(recommendedKeyOf({ code: 'business_domain', axisName: 'Domaine métier' }), null);
  console.log('  recommended dimensions found by code or by the cost pool\'s name: OK');
}

// The server matches what it can without the model: accents, and the recommended values' names in
// the four languages. A match by case is the same value, as before: not listed.
async function testServerMatches() {
  const { report, plans } = await check([
    ',opex,Licences,Fromage & Co SA,612200,SOCIETE GENERALE,EUR,Software,High,Recurring,magasins',
    ',capex,Caisses,Fromage & Co SA,218300,,EUR,Hardware,Mandatory,One-off,Magasins',
    ',capex,Serveurs,Fromage & Co SA,218300,,EUR,Materiel,Haute,ponctuel,IT partagee',
  ]);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.creates.dimensionValues, [], 'nothing to create');
  assert.equal(report.creates.supplierCount, 0);
  assert.deepEqual(matchesOf(report), [
    ['supplier_name', 'SOCIETE GENERALE', 'Société Générale', 'server', 'accents', [2]],
    ['analytics:default', 'Software', 'Logiciel', 'server', 'translation', [2]],
    ['analytics:priority', 'High', 'Haute', 'server', 'translation', [2]],
    ['analytics:recurrence', 'Recurring', 'Récurrent', 'server', 'translation', [2]],
    ['analytics:default', 'Hardware', 'Matériel', 'server', 'translation', [3]],
    ['analytics:priority', 'Mandatory', 'Obligatoire', 'server', 'translation', [3]],
    ['analytics:recurrence', 'One-off', 'Ponctuel', 'server', 'translation', [3]],
    ['analytics:default', 'Materiel', 'Matériel', 'server', 'accents', [4]],
    ['analytics:business_domain', 'IT partagee', 'IT partagée', 'server', 'accents', [4]],
  ]);
  assert.ok(report.matching!.matches.every((match) => match.undoable === true));
  assert.equal(report.matching!.matches.find((match) => match.column === 'analytics:priority')!.name, 'Priorité', 'a dimension by its name');
  // "magasins", "Haute" and "ponctuel" are the same values, case aside: no match to show.
  assert.ok(!report.matching!.matches.some((match) => ['magasins', 'Haute', 'ponctuel'].includes(match.value)));
  // The plans write the existing values.
  assert.deepEqual(plans[1].analytics.map((change) => [change.code, change.categoryId, change.createName]), [
    ['default', 'd1', null], ['priority', 'p1', null], ['recurrence', 'r2', null], ['business_domain', 'b1', null],
  ]);
  console.log('  accents and the four languages matched by the server, listed: OK');
}

// The sample data's own business domain (fixture-dimensions.mjs): the server matches its values in
// the four languages too, as its loader names them ("Retail" is "Magasins" in French, "Einzelhandel"
// in German). The screen's check and Kad's card share it. The budget reference keeps its codes.
async function testSampleDataDomainMatched() {
  const { report, plans } = await check([
    ',opex,Caisses,Fromage & Co SA,612200,,EUR,,,,Retail',
    ',opex,Réseau,Fromage & Co SA,612200,,EUR,,,,Shared IT',
    ',opex,EDI,Fromage & Co SA,612200,,EUR,,,,Supply chain',
    ',opex,Kasse,Fromage & Co SA,612200,,EUR,,,,Einzelhandel',
  ]);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.creates.dimensionValues, [], 'nothing to create');
  assert.deepEqual(matchesOf(report), [
    ['analytics:business_domain', 'Retail', 'Magasins', 'server', 'translation', [2]],
    ['analytics:business_domain', 'Shared IT', 'IT partagée', 'server', 'translation', [3]],
    ['analytics:business_domain', 'Supply chain', 'Chaîne logistique', 'server', 'translation', [4]],
    ['analytics:business_domain', 'Einzelhandel', 'Magasins', 'server', 'translation', [5]],
  ]);
  assert.ok(report.matching!.matches.every((match) => match.undoable === true), 'each match undoable');
  assert.deepEqual(plans.map((plan) => plan.analytics.map((change) => change.categoryId)), [['b1'], ['b2'], ['b5'], ['b1']]);

  // The table is the loader's own module: every name of each language stands for its value.
  assert.equal(findFixtureDimensionsModule(), backendPath('fixtures', 'fromage-co', 'fixture-dimensions.mjs'));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fixtures = require(backendPath('fixtures', 'fromage-co', 'fixture-dimensions.mjs'));
  const table = fixtureValueKeysByName()!;
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const item of fixtures.fixtureDimensions(language).find((axis: { code: string }) => axis.code === 'business_domain').values) {
      const key = table.get(item.name.normalize('NFKC').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''));
      assert.equal(key, item.key, `${language} ${item.name}`);
    }
  }
  assert.equal(translationTableOf({ code: 'business_domain', axisName: 'Domaine métier' }), table);
  assert.equal(translationTableOf({ code: 'reference', axisName: 'Référence budgétaire' }), null, 'the budget reference keeps its codes');
  assert.equal(translationTableOf({ code: 'site', axisName: 'Site' }), null, 'a dimension of the workspace\'s own: the model\'s');
  console.log('  the sample data\'s business domain matched by the server in the four languages: OK');
}

// A value no table translates ("Head office" for "Siège", "Legacy") is the model's: its proposal is
// accepted because the value exists. A proposal naming a value that does not exist, or a disabled
// one, is refused and said; the value is then matched as the file writes it. A proposal comes before
// the server's translation.
async function testModelProposals() {
  const proposals = {
    'analytics:business_domain': { Retail: 'Revue d\'affaires trimestrielle', 'Common IT': 'Informatique commune', Legacy: 'Ancien domaine' },
    supplier_name: { 'Cegid SA': 'Cegid' },
  };
  const { report } = await check([
    ',opex,Caisses,Fromage & Co SA,612200,Cegid SA,EUR,,,,Retail',
    ',opex,Réseau,Fromage & Co SA,612200,,EUR,,,,Common IT',
    ',opex,Ancien,Fromage & Co SA,612200,,EUR,,,,Legacy',
  ], { matching: { proposals } });
  assert.deepEqual(matchesOf(report), [
    ['supplier_name', 'Cegid SA', 'Cegid', 'model', 'model', [2]],
    ['analytics:business_domain', 'Retail', 'Revue d\'affaires trimestrielle', 'model', 'model', [2]],
  ]);
  assert.equal(similarity('Retail', 'Revue d\'affaires trimestrielle') < 0.3, true, 'no near name of the cell');
  assert.deepEqual(report.matching!.refusedProposals.map((entry) => [entry.column, entry.value, entry.target, entry.reason, entry.lines]), [
    ['analytics:business_domain', 'Common IT', 'Informatique commune', 'missing', [3]],
    ['analytics:business_domain', 'Legacy', 'Ancien domaine', 'disabled', [4]],
  ]);
  // The refused ones are created as the file writes them, as before.
  assert.deepEqual(report.creates.dimensionValues, [{ dimension: 'business_domain', name: 'Domaine métier', names: ['Common IT', 'Legacy'] }]);
  assert.equal(report.creates.supplierCount, 0);
  console.log('  the model\'s proposals: accepted when the value exists, refused when missing or disabled: OK');
}

// An unknown value is created once, whatever its spelling, with the closest names of the list; the
// candidates come from the reference lists only. An unknown company stays an error, with candidates.
async function testCreatesAndCandidates() {
  const { report, plans } = await check([
    ',opex,A,Fromage & Co SA,612200,Société Nouvelle,EUR,,,,Quarterly business review',
    ',opex,B,Fromage & Co SA,612200,Societe Nouvelle,EUR,,,,Quarterly Business Review',
    ',opex,C,Fromage & Cie SA,612200,Orange Busines,EUR,,,,',
  ]);
  assert.deepEqual(report.creates.suppliers, [{ name: 'Société Nouvelle', erpId: null }, { name: 'Orange Busines', erpId: null }], 'two spellings, one supplier');
  assert.equal(report.creates.supplierCount, 2);
  assert.deepEqual(plans.map((plan) => plan.newSupplier?.name ?? null), ['Société Nouvelle', 'Société Nouvelle']);
  assert.deepEqual(report.creates.dimensionValues, [{ dimension: 'business_domain', name: 'Domaine métier', names: ['Quarterly business review'] }]);
  const candidates = Object.fromEntries(report.matching!.candidates.map((entry) => [`${entry.column}|${entry.value}`, entry]));
  assert.equal(candidates['analytics:business_domain|Quarterly business review'].outcome, 'create');
  assert.deepEqual(candidates['analytics:business_domain|Quarterly business review'].lines, [2, 3]);
  assert.equal(candidates['analytics:business_domain|Quarterly business review'].count, 2);
  // A translation is no trigram neighbour: the model reads the dimension's values in the template.
  assert.deepEqual(candidates['analytics:business_domain|Quarterly business review'].candidates, []);
  // A near name is no match: it is created, and its candidates say which existing name is close.
  assert.equal(candidates['supplier_name|Orange Busines'].outcome, 'create');
  assert.equal(candidates['supplier_name|Orange Busines'].candidates[0].name, 'Orange Business');
  const company = candidates['company_name|Fromage & Cie SA'];
  assert.equal(company.outcome, 'refused');
  assert.equal(company.candidates[0].name, 'Fromage & Co SA');
  assert.ok(company.candidates[0].score >= 0.3 && company.candidates[0].score <= 1);
  assert.ok(report.errors.some((error) => error.column === 'company_name' && error.code === 'CSV_REFERENCE_NOT_FOUND'));
  console.log('  two spellings make one creation; candidates of an unknown company: OK');
}

// The candidates' measure: pg_trgm's similarity, accents and case aside, three at most, from 0.3.
function testCandidates() {
  assert.equal(similarity('Société', 'societe'), 1);
  assert.equal(similarity('Retail', 'Magasins'), 0);
  assert.deepEqual(closestNames('Orange Busines', ['Orange Business', 'Orange', 'Cegid', 'Orange Bank', 'Oracle']).map((entry) => entry.name),
    ['Orange Business', 'Orange', 'Orange Bank']);
  assert.deepEqual(closestNames('Quarterly review', ['Obligatoire', 'Haute']), []);
  console.log('  candidates by trigram similarity, three at most: OK');
}

// A match undone is no match: the value is created as the file writes it, or refused when the person
// may not create it; the choice is reported as followed. A choice no row uses is dropped.
async function testUndoneMatches() {
  const choices: BudgetFileChoice[] = [
    { kind: 'unmatch', column: 'analytics:priority', value: 'high' },
    { kind: 'unmatch', column: 'supplier_name', value: 'Societe Generale' },
    { kind: 'unmatch', column: 'analytics:business_domain', value: 'Retail' },
    { kind: 'unmatch', column: 'analytics:default', value: 'Nowhere' },
  ];
  const proposals = { 'analytics:business_domain': { Retail: 'Magasins' } };
  const { report } = await check([',opex,Licences,Fromage & Co SA,612200,Societe Generale,EUR,,High,,Retail'], { matching: { choices, proposals } });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.matching!.matches, []);
  assert.deepEqual(report.creates.dimensionValues.map((entry) => [entry.dimension, entry.names]), [['priority', ['High']], ['business_domain', ['Retail']]]);
  assert.deepEqual(report.creates.suppliers, [{ name: 'Societe Generale', erpId: null }]);
  assert.deepEqual(report.matching!.choices, choices.slice(0, 3), 'the choices followed; the one no row uses is dropped');

  // Without the right to create suppliers, or with the box unticked: the supplier is refused.
  const unticked = await check([',opex,Licences,Fromage & Co SA,612200,Societe Generale,EUR,,,,'], {
    matching: { choices: [{ kind: 'unmatch', column: 'supplier_name', value: 'Societe Generale' }, { kind: 'create_suppliers', value: false }] },
  });
  assert.equal(unticked.report.ok, false);
  assert.deepEqual(unticked.report.errors.map((error) => [error.column, error.code]), [['supplier_name', 'CSV_REFERENCE_NOT_FOUND']]);
  assert.deepEqual(unticked.report.matching!.createSuppliers, { allowed: true, value: false });
  assert.equal(unticked.report.matching!.candidates[0].outcome, 'refused');
  assert.equal(unticked.report.matching!.candidates[0].candidates[0].name, 'Société Générale');
  const noRight = await check([',opex,Licences,Fromage & Co SA,612200,Nouveau,EUR,,,,'], { canCreateSuppliers: false });
  assert.deepEqual(noRight.report.matching!.createSuppliers, { allowed: false, value: false }, 'no box for a person who may not create suppliers');
  assert.deepEqual(noRight.report.errors.map((error) => error.code), ['CSV_REFERENCE_NOT_FOUND']);
  console.log('  a match undone creates or refuses the value; the suppliers box: OK');
}

// A limited person, a closed list: an unknown value stays refused (BUDGET_FILE_DIMENSION_CLOSED),
// undone match included; its candidates come from the list of values, nothing else.
async function testClosedListForALimitedPerson() {
  const cat = frenchCatalog();
  cat.dimensions = cat.dimensions.map((item) => (item.code === 'priority' ? { ...item, openValues: false } : item));
  const access: BudgetFileAccess = { editable: new Set(), places: new Map(), wanted: new Map() };
  const matched = await check([',opex,Licences,Fromage & Co SA,612200,,EUR,,High,,'], { cat, access });
  assert.deepEqual(matched.report.errors, [], 'a value matched by translation is no new value');
  const undone = await check([',opex,Licences,Fromage & Co SA,612200,,EUR,,High,,'], {
    cat, access, matching: { choices: [{ kind: 'unmatch', column: 'analytics:priority', value: 'High' }] },
  });
  assert.deepEqual(undone.report.errors.map((error) => [error.column, error.code]), [['analytics:priority', 'BUDGET_FILE_DIMENSION_CLOSED']]);
  assert.deepEqual(undone.report.creates.refusedDimensionValues, [{ dimension: 'priority', name: 'Priorité', names: ['High'] }]);
  const entry = undone.report.matching!.candidates.find((item) => item.column === 'analytics:priority')!;
  assert.equal(entry.outcome, 'refused');
  assert.ok(entry.candidates.every((candidate) => ['Obligatoire', 'Haute', 'Moyenne'].includes(candidate.name)));
  console.log('  a closed list stays closed to a limited person: OK');
}

function testChoicesParsing() {
  assert.deepEqual(parseBudgetFileChoices(undefined), []);
  assert.deepEqual(parseBudgetFileChoices('[{"kind":"create_suppliers","value":false}]'), [{ kind: 'create_suppliers', value: false }]);
  assert.deepEqual(parseBudgetFileChoices([{ kind: 'unmatch', column: 'supplier_name', value: ' X ' }, { kind: 'unmatch', column: 'supplier_name', value: 'x' }]),
    [{ kind: 'unmatch', column: 'supplier_name', value: 'X' }]);
  for (const bad of ['nope', [{ kind: 'unmatch', column: 'company_name', value: 'X' }], [{ kind: 'drop' }], [{ kind: 'create_suppliers', value: 'yes' }]]) {
    assert.throws(() => parseBudgetFileChoices(bad), /not valid/);
  }
  console.log('  choices parsed and bounded: OK');
}

const OFF = '2020-01-01T00:00:00.000Z';

// Review of lot I1. A supplier matched accents aside to a disabled supplier is refused as before, and
// its match is listed, so that the person can undo it (the value is then created).
async function testDisabledSupplierMatchListed() {
  const cat = frenchCatalog();
  cat.suppliers = [...cat.suppliers, { id: 's9', name: 'Société Ancienne', erpId: null, disabledAt: OFF }];
  const { report } = await check([',opex,A,Fromage & Co SA,612200,Societe Ancienne,EUR,,,,'], { cat });
  assert.deepEqual(report.errors.map((error) => [error.column, error.code]), [['supplier_name', 'BUDGET_FILE_DISABLED']]);
  assert.deepEqual(matchesOf(report), [['supplier_name', 'Societe Ancienne', 'Société Ancienne', 'server', 'accents', [2]]]);
  const undone = await check([',opex,A,Fromage & Co SA,612200,Societe Ancienne,EUR,,,,'], {
    cat, matching: { choices: [{ kind: 'unmatch', column: 'supplier_name', value: 'Societe Ancienne' }] },
  });
  assert.equal(undone.report.ok, true, JSON.stringify(undone.report.errors));
  assert.deepEqual(undone.report.creates.suppliers, [{ name: 'Societe Ancienne', erpId: null }]);
  console.log('  a supplier matched to a disabled one: refused, the match listed and undoable: OK');
}

// Two spellings of one new value are one creation and one candidate entry, counted once; the model
// is told how many values the approval creates.
async function testOneCandidatePerCreation() {
  const { report } = await check([
    ',opex,A,Fromage & Co SA,612200,Société Nouvelle,EUR,,,,Revue privée',
    ',opex,B,Fromage & Co SA,612200,Societe Nouvelle,EUR,,,,Revue privee',
  ]);
  assert.deepEqual(report.creates.dimensionValues.map((entry) => entry.names), [['Revue privée']]);
  assert.equal(report.creates.dimensionValueCount, 1);
  const toCreate = report.matching!.candidates.filter((entry) => entry.outcome === 'create');
  assert.deepEqual(toCreate.map((entry) => [entry.column, entry.value, entry.count, entry.lines]), [
    ['supplier_name', 'Société Nouvelle', 2, [2, 3]],
    ['analytics:business_domain', 'Revue privée', 2, [2, 3]],
  ]);
  assert.deepEqual(report.matching!.totals, { matches: 0, refusedProposals: 0, candidates: 2 });
  console.log('  two spellings: one creation, one candidate entry: OK');
}

// A disabled company is no candidate; the names of the suppliers and the companies are candidates
// only for a person who may read their list.
async function testCandidatesOfReadableLists() {
  const cat = frenchCatalog();
  cat.companies = [...cat.companies, { id: 'c3', name: 'Fromage & Co SARL', coaId: null, disabledAt: OFF }];
  const rows = [',opex,A,Fromage & Co SARLL,612200,Orange Busines,EUR,,,,'];
  const { report } = await check(rows, { cat });
  const of = (result: typeof report, column: string) => result.matching!.candidates.find((entry) => entry.column === column)!.candidates.map((entry) => entry.name);
  assert.ok(!of(report, 'company_name').includes('Fromage & Co SARL'), 'a disabled company is no candidate');
  assert.ok(of(report, 'company_name').includes('Fromage & Co SA'));
  assert.ok(of(report, 'supplier_name').includes('Orange Business'));
  const blind = (await check(rows, { cat, canReadSuppliers: false, canReadCompanies: false })).report;
  assert.deepEqual(of(blind, 'company_name'), [], 'no company names without the companies reader level');
  assert.deepEqual(of(blind, 'supplier_name'), [], 'no supplier names without the suppliers reader level');
  assert.equal(blind.matching!.candidates.find((entry) => entry.column === 'supplier_name')!.outcome, 'create', 'the entry itself stays');
  console.log('  candidates: enabled companies only, and only from the lists the person may read: OK');
}

async function main() {
  testRecommendedKeys();
  testCandidates();
  testChoicesParsing();
  await testServerMatches();
  await testSampleDataDomainMatched();
  await testModelProposals();
  await testCreatesAndCandidates();
  await testUndoneMatches();
  await testClosedListForALimitedPerson();
  await testDisabledSupplierMatchListed();
  await testOneCandidatePerCreation();
  await testCandidatesOfReadableLists();
  console.log('budget-file-matching.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
