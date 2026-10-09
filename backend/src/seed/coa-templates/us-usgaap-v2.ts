/**
 * US-USGAAP v2.0 — Detailed
 * US GAAP — United States
 * All v1.0 IT accounts + additional granular sub-accounts.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
1700;Computer Equipment;;Servers, workstations and network equipment (capitalized);1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1705;Network Equipment;;Routers, switches, firewalls and access points (capitalized);1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1710;Capitalized Software;;Capitalized software licences and development costs;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1715;Internally Developed Software;;Capitalized internal development costs;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
6700;Depreciation - IT Equipment;;Accumulated depreciation on IT hardware;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6710;Amortization - Software;;Accumulated amortization on capitalized software;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6720;Impairment of IT Assets;;Write-down of IT assets below carrying amount;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
7110;Software Licenses;;Perpetual and term license fees;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
7120;SaaS Subscriptions;;Cloud software subscriptions (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
7125;Open Source Support;;Commercial support contracts for open-source software;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
7130;Cloud Hosting & IaaS;;Dedicated servers, object storage, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
7135;Data & Analytics Platforms;;Monitoring, BI and data tools (Datadog, Snowflake);2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
7140;Cybersecurity Services;;Endpoint protection, IAM, vulnerability scanning;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
7150;Telecommunications;;WAN, LAN, internet and telephony;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
7155;Mobile Communications;;Corporate mobile plans and devices;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
7160;Internet & Data Services;;Broadband, fiber and leased line services;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
7210;IT Maintenance & Support;;Software and hardware maintenance contracts;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
7220;IT Consulting;;Strategy, architecture and security advisory;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
7225;Systems Integration;;ERP/CRM implementation and data migration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
7230;Software Development Services;;Application development and systems integration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
7235;IT Contractors & Freelancers;;External developers, engineers and project managers;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
7310;IT Salaries & Wages;;Gross compensation for IT employees;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
7315;IT Bonuses & Incentives;;Performance bonuses and variable compensation;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
7320;IT Benefits & Payroll Taxes;;Health insurance, 401(k), FICA and state taxes;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
7410;IT Training & Certifications;;Training programs and professional certifications;2600;Training & Certification;Staff training and certifications;enabled;opex
7415;IT Conferences & Events;;Tech conferences, summits and industry events;2600;Training & Certification;Staff training and certifications;enabled;opex
7420;Workplace IT Equipment;;End-user devices and peripherals below capitalization threshold;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
7425;Printing & Scanning;;Printers, scanners and consumables;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
7430;IT Travel & Conferences;;Project-related travel and conference attendance;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
7440;Other IT Expenses;;Sundry IT operating costs;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
7445;IT Insurance;;Cyber insurance and equipment insurance;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
