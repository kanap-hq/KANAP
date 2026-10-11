import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// `Trans` stands in: its key, then its link element holding the reference.
const i18n = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', async () => {
  const React = await import('react');
  return {
    useTranslation: () => i18n,
    Trans: ({ i18nKey, values, components }: { i18nKey: string; values: Record<string, unknown>; components: { link: React.ReactElement } }) => (
      <span>
        {`${i18nKey} ${values.type} ${values.year ?? ''} `}
        {React.cloneElement(components.link, {}, String(values.reference))}
      </span>
    ),
  };
});

import LineLineage from './LineLineage';

describe('LineLineage', () => {
  it('names the line it follows and the line that replaces it; each opens', () => {
    const onOpen = vi.fn();
    render(
      <LineLineage
        lineage={{
          predecessor: { id: 'l1', reference: 'BL-12', nature: 'opex' },
          successor: { id: 'l3', reference: 'BL-40', nature: 'opex', from_year: 2027 },
        }}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText(/shared\.lineage\.follows shared\.lineage\.type\.opex/)).toBeInTheDocument();
    expect(screen.getByText(/shared\.lineage\.replacedBy shared\.lineage\.type\.opex 2027/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'BL-12' }));
    fireEvent.click(screen.getByRole('button', { name: 'BL-40' }));
    expect(onOpen.mock.calls.map(([line]) => line.id)).toEqual(['l1', 'l3']);
  });

  it('shows nothing for a line without either', () => {
    const { container } = render(<LineLineage lineage={{ predecessor: null, successor: null }} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    const none = render(<LineLineage lineage={undefined} onOpen={vi.fn()} />);
    expect(none.container).toBeEmptyDOMElement();
  });
});
