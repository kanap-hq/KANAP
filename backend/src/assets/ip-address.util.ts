import { isIP } from 'node:net';

/** An IPv4 or IPv6 address. `999.999.1.1` and `not-an-ip` are refused; a blank cell is not an address. */
export function isValidIpAddress(value: string): boolean {
  return isIP(value) !== 0;
}
