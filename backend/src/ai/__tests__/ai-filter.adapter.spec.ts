import * as assert from 'node:assert/strict';
import { adaptFilters, getAppliedFilterNames } from '../query/ai-filter.adapter';
import { tasksRegistry } from '../query/registries/tasks.registry';
import { projectsRegistry } from '../query/registries/projects.registry';
import { requestsRegistry } from '../query/registries/requests.registry';
import { incidentsRegistry } from '../query/registries/incidents.registry';
import { spendItemsRegistry } from '../query/registries/spend-items.registry';
import { companiesRegistry } from '../query/registries/companies.registry';

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
  const adapted = adaptFilters(spendItemsRegistry, {
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

  const same = adaptFilters(spendItemsRegistry, {
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
  const adapted = adaptFilters(spendItemsRegistry, { supplier: { not: ['Acme', null] }, status: { not: ['disabled', 'bogus'] } } as any);
  assert.deepEqual(adapted.filters, {
    supplier_name: { filterType: 'set', mode: 'exclude', values: ['Acme', null] },
    status: { filterType: 'set', mode: 'exclude', values: ['disabled'] },
  }, 'OPEX: every value but these; a value outside the declared ones excludes nothing');
  assert.deepEqual(adapted.applied, ['supplier', 'status']);
  // A list that does not know the exclude mode reports the filter as not applied.
  const tasks = adaptFilters(tasksRegistry, { status: { not: ['done'] } } as any);
  assert.deepEqual(tasks.filters, {});
  assert.deepEqual(tasks.ignored, ['status']);
}

function run() {
  testExcludeSetFilter();
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
