import React from 'react';

/**
 * "Create" on the new page of a record created at its title (`CreationActions`). The title is the
 * only field: a click with a title typed lets the title's commit (its blur) create the record, then
 * closes it instead of opening it; with an empty title, the title shows `requiredMessage` and gets
 * the focus. A refusal already under the title stays, and the title gets the focus.
 *
 * The page calls `titleSent()` when the title commits, and `titleSettled()` once the create has
 * answered: true when Create was clicked meanwhile, so the page closes the new record (kept, as an
 * ordinary record) instead of opening it.
 */
export default function useNewRecordCreate({ setTitleError, requiredMessage }: {
  setTitleError: (message: string | null) => void;
  requiredMessage: string;
}) {
  const sent = React.useRef(false);
  const finishAfter = React.useRef(false);
  const [focusRequest, setFocusRequest] = React.useState(0);

  const titleSent = React.useCallback(() => {
    sent.current = true;
  }, []);

  const titleSettled = React.useCallback((): boolean => {
    const finish = sent.current && finishAfter.current;
    sent.current = false;
    finishAfter.current = false;
    return finish;
  }, []);

  const create = React.useCallback((currentError?: string | null) => {
    if (sent.current) {
      finishAfter.current = true;
      return;
    }
    if (!currentError) setTitleError(requiredMessage);
    setFocusRequest((n) => n + 1);
  }, [requiredMessage, setTitleError]);

  return { focusRequest, titleSent, titleSettled, create };
}
