/**
 * CH-KMU v2.0 — Detailed
 * Kontenrahmen KMU — Switzerland
 * All v1.0 IT accounts + additional granular sub-accounts.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
1500;IT Equipment;Maschinen und Apparate;Server, Arbeitsplaetze und Netzwerkausruestung;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1510;Network Equipment;Netzwerkausruestung;Router, Switches, Firewalls und Access Points;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1520;Capitalized Software;Software;Aktivierte Software und Nutzungsrechte;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1521;Internally Developed Software;Selbst erstellte Software;Aktivierte Eigenentwicklungen;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
6800;Depreciation - IT Equipment;Abschreibungen Sachanlagen;Abschreibungen auf IT-Hardware;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6810;Depreciation - Software;Abschreibungen immaterielle Anlagen;Abschreibungen auf aktivierte Software;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6820;Impairment of IT Assets;Wertberichtigungen;Ausserplanmaessige Wertminderungen IT-Aktiva;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
4400;Software Licenses;Softwarelizenzen;Perpetuelle und befristete Lizenzen;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
4410;SaaS Subscriptions;SaaS-Abonnemente;Cloud-Softwareabonnementen (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
4415;Open Source Support;Open-Source-Support;Kommerzielle Supportvertraege fuer Open Source;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
4420;Cloud Hosting;Cloud-Hosting und IaaS;Dedizierte Server, Objektspeicher, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
4430;Cybersecurity Tools;Cybersecurity-Tools;Endpunktsicherheit, IAM, Schwachstellenscanner;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
4435;Data & Analytics Platforms;Datenplattformen und Analytics;Monitoring, BI und Datentools;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
4440;Telecommunications;Telekommunikation;WAN, LAN, Internet und Telefonie;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
4450;Internet & Data Lines;Internet und Datenleitungen;Breitband, Glasfaser und Standleitungen;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
4455;Mobile Communications;Mobilfunk;Mobilfunkvertraege und Endgeraete;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
4460;IT Maintenance;IT-Wartung und Support;Software- und Hardwarewartungsvertraege;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
4470;IT Consulting;IT-Beratung;Strategie-, Architektur- und Sicherheitsberatung;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
4475;Systems Integration;Systemintegration;ERP/CRM-Einfuehrung und Datenmigration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
4480;Software Development Services;Softwareentwicklung extern;Anwendungsentwicklung und Systemintegration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
4485;IT Freelancers;Freiberufler IT;Externe Entwickler und Projektberater;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
5200;IT Salaries;IT-Loehne;Bruttoloehne IT-Personal;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
5210;IT Bonuses;IT-Praemien;Leistungspraemien und variable Verguetung IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
5700;IT Social Charges;Sozialversicherungen IT;AHV, BVG und Unfallversicherung IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6500;IT Training;IT-Schulung und Zertifizierung;Weiterbildung und Fachzertifikate IT;2600;Training & Certification;Staff training and certifications;enabled;opex
6505;IT Conferences;IT-Konferenzen;Fachkonferenzen, Messen und Meetups;2600;Training & Certification;Staff training and certifications;enabled;opex
6510;Workplace IT Equipment;Arbeitsplatz-IT;Peripherie und Endgeraete unter Aktivierungsgrenze;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
6520;IT Travel;IT-Reisekosten;Dienstreisen fuer IT-Projekte und Konferenzen;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
6900;Other IT Expenses;Sonstige IT-Kosten;Verschiedene IT-Betriebskosten;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
6910;IT Insurance;IT-Versicherungen;Cyberversicherung und Geraeteversicherung;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
