import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('stays off when the configuration cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await readProbe(Promise.reject(new Error('offline')))).toBe('multi-tenant:false');
  });
});
