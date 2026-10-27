/**
 * The sentences the orchestrator writes itself in a write turn, in the person's language: the
 * stops of the write guards. The model writes everything else.
 */

export type AiWriteLanguage = 'en' | 'fr' | 'de' | 'es';

/** The person's stored locale (`fr-FR` reads as `fr`); English when it is missing or unknown. */
export function aiWriteLanguage(locale: string | null | undefined): AiWriteLanguage {
  const code = String(locale ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return code === 'fr' || code === 'de' || code === 'es' ? code : 'en';
}

type Texts = Record<AiWriteLanguage, string>;

/** A bulk change whose previews do not cover every record it concerns: nothing was changed. */
const BULK_PREVIEWS_INCOMPLETE: Texts = {
  en: 'I could not prepare a preview for every record this request concerns. Nothing has been changed.',
  fr: "Je n'ai pas pu préparer un aperçu pour chaque élément concerné par cette demande. Rien n'a été modifié.",
  de: 'Ich konnte nicht für jedes von dieser Anfrage betroffene Element eine Vorschau vorbereiten. Es wurde nichts geändert.',
  es: 'No he podido preparar una vista previa para cada elemento afectado por esta solicitud. No se ha modificado nada.',
};

/** A change the model described or asked about without preparing its preview: nothing was changed. */
const WRITE_PREVIEW_MISSING: Texts = {
  en: 'I could not prepare this change for your approval. Nothing has been changed.',
  fr: "Je n'ai pas pu préparer cette modification pour votre approbation. Rien n'a été modifié.",
  de: 'Ich konnte diese Änderung nicht zur Genehmigung vorbereiten. Es wurde nichts geändert.',
  es: 'No he podido preparar este cambio para su aprobación. No se ha modificado nada.',
};

export function bulkPreviewsIncompleteText(language: AiWriteLanguage): string {
  return BULK_PREVIEWS_INCOMPLETE[language];
}

export function writePreviewMissingText(language: AiWriteLanguage): string {
  return WRITE_PREVIEW_MISSING[language];
}
