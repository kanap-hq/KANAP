import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import ServerSelect from './ServerSelect';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({ default: { get: apiGet } }));

describe('ServerSelect', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: { items: [] } });
  });

  it('leaves clusters out through the filter model the assets list reads', async () => {
    render(<ServerSelect value={null} onChange={vi.fn()} allowClusters={false} hideLabel />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const params = apiGet.mock.calls[0][1].params;
    expect(params.is_cluster).toBeUndefined();
    expect(JSON.parse(params.filters)).toEqual({ is_cluster: { filterType: 'set', values: ['false'] } });
  });

  it('asks for every asset when clusters are allowed', async () => {
    render(<ServerSelect value={null} onChange={vi.fn()} hideLabel />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0][1].params.filters).toBeUndefined();
  });

  it('invites to choose a server in an empty field', async () => {
    const { findByPlaceholderText } = render(<ServerSelect value={null} onChange={vi.fn()} hideLabel />);
    expect(await findByPlaceholderText('Choose a server')).toBeTruthy();
  });
});
