import type { AiCapabilities } from './useAiCapabilities';

/**
 * The KANAP included model as a workspace sees it (`builtin_provider` of the AI settings).
 * in_use: the assistant, or agents without a model of their own, would run on it;
 * used_by_assistant: the assistant would.
 */
export type AiBuiltinProvider = {
  in_use: boolean;
  used_by_assistant: boolean;
  name: string | null;
  location: string | null;
  key: string | null;
  accepted: boolean;
  accepted_at: string | null;
  accepted_by_name: string | null;
};

/** Provider name, processing location and the key an administrator confirms. */
export type IncludedModelIdentity = {
  name: string;
  location: string;
  key: string;
};

/** Processing locations the platform console offers: a region code, or EU. */
export const INCLUDED_MODEL_LOCATIONS = ['EU', 'US', 'GB', 'CH', 'CA', 'JP', 'AU', 'SG', 'IN', 'CN'] as const;

export const BUILTIN_PROVIDER_CHANGED = 'BUILTIN_PROVIDER_CHANGED';
export const BUILTIN_PROVIDER_CONFIRMATION_REQUIRED = 'BUILTIN_PROVIDER_CONFIRMATION_REQUIRED';

export function identityOf(provider: AiBuiltinProvider | null | undefined): IncludedModelIdentity | null {
  if (!provider?.name || !provider.location || !provider.key) return null;
  return { name: provider.name, location: provider.location, key: provider.key };
}

/**
 * The confirmation answer of a settings save: its code and the included model's
 * current identity, or null for any other error.
 */
export function includedModelError(error: unknown): { code: string; identity: IncludedModelIdentity | null } | null {
  const data = (error as { response?: { data?: { code?: unknown; builtin_provider?: unknown } } } | null)?.response?.data;
  const code = typeof data?.code === 'string' ? data.code : null;
  if (code !== BUILTIN_PROVIDER_CHANGED && code !== BUILTIN_PROVIDER_CONFIRMATION_REQUIRED) return null;
  const body = data?.builtin_provider as Partial<IncludedModelIdentity> | null | undefined;
  const identity = body?.name && body.location && body.key
    ? { name: body.name, location: body.location, key: body.key }
    : null;
  return { code, identity };
}

/** The assistant is held back only by the included model waiting for an administrator's confirmation. */
export function chatAwaitsIncludedModelConfirmation(capabilities: AiCapabilities | null | undefined): boolean {
  const reasons = capabilities?.surfaces.chat.reasons ?? [];
  return reasons.length > 0 && reasons.every((reason) => reason === 'builtin_not_accepted');
}
