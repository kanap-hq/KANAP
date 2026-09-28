import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FormattedNumberField from './FormattedNumberField';

function renderField(decimals?: number) {
  const onChange = vi.fn();
  render(<FormattedNumberField value="" onChange={onChange} decimals={decimals} inputProps={{ 'aria-label': 'value' }} />);
  return { input: screen.getByLabelText('value') as HTMLInputElement, onChange };
}

function lastValue(onChange: ReturnType<typeof vi.fn>): unknown {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0].target.value;
}

/** A controlled parent that stores what the field sends and hands it back, as the screens do. */
function Host({ decimals, emit, seen }: { decimals?: number; emit?: 'number' | 'string'; seen: unknown[] }) {
  const [value, setValue] = React.useState<number | string>('');
  return (
    <FormattedNumberField
      value={value}
      decimals={decimals}
      emit={emit}
      onChange={(event) => {
        const next = event.target.value as unknown as number | string;
        seen.push(next);
        setValue(next);
      }}
      inputProps={{ 'aria-label': 'typed' }}
    />
  );
}

/** Types one character at a time, each keystroke on top of what the input shows. */
function typeChars(text: string, props: { decimals?: number; emit?: 'number' | 'string' }) {
  const seen: unknown[] = [];
  render(<Host {...props} seen={seen} />);
  const input = screen.getByLabelText('typed') as HTMLInputElement;
  for (const ch of text) fireEvent.change(input, { target: { value: input.value + ch } });
  return { input, seen, last: seen[seen.length - 1] };
}

describe('FormattedNumberField', () => {
  it('keeps two decimals by default, as the budget amounts do', () => {
    const { input, onChange } = renderField();
    fireEvent.change(input, { target: { value: '1234.5678' } });
    expect(input.value).toBe('1 234.56');
    expect(lastValue(onChange)).toBe(1234.56);
  });

  it('keeps as many decimals as asked', () => {
    const { input, onChange } = renderField(6);
    fireEvent.change(input, { target: { value: '19,08333333' } });
    expect(input.value).toBe('19.083333');
    expect(lastValue(onChange)).toBe(19.083333);
  });

  it('drops the decimals when asked for none', () => {
    const { input, onChange } = renderField(0);
    fireEvent.change(input, { target: { value: '12.9' } });
    expect(input.value).toBe('12');
    expect(lastValue(onChange)).toBe(12);
  });

  describe('typed character by character', () => {
    it('1.5 with 3 decimals', () => {
      const { input, last, seen } = typeChars('1.5', { decimals: 3, emit: 'string' });
      expect(input.value).toBe('1.5');
      expect(seen).toEqual(['1', '1', '1.5']);
      expect(last).toBe('1.5');
    });

    it('400.25 with 4 decimals', () => {
      const first = typeChars('400.25', { decimals: 4, emit: 'string' });
      expect(first.input.value).toBe('400.25');
      expect(first.last).toBe('400.25');
    });

    it('0.05 with 4 decimals keeps the zeros', () => {
      const { input, seen, last } = typeChars('0.05', { decimals: 4, emit: 'string' });
      expect(input.value).toBe('0.05');
      expect(seen).toEqual(['0', '0', '0.0', '0.05']);
      expect(last).toBe('0.05');
    });

    it('19.083333 with 6 decimals, and a seventh decimal is dropped', () => {
      const { input, last } = typeChars('19.0833339', { decimals: 6, emit: 'string' });
      expect(input.value).toBe('19.083333');
      expect(last).toBe('19.083333');
    });

    it('1234.56 with 2 decimals and a number parent (the budget amounts)', () => {
      const { input, last } = typeChars('1234.56', {});
      expect(input.value).toBe('1 234.56');
      expect(last).toBe(1234.56);
    });

    it('-400.5 keeps the minus sign', () => {
      const text = typeChars('-400.5', { decimals: 4, emit: 'string' });
      expect(text.input.value).toBe('-400.5');
      expect(text.seen[0]).toBe('');
      expect(text.last).toBe('-400.5');
    });

    it('-400.5 with a number parent', () => {
      const { input, last } = typeChars('-400.5', { decimals: 4 });
      expect(input.value).toBe('-400.5');
      expect(last).toBe(-400.5);
    });

    it('a comma is read as the decimal point', () => {
      const { input, last } = typeChars('19,5', { decimals: 6, emit: 'string' });
      expect(input.value).toBe('19.5');
      expect(last).toBe('19.5');
    });

    it('does not rewrite 400.10 when the parent hands back the same value', () => {
      const asString = typeChars('400.10', { decimals: 4, emit: 'string' });
      expect(asString.input.value).toBe('400.10');
      expect(asString.last).toBe('400.10');
    });

    it('does not rewrite 400.10 with a number parent either', () => {
      const { input, last } = typeChars('400.10', { decimals: 4 });
      expect(input.value).toBe('400.10');
      expect(last).toBe(400.1);
    });

    it('groups thousands while typing and a pasted value too', () => {
      const { input, last } = typeChars('12345.5', { decimals: 4, emit: 'string' });
      expect(input.value).toBe('12 345.5');
      expect(last).toBe('12345.5');
      fireEvent.change(input, { target: { value: '1.5' } });
      expect(input.value).toBe('1.5');
    });
  });

  it('shows a new value from the parent', () => {
    function Parent() {
      const [value, setValue] = React.useState<string>('20');
      return (
        <>
          <FormattedNumberField value={value} emit="string" onChange={(e) => setValue(String(e.target.value))} inputProps={{ 'aria-label': 'f' }} />
          <button type="button" onClick={() => setValue('18.5')}>reset</button>
        </>
      );
    }
    render(<Parent />);
    const input = screen.getByLabelText('f') as HTMLInputElement;
    expect(input.value).toBe('20');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(input.value).toBe('18.5');
  });
});
