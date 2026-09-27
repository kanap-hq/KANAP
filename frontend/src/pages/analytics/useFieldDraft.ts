import React from 'react';

/**
 * The text of an autosaved field. It follows the stored value, except while the field has focus:
 * a save that lands while the user types again must not replace what they typed.
 */
export function useFieldDraft(value: string) {
  const [draft, setDraft] = React.useState(value);
  const focusedRef = React.useRef(false);
  React.useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);
  const onFocus = React.useCallback(() => { focusedRef.current = true; }, []);
  const onBlur = React.useCallback(() => { focusedRef.current = false; }, []);
  return { draft, setDraft, onFocus, onBlur };
}
