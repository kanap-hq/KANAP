/**
 * US-USGAAP v1.0 — Simple (IT-focused)
 * US GAAP — United States
 * ~20 IT-focused accounts using standard US 4-digit numbering.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
1700;Computer Equipment;;Servers, workstations and network equipment (capitalized);1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1710;Capitalized Software;;Capitalized software licences and development costs;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
6700;Depreciation - IT Equipment;;Accumulated depreciation on IT hardware;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6710;Amortization - Software;;Accumulated amortization on capitalized software;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6720;Impairment of IT Assets;;Write-down of IT assets below carrying amount;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
7110;Software Licenses;;Perpetual and term license fees;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
7120;SaaS Subscriptions;;Cloud software subscriptions (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
7130;Cloud Hosting & IaaS;;Dedicated servers, object storage, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
7140;Cybersecurity Services;;Endpoint protection, IAM, vulnerability scanning;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
7150;Telecommunications;;WAN, LAN, internet and telephony;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
7160;Internet & Data Services;;Broadband, fiber and leased line services;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
7210;IT Maintenance & Support;;Software and hardware maintenance contracts;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
7220;IT Consulting;;Strategy, architecture and security advisory;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
7230;Software Development Services;;Application development and systems integration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
7310;IT Salaries & Wages;;Gross compensation for IT employees;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
7320;IT Benefits & Payroll Taxes;;Health insurance, 401(k), FICA and state taxes;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
7410;IT Training & Certifications;;Training programs and professional certifications;2600;Training & Certification;Staff training and certifications;enabled;opex
7420;Workplace IT Equipment;;End-user devices and peripherals below capitalization threshold;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
7430;IT Travel & Conferences;;Project-related travel and conference attendance;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
7440;Other IT Expenses;;Sundry IT operating costs;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
