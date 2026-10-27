import { describe, expect, it } from 'vitest';
import { isValidHostname, sanitizeHostname } from './hostname';

const label63 = 'a'.repeat(63);
const label64 = 'a'.repeat(64);

describe('isValidHostname', () => {
  it('accepts a single RFC 1123 label', () => {
    expect(isValidHostname('srv01')).toBe(true);
    expect(isValidHostname('a')).toBe(true);
    expect(isValidHostname('par-esx-09')).toBe(true);
    expect(isValidHostname(label63)).toBe(true);
  });

  it('accepts several labels separated by single dots', () => {
    expect(isValidHostname('dl3.robot-15ms.ie2000')).toBe(true);
    expect(isValidHostname('DL3.ROBOT-15MS.IE2000')).toBe(true);
  });

  it('refuses an empty label', () => {
    expect(isValidHostname('')).toBe(false);
    expect(isValidHostname('a..b')).toBe(false);
    expect(isValidHostname('.srv01')).toBe(false);
    expect(isValidHostname('srv01.')).toBe(false);
  });

  it('refuses a hyphen at either end of a label', () => {
    expect(isValidHostname('-srv01')).toBe(false);
    expect(isValidHostname('srv01-')).toBe(false);
    expect(isValidHostname('dl3.-robot.ie2000')).toBe(false);
    expect(isValidHostname('dl3.robot-.ie2000')).toBe(false);
  });

  it('enforces 63 characters per label and 253 overall', () => {
    expect(isValidHostname(label64)).toBe(false);
    expect(isValidHostname(`srv01.${label64}`)).toBe(false);
    expect(isValidHostname([label63, label63, label63, label63].join('.'))).toBe(false);
  });

  it('refuses characters that are not letters, digits, hyphens or dots', () => {
    expect(isValidHostname('srv_01')).toBe(false);
    expect(isValidHostname('srv 01')).toBe(false);
    expect(isValidHostname('Switch #3 (spare)')).toBe(false);
  });
});

describe('sanitizeHostname', () => {
  it('keeps the dots of a multi-part device name', () => {
    expect(sanitizeHostname('DL3.ROBOT-15MS.IE2000')).toBe('dl3.robot-15ms.ie2000');
  });

  it('turns spaces and underscores into hyphens and drops the rest', () => {
    expect(sanitizeHostname('Switch #3 (spare)')).toBe('switch-3-spare');
    expect(sanitizeHostname('srv_01')).toBe('srv-01');
  });

  it('never leaves an empty or hyphen-edged label', () => {
    expect(sanitizeHostname('a..b')).toBe('a.b');
    expect(sanitizeHostname('.srv01.')).toBe('srv01');
    expect(sanitizeHostname('--srv01--')).toBe('srv01');
  });

  it('always produces a valid host name or nothing', () => {
    // 62 letters, a hyphen, then one more letter: the 63 cut used to keep the hyphen.
    const labelCutOnHyphen = 'a'.repeat(62) + '-b';
    // The hyphen of the last label sits on the 253rd character of the joined name.
    const full = 'b'.repeat(63);
    const overallCutOnHyphen = [full, full, full, 'c'.repeat(60) + '-' + 'd'].join('.');
    // The same 63 cut on a label that is not the last one.
    const earlierLabelCutOnHyphen = 'a'.repeat(62) + '-b.srv01';

    for (const input of [
      'DL3.ROBOT-15MS.IE2000',
      'Switch #3 (spare)',
      'a..b',
      '.srv01.',
      '###',
      'a'.repeat(200),
      labelCutOnHyphen,
      overallCutOnHyphen,
      earlierLabelCutOnHyphen,
    ]) {
      const sanitized = sanitizeHostname(input);
      if (sanitized) expect(isValidHostname(sanitized)).toBe(true);
    }

    expect(sanitizeHostname(labelCutOnHyphen)).toBe('a'.repeat(62));
    expect(sanitizeHostname(overallCutOnHyphen)).toBe([full, full, full, 'c'.repeat(60)].join('.'));
    expect(sanitizeHostname(earlierLabelCutOnHyphen)).toBe('a'.repeat(62) + '.srv01');
    expect(sanitizeHostname('###')).toBe('');
  });
});
