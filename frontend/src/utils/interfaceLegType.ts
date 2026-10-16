import type { TFunction } from 'i18next';

/** An interface step type (extract, transform, load, direct) in the reader's language; an unknown value as stored. */
export function legTypeLabel(t: TFunction, legType: string | null | undefined): string {
  if (!legType) return '';
  return t(`it:enums.legType.${legType}`, { defaultValue: legType });
}

const ROUTE_TYPE_KEYS: Record<string, string> = { direct: 'direct', via_middleware: 'viaMiddleware' };

/** An interface route type (direct, via middleware) in the reader's language; an unknown value as stored. */
export function routeTypeLabel(t: TFunction, routeType: string | null | undefined): string {
  if (!routeType) return '';
  const key = ROUTE_TYPE_KEYS[routeType];
  return key ? t(`it:enums.routeType.${key}`) : routeType;
}

const MIDDLEWARE_LEGS = ['extract', 'transform', 'load'] as const;

/** The sentence above the bindings matrix: the route type and its legs, named like the matrix rows. */
export function interfaceRouteIntro(t: TFunction, routeType: string | null | undefined): string {
  if (routeType === 'via_middleware') {
    const legs = MIDDLEWARE_LEGS.map((leg) => legTypeLabel(t, leg)).join(', ');
    return t('it:workspace.interface.bindings.routeViaMiddleware', { legs });
  }
  if (routeType === 'direct') return t('it:workspace.interface.bindings.routeDirect');
  return '';
}
