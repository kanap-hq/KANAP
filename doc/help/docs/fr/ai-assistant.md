# Plaid

Plaid est l'assistant conversationnel intégré de KANAP. Il est connecté aux mêmes données que celles que vous manipulez déjà (applications, actifs, technologies, incidents, projets, demandes, tâches, contrats, documents de la base de connaissances et master data), afin que vous puissiez poser des questions en langage naturel au lieu de naviguer entre plusieurs écrans pour trouver une réponse.

Plaid ne remplace pas le reste de l'application. C'est un moyen plus rapide de synthétiser le contexte, de localiser des enregistrements, de rédiger du texte ou de préparer des modifications. Les opérations sensibles sont toujours présentées sous forme d'aperçus que vous devez approuver avant que quoi que ce soit ne soit écrit dans KANAP.

!!! note "Plaid ou les Agents IA"
    Plaid est l'assistant interactif que **vous** pilotez : vous demandez, il répond et vous approuvez une modification à la fois. Les **Agents IA** sont différents : ce sont des assistants autonomes qui surveillent votre centre de services et proposent ou traitent eux-mêmes le travail sur les tickets, dans les limites d'approbation que vous définissez. Voir [Agents IA : vue d'ensemble](agents-overview.md).

## Où le trouver

- Espace de travail : **Plaid** (barre de navigation supérieure)
- Route : `/ai`
- Autorisation : `ai_chat:reader` permet d'ouvrir l'espace de chat et de démarrer des conversations
- Indicateur de fonctionnalité : nécessite que l'interface de chat soit activée sur votre instance. Si elle est désactivée, l'espace de travail affiche un avis à la place de l'interface de chat.

L'espace de travail est également accessible aux administrateurs disposant de `ai_chat:admin`, qui peuvent voir et modérer tout ce que font les utilisateurs standard.

!!! note "En attente d'un administrateur"
    Sur le service hébergé, Plaid peut s'exécuter sur le modèle inclus KANAP. Avant cela, un administrateur confirme le fournisseur et le lieu où il traite les données. Jusque-là, l'espace de travail affiche *Un administrateur doit confirmer le fournisseur d'IA dans Administration > Plaid.* à la place du chat. Un administrateur le fait sur la page [Paramètres Plaid](ai-settings.md#confirmer-le-modele-inclus-kanap). Les organisations qui utilisent un modèle propre ne voient jamais cet avis.

## Démarrer une conversation

Lorsque vous ouvrez Plaid pour la première fois, vous arrivez sur un écran d'accueil comportant :

- Une courte accroche (« Plaid est prêt ») et une description de ce que vous pouvez demander
- Une section **Pour démarrer** avec des exemples de requêtes sur lesquels cliquer pour les envoyer
- Le composeur en bas, prêt à recevoir votre premier message

Cliquez sur une suggestion pour l'envoyer directement ou, pour les requêtes contenant un espace réservé `@`, l'insérer dans le composeur afin de la compléter.

Saisissez un message et appuyez sur **Entrée** pour l'envoyer. **Maj+Entrée** insère un retour à la ligne. Le bouton d'envoi est désactivé lorsqu'il n'y a rien à envoyer et se transforme en bouton rouge **Arrêter** pendant que Plaid répond.

## La liste des conversations

La barre latérale de gauche répertorie vos conversations passées. Utilisez l'icône de menu en haut à gauche de la zone de chat pour la réduire ou la développer.

La liste contient :

- Un bouton **Nouvelle conversation** en haut
- Un champ de recherche qui apparaît dès que vous avez au moins une conversation
- Les conversations regroupées par date : **Aujourd'hui**, **Hier**, **7 derniers jours**, **Plus ancien**

Chaque ligne affiche le titre de la conversation (ou **Sans titre** si aucun n'a encore été défini). Survolez une ligne ou placez-y le focus pour faire apparaître :

- Une icône crayon : **Renommer** la conversation. Double-cliquez sur le titre pour faire de même.
- Une icône corbeille : **Archiver** la conversation. Les conversations archivées disparaissent de la liste. Si vous archivez la conversation actuellement ouverte, Plaid bascule vers un nouveau chat vide.

La recherche filtre la liste par titre au fur et à mesure de votre saisie. Le renommage et l'archivage sont enregistrés immédiatement.

## Rédiger un message

Le composeur est le point de contrôle principal de l'espace de travail. Il prend en charge :

- Le texte multiligne jusqu'à 10 lignes visibles avant défilement
- Les pièces jointes image inline (PNG, JPG, GIF, WEBP)
- Les mentions `@` d'enregistrements KANAP
- Un rappel de raccourci clavier (« Entrée pour envoyer · Maj+Entrée retour à la ligne »)

### Joindre des images

Vous pouvez ajouter des images de trois manières :

- Cliquez sur l'icône trombone et sélectionnez des fichiers sur votre ordinateur
- Glissez-déposez des fichiers image sur le composeur (une superposition indicative confirme la zone de dépôt)
- Collez une image directement depuis le presse-papiers

Chaque image en attente apparaît sous forme de miniature au-dessus du texte. Cliquez sur le petit **X** d'une miniature pour la retirer. Le nombre de pièces jointes par message est limité ; une fois cette limite atteinte, le trombone est désactivé jusqu'à ce que vous retiriez ou envoyiez les pièces jointes en cours.

Les images sont importées avec votre message afin que Plaid puisse les décrire, les comparer ou en extraire des détails.

### Mentionner des enregistrements avec `@`

La saisie de `@` ouvre le **sélecteur de mentions** au-dessus du composeur. Il vous permet de référencer n'importe quel enregistrement KANAP auquel vous avez accès, selon deux modes complémentaires :

- **Préfixe de type** : des codes courts qui correspondent à une seule famille d'entités. Exemples :
  - `@T-5` : la tâche portant la référence T-5
  - `@DOC` : les documents récents de la base de connaissances
  - `@APP backup` : les applications correspondant à « backup »
  - `@BL-12` : la ligne budgétaire portant la référence BL-12. `@BL` seul liste les lignes budgétaires des deux types. Les anciens numéros fonctionnent toujours : `@OPX-12` ou `@CPX-3` trouve sa ligne
  - `@PRJ`, `@REQ`, `@INC`, `@TEC`, `@AST`, `@CONN`, `@INT`, `@LOC`, `@CTR`, `@COMP`, `@CONT`, `@DEPT`, `@SUP`, `@BP`
- **Texte libre** : tout le reste (`@payroll`, `@server-2`) lance une recherche multi-types classée par pertinence. Elle trouve aussi les lignes budgétaires par le nom de leurs valeurs analytiques.

Utilisez les touches fléchées pour parcourir les suggestions, **Entrée** ou **Tab** pour confirmer, **Échap** pour fermer le sélecteur. Les résultats sont regroupés par type d'entité (Base de connaissances, Tâches, Projets, Applications, Actifs, Contrats, etc.) afin que vous sachiez d'un coup d'œil quel type d'enregistrement vous vous apprêtez à insérer.

Lorsque vous confirmez une suggestion, le composeur continue d'afficher un libellé lisible (`@DOC-152`, `@SAP S/4HANA`). À l'envoi du message, chaque mention est transformée en un véritable lien que Plaid peut suivre jusqu'à l'enregistrement source.

### Modifier ou régénérer un message

Survolez n'importe lequel de vos messages précédents pour accéder aux actions au niveau du message :

- **Copier** : copie le texte du message dans le presse-papiers
- **Modifier** : rouvre le message dans un éditeur inline ; l'enregistrement envoie la nouvelle version et supprime tout ce qui suivait (la conversation est relancée à partir de ce point)
- **Régénérer** (sur les réponses de l'assistant) : demande à Plaid de produire une autre réponse à la même requête

La modification est l'outil adapté lorsque vous constatez que votre question précédente manquait de clarté. La régénération est l'outil adapté lorsque la question était bonne mais pas la réponse.

## Comment Plaid répond

Plaid diffuse sa réponse caractère par caractère. Pendant la diffusion :

- Le composeur reste utilisable afin que vous puissiez préparer une relance
- Le bouton d'envoi affiche une icône rouge **Arrêter** : cliquer dessus annule la réponse en cours
- Un petit indicateur « Utilisation des outils… » apparaît lorsque Plaid effectue une recherche dans KANAP, récupère un document ou exécute un autre appel d'outil
- Le nombre et le type d'outils utilisés sont récapitulés sous la réponse une fois celle-ci terminée

Lorsque la diffusion se termine, le focus revient automatiquement sur le composeur afin que vous puissiez poursuivre la conversation sans avoir à utiliser la souris.

Les images stockées dans KANAP, comme les pièces jointes, s'affichent normalement. Une image hébergée sur un autre site web ne se charge pas d'elle-même, dans une réponse, dans vos propres messages ou dans l'aperçu d'une modification proposée. Elle apparaît comme un lien avec une icône d'image : cliquez dessus pour ouvrir l'image dans un nouvel onglet. Aucune demande ne part vers ce site avant votre clic.

### Appels d'outils { #tool-calls }

Plaid utilise un petit ensemble d'outils internes pour répondre aux questions : `Search all`, `Search knowledge`, `Get document`, `Get entity context` et quelques autres. Chaque appel d'outil apparaît sous forme de ligne compacte sous le message (« a utilisé Search all · 8 résultats »). Vous n'avez généralement pas besoin de lire les détails de l'outil, mais ils sont là si vous voulez voir exactement sur quels enregistrements la réponse s'est appuyée.

`Search all` trouve les lignes budgétaires par le nom de leurs valeurs analytiques, et indique à Plaid les valeurs de chaque ligne. Plaid désigne une ligne budgétaire par sa référence `BL-12`, et ses liens ouvrent la ligne. Un nombre seul, comme 21, désigne `BL-21`. Les anciens numéros fonctionnent toujours : `OPX-12` ou `CPX-3` trouve sa ligne.

Plaid lit les lignes OPEX et CAPEX ensemble. Une question qui ne nomme aucun des deux types porte sur les deux, et Plaid peut filtrer ou regrouper les lignes par type.

Plaid liste et lit les technologies pour les utilisateurs qui peuvent lire l'infrastructure. Il peut les filtrer par famille, éditeur, version, responsable, fin de support ou nombre de serveurs, et lire les versions, les serveurs, les applications, les responsables, les contacts de support, les liens web et le réglage des alertes de vulnérabilité d'une technologie. Il lit aussi les deux vues du rapport [Fins de support](end-of-support.md#demander-a-lassistant), ainsi que la version et les dates de chaque application. Interrogé sur un serveur, une application ou une technologie par son nom, sans sa référence, il lit aussi les enregistrements liés. Demandez par exemple : « Quelles technologies n'ont pas de responsable IT ? » Les assistants connectés via MCP obtiennent les mêmes réponses.

Quand les vulnérabilités sont suivies, Plaid liste, compte et lit aussi les vulnérabilités, pour les utilisateurs qui lisent l'infrastructure. Un élément est une CVE sur une version d'une technologie, comme sur la page [Vulnérabilités](vulnerabilities.md). Plaid peut les filtrer par sévérité, exploitation, état, alertes, technologie, date de publication, actif ou application. Il peut aussi garder les technologies en usage dans le parc, ou les lignes qui ne correspondent plus. Il les compte par sévérité, par technologie ou par version, en lignes et en CVE distinctes, comme la page : « 117 lignes (112 CVE) ». Sauf demande contraire, Plaid garde les vulnérabilités à traiter qui sont dans les alertes, comme la page. Il dit aussi quand KANAP a lu la NVD et CVE.org pour la dernière fois, et si la dernière lecture a échoué. Les serveurs et les applications qu'une vulnérabilité atteint suivent les liens directs, comme la page les compte (voir [Ce que KANAP compte](vulnerabilities.md#what-kanap-counts)). Sur les actifs et les applications, Plaid lit combien de vulnérabilités restent à traiter et combien sont critiques ou élevées. Demandez par exemple : « Quelles applications critiques sont touchées par une CVE exploitée ? » Les assistants connectés via MCP obtiennent les mêmes réponses.

Plaid liste, compte et lit les incidents. Il les filtre par actif, application ou technologie, les regroupe par fiche liée ou par mois, et lit le délai de résolution. Un incident restreint que vous ne pouvez pas voir n'apparaît nulle part. Voir [Demander à l'assistant](incidents.md#demander-a-lassistant).

Plaid lit les contrats comme les montre la liste des [Contrats](contracts.md) : l'état du terme en cours (à décider, en cours, reconduit, fin sans reconduction, échu), la prochaine échéance et la date limite de résiliation, avec le délai de décision de votre espace de travail et les décisions de renouvellement déjà enregistrées. Il lit aussi ce que couvre un contrat : ses applications, actifs, technologies et lignes budgétaires. Demandez par exemple : « Quels contrats sont à décider, et quelles applications couvrent-ils ? » ou « Quels contrats couvrent APP-8 ? » Les assistants connectés par MCP obtiennent les mêmes réponses.

Plaid désigne une fiche par sa référence, comme `APP-8` ou `BL-14`, ou par son nom quand elle n'en a pas, comme un contrat, un fournisseur ou un site. La référence ou le nom mène à la page de la fiche quand vous pouvez l'ouvrir.

Plaid ne nomme une fiche liée à celle que vous interrogez que si vous pouvez lire son module, comme la page de la fiche : les applications d'un projet demandent les applications, ses actifs l'infrastructure, ses demandes d'origine les demandes. Un Business Contributor n'obtient que les projets, demandes et applications auxquels il participe. Les serveurs sur lesquels tourne une application font exception : ils viennent avec l'application, comme dans son onglet **Déploiements**. Interrogé sur une personne, Plaid donne ce que la liste des utilisateurs vous montre : un administrateur des utilisateurs obtient le profil complet, les autres le nom, l'e-mail et le statut. Les assistants connectés via MCP obtiennent les mêmes réponses.

Un administrateur des utilisateurs qui a accès à toutes les données lit avec Plaid ce que montrent **Administration › Rôles** et **Administration › Accès aux données**. Plaid liste les rôles, le nombre de personnes de chacun et les droits que donne chaque rôle, avec les mots de l'écran Rôles. Il dit qui est limité à quelles sociétés, quels centres de coûts ou quels groupes, en Lecture ou en Saisie, qui est limité sans aucun nœud, et qui voit une société. La liste des utilisateurs porte aussi tous les rôles d'une personne et son accès. Demandez par exemple : « Qui est limité à Alpha Spain, et avec quel accès ? » ou « Quels rôles donnent le niveau Administrateur sur le budget ? » Une personne dont l'accès est limité ne les lit pas, même administratrice des utilisateurs, et Plaid le dit. Plaid ne modifie rien de tout cela : l'accès aux données d'une personne, ses rôles, les droits d'un rôle, la création ou la désactivation d'une personne restent sur les écrans **Administration**. Les assistants connectés via MCP obtiennent les mêmes réponses.

Plaid lit l'[historique](record-history.md) d'une fiche, tel que le montre son onglet **Historique**, pour toute personne qui peut ouvrir la fiche. Demandez par exemple : « Qui a modifié les montants de BL-12 ? » Une fiche sans onglet Historique, comme un utilisateur ou un rôle, n'a pas d'historique dans KANAP : Plaid le dit et n'en reconstitue aucun à partir d'autres données. Les assistants connectés via MCP obtiennent les mêmes réponses.

Quand Plaid additionne des montants budgétaires, une ligne dont la devise n'a pas de taux de change pour l'année est exclue de la somme. Plaid indique alors quelles devises et quelles années il a exclues. Les assistants connectés par MCP reçoivent la même réponse.

Plaid lit les chiffres de personnel du rapport [Coût par ETP](reports.md#cout-par-etp) pour chaque année et chaque colonne budgétaire : le coût et les ETP des lignes en personnes ou en jours, le coût des lignes au prix journalier et les jours qu'elles achètent. KANAP calcule le coût par ETP et le TJM par fournisseur, société, centre de coûts ou tout autre regroupement, comme le fait le rapport, et Plaid les cite. Demandez par exemple : « Quels sont les ETP externes et le TJM par fournisseur en 2026 ? » Quand vous ne nommez ni OPEX ni CAPEX, Plaid répond pour les deux types. Les assistants connectés par MCP reçoivent les mêmes réponses.

Plaid donne aussi les chiffres d'autres rapports budgétaires. Avec le droit de lecture sur les comptes, il totalise le budget par compte de consolidation, comme le rapport [Comptes de consolidation](reports.md#comptes-de-consolidation). Sans ce droit, Plaid dit qu'il faut le droit sur les comptes. Il mesure plusieurs colonnes ou années dans une même réponse et ajoute un second regroupement, par exemple le budget, la révision et l'atterrissage prévu de chaque société, ou chaque fournisseur sur trois ans. Il trouve les plus fortes hausses ou baisses entre deux colonnes, 10 par défaut, comme le rapport [Top hausse / baisse](reports.md#top-hausse-baisse). Il donne les ETP mois par mois avec la moyenne et le mois le plus haut, comme [Effectifs par mois](reports.md#effectifs-par-mois). Demandez par exemple : « Quelles lignes augmentent le plus du budget 2026 à la révision ? » ou « Quel est le budget de chaque fournisseur en 2025, 2026 et 2027 ? » Plaid lit toutes les lignes budgétaires, alors que les rapports lisent les lignes encore actives au 1er janvier de l'année qui précède la première année affichée : une ligne terminée plus tôt peut donc faire différer un chiffre du rapport. Les assistants connectés par MCP reçoivent les mêmes réponses.

Avec le droit de lecture sur Reporting, Plaid lit la refacturation comme la montrent les rapports [Refacturation globale](reports.md#refacturation-globale) et [Refacturation par société](reports.md#refacturation-par-societe) : le montant refacturé à chaque société et département bénéficiaires, ce que paie chaque société, le net, les ratios par utilisateur et au chiffre d'affaires, et les lignes refacturées à une société. Quand vous ne nommez ni OPEX ni CAPEX, il couvre les deux types. Plaid reprend les avertissements du rapport, comme une ligne qu'il n'a pas pu répartir, une ligne sans société payeuse ou un montant sans taux de change. Quand votre accès aux données est limité, les chiffres portent sur les lignes que vous pouvez lire, sans le total du groupe, et Plaid ne liste les lignes refacturées à une société que pour les sociétés de votre accès. Les assistants connectés par MCP reçoivent les mêmes réponses.

Plaid lit quatre référentiels, tels que leurs écrans les montrent. Il n'en modifie aucun.

- **Centres de coûts**, avec le droit de lecture sur les centres de coûts : l'arbre des groupes de centres et des centres de coûts, la société et le responsable budgétaire de chaque nœud, et le nombre de lignes OPEX et CAPEX qui l'utilisent. Plaid liste tous les nœuds sous un groupe, à tous les niveaux, ou seulement les nœuds placés juste en dessous.
- **Calendriers de jours ouvrés**, avec le droit de lecture sur les calendriers de jours ouvrés : les jours ouvrés d'une année, mois par mois, et les jours fériés d'un calendrier standard. KANAP calcule le total de l'année, et Plaid le cite. Un pays sans calendrier dans votre espace de travail n'en a aucun, et Plaid ne calcule pas ses jours.
- **Dimensions analytiques**, avec le droit de lecture sur l'analytique : les réglages de chaque dimension (les types de ligne concernés, si une valeur est obligatoire, si chacun peut ajouter une valeur), son nombre de valeurs et les lignes qui l'utilisent. Une dimension obligatoire ne compte comme obligatoire que tant qu'elle est activée.
- **Taux de change et devise de reporting**, avec le droit de lecture sur le budget : la devise de reporting, les devises par défaut et autorisées, le taux de chaque devise pour chaque année avec sa source, les taux saisis à la main et les taux manquants.

Un taux est le montant en devise de reporting pour 1 unité de la devise. Dans un espace de travail qui présente ses rapports en euros, un taux de 0,89 pour USD signifie 1 USD = 0,89 EUR. KANAP calcule le taux inverse et le taux entre deux autres devises, par exemple de USD vers CHF, et Plaid les cite.

Sans le droit qu'un référentiel demande, Plaid nomme le droit manquant. Quand votre accès aux données est limité, vous lisez tous les référentiels, comme à l'écran. Seuls les nombres de lignes budgétaires couvrent votre accès, et les devises listées avec leurs taux sont celles des lignes et des contrats que vous pouvez lire.

Plaid lit l'historique d'un centre de coûts, d'un calendrier ou d'une dimension, tel que le montre son onglet **Historique**. `Search all` trouve un centre de coûts, un calendrier ou une dimension par son code ou son nom. Il ne cherche pas les taux de change : Plaid les liste à la place.

Demandez par exemple : « Quels centres de coûts dépendent de Group IT ? », « Qui est le responsable budgétaire de FR-TRV-600 ? », « Combien de jours ouvrés en France en 2026 ? », « Quelles dimensions sont obligatoires ? » ou « Quel est le taux USD pour 2026 ? » Les assistants connectés par MCP reçoivent les mêmes réponses.

Les totaux viennent de KANAP. Une liste de lignes budgétaires ou de contrats est accompagnée du total de toutes les fiches qui correspondent, toutes pages comprises, et du total des fiches listées : Plaid cite l'un des deux ou demande une somme à KANAP. Si vous demandez les dix plus grosses lignes et leur total, Plaid donne le total de ces dix lignes. Quand votre accès aux données est limité à certaines sociétés ou à certains centres de coûts, Plaid précise que ses décomptes et ses totaux couvrent votre accès, et ne les présente pas comme le total de l'espace de travail.

Quand Plaid essaie une valeur de filtre qu'un champ n'accepte pas, par exemple « actif » pour le statut d'une application (qui est « activé » ou « désactivé »), KANAP la refuse et liste les valeurs acceptées. Plaid relance alors la recherche avec la bonne valeur.

Quand vous demandez une modification que votre rôle ne permet pas, Plaid nomme le droit qui vous manque, par exemple « vous avez besoin du droit de modifier les projets ». Un administrateur l'ajoute à votre rôle.

Plaid ne fait que les modifications que vos écrans vous permettent, sur les fiches que vous pouvez y atteindre. Avec le droit de contribuer aux projets, vous pouvez faire changer par Plaid l'objectif d'un projet et ses liens vers des applications, des actifs et des lignes budgétaires. Le droit de contribuer aux demandes couvre les mêmes liens sur les demandes. Un Business Contributor ne fait ces modifications que sur les projets et les demandes auxquels il participe. Lier une fiche demande le droit de lire son module. Renommer un projet ou changer ses autres champs demande le droit de modifier les projets, comme sur la page du projet.

Avec le niveau Contributeur sur les incidents, Plaid enregistre un incident, modifie ses champs, fait avancer son statut jusqu'à Clôturé, ajoute des notes au journal et lie des actifs, des applications et des technologies. Avec le niveau Membre sur les tâches, il crée une tâche de suivi sur un incident. Avec le niveau Administrateur sur les incidents, il rouvre ou annule un incident, avec une raison, et active ou désactive sa restriction. La clôture fige l'incident. Sa suppression reste sur son écran. Voir [Demander à l'assistant](incidents.md#demander-a-lassistant).

Avec le niveau Membre sur l'infrastructure, Plaid crée une technologie, l'adopte depuis le catalogue KANAP ou complète une technologie saisie à la main. Il modifie ses champs, ajoute des versions et change leurs dates, la lie à des applications et à des serveurs, ajoute ou retire ses responsables, ses contacts de support et ses liens web, et active ou désactive ses alertes de vulnérabilité, pour toute la technologie ou pour une version. Lier une application demande aussi le droit de lire les applications. Ajouter un contact de support demande le droit de lire les contacts. Demandez à Plaid d'annuler une modification qu'il a faite dans la conversation : il prépare un aperçu qui remet les choses en place. La création ou l'adoption d'une technologie ne s'annule pas, et une version ajoutée au passage reste. La suppression d'une technologie ou d'une version, les pièces jointes, les identifiants de vulnérabilité et le nouveau rapprochement des vulnérabilités (**Actualiser**) restent sur les écrans. Voir [Demander à l'assistant](technologies.md#demander-a-lassistant).

Avec le même niveau, quand les vulnérabilités sont suivies, Plaid change l'état des vulnérabilités en **À traiter**, **Traitée** ou **Non concernée**, avec une note si vous en donnez une. Nommez une CVE pour changer toutes ses lignes, ajoutez une technologie, ou une technologie et une version, pour restreindre, ou décrivez les lignes avec les filtres de la page. Un changement porte sur 5 000 lignes au plus, comme sur la page. L'aperçu dit combien de lignes et de CVE changent. **Acceptée** n'est pas un état : Plaid propose **Traitée** avec une note, ou **Non concernée**. Demandez à Plaid d'annuler le changement dans la conversation. Demandez par exemple : « Passe CVE-2024-3094 en non concernée sur TEC-3, le paquet n'est pas installé ». Voir [Demander à l'assistant](vulnerabilities.md#demander-a-lassistant).

Quand Plaid crée une ligne budgétaire, il demande si la ligne est OPEX ou CAPEX si vous ne l'avez pas dit. Il ne change pas le type d'une ligne existante : utilisez **Changer le type...** dans l'espace de travail de la ligne (voir [Changer le type](budget-lines.md#changer-le-type)). Plaid ne définit le contrat que des lignes OPEX. Une ligne CAPEX rejoint ses contrats par les liens de son onglet **Relations**.

### Supprimer une fiche { #deleting-a-record }

Plaid supprime une fiche à la fois : une tâche, un contact, un site, un document, une ligne budgétaire (OPEX ou CAPEX), une connexion ou une interface. Chaque suppression arrive en aperçu, que vous approuvez. Une suppression ne s'annule pas.

L'aperçu liste ce qui part avec la fiche, comme les commentaires, les temps saisis, les pièces jointes, les versions et les liens. Il ne nomme que ce que vous pouvez lire et compte le reste parmi les autres liens. Si la fiche change entre l'aperçu et votre approbation, KANAP refuse la suppression. Redemandez-la à Plaid pour obtenir un nouvel aperçu.

Une seule suppression attend votre approbation à la fois dans une conversation. Quand vous demandez de supprimer plusieurs fiches, Plaid les prépare l'une après l'autre.

Plaid demande le niveau que demande l'écran :

| Fiche | Niveau |
|---|---|
| Tâche | Administrateur des tâches |
| Contact | Administrateur des contacts |
| Site | Membre des sites |
| Document | Administrateur de la base de connaissances, avec le droit d'écrire dans sa bibliothèque |
| Ligne budgétaire | Administrateur du budget |
| Connexion | Membre de l'infrastructure |
| Interface | Administrateur des applications |

Quand votre accès aux données est limité à certaines sociétés ou à certains centres de coûts, Plaid ne supprime ni contacts ni lignes budgétaires, comme les écrans.

Plaid refuse ce que les écrans refusent :

- Une tâche qu'une demande désigne comme son origine
- Une ligne budgétaire avec des montants dans une colonne gelée
- Une interface avec des liaisons, sauf si vous demandez de supprimer ses liaisons avec elle
- Un document intégré à une fiche. Il part quand sa fiche est supprimée.

Les autres fiches, comme les applications, les actifs, les contrats, les projets, les demandes, les incidents et les technologies, se suppriment sur leurs écrans. Plaid le dit et nomme l'écran. Les assistants connectés par MCP ne font que lire.

### Ce que Plaid ne lit pas { #what-plaid-does-not-read }

Plaid ne lit pas :

- Le journal d'audit (**Administration › Journal d'audit**)
- Les agents IA

Quand une question touche l'un de ces éléments, Plaid dit qu'il ne peut pas le lire et nomme l'écran qui le montre, avec les mots de vos menus dans la langue de votre profil. Une recherche sans résultat indique à Plaid ce qu'il n'a pas cherché, pour que la réponse n'affirme pas que la fiche n'existe pas. Il en va de même pour un champ : le contexte d'une fiche porte ses champs principaux, et Plaid lit la fiche complète avant de dire qu'un champ est vide. Les assistants connectés par MCP obtiennent les mêmes réponses.

## Artefacts et aperçus

Certaines réponses s'accompagnent de contenu supplémentaire qui ne trouve pas naturellement sa place dans le fil de discussion. KANAP les appelle des **artefacts**.

Cas courants :

- Un long bloc de texte ou de markdown que Plaid a préparé pour vous
- Une comparaison côte à côte **Avant / Après** d'un enregistrement que Plaid souhaite mettre à jour
- Un brouillon d'import ou un ensemble de modifications nécessitant votre validation

Les artefacts s'ouvrent dans un panneau latéral à droite de l'espace de travail. Le panneau peut être ouvert ou fermé en cliquant sur le bouton d'onglet **Artefacts** sur le bord droit de l'écran.

Le panneau s'ouvre automatiquement lorsque :

- Un long aperçu arrive pendant une réponse en cours de diffusion
- Un aperçu en attente nécessite votre décision (ceux-ci ouvrent toujours le panneau, car vous devez agir dessus)

Pour les aperçus de modification en attente, le panneau propose deux boutons :

- **Approuver** : confirme la modification et permet à Plaid de l'appliquer
- **Rejeter** : annule la modification. Plaid indique que la modification a été rejetée et ne prépare rien à sa place. Si votre demande portait sur plusieurs modifications, il poursuit avec les autres.

Un aperçu, et le message que Plaid écrit après votre approbation ou votre rejet, sont dans la langue de votre profil, avec les noms de champs et les valeurs des écrans. Une ligne budgétaire demandée avec un montant arrive en un seul aperçu : une seule approbation crée la ligne, sa version budgétaire de l'année et le montant.

Quand vous demandez une modification que Plaid ne peut pas faire, comme supprimer un projet ou relancer le rapprochement des vulnérabilités, il le dit et nomme l'écran où vous pouvez la faire. Il ne prépare aucune autre modification à sa place.

Rien de ce qui modifie les données de KANAP n'est appliqué en silence. L'aperçu est le point de contrôle.

## Indicateurs d'utilisation

Au-dessus du composeur, deux petits indicateurs vous aident à garder à l'esprit les coûts et les limites :

- **Utilisation intégrée** : lorsque Plaid s'exécute sur le modèle inclus KANAP plutôt que sur l'un des modèles propres à votre organisation, cet indicateur montre combien de messages restent pour le mois en cours ainsi que la date de réinitialisation du quota. Un administrateur a confirmé ce modèle au préalable (voir [Paramètres Plaid](ai-settings.md#confirmer-le-modele-inclus-kanap)). Lorsque la limite est atteinte, le composeur est désactivé et un texte d'aide invite les administrateurs à basculer vers un modèle qui leur est propre ; voir [Modèles IA](ai-models.md).
- **Utilisation des tokens** : une fine barre avec des compteurs de tokens en entrée/sortie pour la conversation en cours, ainsi que la taille de la dernière requête. Les longues conversations deviennent plus coûteuses avec le temps ; la barre rend ce coût visible afin que vous puissiez décider quand démarrer un nouveau fil.

La barre d'utilisation des tokens n'apparaît qu'une fois que la conversation compte au moins un échange.

## Conseils

- **Utilisez les préfixes pour plus de précision** : `@T-`, `@DOC-`, `@PRJ-`, `@REQ-`, `@INC-`, `@TEC-` correspondent directement aux références natives de KANAP. C'est le moyen le plus rapide de diriger Plaid vers un enregistrement précis et ils résistent au copier-coller car ils sont identiques à ce que vous voyez ailleurs dans l'application.
- **Démarrez une nouvelle conversation par sujet** : garder des questions sans rapport dans des conversations distinctes réduit la fenêtre de contexte, accélère les réponses et allège la facture de tokens. La liste des conversations est regroupée par date, ce qui vous permet de les retrouver facilement.
- **Approuvez et rejetez en connaissance de cause** : les aperçus sont la seule barrière entre Plaid et vos données en production. Prenez la seconde nécessaire pour lire la comparaison avant de cliquer sur **Approuver**.
- **Arrêtez plutôt que d'attendre** : si Plaid s'engage sur une mauvaise voie en cours de diffusion, cliquez sur le bouton **Arrêter** plutôt que d'attendre la fin. Vous économiserez des tokens et votre message suivant pourra corriger le tir.
- **Déposez les images directement** : glisser une capture d'écran sur le composeur est plus rapide que le sélecteur de fichiers, et le collage depuis le presse-papiers fonctionne également. Utilisez cette méthode pour décrire un problème d'interface ou demander à Plaid de lire un graphique.
