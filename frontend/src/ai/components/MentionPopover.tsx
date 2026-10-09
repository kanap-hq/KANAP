import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { aiSearchApi, EntitySearchResult } from '../aiApi';
import { isLinkableEntityType, parseAtMentionQuery } from '../utils/entityUrls';

export type MentionSelection = EntitySearchResult;

type MentionPopoverProps = {
  query: string;
  /**
   * Rendered as `position: absolute` inside the composer container; the parent positions
   * the wrapper. Just here we render the floating panel itself.
   */
  onSelect: (item: MentionSelection) => void;
  onCancel: () => void;
};

/**
 * imperative handle exposed to the parent: lets ChatInput translate keyboard events
 * (ArrowUp/Down/Enter) into popover navigation without forwarding the textarea focus.
 */
export type MentionPopoverHandle = {
  moveSelection: (delta: 1 | -1) => void;
  confirmSelection: () => void;
};

const SEARCH_DEBOUNCE_MS = 150;
const ENTITY_TYPE_LABELS: Record<string, string> = {
  documents: 'Knowledge',
  tasks: 'Tasks',
  projects: 'Projects',
  requests: 'Requests',
  applications: 'Applications',
  assets: 'Assets',
  connections: 'Connections',
  interfaces: 'Interfaces',
  locations: 'Locations',
  contracts: 'Contracts',
  spend_items: 'Opex',
  capex_items: 'Capex',
  incidents: 'Incidents',
  companies: 'Companies',
  contacts: 'Contacts',
  departments: 'Departments',
  suppliers: 'Suppliers',
  business_processes: 'Business processes',
  users: 'Users',
};

const MentionPopover = React.forwardRef<MentionPopoverHandle, MentionPopoverProps>(
  function MentionPopover({ query, onSelect, onCancel }, ref) {
    const { t } = useTranslation(['ai']);
    const [results, setResults] = useState<EntitySearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeIdx, setActiveIdx] = useState(0);
    const itemRefs = useRef<Array<HTMLElement | null>>([]);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const requestSeqRef = useRef(0);
    const keyboardScrollRef = useRef(false);

    // Debounced search.
    useEffect(() => {
      const { entityType, entityTypes, searchTerm } = parseAtMentionQuery(query);
      const narrowedEntityTypes = entityTypes ?? (entityType ? [entityType] : undefined);
      const requestSeq = ++requestSeqRef.current;
      itemRefs.current = [];
      keyboardScrollRef.current = false;
      setActiveIdx(0);
      panelRef.current?.scrollTo({ top: 0 });

      // Skip if the user hasn't typed anything AND no prefix was recognised.
      // (A recognised prefix is enough on its own: `@APP` → recent applications.)
      if (!narrowedEntityTypes?.length && searchTerm.length < 1) {
        setResults([]);
        setLoading(false);
        return;
      }
      const controller = new AbortController();
      setResults([]);
      setLoading(true);
      const handle = window.setTimeout(async () => {
        try {
          // Two distinct search modes:
          //  - Type-token prefix recognised or partially typed (`@APP`, `@DO`,
          //    `@T-5`): narrow to the matching entity_type(s). Strip the prefix;
          //    the backend can apply the item_number boost on the bare number.
          //  - No prefix (`@backup`, `@server`): no narrow, cross-type text search
          //    with tier-based ranking.
          const items = await aiSearchApi.searchEntities(searchTerm, {
            signal: controller.signal,
            entityTypes: narrowedEntityTypes,
          });
          if (requestSeq !== requestSeqRef.current) return;
          // Drop entity types that don't have a frontend workspace route — no point
          // mentioning something the user can't navigate to from the chip.
          const linkable = items.filter((item) => isLinkableEntityType(item.entity_type));
          itemRefs.current = [];
          setResults(linkable);
          setActiveIdx(0);
          window.requestAnimationFrame(() => {
            if (requestSeq === requestSeqRef.current) {
              panelRef.current?.scrollTo({ top: 0 });
            }
          });
        } catch (err: any) {
          if (requestSeq !== requestSeqRef.current) return;
          if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
            // Soft-fail: empty list, no toast — typeahead errors shouldn't disrupt typing.
            setResults([]);
          }
        } finally {
          if (requestSeq === requestSeqRef.current) setLoading(false);
        }
      }, SEARCH_DEBOUNCE_MS);
      return () => {
        window.clearTimeout(handle);
        controller.abort();
      };
    }, [query]);

    // Keep activeIdx within bounds when results shrink.
    useEffect(() => {
      if (activeIdx >= results.length) setActiveIdx(Math.max(0, results.length - 1));
    }, [results.length, activeIdx]);

    // Scroll the active row into view on keyboard navigation.
    useEffect(() => {
      if (!keyboardScrollRef.current) return;
      keyboardScrollRef.current = false;
      const node = itemRefs.current[activeIdx];
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest' });
      }
    }, [activeIdx]);

    const moveSelection = useCallback((delta: 1 | -1) => {
      keyboardScrollRef.current = true;
      setActiveIdx((prev) => {
        if (results.length === 0) return 0;
        const next = (prev + delta + results.length) % results.length;
        return next;
      });
    }, [results.length]);

    const confirmSelection = useCallback(() => {
      const item = results[activeIdx];
      if (item) onSelect(item);
    }, [activeIdx, results, onSelect]);

    React.useImperativeHandle(ref, () => ({ moveSelection, confirmSelection }), [moveSelection, confirmSelection]);

    // Group consecutive results by entity_type for a clean section divider.
    const grouped = useMemo(() => {
      const groups: Array<{ entity_type: string; items: EntitySearchResult[] }> = [];
      for (const item of results) {
        const last = groups[groups.length - 1];
        if (last && last.entity_type === item.entity_type) {
          last.items.push(item);
        } else {
          groups.push({ entity_type: item.entity_type, items: [item] });
        }
      }
      return groups;
    }, [results]);

    const showEmpty = !loading && results.length === 0 && query.length > 0;
    let runningIdx = -1;

    return (
      <Box
        ref={panelRef}
        // Stop pointer events from bubbling to the textarea (don't lose focus on click).
        onMouseDown={(e) => e.preventDefault()}
        sx={(theme) => ({
          width: 380,
          maxHeight: 320,
          overflowY: 'auto',
          bgcolor: theme.palette.kanap.bg.composer,
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: '10px',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 24px rgba(0,0,0,0.45)'
            : '0 8px 24px rgba(0,0,0,0.10)',
        })}
      >
        {loading && results.length === 0 && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 1.25 }}>
            <CircularProgress size={12} thickness={5} sx={{ color: 'kanap.text.tertiary' }} />
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('mention.searching')}
            </Typography>
          </Stack>
        )}
        {showEmpty && (
          <Box sx={{ px: 1.5, py: 1.25 }}>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('mention.noResults')}
            </Typography>
          </Box>
        )}
        {grouped.map((group) => (
          <Box key={group.entity_type}>
            <Typography
              component="div"
              sx={(theme) => ({
                px: 1.5,
                pt: 1,
                pb: 0.25,
                fontSize: 10,
                fontWeight: 500,
                color: theme.palette.kanap.text.tertiary,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                bgcolor: theme.palette.kanap.bg.drawer,
              })}
            >
              {ENTITY_TYPE_LABELS[group.entity_type] || group.entity_type}
            </Typography>
            {group.items.map((item) => {
              runningIdx += 1;
              const idx = runningIdx;
              const active = idx === activeIdx;
              return (
                <Box
                  key={`${item.entity_type}-${item.id}`}
                  ref={(node: HTMLDivElement | null) => { itemRefs.current[idx] = node; }}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => onSelect(item)}
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1,
                    px: 1.5,
                    py: 0.875,
                    cursor: 'pointer',
                    bgcolor: active ? theme.palette.primary.light : 'transparent',
                    transition: 'background-color 80ms ease',
                  })}
                >
                  {item.ref && (
                    <Typography
                      component="span"
                      sx={(theme) => ({
                        fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
                        fontSize: 11,
                        fontWeight: 500,
                        color: theme.palette.kanap.text.secondary,
                        flexShrink: 0,
                      })}
                    >
                      {item.ref}
                    </Typography>
                  )}
                  <Typography
                    component="span"
                    sx={(theme) => ({
                      fontSize: 13,
                      color: theme.palette.kanap.text.primary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    })}
                  >
                    {item.label || item.ref || item.id}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    );
  },
);

export default MentionPopover;
