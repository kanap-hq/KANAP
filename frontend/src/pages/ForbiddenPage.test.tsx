import '../i18n';
import i18n from 'i18next';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { FORBIDDEN_REASON_AI_CHAT_RIGHT } from '../components/ProtectedRoute';
import ForbiddenPage, { canGoBack } from './ForbiddenPage';

const fr = i18n.getFixedT('fr', 'common');
const MODULE_SENTENCE = 'Il vous manque le droit « Lecteur » sur « Budget ». Demandez-le à un administrateur de votre espace.';

function renderPage(props: { resource?: string; level?: string } = {}, state?: unknown) {
  const entry = state === undefined ? '/403' : { pathname: '/403', state };
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ForbiddenPage {...props} />
    </MemoryRouter>,
  );
}

describe('ForbiddenPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
    window.history.replaceState({ idx: 0 }, '');
  });

  it('names the missing right and level in the sentence of the API refusal', () => {
    renderPage({ resource: 'budget', level: 'reader' });
    expect(screen.getByText(MODULE_SENTENCE)).toBeInTheDocument();
  });

  it('reads the missing right from the router state when no prop says it', () => {
    renderPage({}, { resource: 'budget', level: 'reader' });
    expect(screen.getByText(MODULE_SENTENCE)).toBeInTheDocument();
  });

  it('keeps the generic sentence when no module is known', () => {
    renderPage();
    expect(screen.getByText(fr('forbidden.message'))).toBeInTheDocument();
  });

  it('keeps the AI chat wording for its own reason', () => {
    renderPage({}, { reason: FORBIDDEN_REASON_AI_CHAT_RIGHT });
    expect(screen.getByText(fr('forbidden.aiChatRight'))).toBeInTheDocument();
  });

  it('reads the React Router history index to know whether a page precedes this one', () => {
    expect(canGoBack(null)).toBe(false);
    expect(canGoBack({ idx: 0 })).toBe(false);
    expect(canGoBack({ idx: 1 })).toBe(true);
  });

  it('hides the back button on the first page of the visit', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: fr('buttons.back') })).not.toBeInTheDocument();
  });

  it('shows the back button when the app has a previous page', () => {
    window.history.replaceState({ idx: 1 }, '');
    renderPage();
    expect(screen.getByRole('button', { name: fr('buttons.back') })).toBeInTheDocument();
  });

  it('centres the block in the content area and keeps its maximum width', () => {
    renderPage();
    const title = screen.getByRole('heading', { name: fr('forbidden.title') });
    const block = title.parentElement as HTMLElement;
    const frame = block.parentElement as HTMLElement;

    expect(frame).toHaveStyle({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexGrow: '1',
      flexShrink: '0',
    });
    expect(block).toHaveStyle({ maxWidth: '560px', textAlign: 'center', width: '100%' });
    expect(block.querySelector('.MuiStack-root')).toHaveStyle({ justifyContent: 'center' });
  });
});
