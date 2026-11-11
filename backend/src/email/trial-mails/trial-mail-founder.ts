import { PRODUCT_NAME } from '../../config/product';

/** Friedrich, who signs the trial e-mails, sends J+5 and gets the replies of the others. */
export const DEFAULT_TRIAL_MAIL_FOUNDER_ADDRESS = 'fried@kanap.net';

// One plain address: nothing that could add a recipient or a header line.
const PLAIN_ADDRESS = /^[^\s<>",;()[\]\\]+@[^\s<>",;()[\]\\]+\.[^\s<>",;()[\]\\]+$/;

/**
 * The address the trial e-mails use for the founder: `TRIAL_MAIL_FOUNDER_ADDRESS`, or the address in
 * service at the switch to Kadratis when it is unset, blank or not a plain address.
 */
export function trialMailFounderAddress(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.TRIAL_MAIL_FOUNDER_ADDRESS ?? '').trim();
  return PLAIN_ADDRESS.test(configured) ? configured : DEFAULT_TRIAL_MAIL_FOUNDER_ADDRESS;
}

/** The founder as the `From` or `Reply-To` header of a trial e-mail. */
export function trialMailFounder(env: Record<string, string | undefined> = process.env): string {
  return `"Friedrich (${PRODUCT_NAME})" <${trialMailFounderAddress(env)}>`;
}
