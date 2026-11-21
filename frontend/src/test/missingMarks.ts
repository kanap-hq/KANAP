/**
 * The labels a check marked missing (`FieldLabel` `missing`), in screen order: the text each one
 * names, without its required mark.
 */
export function markedLabels(): Array<string | null> {
  return Array.from(document.querySelectorAll<HTMLElement>('.kanap-field-label[data-missing]'))
    .map((label) => label.childNodes[0]?.textContent ?? null);
}
