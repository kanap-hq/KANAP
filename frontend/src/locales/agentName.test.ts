import { describe, expect, it } from 'vitest';
import { AGENT_NAME } from '../config/product';

// The AI agent's name is one constant (`config/product.ts`), given to every text as `{{agent}}`
// (`i18n/index.ts`), so that a new name is one change. The server's texts have their own check
// (`backend/src/config/__tests__/agent-name.spec.ts`).
const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true });

const NAME = new RegExp(`\\b${AGENT_NAME}\\b`);

function strings(tree: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof tree === 'string') return [[path.join('.'), tree]];
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => strings(value, [...path, key]));
}

describe('agent name in the locale files', () => {
  it('writes {{agent}}, never the name itself, in every locale', () => {
    const offenders = Object.entries(localeFiles).flatMap(([file, module]) =>
      strings(module.default)
        .filter(([, text]) => NAME.test(text))
        .map(([key, text]) => `${file} ${key}: ${text}`),
    );
    expect(offenders).toEqual([]);
  });

  it('names the agent in each language', () => {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      expect(localeFiles[`./${lang}/nav.json`]?.default).toMatchObject({ workspaces: { ai: '{{agent}}' } });
    }
  });
});
