import React from 'react';

/** The controls a person types in or picks from, inside a field's box (a native select's hidden input aside). */
const CONTROLS = 'input:not([type="hidden"]):not([aria-hidden="true"]), textarea, [role="combobox"]:not(input)';
const MARK = 'data-missing-invalid';

/**
 * Sets `aria-invalid` on the controls inside `ref` while `invalid`: a screen reader announces the
 * field a check found missing, which the screen shows by its red label. Only the controls this hook
 * marked are put back. Runs after every render: a picker may draw its input again.
 */
export function useInvalidControls(ref: React.RefObject<HTMLElement | null>, invalid: boolean): void {
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(CONTROLS).forEach((control) => {
      if (invalid) {
        if (control.getAttribute('aria-invalid') !== 'true') {
          control.setAttribute(MARK, control.getAttribute('aria-invalid') ?? '');
          control.setAttribute('aria-invalid', 'true');
        }
      } else if (control.hasAttribute(MARK)) {
        const before = control.getAttribute(MARK);
        if (before) control.setAttribute('aria-invalid', before);
        else control.removeAttribute('aria-invalid');
        control.removeAttribute(MARK);
      }
    });
  });
}

/** A box around a field that is not a `PropertyRow` (its label drawn apart): `aria-invalid` on its controls while `missing`. */
export function MissingFieldBox({ missing, children, ...rest }: { missing: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  useInvalidControls(ref, missing);
  return <div ref={ref} {...rest}>{children}</div>;
}
