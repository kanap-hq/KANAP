import { BudgetFileFailure, OLD_LAYOUT_SENTENCE } from './budgetFile';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const K = 'operations.budgetFile.';

/** A server sentence the dialog has in the screen language, or the sentence as the server wrote it. */
export function serverSentence(text: string, t: Translate): string {
  if (text === OLD_LAYOUT_SENTENCE) return t(`${K}oldLayout`);
  return text;
}

/** The sentence a dialog shows for a failed export, check or load. Never raw error text. */
export function failureText(failure: BudgetFileFailure, t: Translate, action: 'export' | 'check' | 'load'): string {
  switch (failure.kind) {
    case 'running':
      return t(`${K}running`);
    case 'busy':
      return failure.seconds ? t(`${K}busyAfter`, { count: failure.seconds }) : t(`${K}busy`);
    case 'tooLarge':
      return t(`${K}tooLarge`);
    case 'stale':
      return t(`${K}stale`);
    case 'forbidden':
      return t(`${K}forbidden`);
    case 'message':
      return serverSentence(failure.text, t);
    default:
      return t(`${K}${action}Failed`);
  }
}
