import { describe, expect, it } from 'vitest';
import en from '../../locales/en/common.json';
import fr from '../../locales/fr/common.json';
import de from '../../locales/de/common.json';
import es from '../../locales/es/common.json';

// The shared import and export dialogs name these four controls in plain words.
// Issue 1561: no "workflow", "preset" or "préréglage" in the heading, the note,
// the export field list or the selected-field counter.
const COPY = {
  en: {
    importWorkflow: 'What the import does',
    exportPreset: 'Fields to export',
    fieldsSelected: '{{selected}} of {{total}} fields selected',
  },
  fr: {
    importWorkflow: "Ce que fait l'import",
    exportPreset: 'Champs à exporter',
    fieldsSelected: '{{selected}} champs sélectionnés sur {{total}}',
  },
  de: {
    importWorkflow: 'Was der Import macht',
    exportPreset: 'Zu exportierende Felder',
    fieldsSelected: '{{selected}} von {{total}} Feldern ausgewählt',
  },
  es: {
    importWorkflow: 'Lo que hace la importación',
    exportPreset: 'Campos a exportar',
    fieldsSelected: '{{selected}} de {{total}} campos seleccionados',
  },
} as const;

const TECHNICAL = /workflow|preset|préréglage|preconfiguraci|flujo de trabajo|vorlage/i;

// Issue 1639: a dialog that offers CSV or Excel does not call the export CSV only.
// The CSV-only sentence stays on a stored template. The format choice carries a note about the CSV file.
const CSV_ONLY_LEAD = {
  en: 'Export data as CSV',
  fr: 'Exporter les données au format CSV',
  de: 'Daten als CSV exportieren',
  es: 'Exportar datos como CSV',
} as const;

const CSV_FILE_NOTE = {
  en: 'A CSV file uses semicolon separators.',
  fr: 'Un fichier CSV utilise le séparateur point-virgule.',
  de: 'Eine CSV-Datei verwendet Semikolon als Trennzeichen.',
  es: 'Un archivo CSV usa punto y coma como separador.',
} as const;

const CSV_FILE_NOTE_FLEXIBLE = {
  en: 'In a CSV file, the separator, the decimal mark and the dates follow the language of the screen.',
  fr: "Dans un fichier CSV, le séparateur, le séparateur décimal et les dates suivent la langue de l'écran.",
  de: 'In einer CSV-Datei richten sich Trennzeichen, Dezimaltrennzeichen und Datumsformat nach der Sprache der Oberfläche.',
  es: 'En un archivo CSV, el separador, el separador decimal y las fechas siguen el idioma de la pantalla.',
} as const;

describe('csv dialog copy', () => {
  const locales = { en, fr, de, es };

  it('names the import choice, the export fields and the counter in plain words', () => {
    for (const language of Object.keys(COPY) as (keyof typeof COPY)[]) {
      const csv = locales[language].csv;
      expect(csv.importWorkflow).toBe(COPY[language].importWorkflow);
      expect(csv.exportPreset).toBe(COPY[language].exportPreset);
      expect(csv.fieldsSelected).toBe(COPY[language].fieldsSelected);
      for (const value of [csv.importWorkflow, csv.exportPreset, csv.fieldsSelected]) {
        expect(value).not.toMatch(TECHNICAL);
      }
    }
  });

  it('names CSV in a CSV-only export, and talks about the CSV file when the dialog also offers Excel', () => {
    for (const language of Object.keys(CSV_ONLY_LEAD) as (keyof typeof CSV_ONLY_LEAD)[]) {
      const csv = locales[language].csv;
      expect(csv.exportDescription.startsWith(CSV_ONLY_LEAD[language])).toBe(true);
      expect(csv.exportDescriptionFlexible.startsWith(CSV_ONLY_LEAD[language])).toBe(true);
      expect(csv.csvFileNote).toBe(CSV_FILE_NOTE[language]);
      expect(csv.csvFileNoteFlexible).toBe(CSV_FILE_NOTE_FLEXIBLE[language]);
      expect(csv.csvFileNote.includes(CSV_ONLY_LEAD[language])).toBe(false);
      expect(csv.csvFileNoteFlexible.includes(CSV_ONLY_LEAD[language])).toBe(false);
    }
  });
});
