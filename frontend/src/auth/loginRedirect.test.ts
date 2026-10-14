import { describe, expect, it } from 'vitest';
import { oauthReturnPath, sanitizeLoginRedirect } from './loginRedirect';

describe('sanitizeLoginRedirect', () => {
  it('preserves internal paths with search params and hashes', () => {
    expect(sanitizeLoginRedirect('/portfolio/tasks/42?focus=activity#comments')).toBe(
      '/portfolio/tasks/42?focus=activity#comments',
    );
  });

  it('rejects external, protocol-relative, and auth redirects', () => {
    expect(sanitizeLoginRedirect('https://example.com/path')).toBe('/');
    expect(sanitizeLoginRedirect('//example.com/path')).toBe('/');
    expect(sanitizeLoginRedirect('/login?redirectTo=%2Fportfolio%2Ftasks')).toBe('/');
  });

  it('falls back to the home page for missing values', () => {
    expect(sanitizeLoginRedirect(undefined)).toBe('/');
    expect(sanitizeLoginRedirect('')).toBe('/');
  });
});

describe('oauthReturnPath', () => {
  const consent = '/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Fmeta&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s1';

  it('keeps the consent page of an MCP connection with its whole query', () => {
    expect(oauthReturnPath(consent)).toBe(consent);
  });

  it('keeps the consent page through the SSO sanitizer, as the SSO callback does', () => {
    expect(sanitizeLoginRedirect(consent)).toBe(consent);
  });

  it.each([
    '//evil.example/oauth/authorize?x=1',
    '/oauth/authorizeX?x=1',
    '/oauth/authorize',
    '/oauth/authorize/../../settings?x=1',
    'https://evil.example/oauth/authorize?x=1',
    `${window.location.origin}/oauth/authorize?x=1`,
    '/settings',
    '/',
    '',
    null,
    undefined,
    42,
  ])('sends anything else (%s) to the home page', (value) => {
    expect(oauthReturnPath(value)).toBe('/');
  });
});
