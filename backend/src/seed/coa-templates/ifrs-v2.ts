/**
 * IFRS v2.0 — Detailed
 * 14 core consolidation accounts + structural sub-categories.
 * Sub-accounts consolidate to their parent; parent accounts self-reference.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
1000;Tangible Assets (CAPEX);;Purchase of physical IT equipment — IAS 16;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1010;Servers & Data Center Hardware;;Physical servers, storage arrays, racks;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1020;Networking Equipment;;Routers, switches, firewalls, access points;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1030;End-user Computing Devices;;Laptops, desktops, monitors (capitalized);1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1100;Intangible Assets (CAPEX);;Capitalized software and rights — IAS 38;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1110;Internally Developed Software;;Capitalized development costs for internal tools;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1120;Purchased Software Rights;;ERP, CRM and major platform licenses (capitalized);1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1130;Technology Patents & IP;;Acquired patents, trademarks and IP;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1200;Depreciation & Amortization;;Expense for PPE and intangibles — IAS 16/38;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
1210;Depreciation of Tangible IT Assets;;Straight-line depreciation of hardware;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
1220;Amortization of Intangible IT Assets;;Amortization of capitalized software and rights;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
1300;Impairments & Write-offs;;Impairment of assets — IAS 36;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
1310;Impairment of Tangible IT Assets;;Write-down of hardware below carrying amount;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
1320;Impairment of Intangible IT Assets;;Write-down of software below carrying amount;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
2000;Software Licenses (OPEX);;Recurring licenses and subscriptions;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
2010;Perpetual Licenses;;One-time license fees expensed;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
2020;SaaS Subscriptions;;Monthly/annual cloud software subscriptions;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
2030;Open Source Support Contracts;;Commercial support for open-source software;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
2100;Cloud & Hosting Services;;IaaS/PaaS/SaaS usage and hosting;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
2110;IaaS Services;;Virtual machines, compute, storage (AWS, Azure, GCP);2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
2120;PaaS Services;;Managed databases, serverless, container platforms;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
2130;Managed Hosting;;Dedicated and co-located hosting services;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
2200;Telecommunications & Network;;Internet, mobile, lines, VPN;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
2210;Internet Connectivity;;Broadband, fibre and leased lines;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
2220;Mobile Communications;;Corporate mobile plans and devices;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
2230;Fixed-line Telephony;;PBX, VoIP and landline services;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
2240;VPN & SD-WAN Services;;Secure connectivity and WAN optimization;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
2300;Maintenance & Support;;Software/hardware maintenance contracts;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
2310;Hardware Maintenance Contracts;;Vendor support and extended warranties;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
2320;Software Maintenance & Updates;;Annual maintenance fees and update subscriptions;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
2400;IT Consulting & External Services;;Professional services, integration, contractors;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
2410;IT Strategy Consulting;;Advisory on IT roadmap, architecture, governance;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
2420;Systems Integration Services;;ERP/CRM implementation, data migration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
2430;Contractors & Freelancers;;External developers, engineers, project managers;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
2500;IT Staff Costs;;Salaries, benefits — IAS 19;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
2510;IT Salaries & Wages;;Base compensation for IT employees;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
2520;IT Benefits & Social Charges;;Health insurance, pension, social contributions;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
2530;IT Bonuses & Incentives;;Performance bonuses and variable pay;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
2600;Training & Certification;;Staff training and certifications;2600;Training & Certification;Staff training and certifications;enabled;opex
2610;Technical Training Programs;;Courses, workshops and e-learning;2600;Training & Certification;Staff training and certifications;enabled;opex
2620;Professional Certifications;;AWS, Azure, CISSP, PMP and similar;2600;Training & Certification;Staff training and certifications;enabled;opex
2630;Conference & Event Attendance;;Tech conferences, summits and meetups;2600;Training & Certification;Staff training and certifications;enabled;opex
2700;Workplace IT (Non-capitalized);;End-user devices/peripherals not capitalized;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
2710;End-user Devices;;Laptops, tablets, phones (below capitalization threshold);2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
2720;Peripherals & Accessories;;Keyboards, mice, docking stations, headsets;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
2730;Printing & Scanning Equipment;;Printers, scanners and consumables;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
2800;Travel & Mobility (IT Projects);;Project-related travel costs;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
2810;Domestic Travel;;Local and national IT project travel;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
2820;International Travel;;Cross-border IT project travel;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
2900;Other IT Operating Expenses;;Miscellaneous IT OPEX;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
2910;IT Insurance;;Cyber insurance, equipment insurance;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
2920;IT Subscriptions & Memberships;;Industry memberships, research subscriptions;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
2930;Miscellaneous IT Costs;;Sundry IT operating expenses;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
