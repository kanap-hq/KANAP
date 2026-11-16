import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * The key of a record page's editor, for a page keyed by its record (drafts and pending saves
 * belong to the record they were typed on). The address may name one record several ways: its uuid
 * or `sup-12`, which the page reads, then puts under its reference (`SUP-12`) and moves to. The key
 * stays the same through that move, so the editor stays mounted with what is typed; another record
 * gets a new key. `family` is the first part of the page's cache key (`['suppliers', address]`).
 */
export default function useRecordEditorKey(family: string, address: string): string {
  const queryClient = useQueryClient();
  const last = React.useRef<{ address: string; key: string } | null>(null);
  const previous = last.current;
  let key = address;
  if (previous && previous.address === address) key = previous.key;
  else if (previous) {
    const recordAt = (at: string) => queryClient.getQueryData<{ id?: string }>([family, at])?.id;
    const before = recordAt(previous.address);
    if (before && before === recordAt(address)) key = previous.key;
  }
  last.current = { address, key };
  return key;
}
