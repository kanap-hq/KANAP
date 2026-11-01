import React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The last in-app address before the current one, for the pages that send the person back where
 * they came from (a record whose creation is cancelled, `useCreationReturn`). Mounted once inside
 * the router (`Layout`). Module state: lost on a full reload, which then falls back to the page's
 * own list.
 */

let current: string | null = null;
let previous: string | null = null;

function addressOf(location: { pathname: string; search: string; hash?: string }): string {
  return `${location.pathname}${location.search}${location.hash ?? ''}`;
}

export function recordLocation(address: string): void {
  if (address === current) return;
  previous = current;
  current = address;
}

/**
 * The address the person was on before `here`. A page reads it while it renders, before the
 * tracker's own effect has recorded `here`: the last recorded address is then the previous one.
 */
export function previousLocation(here: { pathname: string; search: string; hash?: string }): string | null {
  const address = addressOf(here);
  if (current !== null && current !== address) return current;
  return previous !== address ? previous : null;
}

/** Tests only: forget what was recorded. */
export function resetNavigationTracker(): void {
  current = null;
  previous = null;
}

export default function NavigationTracker() {
  const location = useLocation();
  const address = addressOf(location);
  React.useEffect(() => {
    recordLocation(address);
  }, [address]);
  return null;
}
