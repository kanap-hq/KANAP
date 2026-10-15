import React from 'react';
import {
  Box,
  Checkbox,
  FormControlLabel,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from 'react-i18next';
import { CsvFieldInfo } from './csv.types';

interface CsvFieldSelectorProps {
  fields: CsvFieldInfo[];
  selectedFields: Set<string>;
  onToggle: (fieldName: string) => void;
  groupBy?: 'group' | 'none';
}

export function CsvFieldSelector({
  fields,
  selectedFields,
  onToggle,
  groupBy = 'group',
}: CsvFieldSelectorProps) {
  const { t } = useTranslation('common');
  // Group fields: '' holds the fields without a group (or every field when not grouped)
  const groupedFields = React.useMemo(() => {
    if (groupBy === 'none') {
      return { '': fields };
    }

    const groups: Record<string, CsvFieldInfo[]> = {};
    for (const field of fields) {
      const group = field.group || '';
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(field);
    }
    return groups;
  }, [fields, groupBy]);

  // Count selected in each group
  const getGroupSelectedCount = (groupFields: CsvFieldInfo[]) => {
    return groupFields.filter((f) => selectedFields.has(f.csvColumn)).length;
  };

  return (
    <Box>
      {Object.entries(groupedFields).map(([groupName, groupFields]) => {
        const selectedCount = getGroupSelectedCount(groupFields);
        const allSelected = selectedCount === groupFields.length;
        const noneSelected = selectedCount === 0;

        return (
          <Accordion key={groupName} defaultExpanded={groupBy === 'none'} disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                <Typography variant="subtitle2">
                  {groupName || (groupBy === 'none' ? t('labels.all') : t('csv.otherGroup'))}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  {`${selectedCount}/${groupFields.length}`}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {groupFields.map((field) => (
                  <FormControlLabel
                    key={field.csvColumn}
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedFields.has(field.csvColumn)}
                        onChange={() => onToggle(field.csvColumn)}
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {field.label}
                        {field.required && (
                          <Typography component="span" color="error" sx={{ ml: 0.5 }}>
                            *
                          </Typography>
                        )}
                      </Typography>
                    }
                    sx={{ width: '45%', mr: 0 }}
                  />
                ))}
              </Box>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}
