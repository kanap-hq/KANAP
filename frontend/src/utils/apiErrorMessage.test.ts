import '../i18n';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, getDocumentSaveErrorMessage } from './apiErrorMessage';

const t = i18n.getFixedT('en');

describe('getApiErrorMessage', () => {
  it('translates a code', () => {
    expect(getApiErrorMessage({ response: { status: 400, data: { code: 'confirmation_mismatch', message: 'raw' } } }, t, 'fallback'))
      .toBe('The name typed does not match the name of the workspace.');
  });

  it('translates a rate limit, which carries no code', () => {
    expect(getApiErrorMessage(
      { response: { status: 429, data: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } } },
      t,
      'fallback',
    )).toBe('Too many attempts. Wait a few minutes and try again.');
  });

  it('reads the variant of a message for this installation', () => {
    const unavailable = (variant?: string) => ({
      response: { status: 503, data: { code: 'MARKDOWN_UNAVAILABLE', message: 'raw', ...(variant ? { variant } : {}) } },
    });
    expect(getApiErrorMessage(unavailable(), t, 'fallback')).toBe('Formatted texts cannot be saved right now. Try again in a few minutes.');
    expect(getApiErrorMessage(unavailable('onprem'), t, 'fallback')).toBe(
      'Formatted texts cannot be saved on this server right now. Ask your administrator to check the API logs.',
    );
    expect(getApiErrorMessage(unavailable('onprem'), i18n.getFixedT('fr'), 'fallback')).toMatch(/^Les textes mis en forme ne peuvent pas être enregistrés sur ce serveur/);
  });

  it('words a refused delete with its counts, in the language of the interface', () => {
    const refused = {
      response: {
        status: 409,
        data: { code: 'ASSET_IN_USE', message: 'Cannot delete asset "srv-01": is linked to 2 connection(s)', usages: [{ type: 'app_assignments', total: 1 }, { type: 'connections', total: 2 }] },
      },
    };
    expect(getApiErrorMessage(refused, t, 'fallback')).toBe(
      'This asset is used by 1 application assignment and 2 connections. Remove it from them before deleting it.',
    );
    expect(getApiErrorMessage(refused, i18n.getFixedT('fr'), 'fallback')).toBe(
      'Cet actif est utilisé par 1 affectation à une application et 2 connexions. Retirez-le de ces éléments avant de le supprimer.',
    );
    expect(getApiErrorMessage({ response: { status: 409, data: { code: 'USER_OWN_ACCOUNT', message: 'raw', usages: [] } } }, i18n.getFixedT('de'), 'fallback'))
      .toBe('Sie können Ihr eigenes Konto nicht löschen. Deaktivieren Sie es bei Bedarf.');
  });

  it('names the values a refusal carries (a frozen column and its year)', () => {
    const frozen = { response: { status: 409, data: { code: 'BUDGET_LINE_FROZEN', message: 'English', usages: [], params: { column: 'Budget', year: 2026 } } } };
    expect(getApiErrorMessage(frozen, i18n.getFixedT('fr'), 'fallback')).toMatch(/^Cette ligne a des montants dans Budget 2026/);
  });

  it('keeps the server message without a code, then the fallback', () => {
    expect(getApiErrorMessage({ response: { status: 500, data: { message: 'Server said' } } }, t, 'fallback')).toBe('Server said');
    expect(getApiErrorMessage({}, t, 'fallback')).toBe('fallback');
  });
});

describe('getDocumentSaveErrorMessage', () => {
  const tooLarge = { response: { status: 400, data: { code: 'MARKDOWN_TOO_LARGE', message: 'content_markdown is too long' } } };

  it('says what to do with a document over the size limit', () => {
    expect(getDocumentSaveErrorMessage(tooLarge, t, 'fallback')).toBe(
      'This document is over the 200 KB of text a save accepts (images do not count). Shorten it to save your changes. The last saved version is kept.',
    );
    expect(getDocumentSaveErrorMessage(tooLarge, i18n.getFixedT('fr'), 'fallback')).toMatch(/^Ce document dépasse les 200 Ko/);
  });

  it('reads any other error as getApiErrorMessage does', () => {
    const tooComplex = { response: { status: 400, data: { code: 'MARKDOWN_TOO_COMPLEX', message: 'raw' } } };
    expect(getDocumentSaveErrorMessage(tooComplex, t, 'fallback')).toBe(getApiErrorMessage(tooComplex, t, 'fallback'));
    expect(getDocumentSaveErrorMessage({}, t, 'fallback')).toBe('fallback');
  });
});
