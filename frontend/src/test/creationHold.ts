import { act, fireEvent } from '@testing-library/react';

/**
 * The person puts the cursor in a field: the press, the focus it gives, the release. While a record
 * is written only such a move takes the cursor from the waiting field (`creationFieldFocus`); a
 * bare `focus()` is the page's own, which the waiting field takes back.
 */
export function pressInto(field: HTMLElement): void {
  fireEvent.pointerDown(field);
  act(() => field.focus());
  fireEvent.pointerUp(field);
}

/**
 * The selector of a page's own field in a query by label: while a record is written, the waiting
 * field bears the name of the description it waits for.
 */
export const PAGE_FIELD = ':not([data-creation-hold])';
