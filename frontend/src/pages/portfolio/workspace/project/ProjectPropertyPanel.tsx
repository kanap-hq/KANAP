import React from 'react';
import {
  Alert,
  Box,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../../api';
import UserSelect from '../../../../components/fields/UserSelect';
import CompanySelect from '../../../../components/fields/CompanySelect';
import DepartmentSelect from '../../../../components/fields/DepartmentSelect';
import DateEUField from '../../../../components/fields/DateEUField';
import TeamMemberMultiSelect from '../../../../components/fields/TeamMemberMultiSelect';
import { PropertyGroup, PropertyRow } from '../../../../components/design';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx, selectPlaceholderSx } from '../../../../theme/formSx';
import { getApiErrorMessage } from '../../../../utils/apiErrorMessage';
import { getRequestStatusLabel } from '../../../../utils/portfolioI18n';

type PanelSection = 'core' | 'team';

type ProjectPropertyPanelProps = {
  canManage: boolean;
  categories: Array<{ id: string; name: string }>;
  form: any;
  focusSection?: Exclude<PanelSection, 'core'> | null;
  isCreate: boolean;
  onCategoryChange: (value: string) => void;
  onCompanyChange: (value: string | null) => void;
  onLocalUpdate: (updater: (prev: any) => any) => void;
  onNameChange: (value: string) => void;
  onOriginChange: (value: string) => void;
  onPlannedEndChange: (value: string) => void;
  onPlannedStartChange: (value: string) => void;
  onRefetch: () => Promise<unknown>;
  onSourceChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onStreamChange: (value: string) => void;
  onUpdate: (patch: any) => void;
  originOptions: Array<{ value: string; label: string }>;
  originLabels: Record<string, string>;
  sources: Array<{ id: string; name: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  streams: Array<{ id: string; name: string; category_id: string }>;
};


export default function ProjectPropertyPanel({
  canManage,
  categories,
  form,
  isCreate,
  onCategoryChange,
  onCompanyChange,
  onLocalUpdate,
  onNameChange,
  onOriginChange,
  onPlannedEndChange,
  onPlannedStartChange,
  onRefetch,
  onSourceChange,
  onStatusChange,
  onStreamChange,
  onUpdate,
  originOptions,
  originLabels,
  sources,
  statusOptions,
  streams,
}: ProjectPropertyPanelProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [nameDraft, setNameDraft] = React.useState(form?.name || '');
  const coreFieldsDisabled = !isCreate && !canManage;
  const [panelError, setPanelError] = React.useState<string | null>(null);
  const noneLabel = t('common:labels.none');

  React.useEffect(() => {
    setNameDraft(form?.name || '');
  }, [form?.id, form?.name]);

  const handleImmediateSave = React.useCallback(async (
    action: () => Promise<void>,
    optimisticUpdate?: (prev: any) => any,
    refetchOnSuccess = false,
  ) => {
    setPanelError(null);
    if (optimisticUpdate) {
      onLocalUpdate(optimisticUpdate);
    }
    try {
      await action();
      if (refetchOnSuccess) {
        await onRefetch();
      }
    } catch (error: any) {
      setPanelError(
        getApiErrorMessage(error, t, t('workspace.project.messages.savePanelFailed')),
      );
      await onRefetch();
    }
  }, [onLocalUpdate, onRefetch, t]);

  const filteredStreams = React.useMemo(() => {
    if (!form?.category_id) return [];
    return streams.filter((stream) => stream.category_id === form.category_id);
  }, [form?.category_id, streams]);

  return (
    <Stack spacing={0}>
      {!!panelError && (
        <Box sx={{ px: '18px', pb: 1 }}>
          <Alert severity="error">{panelError}</Alert>
        </Box>
      )}

      <PropertyGroup>
        <PropertyRow label={t('workspace.project.fields.projectName')} required>
          <TextField
            value={nameDraft}
            disabled={coreFieldsDisabled}
            onChange={(event) => {
              const nextValue = event.target.value;
              setNameDraft(nextValue);
              if (isCreate) {
                onNameChange(nextValue);
              }
            }}
            onBlur={() => {
              if (!coreFieldsDisabled && !isCreate && nameDraft !== (form?.name || '')) {
                onNameChange(nameDraft);
              }
            }}
            variant="standard"
            required
            fullWidth
          />
        </PropertyRow>

        {!isCreate && (
          <PropertyRow label={t('workspace.project.fields.status')}>
            <Select
              value={form?.status || 'waiting_list'}
              onChange={(event) => onStatusChange(String(event.target.value))}
              disabled={coreFieldsDisabled}
              variant="standard"
              sx={drawerSelectSx}
            >
              {statusOptions.map((option) => (
                <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
        )}

        <PropertyRow label={t('workspace.project.fields.origin')}>
          {isCreate ? (
            <Select
              value={form?.origin || 'fast_track'}
              onChange={(event) => onOriginChange(String(event.target.value))}
              disabled={coreFieldsDisabled}
              variant="standard"
              sx={drawerSelectSx}
            >
              {originOptions.map((option) => (
                <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          ) : (
            <Typography variant="body2" sx={{ fontSize: 13 }}>
              {originLabels[form?.origin] || form?.origin || noneLabel}
            </Typography>
          )}
        </PropertyRow>

        <PropertyRow label={t('workspace.project.fields.source')}>
          <Select
            value={form?.source_id || ''}
            onChange={(event) => onSourceChange(String(event.target.value))}
            disabled={coreFieldsDisabled}
            variant="standard"
            displayEmpty
            renderValue={(v) => (v ? (sources.find((o) => o.id === v)?.name ?? '') : <Box component="span" sx={selectPlaceholderSx}>{noneLabel}</Box>)}
            sx={drawerSelectSx}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{noneLabel}</MenuItem>
            {sources.map((source) => (
              <MenuItem key={source.id} value={source.id} sx={drawerMenuItemSx}>
                {source.name}
              </MenuItem>
            ))}
          </Select>
        </PropertyRow>

        <PropertyRow label={t('workspace.project.fields.category')}>
          <Select
            value={form?.category_id || ''}
            onChange={(event) => onCategoryChange(String(event.target.value))}
            disabled={coreFieldsDisabled}
            variant="standard"
            displayEmpty
            renderValue={(v) => (v ? (categories.find((o) => o.id === v)?.name ?? '') : <Box component="span" sx={selectPlaceholderSx}>{noneLabel}</Box>)}
            sx={drawerSelectSx}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{noneLabel}</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category.id} value={category.id} sx={drawerMenuItemSx}>
                {category.name}
              </MenuItem>
            ))}
          </Select>
        </PropertyRow>

        <PropertyRow label={t('workspace.project.fields.stream')}>
          <Select
            value={form?.stream_id || ''}
            onChange={(event) => onStreamChange(String(event.target.value))}
            disabled={coreFieldsDisabled || !form?.category_id}
            variant="standard"
            displayEmpty
            renderValue={(v) => (v ? (filteredStreams.find((o) => o.id === v)?.name ?? '') : <Box component="span" sx={selectPlaceholderSx}>{noneLabel}</Box>)}
            sx={drawerSelectSx}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{noneLabel}</MenuItem>
            {filteredStreams.map((stream) => (
              <MenuItem key={stream.id} value={stream.id} sx={drawerMenuItemSx}>
                {stream.name}
              </MenuItem>
            ))}
          </Select>
        </PropertyRow>

        <PropertyRow label={t('workspace.project.fields.company')}>
          <CompanySelect
            hideLabel
            label={t('workspace.project.fields.company')}
            value={form?.company_id || null}
            onChange={onCompanyChange}
            disabled={coreFieldsDisabled}
            size="small"
          />
        </PropertyRow>

        <PropertyRow label={t('workspace.project.fields.department')}>
          <DepartmentSelect
            hideLabel
            label={t('workspace.project.fields.department')}
            companyId={form?.company_id || undefined}
            value={form?.department_id || null}
            onChange={(value) => onUpdate({ department_id: value })}
            disabled={coreFieldsDisabled}
            size="small"
          />
        </PropertyRow>

        <PropertyRow label={t('workspace.project.fields.plannedStart')}>
          <DateEUField
            label=""
            valueYmd={form?.planned_start || ''}
            onChangeYmd={onPlannedStartChange}
            disabled={coreFieldsDisabled}
            size="small"
          />
        </PropertyRow>

        <PropertyRow label={t('workspace.project.fields.plannedEnd')}>
          <DateEUField
            label=""
            valueYmd={form?.planned_end || ''}
            onChangeYmd={onPlannedEndChange}
            disabled={coreFieldsDisabled}
            size="small"
          />
        </PropertyRow>
      </PropertyGroup>

      {!isCreate && (
        <PropertyGroup>
          <PropertyRow label={t('workspace.project.fields.businessSponsor')}>
            <UserSelect
              hideLabel
              label={t('workspace.project.fields.businessSponsor')}
              value={form?.business_sponsor_id || null}
              onChange={(value) => handleImmediateSave(
                () => api.patch(`/portfolio/projects/${form.id}`, { business_sponsor_id: value }),
                (prev) => ({ ...prev, business_sponsor_id: value }),
              )}
              disabled={!canManage}
              size="small"
            />
          </PropertyRow>

          <PropertyRow label={t('workspace.project.fields.businessLead')}>
            <UserSelect
              hideLabel
              label={t('workspace.project.fields.businessLead')}
              value={form?.business_lead_id || null}
              onChange={(value) => handleImmediateSave(
                async () => {
                  await api.patch(`/portfolio/projects/${form.id}`, { business_lead_id: value });
                  await queryClient.invalidateQueries({ queryKey: ['project-effort-allocations', form.id, 'business'] });
                },
                (prev) => ({ ...prev, business_lead_id: value }),
              )}
              disabled={!canManage}
              size="small"
            />
          </PropertyRow>

          <PropertyRow label={t('workspace.project.fields.itSponsor')}>
            <UserSelect
              hideLabel
              label={t('workspace.project.fields.itSponsor')}
              value={form?.it_sponsor_id || null}
              onChange={(value) => handleImmediateSave(
                () => api.patch(`/portfolio/projects/${form.id}`, { it_sponsor_id: value }),
                (prev) => ({ ...prev, it_sponsor_id: value }),
              )}
              disabled={!canManage}
              size="small"
            />
          </PropertyRow>

          <PropertyRow label={t('workspace.project.fields.itLead')}>
            <UserSelect
              hideLabel
              label={t('workspace.project.fields.itLead')}
              value={form?.it_lead_id || null}
              onChange={(value) => handleImmediateSave(
                async () => {
                  await api.patch(`/portfolio/projects/${form.id}`, { it_lead_id: value });
                  await queryClient.invalidateQueries({ queryKey: ['project-effort-allocations', form.id, 'it'] });
                },
                (prev) => ({ ...prev, it_lead_id: value }),
              )}
              disabled={!canManage}
              size="small"
            />
          </PropertyRow>

          <PropertyRow label={t('workspace.project.fields.businessContributors')}>
            <TeamMemberMultiSelect
              label={t('workspace.project.fields.businessContributors')}
              value={form?.business_team || []}
              onChange={(userIds) => handleImmediateSave(
                async () => {
                  await api.post(`/portfolio/projects/${form.id}/business-team/bulk-replace`, {
                    user_ids: userIds,
                  });
                  await queryClient.invalidateQueries({ queryKey: ['project-effort-allocations', form.id, 'business'] });
                },
                undefined,
                true,
              )}
              disabled={!canManage}
              hideLabel
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>

          <PropertyRow label={t('workspace.project.fields.itContributors')}>
            <TeamMemberMultiSelect
              label={t('workspace.project.fields.itContributors')}
              value={form?.it_team || []}
              onChange={(userIds) => handleImmediateSave(
                async () => {
                  await api.post(`/portfolio/projects/${form.id}/it-team/bulk-replace`, {
                    user_ids: userIds,
                  });
                  await queryClient.invalidateQueries({ queryKey: ['project-effort-allocations', form.id, 'it'] });
                },
                undefined,
                true,
              )}
              disabled={!canManage}
              hideLabel
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>
        </PropertyGroup>
      )}

      {/* Null for a person who does not read requests: the row is not shown. */}
      {!isCreate && form?.id && form?.source_requests !== null && (
        <PropertyGroup>
          <PropertyRow label={t('workspace.project.sections.sourceRequests')} valueSx={{ minHeight: 0 }}>
            {form?.source_requests?.length > 0 ? (
              <Stack spacing={1}>
                {form.source_requests.map((request: any) => (
                  <Box
                    key={request.id}
                    component="button"
                    type="button"
                    onClick={() => navigate(`/portfolio/requests/${request.id}/summary`)}
                    sx={(theme) => ({
                      border: 0,
                      background: 'transparent',
                      p: 0,
                      textAlign: 'left',
                      color: theme.palette.kanap.text.primary,
                      cursor: 'pointer',
                      font: 'inherit',
                    })}
                  >
                    <Typography variant="body2" sx={{ fontSize: 13 }}>
                      {request.name} ({getRequestStatusLabel(t, request.status)})
                    </Typography>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                {t('workspace.project.messages.noSourceRequests')}
              </Typography>
            )}
          </PropertyRow>
        </PropertyGroup>
      )}
    </Stack>
  );
}
