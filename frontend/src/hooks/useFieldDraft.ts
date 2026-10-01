import React from 'react';

/**
 * The text of an autosaved field. It follows the stored value, except while the user is editing
 * it (focused and changed since focus): a save that lands while the user types again must not
 * replace what they typed. A stored change that lands while the field only has focus (a value
 * the server normalised, for example) still shows.
 */
export function useFieldDraft(value: string) {
  const [draft, setDraftState] = React.useState(value);
  const focusedRef = React.useRef(false);
  const dirtyRef = React.useRef(false);
  React.useEffect(() => {
    if (!(focusedRef.current && dirtyRef.current)) setDraftState(value);
  }, [value]);
  const setDraft = React.useCallback((next: string) => {
    if (focusedRef.current) dirtyRef.current = true;
    setDraftState(next);
  }, []);
  const onFocus = React.useCallback(() => {
    focusedRef.current = true;
    dirtyRef.current = false;
  }, []);
  const onBlur = React.useCallback(() => {
    focusedRef.current = false;
    dirtyRef.current = false;
  }, []);
  return { draft, setDraft, onFocus, onBlur };
}
