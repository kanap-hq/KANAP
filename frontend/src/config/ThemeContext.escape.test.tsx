import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button, Dialog, DialogActions, DialogContent } from '@mui/material';
import { useBlurPointerOpenedTriggerOnEscape } from './ThemeContext';

function Harness() {
  useBlurPointerOpenedTriggerOnEscape();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog open={open} onClose={() => setOpen(false)} transitionDuration={0}>
        <DialogContent>Body</DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

describe('useBlurPointerOpenedTriggerOnEscape', () => {
  it('gives focus back to the button that opened a dialog closed with Escape', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    fireEvent.pointerDown(trigger);
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.activeElement).toBe(trigger);
  });
});
