import React from 'react';
import { Typography } from '@mui/material';
import { PropertyRow } from '../design';
import { useSettingsReadOnly } from './SettingsPage';

/** What the field's control needs from the row: draw itself read-only, mark the error and point to it. */
export type SettingFieldControl = {
  readOnly: boolean;
  error: boolean;
  /** The id of the error line, for `aria-describedby`; undefined without an error. */
  errorId?: string;
  /**
   * The two attributes that tie the error to the control, empty without an error: spread them on the
   * focusable element (`inputProps` of a `TextField` or a `Switch`, `SelectDisplayProps` of a
   * `Select`, the `RadioGroup` itself).
   */
  aria: { 'aria-describedby'?: string; 'aria-invalid'?: true };
};

export interface SettingFieldProps {
  /** The label, with the unit when the value has one: "Maximum image size (MB)". */
  label: string;
  /** One sentence in a tooltip beside the label: where to find the value of an external system. */
  hint?: string;
  /** The refusal of the value typed or chosen, under the field. The stored value stays meanwhile. */
  error?: string | null;
  /**
   * The control (`TextField variant="standard"`, `Select`), 32 px drawn by the theme. Its placeholder
   * shows an example of the expected shape, or the default that applies when it is empty. A function
   * receives the read-only state of the page and the error to wire; a plain element (`input`) given
   * as is gets `aria-describedby` and `aria-invalid` from the field.
   */
  children: React.ReactNode | ((control: SettingFieldControl) => React.ReactNode);
}

/**
 * A field of a settings page (design-ecrans.md §4), on `PropertyRow`: label above (12 px, tertiary),
 * the field at most 480 px, the error under it. On a read-only page the control gets `readOnly`
 * (render function) and the theme draws it on the drawer background, like every read-only field.
 */
export function SettingField({ label, hint, error, children }: SettingFieldProps) {
  const readOnly = useSettingsReadOnly();
  const errorId = React.useId();
  let control: React.ReactNode;
  if (typeof children === 'function') {
    control = children({
      readOnly,
      error: !!error,
      errorId: error ? errorId : undefined,
      aria: error ? { 'aria-describedby': errorId, 'aria-invalid': true } : {},
    });
  } else if (error && React.isValidElement<React.HTMLAttributes<HTMLElement>>(children) && typeof children.type === 'string') {
    // A plain element (`input`, `select`) takes the attributes itself. A component (MUI `TextField`,
    // `Select`) would put them on its wrapper, away from the focusable control: it uses the render
    // function and wires `errorId` where its control reads it (`inputProps`).
    const describedBy = [children.props['aria-describedby'], errorId].filter(Boolean).join(' ');
    control = React.cloneElement(children, { 'aria-describedby': describedBy, 'aria-invalid': true });
  } else {
    control = children;
  }
  return (
    <PropertyRow label={label} hint={hint}>
      {control}
      {error && (
        <Typography id={errorId} sx={{ fontSize: 12, color: 'kanap.danger', mt: 0.5 }}>{error}</Typography>
      )}
    </PropertyRow>
  );
}

export default SettingField;
