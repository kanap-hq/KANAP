# Interfaces

Les Interfaces documentent les flux de données logiques entre vos applications. Chaque interface représente une intégration métier (le « pourquoi » et le « quoi » de l'échange de données), indépendamment de la manière dont elle est techniquement implémentée. L'espace de travail vous permet de décrire l'interface, de définir les legs qui déplacent les données dans votre paysage, de configurer les liaisons spécifiques à chaque environnement, de capturer les règles de mappage au niveau des champs et de lier interfaces, documents et pièces jointes connexes.

## Premiers pas

Rendez-vous dans **Cartographie SI > Interfaces** pour voir votre registre d'intégration. Cliquez sur **Ajouter une interface** pour créer une nouvelle entrée, ou ouvrez-en une existante pour la modifier.

**Ajouter une interface** ouvre la page de l'interface sur l'onglet **Flux**, où se trouvent ses champs obligatoires :

- Le titre : un nom descriptif pour l'intégration
- **Application source** et **Application cible**, dans l'onglet **Flux**
- **Catégorie de données**, dans le panneau des propriétés : le type de données transférées

Vous pouvez les remplir dans l'ordre de votre choix. Rien n'est enregistré tant que les quatre ne sont pas remplis. Dès qu'ils le sont, KANAP crée l'interface avec tout ce que contient le brouillon et lui attribue sa référence (`INT-4`). La page passe à l'interface, et **Environnements**, **Mappage des données**, **Relations** et **Historique** s'ouvrent.

**Conseil** : Définissez tôt le **Type de route**. Il contrôle quels legs sont générés automatiquement et ce qui apparaît dans l'onglet Flux et la matrice Environnements.

### Créer ou annuler { #cancelling-a-creation }

Tant que l'interface est en cours de création, son en-tête affiche **Créer** et **Annuler**. Ils restent jusqu'à ce que vous quittiez l'interface.

- **Créer** conserve l'interface et vous ramène à votre point de départ. S'il manque encore quelque chose, un message le nomme, et le titre ou le premier champ manquant prend le focus. Si le brouillon est complet, KANAP crée l'interface et vous ramène aussitôt
- **Annuler** supprime l'interface. Si vous avez ajouté quelque chose après sa création, une confirmation liste ce qui sera supprimé. Vous pouvez annuler votre propre création sans le droit de supprimer des interfaces

Si vous quittez l'interface autrement (le menu, la flèche de retour), elle est conservée : elle est complète.

Avant la création de l'interface, **Annuler**, la flèche de retour ou Échap dans le titre partent sans rien enregistrer. Quand le brouillon contient quelque chose, une confirmation est demandée avant de l'abandonner. Un lien du menu demande la même chose.

---

## Travailler avec la liste

La grille Interfaces affiche votre registre d'intégration en un coup d'œil.

**Colonnes par défaut** :

- **Référence** : La référence attribuée par KANAP (`INT-4`)
- **Code d'interface** : Votre propre code court, s'il est renseigné
- **Nom** : Nom de l'interface
- **Environnements** : Points colorés montrant quels environnements ont déjà des liaisons configurées (ex. : PROD, QA, DEV)
- **App source** et **App cible** : Les applications connectées
- **Cycle de vie** : Statut actuel
- **Criticité** : Importance métier
- **Créée** : Quand l'enregistrement a été créé

**Colonnes supplémentaires** (via le sélecteur de colonnes) :

- **Processus métier** : Processus métier lié
- **Catégorie de données** : Type de données transférées
- **Contient des PII** : Si l'interface manipule des données personnelles
- **Couverture env.** : Nombre d'environnements avec au moins une liaison
- **Liaisons** : Nombre total de liaisons d'environnement

**Filtrage** :

- Recherche rapide sur toutes les colonnes texte
- Filtres de colonne sur les colonnes texte
- **Cycle de vie**, **Criticité**, **Processus métier**, **Catégorie de données** et **Contient des PII** utilisent des filtres par cases à cocher : vous pouvez choisir plusieurs valeurs à la fois. Le filtre **Criticité** propose aussi **(Vide)** pour les interfaces sans criticité

**Tri** :

- **Criticité** trie par gravité, dans l'ordre des niveaux définis dans [Classifications et continuité](it-ops-settings.md#classifications-et-continuite). Les interfaces sans valeur viennent en dernier

**Actions** :

- **Ajouter une interface** : Créer une nouvelle interface (nécessite `applications:member`)
- **Dupliquer l'interface** : Créer une copie d'une interface sélectionnée (nécessite `applications:member`). Sélectionnez exactement une ligne pour activer cette action. Une boîte de dialogue vous permet de choisir si vous voulez copier les liaisons d'environnement. Voir [Copier des interfaces](#copier-des-interfaces) ci-dessous.
- **Supprimer la sélection** : Supprimer les interfaces sélectionnées (nécessite `applications:admin`). Avant la confirmation, la fenêtre liste comme conservées les interfaces qui ont des liaisons, avec leur nombre de liaisons. Cochez **Supprimer également les liaisons associées** pour les supprimer avec leurs liaisons ; leurs connexions sont conservées. Le message nomme ensuite les interfaces supprimées et celles conservées, avec la raison.

---

## L'espace de travail des Interfaces

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. L'espace de travail comporte six onglets, avec les propriétés de l'interface dans un panneau latéral à droite. Le nom dans l'en-tête se modifie directement. Le dernier onglet, **Historique**, liste les modifications apportées à l'interface (voir [Historique des fiches](record-history.md)).

L'en-tête porte **Supprimer**, une icône corbeille avec son nom en infobulle (`applications:admin`). La confirmation utilise la même vérification que **Supprimer la sélection**. Elle indique que cette action est irréversible. Lorsque l'interface a des liaisons, elle les explique et propose **Supprimer également les liaisons associées** : la suppression est disponible une fois cette option cochée, les liaisons partent avec l'interface et les connexions sont conservées. La liste s'ouvre ensuite.

### Propriétés de l'interface (panneau latéral)

Le panneau latéral reste visible sur chaque onglet. Cliquez sur son onglet **Propriétés** pour le replier ou le déplier. Il regroupe ses champs en trois blocs :

**Identification** :

- **Référence** : Attribuée par KANAP, en lecture seule
- **Code d'interface** : Votre propre code court
- **Processus métier** : Lien vers un processus métier des données de référence
- **Cycle de vie**
- **Créé le** et **Mis à jour le** : Dates en lecture seule

**Équipe** :

- **Responsables métier** : Parties prenantes métier redevables de l'intégration
- **Responsables IT** : Membres de l'équipe technique responsables de la maintenance
- **Sociétés impactées** : Les sociétés concernées par l'intégration

**Données et conformité** :

- **Criticité** : Importance métier
- **Catégorie de données** (obligatoire) : Le type de données transférées
- **Classification des données** : Niveau de sensibilité
- **Contient des PII** : Lorsque cette option est activée, un champ **Description des PII** apparaît pour vous permettre de détailler quelles PII sont incluses
- **Résidence des données** : Pays où circulent les données

Les modifications de champs dans le panneau latéral sont enregistrées automatiquement : vous pouvez donc mettre à jour les propriétés depuis n'importe quel onglet sans changer de contexte. Les applications source et cible, le type de route et le middleware se définissent dans l'onglet Flux.

---

### Vue d'ensemble

L'onglet Vue d'ensemble contient la **Spécification**, un document texte enrichi managé où vous décrivez l'interface de bout en bout : contexte métier, périmètre, contrat, exemples. C'est le document narratif principal de l'interface.

**Conseil** : Utilisez cet onglet comme votre source unique de vérité pour la prose. Les règles de mappage et les legs techniques vivent dans les onglets dédiés ci-dessous ; gardez ce document focalisé sur l'intention, le périmètre et le résumé lisible.

---

### Flux

L'onglet Flux définit la route de l'interface, puis les **legs** partagés qui la composent.

**Flux logique** :

- **Application source** et **Application cible** (obligatoires)
- **Type de route** : Direct ou Via middleware
- **Applications middleware** : Affiché uniquement lorsque le type de route est Via middleware. La liste est restreinte aux applications marquées comme ETL/middleware.

**Modèle de tronçons** : Les legs décrivent ce que fait chaque étape en général (la même définition s'applique dans tous les environnements). Pour chaque leg, vous pouvez modifier :

- **Type de tronçon** : Extraction, Transformation, Chargement ou Direct (défini automatiquement en fonction de la route d'intégration)
- **De -> Vers** : Quel rôle gère chaque étape (App source, App cible ou Middleware)
- **Type de déclencheur** : Ce qui initie ce leg (ex. : planifié, événementiel, manuel)
- **Pattern** : Le pattern d'intégration (ex. : batch, temps réel, pub/sub)
- **Format** : Le format des données (ex. : JSON, XML, CSV, fichier plat)
- **Nom du job** : Un nom de job ou de processus par défaut optionnel

Si aucun leg n'apparaît encore, choisissez les applications source et cible. Les legs sont générés depuis l'**Application source**, l'**Application cible** et le **Type de route**.

---

### Environnements

L'onglet Environnements gère les liaisons par environnement qui transforment les modèles de leg en configurations réelles. Il présente une matrice avec une ligne par leg et une colonne par environnement, pour configurer chaque combinaison indépendamment.

**Environnements** :

- **Ajouter un environnement** (`applications:member`) propose les environnements où les applications source et cible (et le middleware, pour une route via middleware) ont toutes un déploiement. Les déploiements se créent dans l'espace de travail Applications.
- Un environnement apparaît dans la matrice dès que vous l'ajoutez ou qu'il a une liaison.
- Pour supprimer un environnement, cliquez sur l'icône corbeille dans l'en-tête de sa colonne. La confirmation indique le nombre de liaisons supprimées avec lui.
- Un bandeau au-dessus de la matrice montre chaque environnement avec le nombre de legs configurés sur le total, par exemple `QA 2/3`. Le point est vert quand chaque leg est configuré, orange quand certains le sont, et gris quand aucun ne l'est.

**Cellules** : Chaque cellule montre le statut de la liaison et ses points de terminaison source et cible. Une fois la liaison ouverte, sa cellule montre aussi sa connexion d'infrastructure : la première, avec le nombre des autres quand il y en a plusieurs (`+2`). Une liaison **Actif** sans connexion d'infrastructure affiche alors **Connexion manquante** en orange. Cliquez sur une cellule vide pour ajouter une liaison, ou sur une cellule configurée pour la modifier. L'icône corbeille d'une cellule supprime sa liaison, après une confirmation.

**Panneau de liaison** : Un clic sur une cellule ouvre un panneau à côté de la matrice.

- Pour une nouvelle liaison, remplissez les champs et cliquez sur **Ajouter une liaison**. Les sélecteurs **Déploiement source** et **Déploiement cible** apparaissent quand l'application a plusieurs déploiements dans cet environnement ; sinon, le seul déploiement est utilisé. Le sélecteur **Outil d'intégration** apparaît, et devient obligatoire, pour une route via middleware quand plusieurs applications middleware ont un déploiement dans l'environnement.
- Pour une liaison existante, chaque modification est enregistrée au fil de l'eau. L'en-tête du panneau indique quand la modification est enregistrée.

**Champs de liaison** :

- **Statut** : Les [statuts du cycle de vie](it-ops-settings.md#statuts-du-cycle-de-vie) : Proposé, Actif, Obsolète, Retiré, plus ceux qu'ajoute votre administrateur
- **Mode d'authentification** : Comment la liaison s'authentifie
- **Connexion d'infrastructure** : La connexion d'infrastructure de votre registre de connexions, pour tracer le chemin complet de l'interface logique jusqu'à la connexion réseau physique. Le panneau modifie une seule connexion. Quand la liaison en a plusieurs, les autres sont indiquées par leur nombre et restent inchangées.
- **Point de terminaison source** et **Point de terminaison cible** : Points de terminaison techniques (URL, chemins, noms de file d'attente, etc.)
- **Détails du déclenchement** : Configuration de déclenchement spécifique à l'environnement
- **Nom du job spécifique** : Remplace le nom du job du modèle de leg dans cet environnement
- **URL de supervision** : Lien vers la supervision ou l'observabilité de cette liaison
- **Notes** : Notes propres à l'environnement

---

### Mappage des données

L'onglet Mappage des données est l'endroit où vous décrivez comment les champs source deviennent des champs cibles. Il est organisé autour de deux concepts :

- **Les règles de mappage** décrivent une seule décision de mappage : un ou plusieurs champs source, un ou plusieurs champs cibles, une opération (copie directe, transformation, lookup, division, fusion, filtre, valeur par défaut ou opération personnalisée), et des notes optionnelles de condition / métier / middleware.
- **Les groupes de mappage** sont des dossiers qui organisent les règles en sections thématiques (par exemple « En-tête », « Bloc client », « Lignes d'articles », « Pied de page »). Les règles peuvent être assignées à un groupe ou laissées non groupées. Deux groupes de base, **En-tête** et **Article**, sont toujours présents ; vous pouvez en ajouter d'autres.

L'onglet fonctionne sur le **jeu de mappage par défaut** de l'interface. La barre d'en-tête affiche le nom du jeu, le numéro de révision actuel, et les nombres de règles et de groupes.

**Filtrage des règles** :

Utilisez le menu déroulant **Vue de groupe** au-dessus du tableau des règles pour vous concentrer sur :

- **Toutes les règles** (par défaut)
- Règles **Non groupées** (avec le compte)
- Un groupe spécifique (affichant l'ordre, le titre et le nombre de règles)

**Gérer les groupes** :

Cliquez sur **Gérer les groupes** pour ouvrir le gestionnaire de groupes. Depuis là, vous pouvez :

- Ajouter un nouveau groupe (titre, description optionnelle, ordre)
- Modifier un groupe existant
- Supprimer un groupe non-base (les règles qui lui sont assignées sont déplacées vers Non groupées)

Les groupes de base **En-tête** et **Article** peuvent être sélectionnés mais ne peuvent être ni modifiés ni supprimés.

**Ajouter ou modifier une règle** :

Cliquez sur **Ajouter une règle** ou cliquez sur n'importe quelle ligne de règle pour ouvrir le tiroir de règle sur la droite. Champs de la règle :

- **Titre de la règle** (obligatoire) et **Clé de règle** optionnelle (un identifiant technique stable pour les exports ou systèmes en aval)
- **Groupe** : Assigner à un groupe ou laisser Non groupée
- **Champ(s) source** : Une ligne par liaison source. Chaque ligne a un **chemin** (ex. : `origin.customerId`) et un **type** optionnel (string, number, date, etc., ou tout descripteur en texte libre). Utilisez plusieurs lignes pour modéliser des mappages 1:N ou N:1.
- **Champ(s) cible** : Même structure, une ligne par liaison de destination
- **Opération** : Copie directe, Transformation, Lookup, Division, Fusion, Filtre, Valeur par défaut, ou **Autre** (avec un libellé en texte libre)
- **S'applique au leg** : Restreindre la règle à un leg spécifique (ex. : uniquement le leg EXTRACT) ou laisser sur **Tous les legs**
- **Ordre** : Ordre d'affichage dans le groupe
- **Condition** : Quand la règle s'applique
- **Règle métier** : Explication en langage naturel de la logique métier
- **Note middleware / transformation** : Notes d'implémentation pour l'équipe middleware ou ETL
- **Remarques** : Tout autre point à noter

Le tableau de mappage résume chaque règle en listant les liaisons source, une flèche, et les liaisons cibles, plus l'opération, le groupe auquel elle appartient et la portée du leg. Cliquez sur une ligne pour la modifier, ou utilisez les icônes de la ligne pour modifier ou supprimer.

**Conseil** : Gardez une règle par décision logique plutôt qu'une règle par champ. Une règle qui prend trois champs source et produit un champ cible concaténé est plus claire que trois lignes presque identiques, et le champ opération rend l'intention explicite.

---

### Relations

L'onglet Relations montre ce dont cette interface dépend et ce qui dépend d'elle, avec ses liens et ses fichiers. Les documents de connaissance liés à l'interface viennent en premier, puis les interfaces en amont, les interfaces en aval, et les liens et fichiers. Le badge de l'onglet compte les interfaces en amont et en aval, et les liens et fichiers. Les documents de connaissance ne sont pas comptés.

**Interfaces en amont** et **Interfaces en aval** : un tableau chacune, avec la référence (`INT-4`), le nom, l'application source, l'application cible et le cycle de vie. Cliquez sur une ligne pour ouvrir l'interface. Une interface retirée reste listée, sa ligne grisée. Utilisez ces sections pour documenter un ordre, par exemple « Sync Commandes doit s'exécuter avant Sync Factures ».

Une dépendance va dans un seul sens. Si vous ajoutez l'interface B en amont de l'interface A, B apparaît en amont sur A uniquement. A n'apparaît pas en aval sur B.

**Ajouter et retirer des interfaces** (`applications:member`) : **Ajouter**, à droite d'une section, ouvre une recherche d'interfaces. Saisissez un nom ou une référence et choisissez un résultat : le lien est enregistré aussitôt. La recherche exclut cette interface et les interfaces déjà présentes dans la section. Pour retirer un lien, survolez la ligne et cliquez sur la croix au bout. Retirer un lien ne supprime aucune des deux interfaces. Les lecteurs voient les tableaux en lecture seule.

**Liens et fichiers** : les liens web de l'interface (spécifications, pages de documentation, tableaux de bord de supervision) et ses fichiers, une ligne chacun avec son nom, le domaine du lien ou la taille du fichier, et la date d'ajout. Cliquez sur un lien pour l'ouvrir dans un nouvel onglet, ou sur un fichier pour le télécharger. Avec `applications:member` :

- **Ajouter un lien** ouvre une boîte de dialogue pour une URL et un nom facultatif ; le lien est enregistré aussitôt. Pour modifier un lien, survolez sa ligne et cliquez sur le crayon.
- **Joindre un fichier** ouvre le sélecteur de fichiers. Vous pouvez aussi déposer des fichiers sur la section.
- Pour retirer un lien ou un fichier, survolez la ligne et cliquez sur la croix. Retirer un lien affiche un message et propose **Annuler**, qui recrée le lien. La suppression d'un fichier demande d'abord une confirmation.

**Astuce** : Joignez la spécification et les documents de mapping à l'interface, pour que les personnes qui l'exploitent les trouvent au même endroit.

---

## Copier des interfaces

Il existe deux façons de copier des interfaces dans KANAP.

### Dupliquer l'interface (depuis la grille Interfaces)

Utilisez cela lorsque vous voulez une copie indépendante d'une interface, typiquement pour créer une intégration similaire entre les mêmes ou différentes applications.

1. Sélectionnez une interface dans la grille
2. Cliquez sur **Dupliquer l'interface**
3. Choisissez si vous voulez copier les liaisons d'environnement :
   - **Sans liaisons** : Une copie propre, avec juste la définition de l'interface, les legs, responsables et métadonnées
   - **Avec liaisons** : Copie également les liaisons d'environnement, mais efface les détails spécifiques à l'environnement (points de terminaison, authentification, noms de jobs) afin que vous puissiez les configurer à frais

**Ce qui est copié** :

| Données | Copiées |
|---------|---------|
| Définition de l'interface (nom, apps, type de route) | Oui |
| Legs (extract / transform / load / direct) | Oui |
| Applications middleware | Oui |
| Responsables (métier et IT) | Oui |
| Sociétés impactées | Oui |
| Dépendances | Oui |
| Identifiants clés | Oui |
| Liens URL externes | Oui |
| Résidence des données | Oui |
| Spécification | Oui, avec ses images |
| Liaisons | Optionnel |
| Groupes et règles de mappage | Non |
| Pièces jointes | Non |

**Nommage** : La copie reçoit « - copy » ajouté à la fois au nom et au code d'interface. Un code d'interface vide le reste. La copie reçoit sa propre référence.

### Migration de version (depuis le versionnage d'application)

Utilisez cela lors de la mise à niveau d'une application vers une nouvelle version et que vous devez migrer les interfaces vers la nouvelle version. Voir [Applications > Gestion des versions](applications.md#gestion-des-versions) pour les détails.

**Différences clés avec Dupliquer** :

| Aspect | Dupliquer | Migration de version |
|--------|-----------|----------------------|
| Objectif | Créer une copie indépendante | Migrer vers une nouvelle version d'app |
| Références d'app | Inchangées | Mises à jour vers la nouvelle version |
| Références middleware | Inchangées | Mises à jour si l'app est middleware |
| Dépendances | Copiées | Non copiées |
| Liaisons | Optionnel (instances inchangées) | Optionnel (instances mappées vers nouvelle app) |
| Cycle de vie | Préservé | Réinitialisé à Proposé |
| Suffixe de nom | « - copy » | « (new version) » |

---

## Conseils

- **Documentez d'abord le « pourquoi »** : Utilisez la **Spécification** de l'onglet Vue d'ensemble pour capturer l'intention avant de plonger dans les legs et les liaisons.
- **Utilisez le panneau latéral depuis n'importe quel onglet** : Responsables, criticité, indicateur PII et le reste persistent immédiatement, vous pouvez donc les mettre à jour pendant que vous examinez les règles ou les liaisons.
- **Une interface, plusieurs environnements** : Ne créez pas d'interfaces séparées pour chaque environnement : utilisez une interface et configurez chaque environnement dans l'onglet Environnements.
- **Groupez vos règles de mappage** : Pour les interfaces ayant plus de quelques champs, organisez les règles en groupes de mappage (En-tête, Lignes d'articles, Pied de page, etc.). Cela rend la revue et l'analyse d'impact bien plus faciles.
- **Gardez le middleware explicite** : Si les données passent par un middleware, définissez le type de route sur **Via middleware** dans l'onglet Flux et choisissez les applications middleware. La Carte des interfaces affichera alors le chemin de données réel.
- **Dupliquez pour des interfaces similaires** : Lors de la création d'une nouvelle interface similaire à une existante, utilisez **Dupliquer l'interface** pour copier tous les paramètres, puis modifiez ce qui diffère. Incluez optionnellement les liaisons pour prendre de l'avance sur la configuration des environnements.
- **Liez les liaisons aux connexions d'infra** : Dans l'onglet Environnements, liez chaque liaison à sa connexion d'infrastructure sous-jacente afin de pouvoir tracer le chemin complet de l'interface métier jusqu'à la connexion réseau.
