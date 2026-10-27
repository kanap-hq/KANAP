import { AiEntityFilterRegistry } from '../ai-filter.types';
import { renewalDecisionSql } from '../../../contracts/contract-renewal';
import {
  CONTRACT_DECISION_WINDOW_DAYS,
  CONTRACT_TERM_STATES,
  contractTermsSql,
  SQL_TODAY_UTC,
} from '../../../contracts/contract-terms';

/** The joined row of the contract's current term (`contractTermsSql(...).row`), for the groups. */
const TERMS_ALIAS = 'ct_r';

/**
 * The contracts registry for a tenant whose decision window is `decisionWindowDays`
 * (`readDecisionWindowDays`). The query filters and sorts go through the contract list
 * (`ContractsService.list`), which reads the window and the renewal decisions itself; the groups
 * and metrics of `aggregate_entities` read the same terms (`contract-terms.ts`) as of today, with
 * that window and the decisions recorded (`renewalDecisionSql`), so a group by `term_state` counts
 * what the list's state filter keeps.
 */
export function contractsRegistryFor(decisionWindowDays: number): AiEntityFilterRegistry {
  const terms = contractTermsSql('c', SQL_TODAY_UTC, { decisionWindowDays, renewalDecision: renewalDecisionSql('c') });
  const termsJoin = `LEFT JOIN LATERAL (${terms.row}) ${TERMS_ALIAS} ON true`;
  return {
    entityType: 'contracts',
    fields: {
      term_state: {
        ai: 'term_state',
        grid: 'term_state',
        type: 'set',
        description: `State of the contract's current term, the State column of the Contracts list: `
          + `to_decide ("To decide": a decision is due within the workspace's decision window, `
          + `${decisionWindowDays} days, the window of the list's "To decide" quick filter: a contract with tacit renewal whose next `
          + `cancellation deadline falls in it and whose renewal is not confirmed, or a contract without tacit renewal ending in it `
          + `that nobody decided to let end); in_progress ("In progress"); renewed ("Renewed": past this term's cancellation deadline, `
          + `it goes on into the next term); ending ("Ends without renewal"); expired ("Expired"). `
          + `Contracts to decide within the window: term_state to_decide; for another horizon, filter next_due_date.`,
        values: [...CONTRACT_TERM_STATES],
        discoverable: true,
        sortable: false,
        groupable: true,
      },
      next_due_date: {
        ai: 'next_due_date',
        grid: 'next_due_date',
        type: 'date',
        description: 'Next due date, the date the Contracts list sorts on by default: the next cancellation deadline of a contract that renews at the end of its term, otherwise the day it ends. Null once the contract has ended.',
        sortable: true,
        groupable: false,
        aggregable: true,
      },
      renewed: {
        ai: 'renewed',
        grid: 'renewed',
        type: 'set',
        description: 'Whether the contract is past its first term (renewed at least once, tacit renewals included).',
        values: ['true', 'false'],
        discoverable: true,
        sortable: false,
        groupable: true,
      },
      owner: {
        ai: 'owner',
        grid: 'owner_name',
        type: 'set',
        description: 'Contract owner, by first and last name.',
        dynamic: true,
        discoverable: true,
        sortable: false,
        groupable: true,
        aliases: ['owner_name', 'owner_user'],
      },
      application: {
        ai: 'application',
        grid: 'covered_application',
        type: 'set',
        description: 'An application the contract covers (linked from the contract or the application), by reference (APP-8) or exact name: "which contracts cover APP-8". Each item names its covered applications in covered_applications.',
        dynamic: true,
        discoverable: false,
        sortable: false,
        groupable: false,
        lookupEntity: 'applications',
        examples: ['APP-8'],
        aliases: ['covered_application', 'covered_applications', 'application_id', 'app'],
      },
      status: {
        ai: 'status',
        grid: 'status',
        type: 'set',
        description: 'Contract lifecycle status.',
        values: ['enabled', 'disabled'],
        discoverable: true,
        sortable: true,
        groupable: true,
      },
      currency: {
        ai: 'currency',
        grid: 'currency',
        type: 'set',
        description: 'The contract\'s currency: its yearly amount is in it.',
        dynamic: true,
        discoverable: true,
        sortable: true,
        groupable: true,
      },
      supplier: {
        ai: 'supplier',
        grid: 'supplier_name',
        type: 'set',
        description: 'Contract supplier name.',
        dynamic: true,
        discoverable: true,
        sortable: true,
        groupable: true,
      },
      company: {
        ai: 'company',
        grid: 'company_name',
        type: 'set',
        description: 'Contract company name.',
        dynamic: true,
        discoverable: true,
        sortable: true,
        groupable: true,
      },
      cost_center: {
        ai: 'cost_center',
        grid: 'cost_center_name',
        type: 'set',
        description: 'Group or cost center of the contract, as "code · name".',
        dynamic: true,
        discoverable: true,
        sortable: true,
        groupable: true,
      },
      billing_frequency: {
        ai: 'billing_frequency',
        grid: 'billing_frequency',
        type: 'set',
        description: 'Contract billing frequency.',
        values: ['monthly', 'quarterly', 'annual', 'other'],
        discoverable: true,
        sortable: true,
        groupable: true,
      },
      start_date: {
        ai: 'start_date',
        grid: 'start_date',
        type: 'date',
        description: 'Contract start date.',
        sortable: true,
        groupable: false,
      },
      end_date: {
        ai: 'end_date',
        grid: 'end_date',
        type: 'date',
        description: 'End of the current term (tacit renewals included).',
        sortable: true,
        groupable: false,
        aggregable: true,
      },
      current_term_end: {
        ai: 'current_term_end',
        grid: 'end_date',
        type: 'date',
        description: 'End of the current term (tacit renewals included); the same date as end_date.',
        sortable: true,
        groupable: false,
        aggregable: true,
      },
      cancellation_deadline: {
        ai: 'cancellation_deadline',
        grid: 'cancellation_deadline',
        type: 'date',
        description: 'Cancellation deadline: the next one (the term end minus the notice period, tacit renewals included); the last one once the contract has ended.',
        sortable: true,
        groupable: false,
        aggregable: true,
      },
      duration_months: {
        ai: 'duration_months',
        grid: 'duration_months',
        type: 'number',
        description: 'Contract duration in months.',
        sortable: true,
        groupable: false,
      },
      auto_renewal: {
        ai: 'auto_renewal',
        grid: 'auto_renewal',
        type: 'set',
        description: 'Whether the contract auto-renews.',
        values: ['true', 'false'],
        discoverable: true,
        sortable: true,
        groupable: true,
      },
      notice_period_months: {
        ai: 'notice_period_months',
        grid: 'notice_period_months',
        type: 'number',
        description: 'Notice period in months.',
        sortable: true,
        groupable: false,
      },
      yearly_amount: {
        ai: 'yearly_amount',
        grid: 'yearly_amount_at_signature',
        type: 'number',
        description: 'Yearly amount at signature, in the contract\'s currency (currency). Amounts in different currencies do not add up: filter or group by currency before summing.',
        sortable: true,
        groupable: false,
        aggregable: true,
      },
      yearly_amount_at_signature: {
        ai: 'yearly_amount_at_signature',
        grid: 'yearly_amount_at_signature',
        type: 'number',
        description: 'Yearly amount at signature, in the contract\'s currency (currency). Amounts in different currencies do not add up: filter or group by currency before summing.',
        sortable: true,
        groupable: false,
        aggregable: true,
      },
    },
    sortFields: {
      label: 'name',
      status: 'status',
      supplier: 'supplier_name',
      company: 'company_name',
      cost_center: 'cost_center_name',
      currency: 'currency',
      billing_frequency: 'billing_frequency',
      start_date: 'start_date',
      duration_months: 'duration_months',
      auto_renewal: 'auto_renewal',
      notice_period_months: 'notice_period_months',
      end_date: 'end_date',
      current_term_end: 'end_date',
      next_due_date: 'next_due_date',
      cancellation_deadline: 'cancellation_deadline',
      yearly_amount: 'yearly_amount_at_signature',
      yearly_amount_at_signature: 'yearly_amount_at_signature',
      created_at: 'created_at',
      updated_at: 'updated_at',
    },
    // The order of the Contracts list: the next due date first, ended contracts last.
    defaultSort: {
      field: 'next_due_date',
      direction: 'asc',
    },
    aggregate: {
      baseTable: 'contracts',
      alias: 'c',
      groupFields: {
        status: { expression: 'c.status' },
        supplier: {
          expression: 'sup.name',
          joins: [
            `LEFT JOIN suppliers sup ON sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id`,
          ],
        },
        company: {
          expression: 'comp.name',
          joins: [
            `LEFT JOIN companies comp ON comp.id = c.company_id AND comp.tenant_id = c.tenant_id`,
          ],
        },
        cost_center: {
          expression: `CASE WHEN cc.id IS NULL THEN NULL ELSE CONCAT(cc.code, ' · ', cc.name) END`,
          joins: [
            `LEFT JOIN cost_centers cc ON cc.id = c.cost_center_id AND cc.tenant_id = c.tenant_id`,
          ],
        },
        currency: { expression: 'c.currency' },
        billing_frequency: { expression: 'c.billing_frequency' },
        auto_renewal: {
          expression: `CASE WHEN c.auto_renewal THEN 'true' ELSE 'false' END`,
        },
        term_state: { expression: `${TERMS_ALIAS}.term_state`, joins: [termsJoin] },
        renewed: {
          expression: `CASE WHEN ${TERMS_ALIAS}.term_index > 0 THEN 'true' ELSE 'false' END`,
          joins: [termsJoin],
        },
        owner: {
          expression: `NULLIF(btrim(concat_ws(' ', ou.first_name, ou.last_name)), '')`,
          joins: [`LEFT JOIN users ou ON ou.id = c.owner_user_id AND ou.tenant_id = c.tenant_id`],
        },
      },
      metricFields: {
        end_date: {
          expression: terms.currentTermEnd,
          type: 'date',
        },
        current_term_end: {
          expression: terms.currentTermEnd,
          type: 'date',
        },
        next_due_date: {
          expression: terms.nextDueDate,
          type: 'date',
        },
        cancellation_deadline: {
          expression: terms.cancellationDeadline,
          type: 'date',
        },
        yearly_amount_at_signature: {
          expression: 'c.yearly_amount_at_signature',
          type: 'number',
        },
      },
    },
  };
}

/** The registry with the default decision window, for callers without a tenant at hand. */
export const contractsRegistry: AiEntityFilterRegistry = contractsRegistryFor(CONTRACT_DECISION_WINDOW_DAYS);
