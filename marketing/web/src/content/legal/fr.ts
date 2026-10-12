import type { LegalContent } from './types';

/* Version française des documents juridiques. Elle fait foi : la version
 * anglaise (en.ts) en est la traduction. Toute modification passe d'abord
 * par ce fichier, puis par en.ts.
 */

const content: LegalContent = {
  privacy: {
    meta: {
      title: 'Politique de confidentialité',
      description: 'Comment KANAP collecte, utilise et protège les données personnelles conformément au RGPD.',
    },
    header: {
      eyebrow: 'Mentions légales',
      title: 'Politique de confidentialité',
      lastUpdated: 'Dernière mise à jour : 12 octobre 2026',
    },
    body: `
<h2>Préambule</h2>
<p>KANAP (ci-après « KANAP »), EURL (entreprise unipersonnelle à responsabilité limitée) immatriculée au RCS de Saverne sous le numéro 939 098 190, dont le siège social est situé 2, rue du Finhay, 67210 Obernai, France, accorde la plus grande importance à la protection de vos données personnelles. La présente politique de confidentialité (ci-après la « Politique ») a pour objet de vous informer de manière claire et transparente sur les traitements de données personnelles mis en œuvre par KANAP dans le cadre de l'utilisation de la plateforme en ligne de gestion informatique « KANAP » (ci-après « la Plateforme »).</p>
<p>KANAP s'engage à respecter le Règlement général sur la protection des données (RGPD) et la loi n° 78-17 du 6 janvier 1978 relative à l'informatique, aux fichiers et aux libertés, dans sa version modifiée.</p>

<h2>1. Responsable du traitement</h2>
<p>Le responsable du traitement des données personnelles collectées via la Plateforme est KANAP, EURL (entreprise unipersonnelle à responsabilité limitée) immatriculée au RCS de Saverne sous le numéro 939 098 190, dont le siège social est situé 2, rue du Finhay, 67210 Obernai, France.</p>
<p>Pour les données saisies par les clients dans la Plateforme (données budgétaires, informations financières, données des utilisateurs au sein des espaces clients), l'organisation cliente agit en qualité de responsable du traitement et KANAP en qualité de sous-traitant.</p>

<h2>2. Données personnelles collectées</h2>
<p>KANAP collecte les données personnelles suivantes auprès des utilisateurs de la Plateforme :</p>
<ul>
  <li><strong>Informations de compte :</strong> prénom, nom, adresse e-mail, fonction, nom de l'organisation</li>
  <li><strong>Données d'authentification :</strong> identifiants de connexion (les mots de passe sont hachés et ne sont jamais stockés en clair)</li>
  <li><strong>Données d'utilisation :</strong> journaux d'utilisation de la Plateforme, informations de session, adresses IP</li>
  <li><strong>Données financières :</strong> postes budgétaires, données CAPEX/OPEX, informations de répartition, détails des contrats saisis par les utilisateurs</li>
  <li><strong>Informations de facturation :</strong> raison sociale, adresse de facturation, numéro de TVA</li>
</ul>
<p>Les informations de paiement (données de carte bancaire) ne sont pas connues de KANAP. Elles sont traitées directement par la plateforme de paiement sécurisée (Stripe).</p>

<h2>3. Finalités du traitement</h2>
<ul>
  <li><strong>Fourniture du service :</strong> les données sont nécessaires pour donner accès à la Plateforme, gérer les comptes utilisateurs et fournir le service de gestion informatique.</li>
  <li><strong>Amélioration du service :</strong> les données d'utilisation servent à améliorer la qualité et les fonctionnalités du service, à identifier les problèmes techniques et à optimiser les performances.</li>
  <li><strong>Support client :</strong> les données servent à répondre aux demandes des utilisateurs, à fournir une assistance technique et à résoudre les problèmes.</li>
  <li><strong>Facturation :</strong> les données sont nécessaires pour traiter les abonnements, émettre les factures et gérer les paiements.</li>
  <li><strong>Sécurité :</strong> les données sont traitées pour assurer la sécurité de la Plateforme, détecter et prévenir la fraude, les accès non autorisés et les incidents de sécurité.</li>
  <li><strong>Respect des obligations légales :</strong> les données sont traitées pour respecter les obligations légales et réglementaires.</li>
</ul>

<h2>4. Base légale du traitement</h2>
<ul>
  <li><strong>Exécution du contrat :</strong> le traitement est nécessaire à la fourniture du service KANAP (gestion des comptes, accès à la Plateforme, etc.).</li>
  <li><strong>Intérêt légitime :</strong> les traitements destinés à l'amélioration du service, à la sécurité et à la prévention de la fraude reposent sur l'intérêt légitime de KANAP à développer et fournir un service de qualité et sécurisé.</li>
  <li><strong>Obligation légale :</strong> le traitement peut être nécessaire au respect d'obligations légales (comptables, fiscales, de lutte contre le blanchiment, etc.).</li>
  <li><strong>Consentement :</strong> pour certaines fonctionnalités ou communications facultatives, le traitement peut reposer sur le consentement explicite de l'utilisateur.</li>
</ul>

<h2>5. Destinataires des données</h2>
<p>KANAP peut partager vos données personnelles dans les cas suivants :</p>
<ul>
  <li><strong>Prestataires de services :</strong> KANAP peut faire appel à des prestataires (hébergement, infrastructure, traitement des paiements, services d'e-mail, etc.) susceptibles d'accéder à des données personnelles dans le cadre de leurs missions. Ces prestataires sont tenus à des obligations de confidentialité et de sécurité et agissent en qualité de sous-traitants sur instruction de KANAP.</li>
  <li><strong>Obligations légales :</strong> KANAP peut être tenue de communiquer des données personnelles aux autorités administratives ou judiciaires lorsque la loi l'exige.</li>
</ul>
<p>KANAP s'engage à ne pas partager les données personnelles des utilisateurs à des fins commerciales autres que celles mentionnées ci-dessus. KANAP ne vendra ni ne louera jamais vos données personnelles à des tiers.</p>
<p>Les prestataires (sous-traitants ultérieurs) qui traitent des données personnelles pour le compte de KANAP dans le cadre du service cloud sont :</p>
<ul>
  <li><strong>Hetzner Online GmbH</strong> (Allemagne) : hébergement des serveurs, de la base de données et du stockage des fichiers.</li>
  <li><strong>Cloudflare</strong> (États-Unis) : réseau, CDN et terminaison TLS en amont des serveurs, avec des garanties contractuelles pour les transferts hors de l'Union européenne.</li>
  <li><strong>Resend</strong> (e-mails transactionnels, États-Unis) : e-mails d'activation de compte, de réinitialisation de mot de passe et de notification.</li>
  <li><strong>Stripe</strong> (paiements, Irlande et États-Unis) : traitement des paiements et facturation des abonnements.</li>
  <li><strong>Fournisseur de modèles d'IA</strong> pour les fonctionnalités d'IA intégrées du service cloud : les fonctionnalités d'IA sont désactivées par défaut. Le modèle intégré ne reçoit aucune donnée tant que l'espace de travail n'a pas accepté son fournisseur et le lieu où il traite les données, tous deux indiqués dans l'application. Un administrateur de l'espace de travail donne cette confirmation, qui couvre l'assistant, les agents et les traitements planifiés ; une nouvelle confirmation est demandée si le fournisseur ou le lieu change. Les administrateurs peuvent utiliser leur propre fournisseur de modèles à la place. Le fournisseur peut traiter des données hors de l'Union européenne.</li>
</ul>
<p>Les clients qui hébergent eux-mêmes KANAP choisissent leurs propres prestataires, et KANAP ne traite pas leurs données. Les clients du service cloud qui connectent leur propre fournisseur de modèles d'IA choisissent ce fournisseur, et KANAP n'envoie pas leurs données à son modèle intégré.</p>

<h2>6. Durée de conservation des données</h2>
<ul>
  <li>Les données de compte et les données saisies par les clients dans la Plateforme sont conservées pendant la durée du contrat. À la fin du contrat, elles sont supprimées à la demande du client.</li>
  <li>Les données de facturation sont conservées 10 ans conformément à la réglementation comptable et fiscale française.</li>
  <li>Les données de paiement ne sont pas conservées par KANAP et sont gérées directement par le prestataire de paiement (Stripe).</li>
</ul>

<h2>7. Sécurité des données</h2>
<ul>
  <li>HTTPS pour toutes les connexions à la Plateforme</li>
  <li>Chiffrement au repos des secrets et identifiants stockés par la Plateforme (AES-256-GCM)</li>
  <li>Contrôle d'accès fondé sur les rôles et mécanismes d'authentification</li>
  <li>Hébergement dans l'Union européenne (Hetzner, Allemagne)</li>
  <li>Hachage des mots de passe avec des algorithmes reconnus (Argon2id)</li>
  <li>Isolation multi-locataire par sécurité au niveau des lignes (Row-Level Security, RLS) dans la base de données</li>
  <li>Code source publié sous licence AGPL v3, et canal privé de signalement des vulnérabilités</li>
</ul>

<h2>8. Droits des utilisateurs</h2>
<p>Conformément au RGPD, vous disposez des droits suivants sur vos données personnelles :</p>
<ul>
  <li>Droit d'accès</li>
  <li>Droit de rectification</li>
  <li>Droit à l'effacement</li>
  <li>Droit à la limitation du traitement</li>
  <li>Droit d'opposition</li>
  <li>Droit à la portabilité des données</li>
  <li>Droit de retirer votre consentement</li>
</ul>
<p>Pour exercer vos droits, vous pouvez contacter KANAP à l'adresse <a href="mailto:support@kanap.net">support@kanap.net</a>. Vous disposez également du droit d'introduire une réclamation auprès de la Commission nationale de l'informatique et des libertés (CNIL).</p>

<h2>9. Transferts internationaux de données</h2>
<p>La Plateforme est hébergée dans l'Union européenne, en Allemagne. Certains prestataires mentionnés à la section 5 peuvent traiter des données personnelles hors de l'Union européenne, par exemple Cloudflare pour le trafic réseau. Dans ce cas, KANAP s'assure que des garanties appropriées sont en place (le cadre de protection des données UE-États-Unis ou des clauses contractuelles types).</p>

<h2>10. Cookies et technologies de suivi</h2>
<p>Le site web de KANAP ne dépose aucun cookie publicitaire ou de mesure d'audience et n'affiche pas de bandeau cookies. Nous mesurons l'audience avec Cloudflare Web Analytics, qui fonctionne sans cookie et sans rien stocker sur votre appareil. Les formulaires de contact et d'essai utilisent Cloudflare Turnstile, une vérification de sécurité qui distingue les personnes des programmes automatisés. Le site retient votre choix de thème clair ou sombre dans votre navigateur, uniquement si vous en choisissez un.</p>
<p>L'application utilise uniquement les cookies nécessaires à la connexion et au maintien de votre session. Elle stocke aussi des préférences d'interface, comme votre thème et la disposition des tableaux, dans votre navigateur. Vous pouvez les supprimer à tout moment dans les paramètres de votre navigateur.</p>

<h2>11. Modifications de la politique</h2>
<p>KANAP se réserve le droit de modifier la présente Politique à tout moment. Les utilisateurs sont informés des modifications par tout moyen, notamment par une notification sur la Plateforme ou par e-mail.</p>

<p class="mk-legal__foot">Pour toute question relative à la présente politique de confidentialité, contactez <a href="mailto:support@kanap.net">support@kanap.net</a>.</p>
`,
  },

  terms: {
    meta: {
      title: "Conditions générales d'utilisation",
      description: "Conditions d'utilisation de la plateforme en ligne de gestion informatique KANAP.",
    },
    header: {
      eyebrow: 'Mentions légales',
      title: "Conditions générales d'utilisation",
      lastUpdated: 'Dernière mise à jour : 12 octobre 2026',
    },
    body: `
<h2>Préambule</h2>
<p>Les présentes Conditions générales d'utilisation régissent l'accès et l'utilisation de la plateforme en ligne de gestion informatique « KANAP » (ci-après « la Plateforme » ou « le Service ») éditée par KANAP, EURL (entreprise unipersonnelle à responsabilité limitée) immatriculée au RCS de Saverne sous le numéro 939 098 190, dont le siège social est situé 2, rue du Finhay, 67210 Obernai, France. L'utilisation de la Plateforme vaut acceptation pleine et entière des présentes Conditions générales d'utilisation.</p>

<h2>Article 1. Accès à la plateforme et création de compte</h2>
<p>1.1. L'accès à la Plateforme est réservé aux utilisateurs ayant souscrit un abonnement valide, conformément aux Conditions générales de vente (CGV) de KANAP.</p>
<p>1.2. Pour accéder à la Plateforme, l'utilisateur doit créer un compte personnel en fournissant des informations exactes et complètes.</p>
<p>1.3. L'utilisateur est responsable de la confidentialité de ses identifiants de connexion. Toute utilisation du compte avec ces identifiants est réputée effectuée par l'utilisateur. En cas de perte ou de vol, l'utilisateur doit en informer KANAP sans délai.</p>
<p>1.4. KANAP se réserve le droit de refuser l'accès à la Plateforme ou de suspendre un compte en cas de manquement aux présentes Conditions générales d'utilisation ou aux CGV.</p>

<h2>Article 2. Utilisation de la plateforme</h2>
<p>2.1. La Plateforme est mise à disposition à des fins professionnelles. L'utilisateur s'engage à l'utiliser de manière responsable et dans le respect de la loi.</p>
<p>2.2. L'utilisateur s'engage à ne pas : utiliser la Plateforme à des fins illicites ; tenter d'accéder aux données d'autres utilisateurs ; publier des contenus inappropriés ou diffamatoires ; partager son accès avec des tiers non autorisés ; utiliser la Plateforme à des fins commerciales ou publicitaires autres que son usage prévu ; copier, reproduire, diffuser ou modifier le contenu sans autorisation préalable.</p>
<p>2.3. KANAP se réserve le droit de modifier à tout moment les fonctionnalités de la Plateforme.</p>

<h2>Article 3. Responsabilité de l'utilisateur</h2>
<p>3.1. L'utilisateur est seul responsable de son utilisation de la Plateforme et des contenus qu'il publie ou partage.</p>
<p>3.2. L'utilisateur s'engage à ne pas porter atteinte à la réputation de KANAP ni à la qualité de ses services.</p>
<p>3.3. L'utilisateur est responsable de la sécurité de son matériel informatique et de sa connexion internet.</p>

<h2>Article 4. Responsabilité de KANAP et limitation</h2>
<p>4.1. KANAP s'engage à fournir l'accès à la Plateforme conformément à la description du Service.</p>
<p>4.2. KANAP ne garantit pas l'absence d'erreurs ou d'interruptions dans le fonctionnement de la Plateforme.</p>
<p>4.3. KANAP ne peut être tenue responsable : des conséquences de l'utilisation de la Plateforme par l'utilisateur ; des interruptions ou dysfonctionnements techniques, des problèmes de connexion internet ou des cas de force majeure ; de l'exactitude des données saisies par l'utilisateur ou des décisions prises sur la base des rapports de la Plateforme.</p>
<p>4.4. La responsabilité de KANAP est en tout état de cause limitée au montant de l'abonnement payé par l'utilisateur.</p>

<h2>Article 5. Confidentialité et sécurité des données</h2>
<p>5.1. KANAP s'engage à prendre toutes les mesures techniques et organisationnelles nécessaires pour préserver la confidentialité de l'ensemble des informations et données fournies.</p>
<p>5.2. Les données des utilisateurs sont stockées sur des serveurs hébergés dans l'Union européenne, avec contrôle d'accès. Les secrets et identifiants stockés par la Plateforme sont chiffrés au repos. KANAP applique des pratiques de sécurité reconnues.</p>
<p>5.3. Les salariés et sous-traitants de KANAP susceptibles d'accéder aux données des clients sont soumis à de strictes obligations de confidentialité.</p>
<p>5.4. KANAP ne partagera, ne vendra ni ne divulguera les données des clients à des tiers, sauf consentement explicite, obligation légale, ou recours à des sous-traitants de confiance liés par des accords de confidentialité.</p>
<p>5.5. En cas d'incident de sécurité affectant les données, KANAP informera les clients concernés dans un délai de 72 heures.</p>

<h2>Article 6. Propriété intellectuelle</h2>
<p>6.1. Le logiciel KANAP est publié par KANAP sous licence GNU Affero General Public License version 3 (AGPL-3.0). Les droits de l'utilisateur sur son code source sont ceux que lui confère cette licence.</p>
<p>6.2. Le nom et le logo KANAP appartiennent à KANAP. L'utilisation de la Plateforme ne confère aucun droit sur ceux-ci.</p>
<p>6.3. Les contenus créés par l'utilisateur restent sa propriété, mais KANAP se réserve le droit d'utiliser des données agrégées et anonymisées à des fins d'amélioration du service.</p>

<h2>Article 7. Suspension ou résiliation du compte</h2>
<p>7.1. KANAP se réserve le droit de suspendre ou de résilier le compte d'un utilisateur en cas de non-respect des présentes Conditions, d'utilisation abusive ou frauduleuse, d'atteinte à la sécurité, de défaut de paiement ou de comportement inapproprié.</p>
<p>7.2. En cas de résiliation du compte, l'utilisateur perd l'accès à la Plateforme et à son contenu.</p>

<h2>Article 8. Protection des données personnelles</h2>
<p>Les données personnelles sont traitées conformément à la politique de confidentialité de KANAP, disponible sur le site web.</p>

<h2>Article 9. Modification des conditions d'utilisation</h2>
<p>KANAP se réserve le droit de modifier les présentes Conditions générales d'utilisation à tout moment. La poursuite de l'utilisation après modification vaut acceptation.</p>

<h2>Article 10. Droit applicable et litiges</h2>
<p>Les présentes Conditions générales d'utilisation sont régies par le droit français. Tout litige relève de la compétence exclusive des tribunaux français.</p>

<p class="mk-legal__foot">Pour toute question, contactez <a href="mailto:support@kanap.net">support@kanap.net</a>.</p>
`,
  },

  sales: {
    meta: {
      title: 'Conditions générales de vente',
      description: 'Conditions applicables à la souscription des abonnements KANAP.',
    },
    header: {
      eyebrow: 'Mentions légales',
      title: 'Conditions générales de vente',
      lastUpdated: 'Dernière mise à jour : 12 octobre 2026',
    },
    body: `
<h2>Article 1. Objet</h2>
<p>Les présentes Conditions générales de vente (CGV) régissent la vente par KANAP (ci-après « le Vendeur »), EURL (entreprise unipersonnelle à responsabilité limitée) au capital de 1 000 €, immatriculée au RCS de Saverne sous le numéro 939 098 190, dont le siège social est situé 2, rue du Finhay, 67210 Obernai, France, d'abonnements à la plateforme en ligne de gestion informatique « KANAP ».</p>

<h2>Article 2. Acceptation des CGV</h2>
<p>L'acceptation des présentes CGV est obligatoire avant toute souscription et emporte l'adhésion pleine et entière du Client à ces conditions.</p>

<h2>Article 3. Description du service</h2>
<p>KANAP est une plateforme en ligne de gestion informatique conçue pour les responsables technologiques et les directions des systèmes d'information. Les fonctionnalités sont celles décrites sur le site web au moment de la souscription.</p>

<h2>Article 4. Abonnement et tarifs</h2>
<p>4.1. L'accès au Service est proposé selon les offres d'abonnement décrites sur la page des tarifs. Les prix sont indiqués en euros (EUR). Le Vendeur bénéficie de la franchise en base de TVA prévue à l'article 293 B du Code général des impôts : aucune TVA n'est facturée, et les factures portent la mention « TVA non applicable, art. 293 B du CGI ». Si le régime de TVA du Vendeur change, la TVA s'appliquera aux factures émises après la date de ce changement.</p>
<p>4.2. Les abonnements incluent un nombre illimité d'utilisateurs et d'espaces de travail. Aucun tarif par utilisateur ne s'applique.</p>
<p>4.3. Les tarifs applicables aux abonnements sont affichés sur le site web au moment de la souscription. Ils peuvent être modifiés à tout moment, mais ces modifications ne s'appliquent qu'aux abonnements souscrits après la modification.</p>
<p>4.4. Le Client est informé à l'avance de toute modification tarifaire avant le renouvellement automatique de son abonnement.</p>
<p>4.5. Les abonnés payants bénéficient d'une remise de 20 % sur les prestations de conseil. Les prestations de conseil et les prestations au forfait sont facturées séparément, aux tarifs affichés sur le site web.</p>

<h2>Article 5. Modalités de paiement</h2>
<p>5.1. Le paiement s'effectue par carte bancaire via une plateforme de paiement sécurisée (Stripe) ou, pour les abonnements annuels uniquement, par virement bancaire sur facture. Le prélèvement n'est pas proposé.</p>
<p>5.2. Pour les abonnements mensuels, le premier paiement intervient à la souscription, puis chaque mois à la date anniversaire. Les paiements par carte sont débités à l'émission de la facture.</p>
<p>5.3. Pour les abonnements annuels, le montant annuel total est facturé à la souscription, puis à chaque renouvellement. Il est débité immédiatement sur la carte ou, en cas de paiement par virement bancaire, payable selon l'article 5.4.</p>
<p>5.4. Les factures réglées par virement bancaire (abonnements annuels uniquement) sont payables dans un délai de 30 jours à compter de la date de facture. En cas de retard de paiement, l'accès au Service peut être suspendu.</p>
<p>5.5. En cas de refus ou d'échec du paiement, le Client en est informé et l'accès peut être suspendu.</p>
<p>5.6. Une facture est émise pour chaque paiement et mise à disposition dans l'espace client ou envoyée par e-mail.</p>
<p>5.7. Toute somme non payée à son échéance porte de plein droit, sans mise en demeure préalable, des pénalités de retard calculées à un taux annuel égal à trois fois le taux d'intérêt légal en vigueur, du lendemain de la date d'échéance jusqu'au paiement complet.</p>
<p>5.8. Tout client professionnel en retard de paiement est en outre redevable de plein droit d'une indemnité forfaitaire pour frais de recouvrement de 40 € par facture (articles L441-10 et D441-5 du Code de commerce). Le Vendeur peut demander une indemnisation complémentaire, sur justificatifs, lorsque les frais de recouvrement dépassent ce montant.</p>
<p>5.9. Aucun escompte n'est accordé en cas de paiement anticipé.</p>

<h2>Article 6. Durée et renouvellement de l'abonnement</h2>
<p>6.1. <strong>Abonnement mensuel :</strong> souscrit pour un mois, renouvelable automatiquement par tacite reconduction. Le Client peut résilier à tout moment depuis son espace client, avec un préavis de 48 heures avant le renouvellement. La résiliation prend effet à la fin du mois en cours.</p>
<p>6.2. <strong>Abonnement annuel :</strong> souscrit pour un an, renouvelable automatiquement par tacite reconduction sauf résiliation. Le Client est informé par e-mail 30 jours avant le renouvellement. La résiliation requiert un préavis de 30 jours avant la date anniversaire. L'abonnement annuel ne donne lieu à aucun remboursement en cas de résiliation anticipée.</p>
<p>6.3. <strong>Changements d'abonnement :</strong> le Client peut passer à tout moment de la facturation mensuelle à la facturation annuelle (la différence au prorata est facturée immédiatement et payable selon l'article 5), ou de l'annuelle à la mensuelle à la fin de la période de facturation en cours. Le Client peut passer du Service hébergé à un déploiement auto-hébergé, et inversement, en contactant le support. Le Client peut exporter ses données à tout moment. L'accompagnement d'un tel changement (installation, transfert des données, configuration) est une prestation chiffrée et facturée séparément.</p>

<h2>Article 7. Droit de rétractation</h2>
<p>Les Services sont proposés exclusivement à des professionnels agissant dans le cadre de leur activité. Aucun droit de rétractation ne s'applique.</p>

<h2>Article 8. Garantie et responsabilité</h2>
<p>8.1. Le Vendeur s'engage à fournir un Service conforme à sa description.</p>
<p>8.2. Le Vendeur ne peut être tenu responsable des interruptions ou dysfonctionnements, de l'exactitude des données saisies par le Client, ni des dommages indirects ou consécutifs.</p>
<p>8.3. La responsabilité du Vendeur est limitée au montant de l'abonnement payé par le Client au cours des 12 derniers mois.</p>

<h2>Article 9. Propriété intellectuelle</h2>
<p>9.1. Le logiciel KANAP est publié par le Vendeur sous licence GNU Affero General Public License version 3 (AGPL-3.0). Les droits du Client sur son code source sont ceux que lui confère cette licence.</p>
<p>9.2. L'abonnement confère au Client le droit d'utiliser le Service hébergé pendant sa durée. Il ne transfère aucun droit de propriété intellectuelle.</p>
<p>9.3. Le nom et le logo KANAP appartiennent au Vendeur. L'abonnement ne confère aucun droit sur ceux-ci.</p>
<p>9.4. Les données saisies par le Client restent sa propriété.</p>

<h2>Article 10. Données personnelles</h2>
<p>Les données personnelles sont traitées conformément à la politique de confidentialité du Vendeur.</p>

<h2>Article 11. Litiges et droit applicable</h2>
<p>11.1. Les présentes CGV sont régies par le droit français. Tout litige relève de la compétence exclusive des tribunaux français.</p>
<p>11.2. En cas de litige, les parties s'engagent à rechercher une solution amiable avant toute action en justice.</p>

<p class="mk-legal__foot">Pour toute question, contactez <a href="mailto:support@kanap.net">support@kanap.net</a>.</p>
`,
  },

  legal: {
    meta: {
      title: 'Mentions légales',
      description: "Éditeur, hébergement et juridiction applicable pour le site kanap.net.",
    },
    header: {
      eyebrow: 'Mentions légales',
      title: 'Mentions légales',
      lastUpdated: 'Dernière mise à jour : 12 octobre 2026',
    },
    body: `
<h2>Éditeur du site</h2>
<p><strong>KANAP</strong><br/>
EURL au capital de 1 000 €<br/>
RCS Saverne 939 098 190<br/>
SIRET : 939 098 190 00019<br/>
N° de TVA intracommunautaire : FR04939098190 (TVA non applicable, art. 293 B du CGI)<br/>
Siège social : 2, rue du Finhay, 67210 Obernai, France</p>
<p>Directeur de la publication : Friedrich Eva</p>

<h2>Contact</h2>
<p>E-mail : <a href="mailto:support@kanap.net">support@kanap.net</a></p>

<h2>Hébergement</h2>
<p>Le site kanap.net est hébergé par Hetzner Online GmbH, dont le siège social est situé :</p>
<p>Hetzner Online GmbH<br/>
Industriestr. 25, 91710 Gunzenhausen, Allemagne</p>
<p>Les serveurs sont situés à Nuremberg, en Allemagne. Le trafic vers le site passe par Cloudflare, qui fournit le réseau de diffusion de contenu et la protection TLS.</p>

<h2>Droit applicable et juridiction</h2>
<p>Le présent site est régi par le droit français. En cas de litige relatif à l'utilisation du site kanap.net et à défaut d'accord amiable entre les parties concernées, les tribunaux français sont seuls compétents.</p>
`,
  },
};

export default content;
