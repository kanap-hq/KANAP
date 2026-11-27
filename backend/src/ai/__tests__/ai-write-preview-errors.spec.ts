import * as assert from 'node:assert/strict';
import { AiTranslatedWriteLanguage, isFixedPreviewError, PREVIEW_DOCUMENT_CHANGED_MESSAGE, PREVIEW_EXPIRED_MESSAGE, previewErrorText } from '../ai-write-texts';

/**
 * The detail of a failed preview (`previewErrorText`): drift since the preview and a record
 * gone at execution, in the person's language. English and any other sentence stay as stored.
 * The technical flag of the card reads `isFixedPreviewError`, which does not see these patterns.
 */

const LANGUAGES = ['fr', 'de', 'es'] as const;

function expectTranslated(message: string, text: Record<AiTranslatedWriteLanguage, string>) {
  assert.equal(previewErrorText('en', message), message, `en: ${message}`);
  for (const language of LANGUAGES) {
    assert.equal(previewErrorText(language, message), text[language], `${language}: ${message}`);
  }
  assert.equal(isFixedPreviewError(message), false, message);
}

/** The relation cards name their relation after the sentence, so it holds whatever its gender and number (lot K2b). */
function testRelationCards() {
  expectTranslated('The Applications relation changed after the preview was created.', {
    fr: "Cette relation a changé depuis l'aperçu : Applications.",
    de: 'Diese Beziehung hat sich seit der Vorschau geändert: Anwendungen.',
    es: 'Esta relación ha cambiado desde la vista previa: Aplicaciones.',
  });
  expectTranslated('The Sub-locations relation changed after the preview was created.', {
    fr: "Cette relation a changé depuis l'aperçu : Sous-sites.",
    de: 'Diese Beziehung hat sich seit der Vorschau geändert: Unterstandorte.',
    es: 'Esta relación ha cambiado desde la vista previa: Sub-ubicaciones.',
  });
  expectTranslated('The Support Contacts relation changed after the preview was created.', {
    fr: "Cette relation a changé depuis l'aperçu : Contacts de support.",
    de: 'Diese Beziehung hat sich seit der Vorschau geändert: Supportkontakte.',
    es: 'Esta relación ha cambiado desde la vista previa: Contactos de soporte.',
  });
  expectTranslated('Owners could not be changed: nothing was written.', {
    fr: "Cette relation n'a pas été modifiée, rien n'a été écrit : Responsables.",
    de: 'Diese Beziehung wurde nicht geändert, nichts wurde geschrieben: Verantwortliche.',
    es: 'Esta relación no se ha modificado, no se ha escrito nada: Responsables.',
  });
  expectTranslated('Projects: the record was not found.', {
    fr: 'Projets : la fiche est introuvable.',
    de: 'Projekte: der Eintrag wurde nicht gefunden.',
    es: 'Proyectos: no se ha encontrado el registro.',
  });
  console.log('  relation cards: OK');
}

function testDrift() {
  expectTranslated('APP-3 changed after the preview was created.', {
    fr: "APP-3 a changé depuis l'aperçu.",
    de: 'APP-3 hat sich seit der Vorschau geändert.',
    es: 'APP-3 ha cambiado desde la vista previa.',
  });
  expectTranslated('OPX-12 changed after the preview was created.', {
    fr: "OPX-12 a changé depuis l'aperçu.",
    de: 'OPX-12 hat sich seit der Vorschau geändert.',
    es: 'OPX-12 ha cambiado desde la vista previa.',
  });
  // A dimension's current name rides the same sentence and is kept.
  expectTranslated('Cost pool changed after the preview was created.', {
    fr: "Cost pool a changé depuis l'aperçu.",
    de: 'Cost pool hat sich seit der Vorschau geändert.',
    es: 'Cost pool ha cambiado desde la vista previa.',
  });
  expectTranslated('Links of APP-3 changed after the preview was created.', {
    fr: "Les liens de APP-3 ont changé depuis l'aperçu.",
    de: 'Die Verknüpfungen von APP-3 haben sich seit der Vorschau geändert.',
    es: 'Los enlaces de APP-3 han cambiado desde la vista previa.',
  });
  expectTranslated('Links of OPX-12 changed after the preview was created.', {
    fr: "Les liens de OPX-12 ont changé depuis l'aperçu.",
    de: 'Die Verknüpfungen von OPX-12 haben sich seit der Vorschau geändert.',
    es: 'Los enlaces de OPX-12 han cambiado desde la vista previa.',
  });
  expectTranslated('Links on INC-4 changed after the preview was created.', {
    fr: "Les liens sur INC-4 ont changé depuis l'aperçu.",
    de: 'Die Verknüpfungen an INC-4 haben sich seit der Vorschau geändert.',
    es: 'Los enlaces en INC-4 han cambiado desde la vista previa.',
  });
  expectTranslated('Web links of TEC-1 - PostgreSQL changed after the preview was created.', {
    fr: "Les liens web de TEC-1 - PostgreSQL ont changé depuis l'aperçu.",
    de: 'Die Weblinks von TEC-1 - PostgreSQL haben sich seit der Vorschau geändert.',
    es: 'Los enlaces web de TEC-1 - PostgreSQL han cambiado desde la vista previa.',
  });
  expectTranslated('Vulnerability alerts of TEC-1 - PostgreSQL changed after the preview was created.', {
    fr: "Les alertes de vulnérabilité de TEC-1 - PostgreSQL ont changé depuis l'aperçu.",
    de: 'Die Sicherheitswarnungen von TEC-1 - PostgreSQL haben sich seit der Vorschau geändert.',
    es: 'Las alertas de vulnerabilidades de TEC-1 - PostgreSQL han cambiado desde la vista previa.',
  });
  expectTranslated('Versions of TEC-1 - PostgreSQL changed after the preview was created.', {
    fr: "Les versions de TEC-1 - PostgreSQL ont changé depuis l'aperçu.",
    de: 'Die Versionen von TEC-1 - PostgreSQL haben sich seit der Vorschau geändert.',
    es: 'Las versiones de TEC-1 - PostgreSQL han cambiado desde la vista previa.',
  });
  expectTranslated('Document changed after the preview was created.', {
    fr: "Le document a changé depuis l'aperçu.",
    de: 'Das Dokument hat sich seit der Vorschau geändert.',
    es: 'El documento ha cambiado desde la vista previa.',
  });
  expectTranslated('People of TEC-2 - nginx changed after the preview was created.', {
    fr: "Les personnes de TEC-2 - nginx ont changé depuis l'aperçu.",
    de: 'Die Personen von TEC-2 - nginx haben sich seit der Vorschau geändert.',
    es: 'Las personas de TEC-2 - nginx han cambiado desde la vista previa.',
  });
  expectTranslated('Technology "Say "hi"" changed after the preview was created.', {
    fr: "La technologie « Say \"hi\" » a changé depuis l'aperçu.",
    de: 'Die Technologie „Say "hi"“ hat sich seit der Vorschau geändert.',
    es: 'La tecnología «Say "hi"» ha cambiado desde la vista previa.',
  });
  // A known thing is named after the sentence in French and German, which then holds whatever its
  // gender and number; Spanish carries its article (lot K2b).
  expectTranslated('Budget line changed after the preview was created.', {
    fr: "Les données ont changé depuis l'aperçu : Ligne budgétaire.",
    de: 'Die Daten haben sich seit der Vorschau geändert: Budgetzeile.',
    es: 'La línea presupuestaria ha cambiado desde la vista previa.',
  });
  expectTranslated('Tasks changed after the preview was created.', {
    fr: "Les données ont changé depuis l'aperçu : Tâches.",
    de: 'Die Daten haben sich seit der Vorschau geändert: Aufgaben.',
    es: 'Las tareas han cambiado desde la vista previa.',
  });
  expectTranslated('Assignee changed after the preview was created.', {
    fr: "Les données ont changé depuis l'aperçu : Responsable.",
    de: 'Die Daten haben sich seit der Vorschau geändert: Zuständige Person.',
    es: 'El responsable ha cambiado desde la vista previa.',
  });
  expectTranslated('Company metrics for 2024 changed after the preview was created.', {
    fr: "Les indicateurs (Société) pour 2024 ont changé depuis l'aperçu.",
    de: 'Die Kennzahlen (Unternehmen) für 2024 haben sich seit der Vorschau geändert.',
    es: 'Los indicadores (la empresa) para 2024 han cambiado desde la vista previa.',
  });
}

function testMissingRecords() {
  expectTranslated('OPX-12 not found.', {
    fr: 'OPX-12 introuvable.',
    de: 'OPX-12 nicht gefunden.',
    es: 'No se ha encontrado OPX-12.',
  });
  expectTranslated('Task not found.', {
    fr: 'Tâche introuvable.',
    de: 'Aufgabe nicht gefunden.',
    es: 'No se ha encontrado la tarea.',
  });
  expectTranslated('User not found.', {
    fr: 'Utilisateur introuvable.',
    de: 'Benutzer nicht gefunden.',
    es: 'No se ha encontrado el usuario.',
  });
  expectTranslated('Budget line not found.', {
    fr: 'Ligne budgétaire introuvable.',
    de: 'Budgetzeile nicht gefunden.',
    es: 'No se ha encontrado la línea presupuestaria.',
  });
  expectTranslated('Assignee not found.', {
    fr: 'Responsable introuvable.',
    de: 'Zuständige Person nicht gefunden.',
    es: 'No se ha encontrado el responsable.',
  });
  expectTranslated('Asset not found', {
    fr: 'Actif introuvable.',
    de: 'Asset nicht gefunden.',
    es: 'No se ha encontrado el activo.',
  });
  expectTranslated('No task found matching "Migration".', {
    fr: 'Tâche « Migration » introuvable.',
    de: 'Aufgabe „Migration“ nicht gefunden.',
    es: 'No se ha encontrado la tarea «Migration».',
  });
  expectTranslated('No project found matching "O\'Brien "phase"".', {
    fr: 'Projet « O\'Brien "phase" » introuvable.',
    de: 'Projekt „O\'Brien "phase"“ nicht gefunden.',
    es: 'No se ha encontrado el proyecto «O\'Brien "phase"».',
  });
  expectTranslated('Application "CheeseTrack" not found.', {
    fr: 'Application « CheeseTrack » introuvable.',
    de: 'Anwendung „CheeseTrack“ nicht gefunden.',
    es: 'No se ha encontrado la aplicación «CheeseTrack».',
  });
  expectTranslated('Version "16 "LTS"" not found.', {
    fr: 'Version « 16 "LTS" » introuvable.',
    de: 'Version „16 "LTS"“ nicht gefunden.',
    es: 'No se ha encontrado la versión «16 "LTS"».',
  });
  expectTranslated('Budget Lines: the line was not found.', {
    fr: 'Lignes budgétaires : la ligne est introuvable.',
    de: 'Budgetzeilen: die Zeile wurde nicht gefunden.',
    es: 'Las líneas presupuestarias: no se ha encontrado la línea.',
  });
  expectTranslated('Asset Relations: the asset was not found.', {
    fr: "Relations entre actifs : l'actif est introuvable.",
    de: 'Asset-Beziehungen: das Asset wurde nicht gefunden.',
    es: 'Las relaciones entre activos: no se ha encontrado el activo.',
  });
}

function testLeftAsStored() {
  assert.equal(
    previewErrorText('fr', PREVIEW_EXPIRED_MESSAGE),
    "L'aperçu a expiré avant l'approbation.",
  );
  assert.equal(isFixedPreviewError(PREVIEW_EXPIRED_MESSAGE), true);
  const unknown = 'The printer caught fire.';
  for (const language of ['en', ...LANGUAGES] as const) {
    assert.equal(previewErrorText(language, unknown), unknown);
  }
  assert.equal(
    previewErrorText('fr', 'A technology with this name appeared after the preview was created: TEC-3.'),
    'A technology with this name appeared after the preview was created: TEC-3.',
  );
  assert.equal(previewErrorText('de', 'This version already exists.'), 'This version already exists.');
  assert.equal(previewErrorText('fr', null), null);
  assert.equal(previewErrorText('es', undefined), null);
}

testRelationCards();
testDrift();
testMissingRecords();
testLeftAsStored();
testDocumentChangedMeanwhile();

/**
 * A document written by someone else while Kad's approved change wrote it (the 409
 * `document_revision_conflict`, lot I7b of 26.12.1): the card says so in the person's language and
 * asks for the request again, never the API's "Document revision conflict".
 */
function testDocumentChangedMeanwhile() {
  assert.equal(PREVIEW_DOCUMENT_CHANGED_MESSAGE, 'The document changed in the meantime, so nothing was changed. Make the request again.');
  assert.equal(previewErrorText('en', PREVIEW_DOCUMENT_CHANGED_MESSAGE), PREVIEW_DOCUMENT_CHANGED_MESSAGE);
  assert.equal(previewErrorText('fr', PREVIEW_DOCUMENT_CHANGED_MESSAGE), "Le document a changé entre-temps : rien n'a été modifié. Relancez la demande.");
  assert.equal(previewErrorText('de', PREVIEW_DOCUMENT_CHANGED_MESSAGE), 'Das Dokument hat sich inzwischen geändert, daher wurde nichts geändert. Stellen Sie die Anfrage erneut.');
  assert.equal(previewErrorText('es', PREVIEW_DOCUMENT_CHANGED_MESSAGE), 'El documento ha cambiado mientras tanto, así que no se ha modificado nada. Vuelva a hacer la solicitud.');
  assert.equal(isFixedPreviewError(PREVIEW_DOCUMENT_CHANGED_MESSAGE), true);
}
