import { describe, expect, it } from 'vitest';
import { escapeTooltipText } from './tooltipText';

describe('escapeTooltipText', () => {
  it('shows a name with markup as typed', () => {
    expect(escapeTooltipText('<b>Bold</b> "A" & \'B\'')).toBe('&lt;b&gt;Bold&lt;/b&gt; &quot;A&quot; &amp; &#39;B&#39;');
  });

  it('leaves plain names alone and turns a missing name into an empty title', () => {
    expect(escapeTooltipText('Réel 2026')).toBe('Réel 2026');
    expect(escapeTooltipText(undefined)).toBe('');
    expect(escapeTooltipText(null)).toBe('');
  });
});
