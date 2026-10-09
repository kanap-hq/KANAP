/**
 * FR-PCG v1.0 — Simple (IT-focused)
 * Plan Comptable General — France
 * ~23 IT-focused accounts using standard PCG 6-digit numbering.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
205000;Capitalized Software;Concessions et droits similaires;Logiciels et droits d'utilisation immobilises;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
218200;IT Equipment;Materiel informatique;Serveurs, postes de travail et equipements reseau immobilises;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
281820;Depreciation - IT Equipment;Amort. materiel informatique;Amortissement du materiel informatique;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
281050;Depreciation - Software;Amort. concessions et droits;Amortissement des logiciels immobilises;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
290500;Impairment - Software;Deprec. concessions et droits;Depreciation des logiciels immobilises;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
291800;Impairment - IT Equipment;Deprec. materiel informatique;Depreciation du materiel informatique;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
606100;Workplace IT Supplies;Fournitures informatiques;Petites fournitures et consommables informatiques;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
606200;Non-capitalized Devices;Materiel informatique non immobilise;Peripheriques et equipements sous seuil d'immobilisation;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
612100;Software Licenses;Redevances de licences logicielles;Licences perpetuelles et temporaires (SAP, VMware);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
612200;SaaS Subscriptions;Abonnements SaaS;Abonnements logiciels cloud (Microsoft 365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
613100;Cloud Hosting;Hebergement cloud et IaaS;Serveurs dedies, stockage objet, PaaS (OVHcloud, AWS);2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
613200;Cybersecurity Tools;Outils de cybersecurite;Securite des endpoints, IAM, scanning (Sophos, Okta);2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
615100;IT Maintenance;Maintenance informatique;Contrats de maintenance logicielle et infogerance;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
615200;Hardware Maintenance;Maintenance materiel;Contrats de maintenance et garanties etendues;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
616100;Telecommunications;Telecommunications;WAN, LAN, internet et telephonie;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
616200;Data Center Costs;Hebergement datacenter;Colocation, energie et refroidissement;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
618100;IT Training;Formation informatique;Programmes de formation et certifications professionnelles;2600;Training & Certification;Staff training and certifications;enabled;opex
621100;IT Staff Augmentation;Personnel interimaire IT;Developpeurs, ingenieurs et chefs de projet externes;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
622100;IT Consulting;Honoraires conseil IT;Conseil en strategie, architecture et cybersecurite;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
622200;Software Development Services;Developpement logiciel externalise;Developpement d'applications et integration;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
625100;IT Travel;Deplacements IT;Deplacements projets, conferences et salons IT;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
641000;IT Salaries;Remunerations personnel IT;Salaires bruts du personnel informatique;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
645000;IT Social Charges;Charges sociales IT;Cotisations sociales et patronales IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
658000;Other IT Expenses;Charges diverses IT;Depenses informatiques diverses;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
