import * as assert from 'node:assert/strict';
import {
  COMPLIANCE_RULE_REQUIREMENTS,
  CONTRACT_COMPLIANCE_REQUIREMENTS,
  complianceInputsFromSettings,
  highLevelCodes,
  registerReasonText,
  summarizeCompliance,
  type ComplianceReason,
} from '../contract-compliance';

// The rules of the compliance register that need no database (`contract-compliance.ts`):
// - "high" criticality: the two most severe levels of the tenant's catalog, by rank (the most
//   severe alone below three levels), whatever their codes;
// - cloud hosting: the category of the tenant's hosting types (defaults: public cloud, private
//   cloud, SaaS); a type without category is on premises only for on_prem and colocation;
// - the summary of a contract, and a reason in the register's words.

function testHighLevels() {
  assert.deepEqual(
    highLevelCodes([{ code: 'low', rank: 1 }, { code: 'business_critical', rank: 4 }, { code: 'medium', rank: 2 }, { code: 'high', rank: 3 }]),
    ['business_critical', 'high'],
  );
  assert.deepEqual(highLevelCodes([{ code: 'p3', rank: 1 }, { code: 'p1', rank: 3 }, { code: 'p2', rank: 2 }]), ['p1', 'p2'], 'three levels: the top two');
  assert.deepEqual(highLevelCodes([{ code: 'yes', rank: 2 }, { code: 'no', rank: 1 }]), ['yes'], 'two levels: the top one');
  assert.deepEqual(highLevelCodes([]), []);
}

function testDefaultSettings() {
  const inputs = complianceInputsFromSettings({});
  assert.deepEqual(inputs.highBusiness, ['business_critical', 'high']);
  assert.deepEqual(inputs.highCyber, ['critical', 'high']);
  assert.deepEqual(inputs.cloudHosting, ['public_cloud', 'private_cloud', 'saas']);
  assert.equal(inputs.entries.get('businessCriticalityLevels:business_critical')?.label, 'Critical');
  assert.equal(inputs.entries.get('hostingTypes:saas')?.label, 'SaaS');
  // No settings at all reads the same defaults.
  assert.deepEqual(complianceInputsFromSettings(null).cloudHosting, inputs.cloudHosting);
}

function testCustomSettings() {
  const inputs = complianceInputsFromSettings({
    business_criticality_levels: [
      { code: 'vital', label: 'Vital', description: '', rank: 5 },
      { code: 'major', label: 'Major', description: '', rank: 4 },
      { code: 'normal', label: 'Normal', description: '', rank: 3 },
      { code: 'minor', label: 'Minor', description: '', rank: 2 },
      { code: 'none', label: 'None', description: '', rank: 1 },
    ],
    hosting_types: [
      { code: 'saas', label: 'SaaS', category: 'on_prem' },
      { code: 'hosted', label: 'Hosted', translations: { fr: { label: 'Hébergé' } } },
      { code: 'colocation', label: 'Colocation' },
      { code: 'dc', label: 'Data center', category: 'on_prem' },
    ],
  });
  assert.deepEqual(inputs.highBusiness, ['vital', 'major']);
  assert.deepEqual(inputs.highCyber, ['critical', 'high'], 'the cyber catalog keeps its defaults');
  assert.deepEqual(inputs.cloudHosting, ['hosted'], 'the category decides; without one, colocation stays on premises');
  assert.deepEqual(inputs.entries.get('hostingTypes:hosted')?.translations, { fr: { label: 'Hébergé' } });
}

function testRulesCoverEveryRequirement() {
  const reached = new Set(Object.values(COMPLIANCE_RULE_REQUIREMENTS).flat());
  assert.deepEqual([...reached].sort(), [...CONTRACT_COMPLIANCE_REQUIREMENTS].sort(), 'every requirement can be expected');
}

function testSummary() {
  assert.deepEqual(summarizeCompliance([]), { expected: 0, missing: 0, to_check: 0, state: 'none' });
  assert.deepEqual(
    summarizeCompliance([{ expected: false, state: 'absent' }, { expected: false, state: null }]),
    { expected: 0, missing: 0, to_check: 0, state: 'none' },
    'what is not expected never counts',
  );
  assert.deepEqual(
    summarizeCompliance([{ expected: true, state: 'present' }, { expected: true, state: 'not_applicable' }]),
    { expected: 2, missing: 0, to_check: 0, state: 'complete' },
  );
  assert.deepEqual(
    summarizeCompliance([{ expected: true, state: 'present' }, { expected: true, state: null }]),
    { expected: 2, missing: 0, to_check: 1, state: 'to_check' },
  );
  assert.deepEqual(
    summarizeCompliance([{ expected: true, state: 'absent' }, { expected: true, state: null }, { expected: true, state: 'absent' }]),
    { expected: 3, missing: 2, to_check: 1, state: 'missing' },
    'missing comes before to check',
  );
}

function testReasonText() {
  const reason = (overrides: Partial<ComplianceReason>): ComplianceReason => ({
    rule: 'personal_data',
    application: { id: 'a', name: 'SAP S/4HANA' },
    asset: null,
    level: null,
    ...overrides,
  });
  assert.equal(registerReasonText('fr', reason({})), 'SAP S/4HANA contient des données personnelles');
  assert.equal(registerReasonText('en', reason({ asset: { id: 's', name: 'sap-prd-app01' } })), 'SAP S/4HANA holds personal data (asset sap-prd-app01)');
  const critical = reason({ rule: 'business_criticality', level: { axis: 'businessCriticalityLevels', code: 'business_critical', label: 'Critical', translations: { fr: { label: 'Critique' } } } });
  assert.equal(registerReasonText('fr', critical), 'SAP S/4HANA : criticité métier Critique', "the tenant's translation of the level");
  assert.equal(registerReasonText('de', critical), 'SAP S/4HANA: geschäftliche Kritikalität Critical', 'else its name');
  assert.equal(
    registerReasonText('es', reason({ rule: 'cloud_hosting', level: { axis: 'hostingTypes', code: 'saas', label: 'SaaS' } })),
    'SAP S/4HANA: alojamiento SaaS',
  );
}

function run() {
  testHighLevels();
  testDefaultSettings();
  testCustomSettings();
  testRulesCoverEveryRequirement();
  testSummary();
  testReasonText();
}

run();
