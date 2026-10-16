import { describe, expect, it } from 'vitest';

const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>('./{fr,es}/*.json', { eager: true });

function strings(tree: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof tree === 'string') return [[path.join('.'), tree]];
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => strings(value, [...path, key]));
}

// French and Spanish determiners agree with the noun ("toutes les tâches", "todas las tareas").
// A determiner followed by an interpolated noun cannot agree: write the whole label per noun.
const GENDERED_DETERMINER_BEFORE_NOUN = /\b(tous|toutes|todos|todas) (les|los|las) \{\{(?!count\}\})/i;

describe('noun agreement in French and Spanish', () => {
  it('puts no gendered determiner before an interpolated noun', () => {
    const offenders = Object.entries(localeFiles).flatMap(([file, module]) =>
      strings(module.default)
        .filter(([, text]) => GENDERED_DETERMINER_BEFORE_NOUN.test(text))
        .map(([key, text]) => `${file} ${key}: ${text}`),
    );
    expect(offenders).toEqual([]);
  });
});
