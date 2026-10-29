# Interfaces

Les Interfaces documentent les flux de données logiques entre vos applications. Chaque interface représente une intégration métier (le « pourquoi » et le « quoi » de l'échange de données), indépendamment de la manière dont elle est techniquement implémentée. L'espace de travail vous permet de décrire l'interface, de définir les legs qui déplacent les données dans votre paysage, de configurer les liaisons spécifiques à chaque environnement, de capturer les règles de mappage au niveau des champs et de lier interfaces, documents et pièces jointes connexes.

## Premiers pas

Rendez-vous dans **Cartographie SI > Interfaces** pour voir votre registre d'intégration. Cliquez sur **Ajouter une interface** pour créer une nouvelle entrée, ou ouvrez-en une existante pour la modifier.

Pour créer une interface, vous avez besoin de :

- **ID de l'interface** : Un code court unique (ex. : `INT-CRM-ERP-001`)
- **Nom** : Un nom descriptif pour l'intégration
- **Objectif métier** : Un court résumé de la raison d'être de cette intégration
- **Application source** et **Application cible**
- **Catégorie de données** : Le type de données transférées

Une fois ces éléments définis, vous pouvez enregistrer l'interface ; le reste de l'espace de travail (Flux, Environnements, Mappage des données, Relations) devient alors disponible.

**Conseil** : Définissez tôt le **Type de route d'intégration** (Direct ou Via middleware). Il contrôle quels legs sont générés automatiquement et ce qui apparaît dans l'onglet Flux et la matrice Environnements.

---

## Travailler avec la liste

La grille Interfaces affiche votre registre d'intégration en un coup d'œil.

**Colonnes par défaut** :

- **ID de l'interface** : L'identifiant unique (cliquez pour ouvrir l'espace de travail)
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

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. L'espace de travail comporte un panneau latéral avec les propriétés de l'interface à gauche, et six onglets à droite. Le dernier, **Historique**, liste les modifications apportées à l'interface (voir [Historique des fiches](record-history.md)).

L'en-tête porte **Supprimer**, une icône corbeille avec son nom en infobulle (`applications:admin`). La confirmation utilise la même vérification que **Supprimer la sélection**. Elle indique que cette action est irréversible. Lorsque l'interface a des liaisons, elle les explique et propose **Supprimer également les liaisons associées** : la suppression est disponible une fois cette option cochée, les liaisons partent avec l'interface et les connexions sont conservées. La liste s'ouvre ensuite.

### Propriétés de l'interface (panneau latéral)

Le panneau latéral reste visible sur chaque onglet et regroupe les champs les plus modifiés en trois sections rétractables :

**Propriétés principales** :

- **ID de l'interface**, **Nom**, **Objectif métier** (obligatoires)
- **Processus métier** : Lien vers un processus métier des données de référence
- **Cycle de vie** et **Criticité**
- **Application source** et **Application cible** (obligatoires)
- **Type de route d'intégration** : Direct ou Via middleware
- **Applications middleware** : Affiché uniquement lorsque le type de route est Via middleware. La liste est restreinte aux applications marquées comme ETL/middleware.

**Équipe** :

- **Responsables métier** : Parties prenantes métier redevables de l'intégration
- **Responsables IT** : Membres de l'équipe technique responsables de la maintenance

**Données et conformité** :

- **Catégorie de données** : Le type de données transférées
- **Classification des données** : Niveau de sensibilité (Public, Interne, Confidentiel, Restreint)
- **Contient des PII** : Lorsque coché, un champ **Description PII** apparaît pour vous permettre de détailler quelles PII sont incluses
- **Résidence des données** : Pays où circulent les données (codes ISO à 2 lettres)

Les modifications de champs dans le panneau latéral sont enregistrées automatiquement lorsque vous quittez le champ, vous pouvez donc mettre à jour les propriétés depuis n'importe quel onglet sans changer de contexte.

---

### Vue d'ensemble

Une fois l'interface enregistrée, l'onglet Vue d'ensemble contient la **Spécification**, un document texte enrichi managé où vous décrivez l'interface de bout en bout : contexte métier, périmètre, contrat, exemples. C'est le document narratif principal de l'interface.

**Conseil** : Utilisez cet onglet comme votre source unique de vérité pour la prose. Les règles de mappage et les legs techniques vivent dans les onglets dédiés ci-dessous ; gardez ce document focalisé sur l'intention, le périmètre et le résumé lisible.

---

### Flux

L'onglet Flux définit les **legs** partagés qui composent l'interface. Les legs sont des modèles : ils décrivent ce que fait chaque étape en général (la même définition s'applique dans tous les environnements).

Pour chaque leg, vous pouvez modifier :

- **Type de tronçon** : Extraction, Transformation, Chargement ou Direct (défini automatiquement en fonction de la route d'intégration)
- **De -> Vers** : Quel rôle gère chaque étape (App source, App cible ou Middleware)
- **Type de déclencheur** : Ce qui initie ce leg (ex. : planifié, événementiel, manuel)
- **Pattern** : Le pattern d'intégration (ex. : batch, temps réel, pub/sub)
- **Format** : Le format des données (ex. : JSON, XML, CSV, fichier plat)
- **Nom du job** : Un nom de job ou de processus par défaut optionnel

Si aucun leg n'apparaît encore, enregistrez d'abord l'interface. Les legs sont générés depuis l'**Application source**, l'**Application cible** et le **Type de route d'intégration** dans le panneau latéral.

---

### Environnements

L'onglet Environnements gère les liaisons par environnement qui transforment les modèles de leg en configurations réelles. Il présente une matrice d'environnements et de legs, vous permettant de configurer chaque combinaison indépendamment.

**Comment ça fonctionne** :

- Chaque environnement (Prod, Pré-prod, QA, Test, Dev, Sandbox ou personnalisé) peut avoir des liaisons pour chaque leg
- Les environnements sont découverts automatiquement à partir de vos instances d'applications ; vous pouvez également ajouter des environnements personnalisés
- Cliquez sur une cellule vide pour créer une liaison, ou cliquez sur une existante pour la modifier

**Champs de liaison** :

- **Instance source** et **Instance cible** : Quelles instances d'applications utiliser dans cet environnement
- **Statut** : Activé, Désactivé ou En test
- **Point de terminaison source** et **Point de terminaison cible** : Points de terminaison techniques (URL, chemins, noms de file d'attente, etc.)
- **Détails du déclencheur** : Configuration de déclencheur spécifique à l'environnement
- **Nom du job env.** : Remplacer le nom du job du modèle de leg pour cet environnement
- **Mode d'authentification** : Comment la liaison s'authentifie
- **URL de monitoring** : Lien vers la supervision ou observabilité de cette liaison
- **Application outil d'intégration** : Le cas échéant, l'outil d'intégration utilisé
- **Notes env.** : Notes spécifiques à l'environnement

**Liaison aux connexions** : Chaque liaison peut être liée à des connexions d'infrastructure de votre registre de connexions. Cela vous permet de tracer le chemin complet de l'interface logique jusqu'à la connexion réseau physique.

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
- Pour retirer un lien ou un fichier, survolez la ligne et cliquez sur la croix. La suppression d'un fichier demande d'abord une confirmation.

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

**Nommage** : La copie reçoit « - copy » ajouté à la fois au nom et à l'ID de l'interface. Un identifiant d'interface vide le reste.

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

- **Documentez d'abord le « pourquoi »** : Utilisez la **Spécification** de l'onglet Vue d'ensemble et le champ **Objectif métier** du panneau latéral pour capturer l'intention avant de plonger dans les legs et les liaisons.
- **Utilisez le panneau latéral depuis n'importe quel onglet** : Responsables, criticité, type de route, indicateur PII et le reste persistent immédiatement, vous pouvez donc les mettre à jour pendant que vous examinez les règles ou les liaisons.
- **Une interface, plusieurs environnements** : Ne créez pas d'interfaces séparées pour chaque environnement : utilisez une interface et configurez chaque environnement dans l'onglet Environnements.
- **Groupez vos règles de mappage** : Pour les interfaces ayant plus de quelques champs, organisez les règles en groupes de mappage (En-tête, Lignes d'articles, Pied de page, etc.). Cela rend la revue et l'analyse d'impact bien plus faciles.
- **Gardez le middleware explicite** : Si les données passent par un middleware, définissez le type de route sur **Via middleware** et choisissez les applications middleware. La Carte des interfaces affichera alors le chemin de données réel.
- **Dupliquez pour des interfaces similaires** : Lors de la création d'une nouvelle interface similaire à une existante, utilisez **Dupliquer l'interface** pour copier tous les paramètres, puis modifiez ce qui diffère. Incluez optionnellement les liaisons pour prendre de l'avance sur la configuration des environnements.
- **Liez les liaisons aux connexions d'infra** : Dans l'onglet Environnements, liez chaque liaison à sa connexion d'infrastructure sous-jacente afin de pouvoir tracer le chemin complet de l'interface métier jusqu'à la connexion réseau.
