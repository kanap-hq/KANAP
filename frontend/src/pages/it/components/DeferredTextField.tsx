import React from 'react';
import { TextField, type TextFieldProps } from '@mui/material';

/** Quiet time after the last keystroke before the value is saved. */
export const DEFERRED_SAVE_MS = 800;

type Props = Omit<TextFieldProps, 'value' | 'onChange' | 'onBlur' | 'defaultValue'> & {
  /** The saved value. It follows the field only while nothing is typed or being saved. */
  value: string;
  /** Saves the typed value; a rejection puts the field back on the saved value. */
  onSave: (next: string) => void | Promise<unknown>;
  /** Another record: the field restarts from its value. */
  resetKey?: string;
};

/**
 * A text field that saves once the typing stops (800 ms without a key, or when the field loses
 * the focus), one request at a time, the last typed value winning. A response never rewrites
 * what is being typed.
 */
export default function DeferredTextField({ value, onSave, resetKey, ...rest }: Props) {
  const [text, setText] = React.useState(value);
  const typed = React.useRef(value);
  const dirty = React.useRef(false);
  const inFlight = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = React.useRef(value);
  saved.current = value;
  // The save of the record the typed value belongs to, taken at the keystroke: when another
  // record opens, `onSave` is already the new record's.
  const typedSave = React.useRef(onSave);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  React.useEffect(() => {
    if (!dirty.current && !inFlight.current) {
      typed.current = value;
      setText(value);
    }
  }, [value]);

  React.useEffect(() => {
    clearTimer();
    if (dirty.current) {
      // A value typed on the record just left: saved there, never on the new one.
      const send = typedSave.current;
      const sending = typed.current;
      void Promise.resolve().then(() => send(sending)).catch(() => undefined);
    }
    dirty.current = false;
    typed.current = saved.current;
    setText(saved.current);
  }, [resetKey]);

  const flush = React.useCallback(async () => {
    clearTimer();
    if (inFlight.current || !dirty.current) return;
    inFlight.current = true;
    try {
      while (dirty.current) {
        const sending = typed.current;
        dirty.current = false;
        try {
          await typedSave.current(sending);
        } catch {
          if (!dirty.current) {
            typed.current = saved.current;
            setText(saved.current);
          }
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  React.useEffect(() => () => { void flush(); }, [flush]);

  return (
    <TextField
      {...rest}
      value={text}
      onChange={(event) => {
        typed.current = event.target.value;
        typedSave.current = onSave;
        dirty.current = true;
        setText(event.target.value);
        clearTimer();
        timer.current = setTimeout(() => { void flush(); }, DEFERRED_SAVE_MS);
      }}
      onBlur={() => { void flush(); }}
    />
  );
}
