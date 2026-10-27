// The data set's own analytics dimensions (business domain, budget reference), in the four
// seed languages. The budget files and 27-analytics-values.csv keep the English names, as an
// English tenant's seed does. The runner creates the dimensions and their values in the
// tenant's seed language and writes that language's value names into the budget files, the
// same way it maps the recommended dimensions (recommended-dimensions.seed.ts).
//
// English value names and descriptions come from 27-analytics-values.csv, so the generator
// stays the source of those. A budget reference value keeps its code (REF-SAP-S4 and the
// others) in every language: the code is the reference. Its description is translated.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../../scripts/lib/fixture-csv.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_LANGUAGES = ['en', 'fr', 'de', 'es'];

/** The seed language of a locale (`fr-FR` gives `fr`); English for anything else. */
export function resolveFixtureLanguage(raw) {
  const base = String(raw ?? '').trim().toLowerCase().split(/[-_]/, 1)[0];
  return FIXTURE_LANGUAGES.includes(base) ? base : 'en';
}

const AXIS_META = [
  {
    code: 'business_domain',
    sort_order: 100,
    name: 'Business domain',
    description: 'The part of the business the spending serves: ERP, e-commerce, shops\u2026 Shared IT serves every business.',
  },
  {
    code: 'reference',
    sort_order: 110,
    name: 'Budget reference',
    description: 'Groups the OPEX and CAPEX lines of one order or one competence center, whatever the supplier',
  },
];

const FR = {
  axes: {
    business_domain: {
      name: 'Domaine métier',
      description: 'La partie du métier que la dépense sert : ERP, e-commerce, magasins\u2026 L\'IT partagée sert tous les métiers.',
    },
    reference: {
      name: 'Référence budgétaire',
      description: 'Regroupe les lignes OPEX et CAPEX d\'une commande ou d\'un centre de compétences, indépendamment du fournisseur',
    },
  },
  values: {
    business_domain: {
      erp: { name: 'ERP', description: 'Finance, achats, administration des ventes et logistique sur SAP et Sage' },
      crm: { name: 'CRM', description: 'Gestion de la relation client pour la distribution et les abonnés' },
      'e-commerce': { name: 'E-commerce', description: 'Boutiques en ligne, portail B2B et paiement' },
      retail: { name: 'Magasins', description: 'Boutiques et points de vente' },
      'supply chain': { name: 'Chaîne logistique', description: 'Entrepôts, EDI, informations produit et logistique' },
      traceability: { name: 'Traçabilité', description: 'Chaîne du froid, surveillance des caves et traçabilité des produits' },
      hr: { name: 'RH', description: 'Gestion du capital humain et paie' },
      'data and analytics': { name: 'Données et analytique', description: 'Plateforme de données, BI et reporting' },
      'shared it': { name: 'IT partagée', description: 'Infrastructure, poste de travail, sécurité et pilotage IT au service de tous les métiers' },
    },
    reference: {
      'ref-ecom-cdc': { name: 'REF-ECOM-CDC', description: 'Centre de compétences e-commerce : équipe externalisée, lignes OPEX et CAPEX, fournisseurs qui changent' },
      'ref-sap-s4': { name: 'REF-SAP-S4', description: 'Programme S/4HANA : prestataires fonctionnels et techniques, matériel et développements immobilisés' },
      'ref-data': { name: 'REF-DATA', description: 'Plateforme de données du groupe : licences, hébergement et ingénierie' },
      'ref-secu-zt': { name: 'REF-SECU-ZT', description: 'Programme Zero Trust : audits, outillage et déploiement' },
    },
  },
};

const DE = {
  axes: {
    business_domain: {
      name: 'Geschäftsbereich',
      description: 'Der Teil des Geschäfts, dem die Ausgabe dient: ERP, E-Commerce, Läden\u2026 Die gemeinsame IT dient jedem Geschäft.',
    },
    reference: {
      name: 'Budgetreferenz',
      description: 'Gruppiert die OPEX- und CAPEX-Zeilen eines Auftrags oder eines Kompetenzzentrums, unabhängig vom Lieferanten',
    },
  },
  values: {
    business_domain: {
      erp: { name: 'ERP', description: 'Finanzen, Einkauf, Vertriebsadministration und Logistik auf SAP und Sage' },
      crm: { name: 'CRM', description: 'Kundenbeziehungsmanagement für Vertrieb und Abonnenten' },
      'e-commerce': { name: 'E-Commerce', description: 'Online-Shops, B2B-Portal und Zahlung' },
      retail: { name: 'Einzelhandel', description: 'Läden und Verkaufsstellen' },
      'supply chain': { name: 'Lieferkette', description: 'Lager, EDI, Produktinformationen und Logistik' },
      traceability: { name: 'Rückverfolgbarkeit', description: 'Kühlkette, Überwachung der Reifekeller und Produktrückverfolgbarkeit' },
      hr: { name: 'Personal', description: 'Personalverwaltung und Gehaltsabrechnung' },
      'data and analytics': { name: 'Daten und Analytik', description: 'Datenplattform, BI und Reporting' },
      'shared it': { name: 'Gemeinsame IT', description: 'Infrastruktur, Arbeitsplatz, Sicherheit und IT-Steuerung für jedes Geschäft' },
    },
    reference: {
      'ref-ecom-cdc': { name: 'REF-ECOM-CDC', description: 'Kompetenzzentrum E-Commerce: externes Team, OPEX- und CAPEX-Zeilen, wechselnde Lieferanten' },
      'ref-sap-s4': { name: 'REF-SAP-S4', description: 'Programm S/4HANA: fachliche und technische Dienstleister, Hardware und aktivierte Entwicklung' },
      'ref-data': { name: 'REF-DATA', description: 'Datenplattform der Gruppe: Lizenzen, Hosting und Engineering' },
      'ref-secu-zt': { name: 'REF-SECU-ZT', description: 'Programm Zero Trust: Audits, Werkzeuge und Einführung' },
    },
  },
};

const ES = {
  axes: {
    business_domain: {
      name: 'Dominio de negocio',
      description: 'La parte del negocio a la que sirve el gasto: ERP, comercio electrónico, tiendas\u2026 La TI compartida sirve a todo el negocio.',
    },
    reference: {
      name: 'Referencia presupuestaria',
      description: 'Agrupa las líneas OPEX y CAPEX de un pedido o de un centro de competencias, independientemente del proveedor',
    },
  },
  values: {
    business_domain: {
      erp: { name: 'ERP', description: 'Finanzas, compras, administración de ventas y logística en SAP y Sage' },
      crm: { name: 'CRM', description: 'Gestión de la relación con el cliente para la distribución y los abonados' },
      'e-commerce': { name: 'Comercio electrónico', description: 'Tiendas en línea, portal B2B y pago' },
      retail: { name: 'Comercio minorista', description: 'Tiendas y puntos de venta' },
      'supply chain': { name: 'Cadena de suministro', description: 'Almacenes, EDI, información de producto y logística' },
      traceability: { name: 'Trazabilidad', description: 'Cadena de frío, vigilancia de las cavas y trazabilidad de los productos' },
      hr: { name: 'RR. HH.', description: 'Gestión del capital humano y nómina' },
      'data and analytics': { name: 'Datos y analítica', description: 'Plataforma de datos, BI e informes' },
      'shared it': { name: 'TI compartida', description: 'Infraestructura, puesto de trabajo, seguridad y gestión de TI al servicio de todo el negocio' },
    },
    reference: {
      'ref-ecom-cdc': { name: 'REF-ECOM-CDC', description: 'Centro de competencias de comercio electrónico: equipo externo, líneas OPEX y CAPEX, proveedores que cambian' },
      'ref-sap-s4': { name: 'REF-SAP-S4', description: 'Programa S/4HANA: contratistas funcionales y técnicos, hardware y desarrollo capitalizado' },
      'ref-data': { name: 'REF-DATA', description: 'Plataforma de datos del grupo: licencias, alojamiento e ingeniería' },
      'ref-secu-zt': { name: 'REF-SECU-ZT', description: 'Programa Zero Trust: auditorías, herramientas y despliegue' },
    },
  },
};

const TRANSLATIONS = { fr: FR, de: DE, es: ES };

let cachedEnglish = null;

/** English values of 27-analytics-values.csv, in file order, keyed by dimension code. */
function englishAxes() {
  if (cachedEnglish) return cachedEnglish;
  const rows = parseCsv(readFileSync(path.join(ROOT, '27-analytics-values.csv'), 'utf8'));
  const byCode = new Map(AXIS_META.map((axis) => [axis.code, []]));
  for (const row of rows) {
    const code = String(row.axis_code ?? '').trim();
    const list = byCode.get(code);
    if (!list) throw new Error(`27-analytics-values.csv: '${code}' is not a dimension of the data set`);
    const name = String(row.name ?? '').trim();
    if (!name) throw new Error(`27-analytics-values.csv: a ${code} value has no name`);
    list.push({ key: name.toLowerCase(), name, description: String(row.description ?? '').trim() });
  }
  for (const [code, list] of byCode) {
    if (!list.length) throw new Error(`27-analytics-values.csv: no value for ${code}`);
    const seen = new Set();
    for (const value of list) {
      if (seen.has(value.key)) throw new Error(`27-analytics-values.csv: '${value.name}' is repeated on ${code}`);
      seen.add(value.key);
    }
  }
  cachedEnglish = byCode;
  return byCode;
}

/**
 * The two dimensions in `language`, values in the order of 27-analytics-values.csv.
 * `key` is the English name, lower case, and is the same in every language.
 */
export function fixtureDimensions(language) {
  const lang = resolveFixtureLanguage(language);
  const english = englishAxes();
  return AXIS_META.map((axis) => {
    const values = english.get(axis.code).map((value) => {
      if (lang === 'en') return { key: value.key, name: value.name, description: value.description };
      const translated = TRANSLATIONS[lang]?.values?.[axis.code]?.[value.key];
      if (!translated?.name || translated.description == null) {
        throw new Error(`${lang} ${axis.code}: no translation for '${value.name}'`);
      }
      return { key: value.key, name: translated.name, description: translated.description };
    });
    if (lang === 'en') return { code: axis.code, sort_order: axis.sort_order, name: axis.name, description: axis.description, values };
    const text = TRANSLATIONS[lang]?.axes?.[axis.code];
    if (!text?.name || text.description == null) throw new Error(`${lang}: no translation for the ${axis.code} dimension`);
    return { code: axis.code, sort_order: axis.sort_order, name: text.name, description: text.description, values };
  });
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[;"\r\n]/.test(text)) throw new Error(`An analytics value cell cannot contain a separator or a line break: ${text}`);
  return text;
}

/**
 * `27-analytics-values.csv` as the import should send it. English is the file unchanged.
 * Another language keeps the axis code and the status, and writes that language's name
 * and description. A value the table does not know stops the load.
 */
export function analyticsValuesText(language, fileText) {
  const lang = resolveFixtureLanguage(language);
  if (lang === 'en') return fileText;
  const table = new Map(fixtureDimensions(lang).map((axis) => [axis.code, axis]));
  const lines = ['axis_code;name;description;status'];
  for (const row of parseCsv(fileText)) {
    const code = String(row.axis_code ?? '').trim();
    let name = String(row.name ?? '').trim();
    let description = String(row.description ?? '').trim();
    const status = String(row.status ?? '').trim();
    const axis = table.get(code);
    if (axis) {
      const value = axis.values.find((item) => item.key === name.toLowerCase());
      if (!value) throw new Error(`27-analytics-values.csv: '${name}' is no value of ${code}`);
      name = value.name;
      description = value.description;
    }
    lines.push([csvCell(code), csvCell(name), csvCell(description), csvCell(status)].join(';'));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The rows of a budget file with the data set's own dimensions named in `language`.
 * English rows are returned as they are. An empty cell stays empty. A value the table
 * does not know stops the load. Other columns are left as they are.
 */
export function withFixtureDimensionValues(rows, language) {
  const lang = resolveFixtureLanguage(language);
  if (lang === 'en') return rows;
  const byCode = new Map(fixtureDimensions(lang).map((axis) => [axis.code, new Map(axis.values.map((value) => [value.key, value.name]))]));
  return rows.map((row) => {
    const out = { ...row };
    for (const code of byCode.keys()) {
      const column = `analytics:${code}`;
      if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
      const text = String(row[column] ?? '').trim();
      if (!text) continue;
      const name = byCode.get(code).get(text.toLowerCase());
      if (!name) throw new Error(`'${text}' is no value of the ${code} dimension`);
      out[column] = name;
    }
    return out;
  });
}
