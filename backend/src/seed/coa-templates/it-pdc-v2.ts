/**
 * IT-PDC v2.0 — Detailed
 * Piano dei Conti — Italy
 * All v1.0 IT accounts + additional granular sub-accounts.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
1050;Capitalized Software;Software e licenze;Software attivato e diritti di utilizzo;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1051;Purchased Software;Software acquistato;Licenze software attivate (ERP, CRM);1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1052;Internally Developed Software;Software sviluppato internamente;Costi di sviluppo attivati;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
1100;IT Equipment;Attrezzature informatiche;Server, postazioni di lavoro e apparati di rete;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
1101;Network Equipment;Apparati di rete;Router, switch, firewall e access point;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
6800;Depreciation - IT Equipment;Ammortamento attrezzature;Ammortamento delle attrezzature informatiche;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6810;Depreciation - Software;Ammortamento software;Ammortamento del software attivato;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6820;Impairment of IT Assets;Svalutazione immobilizzazioni IT;Svalutazione di immobilizzazioni informatiche;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
6501;Software Licenses;Licenze software;Licenze perpetue e a termine;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6502;SaaS Subscriptions;Abbonamenti SaaS;Abbonamenti software cloud (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6507;Open Source Support;Supporto open source;Contratti di supporto per software open source;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6503;Cloud Hosting;Hosting cloud e IaaS;Server dedicati, archiviazione oggetti, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6504;Cybersecurity Tools;Strumenti di cybersecurity;Protezione endpoint, IAM, scansione vulnerabilita;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6508;Data & Analytics Platforms;Piattaforme dati e analytics;Monitoraggio, BI e strumenti dati;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6505;Telecommunications;Telecomunicazioni;WAN, LAN, internet e telefonia;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6506;Internet & Data Lines;Internet e linee dati;Banda larga, fibra e linee dedicate;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6509;Mobile Communications;Comunicazioni mobili;Piani mobili aziendali e dispositivi;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6510;IT Maintenance;Manutenzione IT;Contratti di manutenzione software e hardware;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
6515;IT Consulting;Consulenza IT;Consulenza strategica, architetturale e di sicurezza;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6516;Software Development Services;Sviluppo software esterno;Sviluppo applicazioni e integrazione sistemi;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6517;Systems Integration;Integrazione di sistemi;Implementazione ERP/CRM e migrazione dati;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6520;IT Training;Formazione IT;Programmi di formazione e certificazioni professionali;2600;Training & Certification;Staff training and certifications;enabled;opex
6521;IT Conferences;Conferenze IT;Congressi, fiere e eventi tecnologici;2600;Training & Certification;Staff training and certifications;enabled;opex
6525;Workplace IT Equipment;Attrezzature IT non capitalizzate;Periferiche e dispositivi sotto soglia di capitalizzazione;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
6530;IT Travel;Viaggi e trasferte IT;Trasferte per progetti, conferenze e fiere IT;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
6540;Other IT Expenses;Altri costi IT;Spese informatiche diverse;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
6541;IT Insurance;Assicurazione IT;Cyber-assicurazione e assicurazione attrezzature;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
6600;IT Salaries;Retribuzioni personale IT;Stipendi lordi del personale informatico;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6601;IT Bonuses;Premi personale IT;Premi di rendimento e retribuzione variabile;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6610;IT Social Charges;Oneri sociali IT;Contributi previdenziali e assistenziali IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
`;
