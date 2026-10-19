import { In } from 'typeorm';
import { User } from '../users/user.entity';

type FreezeSlot = {
  frozen: boolean;
  frozenAt: Date | string | null;
  frozenBy: string | null;
};

type NamedSlot = FreezeSlot & { frozenByName: string | null };

/** A person's name. An account with no name stays unnamed: the address is not shown. */
export function personName(row: { first_name?: string | null; last_name?: string | null } | null | undefined): string | null {
  if (!row) return null;
  const name = [row.first_name, row.last_name].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');
  return name || null;
}

function namedSlot(slot: FreezeSlot, names: ReadonlyMap<string, string>): NamedSlot {
  return { ...slot, frozenByName: slot.frozenBy ? names.get(slot.frozenBy) ?? null : null };
}

function namedColumns(columns: Record<string, FreezeSlot>, names: ReadonlyMap<string, string>): Record<string, NamedSlot> {
  const named: Record<string, NamedSlot> = {};
  for (const key of Object.keys(columns)) named[key] = namedSlot(columns[key], names);
  return named;
}

type FreezeSummary = {
  scopes: {
    opex: Record<string, FreezeSlot>;
    capex: Record<string, FreezeSlot>;
    companies: FreezeSlot;
    departments: FreezeSlot;
  };
};

type NamedSummary<T extends FreezeSummary> = Omit<T, 'scopes'> & {
  scopes: Omit<T['scopes'], 'opex' | 'capex' | 'companies' | 'departments'> & {
    opex: Record<string, NamedSlot>;
    capex: Record<string, NamedSlot>;
    companies: NamedSlot;
    departments: NamedSlot;
  };
};

/** Adds `frozenByName` beside each slot. `frozenBy` stays the user id. */
export function attachFrozenByNames<T extends FreezeSummary>(summary: T, names: ReadonlyMap<string, string>): NamedSummary<T> {
  return {
    ...summary,
    scopes: {
      ...summary.scopes,
      opex: namedColumns(summary.scopes.opex, names),
      capex: namedColumns(summary.scopes.capex, names),
      companies: namedSlot(summary.scopes.companies, names),
      departments: namedSlot(summary.scopes.departments, names),
    },
  } as NamedSummary<T>;
}

type UserLookup = {
  getRepository: (entity: typeof User) => {
    find: (opts: { where: { id: ReturnType<typeof In> }; select: { id: boolean; first_name: boolean; last_name: boolean } }) => Promise<Array<{ id: string; first_name?: string | null; last_name?: string | null }>>;
  };
};

/** Names for the given user ids, read through the request manager so the tenant scope applies. */
export async function lookupUserNames(ids: Array<string | null | undefined>, manager: UserLookup): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const rows = await manager.getRepository(User).find({
    where: { id: In(unique) },
    select: { id: true, first_name: true, last_name: true },
  });
  for (const row of rows) {
    const name = personName(row);
    if (name) names.set(row.id, name);
  }
  return names;
}
