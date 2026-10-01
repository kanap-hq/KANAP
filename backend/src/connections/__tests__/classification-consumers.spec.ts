import * as assert from 'node:assert/strict';
import { readEffectiveRisk } from '../services/connections-base.service';

// The effective risk of a connection is computed in SQL (connections-base.service.ts,
// LINKED_INTERFACE_RISK_SQL and EFFECTIVE_RISK); its ranking by the tenant catalog, the
// incomplete and manual cases are covered against the database by
// connections-effective-filter.integration.spec.ts. This spec covers the reading of a
// raw result row into the values the list and the workspace return.

function run() {
  assert.deepEqual(
    readEffectiveRisk({
      effective_criticality: 'urgent',
      effective_data_class: 'secret',
      effective_contains_pii: true,
      derived_interface_count: 2,
      classification_incomplete: false,
    }),
    {
      effective_criticality: 'urgent',
      effective_data_class: 'secret',
      effective_contains_pii: true,
      derived_interface_count: 2,
      classification_incomplete: false,
    },
  );

  // Unknown values stay null; a count may come back as text; missing flags read as false.
  assert.deepEqual(
    readEffectiveRisk({
      effective_criticality: null,
      effective_data_class: undefined,
      effective_contains_pii: null,
      derived_interface_count: '0',
      classification_incomplete: true,
    }),
    {
      effective_criticality: null,
      effective_data_class: null,
      effective_contains_pii: false,
      derived_interface_count: 0,
      classification_incomplete: true,
    },
  );
}

run();
console.log('classification consumer tests passed');
