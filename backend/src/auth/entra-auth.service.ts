import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import * as jwt from 'jsonwebtoken';
import { createCipheriv, createDecipheriv, createHmac, createPublicKey, KeyObject, randomBytes } from 'crypto';
import * as https from 'https';
import { DirectoryProfile } from './entra-directory-sync.util';
import { URL, URLSearchParams } from 'url';
import {
  ENTRA_CONSENT_STATE_PURPOSE,
  ENTRA_LINK_CONFIRMATION_PURPOSE,
  ENTRA_LOGIN_HANDOFF_TYPE,
  ENTRA_STATE_PURPOSE,
} from './access-token.util';
import { getEntraStateSecret } from './token-secret.util';
import { ENTRA_ID_TOKEN_ALGORITHMS, ISSUED_TOKEN_ALGORITHM, ISSUED_TOKEN_ALGORITHMS } from './jwt-algorithms';

type EntraMode = 'setup' | 'login';

type EntraState = {
  purpose: typeof ENTRA_STATE_PURPOSE;
  mode: EntraMode;
  tenantId: string;
  redirectTo?: string;
  nonce: string;
};

/**
 * The state as it travels: a sign-in state is handed out before anyone signs in, so it names the
 * workspace by a sealed reference only this application reads, never by its id.
 */
type SignedEntraState = Omit<EntraState, 'tenantId'> & { tenant: string };

/** Label of the key that seals the workspace reference, derived from the state key. */
const TENANT_REFERENCE_KEY_LABEL = `${ENTRA_STATE_PURPOSE}:tenant-reference`;
const SEAL_IV_BYTES = 12;
const SEAL_TAG_BYTES = 16;

type EntraConsentState = {
  purpose: typeof ENTRA_CONSENT_STATE_PURPOSE;
  tenantId: string;
  /** The administrator the consent address was built for, when there is one. */
  userId?: string;
};

/**
 * Lifetime of a consent state. The consent address is part of the settings page, so the state is
 * signed when the page loads and used when the administrator comes back from Microsoft.
 */
const CONSENT_STATE_LIFETIME = '1h';

type EntraLoginHandoff = {
  type: typeof ENTRA_LOGIN_HANDOFF_TYPE;
  tenantId: string;
  userId: string;
  redirectTo?: string;
};

/**
 * What a link confirmation names: the account, its address when the link was sent, and the
 * Microsoft account (`oid` in the directory `tid`) it will be linked to.
 */
export type EntraLinkConfirmation = {
  tenantId: string;
  userId: string;
  email: string;
  oid: string;
  tid: string;
  /** The Microsoft account as the e-mail and the confirmation page show it: display name and sign-in name. */
  name?: string;
  username?: string;
};

/** A display value from the directory, bounded; absent when empty. */
function displayClaim(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim().slice(0, 200) : '';
  return text || undefined;
}

type OpenIdConfiguration = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  // optional, not all fields used
};

type Jwk = {
  kid: string;
  [key: string]: any;
};

type JwksResponse = {
  keys: Jwk[];
};

type GraphProfile = DirectoryProfile;

/** Fields KANAP reads from a Graph user. accountEnabled needs application permissions. */
const GRAPH_ME_SELECT = 'id,givenName,surname,displayName,jobTitle,businessPhones,mobilePhone,department,companyName,preferredLanguage';
const GRAPH_USERS_SELECT = `${GRAPH_ME_SELECT},accountEnabled`;
/** Reporting line, id only: the manager is matched to a KANAP user by object id. */
const GRAPH_MANAGER_EXPAND = encodeURIComponent('manager($select=id)');

/** HTTP failure from Microsoft endpoints, with the status kept for classification. */
export class GraphAccessError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'GraphAccessError';
  }
}

@Injectable()
export class EntraAuthService {
  private readonly logger = new Logger(EntraAuthService.name);
  private readonly stateSecret: string;
  private readonly tenantReferenceKey: Buffer;
  private readonly linkConfirmationKey: string;

  private metadataPromise: Promise<OpenIdConfiguration> | null = null;
  private jwksPromise: Promise<JwksResponse> | null = null;

  constructor(private readonly config: ConfigService) {
    // Dedicated `ENTRA_STATE_SECRET` when configured, otherwise the derived
    // `kanap:v1:entra-state` key. Never the shared access-token secret.
    this.stateSecret = getEntraStateSecret();
    this.tenantReferenceKey = createHmac('sha256', this.stateSecret).update(TENANT_REFERENCE_KEY_LABEL).digest();
    this.linkConfirmationKey = createHmac('sha256', this.stateSecret).update(ENTRA_LINK_CONFIRMATION_PURPOSE).digest('hex');
  }

  private getClientId(): string {
    return (this.config.get<string>('ENTRA_CLIENT_ID') || '').trim();
  }

  private getClientSecret(): string {
    return (this.config.get<string>('ENTRA_CLIENT_SECRET') || '').trim();
  }

  private getRedirectUri(): string {
    return (this.config.get<string>('ENTRA_REDIRECT_URI') || '').trim();
  }

  private getAuthority(): string {
    return (this.config.get<string>('ENTRA_AUTHORITY') || '').trim();
  }

  private async fetchJson<T>(urlString: string, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        const url = new URL(urlString);
        const req = https.request(url, { method: 'GET' }, (res) => {
          const status = res.statusCode ?? 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (status < 200 || status >= 300) {
              reject(new GraphAccessError(`${label} request failed (${status})`, status));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(new Error(`${label} response was not valid JSON`));
            }
          });
        });
        req.on('error', (err) => reject(err));
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private async fetchJsonWithAuth<T>(urlString: string, label: string, accessToken: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        const url = new URL(urlString);
        const req = https.request(
          url,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              if (status < 200 || status >= 300) {
                reject(new GraphAccessError(`${label} request failed (${status})`, status));
                return;
              }
              try {
                resolve(JSON.parse(body));
              } catch (err) {
                reject(new Error(`${label} response was not valid JSON`));
              }
            });
          },
        );
        req.on('error', (err) => reject(err));
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private async postForm<T>(urlString: string, data: Record<string, string>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        const body = new URLSearchParams(data).toString();
        const url = new URL(urlString);
        const req = https.request(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(body).toString(),
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => {
              const respBody = Buffer.concat(chunks).toString('utf8');
              let parsed: any;
              try {
                parsed = respBody ? JSON.parse(respBody) : {};
              } catch {
                reject(new Error(`${label} response was not valid JSON`));
                return;
              }
              if (status < 200 || status >= 300) {
                const err = parsed?.error_description || parsed?.error || respBody || `status ${status}`;
                reject(new Error(`${label} failed (${status}): ${err}`));
                return;
              }
              resolve(parsed as T);
            });
          },
        );
        req.on('error', (err) => reject(err));
        req.write(body);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private async loadMetadata(): Promise<OpenIdConfiguration> {
    if (this.metadataPromise) return this.metadataPromise;
    const authority = this.getAuthority();
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const redirectUri = this.getRedirectUri();
    if (!authority || !clientId || !clientSecret || !redirectUri) {
      this.logger.warn('Entra auth is not fully configured; check ENTRA_* env vars');
      throw new BadRequestException('Entra authentication is not configured');
    }

    const normalizedAuthority = authority.replace(/\/$/, '');
    const wellKnownBase = normalizedAuthority.endsWith('/v2.0') ? normalizedAuthority : `${normalizedAuthority}/v2.0`;
    const wellKnownUrl = `${wellKnownBase}/.well-known/openid-configuration`;

    this.metadataPromise = this.fetchJson<OpenIdConfiguration>(wellKnownUrl, 'Entra discovery').catch((err) => {
      this.logger.error(`Failed to load Entra metadata: ${err instanceof Error ? err.message : err}`);
      this.metadataPromise = null;
      throw new BadRequestException('Entra authentication is not available');
    });
    return this.metadataPromise;
  }

  private async loadJwks(): Promise<JwksResponse> {
    if (this.jwksPromise) return this.jwksPromise;
    const metadata = await this.loadMetadata();
    if (!metadata.jwks_uri) {
      throw new BadRequestException('Entra JWKS endpoint is not configured');
    }
    this.jwksPromise = this.fetchJson<JwksResponse>(metadata.jwks_uri, 'Entra JWKS').catch((err) => {
      this.logger.error(`Failed to load Entra JWKS: ${err instanceof Error ? err.message : err}`);
      this.jwksPromise = null;
      throw new BadRequestException('Entra authentication is not available');
    });
    return this.jwksPromise;
  }

  private async resolveSigningKey(kid: string): Promise<KeyObject> {
    const jwks = await this.loadJwks();
    const jwk = jwks.keys.find((k) => k.kid === kid);
    if (!jwk) {
      throw new BadRequestException('Unable to validate Entra token (unknown kid)');
    }
    try {
      return createPublicKey({ key: jwk as any, format: 'jwk' });
    } catch (err: any) {
      this.logger.error(`Failed to build public key for kid ${kid}: ${err?.message || String(err)}`);
      throw new BadRequestException('Unable to validate Entra token');
    }
  }

  /** The workspace id as a sealed reference (AES-256-GCM, a fresh nonce each time). */
  private sealTenantId(tenantId: string): string {
    const iv = randomBytes(SEAL_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.tenantReferenceKey, iv, { authTagLength: SEAL_TAG_BYTES });
    const sealed = Buffer.concat([cipher.update(tenantId, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64url');
  }

  /** The workspace id of a reference this application sealed; null for anything else. */
  private openTenantReference(reference: unknown): string | null {
    if (typeof reference !== 'string') return null;
    try {
      const raw = Buffer.from(reference, 'base64url');
      if (raw.length <= SEAL_IV_BYTES + SEAL_TAG_BYTES) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.tenantReferenceKey, raw.subarray(0, SEAL_IV_BYTES), {
        authTagLength: SEAL_TAG_BYTES,
      });
      decipher.setAuthTag(raw.subarray(SEAL_IV_BYTES, SEAL_IV_BYTES + SEAL_TAG_BYTES));
      return Buffer.concat([decipher.update(raw.subarray(SEAL_IV_BYTES + SEAL_TAG_BYTES)), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  private signState(payload: EntraState): string {
    try {
      const { tenantId, ...rest } = payload;
      const signed: SignedEntraState = { ...rest, tenant: this.sealTenantId(tenantId) };
      return jwt.sign(signed, this.stateSecret, { algorithm: ISSUED_TOKEN_ALGORITHM, expiresIn: '10m' });
    } catch (err: any) {
      this.logger.error(`Failed to sign Entra state: ${err?.message || String(err)}`);
      throw new BadRequestException('Unable to start Entra authentication');
    }
  }

  private verifyState(token: string): EntraState {
    try {
      const decoded = jwt.verify(token, this.stateSecret, { algorithms: [...ISSUED_TOKEN_ALGORITHMS] }) as SignedEntraState;
      // Explicit typing (RFC 8725 §3.12): an SSO state must be an SSO state, not merely a token
      // this application can verify.
      const tenantId = decoded ? this.openTenantReference(decoded.tenant) : null;
      if (!decoded || decoded.purpose !== ENTRA_STATE_PURPOSE || !decoded.mode || !tenantId || !decoded.nonce) {
        throw new Error('invalid payload');
      }
      const { tenant: _reference, ...rest } = decoded;
      return { ...rest, tenantId };
    } catch (err: any) {
      this.logger.warn(`Invalid Entra state: ${err?.message || String(err)}`);
      throw new BadRequestException('Invalid Entra state');
    }
  }

  /**
   * The workspace named by the state of an admin-consent return, and the administrator the
   * consent address was built for, when it names one. The state must be signed with the
   * state key and typed for consent: a sign-in or setup state is refused here, as a consent state
   * is by `verifyState`. The lifetime is read here, not by `jwt.verify`, so that a state this
   * application signed is still recognised once `expired`: the caller acts only on one that is not.
   */
  verifyConsentState(token: string): { tenantId: string; userId: string | null; expired: boolean } {
    try {
      const decoded = jwt.verify(token, this.stateSecret, {
        algorithms: [...ISSUED_TOKEN_ALGORITHMS],
        ignoreExpiration: true,
      }) as (Partial<EntraConsentState> & { exp?: number }) | string;
      if (
        !decoded
        || typeof decoded !== 'object'
        || decoded.purpose !== ENTRA_CONSENT_STATE_PURPOSE
        || typeof decoded.tenantId !== 'string'
        || !decoded.tenantId
        || typeof decoded.exp !== 'number'
      ) {
        throw new Error('invalid payload');
      }
      return {
        tenantId: decoded.tenantId,
        userId: typeof decoded.userId === 'string' && decoded.userId ? decoded.userId : null,
        expired: Math.floor(Date.now() / 1000) >= decoded.exp,
      };
    } catch (err: any) {
      this.logger.warn(`Invalid Entra consent state: ${err?.message || String(err)}`);
      throw new BadRequestException('Invalid Entra state');
    }
  }

  signLoginHandoff(payload: { tenantId: string; userId: string; redirectTo?: string }): string {
    try {
      return jwt.sign(
        {
          type: ENTRA_LOGIN_HANDOFF_TYPE,
          tenantId: payload.tenantId,
          userId: payload.userId,
          redirectTo: payload.redirectTo ?? '/',
        } satisfies EntraLoginHandoff,
        this.stateSecret,
        { algorithm: ISSUED_TOKEN_ALGORITHM, expiresIn: '2m' },
      );
    } catch (err: any) {
      this.logger.error(`Failed to sign Entra login handoff: ${err?.message || String(err)}`);
      throw new BadRequestException('Unable to complete Entra authentication');
    }
  }

  verifyLoginHandoff(token: string): EntraLoginHandoff {
    try {
      const decoded = jwt.verify(token, this.stateSecret, { algorithms: [...ISSUED_TOKEN_ALGORITHMS] }) as EntraLoginHandoff;
      if (
        !decoded
        || decoded.type !== ENTRA_LOGIN_HANDOFF_TYPE
        || !decoded.tenantId
        || !decoded.userId
      ) {
        throw new Error('invalid payload');
      }
      return decoded;
    } catch (err: any) {
      this.logger.warn(`Invalid Entra login handoff: ${err?.message || String(err)}`);
      throw new BadRequestException('Invalid Entra login session');
    }
  }

  /** The link that confirms an account's link to a Microsoft account, valid for `expiresIn`. */
  signLinkConfirmation(payload: EntraLinkConfirmation, expiresIn: StringValue | number): { token: string; expiresAt: Date } {
    const { name, username, ...link } = payload;
    const shown = { name: displayClaim(name), username: displayClaim(username) };
    const token = jwt.sign(
      { purpose: ENTRA_LINK_CONFIRMATION_PURPOSE, ...link, ...shown, jti: randomBytes(16).toString('hex') },
      this.linkConfirmationKey,
      { algorithm: ISSUED_TOKEN_ALGORITHM, expiresIn },
    );
    const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
    return { token, expiresAt: new Date((exp ?? Math.floor(Date.now() / 1000)) * 1000) };
  }

  /** What a link confirmation this application signed names; refused when expired or anything else. */
  verifyLinkConfirmation(token: unknown): EntraLinkConfirmation {
    try {
      if (typeof token !== 'string' || !token) throw new Error('missing');
      const decoded = jwt.verify(token, this.linkConfirmationKey, { algorithms: [...ISSUED_TOKEN_ALGORITHMS] }) as any;
      const fields = ['tenantId', 'userId', 'email', 'oid', 'tid'] as const;
      if (!decoded || decoded.purpose !== ENTRA_LINK_CONFIRMATION_PURPOSE || fields.some((f) => typeof decoded[f] !== 'string' || !decoded[f])) {
        throw new Error('invalid payload');
      }
      return {
        tenantId: decoded.tenantId,
        userId: decoded.userId,
        email: decoded.email,
        oid: decoded.oid,
        tid: decoded.tid,
        name: displayClaim(decoded.name),
        username: displayClaim(decoded.username),
      };
    } catch (err: any) {
      this.logger.warn(`Invalid Entra link confirmation: ${err?.message || String(err)}`);
      throw new BadRequestException('ENTRA_LINK_INVALID');
    }
  }

  async buildAuthorizationUrl(params: { mode: EntraMode; tenantId: string; redirectTo?: string }) {
    const metadata = await this.loadMetadata();
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!metadata.authorization_endpoint) throw new BadRequestException('Entra authorization endpoint missing');

    const nonce = randomBytes(16).toString('hex');
    const state = this.signState({
      purpose: ENTRA_STATE_PURPOSE,
      mode: params.mode,
      tenantId: params.tenantId,
      redirectTo: params.redirectTo ?? '/',
      nonce,
    });

    const urlObj = new URL(metadata.authorization_endpoint);
    urlObj.searchParams.set('client_id', clientId);
    urlObj.searchParams.set('response_type', 'code');
    urlObj.searchParams.set('redirect_uri', redirectUri);
    urlObj.searchParams.set('scope', 'openid profile email offline_access User.Read');
    urlObj.searchParams.set('response_mode', 'query');
    urlObj.searchParams.set('state', state);
    urlObj.searchParams.set('nonce', nonce);

    if (params.mode === 'setup') {
      // Force the consent screen during initial setup so that the admin
      // sees exactly which permissions are being granted. Entra tenant
      // policies (e.g., “admin consent required”) determine who can
      // actually complete this step.
      urlObj.searchParams.set('prompt', 'consent');
    }

    return { url: urlObj.toString(), nonce, state };
  }

  async handleCallback(input: { code?: string | string[]; state?: string | string[] }) {
    const code = Array.isArray(input.code) ? input.code[0] : input.code;
    const stateRaw = Array.isArray(input.state) ? input.state[0] : input.state;

    if (!code || !stateRaw) {
      throw new BadRequestException('Missing code or state');
    }

    const metadata = await this.loadMetadata();
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const redirectUri = this.getRedirectUri();
    if (!metadata.token_endpoint) throw new BadRequestException('Entra token endpoint missing');

    const parsedState = this.verifyState(stateRaw);

    const tokenResponse = await this.postForm<{
      id_token?: string;
      access_token?: string;
      error?: string;
      error_description?: string;
    }>(
      metadata.token_endpoint,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'openid profile email offline_access User.Read',
      },
      'Entra token exchange',
    );

    if (!tokenResponse?.id_token) {
      const desc = tokenResponse?.error_description || tokenResponse?.error || 'missing id_token';
      throw new BadRequestException(`Failed to complete Entra sign-in: ${desc}`);
    }

    const [headerB64] = tokenResponse.id_token.split('.');
    if (!headerB64) throw new BadRequestException('Invalid Entra token format');
    let kid: string | undefined;
    try {
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      kid = header.kid;
    } catch {
      kid = undefined;
    }
    if (!kid) throw new BadRequestException('Entra token missing kid');

    const key = await this.resolveSigningKey(kid);
    let claims: any;
    try {
      // Verify signature and audience first
      claims = jwt.verify(tokenResponse.id_token, key, {
        algorithms: [...ENTRA_ID_TOKEN_ALGORITHMS],
        audience: clientId,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to verify Entra token: ${err?.message || String(err)}`);
      throw new BadRequestException('Invalid Entra token');
    }

    // Validate issuer explicitly so multi-tenant authorities (e.g. "organizations")
    // with "{tenantid}" placeholders in metadata.issuer are handled correctly.
    const iss = typeof (claims as any)?.iss === 'string' ? (claims as any).iss : '';
    const tidFromClaims = typeof (claims as any)?.tid === 'string' ? (claims as any).tid : '';
    if (!iss || !tidFromClaims) {
      throw new BadRequestException('Entra token issuer or tenant id is missing');
    }
    const expectedIssuer = `https://login.microsoftonline.com/${tidFromClaims}/v2.0`;
    if (iss !== expectedIssuer) {
      this.logger.warn(`Unexpected Entra issuer: got ${iss}, expected ${expectedIssuer}`);
      throw new BadRequestException('Invalid Entra token');
    }

    if (!claims.nonce || claims.nonce !== parsedState.nonce) {
      throw new BadRequestException('Entra token nonce mismatch');
    }
    if (!claims?.sub) throw new BadRequestException('Entra token subject missing');

    return {
      mode: parsedState.mode,
      tenantId: parsedState.tenantId,
      redirectTo: parsedState.redirectTo ?? '/',
      claims,
      accessToken: tokenResponse.access_token || null,
    };
  }

  async fetchGraphProfile(accessToken: string): Promise<GraphProfile> {
    if (!accessToken) {
      throw new BadRequestException('Missing access token for Graph request');
    }
    // Reading a manager asks for User.Read.All, above the User.Read this
    // sign-in token carries, so most directories answer without one. Tenants
    // that consented to more get their reporting line right away; everyone
    // else gets it from the nightly sync, which runs with that permission.
    return this.fetchWithManagerExpansion<GraphProfile>(
      `https://graph.microsoft.com/v1.0/me?$select=${GRAPH_ME_SELECT}`,
      'Graph /me',
      accessToken,
      'debug',
    );
  }

  /**
   * Graph read that also expands the manager, retried once without it when the
   * directory refuses the expansion. The reporting line is a bonus: it must
   * never cost a tenant its profile refresh or its removed-account detection.
   */
  private async fetchWithManagerExpansion<T>(
    baseUrl: string,
    label: string,
    accessToken: string,
    onRefusal: 'warn' | 'debug' = 'warn',
  ): Promise<T> {
    try {
      return await this.fetchJsonWithAuth<T>(`${baseUrl}&$expand=${GRAPH_MANAGER_EXPAND}`, label, accessToken);
    } catch (err: any) {
      this.logger[onRefusal](`${label}: manager expansion refused (${err?.message || err}), retrying without it`);
      return this.fetchJsonWithAuth<T>(baseUrl, label, accessToken);
    }
  }

  // ---------------------------------------------------------------------
  // Application-permission access (scheduled directory sync)
  // ---------------------------------------------------------------------

  private readonly appTokens = new Map<string, { token: string; expiresAt: number }>();

  /**
   * Client-credentials token for a customer directory. Requires the customer's
   * Entra admin to have granted consent for the app's application permissions
   * (User.Read.All); otherwise the token request or the Graph call fails and
   * `isConsentError` classifies it.
   */
  async acquireAppToken(entraTenantId: string): Promise<string> {
    const cached = this.appTokens.get(entraTenantId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    if (!clientId || !clientSecret) throw new Error('ENTRA_NOT_CONFIGURED');

    const response = await this.postForm<{
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    }>(
      `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/oauth2/v2.0/token`,
      {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      },
      'Entra app token',
    );
    if (!response?.access_token) {
      throw new GraphAccessError(response?.error_description || response?.error || 'Entra app token missing', 401);
    }
    const ttlSec = Number(response.expires_in) > 0 ? Number(response.expires_in) : 3600;
    this.appTokens.set(entraTenantId, { token: response.access_token, expiresAt: Date.now() + ttlSec * 1000 });
    return response.access_token;
  }

  /**
   * Drop a cached app token — needed right after admin consent (a token issued
   * before the grant does not carry the new permission until it expires).
   */
  invalidateAppToken(entraTenantId: string): void {
    this.appTokens.delete(entraTenantId);
  }

  /** Batch lookup by object id. Ids absent from the result are deleted in the directory. */
  async fetchDirectoryUsers(accessToken: string, objectIds: string[]): Promise<DirectoryProfile[]> {
    if (objectIds.length === 0) return [];
    const filter = `id in (${objectIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')})`;
    const url = `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(filter)}&$select=${GRAPH_USERS_SELECT}`;
    const response = await this.fetchWithManagerExpansion<{ value?: DirectoryProfile[] }>(
      url,
      'Graph users lookup',
      accessToken,
    );
    return Array.isArray(response?.value) ? response.value : [];
  }

  /**
   * The mode and workspace of a state past its checks — used only to pick a
   * sensible error redirect target after a failed callback, and to tell a
   * setup round trip from a sign-in. Never trust it for auth: the lifetime is
   * not checked. The state must be signed by this application as an SSO state
   * and carry a reference it sealed; any other state gives neither.
   */
  peekState(stateRaw: unknown): { mode: string; tenantId: string } | null {
    if (typeof stateRaw !== 'string' || !stateRaw) return null;
    try {
      const decoded = jwt.verify(stateRaw, this.stateSecret, {
        algorithms: [...ISSUED_TOKEN_ALGORITHMS],
        ignoreExpiration: true,
      }) as Partial<SignedEntraState> | string;
      if (!decoded || typeof decoded !== 'object' || decoded.purpose !== ENTRA_STATE_PURPOSE) return null;
      const tenantId = this.openTenantReference(decoded.tenant);
      if (!tenantId || typeof decoded.mode !== 'string') return null;
      return { mode: decoded.mode, tenantId };
    } catch {
      return null;
    }
  }

  /**
   * Cheapest possible check that application permissions were consented:
   * a token is issued even without consent, only Graph refuses (403).
   */
  async probeDirectoryAccess(accessToken: string): Promise<void> {
    await this.fetchJsonWithAuth<{ value?: unknown[] }>(
      'https://graph.microsoft.com/v1.0/users?$top=1&$select=id',
      'Graph directory probe',
      accessToken,
    );
  }

  /** True when the failure means "admin consent for application permissions is missing". */
  isConsentError(err: unknown): boolean {
    const message = String((err as any)?.message ?? '');
    if (err instanceof GraphAccessError && err.status === 403) return true;
    return /AADSTS65001|AADSTS700016|AADSTS650057|Authorization_RequestDenied/i.test(message);
  }

  /**
   * Microsoft admin-consent URL for the tenant. Lands back on the regular SSO
   * callback with `state=consent:<signed state naming the tenant>` so no extra
   * redirect URI needs registering. The state also names `userId`, the
   * administrator the address is built for, who becomes the author of the
   * audit entry written at the return.
   */
  buildAdminConsentUrl(entraTenantId: string, kanapTenantId: string, userId?: string | null): string | null {
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) return null;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: `consent:${jwt.sign(
        {
          purpose: ENTRA_CONSENT_STATE_PURPOSE,
          tenantId: kanapTenantId,
          ...(typeof userId === 'string' && userId ? { userId } : {}),
        } satisfies EntraConsentState,
        this.stateSecret,
        { algorithm: ISSUED_TOKEN_ALGORITHM, expiresIn: CONSENT_STATE_LIFETIME },
      )}`,
      scope: 'https://graph.microsoft.com/.default',
    });
    return `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/v2.0/adminconsent?${params.toString()}`;
  }
}
