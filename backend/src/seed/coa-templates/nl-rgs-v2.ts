/**
 * NL-RGS v2.0 — Detailed
 * Rekeningschema (RGS) — Netherlands
 * All v1.0 IT accounts + additional granular sub-accounts.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
1100;Capitalized Software;Software;Geactiveerde software en gebruiksrechten;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1110;Internally Developed Software;Zelf ontwikkelde software;Geactiveerde interne ontwikkelkosten;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1200;IT Equipment;Machines en installaties;Servers, werkplekken en netwerkapparatuur;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1210;Network Equipment;Netwerkapparatuur;Routers, switches, firewalls en access points;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
49100;Depreciation - IT Equipment;Afschrijving materiele activa;Afschrijving op IT-hardware;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
49200;Depreciation - Software;Afschrijving immateriele activa;Afschrijving op geactiveerde software;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
49300;Impairment of IT Assets;Bijzondere waardevermindering;Waardevermindering van IT-activa;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
40100;IT Salaries;IT-salarissen;Brutosalarissen IT-personeel;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
40110;IT Bonuses;IT-bonussen;Prestatiebonussen en variabele beloning IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
40200;IT Social Charges;Sociale lasten IT;Werkgeverslasten sociale verzekeringen IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
40210;IT Pension Contributions;Pensioenlasten IT;Werkgeverspensioenpremies IT-personeel;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
45100;Software Licenses;Softwarelicenties;Perpetuele en termijnlicenties;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
45200;SaaS Subscriptions;SaaS-abonnementen;Cloud-softwareabonnementen (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
45250;Open Source Support;Open-source-support;Commerciele supportcontracten voor open source;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
45300;Cloud Hosting;Cloudhosting en IaaS;Dedicated servers, objectopslag, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
45400;Cybersecurity Tools;Cyberbeveiligingstools;Endpointbeveiliging, IAM, kwetsbaarheidsscanning;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
45500;Data & Analytics Platforms;Data- en analyticsplatformen;Monitoring, BI en datatools;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
46100;Telecommunications;Telecommunicatie;WAN, LAN, internet en telefonie;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
46200;Internet & Data Lines;Internet en datalijnen;Breedband, glasvezel en huurlijnen;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
46250;Mobile Communications;Mobiele communicatie;Zakelijke mobiele abonnementen en apparaten;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
46300;IT Maintenance;IT-onderhoud en support;Software- en hardwareonderhoudscontracten;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
47100;IT Consulting;IT-advies;Strategie-, architectuur- en beveiligingsadvies;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
47200;Software Development Services;Softwareontwikkeling extern;Applicatieontwikkeling en systeemintegratie;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
47250;Systems Integration;Systeemintegratie;ERP/CRM-implementatie en datamigratie;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
48100;IT Training;IT-opleiding en certificering;Opleidingen en professionele certificeringen;2600;Training & Certification;Staff training and certifications;enabled;opex
48150;IT Conferences;IT-conferenties;Vakconferenties, beurzen en meetups;2600;Training & Certification;Staff training and certifications;enabled;opex
48200;Workplace IT Equipment;Werkplek-IT;Randapparatuur en apparaten onder activeringsdrempel;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
48300;IT Travel;IT-reizen en evenementen;Projectreizen, conferenties en beurzen;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
48400;Other IT Expenses;Overige IT-kosten;Diverse IT-bedrijfskosten;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
48410;IT Insurance;IT-verzekeringen;Cyberverzekering en apparatuurverzekering;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
