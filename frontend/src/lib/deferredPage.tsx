import React from 'react';
import { UNSAFE_LocationContext, matchRoutes, type Location, type RouteObject } from 'react-router-dom';

/** True while another page loads in the background behind the one on screen. */
export const PagePendingContext = React.createContext(false);

/**
 * The location the routes below render. A move within the same page (a tab, the query, another
 * line of the workspace) renders at once, as the router does. A move to another page renders in
 * the background: the page on screen stays, untouched, until the next one is ready (its code
 * chunk and what it suspends on) instead of the layout's loading spinner and a blank frame. The
 * router itself still moves at once: the leave guards, which run before the move, and anything
 * outside the routes see the latest navigation.
 */
export function DeferredPageLocation({ routes, children }: { routes: RouteObject[]; children: React.ReactNode }) {
  const current = React.useContext(UNSAFE_LocationContext);
  const deferred = React.useDeferredValue(current);
  const shown = deferred === current || pageOf(routes, current.location) === pageOf(routes, deferred.location)
    ? current
    : deferred;
  return (
    <UNSAFE_LocationContext.Provider value={shown}>
      <PagePendingContext.Provider value={shown !== current}>{children}</PagePendingContext.Provider>
    </UNSAFE_LocationContext.Provider>
  );
}

/** The component of the deepest route matching `location` (the page), or null. */
function pageOf(routes: RouteObject[], location: Location): unknown {
  const matches = matchRoutes(routes, location);
  const element = matches?.[matches.length - 1]?.route.element;
  return React.isValidElement(element) ? element.type : null;
}
