import type { SelectQueryBuilder } from 'typeorm';
import {
  compileAgFilterCondition,
  compileReferenceFilter,
  createParamNameGenerator,
  normalizeAgFilterModel,
  type CompiledCondition,
  type FilterTargetConfig,
} from '../common/ag-grid-filtering';
import { isDocumentStatus } from './document-status';

/** The document list's column filters compiled by the shared compiler, on the list's alias `d`. */
const DOCUMENT_FILTER_TARGETS: Record<string, FilterTargetConfig> = {
  title: { expression: 'd.title' },
  current_version_number: { expression: 'd.current_version_number', dataType: 'number' },
  updated_at: { expression: 'd.updated_at', dataType: 'date' },
};

/**
 * The column filters of the document list the other filters of `list` do not read: the
 * reference (`DOC-12`), the title, the version number and the day of the last change. A status
 * set of which no value is a document status keeps no document (the status filter of `list`
 * reads only the valid values, and would otherwise keep them all).
 */
export function applyDocumentColumnFilters(qb: SelectQueryBuilder<any>, filters: Record<string, any> | undefined): void {
  if (!filters || typeof filters !== 'object') return;
  const nextParam = createParamNameGenerator('doc_filter_');
  const conditions: CompiledCondition[] = [];
  if (filters.item_ref) {
    const condition = compileReferenceFilter(filters.item_ref, 'd.item_number', 'DOC', nextParam);
    if (condition) conditions.push(condition);
  }
  for (const [field, target] of Object.entries(DOCUMENT_FILTER_TARGETS)) {
    if (!filters[field]) continue;
    const condition = compileAgFilterCondition(filters[field], target, nextParam);
    if (condition) conditions.push(condition);
  }
  const status = normalizeAgFilterModel(filters.status);
  if (status?.filterType === 'set' && Array.isArray(status.values) && status.values.length > 0
    && !status.values.some((value: unknown) => isDocumentStatus(String(value)))) {
    conditions.push({ sql: '1 = 0', params: {} });
  }
  conditions.forEach((condition) => qb.andWhere(`(${condition.sql})`, condition.params));
}
