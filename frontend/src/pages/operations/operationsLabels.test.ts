import { describe, expect, it } from 'vitest';
import fr from '../../locales/fr/ops.json';
import de from '../../locales/de/ops.json';
import es from '../../locales/es/ops.json';

// The administration cards address the reader the same way: each description is an instruction
// in the formal imperative, as elsewhere in the app ("Définissez", "Legen Sie", "Defina").
const descriptions = (cards: Record<string, string>) => Object.entries(cards).filter(([key]) => key.endsWith('Desc'));

describe('administration card descriptions', () => {
  it('use the formal imperative in French', () => {
    expect(descriptions(fr.operations.cards).filter(([, text]) => !/^\p{Lu}\p{Ll}+ez\b/u.test(text))).toEqual([]);
  });
  it('use the formal imperative in German', () => {
    expect(descriptions(de.operations.cards).filter(([, text]) => !/^\p{Lu}\p{Ll}+ Sie\b/u.test(text))).toEqual([]);
  });
  it('use the formal imperative in Spanish', () => {
    expect(descriptions(es.operations.cards).filter(([, text]) => /^\p{Lu}\p{Ll}+(ar|er|ir)\b/u.test(text))).toEqual([]);
  });
});
