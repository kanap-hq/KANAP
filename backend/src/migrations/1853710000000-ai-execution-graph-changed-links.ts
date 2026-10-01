import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * enforce_ai_execution_tenant_graph() re-checks only the links an UPDATE changes.
 *
 * The function (last defined by 1851900000000) is the tenant-isolation guard of
 * the AI execution graph: FKs are RLS-exempt, so it refuses a link to another
 * tenant's row. It re-checked every link on every UPDATE, including the
 * UPDATE that an ON DELETE SET NULL issues to clear one column. When one DELETE
 * reaches a row along two paths, that SET NULL lands after the other parent is
 * already gone and the unchanged link to it fails the existence test:
 *   - DELETE FROM users: ai_api_keys CASCADE, then ai_runs.user_id SET NULL
 *     re-checks ai_api_key_id ("ai_runs ai_api_key_id must belong to the same
 *     tenant"); ai_conversations and ai_mutation_previews CASCADE, then
 *     ai_action_requests.user_id / conversation_id SET NULL re-checks preview_id.
 *     Any user who ran an MCP key or confirmed a chat write could not be deleted.
 *   - DELETE FROM ai_runs (activity retention): ai_tool_executions CASCADE, then
 *     ai_evidence.run_id SET NULL re-checks tool_execution_id.
 *   - DELETE FROM ai_conversations (conversation retention): ai_mutation_previews
 *     CASCADE, then ai_action_requests.conversation_id SET NULL re-checks
 *     preview_id.
 * The ai_agent_* guards (1852800000000 and later) already skip unchanged links.
 *
 * This fixes the trigger half only. PostgreSQL's own FK check also re-tests an
 * unchanged key when the row version was written in the same transaction, and
 * on a pg_restore'd database the referential triggers fire in another order
 * (trigger-name order). The retention purges and the agent delete therefore
 * unlink the second path explicitly before they DELETE.
 *
 * Same rule here: on INSERT, or when tenant_id changes, every link is checked;
 * otherwise only the links whose value changed. An unchanged link was checked
 * when it was written, and RLS keeps both rows in their tenant. down() restores
 * the check-everything body.
 */

type Link = { column: string; target: string; notNull?: boolean };

const GRAPH: Array<{ table: string; links: Link[] }> = [
  { table: 'ai_runs', links: [{ column: 'ai_api_key_id', target: 'ai_api_keys' }] },
  { table: 'ai_run_steps', links: [{ column: 'run_id', target: 'ai_runs', notNull: true }] },
  {
    table: 'ai_action_requests',
    links: [
      { column: 'run_id', target: 'ai_runs' },
      { column: 'tool_execution_id', target: 'ai_tool_executions' },
      { column: 'preview_id', target: 'ai_mutation_previews' },
    ],
  },
  {
    table: 'ai_tool_executions',
    links: [
      { column: 'run_id', target: 'ai_runs', notNull: true },
      { column: 'step_id', target: 'ai_run_steps' },
      { column: 'action_request_id', target: 'ai_action_requests' },
      { column: 'approval_id', target: 'ai_approvals' },
    ],
  },
  {
    table: 'ai_evidence',
    links: [
      { column: 'run_id', target: 'ai_runs' },
      { column: 'tool_execution_id', target: 'ai_tool_executions' },
      { column: 'action_request_id', target: 'ai_action_requests' },
    ],
  },
  {
    table: 'ai_approvals',
    links: [
      { column: 'action_request_id', target: 'ai_action_requests', notNull: true },
      { column: 'matched_policy_id', target: 'ai_approval_policies' },
    ],
  },
];

function functionSql(changedLinksOnly: boolean): string {
  const branches = GRAPH.map(({ table, links }, index) => {
    const checks = links.map(({ column, target, notNull }) => {
      const guards = [
        ...(notNull ? [] : [`NEW.${column} IS NOT NULL`]),
        ...(changedLinksOnly ? [`(check_all OR NEW.${column} IS DISTINCT FROM OLD.${column})`] : []),
      ];
      return `
        IF ${[...guards, 'NOT EXISTS ('].join(' AND ')}
          SELECT 1 FROM ${target} WHERE id = NEW.${column} AND tenant_id = NEW.tenant_id
        ) THEN
          RAISE EXCEPTION '${table} ${column} must belong to the same tenant';
        END IF;`;
    }).join('');
    return `
      ${index === 0 ? 'IF' : 'ELSIF'} TG_TABLE_NAME = '${table}' THEN${checks}`;
  }).join('');
  return `
    CREATE OR REPLACE FUNCTION enforce_ai_execution_tenant_graph()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    ${changedLinksOnly ? 'DECLARE\n      check_all boolean := TG_OP = \'INSERT\' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id;\n    ' : ''}BEGIN${branches}
      END IF;
      RETURN NEW;
    END;
    $$;
  `;
}

export class AiExecutionGraphChangedLinks1853710000000 implements MigrationInterface {
  name = 'AiExecutionGraphChangedLinks1853710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(functionSql(true));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(functionSql(false));
  }
}
