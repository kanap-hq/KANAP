import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import LinksAndFilesSection, { urlDomain } from './LinksAndFilesSection';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}(${opts.name})` : opts?.count != null ? `${key}(${opts.count})` : key),
  i18n: { language: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));

const LINKS = [
  { id: 'l-1', name: 'Vendor portal', url: 'https://portal.talend.com/login', added_at: '2026-10-02T08:00:00Z' },
  { id: 'l-2', name: null, url: 'status.talend.com', added_at: null },
];
const FILES = [{ id: 'f-1', name: 'Architecture.pdf', size: 2048, added_at: '2026-09-15T10:00:00Z' }];

function renderSection(props: Partial<React.ComponentProps<typeof LinksAndFilesSection>> = {}) {
  const handlers = {
    onAddLink: vi.fn().mockResolvedValue(undefined),
    onEditLink: vi.fn().mockResolvedValue(undefined),
    onRemoveLink: vi.fn(),
    onUploadFiles: vi.fn(),
    onOpenFile: vi.fn(),
    onRemoveFile: vi.fn(),
  };
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <LinksAndFilesSection links={LINKS} files={FILES} canEdit {...handlers} {...props} />
      </MemoryRouter>
    </ThemeProvider>,
  );
  return handlers;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('LinksAndFilesSection', () => {
  it('shows one row per link and file: name, domain or size, date added', () => {
    renderSection();
    const table = screen.getByRole('table', { name: 'linksAndFiles.title' });
    expect(within(table).getByText('Vendor portal')).toBeTruthy();
    expect(within(table).getByText('portal.talend.com')).toBeTruthy();
    // A link without a name shows its URL.
    expect(within(table).getAllByText('status.talend.com')).toHaveLength(2);
    expect(within(table).getByText('Architecture.pdf')).toBeTruthy();
    expect(within(table).getByText('2 kB')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('opens a web link through a real link, and a file through its callback', () => {
    const handlers = renderSection();
    const name = screen.getByRole('link', { name: 'Vendor portal' });
    expect(name).toHaveAttribute('href', 'https://portal.talend.com/login');
    expect(name).toHaveAttribute('target', '_blank');
    expect(name).toHaveAttribute('rel', 'noopener noreferrer');
    const address = screen.getByRole('link', { name: 'portal.talend.com' });
    expect(address).toHaveAttribute('href', 'https://portal.talend.com/login');
    expect(address).toHaveAttribute('target', '_blank');
    expect(address).toHaveAttribute('rel', 'noopener noreferrer');
    // A stored address without a scheme, and one that is not http, still open as https.
    const plain = screen.getAllByRole('link', { name: 'status.talend.com' });
    expect(plain).toHaveLength(2);
    plain.forEach((link) => expect(link).toHaveAttribute('href', 'https://status.talend.com'));
    fireEvent.click(screen.getByText('Architecture.pdf'));
    expect(handlers.onOpenFile).toHaveBeenCalledWith(FILES[0]);
  });

  it('adds a link through the dialog', async () => {
    const handlers = renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'linksAndFiles.columns.name' }), { target: { value: ' Release notes ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'linksAndFiles.url' }), { target: { value: 'https://talend.com/notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(handlers.onAddLink).toHaveBeenCalledWith({ name: 'Release notes', url: 'https://talend.com/notes' }));
  });

  it('shows a refused link inside the dialog and keeps it open', async () => {
    renderSection({
      onAddLink: vi.fn().mockRejectedValue({
        response: { status: 400, data: { message: '« javascript:alert(1) » is not an http or https address.' } },
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'linksAndFiles.url' }), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('« javascript:alert(1) » is not an http or https address.');
    expect(within(dialog).getByRole('heading', { name: 'linksAndFiles.newLink' })).toBeTruthy();
  });

  it('edits a link from its hover action, with its values filled in', async () => {
    const handlers = renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.editLinkNamed(Vendor portal)' }));
    const url = screen.getByRole('textbox', { name: 'linksAndFiles.url' }) as HTMLInputElement;
    expect(url.value).toBe('https://portal.talend.com/login');
    fireEvent.change(url, { target: { value: 'https://portal.talend.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(handlers.onEditLink).toHaveBeenCalledWith(LINKS[0], { name: 'Vendor portal', url: 'https://portal.talend.com' }));
  });

  it('removes a link or a file from the hover cross', () => {
    const handlers = renderSection();
    const remove = screen.getByRole('button', { name: 'linksAndFiles.removeNamed(Vendor portal)' });
    expect(remove.className).toContain('relations-remove');
    fireEvent.click(remove);
    expect(handlers.onRemoveLink).toHaveBeenCalledWith(LINKS[0]);
    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeFileNamed(Architecture.pdf)' }));
    expect(handlers.onRemoveFile).toHaveBeenCalledWith(FILES[0]);
  });

  it('attaches the chosen files, and highlights the section only while files are dragged over it', () => {
    const handlers = renderSection();
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('linksAndFiles.attachFile'), { target: { files: [file] } });
    expect(handlers.onUploadFiles).toHaveBeenCalledWith([file]);

    const zone = screen.getByRole('region', { name: 'linksAndFiles.title' }).parentElement as HTMLElement;
    expect(zone.getAttribute('data-dragging')).toBeNull();
    const dataTransfer = { types: ['Files'], files: [file] };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(zone.getAttribute('data-dragging')).toBe('true');
    fireEvent.drop(zone, { dataTransfer });
    expect(zone.getAttribute('data-dragging')).toBeNull();
    expect(handlers.onUploadFiles).toHaveBeenLastCalledWith([file]);
  });

  it('shows one line when empty', () => {
    renderSection({ links: [], files: [] });
    expect(screen.getByText('linksAndFiles.empty')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('gives readers the table and the opening only', () => {
    renderSection({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.attachFile' })).toBeNull();
    expect(screen.queryByRole('button', { name: /removeNamed|editLinkNamed/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Vendor portal' })).toHaveAttribute('href', 'https://portal.talend.com/login');
  });

  it('reads the domain of a URL, with or without its scheme', () => {
    expect(urlDomain('https://learn.microsoft.com/sql')).toBe('learn.microsoft.com');
    expect(urlDomain('status.talend.com/page')).toBe('status.talend.com');
  });
});
