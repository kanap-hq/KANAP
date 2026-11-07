import { BadRequestException, Injectable } from '@nestjs/common';
import { assertPublicHttpUrl } from '../../../common/ssrf-guard';
import { AiSecretCipherService } from '../../ai-secret-cipher.service';
import { AiExecutionContextWithManager } from '../../ai.types';
import { PrtgService, sanitizePrtgText } from '../../prtg/prtg.service';
import { PrtgApiError, PrtgAuth } from '../../prtg/prtg.types';
import { AiAdapterConfig } from './adapter-config.entity';
import { AiAdapterConfigService, parseCredentialRef } from './adapter-config.service';
import { PRTG_MONITORING_IMPLEMENTATION, PRTG_MONITORING_PROVIDER_KEY } from './provider-constants';
import { PRTG_MAX_TIMEOUT_SECONDS, PRTG_MIN_TIMEOUT_SECONDS } from './prtg-monitoring.provider';
import { ProviderCredentialRef } from './provider.types';
import { AiTenantSecretResolverService } from './tenant-secret-resolver.service';

// Admin-facing monitoring integration management (Phase 15). Mirrors the GLPI
// settings UX/security pattern: credentials are WRITE-ONLY (stored as an
// AES-256-GCM 'encrypted' credential ref, never echoed back), reads expose
// presence/shape only, and test responses never contain tokens or URLs with
// query strings.

export type MonitoringIntegrationView = {
  provider_key: string;
  implementation: string;
  enabled: boolean;
  environment: string;
  base_url: string | null;
  server_timezone: string | null;
  request_timeout_seconds: number | null;
  credential: {
    present: boolean;
    shape: 'api_token' | 'username_passhash' | 'secret_ref' | 'none';
  };
  updated_at: string | null;
};

export type PrtgIntegrationSaveInput = {
  base_url?: unknown;
  enabled?: unknown;
  environment?: unknown;
  server_timezone?: unknown;
  request_timeout_seconds?: unknown;
  api_token?: unknown;
  username?: unknown;
  passhash?: unknown;
};

export type PrtgIntegrationTestInput = {
  base_url?: unknown;
  api_token?: unknown;
};

export type PrtgIntegrationTestResult = {
  ok: boolean;
  prtg_version?: string;
  sensor_count?: number;
  message: string;
};

const BASE_URL_MESSAGE = 'The PRTG server address must be a full web address starting with http:// or https:// '
  + '(for example https://prtg.example.com). You can copy it from the browser address bar when logged into PRTG.';
const TIMEZONE_MESSAGE = 'The server time zone must be a valid IANA time zone name such as Europe/Paris. '
  + 'Use the time zone configured on the machine that runs the PRTG core server (its operating-system clock setting).';
const CREDENTIAL_PAIR_MESSAGE = 'Enter both the PRTG user name and the passhash together. '
  + 'The passhash is shown in PRTG under Setup > Account Settings > My Account.';
const TIMEOUT_MESSAGE = 'The request timeout must be a whole number of seconds between '
  + `${PRTG_MIN_TIMEOUT_SECONDS} and ${PRTG_MAX_TIMEOUT_SECONDS}, or empty to use the default.`;

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizePrtgBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
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
    throw new BadRequestException('The PRTG server address must not contain a query string, fragment, or embedded credentials.');
  }
  return trimmed;
}

// IANA zone probe: Intl throws a RangeError for unknown zone names. A shape
// pre-check keeps obvious junk (and anything secret-looking) out of the probe.
export function isValidIanaTimeZone(value: string): boolean {
  if (!/^[A-Za-z0-9_+/-]{1,64}$/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Same material formats prtg.service.ts parses: plain string = API token,
// JSON { api_token } or { username, passhash }.
function parsePrtgAuthMaterial(material: string): PrtgAuth | null {
  const raw = material.trim();
  if (!raw) {
    return null;
  }
  if (!raw.startsWith('{')) {
    return { kind: 'api_token', apiToken: raw };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) {
    return null;
  }
  const apiToken = textOrNull(record.api_token);
  if (apiToken) {
    return { kind: 'api_token', apiToken };
  }
  const username = textOrNull(record.username);
  const passhash = textOrNull(record.passhash);
  if (username && passhash) {
    return { kind: 'passhash', username, passhash };
  }
  return null;
}

function credentialSummary(raw: unknown): MonitoringIntegrationView['credential'] {
  const parsed = parseCredentialRef(raw);
  if (!parsed || parsed.kind === 'none') {
    return { present: false, shape: 'none' };
  }
  if (parsed.kind === 'encrypted') {
    return {
      present: true,
      shape: parsed.material_shape === 'username_passhash' ? 'username_passhash' : 'api_token',
    };
  }
  // secret_ref / environment references are operator-managed indirections —
  // both surface as 'secret_ref' (a reference, not stored material).
  return { present: true, shape: 'secret_ref' };
}

function toView(config: AiAdapterConfig): MonitoringIntegrationView {
  const metadata = asRecord(config.metadata_json);
  return {
    provider_key: config.provider_key,
    implementation: config.implementation,
    enabled: config.enabled === true,
    environment: config.environment,
    base_url: textOrNull(config.base_url),
    server_timezone: textOrNull(metadata?.server_timezone),
    request_timeout_seconds: config.timeout_seconds ?? null,
    credential: credentialSummary(config.credential_ref_json),
    updated_at: config.updated_at instanceof Date
      ? config.updated_at.toISOString()
      : textOrNull(config.updated_at),
  };
}

@Injectable()
export class AiMonitoringIntegrationsService {
  constructor(
    private readonly adapterConfigs: AiAdapterConfigService,
    private readonly secretResolver: AiTenantSecretResolverService,
    private readonly cipher: AiSecretCipherService,
    private readonly prtg: PrtgService,
  ) {}

  async listMonitoringIntegrations(
    context: AiExecutionContextWithManager,
  ): Promise<{ integrations: MonitoringIntegrationView[] }> {
    const configs = await context.manager.getRepository(AiAdapterConfig).find({
      where: { tenant_id: context.tenantId, provider_kind: 'monitoring' },
    });
    const integrations = configs
      .map(toView)
      .sort((a, b) => a.provider_key.localeCompare(b.provider_key));
    return { integrations };
  }

  async savePrtgIntegration(
    context: AiExecutionContextWithManager,
    input: PrtgIntegrationSaveInput,
  ): Promise<{ ok: true }> {
    const baseUrlRaw = textOrNull(input.base_url);
    if (!baseUrlRaw) {
      throw new BadRequestException(BASE_URL_MESSAGE);
    }
    const baseUrl = normalizePrtgBaseUrl(baseUrlRaw);
    assertPublicHttpUrl(baseUrl); // SSRF: block internal targets in cloud (no-op on-prem)
    if (typeof input.enabled !== 'boolean') {
      throw new BadRequestException('The enabled setting must be on or off.');
    }

    const existing = await this.adapterConfigs.getConfig(context, 'monitoring', PRTG_MONITORING_PROVIDER_KEY);

    let environment = existing?.environment ?? 'production';
    const environmentInput = textOrNull(input.environment);
    if (environmentInput != null) {
      if (environmentInput !== 'sandbox' && environmentInput !== 'production') {
        throw new BadRequestException('The environment must be either sandbox or production.');
      }
      environment = environmentInput;
    }

    // server_timezone: key present + value → validate and set; key present +
    // empty → clear (back to UTC); key absent → keep the stored value.
    const metadata: Record<string, unknown> = { ...(asRecord(existing?.metadata_json) ?? {}) };
    if (input.server_timezone !== undefined) {
      const timezone = textOrNull(input.server_timezone);
      if (timezone == null) {
        delete metadata.server_timezone;
      } else if (!isValidIanaTimeZone(timezone)) {
        throw new BadRequestException(TIMEZONE_MESSAGE);
      } else {
        metadata.server_timezone = timezone;
      }
    }

    // request_timeout_seconds: key present + value → validate and set; key
    // present + empty → clear (back to the built-in default); key absent →
    // keep the stored value.
    let timeoutSeconds = existing?.timeout_seconds ?? null;
    if (input.request_timeout_seconds !== undefined) {
      const timeoutRaw = input.request_timeout_seconds;
      if (timeoutRaw === null || (typeof timeoutRaw === 'string' && !timeoutRaw.trim())) {
        timeoutSeconds = null;
      } else {
        const parsed = Number(timeoutRaw);
        if (!Number.isInteger(parsed) || parsed < PRTG_MIN_TIMEOUT_SECONDS || parsed > PRTG_MAX_TIMEOUT_SECONDS) {
          throw new BadRequestException(TIMEOUT_MESSAGE);
        }
        timeoutSeconds = parsed;
      }
    }

    // Credential is write-only: omitted/empty keeps the existing reference
    // as-is — including an operator-managed secret_ref, which a base_url-only
    // save must never clobber.
    let credentialRef: Record<string, unknown> | null = existing?.credential_ref_json ?? null;
    const apiToken = textOrNull(input.api_token);
    const username = textOrNull(input.username);
    const passhash = textOrNull(input.passhash);
    if (apiToken) {
      credentialRef = this.encryptedCredentialRef(apiToken, 'api_token');
    } else if (username || passhash) {
      if (!username || !passhash) {
        throw new BadRequestException(CREDENTIAL_PAIR_MESSAGE);
      }
      credentialRef = this.encryptedCredentialRef(JSON.stringify({ username, passhash }), 'username_passhash');
    }

    await this.adapterConfigs.saveConfig(context, {
      provider_kind: 'monitoring',
      provider_key: PRTG_MONITORING_PROVIDER_KEY,
      implementation: PRTG_MONITORING_IMPLEMENTATION,
      environment,
      enabled: input.enabled,
      base_url: baseUrl,
      credential_ref_json: credentialRef,
      metadata_json: Object.keys(metadata).length > 0 ? metadata : null,
      timeout_seconds: timeoutSeconds,
    });
    return { ok: true };
  }

  async testPrtgIntegration(
    context: AiExecutionContextWithManager,
    input: PrtgIntegrationTestInput,
  ): Promise<PrtgIntegrationTestResult> {
    const config = await this.adapterConfigs.getConfig(context, 'monitoring', PRTG_MONITORING_PROVIDER_KEY);

    const baseUrlInput = textOrNull(input.base_url);
    const baseUrl = baseUrlInput ? normalizePrtgBaseUrl(baseUrlInput) : textOrNull(config?.base_url);
    if (!baseUrl) {
      return { ok: false, message: 'Add the PRTG server address first, then run the test again.' };
    }
    assertPublicHttpUrl(baseUrl); // SSRF: block internal targets in cloud (no-op on-prem)

    let material = textOrNull(input.api_token);
    if (!material) {
      if (!config?.credential_ref_json) {
        return { ok: false, message: 'No PRTG credential is saved yet. Enter an API token to test with, or save one first.' };
      }
      try {
        material = this.secretResolver.resolve(context, config.credential_ref_json).reveal();
      } catch {
        // Structured missing-credential outcome — never surfaces resolver
        // details (they may reference internal env naming).
        return { ok: false, message: 'The saved PRTG credential is not available on this server. Enter the API token again and save.' };
      }
    }
    const auth = parsePrtgAuthMaterial(material);
    if (!auth) {
      return { ok: false, message: 'The saved PRTG credential is incomplete. Enter the API token (or user name and passhash) again and save.' };
    }

    // Apply the tuned timeout to the probe too: a slow-but-working PRTG
    // server should pass the admin test with the same budget the poller gets.
    const timeoutSeconds = config?.timeout_seconds;
    const requestTimeoutMs = typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds)
      ? Math.max(PRTG_MIN_TIMEOUT_SECONDS, Math.min(PRTG_MAX_TIMEOUT_SECONDS, Math.floor(timeoutSeconds))) * 1000
      : null;
    try {
      const probe = await this.prtg.testConnection({ baseUrl, auth, requestTimeoutMs });
      const version = probe.prtgVersion;
      const count = probe.sensorCount;
      return {
        ok: true,
        ...(version ? { prtg_version: version } : {}),
        ...(count != null ? { sensor_count: count } : {}),
        message: version
          ? `Connected to PRTG ${version}. ${count ?? 0} sensor(s) are visible to this account.`
          : 'Connected to PRTG.',
      };
    } catch (error) {
      // PrtgApiError messages are already sanitized by the transport; anything
      // else gets a fixed plain-language message so no URL/token can leak.
      const message = error instanceof PrtgApiError
        ? sanitizePrtgText(error.message)
        : 'PRTG did not respond. Check the server address and that the PRTG web server is reachable.';
      return { ok: false, message };
    }
  }

  private encryptedCredentialRef(
    material: string,
    materialShape: 'api_token' | 'username_passhash',
  ): Record<string, unknown> {
    // AiSecretCipherService.encrypt throws a plain-language BadRequest when
    // AI_SETTINGS_ENCRYPTION_SECRET is not configured — let it propagate.
    const ref: ProviderCredentialRef = {
      kind: 'encrypted',
      ciphertext: this.cipher.encrypt(material),
      material_shape: materialShape,
    };
    return ref as unknown as Record<string, unknown>;
  }
}
