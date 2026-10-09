/**
 * BE-PCMN v2.0 — Detailed
 * Plan Comptable Minimum Normalise — Belgium
 * All v1.0 IT accounts + additional granular sub-accounts.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
2410;Capitalized Software;Logiciels informatiques;Software et droits d'utilisation actives;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
2411;Purchased Software;Logiciels acquis;Licences logicielles activees (ERP, CRM);1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
2412;Internally Developed Software;Logiciels developpes en interne;Couts de developpement actives;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
2430;IT Equipment;Materiel informatique;Serveurs, postes de travail et equipements reseau;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
2431;Network Equipment;Materiel de reseau;Routeurs, commutateurs, pare-feu, points d'acces;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
6302;Depreciation - Intangible Assets;Amort. immobilisations incorporelles;Amortissement des logiciels actives;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6303;Depreciation - Tangible Assets;Amort. immobilisations corporelles;Amortissement du materiel informatique;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
6310;Impairment of IT Assets;Reductions de valeur actifs corporels;Perte de valeur sur immobilisations IT;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
6110;Software Licenses;Loyers et redevances logiciels;Licences perpetuelles et temporaires;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6111;SaaS Subscriptions;Abonnements SaaS;Abonnements logiciels cloud (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6121;Open Source Support;Support open source;Contrats de support pour logiciels open source;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6112;Cloud Hosting;Hebergement cloud et IaaS;Serveurs dedies, stockage objet, PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6113;Cybersecurity Tools;Outils de cybersecurite;Protection des endpoints, IAM, scanning;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6122;Data & Analytics Platforms;Plateformes donnees et analytics;Monitoring, BI et outils data;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6114;Telecommunications;Telecommunications;WAN, LAN, internet et telephonie;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6115;Internet & Data Lines;Internet et lignes de donnees;Haut debit, fibre et lignes dediees;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6123;Mobile Communications;Telephonie mobile;Forfaits mobiles et equipements;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6116;IT Maintenance;Maintenance informatique;Contrats de maintenance logicielle et materielle;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
6117;IT Consulting;Conseil IT;Conseil en strategie, architecture et securite;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6118;Software Development Services;Developpement logiciel externe;Developpement d'applications et integration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6124;Systems Integration;Integration de systemes;Implantation ERP/CRM et migration de donnees;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6119;IT Training;Formation IT;Programmes de formation et certifications professionnelles;2600;Training & Certification;Staff training and certifications;enabled;opex
6125;IT Conferences;Conferences IT;Salons professionnels et evenements IT;2600;Training & Certification;Staff training and certifications;enabled;opex
6120;Workplace IT Equipment;Materiel IT non capitalise;Peripheriques et equipements sous seuil d'activation;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
6130;IT Travel;Deplacements IT;Deplacements projets, conferences et salons IT;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
6140;Other IT Expenses;Autres charges IT;Depenses informatiques diverses;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
6141;IT Insurance;Assurance informatique;Cyber-assurance et assurance equipements;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
6200;IT Salaries;Remunerations personnel IT;Salaires bruts du personnel informatique;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6201;IT Bonuses;Primes personnel IT;Primes de performance et remuneration variable;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6210;IT Social Charges;Charges sociales IT;Cotisations ONSS et assurance-loi IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
`;
