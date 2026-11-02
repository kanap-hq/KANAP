import { Button, Link, type SxProps, type Theme } from '@mui/material';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { useFeatures } from '../config/FeaturesContext';

export type DiscoveryCallPlacement = 'last_step' | 'about';

/**
 * Where "Book a discovery call" leads: the booking page, else a message to the fallback address.
 * Null outside a running trial, on-premise, for a platform administrator, and when neither is set.
 */
export function useDiscoveryCall(): string | null {
  const { config, isLoading } = useFeatures();
  const { subscription, claims } = useAuth();
  if (isLoading || config.deploymentMode === 'single-tenant' || claims?.isPlatformAdmin) return null;
  const days = subscription?.trial_days_remaining;
  if (subscription?.status !== 'trialing' || days == null || days <= 0) return null;
  const { url, fallbackEmail } = config.discoveryCall ?? { url: '', fallbackEmail: '' };
  if (url) return url;
  return fallbackEmail ? `mailto:${fallbackEmail}` : null;
}

/**
 * "Book a discovery call", during the trial only (`useDiscoveryCall`): a pill, or a link inside a
 * line of text (`asLink`). Opens the booking page in a new tab and records the click with its
 * placement (`trial.discovery_call_clicked`); a failed record never blocks the link.
 */
export default function BookDiscoveryCallButton({ placement, asLink = false, sx }: {
  placement: DiscoveryCallPlacement;
  asLink?: boolean;
  sx?: SxProps<Theme>;
}) {
  const { t } = useTranslation('common');
  const href = useDiscoveryCall();
  if (!href) return null;
  const record = () => { void api.post('/discovery-call/clicks', { placement }).catch(() => undefined); };
  if (asLink) {
    return (
      <Link variant="body2" href={href} target="_blank" rel="noopener" onClick={record} sx={sx}>
        {t('discoveryCall.book')}
      </Link>
    );
  }
  return (
    <Button
      variant="action"
      size="small"
      component="a"
      href={href}
      target="_blank"
      rel="noopener"
      startIcon={<EventOutlinedIcon sx={{ fontSize: 14 }} />}
      onClick={record}
      sx={sx}
    >
      {t('discoveryCall.book')}
    </Button>
  );
}
