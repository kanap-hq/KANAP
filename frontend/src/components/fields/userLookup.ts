import React from 'react';
import { useAuth } from '../../auth/AuthContext';

/** A person as the user lookup returns it: names only, the email only for a person without a name. */
export type UserOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  status?: string | null;
};

/** People search of every person picker (`GET /users/lookup`, readable from every page that picks a person). */
export const USERS_LOOKUP_ENDPOINT = '/users/lookup';

/** The signed-in person as a picker option. */
export function useMeOption(): UserOption | null {
  const { profile } = useAuth();
  return React.useMemo(() => (profile?.id
    ? { id: profile.id, first_name: profile.first_name ?? null, last_name: profile.last_name ?? null, email: profile.email ?? null }
    : null), [profile?.id, profile?.first_name, profile?.last_name, profile?.email]);
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
