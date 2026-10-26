import type { TFunction } from 'i18next';

/**
 * Confirmation of deleting one connection. Hops are deleted with it. Interface bindings are
 * unlinked and the interfaces stay, so each effect keeps its own clause.
 */
export function connectionDeleteMessage(t: TFunction, hops: number, bindings: number): string {
  if (hops > 0 && bindings > 0) {
    return t('workspace.connection.deleteDialog.messageWithBindingsAndHops', {
      count: bindings,
      hops: t('workspace.connection.deleteDialog.hops', { count: hops }),
    }) as string;
  }
  if (hops > 0) {
    return t('workspace.connection.deleteDialog.messageWithHops', {
      hops: t('workspace.connection.deleteDialog.hops', { count: hops }),
    }) as string;
  }
  if (bindings > 0) {
    return t('workspace.connection.deleteDialog.messageWithBindings', { count: bindings }) as string;
  }
  return t('workspace.connection.deleteDialog.message') as string;
}
