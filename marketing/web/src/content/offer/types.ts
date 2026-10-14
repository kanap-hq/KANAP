/** /offer page content shape. */

export interface OfferPlan {
  name: string;
  badge?: string;
  target: string;
  price: string;
  period?: string;
  subPrice?: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaVariant: 'primary' | 'ghost';
  note?: string;
  featured?: boolean;
}

export interface ChoiceEntry {
  title: string;
  body: string;
}

export interface ServiceCard {
  title: string;
  subtitle: string;
  body: string;
  items: string[];
}

/** The fixed-price "Guided pilot" card, third block of the services section. */
export interface PilotCard extends ServiceCard {
  ctaLabel: string;
  ctaHref: string;
  note: string;
}

export interface OfferContent {
  meta: {
    title: string;
    description: string;
  };
  header: {
    eyebrow: string;
    title: string;
    lead: string;
  };
  selfHosted: {
    eyebrow: string;
    title: string;
    intro: string;
    plans: OfferPlan[];
  };
  openSourceBanner: {
    title: string;
    body: string;
    linkLabel: string;
    linkHref: string;
  };
  cloud: {
    eyebrow: string;
    title: string;
    intro: string;
    plans: OfferPlan[];
  };
  howToChoose: {
    title: string;
    intro: string;
    items: ChoiceEntry[];
  };
  services: {
    title: string;
    intro: string;
    support: ServiceCard;
    consulting: ServiceCard;
  };
  pilot: PilotCard;
  supportInvoice: {
    title: string;
    eyebrow: string;
    body: string;
    companyLabel: string;
    contactLabel: string;
    billingEmailLabel: string;
    countryLabel: string;
    vatLabel: string;
    /** Shown under the VAT field when the country is in the European Union. */
    vatHelpEu: string;
    address1Label: string;
    address2Label: string;
    cityLabel: string;
    postalCodeLabel: string;
    /** Checkbox text before the link to the general terms of sale. */
    termsAccept: string;
    termsLink: string;
    captchaLabel: string;
    submitLabel: string;
    submittingLabel: string;
    successWithLink: string;
    successLinkLabel: string;
    successNoLink: string;
    errorGeneric: string;
    errorRequired: string;
    errorVatRequired: string;
    errorVatInvalid: string;
    errorTerms: string;
    closeLabel: string;
  };
  faqTeaser: {
    title: string;
    body: string;
    ctaLabel: string;
  };
  cta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
}
