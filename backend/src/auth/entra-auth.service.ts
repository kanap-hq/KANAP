import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { randomBytes, createPublicKey, KeyObject } from 'crypto';
import * as https from 'https';
import { DirectoryProfile } from './entra-directory-sync.util';
import { URL, URLSearchParams } from 'url';
import { ENTRA_LOGIN_HANDOFF_TYPE, ENTRA_STATE_PURPOSE } from './access-token.util';
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

type EntraLoginHandoff = {
  type: typeof ENTRA_LOGIN_HANDOFF_TYPE;
  tenantId: string;
  userId: string;
  redirectTo?: string;
};

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

  private metadataPromise: Promise<OpenIdConfiguration> | null = null;
  private jwksPromise: Promise<JwksResponse> | null = null;

  constructor(private readonly config: ConfigService) {
    // Dedicated `ENTRA_STATE_SECRET` when configured, otherwise the derived
    // `kanap:v1:entra-state` key. Never the shared access-token secret (constat n°2).
    this.stateSecret = getEntraStateSecret();
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

  private signState(payload: EntraState): string {
    try {
      return jwt.sign(payload, this.stateSecret, { algorithm: ISSUED_TOKEN_ALGORITHM, expiresIn: '10m' });
    } catch (err: any) {
      this.logger.error(`Failed to sign Entra state: ${err?.message || String(err)}`);
      throw new BadRequestException('Unable to start Entra authentication');
    }
  }

  private verifyState(token: string): EntraState {
    try {
      const decoded = jwt.verify(token, this.stateSecret, { algorithms: [...ISSUED_TOKEN_ALGORITHMS] }) as EntraState;
      // Explicit typing (RFC 8725 §3.12): an SSO state must be an SSO state, not merely a token
      // this application can verify.
      if (!decoded || decoded.purpose !== ENTRA_STATE_PURPOSE || !decoded.mode || !decoded.tenantId || !decoded.nonce) {
        throw new Error('invalid payload');
      }
      return decoded;
    } catch (err: any) {
      this.logger.warn(`Invalid Entra state: ${err?.message || String(err)}`);
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
   * Unverified decode of the state parameter — used only to pick a sensible
   * error redirect target after a failed callback. Never trust it for auth.
   */
  peekState(stateRaw: unknown): { mode?: string; tenantId?: string } | null {
    if (typeof stateRaw !== 'string' || !stateRaw) return null;
    try {
      const decoded = jwt.decode(stateRaw);
      return decoded && typeof decoded === 'object' ? (decoded as { mode?: string; tenantId?: string }) : null;
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
   * callback with `state=consent:<kanapTenantId>` so no extra redirect URI
   * needs registering.
   */
  buildAdminConsentUrl(entraTenantId: string, kanapTenantId: string): string | null {
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) return null;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: `consent:${kanapTenantId}`,
      scope: 'https://graph.microsoft.com/.default',
    });
    return `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/v2.0/adminconsent?${params.toString()}`;
  }
}
