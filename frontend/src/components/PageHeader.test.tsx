import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PageHeader from './PageHeader';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const UUID = '8c744aca-52d4-4404-8079-763c1ea9a2a7';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PageHeader title="Antoine KANDEL" actions={<button type="button">Save</button>} />
    </MemoryRouter>,
  );
}

describe('PageHeader', () => {
  it.each([
    '/settings',
    '/agents',
    '/agents/budget-watch',
    '/master-data/companies',
    '/it/assets',
    `/it/assets/${UUID}`,
    `/portfolio/contributors/${UUID}/skills`,
    '/ops/operations/currency',
    '/ops/operations/freeze',
    '/ops/operations/allocation-default',
    '/ops/operations/columns',
    '/ops/operations/master-data-freeze',
  ])('shows the title and the actions, with no breadcrumb, on %s', (path) => {
    const { container } = renderAt(path);
    expect(container.querySelector('nav[aria-label="breadcrumb"]')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Antoine KANDEL')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('labels administration pages next to the title', () => {
    renderAt('/admin/users');
    expect(screen.getByText('breadcrumbs.admin')).toBeTruthy();
  });

  it('adds no label outside administration', () => {
    renderAt('/ops/operations/currency');
    expect(screen.queryByText('breadcrumbs.admin')).toBeNull();
  });
});
