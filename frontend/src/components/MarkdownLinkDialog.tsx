import React from 'react';
import {
  Box,
  Button,
  Dialog,
  IconButton,
  Paper,
  Popper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTheme } from '@mui/material/styles';
import {
  useCellValue,
  usePublisher,
  linkDialogState$,
  updateLink$,
  cancelLinkEdit$,
  switchFromPreviewToLinkEdit$,
  removeLink$,
  onWindowChange$,
  activeEditor$,
} from '@mdxeditor/editor';

/**
 * Custom replacement for MDXEditor's built-in link dialog.
 *
 * The default dialog renders its Radix popover with `align="center"` on a
 * zero-width anchor at the caret. When the caret sits near the left edge of the
 * editor (e.g. an empty Description field), half of the dialog spills left over
 * the navigation sidebar. This version anchors the dialog to the caret with
 * `placement="bottom-start"` and viewport collision handling, so it opens at the
 * caret and extends rightward, staying on screen at either edge.
 *
 * Wired via `linkDialogPlugin({ LinkDialog: MarkdownLinkDialog })`.
 */

interface LinkEditFormProps {
  initialUrl: string;
  initialText: string;
  withAnchorText: boolean;
  title: string;
  onSubmit: (payload: { url: string; text: string; title: string }) => void;
  onCancel: () => void;
}

function LinkEditForm({
  initialUrl,
  initialText,
  withAnchorText,
  title,
  onSubmit,
  onCancel,
}: LinkEditFormProps) {
  const [url, setUrl] = React.useState(initialUrl);
  const [text, setText] = React.useState(initialText);

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSubmit({ url: url.trim(), text, title });
      }}
      sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}
    >
      <TextField
        label="URL"
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        size="small"
        autoFocus
        fullWidth
        InputLabelProps={{ shrink: true }}
      />
      {withAnchorText && (
        <TextField
          label="Anchor text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          size="small"
          fullWidth
          InputLabelProps={{ shrink: true }}
        />
      )}
      <Stack direction="row" justifyContent="flex-end" spacing={1}>
        <Button variant="action" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="action-primary">
          Save
        </Button>
      </Stack>
    </Box>
  );
}

export default function MarkdownLinkDialog() {
  const theme = useTheme();
  const state = useCellValue(linkDialogState$);
  const activeEditor = useCellValue(activeEditor$);
  const updateLink = usePublisher(updateLink$);
  const cancelLinkEdit = usePublisher(cancelLinkEdit$);
  const switchToEdit = usePublisher(switchFromPreviewToLinkEdit$);
  const removeLink = usePublisher(removeLink$);
  const publishWindowChange = usePublisher(onWindowChange$);

  // Keep the anchor rectangle in sync while scrolling/resizing (mirrors the
  // default dialog), so the popover follows the caret.
  React.useEffect(() => {
    const update = () => {
      activeEditor?.getEditorState().read(() => {
        publishWindowChange(true);
      });
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [activeEditor, publishWindowChange]);

  const rect = state.type !== 'inactive' ? state.rectangle : null;
  const virtualAnchor = React.useMemo(() => {
    if (!rect) return null;
    const r = {
      x: rect.left,
      y: rect.top,
      top: rect.top,
      left: rect.left,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
    };
    return { getBoundingClientRect: () => ({ ...r, toJSON: () => r }) as DOMRect };
  }, [rect?.top, rect?.left, rect?.width, rect?.height]);

  if (state.type === 'inactive') return <></>;

  // Edit form: a centered modal. Anchoring it to the caret read as "oddly placed"
  // when the caret sat at the editor's top-left (e.g. an empty Description).
  if (state.type === 'edit') {
    return (
      <Dialog
        open
        onClose={() => cancelLinkEdit()}
        fullWidth
        maxWidth="xs"
        disableEnforceFocus
        disableAutoFocus
        disableRestoreFocus
      >
        <LinkEditForm
          key={state.linkNodeKey}
          initialUrl={state.url}
          initialText={state.text}
          withAnchorText={state.withAnchorText}
          title={state.title}
          onSubmit={(payload) => updateLink(payload)}
          onCancel={() => cancelLinkEdit()}
        />
      </Dialog>
    );
  }

  // Preview popover for an existing link: stays anchored to the link, and closes
  // when the selection moves off it (matching MDXEditor's default behaviour).
  if (!virtualAnchor) return <></>;
  const urlIsExternal = state.url.startsWith('http');

  return (
    <Popper
      open
      anchorEl={virtualAnchor}
      placement="bottom-start"
      style={{ zIndex: theme.zIndex.modal + 3 }}
      modifiers={[
        { name: 'offset', options: { offset: [0, 5] } },
        { name: 'preventOverflow', options: { padding: 8 } },
        { name: 'flip', options: { padding: 8 } },
      ]}
    >
      <Paper
        elevation={2}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.5}
          sx={{ pl: 1.5, pr: 0.5, py: 0.5, maxWidth: 440 }}
        >
          <Typography
            component="a"
            href={state.url}
            target={urlIsExternal ? '_blank' : undefined}
            rel="noreferrer"
            sx={{
              color: 'primary.main',
              textDecoration: 'none',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {state.url}
          </Typography>
          {urlIsExternal && (
            <OpenInNewIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
          )}
          <Tooltip title="Edit link">
            <IconButton size="small" onClick={() => switchToEdit()}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Copy URL">
            <IconButton size="small" onClick={() => void navigator.clipboard?.writeText(state.url)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove link">
            <IconButton size="small" onClick={() => removeLink()}>
              <LinkOffIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>
    </Popper>
  );
}
