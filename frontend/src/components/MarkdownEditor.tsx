import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ClickAwayListener, GlobalStyles, MenuItem, MenuList, Paper, Popper } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { alpha, useTheme } from '@mui/material/styles';
import {
  AdmonitionDirectiveDescriptor,
  BoldItalicUnderlineToggles,
  ButtonOrDropdownButton,
  ChangeCodeMirrorLanguage,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  activePlugins$,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  directivesPlugin,
  frontmatterPlugin,
  headingsPlugin,
  HighlightToggle,
  imagePlugin,
  InsertAdmonition,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  createRootEditorSubscription$,
  MDXEditor,
  MDXEditorMethods,
  quotePlugin,
  realmPlugin,
  Separator,
  StrikeThroughSupSubToggles,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  insertMarkdown$,
  convertSelectionToNode$,
  currentBlockType$,
  useCellValue,
  usePublisher,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createParagraphNode, $getSelection, type LexicalEditor } from 'lexical';
import { hasPotentiallyUnsafeMdxPaste, sanitizeMarkdownForMdxPaste } from '../lib/mdxPaste';
import { normalizeMarkdownForRichTextEditor } from '../lib/markdownEditorNormalization';
import { getMarkdownEditorToolbarConfig, type MarkdownEditorHeadingLevel } from './markdownEditorToolbarConfig';
import {
  convertRichClipboardToMarkdown,
  extractClipboardImageFiles,
  looksLikeMarkdown,
  shouldHandleRichClipboardImport,
} from '../lib/richClipboardMarkdown';
import MarkdownLinkDialog from './MarkdownLinkDialog';

interface MarkdownEditorProps {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  /** When set, the content area is capped to this many rows until the editor receives
   *  focus (via :focus-within), then expands to minRows/maxRows. Lets a read-mode
   *  description stay compact and reveal more of the page below it. */
  collapsedRows?: number;
  fillHeight?: boolean;
  disabled?: boolean;
  focusNonce?: number;
  refreshNonce?: number;
  onImageUpload?: (file: File) => Promise<string>;
  onImageUrlImport?: (sourceUrl: string) => Promise<string>;
  /** Enable the full Knowledge toolbar. Default is the simplified toolbar used elsewhere. */
  fullToolbar?: boolean;
  /** Hide the toolbar until the editor receives focus (via :focus-within). */
  hideToolbarUntilFocus?: boolean;
  /** Render on the KANAP long-form composer surface. */
  surface?: boolean;
  /** Delegate wheel scrolling to the parent scroll container until the editor is focused. */
  delegateWheelUntilFocus?: boolean;
  /** Called when Ctrl+Enter or Cmd+Enter is pressed inside the editor. */
  onModEnter?: () => void;
  /** Called when Ctrl+S or Cmd+S is pressed inside the editor. */
  onModSave?: () => void;
}

const EMOJI_OPTIONS = [
  { value: '🙂', label: 'Smile' },
  { value: '😀', label: 'Grin' },
  { value: '😂', label: 'Laugh' },
  { value: '😍', label: 'Love' },
  { value: '🤔', label: 'Think' },
  { value: '👍', label: 'Thumbs up' },
  { value: '🎉', label: 'Celebrate' },
  { value: '🔥', label: 'Fire' },
  { value: '✅', label: 'Done' },
  { value: '🚀', label: 'Launch' },
] as const;

function EmojiPickerButton() {
  const { t } = useTranslation('common');
  const insertMarkdown = usePublisher(insertMarkdown$);
  const items = React.useMemo(
    () => EMOJI_OPTIONS.map(({ value, label }) => ({
      value,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <span aria-hidden="true">{value}</span>
          <span>{label}</span>
        </span>
      ),
    })),
    [],
  );

  return (
    <ButtonOrDropdownButton
      title={t('markdownEditor.insertEmoji')}
      items={items}
      onChoose={(value) => {
        insertMarkdown(value);
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '1rem', lineHeight: 1 }}>
        🙂
      </span>
    </ButtonOrDropdownButton>
  );
}

function KanapBlockStyleSelect({
  allowedHeadingLevels,
}: {
  allowedHeadingLevels: MarkdownEditorHeadingLevel[];
}) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const convertSelectionToNode = usePublisher(convertSelectionToNode$);
  const currentBlockType = useCellValue(currentBlockType$);
  const activePlugins = useCellValue(activePlugins$);
  const hasQuote = activePlugins.includes('quote');
  const hasHeadings = activePlugins.includes('headings');
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const items = React.useMemo(() => {
    const next = [{ label: 'Paragraph', value: 'paragraph' }];
    if (hasQuote) {
      next.push({ label: 'Quote', value: 'quote' });
    }
    if (hasHeadings) {
      next.push(...allowedHeadingLevels.map((level) => ({
        label: `Heading ${level}`,
        value: `h${level}`,
      })));
    }
    return next;
  }, [allowedHeadingLevels, hasHeadings, hasQuote]);

  if (!hasQuote && !hasHeadings) return null;

  const value = items.some((item) => item.value === currentBlockType)
    ? currentBlockType
    : 'paragraph';
  const selectedLabel = items.find((item) => item.value === value)?.label || 'Paragraph';
  const open = Boolean(anchorEl);

  const applyBlockType = React.useCallback((blockType: string) => {
    switch (blockType) {
      case 'quote':
        convertSelectionToNode(() => $createQuoteNode());
        break;
      case 'paragraph':
        convertSelectionToNode(() => $createParagraphNode());
        break;
      default:
        if (blockType.startsWith('h')) {
          convertSelectionToNode(() => $createHeadingNode(blockType as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'));
        }
    }
  }, [convertSelectionToNode]);

  return (
    <>
      <Box
        component="button"
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : undefined}
        onClick={(event) => {
          setAnchorEl((current) => current ? null : event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setAnchorEl(null);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setAnchorEl(event.currentTarget);
          }
        }}
        sx={{
          minWidth: 116,
          height: 26,
          px: 0.75,
          py: 0,
          border: 0,
          borderRadius: 0.75,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 0.5,
          font: 'inherit',
          fontSize: '0.8125rem',
          lineHeight: 1.5,
          color: 'text.primary',
          bgcolor: 'transparent',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 1,
          },
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel}
        </Box>
        <KeyboardArrowDownIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
      </Box>
      <Popper
        open={open}
        anchorEl={anchorEl}
        placement="bottom-start"
        sx={{ zIndex: theme.zIndex.modal + 2 }}
        modifiers={[
          { name: 'offset', options: { offset: [0, 4] } },
          { name: 'preventOverflow', options: { padding: 8 } },
        ]}
      >
        <ClickAwayListener
          onClickAway={(event) => {
            if (anchorEl?.contains(event.target as Node)) return;
            setAnchorEl(null);
          }}
        >
          <Paper
            elevation={2}
            sx={{
              minWidth: anchorEl?.clientWidth || 116,
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
              overflow: 'hidden',
            }}
          >
            <MenuList
              dense
              disablePadding
              aria-label={t('markdownEditor.blockStyle')}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'Tab') {
                  setAnchorEl(null);
                  buttonRef.current?.focus();
                }
              }}
            >
              {items.map((item) => (
                <MenuItem
                  key={item.value}
                  selected={item.value === value}
                  onClick={() => {
                    applyBlockType(item.value);
                    setAnchorEl(null);
                    buttonRef.current?.focus();
                  }}
                  sx={{ fontSize: '0.8125rem', minHeight: 28 }}
                >
                  {item.label}
                </MenuItem>
              ))}
            </MenuList>
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  );
}

function getPasteTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

const captureRootEditorPlugin = realmPlugin<{ editorRef: React.MutableRefObject<LexicalEditor | null> }>({
  init(realm, params) {
    if (!params?.editorRef) return;

    realm.pub(createRootEditorSubscription$, (rootEditor) => {
      params.editorRef.current = rootEditor;
      return () => {
        if (params.editorRef.current === rootEditor) {
          params.editorRef.current = null;
        }
      };
    });
  },
});

const MarkdownEditor = React.memo(function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Start typing...',
  minRows = 10,
  maxRows = 18,
  collapsedRows,
  fillHeight = false,
  disabled = false,
  focusNonce,
  refreshNonce,
  onImageUpload,
  onImageUrlImport,
  fullToolbar = false,
  hideToolbarUntilFocus = false,
  surface = false,
  delegateWheelUntilFocus = false,
  onModEnter,
  onModSave,
}: MarkdownEditorProps) {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const minHeight = minRows * 24;
  const maxHeight = maxRows * 24;
  const contentHeightOffset = disabled ? 0 : 24;
  const editorContentMinHeight = fillHeight ? 0 : (minHeight - contentHeightOffset);
  const editorContentMaxHeight = fillHeight ? '100%' : (maxHeight - contentHeightOffset);
  const collapsedContentMaxHeight =
    collapsedRows && !fillHeight ? Math.max(0, collapsedRows * 24 - contentHeightOffset) : undefined;
  // Overrides applied to the content area while the editor is NOT focused:
  //  - cap the height (read-mode collapse via collapsedRows), and
  //  - for editable wheel-delegating editors, disable internal scrolling so a
  //    scroll above an unfocused field moves the page, not the field. The content
  //    only scrolls internally once the editor is focused (clicked) for editing.
  const unfocusedContentSx: Record<string, number | string> = {};
  if (collapsedContentMaxHeight !== undefined) {
    unfocusedContentSx.minHeight = 0;
    unfocusedContentSx.maxHeight = collapsedContentMaxHeight;
  }
  if (delegateWheelUntilFocus && !disabled) {
    // Clip (don't scroll) the content, and allow the wheel to chain to the page
    // (the base `overscroll-behavior: contain` would otherwise trap it).
    unfocusedContentSx.overflowY = 'hidden';
    unfocusedContentSx.overscrollBehavior = 'auto';
  }
  const fixedSourceEditorHeight = fillHeight
    ? '100%'
    : (minRows === maxRows ? (maxHeight - contentHeightOffset) : undefined);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mdxRef = React.useRef<MDXEditorMethods>(null);
  const lexicalEditorRef = React.useRef<LexicalEditor | null>(null);
  const internalChangeRef = React.useRef(false);
  const currentMarkdownRef = React.useRef(normalizeMarkdownForRichTextEditor(value || ''));
  const onChangeRef = React.useRef<MarkdownEditorProps['onChange']>(onChange);
  const onModEnterRef = React.useRef<MarkdownEditorProps['onModEnter']>(onModEnter);
  const onModSaveRef = React.useRef<MarkdownEditorProps['onModSave']>(onModSave);
  const imageUploadHandlerRef = React.useRef<MarkdownEditorProps['onImageUpload']>(onImageUpload);
  const imageUrlImportHandlerRef = React.useRef<MarkdownEditorProps['onImageUrlImport']>(onImageUrlImport);
  onChangeRef.current = onChange;
  onModEnterRef.current = onModEnter;
  onModSaveRef.current = onModSave;
  imageUploadHandlerRef.current = onImageUpload;
  imageUrlImportHandlerRef.current = onImageUrlImport;
  const [editorInstanceKey, setEditorInstanceKey] = React.useState(0);
  const mdxRootClassName = React.useMemo(
    () => `kanap-mdx-root ${isDarkMode ? 'dark-theme' : 'light-theme'}${hideToolbarUntilFocus ? ' kanap-mdx-hide-toolbar' : ''}${surface ? ' kanap-mdx-surface' : ''}`,
    [isDarkMode, hideToolbarUntilFocus, surface],
  );
  const mdxEditorKey = React.useMemo(
    () => `${editorInstanceKey}:${disabled ? 'readonly' : 'editable'}:${onImageUpload ? 'image' : 'no-image'}`,
    [disabled, editorInstanceKey, onImageUpload],
  );
  const mdxThemeVariables = React.useMemo<Record<string, string>>(
    () => ({
      colorScheme: isDarkMode ? 'dark' : 'light',
      '--basePageBg': surface ? theme.palette.kanap.bg.composer : theme.palette.background.paper,
      '--baseBase': surface ? theme.palette.kanap.bg.composer : theme.palette.background.paper,
      '--baseBgSubtle': isDarkMode ? alpha(theme.palette.common.white, 0.04) : theme.palette.grey[50],
      '--baseBg': isDarkMode ? alpha(theme.palette.common.white, 0.06) : theme.palette.grey[100],
      '--baseBgHover': isDarkMode ? alpha(theme.palette.common.white, 0.1) : theme.palette.grey[200],
      '--baseBgActive': isDarkMode ? alpha(theme.palette.common.white, 0.14) : theme.palette.grey[300],
      '--baseLine': alpha(theme.palette.divider, isDarkMode ? 0.8 : 1),
      '--baseBorder': theme.palette.divider,
      '--baseBorderHover': theme.palette.text.secondary,
      '--baseSolid': isDarkMode ? theme.palette.grey[700] : theme.palette.grey[400],
      '--baseSolidHover': isDarkMode ? theme.palette.grey[600] : theme.palette.grey[500],
      '--baseText': theme.palette.text.secondary,
      '--baseTextContrast': theme.palette.text.primary,
      '--accentBorder': theme.palette.primary.main,
      '--accentSolid': theme.palette.primary.main,
      '--accentSolidHover': theme.palette.primary.dark,
      '--accentText': theme.palette.primary.main,
      '--accentTextContrast': theme.palette.primary.contrastText,
    }),
    [isDarkMode, surface, theme],
  );
  const mdxThemeVariablesImportant = React.useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        Object.entries(mdxThemeVariables).map(([key, value]) => [key, `${value} !important`]),
      ),
    [mdxThemeVariables],
  );

  const codeBlockLanguages = React.useMemo<Record<string, string>>(
    () =>
      // Proxy lets Object.hasOwn() return true for ANY language (so MDXEditor's
      // codeMirrorPlugin descriptor matches unknown languages like "ini" instead
      // of crashing), while Object.entries() still returns only the curated set
      // shown in the toolbar dropdown.
      new Proxy(
        {
          '': 'Plain text',
          txt: 'Plain text',
          md: 'Markdown',
          abap: 'ABAP (plain)',
          powershell: 'PowerShell',
          bash: 'Bash / Shell',
          yml: 'YAML',
          yaml: 'YAML',
          json: 'JSON',
          sql: 'SQL',
          html: 'HTML',
          css: 'CSS',
          js: 'JavaScript',
          jsx: 'JavaScript (React)',
          ts: 'TypeScript',
          tsx: 'TypeScript (React)',
          py: 'Python',
          java: 'Java',
          go: 'Go',
          rust: 'Rust',
          xml: 'XML',
          dockerfile: 'Dockerfile',
        } as Record<string, string>,
        {
          getOwnPropertyDescriptor(target, prop) {
            const real = Object.getOwnPropertyDescriptor(target, prop);
            if (real) return real;
            // Unknown language: non-enumerable so it won't appear in the dropdown
            return { configurable: true, enumerable: false, value: String(prop) };
          },
          get(target, prop) {
            if (prop in target) return target[prop as string];
            if (typeof prop === 'string') return prop;
            return undefined;
          },
        },
      ),
    [],
  );

  const handleChange = React.useCallback(
    (markdown: string, initialMarkdownNormalize: boolean) => {
      if (initialMarkdownNormalize) return;
      const normalized = normalizeMarkdownForRichTextEditor(markdown);
      currentMarkdownRef.current = normalized;
      internalChangeRef.current = true;
      onChangeRef.current(normalized);
    },
    [],
  );

  const handleError = React.useCallback(
    ({ source }: { error: string; source: string }) => {
      if (disabled) return;
      const normalized = normalizeMarkdownForRichTextEditor(source);
      if (normalized === currentMarkdownRef.current) return;
      currentMarkdownRef.current = normalized;
      internalChangeRef.current = true;
      onChangeRef.current(normalized);
    },
    [disabled],
  );

  const insertPlainText = React.useCallback((text: string) => {
    const editor = lexicalEditorRef.current;
    if (!editor || !text) return false;

    let inserted = false;
    editor.update(() => {
      const selection = $getSelection();
      if (!selection) return;
      selection.insertRawText(text);
      inserted = true;
    });

    return inserted;
  }, []);

  const insertSanitizedMarkdown = React.useCallback((markdown: string) => {
    const content = normalizeMarkdownForRichTextEditor(sanitizeMarkdownForMdxPaste(markdown));
    if (!content.trim()) return false;
    mdxRef.current?.insertMarkdown(content);
    return true;
  }, []);

  React.useEffect(() => {
    const incomingRaw = value || '';
    const incoming = normalizeMarkdownForRichTextEditor(incomingRaw);
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      currentMarkdownRef.current = incoming;
      return;
    }
    if (!disabled && incoming !== incomingRaw) {
      const shouldRemount = incoming !== currentMarkdownRef.current;
      currentMarkdownRef.current = incoming;
      if (shouldRemount) {
        setEditorInstanceKey((prev) => prev + 1);
      }
      internalChangeRef.current = true;
      onChangeRef.current(incoming);
      return;
    }
    if (incoming === currentMarkdownRef.current) return;
    currentMarkdownRef.current = incoming;
    // Remount on true external resets so rich image nodes render immediately.
    setEditorInstanceKey((prev) => prev + 1);
  }, [disabled, value]);

  React.useEffect(() => {
    if (refreshNonce === undefined || refreshNonce < 1) return;
    const incoming = normalizeMarkdownForRichTextEditor(value || '');
    currentMarkdownRef.current = incoming;
    mdxRef.current?.setMarkdown(incoming);
  }, [refreshNonce, value]);

  React.useEffect(() => {
    if (!mdxRef.current || disabled || focusNonce === undefined || focusNonce < 1) return;
    mdxRef.current.focus();
  }, [focusNonce, disabled]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container
      .querySelectorAll<HTMLButtonElement>('.kanap-mdx-toolbar button:not([type])')
      .forEach((button) => {
        button.type = 'button';
      });
  }, [disabled, editorInstanceKey, fullToolbar, onImageUpload]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) return;

    const handlePaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;
      if (clipboardData.getData('application/x-lexical-editor')) return;

      const target = getPasteTargetElement(event.target);
      if (!target || !container.contains(target)) return;
      if (!target.closest('.kanap-mdx-content')) return;
      if (target.closest('.cm-editor, input, textarea, [data-editor-dialog], [role="dialog"], [contenteditable="false"]')) {
        return;
      }

      const html = clipboardData.getData('text/html');
      const plainText = clipboardData.getData('text/plain');
      const imageFiles = extractClipboardImageFiles(clipboardData);
      const hasUnsafeLiteralPlainText = Boolean(plainText) && hasPotentiallyUnsafeMdxPaste(plainText);

      if (!shouldHandleRichClipboardImport({ html, plainText, imageFiles })) {
        if (hasUnsafeLiteralPlainText && !looksLikeMarkdown(plainText)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          insertPlainText(plainText);
          return;
        }

        if (plainText && looksLikeMarkdown(plainText)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          insertSanitizedMarkdown(plainText);
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void convertRichClipboardToMarkdown({
        html,
        plainText,
        imageFiles,
        uploadImage: imageUploadHandlerRef.current || undefined,
        importRemoteImage: imageUrlImportHandlerRef.current || undefined,
      })
        .then((markdown) => {
          insertSanitizedMarkdown(String(markdown || ''));
        })
        .catch((error) => {
          console.error('Failed to import rich clipboard content', error);
          if (!plainText.trim()) return;
          if (hasUnsafeLiteralPlainText && !looksLikeMarkdown(plainText)) {
            insertPlainText(plainText);
            return;
          }
          insertSanitizedMarkdown(plainText);
        });
    };

    container.addEventListener('paste', handlePaste, true);
    return () => {
      container.removeEventListener('paste', handlePaste, true);
    };
  }, [disabled, insertPlainText, insertSanitizedMarkdown]);

  const plugins = React.useMemo(() => {
    const toolbarConfig = getMarkdownEditorToolbarConfig(fullToolbar);
    const basePlugins = [
      captureRootEditorPlugin({ editorRef: lexicalEditorRef }),
      headingsPlugin({ allowedHeadingLevels: toolbarConfig.allowedHeadingLevels }),
      listsPlugin(),
      quotePlugin(),
      linkPlugin(),
      linkDialogPlugin({ LinkDialog: MarkdownLinkDialog }),
      imagePlugin({
        imageUploadHandler: async (file: File) => {
          const handler = imageUploadHandlerRef.current;
          if (!handler) {
            throw new Error('Image upload is unavailable in this editor state');
          }
          return handler(file);
        },
      }),
      thematicBreakPlugin(),
      tablePlugin(),
      frontmatterPlugin(),
      directivesPlugin({
        directiveDescriptors: [AdmonitionDirectiveDescriptor],
        escapeUnknownTextDirectives: true,
      }),
      codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
      codeMirrorPlugin({ codeBlockLanguages }),
      diffSourcePlugin({ viewMode: 'rich-text' }),
      markdownShortcutPlugin(),
    ];

    if (!disabled) {
      basePlugins.push(
        toolbarPlugin({
          toolbarClassName: 'kanap-mdx-toolbar',
          toolbarContents: () => (
            <DiffSourceToggleWrapper options={['rich-text', 'source']}>
              <ConditionalContents
                options={[
                  {
                    when: (editor) => editor?.editorType === 'codeblock',
                    contents: () => (
                      <>
                        <ChangeCodeMirrorLanguage />
                      </>
                    ),
                  },
                  {
                    fallback: () => (
                      <>
                        <UndoRedo />
                        <Separator />
                        <KanapBlockStyleSelect allowedHeadingLevels={toolbarConfig.allowedHeadingLevels} />
                        <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
                        <StrikeThroughSupSubToggles options={toolbarConfig.strikeThroughOptions} />
                        {toolbarConfig.showHighlight ? <HighlightToggle /> : null}
                        <CodeToggle />
                        <Separator />
                        <ListsToggle options={['bullet', 'number', 'check']} />
                        <Separator />
                        <CreateLink />
                        {toolbarConfig.showEmoji ? <EmojiPickerButton /> : null}
                        {onImageUpload ? <InsertImage /> : null}
                        {toolbarConfig.showTable ? <InsertTable /> : null}
                        <InsertCodeBlock />
                        {toolbarConfig.showAdmonition ? <InsertAdmonition /> : null}
                        {toolbarConfig.showThematicBreak ? <InsertThematicBreak /> : null}
                      </>
                    ),
                  },
                ]}
              />
            </DiffSourceToggleWrapper>
          ),
        }),
      );
    }

    return basePlugins;
  }, [codeBlockLanguages, disabled, fullToolbar, onImageUpload]);

  return (
    <>
      <GlobalStyles
        styles={{
          '.kanap-mdx-root.kanap-mdx-root': mdxThemeVariables,
          '.kanap-mdx-root.kanap-mdx-root *': mdxThemeVariablesImportant,
          '.mdxeditor-select-content, .kanap-mdx-root .mdxeditor-select-content': {
            backgroundColor: `${theme.palette.background.paper} !important`,
            color: `${theme.palette.text.primary} !important`,
            borderColor: `${theme.palette.divider} !important`,
            zIndex: `${theme.zIndex.modal + 2} !important`,
            width: 'min(92vw, 22rem) !important',
            maxWidth: 'min(92vw, 22rem) !important',
          },
          '.kanap-mdx-root [data-radix-popper-content-wrapper]': {
            zIndex: `${theme.zIndex.modal + 2} !important`,
          },
          '.mdxeditor-select-content [data-editor-dropdown], .kanap-mdx-root [data-editor-dropdown]': {
            backgroundColor: `${theme.palette.background.paper} !important`,
            color: `${theme.palette.text.primary} !important`,
            maxHeight: 'min(55vh, 20rem)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
          },
          '.mdxeditor-select-content [data-highlighted], .kanap-mdx-root .mdxeditor-select-content [data-highlighted]': {
            backgroundColor: `${alpha(theme.palette.action.selected, isDarkMode ? 0.32 : 0.22)} !important`,
            color: `${theme.palette.text.primary} !important`,
          },
          '.kanap-mdx-root [role="dialog"]': {
            backgroundColor: `${theme.palette.background.paper} !important`,
            color: `${theme.palette.text.primary} !important`,
            borderColor: `${theme.palette.divider} !important`,
          },
          '.kanap-mdx-root [data-editor-dialog]': {
            color: `${theme.palette.text.primary} !important`,
          },
          '.kanap-mdx-root [data-editor-dialog]::placeholder': {
            color: `${theme.palette.text.secondary} !important`,
          },
          '.kanap-mdx-root .cm-cursor, .kanap-mdx-root .cm-cursor-primary': {
            borderLeftColor: `${theme.palette.text.primary} !important`,
          },
          '.kanap-mdx-root.dark-theme .cm-editor': {
            backgroundColor: `${alpha(theme.palette.background.default, 0.66)} !important`,
            color: `${theme.palette.text.primary} !important`,
          },
          '.kanap-mdx-root.dark-theme .cm-gutters': {
            backgroundColor: `${alpha(theme.palette.background.default, 0.52)} !important`,
            color: `${theme.palette.text.secondary} !important`,
            borderColor: `${theme.palette.divider} !important`,
          },
          '.kanap-mdx-root.dark-theme .cm-activeLine, .kanap-mdx-root.dark-theme .cm-activeLineGutter': {
            backgroundColor: `${alpha(theme.palette.primary.main, 0.12)} !important`,
          },
          '.kanap-mdx-root.dark-theme .cm-tooltip, .kanap-mdx-root.dark-theme .cm-tooltip.cm-tooltip-autocomplete': {
            backgroundColor: `${theme.palette.background.paper} !important`,
            color: `${theme.palette.text.primary} !important`,
            borderColor: `${theme.palette.divider} !important`,
          },
          '.kanap-mdx-root.dark-theme .cm-tooltip .cm-completionLabel, .kanap-mdx-root.dark-theme .cm-tooltip .cm-completionDetail': {
            color: `${theme.palette.text.primary} !important`,
          },
        }}
      />
      <Box
        ref={containerRef}
        onKeyDownCapture={(event) => {
          if ((!event.ctrlKey && !event.metaKey) || event.nativeEvent.isComposing) return;
          if (event.key.toLowerCase() === 's') {
            const save = onModSaveRef.current;
            if (!save) return;
            event.preventDefault();
            event.stopPropagation();
            save();
            return;
          }
          if (event.key !== 'Enter') return;
          const submit = onModEnterRef.current;
          if (!submit) return;
          event.preventDefault();
          event.stopPropagation();
          submit();
        }}
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          height: fillHeight ? '100%' : 'auto',
          minHeight: 0,
          overflow: 'visible',
          border: 1,
          borderColor: surface ? 'kanap.border.default' : 'divider',
          borderRadius: surface ? '8px' : 1,
          bgcolor: surface
            ? 'kanap.bg.composer'
            : disabled && isDarkMode ? 'action.disabledBackground' : 'background.paper',
          ...(surface ? { p: '14px 16px' } : {}),
          ...(disabled && !isDarkMode ? {
            boxShadow: `inset 0 1px 0 ${alpha(theme.palette.primary.main, 0.06)}`,
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.18),
              zIndex: 1,
            },
          } : {}),
          '&:focus-within': {
            borderColor: surface ? 'kanap.teal' : 'primary.main',
            borderWidth: 2,
          },
          '& .kanap-mdx-toolbar': {
            p: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 0.5,
            flexShrink: 0,
            top: 0,
            zIndex: 1,
            bgcolor: surface ? 'transparent' : 'background.paper',
          },
          // Hide toolbar until the editor container has focus-within
          '&:not(:focus-within) .kanap-mdx-hide-toolbar .kanap-mdx-toolbar': {
            display: 'none',
          },
          '& .kanap-mdx-root': {
            display: 'flex',
            flexDirection: 'column',
            height: fillHeight ? '100%' : 'auto',
            minHeight: 0,
            overflow: 'visible',
          },
          '& .kanap-mdx-root .mdxeditor-diff-source-wrapper': {
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            ...(fillHeight ? { flex: 1, height: '100%' } : {}),
          },
          '& .kanap-mdx-root .mdxeditor-rich-text-editor': {
            ...(fillHeight ? { minHeight: 0, height: '100%' } : {}),
          },
          '& .kanap-mdx-root .mdxeditor-root-contenteditable': {
            ...(fillHeight ? { display: 'flex', flex: 1, minHeight: 0, height: '100%' } : {}),
          },
          '& .kanap-mdx-root .mdxeditor-root-contenteditable > div': {
            ...(fillHeight
              ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }
              : {}),
          },
          '& .kanap-mdx-root .mdxeditor-source-editor': {
            minHeight: editorContentMinHeight,
            maxHeight: editorContentMaxHeight,
            ...(fillHeight ? { flex: 1, height: '100%' } : {}),
            ...(fixedSourceEditorHeight !== undefined ? { height: fixedSourceEditorHeight } : {}),
            overflow: 'hidden',
          },
          '& .kanap-mdx-root .mdxeditor-source-editor > .cm-editor': {
            minHeight: 'inherit',
            maxHeight: 'inherit',
            ...(fixedSourceEditorHeight !== undefined ? { height: '100%' } : {}),
          },
          '& .kanap-mdx-root .mdxeditor-source-editor .cm-scroller': {
            minHeight: 'inherit',
            maxHeight: 'inherit',
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',
          },
          '& .kanap-mdx-content': {
            p: 1.5,
            minHeight: editorContentMinHeight,
            maxHeight: editorContentMaxHeight,
            ...(fillHeight ? { flex: 1, height: '100%' } : {}),
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',
            outline: 'none',
            '& p': { my: 2 },
            '& hr': { my: 4 },
            '& h1': { fontSize: '1.5rem', fontWeight: 500, mt: 2, mb: 1 },
            '& h2': { fontSize: '1.25rem', fontWeight: 500, mt: 1.5, mb: 0.75 },
            '& h3': { fontSize: '1.1rem', fontWeight: 500, mt: 1, mb: 0.5 },
            '& h4': { fontSize: '1rem', fontWeight: 500, mt: 1, mb: 0.5 },
            '& h5': { fontSize: '0.95rem', fontWeight: 500, mt: 0.75, mb: 0.4 },
            '& h6': { fontSize: '0.9rem', fontWeight: 500, mt: 0.75, mb: 0.4 },
            '& ul, & ol': { pl: 3, my: 0.5 },
            '& li': { my: 0.25 },
            '& ul.contains-task-list': {
              listStyle: 'none',
              pl: 0,
              '& li': {
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
              },
              '& input[type="checkbox"]': {
                mt: 0.5,
              },
            },
            '& code': {
              bgcolor: 'action.hover',
              px: 0.5,
              py: 0.25,
              borderRadius: 0.5,
              fontFamily: 'monospace',
              fontSize: '0.875em',
            },
            '& pre': {
              bgcolor: 'action.hover',
              p: 1.5,
              borderRadius: 1,
              overflow: 'auto',
              '& code': { bgcolor: 'transparent', p: 0 },
            },
            '& blockquote': {
              borderLeft: 3,
              borderColor: 'divider',
              pl: 2,
              ml: 0,
              color: 'text.secondary',
              fontStyle: 'italic',
            },
            '& a': { color: 'primary.main', textDecoration: 'underline' },
            '& img': {
              maxWidth: '100%',
              borderRadius: 1,
              my: 1,
            },
          },
          // Read-mode content overrides: see `unfocusedContentSx` above (height
          // cap + no internal wheel scroll until the editor is focused).
          ...(Object.keys(unfocusedContentSx).length
            ? { '&:not(:focus-within) .kanap-mdx-content': unfocusedContentSx }
            : {}),
          '&:not(:focus-within) .kanap-mdx-root.kanap-mdx-hide-toolbar.kanap-mdx-surface .kanap-mdx-content': {
            p: 0,
          },
          '&:not(:focus-within) .kanap-mdx-root.kanap-mdx-hide-toolbar .kanap-mdx-content > :first-child': {
            mt: 0,
          },
          '&:not(:focus-within) .kanap-mdx-root.kanap-mdx-hide-toolbar .kanap-mdx-content > :last-child': {
            mb: 0,
          },
        }}
      >
        <MDXEditor
          key={mdxEditorKey}
          ref={mdxRef}
          markdown={currentMarkdownRef.current}
          readOnly={disabled}
          placeholder={placeholder}
          className={mdxRootClassName}
          contentEditableClassName="kanap-mdx-content"
          onChange={handleChange}
          onError={handleError}
          plugins={plugins}
        />
      </Box>
    </>
  );
});

export default MarkdownEditor;
