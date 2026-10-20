import { describe, expect, it } from 'vitest';
import { CURRENCY_OPTIONS } from './isoOptions';

// The backend file is the list the API accepts. The frontend copy has to stay identical.
// A checkout without the backend skips the comparison. Vite rewrites a bare
// `new URL('…', import.meta.url)`, so the base URL goes through a variable.

type NodeFs = {
  existsSync(path: URL): boolean;
  readFileSync(path: URL, encoding: 'utf8'): string;
};

const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
const TEST_FILE = import.meta.url;
const BACKEND_FILE = new URL('../../../backend/src/currency/iso-currencies.ts', TEST_FILE);
const hasBackend = fs.existsSync(BACKEND_FILE);

function backendCurrencies(): Array<{ code: string; name: string }> {
  const source = fs.readFileSync(BACKEND_FILE, 'utf8');
  return [...source.matchAll(/^  ([A-Z]{3}): '([^']*)',$/gm)].map((match) => ({
    code: match[1],
    name: match[2],
  }));
}

describe('ISO currency codes', () => {
  it.skipIf(!hasBackend)('matches the backend list exactly', () => {
    const backend = backendCurrencies();
    const frontendCodes = CURRENCY_OPTIONS.map((option) => option.code);
    const backendCodes = backend.map((option) => option.code);
    expect(new Set(frontendCodes)).toEqual(new Set(backendCodes));
    expect(frontendCodes).toEqual(backendCodes);
    expect(CURRENCY_OPTIONS).toEqual(backend);
  });
});
