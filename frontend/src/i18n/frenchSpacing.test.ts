import { describe, expect, it } from 'vitest';
import i18n, { i18nReady } from './index';
import { frenchSpacing } from './formatters';

const NO_BREAK_SPACE = '\u00a0';
const NARROW_NO_BREAK_SPACE = '\u202f';

describe('frenchSpacing', () => {
  it('puts a no-break space inside guillemets, after the opening one and before the closing one', () => {
    expect(frenchSpacing('« Lecteur »')).toBe(`«${NO_BREAK_SPACE}Lecteur${NO_BREAK_SPACE}»`);
  });

  it('puts a no-break space before a colon', () => {
    expect(frenchSpacing('Budget : 12')).toBe(`Budget${NO_BREAK_SPACE}: 12`);
  });

  it('puts a narrow no-break space before a semicolon, an exclamation mark and a question mark', () => {
    expect(frenchSpacing('un ; deux')).toBe(`un${NARROW_NO_BREAK_SPACE}; deux`);
    expect(frenchSpacing('Oui !')).toBe(`Oui${NARROW_NO_BREAK_SPACE}!`);
    expect(frenchSpacing('Vraiment ?')).toBe(`Vraiment${NARROW_NO_BREAK_SPACE}?`);
  });

  it('leaves a text already written with non-breaking spaces as it is', () => {
    const text = `«${NO_BREAK_SPACE}Lecteur${NO_BREAK_SPACE}»${NO_BREAK_SPACE}: oui${NARROW_NO_BREAK_SPACE}; non${NARROW_NO_BREAK_SPACE}! quoi${NARROW_NO_BREAK_SPACE}?`;
    expect(frenchSpacing(text)).toBe(text);
  });

  it('adds no space where the text has none', () => {
    expect(frenchSpacing('Budget: 12')).toBe('Budget: 12');
    expect(frenchSpacing('«Lecteur»')).toBe('«Lecteur»');
  });

  it('leaves an English text untouched', () => {
    const text = 'Reader rights: budget, applications; ask an administrator!';
    expect(frenchSpacing(text)).toBe(text);
  });

  it('gives the same result when applied twice', () => {
    const once = frenchSpacing('« Lecteur » : oui ; non ! quoi ?');
    expect(once).toBe(`«${NO_BREAK_SPACE}Lecteur${NO_BREAK_SPACE}»${NO_BREAK_SPACE}: oui${NARROW_NO_BREAK_SPACE}; non${NARROW_NO_BREAK_SPACE}! quoi${NARROW_NO_BREAK_SPACE}?`);
    expect(frenchSpacing(once)).toBe(once);
  });
});

describe('the frenchSpacing post-processor', () => {
  it('applies to French only', async () => {
    await i18nReady;
    i18n.addResourceBundle('en', 'common', { frenchSpacingProbe: 'Role « Reader » : yes ; no ! what ?' }, true, true);
    i18n.addResourceBundle('fr', 'common', { frenchSpacingProbe: 'Rôle « Lecteur » : oui ; non ! quoi ?' }, true, true);

    expect(i18n.t('common:frenchSpacingProbe', { lng: 'en' })).toBe('Role « Reader » : yes ; no ! what ?');
    expect(i18n.t('common:frenchSpacingProbe', { lng: 'fr' })).toBe(
      `Rôle «${NO_BREAK_SPACE}Lecteur${NO_BREAK_SPACE}»${NO_BREAK_SPACE}: oui${NARROW_NO_BREAK_SPACE}; non${NARROW_NO_BREAK_SPACE}! quoi${NARROW_NO_BREAK_SPACE}?`,
    );
  });
});
