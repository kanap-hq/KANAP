/**
 * GB-UKGAAP v1.0 — Simple (IT-focused)
 * UK GAAP — United Kingdom
 * ~20 IT-focused accounts using standard UK 4-digit numbering.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
500;Computer Equipment;;Servers, workstations and network equipment (capitalized);1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
510;Software & IT Rights;;Capitalized software licences and development costs;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
520;Depreciation - Computer Equipment;;Accumulated depreciation on IT hardware;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
530;Amortization - Software;;Accumulated amortization on capitalized software;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
540;Impairment of IT Assets;;Write-down of IT assets below carrying amount;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
6010;Software Licences;;Perpetual and term licence fees;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6020;SaaS Subscriptions;;Cloud software subscriptions (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6030;Cloud Hosting & IaaS;;Dedicated servers, object storage, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6040;Cybersecurity Services;;Endpoint protection, IAM, vulnerability scanning;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6050;Telecommunications;;WAN, LAN, internet and telephony;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6060;Internet & Data Lines;;Broadband, fibre and leased line services;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6070;IT Maintenance & Support;;Software and hardware maintenance contracts;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
6080;IT Consultancy Fees;;Strategy, architecture and security advisory;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6090;Outsourced Development;;Application development and systems integration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
7010;IT Staff Salaries;;Gross salaries for IT employees;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
7020;IT Staff National Insurance;;Employer NI contributions for IT staff;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
7030;IT Training & Development;;Training programmes and professional certifications;2600;Training & Certification;Staff training and certifications;enabled;opex
7040;Workplace IT Equipment;;End-user devices and peripherals below capitalisation threshold;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
7050;IT Travel & Subsistence;;Project-related travel and accommodation;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
7060;Other IT Expenses;;Sundry IT operating costs;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
