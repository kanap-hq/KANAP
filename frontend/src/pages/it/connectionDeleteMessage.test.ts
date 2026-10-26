import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en/it.json';
import fr from '../../locales/fr/it.json';
import de from '../../locales/de/it.json';
import es from '../../locales/es/it.json';
import { connectionDeleteMessage } from './connectionDeleteMessage';

const RESOURCES = { en, fr, de, es } as const;

async function translator(lng: keyof typeof RESOURCES) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng,
    resources: { [lng]: { it: RESOURCES[lng] } },
    defaultNS: 'it',
    interpolation: { escapeValue: false },
  });
  return i18n.t.bind(i18n);
}

describe('connectionDeleteMessage', () => {
  it('names the hops deleted with the connection, and keeps the bindings clause', async () => {
    const t = await translator('en');
    expect(connectionDeleteMessage(t, 0, 0)).toBe('This will permanently delete this connection.');
    expect(connectionDeleteMessage(t, 0, 1)).toBe(
      'This will permanently delete this connection and unlink it from 1 interface binding. The interfaces themselves are not deleted.',
    );
    expect(connectionDeleteMessage(t, 0, 2)).toBe(
      'This will permanently delete this connection and unlink it from 2 interface bindings. The interfaces themselves are not deleted.',
    );
    expect(connectionDeleteMessage(t, 1, 0)).toBe('This will permanently delete this connection and its 1 hop.');
    expect(connectionDeleteMessage(t, 2, 0)).toBe('This will permanently delete this connection and its 2 hops.');
    expect(connectionDeleteMessage(t, 1, 1)).toBe(
      'This will permanently delete this connection and its 1 hop, and unlink it from 1 interface binding. The interfaces themselves are not deleted.',
    );
    expect(connectionDeleteMessage(t, 3, 2)).toBe(
      'This will permanently delete this connection and its 3 hops, and unlink it from 2 interface bindings. The interfaces themselves are not deleted.',
    );
  });

  it.each([
    ['fr', {
      none: 'Cette connexion sera définitivement supprimée.',
      oneHop: 'Cette connexion sera définitivement supprimée, ainsi que son 1 saut.',
      hops: 'Cette connexion sera définitivement supprimée, ainsi que ses 2 sauts.',
      both: 'Cette connexion sera définitivement supprimée, ainsi que ses 2 sauts, et détachée de 1 liaison d\'interface. Les interfaces elles-mêmes ne sont pas supprimées.',
      bindings: 'Cette connexion sera définitivement supprimée et détachée de 2 liaisons d\'interface. Les interfaces elles-mêmes ne sont pas supprimées.',
    }],
    ['de', {
      none: 'Diese Verbindung wird dauerhaft gelöscht.',
      oneHop: 'Diese Verbindung wird dauerhaft gelöscht, zusammen mit ihrem 1 Hop.',
      hops: 'Diese Verbindung wird dauerhaft gelöscht, zusammen mit ihren 2 Hops.',
      both: 'Diese Verbindung wird dauerhaft gelöscht, zusammen mit ihren 2 Hops, und von 1 Schnittstellen-Bindung getrennt. Die Schnittstellen selbst werden nicht gelöscht.',
      bindings: 'Diese Verbindung wird dauerhaft gelöscht und von 2 Schnittstellen-Bindungen getrennt. Die Schnittstellen selbst werden nicht gelöscht.',
    }],
    ['es', {
      none: 'Esta conexión se eliminará de forma permanente.',
      oneHop: 'Esta conexión se eliminará de forma permanente, junto con su 1 salto.',
      hops: 'Esta conexión se eliminará de forma permanente, junto con sus 2 saltos.',
      both: 'Esta conexión se eliminará de forma permanente, junto con sus 2 saltos, y se desvinculará de 1 enlace de interfaz. Las interfaces en sí no se eliminan.',
      bindings: 'Esta conexión se eliminará de forma permanente y se desvinculará de 2 enlaces de interfaz. Las interfaces en sí no se eliminan.',
    }],
  ] as const)('says it in %s', async (lng, expected) => {
    const t = await translator(lng);
    expect(connectionDeleteMessage(t, 0, 0)).toBe(expected.none);
    expect(connectionDeleteMessage(t, 1, 0)).toBe(expected.oneHop);
    expect(connectionDeleteMessage(t, 2, 0)).toBe(expected.hops);
    expect(connectionDeleteMessage(t, 2, 1)).toBe(expected.both);
    expect(connectionDeleteMessage(t, 0, 2)).toBe(expected.bindings);
    for (const text of Object.values(expected)) expect(text).not.toMatch(/\{\{/);
  });
});
