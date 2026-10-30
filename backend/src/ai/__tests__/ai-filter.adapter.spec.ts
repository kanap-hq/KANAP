import * as assert from 'node:assert/strict';
import { adaptFilters, getAppliedFilterNames } from '../query/ai-filter.adapter';
import { tasksRegistry } from '../query/registries/tasks.registry';
import { projectsRegistry } from '../query/registries/projects.registry';
import { requestsRegistry } from '../query/registries/requests.registry';
import { incidentsRegistry } from '../query/registries/incidents.registry';
import { budgetLinesRegistry } from '../query/registries/budget-lines.registry';
import { companiesRegistry } from '../query/registries/companies.registry';
import { applicationsRegistry } from '../query/registries/applications.registry';
import { exchangeRatesRegistry } from '../query/registries/exchange-rates.registry';
import { workingDayCalendarsRegistry } from '../query/registries/working-day-calendars.registry';
import { invalidFilterResult } from '../query/ai-filter-description.util';

/**
 * A number alone on a number field, or a string that is only a number, is eq (Plaid L9, lot G),
 * for every family: the in-memory ones that read `year` themselves and the list engine's. A value
 * that is no number is still refused, with the form the field takes.
 */
function testBareNumberIsEq() {
  for (const [registry, field] of [[exchangeRatesRegistry, 'year'], [workingDayCalendarsRegistry, 'year'], [projectsRegistry, 'priority_score']] as const) {
    for (const value of [2026, '2026', ' 2026 ']) {
      const adapted = adaptFilters(registry, { [field]: value } as any);
      assert.deepEqual(adapted.filters, { [registry.fields[field].grid]: { filterType: 'number', type: 'equals', filter: 2026 } }, `${registry.entityType}.${field} = ${JSON.stringify(value)}`);
      assert.deepEqual(adapted.applied, [field]);
      assert.deepEqual(adapted.ignored, []);
    }
  }
  assert.deepEqual(adaptFilters(projectsRegistry, { priority_score: '12.5' } as any).filters.priority_score, { filterType: 'number', type: 'equals', filter: 12.5 });
  // The comparison form is unchanged.
  assert.deepEqual(adaptFilters(exchangeRatesRegistry, { year: { op: 'gte', value: 2026 } }).filters, { year: { filterType: 'number', type: 'greaterThanOrEqual', filter: 2026 } });

  for (const [registry, field] of [[exchangeRatesRegistry, 'year'], [projectsRegistry, 'priority_score']] as const) {
    for (const value of ['next year', '2026-01', ['2026'], true]) {
      const adapted = adaptFilters(registry, { [field]: value } as any);
      assert.deepEqual(adapted.ignored, [field], `${registry.entityType}.${field} = ${JSON.stringify(value)} is not applied`);
      const [repair] = invalidFilterResult(registry, adapted).suggested_repairs;
      assert.equal(repair.field, field);
      assert.match(repair.reason, new RegExp(`^${field} is a number field of ${registry.entityType}, and the value given is not one it takes\\. It takes a number alone \\(2026 means \\{"op":"eq","value":2026\\}\\) or a comparison, for example `));
      assert.doesNotMatch(repair.reason, /Unsupported/);
    }
  }
  // A known field of another type given a value it does not take: its form too.
  const [dateRepair] = invalidFilterResult(projectsRegistry, adaptFilters(projectsRegistry, { planned_start: 'soon' } as any)).suggested_repairs;
  assert.match(dateRepair.reason, /^planned_start is a date field of projects, and the value given is not one it takes\. It takes date comparison, for example \{"op":"before","value":"2026-05-08"\}/);
  // An unknown field keeps its reason.
  const [unknown] = invalidFilterResult(exchangeRatesRegistry, adaptFilters(exchangeRatesRegistry, { made_up: '1' } as any)).suggested_repairs;
  assert.match(unknown.reason, /^Unsupported AI filter field for exchange_rates/);
}

function testSetFilterAdaptation() {
  const adapted = adaptFilters(tasksRegistry, {
    status: ['open', 'in_progress'],
  });
  assert.deepEqual(adapted.filters, {
    status: { filterType: 'set', values: ['open', 'in_progress'] },
  });
  assert.deepEqual(adapted.applied, ['status']);
  assert.deepEqual(adapted.ignored, []);
}

function testStringToSetFilterAdaptation() {
  const adapted = adaptFilters(tasksRegistry, {
    assignee: 'Ada Lovelace',
  } as any);
  assert.deepEqual(adapted.filters, {
    assignee_name: { filterType: 'set', values: ['Ada Lovelace'] },
  });
}

function testDateFilterAdaptation() {
  const adapted = adaptFilters(projectsRegistry, {
    planned_start: { op: 'before', value: '2026-01-01' },
  });
  assert.deepEqual(adapted.filters, {
    planned_start: { filterType: 'date', type: 'lessThan', dateFrom: '2026-01-01' },
  });
}

function testUnknownFieldsAreIgnored() {
  const adapted = adaptFilters(tasksRegistry, {
    made_up: ['nope'],
  } as any);
  assert.deepEqual(adapted.filters, {});
  assert.deepEqual(adapted.applied, []);
  assert.deepEqual(adapted.ignored, ['made_up']);
}

function testRequestAssigneeFieldIsIgnored() {
  const adapted = adaptFilters(requestsRegistry, {
    assignee: ['jane.doe@example.com'],
  } as any);
  assert.deepEqual(adapted.filters, {});
  assert.deepEqual(adapted.applied, []);
  assert.deepEqual(adapted.ignored, ['assignee']);
}

function testEmptyInput() {
  const adapted = adaptFilters(tasksRegistry, undefined);
  assert.deepEqual(adapted.filters, {});
  assert.deepEqual(getAppliedFilterNames(tasksRegistry, undefined), []);
}

function testIncidentSeveritySetFilter() {
  const adapted = adaptFilters(incidentsRegistry, {
    severity: ['critical', 'major'],
  });
  assert.deepEqual(adapted.filters, {
    severity: { filterType: 'set', values: ['critical', 'major'] },
  });
  assert.deepEqual(adapted.applied, ['severity']);
  assert.deepEqual(adapted.ignored, []);
}

function testIncidentDetectedAtDateFilter() {
  const adapted = adaptFilters(incidentsRegistry, {
    detected_at: { op: 'after', value: '2026-07-01' },
  });
  assert.deepEqual(adapted.filters, {
    detected_at: { filterType: 'date', type: 'greaterThan', dateFrom: '2026-07-01' },
  });
  assert.deepEqual(adapted.applied, ['detected_at']);
  assert.deepEqual(adapted.ignored, []);
}

function testIncidentUnknownFieldIgnored() {
  const adapted = adaptFilters(incidentsRegistry, {
    made_up: ['nope'],
  } as any);
  assert.deepEqual(adapted.filters, {});
  assert.deepEqual(adapted.applied, []);
  assert.deepEqual(adapted.ignored, ['made_up']);
}

function testEndOfValidityAndAliasBothApply() {
  const adapted = adaptFilters(budgetLinesRegistry, {
    end_of_validity: { op: 'after', value: '2026-01-01' },
    effective_end: { op: 'before', value: '2027-01-01' },
  });
  assert.deepEqual(adapted.filters, {
    disabled_at: {
      filterType: 'date',
      operator: 'AND',
      conditions: [
        { filterType: 'date', type: 'greaterThan', dateFrom: '2026-01-01' },
        { filterType: 'date', type: 'lessThan', dateFrom: '2027-01-01' },
      ],
    },
  });
  assert.deepEqual(adapted.applied, ['end_of_validity', 'effective_end']);
  assert.deepEqual(adapted.ignored, []);

  const same = adaptFilters(budgetLinesRegistry, {
    end_of_validity: { op: 'before', value: '2027-01-01' },
    effective_end: { op: 'before', value: '2027-01-01' },
  });
  assert.deepEqual(same.filters, { disabled_at: { filterType: 'date', type: 'lessThan', dateFrom: '2027-01-01' } });
  assert.deepEqual(same.applied, ['end_of_validity', 'effective_end']);
}

function testSameColumnConflictIsReported() {
  const adapted = adaptFilters(companiesRegistry, { country: ['FR'], country_iso: ['DE'] });
  assert.deepEqual(adapted.filters, { country_iso: { filterType: 'set', values: ['FR'] } }, 'the first filter is kept');
  assert.deepEqual(adapted.applied, ['country']);
  assert.deepEqual(adapted.ignored, ['country_iso'], 'the later one is reported as not applied');
}

function testExcludeSetFilter() {
  const adapted = adaptFilters(budgetLinesRegistry, { supplier: { not: ['Acme', null] }, status: { not: ['disabled'] } } as any);
  assert.deepEqual(adapted.filters, {
    supplier_name: { filterType: 'set', mode: 'exclude', values: ['Acme', null] },
    status: { filterType: 'set', mode: 'exclude', values: ['disabled'] },
  }, 'OPEX: every value but these');
  assert.deepEqual(adapted.applied, ['supplier', 'status']);
  // A value outside the declared ones is refused with the accepted values, in both modes (P3-7).
  const bogus = adaptFilters(budgetLinesRegistry, { status: { not: ['disabled', 'bogus'] } } as any);
  assert.deepEqual(bogus.ignored, ['status']);
  assert.deepEqual(bogus.invalid_values, [{ field: 'status', rejected: ['bogus'], accepted: budgetLinesRegistry.fields.status.values }]);
  const included = adaptFilters(budgetLinesRegistry, { status: ['enabled', 'active'] } as any);
  assert.deepEqual(included.filters, {}, 'one unknown value refuses the filter, never drops the value');
  assert.deepEqual(included.invalid_values, [{ field: 'status', rejected: ['active'], accepted: budgetLinesRegistry.fields.status.values }]);
  // A list that does not know the exclude mode reports the filter as not applied.
  const tasks = adaptFilters(tasksRegistry, { status: { not: ['done'] } } as any);
  assert.deepEqual(tasks.filters, {});
  assert.deepEqual(tasks.ignored, ['status']);
}

function testApplicationLifecycleExcludeOnly() {
  // The Compliance tile scope: every lifecycle but retired. Other application set columns keep refusing it.
  const adapted = adaptFilters(applicationsRegistry, { lifecycle: { not: ['retired'] }, criticality: { not: ['low'] } } as any);
  assert.deepEqual(adapted.filters, { lifecycle: { filterType: 'set', mode: 'exclude', values: ['retired'] } });
  assert.deepEqual(adapted.applied, ['lifecycle']);
  assert.deepEqual(adapted.ignored, ['criticality']);
}

function testBlankableDateFilter() {
  const adapted = adaptFilters(applicationsRegistry, { last_dr_test: [null] } as any);
  assert.deepEqual(adapted.filters, { last_dr_test: { filterType: 'date', type: 'blank' } });
  assert.deepEqual(adapted.applied, ['last_dr_test']);
  const before = adaptFilters(applicationsRegistry, { last_dr_test: { op: 'before', value: '2025-10-11' } });
  assert.deepEqual(before.filters, { last_dr_test: { filterType: 'date', type: 'lessThan', dateFrom: '2025-10-11' } });
  // A date field that is not blankable, or a value that is not only null, is reported as not applied.
  assert.deepEqual(adaptFilters(projectsRegistry, { planned_start: [null] } as any).ignored, ['planned_start']);
  assert.deepEqual(adaptFilters(applicationsRegistry, { last_dr_test: [null, '2025-01-01'] } as any).ignored, ['last_dr_test']);
  assert.deepEqual(adaptFilters(applicationsRegistry, { last_dr_test: [] } as any).ignored, ['last_dr_test']);
}

function run() {
  testBareNumberIsEq();
  testExcludeSetFilter();
  testApplicationLifecycleExcludeOnly();
  testBlankableDateFilter();
  testSetFilterAdaptation();
  testStringToSetFilterAdaptation();
  testDateFilterAdaptation();
  testUnknownFieldsAreIgnored();
  testRequestAssigneeFieldIsIgnored();
  testEmptyInput();
  testIncidentSeveritySetFilter();
  testIncidentDetectedAtDateFilter();
  testIncidentUnknownFieldIgnored();
  testEndOfValidityAndAliasBothApply();
  testSameColumnConflictIsReported();
}

run();
