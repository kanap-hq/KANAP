import type { LegalContent } from './types';

/* Legal text is ported verbatim from the previous marketing site so the
 * redesign doesn't alter the legal meaning. Any update to these documents
 * should go through your usual legal review process.
 */

const content: LegalContent = {
  privacy: {
    meta: {
      title: 'Privacy policy',
      description: 'How KANAP collects, uses, and protects personal data under GDPR.',
    },
    header: {
      eyebrow: 'Legal',
      title: 'Privacy policy',
      lastUpdated: 'Last updated: 7 October 2026',
    },
    body: `
<h2>Preamble</h2>
<p>KANAP (hereinafter "KANAP"), an EURL (single-member limited liability company) registered with the RCS Saverne under number 939 098 190, whose registered office is located at 2, rue du Finhay, 67210 Obernai, France, attaches the highest importance to the protection of your personal data. This privacy policy (hereinafter the "Policy") aims to inform you in a clear and transparent manner about the processing of personal data implemented by KANAP in connection with the use of the online IT management platform "KANAP" (hereinafter "the Platform").</p>
<p>KANAP undertakes to comply with the General Data Protection Regulation (GDPR) and French Law No. 78-17 of January 6, 1978 relating to data processing, files, and freedoms, as amended.</p>

<h2>1. Data controller</h2>
<p>The data controller for personal data collected via the Platform is KANAP, an EURL (single-member limited liability company) registered with the RCS Saverne under number 939 098 190, whose registered office is located at 2, rue du Finhay, 67210 Obernai, France.</p>
<p>For data entered by customers into the Platform (budget data, financial information, user data within tenants), the customer organization acts as the data controller, and KANAP acts as the data processor.</p>

<h2>2. Personal data collected</h2>
<p>KANAP collects the following personal data from users of the Platform:</p>
<ul>
  <li><strong>Account information:</strong> First name, last name, email address, job title, organization name</li>
  <li><strong>Authentication data:</strong> Login credentials (passwords are hashed and never stored in plain text)</li>
  <li><strong>Usage data:</strong> Platform usage logs, session information, IP addresses</li>
  <li><strong>Financial data:</strong> Budget items, CAPEX/OPEX data, allocation information, contract details entered by users</li>
  <li><strong>Billing information:</strong> Company name, billing address, VAT number</li>
</ul>
<p>Payment information (credit card details) is not known to KANAP. It is processed directly by the secure payment platform (Stripe).</p>

<h2>3. Purposes of processing</h2>
<ul>
  <li><strong>Service provision:</strong> Data is necessary to provide access to the Platform, manage user accounts, and deliver the IT management service.</li>
  <li><strong>Service improvement:</strong> Usage data is used to improve the quality and functionality of the service, identify technical issues, and optimize performance.</li>
  <li><strong>Customer support:</strong> Data is used to respond to user inquiries, provide technical assistance, and resolve issues.</li>
  <li><strong>Billing and invoicing:</strong> Data is necessary to process subscriptions, issue invoices, and manage payments.</li>
  <li><strong>Security:</strong> Data is processed to ensure the security of the Platform, detect and prevent fraud, unauthorized access, and security incidents.</li>
  <li><strong>Legal compliance:</strong> Data is processed to comply with legal and regulatory obligations.</li>
</ul>

<h2>4. Legal basis for processing</h2>
<ul>
  <li><strong>Contract performance:</strong> Processing is necessary to provide the KANAP service (account management, Platform access, etc.).</li>
  <li><strong>Legitimate interest:</strong> Processing for service improvement, security, and fraud prevention is based on KANAP's legitimate interest in developing and providing a quality and secure service.</li>
  <li><strong>Legal obligation:</strong> Processing may be necessary to comply with legal obligations (accounting, tax, anti-money laundering, etc.).</li>
  <li><strong>Consent:</strong> For certain optional features or communications, processing may be based on the user's explicit consent.</li>
</ul>

<h2>5. Data recipients</h2>
<p>KANAP may share your personal data in the following cases:</p>
<ul>
  <li><strong>Service providers:</strong> KANAP may use service providers (hosting, infrastructure, payment processing, email services, etc.) who may have access to personal data in the course of their duties. These providers are bound by confidentiality and security obligations and act as data processors under KANAP's instructions.</li>
  <li><strong>Legal obligations:</strong> KANAP may be required to disclose personal data to administrative or judicial authorities when required by law.</li>
</ul>
<p>KANAP undertakes not to share users' personal data for commercial purposes other than those mentioned above. KANAP will never sell or rent your personal data to third parties.</p>
<p>The service providers (sub-processors) that process personal data on behalf of KANAP for the cloud service are:</p>
<ul>
  <li><strong>Hetzner Online GmbH</strong> (Germany): hosting of the servers, database and file storage.</li>
  <li><strong>Cloudflare</strong> (United States): network, CDN and TLS termination in front of the servers, with contractual safeguards for transfers outside the European Union.</li>
  <li><strong>Resend</strong> (transactional email, United States): account activation, password reset and notification emails.</li>
  <li><strong>Stripe</strong> (payments, Ireland and United States): payment processing and subscription billing.</li>
  <li><strong>AI model provider</strong> for the built-in AI features of the cloud service: AI features are off by default. The built-in model receives no data until the workspace has accepted its provider and where it processes data, both named in the application. An administrator of the workspace gives this confirmation, which covers the assistant, the agents and scheduled processing, and a new confirmation is asked if the provider or the location changes. Administrators can use their own model provider instead. The provider may process data outside the European Union.</li>
</ul>
<p>Customers who self-host KANAP choose their own providers, and KANAP does not process their data. Customers of the cloud service who connect their own AI model provider choose that provider, and KANAP does not send their data to its built-in model.</p>

<h2>6. Data retention period</h2>
<ul>
  <li>Account data and the data entered by customers into the Platform are retained for the duration of the contract. On termination, they are deleted at the customer's request.</li>
  <li>Billing and invoicing data is retained for 10 years in accordance with French accounting and tax regulations.</li>
  <li>Payment data is not retained by KANAP and is managed directly by the payment processor (Stripe).</li>
</ul>

<h2>7. Data security</h2>
<ul>
  <li>HTTPS for all connections to the Platform</li>
  <li>Encryption at rest of secrets and credentials stored by the Platform (AES-256-GCM)</li>
  <li>Role-based access control and authentication mechanisms</li>
  <li>Hosting in the European Union (Hetzner, Germany)</li>
  <li>Password hashing using industry-standard algorithms (Argon2id)</li>
  <li>Multi-tenant isolation using Row-Level Security (RLS) in the database</li>
  <li>Source code published under AGPL v3, and a private channel to report vulnerabilities</li>
</ul>

<h2>8. User rights</h2>
<p>In accordance with the GDPR, you have the following rights regarding your personal data:</p>
<ul>
  <li>Right of access</li>
  <li>Right to rectification</li>
  <li>Right to erasure</li>
  <li>Right to restriction of processing</li>
  <li>Right to object</li>
  <li>Right to data portability</li>
  <li>Right to withdraw consent</li>
</ul>
<p>To exercise your rights, you can contact KANAP at <a href="mailto:admin@kanap.net">admin@kanap.net</a>. You also have the right to lodge a complaint with the French Data Protection Authority (CNIL).</p>

<h2>9. International data transfers</h2>
<p>The Platform is hosted in the European Union, in Germany. Some providers listed in section 5 may process personal data outside the European Union, for example Cloudflare for network traffic. In that case, KANAP ensures that appropriate safeguards are in place (the EU-US Data Privacy Framework or standard contractual clauses).</p>

<h2>10. Cookies and tracking technologies</h2>
<p>The KANAP website sets no advertising or analytics cookies and shows no cookie banner. We measure audience with Cloudflare Web Analytics, which works without cookies and without storing anything on your device. The contact and trial forms use Cloudflare Turnstile, a security check that tells people from automated programs. The website remembers your light or dark theme choice in your browser, only when you pick one.</p>
<p>The application uses only the cookies needed to sign in and keep your session. It also stores interface preferences, such as your theme and table layout, in your browser. You can remove them at any time in your browser settings.</p>

<h2>11. Modifications to the policy</h2>
<p>KANAP reserves the right to modify this Policy at any time. Users will be notified of changes by any means, including a notification on the Platform or by email.</p>

<p class="mk-legal__foot">For any questions regarding this privacy policy, please contact <a href="mailto:admin@kanap.net">admin@kanap.net</a>.</p>
`,
  },

  terms: {
    meta: {
      title: 'Terms of use',
      description: 'Terms governing the use of the KANAP online IT management platform.',
    },
    header: {
      eyebrow: 'Legal',
      title: 'Terms of use',
      lastUpdated: 'Last updated: 7 October 2026',
    },
    body: `
<h2>Preamble</h2>
<p>These Terms of Use govern the access and use of the online IT management platform "KANAP" (hereinafter "the Platform" or "the Service") published by KANAP, an EURL (single-member limited liability company) registered with the RCS Saverne under number 939 098 190, whose registered office is located at 2, rue du Finhay, 67210 Obernai, France. Use of the Platform implies full acceptance of these Terms of Use.</p>

<h2>Article 1. Access to the platform and account creation</h2>
<p>1.1. Access to the Platform is reserved for users who have subscribed to a valid subscription, in accordance with the General Terms and Conditions of Sale (GTC) of KANAP.</p>
<p>1.2. To access the Platform, the user must create a personal account by providing accurate and complete information.</p>
<p>1.3. The user is responsible for maintaining the confidentiality of their login credentials. Any use of the account with these credentials is deemed to have been made by the user. In case of loss or theft, the user must immediately inform KANAP.</p>
<p>1.4. KANAP reserves the right to refuse access to the Platform or to suspend an account in case of violation of these Terms of Use or the GTC.</p>

<h2>Article 2. Use of the platform</h2>
<p>2.1. The Platform is made available for professional purposes. The user agrees to use it responsibly and in compliance with the law.</p>
<p>2.2. The user agrees not to: use the Platform for illegal purposes; attempt to access other users' data; publish inappropriate or defamatory content; share access with unauthorized third parties; use the Platform for commercial or advertising purposes other than its intended use; copy, reproduce, distribute, or modify the content without prior authorization.</p>
<p>2.3. KANAP reserves the right to modify, at any time, the features of the Platform.</p>

<h2>Article 3. User responsibility</h2>
<p>3.1. The user is solely responsible for their use of the Platform and the content they publish or share.</p>
<p>3.2. The user agrees not to harm the reputation of KANAP or the quality of its services.</p>
<p>3.3. The user is responsible for the security of their computer equipment and internet connection.</p>

<h2>Article 4. KANAP's responsibility and limitation</h2>
<p>4.1. KANAP undertakes to provide access to the Platform in accordance with the Service description.</p>
<p>4.2. KANAP does not guarantee the absence of errors or interruptions in the operation of the Platform.</p>
<p>4.3. KANAP cannot be held responsible for: the consequences of the user's use of the Platform; technical interruptions or malfunctions, internet connection issues, or force majeure events; the accuracy of data entered by the user or decisions made based on Platform reports.</p>
<p>4.4. KANAP's liability is in any event limited to the amount of the subscription paid by the user.</p>

<h2>Article 5. Confidentiality and data security</h2>
<p>5.1. KANAP undertakes to take all necessary technical and organizational measures to preserve the confidentiality of all information and data provided.</p>
<p>5.2. User data is stored on servers hosted in the European Union, with access control. Secrets and credentials stored by the Platform are encrypted at rest. KANAP implements industry-standard security practices.</p>
<p>5.3. KANAP employees and subcontractors who may have access to client data are bound by strict confidentiality obligations.</p>
<p>5.4. KANAP will not share, sell, or disclose client data to third parties, except with explicit consent, when required by law, or to trusted subcontractors under confidentiality agreements.</p>
<p>5.5. In the event of a data security incident, KANAP will notify affected clients within 72 hours.</p>

<h2>Article 6. Intellectual property</h2>
<p>6.1. The Platform and all its elements are the exclusive property of KANAP and are protected by copyright and trademark law.</p>
<p>6.2. The user acquires no intellectual property rights over the Platform.</p>
<p>6.3. Content created by the user remains the property of the user, but KANAP reserves the right to use aggregated and anonymized data for service improvement purposes.</p>

<h2>Article 7. Suspension or termination of account</h2>
<p>7.1. KANAP reserves the right to suspend or terminate a user's account in case of non-compliance with these Terms, abusive or fraudulent use, breach of the security, non-payment, or inappropriate behaviour.</p>
<p>7.2. In case of account termination, the user will lose access to the Platform and its content.</p>

<h2>Article 8. Personal data protection</h2>
<p>Personal data is processed in accordance with KANAP's privacy policy, available on the website.</p>

<h2>Article 9. Modifications to the terms of use</h2>
<p>KANAP reserves the right to modify these Terms of Use at any time. Continued use after modification implies acceptance.</p>

<h2>Article 10. Applicable law and disputes</h2>
<p>These Terms of Use are governed by French law. Any dispute will be subject to the exclusive jurisdiction of the French courts.</p>

<p class="mk-legal__foot">For any questions, please contact <a href="mailto:admin@kanap.net">admin@kanap.net</a>.</p>
`,
  },

  sales: {
    meta: {
      title: 'General terms and conditions of sale',
      description: 'Terms governing the purchase of KANAP subscriptions.',
    },
    header: {
      eyebrow: 'Legal',
      title: 'General terms and conditions of sale',
      lastUpdated: 'Last updated: 1 February 2026',
    },
    body: `
<h2>Article 1. Purpose</h2>
<p>These General Terms and Conditions of Sale (GTC) govern the sale by KANAP (hereinafter "the Vendor"), an EURL (single-member limited liability company) registered with the RCS Saverne under number 939 098 190, whose registered office is located at 2, rue du Finhay, 67210 Obernai, France, of subscriptions to the online IT management platform "KANAP".</p>

<h2>Article 2. Acceptance of the GTC</h2>
<p>Acceptance of these GTC is mandatory before any subscription and implies full acceptance by the Customer of these conditions.</p>

<h2>Article 3. Description of the service</h2>
<p>KANAP is an online IT management platform designed for technology leaders and IT departments. The specific features are those described on the website at the time of subscription.</p>

<h2>Article 4. Subscription and pricing</h2>
<p>4.1. Access to the Service is offered under the subscription offers described on the pricing page. Rates are indicated in euros (EUR) and are exclusive of taxes. Applicable VAT will be added to the invoice according to the customer's location and tax status.</p>
<p>4.2. Subscriptions include an unlimited number of users and workspaces. No per-user fee applies.</p>
<p>4.3. The rates applicable for subscriptions are displayed on the website at the time of subscription. Rates may be modified at any time, but such modifications will only apply to subscriptions entered into after the modification.</p>
<p>4.4. The customer will be informed in advance of any rate modification before the automatic renewal of their subscription.</p>
<p>4.5. Paying subscribers receive a 20% discount on consulting services. Consulting services and fixed-price service engagements are billed separately at rates displayed on the website.</p>

<h2>Article 5. Payment terms</h2>
<p>5.1. Payment is made by credit card via a secure payment platform (Stripe).</p>
<p>5.2. For monthly subscriptions, the first payment is made upon subscription; subsequent payments each month on the anniversary date.</p>
<p>5.3. For annual subscriptions, payment is made in full at the time of subscription.</p>
<p>5.4. For invoiced customers (annual plans only), payment terms are NET 30 days. In case of late payment, access to the Service may be suspended.</p>
<p>5.5. In case of payment refusal or failure, the Customer is notified and access may be suspended.</p>
<p>5.6. An invoice is issued for each payment and made available in the account area or sent by email.</p>

<h2>Article 6. Subscription duration and renewal</h2>
<p>6.1. <strong>Monthly subscription:</strong> entered into for one month, automatically renewable by tacit renewal. The Customer may cancel at any time from the account area, with 48h notice before renewal. Cancellation takes effect at the end of the current month.</p>
<p>6.2. <strong>Annual subscription:</strong> entered into for one year, automatically renewable by tacit renewal unless cancelled. The customer is notified by email 30 days before renewal. Cancellation requires 30 days' notice before the anniversary date. Annual subscription does not entitle to a refund in case of early cancellation.</p>
<p>6.3. <strong>Subscription changes:</strong> Customers may switch from monthly to annual billing at any time (prorated difference charged immediately) or from annual to monthly at the end of the current billing period. Customers may switch between cloud and self-hosted deployment at any time by contacting support.</p>

<h2>Article 7. Right of withdrawal</h2>
<p>7.1. Since KANAP is a B2B service, the legal right of withdrawal applicable to consumers does not apply.</p>
<p>7.2. For customers who qualify as consumers (micro-enterprises, sole proprietorships), a 14-day right of withdrawal may apply. To exercise, send clear notification to <a href="mailto:admin@kanap.net">admin@kanap.net</a> before the expiration of the 14-day period.</p>

<h2>Article 8. Warranty and liability</h2>
<p>8.1. The Vendor undertakes to provide a Service in accordance with its description.</p>
<p>8.2. The Vendor cannot be held liable for interruptions or malfunctions, the accuracy of data entered by the customer, or indirect or consequential damages.</p>
<p>8.3. The Vendor's liability is limited to the amount of the subscription paid by the Customer over the preceding 12 months.</p>

<h2>Article 9. Intellectual property</h2>
<p>The KANAP platform is the exclusive property of the Vendor. The Customer acquires no intellectual property rights over the Platform.</p>

<h2>Article 10. Personal data</h2>
<p>Personal data is processed in accordance with the Vendor's privacy policy.</p>

<h2>Article 11. Disputes and applicable law</h2>
<p>11.1. These GTC are governed by French law. All disputes shall be subject to the exclusive jurisdiction of the French courts.</p>
<p>11.2. In the event of a dispute, the parties agree to seek an amicable resolution before initiating any legal proceedings.</p>

<p class="mk-legal__foot">For any questions, please contact <a href="mailto:admin@kanap.net">admin@kanap.net</a>.</p>
`,
  },

  legal: {
    meta: {
      title: 'Legal notice',
      description: 'Publisher, hosting, and legal jurisdiction information for kanap.net.',
    },
    header: {
      eyebrow: 'Legal',
      title: 'Legal notice',
      lastUpdated: 'Last updated: 7 October 2026',
    },
    body: `
<h2>Site publisher</h2>
<p><strong>KANAP</strong><br/>
EURL registered with the RCS Saverne under number 939 098 190<br/>
Share capital: €1,000<br/>
Registered office: 2, rue du Finhay – 67210 Obernai – France</p>

<h2>Contact</h2>
<p>Email: <a href="mailto:admin@kanap.net">admin@kanap.net</a></p>

<h2>Hosting</h2>
<p>The website kanap.net is hosted by Hetzner Online GmbH, whose registered office is located at:</p>
<p>Hetzner Online GmbH<br/>
Industriestr. 25 – 91710 Gunzenhausen – Germany</p>
<p>The servers are located in Nuremberg, Germany. Traffic to the website passes through Cloudflare, which provides the content delivery network and TLS protection.</p>

<h2>Applicable law and jurisdiction</h2>
<p>This website is governed by French law. In the event of a dispute relating to the use of the kanap.net website and in the absence of an amicable agreement between the parties concerned, the French courts shall have sole jurisdiction.</p>
`,
  },
};

export default content;
