import { ForbiddenException } from '@nestjs/common';
import type { PermissionLevel, RequireAnyLevelMeta } from '../../auth/require-level.decorator';
import { parseLookupIds } from './reference-lookup';

/**
 * Who may read a reference lookup. A lookup row holds the fields a picker
 * shows (a name, a code), never the record itself, and it is read two ways:
 *
 * - a search (`q`, blank or not): the rows a user may pick from. Allowed to
 *   the readers of the reference's own page, and to the users who edit a page
 *   whose forms pick the reference (the level that page's edits require).
 * - a hydration (`ids`): the labels of values the user already holds on a
 *   record. Allowed to the readers of those picking pages too, who see the
 *   chosen value without ever picking one.
 *
 * So a read-only role never lists a table it cannot open: an OPEX reader sees
 * its line's supplier, but cannot page through every supplier.
 */
const reader = (resource: string) => ({ resource, level: 'reader' as const });

export type LookupPicker = { resource: string; level: PermissionLevel };

export interface LookupAccess {
  /** The reference's own page: its readers search. */
  own: string;
  /** Pages whose forms pick the reference: the level that edits them searches, their readers hydrate. */
  pickers: LookupPicker[];
  /** Pages whose readers search too (the people of "Send link", open on read-only pages). */
  readerSearch?: string[];
  /** Pages that only show chosen labels: their readers hydrate. */
  shows?: string[];
}

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
const at = (resource: string, level: PermissionLevel): LookupPicker => ({ resource, level });

/** The guard's list: every role that may at least read the chosen labels. */
export function lookupReaders(access: LookupAccess): RequireAnyLevelMeta {
  const resources = [
    access.own,
    ...(access.readerSearch ?? []),
    ...access.pickers.map((picker) => picker.resource),
    ...(access.shows ?? []),
  ];
  return Array.from(new Set(resources)).map(reader);
}

/** The requirements under which a search is allowed (an administrator always may). */
export function lookupSearchers(access: LookupAccess): RequireAnyLevelMeta {
  return [reader(access.own), ...(access.readerSearch ?? []).map(reader), ...access.pickers];
}

/** What PermissionGuard leaves on the request (`@Tenant()` hands it on). */
export type LookupCaller = { isAdmin?: boolean; permissions?: Record<string, string> };

/**
 * Refuses a search to a role that may only hydrate. Run in the handler, after
 * PermissionGuard (which checked `lookupReaders`). `ids` is read as the lookup
 * reads it, so the two can never disagree on what a hydration is.
 */
export function assertLookupSearch(access: LookupAccess, caller: LookupCaller, query: any): void {
  if (parseLookupIds(query?.ids) !== null) return;
  if (caller.isAdmin) return;
  const permissions = caller.permissions ?? {};
  const allowed = lookupSearchers(access).some(({ resource, level }) => (RANK[permissions[resource]] ?? 0) >= RANK[level]);
  if (!allowed) {
    throw new ForbiddenException({
      code: 'lookup_search_forbidden',
      message: 'This role can show the chosen values but cannot search this list.',
    });
  }
}

/**
 * Companies and departments: picked on most forms (owners, allocations, assets, projects...)
 * and filtered on in read-only reports (the chargeback report picks a company). Searched by
 * every role listed, as before lot 1C.
 */
export const ORGANISATION_LOOKUP_READERS: RequireAnyLevelMeta = [
  reader('companies'),
  reader('departments'),
  { resource: 'users', level: 'admin' },
  reader('opex'),
  reader('capex'),
  reader('contracts'),
  reader('reporting'),
  reader('tasks'),
  reader('portfolio_requests'),
  reader('portfolio_projects'),
  reader('applications'),
  reader('locations'),
  reader('infrastructure'),
];

/**
 * People. Every page with "Send link" lets its readers search (the dialog is
 * open on read-only pages); the other pages that pick a person search at the
 * level that edits them; the portfolio pages show a contributor's manager.
 */
export const USER_LOOKUP_ACCESS: LookupAccess = {
  own: 'users',
  readerSearch: [
    'opex',
    'capex',
    'tasks',
    'portfolio_requests',
    'portfolio_projects',
    'applications',
    'infrastructure',
    'locations',
    'knowledge',
  ],
  pickers: [
    at('contracts', 'member'),
    at('business_processes', 'member'),
    at('incidents', 'contributor'),
    at('cost_centers', 'member'),
    at('portfolio_settings', 'member'),
  ],
  shows: ['portfolio_planning', 'portfolio_reports'],
};

/** Suppliers: picked on OPEX and CAPEX lines, contracts, applications, an asset's support panel and contacts. */
export const SUPPLIER_LOOKUP_ACCESS: LookupAccess = {
  own: 'suppliers',
  pickers: [
    at('opex', 'member'),
    at('capex', 'member'),
    at('contracts', 'member'),
    at('applications', 'member'),
    at('infrastructure', 'member'),
    at('contacts', 'member'),
  ],
};

/** Accounts: picked on OPEX and CAPEX lines only. */
export const ACCOUNT_LOOKUP_ACCESS: LookupAccess = {
  own: 'accounts',
  pickers: [at('opex', 'member'), at('capex', 'member')],
};

/** Business processes: picked on a request's analysis and on interfaces (applications area). */
export const BUSINESS_PROCESS_LOOKUP_ACCESS: LookupAccess = {
  own: 'business_processes',
  pickers: [at('portfolio_requests', 'member'), at('applications', 'member')],
};

/** Contracts: linked from OPEX and CAPEX lines (Relations tab) and from an asset's support panel. */
export const CONTRACT_LOOKUP_ACCESS: LookupAccess = {
  own: 'contracts',
  pickers: [at('opex', 'member'), at('capex', 'member'), at('infrastructure', 'member')],
};

export const USER_LOOKUP_READERS = lookupReaders(USER_LOOKUP_ACCESS);
export const SUPPLIER_LOOKUP_READERS = lookupReaders(SUPPLIER_LOOKUP_ACCESS);
export const ACCOUNT_LOOKUP_READERS = lookupReaders(ACCOUNT_LOOKUP_ACCESS);
export const BUSINESS_PROCESS_LOOKUP_READERS = lookupReaders(BUSINESS_PROCESS_LOOKUP_ACCESS);
export const CONTRACT_LOOKUP_READERS = lookupReaders(CONTRACT_LOOKUP_ACCESS);
