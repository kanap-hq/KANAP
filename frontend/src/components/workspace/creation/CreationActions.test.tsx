import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreationActions from './CreationActions';

function ctrlS(target: Element) {
  const press = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
  fireEvent(target, press);
  return press;
}

/** A page whose text field commits as the focus leaves it, like the record pages. */
function Page({ onCreate }: { onCreate: (city: string) => void }) {
  const [city, setCity] = React.useState('');
  const [draft, setDraft] = React.useState('');
  return (
    <div data-workspace-shell="">
      <CreationActions onCreate={() => onCreate(city)} onCancel={vi.fn()} />
      <input aria-label="city" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setCity(draft)} />
    </div>
  );
}

describe('CreationActions', () => {
  it('keeps Create clickable while the record is written, Cancel waits', () => {
    const onCreate = vi.fn();
    render(<CreationActions onCreate={onCreate} onCancel={vi.fn()} writing />);
    const [cancel, create] = screen.getAllByRole('button');
    expect(cancel).toBeDisabled();
    expect(create).toBeEnabled();
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('holds both while a check or a cancel runs', () => {
    render(<CreationActions onCreate={vi.fn()} onCancel={vi.fn()} busy />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('takes Ctrl+S as Create, with the field being typed committed first', async () => {
    const onCreate = vi.fn();
    render(<Page onCreate={onCreate} />);
    const city = screen.getByLabelText('city');
    city.focus();
    fireEvent.change(city, { target: { value: 'Lyon' } });
    const press = ctrlS(city);
    expect(press.defaultPrevented).toBe(true);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Lyon'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toHaveFocus();
  });

  it('keeps the page from its own save shortcut and the browser from saving the page', async () => {
    const pageSave = vi.fn();
    window.addEventListener('keydown', pageSave);
    render(<CreationActions onCreate={vi.fn()} onCancel={vi.fn()} busy />);
    const press = ctrlS(document.body);
    expect(press.defaultPrevented).toBe(true);
    expect(pageSave).not.toHaveBeenCalled();
    window.removeEventListener('keydown', pageSave);
  });

  it('does nothing while busy, as the button', async () => {
    const onCreate = vi.fn();
    render(<CreationActions onCreate={onCreate} onCancel={vi.fn()} busy />);
    ctrlS(document.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+S to a field that uses it, to a dialog over the page and to a panel beside it', async () => {
    const onCreate = vi.fn();
    render(
      <>
        <div data-workspace-shell="">
          <CreationActions onCreate={onCreate} onCancel={vi.fn()} />
          <textarea aria-label="comment" onKeyDown={(e) => { if (e.key === 's') e.stopPropagation(); }} />
        </div>
        <div role="dialog"><input aria-label="dialog field" /></div>
        <aside><input aria-label="assistant" /></aside>
      </>,
    );
    for (const name of ['comment', 'dialog field', 'assistant']) {
      expect(ctrlS(screen.getByLabelText(name)).defaultPrevented).toBe(false);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
