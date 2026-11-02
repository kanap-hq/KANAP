import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it } from 'vitest';
import TokenUsageBar from './TokenUsageBar';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import en from '../../locales/en/ai.json';
import fr from '../../locales/fr/ai.json';
import de from '../../locales/de/ai.json';
import es from '../../locales/es/ai.json';

const usage = { input_tokens: 12, output_tokens: 4 };
const lastRequestUsage = { input_tokens: 7, output_tokens: 2 };

function renderBar() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <TokenUsageBar usage={usage} lastRequestUsage={lastRequestUsage} />
    </ThemeProvider>,
  );
}

describe('TokenUsageBar labels', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('names the processed volume and the context of the last request in each language', async () => {
    expect(en.tokenUsage).toEqual({
      total: 'Volume processed',
      input: 'Input tokens',
      output: 'Output tokens',
      lastInput: 'Context of the last request',
    });
    expect(fr.tokenUsage).toEqual({
      total: 'Volume traité',
      input: 'Tokens en entrée',
      output: 'Tokens en sortie',
      lastInput: 'Contexte de la dernière requête',
    });
    expect(de.tokenUsage).toEqual({
      total: 'Verarbeitetes Volumen',
      input: 'Eingabe-Tokens',
      output: 'Ausgabe-Tokens',
      lastInput: 'Kontext der letzten Anfrage',
    });
    expect(es.tokenUsage).toEqual({
      total: 'Volumen procesado',
      input: 'Tokens de entrada',
      output: 'Tokens de salida',
      lastInput: 'Contexto de la última solicitud',
    });

    await i18n.changeLanguage('en');
    renderBar();
    const bar = screen.getByTestId('token-usage-bar');
    expect(bar).toHaveTextContent('Volume processed: 16');
    expect(bar).toHaveTextContent('Input tokens: 12');
    expect(bar).toHaveTextContent('Output tokens: 4');
    expect(bar).toHaveTextContent('Context of the last request: 7');
  });

  it('uses the French labels on the bar', async () => {
    await i18n.changeLanguage('fr');
    renderBar();
    const bar = screen.getByTestId('token-usage-bar');
    expect(bar).toHaveTextContent('Volume traité');
    expect(bar).toHaveTextContent('Contexte de la dernière requête');
    expect(bar).toHaveTextContent('Tokens en entrée');
    expect(bar).toHaveTextContent('Tokens en sortie');
  });

  it('omits the last-request context when that usage is missing', async () => {
    await i18n.changeLanguage('en');
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <TokenUsageBar usage={usage} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('token-usage-bar')).toHaveTextContent('Volume processed: 16');
    expect(screen.queryByText(/Context of the last request/)).not.toBeInTheDocument();
  });
});
