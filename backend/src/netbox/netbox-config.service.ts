import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AiSecretCipherService } from '../ai/ai-secret-cipher.service';
import { AiAdapterConfig } from '../ai/control-plane/providers/adapter-config.entity';
import { parseCredentialRef } from '../ai/control-plane/providers/adapter-config.service';
import { ProviderCredentialRef } from '../ai/control-plane/providers/provider.types';
import { ENVIRONMENTS } from '../assets/services/assets-base.service';
import { assertPublicHttpUrl } from '../common/ssrf-guard';
import {
  NETBOX_MAX_TIMEOUT_SECONDS,
  NETBOX_MIN_TIMEOUT_SECONDS,
  clampNetboxTimeoutSeconds,
  normalizeNetboxBaseUrl,
} from './netbox.client';
import { NETBOX_LEGACY_VM_ROLE_SLUG, NETBOX_VIRTUAL_MACHINES_SLUG } from './netbox-mapper';
import { NetboxNotice, netboxNoticeFromStore } from './netbox-notice';
import { NetboxSyncCounts } from './netbox-planner';
import { NetboxConnection } from './netbox.types';

// The Netbox connection lives in ai_adapter_configs, the table that already
// stores every external-system connection (GLPI ticketing, PRTG monitoring)
// with an encrypted, write-only credential. It is a new provider_kind,
// 'inventory', so nothing that lists monitoring or ticketing adapters sees it.
//
// The API token is stored as an AES-256-GCM 'encrypted' credential ref and is
// never read back: reads expose presence only.

export const NETBOX_PROVIDER_KIND = 'inventory';
export const NETBOX_PROVIDER_KEY = 'netbox';
export const NETBOX_IMPLEMENTATION = 'netbox';
// Lives in netbox.types.ts so the pure planner can read it without pulling the
// Nest/TypeORM layers in; re-exported here for the callers that already use it.
export { NETBOX_LINK_SOURCE } from './netbox.types';

// Same values the PRTG adapter writes for the two other NOT NULL columns.
const NETBOX_ADAPTER_ENVIRONMENT = 'production';
const NETBOX_LIVE_TEST_SAFETY = 'mock_only';

const BASE_URL_MESSAGE = 'The Netbox address must be a full web address starting with http:// or https:// '
  + '(for example https://netbox.example.com). Copy it from the browser address bar when you are logged into Netbox.';
const TIMEOUT_MESSAGE = 'The request timeout must be a whole number of seconds between '
  + `${NETBOX_MIN_TIMEOUT_SECONDS} and ${NETBOX_MAX_TIMEOUT_SECONDS}, or empty to use the default.`;
const TOKEN_MISSING_MESSAGE = 'No Netbox API token is saved yet. Add one in Netbox under your profile, API tokens, then paste it here.';

export type NetboxSyncStateView = {
  status: 'never' | 'running' | 'success' | 'failure';
  trigger: 'manual' | 'scheduled' | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  counts: NetboxSyncCounts | null;
  error: string | null;
  /** Things worth saying about a run that still succeeded. */
  warnings: NetboxNotice[];
};

export type NetboxIntegrationView = {
  configured: boolean;
  enabled: boolean;
  base_url: string | null;
  credential: { present: boolean };
  request_timeout_seconds: number | null;
  insecure_tls: boolean;
  auto_sync: boolean;
  /** A synchronisation was applied by hand at least once; the hourly run waits for it. */
  manual_sync_done: boolean;
  /** Objects a manual run left for a later batch; automatic runs hold while it is not zero. */
  review_pending: number;
  default_environment: string;
  secret_writable: boolean;
  updated_at: string | null;
};

export type NetboxIntegrationSaveInput = {
  enabled?: unknown;
  base_url?: unknown;
  api_token?: unknown;
  request_timeout_seconds?: unknown;
  insecure_tls?: unknown;
  auto_sync?: unknown;
  default_environment?: unknown;
};

export type NetboxTestInput = {
  base_url?: unknown;
  api_token?: unknown;
  insecure_tls?: unknown;
  request_timeout_seconds?: unknown;
};

export type NetboxMappingView = {
  role_map: Record<string, string>;
  site_map: Record<string, string>;
  /** Netbox platform slug -> KANAP operating system code. Not an import filter. */
  os_map: Record<string, string>;
};

const NEVER_RAN: NetboxSyncStateView = {
  status: 'never',
  trigger: null,
  started_at: null,
  finished_at: null,
  duration_ms: null,
  counts: null,
  error: null,
  warnings: [],
};

// A run that claims to still be going after an hour is a crashed run.
const STALE_RUNNING_MS = 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const cleanKey = textOrNull(key);
    const cleanValue = textOrNull(entry);
    if (cleanKey && cleanValue) result[cleanKey] = cleanValue;
  }
  return result;
}

/** Longest Netbox address accepted, in characters. */
export const NETBOX_ADDRESS_MAX_LENGTH = 2048;

export function normalizeNetboxAddress(raw: string): string {
  if (String(raw || '').trim().length > NETBOX_ADDRESS_MAX_LENGTH) {
    throw new BadRequestException(`The Netbox address must be at most ${NETBOX_ADDRESS_MAX_LENGTH} characters long.`);
  }
  const trimmed = normalizeNetboxBaseUrl(raw);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException(BASE_URL_MESSAGE);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException(BASE_URL_MESSAGE);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new BadRequestException('The Netbox address must not contain a query string, a fragment, or a user name and password.');
  }
  return trimmed;
}

/** Reads a stored sync state, downgrading a run that has been stuck for an hour. */
export function readSyncState(metadata: Record<string, unknown> | null, nowMs = Date.now()): NetboxSyncStateView {
  const raw = asRecord(metadata?.sync_state);
  if (!raw) return NEVER_RAN;
  const state: NetboxSyncStateView = {
    status: ['never', 'running', 'success', 'failure'].includes(String(raw.status))
      ? raw.status as NetboxSyncStateView['status']
      : 'never',
    trigger: raw.trigger === 'manual' || raw.trigger === 'scheduled' ? raw.trigger : null,
    started_at: textOrNull(raw.started_at),
    finished_at: textOrNull(raw.finished_at),
    duration_ms: typeof raw.duration_ms === 'number' ? raw.duration_ms : null,
    counts: asRecord(raw.counts) as NetboxSyncCounts | null,
    error: textOrNull(raw.error),
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : [])
      .map((entry) => netboxNoticeFromStore(asRecord(entry)?.code, asRecord(entry)?.params))
      .filter((notice): notice is NetboxNotice => notice != null),
  };
  if (state.status === 'running') {
    const startedMs = state.started_at ? Date.parse(state.started_at) : NaN;
    if (!Number.isFinite(startedMs) || nowMs - startedMs > STALE_RUNNING_MS) {
      return {
        ...state,
        status: 'failure',
        error: 'The previous synchronisation stopped without finishing. Start a new one.',
      };
    }
  }
  return state;
}

@Injectable()
export class NetboxConfigService {
  constructor(private readonly cipher: AiSecretCipherService) {}

  private repo(manager: EntityManager) {
    return manager.getRepository(AiAdapterConfig);
  }

  async getConfig(manager: EntityManager, tenantId: string): Promise<AiAdapterConfig | null> {
    return this.repo(manager).findOne({
      where: {
        tenant_id: tenantId,
        provider_kind: NETBOX_PROVIDER_KIND,
        provider_key: NETBOX_PROVIDER_KEY,
      },
    });
  }

  toView(config: AiAdapterConfig | null): NetboxIntegrationView {
    const metadata = asRecord(config?.metadata_json);
    const credential = parseCredentialRef(config?.credential_ref_json);
    const present = !!credential && credential.kind !== 'none';
    const baseUrl = textOrNull(config?.base_url);
    return {
      configured: !!config && !!baseUrl && present,
      enabled: config?.enabled === true,
      base_url: baseUrl,
      credential: { present },
      request_timeout_seconds: config?.timeout_seconds ?? null,
      insecure_tls: metadata?.insecure_tls === true,
      auto_sync: metadata?.auto_sync === true,
      manual_sync_done: typeof metadata?.first_manual_sync_at === 'string'
        && !(Number(metadata?.review_pending) > 0),
      review_pending: Math.max(0, Math.floor(Number(metadata?.review_pending)) || 0),
      default_environment: textOrNull(metadata?.default_environment) ?? 'prod',
      secret_writable: this.cipher.canEncrypt(),
      updated_at: config?.updated_at instanceof Date
        ? config.updated_at.toISOString()
        : textOrNull(config?.updated_at),
    };
  }

  getMapping(config: AiAdapterConfig | null): NetboxMappingView {
    const metadata = asRecord(config?.metadata_json);
    const roleMap = stringMap(metadata?.role_map);
    // An earlier build keyed virtual machines differently; read it as the
    // current key so a saved mapping keeps working without a data migration.
    if (roleMap[NETBOX_LEGACY_VM_ROLE_SLUG] && !roleMap[NETBOX_VIRTUAL_MACHINES_SLUG]) {
      roleMap[NETBOX_VIRTUAL_MACHINES_SLUG] = roleMap[NETBOX_LEGACY_VM_ROLE_SLUG];
    }
    return {
      role_map: roleMap,
      site_map: stringMap(metadata?.site_map),
      os_map: stringMap(metadata?.os_map),
    };
  }

  /** Partial save: a key that is not sent keeps its stored value. */
  async save(
    manager: EntityManager,
    tenantId: string,
    input: NetboxIntegrationSaveInput,
  ): Promise<NetboxIntegrationView> {
    const existing = await this.getConfig(manager, tenantId);
    const metadata: Record<string, unknown> = { ...(asRecord(existing?.metadata_json) ?? {}) };

    let baseUrl = textOrNull(existing?.base_url);
    if (input.base_url !== undefined) {
      const raw = textOrNull(input.base_url);
      if (!raw) throw new BadRequestException(BASE_URL_MESSAGE);
      baseUrl = normalizeNetboxAddress(raw);
      assertPublicHttpUrl(baseUrl); // SSRF: blocks internal targets in cloud, no-op on-prem
    }
    if (!baseUrl) throw new BadRequestException(BASE_URL_MESSAGE);

    let timeoutSeconds = existing?.timeout_seconds ?? null;
    if (input.request_timeout_seconds !== undefined) {
      const raw = input.request_timeout_seconds;
      if (raw === null || (typeof raw === 'string' && !raw.trim())) {
        timeoutSeconds = null;
      } else {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < NETBOX_MIN_TIMEOUT_SECONDS || parsed > NETBOX_MAX_TIMEOUT_SECONDS) {
          throw new BadRequestException(TIMEOUT_MESSAGE);
        }
        timeoutSeconds = parsed;
      }
    }

    if (input.insecure_tls !== undefined) {
      metadata.insecure_tls = input.insecure_tls === true;
    }
    if (input.auto_sync !== undefined) {
      metadata.auto_sync = input.auto_sync === true;
    }
    if (input.default_environment !== undefined) {
      const value = String(textOrNull(input.default_environment) ?? '').toLowerCase();
      if (!ENVIRONMENTS.includes(value as (typeof ENVIRONMENTS)[number])) {
        throw new BadRequestException(`"${input.default_environment}" is not one of the environments KANAP knows.`);
      }
      metadata.default_environment = value;
    }

    // Write-only credential: an omitted or empty token keeps the stored one.
    let credentialRef = existing?.credential_ref_json ?? null;
    const token = textOrNull(input.api_token);
    if (token) {
      credentialRef = this.encryptedCredentialRef(token);
    }

    const enabled = booleanOr(input.enabled, existing?.enabled ?? false);
    if (enabled && !credentialRef) {
      throw new BadRequestException(TOKEN_MISSING_MESSAGE);
    }

    const repo = this.repo(manager);
    const entity = repo.create({
      ...(existing ?? {}),
      tenant_id: tenantId,
      provider_kind: NETBOX_PROVIDER_KIND,
      provider_key: NETBOX_PROVIDER_KEY,
      implementation: NETBOX_IMPLEMENTATION,
      environment: existing?.environment ?? NETBOX_ADAPTER_ENVIRONMENT,
      live_test_safety: existing?.live_test_safety ?? NETBOX_LIVE_TEST_SAFETY,
      enabled,
      base_url: baseUrl,
      credential_ref_json: credentialRef,
      metadata_json: metadata,
      timeout_seconds: timeoutSeconds,
      updated_at: new Date(),
      created_at: existing?.created_at ?? new Date(),
    });
    return this.toView(await repo.save(entity));
  }

  /** Full replacement of the mapping tables the body carries. */
  async saveMapping(
    manager: EntityManager,
    tenantId: string,
    input: { role_map?: unknown; site_map?: unknown; os_map?: unknown },
  ): Promise<NetboxMappingView> {
    const existing = await this.getConfig(manager, tenantId);
    if (!existing) {
      throw new BadRequestException('Set up the Netbox connection first, then save the matches.');
    }
    // A full replacement of both tables. Accepting one of them and silently
    // clearing the other is how a whole site mapping disappears.
    if (asRecord(input.role_map) == null || asRecord(input.site_map) == null) {
      throw new BadRequestException('Send both the role matches and the site matches together when saving.');
    }
    const metadata: Record<string, unknown> = { ...(asRecord(existing.metadata_json) ?? {}) };
    metadata.role_map = stringMap(input.role_map);
    metadata.site_map = stringMap(input.site_map);
    // The operating system matches came later: a page that does not know about
    // them sends nothing, and that must keep the saved ones rather than clear
    // them. Sent, they are replaced in full like the other two.
    if (input.os_map !== undefined) {
      if (asRecord(input.os_map) == null) {
        throw new BadRequestException('Send the operating system matches as a list of matches, or leave them out to keep the saved ones.');
      }
      metadata.os_map = stringMap(input.os_map);
    }
    existing.metadata_json = metadata;
    existing.updated_at = new Date();
    await this.repo(manager).save(existing);
    return this.getMapping(existing);
  }

  /**
   * Builds the connection the client needs. `overrides` carries the values an
   * administrator typed in the test dialog but has not saved yet.
   */
  buildConnection(
    config: AiAdapterConfig | null,
    overrides?: { baseUrl?: string | null; token?: string | null; insecureTls?: boolean; timeoutSeconds?: number | null },
  ): NetboxConnection {
    const metadata = asRecord(config?.metadata_json);
    const baseUrl = overrides?.baseUrl ?? textOrNull(config?.base_url);
    if (!baseUrl) {
      throw new BadRequestException('Add the Netbox address first, then try again.');
    }
    const token = overrides?.token ?? this.revealToken(config);
    const timeoutSeconds = overrides?.timeoutSeconds ?? config?.timeout_seconds ?? null;
    return {
      baseUrl: normalizeNetboxAddress(baseUrl),
      token,
      insecureTls: overrides?.insecureTls ?? metadata?.insecure_tls === true,
      requestTimeoutMs: typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds)
        ? clampNetboxTimeoutSeconds(timeoutSeconds) * 1000
        : null,
    };
  }

  /**
   * Decrypts the stored token. Only the 'encrypted' credential shape the save
   * path writes is supported; operator-managed indirections are not offered
   * for this integration.
   */
  private revealToken(config: AiAdapterConfig | null): string {
    const credential = parseCredentialRef(config?.credential_ref_json);
    if (!credential || credential.kind === 'none') {
      throw new BadRequestException(TOKEN_MISSING_MESSAGE);
    }
    if (credential.kind !== 'encrypted') {
      throw new BadRequestException('The saved Netbox token cannot be read on this server. Enter the token again and save.');
    }
    try {
      return this.cipher.decrypt(credential.ciphertext);
    } catch {
      throw new BadRequestException('The saved Netbox token cannot be read on this server. Enter the token again and save.');
    }
  }

  readSyncState(config: AiAdapterConfig | null, nowMs = Date.now()): NetboxSyncStateView {
    return readSyncState(asRecord(config?.metadata_json), nowMs);
  }

  /** Persists the run state; the page polls GET /netbox/status for it. */
  async writeSyncState(
    manager: EntityManager,
    tenantId: string,
    state: NetboxSyncStateView,
  ): Promise<void> {
    const config = await this.getConfig(manager, tenantId);
    if (!config) return;
    const metadata: Record<string, unknown> = { ...(asRecord(config.metadata_json) ?? {}) };
    metadata.sync_state = state;
    // The hourly run waits for this: a first import is read and applied by a
    // person before anything is allowed to apply changes on its own. A manual
    // run that left objects for a later batch has not finished that review:
    // the hourly run would import them with nobody having read them. So the
    // number still waiting is kept, the hourly run holds while it is not zero,
    // and the first-import mark is only set by a run that left nothing behind.
    if (state.status === 'success' && state.trigger === 'manual') {
      const deferred = Number(state.counts?.deferred) || 0;
      metadata.review_pending = deferred;
      if (deferred === 0 && !metadata.first_manual_sync_at) {
        metadata.first_manual_sync_at = state.finished_at ?? new Date().toISOString();
      }
    }
    config.metadata_json = metadata;
    config.updated_at = new Date();
    await this.repo(manager).save(config);
  }

  private encryptedCredentialRef(material: string): Record<string, unknown> {
    // AiSecretCipherService.encrypt throws a plain-language BadRequest when
    // AI_SETTINGS_ENCRYPTION_SECRET is not configured — let it propagate.
    const ref: ProviderCredentialRef = {
      kind: 'encrypted',
      ciphertext: this.cipher.encrypt(material),
      material_shape: 'api_token',
    };
    return ref as unknown as Record<string, unknown>;
  }
}
