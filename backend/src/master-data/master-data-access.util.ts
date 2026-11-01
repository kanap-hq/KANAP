import { moduleRightRequired } from '../auth/module-right-required';

export type MasterDataScope = 'companies' | 'departments';

// Effective rights computed by PermissionGuard across all of the user's roles.
export type MasterDataAccess = {
  isAdmin?: boolean;
  permissions?: Record<string, string>;
};

// Budget administrators manage every scope; master data administrators manage their own.
export function canManageMasterDataScope(access: MasterDataAccess, scope: MasterDataScope): boolean {
  if (access.isAdmin) return true;
  const perms = access.permissions ?? {};
  return perms.budget_ops === 'admin' || perms[scope] === 'admin';
}

export function assertCanManageMasterDataScope(access: MasterDataAccess, scope: MasterDataScope, action: string) {
  if (!canManageMasterDataScope(access, scope)) {
    const label = scope === 'companies' ? 'Companies' : 'Departments';
    throw moduleRightRequired(scope, 'admin', `You need ${label} admin permissions to ${action}`);
  }
}
