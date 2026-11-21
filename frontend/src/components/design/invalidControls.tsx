import React from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { visuallyHiddenSx } from './FieldLabel';

/** The controls a person types in or picks from, inside a field's box (a native select's hidden input aside). */
const CONTROLS = 'input:not([type="hidden"]):not([aria-hidden="true"]), textarea, [role="combobox"]:not(input)';
const MARK = 'data-missing-invalid';
/** The id this hook added to a control's `aria-describedby`. */
const DESCRIBED = 'data-missing-described';

const tokens = (value: string | null) => (value ?? '').split(/\s+/).filter(Boolean);

/**
 * Sets `aria-invalid` on the controls inside `ref` while `invalid`, and ties them (`aria-describedby`,
 * next to what they already have) to the text `describedBy` names: a screen reader announces the
 * field a check found missing, and why, which the screen shows by its red label and its icon. Only
 * what this hook added is taken back. Runs after every render: a picker may draw its input again.
 */
export function useInvalidControls(ref: React.RefObject<HTMLElement | null>, invalid: boolean, describedBy?: string): void {
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(CONTROLS).forEach((control) => {
      if (invalid) {
        if (control.getAttribute('aria-invalid') !== 'true') {
          control.setAttribute(MARK, control.getAttribute('aria-invalid') ?? '');
          control.setAttribute('aria-invalid', 'true');
        }
        if (describedBy && !tokens(control.getAttribute('aria-describedby')).includes(describedBy)) {
          control.setAttribute(DESCRIBED, describedBy);
          control.setAttribute('aria-describedby', [...tokens(control.getAttribute('aria-describedby')), describedBy].join(' '));
        }
      } else {
        if (control.hasAttribute(MARK)) {
          const before = control.getAttribute(MARK);
          if (before) control.setAttribute('aria-invalid', before);
          else control.removeAttribute('aria-invalid');
          control.removeAttribute(MARK);
        }
        const added = control.getAttribute(DESCRIBED);
        if (added) {
          const rest = tokens(control.getAttribute('aria-describedby')).filter((id) => id !== added);
          if (rest.length > 0) control.setAttribute('aria-describedby', rest.join(' '));
          else control.removeAttribute('aria-describedby');
          control.removeAttribute(DESCRIBED);
        }
      }
    });
  });
}

/** The text a missing field's control is described by: "Missing", for a screen reader only. Rendered while `missing`. */
export function MissingDescription({ id }: { id: string }) {
  const { t } = useTranslation('common');
  return <Box component="span" id={id} sx={visuallyHiddenSx}>{t('common:creation.missingMark')}</Box>;
}

/** A box around a field that is not a `PropertyRow` (its label drawn apart): `aria-invalid` on its controls, tied to "Missing", while `missing`. */
export function MissingFieldBox({ missing, children, ...rest }: { missing: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const descriptionId = React.useId();
  useInvalidControls(ref, missing, descriptionId);
  return <div ref={ref} {...rest}>{children}{missing ? <MissingDescription id={descriptionId} /> : null}</div>;
}
