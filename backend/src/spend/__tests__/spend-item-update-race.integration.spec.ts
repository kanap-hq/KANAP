import { itemUpdateRaceTests } from './item-update-races';
import { runRaceSpecs } from './race-harness';

// Known race (plan planning/perf-scale, step 0.3), failing until lot 3B lands:
// two OPEX line updates that overlap revert each other's columns, and a
// company change can slip past the chart-of-accounts check of a concurrent
// account change. See `item-update-races.ts`. Excluded from test:ci; run with
// `npm run test:races` on a dedicated database (never appdb).

void runRaceSpecs('OPEX line update races', itemUpdateRaceTests('opex'));
