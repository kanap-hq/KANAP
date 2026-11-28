import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `/admin` opens the first page of the Administration menu the person may open, in menu order.

type Level = 'reader' | 'member' | 'admin';
const state = vi.hoisted(() => ({
  isGlobalAdmin: false,
  isPlatformAdmin: false,
  grants: {} as Record<string, 'reader' | 'member' | 'admin'>,
  isPlatformHost: false,
  singleTenant: false,
  aiSettings: false,
  aiData: undefined as unknown,
}));

vi.mock('./auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    claims: { isGlobalAdmin: state.isGlobalAdmin, isPlatformAdmin: state.isPlatformAdmin },
    hasLevel: (resource: string, level: Level) => {
      if (state.isGlobalAdmin || state.isPlatformAdmin) return true;
      const rank = { reader: 1, member: 3, admin: 4 } as Record<string, number>;
      const granted = state.grants[resource];
      return !!granted && rank[granted] >= rank[level];
    },
    dataAccess: null,
  }),
}));
vi.mock('./tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: state.isPlatformHost }) }));
vi.mock('./config/FeaturesContext', () => ({
  FeaturesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFeatures: () => ({
    config: {
      deploymentMode: state.singleTenant ? 'single-tenant' : 'multi-tenant',
      features: { billing: !state.singleTenant, sso: true, aiChat: false, aiSettings: state.aiSettings, sampleData: false },
    },
    isSingleTenant: state.singleTenant,
    isLoading: false,
  }),
}));
vi.mock('./ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: state.aiData }),
}));

import { AdminDefaultRedirect } from './App';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function landing(group?: 'installation'): string | null {
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminDefaultRedirect group={group} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('where').textContent;
}

const aiAvailable = { surfaces: { settings: { available: true } } };

afterEach(() => {
  Object.assign(state, {
    isGlobalAdmin: false, isPlatformAdmin: false, grants: {}, isPlatformHost: false, singleTenant: false, aiSettings: false, aiData: undefined,
  });
});

describe('AdminDefaultRedirect', () => {
  it('opens Users to an Administrator, on site and in the cloud', () => {
    state.isGlobalAdmin = true;
    expect(landing()).toBe('/admin/users');
  });

  it('opens Users to an Administrator on site', () => {
    state.isGlobalAdmin = true;
    state.singleTenant = true;
    expect(landing()).toBe('/admin/users');
  });

  it('opens Users to a person who administers users', () => {
    state.grants = { users: 'admin' };
    expect(landing()).toBe('/admin/users');
  });

  it('opens Integrations to an infrastructure administrator alone', () => {
    state.grants = { infrastructure: 'admin' };
    expect(landing()).toBe('/admin/integrations');
  });

  it('opens Billing to a billing reader alone', () => {
    state.grants = { billing: 'reader' };
    expect(landing()).toBe('/admin/billing');
  });

  it('opens the first AI page, in menu order, to an AI settings administrator', () => {
    state.grants = { ai_settings: 'admin' };
    state.aiSettings = true;
    state.aiData = aiAvailable;
    expect(landing()).toBe('/admin/ai-models');
  });

  it('opens Billing before the AI pages to a person who has both', () => {
    state.grants = { ai_settings: 'admin', billing: 'reader' };
    state.aiSettings = true;
    state.aiData = aiAvailable;
    expect(landing()).toBe('/admin/billing');
  });

  it('opens Tenants on the platform host', () => {
    state.isPlatformHost = true;
    state.isPlatformAdmin = true;
    expect(landing()).toBe('/admin/tenants');
  });

  it('refuses a person who may open no page of the menu', () => {
    state.grants = { applications: 'reader' };
    expect(landing()).toBe('/403');
  });

  it('refuses a billing reader on site, where billing is off', () => {
    state.singleTenant = true;
    state.grants = { billing: 'reader' };
    expect(landing()).toBe('/403');
  });

  it('opens the first page of the Installation section for the section address', () => {
    state.singleTenant = true;
    state.isGlobalAdmin = true;
    expect(landing('installation')).toBe('/admin/installation/scheduled-tasks');
  });
});
