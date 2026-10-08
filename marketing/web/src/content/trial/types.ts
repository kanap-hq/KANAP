/** Trial funnel page content shape (shared across 5 pages). */

export interface TrialPageCopy {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
}

export interface TrialFormCopy extends TrialPageCopy {
  benefits: string[];
  form: {
    orgLabel: string;
    orgHelp: string;
    countryLabel: string;
    countryHelp: string;
    /** Shown in the country list when the typed text matches no country. */
    countryNoMatch: string;
    slugLabel: string;
    slugHelp: string;
    slugDomain: string;
    emailLabel: string;
    emailHelp: string;
    submitLabel: string;
    submitting: string;
    errorGeneric: string;
    errorRequired: string;
    errorEmail: string;
    errorSlug: string;
    captchaLabel: string;
    privacyNote: string;
  };
  countryOptions: { value: string; label: string }[];
}

export interface TrialCheckEmailCopy extends TrialPageCopy {
  whatNext: string;
  steps: string[];
  noEmailTitle: string;
  noEmailBody: string;
  resendLabel: string;
  restartLabel: string;
}

export interface TrialActivateCopy extends TrialPageCopy {
  progressIdle: string;
  progressValidating: string;
  progressCreating: string;
  progressRedirecting: string;
  successPrefix: string;
  redirectNote: string;
}

export interface TrialErrorCopy extends TrialPageCopy {
  body: string;
  restartLabel: string;
  contactLabel: string;
}

export interface TrialContent {
  start: TrialFormCopy;
  checkEmail: TrialCheckEmailCopy;
  activate: TrialActivateCopy;
  expired: TrialErrorCopy;
  failed: TrialErrorCopy;
}
