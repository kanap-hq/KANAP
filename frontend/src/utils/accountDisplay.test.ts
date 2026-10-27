import { describe, expect, it } from 'vitest';
import { accountDisplayText } from './accountDisplay';

describe('accountDisplayText', () => {
  it('joins the number and the name', () => {
    expect(accountDisplayText(612100, 'Name')).toBe('612100 - Name');
    expect(accountDisplayText('612100', 'Name')).toBe('612100 - Name');
  });

  it('shows the number alone when the account has no name', () => {
    expect(accountDisplayText(612100, '')).toBe('612100');
    expect(accountDisplayText(612100, null)).toBe('612100');
    expect(accountDisplayText(612100, undefined)).toBe('612100');
  });

  it('keeps a name that is only spaces, as the list does', () => {
    expect(accountDisplayText(612100, ' ')).toBe('612100 -  ');
  });
});
