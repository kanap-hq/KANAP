import { Box, Tab, Tabs } from '@mui/material';

export type WorkspaceTab = {
  key: string;
  label: string;
  /** A count shown at the top right of the label. */
  badge?: number;
  disabled?: boolean;
};

/**
 * The tab row of a record page: sentence-case labels, the active one in teal, an optional count
 * badge on each. The workspace shell draws it under the title; a page without the shell uses it as is.
 */
export default function WorkspaceTabs({ tabs, activeTab, onTabChange, ariaLabel }: {
  tabs: WorkspaceTab[];
  activeTab: string;
  onTabChange: (nextTab: string) => void;
  ariaLabel?: string;
}) {
  return (
    <Tabs
      value={activeTab}
      onChange={(_, nextValue) => onTabChange(String(nextValue))}
      variant="scrollable"
      allowScrollButtonsMobile
      aria-label={ariaLabel}
      sx={{
        minHeight: 'auto',
        overflow: 'visible',
        '& .MuiTabs-indicator': { display: 'none' },
        // A row too wide for its room scrolls; the arrow toward its start stays out until there
        // is something to scroll back to, so the first tab keeps its place under the title.
        '& .MuiTabs-scrollButtons': { width: 24, flexShrink: 0, pt: '10px', pb: '9px' },
        '& .MuiTabs-scrollButtons.Mui-disabled': { display: 'none' },
        '& .MuiTabs-flexContainer': { overflow: 'visible', pt: '10px' },
      }}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.key}
          label={(
            <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              {tab.label}
              {typeof tab.badge === 'number' && (
                <Box
                  component="span"
                  sx={(theme) => ({
                    position: 'absolute',
                    top: '-9px',
                    right: '-16px',
                    minWidth: 15,
                    height: 15,
                    px: '4px',
                    borderRadius: '999px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.pill.bg,
                    border: `1px solid ${activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.pill.border}`,
                    color: activeTab === tab.key ? theme.palette.kanap.tealForeground : theme.palette.kanap.text.tertiary,
                    fontSize: 10,
                    fontWeight: 500,
                    lineHeight: 1,
                    pointerEvents: 'none',
                  })}
                >
                  {tab.badge}
                </Box>
              )}
            </Box>
          )}
          value={tab.key}
          disabled={tab.disabled}
          sx={(theme) => ({
            position: 'relative',
            overflow: 'visible',
            minHeight: 'auto',
            pt: 0,
            px: 0,
            pb: '9px',
            mr: tab.badge != null ? '30px' : '24px',
            textTransform: 'none',
            minWidth: 'auto',
            fontSize: '14px',
            lineHeight: 1.35,
            fontWeight: activeTab === tab.key ? 500 : 400,
            color: activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.text.secondary,
            '&:hover': {
              color: activeTab === tab.key ? theme.palette.kanap.teal : theme.palette.kanap.text.primary,
            },
            '&.Mui-disabled': {
              color: theme.palette.kanap.text.tertiary,
              opacity: 0.65,
            },
          })}
        />
      ))}
    </Tabs>
  );
}
