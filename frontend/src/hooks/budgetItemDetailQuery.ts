import api from '../api';

/**
 * The OPEX and CAPEX workspaces' detail query of a line, by the id or reference of its route
 * (`OPX-12`, `CPX-3` or a uuid). The workspace reads it, and its previous / next navigation
 * prefetches it for the lines next door (same key, same request).
 */
export function spendDetailQuery(ref: string) {
  return {
    queryKey: ['spend', ref] as unknown[],
    queryFn: async () => (await api.get(`/spend-items/${ref}`)).data,
  };
}

export function capexDetailQuery(ref: string) {
  return {
    queryKey: ['capex', ref] as unknown[],
    queryFn: async () => (await api.get(`/capex-items/${ref}`)).data,
  };
}
