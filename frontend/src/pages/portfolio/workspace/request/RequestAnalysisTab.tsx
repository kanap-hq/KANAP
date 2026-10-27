import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import BusinessProcessMultiSelect from '../../../../components/fields/BusinessProcessMultiSelect';
import IntegratedDocumentEditor, { type IntegratedDocumentEditorHandle } from '../../../../components/IntegratedDocumentEditor';
import { MarkdownContent } from '../../../../components/MarkdownContent';
import { getRequestStatusLabel } from '../../../../utils/portfolioI18n';
import FeasibilityReview from '../../editors/FeasibilityReview';

type RecommendationColor = 'default' | 'success' | 'error' | 'warning' | 'info';

type RequestAnalysisTabProps = {
  canEditManagedDocs: boolean;
  /** `business_processes:member` on top of `canManage`, as the process links of the Relations tab. */
  canEditProcesses: boolean;
  canManage: boolean;
  categoryName?: string;
  form: any;
  highlightLatestRecommendation: boolean;
  id: string;
  latestAnalysisRecommendation: any;
  latestRecommendationAuthor: string;
  latestRecommendationCreatedAt: string;
  latestRecommendationOutcome: string | null;
  latestRecommendationOutcomeColor: RecommendationColor;
  latestRecommendationStatusChange: [unknown, unknown] | undefined;
  onBusinessProcessesChange: (ids: string[]) => Promise<void>;
  onOpenActivity: () => void;
  onOpenRecommendationDialog: () => void;
  onRisksDraftChange: (value: string) => void;
  onRisksDirtyChange: (dirty: boolean) => void;
  onUpdateFeasibilityReview: (value: any) => void;
  recommendationButtonLabel: string;
  risksEditorRef: React.RefObject<IntegratedDocumentEditorHandle>;
  streamName?: string;
};

const hasContentValue = (value: unknown): boolean => {
  if (value == null) return false;
  const text = String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/[#*_~`>\-\[\]()!|]/g, '')
    .trim();
  return text.length > 0;
};

export default function RequestAnalysisTab({
  canEditManagedDocs,
  canEditProcesses,
  canManage,
  categoryName,
  form,
  highlightLatestRecommendation,
  id,
  latestAnalysisRecommendation,
  latestRecommendationAuthor,
  latestRecommendationCreatedAt,
  latestRecommendationOutcome,
  latestRecommendationOutcomeColor,
  latestRecommendationStatusChange,
  onBusinessProcessesChange,
  onOpenActivity,
  onOpenRecommendationDialog,
  onRisksDraftChange,
  onRisksDirtyChange,
  onUpdateFeasibilityReview,
  recommendationButtonLabel,
  risksEditorRef,
  streamName,
}: RequestAnalysisTabProps) {
  const { t } = useTranslation('portfolio');
  const hasLegacyAnalysis = hasContentValue(form?.current_situation) || hasContentValue(form?.expected_benefits);

  return (
    <Stack spacing={2}>
      {/* Null for a person who does not read business processes: the section is not shown. */}
      {form?.business_processes !== null && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
            {t('workspace.request.analysis.sections.businessProcesses')}
          </Typography>
          <BusinessProcessMultiSelect
            label={t('workspace.request.analysis.fields.businessProcesses')}
            value={(form?.business_processes || []).map((bp: any) => bp.id)}
            onChange={onBusinessProcessesChange}
            disabled={!canEditProcesses}
          />
        </>
      )}
      <Typography variant="subtitle1" sx={{ fontWeight: 500, mt: 1 }}>
        {t('workspace.request.analysis.sections.feasibilityReview')}
      </Typography>
      <FeasibilityReview
        value={form?.feasibility_review}
        onChange={onUpdateFeasibilityReview}
        disabled={!canManage}
        categoryName={categoryName}
        streamName={streamName}
      />
      <Box>
        <IntegratedDocumentEditor
          ref={risksEditorRef}
          entityType="requests"
          entityId={id}
          slotKey="risks_mitigations"
          label={t('workspace.request.analysis.fields.risksMitigations')}
          placeholder={t('workspace.request.analysis.placeholders.risksMitigations')}
          minRows={12}
          maxRows={24}
          disabled={!canEditManagedDocs}
          draftValue={form?.risks || ''}
          onDraftChange={onRisksDraftChange}
          onDirtyChange={onRisksDirtyChange}
          showDocumentControls={false}
          showManagedDocChip={false}
          editModeBehavior="auto"
          autosaveEnabled
          surface
          hideToolbarUntilFocus
        />
      </Box>

      <Box
        sx={{
          p: 2,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
        }}
      >
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            alignItems={{ xs: 'stretch', md: 'flex-start' }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                {t('workspace.request.analysis.sections.analysisRecommendation')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('workspace.request.analysis.messages.publishRecommendation')}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
              {latestAnalysisRecommendation && (
                <Button variant="outlined" onClick={onOpenActivity} sx={{ whiteSpace: 'nowrap' }}>
                  {t('workspace.request.analysis.actions.viewInActivity')}
                </Button>
              )}
              <Button
                variant="contained"
                color="warning"
                disabled={!canManage || form?.status === 'converted'}
                onClick={onOpenRecommendationDialog}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {recommendationButtonLabel}
              </Button>
            </Stack>
          </Stack>

          {latestAnalysisRecommendation ? (
            <Box
              sx={{
                p: 1.5,
                border: 1,
                borderColor: highlightLatestRecommendation ? 'success.main' : 'divider',
                borderRadius: 1,
                bgcolor: highlightLatestRecommendation ? 'success.light' : 'action.hover',
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {t('workspace.request.analysis.labels.latestRecommendation')}
                </Typography>
                {latestRecommendationOutcome && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                    {latestRecommendationOutcome}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                  {latestRecommendationAuthor} • {latestRecommendationCreatedAt}
                </Typography>
              </Stack>
              {Array.isArray(latestRecommendationStatusChange) && latestRecommendationStatusChange.length === 2 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {t('workspace.request.analysis.messages.statusChanged', {
                    from: getRequestStatusLabel(t, String(latestRecommendationStatusChange[0] || '')),
                    to: getRequestStatusLabel(t, String(latestRecommendationStatusChange[1] || '')),
                  })}
                </Typography>
              )}
              {hasContentValue(latestAnalysisRecommendation.content) && (
                <Box sx={{ mt: 1, maxHeight: 140, overflow: 'hidden' }}>
                  <MarkdownContent content={latestAnalysisRecommendation.content} variant="compact" />
                </Box>
              )}
            </Box>
          ) : (
            <Alert severity="info">
              {t('workspace.request.analysis.states.noRecommendation')}
            </Alert>
          )}
        </Stack>
      </Box>

      {hasLegacyAnalysis && (
        <Accordion disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">
              {t('workspace.request.analysis.sections.previousAnalysis')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              {hasContentValue(form?.current_situation) && (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('workspace.request.analysis.labels.currentSituation')}
                  </Typography>
                  <MarkdownContent content={form?.current_situation} />
                </Box>
              )}
              {hasContentValue(form?.expected_benefits) && (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('workspace.request.analysis.labels.expectedBenefits')}
                  </Typography>
                  <MarkdownContent content={form?.expected_benefits} />
                </Box>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  );
}
