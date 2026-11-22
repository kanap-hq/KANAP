import { useLocation } from 'react-router-dom';
import { previousLocation } from '../../navigation/NavigationTracker';

/** An address of this app: a path, never another site (`//host`) or a scheme. */
function isInAppPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

/** The path of an address, without its query or hash. */
function pathOf(address: string): string {
  return address.split(/[?#]/, 1)[0];
}

/**
 * Whether `previous` is the new address of the page at `pathname` (`/it/interfaces/new`, on any tab
 * or none): the new page, or the record it created, seen before it moved to another tab or address.
 */
function isOwnNewAddress(previous: string, pathname: string): boolean {
  const base = /^(.*)\/new(?:\/[^/]*)?$/.exec(pathOf(previous))?.[1];
  return base !== undefined && pathname.startsWith(`${base}/`);
}

/**
 * Where a creation started from, to go back there when it is left or cancelled: the `returnTo`
 * the link put in its state, else the previous in-app address (`NavigationTracker`), else
 * `listPath`, the record type's list. A previous address on the same path is this page before it
 * rewrote its own query (the new document page adds its library), and the page's own new address on
 * another tab (or none) is this page before it moved: neither is where the person came from.
 */
export default function useCreationReturn(listPath: string): string {
  const location = useLocation();
  const stateReturn = (location.state as { returnTo?: unknown } | null | undefined)?.returnTo;
  if (isInAppPath(stateReturn)) return stateReturn;
  const previous = previousLocation(location);
  if (isInAppPath(previous) && pathOf(previous) !== location.pathname && !isOwnNewAddress(previous, location.pathname)) return previous;
  return listPath;
}
