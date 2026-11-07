import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setWorkspaceTitle, useRecordTitle } from './workspaceTitle';

function RecordPage({ title }: { title: string | null }) {
  useRecordTitle(title);
  return null;
}

describe('workspace title', () => {
  afterEach(() => {
    setWorkspaceTitle('KANAP');
    document.head.innerHTML = '';
  });

  it('names the workspace in the tab title and the installed app name', () => {
    document.head.innerHTML = '<meta name="apple-mobile-web-app-title" content="KANAP" />';
    setWorkspaceTitle('Acme Industries');
    expect(document.title).toBe('Acme Industries');
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Acme Industries');
  });

  it('titles a record page after the record and the workspace, and puts the workspace back on close', () => {
    setWorkspaceTitle('Acme Industries');
    const view = render(<RecordPage title="PRJ-3 New ERP" />);
    expect(document.title).toBe('PRJ-3 New ERP | Acme Industries');
    view.unmount();
    expect(document.title).toBe('Acme Industries');
  });

  it('leaves the title alone while the record is not loaded', () => {
    setWorkspaceTitle('Acme Industries');
    render(<RecordPage title={null} />);
    expect(document.title).toBe('Acme Industries');
  });
});
