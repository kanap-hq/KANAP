import * as assert from 'node:assert/strict';
import { RoadmapApplySchema } from '../dto/roadmap.dto';

/**
 * Apply dates refuses a project listed twice. The ids are compared without case, so the same
 * uuid written once in lower case and once in upper case is the same duplicate refusal.
 */

const LOWER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UPPER = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const OTHER = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function project(projectId: string, plannedStart = '2026-03-02', plannedEnd = '2026-04-10') {
  return { projectId, plannedStart, plannedEnd };
}

const accepted = RoadmapApplySchema.safeParse({
  projects: [project(LOWER), project(OTHER, '2026-05-04', '2026-06-12')],
});
assert.equal(accepted.success, true, 'two different projects pass');
if (accepted.success) {
  assert.deepEqual(
    accepted.data.projects.map((entry) => entry.projectId),
    [LOWER, OTHER],
    'each id is kept as written',
  );
}

const mixedCase = RoadmapApplySchema.safeParse({
  projects: [project(LOWER), project(UPPER, '2026-05-04', '2026-06-12')],
});
assert.equal(mixedCase.success, false, 'the same uuid in another case is refused');
if (!mixedCase.success) {
  const duplicate = mixedCase.error.issues.find((issue) => issue.message.startsWith('Duplicate projectId'));
  assert.ok(duplicate, mixedCase.error.issues.map((issue) => issue.message).join(' | '));
  assert.equal(duplicate?.message, `Duplicate projectId '${UPPER}'`);
  assert.deepEqual(duplicate?.path, ['projects', 1, 'projectId']);
}

const sameCase = RoadmapApplySchema.safeParse({
  projects: [project(LOWER), project(LOWER, '2026-05-04', '2026-06-12')],
});
assert.equal(sameCase.success, false, 'the same uuid written twice is still refused');
if (!sameCase.success) {
  assert.equal(
    sameCase.error.issues.some((issue) => issue.message === `Duplicate projectId '${LOWER}'`),
    true,
  );
}
