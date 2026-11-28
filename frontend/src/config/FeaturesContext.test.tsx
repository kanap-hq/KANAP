import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeaturesProvider, useFeatures } from './FeaturesContext';

function Probe() {
  const { config, isLoading } = useFeatures();
  return <div data-testid="probe">{isLoading ? 'loading' : `${config.deploymentMode}:${String(config.features.sampleData)}`}</div>;
}

async function readProbe(response: Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(() => response));
  render(<FeaturesProvider><Probe /></FeaturesProvider>);
  await waitFor(() => expect(screen.getByTestId('probe')).not.toHaveTextContent('loading'));
  return screen.getByTestId('probe').textContent;
}

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });

describe('FeaturesProvider: sample data flag', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is on when a cloud server announces it', async () => {
    expect(await readProbe(ok({ deploymentMode: 'multi-tenant', features: { sampleData: true }, version: '1' }))).toBe('multi-tenant:true');
  });

  it('stays off on-premise, where the server does not announce it', async () => {
    expect(await readProbe(ok({ deploymentMode: 'single-tenant', features: { sampleData: false }, version: '1' }))).toBe('single-tenant:false');
  });

  it('stays off when an older server says nothing about it', async () => {
    expect(await readProbe(ok({ deploymentMode: 'multi-tenant', features: {}, version: '1' }))).toBe('multi-tenant:false');
  });

});

describe('FeaturesProvider: a failed read', () => {
  const okResponse = (features: Record<string, boolean>) => ({
    ok: true,
    json: async () => ({ deploymentMode: 'multi-tenant', features, version: '1' }),
  });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function FlagProbe() {
    const { config, isLoading } = useFeatures();
    return <div data-testid="flag">{isLoading ? 'loading' : `loaded:${String(config.features.vulnerabilityFeed)}`}</div>;
  }

  it('keeps loading and retries with a growing delay until the server answers', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce(okResponse({ vulnerabilityFeed: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FeaturesProvider><FlagProbe /></FeaturesProvider>);

    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('flag')).toHaveTextContent('loading');

    await advance(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('flag')).toHaveTextContent('loading');

    await advance(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('flag')).toHaveTextContent('loaded:true');

    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caps the delay between two retries at 30 seconds', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    render(<FeaturesProvider><FlagProbe /></FeaturesProvider>);
    // Failures at 0, 1, 3, 7, 15, 31 s; then every 30 s: 61, 91 s.
    await advance(0);
    await advance(31_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await advance(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(screen.getByTestId('flag')).toHaveTextContent('loading');
  });

  it('abandons a read that does not answer within 5 seconds and retries it', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }))
      .mockResolvedValueOnce(okResponse({ vulnerabilityFeed: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FeaturesProvider><FlagProbe /></FeaturesProvider>);
    await advance(5000);
    expect(screen.getByTestId('flag')).toHaveTextContent('loading');
    await advance(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('flag')).toHaveTextContent('loaded:true');
  });

  it.each(['focus', 'online'])('retries at once when the window fires %s after a failure', async (event) => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(okResponse({ vulnerabilityFeed: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FeaturesProvider><FlagProbe /></FeaturesProvider>);
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(new Event(event)); });
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('flag')).toHaveTextContent('loaded:true');

    // Loaded: neither the event nor the pending timer reads it again.
    await act(async () => { window.dispatchEvent(new Event(event)); });
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('FeaturesProvider: the deployment mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function ModeProbe() {
    const { isLoading, isSingleTenant } = useFeatures();
    return <div data-testid="mode">{isLoading ? 'loading' : String(isSingleTenant)}</div>;
  }

  it.each([['single-tenant', 'true'], ['multi-tenant', 'false']])('reads isSingleTenant from a %s server', async (mode, expected) => {
    vi.stubGlobal('fetch', vi.fn(() => ok({ deploymentMode: mode, features: {}, version: '1' })));
    render(<FeaturesProvider><ModeProbe /></FeaturesProvider>);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent(expected));
  });

  it('is false outside the provider', () => {
    render(<ModeProbe />);
    expect(screen.getByTestId('mode')).toHaveTextContent('loading');
    function Outside() {
      return <div data-testid="outside">{String(useFeatures().isSingleTenant)}</div>;
    }
    render(<Outside />);
    expect(screen.getByTestId('outside')).toHaveTextContent('false');
  });
});

describe('FeaturesProvider: refresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const response = (deploymentMode: string, vulnerabilityFeed: boolean) => ({
    ok: true,
    json: async () => ({ deploymentMode, features: { vulnerabilityFeed }, version: '1' }),
  });

  type Api = ReturnType<typeof useFeatures>;
  function mount(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    const refreshes = new Set<Api['refresh']>();
    const api: { current: Api | null } = { current: null };
    function RefreshProbe() {
      const features = useFeatures();
      api.current = features;
      refreshes.add(features.refresh);
      const shown = features.isLoading ? 'loading' : `${features.config.deploymentMode}:${String(features.config.features.vulnerabilityFeed)}`;
      seen.push(shown);
      return <div data-testid="refresh">{shown}</div>;
    }
    render(<FeaturesProvider><RefreshProbe /></FeaturesProvider>);
    return { seen, refreshes, api };
  }

  it('replaces the configuration with a new read, without loading again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('multi-tenant', false))
      .mockResolvedValueOnce(response('single-tenant', true));
    const { seen, api, refreshes } = mount(fetchMock);
    await waitFor(() => expect(screen.getByTestId('refresh')).toHaveTextContent('multi-tenant:false'));
    const loadedAt = seen.length;

    let result: boolean | undefined;
    await act(async () => { result = await api.current!.refresh(); });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('refresh')).toHaveTextContent('single-tenant:true');
    expect(api.current!.isSingleTenant).toBe(true);
    expect(seen.slice(loadedAt)).not.toContain('loading');
    // One function for the life of the provider: an effect that depends on it does not loop.
    expect(refreshes.size).toBe(1);
  });

  it('keeps the configuration it had when the read fails, and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('multi-tenant', true))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, status: 502 });
    const { api } = mount(fetchMock);
    await waitFor(() => expect(screen.getByTestId('refresh')).toHaveTextContent('multi-tenant:true'));

    let first: boolean | undefined;
    let second: boolean | undefined;
    await act(async () => { first = await api.current!.refresh(); });
    await act(async () => { second = await api.current!.refresh(); });

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(screen.getByTestId('refresh')).toHaveTextContent('multi-tenant:true');
    expect(api.current!.isLoading).toBe(false);
  });

  it('ends the retries of a first load that has not answered yet', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(response('single-tenant', true))
        .mockResolvedValue(response('multi-tenant', false));
      const { api } = mount(fetchMock);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByTestId('refresh')).toHaveTextContent('loading');

      let result: boolean | undefined;
      await act(async () => { result = await api.current!.refresh(); });
      expect(result).toBe(true);
      expect(screen.getByTestId('refresh')).toHaveTextContent('single-tenant:true');

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('refresh')).toHaveTextContent('single-tenant:true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes one read for two calls at the same time', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('multi-tenant', false))
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const { api } = mount(fetchMock);
    await waitFor(() => expect(screen.getByTestId('refresh')).toHaveTextContent('multi-tenant:false'));

    let results: boolean[] = [];
    await act(async () => {
      const both = Promise.all([api.current!.refresh(), api.current!.refresh()]);
      answer(response('multi-tenant', true));
      results = await both;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toEqual([true, true]);
    expect(screen.getByTestId('refresh')).toHaveTextContent('multi-tenant:true');
  });
});

describe('FeaturesProvider: an effect torn down before its read answers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never reports the defaults as loaded (development double run)', async () => {
    // The first read is aborted by the cleanup; the second answers later with the flag on.
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return new Promise((resolve) => setTimeout(() => resolve({
        ok: true,
        json: async () => ({ deploymentMode: 'multi-tenant', features: { vulnerabilityFeed: true }, version: '1' }),
      }), 20));
    }));
    const seen: string[] = [];
    function FlagProbe() {
      const { config, isLoading } = useFeatures();
      const state = isLoading ? 'loading' : `loaded:${String(config.features.vulnerabilityFeed)}`;
      seen.push(state);
      return <div data-testid="flag">{state}</div>;
    }
    render(<React.StrictMode><FeaturesProvider><FlagProbe /></FeaturesProvider></React.StrictMode>);
    await waitFor(() => expect(screen.getByTestId('flag')).toHaveTextContent('loaded:true'));
    expect(seen).not.toContain('loaded:false');
  });
});
