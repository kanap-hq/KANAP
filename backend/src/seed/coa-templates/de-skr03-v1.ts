/**
 * DE-SKR03 v1.0 — Simple (IT-focused)
 * Standardkontenrahmen 03 — Germany
 * ~21 IT-focused accounts using standard SKR03 numbering.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
27;Capitalized Software;EDV-Software;Aktivierte Software und Nutzungsrechte;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
420;IT Equipment;Bueromaschinen und EDV-Anlagen;Server, Arbeitsplaetze und Netzwerkausruestung;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
4822;Depreciation - IT Equipment;Abschr. Sachanlagen;Abschreibungen auf IT-Hardware;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
4830;Depreciation - Software;Abschr. immat. Vermoegensgegenstaende;Abschreibungen auf aktivierte Software;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
4840;Impairment of IT Assets;Ausserplanm. Abschreibungen;Ausserplanmaessige Wertminderungen IT;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
4120;IT Salaries;IT-Gehaelter;Bruttogehaelter IT-Personal;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
4130;IT Social Charges;Sozialabgaben IT;Gesetzliche Sozialabgaben IT-Personal;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
4670;IT Travel;IT-Reisekosten;Dienstreisen fuer IT-Projekte;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
4940;Software Licenses;Softwarelizenzen;Perpetuelle und befristete Lizenzen;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
4941;SaaS Subscriptions;SaaS-Abonnements;Cloud-Softwareabonnements (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
4944;Cloud Hosting;Cloud-Hosting und IaaS;Dedizierte Server, Objektspeicher, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
4945;Cybersecurity Tools;Cybersecurity-Tools;Endpunktsicherheit, IAM, Schwachstellenscanner;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
4946;IT Training;IT-Schulung und Zertifizierung;Weiterbildung und Fachzertifikate IT;2600;Training & Certification;Staff training and certifications;enabled;opex
4950;Telecommunications;Telekommunikation;WAN, LAN, Internet und Telefonie;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
4952;Internet & Data Lines;Internetkosten;Breitband, Standleitungen und Datenanbindungen;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
4960;IT Maintenance;IT-Wartung und Support;Software- und Hardwarewartungsvertraege;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
4962;Hardware Maintenance;Hardware-Wartung;Herstellersupport und erweiterte Garantien;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
4970;IT Consulting;IT-Beratung;Strategie-, Architektur- und Sicherheitsberatung;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
4972;Software Development Services;Softwareentwicklung extern;Anwendungsentwicklung und Integration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
4980;Workplace IT;Arbeitsplatz-IT;Peripherie und Endgeraete unter Aktivierungsgrenze;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
4990;Other IT Expenses;Sonstige IT-Aufwendungen;Verschiedene IT-Betriebskosten;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
