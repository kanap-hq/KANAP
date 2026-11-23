import { describe, expect, it, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
  armCreatedRecordFocus,
  clearCreationFieldFocus,
  followCreationFields,
  noteCreationWrite,
  useCreationFieldFocus,
} from './creationFieldFocus';

/**
 * A new record's title with a name typed, whose Tab the page takes for its own step (an interface
 * opens its Flow tab): the focus follows on the page that shows next.
 */
function tabFromTitleToPageStep() {
  const view = render(
    <div onKeyDownCapture={(event) => followCreationFields(event, () => undefined)}>
      <span data-creation-actions="" />
      <div data-creation-title=""><input aria-label="title" defaultValue="Billing" /></div>
    </div>,
  );
  fireEvent.keyDown(screen.getByLabelText('title'), { key: 'Tab' });
  view.unmount();
}

/** The creation frame wrote the record from its title: the record's page places the cursor. */
function tabFromTitle() {
  noteCreationWrite();
  armCreatedRecordFocus();
}

function Record({ page = 'record:overview', children }: { page?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useCreationFieldFocus(ref, page);
  return <div ref={ref} data-workspace-shell="">{children}</div>;
}

describe('useCreationFieldFocus', () => {
  afterEach(() => clearCreationFieldFocus());

  it('focuses the description on the record created, ahead of a field left empty', async () => {
    tabFromTitle();
    render(
      <Record>
        <div data-creation-panel="main"><div data-creation-description=""><textarea aria-label="description" /></div></div>
        <div data-creation-panel="properties">
          <div data-required-field=""><input aria-label="company" /></div>
        </div>
      </Record>,
    );
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('takes the focus back from the page scroller Layout focused after the navigation', async () => {
    tabFromTitle();
    const view = render(<Record><div data-creation-panel="main" data-creation-description=""><textarea aria-label="description" /></div></Record>);
    const scroller = document.createElement('div');
    scroller.setAttribute('data-primary-scroll', '');
    scroller.tabIndex = -1;
    document.body.appendChild(scroller);
    scroller.focus();
    await waitFor(() => expect(view.getByLabelText('description')).toHaveFocus());
    scroller.remove();
  });

  it('waits for a marked description whose editor is still loading', async () => {
    tabFromTitle();
    const view = render(
      <Record>
        <div data-creation-panel="main">
          <div data-creation-description="" />
          <textarea aria-label="support notes" />
        </div>
      </Record>,
    );
    expect(screen.getByLabelText('support notes')).not.toHaveFocus();
    view.rerender(
      <Record>
        <div data-creation-panel="main">
          <div data-creation-description=""><div aria-label="description" contentEditable suppressContentEditableWarning /></div>
          <textarea aria-label="support notes" />
        </div>
      </Record>,
    );
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('focuses a description shown read-only, which opens its editor', async () => {
    tabFromTitle();
    render(
      <Record>
        <div data-creation-panel="main">
          <div data-creation-description=""><div role="textbox" tabIndex={0} aria-label="description">Add a description</div></div>
        </div>
      </Record>,
    );
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('leaves the focus alone on the page the Tab was pressed on', async () => {
    const view = render(<Record page="new:overview"><div data-creation-panel="main"><textarea aria-label="description" /></div></Record>);
    tabFromTitle();
    view.rerender(<Record page="new:overview"><div data-creation-panel="main"><textarea aria-label="description" /></div></Record>);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByLabelText('description')).not.toHaveFocus();
  });

  it('places the focus on the tab the page opened', async () => {
    const view = render(<Record page="new:overview"><div data-creation-panel="main"><textarea aria-label="description" /></div></Record>);
    tabFromTitleToPageStep();
    view.rerender(
      <Record page="new:flow">
        <div data-creation-panel="main"><div data-creation-field="source"><input aria-label="source" /></div></div>
      </Record>,
    );
    await waitFor(() => expect(screen.getByLabelText('source')).toHaveFocus());
  });

  it('passes by a required field the tab the page opened fills a moment after it shows', async () => {
    tabFromTitleToPageStep();
    const fields = (type: string) => (
      <Record>
        <div data-creation-panel="properties">
          <div data-required-field=""><input aria-label="type" value={type} onChange={() => undefined} /></div>
          <div data-required-field=""><input aria-label="site" /></div>
        </div>
      </Record>
    );
    const view = render(fields(''));
    view.rerender(fields('Server'));
    await waitFor(() => expect(screen.getByLabelText('site')).toHaveFocus());
  });

  it('does not take the focus from where the person went meanwhile', async () => {
    tabFromTitle();
    const view = render(<Record><button type="button">Elsewhere</button></Record>);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    view.rerender(<Record><button type="button">Elsewhere</button><textarea aria-label="description" data-creation-description="" /></Record>);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('keeps placing the focus after a key typed while the focus is nowhere yet', async () => {
    tabFromTitle();
    const loading = <Record><div data-creation-panel="main"><div data-creation-description="" /></div></Record>;
    const view = render(loading);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'q' });
    view.rerender(
      <Record>
        <div data-creation-panel="main">
          <div data-creation-description=""><div aria-label="description" contentEditable suppressContentEditableWarning /></div>
        </div>
      </Record>,
    );
    await waitFor(() => expect(screen.getByLabelText('description')).toHaveFocus());
  });

  it('stops placing the focus after a press of the pointer elsewhere', async () => {
    tabFromTitle();
    const view = render(<Record><div data-creation-panel="main"><div data-creation-description="" /></div></Record>);
    fireEvent.pointerDown(document.body);
    view.rerender(
      <Record>
        <div data-creation-panel="main">
          <div data-creation-description=""><div aria-label="description" contentEditable suppressContentEditableWarning /></div>
        </div>
      </Record>,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByLabelText('description')).not.toHaveFocus();
  });

  it('leaves the cursor in the field it placed once the person types there', async () => {
    tabFromTitleToPageStep();
    const fields = (type: string) => (
      <Record>
        <div data-creation-panel="properties">
          <div data-required-field=""><input aria-label="type" value={type} onChange={() => undefined} /></div>
          <div data-required-field=""><input aria-label="site" /></div>
        </div>
      </Record>
    );
    const view = render(fields(''));
    await waitFor(() => expect(screen.getByLabelText('type')).toHaveFocus());
    fireEvent.keyDown(screen.getByLabelText('type'), { key: 'S' });
    view.rerender(fields('Server'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByLabelText('type')).toHaveFocus();
  });
});
