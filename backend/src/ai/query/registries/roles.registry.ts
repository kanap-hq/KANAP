import { AiEntityFilterRegistry } from '../ai-filter.types';
import { AI_ROLE_TYPES } from '../ai-roles.query';

/**
 * The roles of Admin › Roles, read through the screen's services (`query/ai-roles.query.ts`): one
 * row per role, with the number of people it is given to. Listed, filtered, grouped, sorted and
 * paged in memory; the `aggregate` block is descriptive and never reads its empty base table. The
 * detail of a role (by name or id) is its rights, resource by resource, as the screen's matrix.
 * Read with users at admin level, by a person whose access is not limited.
 */
export const rolesRegistry: AiEntityFilterRegistry = {
  entityType: 'roles',
  fields: {
    name: {
      ai: 'name',
      grid: 'name',
      type: 'text',
      description: 'Name of the role, as stored (shipped roles keep their English name, which the screen translates). A part of the name matches.',
      sortable: true,
      groupable: false,
    },
    description: {
      ai: 'description',
      grid: 'description',
      type: 'text',
      description: 'Description of the role. A part of it matches.',
      sortable: false,
      groupable: false,
    },
    type: {
      ai: 'type',
      grid: 'type',
      type: 'set',
      description: 'Kind of role, as the badge of the Roles screen: system (Administrator and Contact, managed by KANAP), built_in (shipped with KANAP, locked: duplicate it to change it) or custom (created in the workspace, editable).',
      values: [...AI_ROLE_TYPES],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    user_count: {
      ai: 'user_count',
      grid: 'user_count',
      type: 'number',
      description: 'Number of people the role is given to, as primary or additional role, as the Roles screen counts them. The people are not named.',
      sortable: true,
      groupable: false,
    },
  },
  sortFields: {
    name: 'name',
    type: 'type',
    user_count: 'user_count',
  },
  defaultSort: {
    field: 'name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: '',
    alias: 'r',
    groupFields: {
      type: { expression: 'type' },
    },
  },
};
