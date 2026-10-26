import { BadRequestException, HttpException } from '@nestjs/common';
import { NetboxApiError, NetboxApiErrorCode } from './netbox.types';

/**
 * Stable codes the Netbox screens translate (`errors:<code>`). The English
 * sentence travels with the response for the API and as a fallback. A raw
 * system message (a refused connection, an internal address) never leaves
 * the server: it stays in `detail`, for the log only.
 */
export const NETBOX_ERROR_CODES = [
  'netbox_unreachable',
  'netbox_dns',
  'netbox_private_host',
  'netbox_timeout',
  'netbox_auth',
  'netbox_base_url_invalid',
  'netbox_address_too_long',
  'netbox_timeout_invalid',
  'netbox_token_missing',
  'netbox_tls',
  'netbox_invalid_response',
  'netbox_rate_limited',
  'netbox_token_unreadable',
] as const;

export type NetboxErrorCode = (typeof NETBOX_ERROR_CODES)[number];

export const NETBOX_ERROR_MESSAGES: Record<NetboxErrorCode, string> = {
  netbox_unreachable: 'KANAP could not reach the Netbox server.',
  netbox_dns: 'KANAP could not find the Netbox server from its address.',
  netbox_private_host: 'This address points at a private network. Use the public address of the Netbox server.',
  netbox_timeout: 'The Netbox server did not answer in time.',
  netbox_auth: 'Netbox rejected the API token. Check that it was copied in full and that it can read the inventory.',
  netbox_base_url_invalid: 'The Netbox address must be a full web address starting with http:// or https://.',
  netbox_address_too_long: 'The Netbox address must be at most 2048 characters long.',
  netbox_timeout_invalid: 'The request timeout must be a whole number of seconds between 5 and 120, or empty to use the default.',
  netbox_token_missing: 'No Netbox API token is saved yet. Add one in Netbox under your profile, API tokens, then paste it here.',
  netbox_tls: 'The Netbox certificate could not be verified. Turn on Ignore certificate errors only if you trust this server.',
  netbox_invalid_response: 'The Netbox server returned an answer KANAP could not read. Check that the address points at Netbox.',
  netbox_rate_limited: 'Netbox is refusing more requests for the moment. Try again in a few minutes.',
  netbox_token_unreadable: 'The saved Netbox token cannot be read on this server. Enter the token again and save.',
};

export type NetboxFailure = {
  code: NetboxErrorCode;
  message: string;
  /** The original text, when it must not be shown. Log it, do not return it. */
  detail?: string;
};

const API_CODES: Record<NetboxApiErrorCode, NetboxErrorCode> = {
  unauthorized: 'netbox_auth',
  forbidden: 'netbox_auth',
  not_found: 'netbox_invalid_response',
  timeout: 'netbox_timeout',
  rate_limited: 'netbox_rate_limited',
  provider_unavailable: 'netbox_unreachable',
  invalid_response: 'netbox_invalid_response',
  tls_untrusted: 'netbox_tls',
  dns: 'netbox_dns',
};

const CODE_SET = new Set<string>(NETBOX_ERROR_CODES);

/** A refused socket, a DNS failure, or an address: none of that is shown. */
const SENSITIVE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|EHOSTUNREACH|ECONNABORTED|getaddrinfo|\b(?:\d{1,3}\.){3}\d{1,3}\b|\[[0-9a-f:]+\]/i;

const MESSAGE_CODES: Array<[string, NetboxErrorCode]> = [
  ['Unable to resolve target host.', 'netbox_dns'],
  ['Private or internal hosts are not allowed.', 'netbox_private_host'],
  ['Invalid target host.', 'netbox_private_host'],
  ['A URL is required.', 'netbox_base_url_invalid'],
  ['Value must be a valid HTTP(S) URL.', 'netbox_base_url_invalid'],
  ['Only http:// or https:// URLs are supported.', 'netbox_base_url_invalid'],
  ['URLs must not include embedded credentials.', 'netbox_base_url_invalid'],
];

export function isNetboxErrorCode(value: string): value is NetboxErrorCode {
  return CODE_SET.has(value);
}

export function netboxBadRequest(code: NetboxErrorCode): BadRequestException {
  return new BadRequestException({ code, message: NETBOX_ERROR_MESSAGES[code] });
}

/** The code a connection failure deserves, and a sentence safe to show. */
export function netboxFailureOf(error: unknown): NetboxFailure {
  if (error instanceof NetboxApiError) {
    return pack(API_CODES[error.errorCode] ?? 'netbox_unreachable', error.message);
  }
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === 'object') {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string' && isNetboxErrorCode(code)) {
        const message = (response as { message?: unknown }).message;
        return pack(code, typeof message === 'string' ? message : undefined);
      }
    }
    const text = httpExceptionMessage(error);
    const mapped = text ? messageCode(text) : null;
    if (mapped) return pack(mapped, text ?? undefined);
    return pack('netbox_unreachable', text ?? undefined);
  }
  const text = error instanceof Error ? error.message : '';
  return pack('netbox_unreachable', text || undefined);
}

function pack(code: NetboxErrorCode, raw?: string): NetboxFailure {
  const message = NETBOX_ERROR_MESSAGES[code];
  if (raw && raw !== message && SENSITIVE.test(raw)) {
    return { code, message, detail: raw };
  }
  return { code, message };
}

function messageCode(text: string): NetboxErrorCode | null {
  const exact = MESSAGE_CODES.find(([sentence]) => sentence === text);
  if (exact) return exact[1];
  if (text.startsWith('The Netbox address must be at most')) return 'netbox_address_too_long';
  if (text.startsWith('The Netbox address must') || text.startsWith('Add the Netbox address')) {
    return 'netbox_base_url_invalid';
  }
  if (text.startsWith('The request timeout must')) return 'netbox_timeout_invalid';
  if (text.startsWith('No Netbox API token')) return 'netbox_token_missing';
  if (text.startsWith('The saved Netbox token cannot be read')) return 'netbox_token_unreadable';
  return null;
}

function httpExceptionMessage(error: HttpException): string | null {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown })?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return null;
}
