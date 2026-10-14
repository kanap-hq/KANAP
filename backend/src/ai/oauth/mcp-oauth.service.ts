import { HttpException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AiApiKey } from '../ai-api-key.entity';
import { AiApiKeysService } from '../ai-api-keys.service';
import { AiPolicyService } from '../ai-policy.service';
import { AiSettingsService } from '../ai-settings.service';
import { buildMcpApiKeyPolicyRecord } from '../control-plane/mcp/ai-mcp-access-policy';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';
import { UsersService } from '../../users/users.service';
import { CIMD_PUBLIC_ERROR, CimdFetcherService, ClientMetadata, isCimdClientId } from './cimd-fetcher.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MAX_OAUTH_URL_LENGTH,
  MCP_OAUTH_SCOPE,
  REFRESH_TOKEN_TTL_DAYS,
  isLoopbackRedirect,
  isThisMcpResource,
  isValidS256Challenge,
  mcpResourceUrl,
  normalizeScope,
  pkceVerifierMatches,
  redirectHost,
  redirectUriMatches,
  redirectWithParams,
} from './mcp-oauth.util';
import {
  McpAccessClaims,
  issueRefreshToken,
  newGrantPrefix,
  parseRefreshToken,
  refreshTokenMatchesHash,
  signAccessToken,
  signAuthorizationCode,
  successorRefreshToken,
  verifyAccessToken,
  verifyAuthorizationCode,
} from './mcp-oauth-tokens';

/**
 * MCP OAuth authorization server (spec: planning/mcp-oauth.md, lot 1).
 *
 * Every grant is a row of `ai_api_keys` with `credential_kind = 'oauth'`: tenant, owner, policy,
 * rate limit, expiry, revocation and audit work as for an API key. The tenant always comes from
 * the request host and must match the tenant named by every token.
 */

/** The request of one tenant address. */
export type McpOAuthHost = {
  tenantId: string;
  /** Scheme and host of the tenant, as the client reached it: the issuer. */
  origin: string;
  isPlatformHost: boolean;
  requestId?: string | null;
};

export type AuthorizationParams = Record<string, unknown>;

export type ValidatedAuthorization = {
  client: ClientMetadata;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  scope: string;
};

/**
 * An authorization request error. Before the redirect URI is validated it is answered here
 * (`redirectUri` null), never sent to an unverified address; after, it goes back to the client.
 */
export class AuthorizationError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly redirectUri: string | null = null,
    readonly state: string | null = null,
  ) {
    super(description);
  }
}

/** A token endpoint error (RFC 6749 §5.2). */
export class TokenEndpointError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) {
    super(description);
  }
}

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const FIRST = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const str = (value: unknown): string | null => {
  const first = FIRST(value);
  return typeof first === 'string' && first !== '' ? first : null;
};

const REFRESH_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 86_400_000;
const LAST_USED_RESOLUTION_MS = 60_000;
/** A refresh presented again within this window after its rotation gets the same successor. */
const REFRESH_RETRY_WINDOW_MS = 60_000;
/** At most one "refreshed" audit row per grant in this window. */
const REFRESH_AUDIT_INTERVAL_MS = 60 * 60_000;
/** Live grants kept per user and client: a new connection retires the oldest beyond this. */
const MAX_LIVE_GRANTS_PER_CLIENT = 5;

/**
 * The two parameters every authorization request needs before anything else is looked at:
 * present, strings, at most MAX_OAUTH_URL_LENGTH characters (the code carries both).
 */
export function checkRequestShape(params: AuthorizationParams): { clientId: string; redirectUri: string } {
  const clientId = str(params.client_id);
  if (!clientId) throw new AuthorizationError('invalid_request', 'client_id is required.');
  const redirectUri = str(params.redirect_uri);
  if (!redirectUri) throw new AuthorizationError('invalid_request', 'redirect_uri is required.');
  if (clientId.length > MAX_OAUTH_URL_LENGTH || redirectUri.length > MAX_OAUTH_URL_LENGTH) {
    throw new AuthorizationError('invalid_request', 'client_id and redirect_uri are limited to 512 characters.');
  }
  return { clientId, redirectUri };
}

@Injectable()
export class McpOAuthService {
  constructor(
    private readonly apiKeys: AiApiKeysService,
    private readonly users: UsersService,
    private readonly policy: AiPolicyService,
    private readonly aiSettings: AiSettingsService,
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly cimd: CimdFetcherService,
  ) {}

  // ---------------------------------------------------------------- authorization request

  /** Validates an authorization request (RFC 6749 §4.1.1, PKCE, RFC 8707) against the client's CIMD. */
  async validateAuthorization(params: AuthorizationParams, host: McpOAuthHost): Promise<ValidatedAuthorization> {
    const { clientId, redirectUri } = checkRequestShape(params);
    if (!isCimdClientId(clientId)) {
      throw new AuthorizationError('invalid_client', 'client_id must be the https URL of a client metadata document.');
    }

    let client: ClientMetadata;
    try {
      client = await this.cimd.fetch(clientId);
    } catch {
      throw new AuthorizationError('invalid_client', CIMD_PUBLIC_ERROR);
    }
    if (!client.redirect_uris.some((registered) => redirectUriMatches(registered, redirectUri))) {
      throw new AuthorizationError('invalid_request', 'redirect_uri is not registered by this client.');
    }

    // From here on, errors go back to the client's redirect URI.
    const state = str(params.state);
    const fail = (error: string, description: string) => new AuthorizationError(error, description, redirectUri, state);
    if (str(params.response_type) !== 'code') {
      throw fail('unsupported_response_type', 'response_type must be "code".');
    }
    const codeChallenge = str(params.code_challenge);
    if (!codeChallenge) throw fail('invalid_request', 'code_challenge is required (PKCE).');
    if (str(params.code_challenge_method) !== 'S256') {
      throw fail('invalid_request', 'code_challenge_method must be "S256".');
    }
    if (!isValidS256Challenge(codeChallenge)) throw fail('invalid_request', 'code_challenge is malformed.');
    const resource = str(params.resource);
    if (!resource) throw fail('invalid_target', 'resource is required.');
    if (!isThisMcpResource(resource, host.origin)) {
      throw fail('invalid_target', 'resource must be this server\'s MCP endpoint.');
    }
    const scope = normalizeScope(FIRST(params.scope));
    if (!scope) throw fail('invalid_scope', `Only the "${MCP_OAUTH_SCOPE}" scope is supported.`);

    return {
      client,
      clientId,
      redirectUri,
      state,
      codeChallenge,
      resource: mcpResourceUrl(host.origin),
      scope,
    };
  }

  /** The URL an error after redirect validation sends the browser to (RFC 6749 §4.1.2.1, RFC 9207). */
  errorRedirect(error: AuthorizationError, host: McpOAuthHost): string | null {
    if (!error.redirectUri) return null;
    return redirectWithParams(error.redirectUri, {
      error: error.error,
      error_description: error.description,
      state: error.state,
      iss: host.origin,
    });
  }

  /** The consent screen's details, and whether the user's remembered consent covers this request. */
  async describeRequest(params: AuthorizationParams, host: McpOAuthHost, userId: string) {
    const request = await this.validateAuthorization(params, host);
    const remembered = await this.tenantExecutor.run(host.tenantId, async (manager) => {
      await this.assertUserMayAuthorize(host, userId, manager);
      return this.hasRememberedConsent(manager, host.tenantId, userId, request);
    });
    // Remembered consent skips the screen for a loopback redirect only (Claude Code on the user's
    // machine). A web redirect always takes a click, so a page cannot connect a user's account to
    // a client of its choosing on its own.
    const autoApprove = remembered && isLoopbackRedirect(request.redirectUri);
    return {
      client: {
        client_id: request.clientId,
        client_name: request.client.client_name,
        client_uri: request.client.client_uri,
        logo_uri: request.client.logo_uri,
      },
      redirect_uri: request.redirectUri,
      redirect_host: redirectHost(request.redirectUri),
      loopback_redirect: isLoopbackRedirect(request.redirectUri),
      scope: request.scope,
      resource: request.resource,
      remembered,
      auto_approve: autoApprove,
    };
  }

  /**
   * Remembered consent (spec §5): a grant of this user for this client, not revoked nor expired,
   * marked `oauth_remember`, whose redirect URI has the same host as the one requested. The
   * requested URI was already checked against the client's current CIMD.
   */
  private async hasRememberedConsent(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    request: ValidatedAuthorization,
  ): Promise<boolean> {
    const rows: Array<{ oauth_redirect_uri: string | null }> = await manager.query(
      `SELECT oauth_redirect_uri FROM ai_api_keys
        WHERE tenant_id = $1 AND user_id = $2 AND credential_kind = 'oauth' AND oauth_client_id = $3
          AND oauth_remember = true AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [tenantId, userId, request.clientId],
    );
    const host = redirectHost(request.redirectUri);
    return rows.some((row) => !!row.oauth_redirect_uri && redirectHost(row.oauth_redirect_uri) === host);
  }

  /** Approve or refuse. Returns where the browser goes next: the client's redirect URI. */
  async decide(
    params: AuthorizationParams,
    host: McpOAuthHost,
    userId: string,
    decision: { approve: boolean; remember: boolean },
  ): Promise<{ redirect_to: string }> {
    const request = await this.validateAuthorization(params, host);
    if (!decision.approve) {
      // The refusal is a sign-in event of the account (the controller records it).
      return {
        redirect_to: redirectWithParams(request.redirectUri, {
          error: 'access_denied',
          error_description: 'The user refused the connection.',
          state: request.state,
          iss: host.origin,
        }),
      };
    }

    await this.tenantExecutor.run(host.tenantId, (manager) => this.assertUserMayAuthorize(host, userId, manager));
    const { code } = signAuthorizationCode({
      sub: userId,
      tenant_id: host.tenantId,
      iss: host.origin,
      client_id: request.clientId,
      client_name: request.client.client_name,
      redirect_uri: request.redirectUri,
      code_challenge: request.codeChallenge,
      resource: request.resource,
      scope: request.scope,
      remember: decision.remember,
    });
    return {
      redirect_to: redirectWithParams(request.redirectUri, { code, state: request.state, iss: host.origin }),
    };
  }

  /**
   * Who may connect an MCP client: the rule of MCP use itself (feature on, tenant active and not
   * frozen, MCP enabled for the tenant, `ai_mcp:reader`), plus the owner rule of API keys.
   */
  private async assertUserMayAuthorize(host: McpOAuthHost, userId: string, manager: EntityManager): Promise<void> {
    await this.policy.assertSurfaceAccess(
      {
        tenantId: host.tenantId,
        userId,
        isPlatformHost: host.isPlatformHost,
        surface: 'mcp',
        authMethod: 'oauth',
        requestId: host.requestId ?? null,
        aiApiKeyId: null,
      },
      manager,
    );
    const user = await this.users.findById(userId, { manager });
    if (!this.apiKeys.ownerMayAuthenticate(user)) {
      throw new AuthorizationError('access_denied', 'This account cannot connect MCP clients.');
    }
  }

  // ---------------------------------------------------------------- token endpoint

  /**
   * Every client is public (`token_endpoint_auth_methods_supported: ["none"]`). A client assertion is
   * refused (RFC 6749 §5.2 `invalid_client`): a client that sends one expects key-bound tokens, and
   * this server would neither check it nor bind anything to it.
   */
  async token(body: Record<string, unknown>, host: McpOAuthHost): Promise<TokenResponse> {
    if (body.client_assertion !== undefined || body.client_assertion_type !== undefined) {
      throw new TokenEndpointError('invalid_client', 'This server accepts public clients only (token_endpoint_auth_method "none").', 401);
    }
    const grantType = str(body.grant_type);
    if (grantType === 'authorization_code') return this.exchangeCode(body, host);
    if (grantType === 'refresh_token') return this.refresh(body, host);
    if (!grantType) throw new TokenEndpointError('invalid_request', 'grant_type is required.');
    throw new TokenEndpointError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  }

  private async exchangeCode(body: Record<string, unknown>, host: McpOAuthHost): Promise<TokenResponse> {
    const claims = verifyAuthorizationCode(str(body.code));
    if (!claims) throw new TokenEndpointError('invalid_grant', 'The authorization code is invalid or expired.');
    if (claims.tenant_id !== host.tenantId || claims.iss !== host.origin) {
      throw new TokenEndpointError('invalid_grant', 'The authorization code was issued for another address.');
    }
    if (str(body.client_id) !== claims.client_id) {
      throw new TokenEndpointError('invalid_grant', 'The authorization code was issued to another client.');
    }
    if (str(body.redirect_uri) !== claims.redirect_uri) {
      throw new TokenEndpointError('invalid_grant', 'redirect_uri does not match the authorization request.');
    }
    // RFC 8707: optional here, the code carries the resource of the authorization request.
    const resource = str(body.resource) ?? claims.resource;
    if (!isThisMcpResource(resource, host.origin) || !isThisMcpResource(claims.resource, host.origin)) {
      throw new TokenEndpointError('invalid_target', 'resource must be this server\'s MCP endpoint.');
    }
    if (!pkceVerifierMatches(str(body.code_verifier), claims.code_challenge)) {
      throw new TokenEndpointError('invalid_grant', 'code_verifier does not match the code challenge.');
    }

    type Outcome = { replayed: true } | { replayed: false; response: TokenResponse };
    let outcome: Outcome;
    try {
      outcome = await this.tenantExecutor.run(host.tenantId, async (manager): Promise<Outcome> => {
        // A replayed code: the grant the first exchange created goes too (RFC 6749 §4.1.2).
        if (await this.revokeGrantsOfCode(manager, host.tenantId, claims.jti)) return { replayed: true };
        await this.assertOwnerForToken(host, claims.sub, manager);
        return { replayed: false, response: await this.createGrant(manager, host, claims) };
      });
    } catch (error) {
      if ((error as any)?.code !== '23505') throw error;
      // Two exchanges of one code at the same time: the unique jti let one through.
      await this.tenantExecutor.run(host.tenantId, (manager) => this.revokeGrantsOfCode(manager, host.tenantId, claims.jti));
      outcome = { replayed: true };
    }
    if (outcome.replayed) {
      throw new TokenEndpointError('invalid_grant', 'The authorization code was already used.');
    }
    return outcome.response;
  }

  /** Revokes the live grants created by this code; true when the code had been used. */
  private async revokeGrantsOfCode(manager: EntityManager, tenantId: string, jti: string): Promise<boolean> {
    const rows = await manager.getRepository(AiApiKey).find({
      where: { tenant_id: tenantId, oauth_code_jti: jti },
    });
    for (const row of rows) {
      if (!row.revoked_at) {
        await this.apiKeys.revokeKey(row.id, {
          manager,
          tenantId,
          userId: null,
          revocationReason: 'oauth_code_replayed',
        });
      }
    }
    return rows.length > 0;
  }

  private async assertOwnerForToken(host: McpOAuthHost, userId: string, manager: EntityManager): Promise<void> {
    try {
      await this.assertUserMayAuthorize(host, userId, manager);
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof HttpException) {
        throw new TokenEndpointError('invalid_grant', 'The account may no longer connect MCP clients.');
      }
      throw error;
    }
  }

  /** 90 days from now, capped by the tenant's key max lifetime counted from the grant's creation. */
  private async grantExpiry(manager: EntityManager, tenantId: string, createdAt: Date): Promise<Date> {
    const settings = await this.aiSettings.find(tenantId, { manager });
    const sliding = Date.now() + REFRESH_TTL_MS;
    const maxDays = settings?.mcp_key_max_lifetime_days;
    if (!maxDays) return new Date(sliding);
    return new Date(Math.min(sliding, createdAt.getTime() + maxDays * 86_400_000));
  }

  /** Retires the user's oldest live grants for this client beyond MAX_LIVE_GRANTS_PER_CLIENT. */
  private async retireOldGrants(manager: EntityManager, tenantId: string, userId: string, clientId: string): Promise<void> {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM ai_api_keys
        WHERE tenant_id = $1 AND user_id = $2 AND credential_kind = 'oauth' AND oauth_client_id = $3
          AND revoked_at IS NULL
        ORDER BY created_at DESC, id DESC
        OFFSET $4`,
      [tenantId, userId, clientId, MAX_LIVE_GRANTS_PER_CLIENT],
    );
    for (const row of rows) {
      await this.apiKeys.revokeKey(row.id, { manager, tenantId, userId: null, revocationReason: 'oauth_superseded' });
    }
  }

  private async createGrant(
    manager: EntityManager,
    host: McpOAuthHost,
    claims: NonNullable<ReturnType<typeof verifyAuthorizationCode>>,
  ): Promise<TokenResponse> {
    const now = new Date();
    const prefix = newGrantPrefix();
    const refresh = issueRefreshToken(host.tenantId, prefix);
    const expiresAt = await this.grantExpiry(manager, host.tenantId, now);
    if (expiresAt.getTime() <= now.getTime()) {
      throw new TokenEndpointError('invalid_grant', 'The workspace allows no new MCP connection lifetime.');
    }
    const repo = manager.getRepository(AiApiKey);
    const record = await repo.save(repo.create({
      tenant_id: host.tenantId,
      user_id: claims.sub,
      key_hash: refresh.hash,
      key_prefix: prefix,
      label: (claims.client_name || new URL(claims.client_id).hostname).slice(0, 100),
      expires_at: expiresAt,
      ...buildMcpApiKeyPolicyRecord({ maxEffect: 'read' }),
      created_by_user_id: claims.sub,
      credential_kind: 'oauth',
      oauth_client_id: claims.client_id,
      oauth_client_name: claims.client_name || null,
      oauth_redirect_uri: claims.redirect_uri,
      oauth_code_jti: claims.jti,
      refresh_rotated_at: now,
      oauth_remember: claims.remember === true,
      last_used_at: now,
    }));
    await this.apiKeys.logAudit(
      {
        table: 'ai_api_keys',
        recordId: record.id,
        action: 'create',
        before: null,
        after: { ...this.apiKeys.toView(record), oauth: 'granted', oauth_client_id: claims.client_id },
        userId: claims.sub,
        source: 'user',
      },
      { manager },
    );
    await this.retireOldGrants(manager, host.tenantId, claims.sub, claims.client_id);
    return this.tokenResponse(host, record, refresh.token, claims.scope);
  }

  private tokenResponse(host: McpOAuthHost, record: AiApiKey, refreshToken: string, scope: string): TokenResponse {
    return {
      access_token: signAccessToken({
        sub: record.user_id,
        tenant_id: host.tenantId,
        iss: host.origin,
        aud: mcpResourceUrl(host.origin),
        grant: record.id,
        scope,
      }),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope,
    };
  }

  private async findGrantByPrefix(manager: EntityManager, tenantId: string, prefix: string): Promise<AiApiKey | null> {
    return manager.getRepository(AiApiKey)
      .createQueryBuilder('grant')
      .addSelect('grant.key_hash')
      .where('grant.tenant_id = :tenantId', { tenantId })
      .andWhere('grant.key_prefix = :prefix', { prefix })
      .andWhere(`grant.credential_kind = 'oauth'`)
      .getOne();
  }

  /**
   * Refresh (RFC 6749 §6) with rotation. Only the grant and its owner are checked here: the MCP
   * endpoint checks the tenant's MCP access on every request, so a passing refusal there (a
   * provider being configured, MCP switched off for a while) does not end the connection.
   *
   * The successor of a token is derived from it. A token that is no longer current but whose
   * successor is the current one, rotated less than a minute ago, is a retry (a lost answer, two
   * refreshes at once): it gets that same successor. Any other genuine former token is a replay
   * and revokes the grant; a forged one is only refused.
   */
  private async refresh(body: Record<string, unknown>, host: McpOAuthHost): Promise<TokenResponse> {
    const presented = str(body.refresh_token);
    const parsed = parseRefreshToken(presented, host.tenantId);
    const invalid = () => new TokenEndpointError('invalid_grant', 'The refresh token is invalid, expired or revoked.');
    if (!presented || !parsed) throw invalid();
    const resource = str(body.resource);
    if (resource && !isThisMcpResource(resource, host.origin)) {
      throw new TokenEndpointError('invalid_target', 'resource must be this server\'s MCP endpoint.');
    }
    const clientId = str(body.client_id);

    type Outcome = { ok: false } | { ok: true; response: TokenResponse };
    const outcome = await this.tenantExecutor.run(host.tenantId, async (manager): Promise<Outcome> => {
      let grant = await this.findGrantByPrefix(manager, host.tenantId, parsed.prefix);
      if (!grant || !this.isLive(grant)) return { ok: false };
      if (clientId && clientId !== grant.oauth_client_id) return { ok: false };
      if (!(await this.ownerMayUseGrant(manager, grant))) return { ok: false };
      const successor = successorRefreshToken(host.tenantId, parsed.prefix, presented);

      if (refreshTokenMatchesHash(presented, grant.key_hash)) {
        const expiresAt = await this.grantExpiry(manager, host.tenantId, grant.created_at);
        if (expiresAt.getTime() <= Date.now()) return { ok: false };
        const previousRotation = grant.refresh_rotated_at;
        // Compare-and-swap on the current hash: of two refreshes with one token, one rotates.
        const [{ count }] = await manager.query(
          `WITH changed AS (
             UPDATE ai_api_keys
                SET key_hash = $3, refresh_rotated_at = now(), last_used_at = now(), expires_at = $4
              WHERE tenant_id = $1 AND id = $2 AND key_hash = $5 AND revoked_at IS NULL
             RETURNING 1
           ) SELECT count(*)::int AS count FROM changed`,
          [host.tenantId, grant.id, successor.hash, expiresAt, grant.key_hash],
        );
        if (Number(count) === 1) {
          if (!previousRotation || Date.now() - previousRotation.getTime() >= REFRESH_AUDIT_INTERVAL_MS) {
            await this.apiKeys.logAudit(
              {
                table: 'ai_api_keys',
                recordId: grant.id,
                action: 'update',
                before: null,
                after: { oauth: 'refreshed', expires_at: expiresAt.toISOString() },
                userId: grant.user_id,
                source: 'system',
              },
              { manager },
            );
          }
          return { ok: true, response: this.tokenResponse(host, grant, successor.token, MCP_OAUTH_SCOPE) };
        }
        // The other refresh rotated first: read the grant again, this is now a retry.
        grant = await this.findGrantByPrefix(manager, host.tenantId, parsed.prefix);
        if (!grant || !this.isLive(grant)) return { ok: false };
      }

      if (!parsed.genuine) return { ok: false };
      const rotatedAt = grant.refresh_rotated_at?.getTime() ?? 0;
      if (refreshTokenMatchesHash(successor.token, grant.key_hash) && Date.now() - rotatedAt < REFRESH_RETRY_WINDOW_MS) {
        return { ok: true, response: this.tokenResponse(host, grant, successor.token, MCP_OAUTH_SCOPE) };
      }
      // Issued here but long replaced: whoever holds it, the grant is compromised (OAuth 2.1 §4.3.1).
      await this.apiKeys.revokeKey(grant.id, {
        manager,
        tenantId: host.tenantId,
        userId: null,
        revocationReason: 'oauth_refresh_replayed',
      });
      return { ok: false };
    });
    if (!outcome.ok) throw invalid();
    return outcome.response;
  }

  private isLive(grant: AiApiKey): boolean {
    return !grant.revoked_at && !(grant.expires_at && grant.expires_at.getTime() <= Date.now());
  }

  /** The grant's owner still exists, is enabled and may use MCP credentials (ownerMayAuthenticate). */
  private async ownerMayUseGrant(manager: EntityManager, grant: AiApiKey): Promise<boolean> {
    const user = await this.users.findById(grant.user_id, { manager });
    return this.apiKeys.ownerMayAuthenticate(user);
  }

  // ---------------------------------------------------------------- revocation (RFC 7009)

  /** Revokes the grant behind a refresh or access token. Unknown tokens are not an error. */
  async revoke(body: Record<string, unknown>, host: McpOAuthHost): Promise<void> {
    const token = str(body.token);
    if (!token) throw new TokenEndpointError('invalid_request', 'token is required.');
    const clientId = str(body.client_id);
    await this.tenantExecutor.run(host.tenantId, async (manager) => {
      let grant: AiApiKey | null = null;
      const parsed = parseRefreshToken(token, host.tenantId);
      if (parsed?.genuine) {
        const found = await this.findGrantByPrefix(manager, host.tenantId, parsed.prefix);
        if (found && refreshTokenMatchesHash(token, found.key_hash)) grant = found;
      } else {
        const claims = verifyAccessToken(token, { issuer: host.origin, resource: mcpResourceUrl(host.origin) });
        if (claims && claims.tenant_id === host.tenantId) {
          grant = await manager.getRepository(AiApiKey).findOne({
            where: { id: claims.grant, tenant_id: host.tenantId, credential_kind: 'oauth' },
          });
        }
      }
      if (!grant || grant.revoked_at) return;
      if (clientId && clientId !== grant.oauth_client_id) return;
      await this.apiKeys.revokeKey(grant.id, {
        manager,
        tenantId: host.tenantId,
        userId: null,
        revocationReason: 'oauth_client_revocation',
      });
    });
  }

  // ---------------------------------------------------------------- resource server

  /**
   * The MCP guard's check of an access token: signature and family, issuer and audience of this
   * address, tenant of the host, then the grant row read inside the tenant (live, not revoked, not
   * expired, same owner) and its owner. Null when any check fails.
   */
  async authenticateAccessToken(
    token: string,
    host: McpOAuthHost,
  ): Promise<{ grant: AiApiKey; user: Awaited<ReturnType<UsersService['findById']>>; claims: McpAccessClaims } | null> {
    const claims = verifyAccessToken(token, { issuer: host.origin, resource: mcpResourceUrl(host.origin) });
    if (!claims || claims.tenant_id !== host.tenantId) return null;
    return this.tenantExecutor.run(host.tenantId, async (manager) => {
      const repo = manager.getRepository(AiApiKey);
      const grant = await repo.findOne({ where: { id: claims.grant, tenant_id: host.tenantId } });
      if (!grant || grant.credential_kind !== 'oauth' || grant.user_id !== claims.sub) return null;
      if (grant.revoked_at || (grant.expires_at && grant.expires_at.getTime() <= Date.now())) return null;
      const user = await this.users.findById(grant.user_id, { manager });
      if (!this.apiKeys.ownerMayAuthenticate(user)) return null;
      const now = Date.now();
      if (!grant.last_used_at || now - grant.last_used_at.getTime() >= LAST_USED_RESOLUTION_MS) {
        grant.last_used_at = new Date(now);
        await repo.update({ id: grant.id, tenant_id: host.tenantId }, { last_used_at: grant.last_used_at });
      }
      return { grant, user, claims };
    });
  }
}
