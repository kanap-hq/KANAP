import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatEmptyState, { ANGLE_SUGGESTIONS, SUGGESTION_KEYS, suggestionPrompt } from '../components/ChatEmptyState';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';

// Keys are built as `workspace.suggestions.${key}`, so translationKeys.test.ts never sees them.
let budgetReader = true;
let readable: string[] | null = null;
let angle: string | null = null;

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => level === 'reader'
      && (readable ? readable.includes(resource) : budgetReader && resource === 'budget'),
  }),
}));

vi.mock('../../components/onboarding/useOnboarding', () => ({
  useOnboarding: () => ({ state: angle ? { angle } : undefined }),
}));

const LABELS: Record<string, { budgetLines: string; applicationMention: string }> = {
  en: {
    budgetLines: 'What are my five largest budget lines this year?',
    applicationMention: 'Summarize an application: type @ to pick one',
  },
  fr: {
    budgetLines: 'Quelles sont mes cinq plus grosses lignes budgétaires cette année ?',
    applicationMention: 'Résume une application : tapez @ pour la choisir',
  },
  de: {
    budgetLines: 'Was sind meine fünf größten Budgetzeilen in diesem Jahr?',
    applicationMention: 'Fassen Sie eine Anwendung zusammen: Geben Sie @ ein, um eine auszuwählen.',
  },
  es: {
    budgetLines: '¿Cuáles son mis cinco líneas presupuestarias más grandes este año?',
    applicationMention: 'Resuma una aplicación: escriba @ para elegir una.',
  },
};

const MENTION_PROMPTS: Record<string, string> = {
  en: 'Summarize an application @APP-',
  fr: 'Résume une application @APP-',
  de: 'Fassen Sie eine Anwendung zusammen @APP-',
  es: 'Resuma una aplicación @APP-',
};

function renderEmpty(onSuggestion = vi.fn()) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ChatEmptyState onSuggestion={onSuggestion} />
    </ThemeProvider>,
  );
  return onSuggestion;
}

describe('suggestionPrompt', () => {
  it('leaves a token that already opens the picker unchanged', () => {
    expect(suggestionPrompt('Summarize @APP-')).toBe('Summarize @APP-');
    expect(suggestionPrompt('Show me my overdue tasks')).toBe('Show me my overdue tasks');
  });

  it('keeps the request and ends on the application token', () => {
    expect(suggestionPrompt(LABELS.en.applicationMention)).toBe(MENTION_PROMPTS.en);
    expect(suggestionPrompt(`Résume une application\u00a0: tapez @ pour la choisir`)).toBe(MENTION_PROMPTS.fr);
  });
});

describe.each(['en', 'fr', 'de', 'es'])('chat suggestions in %s', (lng) => {
  beforeEach(async () => {
    budgetReader = true;
    await i18n.changeLanguage(lng);
  });

  afterEach(async () => {
    cleanup();
    budgetReader = true;
    readable = null;
    angle = null;
    await i18n.changeLanguage('en');
  });

  it('has the questions of every path in this locale', () => {
    for (const { key } of Object.values(ANGLE_SUGGESTIONS).flat()) {
      const raw = i18n.getResource(lng, 'ai', `workspace.suggestions.${key}`);
      expect(typeof raw, `${lng} workspace.suggestions.${key}`).toBe('string');
    }
  });

  it('has every suggestion key in this locale', () => {
    for (const key of SUGGESTION_KEYS) {
      const raw = i18n.getResource(lng, 'ai', `workspace.suggestions.${key}`);
      expect(typeof raw, `${lng} workspace.suggestions.${key}`).toBe('string');
      expect((raw as string).trim().length).toBeGreaterThan(0);
    }
    expect(i18n.getResource(lng, 'ai', 'workspace.suggestions.budgetLines')).toBe(LABELS[lng].budgetLines);
    expect(i18n.getResource(lng, 'ai', 'workspace.suggestions.applicationMention')).toBe(LABELS[lng].applicationMention);
    expect(LABELS[lng].budgetLines.includes('@')).toBe(false);
    expect(LABELS[lng].applicationMention.includes('@')).toBe(true);
  });

  it('shows the budget question to a budget reader and the mention hint to everyone', () => {
    const onSuggestion = renderEmpty();

    expect(screen.getAllByRole('button')).toHaveLength(SUGGESTION_KEYS.length);
    for (const key of SUGGESTION_KEYS) {
      const label = i18n.t(`ai:workspace.suggestions.${key}`);
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai:workspace.suggestions.budgetLines') }));
    expect(onSuggestion).toHaveBeenCalledWith(i18n.t('ai:workspace.suggestions.budgetLines'));

    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai:workspace.suggestions.applicationMention') }));
    const prompt = onSuggestion.mock.calls[1][0] as string;
    expect(prompt).toBe(MENTION_PROMPTS[lng]);
    const at = prompt.lastIndexOf('@');
    expect(at).toBeGreaterThan(0);
    expect(/\s/.test(prompt.slice(at + 1))).toBe(false);
  });

  it('hides the budget question without the right to read the budget', () => {
    budgetReader = false;
    renderEmpty();

    expect(screen.getAllByRole('button')).toHaveLength(SUGGESTION_KEYS.length - 1);
    expect(screen.queryByRole('button', { name: i18n.t('ai:workspace.suggestions.budgetLines') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('ai:workspace.suggestions.applicationMention') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('ai:workspace.suggestions.overdueTasks') })).toBeInTheDocument();
  });

  it('puts the questions of the workspace path first, then the usual ones, five at most', () => {
    angle = 'cartography';
    readable = ['applications', 'budget'];
    renderEmpty();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels).toEqual([
      i18n.t('ai:workspace.suggestions.endOfSupport'),
      i18n.t('ai:workspace.suggestions.noRecovery'),
      i18n.t('ai:workspace.suggestions.budgetLines'),
      i18n.t('ai:workspace.suggestions.overdueTasks'),
      i18n.t('ai:workspace.suggestions.myProjects'),
    ]);
  });

  it('leads with the savings question on the budget path, then the usual budget question once', () => {
    angle = 'budget';
    readable = ['budget'];
    renderEmpty();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.slice(0, 3)).toEqual([
      i18n.t('ai:workspace.suggestions.savings'),
      i18n.t('ai:workspace.suggestions.noOwner'),
      i18n.t('ai:workspace.suggestions.budgetLines'),
    ]);
    expect(labels.filter((label) => label === i18n.t('ai:workspace.suggestions.budgetLines'))).toHaveLength(1);
  });

  it('leaves out a path question the person may not read', () => {
    angle = 'portfolio';
    readable = ['portfolio_projects'];
    renderEmpty();
    expect(screen.getByRole('button', { name: i18n.t('ai:workspace.suggestions.overBudget') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: i18n.t('ai:workspace.suggestions.awaitingDecision') })).not.toBeInTheDocument();
  });
});
