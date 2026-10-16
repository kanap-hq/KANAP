import { MigrationInterface, QueryRunner } from 'typeorm';
import { ensureReferenceKey, type ReferenceKey } from '../common/migration-reference-keys';

/**
 * Foreign keys on the reference columns that had none, so a delete no longer leaves rows naming a
 * row that is gone. The columns that keep no key, each with its reason, are listed in
 * `common/reference-keys.inventory.ts`; a spec fails on any new reference column with neither.
 *
 * - Rows that mean nothing without the row they name go with it (ON DELETE CASCADE): link rows
 *   (supplier contacts, a contract's or a budget line's links, attachments and tasks), a project's,
 *   request's or task's history, team memberships, a user's team member settings, notification
 *   settings, monthly time totals and AI change plans, and the plans of a deleted conversation.
 *   The delete services that already remove them first are unchanged.
 * - A nullable reference is cleared (ON DELETE SET NULL): who created, updated, owns or leads
 *   something, the department of a project or request, a task's phase, category and stream, a
 *   team member's default classification, a budget line's contract and project, an allocation's
 *   rule. Deleting a user, a department, a phase or a classification item leaves the rest as it is.
 * - The equipment of a connection leg restricts (ON DELETE RESTRICT): the asset delete already
 *   refuses an asset that a connection uses.
 *
 * The migration succeeds on any data (`common/migration-reference-keys.ts`). Rows that name a row
 * missing in their tenant are counted per tenant in the log, then deleted (CASCADE keys) or
 * cleared (the others), and every key is validated. A rerun finds the keys in place.
 */

const key = (
  table: string,
  column: string,
  refTable: string,
  onDelete: ReferenceKey['onDelete'],
): ReferenceKey => ({
  table,
  column,
  refTable,
  name: `fk_${table}_${column}`,
  onDelete,
  orphans: onDelete === 'CASCADE' ? 'delete' : 'clear',
});

const cascade = (table: string, column: string, refTable: string) => key(table, column, refTable, 'CASCADE');
const setNull = (table: string, column: string, refTable: string) => key(table, column, refTable, 'SET NULL');

const LINK_AND_REFERENCE_KEYS: readonly ReferenceKey[] = [
  // Link and owned rows.
  cascade('supplier_contacts', 'contact_id', 'contacts'),
  cascade('contract_attachments', 'contract_id', 'contracts'),
  cascade('contract_links', 'contract_id', 'contracts'),
  cascade('contract_spend_items', 'contract_id', 'contracts'),
  cascade('contract_spend_items', 'spend_item_id', 'spend_items'),
  cascade('contract_tasks', 'contract_id', 'contracts'),
  cascade('spend_attachments', 'spend_item_id', 'spend_items'),
  cascade('spend_links', 'spend_item_id', 'spend_items'),
  cascade('portfolio_activities', 'project_id', 'portfolio_projects'),
  cascade('portfolio_activities', 'request_id', 'portfolio_requests'),
  cascade('portfolio_activities', 'task_id', 'tasks'),
  cascade('portfolio_project_team', 'user_id', 'users'),
  cascade('portfolio_request_team', 'user_id', 'users'),
  cascade('portfolio_team_member_configs', 'user_id', 'users'),
  cascade('user_notification_preferences', 'user_id', 'users'),
  cascade('user_time_monthly_aggregates', 'user_id', 'users'),
  cascade('ai_mutation_plans', 'user_id', 'users'),
  cascade('ai_mutation_plans', 'conversation_id', 'ai_conversations'),

  // Nullable references to a user.
  setNull('ai_agent_definitions', 'updated_by_user_id', 'users'),
  setNull('ai_api_keys', 'revoked_by_user_id', 'users'),
  setNull('ai_model_configs', 'updated_by', 'users'),
  setNull('ai_shared_context_profiles', 'updated_by_user_id', 'users'),
  setNull('contract_compliance_items', 'updated_by', 'users'),
  setNull('contract_tasks', 'assignee_user_id', 'users'),
  setNull('document_libraries', 'owner_user_id', 'users'),
  setNull('freeze_states', 'frozen_by', 'users'),
  setNull('freeze_states', 'unfrozen_by', 'users'),
  setNull('incident_attachments', 'uploaded_by', 'users'),
  setNull('incidents', 'created_by', 'users'),
  setNull('incidents', 'updated_by', 'users'),
  setNull('portfolio_activities', 'author_id', 'users'),
  setNull('portfolio_project_time_entries', 'logged_by_id', 'users'),
  setNull('portfolio_project_time_entries', 'user_id', 'users'),
  setNull('portfolio_projects', 'business_lead_id', 'users'),
  setNull('portfolio_projects', 'business_sponsor_id', 'users'),
  setNull('portfolio_projects', 'it_lead_id', 'users'),
  setNull('portfolio_projects', 'it_sponsor_id', 'users'),
  setNull('portfolio_requests', 'business_lead_id', 'users'),
  setNull('portfolio_requests', 'business_sponsor_id', 'users'),
  setNull('portfolio_requests', 'created_by_id', 'users'),
  setNull('portfolio_requests', 'it_lead_id', 'users'),
  setNull('portfolio_requests', 'it_sponsor_id', 'users'),
  setNull('portfolio_requests', 'requestor_id', 'users'),
  setNull('spend_round_inputs', 'updated_by', 'users'),
  setNull('task_attachments', 'uploaded_by_id', 'users'),
  setNull('task_time_entries', 'logged_by_id', 'users'),
  setNull('task_time_entries', 'user_id', 'users'),
  setNull('tasks', 'assignee_user_id', 'users'),
  setNull('tasks', 'creator_id', 'users'),

  // Other nullable references.
  setNull('portfolio_projects', 'department_id', 'departments'),
  setNull('portfolio_requests', 'department_id', 'departments'),
  setNull('portfolio_team_member_configs', 'default_category_id', 'portfolio_categories'),
  setNull('portfolio_team_member_configs', 'default_source_id', 'portfolio_sources'),
  setNull('portfolio_team_member_configs', 'default_stream_id', 'portfolio_streams'),
  setNull('tasks', 'category_id', 'portfolio_categories'),
  setNull('tasks', 'stream_id', 'portfolio_streams'),
  setNull('tasks', 'phase_id', 'portfolio_project_phases'),
  setNull('spend_items', 'contract_id', 'contracts'),
  setNull('spend_items', 'project_id', 'portfolio_projects'),
  setNull('spend_allocations', 'rule_id', 'allocation_rules'),
  key('connection_legs', 'equipment_asset_id', 'assets', 'RESTRICT'),
];

const PREFIX = '[Migration] LinkAndReferenceKeys:';

export class LinkAndReferenceKeys1854160000000 implements MigrationInterface {
  name = 'LinkAndReferenceKeys1854160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const ref of LINK_AND_REFERENCE_KEYS) {
      await ensureReferenceKey(queryRunner, ref, (line) => console.log(`${PREFIX} ${line}`));
    }
  }

  /** None of these columns had a key before. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const ref of LINK_AND_REFERENCE_KEYS) {
      await queryRunner.query(`ALTER TABLE ${ref.table} DROP CONSTRAINT IF EXISTS ${ref.name}`);
    }
  }
}
