import { BadRequestException } from '@nestjs/common';
import { sameStoredValue } from '../../common/csv-sheet/unchanged';
import { ClassificationCatalog, resolveClassificationOption, validateDuration } from '../../it-ops-settings/classification-catalog';

export type ClassificationReview = { user_id: string; reviewed_at: string; revision: number };
export const CLASSIFICATION_INPUT_FIELDS = ['criticality', 'cyber_criticality', 'data_class', 'recovery_wave', 'rto_minutes', 'rpo_minutes', 'classification_justification', 'contains_pii', 'last_dr_test'] as const;
export const CLASSIFICATION_SERVER_FIELDS = ['classification_revision', 'classification_review', 'classification_review_state', 'classification_review_reason', 'classification_reviewed_at', 'classification_reviewer_name'] as const;
const CLASSIFICATION_AXES = [['criticality', 'businessCriticalityLevels'], ['cyber_criticality', 'cyberCriticalityLevels'], ['data_class', 'dataClasses'], ['recovery_wave', 'recoveryWaves']] as const;

export function classificationPatch(input: Record<string, any>, existing: Record<string, any> | null, catalog: ClassificationCatalog): Record<string, any> {
  for (const field of CLASSIFICATION_SERVER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) throw new BadRequestException(`${field} is server-managed`);
  }
  const patch: Record<string, any> = {};
  for (const field of CLASSIFICATION_INPUT_FIELDS) {
    if (input[field] !== undefined) patch[field] = input[field];
    else if (!existing && !['contains_pii', 'last_dr_test'].includes(field)) patch[field] = null;
  }
  for (const field of ['rto_minutes', 'rpo_minutes']) {
    if (patch[field] !== undefined) patch[field] = validateDuration(patch[field], field, field === 'rpo_minutes');
  }
  for (const [field, axis] of CLASSIFICATION_AXES) {
    if (patch[field] !== undefined) patch[field] = resolveClassificationOption(patch[field], catalog[axis], existing?.[field]);
  }
  if (patch.classification_justification !== undefined && patch.classification_justification !== null) {
    if (typeof patch.classification_justification !== 'string' || patch.classification_justification.length > 8000) throw new BadRequestException('classification_justification must be text of at most 8000 characters or null');
    patch.classification_justification = patch.classification_justification.trim() || null;
  }
  // A date cell is text and the stored date a Date: compared as values, so an identical re-import keeps the revision.
  const changed = Object.entries(patch).some(([key, value]) => !sameStoredValue(existing?.[key] ?? null, value));
  patch.classification_revision = (existing?.classification_revision ?? 0) + (changed ? 1 : 0);
  if (!existing) patch.classification_review = null;
  return patch;
}

export function isClassificationComplete(app: Record<string, any>): boolean {
  return !!app.criticality?.trim() && !!app.cyber_criticality && !!app.data_class && !!app.recovery_wave && !!app.classification_justification?.trim();
}

/** Review is a timestamp: `stale` means never reviewed or changed since; the catalog never invalidates it. */
export function classificationReadState(app: Record<string, any>) {
  const complete = isClassificationComplete(app);
  const review = app.classification_review as ClassificationReview | null;
  const reason = !complete ? 'missing_fields' : !review ? 'never_reviewed' : review.revision !== app.classification_revision ? 'data_changed' : null;
  return {
    classification_review_state: !complete ? 'incomplete' : reason ? 'stale' : 'reviewed',
    classification_review_reason: reason,
    classification_reviewed_at: review?.reviewed_at ?? null,
  };
}

export function copyClassification(source: Record<string, any>, catalog: ClassificationCatalog): Record<string, any> {
  const inputs = Object.fromEntries(CLASSIFICATION_INPUT_FIELDS.map((field) => [field, source[field] ?? null]));
  inputs.last_dr_test = null;
  // Deprecated decisions of the source may be carried into the copy as historical values.
  return { ...inputs, ...classificationPatch(inputs, source, catalog), classification_revision: 0, classification_review: null, last_dr_test: null };
}
