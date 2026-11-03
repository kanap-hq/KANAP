import type { CsvLanguage } from '../common/csv-sheet';

/** What a reference column names, in the notes of an example file. */
export type ReferenceThing =
  | 'supplier' | 'company' | 'costCenterName' | 'costCenterCode' | 'location' | 'account' | 'project'
  | 'source' | 'category' | 'stream' | 'department' | 'cluster';

/** A column whose notes need more than its kind says. */
export type ColumnHint =
  | 'countries' | 'minutes' | 'manDays' | 'percent' | 'names' | 'ipAddress' | 'subnet' | 'currency' | 'months'
  | 'operatingSystem' | 'erpId' | 'endDay' | 'startDay' | 'hostname' | 'userEmail' | 'contactEmail' | 'version';

export interface ExampleTexts {
  /** The word of the file name: `applications-example.xlsx`. */
  file: string;
  sheets: { examples: string; advanced: string; notes: string };
  notesHeaders: [string, string, string, string];
  required: string;
  text: string;
  date: string;
  number: string;
  amount: string;
  bool: string;
  oneOf: (values: string) => string;
  someOf: (values: string) => string;
  reference: Record<ReferenceThing, string>;
  hints: Record<ColumnHint, string>;
  dimension: (name: string) => string;
  amountColumn: (column: string, year: string) => string;
  /** The lines under the notes table. */
  firstSheet: string;
  firstSheetWithAdvanced: string;
  references: string;
  budgetAmounts: string;
}

export const EXAMPLE_TEXTS: Record<CsvLanguage, ExampleTexts> = {
  en: {
    file: 'example',
    sheets: { examples: 'Examples', advanced: 'Advanced', notes: 'Notes' },
    notesHeaders: ['Column', 'Sheet', 'Required', 'What to write'],
    required: 'Yes',
    text: 'Text',
    date: 'A date',
    number: 'A number',
    amount: 'An amount, two decimals at most',
    bool: 'Yes or no',
    oneOf: (values) => `One of: ${values}`,
    someOf: (values) => `One or more of, separated by commas: ${values}`,
    reference: {
      supplier: 'The name of a supplier of the workspace',
      company: 'The name of a company of the workspace',
      costCenterName: 'The name of a cost center of the workspace',
      costCenterCode: 'The code of a cost center of the workspace, such as FR-TRV-400',
      location: 'The reference of a location of the workspace, such as LOC-1',
      account: "An account number of the paying company's chart of accounts",
      project: 'A project reference, such as PRJ-3',
      source: 'The name of a portfolio source of the workspace',
      category: 'The name of a portfolio category of the workspace',
      stream: 'The name of a stream of that category',
      department: 'The name of a department of the company',
      cluster: 'The name of the cluster the server belongs to',
    },
    hints: {
      countries: 'Country codes separated by commas, such as FR, NL',
      minutes: 'A number of minutes',
      manDays: 'A number of man-days',
      percent: 'A percentage from 0 to 100',
      names: 'Names separated by commas',
      ipAddress: 'An IPv4 or IPv6 address',
      subnet: 'A subnet, such as 10.10.20.0/24',
      currency: 'A three-letter currency code allowed in the workspace, such as EUR',
      months: 'A number of months',
      operatingSystem: 'The operating system and its version, such as Windows Server 2022',
      erpId: "The supplier's ID in your ERP",
      endDay: 'A date. Empty: no end',
      startDay: 'A date. Empty: January 1 of the first year with an amount',
      hostname: 'The host name, without the domain',
      userEmail: 'The email of a user of the workspace',
      contactEmail: 'The email of a contact of the workspace',
      version: 'Text, such as 4.2',
    },
    dimension: (name) => `A value of the ${name} dimension. A value that does not exist is created`,
    amountColumn: (column, year) => `The ${column} amount for ${year}`,
    firstSheet: 'The import reads the first sheet. Its columns can be in any order.',
    firstSheetWithAdvanced: 'The import reads the first sheet. To use a column of the Advanced sheet, copy it into the first sheet: the columns can be in any order.',
    references: 'Names, codes and emails must match records of your workspace. The examples use those of the Fromage & Co sample data.',
    budgetAmounts: 'An amount column is named after the column and the year (budget_2027), or the month (budget_2027_03). A file holds the yearly total of a column and year, or its twelve months, never both.',
  },
  fr: {
    file: 'exemple',
    sheets: { examples: 'Exemples', advanced: 'Avancé', notes: 'Notes' },
    notesHeaders: ['Colonne', 'Feuille', 'Obligatoire', 'Ce qu’on y écrit'],
    required: 'Oui',
    text: 'Texte',
    date: 'Une date',
    number: 'Un nombre',
    amount: 'Un montant, deux décimales au plus',
    bool: 'Oui ou non',
    oneOf: (values) => `Une de ces valeurs : ${values}`,
    someOf: (values) => `Une ou plusieurs de ces valeurs, séparées par des virgules : ${values}`,
    reference: {
      supplier: 'Le nom d’un fournisseur de l’espace',
      company: 'Le nom d’une société de l’espace',
      costCenterName: 'Le nom d’un centre de coûts de l’espace',
      costCenterCode: 'Le code d’un centre de coûts de l’espace, par exemple FR-TRV-400',
      location: 'La référence d’un site de l’espace, par exemple LOC-1',
      account: 'Un numéro de compte du plan comptable de la société qui paie',
      project: 'La référence d’un projet, par exemple PRJ-3',
      source: 'Le nom d’une source du portefeuille de l’espace',
      category: 'Le nom d’une catégorie du portefeuille de l’espace',
      stream: 'Le nom d’une filière de cette catégorie',
      department: 'Le nom d’un département de la société',
      cluster: 'Le nom du cluster dont le serveur fait partie',
    },
    hints: {
      countries: 'Des codes pays séparés par des virgules, par exemple FR, NL',
      minutes: 'Un nombre de minutes',
      manDays: 'Un nombre de jours-hommes',
      percent: 'Un pourcentage de 0 à 100',
      names: 'Des noms séparés par des virgules',
      ipAddress: 'Une adresse IPv4 ou IPv6',
      subnet: 'Un sous-réseau, par exemple 10.10.20.0/24',
      currency: 'Un code de devise à trois lettres autorisé dans l’espace, par exemple EUR',
      months: 'Un nombre de mois',
      operatingSystem: 'Le système d’exploitation et sa version, par exemple Windows Server 2022',
      erpId: 'L’identifiant du fournisseur dans votre ERP',
      endDay: 'Une date. Vide : pas de fin',
      startDay: 'Une date. Vide : le 1er janvier de la première année qui a un montant',
      hostname: 'Le nom d’hôte, sans le domaine',
      userEmail: 'L’e-mail d’un utilisateur de l’espace',
      contactEmail: 'L’e-mail d’un contact de l’espace',
      version: 'Texte, par exemple 4.2',
    },
    dimension: (name) => `Une valeur de la dimension ${name}. Une valeur qui n’existe pas est créée`,
    amountColumn: (column, year) => `Le montant ${column} de ${year}`,
    firstSheet: 'L’import lit la première feuille. Ses colonnes peuvent être dans n’importe quel ordre.',
    firstSheetWithAdvanced: 'L’import lit la première feuille. Pour utiliser une colonne de la feuille Avancé, copiez-la dans la première feuille : les colonnes peuvent être dans n’importe quel ordre.',
    references: 'Les noms, codes et e-mails doivent correspondre à des fiches de votre espace. Les exemples reprennent ceux des données d’exemple de Fromage & Co.',
    budgetAmounts: 'Une colonne de montant porte le nom de la colonne et l’année (budget_2027), ou le mois (budget_2027_03). Un fichier contient le total annuel d’une colonne et d’une année, ou ses douze mois, jamais les deux.',
  },
  de: {
    file: 'beispiel',
    sheets: { examples: 'Beispiele', advanced: 'Erweitert', notes: 'Hinweise' },
    notesHeaders: ['Spalte', 'Blatt', 'Pflicht', 'Inhalt'],
    required: 'Ja',
    text: 'Text',
    date: 'Ein Datum',
    number: 'Eine Zahl',
    amount: 'Ein Betrag, höchstens zwei Dezimalstellen',
    bool: 'Ja oder Nein',
    oneOf: (values) => `Einer dieser Werte: ${values}`,
    someOf: (values) => `Einer oder mehrere dieser Werte, durch Kommas getrennt: ${values}`,
    reference: {
      supplier: 'Der Name eines Lieferanten des Arbeitsbereichs',
      company: 'Der Name eines Unternehmens des Arbeitsbereichs',
      costCenterName: 'Der Name einer Kostenstelle des Arbeitsbereichs',
      costCenterCode: 'Der Code einer Kostenstelle des Arbeitsbereichs, zum Beispiel FR-TRV-400',
      location: 'Die Referenz eines Standorts des Arbeitsbereichs, zum Beispiel LOC-1',
      account: 'Eine Kontonummer aus dem Kontenplan des zahlenden Unternehmens',
      project: 'Die Referenz eines Projekts, zum Beispiel PRJ-3',
      source: 'Der Name einer Portfolio-Quelle des Arbeitsbereichs',
      category: 'Der Name einer Portfolio-Kategorie des Arbeitsbereichs',
      stream: 'Der Name eines Streams dieser Kategorie',
      department: 'Der Name einer Abteilung des Unternehmens',
      cluster: 'Der Name des Clusters, zu dem der Server gehört',
    },
    hints: {
      countries: 'Ländercodes, durch Kommas getrennt, zum Beispiel FR, NL',
      minutes: 'Eine Anzahl Minuten',
      manDays: 'Eine Anzahl Personentage',
      percent: 'Ein Prozentsatz von 0 bis 100',
      names: 'Namen, durch Kommas getrennt',
      ipAddress: 'Eine IPv4- oder IPv6-Adresse',
      subnet: 'Ein Subnetz, zum Beispiel 10.10.20.0/24',
      currency: 'Ein dreistelliger Währungscode, der im Arbeitsbereich erlaubt ist, zum Beispiel EUR',
      months: 'Eine Anzahl Monate',
      operatingSystem: 'Das Betriebssystem und seine Version, zum Beispiel Windows Server 2022',
      erpId: 'Die ID des Lieferanten in Ihrem ERP',
      endDay: 'Ein Datum. Leer: kein Ende',
      startDay: 'Ein Datum. Leer: der 1. Januar des ersten Jahres mit einem Betrag',
      hostname: 'Der Hostname, ohne Domäne',
      userEmail: 'Die E-Mail-Adresse eines Benutzers des Arbeitsbereichs',
      contactEmail: 'Die E-Mail-Adresse eines Kontakts des Arbeitsbereichs',
      version: 'Text, zum Beispiel 4.2',
    },
    dimension: (name) => `Ein Wert der Dimension ${name}. Ein Wert, der nicht existiert, wird angelegt`,
    amountColumn: (column, year) => `Der Betrag ${column} für ${year}`,
    firstSheet: 'Der Import liest das erste Blatt. Seine Spalten können in beliebiger Reihenfolge stehen.',
    firstSheetWithAdvanced: 'Der Import liest das erste Blatt. Um eine Spalte des Blatts Erweitert zu verwenden, kopieren Sie sie in das erste Blatt: Die Spalten können in beliebiger Reihenfolge stehen.',
    references: 'Namen, Codes und E-Mail-Adressen müssen zu Datensätzen Ihres Arbeitsbereichs passen. Die Beispiele verwenden die der Beispieldaten von Fromage & Co.',
    budgetAmounts: 'Eine Betragsspalte trägt den Namen der Spalte und das Jahr (budget_2027) oder den Monat (budget_2027_03). Eine Datei enthält die Jahressumme einer Spalte und eines Jahres oder ihre zwölf Monate, nie beides.',
  },
  es: {
    file: 'ejemplo',
    sheets: { examples: 'Ejemplos', advanced: 'Avanzado', notes: 'Notas' },
    notesHeaders: ['Columna', 'Hoja', 'Obligatoria', 'Qué escribir'],
    required: 'Sí',
    text: 'Texto',
    date: 'Una fecha',
    number: 'Un número',
    amount: 'Un importe, con dos decimales como máximo',
    bool: 'Sí o no',
    oneOf: (values) => `Uno de estos valores: ${values}`,
    someOf: (values) => `Uno o varios de estos valores, separados por comas: ${values}`,
    reference: {
      supplier: 'El nombre de un proveedor del espacio de trabajo',
      company: 'El nombre de una empresa del espacio de trabajo',
      costCenterName: 'El nombre de un centro de coste del espacio de trabajo',
      costCenterCode: 'El código de un centro de coste del espacio de trabajo, por ejemplo FR-TRV-400',
      location: 'La referencia de una ubicación del espacio de trabajo, por ejemplo LOC-1',
      account: 'Un número de cuenta del plan contable de la empresa que paga',
      project: 'La referencia de un proyecto, por ejemplo PRJ-3',
      source: 'El nombre de un origen del portafolio del espacio de trabajo',
      category: 'El nombre de una categoría del portafolio del espacio de trabajo',
      stream: 'El nombre de una línea de esa categoría',
      department: 'El nombre de un departamento de la empresa',
      cluster: 'El nombre del clúster al que pertenece el servidor',
    },
    hints: {
      countries: 'Códigos de país separados por comas, por ejemplo FR, NL',
      minutes: 'Un número de minutos',
      manDays: 'Un número de días-persona',
      percent: 'Un porcentaje de 0 a 100',
      names: 'Nombres separados por comas',
      ipAddress: 'Una dirección IPv4 o IPv6',
      subnet: 'Una subred, por ejemplo 10.10.20.0/24',
      currency: 'Un código de moneda de tres letras permitido en el espacio de trabajo, por ejemplo EUR',
      months: 'Un número de meses',
      operatingSystem: 'El sistema operativo y su versión, por ejemplo Windows Server 2022',
      erpId: 'El identificador del proveedor en su ERP',
      endDay: 'Una fecha. Vacía: sin fin',
      startDay: 'Una fecha. Vacía: el 1 de enero del primer año con un importe',
      hostname: 'El nombre de host, sin el dominio',
      userEmail: 'El correo de un usuario del espacio de trabajo',
      contactEmail: 'El correo de un contacto del espacio de trabajo',
      version: 'Texto, por ejemplo 4.2',
    },
    dimension: (name) => `Un valor de la dimensión ${name}. Un valor que no existe se crea`,
    amountColumn: (column, year) => `El importe ${column} de ${year}`,
    firstSheet: 'La importación lee la primera hoja. Sus columnas pueden estar en cualquier orden.',
    firstSheetWithAdvanced: 'La importación lee la primera hoja. Para usar una columna de la hoja Avanzado, cópiela en la primera hoja: las columnas pueden estar en cualquier orden.',
    references: 'Los nombres, códigos y correos deben corresponder a registros de su espacio de trabajo. Los ejemplos usan los de los datos de ejemplo de Fromage & Co.',
    budgetAmounts: 'Una columna de importe lleva el nombre de la columna y el año (budget_2027), o el mes (budget_2027_03). Un archivo contiene el total anual de una columna y un año, o sus doce meses, nunca ambos.',
  },
};
