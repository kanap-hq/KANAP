import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../../common/__tests__/backend-root';

/**
 * The budget report exports run the screens' own code: `reportAggregates.ts` (the requests and how
 * the answers are read) and `reportTables.ts` (the key tables). The backend cannot import the
 * frontend tree (separate images), so it holds copies under `src/spend/reports/shared/`, which must
 * stay byte-identical to `frontend/src/pages/reports/`. CI runs this spec when either side changes
 * (`.github/scripts/ci-changes.sh`).
 */

const SHARED_FILES = ['reportAggregates.ts', 'reportTables.ts'];

for (const file of SHARED_FILES) {
  const frontend = fs.readFileSync(backendPath('..', 'frontend', 'src', 'pages', 'reports', file));
  const backend = fs.readFileSync(backendPath('src', 'spend', 'reports', 'shared', file));
  assert.ok(
    frontend.equals(backend),
    `backend/src/spend/reports/shared/${file} differs from frontend/src/pages/reports/${file}: change the frontend file, then copy it `
      + `(cp frontend/src/pages/reports/${file} backend/src/spend/reports/shared/${file}).`,
  );
}

console.log(`report-shared-copies.spec: ${SHARED_FILES.length} files identical: OK`);
