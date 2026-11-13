import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [], dataClasses: [] } }),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ settings: { connectionTypes: [] }, labelFor: (_: string, code: string) => code }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../../components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="markdown-editor" value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock('./ConnectionEndpointPicker', () => ({ default: () => null }));
vi.mock('./ConnectionLinkInterfacesDialog', () => ({ default: () => null }));
vi.mock('./ConnectionProtocolsTable', () => ({ default: () => null }));

import api from '../../../api';
import ConnectionOverviewTab from './ConnectionOverviewTab';

const binding = (id: string, ref: string, name: string, environment: string) => ({
  id,
  binding_id: `b-${id}`,
  interface_id: `if-${ref}`,
  interface_reference: ref,
  interface_name: name,
  environment,
  leg_type: 'direct',
  source_endpoint: null,
  target_endpoint: null,
  pattern: 'direct',
  binding_status: 'enabled',
  interface_criticality: 'high',
  interface_data_class: 'internal',
  interface_contains_pii: false,
});

describe('ConnectionOverviewTab risk derivation', () => {
  it('lists each interface once, with its environments on the line, so the count and lines agree', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ConnectionOverviewTab
            connectionId="c1"
            topology="server_to_server"
            initialDescription=""
            canManage={false}
            source={{ asset_id: null, entity_code: null }}
            destination={{ asset_id: null, entity_code: null }}
            multiServerIds={[]}
            assetMap={{}}
            protocols={[]}
            riskMode="derived"
            linkedInterfaces={[
              binding('1', 'INT-2', 'Billing feed', 'prod'),
              binding('2', 'INT-1', 'HR sync', 'prod'),
              binding('3', 'INT-1', 'HR sync', 'qa'),
            ]}
            linkedInterfacesLoading={false}
            linkedInterfacesError={null}
            derivedInterfaceCount={2}
            onEndpointChange={vi.fn()}
            onMultiServerChange={vi.fn()}
            onProtocolsChange={vi.fn()}
            onLinkedInterfacesChanged={vi.fn()}
          />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const heading = screen.getByRole('heading', { name: 'Risk derivation (2 interfaces)' });
    const table = heading.parentElement!.parentElement!.querySelector('table')!;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const hr = rows.find((row) => row.textContent?.includes('INT-1'))!;
    expect(hr.textContent).toContain('PROD, QA');
  });
});

describe('ConnectionOverviewTab description waiting to be saved', () => {
  const patch = (api as unknown as { patch: ReturnType<typeof vi.fn> }).patch;
  const pause = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  const tab = (props: Partial<React.ComponentProps<typeof ConnectionOverviewTab>> = {}) => (
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <ConnectionOverviewTab
          connectionId="c1"
          topology="server_to_server"
          initialDescription=""
          canManage
          source={{ asset_id: null, entity_code: null }}
          destination={{ asset_id: null, entity_code: null }}
          multiServerIds={[]}
          assetMap={{}}
          protocols={[]}
          riskMode="manual"
          linkedInterfaces={[]}
          linkedInterfacesLoading={false}
          linkedInterfacesError={null}
          derivedInterfaceCount={0}
          onEndpointChange={vi.fn()}
          onMultiServerChange={vi.fn()}
          onProtocolsChange={vi.fn()}
          onLinkedInterfacesChanged={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </ThemeProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    patch.mockResolvedValue({ data: {} });
  });

  it('writes the description once, with the last text, when the tab goes before the delay', async () => {
    const onDescriptionSaved = vi.fn();
    const view = render(tab({ onDescriptionSaved }));
    const editor = await screen.findByLabelText('markdown-editor');
    fireEvent.change(editor, { target: { value: 'Back' } });
    fireEvent.change(editor, { target: { value: 'Backup link' } });
    expect(patch).not.toHaveBeenCalled();
    view.unmount();
    await pause(0);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/connections/c1', { description: 'Backup link' });
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(onDescriptionSaved).toHaveBeenCalledWith('Backup link', 'c1');
  });

  it('writes nothing when the text is back to the saved one, or was never typed', async () => {
    const view = render(tab({ initialDescription: 'Backup link' }));
    const editor = await screen.findByLabelText('markdown-editor');
    fireEvent.change(editor, { target: { value: 'Backup links' } });
    fireEvent.change(editor, { target: { value: 'Backup link' } });
    view.unmount();
    const idle = render(tab());
    idle.unmount();
    await pause(50);
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not write a second time when the delay already ran', async () => {
    const view = render(tab());
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'Backup link' } });
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
    view.unmount();
    await pause(50);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('sends the text to the connection it was typed on when the tab shows another one', async () => {
    const view = render(tab({ connectionId: 'c1', initialDescription: 'one' }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'one, typed' } });
    view.rerender(tab({ connectionId: 'c2', initialDescription: 'two' }));
    await pause(50);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/connections/c1', { description: 'one, typed' });
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('keeps the page\'s own flush (Create, Cancel) to one write, and nothing more at unmount', async () => {
    const descriptionFlushRef = { current: null } as React.MutableRefObject<(() => Promise<void>) | null>;
    const view = render(tab({ descriptionFlushRef }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'Backup link' } });
    await act(async () => { await descriptionFlushRef.current?.(); });
    view.unmount();
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('keeps the text typed while the save runs once the page hands the saved text back, and sends it after', async () => {
    let answer: (value: unknown) => void = () => undefined;
    patch.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    function Page() {
      const [stored, setStored] = React.useState('');
      return tab({ initialDescription: stored, onDescriptionSaved: (next) => setStored(next) });
    }
    render(<Page />);
    const editor = (await screen.findByLabelText('markdown-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Backup' } });
    await pause(1000);
    expect(patch).toHaveBeenCalledTimes(1);
    fireEvent.change(editor, { target: { value: 'Backup link' } });
    await act(async () => { answer({ data: {} }); });
    expect(editor.value).toBe('Backup link');
    await pause(1000);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenLastCalledWith('/connections/c1', { description: 'Backup link' });
  });

  it('hands back a save to the connection it was made on when the tab shows another one meanwhile', async () => {
    const onDescriptionSaved = vi.fn();
    let answer: (value: unknown) => void = () => undefined;
    patch.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const view = render(tab({ connectionId: 'c1', onDescriptionSaved }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'one, typed' } });
    await pause(1000);
    view.rerender(tab({ connectionId: 'c2', initialDescription: 'two', onDescriptionSaved }));
    await act(async () => { answer({ data: {} }); });
    expect(onDescriptionSaved).toHaveBeenCalledWith('one, typed', 'c1');
    expect((screen.getByLabelText('markdown-editor') as HTMLTextAreaElement).value).toBe('two');
  });
});
