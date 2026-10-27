import React, { useCallback, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import CheckIcon from '@mui/icons-material/Check';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import ReactMarkdown, { type Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
// Highlight.js languages outside the lowlight "common" preset that are useful for an
// IT governance platform but not bundled by default.
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import powershell from 'highlight.js/lib/languages/powershell';
import properties from 'highlight.js/lib/languages/properties';
import { normalizeMarkdownForRichTextEditor } from '../lib/markdownEditorNormalization';

interface MarkdownContentProps {
  content: string;
  variant?: 'default' | 'compact';
  /**
   * 'show' renders every image inline, as Markdown content always has.
   * 'link' keeps KANAP-served images inline and turns any other image into a link,
   * so model-produced content cannot trigger a third-party request without a click.
   */
  externalImages?: 'show' | 'link';
  /** Remark plugins run after GitHub Flavored Markdown, on the parsed tree. */
  remarkPlugins?: ReactMarkdownOptions['remarkPlugins'];
}

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data', 'blob'],
  },
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt', 'title', 'width', 'height'],
    input: [...(defaultSchema.attributes?.input || []), 'type', 'checked', 'disabled'],
    li: [...(defaultSchema.attributes?.li || []), 'className', 'data-type', 'data-checked'],
    ul: [...(defaultSchema.attributes?.ul || []), 'className', 'data-type'],
    ol: [...(defaultSchema.attributes?.ol || []), 'className'],
    // rehype-highlight emits class="hljs language-xxx hljs-keyword" etc on
    // pre/code/span elements. Allow the className attribute on those tags so the
    // sanitizer doesn't strip the highlight classes (they're safe — pure presentation).
    code: [...(defaultSchema.attributes?.code || []), 'className'],
    pre: [...(defaultSchema.attributes?.pre || []), 'className'],
    span: [...(defaultSchema.attributes?.span || []), 'className'],
  },
};

/**
 * Replacement for the default <pre> renderer that adds a hover-revealed Copy button.
 * Extracts the raw code text from the children's text nodes (works whether the inner
 * <code> has had rehype-highlight class spans applied or not).
 */
function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractTextFromNode(props.children);
  }
  return '';
}

function CodeBlock({ children, ...rest }: { children?: React.ReactNode } & React.HTMLAttributes<HTMLPreElement>) {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);
  const text = extractTextFromNode(children);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable in non-secure contexts
    }
  }, [text]);

  return (
    <Box
      className="kanap-code-block"
      sx={{
        position: 'relative',
        '&:hover .kanap-code-copy, &:focus-within .kanap-code-copy': { opacity: 1 },
      }}
    >
      <Box component="pre" {...rest}>
        {children}
      </Box>
      {text && (
        <Tooltip title={copied ? t('markdownContent.copied') : t('markdownContent.copyCode')} placement="left">
          <IconButton
            className="kanap-code-copy"
            size="small"
            onClick={handleCopy}
            aria-label={copied ? t('markdownContent.copied') : t('markdownContent.copyCode')}
            sx={(theme) => ({
              position: 'absolute',
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              opacity: 0,
              transition: 'opacity 120ms ease, color 120ms ease, background-color 120ms ease',
              color: theme.palette.kanap.text.tertiary,
              bgcolor: theme.palette.kanap.bg.composer,
              border: `1px solid ${theme.palette.kanap.border.default}`,
              '&:hover': {
                color: theme.palette.kanap.text.primary,
                bgcolor: theme.palette.kanap.bg.composer,
              },
            })}
          >
            {copied
              ? <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />
              : <ContentCopyIcon sx={{ fontSize: 14 }} />}
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

function sanitizeUrl(url: string, key?: string): string {
  const value = String(url || '').trim();
  if (!value) return '';
  if (value.startsWith('#')) return value;

  if (key === 'href') {
    if (/^(https?:|mailto:)/i.test(value)) return value;
    if (value.startsWith('/')) return value;
    return '';
  }

  if (key === 'src') {
    if (/^(https?:|blob:)/i.test(value) || /^data:image\//i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
    return value;
  }

  return value;
}

/**
 * True when the image is served by KANAP itself: a relative URL, the app origin,
 * a blob URL, or an inline `data:image/` payload. Those load no third-party request.
 */
export function isKanapImageSource(src: string | null | undefined): boolean {
  const value = String(src ?? '').trim();
  if (!value) return false;
  if (/^data:image\//i.test(value)) return true;
  if (/^blob:/i.test(value)) return true;
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** True when an external image source can become a clickable http(s) link. */
function isHttpImageSource(src: string): boolean {
  if (/^https?:/i.test(src) || src.startsWith('//')) return true;
  try {
    const { protocol } = new URL(src, window.location.href);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function MarkdownContent({ content, variant = 'default', externalImages = 'show', remarkPlugins }: MarkdownContentProps) {
  const isCompact = variant === 'compact';
  const value = normalizeMarkdownForRichTextEditor(content || '');
  const isDark = useTheme().palette.mode === 'dark';

  // KANAP-tuned syntax palette. Code blocks get a sober, semantic ramp rather than
  // the loud github-* defaults: orange for keywords/control flow, green for strings,
  // red for numbers, purple for types/literals, neutral for everything else. Dark mode
  // uses the lighter variants so contrast stays readable on bg.composer.
  const syntax = isDark
    ? {
        comment: 'rgba(255,255,255,0.42)',
        keyword: '#F0A830',
        string: '#34D399',
        number: '#F87171',
        type: '#A78BFA',
        title: '#E5E7EB',
        tag: '#F87171',
        attr: '#9CA3AF',
      }
    : {
        comment: 'rgba(15,17,23,0.5)',
        keyword: '#E8920F',
        string: '#10B981',
        number: '#DC2626',
        type: '#8B5CF6',
        title: '#111827',
        tag: '#DC2626',
        attr: '#6B7280',
      };

  return (
    <Box
      sx={{
        '& p': { my: isCompact ? 0.25 : 1 },
        '& p:first-of-type': { mt: 0 },
        '& p:last-of-type': { mb: 0 },
        '& h1': { fontSize: '1.5rem', fontWeight: 500, mt: 2, mb: 1 },
        '& h2': { fontSize: '1.25rem', fontWeight: 500, mt: 1.5, mb: 0.75 },
        '& h3': { fontSize: '1.1rem', fontWeight: 500, mt: 1, mb: 0.5 },
        '& h4': { fontSize: '1rem', fontWeight: 500, mt: 1, mb: 0.5 },
        '& h5': { fontSize: '0.95rem', fontWeight: 500, mt: 0.75, mb: 0.4 },
        '& h6': { fontSize: '0.9rem', fontWeight: 500, mt: 0.75, mb: 0.4 },
        '& ul, & ol': { pl: 3, my: 0.5 },
        '& li': { my: 0.25 },
        '& ul[data-type="taskList"], & ul.contains-task-list': {
          listStyle: 'none',
          pl: 0,
          '& li': {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
          },
          '& input[type="checkbox"]': {
            mt: 0.5,
            pointerEvents: 'none',
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
        // rehype-highlight token colors — applied only inside <pre><code class="hljs ...">
        // so inline `code` spans keep their plain neutral styling.
        '& pre code.hljs, & pre .hljs': {
          color: 'inherit',
          background: 'transparent',
        },
        '& .hljs-comment, & .hljs-quote': { color: syntax.comment, fontStyle: 'italic' },
        '& .hljs-keyword, & .hljs-selector-tag, & .hljs-section, & .hljs-link': {
          color: syntax.keyword,
        },
        '& .hljs-literal, & .hljs-built_in, & .hljs-type, & .hljs-class .hljs-title': {
          color: syntax.type,
        },
        '& .hljs-string, & .hljs-symbol, & .hljs-bullet, & .hljs-addition': {
          color: syntax.string,
        },
        '& .hljs-number, & .hljs-meta': { color: syntax.number },
        '& .hljs-title, & .hljs-name, & .hljs-selector-id, & .hljs-selector-class': {
          color: syntax.title,
          fontWeight: 500,
        },
        '& .hljs-tag': { color: syntax.tag },
        '& .hljs-attr, & .hljs-attribute, & .hljs-template-variable, & .hljs-variable': {
          color: syntax.attr,
        },
        '& .hljs-regexp, & .hljs-deletion': { color: syntax.number },
        '& .hljs-emphasis': { fontStyle: 'italic' },
        '& .hljs-strong': { fontWeight: 500 },
        '& blockquote': {
          borderLeft: 3,
          borderColor: 'divider',
          pl: 2,
          ml: 0,
          color: 'text.secondary',
          fontStyle: 'italic',
        },
        '& a': { color: 'primary.main' },
        '& img': {
          maxWidth: '100%',
          borderRadius: 1,
          my: 1,
        },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
        // rehypeHighlight runs AFTER rehypeSanitize so the class names it adds aren't
        // stripped. (Sanitize would also drop them anyway because they're presentation,
        // but the order keeps the output predictable.)
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema as any],
          [rehypeHighlight, {
            detect: true,
            ignoreMissing: true,
            languages: { powershell, dockerfile, nginx, properties },
          }],
        ]}
        urlTransform={sanitizeUrl}
        components={{
          a: ({ node: _node, ...props }: any) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          img: ({ node: _node, src, alt, ...props }: any) => {
            const source = typeof src === 'string' ? src : '';
            const label = typeof alt === 'string' && alt.trim() ? alt : source;
            if (!source) return <>{label}</>;
            if (externalImages === 'show' || isKanapImageSource(source)) {
              return <img {...props} src={source} alt={typeof alt === 'string' ? alt : ''} />;
            }
            if (!isHttpImageSource(source)) return <>{label}</>;
            return (
              <a href={source} target="_blank" rel="noopener noreferrer nofollow">
                <ImageOutlinedIcon
                  sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary', verticalAlign: 'text-bottom' }}
                />
                {label}
              </a>
            );
          },
          pre: ({ children, ...props }: any) => (
            <CodeBlock {...props}>{children}</CodeBlock>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </Box>
  );
}
