import React from 'react';
import { useAuth } from '../../auth/AuthContext';
import { formatUserName, type DisplayUserLike } from '../../utils/userDisplay';

/**
 * A person as the user lookup returns it: names only, the email only for a
 * person without a name or whose name another account shares (one person with
 * a user and an admin account, for instance).
 */
export type UserOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  status?: string | null;
};

/** People search of every person picker (`GET /users/lookup`, readable from every page that picks a person). */
export const USERS_LOOKUP_ENDPOINT = '/users/lookup';

/**
 * A person's label in a picker. The lookup returns an email only for a person
 * without a name or whose name another account shares: that email is the label
 * (it tells the two accounts apart); otherwise the name.
 */
export function formatUserOption(user: DisplayUserLike | null | undefined): string {
  if (!user) return '';
  return String(user.email || '').trim() || formatUserName(user) || '';
}

/**
 * The signed-in person as a picker option. It carries the email only when the
 * profile has no name, as the lookup does; when the lookup's own row of me is
 * on the page, `withMeFirst` uses that one (with its email when my name is shared).
 */
export function useMeOption(): UserOption | null {
  const { profile } = useAuth();
  return React.useMemo(() => {
    if (!profile?.id) return null;
    const nameless = !String(profile.first_name || '').trim() && !String(profile.last_name || '').trim();
    return {
      id: profile.id,
      first_name: profile.first_name ?? null,
      last_name: profile.last_name ?? null,
      email: nameless ? profile.email ?? null : null,
    };
  }, [profile?.id, profile?.first_name, profile?.last_name, profile?.email]);
}

/**
 * Pickers list the signed-in person first while nothing is typed (then a divider);
 * a search keeps the server's order. `me` is added when the first page does not hold it.
 */
export function withMeFirst<T extends UserOption>(options: T[], me: UserOption | null, searching: boolean, exclude?: (option: UserOption) => boolean): T[] {
  if (!me || searching || exclude?.(me)) return options;
  const rest = options.filter((option) => option.id !== me.id);
  const own = (options.find((option) => option.id === me.id) ?? me) as T;
  return [own, ...rest];
}
