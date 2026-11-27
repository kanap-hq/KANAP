import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { conversationNameInText } from './conversationTitle';

const TITLE_WITH_PERIOD = 'Donne-moi les lignes sous forme de tableau.';
const LONG_TITLE = 'Donne-moi toutes les lignes budgétaires de 2026 par fournisseur et par compte sous forme de tableau trié';

describe('conversation name in the delete dialog title', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('quotes a name that ends with a period, with the quotation marks of each language', async () => {
    const name = conversationNameInText(TITLE_WITH_PERIOD);
    expect(name).toBe(TITLE_WITH_PERIOD);
    const titles: Record<string, string> = {};
    for (const lng of ['en', 'fr', 'de', 'es']) {
      await i18n.changeLanguage(lng);
      titles[lng] = i18n.t('ai:conversationList.deleteConfirmTitle', { name });
    }
    expect(titles).toEqual({
      en: `Delete "${TITLE_WITH_PERIOD}"?`,
      fr: `Supprimer « ${TITLE_WITH_PERIOD} » ?`,
      de: `„${TITLE_WITH_PERIOD}“ löschen?`,
      es: `¿Eliminar «${TITLE_WITH_PERIOD}»?`,
    });
  });

  it('cuts a long name at a word with an ellipsis', () => {
    const name = conversationNameInText(LONG_TITLE);
    expect(name).toBe('Donne-moi toutes les lignes budgétaires de 2026 par…');
    expect(name.length).toBeLessThanOrEqual(61);
  });

  it('keeps the plain text of a Markdown title', () => {
    expect(conversationNameInText('Summarise [Formaggio Supremo SRL](/master-data/companies/5835dd12)'))
      .toBe('Summarise Formaggio Supremo SRL');
  });
});
