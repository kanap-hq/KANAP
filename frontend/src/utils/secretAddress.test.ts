import { describe, expect, it } from 'vitest';
import { glpiAddressRoot, isNewSecretAddress } from './secretAddress';

describe('isNewSecretAddress', () => {
  it('treats spellings of one address as the same address', () => {
    expect(isNewSecretAddress('HTTPS://Host.example.com:443/base/', 'https://host.example.com/base')).toBe(false);
    expect(isNewSecretAddress('', null)).toBe(false);
  });

  it('counts a new host, path, port or query', () => {
    expect(isNewSecretAddress('https://other.example.com/base', 'https://host.example.com/base')).toBe(true);
    expect(isNewSecretAddress('https://host.example.com/other', 'https://host.example.com/base')).toBe(true);
    expect(isNewSecretAddress('https://host.example.com:8443/base', 'https://host.example.com/base')).toBe(true);
    expect(isNewSecretAddress('https://host.example.com/base?x=1', 'https://host.example.com/base')).toBe(true);
  });

  it('counts credentials written in the address, as the server does', () => {
    expect(isNewSecretAddress('https://a@host.example.com/', 'https://host.example.com/')).toBe(true);
    expect(isNewSecretAddress('https://a:b@host.example.com/', 'https://a@host.example.com/')).toBe(true);
  });

  it('reads a GLPI API route as its installation root', () => {
    expect(isNewSecretAddress(
      glpiAddressRoot('https://glpi.example.com/helpdesk/apirest.php/initSession'),
      glpiAddressRoot('https://glpi.example.com/helpdesk/'),
    )).toBe(false);
  });
});
