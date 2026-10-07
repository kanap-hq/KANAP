import { Features } from '../config/features';
import { isDevelopmentEnv } from '../common/env';

export type PlatformAdminCandidate = {
  email?: string | null;
  role?: { role_name?: string | null } | null;
};

function parseAllowlist(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? '';
  const parts = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
  return new Set(parts);
}

export function isPlatformAdmin(candidate: PlatformAdminCandidate | undefined | null): boolean {
  if (Features.SINGLE_TENANT) return false;
  if (!candidate?.email) return false;
  const allowlist = parseAllowlist();
  const email = candidate.email.toLowerCase();
  if (allowlist.size === 0) return false;
  // The `*` allowlist is a workstation convenience: development mode only.
  if (allowlist.has('*')) return isDevelopmentEnv();
  return allowlist.has(email);
}

