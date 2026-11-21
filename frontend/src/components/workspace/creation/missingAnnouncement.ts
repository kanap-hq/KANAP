import React from 'react';
import { useTranslation } from 'react-i18next';
import { missingFieldsList } from './missingFieldsList';

const EVENT = 'kanap:creation-fields-marked';

/** A check has just marked fields missing (`useMissingMarks`): the page's announcement says which. */
export function notifyFieldsMarked(): void {
  window.dispatchEvent(new Event(EVENT));
}

/** The name a missing label shows, without its required mark and its alert icon. */
function labelText(label: HTMLElement): string {
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-required-mark], [data-missing-mark]').forEach((node) => node.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The labels now marked missing under `scope`, in screen order. */
function markedLabelTexts(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-missing]')).map(labelText).filter(Boolean);
}

/**
 * The sentence a screen reader hears when a check marks fields missing ("Missing: account, paying
 * company"): once per check, never again on a later render. The marks come on screen a few renders
 * after the check (a panel or a tab opens), so the list is read once it stops changing. The text
 * is emptied first, so the same words said again are announced again. `anchor` is an element of the
 * record's page; the labels are read from the whole page, in screen order.
 */
export default function useMissingAnnouncement(anchor: React.RefObject<Element | null>): string {
  const { t, i18n } = useTranslation(['common']);
  const [text, setText] = React.useState('');
  const latest = React.useRef({ t, language: i18n.resolvedLanguage || i18n.language });
  latest.current = { t, language: i18n.resolvedLanguage || i18n.language };

  React.useEffect(() => {
    let timer: number | undefined;
    const onMarked = () => {
      window.clearTimeout(timer);
      setText('');
      const scope: ParentNode = anchor.current?.closest('[data-workspace-shell]') ?? document;
      let previous = '';
      let tries = 0;
      const attempt = () => {
        const labels = markedLabelTexts(scope);
        const key = labels.join('\n');
        tries += 1;
        if (labels.length > 0 && (key === previous || tries >= 20)) {
          setText(latest.current.t('common:creation.missingFields', { fields: missingFieldsList(labels, latest.current.language) }));
          return;
        }
        previous = key;
        if (tries < 20) timer = window.setTimeout(attempt, 25);
      };
      timer = window.setTimeout(attempt, 25);
    };
    window.addEventListener(EVENT, onMarked);
    return () => {
      window.removeEventListener(EVENT, onMarked);
      window.clearTimeout(timer);
    };
  }, [anchor]);

  return text;
}
