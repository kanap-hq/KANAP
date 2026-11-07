import { useEffect } from 'react';
import { PRODUCT_NAME } from '../config/product';

let workspaceName = PRODUCT_NAME;

/**
 * Names the workspace in the tab title, and in the name iOS gives an installed app. TenantProvider
 * calls it with the organisation name once the tenant is known.
 */
export function setWorkspaceTitle(name: string): void {
  workspaceName = name;
  document.title = name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
}

/** The tab title of a record page, "<title> | <workspace>", back to the workspace's name when it closes. */
export function useRecordTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return undefined;
    document.title = `${title} | ${workspaceName}`;
    return () => { document.title = workspaceName; };
  }, [title]);
}
