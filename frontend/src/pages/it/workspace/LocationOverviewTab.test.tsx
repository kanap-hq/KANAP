import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../../components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="markdown-editor" value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock('./LocationSubItemsTable', () => ({ default: () => null }));

import api from '../../../api';
import LocationOverviewTab from './LocationOverviewTab';

const patch = (api as unknown as { patch: ReturnType<typeof vi.fn> }).patch;
const pause = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

type Props = React.ComponentProps<typeof LocationOverviewTab>;
const wrap = (props: Partial<Props>) => (
  <ThemeProvider theme={createAppTheme('light')}>
    <LocationOverviewTab locationId="loc-1" initialNotes="" canManage {...props} />
  </ThemeProvider>
);

describe('LocationOverviewTab notes waiting to be saved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patch.mockResolvedValue({ data: {} });
  });

  it('writes the notes once, with the last value, when the tab goes before the delay', async () => {
    const onNotesSaved = vi.fn();
    const view = render(wrap({ onNotesSaved }));
    const editor = await screen.findByLabelText('markdown-editor');
    fireEvent.change(editor, { target: { value: 'Rack' } });
    fireEvent.change(editor, { target: { value: 'Rack 4' } });
    expect(patch).not.toHaveBeenCalled();
    view.unmount();
    await pause(0);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/locations/loc-1', { additional_info: 'Rack 4' });
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(onNotesSaved).toHaveBeenCalledWith('Rack 4', 'loc-1');
  });

  it('writes nothing when the notes are back to the saved text', async () => {
    const view = render(wrap({ initialNotes: 'Rack 4' }));
    const editor = await screen.findByLabelText('markdown-editor');
    fireEvent.change(editor, { target: { value: 'Rack 45' } });
    fireEvent.change(editor, { target: { value: 'Rack 4' } });
    view.unmount();
    await pause(50);
    expect(patch).not.toHaveBeenCalled();
  });

  it('writes nothing when the notes were never typed in', async () => {
    const view = render(wrap({}));
    view.unmount();
    await pause(50);
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not write a second time when the delay already ran', async () => {
    const view = render(wrap({}));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'Rack 4' } });
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
    view.unmount();
    await pause(50);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('sends the notes to the site they were typed on when the tab shows another site', async () => {
    const view = render(wrap({ locationId: 'loc-1', initialNotes: 'one' }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'one, typed' } });
    view.rerender(wrap({ locationId: 'loc-2', initialNotes: 'two' }));
    await pause(50);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/locations/loc-1', { additional_info: 'one, typed' });
    expect((screen.getByLabelText('markdown-editor') as HTMLTextAreaElement).value).toBe('two');
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('writes a pending text once when the page asks (Cancel), and nothing more at unmount', async () => {
    const notesFlushRef = { current: null } as React.MutableRefObject<(() => Promise<void>) | null>;
    const view = render(wrap({ notesFlushRef }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'Rack 4' } });
    await act(async () => { await notesFlushRef.current?.(); });
    expect(patch).toHaveBeenCalledTimes(1);
    view.unmount();
    await pause(1100);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(notesFlushRef.current).toBeNull();
  });

  it('keeps a new site\'s notes in its draft: nothing is written at unmount', async () => {
    const onNotesDraft = vi.fn();
    const view = render(wrap({ locationId: '', onNotesDraft }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'Rack 4' } });
    view.unmount();
    await pause(50);
    expect(onNotesDraft).toHaveBeenCalledWith('Rack 4');
    expect(patch).not.toHaveBeenCalled();
  });

  /** The page's side: what the tab saves comes back as the text it hands to the tab. */
  function Page({ locationId = 'loc-1' }: { locationId?: string }) {
    const [stored, setStored] = React.useState<Record<string, string>>({ 'loc-1': '', 'loc-2': 'two' });
    return wrap({
      locationId,
      initialNotes: stored[locationId] ?? '',
      onNotesSaved: (next, id = locationId) => setStored((prev) => ({ ...prev, [id]: next.trim() ? next : '' })),
    });
  }

  it('keeps the text typed while the save runs, and sends it after', async () => {
    let answer: (value: unknown) => void = () => undefined;
    patch.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    render(<Page />);
    const editor = (await screen.findByLabelText('markdown-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Rack' } });
    await pause(1000);
    expect(patch).toHaveBeenCalledTimes(1);
    fireEvent.change(editor, { target: { value: 'Rack 4' } });
    await act(async () => { answer({ data: {} }); });
    expect(editor.value).toBe('Rack 4');
    await pause(1000);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenLastCalledWith('/locations/loc-1', { additional_info: 'Rack 4' });
  });

  it('hands back a save to the site it was made on when the tab shows another site meanwhile', async () => {
    const onNotesSaved = vi.fn();
    let answer: (value: unknown) => void = () => undefined;
    patch.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const view = render(wrap({ locationId: 'loc-1', onNotesSaved }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'one, typed' } });
    await pause(1000);
    view.rerender(wrap({ locationId: 'loc-2', initialNotes: 'two', onNotesSaved }));
    await act(async () => { answer({ data: {} }); });
    expect(onNotesSaved).toHaveBeenCalledWith('one, typed', 'loc-1');
    expect((screen.getByLabelText('markdown-editor') as HTMLTextAreaElement).value).toBe('two');
    await pause(1000);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('hands back the write made when the tab shows another site, with the site it was typed on', async () => {
    const onNotesSaved = vi.fn();
    const view = render(wrap({ locationId: 'loc-1', onNotesSaved }));
    fireEvent.change(await screen.findByLabelText('markdown-editor'), { target: { value: 'one, typed' } });
    view.rerender(wrap({ locationId: 'loc-2', initialNotes: 'two', onNotesSaved }));
    await pause(50);
    expect(onNotesSaved).toHaveBeenCalledWith('one, typed', 'loc-1');
    expect(onNotesSaved).toHaveBeenCalledTimes(1);
  });
});
