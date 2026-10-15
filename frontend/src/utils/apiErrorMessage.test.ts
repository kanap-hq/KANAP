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

  it('words a refusal with its count, in the screen language', () => {
    const refusal = { response: { status: 409, data: { code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', count: 3, message: 'raw' } } };
    expect(getApiErrorMessage(refusal, t, 'fallback'))
      .toBe('This contract has 3 recorded compliance requirements. Disable it instead of deleting it.');
    expect(getApiErrorMessage({ response: { status: 409, data: { code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', count: 1 } } }, t, 'fallback'))
      .toBe('This contract has 1 recorded compliance requirement. Disable it instead of deleting it.');
    expect(getApiErrorMessage(refusal, i18n.getFixedT('fr'), 'fallback')).toContain('3 exigences de conformité renseignées');
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
