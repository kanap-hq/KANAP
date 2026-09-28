import React from 'react';
import { TextField, TextFieldProps } from '@mui/material';

/** Groups the integer part with spaces; a typed separator and trailing zeros are kept ("1.", "400.10"). */
function formatWithSpaces(value: string | number | null | undefined): string {
  if (value === '' || value == null) return '';
  const str = typeof value === 'number' ? String(value) : value;
  const neg = str.startsWith('-');
  const raw = neg ? str.slice(1) : str;
  const dot = raw.indexOf('.');
  const intPart = (dot >= 0 ? raw.slice(0, dot) : raw).replace(/\s+/g, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + (dot >= 0 ? `${grouped}.${raw.slice(dot + 1)}` : grouped);
}

/**
 * What the user typed, cleaned: no group spaces, a comma read as the decimal point, digits, one
 * leading minus and one point. The point and trailing zeros stay while `decimals > 0`, so "1." can
 * become "1.5"; decimals beyond `decimals` are dropped.
 */
function cleanTyped(raw: string, decimals: number): string {
  let v = raw.replace(/\s+/g, '').replace(/,/g, '.');
  const neg = v.startsWith('-');
  if (neg) v = v.slice(1);
  const dot = v.indexOf('.');
  let intPart = (dot >= 0 ? v.slice(0, dot) : v).replace(/[^0-9]/g, '');
  const decPart = dot >= 0 ? v.slice(dot + 1).replace(/[^0-9]/g, '').slice(0, Math.max(0, decimals)) : '';
  const keepPoint = dot >= 0 && decimals > 0;
  if (keepPoint && intPart === '') intPart = '0';
  return (neg ? '-' : '') + intPart + (keepPoint ? `.${decPart}` : '');
}

/** The decimal string a parent receives: '' while nothing (or only a minus) is typed, no trailing point. */
function emittedString(cleaned: string): string {
  const trimmed = cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned;
  return trimmed === '' || trimmed === '-' ? '' : trimmed;
}

export type FormattedNumberFieldProps = TextFieldProps & {
  /** Decimals kept while typing (default 2, amounts); extra ones are dropped. */
  decimals?: number;
  /**
   * What `onChange` carries in `event.target.value`: a JS number (default, amounts), or the cleaned
   * decimal string (point separator, no group spaces, minus kept, '' when empty) for values that must
   * stay exact, such as quantities, prices and working days.
   */
  emit?: 'number' | 'string';
};

type Emitted = { value: number | string } | null;

export default function FormattedNumberField({
  value,
  onChange,
  inputProps,
  InputLabelProps,
  decimals = 2,
  emit = 'number',
  ...rest
}: FormattedNumberFieldProps) {
  const [text, setText] = React.useState<string>('');
  // The value this field last sent. When the parent hands it back, the text the user typed stays as
  // typed ("400.10", "1."), instead of being rewritten from the parent's form of the same value.
  const emittedRef = React.useRef<Emitted>(null);

  React.useEffect(() => {
    const emitted = emittedRef.current;
    if (emitted && sameValue(value, emitted.value, emit)) return;
    emittedRef.current = null;

    if (value === '' || value == null) {
      setText('');
      return;
    }

    if (typeof value === 'number' || typeof value === 'string') {
      setText(formatWithSpaces(value));
      return;
    }

    if (Array.isArray(value)) {
      setText(formatWithSpaces(value.join('')));
      return;
    }

    // Unsupported value shapes (e.g. objects) fall back to empty string.
    setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e?.target?.value;
    const raw = typeof rawValue === 'number' ? String(rawValue) : rawValue ?? '';
    const cleaned = cleanTyped(raw, decimals);
    setText(formatWithSpaces(cleaned));
    const asString = emittedString(cleaned);
    const next: number | string = emit === 'string' ? asString : asString === '' ? '' : Number(asString);
    emittedRef.current = { value: next };
    const synthetic = { ...e, target: { ...e.target, value: next as any } } as React.ChangeEvent<HTMLInputElement>;
    (onChange as any)?.(synthetic);
  };

  return (
    <TextField
      {...rest}
      InputLabelProps={{ shrink: true, ...(InputLabelProps as any) }}
      value={text}
      onChange={handleChange}
      inputProps={{ inputMode: 'decimal', ...inputProps }}
    />
  );
}

/** The parent's value is the one this field sent: same string, or the same number. */
function sameValue(value: unknown, emitted: number | string, emit: 'number' | 'string'): boolean {
  const blank = value === '' || value == null;
  if (emitted === '') return blank;
  if (blank) return false;
  if (emit === 'string') return String(value) === emitted;
  return Number(value) === emitted;
}
