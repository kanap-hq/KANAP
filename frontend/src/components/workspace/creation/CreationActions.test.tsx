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

  it('says Create on the new page and Done once the record is created', () => {
    const view = render(<CreationActions onCreate={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.done' })).toBeNull();
    view.rerender(<CreationActions onCreate={vi.fn()} onCancel={vi.fn()} done />);
    expect(screen.getByRole('button', { name: 'common:buttons.done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.create' })).toBeNull();
  });

  it('takes a click, a key and Ctrl+S on Done', async () => {
    const onCreate = vi.fn();
    render(<div data-workspace-shell=""><CreationActions onCreate={onCreate} onCancel={vi.fn()} done /></div>);
    const done = screen.getByRole('button', { name: 'common:buttons.done' });
    fireEvent.pointerDown(done);
    fireEvent.click(done, { detail: 1 });
    // Enter or Space on the button: a click with no pointer.
    fireEvent.click(done, { detail: 0 });
    ctrlS(document.body);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(3));
  });

  it('never reaches Done from a press that began on Create: the record created under the press', () => {
    const onCreate = vi.fn();
    const view = render(<CreationActions onCreate={onCreate} onCancel={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'common:buttons.create' });
    fireEvent.pointerDown(button);
    // A record already on its way (Enter just before) comes back before the click.
    view.rerender(<CreationActions onCreate={onCreate} onCancel={vi.fn()} done />);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }), { detail: 1 });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('never reaches Done from the second click of a double-click on Create', () => {
    const onCreate = vi.fn();
    const view = render(<CreationActions onCreate={onCreate} onCancel={vi.fn()} />);
    const create = screen.getByRole('button', { name: 'common:buttons.create' });
    fireEvent.pointerDown(create);
    fireEvent.click(create, { detail: 1 });
    expect(onCreate).toHaveBeenCalledTimes(1);
    // The record is created between the two clicks.
    view.rerender(<CreationActions onCreate={onCreate} onCancel={vi.fn()} done />);
    const done = screen.getByRole('button', { name: 'common:buttons.done' });
    fireEvent.pointerDown(done);
    fireEvent.click(done, { detail: 2 });
    expect(onCreate).toHaveBeenCalledTimes(1);
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
