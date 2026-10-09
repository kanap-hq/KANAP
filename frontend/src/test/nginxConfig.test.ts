import { describe, expect, it } from 'vitest';
// The nginx configuration of the web image and its Dockerfile, as text.
import defaultConf from '../../nginx/default.conf?raw';
import headersConf from '../../nginx/security-headers.conf?raw';
import dockerfile from '../../Dockerfile?raw';

// Rules for the web container's nginx configuration: every response of the app carries the CSP
// and the shared headers, API responses keep the API's own headers once each, the CSP only lets
// the app call its own API, and the hashed assets keep their cache rule.

const FRAGMENT = 'security-headers.conf';

function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

type Block = { head: string; body: string };

/** Top-level `location` blocks of the server block, with their bodies (no nested blocks here). */
function locations(conf: string): Block[] {
  const text = stripComments(conf);
  const result: Block[] = [];
  const pattern = /\blocation\b([^{]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    let depth = 1;
    let index = pattern.lastIndex;
    while (depth > 0 && index < text.length) {
      if (text[index] === '{') depth += 1;
      if (text[index] === '}') depth -= 1;
      index += 1;
    }
    result.push({ head: match[1].trim(), body: text.slice(pattern.lastIndex, index - 1) });
  }
  return result;
}

/** Directives of the server block itself, outside its locations. */
function serverLevel(conf: string): string {
  let text = stripComments(conf);
  for (const block of locations(conf)) text = text.replace(block.body, '');
  return text;
}

function directives(body: string, name: string): string[] {
  return body
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part === name || part.startsWith(`${name} `));
}

const includesFragment = (body: string) => directives(body, 'include').includes(`include ${FRAGMENT}`);

const headerDirectives = directives(stripComments(headersConf), 'add_header');
const fragmentHeaders = headerDirectives.map((line) => line.split(' ')[1]);

const cspValue = (() => {
  const match = /set \$csp "([^"]*)"/.exec(stripComments(defaultConf));
  return match ? match[1] : '';
})();

describe('web container nginx configuration', () => {
  const blocks = locations(defaultConf);

  it('finds the locations of default.conf', () => {
    expect(blocks.map((block) => block.head)).toEqual(
      expect.arrayContaining(['/api/', '= /index.html', '^~ /assets/', '/']),
    );
  });

  it('sets the shared headers on every response, error responses included', () => {
    expect(fragmentHeaders).toEqual([
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Frame-Options',
    ]);
    for (const line of headerDirectives) expect(line.endsWith(' always')).toBe(true);
    expect(headersConf).toContain('X-Content-Type-Options "nosniff"');
    expect(headersConf).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
    expect(headersConf).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=()"');
    expect(headersConf).toContain('X-Frame-Options "SAMEORIGIN"');
  });

  it('leaves clipboard access and HTTPS pinning to others', () => {
    // The app copies to the clipboard; HSTS belongs to the TLS proxy in front of the container.
    expect(stripComments(headersConf)).not.toMatch(/clipboard/i);
    expect(stripComments(defaultConf + headersConf)).not.toMatch(/Strict-Transport-Security/i);
  });

  it('hides the nginx version', () => {
    expect(directives(serverLevel(defaultConf), 'server_tokens')).toEqual(['server_tokens off']);
  });

  it('gives every location headers of its own, so none inherits the server-level set', () => {
    // A location without any add_header inherits the app's CSP and shared headers from the
    // server level: on /api/ that would add a second CSP next to the API's own.
    expect(includesFragment(serverLevel(defaultConf))).toBe(true);
    for (const block of blocks) {
      const own = directives(block.body, 'add_header').length > 0 || includesFragment(block.body);
      expect({ location: block.head, ownHeaders: own }).toEqual({ location: block.head, ownHeaders: true });
    }
  });

  it('sends the CSP and the shared headers in every location that serves the app', () => {
    for (const block of blocks) {
      if (directives(block.body, 'proxy_pass').length > 0) continue;
      expect({
        location: block.head,
        includes: includesFragment(block.body),
        headers: directives(block.body, 'add_header'),
      }).toEqual({
        location: block.head,
        includes: true,
        headers: expect.arrayContaining(['add_header Content-Security-Policy $csp always']),
      });
    }
  });

  it('passes the API headers through and adds only Permissions-Policy on proxied responses', () => {
    const proxied = blocks.filter((block) => directives(block.body, 'proxy_pass').length > 0);
    expect(proxied.map((block) => block.head)).toContain('/api/');
    const permissionsPolicy = headerDirectives.find((line) => line.startsWith('add_header Permissions-Policy '));
    expect(permissionsPolicy).toBeDefined();
    for (const block of proxied) {
      // The API sets its own CSP and shared headers: nginx neither hides nor repeats them.
      expect({
        location: block.head,
        headers: directives(block.body, 'add_header'),
        includes: directives(block.body, 'include'),
        hidden: directives(block.body, 'proxy_hide_header'),
      }).toEqual({ location: block.head, headers: [permissionsPolicy], includes: [], hidden: [] });
    }
  });

  it('only lets the app connect to its own site and to the API origin set at build time', () => {
    const connectSrc = cspValue
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('connect-src'));
    expect(connectSrc).toBe("connect-src 'self'__KANAP_API_ORIGIN__");
    for (const source of (connectSrc ?? '').split(/\s+/).slice(1)) {
      expect(['https:', 'http:', '*', 'wss:', 'ws:']).not.toContain(source);
    }
    // The Dockerfile replaces the placeholder in the copied configuration and checks it is gone.
    expect(dockerfile).toContain('s#__KANAP_API_ORIGIN__#${origin}#g');
    expect(dockerfile).toContain("! grep -q '__KANAP_API_ORIGIN__' \"$conf\"");
  });

  it('builds the image whatever VITE_API_URL holds, with the former connect-src as fallback', () => {
    // An absolute URL whose host cannot be read, or a placeholder left in place, gives
    // connect-src 'self' https: with a notice in the build output.
    expect(dockerfile).toContain('origin=" https:"');
    expect(dockerfile).toContain('s#__KANAP_API_ORIGIN__# https:#g');
    expect(dockerfile).not.toMatch(/\bexit 1\b/);
  });

  it('ships the shared headers file where the include finds it', () => {
    expect(dockerfile).toContain('COPY nginx/default.conf /etc/nginx/conf.d/default.conf');
    expect(dockerfile).toContain(`COPY nginx/${FRAGMENT} /etc/nginx/${FRAGMENT}`);
  });

  it('marks hashed assets immutable on successful responses only', () => {
    const immutable = blocks.flatMap((block) =>
      directives(block.body, 'add_header').filter((line) => line.startsWith('add_header Cache-Control') && line.includes('immutable')),
    );
    expect(immutable.length).toBeGreaterThan(0);
    for (const line of immutable) expect(line.endsWith(' always')).toBe(false);
  });

  it('passes the browser scheme to the API and forwards client addresses unchanged', () => {
    const text = stripComments(defaultConf);
    expect(text).toMatch(
      /map \$http_x_forwarded_proto \$forwarded_proto \{\s*default \$http_x_forwarded_proto;\s*'' \$scheme;\s*\}/,
    );
    const api = blocks.find((block) => block.head === '/api/');
    expect(api && directives(api.body, 'proxy_set_header')).toEqual(
      expect.arrayContaining(['proxy_set_header X-Forwarded-Proto $forwarded_proto']),
    );
    // X-Forwarded-For reaches the API as the proxy in front of this container sent it.
    expect(text).not.toMatch(/X-Forwarded-For/i);
  });
});
