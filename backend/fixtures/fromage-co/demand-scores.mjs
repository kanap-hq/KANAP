// Scores the Fromage demands on the tenant's default criteria. The criterion
// and value ids are created per tenant, so the fixture names them and the
// runner resolves the ids after the requests import. Names and labels are the
// ones seeded by PortfolioCriteriaService.seedDefaultCriteria, in the workspace
// seed language (default-criteria.labels.json). A tenant that changed that set
// is left unscored.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED_LANGUAGES = ['en', 'fr', 'de', 'es'];
const SEED = JSON.parse(readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/portfolio/default-criteria.labels.json'),
  'utf8',
));

/** The default criteria in one seed language, in seed order. English for any other language. */
export function criteriaForLanguage(language) {
  const lang = SEED_LANGUAGES.includes(language) ? language : 'en';
  return SEED.criteria.map((criterion) => ({
    name: criterion.name[lang],
    inverted: criterion.inverted === true,
    weight: criterion.weight,
    values: criterion.values.map((value) => value.label[lang]),
  }));
}

/** The eight default criteria, in seed order, with the direction the score uses. */
export const DEFAULT_CRITERIA = criteriaForLanguage('en');

/**
 * Every demand of 17-portfolio-requests.csv. The labels are positions on
 * DEFAULT_CRITERIA. The engine then stores about 63.75, 43.96, 26.46 and
 * 37.92, which the demand list rounds to 64, 44, 26 and 38. Cave Climate
 * Digital Twin is the highest, and the loader converts that one.
 */
export const DEMAND_SCORES = [
  {
    name: 'Cave Climate Digital Twin',
    values: {
      'Business value': '200-500k€',
      'Strategic alignment': 'Top',
      'Project costs': '50-200k€',
      ROI: '2-5y',
      'Risk level': 'Medium',
      Urgency: 'High',
      'Time estimation IT': '20-50 MD',
      'Time estimation Business': '0-10 MD',
    },
  },
  {
    name: 'AI Cheese Grading',
    values: {
      'Business value': '50-200k€',
      'Strategic alignment': 'Top',
      'Project costs': '50-200k€',
      ROI: '1-2y',
      'Risk level': 'High',
      Urgency: 'Low',
      'Time estimation IT': '>50 MD',
      'Time estimation Business': '10-20 MD',
    },
  },
  {
    name: 'Smart Packaging Automation',
    values: {
      'Business value': '200-500k€',
      'Strategic alignment': 'High',
      'Project costs': '>500k€',
      ROI: '2-5y',
      'Risk level': 'High',
      Urgency: 'Low',
      'Time estimation IT': '>50 MD',
      'Time estimation Business': '>50 MD',
    },
  },
  {
    name: 'Automated Warehouse Inventory',
    values: {
      'Business value': '50-200k€',
      'Strategic alignment': 'Medium',
      'Project costs': '200-500k€',
      ROI: '2-5y',
      'Risk level': 'Medium',
      Urgency: 'Low',
      'Time estimation IT': '10-20 MD',
      'Time estimation Business': '20-50 MD',
    },
  },
];

function orderedValues(criterion) {
  return [...(criterion?.values ?? [])].sort((a, b) => Number(a.position) - Number(b.position));
}

function asMap(value) {
  if (typeof value === 'string') {
    try {
      return asMap(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

/** Why `criteria` is not `expected`, or null when it matches. Disabled criteria are ignored. */
function reasonAgainst(criteria, expected) {
  const enabled = (criteria ?? []).filter((criterion) => criterion?.enabled !== false);
  if (enabled.length !== expected.length) {
    return `the tenant has ${enabled.length} enabled criteria and the default set has ${expected.length}`;
  }
  const byName = new Map();
  for (const criterion of enabled) {
    const name = String(criterion?.name ?? '').trim();
    if (byName.has(name)) return `criterion '${name}' is duplicated`;
    byName.set(name, criterion);
  }
  for (const item of expected) {
    const criterion = byName.get(item.name);
    if (!criterion) return `criterion '${item.name}' is missing`;
    if ((criterion.inverted === true) !== item.inverted) return `criterion '${item.name}' has a different direction`;
    if (Number(criterion.weight) !== item.weight) return `criterion '${item.name}' has a different weight`;
    const labels = orderedValues(criterion).map((value) => String(value?.label ?? '').trim());
    if (labels.length !== item.values.length || labels.some((label, index) => label !== item.values[index])) {
      return `criterion '${item.name}' has different values`;
    }
  }
  return null;
}

/** The seed language `criteria` matches, or null. */
function seedLanguageOf(criteria) {
  return SEED_LANGUAGES.find((language) => reasonAgainst(criteria, criteriaForLanguage(language)) === null) ?? null;
}

/** Why `criteria` is not the default set in any seed language, or null when it is. Disabled criteria are ignored. */
export function defaultCriteriaReason(criteria) {
  if (seedLanguageOf(criteria)) return null;
  return reasonAgainst(criteria, DEFAULT_CRITERIA);
}

/**
 * The priority score `calculateScore` stores for these criteria and this
 * selection. An empty selection uses the first position of each criterion.
 */
export function demandScore(criteria, criteriaValues) {
  const selected = asMap(criteriaValues);
  let total = 0;
  let weightSum = 0;
  for (const criterion of criteria ?? []) {
    if (criterion?.enabled === false) continue;
    const values = orderedValues(criterion);
    if (values.length < 2) continue;
    const weight = Number(criterion.weight) || 1;
    const maxPosition = values.length - 1;
    const selectedId = selected[criterion.id];
    let percentage;
    if (!selectedId) {
      percentage = criterion.inverted === true ? 100 : 0;
    } else {
      const value = values.find((item) => item.id === selectedId);
      if (!value) continue;
      const position = Number(value.position);
      percentage = criterion.inverted === true
        ? ((maxPosition - position) / maxPosition) * 100
        : (position / maxPosition) * 100;
    }
    total += percentage * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return 0;
  return Math.round((total / weightSum) * 100) / 100;
}

/** True when the demand already holds exactly this selection. */
export function sameCriteriaValues(stored, next) {
  const current = asMap(stored);
  const target = asMap(next);
  const keys = Object.keys(target);
  if (Object.keys(current).length !== keys.length) return false;
  return keys.every((key) => String(current[key]) === String(target[key]));
}

/**
 * Resolves DEMAND_SCORES against the tenant's criteria and demands.
 * `skipped` is set when the criteria are not the default set in any seed
 * language: the caller then changes nothing. A demand the tenant does not hold
 * is named in `missing` and the others are still scored. `translate` gives a
 * demand's name in the language of the data set (the names below are English).
 *
 * @returns {{
 *   skipped: boolean,
 *   reason: string | null,
 *   missing: string[],
 *   assignments: Array<{ requestId: string, name: string, criteria_values: Record<string, string>, current: Record<string, string> }>,
 * }}
 */
export function planDemandScores(criteria, requests, translate = (text) => text) {
  const language = seedLanguageOf(criteria);
  if (!language) return { skipped: true, reason: defaultCriteriaReason(criteria), missing: [], assignments: [] };

  const local = criteriaForLanguage(language);
  const byEnglishName = new Map(DEFAULT_CRITERIA.map((item, index) => [item.name, local[index]]));
  const byName = new Map(
    (criteria ?? [])
      .filter((criterion) => criterion?.enabled !== false)
      .map((criterion) => [String(criterion.name).trim(), criterion]),
  );
  const byRequest = new Map((requests ?? []).map((request) => [String(request?.name ?? '').trim(), request]));
  const assignments = [];
  const missing = [];
  for (const demand of DEMAND_SCORES) {
    const request = byRequest.get(translate(demand.name));
    if (!request?.id) {
      missing.push(demand.name);
      continue;
    }
    const criteriaValues = {};
    for (const [criterionName, label] of Object.entries(demand.values)) {
      const expected = byEnglishName.get(criterionName);
      const valueIndex = DEFAULT_CRITERIA.find((item) => item.name === criterionName)?.values.indexOf(label) ?? -1;
      const localLabel = expected?.values[valueIndex];
      const criterion = byName.get(expected?.name);
      const value = orderedValues(criterion).find((item) => String(item?.label ?? '').trim() === localLabel);
      if (!criterion?.id || !value?.id) {
        return {
          skipped: true,
          reason: `value '${label}' of '${criterionName}' was not found`,
          missing: [],
          assignments: [],
        };
      }
      criteriaValues[criterion.id] = value.id;
    }
    assignments.push({
      requestId: request.id,
      name: demand.name,
      criteria_values: criteriaValues,
      current: asMap(request.criteria_values),
    });
  }
  return { skipped: false, reason: null, missing, assignments };
}
