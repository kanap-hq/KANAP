import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsGroup, SettingsSection } from './SettingsSection';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('SettingsSection', () => {
  it('puts what a list is for in a tooltip beside its title', () => {
    render(<SettingsSection title="Domains" description="Assets / Identity section" hint="Active Directory or DNS domains of your assets.">rows</SettingsSection>);
    expect(screen.getByText('Domains')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Active Directory or DNS domains of your assets.' })).toBeTruthy();
  });

  it('shows no icon for a list whose rows say what it is', () => {
    render(<SettingsSection title="Access methods" description="Applications / Access method selector">rows</SettingsSection>);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('titles a group without a sentence under it', () => {
    const { container } = render(<SettingsGroup title="Locations"><div /></SettingsGroup>);
    expect(container.textContent).toBe('Locations');
  });

  it('draws a flat section as its title and its fields, with the hint beside the title and nothing under it', () => {
    render(<SettingsSection variant="flat" title="Computed split" hint="Percentages of the year." description="Not shown"><p>rows</p></SettingsSection>);
    const section = screen.getByRole('region', { name: 'Computed split' });
    expect(screen.getByRole('heading', { level: 2, name: 'Computed split' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Percentages of the year.' })).toBeTruthy();
    expect(section.textContent).toBe('Computed splitrows');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
