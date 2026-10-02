import { SetMetadata } from '@nestjs/common';

export const REQUIRE_LEVEL_KEY = 'require_level';
export const REQUIRE_ANY_LEVEL_KEY = 'require_any_level';
export type PermissionLevel = 'reader' | 'contributor' | 'member' | 'admin';
export type RequireLevelMeta = { resource: string; level: PermissionLevel };
export type RequireAnyLevelMeta = RequireLevelMeta[];

export const RequireLevel = (resource: string, level: PermissionLevel) =>
  SetMetadata(REQUIRE_LEVEL_KEY, { resource, level } as RequireLevelMeta);

export const RequireAnyLevel = (requirements: RequireAnyLevelMeta) =>
  SetMetadata(REQUIRE_ANY_LEVEL_KEY, requirements);

export const READ_ONLY_ROUTE_KEY = 'read_only_route';

/**
 * A POST that only reads (its query is too long for an address: the budget
 * aggregates of the reports). The subscription freeze, which blocks the
 * writes of a frozen tenant and keeps its reads (`PermissionGuard`), lets it
 * through like a GET. The permission level still applies.
 */
export const ReadOnlyRoute = () => SetMetadata(READ_ONLY_ROUTE_KEY, true);
