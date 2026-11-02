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
