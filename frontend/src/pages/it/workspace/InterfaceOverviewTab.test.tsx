import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { findCreatedRecordField } from '../../../components/workspace/creation/creationFieldFocus';

const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../components/IntegratedDocumentEditor', () => ({
  default: (props: { disabled?: boolean }) => <textarea aria-label="specification editor" disabled={props.disabled} />,
}));

import InterfaceOverviewTab from './InterfaceOverviewTab';

const LOADED = { id: 'iface-1' } as React.ComponentProps<typeof InterfaceOverviewTab>['data'];

const renderTab = (canManage: boolean, data: React.ComponentProps<typeof InterfaceOverviewTab>['data'] = LOADED) => render(
  <ThemeProvider theme={createAppTheme('light')}>
    <InterfaceOverviewTab canManage={canManage} data={data} isCreate={false} specificationEditorRef={{ current: null }} onPatch={async () => undefined} />
  </ThemeProvider>,
);

describe('InterfaceOverviewTab place of the cursor once an interface is created', () => {
  it('declares its specification when the person may change it', () => {
    renderTab(true);
    expect(findCreatedRecordField(document.body)).toBe(screen.getByLabelText('specification editor'));
  });

  it('declares nothing while the interface just written has not loaded: the editor of the draft still shows', () => {
    renderTab(true, null);
    expect(document.querySelector('[data-creation-description]')).toBeNull();
  });

  it('declares nothing when the person may not change it', () => {
    renderTab(false);
    expect(document.querySelector('[data-creation-description]')).toBeNull();
  });
});
