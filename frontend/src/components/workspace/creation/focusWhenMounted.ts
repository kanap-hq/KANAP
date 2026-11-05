/**
 * Focuses the field `find` returns once it is on screen: a panel that opens or a tab that changes
 * mounts it a few renders later. Gives up after half a second.
 */
export default function focusWhenMounted(find: () => HTMLElement | null | undefined): void {
  let tries = 0;
  const attempt = () => {
    const input = find();
    if (input) {
      input.focus();
      return;
    }
    tries += 1;
    if (tries < 20) window.setTimeout(attempt, 25);
  };
  window.setTimeout(attempt, 0);
}
