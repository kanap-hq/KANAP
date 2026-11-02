import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DevBuildIndicator, { type DevBuild } from './DevBuildIndicator';
import { formatShortDate } from '../lib/dateFormat';

vi.mock('react-i18next', async () => {
  const { default: nav } = await import('../locales/en/nav.json');
  const texts = nav.devBuild as Record<string, string>;
  // One stable `t`, English strings with the plural suffix i18next picks for English.
  const t = (key: string, options: Record<string, string | number> = {}) => {
    const name = key.replace('devBuild.', '');
    const text = options.count !== undefined ? texts[`${name}_${options.count === 1 ? 'one' : 'other'}`] : texts[name];
    return text.replace(/\{\{(\w+)\}\}/g, (_, variable: string) => String(options[variable]));
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const build = (branches: DevBuild['branches'] = []): DevBuild => ({
  schema: 1,
  built_at: '2026-11-02T12:09:56+01:00',
  main: { date: '2026-11-02T09:41:24Z', pr: 1257 },
  branches,
});

const branch = (name: string, state: string, pr: DevBuild['branches'][number]['pr'] = null) => ({
  name,
  label: `Label of ${name}`,
  state,
  pr,
});

function serve(response: Response | Error) {
  const fetchMock = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const MAIN_DATE = new Date('2026-11-02T09:41:24Z');
const mainOf = `main of ${formatShortDate(MAIN_DATE, 'en')}, ${new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(MAIN_DATE)}`;

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('DevBuildIndicator', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('shows main and the merged branches when the dev server has the file', async () => {
    const fetchMock = serve(json(build([
      branch('feat/a', 'in', { number: 1260, state: 'open' }),
      branch('feat/b', 'in'),
      branch('feat/c', 'conflit', { number: 1262, state: 'open' }),
      branch('feat/d', 'retiree', { number: 1250, state: 'merged' }),
    ])));
    render(<DevBuildIndicator />);

    // The branch left out for a conflict and the one retired from the list do not count.
    expect(await screen.findByText(`dev · ${mainOf} (#1257) + 2 branches`)).toBeTruthy();
    expect(screen.getByText('dev + 2')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/dev-build.json', { cache: 'no-store' });

    fireEvent.mouseOver(screen.getByTestId('dev-build-indicator'));
    expect(await screen.findByText('Label of feat/a')).toBeTruthy();
    expect(screen.getByText('PR #1260 open')).toBeTruthy();
    expect(screen.getByText('Label of feat/b')).toBeTruthy();
    expect(screen.getByText('In conflict, left out of dev · PR #1262 open')).toBeTruthy();
    expect(screen.queryByText('Label of feat/d')).toBeNull();
  });

  it('says main alone when no branch is merged on top', async () => {
    serve(json(build()));
    render(<DevBuildIndicator />);

    expect(await screen.findByText(`dev · ${mainOf} (#1257)`)).toBeTruthy();
    expect(screen.getByText('dev')).toBeTruthy();
  });

  it('renders nothing when the dev server answers with the app page instead of the file', async () => {
    const fetchMock = serve(new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }));
    const { container } = render(<DevBuildIndicator />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the request fails or the file has another schema', async () => {
    serve(new TypeError('Failed to fetch'));
    const first = render(<DevBuildIndicator />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(first.container.innerHTML).toBe('');
    first.unmount();

    serve(json({ ...build(), schema: 2 }));
    const second = render(<DevBuildIndicator />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(second.container.innerHTML).toBe('');
  });

  it('asks for nothing outside the dev server', () => {
    vi.stubEnv('DEV', false);
    const fetchMock = serve(json(build()));
    const { container } = render(<DevBuildIndicator />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
});
