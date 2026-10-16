import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../api';

const DEFAULT_MARKETING_URL = 'https://www.kanap.net';
const DEFAULT_API_BASE = '/api';
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeApiBase(value: string): string {
  if (!value) return DEFAULT_API_BASE;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return trimTrailingSlash(value);
  }
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return trimTrailingSlash(withLeadingSlash) || DEFAULT_API_BASE;
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!HEX_COLOR_RE.test(text)) return null;
  return text.toUpperCase();
}

function normalizeLogoVersion(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export type TenantContextValue = {
  isPlatformHost: boolean;
  tenantSlug: string | null;
  tenantName: string | null;
  logoUrl: string | null;
  useLogoInDark: boolean;
  primaryColorLight: string | null;
  primaryColorDark: string | null;
  refreshTenantInfo: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

type State =
  | { status: 'loading' }
  | { status: 'platform' }
  | {
    status: 'ready';
    slug: string | null;
    name: string | null;
    logoPath: string | null;
    logoVersion: number;
    useLogoInDark: boolean;
    primaryColorLight: string | null;
    primaryColorDark: string | null;
  }
  | { status: 'missing'; marketingUrl: string };

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common');
  const [state, setState] = useState<State>({ status: 'loading' });
  const marketingUrl = (import.meta.env.VITE_MARKETING_URL as string | undefined)?.replace(/\/$/, '')
    || DEFAULT_MARKETING_URL;
  const apiBase = normalizeApiBase(((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API_BASE).trim());

  const loadTenantInfo = React.useCallback(async (): Promise<State> => {
    try {
      const res = await api.get('/public/tenant-info');
      const data = res.data ?? {};
      if (data.platform) {
        return { status: 'platform' };
      }
      if (data.marketing) {
        return { status: 'missing', marketingUrl };
      }
      return {
        status: 'ready',
        slug: data.slug ?? null,
        name: data.name ?? null,
        logoPath: typeof data.logoPath === 'string' ? data.logoPath : null,
        logoVersion: normalizeLogoVersion(data.logoVersion),
        useLogoInDark: data.useLogoInDark !== false,
        primaryColorLight: normalizeHex(data.primaryColorLight),
        primaryColorDark: normalizeHex(data.primaryColorDark),
      };
    } catch (error: any) {
      const marketing = error?.response?.data?.marketingUrl || marketingUrl;
      if (error?.response?.status === 404 && error?.response?.data?.error === 'TENANT_NOT_FOUND') {
        return { status: 'missing', marketingUrl: marketing };
      }
      // Unknown failure: allow app to continue without tenant metadata
      return {
        status: 'ready',
        slug: null,
        name: null,
        logoPath: null,
        logoVersion: 0,
        useLogoInDark: true,
        primaryColorLight: null,
        primaryColorDark: null,
      };
    }
  }, [marketingUrl]);

  const refreshTenantInfo = React.useCallback(async () => {
    const nextState = await loadTenantInfo();
    setState(nextState);
  }, [loadTenantInfo]);

  const value = useMemo<TenantContextValue>(() => {
    if (state.status === 'platform') {
      return {
        isPlatformHost: true,
        tenantSlug: null,
        tenantName: null,
        logoUrl: null,
        useLogoInDark: true,
        primaryColorLight: null,
        primaryColorDark: null,
        refreshTenantInfo,
      };
    }
    if (state.status === 'ready') {
      const logoUrl = state.logoPath
        ? `${apiBase}${state.logoPath}${state.logoPath.includes('?') ? '&' : '?'}v=${state.logoVersion}`
        : null;
      return {
        isPlatformHost: false,
        tenantSlug: state.slug,
        tenantName: state.name,
        logoUrl,
        useLogoInDark: state.useLogoInDark,
        primaryColorLight: state.primaryColorLight,
        primaryColorDark: state.primaryColorDark,
        refreshTenantInfo,
      };
    }
    return {
      isPlatformHost: false,
      tenantSlug: null,
      tenantName: null,
      logoUrl: null,
      useLogoInDark: true,
      primaryColorLight: null,
      primaryColorDark: null,
      refreshTenantInfo,
    };
  }, [apiBase, refreshTenantInfo, state]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextState = await loadTenantInfo();
      if (!cancelled) {
        setState(nextState);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTenantInfo]);

  useEffect(() => {
    if (state.status === 'missing') {
      const timeout = setTimeout(() => {
        window.location.href = state.marketingUrl;
      }, 3000);
      return () => clearTimeout(timeout);
    }
    return () => {};
  }, [state]);

  if (state.status === 'loading') {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (state.status === 'missing') {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" px={2}>
        <Paper elevation={3} sx={{ p: 4, maxWidth: 420, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            {t('tenant.notFound.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('tenant.notFound.message')}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            {t('tenant.notFound.redirecting', { url: state.marketingUrl })}
          </Typography>
        </Paper>
      </Box>
    );
  }

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used within TenantProvider');
  return ctx;
}
