import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, createRoutesFromChildren, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DeferredPageLocation, PagePendingContext } from './deferredPage';
import { isLeaveGuarded, useLeaveGuard } from '../hooks/leaveGuard';

function PageA() {
  useLeaveGuard(() => true, async () => true);
  const location = useLocation();
  return <div data-testid="page-a">{location.pathname}{location.search}</div>;
}

let showB: () => void = () => undefined;
const loadB = new Promise<{ default: React.ComponentType }>((resolve) => {
  showB = () => resolve({ default: () => <div data-testid="page-b">B</div> });
});
const PageB = React.lazy(() => loadB);

const routeChildren = (
  <>
    <Route path="/a" element={<PageA />} />
    <Route path="/b" element={<PageB />} />
  </>
);
const routes = createRoutesFromChildren(routeChildren);

let navigate: NavigateFunction = () => undefined;
function RouterProbe() {
  navigate = useNavigate();
  return <div data-testid="router-location">{useLocation().pathname}</div>;
}
function PendingProbe() {
  return <div data-testid="pending">{String(React.useContext(PagePendingContext))}</div>;
}

describe('DeferredPageLocation', () => {
  it('keeps the page on screen while the next page loads, and moves within a page at once', async () => {
    render(
      <MemoryRouter initialEntries={['/a']} useTransitions={false}>
        <RouterProbe />
        <React.Suspense fallback={<div data-testid="spinner" />}>
          <DeferredPageLocation routes={routes}>
            <PendingProbe />
            <Routes>{routeChildren}</Routes>
          </DeferredPageLocation>
        </React.Suspense>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('page-a')).toHaveTextContent('/a');
    expect(isLeaveGuarded()).toBe(true);

    // Within the same page: the page follows the router in the same render, as before.
    act(() => { navigate('/a?year=2027'); });
    expect(screen.getByTestId('page-a')).toHaveTextContent('/a?year=2027');
    expect(screen.getByTestId('pending')).toHaveTextContent('false');

    // To a page whose code is not loaded: the router moves, the page on screen stays (no spinner)
    // and keeps the location it shows; its leave guard stays registered while it is on screen.
    act(() => { navigate('/b'); });
    expect(screen.getByTestId('router-location')).toHaveTextContent('/b');
    expect(screen.queryByTestId('spinner')).toBeNull();
    expect(screen.getByTestId('page-a')).toHaveTextContent('/a?year=2027');
    expect(screen.getByTestId('pending')).toHaveTextContent('true');
    expect(isLeaveGuarded()).toBe(true);

    // Once loaded, the next page replaces it and the guard goes with it.
    await act(async () => { showB(); await loadB; });
    expect(await screen.findByTestId('page-b')).toBeInTheDocument();
    expect(screen.queryByTestId('page-a')).toBeNull();
    expect(screen.getByTestId('pending')).toHaveTextContent('false');
    expect(isLeaveGuarded()).toBe(false);
  });
});
