import { describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { ready, open: () => open() };
});
const root = vi.hoisted(() => ({ render: vi.fn() }));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./i18n')>()),
  i18nReady: gate.ready,
}));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => root) }));
vi.mock('./App', () => ({ default: () => null }));

describe('main entry', () => {
  it('renders the app only once the texts of the active language are ready', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('./main');
    await Promise.resolve();
    expect(root.render).not.toHaveBeenCalled();

    gate.open();
    await vi.waitFor(() => expect(root.render).toHaveBeenCalledTimes(1));
  });
});
