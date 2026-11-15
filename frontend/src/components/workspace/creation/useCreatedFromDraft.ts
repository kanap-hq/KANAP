import React from 'react';
import { creationKey, getCreation, subscribeCreations } from './creationStore';

/**
 * True on the page of a record that a draft (`useDraftCreation`) has just created and that is still
 * being created. The draft's page uses it in the key of its editor, so that the editor stays the
 * same from the draft (`/new`) to the record: what the person typed meanwhile and the field they are
 * in are kept, where a new key would mount the page again. `recordId` is the address's: the uuid,
 * or the reference the draft gave with the record (`DraftCreated.reference`).
 */
export default function useCreatedFromDraft(family: string, recordId: string): boolean {
  const key = recordId && recordId !== 'new' ? creationKey(family, recordId) : null;
  return React.useSyncExternalStore(
    subscribeCreations,
    () => !!key && !!getCreation(key),
    () => false,
  );
}
