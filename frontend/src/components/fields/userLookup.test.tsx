import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ profile: null as null | Record<string, string | null> }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: auth.profile }) }));

import { formatUserOption, useMeOption, withMeFirst } from './userLookup';

describe('formatUserOption', () => {
  it('reads the email when the lookup returned one (a shared or missing name)', () => {
    expect(formatUserOption({ first_name: 'Friedrich', last_name: 'Eva', email: ' fried@kanap.net ' })).toBe('fried@kanap.net');
    expect(formatUserOption({ first_name: null, last_name: null, email: 'service@kanap.net' })).toBe('service@kanap.net');
  });

  it('reads the name otherwise, and nothing for nothing', () => {
    expect(formatUserOption({ first_name: ' Ana ', last_name: 'Diaz', email: null })).toBe('Ana Diaz');
    expect(formatUserOption({ first_name: 'Ana', last_name: 'Diaz', email: '  ' })).toBe('Ana Diaz');
    expect(formatUserOption({ first_name: null, last_name: null, email: null })).toBe('');
    expect(formatUserOption(null)).toBe('');
  });
});

describe('useMeOption', () => {
  beforeEach(() => { auth.profile = null; });

  it('carries no email for a person with a name, so me reads as my name when not on the page', () => {
    auth.profile = { id: 'me', first_name: 'Friedrich', last_name: 'Eva', email: 'fried@kanap.net' };
    const { result } = renderHook(() => useMeOption());
    expect(result.current).toEqual({ id: 'me', first_name: 'Friedrich', last_name: 'Eva', email: null });
    expect(formatUserOption(result.current)).toBe('Friedrich Eva');
  });

  it('carries the email for a person without a name, as the lookup does', () => {
    auth.profile = { id: 'me', first_name: ' ', last_name: null, email: 'service@kanap.net' };
    const { result } = renderHook(() => useMeOption());
    expect(result.current?.email).toBe('service@kanap.net');
    expect(formatUserOption(result.current)).toBe('service@kanap.net');
  });

  it('is null when nobody is signed in', () => {
    const { result } = renderHook(() => useMeOption());
    expect(result.current).toBeNull();
  });

  it('gives way to the lookup row of me, which carries the email when my name is shared', () => {
    auth.profile = { id: 'me', first_name: 'Friedrich', last_name: 'Eva', email: 'fried@kanap.net' };
    const { result } = renderHook(() => useMeOption());
    const rows = [
      { id: 'twin', first_name: 'Friedrich', last_name: 'Eva', email: 'admin@kanap.net' },
      { id: 'me', first_name: 'Friedrich', last_name: 'Eva', email: 'fried@kanap.net' },
    ];
    expect(withMeFirst(rows, result.current, false).map(formatUserOption)).toEqual(['fried@kanap.net', 'admin@kanap.net']);
  });
});
