import { AI_SCREEN_RESOURCES } from '../../ai-role-labels';
import { AiEntityFilterRegistry } from '../ai-filter.types';
import { AI_PERMISSION_LEVELS, AI_ROLE_TYPES } from '../ai-roles.query';

/**
 * The rights the roles give, as the matrix of Admin › Roles shows them (`query/ai-roles.query.ts`):
 * one row per role and right it gives, at the level read by the screen's service (former names of
 * a right folded into today's, the contacts right a suppliers contributor gets included). A right
 * a role does not give has no row; the detail of a role lists them all. Listed, filtered, grouped,
 * sorted and paged in memory; no detail of its own. Read with users at admin level, by a person
 * whose access is not limited.
 */
export const rolePermissionsRegistry: AiEntityFilterRegistry = {
  entityType: 'role_permissions',
  fields: {
    role: {
      ai: 'role',
      grid: 'role',
      type: 'text',
      description: 'Name of the role. A part of the name matches.',
      sortable: true,
      groupable: true,
    },
    role_type: {
      ai: 'role_type',
      grid: 'role_type',
      type: 'set',
      description: 'Kind of the role: system, built_in or custom, as on roles.',
      values: [...AI_ROLE_TYPES],
      acceptedValueKind: 'one_of_declared_values',
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    resource: {
      ai: 'resource',
      grid: 'resource',
      type: 'set',
      description: 'The right, by its code on the Roles screen. Each row\'s `resource_label` is the name the screen gives it, in the person\'s language: the name to quote, not the code.',
      values: [...AI_SCREEN_RESOURCES],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    level: {
      ai: 'level',
      grid: 'level',
      type: 'set',
      description: 'The level the role gives on the right: reader, contributor, member or admin, each including the ones below. Each row\'s `level_label` is the screen\'s word for it, in the person\'s language. "Which roles give budget admin" filters resource budget and level admin.',
      values: [...AI_PERMISSION_LEVELS],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
  },
  sortFields: {
    role: 'role',
    role_type: 'role_type',
    resource: 'resource',
    level: 'level',
  },
  defaultSort: {
    field: 'role',
    direction: 'asc',
  },
  aggregate: {
    baseTable: '',
    alias: 'p',
    groupFields: {
      role: { expression: 'role' },
      role_type: { expression: 'role_type' },
      resource: { expression: 'resource' },
      level: { expression: 'level' },
    },
  },
};
