import React from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useTenant } from '../../tenant/TenantContext';
import useBudgetColumns, { type BudgetColumnView } from '../../hooks/useBudgetColumns';
import type { AmountMeasure } from '../../components/finance/roundPeriod';
import { formatAmount } from '../../i18n/formatters';
import type { FxMissing } from '../../components/finance/fxMissing';

/**
 * A contract against its budget lines (lot CB), as the API computes it
 * (`backend/src/contracts/contract-budget.ts`): for a year and a budget column, the commitment,
 * the linked lines' sum, the gap and a state. Shared by the contract's Budget tab and the
 * contract list, which also share the user's choice of year and column.
 */

/** The coverage states, in the order the list's filter offers them. */
export const CONTRACT_BUDGET_STATES = ['covered', 'under', 'over', 'no_line', 'no_commitment', 'not_started'] as const;
export type ContractBudgetState = (typeof CONTRACT_BUDGET_STATES)[number];

/** One year of a contract's coverage (`GET /contracts/:id/budget`), amounts in the reporting currency. */
export type ContractBudgetYear = {
  year: number;
  /** In the contract's currency. */
  committed_local: number;
  /** Null when the contract's currency has no rate that year. */
  committed: number | null;
  linked: number;
  /** A linked line has an amount without a rate that year: `linked` leaves it out, `gap` and `state` are null (unknown). */
  linked_fx_missing?: boolean;
  gap: number | null;
  state: ContractBudgetState | null;
};

/** A linked line's amount in the year and column; without a rate, null with the amount in the line's own currency. */
export type ContractBudgetLineAmount = {
  id: string;
  amount: number | null;
  fx_missing?: { currency: string; amount: number };
};

export type ContractBudgetCoverage = {
  year: number;
  column: AmountMeasure;
  reporting_currency: string;
  /** The contract's currency. */
  currency: string;
  /** Each linked line's amount in the year and column. */
  lines: ContractBudgetLineAmount[];
  /** The linked lines without a rate, by currency and year, for every year of `years`. */
  lines_fx_missing?: FxMissing[];
  years: ContractBudgetYear[];
};

export const contractBudgetKey = (contractId: string, year: number, column: string) => ['contract-budget', contractId, year, column] as const;

/** The years offered before the API names them: this year and the two after (the API adds the year before when the budget holds it). */
export function defaultBudgetYears(currentYear = new Date().getFullYear()): number[] {
  return [currentYear, currentYear + 1, currentYear + 2];
}

/** The years to offer: the API's (or the defaults) and the chosen one, in order. */
export function offeredBudgetYears(years: number[] | undefined, chosen: number): number[] {
  return Array.from(new Set([...(years?.length ? years : defaultBudgetYears()), chosen])).sort((a, b) => a - b);
}

/** A gap with its sign (+200, −1 400, 0). */
export function formatSignedAmount(value: number): string {
  if (value > 0) return `+${formatAmount(value)}`;
  if (value < 0) return `−${formatAmount(-value)}`;
  return '0';
}

/** How far a stored year may be from today and still be offered (the API's reach). */
const YEAR_REACH = 10;

type StoredChoice = { year?: unknown; column?: unknown };

function readStored(key: string): StoredChoice | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredChoice) : null;
  } catch {
    return null;
  }
}

export type ContractBudgetChoice = {
  year: number;
  column: AmountMeasure;
  /** The columns the tenant shows, with their names. */
  columns: BudgetColumnView[];
  /** The chosen column's name. */
  columnLabel: string;
  setYear: (year: number) => void;
  setColumn: (column: AmountMeasure) => void;
};

/**
 * The year and budget column the user looks at contracts with, kept per tenant and user in the
 * browser like the budget list's columns: the contract page and the list share it. Next year
 * (the next budget to check) and the tenant's default column until the user picks others; a
 * stored column the tenant no longer shows falls back to the default one.
 */
export function useContractBudgetChoice(): ContractBudgetChoice {
  const { profile } = useAuth();
  const { tenantSlug } = useTenant();
  const columns = useBudgetColumns();
  const key = `kanap-contract-budget:${tenantSlug ?? 'unknown'}:${profile?.id ?? 'anon'}`;
  const currentYear = new Date().getFullYear();
  const [stored, setStored] = React.useState<StoredChoice | null>(() => readStored(key));
  React.useEffect(() => { setStored(readStored(key)); }, [key]);

  const storedYear = Number(stored?.year);
  const year = Number.isInteger(storedYear) && Math.abs(storedYear - currentYear) <= YEAR_REACH ? storedYear : currentYear + 1;
  const shownColumn = columns.shown.find((column) => column.measure === stored?.column);
  const column = (shownColumn ?? columns.defaultColumn).measure;

  const save = React.useCallback((next: StoredChoice) => {
    setStored((previous) => {
      const merged = { ...(previous ?? {}), ...next };
      try {
        window.localStorage.setItem(key, JSON.stringify(merged));
      } catch {
        /* storage unavailable: the choice lasts for the page */
      }
      return merged;
    });
  }, [key]);

  return {
    year,
    column,
    columns: columns.shown,
    columnLabel: columns.label(column),
    setYear: React.useCallback((next: number) => save({ year: next }), [save]),
    setColumn: React.useCallback((next: AmountMeasure) => save({ column: next }), [save]),
  };
}
