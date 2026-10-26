import { isReservedDimensionValueWrite } from '../../data-access/reserved-operations';

/**
 * Plaid's writes that are operations reserved to unscoped persons (planning/data-scoped-access/spec.md
 * §2.7, §5.6): refused to a person whose access is limited, as the matching routes are
 * (`data-access/data-access-reserved.inventory.ts`).
 * - organisation data (companies and their metrics, departments and their metrics, accounts,
 *   charts of accounts, business processes): create and update;
 * - dimension values (analytics categories): create and update, as on the dimension page
 *   (`isReservedDimensionValueWrite` without a dimension: open values come from a line only);
 * - suppliers and shared contacts: update, and a supplier's contacts; creating one stays allowed.
 * Lines, contracts, tasks, documents, locations and the other records follow the person's access.
 */

const ORGANISATION = new Set(['companies', 'departments', 'accounts', 'chart_of_accounts', 'business_processes']);
const SHARED_RECORDS = new Set(['suppliers', 'contacts']);

/** Whether this write tool on this entity type is reserved to unscoped persons. */
export function isReservedAiMutation(toolName: string, entityType: unknown): boolean {
  const type = String(entityType ?? '').trim();
  switch (toolName) {
    case 'create_master_data_record':
      return ORGANISATION.has(type) || (type === 'analytics_categories' && isReservedDimensionValueWrite());
    case 'update_master_data_record':
      return ORGANISATION.has(type)
        || SHARED_RECORDS.has(type)
        || (type === 'analytics_categories' && isReservedDimensionValueWrite());
    case 'update_entity_relations':
      // The contacts of a supplier (as `suppliers/:id/contacts`).
      return type === 'suppliers';
    default:
      return false;
  }
}
