import React from 'react';
import { Box, Button, Link, Stack, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import { useLocale } from '../../i18n/useLocale';
import { useTenant } from '../../tenant/TenantContext';
import { getDocHomeUrl, getDocPageUrl } from '../../utils/docUrls';
import AboutOnboardingLine from '../onboarding/AboutOnboardingLine';
import {
  buildSupportInfo,
  buildSupportMailto,
  DISCUSSIONS_LABEL,
  DISCUSSIONS_URL,
  ISSUES_LABEL,
  ISSUES_URL,
  releaseNotesUrl,
  REPOSITORY_URL,
  SITE_LABEL,
  SITE_URL,
  SUPPORT_EMAIL,
  supportOfferUrl,
} from './aboutLinks';

const TOKEN = '[[link]]';

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link variant="body2" href={href} target="_blank" rel="noopener">
      {children}
    </Link>
  );
}

/** A sentence whose translation holds one `{{link}}` or `{{email}}` spot, filled with a link. */
function Sentence({ text, link }: { text: string; link: React.ReactNode }) {
  const [before, after = ''] = text.split(TOKEN);
  return (
    <Typography variant="body2">
      {before}
      {link}
      {after}
    </Typography>
  );
}

export default function AboutContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('settings');
  const { config } = useFeatures();
  const { subscription, claims } = useAuth();
  const { tenantName, tenantSlug } = useTenant();
  const locale = useLocale();
  const [copied, setCopied] = React.useState(false);
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const isOnPremise = config.deploymentMode === 'single-tenant';
  const versionKnown = config.version !== 'unknown';
  const trialDays = subscription?.trial_days_remaining;
  const showTrial = !isOnPremise
    && config.features.billing
    && subscription?.status === 'trialing'
    && trialDays != null
    && trialDays > 0;

  const workspace = [tenantName, tenantSlug ?? config.tenantSlug]
    .filter((value, index, all): value is string => !!value && all.indexOf(value) === index)
    .join(' / ');
  const supportInfo = {
    version: config.version,
    workspace,
    deploymentMode: config.deploymentMode,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };

  const copyInfo = async () => {
    try {
      await navigator.clipboard.writeText(buildSupportInfo(supportInfo));
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const emailLink = (
    <Link variant="body2" href={buildSupportMailto(supportInfo)}>
      {SUPPORT_EMAIL}
    </Link>
  );
  const sectionTitleSx = { fontWeight: 500, fontSize: 13, mb: 0.5 };

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 0.5 }}>
          <Box component="img" src="/icon-192.png" alt="KANAP" sx={{ width: 40, height: 40, flexShrink: 0 }} />
          <Box>
            {versionKnown && <Typography variant="body2">{t('about.version', { version: config.version })}</Typography>}
            <Typography variant="body2">
              {isOnPremise ? t('about.deploymentOnPremise') : t('about.deploymentCloud')}
            </Typography>
          </Box>
        </Box>
        {showTrial && (
          <Typography variant="body2">
            {t('about.trialDaysLeft', { count: trialDays })}
            {claims?.isBillingAdmin && (
              <>
                {' · '}
                <Link variant="body2" component={RouterLink} to="/admin/billing" onClick={onNavigate}>
                  {t('about.choosePlan')}
                </Link>
              </>
            )}
          </Typography>
        )}
        <AboutOnboardingLine />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, pt: 0.5 }}>
          <ExternalLink href={releaseNotesUrl(config.version)}>{t('about.releaseNotes')}</ExternalLink>
          <ExternalLink href={getDocHomeUrl(locale)}>{t('about.docs')}</ExternalLink>
          <ExternalLink href={SITE_URL}>{SITE_LABEL}</ExternalLink>
          {isOnPremise && (
            <ExternalLink href={getDocPageUrl('on-premise/operations', locale)}>{t('about.upgradeGuide')}</ExternalLink>
          )}
        </Box>
        <Box sx={{ pt: 0.5 }}>
          <ExternalLink href={REPOSITORY_URL}>{t('about.license')}</ExternalLink>
        </Box>
      </Stack>

      <Box>
        <Typography component="h3" sx={sectionTitleSx}>{t('about.support.title')}</Typography>
        <Stack spacing={0.5}>
          <Sentence
            text={t(isOnPremise ? 'about.support.contract' : 'about.support.included', { link: TOKEN, email: TOKEN })}
            link={emailLink}
          />
          <Box>
            <Button
              variant="action"
              size="small"
              startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
              onClick={() => { void copyInfo(); }}
            >
              {copied ? t('about.support.copied') : t('about.support.copy')}
            </Button>
          </Box>
          {isOnPremise && (
            <>
              <Typography variant="body2" sx={{ pt: 0.5 }}>{t('about.support.otherwise')}</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, '& > li': { typography: 'body2' } }}>
                <li>
                  <Sentence
                    text={t('about.support.discussions', { link: TOKEN })}
                    link={<ExternalLink href={DISCUSSIONS_URL}>{DISCUSSIONS_LABEL}</ExternalLink>}
                  />
                </li>
                <li>
                  <Sentence
                    text={t('about.support.issues', { link: TOKEN })}
                    link={<ExternalLink href={ISSUES_URL}>{ISSUES_LABEL}</ExternalLink>}
                  />
                </li>
              </Box>
              <Sentence
                text={t('about.support.offer', { link: TOKEN })}
                link={<ExternalLink href={supportOfferUrl(locale)}>{t('about.support.offerLink')}</ExternalLink>}
              />
            </>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
