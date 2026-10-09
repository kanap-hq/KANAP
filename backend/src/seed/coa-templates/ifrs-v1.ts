/**
 * IFRS v1.0 — Simple (IT-focused)
 * 14 consolidation accounts, each self-referencing.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
1000;Tangible Assets (CAPEX);;Purchase of physical IT equipment — IAS 16;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1100;Intangible Assets (CAPEX);;Capitalized software and rights — IAS 38;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1200;Depreciation & Amortization;;Expense for PPE and intangibles — IAS 16/38;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
1300;Impairments & Write-offs;;Impairment of assets — IAS 36;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
2000;Software Licenses (OPEX);;Recurring licenses and subscriptions;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
2100;Cloud & Hosting Services;;IaaS/PaaS/SaaS usage and hosting;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
2200;Telecommunications & Network;;Internet, mobile, lines, VPN;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
2300;Maintenance & Support;;Software/hardware maintenance contracts;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
2400;IT Consulting & External Services;;Professional services, integration, contractors;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
2500;IT Staff Costs;;Salaries, benefits — IAS 19;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
2600;Training & Certification;;Staff training and certifications;2600;Training & Certification;Staff training and certifications;enabled;opex
2700;Workplace IT (Non-capitalized);;End-user devices/peripherals not capitalized;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
2800;Travel & Mobility (IT Projects);;Project-related travel costs;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
2900;Other IT Operating Expenses;;Miscellaneous IT OPEX;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
