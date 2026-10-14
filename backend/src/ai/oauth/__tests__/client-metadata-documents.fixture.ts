/** Client metadata documents of real MCP clients, as served at their client_id on 2026-10-14. */

export const CHATGPT_CIMD = 'https://chatgpt.com/oauth/client.json';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const CHATGPT_CLIENT_METADATA = {
  client_id: CHATGPT_CIMD,
  client_uri: 'https://chatgpt.com/',
  redirect_uris: [CHATGPT_REDIRECT],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  client_name: 'ChatGPT',
  logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
  token_endpoint_auth_signing_alg: 'RS256',
  jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
};

export const GROK_CIMD = 'https://grok.com/oauth/mcp-client.json';
export const GROK_REDIRECT = 'https://grok.com/connectors-oauth-exchange-code/';
export const GROK_CLIENT_METADATA = {
  client_id: GROK_CIMD,
  client_name: 'Grok',
  client_uri: 'https://grok.com',
  logo_uri: 'https://grok.com/icon-512x512.png',
  redirect_uris: [GROK_REDIRECT, 'https://console.x.ai/connectors-oauth-exchange-code/'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};
