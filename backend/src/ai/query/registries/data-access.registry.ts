import { AiEntityFilterRegistry } from '../ai-filter.types';
import { AI_DATA_ACCESS_LEVELS, AI_DATA_ACCESS_NODE_KINDS, AI_DATA_ACCESS_NODE_TYPES } from '../ai-data-access.query';

/**
 * Admin › Data access, read through the screen's service (`query/ai-data-access.query.ts`): one
 * row per person in limited access and node, a person without a node giving one row without a
 * node (they see no budget or contract data). People holding the Administrator role see all data
 * and are never listed. Listed, filtered, grouped, sorted and paged in memory; the `aggregate`
 * block is descriptive and never reads its empty base table. A row has no detail of its own: the
 * person's access is in `get_entity_detail` on users, who sees a company in `get_entity_detail` on
 * companies. Read with users at admin level, by a person whose access is not limited.
 */
export const dataAccessRegistry: AiEntityFilterRegistry = {
  entityType: 'data_access',
  fields: {
    person: {
      ai: 'person',
      grid: 'person',
      type: 'text',
      description: 'Name of the person in limited access. A part of the name matches. Grouping counts the nodes of each person.',
      sortable: true,
      groupable: true,
    },
    roles: {
      ai: 'roles',
      grid: 'roles',
      type: 'text',
      description: 'Every role of the person, primary first. A part of a role name matches. A role says what a person may do; the node says which budget and contract data they see.',
      sortable: false,
      groupable: false,
    },
    node_type: {
      ai: 'node_type',
      grid: 'node_type',
      type: 'set',
      description: 'Kind of node: all (all budget and contract data), company (the company and the cost centers of that company) or cost_center (a cost center, or a group with its sub-groups and their cost centers, whatever their company). null is a person without a node, who sees no budget or contract data.',
      values: [...AI_DATA_ACCESS_NODE_TYPES],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    node: {
      ai: 'node',
      grid: 'node',
      type: 'text',
      description: 'The node as the screen names it: the company name, or `CODE name` of a cost center or group. "deleted node" when its company or cost center no longer exists. A part of it matches. It names the node given to the person, not what it covers by inheritance: who sees a company, through a node on it or on one of its cost centers, is in get_entity_detail on companies (data_access). The inheritance of a cost center (its groups, its company, all) is on its Access tab in KANAP. Grouping counts rows, so a person with several nodes counts in each of their groups: see `distinct_count` and `distinct_total` for persons.',
      sortable: true,
      groupable: true,
    },
    node_code: {
      ai: 'node_code',
      grid: 'node_code',
      type: 'text',
      description: 'Code of the cost center or group of the node, compared exactly without case. Gives who has a node on that cost center.',
      sortable: false,
      groupable: false,
    },
    node_kind: {
      ai: 'node_kind',
      grid: 'node_kind',
      type: 'set',
      description: 'For a cost center node: group (a group of cost centers) or cost_center (one cost center). null for the other nodes.',
      values: [...AI_DATA_ACCESS_NODE_KINDS],
      discoverable: true,
      sortable: false,
      groupable: true,
    },
    access: {
      ai: 'access',
      grid: 'access',
      type: 'set',
      description: 'Level of the node: read (sees the data) or edit (sees and changes it; edit includes read). null is a person without a node.',
      values: [...AI_DATA_ACCESS_LEVELS],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    changed_at: {
      ai: 'changed_at',
      grid: 'changed_at',
      type: 'date',
      description: 'When the person\'s data access was last changed.',
      sortable: true,
      groupable: false,
    },
    changed_by: {
      ai: 'changed_by',
      grid: 'changed_by',
      type: 'text',
      description: 'Name of the person who last changed it.',
      sortable: false,
      groupable: false,
    },
  },
  sortFields: {
    person: 'person',
    node_type: 'node_type',
    node: 'node',
    access: 'access',
    changed_at: 'changed_at',
  },
  defaultSort: {
    field: 'person',
    direction: 'asc',
  },
  aggregate: {
    baseTable: '',
    alias: 'da',
    groupFields: {
      person: { expression: 'person' },
      node_type: { expression: 'node_type' },
      node: { expression: 'node' },
      node_kind: { expression: 'node_kind' },
      access: { expression: 'access' },
    },
  },
};
