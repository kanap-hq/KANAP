import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../../common/__tests__/backend-root';

/**
 * The report and operation exports run the screens' own code: `reportAggregates.ts` (the requests and
 * how the answers are read), `reportTables.ts` (the key tables), `copyBudgetRows.ts` (the rows and
 * statuses of "Copy budget columns"), `masterDataCopyRows.ts` (the words of "Copy yearly metrics"),
 * `skillsMatrix.ts` with `contributorsOrdering.ts` (the contributors' skills matrix) and
 * `roadmapOccupation.ts` (the occupation tables of the roadmap generator).
 * The backend cannot import the frontend tree (separate images), so it holds copies, which must stay
 * byte-identical to the frontend files. CI runs this spec when either side changes
 * (`.github/scripts/ci-changes.sh`).
 */

/** [frontend file, backend copy], relative to `frontend/src` and `backend/src`. */
const SHARED_FILES: Array<[string, string]> = [
  ['pages/reports/reportAggregates.ts', 'spend/reports/shared/reportAggregates.ts'],
  ['pages/reports/reportTables.ts', 'spend/reports/shared/reportTables.ts'],
  ['pages/operations/copyBudgetRows.ts', 'spend/budget-operations-export/shared/copyBudgetRows.ts'],
  ['pages/admin/master-data/masterDataCopyRows.ts', 'master-data/shared/masterDataCopyRows.ts'],
  ['pages/portfolio/contributorsOrdering.ts', 'portfolio/shared/contributorsOrdering.ts'],
  ['pages/portfolio/skillsMatrix.ts', 'portfolio/shared/skillsMatrix.ts'],
  ['pages/portfolio/roadmapOccupation.ts', 'portfolio/shared/roadmapOccupation.ts'],
];

for (const [frontendFile, backendFile] of SHARED_FILES) {
  const frontend = fs.readFileSync(backendPath('..', 'frontend', 'src', ...frontendFile.split('/')));
  const backend = fs.readFileSync(backendPath('src', ...backendFile.split('/')));
  assert.ok(
    frontend.equals(backend),
    `backend/src/${backendFile} differs from frontend/src/${frontendFile}: change the frontend file, then copy it `
      + `(cp frontend/src/${frontendFile} backend/src/${backendFile}).`,
  );
}

console.log(`report-shared-copies.spec: ${SHARED_FILES.length} files identical: OK`);
