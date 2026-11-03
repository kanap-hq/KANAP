import React from 'react';

/**
 * The header title of a new record's draft (reference data and contracts, lot V2): the title stays
 * open for typing like the draft's other fields, light blue while empty, and keeps its name until
 * the record is created (`useDraftCreation`), and Tab goes on to the next field. `require()`
 * returns the typed name, or shows `requiredMessage` under the empty title and gives it the focus;
 * `refuse(message)` shows a refusal of the name (a name another record has) the same way, until
 * the person types.
 *
 * `shellProps` go to `PortfolioDetailWorkspaceShell`; `onCancel` is Escape on the empty title;
 * `onChange` follows each keystroke (a code proposed from the name); `onCommit` follows Enter and
 * the blur of a typed name (the draft may now be created). `fill(name)` puts a name in the title as
 * if typed (a calendar named after its country).
 */
export default function useCreationTitle({ requiredMessage, onCancel, onChange, onCommit }: {
  requiredMessage: string;
  onCancel: () => void;
  onChange?: (draft: string) => void;
  onCommit?: () => void;
}) {
  // The field never rests (its value stays empty), so what it shows is always the last draft.
  const draft = React.useRef('');
  const [error, setError] = React.useState<string | null>(null);
  const [focusRequest, setFocusRequest] = React.useState(0);
  const [seed, setSeed] = React.useState<{ value: string; n: number } | undefined>(undefined);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = React.useRef(onCommit);
  onCommitRef.current = onCommit;

  const refuse = React.useCallback((message: string) => {
    setError(message);
    setFocusRequest((n) => n + 1);
  }, []);

  const require = React.useCallback((): string | null => {
    const current = draft.current.trim();
    if (current) return current;
    refuse(requiredMessage);
    return null;
  }, [refuse, requiredMessage]);

  const onTitleDraftChange = React.useCallback((next: string) => {
    draft.current = next;
    setError(null);
    onChangeRef.current?.(next);
  }, []);

  const fill = React.useCallback((next: string) => {
    draft.current = next;
    setSeed((prev) => ({ value: next, n: (prev?.n ?? 0) + 1 }));
  }, []);

  const onTitleSave = React.useCallback(() => {
    onCommitRef.current?.();
  }, []);

  /** The name typed so far, untrimmed. */
  const current = React.useCallback(() => draft.current, []);

  return {
    require,
    refuse,
    fill,
    current,
    shellProps: {
      title: '',
      canEditTitle: true,
      titleAutoEdit: true,
      onTitleDraftChange,
      onTitleSave,
      titleOnCancel: onCancel,
      titleError: error,
      titleFocusRequest: focusRequest,
      titleDraftSeed: seed,
    },
  };
}
