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
      .toBe('Dieses Element liegt außerhalb Ihres Zugriffs.');
    expect(getApiErrorMessage(refusal('This task is read only in your access.'), i18n.getFixedT('es'), 'fallback'))
      .toBe('Esta tarea es de solo lectura en su acceso.');
    expect(getApiErrorMessage(refusal('BL-12 is read only in your access.'), fr, 'fallback')).toBe('BL-12 est en lecture seule dans votre accès.');
    // A refused delete of an object linked to lines outside the access, per object type.
    expect(getApiErrorMessage(refusal('This application is linked to 3 lines outside your access.'), fr, 'fallback'))
      .toBe('Cette application est liée à 3 lignes hors de votre accès.');
    expect(getApiErrorMessage(refusal('This asset is linked to 1 line outside your access.'), t, 'fallback'))
      .toBe('This asset is linked to 1 line outside your access.');
    expect(getApiErrorMessage(refusal('This request is linked to 2 lines outside your access.'), i18n.getFixedT('de'), 'fallback'))
      .toBe('Diese Anfrage ist mit 2 Zeilen außerhalb Ihres Zugriffs verknüpft.');
    expect(getApiErrorMessage(refusal('This technology is linked to 2 lines outside your access.'), i18n.getFixedT('es'), 'fallback'))
      .toBe('Esta tecnología está vinculada a 2 líneas fuera de su acceso.');
    // Lot 5: contracts are counted too, alone or together with lines.
    expect(getApiErrorMessage(refusal('This application is linked to 2 contracts outside your access.'), fr, 'fallback'))
      .toBe('Cette application est liée à 2 contrats hors de votre accès.');
    expect(getApiErrorMessage(refusal('This asset is linked to 1 contract outside your access.'), i18n.getFixedT('de'), 'fallback'))
      .toBe('Dieses Asset ist mit 1 Vertrag außerhalb Ihres Zugriffs verknüpft.');
    expect(getApiErrorMessage(refusal('This application is linked to 1 line and 2 contracts outside your access.'), fr, 'fallback'))
      .toBe('Cette application est liée à 1 ligne et 2 contrats hors de votre accès.');
    expect(getApiErrorMessage(refusal('This technology is linked to 3 lines and 1 contract outside your access.'), i18n.getFixedT('es'), 'fallback'))
      .toBe('Esta tecnología está vinculada a 3 líneas y 1 contrato fuera de su acceso.');
    // A sentence the screen does not know shows as the server wrote it, never the generic refusal.
    expect(getApiErrorMessage(refusal('Some new refusal.'), fr, 'fallback')).toBe('Some new refusal.');
    expect(getApiErrorMessage(refusal(''), t, 'fallback')).toBe('This item is outside your access.');
    expect(isDataAccessRefusal(refusal('x'))).toBe(true);
    expect(isDataAccessRefusal({ response: { status: 403, data: { code: 'NO_ACCESS' } } })).toBe(false);
    const unavailable = { response: { status: 503, data: { code: 'DATA_ACCESS_UNAVAILABLE', message: 'Data access is temporarily unavailable. Contact the person who runs KANAP.' } } };
    expect(getApiErrorMessage(unavailable, fr, 'fallback'))
      .toBe("L'accès aux données est momentanément indisponible. Contactez la personne qui exploite KANAP.");
  });

  it('translates a repeated data access query in French, with its parameter', () => {
    const repeated = (parameter: string) => ({
      response: {
        status: 400,
        data: {
          code: 'DATA_ACCESS_QUERY_REPEATED',
          message: `${parameter} must be given once.`,
          params: { parameter },
        },
      },
    });
    const fr = i18n.getFixedT('fr');
    expect(getApiErrorMessage(repeated('node_type'), fr, 'fallback')).toBe('Indiquez node_type une seule fois.');
    expect(getApiErrorMessage(repeated('q'), fr, 'fallback')).toBe('Indiquez q une seule fois.');
    for (const language of ['en', 'de', 'es']) {
      const text = getApiErrorMessage(repeated('node_id'), i18n.getFixedT(language), 'fallback');
      expect(text, language).toContain('node_id');
      expect(text, language).not.toBe('node_id must be given once.');
    }
    for (const code of [
      'DATA_ACCESS_MODE_INVALID',
      'DATA_ACCESS_ALL_WITH_NODES',
      'DATA_ACCESS_NODES_INVALID',
      'DATA_ACCESS_NODE_ID_INVALID',
      'DATA_ACCESS_NODE_DUPLICATE',
    ]) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const text = getApiErrorMessage(
          { response: { status: 400, data: { code, message: 'server words' } } },
          i18n.getFixedT(language),
          'fallback',
        );
        expect(text, `${code} in ${language}`).not.toBe('server words');
      }
    }
  });

  it('words a refusal without a code as a missing right, in each language', () => {
    const forbidden = { response: { status: 403, data: { statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' } } };
    expect(getApiErrorMessage(forbidden, t, 'fallback')).toBe('You do not have the rights for this action.');
    expect(getApiErrorMessage(forbidden, i18n.getFixedT('fr'), 'fallback')).toBe("Vous n'avez pas les droits pour cette action.");
    expect(getApiErrorMessage(forbidden, i18n.getFixedT('de'), 'fallback')).toBe('Sie haben keine Berechtigung für diese Aktion.');
    expect(getApiErrorMessage(forbidden, i18n.getFixedT('es'), 'fallback')).toBe('No tiene permisos para esta acción.');
    const coded = { response: { status: 403, data: { code: 'administrator_required', message: 'Administrator required' } } };
    expect(getApiErrorMessage(coded, t, 'fallback')).toBe('Only an administrator of this workspace can do this.');
    const platform = { response: { status: 403, data: { code: 'platform_admin_required', message: 'Platform admin host required' } } };
    expect(getApiErrorMessage(platform, t, 'fallback')).toBe('Only a platform administrator can do this.');
    expect(getApiErrorMessage(platform, i18n.getFixedT('fr'), 'fallback')).toBe('Seul un administrateur de la plateforme peut faire cela.');
    const bare = { code: 'ERR_BAD_REQUEST', message: 'Request failed with status code 403', response: { status: 403, data: {} } };
    expect(getApiErrorMessage(bare, i18n.getFixedT('fr'), 'fallback')).toBe("Vous n'avez pas les droits pour cette action.");
  });

  it('words a coded data access refusal by its reason and values', () => {
    const fr = i18n.getFixedT('fr');
    const refusal = (reason: string, params?: Record<string, unknown>) => ({
      response: {
        status: 403,
        data: {
          statusCode: 403,
          error: 'Forbidden',
          code: 'DATA_ACCESS_LIMITED',
          message: 'The server sentence.',
          reason,
          ...(params ? { params } : {}),
        },
      },
    });

    const sentences: Array<{ reason: string; params?: Record<string, unknown>; text: string }> = [
      { reason: 'outside', text: 'Cet élément est hors de votre accès.' },
      { reason: 'readOnlyLine', text: 'Cette ligne est en lecture seule dans votre accès.' },
      { reason: 'readOnlyContract', text: 'Ce contrat est en lecture seule dans votre accès.' },
      { reason: 'placement', text: 'Cette société ou ce centre de coûts ne fait pas partie de votre accès.' },
      { reason: 'reserved', text: 'Cette action est réservée aux personnes qui ont accès à toutes les données.' },
      { reason: 'chargebackCompany', text: 'La refacturation de cette société est hors de votre accès.' },
      { reason: 'readOnlyTask', text: 'Cette tâche est en lecture seule dans votre accès.' },
      { reason: 'taskDelete', text: 'Seule une personne qui peut modifier la ligne ou le contrat de cette tâche peut la supprimer.' },
      { reason: 'leavesAccess', text: "Ce changement sortirait la ligne de votre accès. Restez l'un de ses responsables, ou demandez à une personne qui a accès à sa société." },
      { reason: 'readOnlyRef', params: { ref: 'BL-12' }, text: 'BL-12 est en lecture seule dans votre accès.' },
    ];
    for (const { reason, params, text } of sentences) {
      expect(getApiErrorMessage(refusal(reason, params), fr, 'fallback'), reason).toBe(text);
    }

    // Hidden links: lines alone, contracts alone, both; the counts come from the body's params.
    expect(getApiErrorMessage(refusal('hiddenLinks', { owner: 'application', lines: 3, contracts: 0 }), fr, 'fallback'))
      .toBe('Cette application est liée à 3 lignes hors de votre accès.');
    expect(getApiErrorMessage(refusal('hiddenLinks', { owner: 'asset', lines: 0, contracts: 1 }), fr, 'fallback'))
      .toBe('Cet actif est lié à 1 contrat hors de votre accès.');
    expect(getApiErrorMessage(refusal('hiddenLinks', { owner: 'application', lines: 1, contracts: 2 }), fr, 'fallback'))
      .toBe('Cette application est liée à 1 ligne et 2 contrats hors de votre accès.');

    // An older API, or a reason the screen does not know, keeps the sentence path.
    const legacy = { response: { status: 403, data: { code: 'DATA_ACCESS_LIMITED', message: 'This application is linked to 2 contracts outside your access.' } } };
    expect(getApiErrorMessage(legacy, fr, 'fallback')).toBe('Cette application est liée à 2 contrats hors de votre accès.');
    const unknownReason = {
      response: {
        status: 403,
        data: { code: 'DATA_ACCESS_LIMITED', reason: 'a_new_refusal', message: 'This line is read only in your access.' },
      },
    };
    expect(getApiErrorMessage(unknownReason, fr, 'fallback')).toBe('Cette ligne est en lecture seule dans votre accès.');
  });

  it('names the module right a coded refusal is missing', () => {
    const missing = {
      response: {
        status: 403,
        data: {
          statusCode: 403,
          error: 'Forbidden',
          code: 'MODULE_RIGHT_REQUIRED',
          message: 'You do not have the rights for this action.',
          params: { resource: 'budget', level: 'reader' },
        },
      },
    };
    expect(getApiErrorMessage(missing, i18n.getFixedT('fr'), 'fallback')).toBe(
      'Il vous manque le droit «\u00a0Lecteur\u00a0» sur «\u00a0Budget\u00a0». Demandez-le à un administrateur de votre espace.',
    );
    expect(getApiErrorMessage(missing, t, 'fallback')).toBe(
      'You need the “Reader” right on “Budget”. Ask an administrator of your workspace.',
    );
    const unknown = {
      response: {
        status: 403,
        data: { code: 'MODULE_RIGHT_REQUIRED', message: 'You do not have the rights for this action.', params: { resource: 'not_a_module', level: 'reader' } },
      },
    };
    expect(getApiErrorMessage(unknown, t, 'fallback')).toBe(
      'You need the “Reader” right on “not_a_module”. Ask an administrator of your workspace.',
    );
  });

  it('translates every coded 403 of the core modules in the four languages', () => {
    const refusal = (code: string, params?: Record<string, unknown>) => ({
      response: { status: 403, data: { statusCode: 403, error: 'Forbidden', code, message: 'English sentence of the server.', ...(params ? { params } : {}) } },
    });
    const cases: Array<[string, Record<string, unknown> | undefined, Record<string, string>]> = [
      ['BRANDING_NOT_ON_PLATFORM_HOST', undefined, { en: 'Branding is set inside a workspace. Open a workspace to change it.', fr: "L'identité visuelle se règle dans un espace de travail. Ouvrez un espace pour la modifier." }],
      ['BUSINESS_CONTRIBUTOR_NO_ACCESS', { family: 'interface_bindings' }, { en: 'Your role does not give access to interface bindings.', fr: "Votre rôle ne donne pas accès aux liaisons d'interface.", de: 'Ihre Rolle gibt keinen Zugriff auf Schnittstellen-Bindungen.', es: 'Su rol no da acceso a enlaces de interfaz.' }],
      ['BUSINESS_CONTRIBUTOR_SCOPE', { family: 'applications' }, { en: 'Your role gives access only to the applications you are assigned to.', fr: 'Pour les applications, votre rôle donne accès uniquement aux éléments qui vous sont affectés.' }],
      ['OUTSIDE_PARTICIPATION', { family: 'projects' }, { en: 'You can only link projects you take part in.', fr: 'Pour les projets, vous ne pouvez lier que les éléments auxquels vous participez.', de: 'Bei Projekte können Sie nur Einträge verknüpfen, an denen Sie beteiligt sind.', es: 'En proyectos, solo puede vincular los elementos en los que participa.' }],
      ['LINKED_MODULE_NOT_READABLE', { resources: ['applications', 'infrastructure'] }, { en: 'You cannot change the links to Applications and Infrastructure: your role does not give you access to them.', fr: 'Vous ne pouvez pas modifier les liens vers Applications et Infrastructure\u00a0: votre rôle ne vous y donne pas accès.' }],
      ['LINKED_MODULE_NOT_READABLE', { resources: ['incidents'] }, { en: 'You cannot change the links to Incidents: your role does not give you access to them.' }],
      ['LIBRARY_NOT_MANAGEABLE', undefined, { en: 'You are not allowed to manage this library.', fr: "Vous n'avez pas le droit de gérer cette bibliothèque." }],
      ['OWN_COMMENTS_ONLY', undefined, { en: 'You can only edit your own comments.', fr: 'Vous ne pouvez modifier que vos propres commentaires.' }],
      ['TIME_ENTRY_CREATE_SELF_ONLY', undefined, { en: 'You can only create time entries for yourself.' }],
      ['TIME_ENTRY_EDIT_OWN_ONLY', undefined, { en: 'You can only edit your own time entries.' }],
      ['TIME_ENTRY_DELETE_OWN_ONLY', undefined, { en: 'You can only delete your own time entries.' }],
      ['TIME_ENTRY_EDIT_OWN_OR_ASSIGNED', undefined, { en: 'You can only edit time entries you logged or that are assigned to you.' }],
      ['TIME_ENTRY_DELETE_OWN_OR_ASSIGNED', undefined, { en: 'You can only delete time entries you logged or that are assigned to you.' }],
      ['REQUEST_CONTEXT_MISSING', undefined, { en: 'Your session could not be identified. Reload the page or sign in again.', fr: "Votre session n'a pas pu être identifiée. Rechargez la page ou reconnectez-vous." }],
      ['INCIDENT_LOCKED', undefined, { en: 'This incident is closed. Reopen it to make changes.', fr: 'Cet incident est clos. Rouvrez-le pour le modifier.' }],
      ['INCIDENT_CONFIDENTIAL_LIFT', undefined, { en: 'Only a register administrator can lift this restriction.' }],
      ['INCIDENT_REVIEW_LOCKED', undefined, { en: 'This incident is closed. Reopen it to change its review.' }],
      ['TASK_OUTSIDE_SCOPE', undefined, { en: 'This task is outside the tasks you take part in.' }],
      ['WORKFLOW_CANCEL_NOT_ALLOWED', undefined, { en: 'Only the owner, the requester or a participant can cancel this review.' }],
      ['WORKFLOW_STAGE_NOT_ASSIGNED', undefined, { en: 'You are not assigned to the current stage of this review.' }],
      ['DOCUMENT_SHARE_EXTERNAL_REFUSED', undefined, { en: 'This document belongs to an incident review and cannot be shared outside KANAP.' }],
      ['DOCUMENT_RECIPIENT_NOT_ALLOWED', undefined, { en: 'One of the recipients cannot open this document, so nothing was shared.' }],
      ['FEATURE_DISABLED', undefined, { en: 'This feature is turned off in this deployment.' }],
      ['lookup_search_forbidden', undefined, { en: 'Your role can show the chosen values but cannot search this list.' }],
      ['PROFILE_FIELD_FROM_ENTRA', undefined, { en: 'The job title comes from Microsoft Entra and cannot be changed here.' }],
    ];
    for (const [code, params, expected] of cases) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const text = getApiErrorMessage(refusal(code, params), i18n.getFixedT(language), 'fallback');
        // Every language has its own sentence, never the English one of the server or the generic refusal.
        expect(text, `${code} ${language}`).not.toBe('English sentence of the server.');
        expect(text, `${code} ${language}`).not.toBe('fallback');
        expect(text, `${code} ${language}`).not.toBe(i18n.getFixedT(language)('errors:forbidden'));
        expect(text, `${code} ${language}`).not.toContain('{{');
        expect(text, `${code} ${language}`).not.toContain('errors:');
        if (expected[language]) expect(text, `${code} ${language}`).toBe(expected[language]);
      }
    }
    // The list of modules follows the language of the screen.
    expect(getApiErrorMessage(refusal('LINKED_MODULE_NOT_READABLE', { resources: ['applications', 'infrastructure', 'incidents'] }), t, 'fallback'))
      .toBe('You cannot change the links to Applications, Infrastructure, and Incidents: your role does not give you access to them.');
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
    expect(getApiErrorMessage(taken, fr, 'fallback')).toBe('Une application porte déjà ce nom\u00a0: APP-12.');
    const suite = { response: { status: 409, data: { code: 'suite_has_children', message: 'Detach', params: { count: 3 } } } };
    expect(getApiErrorMessage(suite, fr, 'fallback')).toBe('Retirez d\'abord les 3 applications rattachées.');
    const oneChild = { response: { status: 409, data: { code: 'suite_has_children', message: 'Detach', params: { count: 1 } } } };
    expect(getApiErrorMessage(oneChild, fr, 'fallback')).toBe('Retirez d\'abord l\'application rattachée.');
    expect(getApiErrorMessage(oneChild, t, 'fallback')).toBe('Detach the child application first.');
    const cycle = { response: { status: 409, data: { code: 'suite_cycle', message: 'cycle', params: { name: 'ERP' } } } };
    expect(getApiErrorMessage(cycle, fr, 'fallback')).toBe('Cette application contient déjà ERP\u00a0: elle ne peut pas en faire partie.');
    const duration = { response: { status: 400, data: { code: 'duration_invalid', message: 'rto_minutes must be', params: { field: 'rto_minutes', value: '1.5' } } } };
    expect(getApiErrorMessage(duration, fr, 'fallback')).toBe("L'objectif de temps de reprise (RTO) doit être un nombre entier de minutes.");
    expect(getApiErrorMessage({ response: { status: 400, data: { ...duration.response.data, params: { field: 'rpo_minutes' } } } }, t, 'fallback'))
      .toBe('The recovery point objective (RPO) must be a whole number of minutes.');
    const owner = { response: { status: 400, data: { code: 'owner_email_unknown', message: 'No user', params: { email: 'x@example.com' } } } };
    expect(getApiErrorMessage(owner, fr, 'fallback')).toBe('Aucun utilisateur avec le courriel x@example.com.');
    const allowed = 'line_of_business (Line-of-business), productivity (Productivity)';
    const category = { response: { status: 400, data: { code: 'category_invalid', message: 'server words', params: { value: 'business', allowed } } } };
    expect(getApiErrorMessage(category, t, 'fallback')).toBe(`Unknown category: business. Use a category from the list, by its name or its code. Use one of: ${allowed}.`);
    expect(getApiErrorMessage(category, fr, 'fallback')).toBe(`Catégorie inconnue\u00a0: business. Utilisez une catégorie de la liste, par son nom ou son code. Valeurs possibles\u00a0: ${allowed}.`);
    const lifecycle = { response: { status: 400, data: { code: 'lifecycle_invalid', message: 'server words', params: { value: 'Bogus', allowed: 'active (Active), retired (Retired)' } } } };
    expect(getApiErrorMessage(lifecycle, i18n.getFixedT('de'), 'fallback')).toBe('Unbekannter Lebenszyklus: Bogus. Verwenden Sie einen Lebenszyklus aus der Liste, mit Namen oder Code. Mögliche Werte: active (Active), retired (Retired).');
    expect(getApiErrorMessage(lifecycle, i18n.getFixedT('es'), 'fallback')).toBe('Ciclo de vida desconocido: Bogus. Use un ciclo de vida de la lista, por su nombre o su código. Valores posibles: active (Active), retired (Retired).');
    for (const code of ['name_required', 'name_ambiguous', 'name_too_long', 'lifecycle_invalid', 'category_invalid', 'classification_unknown', 'duration_invalid', 'dates_inconsistent', 'suite_has_children', 'suite_cycle']) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const text = getApiErrorMessage({ response: { status: 400, data: { code, message: 'server words', params: { value: 'v', name: 'n', count: 2, max: 200, field: 'rto_minutes', allowed: 'active (Active)' } } } }, i18n.getFixedT(language), 'fallback');
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
    expect(getApiErrorMessage(date, fr, 'fallback')).toBe('La date «\u00a0Depuis\u00a0» n’est pas une date valide.');
    const inUse = { response: { status: 409, data: { code: 'DEPLOYMENT_IN_USE', message: 'Cannot delete', usages: [{ type: 'server_assignments', total: 2 }] } } };
    expect(getApiErrorMessage(inUse, t, 'fallback')).toMatch(/^This deployment still has 2 .+\. Remove them first\.$/);
    const inherited = { response: { status: 409, data: { code: 'assignment_inherited', message: 'Already inherited', params: { cluster: 'ESX Paris' } } } };
    expect(getApiErrorMessage(inherited, fr, 'fallback')).toBe('Déjà hébergée par ce serveur via ESX Paris.');
    for (const code of ['assignment_duplicate', 'assignment_inherited', 'assignment_role_invalid', 'deployment_environment_taken', 'deployment_lifecycle_invalid', 'date_invalid']) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const text = getApiErrorMessage({ response: { status: 400, data: { code, message: 'server words', params: { value: 'v', environment: 'prod', field: 'since_date', cluster: 'ESX Paris' } } } }, i18n.getFixedT(language), 'fallback');
        expect(text, `${code} in ${language}`).not.toBe('server words');
        expect(text).not.toMatch(/{{|since_date|\bprod\b/);
      }
    }
  });

  it('translates the cluster refusals, with their values', () => {
    const fr = i18n.getFixedT('fr');
    const members = { response: { status: 400, data: { code: 'cluster_has_members', message: 'server words', params: { count: 3 } } } };
    expect(getApiErrorMessage(members, fr, 'fallback')).toBe('Retirez d\'abord ses 3 membres.');
    expect(getApiErrorMessage(members, t, 'fallback')).toBe('Remove its 3 members first.');
    const member = { response: { status: 400, data: { code: 'cluster_switch_member', message: 'server words', params: { cluster: 'ESX-PAR' } } } };
    expect(getApiErrorMessage(member, fr, 'fallback')).toBe('Membre de ESX-PAR\u00a0: il ne peut pas devenir un cluster.');
    const os = { response: { status: 400, data: { code: 'os_cluster_with_members', message: 'server words' } } };
    expect(getApiErrorMessage(os, fr, 'fallback')).toBe('Ce cluster a des membres\u00a0: pas de système d\'exploitation.');
    const codes = [
      'cluster_has_members', 'cluster_switch_member', 'cluster_member_self', 'cluster_member_is_cluster',
      'cluster_member_not_found', 'cluster_os_with_members', 'os_cluster_with_members',
      'CSV_CLUSTER_NOT_FOUND', 'CSV_CLUSTER_AMBIGUOUS', 'CSV_CLUSTER_NOT_A_CLUSTER',
    ];
    for (const code of codes) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const params = { count: 1, cluster: 'ESX-PAR', name: 'ESX-LYO', os: 'Ubuntu 22.04' };
        const text = getApiErrorMessage({ response: { status: 400, data: { code, message: 'server words', params } } }, i18n.getFixedT(language), 'fallback');
        expect(text, `${code} in ${language}`).not.toBe('server words');
        expect(text).not.toMatch(/{{|—/);
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
      'Cet actif est utilisé par 1 affectation à une application et 2 connexions. Retirez-le de chacun d\'eux avant de le supprimer.',
    );
    // One subfolder: the sentence says "it", not "them".
    const folder = { response: { status: 409, data: { code: 'KNOWLEDGE_FOLDER_HAS_SUBFOLDERS', message: 'raw', usages: [{ type: 'sub_folders', total: 1 }] } } };
    expect(getApiErrorMessage(folder, i18n.getFixedT('fr'), 'fallback')).toBe('Ce dossier contient encore 1 sous-dossier. Déplacez-le ou supprimez-le d’abord.');
    expect(getApiErrorMessage(folder, t, 'fallback')).toBe('This folder still has 1 subfolder. Move or delete it first.');
    expect(getApiErrorMessage({ response: { status: 409, data: { code: 'USER_OWN_ACCOUNT', message: 'raw', usages: [] } } }, i18n.getFixedT('de'), 'fallback'))
      .toBe('Sie können Ihr eigenes Konto nicht löschen. Deaktivieren Sie es bei Bedarf.');
  });

  it('names the applications an asset delete refusal carries', () => {
    const refused = {
      response: {
        status: 409,
        data: {
          code: 'ASSET_IN_USE',
          message: 'Cannot delete asset "srv-01": has 1 application assignment(s): CheeseTrack (PROD)',
          usages: [{ type: 'app_assignments', total: 1 }],
          applications: ['CheeseTrack'],
        },
      },
    };
    expect(getApiErrorMessage(refused, t, 'fallback')).toBe(
      'This asset is used by 1 application assignment (CheeseTrack). Remove it from there before deleting it.',
    );
    expect(getApiErrorMessage(refused, i18n.getFixedT('fr'), 'fallback')).toBe(
      'Cet actif est utilisé par 1 affectation à une application (CheeseTrack). Retirez-le de là avant de le supprimer.',
    );
  });

  it('names the connections an asset delete refusal carries', () => {
    const refused = {
      response: {
        status: 409,
        data: {
          code: 'ASSET_IN_USE',
          message: 'Cannot delete asset "srv-01": is linked to 1 connection(s): CONN-4 · Paris to Gouda',
          usages: [{ type: 'connections', total: 1 }],
          connections: ['CONN-4 · Paris to Gouda'],
        },
      },
    };
    expect(getApiErrorMessage(refused, t, 'fallback')).toBe(
      'This asset is used by 1 connection (CONN-4 · Paris to Gouda). Remove it from there before deleting it.',
    );
    expect(getApiErrorMessage(refused, i18n.getFixedT('fr'), 'fallback')).toBe(
      'Cet actif est utilisé par 1 connexion (CONN-4 · Paris to Gouda). Retirez-le de là avant de le supprimer.',
    );
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
      '«\u00a0Analytics\u00a0» est encore utilisée par 2 applications et 1 déploiement. Cochez «\u00a0Ne plus proposer\u00a0» au lieu de la supprimer.',
    );
    for (const lang of ['de', 'es']) {
      const text = getApiErrorMessage(inUse, i18n.getFixedT(lang), 'fallback');
      expect(text, lang).toContain('Analytics');
      expect(text, lang).not.toBe('English');
    }
  });

  it('keeps a server message, and uses the screen fallback when the server sends none', () => {
    const fallback = 'The import failed. Try again.';
    expect(getApiErrorMessage({ response: { status: 500, data: { message: 'Server said' } } }, t, fallback)).toBe('Server said');
    // A 500 that also carries the HTTP client's own sentence still keeps the server's message.
    expect(getApiErrorMessage(
      { message: 'Request failed with status code 500', code: 'ERR_BAD_RESPONSE', response: { status: 500, data: { message: 'Server said' } } },
      t,
      fallback,
    )).toBe('Server said');
    // No response: the API is unreachable.
    expect(getApiErrorMessage({ message: 'Network Error', code: 'ERR_NETWORK' }, t, fallback)).toBe(fallback);
    // A 502 with no body, and a gateway page that is not a message.
    expect(getApiErrorMessage(
      { message: 'Request failed with status code 502', code: 'ERR_BAD_RESPONSE', response: { status: 502, data: '' } },
      t,
      fallback,
    )).toBe(fallback);
    expect(getApiErrorMessage(
      { message: 'Request failed with status code 502', code: 'ERR_BAD_RESPONSE', response: { status: 502, data: '<html><title>502 Bad Gateway</title></html>' } },
      t,
      fallback,
    )).toBe(fallback);
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
