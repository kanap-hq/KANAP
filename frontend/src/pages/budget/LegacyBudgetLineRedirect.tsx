import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import type { LineType } from '../../constants/lineTypeUsage';

/** Keep bookmarks' tabs and queries; bare legacy numbers belong to their old nature. */
export default function LegacyBudgetLineRedirect({ nature }: { nature: LineType }) {
  const { id = 'new', tab } = useParams();
  const { search, hash } = useLocation();
  if (id === 'new') {
    const params = new URLSearchParams(search);
    params.set('nature', nature);
    return <Navigate replace to={`/ops/budget/new?${params.toString()}${hash}`} />;
  }
  const ref = /^\d+$/.test(id) ? `${nature === 'capex' ? 'CPX' : 'OPX'}-${id}` : id;
  return <Navigate replace to={`/ops/budget/${ref}${tab ? `/${tab}` : ''}${search}${hash}`} />;
}
