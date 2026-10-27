import '../i18n';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../locales/en/admin.json';
import fr from '../locales/fr/admin.json';
import de from '../locales/de/admin.json';
import es from '../locales/es/admin.json';
import { roleDescription, roleLabel, type RoleLabelSource } from './roleLabel';

// The seed in tenants.service.ts is the list of names this helper translates. A checkout
// without the backend skips that comparison. Vite rewrites a bare `new URL('…', import.meta.url)`,
// so the base URL goes through a variable.
type NodeFs = { existsSync(path: URL): boolean; readFileSync(path: URL, encoding: 'utf8'): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
const TEST_FILE = import.meta.url;
const SEED_FILE = new URL('../../../backend/src/tenants/tenants.service.ts', TEST_FILE);
const seedSource = fs.existsSync(SEED_FILE) ? fs.readFileSync(SEED_FILE, 'utf8') : null;

const BUDGET_ADMIN: RoleLabelSource = {
  role_name: 'Budget Administrator',
  role_description: 'Full control over budget management including budget lines, contracts, and reporting',
  is_built_in: true,
};

describe('roleLabel', () => {
  it('shows a shipped role in the reader language and leaves a custom role as stored', () => {
    const frT = i18n.getFixedT('fr');
    expect(roleLabel(BUDGET_ADMIN, frT)).toBe('Administrateur budget');
    expect(roleDescription(BUDGET_ADMIN, frT)).toBe(
      'Contrôle complet de la gestion budgétaire, y compris les lignes budgétaires, les contrats et les rapports',
    );
    expect(roleLabel({ role_name: 'Administrator', is_system: true }, frT)).toBe('Administrateur');
    expect(roleLabel({ name: 'IT Landscape Reader' }, frT)).toBe('Lecteur Cartographie SI');
    expect(roleLabel({ role_name: 'Acheteurs', role_description: 'Valide les achats', is_built_in: false, is_system: false }, frT)).toBe('Acheteurs');
    expect(roleDescription({ role_name: 'Acheteurs', role_description: 'Valide les achats', is_built_in: false, is_system: false }, frT)).toBe('Valide les achats');
  });

  it('shows a locked role under its stored name once that name or description is no longer the shipped text', () => {
    const frT = i18n.getFixedT('fr');
    const renamed = { ...BUDGET_ADMIN, role_name: 'Budget desk', role_description: 'Ancienne description' };
    expect(roleLabel(renamed, frT)).toBe('Budget desk');
    expect(roleDescription(renamed, frT)).toBe('Ancienne description');
    // The name still translates when only the description was changed.
    expect(roleLabel({ ...BUDGET_ADMIN, role_description: 'Texte maison' }, frT)).toBe('Administrateur budget');
    expect(roleDescription({ ...BUDGET_ADMIN, role_description: 'Texte maison' }, frT)).toBe('Texte maison');
    // A custom role that happens to carry a shipped name stays as stored.
    expect(roleLabel({ role_name: 'Budget Administrator', is_built_in: false, is_system: false }, frT)).toBe('Budget Administrator');
  });

  it('has a name and a description for every shipped role in the four languages', () => {
    const bundles = { en, fr, de, es };
    const english = en.roles.builtIn;
    expect(Object.keys(english)).toHaveLength(28);
    for (const [slug, copy] of Object.entries(english)) {
      const role = { role_name: copy.name, role_description: copy.description, is_built_in: true };
      for (const lang of ['en', 'fr', 'de', 'es'] as const) {
        const expected = bundles[lang].roles.builtIn[slug as keyof typeof english];
        expect(expected?.name, `${lang} ${slug} name`).toEqual(expect.any(String));
        expect(expected.name.length).toBeGreaterThan(0);
        expect(expected.description.length).toBeGreaterThan(0);
        const t = i18n.getFixedT(lang);
        expect(roleLabel(role, t)).toBe(expected.name);
        expect(roleDescription(role, t)).toBe(expected.description);
      }
    }
  });

  it.skipIf(!seedSource)('matches the roles the backend seeds, name and description', () => {
    const source = seedSource ?? '';
    const seeded = [
      ...source.matchAll(/name: '([^']+)',\s*description: '([^']+)'/g),
      ...source.matchAll(/ensureSystemRole\('([^']+)', '([^']+)'\)/g),
    ].map((match) => ({ name: match[1], description: match[2] }));
    expect(seeded).toHaveLength(Object.keys(en.roles.builtIn).length);
    for (const role of seeded) {
      const copy = Object.values(en.roles.builtIn).find((entry) => entry.name === role.name);
      expect(copy, role.name).toBeTruthy();
      expect(copy?.description).toBe(role.description);
    }
  });
});
