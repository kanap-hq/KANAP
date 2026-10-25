import { describe, expect, it } from 'vitest';
import es from './es/it.json';

const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>('./es/*.json', { eager: true });

function operationsValues(tree: unknown): string[] {
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => {
    if (key === 'operations' && typeof value === 'string') return [value];
    return operationsValues(value);
  });
}

// The Operations tab has one Spanish name on the application, technology and asset workspaces.
describe('Spanish operations tab', () => {
  it('is Operaciones on the three workspaces', () => {
    expect(es.workspace.application.tabs.operations).toBe('Operaciones');
    expect(es.workspace.technology.tabs.operations).toBe('Operaciones');
    expect(es.workspace.asset.tabs.operations).toBe('Operaciones');
  });

  it('keeps no operations key translated as Operación', () => {
    const singular = Object.entries(localeFiles).flatMap(([file, module]) =>
      operationsValues(module.default)
        .filter((text) => text === 'Operación')
        .map(() => file),
    );
    expect(singular).toEqual([]);
  });
});
