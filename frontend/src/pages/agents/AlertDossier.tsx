import React from 'react';
import { Box, CircularProgress, Link, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  aiAgentControlApi,
  type AiAgentControlDiagnosisCause,
  type AiAgentControlDiagnosisRecommendedAction,
  type AiAgentControlDiagnosticSource,
  type AiAgentControlMonitoringAlertDiagnosis,
  type AiAgentControlMonitoringDiagnosisCard,
  type AiAgentControlMonitoringDiagnosisResult,
} from '../../ai/aiApi';
import {
  EmptyState,
  formatDateTime,
  humanize,
  TargetLabel,
  type TicketWorkGroup,
} from '../../components/agents/agentControlPrimitives';
import { monitoringStatusSemanticColor } from '../../components/agents/monitoringTargeting';
import { getDotColor } from '../../utils/statusColors';

// ---------------------------------------------------------------------------
// The alert dossier (plan 38): occurrence-centric list of watched monitoring
// targets whose rows lead with the agent's one-line conclusion, expanding into
// the stored diagnosis — summary, ranked causes, suggested next steps,
// evidence. The Actions section is the container 15.B/C proposals land in.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Dot + text alert state (status charter pattern 1), colored by the normalized
// monitoring vocabulary — never provider-raw values.
export function AlertStateText({ status, label }: { status: string; label?: string }) {
  const { t } = useTranslation(['agents']);
  const color = monitoringStatusSemanticColor(status);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flex: '0 0 auto' }}>
      <Box
        aria-hidden
        sx={(theme) => ({ width: 6, height: 6, borderRadius: '50%', bgcolor: getDotColor(color, theme.palette.mode), flex: '0 0 auto' })}
      />
      <Typography
        sx={(theme) => ({ color: getDotColor(color, theme.palette.mode), fontSize: 12, fontWeight: 500, lineHeight: 1.35, minWidth: 0, whiteSpace: 'nowrap' })}
      >
        {label ?? t(`monitor.alertStates.${status}`, { defaultValue: humanize(status) })}
      </Typography>
    </Stack>
  );
}

// Occurrence bookkeeping the poller writes into the target state; the work
// item's metadata is the fallback for freshly-diagnosed rows.
export function monitoringDiagnosisFields(group: TicketWorkGroup): {
  lastStatus: string | null;
  occurrenceStartedAt: string | null;
  lastDiagnosisAt: string | null;
  clearedAt: string | null;
  briefConfidence: string | null;
  needsHumanReview: boolean;
} {
  const stateJson = recordOf(group.targetState?.state_json);
  const workMeta = recordOf(group.workItem?.metadata_json);
  const source = typeof workMeta.brief_confidence === 'string' || typeof workMeta.needs_human_review === 'boolean'
    ? workMeta
    : stateJson;
  return {
    lastStatus: textOf(stateJson.last_status),
    occurrenceStartedAt: textOf(stateJson.occurrence_started_at),
    lastDiagnosisAt: textOf(stateJson.last_diagnosis_at),
    clearedAt: textOf(stateJson.cleared_at),
    briefConfidence: textOf(source.brief_confidence),
    needsHumanReview: source.needs_human_review === true,
  };
}

const ALERTING_STATES = new Set(['down', 'down_partial', 'warning', 'unusual']);

const monoSx = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
} as const;

const sectionLabelSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  lineHeight: 1.3,
} as const;

function NeedsReviewText() {
  const { t } = useTranslation(['agents']);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flex: '0 0 auto' }}>
      <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flex: '0 0 auto' }} />
      <Typography sx={{ color: 'warning.main', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {t('monitor.needsReview')}
      </Typography>
    </Stack>
  );
}

// One collapsed row: state, plain-language identity, the agent's conclusion as
// subtitle — no badge soup at list level.
function AlertRow({
  group,
  card,
  expanded,
  onToggle,
  agentDefinitionId,
  locale,
}: {
  group: TicketWorkGroup;
  card: AiAgentControlMonitoringDiagnosisCard | null;
  expanded: boolean;
  onToggle: () => void;
  agentDefinitionId: string | null;
  locale: string;
}) {
  const { t } = useTranslation(['agents']);
  const fields = monitoringDiagnosisFields(group);
  const isActive = !!fields.lastStatus && ALERTING_STATES.has(fields.lastStatus);
  const checkName = card?.check_name ?? null;
  const deviceName = card?.device_name ?? null;
  const sourceUri = card?.source_uri ?? group.targetUrl ?? null;
  return (
    <Box
      onClick={onToggle}
      sx={(theme) => ({
        px: 1.5,
        py: 1,
        cursor: 'pointer',
        bgcolor: expanded ? theme.palette.kanap.bg.hover : 'transparent',
        '&:hover': { bgcolor: theme.palette.kanap.bg.hover },
      })}
    >
      <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap sx={{ minWidth: 0 }}>
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary, width: 12, flex: '0 0 auto' })}>
          {expanded ? '▾' : '▸'}
        </Typography>
        <Box sx={{ width: 76, flex: '0 0 auto' }}>
          {isActive
            ? <AlertStateText status={fields.lastStatus ?? 'unknown'} />
            : <AlertStateText status="up" label={t('monitor.cleared')} />}
        </Box>
        {checkName ? (
          <Typography sx={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {checkName}
            {deviceName && (
              <Typography component="span" sx={(theme) => ({ fontSize: 13, fontWeight: 400, color: theme.palette.kanap.text.secondary })}>
                {` · ${deviceName}`}
              </Typography>
            )}
          </Typography>
        ) : (
          <TargetLabel targetType={group.targetType} targetRef={group.targetRef} size="dense" href={sourceUri} />
        )}
        {checkName && (
          <Typography sx={(theme) => ({ ...monoSx, fontSize: 11, color: theme.palette.kanap.text.tertiary, flex: '0 0 auto' })}>
            #{group.targetRef}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {(card?.needs_human_review ?? fields.needsHumanReview) && <NeedsReviewText />}
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary, whiteSpace: 'nowrap', flex: '0 0 auto' })}>
          {isActive && fields.occurrenceStartedAt
            ? `${t('monitor.activeSince')} ${formatDateTime(fields.occurrenceStartedAt, locale)}`
            : fields.clearedAt
              ? t('monitor.clearedAt', { when: formatDateTime(fields.clearedAt, locale) })
              : fields.lastDiagnosisAt
                ? `${t('monitor.lastDiagnosis')}: ${formatDateTime(fields.lastDiagnosisAt, locale)}`
                : ''}
        </Typography>
      </Stack>
      {card?.brief_summary && (
        <Typography
          sx={(theme) => ({
            fontSize: 13,
            color: theme.palette.kanap.text.secondary,
            ml: '108px',
            mt: 0.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          })}
        >
          {card.brief_summary}
        </Typography>
      )}
      {expanded && (
        <Box onClick={(event) => event.stopPropagation()} sx={{ ml: '108px', mr: 1, mt: 1, cursor: 'default' }}>
          <StoredAlertDossier agentDefinitionId={agentDefinitionId} targetRef={group.targetRef} sourceUri={sourceUri} />
        </Box>
      )}
    </Box>
  );
}

// Expanded row content: fetches the stored diagnoses lazily on first expand.
function StoredAlertDossier({
  agentDefinitionId,
  targetRef,
  sourceUri,
}: {
  agentDefinitionId: string | null;
  targetRef: string;
  sourceUri: string | null;
}) {
  const { t } = useTranslation(['agents']);
  const query = useQuery({
    queryKey: ['ai-agent-monitoring-alert-diagnoses', agentDefinitionId, targetRef],
    queryFn: () => aiAgentControlApi.listAgentMonitoringAlertDiagnoses(agentDefinitionId ?? '', targetRef),
    enabled: !!agentDefinitionId,
    staleTime: 30_000,
  });
  if (query.isPending) {
    return <CircularProgress size={16} sx={{ my: 1 }} />;
  }
  const diagnoses = query.data?.diagnoses ?? [];
  if (diagnoses.length === 0) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{t('monitor.noDiagnosisStored')}</Typography>;
  }
  return <AlertDossierBody diagnosis={diagnoses[0]} previous={diagnoses.slice(1)} sourceUri={sourceUri} />;
}

function CauseRow({ cause, index }: { cause: AiAgentControlDiagnosisCause; index: number }) {
  const { t } = useTranslation(['agents']);
  const confidence = textOf(cause.confidence);
  return (
    <Stack direction="row" spacing={1.25} sx={{ mt: 1, maxWidth: '72ch' }}>
      <Typography sx={(theme) => ({ ...monoSx, fontSize: 12, color: theme.palette.kanap.text.tertiary, pt: '1px', flex: '0 0 auto' })}>
        {index + 1}.
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
          {cause.cause ?? t('common.notSet')}
          {confidence && (
            <Typography component="span" sx={(theme) => ({ fontSize: 12, fontWeight: 400, color: theme.palette.kanap.text.tertiary, ml: 1 })}>
              {t('monitor.causeConfidence', { level: t(`monitor.confidenceLevels.${confidence}`, { defaultValue: humanize(confidence) }) })}
            </Typography>
          )}
        </Typography>
        {cause.rationale && (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary, mt: '1px' })}>
            {cause.rationale}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

// Suggested next steps — in 15.A these render as suggestions with the planner's
// rationale; once routing/automation ships the same rows become real approval
// objects with per-action status and Approve / Reject / Dismiss controls.
function SuggestedActionRow({ action }: { action: AiAgentControlDiagnosisRecommendedAction }) {
  const { t } = useTranslation(['agents']);
  const kind = textOf(action.action);
  if (!kind) return null;
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      sx={(theme) => ({
        py: 1,
        maxWidth: '78ch',
        '& + &': { borderTop: `1px solid ${theme.palette.kanap.border.soft}` },
      })}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
          {t(`monitor.actionKinds.${kind}`, { defaultValue: humanize(kind) })}
        </Typography>
        {action.rationale && (
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary, mt: '1px' })}>
            {action.rationale}
          </Typography>
        )}
      </Box>
      <Typography sx={(theme) => ({ fontSize: 12, fontWeight: 500, color: theme.palette.kanap.text.tertiary, pt: '2px', flex: '0 0 auto' })}>
        {t('monitor.suggestionState')}
      </Typography>
    </Stack>
  );
}

function Fact({ label, children, dim = false }: { label: string; children: React.ReactNode; dim?: boolean }) {
  return (
    <Box>
      <Typography sx={sectionLabelSx}>{label}</Typography>
      <Typography sx={(theme) => ({ fontSize: 13, mt: '2px', color: dim ? theme.palette.kanap.text.secondary : theme.palette.kanap.text.primary })}>
        {children}
      </Typography>
    </Box>
  );
}

// The full dossier body, shared between the stored-diagnosis expansion and the
// "Test on an alert" result.
export function AlertDossierBody({
  diagnosis,
  previous = [],
  sourceUri = null,
}: {
  diagnosis: AiAgentControlMonitoringAlertDiagnosis;
  previous?: AiAgentControlMonitoringAlertDiagnosis[];
  sourceUri?: string | null;
}) {
  const { t, i18n } = useTranslation(['agents']);
  const [showRejected, setShowRejected] = React.useState(false);
  const alert = recordOf(diagnosis.alert);
  const kanapContext = recordOf(diagnosis.kanap_context);
  const brief = diagnosis.brief;
  const usedSources = brief.used_sources ?? [];
  const rejectedSources = brief.rejected_sources ?? [];
  const consideredCount = usedSources.length + rejectedSources.length;
  const relatedAlerts = diagnosis.related_alerts ?? [];
  const alertMessage = textOf(alert.message);
  const alertStatus = textOf(alert.status);
  const ackState = textOf(alert.ack_state);
  const kanapNotes = Array.isArray(kanapContext.notes)
    ? kanapContext.notes.filter((note): note is string => typeof note === 'string')
    : [];
  const entityRefs = Array.isArray(kanapContext.entity_refs)
    ? kanapContext.entity_refs.filter((ref): ref is string => typeof ref === 'string')
    : [];
  const openLink = sourceUri ?? textOf(alert.source_uri);
  const businessImpact = textOf(brief.business_impact);
  return (
    <Box>
      <Typography sx={sectionLabelSx}>{t('monitor.diagnosis')}</Typography>
      <Typography sx={{ fontSize: 14, lineHeight: 1.6, maxWidth: '72ch', mt: 0.5 }}>
        {brief.summary ?? diagnosis.summary ?? t('common.notSet')}
      </Typography>

      {brief.probable_causes.length > 0 && (
        <>
          <Typography sx={{ ...sectionLabelSx, mt: 2.25 }}>{t('monitor.probableCauses')}</Typography>
          {brief.probable_causes.map((cause, index) => (
            <CauseRow key={index} cause={cause} index={index} />
          ))}
        </>
      )}

      {businessImpact && businessImpact !== 'unknown' && (
        <>
          <Typography sx={{ ...sectionLabelSx, mt: 2.25 }}>{t('monitor.businessImpact')}</Typography>
          <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary, maxWidth: '72ch', mt: 0.5 })}>
            {businessImpact}
          </Typography>
        </>
      )}

      {brief.recommended_actions.length > 0 && (
        <>
          <Typography sx={{ ...sectionLabelSx, mt: 2.25 }}>{t('monitor.recommendedNextSteps')}</Typography>
          <Box>
            {brief.recommended_actions.map((action, index) => (
              <SuggestedActionRow key={index} action={action} />
            ))}
          </Box>
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary, mt: 0.5 })}>
            {t('monitor.suggestionOnlyNote')}
          </Typography>
        </>
      )}

      <Typography sx={{ ...sectionLabelSx, mt: 2.25 }}>{t('monitor.evidence')}</Typography>
      {alertMessage && (
        <Box
          sx={(theme) => ({
            bgcolor: theme.palette.kanap.bg.composer,
            border: `1px solid ${theme.palette.kanap.border.default}`,
            borderRadius: '8px',
            px: 1.5,
            py: 1.25,
            mt: 0.75,
            maxWidth: '78ch',
            overflowX: 'auto',
          })}
        >
          <Typography sx={(theme) => ({ ...monoSx, fontSize: 12, color: theme.palette.kanap.text.secondary, whiteSpace: 'pre-wrap' })}>
            {alertMessage}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary, mt: 0.5 })}>
            {t('monitor.alertMessageLabel')}
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px 24px', maxWidth: '78ch', mt: 1.5 }}>
        {alertStatus && (
          <Fact label={t('monitor.stateAtDiagnosis')}>
            {t(`monitor.alertStates.${alertStatus}`, { defaultValue: humanize(alertStatus) })}
            {ackState ? `, ${t(`monitor.ack.${ackState}`, { defaultValue: humanize(ackState) }).toLowerCase()}` : ''}
          </Fact>
        )}
        {diagnosis.history_window_minutes != null && (
          <Fact label={t('monitor.historyLabel', { minutes: diagnosis.history_window_minutes })} dim>
            {diagnosis.history_point_count
              ? t('monitor.historyPoints', { count: diagnosis.history_point_count })
              : t('monitor.historyNoPoints')}
          </Fact>
        )}
        <Fact label={t('monitor.relatedAlertsLabel')} dim={relatedAlerts.length === 0}>
          {relatedAlerts.length === 0
            ? t('monitor.noneLabel')
            : relatedAlerts.slice(0, 4).map((related) => `#${textOf(recordOf(related).id) ?? '?'}`).join(', ')}
        </Fact>
        <Fact label={t('monitor.kanapAssetLabel')} dim={entityRefs.length === 0}>
          {entityRefs.length > 0 ? entityRefs.join(', ') : (kanapNotes[0] ?? t('monitor.noneLabel'))}
        </Fact>
        {consideredCount > 0 && (
          <Fact label={t('monitor.sourcesLabel')} dim>
            {t('monitor.sourcesConsidered', { considered: consideredCount, used: usedSources.length })}
            {rejectedSources.length > 0 && (
              <Link
                component="button"
                type="button"
                onClick={() => setShowRejected((current) => !current)}
                sx={{ ml: 1, fontSize: 12, verticalAlign: 'baseline' }}
              >
                {showRejected ? t('monitor.hideWhy') : t('monitor.showWhy')}
              </Link>
            )}
          </Fact>
        )}
      </Box>
      {showRejected && rejectedSources.length > 0 && (
        <Box sx={{ mt: 1, maxWidth: '78ch' }}>
          {rejectedSources.map((source, index) => (
            <RejectedSourceRow key={index} source={source} />
          ))}
        </Box>
      )}

      <Stack
        direction="row"
        spacing={1.75}
        useFlexGap
        flexWrap="wrap"
        alignItems="baseline"
        sx={(theme) => ({ mt: 2.25, pt: 1.25, borderTop: `1px solid ${theme.palette.kanap.border.soft}` })}
      >
        {diagnosis.observed_at && (
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary })}>
            {t('monitor.diagnosedAt', { when: formatDateTime(diagnosis.observed_at, i18n.language) })}
          </Typography>
        )}
        {diagnosis.synthesis.model && (
          <Typography sx={(theme) => ({ ...monoSx, fontSize: 11, color: theme.palette.kanap.text.tertiary })}>
            {diagnosis.synthesis.model}
          </Typography>
        )}
        {diagnosis.synthesis.tokens != null && diagnosis.synthesis.tokens > 0 && (
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary })}>
            {`${new Intl.NumberFormat(i18n.language).format(diagnosis.synthesis.tokens)} tokens`}
            {diagnosis.synthesis.cost_eur != null ? ` · ${diagnosis.synthesis.cost_eur.toFixed(4)} EUR` : ''}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {openLink && (
          <Link href={openLink} target="_blank" rel="noopener noreferrer" sx={{ fontSize: 12 }}>
            {t('monitor.openInMonitoringTool')}
          </Link>
        )}
      </Stack>

      {previous.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={sectionLabelSx}>{t('monitor.previousDiagnoses')}</Typography>
          {previous.map((entry) => (
            <Typography
              key={entry.observation_id}
              sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.secondary, mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}
            >
              {`${formatDateTime(entry.observed_at, i18n.language)} · ${entry.brief.summary ?? entry.summary ?? ''}`}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

function RejectedSourceRow({ source }: { source: AiAgentControlDiagnosticSource & { reason?: string } }) {
  return (
    <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.secondary, mt: 0.5 })}>
      <Typography component="span" sx={(theme) => ({ ...monoSx, fontSize: 11, color: theme.palette.kanap.text.tertiary, mr: 1 })}>
        {source.ref ?? source.kind}
      </Typography>
      {source.title}
      {source.reason ? ` (${source.reason})` : ''}
    </Typography>
  );
}

// Maps a synchronous "Test on an alert" result onto the dossier renderer so
// the test's outcome is finally visible, through the exact same surface.
export function dossierFromDiagnosisResult(result: AiAgentControlMonitoringDiagnosisResult): AiAgentControlMonitoringAlertDiagnosis | null {
  const diagnostic = result.diagnostic;
  if (!diagnostic) return null;
  const brief = isRecord(diagnostic.brief) ? diagnostic.brief as Record<string, unknown> : null;
  const list = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value.filter(isRecord) : []);
  return {
    observation_id: textOf(diagnostic.observation_id) ?? 'test-result',
    run_id: diagnostic.run_id ?? null,
    observed_at: textOf(recordOf(diagnostic.alert).observed_at),
    severity: textOf(recordOf(diagnostic.alert).severity),
    summary: null,
    alert: isRecord(diagnostic.alert) ? diagnostic.alert : null,
    current_state: isRecord(diagnostic.current_state) ? diagnostic.current_state : null,
    related_alerts: [],
    history_window_minutes: typeof diagnostic.history_window_minutes === 'number' ? diagnostic.history_window_minutes : null,
    history_point_count: typeof diagnostic.history_point_count === 'number' ? diagnostic.history_point_count : null,
    history_summary: isRecord(diagnostic.history_summary) ? diagnostic.history_summary : null,
    kanap_context: isRecord(diagnostic.kanap_context) ? diagnostic.kanap_context : null,
    brief: {
      summary: textOf(brief?.summary),
      probable_causes: list(brief?.probable_causes),
      business_impact: textOf(brief?.business_impact),
      recommended_actions: list(brief?.recommended_actions),
      used_sources: list(brief?.used_sources) as AiAgentControlDiagnosticSource[],
      rejected_sources: list(brief?.rejected_sources) as Array<AiAgentControlDiagnosticSource & { reason?: string }>,
      needs_human_review: brief?.needs_human_review === true,
      confidence: textOf(brief?.confidence),
      language: textOf(brief?.language),
      fallback: brief?.fallback === true,
      fallback_reason: textOf(brief?.fallback_reason),
      model: textOf(brief?.model),
    },
    synthesis: { model: textOf(brief?.model), tokens: null, cost_eur: null },
    knowledge: { status: textOf(diagnostic.knowledge_status), result_count: null },
    web: { status: textOf(diagnostic.web_search_status), result_count: null },
  };
}

// The Monitor tab's alert list: Active first (currently alerting), then
// Resolved (cleared occurrences that keep their story). One dossier open at a
// time.
export function AlertOccurrenceList({
  groups,
  cards,
  agentDefinitionId,
}: {
  groups: TicketWorkGroup[];
  cards: AiAgentControlMonitoringDiagnosisCard[];
  agentDefinitionId: string | null;
}) {
  const { t, i18n } = useTranslation(['agents']);
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const cardsByRef = React.useMemo(() => {
    const map = new Map<string, AiAgentControlMonitoringDiagnosisCard>();
    for (const card of cards) {
      map.set(card.target_ref, card);
    }
    return map;
  }, [cards]);
  if (groups.length === 0) {
    return <EmptyState>{t('monitor.noWatchedAlerts')}</EmptyState>;
  }
  const active = groups.filter((group) => {
    const status = monitoringDiagnosisFields(group).lastStatus;
    return !!status && ALERTING_STATES.has(status);
  });
  const resolved = groups.filter((group) => !active.includes(group));
  const renderRows = (rows: TicketWorkGroup[]) => rows.map((group, index) => (
    <Box key={group.key} sx={(theme) => (index > 0 ? { borderTop: `1px solid ${theme.palette.kanap.border.soft}` } : {})}>
      <AlertRow
        group={group}
        card={cardsByRef.get(group.targetRef) ?? null}
        expanded={expandedKey === group.key}
        onToggle={() => setExpandedKey((current) => (current === group.key ? null : group.key))}
        agentDefinitionId={agentDefinitionId}
        locale={i18n.language}
      />
    </Box>
  ));
  return (
    <Box sx={{ pb: 0.75 }}>
      {active.length > 0 && (
        <>
          <Typography sx={{ ...sectionLabelSx, px: 1.5, pt: 1.25, pb: 0.5 }}>
            {t('monitor.alertsActiveGroup', { count: active.length })}
          </Typography>
          {renderRows(active)}
        </>
      )}
      {resolved.length > 0 && (
        <>
          <Typography sx={{ ...sectionLabelSx, px: 1.5, pt: active.length > 0 ? 1.75 : 1.25, pb: 0.5 }}>
            {t('monitor.alertsResolvedGroup', { count: resolved.length })}
          </Typography>
          {renderRows(resolved)}
        </>
      )}
    </Box>
  );
}
