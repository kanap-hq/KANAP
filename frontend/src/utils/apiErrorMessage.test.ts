import '../i18n';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, getDocumentSaveErrorMessage, isDataAccessRefusal } from './apiErrorMessage';

const t = i18n.getFixedT('en');

describe('getApiErrorMessage', () => {
  it('words each refusal of a limited data access in the language of the screen', () => {
    const refusal = (message: string) => ({ response: { status: 403, data: { statusCode: 403, error: 'Forbidden', code: 'DATA_ACCESS_LIMITED', message } } });
    const fr = i18n.getFixedT('fr');
    expect(getApiErrorMessage(refusal('This line is read only in your access.'), fr, 'fallback')).toBe('Cette ligne est en lecture seule dans votre accès.');
    expect(getApiErrorMessage(refusal('This company or cost center is not part of your access.'), fr, 'fallback'))
      .toBe('Cette société ou ce centre de coûts ne fait pas partie de votre accès.');
    expect(getApiErrorMessage(refusal('This action is reserved to people with access to all data.'), fr, 'fallback'))
      .toBe('Cette action est réservée aux personnes qui ont accès à toutes les données.');
    expect(getApiErrorMessage(refusal('This item is outside your data access.'), i18n.getFixedT('de'), 'fallback'))
      .toBe('Dieses Element liegt außerhalb Ihres Datenzugriffs.');
    expect(getApiErrorMessage(refusal('This task is read only in your access.'), i18n.getFixedT('es'), 'fallback'))
      .toBe('Esta tarea es de solo lectura en su acceso.');
    expect(getApiErrorMessage(refusal('BL-12 is read only in your access.'), fr, 'fallback')).toBe('BL-12 est en lecture seule dans votre accès.');
    // A sentence the screen does not know shows as the server wrote it, never the generic refusal.
    expect(getApiErrorMessage(refusal('Some new refusal.'), fr, 'fallback')).toBe('Some new refusal.');
    expect(getApiErrorMessage(refusal(''), t, 'fallback')).toBe('This item is outside your data access.');
    expect(isDataAccessRefusal(refusal('x'))).toBe(true);
    expect(isDataAccessRefusal({ response: { status: 403, data: { code: 'NO_ACCESS' } } })).toBe(false);
    const unavailable = { response: { status: 503, data: { code: 'DATA_ACCESS_UNAVAILABLE', message: 'Data access is temporarily unavailable. Contact the person who runs KANAP.' } } };
    expect(getApiErrorMessage(unavailable, fr, 'fallback'))
      .toBe("L'accès aux données est momentanément indisponible. Contactez la personne qui exploite KANAP.");
  });

  it('words a refusal without a code as a missing right, in each language', () => {
    const forbidden = { response: { status: 403, data: { statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' } } };
    expect(getApiErrorMessage(forbidden, t, 'fallback')).toBe('You do not have the rights for this action.');
    expect(getApiErrorMessage(forbidden, i18n.getFixedT('fr'), 'fallback')).toBe("Vous n'avez pas les droits pour cette action.");
    expect(getApiErrorMessage(forbidden, i18n.getFixedT('de'), 'fallback')).toBe('Sie haben keine Berechtigung für diese Aktion.');
    expect(getApiErrorMessage(forbidden, i18n.getFixedT('es'), 'fallback')).toBe('No tiene permisos para esta acción.');
    const coded = { response: { status: 403, data: { code: 'administrator_required', message: 'Administrator required' } } };
    expect(getApiErrorMessage(coded, t, 'fallback')).toBe('Only an administrator of this workspace can do this.');
    const bare = { code: 'ERR_BAD_REQUEST', message: 'Request failed with status code 403', response: { status: 403, data: {} } };
    expect(getApiErrorMessage(bare, i18n.getFixedT('fr'), 'fallback')).toBe("Vous n'avez pas les droits pour cette action.");
  });

  it('says why a refusal coded in its error field happened', () => {
    const trial = { response: { status: 403, data: { error: 'TRIAL_EXPIRED', message: 'Trial expired' } } };
    expect(getApiErrorMessage(trial, t, 'fallback')).toBe('Your trial has expired. Please choose a plan to continue.');
    expect(getApiErrorMessage(trial, i18n.getFixedT('fr'), 'fallback')).toBe("Votre période d'essai a expiré. Veuillez choisir une offre pour continuer.");
    const frozen = { response: { status: 403, data: { error: 'SUBSCRIPTION_FROZEN', message: 'Frozen' } } };
    expect(getApiErrorMessage(frozen, i18n.getFixedT('de'), 'fallback')).toBe('Ihr Abonnement ist eingefroren.');
    for (const language of ['en', 'fr', 'de', 'es']) {
      const noAccess = { response: { status: 403, data: { error: 'NO_ACCESS', message: 'This account has not been granted access yet.' } } };
      const text = getApiErrorMessage(noAccess, i18n.getFixedT(language), 'fallback');
      expect(text, language).not.toBe('This account has not been granted access yet.');
      expect(text).not.toBe(i18n.getFixedT(language)('errors:forbidden'));
    }
  });

  it('translates the application refusals with their values', () => {
    const fr = i18n.getFixedT('fr');
    const taken = { response: { status: 409, data: { code: 'name_taken', message: 'Another application is already named "CRM"', params: { name: 'CRM', ref: 'APP-12' } } } };
    expect(getApiErrorMessage(taken, fr, 'fallback')).toBe('Une application porte déjà ce nom : APP-12.');
    const suite = { response: { status: 409, data: { code: 'suite_has_children', message: 'Detach', params: { count: 3 } } } };
    expect(getApiErrorMessage(suite, fr, 'fallback')).toBe('Retirez d\'abord les 3 applications rattachées.');
    const oneChild = { response: { status: 409, data: { code: 'suite_has_children', message: 'Detach', params: { count: 1 } } } };
    expect(getApiErrorMessage(oneChild, fr, 'fallback')).toBe('Retirez d\'abord l\'application rattachée.');
    expect(getApiErrorMessage(oneChild, t, 'fallback')).toBe('Detach the child application first.');
    const cycle = { response: { status: 409, data: { code: 'suite_cycle', message: 'cycle', params: { name: 'ERP' } } } };
    expect(getApiErrorMessage(cycle, fr, 'fallback')).toBe('Cette application contient déjà ERP : elle ne peut pas en faire partie.');
    const duration = { response: { status: 400, data: { code: 'duration_invalid', message: 'rto_minutes must be', params: { field: 'rto_minutes', value: '1.5' } } } };
    expect(getApiErrorMessage(duration, fr, 'fallback')).toBe("L'objectif de temps de reprise (RTO) doit être un nombre entier de minutes.");
    expect(getApiErrorMessage({ response: { status: 400, data: { ...duration.response.data, params: { field: 'rpo_minutes' } } } }, t, 'fallback'))
      .toBe('The recovery point objective (RPO) must be a whole number of minutes.');
    const owner = { response: { status: 400, data: { code: 'owner_email_unknown', message: 'No user', params: { email: 'x@example.com' } } } };
    expect(getApiErrorMessage(owner, fr, 'fallback')).toBe('Aucun utilisateur avec le courriel x@example.com.');
    for (const code of ['name_required', 'name_ambiguous', 'name_too_long', 'lifecycle_invalid', 'category_invalid', 'classification_unknown', 'duration_invalid', 'dates_inconsistent', 'suite_has_children', 'suite_cycle']) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const text = getApiErrorMessage({ response: { status: 400, data: { code, message: 'server words', params: { value: 'v', name: 'n', count: 2, max: 200, field: 'rto_minutes' } } } }, i18n.getFixedT(language), 'fallback');
        expect(text, `${code} in ${language}`).not.toBe('server words');
        expect(text).not.toMatch(/{{|rto_minutes/);
      }
    }
  });

  it('translates the deployment and server refusals, the environment by its name', () => {
    const fr = i18n.getFixedT('fr');
    const taken = { response: { status: 409, data: { code: 'deployment_environment_taken', message: 'Environment', params: { environment: 'pre_prod' } } } };
    expect(getApiErrorMessage(taken, fr, 'fallback')).toBe('Cette application a déjà un déploiement Préproduction.');
    expect(getApiErrorMessage(taken, t, 'fallback')).toBe('This application already has a Pre-production deployment.');
    const duplicate = { response: { status: 409, data: { code: 'assignment_duplicate', message: 'Asset already assigned' } } };
    expect(getApiErrorMessage(duplicate, fr, 'fallback')).toBe('Ce serveur a déjà ce rôle sur ce déploiement.');
    const date = { response: { status: 400, data: { code: 'date_invalid', message: 'since_date', params: { field: 'since_date', value: 'x' } } } };
    expect(getApiErrorMessage(date, fr, 'fallback')).toBe('La date « Depuis » n’est pas une date valide.');
    const inUse = { response: { status: 409, data: { code: 'DEPLOYMENT_IN_USE', message: 'Cannot delete', usages: [{ type: 'server_assignments', total: 2 }] } } };
    expect(getApiErrorMessage(inUse, t, 'fallback')).toMatch(/^This deployment still has 2 .+\. Remove them first\.$/);
    for (const code of ['assignment_duplicate', 'assignment_cluster', 'assignment_role_invalid', 'deployment_environment_taken', 'deployment_lifecycle_invalid', 'date_invalid']) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const text = getApiErrorMessage({ response: { status: 400, data: { code, message: 'server words', params: { value: 'v', environment: 'prod', field: 'since_date' } } } }, i18n.getFixedT(language), 'fallback');
        expect(text, `${code} in ${language}`).not.toBe('server words');
        expect(text).not.toMatch(/{{|since_date|\bprod\b/);
      }
    }
  });

  it('translates a turnover that cannot be compared because every selected company lacks a rate', () => {
    const missing = {
      response: {
        status: 400,
        data: {
          code: 'turnover_fx_missing_all',
          message: 'No exchange rate from ZAR to EUR for 2026: the turnover of the selected companies cannot be compared. Enter the rate, or choose another allocation driver.',
        },
      },
    };
    expect(getApiErrorMessage(missing, t, 'fallback')).toBe(
      'None of the selected companies has an exchange rate into the reporting currency. Their turnover cannot be compared. Enter the rates, or choose another allocation driver.',
    );
    expect(getApiErrorMessage(missing, i18n.getFixedT('fr'), 'fallback')).toBe(
      "Aucune des sociétés sélectionnées n'a de taux de change vers la devise de reporting. Leur chiffre d'affaires ne peut pas être comparé. Saisissez les taux, ou choisissez un autre critère de répartition.",
    );
    expect(getApiErrorMessage(missing, i18n.getFixedT('de'), 'fallback')).toBe(
      'Keines der ausgewählten Unternehmen hat einen Wechselkurs in die Reporting-Währung. Ihr Umsatz kann nicht verglichen werden. Geben Sie die Kurse ein, oder wählen Sie ein anderes Zuordnungskriterium.',
    );
    expect(getApiErrorMessage(missing, i18n.getFixedT('es'), 'fallback')).toBe(
      'Ninguna de las empresas seleccionadas tiene un tipo de cambio hacia la moneda de reporting. Su facturación no se puede comparar. Introduzca los tipos, o elija otro criterio de asignación.',
    );
  });

  it('translates a code', () => {
    expect(getApiErrorMessage({ response: { status: 400, data: { code: 'confirmation_mismatch', message: 'raw' } } }, t, 'fallback'))
      .toBe('The name typed does not match the name of the workspace.');
  });

  // QA lot 14: a missing incident read "Incident not found" in English in every language.
  it('translates a missing incident in each language', () => {
    const missing = { response: { status: 404, data: { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' } } };
    expect(getApiErrorMessage(missing, t, 'fallback')).toBe('This incident does not exist or you cannot see it.');
    expect(getApiErrorMessage(missing, i18n.getFixedT('fr'), 'fallback')).toBe("Cet incident n'existe pas ou vous ne pouvez pas le voir.");
    expect(getApiErrorMessage(missing, i18n.getFixedT('de'), 'fallback')).toBe('Dieser Vorfall existiert nicht oder Sie können ihn nicht sehen.');
    expect(getApiErrorMessage(missing, i18n.getFixedT('es'), 'fallback')).toBe('Este incidente no existe o no puede verlo.');
  });

  it('translates a rate limit, which carries no code', () => {
    expect(getApiErrorMessage(
      { response: { status: 429, data: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } } },
      t,
      'fallback',
    )).toBe('Too many attempts. Wait a few minutes and try again.');
  });

  it('reads the variant of a message for this installation', () => {
    const unavailable = (variant?: string) => ({
      response: { status: 503, data: { code: 'MARKDOWN_UNAVAILABLE', message: 'raw', ...(variant ? { variant } : {}) } },
    });
    expect(getApiErrorMessage(unavailable(), t, 'fallback')).toBe('Formatted texts cannot be saved right now. Try again in a few minutes.');
    expect(getApiErrorMessage(unavailable('onprem'), t, 'fallback')).toBe(
      'Formatted texts cannot be saved on this server right now. Ask your administrator to check the API logs.',
    );
    expect(getApiErrorMessage(unavailable('onprem'), i18n.getFixedT('fr'), 'fallback')).toMatch(/^Les textes mis en forme ne peuvent pas être enregistrés sur ce serveur/);
  });

  it('words a refused delete with its counts, in the language of the interface', () => {
    const refused = {
      response: {
        status: 409,
        data: { code: 'ASSET_IN_USE', message: 'Cannot delete asset "srv-01": is linked to 2 connection(s)', usages: [{ type: 'app_assignments', total: 1 }, { type: 'connections', total: 2 }] },
      },
    };
    expect(getApiErrorMessage(refused, t, 'fallback')).toBe(
      'This asset is used by 1 application assignment and 2 connections. Remove it from them before deleting it.',
    );
    expect(getApiErrorMessage(refused, i18n.getFixedT('fr'), 'fallback')).toBe(
      'Cet actif est utilisé par 1 affectation à une application et 2 connexions. Retirez-le de ces éléments avant de le supprimer.',
    );
    // One subfolder: the sentence says "it", not "them".
    const folder = { response: { status: 409, data: { code: 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS', message: 'raw', usages: [{ type: 'sub_folders', total: 1 }] } } };
    expect(getApiErrorMessage(folder, i18n.getFixedT('fr'), 'fallback')).toBe('Ce dossier contient encore 1 sous-dossier. Déplacez-le ou supprimez-le d’abord.');
    expect(getApiErrorMessage(folder, t, 'fallback')).toBe('This folder still has 1 subfolder. Move or delete it first.');
    expect(getApiErrorMessage({ response: { status: 409, data: { code: 'USER_OWN_ACCOUNT', message: 'raw', usages: [] } } }, i18n.getFixedT('de'), 'fallback'))
      .toBe('Sie können Ihr eigenes Konto nicht löschen. Deaktivieren Sie es bei Bedarf.');
  });

  it('names the values a refusal carries (a frozen column and its year)', () => {
    const frozen = { response: { status: 409, data: { code: 'BUDGET_LINE_FROZEN', message: 'English', usages: [], params: { column: 'Budget', year: 2026 } } } };
    expect(getApiErrorMessage(frozen, i18n.getFixedT('fr'), 'fallback')).toMatch(/^Cette ligne a des montants dans Budget 2026/);
  });

  it('translates a refused company metric', () => {
    const refused = {
      response: {
        status: 400,
        data: { code: 'COMPANY_METRIC_HEADCOUNT_INVALID', message: 'headcount is required and must be a non-negative integer' },
      },
    };
    expect(getApiErrorMessage(refused, t, 'fallback')).toBe('Headcount is required and must be a whole number, 0 or more.');
    expect(getApiErrorMessage(refused, i18n.getFixedT('fr'), 'fallback')).toBe(
      "L'effectif est obligatoire et doit être un nombre entier, 0 ou plus.",
    );
    expect(getApiErrorMessage(refused, i18n.getFixedT('de'), 'fallback')).toBe(
      'Die Mitarbeiterzahl ist erforderlich und muss eine ganze Zahl ab 0 sein.',
    );
    expect(getApiErrorMessage(refused, i18n.getFixedT('es'), 'fallback')).toBe(
      'La plantilla es obligatoria y debe ser un número entero, 0 o más.',
    );
  });

  it('translates a frozen year for each scope, and a refused action', () => {
    const companies = {
      response: {
        status: 403,
        data: {
          code: 'DATA_FROZEN',
          message: 'COMPANIES data for 2028 is frozen',
          variant: 'companies',
          params: { year: 2028, column: 'data', scope: 'COMPANIES' },
        },
      },
    };
    expect(getApiErrorMessage(companies, t, 'fallback')).toBe(
      'Company metrics for 2028 are frozen. A budget administrator can unfreeze them.',
    );
    expect(getApiErrorMessage(companies, i18n.getFixedT('fr'), 'fallback')).toBe(
      'Les indicateurs des sociétés pour 2028 sont gelés. Un administrateur budgétaire peut les dégeler.',
    );
    expect(getApiErrorMessage(companies, i18n.getFixedT('de'), 'fallback')).toBe(
      'Die Kennzahlen der Unternehmen für 2028 sind eingefroren. Ein Budgetadministrator kann die Sperre aufheben.',
    );
    expect(getApiErrorMessage(companies, i18n.getFixedT('es'), 'fallback')).toBe(
      'Los indicadores de las empresas de 2028 están congelados. Un administrador de presupuesto puede descongelarlos.',
    );

    const opex = {
      response: {
        status: 403,
        data: {
          code: 'DATA_FROZEN',
          message: 'OPEX Forecast for 2026 is frozen',
          variant: 'opex',
          params: { year: 2026, column: 'Forecast', scope: 'OPEX' },
        },
      },
    };
    expect(getApiErrorMessage(opex, t, 'fallback')).toBe(
      'OPEX Forecast for 2026 is frozen. A budget administrator can unfreeze it.',
    );

    const copy = {
      response: {
        status: 403,
        data: {
          code: 'DATA_FROZEN_ACTION',
          message: 'Copy not allowed: OPEX Forecast for 2026 is frozen',
          variant: 'opex',
          params: { year: 2026, column: 'Forecast', scope: 'OPEX', action: 'Copy' },
        },
      },
    };
    expect(getApiErrorMessage(copy, i18n.getFixedT('fr'), 'fallback')).toBe(
      "Copy n'est pas autorisé. La colonne Forecast (OPEX) pour 2026 est gelée. Un administrateur budgétaire peut la dégeler.",
    );
  });

  it('words a settings save that removes a value records still use', () => {
    const inUse = {
      response: {
        status: 409,
        data: { code: 'CATALOG_VALUE_IN_USE', message: 'English', usages: [{ type: 'applications', total: 2 }, { type: 'app_instances', total: 1 }], params: { value: 'Analytics' } },
      },
    };
    expect(getApiErrorMessage(inUse, t, 'fallback')).toBe(
      '"Analytics" is still used by 2 applications and 1 deployment. Mark it as no longer offered instead of removing it.',
    );
    expect(getApiErrorMessage(inUse, i18n.getFixedT('fr'), 'fallback')).toBe(
      '« Analytics » est encore utilisée par 2 applications et 1 déploiement. Cochez « Ne plus proposer » au lieu de la supprimer.',
    );
    for (const lang of ['de', 'es']) {
      const text = getApiErrorMessage(inUse, i18n.getFixedT(lang), 'fallback');
      expect(text, lang).toContain('Analytics');
      expect(text, lang).not.toBe('English');
    }
  });

  it('keeps the server message without a code, then the fallback', () => {
    expect(getApiErrorMessage({ response: { status: 500, data: { message: 'Server said' } } }, t, 'fallback')).toBe('Server said');
    expect(getApiErrorMessage({}, t, 'fallback')).toBe('fallback');
  });
});

describe('getDocumentSaveErrorMessage', () => {
  const tooLarge = { response: { status: 400, data: { code: 'MARKDOWN_TOO_LARGE', message: 'content_markdown is too long' } } };

  it('says what to do with a document over the size limit', () => {
    expect(getDocumentSaveErrorMessage(tooLarge, t, 'fallback')).toBe(
      'This document is over the 200 KB of text a save accepts (images do not count). Shorten it to save your changes. The last saved version is kept.',
    );
    expect(getDocumentSaveErrorMessage(tooLarge, i18n.getFixedT('fr'), 'fallback')).toMatch(/^Ce document dépasse les 200 Ko/);
  });

  it('reads any other error as getApiErrorMessage does', () => {
    const tooComplex = { response: { status: 400, data: { code: 'MARKDOWN_TOO_COMPLEX', message: 'raw' } } };
    expect(getDocumentSaveErrorMessage(tooComplex, t, 'fallback')).toBe(getApiErrorMessage(tooComplex, t, 'fallback'));
    expect(getDocumentSaveErrorMessage({}, t, 'fallback')).toBe('fallback');
  });
});
