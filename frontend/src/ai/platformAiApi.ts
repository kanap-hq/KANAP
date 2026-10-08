import api from '../api';
import { ProviderDescriptor, AiProviderTestResult } from './aiApi';

export type PlatformAiConfig = {
  id: string;
  provider: string;
  model: string;
  endpoint_url: string | null;
  rate_limit_tenant_per_minute: number;
  rate_limit_user_per_hour: number;
  updated_at: string;
  updated_by: string | null;
  has_api_key: boolean;
  disclosure_name: string | null;
  disclosure_location: string | null;
  disclosure_key: string | null;
};

export type PlatformAiUsageRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  used: number;
  limit: number;
  usage_ratio: number | null;
  year_month: string;
};

export type PlatformAiConfigPayload = {
  config: PlatformAiConfig | null;
  available_providers: ProviderDescriptor[];
  free_monthly_message_limit: number;
  usage: PlatformAiUsageRow[];
};

export const platformAiApi = {
  async getConfig(): Promise<PlatformAiConfigPayload> {
    const res = await api.get('/admin/ai/config');
    return res.data;
  },
  async updateConfig(payload: Record<string, unknown>): Promise<{ config: PlatformAiConfig }> {
    const res = await api.patch('/admin/ai/config', payload);
    return res.data;
  },
  async testConfig(payload: Record<string, unknown>): Promise<AiProviderTestResult> {
    const res = await api.post('/admin/ai/config/test', payload);
    return res.data;
  },
  async updateFreeMessageLimit(monthlyMessageLimit: number): Promise<{ free_monthly_message_limit: number }> {
    const res = await api.put('/admin/ai/free-message-limit', { monthly_message_limit: monthlyMessageLimit });
    return res.data;
  },
  async getUsage(): Promise<{ items: PlatformAiUsageRow[] }> {
    const res = await api.get('/admin/ai/usage');
    return res.data;
  },
};
