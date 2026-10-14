import { Body, Controller, Get, HttpException, NotFoundException, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { assertRequestOriginAllowed } from '../../common/cors-policy';
import { throwFeatureDisabled } from '../../common/feature-gates';
import { RATE_LIMITS } from '../../common/rate-limit';
import { RateLimitGuard } from '../../common/rate-limit.guard';
import { SkipTenantTransaction } from '../../common/skip-tenant-transaction.decorator';
import { Features } from '../../config/features';
import { AuthorizationError, McpOAuthHost, McpOAuthService, TokenEndpointError } from './mcp-oauth.service';
import {
  MCP_OAUTH_SCOPES_SUPPORTED,
  mcpResourceUrl,
  oauthHostOf,
} from './mcp-oauth.util';

/** The host of a request, or 404 when the request is not on a tenant address or MCP is off. */
function requireHost(req: any): McpOAuthHost {
  if (!Features.AI_MCP_ENABLED) throwFeatureDisabled('ai_mcp');
  const host = oauthHostOf(req);
  if (!host) throw new NotFoundException();
  return host;
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * Discovery documents (RFC 9728, RFC 8414). nginx sends `/.well-known/oauth-*` to the API as is
 * (infra/nginx, frontend/nginx): the issuer is the tenant's address without a path.
 */
@Controller('.well-known')
@SkipTenantTransaction()
export class McpOAuthMetadataController {
  private protectedResource(req: any) {
    const host = requireHost(req);
    return {
      resource: mcpResourceUrl(host.origin),
      authorization_servers: [host.origin],
      scopes_supported: [...MCP_OAUTH_SCOPES_SUPPORTED],
      bearer_methods_supported: ['header'],
      resource_name: 'KANAP',
    };
  }

  @Get('oauth-protected-resource/api/ai/mcp')
  protectedResourceForPath(@Req() req: any) {
    return this.protectedResource(req);
  }

  @Get('oauth-protected-resource')
  protectedResourceAtRoot(@Req() req: any) {
    return this.protectedResource(req);
  }

  @Get('oauth-authorization-server')
  authorizationServer(@Req() req: any) {
    const { origin } = requireHost(req);
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      scopes_supported: [...MCP_OAUTH_SCOPES_SUPPORTED],
      authorization_response_iss_parameter_supported: true,
    };
  }
}

/**
 * The authorization and token routes (`/api/oauth/*`). The consent screen is the web app's
 * `/oauth/authorize` page: it reads the request with `GET authorize/request` and posts the
 * user's answer to `POST authorize/decision`, both under the web session.
 */
@Controller('oauth')
@SkipTenantTransaction()
export class McpOAuthController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Get('authorize')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.mcpOAuthAuthorize })
  async authorize(@Req() req: any, @Query() query: Record<string, unknown>, @Res() res: Response) {
    const host = requireHost(req);
    noStore(res);
    try {
      await this.oauth.validateAuthorization(query, host);
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      const redirect = this.oauth.errorRedirect(error, host);
      if (redirect) return res.redirect(302, redirect);
      // The redirect URI is not verified: the error is shown here, never sent there.
      return res.status(400).json({ error: error.error, error_description: error.description });
    }
    // The consent page gets the request exactly as the client sent it.
    const original = String(req.originalUrl ?? req.url ?? '');
    const queryIndex = original.indexOf('?');
    const search = queryIndex >= 0 ? original.slice(queryIndex) : '';
    return res.redirect(302, `${host.origin}/oauth/authorize${search}`);
  }

  @Get('authorize/request')
  @UseGuards(RateLimitGuard, JwtAuthGuard)
  @Throttle({ default: RATE_LIMITS.mcpOAuthAuthorize })
  async describe(@Req() req: any, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const host = requireHost(req);
    noStore(res);
    try {
      return await this.oauth.describeRequest(query, host, String(req.user?.sub ?? ''));
    } catch (error) {
      throw this.consentError(error, host);
    }
  }

  @Post('authorize/decision')
  @UseGuards(RateLimitGuard, JwtAuthGuard)
  @Throttle({ default: RATE_LIMITS.mcpOAuthAuthorize })
  async decide(@Req() req: any, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    // A signed-in browser approves with a POST from the app's own origin only.
    assertRequestOriginAllowed(req);
    const host = requireHost(req);
    noStore(res);
    const params = { ...(body ?? {}) };
    const approve = params.approve === true;
    const remember = params.remember === true;
    delete params.approve;
    delete params.remember;
    try {
      return await this.oauth.decide(params, host, String(req.user?.sub ?? ''), { approve, remember });
    } catch (error) {
      throw this.consentError(error, host);
    }
  }

  /** An error of the consent routes: 400 with the OAuth error, and where to send the client when it is known. */
  private consentError(error: unknown, host: McpOAuthHost): unknown {
    if (!(error instanceof AuthorizationError)) return error;
    const status = error.error === 'access_denied' ? 403 : 400;
    return new HttpException(
      {
        statusCode: status,
        error: error.error,
        error_description: error.description,
        message: error.description,
        redirect_to: this.oauth.errorRedirect(error, host),
      },
      status,
    );
  }

  @Post('token')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.mcpOAuthToken })
  async token(@Req() req: any, @Body() body: Record<string, unknown>, @Res() res: Response) {
    const host = requireHost(req);
    noStore(res);
    try {
      return res.status(200).json(await this.oauth.token(body ?? {}, host));
    } catch (error) {
      if (!(error instanceof TokenEndpointError)) throw error;
      return res.status(error.status).json({ error: error.error, error_description: error.description });
    }
  }

  @Post('revoke')
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.mcpOAuthToken })
  async revoke(@Req() req: any, @Body() body: Record<string, unknown>, @Res() res: Response) {
    const host = requireHost(req);
    noStore(res);
    try {
      await this.oauth.revoke(body ?? {}, host);
    } catch (error) {
      if (!(error instanceof TokenEndpointError)) throw error;
      return res.status(error.status).json({ error: error.error, error_description: error.description });
    }
    return res.status(200).json({});
  }
}
