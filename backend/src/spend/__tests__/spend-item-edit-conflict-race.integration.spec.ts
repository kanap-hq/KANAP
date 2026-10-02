import { itemEditConflictRaceTests } from './item-edit-conflict-races';
import { runRaceSpecs } from './race-harness';

// Field-level edit conflicts of the OPEX line update (plan planning/perf-scale,
// lot 3C, Annexe A #1): the same field saved by two people answers 409
// `edit_conflict` to the second one, different fields merge. See
// `item-edit-conflict-races.ts`. Run with `npm run test:races` on a dedicated
// database (never appdb).

void runRaceSpecs('OPEX line edit conflicts', itemEditConflictRaceTests('opex'));
