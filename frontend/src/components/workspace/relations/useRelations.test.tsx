import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { useRelations } from './useRelations';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const mocked = vi.mocked(api);

type Row = { id: string; name: string };
type Payload = { projects: Row[] | null; suggestions: Row[] };

const PAYLOAD: Payload = {
  projects: [{ id: 'p-1', name: 'Migration' }],
  suggestions: [{ id: 's-1', name: 'Formation' }],
};

function Probe({ drop = false, onChange }: { drop?: boolean; onChange?: () => void }) {
  const rel = useRelations<Payload>({
    path: '/objects/obj-1/relations',
    queryKey: ['object-relations', 'obj-1'],
    onChange,
    dropLinkedSuggestion: drop,
  });
  return (
    <div>
      {rel.error && <div role="alert">{rel.error}</div>}
      <button type="button" onClick={() => { void rel.link('projects', 's-1'); }}>link</button>
      {(rel.data?.projects ?? []).map((row) => (
        <button type="button" key={row.id} onClick={() => { void rel.unlink('projects', row.id); }}>{row.name}</button>
      ))}
      {(rel.data?.suggestions ?? []).map((row) => <span key={row.id}>{row.name}</span>)}
    </div>
  );
}

function renderProbe(props: { drop?: boolean; onChange?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.delete.mockReset();
  mocked.get.mockResolvedValue({ data: PAYLOAD } as never);
});

describe('useRelations', () => {
  it('links a row and drops the matching suggestion at once', async () => {
    let resolvePost: (value: unknown) => void = () => undefined;
    mocked.post.mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }) as never);
    const onChange = vi.fn();
    renderProbe({ drop: true, onChange });
    expect(await screen.findByText('Formation')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'link' }));
    await waitFor(() => expect(screen.queryByText('Formation')).toBeNull());
    expect(mocked.post).toHaveBeenCalledWith('/objects/obj-1/relations/projects', { id: 's-1' });
    expect(onChange).not.toHaveBeenCalled();

    resolvePost({ data: { ok: true } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('removes a row at once and brings it back with a message when the server refuses', async () => {
    let rejectDelete: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, reject) => { rejectDelete = reject; }) as never);
    const onChange = vi.fn();
    renderProbe({ onChange });
    fireEvent.click(await screen.findByRole('button', { name: 'Migration' }));

    expect(mocked.delete).toHaveBeenCalledWith('/objects/obj-1/relations/projects/p-1');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Migration' })).toBeNull());

    rejectDelete({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByRole('button', { name: 'Migration' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
