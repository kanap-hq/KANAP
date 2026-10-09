import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';
import { getDotColor } from '../../../utils/statusColors';
import { PropertyRow, StatusDot } from '../../../components/design';
import { formatShortDateTime } from '../../../lib/dateFormat';
import { drawerAutocompleteListboxSx, drawerMenuItemSx, drawerSelectSx, drawerFieldValueSx, longFormSurfaceFieldSx } from '../../../theme/formSx';

// Flat section styling (charter: no accordions/chevrons in property panels).
const sectionHeaderSx = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 32,
  pt: 1,
  pb: 0.5,
} as const;

const sectionLabelSx = {
  fontSize: 11,
  fontWeight: 500,
  color: 'kanap.text.secondary',
} as const;

// Compact variant of the long-form composer surface for the narrow sidebar.
const sidebarLongFormSx = {
  '& .MuiInputBase-root': { minHeight: 0, px: '10px', py: '8px' },
  '& .MuiInputBase-input': { fontSize: '13px !important', lineHeight: '1.5 !important' },
} as const;

const STATUS_OPTIONS = [
  { value: 'draft' },
  { value: 'published' },
  { value: 'archived' },
  { value: 'obsolete' },
];

type RelationKey = 'applications' | 'assets' | 'projects' | 'requests' | 'tasks' | 'incidents';
type RelationOption = { id: string; label: string };
type ContributorAssignments = {
  owner_user_id: string | null;
  author_user_ids: string[];
  reviewer_user_ids: string[];
  approver_user_ids: string[];
};
type ContributorOption = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  label: string;
};
type DocumentTypeOption = {
  id: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  is_system: boolean;
};

type ClassificationRow = {
  category_id: string;
  stream_id: string | null;
};

interface KnowledgeSidebarProps {
  doc: any;
  form: any;
  onChange: (field: string, value: any) => void;
  isCreate: boolean;
  editMode: boolean;
  canManage: boolean;
  canComment: boolean;
  contributorOptions: ContributorOption[];
  contributorAssignments: ContributorAssignments;
  onContributorAssignmentsChange: (next: ContributorAssignments) => void;
  contributorsError: string | null;
  documentTypeOptions: DocumentTypeOption[];
  // Folder options
  folderOptions: Array<{ id: string; label: string }>;
  // Classification
  classificationCategories: Array<any>;
  classificationStreams: Array<any>;
  classificationRows: ClassificationRow[];
  onClassificationRowsChange: (rows: ClassificationRow[]) => void;
  classificationError: string | null;
  // Relations
  relationSelections: Record<RelationKey, RelationOption[]>;
  onRelationSelectionsChange: (key: RelationKey, values: RelationOption[]) => void;
  relationSearch: Record<RelationKey, string>;
  onRelationSearchChange: (key: RelationKey, value: string) => void;
  relationOptions: Record<RelationKey, RelationOption[]>;
  relationsError: string | null;
  // Versions
  versions: any[];
  onRevertVersion: (versionNumber: number) => void;
  revertingVersion: boolean;
  lockToken: string | null;
  workflow: any;
  latestApprovedWorkflow: any;
  currentUserId: string | null;
  canApproveWorkflow: boolean;
  onApproveWorkflow: (comment: string) => Promise<void>;
  approvingWorkflow: boolean;
  onRequestWorkflowChanges: (comment: string) => Promise<void>;
  requestingWorkflowChanges: boolean;
  // Activity / Comments
  activities: any[];
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onPostComment: () => void;
  postingComment: boolean;
}

const RELATION_LABELS: Record<RelationKey, string> = {
  applications: 'Applications',
  assets: 'Assets',
  projects: 'Projects',
  requests: 'Requests',
  tasks: 'Tasks',
  incidents: 'Incidents',
};

const EMPTY_CLASSIFICATION_ROW: ClassificationRow = { category_id: '', stream_id: null };

function ManagedReadonlyBadge({ title }: { title: string }) {
  return (
    <Tooltip title={title}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'text.secondary',
          lineHeight: 0,
        }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 16 }} />
      </Box>
    </Tooltip>
  );
}

function ManagedReadonlyFieldLabel({ label, title }: { label: string; title: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <ManagedReadonlyBadge title={title} />
    </Stack>
  );
}

const KnowledgeSidebar = React.memo(function KnowledgeSidebar({
  doc,
  form,
  onChange,
  isCreate,
  editMode,
  canManage,
  canComment,
  contributorOptions,
  contributorAssignments,
  onContributorAssignmentsChange,
  contributorsError,
  documentTypeOptions,
  folderOptions,
  classificationCategories,
  classificationStreams,
  classificationRows,
  onClassificationRowsChange,
  classificationError,
  relationSelections,
  onRelationSelectionsChange,
  relationSearch,
  onRelationSearchChange,
  relationOptions,
  relationsError,
  versions,
  onRevertVersion,
  revertingVersion,
  lockToken,
  workflow,
  latestApprovedWorkflow,
  currentUserId,
  canApproveWorkflow,
  onApproveWorkflow,
  approvingWorkflow,
  onRequestWorkflowChanges,
  requestingWorkflowChanges,
  activities,
  commentText,
  onCommentTextChange,
  onPostComment,
  postingComment,
}: KnowledgeSidebarProps) {
  const { t } = useTranslation(['knowledge', 'common']);
  const locale = useLocale();
  const mode = useTheme().palette.mode;
  const [activeTab, setActiveTab] = React.useState<'properties' | 'comments'>('properties');
  const [workflowComment, setWorkflowComment] = React.useState('');

  const disabled = !editMode && !isCreate;
  const isManagedIntegratedDocument = !!doc?.is_managed_integrated_document;
  const managedMetadataDisabled = disabled || isManagedIntegratedDocument;
  const workflowActive = !!workflow?.is_active;
  const managedStatusTooltip = t('sidebar.tooltips.managedStatus');
  const managedFolderTooltip = t('sidebar.tooltips.managedFolder');
  const managedTypeTooltip = t('sidebar.tooltips.managedType');
  const managedTemplateTooltip = t('sidebar.tooltips.managedTemplate');
  const managedRelationsTooltip = t('sidebar.tooltips.managedRelations');
  const managedWorkflowTooltip = t('sidebar.tooltips.managedWorkflow');
  const templateDocumentId = form?.template_document_id !== undefined
    ? form.template_document_id
    : doc?.template_document_id;
  const templateRef = doc?.template_document_item_number && templateDocumentId
    ? `DOC-${doc.template_document_item_number}`
    : (templateDocumentId ? String(templateDocumentId) : '');
  const templateTitle = form?.template_document_title !== undefined
    ? String(form.template_document_title || '')
    : String(doc?.template_document_title || '');
  const activeDocumentType = documentTypeOptions.find((row) => row.id === form?.document_type_id)
    || documentTypeOptions.find((row) => row.id === doc?.document_type_id)
    || null;
  const contributorRoleLabel: Record<string, string> = {
    owner: t('sidebar.contributors.roles.owner'),
    author: t('sidebar.contributors.roles.author'),
    reviewer: t('sidebar.contributors.roles.reviewer'),
    validator: t('sidebar.contributors.roles.approver'),
  };
  const readOnlyClassifications = Array.isArray(doc?.classifications)
    ? doc.classifications
        .map((row: any) => ({
          key: `${row?.category_id || 'category'}:${row?.stream_id || 'stream'}`,
          label: row?.stream_name
            ? `${row?.category_name || row?.category_id || t('shared.unknown')} / ${row.stream_name}`
            : (row?.category_name || row?.category_id || t('shared.unknown')),
        }))
        .filter((row: { label: string }) => !!row.label)
    : [];
  const readOnlyRelations = React.useMemo(() => (
    (Object.keys(RELATION_LABELS) as RelationKey[])
      .map((key) => ({
        key,
        label: t(`sidebar.relations.labels.${key}`),
        items: (relationSelections[key] || []).map((entry) => ({
          id: entry.id,
          label: entry.label || entry.id,
        })),
      }))
      .filter((row) => row.items.length > 0)
  ), [relationSelections, t]);
  const mergedContributorOptions = React.useMemo(() => {
    const out = [...contributorOptions];
    const seen = new Set(out.map((row) => row.id));
    for (const row of Array.isArray(doc?.contributors) ? doc.contributors : []) {
      const id = String(row?.user_id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        email: String(row?.email || ''),
        label: String(row?.user_name || row?.user_id || id),
      });
    }
    if (currentUserId) {
      const ownIndex = out.findIndex((row) => row.id === currentUserId);
      if (ownIndex > 0) out.unshift(...out.splice(ownIndex, 1));
    }
    return out;
  }, [contributorOptions, currentUserId, doc?.contributors]);
  // The server's label wins: it is the email when another account shares the name.
  const formatContributorLabel = React.useCallback((option: ContributorOption) => {
    const label = String(option?.label || '').trim();
    if (label) return label;
    const firstName = String(option?.first_name || '').trim();
    const lastName = String(option?.last_name || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    return fullName || option?.email || option?.id || '';
  }, []);
  const getContributorOptionLabel = React.useCallback((option: ContributorOption) => {
    const baseLabel = formatContributorLabel(option);
    return option.id === currentUserId ? `${baseLabel} ${t('common:selects.meSuffix')}` : baseLabel;
  }, [currentUserId, formatContributorLabel, t]);
  const renderContributorOption = React.useCallback((
    props: React.HTMLAttributes<HTMLLIElement>,
    option: ContributorOption,
  ) => (
    <React.Fragment key={option.id}>
      <li {...props}>
        <div style={{ fontWeight: 500 }}>
          {getContributorOptionLabel(option)}
        </div>
      </li>
      {option.id === currentUserId && mergedContributorOptions.length > 1 && (
        <Divider sx={(theme) => ({ borderColor: theme.palette.kanap.border.soft })} />
      )}
    </React.Fragment>
  ), [currentUserId, getContributorOptionLabel, mergedContributorOptions.length]);
  const getContributorValue = React.useCallback((id: string | null | undefined) => {
    if (!id) return null;
    return mergedContributorOptions.find((row) => row.id === id) || null;
  }, [mergedContributorOptions]);
  const getContributorValues = React.useCallback((ids: string[]) => (
    ids
      .map((id) => getContributorValue(id))
      .filter((row): row is ContributorOption => !!row)
  ), [getContributorValue]);
  const reviewerParticipants = Array.isArray(workflow?.participants)
    ? workflow.participants.filter((row: any) => row?.stage === 'reviewer')
    : [];
  const approverParticipants = Array.isArray(workflow?.participants)
    ? workflow.participants.filter((row: any) => row?.stage === 'approver')
    : [];
  const hasReviewerStage = reviewerParticipants.length > 0;
  const hasApproverStage = approverParticipants.length > 0;
  const currentStage = workflow?.current_stage || null;
  const lastApprovedRevision = latestApprovedWorkflow?.requested_revision
    ? Number(latestApprovedWorkflow.requested_revision)
    : null;
  const recentWorkflowActivity = React.useMemo(() => (
    (activities || [])
      .map((activity: any) => {
        const content = String(activity?.content || '').trim();
        if (!content) return null;
        if (content === 'Review requested') {
          return {
            id: activity.id,
            label: t('sidebar.workflow.activity.reviewRequested'),
            actor: activity.author_name || null,
            detail: null,
            created_at: activity.created_at,
          };
        }
        if (content === 'Approval requested' || content === 'Review stage completed. Approval requested.') {
          return {
            id: activity.id,
            label: t('sidebar.workflow.activity.approvalRequested'),
            actor: activity.author_name || null,
            detail: null,
            created_at: activity.created_at,
          };
        }
        if (content === 'Workflow approved and document published') {
          return {
            id: activity.id,
            label: t('sidebar.workflow.activity.approvedPublished'),
            actor: activity.author_name || null,
            detail: null,
            created_at: activity.created_at,
          };
        }
        if (content === 'Review cancelled') {
          return {
            id: activity.id,
            label: t('sidebar.workflow.activity.reviewCancelled'),
            actor: activity.author_name || null,
            detail: null,
            created_at: activity.created_at,
          };
        }
        const changesRequestedMatch = content.match(/^Changes requested by [^:]+:\s*(.+)$/i);
        if (changesRequestedMatch) {
          return {
            id: activity.id,
            label: t('sidebar.workflow.activity.changesRequested'),
            actor: activity.author_name || null,
            detail: changesRequestedMatch[1] || null,
            created_at: activity.created_at,
          };
        }
        return null;
      })
      .filter((row): row is { id: string; label: string; actor: string | null; detail: string | null; created_at: string | null } => !!row)
      .slice(0, 3)
  ), [activities]);
  const currentStageExplanation = React.useMemo(() => {
    if (!workflowActive) return null;
    if (currentStage === 'reviewer') {
      return hasApproverStage
        ? t('sidebar.workflow.messages.approversWaiting')
        : t('sidebar.workflow.messages.publishWhenReviewersApprove');
    }
    if (currentStage === 'approver') {
      return t('sidebar.workflow.messages.publishWhenApproversApprove');
    }
    return null;
  }, [currentStage, hasApproverStage, t, workflowActive]);
  const getStageState = React.useCallback((stage: 'reviewer' | 'approver', participants: any[]) => {
    if (!participants.length) return null;
    if (currentStage === stage) return 'active';
    if (stage === 'approver' && currentStage === 'reviewer') return 'waiting';
    if (participants.every((row: any) => row?.decision === 'approved')) return 'completed';
    return 'idle';
  }, [currentStage]);
  const reviewerStageState = getStageState('reviewer', reviewerParticipants);
  const approverStageState = getStageState('approver', approverParticipants);
  const editableClassificationRows = classificationRows.length > 0
    ? classificationRows
    : [EMPTY_CLASSIFICATION_ROW];
  const hasPendingClassificationRow = editableClassificationRows.some((row) => !row.category_id);
  const updateClassificationRow = React.useCallback((index: number, nextRow: ClassificationRow) => {
    const rows = classificationRows.length > 0 ? classificationRows : [EMPTY_CLASSIFICATION_ROW];
    onClassificationRowsChange(rows.map((row, idx) => (idx === index ? nextRow : row)));
  }, [classificationRows, onClassificationRowsChange]);
  const removeClassificationRow = React.useCallback((index: number) => {
    onClassificationRowsChange(classificationRows.filter((_, idx) => idx !== index));
  }, [classificationRows, onClassificationRowsChange]);
  const addClassificationRow = React.useCallback(() => {
    if (classificationRows.some((row) => !row.category_id)) return;
    onClassificationRowsChange([...classificationRows, { ...EMPTY_CLASSIFICATION_ROW }]);
  }, [classificationRows, onClassificationRowsChange]);

  React.useEffect(() => {
    setWorkflowComment('');
  }, [workflow?.id]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.5 } }}
      >
        <Tab value="properties" label={t('sidebar.tabs.properties')} />
        <Tab value="comments" label={t('sidebar.tabs.comments')} />
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
        {activeTab === 'properties' && (
          <Stack spacing={0}>
            {/* Status & Info — always visible */}
            <Stack spacing={1.5} sx={{ mb: 1 }}>
              {!isCreate && doc?.item_number && (
                <Typography variant="caption" color="text.secondary">
                  {t('sidebar.values.documentVersion', { itemNumber: doc.item_number, version: form.revision || 1 })}
                </Typography>
              )}
              <PropertyRow
                label={isManagedIntegratedDocument
                  ? <ManagedReadonlyFieldLabel label={t('sidebar.fields.status')} title={managedStatusTooltip} />
                  : t('sidebar.fields.status')}
              >
                <TextField
                  select
                  variant="standard"
                  value={form.status || 'draft'}
                  onChange={(e) => onChange('status', e.target.value)}
                  disabled={managedMetadataDisabled}
                  fullWidth
                  sx={drawerSelectSx}
                >
                  {form.status === 'in_review' && (
                    <MenuItem value="in_review" sx={drawerMenuItemSx}>{t('statuses.in_review')}</MenuItem>
                  )}
                  {STATUS_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                      {t(`statuses.${option.value}`)}
                    </MenuItem>
                  ))}
                </TextField>
              </PropertyRow>
              <PropertyRow
                label={isManagedIntegratedDocument
                  ? <ManagedReadonlyFieldLabel label={t('sidebar.fields.folder')} title={managedFolderTooltip} />
                  : t('sidebar.fields.folder')}
              >
                <TextField
                  select
                  variant="standard"
                  value={form.folder_id || ''}
                  onChange={(e) => onChange('folder_id', e.target.value || null)}
                  disabled={managedMetadataDisabled}
                  fullWidth
                  sx={drawerSelectSx}
                >
                  <MenuItem value="" sx={drawerMenuItemSx}>{t('shared.unfiled')}</MenuItem>
                  {folderOptions.map((folder) => (
                    <MenuItem key={folder.id} value={folder.id} sx={drawerMenuItemSx}>
                      {folder.label}
                    </MenuItem>
                  ))}
                </TextField>
              </PropertyRow>
              {documentTypeOptions.length > 0 ? (
                <PropertyRow
                  label={isManagedIntegratedDocument
                    ? <ManagedReadonlyFieldLabel label={t('sidebar.fields.type')} title={managedTypeTooltip} />
                    : t('sidebar.fields.type')}
                >
                  <TextField
                    select
                    variant="standard"
                    value={form.document_type_id || ''}
                    onChange={(e) => onChange('document_type_id', e.target.value || null)}
                    disabled={managedMetadataDisabled}
                    fullWidth
                    sx={drawerSelectSx}
                  >
                    {documentTypeOptions.map((option) => (
                      <MenuItem
                        key={option.id}
                        value={option.id}
                        disabled={!option.is_active && option.id !== form.document_type_id}
                        sx={drawerMenuItemSx}
                      >
                        {option.name}
                        {option.is_default ? ` (${t('sidebar.values.default')})` : ''}
                        {!option.is_active ? ` (${t('sidebar.values.inactive')})` : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                </PropertyRow>
              ) : (
                <PropertyRow
                  label={isManagedIntegratedDocument
                    ? <ManagedReadonlyFieldLabel label={t('sidebar.fields.type')} title={managedTypeTooltip} />
                    : t('sidebar.fields.type')}
                >
                  <TextField
                    variant="standard"
                    value={activeDocumentType?.name || t('shared.document')}
                    fullWidth
                    InputProps={{ readOnly: true }}
                  />
                </PropertyRow>
              )}
              <PropertyRow
                label={isManagedIntegratedDocument
                  ? <ManagedReadonlyFieldLabel label={t('sidebar.fields.basedOnTemplate')} title={managedTemplateTooltip} />
                  : t('sidebar.fields.basedOnTemplate')}
              >
                <TextField
                  variant="standard"
                  value={templateTitle || t('shared.none')}
                  disabled
                  fullWidth
                />
              </PropertyRow>
              {!!templateTitle && !!templateRef && (
                <Button size="small" href={`/knowledge/${templateRef}`} sx={{ alignSelf: 'flex-start', textTransform: 'none', px: 0 }}>
                  {t('sidebar.actions.openTemplate')}
                </Button>
              )}
              <PropertyRow label={t('sidebar.fields.summary')}>
                <TextField
                  variant="standard"
                  value={form.summary || ''}
                  onChange={(e) => onChange('summary', e.target.value)}
                  multiline
                  minRows={2}
                  maxRows={4}
                  disabled={disabled}
                  fullWidth
                  placeholder={t('sidebar.fields.summary')}
                  sx={[longFormSurfaceFieldSx, sidebarLongFormSx]}
                />
              </PropertyRow>
            </Stack>

            {isCreate ? (
              <Alert severity="info" sx={{ fontSize: '0.75rem' }}>{t('sidebar.messages.saveFirstAll')}</Alert>
            ) : (
              <>
            <Divider />

            {/* Contributors */}
            <Box>
              <Box sx={sectionHeaderSx}>
                <Typography sx={sectionLabelSx}>{t('sidebar.sections.contributors')}</Typography>
              </Box>
              <Box>
                {isCreate ? (
                  <Alert severity="info" sx={{ fontSize: '0.75rem' }}>{t('sidebar.contributors.messages.saveFirst')}</Alert>
                ) : !canManage ? (
                  (doc?.contributors || []).length === 0 ? (
                    <Typography variant="body2" color="text.secondary">{t('sidebar.contributors.empty')}</Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {(doc?.contributors || []).map((row: any) => (
                        <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{contributorRoleLabel[row.role] || row.role}</Box>
                          <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.user_name || row.user_id}
                          </Typography>
                          {row.is_primary && <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{t('sidebar.contributors.primary')}</Box>}
                        </Box>
                      ))}
                    </Stack>
                  )
                ) : (
                  <Stack spacing={0.75}>
                    <PropertyRow label={t('sidebar.contributors.fields.owner')}>
                      <Autocomplete
                        size="small"
                        options={mergedContributorOptions}
                        disableClearable
                        value={getContributorValue(contributorAssignments.owner_user_id) || undefined}
                        onChange={(_, value) => onContributorAssignmentsChange({
                          ...contributorAssignments,
                          owner_user_id: value?.id || null,
                        })}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        getOptionLabel={formatContributorLabel}
                        renderOption={renderContributorOption}
                        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="standard"
                            placeholder={t('sidebar.contributors.placeholders.owner')}
                          />
                        )}
                      />
                    </PropertyRow>
                    <PropertyRow label={t('sidebar.contributors.fields.authors')}>
                      <Autocomplete
                        multiple
                        size="small"
                        options={mergedContributorOptions}
                        value={getContributorValues(contributorAssignments.author_user_ids)}
                        onChange={(_, values) => onContributorAssignmentsChange({
                          ...contributorAssignments,
                          author_user_ids: values.map((row) => row.id),
                        })}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        getOptionLabel={formatContributorLabel}
                        renderOption={renderContributorOption}
                        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="standard"
                            placeholder={t('sidebar.contributors.placeholders.authors')}
                          />
                        )}
                      />
                    </PropertyRow>
                    <PropertyRow label={t('sidebar.contributors.fields.reviewers')}>
                      <Autocomplete
                        multiple
                        size="small"
                        options={mergedContributorOptions}
                        value={getContributorValues(contributorAssignments.reviewer_user_ids)}
                        onChange={(_, values) => onContributorAssignmentsChange({
                          ...contributorAssignments,
                          reviewer_user_ids: values.map((row) => row.id),
                        })}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        getOptionLabel={formatContributorLabel}
                        renderOption={renderContributorOption}
                        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="standard"
                            placeholder={t('sidebar.contributors.placeholders.reviewers')}
                          />
                        )}
                      />
                    </PropertyRow>
                    <PropertyRow label={t('sidebar.contributors.fields.approvers')}>
                      <Autocomplete
                        multiple
                        size="small"
                        options={mergedContributorOptions}
                        value={getContributorValues(contributorAssignments.approver_user_ids)}
                        onChange={(_, values) => onContributorAssignmentsChange({
                          ...contributorAssignments,
                          approver_user_ids: values.map((row) => row.id),
                        })}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        getOptionLabel={formatContributorLabel}
                        renderOption={renderContributorOption}
                        ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="standard"
                            placeholder={t('sidebar.contributors.placeholders.approvers')}
                          />
                        )}
                      />
                    </PropertyRow>
                    {contributorsError && <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{contributorsError}</Alert>}
                  </Stack>
                )}
              </Box>
            </Box>

            <Divider />

            <Box>
              <Box sx={sectionHeaderSx}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography sx={sectionLabelSx}>{t('sidebar.sections.workflow')}</Typography>
                  {isManagedIntegratedDocument && (
                    <ManagedReadonlyBadge title={managedWorkflowTooltip} />
                  )}
                </Stack>
              </Box>
              <Box>
                <Stack spacing={1}>
                  {workflowActive ? (
                    <>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" alignItems="center">
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <StatusDot color={getDotColor('warning', mode)} />
                          <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>
                            {currentStage === 'approver' ? t('sidebar.workflow.values.awaitingApproval') : t('sidebar.workflow.values.awaitingReview')}
                          </Typography>
                        </Box>
                        <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                          {t('sidebar.workflow.values.revision', { count: workflow?.requested_revision || form.revision || 1 })}
                        </Box>
                      </Stack>
                      <Typography variant="body2">
                        {t('sidebar.workflow.requestedBy', { user: workflow?.requested_by_name || t('shared.unknown') })}
                        {workflow?.requested_at ? ` on ${new Date(workflow.requested_at).toLocaleString(locale)}` : ''}
                      </Typography>
                      {!!currentStageExplanation && (
                        <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
                          {currentStageExplanation}
                        </Alert>
                      )}
                      {reviewerParticipants.length > 0 && (
                        <Stack spacing={0.5}>
                          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                            <Typography variant="caption" color="text.secondary">
                              {t('sidebar.workflow.stage1Review', {
                                approved: reviewerParticipants.filter((row: any) => row?.decision === 'approved').length,
                                total: reviewerParticipants.length,
                              })}
                            </Typography>
                            {(() => {
                              const _c = reviewerStageState === 'active' ? 'warning' : reviewerStageState === 'completed' ? 'success' : 'default';
                              const _l = reviewerStageState === 'active' ? t('sidebar.workflow.values.active') : reviewerStageState === 'completed' ? t('sidebar.workflow.values.completed') : t('sidebar.workflow.values.pending');
                              return (
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                  <StatusDot color={getDotColor(_c, mode)} />
                                  <Typography variant="body2" sx={{ color: getDotColor(_c, mode), fontWeight: 500, fontSize: '0.8125rem' }}>{_l}</Typography>
                                </Box>
                              );
                            })()}
                          </Stack>
                          {reviewerParticipants.map((row: any) => (
                            <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ flex: 1 }}>{row.user_name || row.user_id}</Typography>
                              {(() => {
                                const _c = row.decision === 'approved' ? 'success' : row.decision === 'changes_requested' ? 'error' : 'default';
                                const _l = row.decision === 'approved' ? t('sidebar.workflow.values.approved') : row.decision === 'changes_requested' ? t('sidebar.workflow.values.changesRequested') : t('sidebar.workflow.values.pending');
                                return (
                                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                    <StatusDot color={getDotColor(_c, mode)} />
                                    <Typography variant="body2" sx={{ color: getDotColor(_c, mode), fontWeight: 500, fontSize: '0.8125rem' }}>{_l}</Typography>
                                  </Box>
                                );
                              })()}
                              {row.user_id === currentUserId && <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{t('sidebar.workflow.values.you')}</Box>}
                              {!!row.comment && (
                                <Typography variant="caption" color="text.secondary" sx={{ width: '100%' }}>
                                  {row.comment}
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Stack>
                      )}
                      {approverParticipants.length > 0 && (
                        <Stack spacing={0.5}>
                          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                            <Typography variant="caption" color="text.secondary">
                              {t('sidebar.workflow.stage2Approval', {
                                approved: approverParticipants.filter((row: any) => row?.decision === 'approved').length,
                                total: approverParticipants.length,
                              })}
                            </Typography>
                            {(() => {
                              const _c = approverStageState === 'active' ? 'warning' : approverStageState === 'completed' ? 'success' : 'default';
                              const _l = approverStageState === 'active' ? t('sidebar.workflow.values.active') : approverStageState === 'completed' ? t('sidebar.workflow.values.completed') : approverStageState === 'waiting' ? t('sidebar.workflow.values.waiting') : t('sidebar.workflow.values.pending');
                              return (
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                  <StatusDot color={getDotColor(_c, mode)} />
                                  <Typography variant="body2" sx={{ color: getDotColor(_c, mode), fontWeight: 500, fontSize: '0.8125rem' }}>{_l}</Typography>
                                </Box>
                              );
                            })()}
                          </Stack>
                          {approverParticipants.map((row: any) => (
                            <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ flex: 1 }}>{row.user_name || row.user_id}</Typography>
                              {(() => {
                                const _c = row.decision === 'approved' ? 'success' : row.decision === 'changes_requested' ? 'error' : 'default';
                                const _l = row.decision === 'approved'
                                  ? t('sidebar.workflow.values.approved')
                                  : row.decision === 'changes_requested'
                                    ? t('sidebar.workflow.values.changesRequested')
                                    : currentStage === 'reviewer'
                                      ? t('sidebar.workflow.values.waiting')
                                      : t('sidebar.workflow.values.pending');
                                return (
                                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                    <StatusDot color={getDotColor(_c, mode)} />
                                    <Typography variant="body2" sx={{ color: getDotColor(_c, mode), fontWeight: 500, fontSize: '0.8125rem' }}>{_l}</Typography>
                                  </Box>
                                );
                              })()}
                              {row.user_id === currentUserId && <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{t('sidebar.workflow.values.you')}</Box>}
                              {!!row.comment && (
                                <Typography variant="caption" color="text.secondary" sx={{ width: '100%' }}>
                                  {row.comment}
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Stack>
                      )}
                      {canApproveWorkflow && (
                        <Stack spacing={1}>
                          <PropertyRow label={t('sidebar.workflow.fields.decisionNote')} valueSx={drawerFieldValueSx}>
                            <TextField
                              variant="standard"
                              multiline
                              minRows={2}
                              value={workflowComment}
                              onChange={(e) => setWorkflowComment(e.target.value)}
                              placeholder={t('sidebar.workflow.fields.decisionNotePlaceholder')}
                              fullWidth
                            />
                          </PropertyRow>
                          <Stack direction="row" spacing={1}>
                            <Button
                              size="small"
                              variant="action"
                              onClick={async () => {
                                try {
                                  await onApproveWorkflow(workflowComment);
                                  setWorkflowComment('');
                                } catch {
                                  // Parent mutation surfaces the error.
                                }
                              }}
                              disabled={approvingWorkflow || requestingWorkflowChanges}
                            >
                              {t('sidebar.workflow.actions.approve')}
                            </Button>
                            <Button
                              size="small"
                              color="warning"
                              variant="outlined"
                              onClick={async () => {
                                try {
                                  await onRequestWorkflowChanges(workflowComment);
                                  setWorkflowComment('');
                                } catch {
                                  // Parent mutation surfaces the error.
                                }
                              }}
                              disabled={approvingWorkflow || requestingWorkflowChanges || !workflowComment.trim()}
                            >
                              {t('sidebar.workflow.actions.requestChanges')}
                            </Button>
                          </Stack>
                        </Stack>
                      )}
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {isManagedIntegratedDocument
                        ? t('sidebar.workflow.messages.unavailableForManagedDocs')
                        : t('sidebar.workflow.messages.noActiveWorkflow')}
                    </Typography>
                  )}
                  <Divider />
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      {t('sidebar.workflow.lastApprovedVersion')}
                    </Typography>
                    <Typography variant="body2">
                      {lastApprovedRevision != null ? t('sidebar.workflow.values.revision', { count: lastApprovedRevision }) : t('sidebar.workflow.values.neverApproved')}
                    </Typography>
                    {lastApprovedRevision != null && latestApprovedWorkflow?.approved_at && (
                      <Typography variant="caption" color="text.secondary">
                        {t('sidebar.workflow.approvedOn', { value: new Date(latestApprovedWorkflow.approved_at).toLocaleString(locale) })}
                      </Typography>
                    )}
                  </Stack>
                  <Divider />
                  <Stack spacing={0.75}>
                    <Typography variant="caption" color="text.secondary">
                      {t('sidebar.workflow.recentActivity')}
                    </Typography>
                    {recentWorkflowActivity.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('sidebar.workflow.empty')}
                      </Typography>
                    ) : (
                      recentWorkflowActivity.map((entry) => (
                        <Box key={entry.id}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {entry.label}
                            {entry.actor ? ` • ${entry.actor}` : ''}
                          </Typography>
                          {entry.created_at && (
                            <Typography variant="caption" color="text.secondary">
                              {new Date(entry.created_at).toLocaleString(locale)}
                            </Typography>
                          )}
                          {!!entry.detail && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                              {entry.detail}
                            </Typography>
                          )}
                        </Box>
                      ))
                    )}
                  </Stack>
                </Stack>
              </Box>
            </Box>

            <Divider />

            {/* Classification */}
            <Box>
              <Box sx={sectionHeaderSx}>
                <Typography sx={sectionLabelSx}>{t('sidebar.sections.classification')}</Typography>
              </Box>
              <Box>
                {isCreate ? (
                  <Alert severity="info" sx={{ fontSize: '0.75rem' }}>{t('sidebar.classification.messages.saveFirst')}</Alert>
                ) : !canManage ? (
                  readOnlyClassifications.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">{t('sidebar.classification.empty')}</Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {readOnlyClassifications.map((row: { key: string; label: string }) => (
                        <Typography key={row.key} variant="body2" color="text.secondary">{row.label}</Typography>
                      ))}
                    </Stack>
                  )
                ) : (
                  <Stack spacing={1}>
                    {editableClassificationRows.map((row, index) => {
                      const streamOptions = classificationStreams.filter((s: any) => s.category_id === row.category_id);
                      return (
                        <Stack key={`${index}-${row.category_id}`} spacing={0.75}>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <PropertyRow label={t('sidebar.classification.fields.category')} sx={{ flex: 1 }}>
                              <TextField
                                select
                                variant="standard"
                                value={row.category_id}
                                onChange={(e) => {
                                  updateClassificationRow(index, { category_id: e.target.value, stream_id: null });
                                }}
                                fullWidth
                                disabled={!canManage}
                                sx={drawerSelectSx}
                              >
                                <MenuItem value="" sx={drawerMenuItemSx}>{t('sidebar.classification.values.select')}</MenuItem>
                                {classificationCategories.map((cat: any) => (
                                  <MenuItem key={cat.id} value={cat.id} sx={drawerMenuItemSx}>{cat.name}</MenuItem>
                                ))}
                              </TextField>
                            </PropertyRow>
                            {classificationRows.length > 0 && (
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => removeClassificationRow(index)}
                                disabled={!canManage}
                              >
                                <DeleteIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            )}
                          </Stack>
                          {row.category_id && streamOptions.length > 0 && (
                            <PropertyRow label={t('sidebar.classification.fields.stream')}>
                              <TextField
                                select
                                variant="standard"
                                value={row.stream_id || ''}
                                onChange={(e) => {
                                  updateClassificationRow(index, { ...row, stream_id: e.target.value || null });
                                }}
                                disabled={!canManage}
                                fullWidth
                                sx={drawerSelectSx}
                              >
                                <MenuItem value="" sx={drawerMenuItemSx}>{t('shared.none')}</MenuItem>
                                {streamOptions.map((s: any) => (
                                  <MenuItem key={s.id} value={s.id} sx={drawerMenuItemSx}>{s.name}</MenuItem>
                                ))}
                              </TextField>
                            </PropertyRow>
                          )}
                        </Stack>
                      );
                    })}
                    {classificationRows.length > 0 && (
                      <Button
                        size="small"
                        variant="action"
                        startIcon={<AddIcon />}
                        onClick={addClassificationRow}
                        disabled={!canManage || hasPendingClassificationRow}
                      >
                        {t('common:buttons.add')}
                      </Button>
                    )}
                    {classificationError && <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{classificationError}</Alert>}
                  </Stack>
                )}
              </Box>
            </Box>

            <Divider />

            {/* Relations */}
            <Box>
              <Box sx={sectionHeaderSx}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography sx={sectionLabelSx}>{t('sidebar.sections.relations')}</Typography>
                  {isManagedIntegratedDocument && (
                    <ManagedReadonlyBadge title={managedRelationsTooltip} />
                  )}
                </Stack>
              </Box>
              <Box>
                {isCreate ? (
                  <Alert severity="info" sx={{ fontSize: '0.75rem' }}>{t('sidebar.relations.messages.saveFirst')}</Alert>
                ) : isManagedIntegratedDocument ? (
                  <Stack spacing={1}>
                    {readOnlyRelations.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">{t('sidebar.relations.empty')}</Typography>
                    ) : (
                      readOnlyRelations.map((group) => (
                        <Stack key={group.key} spacing={0.5}>
                          <Typography variant="caption" color="text.secondary">
                            {group.label}
                          </Typography>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            {group.items.map((item) => (
                              <Typography key={`${group.key}:${item.id}`} variant="body2" color="text.secondary">{item.label}</Typography>
                            ))}
                          </Stack>
                        </Stack>
                      ))
                    )}
                  </Stack>
                ) : (
                  <Stack spacing={1.5}>
                    {(Object.keys(RELATION_LABELS) as RelationKey[]).map((key) => {
                      const mergedOptions = [
                        ...relationOptions[key],
                        ...relationSelections[key].filter((s) => !relationOptions[key].some((o) => o.id === s.id)),
                      ];
                      return (
                        <PropertyRow key={key} label={t(`sidebar.relations.labels.${key}`)}>
                          <Autocomplete
                            multiple
                            size="small"
                            options={mergedOptions}
                            value={relationSelections[key]}
                            onChange={(_, values) => onRelationSelectionsChange(key, values)}
                            onInputChange={(_, value) => onRelationSearchChange(key, value)}
                            isOptionEqualToValue={(option, value) => option.id === value.id}
                            getOptionLabel={(option) => option.label}
                            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                variant="standard"
                                placeholder={t('sidebar.relations.search', { value: key })}
                              />
                            )}
                            disabled={!canManage}
                          />
                        </PropertyRow>
                      );
                    })}
                    {relationsError && <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{relationsError}</Alert>}
                  </Stack>
                )}
              </Box>
            </Box>
            <Divider />

            {/* Versions */}
            <Box>
              <Box sx={sectionHeaderSx}>
                <Typography sx={sectionLabelSx}>{t('sidebar.sections.versions')}</Typography>
              </Box>
              <Box>
                <Stack spacing={0.75}>
                  {(versions || []).map((version: any) => (
                    <Box key={version.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          v{version.version_number}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {version.created_at ? formatShortDateTime(version.created_at, locale) : ''}
                          {version.change_note ? ` - ${version.change_note}` : ''}
                        </Typography>
                      </Box>
                      {editMode && !isCreate && (
                        <Button
                          size="small"
                          onClick={() => onRevertVersion(Number(version.version_number))}
                          disabled={revertingVersion || !lockToken}
                          sx={{ minWidth: 0, px: 1, fontSize: '0.7rem' }}
                        >
                          {t('sidebar.versions.actions.revert')}
                        </Button>
                      )}
                    </Box>
                  ))}
                  {(versions || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary">{t('sidebar.versions.empty')}</Typography>
                  )}
                </Stack>
              </Box>
            </Box>
              </>
            )}
          </Stack>
        )}

        {activeTab === 'comments' && (
          <Stack spacing={2}>
            {!isCreate && (
              <>
                <PropertyRow label={t('sidebar.comments.fields.addComment')}>
                  <TextField
                    multiline
                    minRows={2}
                    variant="standard"
                    value={commentText}
                    onChange={(e) => onCommentTextChange(e.target.value)}
                    disabled={!canComment}
                    fullWidth
                    placeholder={t('sidebar.comments.fields.addComment')}
                    sx={[longFormSurfaceFieldSx, sidebarLongFormSx]}
                  />
                </PropertyRow>
                <Box>
                  <Button
                    size="small"
                    variant="action"
                    onClick={onPostComment}
                    disabled={!canComment || !commentText.trim() || postingComment}
                  >
                    {t('sidebar.comments.actions.post')}
                  </Button>
                </Box>
                <Divider />
              </>
            )}

            {(activities || []).map((activity: any) => (
              <Box key={activity.id}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {activity.author_name || t('shared.unknown')} - {activity.type}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {activity.created_at ? new Date(activity.created_at).toLocaleString(locale) : ''}
                </Typography>
                {!!activity.content && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {activity.content}
                  </Typography>
                )}
              </Box>
            ))}
            {(activities || []).length === 0 && (
              <Typography variant="body2" color="text.secondary">{t('sidebar.comments.empty')}</Typography>
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
});

export default KnowledgeSidebar;
