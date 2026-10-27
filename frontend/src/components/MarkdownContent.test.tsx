import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownContent, isKanapImageSource } from './MarkdownContent';
import { createAppTheme } from '../config/ThemeContext';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));

const theme = createAppTheme('light');

function renderMarkdown(
  content: string,
  props: { externalImages?: 'show' | 'link'; variant?: 'default' | 'compact' } = {},
) {
  return render(
    <ThemeProvider theme={theme}>
      <MarkdownContent content={content} {...props} />
    </ThemeProvider>,
  );
}

describe('MarkdownContent external images', () => {
  it('renders a Markdown external image as a link in link mode', () => {
    const { container } = renderMarkdown('![logo](https://exemple.test/x.png?d=1)', {
      externalImages: 'link',
    });

    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: 'logo' });
    expect(link).toHaveAttribute('href', 'https://exemple.test/x.png?d=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel') || '').toContain('noopener');
    expect(link.getAttribute('rel') || '').toContain('noreferrer');
  });

  it('renders a raw HTML external image as a link in link mode', () => {
    const { container } = renderMarkdown('<img src="https://exemple.test/x.png" alt="raw logo">', {
      externalImages: 'link',
    });

    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: 'raw logo' });
    expect(link).toHaveAttribute('href', 'https://exemple.test/x.png');
    expect(link.getAttribute('rel') || '').toContain('noopener');
    expect(link.getAttribute('rel') || '').toContain('noreferrer');
  });

  it('shows the URL when an external image has no alt text', () => {
    renderMarkdown('![](https://exemple.test/x.png)', { externalImages: 'link' });

    expect(screen.getByRole('link', { name: 'https://exemple.test/x.png' })).toBeInTheDocument();
  });

  it('keeps an external image inline by default', () => {
    const { container } = renderMarkdown('![logo](https://exemple.test/x.png?d=1)');

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://exemple.test/x.png?d=1');
  });

  it('renders a relative image source inline in link mode', () => {
    renderMarkdown('![a](/api/files/1)', { externalImages: 'link' });

    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/files/1');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a same-origin image source inline in link mode', () => {
    const src = `${window.location.origin}/api/files/2`;
    renderMarkdown(`![a](${src})`, { externalImages: 'link' });

    expect(screen.getByRole('img')).toHaveAttribute('src', src);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a blob image source inline in link mode', () => {
    const src = `blob:${window.location.origin}/asset-1`;
    renderMarkdown(`![a](${src})`, { externalImages: 'link' });

    expect(screen.getByRole('img')).toHaveAttribute('src', src);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a data:image source inline in link mode', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    renderMarkdown(`![a](${src})`, { externalImages: 'link' });

    expect(screen.getByRole('img')).toHaveAttribute('src', src);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders an image source with another scheme as plain text in link mode', () => {
    const { container } = renderMarkdown('![diagram](ftp://exemple.test/x.png)', {
      externalImages: 'link',
    });

    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('diagram')).toBeInTheDocument();
  });

  it('renders a protocol-relative external image as a link in link mode', () => {
    renderMarkdown('![logo](//exemple.test/x.png)', { externalImages: 'link' });

    expect(screen.getByRole('link', { name: 'logo' })).toHaveAttribute(
      'href',
      '//exemple.test/x.png',
    );
  });
});

describe('isKanapImageSource', () => {
  it.each([
    '/api/files/1',
    './x.png',
    '../x.png',
    'x.png',
    `${window.location.origin}/api/files/2`,
    'blob:http://localhost/asset-1',
    'data:image/png;base64,iVBORw0KGgo=',
  ])('accepts %s as served by KANAP', (src) => {
    expect(isKanapImageSource(src)).toBe(true);
  });

  it.each([
    'https://exemple.test/x.png',
    '//exemple.test/x.png',
    'javascript:alert(1)',
    'ftp://exemple.test/x.png',
    'data:text/html,<p>x</p>',
    'http://[',
    '',
    null,
  ])('rejects %s as not served by KANAP', (src) => {
    expect(isKanapImageSource(src)).toBe(false);
  });
});

describe('MarkdownContent links', () => {
  it('keeps a relative link to a page of the application', () => {
    // How the assistant cites a record without a business reference (its `page_url`).
    renderMarkdown('Renew [SAP Maintenance & Support](/ops/contracts/11111111-1111-4111-8111-111111111111) before May.', {
      externalImages: 'link',
    });

    const link = screen.getByRole('link', { name: 'SAP Maintenance & Support' });
    expect(link).toHaveAttribute('href', '/ops/contracts/11111111-1111-4111-8111-111111111111');
    expect(screen.queryByText(/11111111-1111/)).toBeNull();
  });
});
