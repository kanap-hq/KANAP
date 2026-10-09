/**
 * ES-PGC v2.0 — Detailed
 * Plan General de Contabilidad — Spain
 * All v1.0 IT accounts + additional granular sub-accounts.
 */
export const csv = `\ufeffaccount_number;account_name;native_name;description;consolidation_account_number;consolidation_account_name;consolidation_account_description;status;nature
206;Capitalized Software;Aplicaciones informaticas;Software y derechos de uso activados;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
2061;Purchased Software;Software adquirido;Licencias de software activadas (ERP, CRM);1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
2062;Internally Developed Software;Software desarrollado internamente;Costes de desarrollo activados;1100;Intangible Assets (CAPEX);Capitalized software and rights — IAS 38;enabled;capex
217;IT Equipment;Equipos para procesos de informacion;Servidores, puestos de trabajo y equipos de red;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
2171;Network Equipment;Equipos de red;Routers, switches, cortafuegos y puntos de acceso;1000;Tangible Assets (CAPEX);Purchase of physical IT equipment — IAS 16;enabled;capex
280;Depreciation - Intangible Assets;Amort. acum. inmovilizado intangible;Amortizacion acumulada de software activado;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
281;Depreciation - Tangible Assets;Amort. acum. inmovilizado material;Amortizacion acumulada de equipos informaticos;1200;Depreciation & Amortization;Expense for PPE and intangibles — IAS 16/38;enabled;
291;Impairment - Tangible Assets;Deterioro valor inmovilizado material;Perdida por deterioro de equipos informaticos;1300;Impairments & Write-offs;Impairment of assets — IAS 36;enabled;
6210;Software Licenses;Arrendamientos de licencias;Licencias perpetuas y temporales de software;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6211;SaaS Subscriptions;Suscripciones SaaS;Abonos a software en la nube (M365, Salesforce);2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6212;Open Source Support;Soporte open source;Contratos de soporte para software de codigo abierto;2000;Software Licenses (OPEX);Recurring licenses and subscriptions;enabled;opex
6290;Cloud Hosting;Servicios cloud y hosting;Servidores dedicados, almacenamiento y PaaS;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6291;Cybersecurity Tools;Herramientas de ciberseguridad;Proteccion de endpoints, IAM, escaneo;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6294;Data & Analytics Platforms;Plataformas de datos y analytics;Monitorizacion, BI y herramientas de datos;2100;Cloud & Hosting Services;IaaS/PaaS/SaaS usage and hosting;enabled;opex
6280;Telecommunications;Telecomunicaciones;WAN, LAN, internet y telefonia;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6281;Internet & Data Lines;Internet y lineas de datos;Banda ancha, fibra y lineas dedicadas;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6282;Mobile Communications;Comunicaciones moviles;Planes de telefonia movil corporativos;2200;Telecommunications & Network;Internet, mobile, lines, VPN;enabled;opex
6220;IT Maintenance;Mantenimiento informatico;Contratos de mantenimiento de software y hardware;2300;Maintenance & Support;Software/hardware maintenance contracts;enabled;opex
6230;IT Consulting;Consultoria IT;Asesoria en estrategia, arquitectura y seguridad;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6231;Software Development Services;Desarrollo de software externo;Desarrollo de aplicaciones e integracion;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6232;Systems Integration;Integracion de sistemas;Implantacion ERP/CRM y migracion de datos;2400;IT Consulting & External Services;Professional services, integration, contractors;enabled;opex
6400;IT Salaries;Sueldos personal IT;Salarios brutos del personal informatico;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6401;IT Bonuses;Primas personal IT;Primas de rendimiento y remuneracion variable;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6420;IT Social Security;Seguridad Social IT;Cotizaciones a la Seguridad Social IT;2500;IT Staff Costs;Salaries, benefits — IAS 19;enabled;opex
6490;IT Training;Formacion IT;Programas de formacion y certificaciones profesionales;2600;Training & Certification;Staff training and certifications;enabled;opex
6491;IT Conferences;Conferencias IT;Congresos, ferias y eventos tecnologicos;2600;Training & Certification;Staff training and certifications;enabled;opex
6292;Workplace IT Supplies;Material informatico no capitalizable;Perifericos y equipos bajo umbral de activacion;2700;Workplace IT (Non-capitalized);End-user devices/peripherals not capitalized;enabled;opex
6293;IT Travel;Viajes y desplazamientos IT;Desplazamientos de proyectos, conferencias IT;2800;Travel & Mobility (IT Projects);Project-related travel costs;enabled;opex
6299;Other IT Expenses;Otros gastos IT;Gastos informaticos diversos;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
6295;IT Insurance;Seguros informaticos;Ciberseguro y seguro de equipos;2900;Other IT Operating Expenses;Miscellaneous IT OPEX;enabled;opex
`;
