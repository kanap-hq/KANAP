# SAP Access Request Process

SAP S/4HANA access is role-based. Every request goes through ServiceNow under **IT > Access > SAP** — email requests to individual IT staff are kindly redirected there.

## Standard roles

| Role | Scope | Approver |
|---|---|---|
| SAP FI (Finance) | Journal entries, closing, reporting | Maria Casanova (Finance & Controlling) |
| SAP MM (Procurement) | Purchase orders, goods receipt | Head of Procurement |
| SAP SD (Sales) | Orders, deliveries, invoicing | Sales & Marketing lead |
| SAP PP (Production) | Production orders, batch records | Jacques Dubois (Production) |
| Display-only | Read access across modules | Line manager |

## Timeline

- Standard requests: **2 business days** after approval.
- **Expedited path**: for month-end close or an audit, the approver can mark the request *Urgent — financial close*. Urgent requests are provisioned **the same business day** when submitted before 15:00 CET.

## New hires

Submit the request **before the start date** — HR onboarding in Workday triggers the Okta account automatically, but SAP roles still need the ServiceNow request and approval. A new controller who must post entries on day one should have the request submitted the week before, with the *Urgent — financial close* flag if the start date falls in a close week.

## Segregation of duties

The system blocks combinations that violate SoD rules (e.g. creating suppliers *and* approving payments). If your request is rejected for SoD, Finance & Controlling arbitrates which role you keep. No exceptions — not even for cheese emergencies.
