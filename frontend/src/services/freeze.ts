import api from '../api';

export type FreezeScope = 'opex' | 'capex' | 'companies' | 'departments';
export type FreezeColumn = 'budget' | 'revision' | 'forecast' | 'actual' | 'landing';

export type FreezeEntry = {
  id: string;
  scope: FreezeScope;
  column: FreezeColumn | null;
  isFrozen: boolean;
  frozenAt: string | null;
  frozenBy: string | null;
  frozenByName?: string | null;
  unfrozenAt: string | null;
  unfrozenBy: string | null;
};

export type FreezeSummaryColumn = {
  frozen: boolean;
  frozenAt: string | null;
  frozenBy: string | null;
  frozenByName?: string | null;
};

export type FreezeSummary = {
  year: number;
  scopes: {
    opex: Record<FreezeColumn, FreezeSummaryColumn>;
    capex: Record<FreezeColumn, FreezeSummaryColumn>;
    companies: FreezeSummaryColumn;
    departments: FreezeSummaryColumn;
  };
};

export type FreezeStateResponse = {
  year: number;
  entries: FreezeEntry[];
  summary: FreezeSummary;
};

export type FreezeTarget = {
  scope: FreezeScope;
  columns?: FreezeColumn[];
};

export async function fetchFreezeState(year: number): Promise<FreezeStateResponse> {
  const res = await api.get<FreezeStateResponse>('/freeze-states', { params: { year } });
  return res.data;
}

export async function freezeTargets(year: number, targets: FreezeTarget[]): Promise<FreezeStateResponse> {
  const res = await api.post<FreezeStateResponse>('/freeze-states/freeze', { year, scopes: targets });
  return res.data;
}

export async function unfreezeTargets(year: number, targets: FreezeTarget[]): Promise<FreezeStateResponse> {
  const res = await api.post<FreezeStateResponse>('/freeze-states/unfreeze', { year, scopes: targets });
  return res.data;
}
