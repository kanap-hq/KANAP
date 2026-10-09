import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PageHeader from './PageHeader';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const UUID = '8c744aca-52d4-4404-8079-763c1ea9a2a7';

function renderAt(path: string, breadcrumbTitle?: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PageHeader title="Antoine KANDEL" breadcrumbTitle={breadcrumbTitle} />
    </MemoryRouter>,
  );
}

function crumbLabels() {
  const nav = screen.getByLabelText('breadcrumb');
  return Array.from(nav.querySelectorAll('li:not(.MuiBreadcrumbs-separator)')).map((li) => li.textContent);
}

describe('PageHeader single-crumb pages', () => {
  it.each(['/settings', '/agents', '/master-data'])('shows no breadcrumb on %s', (path) => {
    renderAt(path);
    expect(screen.queryByLabelText('breadcrumb')).toBeNull();
    expect(screen.getByText('Antoine KANDEL')).toBeTruthy();
  });
});

describe('PageHeader breadcrumb title placement', () => {
  it('replaces the id crumb on /:id routes', () => {
    renderAt(`/portfolio/contributors/${UUID}`, 'Antoine KANDEL');
    expect(crumbLabels()).toEqual(['breadcrumbs.portfolio', 'breadcrumbs.contributors', 'Antoine KANDEL']);
  });

  it('replaces the id crumb and keeps the tab crumb on /:id/:tab routes', () => {
    renderAt(`/portfolio/contributors/${UUID}/skills`, 'Antoine KANDEL');
    expect(crumbLabels()).toEqual(['breadcrumbs.portfolio', 'breadcrumbs.contributors', 'Antoine KANDEL', 'Skills']);
    const entityLink = screen.getByRole('link', { name: 'Antoine KANDEL' });
    expect(entityLink.getAttribute('href')).toBe(`/portfolio/contributors/${UUID}`);
  });

  it('treats the self-service `me` segment as the entity crumb', () => {
    renderAt('/portfolio/contributors/me/time-logged', 'Antoine KANDEL');
    expect(crumbLabels()).toEqual(['breadcrumbs.portfolio', 'breadcrumbs.contributors', 'Antoine KANDEL', 'Time Logged']);
  });

  it('falls back to the last crumb when no entity segment precedes it', () => {
    renderAt('/ops/reports/summary', 'Quarterly view');
    expect(crumbLabels()).toEqual(['breadcrumbs.ops', 'breadcrumbs.reports', 'Quarterly view']);
  });
});

describe('PageHeader IT landscape crumbs', () => {
  it.each([
    ['assets', 'breadcrumbs.assets'],
    ['locations', 'breadcrumbs.locations'],
    ['interfaces', 'breadcrumbs.interfaces'],
    ['connections', 'breadcrumbs.connections'],
    ['incidents', 'breadcrumbs.incidents'],
  ])('labels /it/%s from the nav keys', (segment, key) => {
    renderAt(`/it/${segment}`);
    expect(crumbLabels()).toEqual(['breadcrumbs.it', key]);
  });
});
