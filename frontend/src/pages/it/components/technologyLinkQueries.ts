import type { QueryClient } from '@tanstack/react-query';

/**
 * The screens that show a link between a technology and a server or an application, on either
 * side: after a write, all of them are read again, so the other side never shows a stale link.
 * The technology's own queries (record, tabs, versions, lists) all start with `technolog`.
 * The vulnerabilities (`vulnerabilities`) count through these links: they are read again too.
 */
const LINK_HEADS = new Set([
  'asset-technologies',
  'asset-impact',
  'application-relations',
  'application-workspace-relations-count',
]);

export function invalidateTechnologyLinks(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const head = String(query.queryKey[0]);
      return LINK_HEADS.has(head) || head.startsWith('technolog') || head === 'vulnerabilities';
    },
  });
}
