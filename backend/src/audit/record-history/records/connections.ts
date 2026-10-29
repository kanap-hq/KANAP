import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The connection (lot 2, family C): its page, its path segments and their allow-list.
 *
 * A segment's write keeps the segment's own id in `record_id` and names the connection in its
 * payload (`connection_id`), so the parent rule reads that key. The reorder swap writes both
 * segments in its payload with no `connection_id`: its writer hands the connection as an explicit
 * parent.
 */
export const connectionsRecord = {
  table: 'connections',
  module: 'infrastructure',
  level: 'reader',
  auditLabels: ['connections'],
  family: 'connection',
  children: {
    connection_legs: 'leg',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A connection, as its screen names it. */
const CONNECTION_FIELDS: HistoryFields = {
  connection_reference: shown(),
  name: shown(),
  description: shown(),
  topology: shown(),
  source_asset_id: shown('asset'),
  source_entity_code: shown(),
  destination_asset_id: shown('asset'),
  destination_entity_code: shown(),
  lifecycle: shown(),
  criticality: shown(),
  data_class: shown(),
  contains_pii: shown(),
  risk_mode: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A path segment; its equipment names an asset of the same module or an external entity code. */
const CONNECTION_LEG_FIELDS: HistoryFields = {
  order_index: shown(),
  function_code: shown(),
  equipment_asset_id: shown('asset'),
  equipment_entity_code: shown(),
  protocol_codes: shown(),
  port_override: shown(),
  notes: shown(),
  connection_id: hidden('connection link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the connection's audit labels: the connection and its segments. */
export const connectionsFields: Readonly<Record<string, HistoryFields>> = {
  connections: CONNECTION_FIELDS,
  connection_legs: CONNECTION_LEG_FIELDS,
};

/**
 * The audit labels that carry a connection. The migration `1855720000000` copies these labels in
 * SQL on purpose: a migration is frozen and must not import this module
 * (`__tests__/record-history-family-c-migration.integration.spec.ts` compares them).
 */
export const connectionsParentRules: Readonly<Record<string, AuditParentRule>> = {
  connection_legs: { parentTable: 'connections', from: 'payload', keys: ['connection_id'] },
};
