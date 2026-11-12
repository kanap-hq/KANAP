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
    overridePresetNote: 'These options replace the choice above.',
    exportPreset: 'Fields to export',
    fieldsSelected: '{{selected}} of {{total}} fields selected',
  },
  fr: {
    importWorkflow: "Ce que fait l'import",
    overridePresetNote: 'Ces options remplacent le choix ci-dessus.',
    exportPreset: 'Champs à exporter',
    fieldsSelected: '{{selected}} champs sélectionnés sur {{total}}',
  },
  de: {
    importWorkflow: 'Was der Import macht',
    overridePresetNote: 'Diese Optionen ersetzen die Auswahl oben.',
    exportPreset: 'Zu exportierende Felder',
    fieldsSelected: '{{selected}} von {{total}} Feldern ausgewählt',
  },
  es: {
    importWorkflow: 'Lo que hace la importación',
    overridePresetNote: 'Estas opciones reemplazan la elección de arriba.',
    exportPreset: 'Campos a exportar',
    fieldsSelected: '{{selected}} de {{total}} campos seleccionados',
  },
} as const;

const TECHNICAL = /workflow|preset|préréglage|preconfiguraci|flujo de trabajo|vorlage/i;

describe('csv dialog copy', () => {
  const locales = { en, fr, de, es };

  it('names the import choice, the advanced note, the export fields and the counter in plain words', () => {
    for (const language of Object.keys(COPY) as (keyof typeof COPY)[]) {
      const csv = locales[language].csv;
      expect(csv.importWorkflow).toBe(COPY[language].importWorkflow);
      expect(csv.overridePresetNote).toBe(COPY[language].overridePresetNote);
      expect(csv.exportPreset).toBe(COPY[language].exportPreset);
      expect(csv.fieldsSelected).toBe(COPY[language].fieldsSelected);
      for (const value of [csv.importWorkflow, csv.overridePresetNote, csv.exportPreset, csv.fieldsSelected]) {
        expect(value).not.toMatch(TECHNICAL);
      }
    }
  });
});
