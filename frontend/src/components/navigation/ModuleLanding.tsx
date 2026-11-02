import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

type Landing = { to: string; resources: string[] };

/** The lists of Budget management, in the order of its menu. */
export const OPS_LANDINGS: Landing[] = [
  { to: '/ops/budget', resources: ['budget'] },
  { to: '/ops/contracts', resources: ['contracts'] },
  { to: '/ops/reports', resources: ['reporting'] },
  { to: '/ops/operations', resources: ['budget', 'budget_ops'] },
];

/** The lists of Master data, in the order of its menu. */
export const MASTER_DATA_LANDINGS: Landing[] = [
  { to: '/master-data/companies', resources: ['companies'] },
  { to: '/master-data/departments', resources: ['departments'] },
  { to: '/master-data/cost-centers', resources: ['cost_centers'] },
  { to: '/master-data/suppliers', resources: ['suppliers'] },
  { to: '/master-data/contacts', resources: ['contacts'] },
  { to: '/master-data/coa', resources: ['accounts'] },
  { to: '/master-data/analytics', resources: ['analytics'] },
  { to: '/master-data/working-day-calendars', resources: ['working_day_profiles'] },
  { to: '/master-data/business-processes', resources: ['business_processes'] },
];

/**
 * A section without a home page of its own: its address opens the first list of its menu the
 * person may read.
 */
export default function ModuleLanding({ landings }: { landings: Landing[] }) {
  const { hasLevel } = useAuth();
  const first = landings.find(({ resources }) => resources.some((resource) => hasLevel(resource, 'reader')));
  return <Navigate to={first?.to ?? '/403'} replace />;
}
