// Scores three Fromage demands on the tenant's default criteria. The criterion
// and value ids are created per tenant, so the fixture names them and the
// runner resolves the ids after the requests import. The labels are the
// English ones seeded by PortfolioCriteriaService.seedDefaultCriteria. A
// tenant that changed that set is left unscored.

/** The eight default criteria, in seed order, with the direction the score uses. */
export const DEFAULT_CRITERIA = [
  {
    name: 'Business value',
    inverted: false,
    weight: 1,
    values: ['0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€', 'Mandatory'],
  },
  {
    name: 'Strategic alignment',
    inverted: false,
    weight: 1,
    values: ['Low', 'Medium', 'High', 'Top'],
  },
  {
    name: 'Project costs',
    inverted: true,
    weight: 1,
    values: ['No direct cost', '0-10k€', '10-50k€', '50-200k€', '200-500k€', '>500k€'],
  },
  {
    name: 'ROI',
    inverted: false,
    weight: 1,
    values: ['Not quantifiable', '>10y', '5-10y', '2-5y', '1-2y', '<1y'],
  },
  {
    name: 'Risk level',
    inverted: true,
    weight: 1,
    values: ['Negligible', 'Low', 'Medium', 'High', 'Top'],
  },
  {
    name: 'Urgency',
    inverted: false,
    weight: 1,
    values: ['Low', 'Medium', 'High', 'Critical'],
  },
  {
    name: 'Time estimation IT',
    inverted: true,
    weight: 1,
    values: ['0-10 MD', '10-20 MD', '20-50 MD', '>50 MD'],
  },
  {
    name: 'Time estimation Business',
    inverted: true,
    weight: 1,
    values: ['0-10 MD', '10-20 MD', '20-50 MD', '>50 MD'],
  },
];

/**
 * The three demands that receive a score. Automated Warehouse Inventory stays
 * empty. The labels are positions on DEFAULT_CRITERIA. The engine then stores
 * about 63.75, 43.96 and 26.46, which the demand list rounds to 64, 44 and 26.
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

/** Why `criteria` is not the default English set, or null when it is. Disabled criteria are ignored. */
export function defaultCriteriaReason(criteria) {
  const enabled = (criteria ?? []).filter((criterion) => criterion?.enabled !== false);
  if (enabled.length !== DEFAULT_CRITERIA.length) {
    return `the tenant has ${enabled.length} enabled criteria and the default set has ${DEFAULT_CRITERIA.length}`;
  }
  const byName = new Map();
  for (const criterion of enabled) {
    const name = String(criterion?.name ?? '').trim();
    if (byName.has(name)) return `criterion '${name}' is duplicated`;
    byName.set(name, criterion);
  }
  for (const expected of DEFAULT_CRITERIA) {
    const criterion = byName.get(expected.name);
    if (!criterion) return `criterion '${expected.name}' is missing`;
    if ((criterion.inverted === true) !== expected.inverted) return `criterion '${expected.name}' has a different direction`;
    if (Number(criterion.weight) !== expected.weight) return `criterion '${expected.name}' has a different weight`;
    const labels = orderedValues(criterion).map((value) => String(value?.label ?? '').trim());
    if (labels.length !== expected.values.length || labels.some((label, index) => label !== expected.values[index])) {
      return `criterion '${expected.name}' has different values`;
    }
  }
  return null;
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
 * `skipped` is set when the criteria are not the default English ones: the
 * caller then changes nothing. A demand the tenant does not hold is named in
 * `missing` and the others are still scored.
 *
 * @returns {{
 *   skipped: boolean,
 *   reason: string | null,
 *   missing: string[],
 *   assignments: Array<{ requestId: string, name: string, criteria_values: Record<string, string>, current: Record<string, string> }>,
 * }}
 */
export function planDemandScores(criteria, requests) {
  const reason = defaultCriteriaReason(criteria);
  if (reason) return { skipped: true, reason, missing: [], assignments: [] };

  const byName = new Map(
    (criteria ?? [])
      .filter((criterion) => criterion?.enabled !== false)
      .map((criterion) => [String(criterion.name).trim(), criterion]),
  );
  const byRequest = new Map((requests ?? []).map((request) => [String(request?.name ?? '').trim(), request]));
  const assignments = [];
  const missing = [];
  for (const demand of DEMAND_SCORES) {
    const request = byRequest.get(demand.name);
    if (!request?.id) {
      missing.push(demand.name);
      continue;
    }
    const criteriaValues = {};
    for (const [criterionName, label] of Object.entries(demand.values)) {
      const criterion = byName.get(criterionName);
      const value = orderedValues(criterion).find((item) => String(item?.label ?? '').trim() === label);
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
