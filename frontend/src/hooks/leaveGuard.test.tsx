import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmLeave, isLeaveGuarded, registerLeaveGuard, useGuardedLeave, useInAppLinkGuard } from './leaveGuard';

// Leaving a page through the app's own links (lot 3C review): under
// BrowserRouter there is no navigation blocker, so a page with edits it could
// not save registers a guard, and every in-app link asks it first.

const unregister: Array<() => void> = [];
afterEach(() => {
  while (unregister.length) unregister.pop()!();
});

function guard(busy: boolean, answer: boolean) {
  const leave = vi.fn(async () => answer);
  unregister.push(registerLeaveGuard({ isBusy: () => busy, leave }));
  return leave;
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function Shell() {
  const navigate = useNavigate();
  useInAppLinkGuard(navigate);
  const guardedLeave = useGuardedLeave();
  return (
    <>
      <Link to="/elsewhere">left menu link</Link>
      <Link to="/elsewhere" target="_blank">new tab link</Link>
      <a href="https://example.com/doc">external link</a>
      <button type="button" onClick={() => { void guardedLeave(() => navigate('/settings')); }}>my profile</button>
      <Where />
    </>
  );
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/ops/opex/OPX-1/overview']}>
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('confirmLeave', () => {
  it('asks the busy pages only, and stops at the first that keeps the user', async () => {
    const idle = guard(false, true);
    expect(isLeaveGuarded()).toBe(false);
    const stays = guard(true, false);
    expect(isLeaveGuarded()).toBe(true);
    await expect(confirmLeave()).resolves.toBe(false);
    expect(idle).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(1);
  });

  it('drops a second move while one asks', async () => {
    let answer: (value: boolean) => void = () => undefined;
    unregister.push(registerLeaveGuard({ isBusy: () => true, leave: () => new Promise((resolve) => { answer = resolve; }) }));
    const first = confirmLeave();
    const second = confirmLeave();
    answer(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    // Once answered, the next move asks again.
    const third = confirmLeave();
    answer(true);
    await expect(third).resolves.toBe(true);
  });
});

describe('in-app links', () => {
  it('go at once while nothing is unsaved', () => {
    guard(false, false);
    renderShell();
    fireEvent.click(screen.getByText('left menu link'));
    expect(screen.getByTestId('where')).toHaveTextContent('/elsewhere');
  });

  it('wait for the page while it is busy: stay keeps the page, leave follows the link', async () => {
    const leave = vi.fn(async () => false);
    unregister.push(registerLeaveGuard({ isBusy: () => true, leave }));
    renderShell();
    fireEvent.click(screen.getByText('left menu link'));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('where')).toHaveTextContent('/ops/opex/OPX-1/overview');

    leave.mockResolvedValueOnce(true);
    await act(async () => { fireEvent.click(screen.getByText('left menu link')); });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/elsewhere'));
    expect(leave).toHaveBeenCalledTimes(2);
  });

  it('leave a new tab, another site or a modified click alone', () => {
    const leave = guard(true, false);
    renderShell();
    // jsdom cannot open these: their default action is stopped after the guard (bubbling) had its say.
    const stop = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('click', stop);
    try {
      for (const [element, init] of [
        [screen.getByText('new tab link'), {}],
        [screen.getByText('external link'), {}],
        [screen.getByText('left menu link'), { ctrlKey: true }],
      ] as const) {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
      }
    } finally {
      document.removeEventListener('click', stop);
    }
    expect(leave).not.toHaveBeenCalled();
  });

  it('a menu item that navigates asks the same way', async () => {
    const leave = vi.fn(async () => false);
    unregister.push(registerLeaveGuard({ isBusy: () => true, leave }));
    renderShell();
    await act(async () => { fireEvent.click(screen.getByText('my profile')); });
    expect(leave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/ops/opex/OPX-1/overview');
    leave.mockResolvedValueOnce(true);
    await act(async () => { fireEvent.click(screen.getByText('my profile')); });
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
  });
});
