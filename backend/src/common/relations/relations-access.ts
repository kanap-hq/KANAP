import type { PermissionLevel } from '../../auth/require-level.decorator';
import type { TenantRequest } from '../decorators/tenant.decorator';

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

type AccessContext = Pick<TenantRequest, 'isAdmin' | 'permissions'>;

/** The caller holds `level` or more on `resource` (an administrator holds everything). */
export function hasLevel(ctx: AccessContext, resource: string, level: PermissionLevel): boolean {
  return ctx.isAdmin === true || (RANK[ctx.permissions?.[resource] ?? ''] ?? 0) >= RANK[level];
}

/**
 * The read (`reader`), write (`member`) and contribute (`contributor`) flags of a Relations tab,
 * one boolean per kind. `read`, `write` and `contribute` map a kind to the permission resource.
 */
export function buildRelationsAccess<R extends string, W extends string = never, C extends string = never>(
  ctx: AccessContext,
  spec: {
    read: Record<R, string>;
    write?: Record<W, string>;
    contribute?: Record<C, string>;
  },
): { access: Record<R, boolean>; writes: Record<W, boolean>; contributes: Record<C, boolean> } {
  return {
    access: flags(ctx, spec.read, 'reader'),
    writes: flags(ctx, spec.write, 'member'),
    contributes: flags(ctx, spec.contribute, 'contributor'),
  };
}

function flags<K extends string>(
  ctx: AccessContext,
  resources: Record<K, string> | undefined,
  level: PermissionLevel,
): Record<K, boolean> {
  const out = {} as Record<K, boolean>;
  if (!resources) return out;
  for (const kind of Object.keys(resources) as K[]) out[kind] = hasLevel(ctx, resources[kind], level);
  return out;
}
