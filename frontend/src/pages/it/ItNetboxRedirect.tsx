import { Navigate, useSearchParams } from 'react-router-dom';

/** `/it/netbox` now lives on the IT settings page. The other query parameters stay. */
export default function ItNetboxRedirect() {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set('tab', 'netbox');
  return <Navigate to={`/it/settings?${next.toString()}`} replace />;
}
