import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../../../data-source';
import { DocumentActivity } from '../../../../knowledge/document-activity.entity';
import { DocumentApplication } from '../../../../knowledge/document-application.entity';
import { DocumentAsset } from '../../../../knowledge/document-asset.entity';
import { DocumentAttachment } from '../../../../knowledge/document-attachment.entity';
import { DocumentClassification } from '../../../../knowledge/document-classification.entity';
import { DocumentContributor } from '../../../../knowledge/document-contributor.entity';
import { DocumentEditLock } from '../../../../knowledge/document-edit-lock.entity';
import { DocumentFolder } from '../../../../knowledge/document-folder.entity';
import { DocumentLibrary } from '../../../../knowledge/document-library.entity';
import { DocumentProject } from '../../../../knowledge/document-project.entity';
import { DocumentReference } from '../../../../knowledge/document-reference.entity';
import { DocumentRequest } from '../../../../knowledge/document-request.entity';
import { DocumentTask } from '../../../../knowledge/document-task.entity';
import { DocumentType } from '../../../../knowledge/document-type.entity';
import { DocumentVersion } from '../../../../knowledge/document-version.entity';
import { Document } from '../../../../knowledge/document.entity';
import { IntegratedDocumentBinding } from '../../../../knowledge/integrated-document-binding.entity';
import { KnowledgeService } from '../../../../knowledge/knowledge.service';
import { knowledgePassageQuery } from '../agent-control-knowledge.util';
import { interpreterCandidatePayload, MAX_INTERPRETER_PASSAGES_PER_CANDIDATE } from '../ai-knowledge-search-planner.service';
import { AiReplySynthesisService } from '../ai-reply-synthesis.service';

/**
 * Long documents whose answer lies past the start (bench of 12/11, tickets 38 and 43, family
 * "passage far in a long document"): the passages read for the interpreter hold the answer, then
 * the reply synthesis gets it past its 3,800-character cut. The search words of a ticket are many
 * and most of them also fall in the first sections; the passages are the ones that hold the most
 * of the words a document holds rarely, wherever they are.
 */

function createKnowledgeService(manager: any) {
  return new KnowledgeService(
    manager.getRepository(Document),
    manager.getRepository(DocumentFolder),
    manager.getRepository(IntegratedDocumentBinding),
    manager.getRepository(DocumentLibrary),
    manager.getRepository(DocumentType),
    manager.getRepository(DocumentVersion),
    manager.getRepository(DocumentEditLock),
    manager.getRepository(DocumentAttachment),
    manager.getRepository(DocumentActivity),
    manager.getRepository(DocumentContributor),
    manager.getRepository(DocumentClassification),
    manager.getRepository(DocumentReference),
    manager.getRepository(DocumentApplication),
    manager.getRepository(DocumentAsset),
    manager.getRepository(DocumentProject),
    manager.getRepository(DocumentRequest),
    manager.getRepository(DocumentTask),
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    dataSource,
    {} as any, {} as any, {} as any, {} as any,
  );
}

const HANDBOOK_START = [
  '1. Your first day',
  'Your manager requests your accounts through the onboarding portal at least five business days before your start date. On your first day, the service desk hands you a laptop that is already prepared with your name. You sign in with your corporate email and a temporary password, then Okta asks you to choose your own password. From then on, the same password opens Windows, Microsoft 365, SAP and the VPN.',
  '2. Mail and calendar',
  'Mail and calendars run on Microsoft 365. Outlook is installed on every laptop; on a phone, use the Outlook app. Your mailbox holds 50 GB. Mail older than three years moves to the online archive, which you can still search from Outlook. Your signature follows the company template.',
  '3. Updates',
  'Windows updates are installed every second Tuesday of the month. The laptop asks you to restart within three days; save your work before you restart. Driver and firmware updates for the laptop come through the same channel. If the screen stays black after an update, wait ten minutes before you call the service desk, the update may still be running.',
  '4. Screens and docking stations',
  'Each desk has a docking station and two screens. Plug the laptop in with the single USB-C cable. If a screen stays blank, unplug the cable, wait ten seconds and plug it back. Windows remembers the layout of the screens for each docking station.',
  '5. Printing',
  'Office printers are shared by floor. Print jobs wait in the secure queue until you badge at any printer of the site. Colour printing is limited to marketing and to the sales offices.',
  '6. Software',
  'Software comes from the company portal on your laptop. A request for a new software goes through the service desk, which checks the licence and the security of the editor. Personal software, browser extensions that are not approved and games are not allowed.',
  '7. Phones',
  'Company phones are enrolled in Intune. Install the Company Portal app, sign in with your corporate account and follow the steps. A lost phone is wiped remotely: call the service desk at once.',
  '8. Travel',
  'Before you travel, check that your laptop has the latest updates and that the VPN starts. Mobile data roaming is enabled in the European Union; for other countries, ask the service desk for a travel plan one week ahead. Do not use public USB charging stations.',
  '8a. Files',
  'Personal files go to OneDrive and team files to the team\'s SharePoint site. USB keys are blocked on every laptop, except for the production engineers who need them for the workshop machines. The old network drives are read only since the move to SharePoint.',
  '8b. Security',
  'Never approve an Okta push that you did not request yourself; if this happens, report it to the service desk. Lock your laptop with Windows and L when you leave your desk. Phishing messages are reported with the button in Outlook. The service desk never asks for your password, by mail or by phone.',
  '8c. Meetings',
  'Meeting rooms have a screen and a camera connected to Teams. Start the meeting from the room panel, then join from your laptop with the sound turned off to avoid echo. If the room screen stays on the start page, restart the panel from its menu.',
  '8d. Remote work',
  'From home, start the VPN before you open SAP. Microsoft 365 works without the VPN. If the VPN does not connect, restart the laptop once, then check that the date and time of Windows are right before you call the service desk. Home printers are not supported.',
  '8e. Hardware problems',
  'A broken keyboard, a cracked screen or a battery that no longer holds a charge is repaired by the service desk. Bring the laptop with its charger; a replacement laptop is lent for the duration of the repair. Back up your files to OneDrive before you hand the laptop over.',
].join('\n');

const BITLOCKER_SECTION = [
  '9. Laptop asks for a BitLocker recovery key',
  'All laptops are encrypted with BitLocker. After a BIOS update, a change of docking station or a hardware repair, the laptop may stop at a blue screen asking for a 48-digit recovery key before Windows starts. This is expected and does not mean your data is lost.',
  'On another device, open myaccount.microsoft.com and sign in with your corporate account. Go to Devices, select your laptop, then View BitLocker keys. Compare the key ID shown on the blue screen with the one on the page, then type the 48 digits on the laptop.',
  '10. Leaving the company',
  'On your last day, return the laptop, the phone and the badge to the service desk. Your mailbox is kept for ninety days.',
].join('\n');

// Ticket 38 of the bench: the queries that found the handbook, as the need step derived them.
const TICKET_38_QUERIES = [
  '48-digit recovery key',
  '48-digit recovery key Laptop',
  '48-digit recovery key Blue screen before Windows starts',
  'recovery key prompt after bios update digit location blue screen',
  'cle recuperation apres mise jour bios chiffres ecran bleu trouver',
  'Laptop Blue screen before Windows starts',
  'Laptop Startup prompt asking for a 48-digit recovery key',
  'Laptop Requester wants to know where to find the recovery key',
  'Laptop BIOS update performed this morning, before the issue appeared',
  'BIOS Blue screen before Windows starts',
];

const MANUAL_START = [
  'Ce manuel décrit les outils informatiques des ateliers de production (affinage, découpe, conditionnement) de Paris, Gouda et Parme. Il s\'adresse aux chefs d\'équipe et aux techniciens de maintenance. Les demandes passent par le portail du service desk, catégorie Informatique de production.',
  '1. Réseau des ateliers',
  'Les ateliers ont leur propre réseau, séparé des bureaux. Les équipements de production (automates, balances, caméras, écrans de ligne) sont branchés sur le réseau PROD. Les prises murales sont étiquetées par couleur : bleu pour PROD, vert pour PROD BUREAU. Brancher un équipement sur la mauvaise couleur le rend injoignable.',
  '2. Postes partagés',
  'Chaque atelier dispose d\'un ou deux postes partagés. On s\'y connecte avec son propre compte, jamais avec celui d\'un collègue. La session se ferme automatiquement après quinze minutes. Les documents de l\'atelier (consignes, fiches de poste) sont rangés dans le site SharePoint de l\'atelier.',
  '3. Écrans de ligne',
  'Les écrans de ligne affichent la cadence, les arrêts et les alertes de la ligne. Un écran qui reste noir se redémarre depuis son interrupteur, à l\'arrière. Si la ligne doit s\'arrêter, le chef d\'équipe appelle le numéro d\'astreinte affiché dans l\'atelier.',
  '4. Balances',
  'Les balances de la salle de découpe envoient chaque pesée à SAP par le PC de pesée. Après une coupure de courant, redémarrer le service de pesée sur ce PC, puis faire une pesée d\'essai. Les pesées faites pendant la coupure sont à ressaisir dans SAP.',
  '5. Caméras de contrôle',
  'Les caméras de contrôle des croûtes sont sur la ligne de conditionnement. Un écran de contrôle noir vient le plus souvent du câble réseau : vérifier la prise bleue. La ligne continue avec un contrôle visuel le temps du dépannage.',
  '6. Terminaux portables',
  'Le réseau sans fil des ateliers, FROM PROD, est réservé aux terminaux portables et aux tablettes de maintenance. Aucun équipement personnel ne doit y être connecté, y compris pour recharger un téléphone.',
  '7. Imprimantes d\'étiquettes',
  'Les imprimantes d\'étiquettes de la ligne de conditionnement impriment les étiquettes des meules et des cartons. Un bourrage se dégage en ouvrant la tête d\'impression. Les rouleaux de rechange sont rangés dans l\'armoire de l\'atelier. Une étiquette illisible bloque l\'expédition : réimprimer depuis le poste de la ligne.',
  '8. Scanners',
  'Les scanners de la réception lisent les codes des lots entrants. Un scanner qui ne bipe plus se recharge sur sa base pendant une heure. Si le lot reste introuvable, saisir son numéro à la main sur le terminal et prévenir le chef d\'équipe.',
  '9. Automates',
  'Les automates des caves et des bacs de saumure pilotent la température, l\'humidité et la durée des cycles. Personne ne modifie un paramètre sans l\'accord du responsable de production. La maintenance des automates est planifiée chaque mois avec le fournisseur, en dehors des heures de production.',
  '10. Sauvegardes et pannes',
  'Les postes partagés ne gardent aucune donnée : tout est sur SharePoint, sauvegardé chaque nuit. En cas de panne d\'un poste, se connecter sur l\'autre poste de l\'atelier. En cas de panne du réseau PROD, les lignes continuent en mode local et les données remontent au retour du réseau.',
  '11. Badges et accès',
  'Les portes des ateliers s\'ouvrent avec le badge de l\'entreprise. Un badge perdu se déclare à l\'accueil du site, qui le désactive aussitôt. Les visiteurs reçoivent un badge temporaire et restent accompagnés. Les intérimaires reçoivent leur badge le premier jour, avec les consignes d\'hygiène.',
  '12. Tablettes de maintenance',
  'Les tablettes de maintenance affichent les plans des machines et les fiches d\'intervention. Elles se rechargent la nuit dans l\'armoire de maintenance. Une tablette perdue est effacée à distance par le service desk.',
].join('\n');

const RECIPE_SECTION = [
  '13. Recettes des automates',
  'Les recettes des automates des bacs de saumure (durée, température, concentration) sont sauvegardées chaque nuit. Pour revenir à la recette de la veille après une modification par erreur, ouvrir la console de l\'automate, menu Recettes, puis Restaurer, et choisir la sauvegarde de la nuit précédente. La restauration prend effet au prochain cycle. Prévenir le responsable qualité de toute restauration.',
].join('\n');

// Ticket 43 of the bench: the queries that found the production manual.
const TICKET_43_QUERIES = [
  'plc recipe restore backup brine tank revert duration change rollback',
  'restaurer recette automate sauvegarde bacs saumure modification duree annuler restauration',
  'Recette Recipe duration was changed by mistake on the brine-tank PLC',
  'Recette Requested outcome: revert to yesterday\'s recipe',
  'Recette Return to the recipe from the previous day',
  'restore yesterday recipe',
  'return recipe previous',
  'recette automate saumure',
];

async function seed(runner: any) {
  const tenantId = randomUUID();
  const libraryId = randomUUID();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Long document spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `long-doc-${tenantId.slice(0, 8)}`],
  );
  await runner.query(
    `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
     VALUES ($1, $2, 'Service desk', 'service-desk', false, 0, now(), now())`,
    [libraryId, tenantId],
  );
  const documents = [
    { item: 863, title: 'IT handbook for employees', body: `${HANDBOOK_START}\n${BITLOCKER_SECTION}` },
    { item: 867, title: 'Manuel informatique des ateliers de production', body: `${MANUAL_START}\n${RECIPE_SECTION}` },
  ];
  for (const document of documents) {
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, summary, content_markdown, content_plain,
         library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, '', $5, $5, $6, null, 'published', 1, 0, now(), now())`,
      [randomUUID(), tenantId, document.item, document.title, document.body, libraryId],
    );
  }
  return { libraryId };
}

async function checkDocument(service: KnowledgeService, manager: any, input: {
  ref: string;
  title: string;
  body: string;
  answer: string;
  queries: string[];
  libraryId: string;
}) {
  assert.ok(input.body.indexOf(input.answer) > 3800, `${input.ref}: the answer lies past the cut of the synthesis`);
  // As the orchestrator asks for them (get_document, passages mode).
  const passages = await service.getDocumentSearchPassages(input.ref, knowledgePassageQuery(input.queries, 600), {
    manager,
    publishedOnly: true,
    maxPassages: MAX_INTERPRETER_PASSAGES_PER_CANDIDATE,
    libraryIds: [input.libraryId],
  });
  assert.ok(passages?.matched, `${input.ref}: passages found`);
  assert.ok(
    passages.passages.some((passage) => passage.includes(input.answer)),
    `${input.ref}: the answering passage is read: ${JSON.stringify(passages.passages)}`,
  );
  assert.ok(passages.passages.every((passage) => passage.split(/\s+/).length <= 90), `${input.ref}: passages stay short`);

  // What the interpreter receives.
  const [candidate] = interpreterCandidatePayload([{
    id: input.ref, ref: input.ref, title: input.title, summary: '', snippet: null, status: 'published',
    search_queries: input.queries, match_count: input.queries.length, score: 20,
    passages: passages.passages, passages_matched: passages.matched,
  } as any]);
  assert.ok(
    (candidate.body_passages as string[]).some((passage) => passage.includes(input.answer)),
    `${input.ref}: the interpreter reads the answer`,
  );

  // What the reply synthesis receives once the document is retained and read in full.
  const synthesis = new AiReplySynthesisService({} as any).buildPromptPayload({
    ticket: { id: '38', title: 'Ticket', description: '' },
    timeline: [],
    language: 'en',
    knowledgeDocs: [{
      ref: input.ref, title: input.title, content_markdown: input.body,
      passages: passages.passages, passages_matched: passages.matched, validation_status: 'selected',
    }],
    webResults: [],
  } as any) as any;
  const source = synthesis.knowledge_sources[0];
  assert.ok(!source.content.includes(input.answer), `${input.ref}: the answer is past the cut of the body`);
  assert.ok(
    (source.matching_passages ?? []).some((passage: string) => passage.includes(input.answer)),
    `${input.ref}: the synthesis reads the answer`,
  );
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const { libraryId } = await seed(runner);
    const service = createKnowledgeService(runner.manager);
    await checkDocument(service, runner.manager, {
      ref: 'DOC-863',
      title: 'IT handbook for employees',
      body: `${HANDBOOK_START}\n${BITLOCKER_SECTION}`,
      answer: 'the laptop may stop at a blue screen asking for a 48-digit recovery key',
      queries: TICKET_38_QUERIES,
      libraryId,
    });
    await checkDocument(service, runner.manager, {
      ref: 'DOC-867',
      title: 'Manuel informatique des ateliers de production',
      body: `${MANUAL_START}\n${RECIPE_SECTION}`,
      answer: 'menu Recettes, puis Restaurer',
      queries: TICKET_43_QUERIES,
      libraryId,
    });
    console.log('knowledge-long-document-passages.spec: ok');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
