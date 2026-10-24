import { ForbiddenException, HttpStatus, SetMetadata } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DataAccessMode, isDataAccessLimited } from './data-access';

/**
 * Data-scoped access: the operations reserved to unscoped persons (planning/data-scoped-access/spec.md
 * §2.7, §6.7). One guard, two entry points:
 * - `@ReservedToUnscopedDataAccess()` on a route (handler or controller): the tenant interceptor
 *   refuses it to a person whose access is limited, right after applying the access (guards run
 *   before it, so the check cannot be a guard). On a `@SkipTenantTransaction()` route the
 *   interceptor runs the same check in a short tenant transaction of its own.
 * - `assertUnscopedDataAccess(context)` for the paths that do not go through the interceptor
 *   (Plaid's writes, work run through `runWithContext`).
 * Both answer 403 `DATA_ACCESS_LIMITED`. `data-access-reserved.inventory.ts` classifies every route
 * of the controllers that hold a reserved operation.
 */

export const RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY = 'reservedToUnscopedDataAccess';

/** The route is reserved to persons whose access is not limited (mode "all", or Administrator). */
export const ReservedToUnscopedDataAccess = () => SetMetadata(RESERVED_TO_UNSCOPED_DATA_ACCESS_KEY, true);

export const DATA_ACCESS_RESERVED_MESSAGE = 'This action is reserved to people with access to all data.';

/** 403 `DATA_ACCESS_LIMITED`: the action is reserved to unscoped persons. */
export class DataAccessReservedException extends ForbiddenException {
  constructor() {
    super({
      statusCode: HttpStatus.FORBIDDEN,
      error: 'Forbidden',
      code: 'DATA_ACCESS_LIMITED',
      message: DATA_ACCESS_RESERVED_MESSAGE,
    });
  }
}

/** Where the person's mode is known: the request (set by the tenant interceptor) or a transaction. */
export type UnscopedDataAccessContext = {
  /** The request the tenant interceptor served: it carries `dataAccessMode`. */
  req?: { dataAccessMode?: DataAccessMode } | null;
  /** A transaction under the tenant, with or without the person's access applied. */
  manager?: EntityManager | null;
  /** The person; none (scheduled or system work) is never refused. */
  userId?: string | null;
};

/**
 * The person's mode: from the request when the interceptor set it; otherwise `limited` when the
 * transaction runs a limited access (`app.da_mode`, set by `data_access_apply`), or when the person
 * is limited (read from the users and roles, for a transaction where the access was not applied).
 */
export async function dataAccessModeOf(context: UnscopedDataAccessContext): Promise<DataAccessMode> {
  const fromRequest = context.req?.dataAccessMode;
  if (fromRequest === 'all' || fromRequest === 'limited') return fromRequest;
  const manager = context.manager;
  if (!manager) {
    throw new Error('assertUnscopedDataAccess needs the request the tenant interceptor served, or a transaction');
  }
  const rows = await manager.query(`SELECT current_setting('app.da_mode', true) = 'limited' AS limited`);
  if (rows?.[0]?.limited === true) return 'limited';
  const userId = context.userId;
  if (userId && await isDataAccessLimited(manager, userId)) return 'limited';
  return 'all';
}

/** Refuses (403 `DATA_ACCESS_LIMITED`) a reserved operation to a person whose access is limited. */
export async function assertUnscopedDataAccess(context: UnscopedDataAccessContext): Promise<void> {
  if (await dataAccessModeOf(context) === 'limited') throw new DataAccessReservedException();
}

/**
 * Whether writing a value of this dimension (create, update, delete) is reserved to unscoped
 * persons (spec §2.7, §3.5): the values of a closed-list dimension are organisation data. A
 * dimension with open values (`open_values`) lets anyone who may change the line create one. Every
 * dimension is a closed list until that setting exists.
 */
export function isReservedDimensionValueWrite(dimension?: { open_values?: boolean | null } | null): boolean {
  return dimension?.open_values !== true;
}
