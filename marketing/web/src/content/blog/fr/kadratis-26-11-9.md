---
title: "Kadratis 26.11.9 : importer sans doublon, modifier en masse"
description: "Huit versions sont sorties depuis la 26.11.1. Les imports retrouvent ce qui existe avant de créer, un champ se modifie sur toute une sélection depuis la liste ou par Kad, les fournisseurs et les contrats ont une référence, et une nouvelle fiche n'est enregistrée qu'à sa création. Le tour des nouveautés."
date: 2026-11-22
topic: release
features: [budget, ai]
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: kadratis-26-11-9
---

Huit versions sont sorties depuis la 26.11.1, dont celle qui a donné au produit [son nom, Kadratis](/fr/blog/kanap-devient-kadratis). Cet article fait le tour de ce qu'elles changent dans le travail de tous les jours, jusqu'à la 26.11.9 publiée le 22 novembre :

- Un import, depuis l'écran ou par Kad, retrouve les fiches qui existent avant d'en créer une seule.
- Un champ se modifie sur toute une sélection de lignes budgétaires ou d'applications, depuis la liste ou en le demandant à Kad.
- Les fournisseurs, les sociétés, les contacts, les départements et les contrats ont une référence, comme `SUP-12` ou `CTR-5`.
- Une nouvelle fiche n'est enregistrée qu'au moment où vous la créez.
- Les droits se délèguent plus finement, et les agents de support trouvent le bon document quelle que soit la langue du ticket.

## Des imports qui retrouvent ce qui existe déjà

![Dans Kad, l'aperçu de l'import d'un classeur budgétaire : les valeurs du fichier rapprochées de valeurs existantes, chacune avec le bouton Défaire, et les lignes qui ressemblent à une ligne existante.](/screenshots/blog/kad-import-matches-2026-11-22.png)

Un tableur n'écrit jamais les noms comme le référentiel : « Dell » pour « Dell Technologies », un fournisseur sans son accent, une nature de coût dans une autre langue. Chaque écart devenait une erreur à corriger, ou une fiche en double.

**Rapprocher avant de créer.** Tous les imports retrouvent une fiche par son nom sans tenir compte des majuscules ni des accents. Le fichier budgétaire rapproche ainsi ses fournisseurs, ses sociétés et ses valeurs de dimension ; sur les dimensions recommandées, il reconnaît aussi une valeur écrite dans une autre langue, `Matériel` pour `Hardware`. Kad va plus loin : pour un nom écrit autrement, une traduction ou une forme courte, il propose la fiche existante. Chaque rapprochement est listé à la vérification, et **Défaire** le retire.

**Une ligne déjà saisie ne devient pas une seconde ligne.** Une ligne budgétaire ou une application du fichier qui ressemble à une fiche existante est écartée par défaut. Pour chacune, vous choisissez de la créer quand même ou de mettre à jour la fiche à laquelle elle ressemble. Un fichier chargé deux fois ne crée plus rien.

**Des avertissements sur ce qui sort de l'ordinaire.** La vérification du fichier budgétaire signale, sans bloquer, un montant dix fois supérieur ou inférieur à celui des lignes comparables, des dates hors des années des montants et une devise autre que celle de la société payeuse.

**Une seule règle pour les cellules vides.** Dans tous les imports, une cellule vide garde la valeur enregistrée, `-` l'efface, et une colonne absente du fichier n'est pas touchée. La vérification compte les valeurs qui seront effacées. Un fichier peut donc ne porter que la référence des fiches et les colonnes à changer, et un fichier exporté puis importé tel quel ne change rien.

**Un budget importé par Kad en une seule carte.** Vous joignez le classeur. Kad montre la correspondance des colonnes, les rapprochements, les lignes ressemblantes et les fournisseurs qu'il créera. Rien n'est écrit avant votre approbation.

**Une trace pour chaque import.** Le journal d'audit enregistre tous les imports, faits depuis un écran ou par Kad. L'onglet **Historique** de chaque fiche créée ou modifiée nomme la personne, ou Kad pour elle.

Voir les pages [Fichiers CSV et Excel](https://doc.kadratis.com/fr/csv-files/) et [Charger un budget depuis un tableur](https://doc.kadratis.com/fr/budget-file/) du manuel.

## Modifier en masse, depuis la liste ou par Kad

![Les seize lignes budgétaires d'un fournisseur cochées dans la liste, et la fenêtre Modifier la sélection : le champ Responsable IT, sa nouvelle valeur et le compte, 13 lignes qui changeront et 3 qui ont déjà cette valeur.](/screenshots/blog/bulk-edit-budget-lines-2026-11-22.png)

Une réorganisation, un responsable qui change d'équipe, un fournisseur racheté : ces changements touchent des dizaines de fiches à la fois.

**Depuis la liste.** Dans les lignes budgétaires et les applications, cochez des fiches ou prenez tout le filtre, puis cliquez sur **Modifier la sélection**. Vous choisissez le champ et sa nouvelle valeur. La fenêtre compte les fiches qui changeront, celles qui ont déjà cette valeur et celles qui sont refusées, avec la raison, puis montre le résultat.

- Sur les lignes budgétaires : le centre de coûts, le compte, la société payeuse, le fournisseur, les responsables, une valeur de dimension, run ou build. Les montants ne se modifient pas ainsi.
- Sur les applications : les responsables, la catégorie, le cycle de vie, la criticité business et la criticité cyber.

![Dans Kad, la même modification demandée en une phrase : la carte montre le filtre, le champ, sa nouvelle valeur et le même compte des lignes.](/screenshots/blog/kad-bulk-change-2026-11-22.png)

**En le demandant à Kad.** « Mets Nadia Lemaire responsable IT des lignes budgétaires du fournisseur Fromatech Consulting » : Kad prépare une seule carte, qui montre les fiches visées, la nouvelle valeur et les mêmes comptes. Vous approuvez, et l'historique de chaque fiche indique la modification comme faite par Kad pour vous. Quand plusieurs cartes attendent, **Tout rejeter** rejoint **Tout approuver**.

Voir [Modifier des lignes en masse](https://doc.kadratis.com/fr/budget-lines/#modifier-des-lignes-en-masse) et [Modifier des fiches en masse](https://doc.kadratis.com/fr/ai-assistant/#changing-records-in-bulk) avec Kad.

## Une référence pour chaque fiche

![La page du contrat SAP Maintenance & Support : sa référence, CTR-11, précède son nom dans l'en-tête.](/screenshots/blog/contract-reference-2026-11-22.png)

Les projets, les applications et les lignes budgétaires avaient déjà la leur (`PRJ-3`, `APP-7`, `BL-12`). Les fournisseurs, les sociétés, les contacts, les départements et les contrats en reçoivent une à leur tour : `SUP-12`, `COMP-3`, `CTCT-8`, `DEPT-2`, `CTR-5`.

**Partout où la fiche apparaît.** La référence figure sur la page de la fiche, dans sa liste (filtre, tri, export), dans son adresse et dans les liens qui y mènent. La recherche globale, les sélecteurs, la mention `@`, Kad et le serveur MCP retrouvent une fiche par sa référence.

**Une clé pour les imports.** Une ligne de fichier qui porte la référence met à jour cette fiche, même si son nom a changé : renommer un fournisseur par un import ne crée pas de doublon. La vérification signale chaque fiche qui sera renommée.

Les contributeurs du portefeuille, qui portaient le préfixe `CTR`, deviennent `MEM-n`. Les adresses enregistrées avant cette version ouvrent toujours le bon contributeur.

## Créer une fiche : rien n'est enregistré avant la création

![Une nouvelle ligne budgétaire après un clic sur Créer : les libellés des champs obligatoires encore vides sont en rouge, avec une icône d'alerte.](/screenshots/blog/create-required-fields-2026-11-22.png)

La 26.11.1 avait donné la même création à toutes les fiches. Les versions suivantes l'ont rendue plus sûre.

**Quitter n'écrit rien.** Une fiche est créée par **Créer**, Entrée ou Tab. Quitter sa page avant n'enregistre rien et ne pose aucune question. Une ligne budgétaire, un actif ou une connexion est créé dès que ses champs obligatoires sont renseignés, dans n'importe quel ordre.

**Les champs manquants se voient.** **Créer** marque chaque champ obligatoire encore vide d'un libellé rouge et d'une icône d'alerte, et place le curseur dans le premier. Un champ obligatoire qui n'a qu'une valeur possible est déjà rempli, et une fiche créée depuis une liste filtrée reprend les filtres qui ne gardent qu'une valeur.

**Créer, puis Terminé.** Une fois la fiche créée, **Créer** devient **Terminé**, qui vous ramène à votre point de départ.

**OPEX ou CAPEX dès la création.** Une nouvelle ligne budgétaire choisit son type dans un menu **Type**. Elle a désormais toujours un compte, à l'écran, par Kad, dans le fichier budgétaire et par l'API.

**Sans quitter la fiche.** Un contact se crée depuis n'importe quel champ de contact, et la liste des fournisseurs d'un contrat ou d'une ligne budgétaire se termine par **+ Nouveau fournisseur**.

## Des droits plus fins

**Un centre de coûts suffit pour modifier.** Pour une personne dont l'accès aux données est limité, un nœud en Saisie sur un centre de coûts, ou sur un groupe au-dessus, permet de modifier les lignes budgétaires imputées à ce centre et les contrats qui y sont placés, quelle que soit la société qui paie. Créer ou déplacer une ligne demande toujours la société du centre. Voir la page [Accès aux données](https://doc.kadratis.com/fr/data-access/) du manuel.

**On ne donne que les droits que l'on a.** Une personne qui administre les utilisateurs sans être Administrateur attribue seulement les rôles qu'elle détient, et voit en lecture seule les personnes qui ont plus de droits qu'elle. Un espace de travail garde toujours au moins un Administrateur actif.

**Les liens suivent les droits de lecture.** L'historique d'un projet, le journal d'un incident ou le champ Applications d'une tâche ne nomment que les fiches liées que la personne peut lire. Les autres sont comptées. Kad et le serveur MCP suivent la même règle.

**Connexion Microsoft.** Une première connexion Microsoft ne rattache plus un compte existant sur sa seule adresse : son titulaire confirme le lien depuis un e-mail, et le compte garde son mot de passe.

## Les agents de support trouvent le bon document

**Dans toutes les langues.** Les agents de support et Kad trouvent un document de la base de connaissances quelle que soit la langue du ticket : français, anglais, allemand ou espagnol. Un agent cite le passage qui répond, où qu'il soit dans un long document, et rédige sa réponse à partir du texte des documents retenus. Il ne lit que les documents publiés.

**Des bibliothèques choisies par agent.** Un agent cherche et cite seulement dans les bibliothèques qu'un administrateur lui ouvre. Un nouvel agent démarre sans aucune.

**Les notes internes restent internes.** Un agent de support utilise ou ignore les notes internes d'un ticket, au choix. Utilisées, elles éclairent le choix de ses actions et sa note au technicien. Ses réponses au demandeur ne s'appuient que sur les messages publics.

**Fermer et résoudre.** Avec la mise à jour du statut en Automatique, un agent ferme et résout aussi les tickets, après l'envoi de sa réponse au demandeur.

## Autres améliorations

- **Les premiers pas suivent vos données.** Avec vos propres données, une étape est cochée dès que l'élément existe dans l'espace de travail. L'indication d'une étape tient dans une bulle en bas à gauche de la fenêtre, et le parcours se change à tout moment depuis la tuile. Pendant l'essai, un administrateur peut repartir de l'exemple complet.
- **Les listes vides proposent de créer.** Une liste vide de sites, d'actifs, de sociétés ou de contacts affiche un bouton de création en son milieu.
- **Fins de support.** La liste des technologies montre la prochaine fin de support, standard ou étendue. Sur une application, la fin de support de chaque technologie est celle du rapport, colorée selon son état.
- **Colonne budgétaire par défaut.** La liste des lignes suit un changement de la colonne par défaut, et l'onglet Budget d'une ligne s'ouvre sur elle.
- **Saisie.** Une nouvelle ligne budgétaire commence le 1er janvier de l'année affichée. Les nombres décimaux suivent la langue de l'interface (6,5 j/mois). Une date tapée sans séparateurs garde son mois : `01012026` devient 01/01/2026.
- **Intégrations.** Changer l'adresse d'une intégration (GLPI, PRTG, Netbox) ou le serveur d'un modèle d'IA redemande son jeton ou sa clé.
- **Abonnement au service hébergé.** Après un paiement refusé, l'espace de travail reste utilisable 14 jours, avec un bandeau qui donne le montant dû et la date limite. La page de facturation règle la facture dès la carte mise à jour.

## Pour les installations on-premise

- **Une sauvegarde chiffrée chaque nuit.** Un script (`infra/backup/`) chiffre la base de données, les fichiers et la configuration avec `age`, et les dépose dans un bucket S3 où le serveur ne peut qu'écrire et lister. Le [guide d'exploitation](https://doc.kadratis.com/fr/on-premise/operations/#sauvegarde-nocturne-chiffree-vers-un-bucket-s3) explique la mise en place, le contrôle et la restauration.
- **Des images `kadratis-*`.** Depuis la 26.11.4, les images publiées s'appellent `kadratis-api`, `kadratis-web` et `kadratis-api-tools`. Le fichier compose de la version les nomme : la mise à jour habituelle les prend.
- **Les imports longs aboutissent.** Le proxy du conteneur web attend 300 secondes les réponses de l'API : un import ou une synchronisation longue ne finit plus sur une page 504.
- **Intégrations sans redirection.** Les appels à GLPI, PRTG, Netbox ou au serveur d'un modèle d'IA ne suivent plus de redirection vers une autre adresse, par exemple de `http://` vers `https://`. Vérifiez que les adresses enregistrées sont les adresses finales.
- **API pour vos scripts.** Les routes `POST …/creation` des lignes budgétaires, des actifs et des connexions sont retirées, `POST /budget-lines` refuse une ligne sans compte, et un import appelé avec `mode=replace` fusionne.

## Mettre à jour

Sur le service hébergé, il n'y a rien à faire : vous êtes déjà en 26.11.9.

Si vous hébergez Kadratis et suivez la branche stable, passez directement à la 26.11.9. Aucune action n'est demandée, et les migrations s'exécutent au démarrage. Lisez d'abord la section on-premise des notes des versions [26.11.5](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.5), [26.11.7](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.7), [26.11.8](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.8) et [26.11.9](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.9). La procédure est dans le [guide d'exploitation](https://doc.kadratis.com/fr/on-premise/operations/#procedure-de-mise-a-jour).

## Suivre les nouvelles versions

- **Sur GitHub** : suivez le dépôt et choisissez « Releases » pour être prévenu à chaque version.
- **Sur le blog** : abonnez-vous au [flux RSS](/fr/blog/rss.xml).
- **Sur le site** : le [changelog](/fr/changelog) liste tous les articles de version.

[Détails techniques et liste complète des changements](https://github.com/kanap-hq/KANAP/releases/tag/v26.11.9)
