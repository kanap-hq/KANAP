import { Navigate, useSearchParams } from 'react-router-dom';

/** `/it/netbox` now lives on the IT settings page, Netbox tab. The other query parameters stay. */
export default function ItNetboxRedirect() {
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  return <Navigate to={`/it/settings/netbox${search ? `?${search}` : ''}`} replace />;
}
