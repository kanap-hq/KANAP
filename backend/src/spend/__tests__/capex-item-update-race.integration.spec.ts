import { itemUpdateRaceTests } from '../../spend/__tests__/item-update-races';
import { runRaceSpecs } from '../../spend/__tests__/race-harness';

// Race of the CAPEX line update (plan planning/perf-scale, step 0.3), fixed in
// lot 3B: two line updates that overlapped reverted each other's columns, and
// a company change could slip past the chart-of-accounts check of a
// concurrent account change. See `spend/__tests__/item-update-races.ts`. Run
// with `npm run test:races` on a dedicated database (never appdb).

void runRaceSpecs('CAPEX line update races', itemUpdateRaceTests('capex'));
