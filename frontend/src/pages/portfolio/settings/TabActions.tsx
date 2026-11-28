import { createContext, forwardRef, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@mui/material';

const SlotContext = createContext<HTMLElement | null>(null);

/** Gives the open tab the place of its buttons (the element of `TabActionsSlot`). */
export const TabActionsProvider = SlotContext.Provider;

/**
 * Where the open tab's buttons go: the page renders it at the right of its title. It draws
 * nothing of its own, so the buttons sit in the title row as if placed there.
 */
export const TabActionsSlot = forwardRef<HTMLDivElement>(function TabActionsSlot(_, ref) {
  return <Box ref={ref} sx={{ display: 'contents' }} />;
});

/**
 * The buttons of the open tab, shown in the page's title row. They leave with the tab, so the row
 * is empty after a change of tab until the new one declares its own.
 */
export default function TabActions({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  return slot ? createPortal(children, slot) : null;
}
