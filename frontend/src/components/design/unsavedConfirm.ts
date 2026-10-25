import type { KanapConfirmOptions } from './KanapDialogProvider';

/**
 * One pair of labels per outcome the caller already implements.
 * Confirm runs the named action. Cancel runs the other one: it does not stay
 * unless that is what the caller's false branch does.
 */
export type UnsavedConfirmKind = 'saveAndLeave' | 'leaveWithoutSaving' | 'saveAndSwitch' | 'saveAndContinue';

export function unsavedConfirm(t: (key: string) => string, kind: UnsavedConfirmKind): KanapConfirmOptions {
  switch (kind) {
    case 'saveAndLeave':
      return {
        message: t('common:unsaved.saveAndLeave.message'),
        confirmLabel: t('common:unsaved.saveAndLeave.confirm'),
        cancelLabel: t('common:unsaved.saveAndLeave.cancel'),
      };
    case 'leaveWithoutSaving':
      return {
        message: t('common:unsaved.leaveWithoutSaving.message'),
        confirmLabel: t('common:unsaved.leaveWithoutSaving.confirm'),
        cancelLabel: t('common:unsaved.leaveWithoutSaving.cancel'),
        intent: 'danger',
      };
    case 'saveAndSwitch':
      return {
        message: t('common:unsaved.saveAndSwitch.message'),
        confirmLabel: t('common:unsaved.saveAndSwitch.confirm'),
        cancelLabel: t('common:unsaved.saveAndSwitch.cancel'),
      };
    case 'saveAndContinue':
      return {
        message: t('common:unsaved.saveAndContinue.message'),
        confirmLabel: t('common:unsaved.saveAndContinue.confirm'),
        cancelLabel: t('common:unsaved.saveAndContinue.cancel'),
      };
  }
}
