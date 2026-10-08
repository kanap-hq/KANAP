# Applications

Applications est votre registre central pour documenter le paysage applicatif IT. Il couvre les applications métier, les outils de productivité, les services d'infrastructure et tout ce qui se trouve entre les deux. Utilisez-le pour suivre la responsabilité, les déploiements, les intégrations, les relations financières et les informations de conformité sur l'ensemble de votre portefeuille.

## Catégories d'applications

Chaque application ou service appartient à une **catégorie** qui décrit son objectif principal. Cette classification aide les différentes parties prenantes à filtrer et se concentrer sur ce qui les concerne.

| Catégorie | Description | Exemples |
|-----------|-------------|----------|
| **Métier** | Applications métier de base qui supportent des processus métier spécifiques | SAP, Salesforce, Workday, ERP sur mesure |
| **Productivité** | Outils du quotidien pour les utilisateurs, incluant utilitaires et collaboration | Office 365, Acrobat Reader, Teams, Slack, Chrome |
| **Sécurité** | Outils de protection des systèmes, données et accès | CrowdStrike, Okta, plateformes SIEM, pare-feux |
| **Analytique** | Reporting, intelligence métier et outils d'entrepôt de données | Power BI, Tableau, Snowflake |
| **Développement** | Outils utilisés par les développeurs et équipes DevOps | Python, Git, Jenkins, VS Code, Docker |
| **Intégration** | Plateformes qui connectent les systèmes et déplacent les données | MuleSoft, Kafka, passerelles API, outils ETL |
| **Infrastructure** | Services fondamentaux dont dépendent les autres systèmes | PostgreSQL, Redis, Kubernetes, systèmes de stockage |

**Conseils de classification** :
- Choisissez en fonction de l'**objectif principal** de l'application, pas de qui la gère
- En cas de doute, demandez-vous : « À quoi cet outil sert-il principalement ? »
- Les catégories peuvent être personnalisées dans **Cartographie SI > Paramètres** pour correspondre à la terminologie de votre organisation

### Filtrage par partie prenante

Les différentes équipes peuvent utiliser les catégories pour se concentrer sur leur domaine de responsabilité :

| Partie prenante | Filtre suggéré |
|-----------------|---------------|
| Cybersécurité | Catégorie Sécurité, ou criticité élevée dans toutes les catégories |
| Service Desk | Productivité + Métier (applications utilisateur) |
| Infrastructure | Infrastructure + Intégration |
| Architecture d'entreprise | Toutes les catégories |

---

## Premiers pas

Rendez-vous dans **Cartographie SI > Applications** pour voir votre liste. Cliquez sur **Nouvelle app / Service** pour créer votre première entrée.

**Champs obligatoires** :
- **Nom** : Un nom reconnaissable pour l'application ou le service
- **Catégorie** : L'objectif principal de cette application (voir les catégories ci-dessus)
- **Cycle de vie** : Statut actuel (Actif, Proposé, Obsolète, Retiré, ou tout code personnalisé défini dans les Paramètres)

**Fortement recommandé** :
- **Fournisseur** : Le fournisseur du logiciel (lié à vos données de référence Fournisseurs)
- **Éditeur** : L'éditeur du logiciel (ex. : Microsoft, SAP, Oracle)
- **Description** : Ce que fait cette application

Les champs de classification sont facultatifs à la création. La **Criticité business**, la criticité cyber, la confidentialité des données et la vague de reprise se choisissent parmi les niveaux définis par votre organisation dans **Cartographie SI > Paramètres** ; chaque option affiche la définition du niveau. Les valeurs restent non définies tant que vous ne les choisissez pas.

**Optionnel mais utile** :
- **Version** : Numéro de version actuel (texte libre, ex. : « 4.2.1 », « 2023 », « Q1 2024 »)
- **Mise en production** : Quand cette version a été ou sera mise en service
- **Fin de support** : Quand le support éditeur prend fin pour cette version
- **Date de retrait** : Quand cette version a été effectivement mise hors service
- **Licences** : Conditions de licence et notes
- **Notes** : Notes internes libres
- **Peut avoir des apps enfants** : Activez cette option pour utiliser cette application comme une « suite » regroupant d'autres applications

Une fois enregistré, l'espace de travail déverrouille tous les onglets pour une documentation détaillée.

**Conseil** : Commencez par documenter vos applications les plus critiques. Utilisez l'onglet **Déploiements** pour capturer les environnements existants (Prod, QA, Dev) et les serveurs qui les exécutent, puis liez les interfaces, contrats et postes budgétaires au fur et à mesure.

**Autorisations** :
- Consultation : `applications:reader`
- Création / modification : `applications:manager` (aussi appelé `member`)
- Import / Export / Suppression : `applications:admin`

---

## Travailler avec la liste

La grille Applications offre une vue complète de votre portefeuille applicatif.

**Filtre de périmètre en haut (Afficher)** :
- **Mes apps** : affiche les apps où vous êtes listé dans le tiroir des propriétés comme **Responsable métier** ou **Responsable IT**. Les entrées multi-responsables sont supportées.
- **Apps de mon équipe** : affiche les apps où tout membre de votre équipe Portefeuille est listé comme Responsable métier ou Responsable IT. Votre propre responsabilité est aussi incluse dans ce périmètre. Désactivé si vous n'êtes pas assigné à une équipe Portefeuille.
- **Toutes les apps** (par défaut) : affiche la grille complète des Applications avec le comportement de filtre par défaut du cycle de vie.
- Votre sélection est mémorisée entre les sessions -- revenir sur la page restaure votre dernier choix.

**Colonnes par défaut** :
- **Nom** : Nom de l'application avec libellé de catégorie et badge « Inclus dans : {suite} » pour les composants d'une suite
- **Catégorie** : L'objectif principal de l'application
- **Environnements** : Pastilles colorées montrant les environnements actifs (Prod, Pré-prod, QA, Test, Dev, Sandbox). Survolez pour voir l'URL de base et le cycle de vie.
- **Cycle de vie** : Statut actuel
- **Criticité business** : Niveau d'importance pour le métier
- **Éditeur** : Éditeur du logiciel
- **Utilisateurs dérivés (A)** : Nombre d'utilisateurs calculé pour l'année en cours (basé sur l'audience définie dans le tiroir des propriétés)
- **Créé** : Quand l'enregistrement a été créé

**Tri par défaut** : **Nom** croissant (A à Z).

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **Suites** : Suites parentes auxquelles cette application appartient
- **Fournisseur** : Nom du fournisseur lié
- **Responsables métier** / **Responsables IT** : Responsables assignés (tronqués, survolez ou cliquez pour tout voir)
- **Hébergement** : Dérivé des sites des serveurs assignés aux déploiements de l'app
- **Exposition externe** : Si l'app est accessible depuis Internet
- **SSO activé** / **MFA activé** : Fonctionnalités d'authentification
- **Intégration de données / ETL** : Si l'app participe à des intégrations de données
- **Postes OPEX** / **Postes CAPEX** / **Contrats** : Dépenses et contrats liés
- **Composants** : Applications enfants (si c'est une suite)
- **Classification données** / **Contient des PII** / **Résidence des données** : Informations de conformité
- **Criticité cyber**, **Vague de reprise**, **RTO**, **RPO**, **État/date de revue** : Champs de classification et de continuité

**Avancement de la classification** : la tuile Conformité de votre tableau de bord indique combien d'applications visibles sont revues, à revoir ou ont encore des champs de classification à compléter, ainsi que les points qui appellent une action. Chaque chiffre ouvre la liste des applications filtrée en conséquence. Voir [Mon tableau de bord](my-dashboard.md).

**Filtrage** :
- Recherche rapide : correspond au nom et à l'éditeur
- Les filtres de criticité, de criticité cyber, de classe de données et de vague de reprise listent leurs valeurs dans l'ordre du catalogue (la plus critique en premier, les vagues dans l'ordre de restauration).
- La plupart des colonnes utilisent des filtres par jeu de cases à cocher affichant uniquement les valeurs présentes dans le jeu de résultats actuel ; le filtre flottant affiche `Tous`, `Aucun` ou `N sélectionnés` avec un **x** pour effacer.
- Les applications retirées sont masquées par défaut ; utilisez le filtre **Cycle de vie** pour inclure les applications retirées.

**Actions** :
- **Nouvelle app / Service** : Créer une nouvelle entrée (`applications:manager`)
- **Import CSV** : Import en masse depuis un fichier CSV (`applications:admin`)
- **Export CSV** : Exporter la liste en CSV (`applications:admin`). Les colonnes issues des catalogues (catégorie, cycle de vie, criticité, criticité cyber, vague de reprise, classification de données, méthodes d'accès) sont exportées avec leurs noms ; l'import accepte un nom ou le code interne.
- **Copier l'élément** : Dupliquer une application sélectionnée avec toutes ses relations principales (`applications:manager`). Voir [Copier des applications](#copier-des-applications) pour ce qui est et n'est pas copié.
- **Supprimer la sélection** : Supprimer les applications sélectionnées (`applications:admin`)

---

## L'espace de travail des applications

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. L'espace de travail comporte un **en-tête** avec des métadonnées rapides, un **tiroir des propriétés** sur la droite (la carte d'identité de l'application -- toujours visible) et une **zone de contenu** au centre qui change selon l'onglet.

### En-tête

L'en-tête affiche :
- **Nom de l'application** (modifiable sur place)
- **Référence** : court identifiant copiable
- Pastille **Cycle de vie** : cliquez pour modifier
- Pastille **Criticité business** : affiche le niveau et ouvre un menu des niveaux définis par l'organisation
- Pastille **Version** (si une version est définie) : cliquez pour copier
- Date de **Mise en production**
- **Envoyer le lien** : copier un lien partageable vers cet espace de travail
- **Créer une nouvelle version** : lancer l'assistant de migration de version (voir [Gestion des versions](#gestion-des-versions))
- **Supprimer** (`applications:admin`)
- **Précédent / Suivant** : parcourir la liste filtrée sans revenir à la grille

### Tiroir des propriétés (panneau de droite)

Le tiroir est la carte d'identité de l'application. Il est affiché sur chaque onglet et modifié en ligne -- les changements sont enregistrés automatiquement.

**Identité** :
- **Catégorie**, **Fournisseur**, **Éditeur**

**Dates du cycle de vie** :
- **Mise en production**, **Fin de support**, **Date de retrait**

**Responsables** :
- **Responsables métier** : parties prenantes métier redevables de cette application (multi-sélection)
- **Responsables IT** : membres de l'équipe IT responsables du support technique (multi-sélection)

**Audience** :
- Ajoutez des lignes **Société / Départements** pour enregistrer qui utilise cette application. Choisissez une société et limitez optionnellement à des départements spécifiques.
- Un nombre d'**Utilisateurs** en direct est affiché.
- **Méthode de calcul** : **Dérivé** (calculé à partir de l'audience basé sur les métriques Utilisateurs IT / Effectif des données de référence) ou **Manuel** (un seul nombre de remplacement que vous saisissez).

---

### Vue d'ensemble

L'onglet Vue d'ensemble est le récit de l'application. Il contient :

**Description** : Une description en texte enrichi de l'application. L'éditeur sauvegarde automatiquement au fur et à mesure que vous tapez.

**Connexions** : Un résumé en lecture seule construit à partir des interfaces de l'application. Pour les apps non-middleware, il affiche deux lignes : **Reçoit de** et **Envoie vers**. Pour les apps ETL/middleware, il affiche une seule ligne **Connecté à**. Chaque entrée est une pastille cliquable qui ouvre l'application liée ; « + N de plus dans Interfaces » saute à l'onglet Interfaces.

**Connaissances** : Articles de connaissances liés. Si vous avez `knowledge:member`, vous pouvez créer de nouveaux articles directement depuis cette section.

---

### Déploiements

L'onglet Déploiements documente où l'application s'exécute réellement -- un bloc par environnement, avec les serveurs attachés à chacun.

**Environnements** : Production, Pré-prod, QA, Test, Dev, Sandbox.

**Pour chaque déploiement, vous pouvez capturer** :
- **Cycle de vie** : statut spécifique à l'environnement (Actif, Proposé, Obsolète, Retiré, etc.)
- **URL de base** : l'URL d'accès pour cet environnement
- **SSO activé** / **MFA supporté**
- **Notes**

**Ajouter un déploiement** ouvre une boîte de dialogue où vous définissez l'environnement, le cycle de vie, l'URL de base, les indicateurs SSO/MFA et les notes. Chaque environnement ne peut être ajouté qu'une seule fois. La pastille de cycle de vie sur l'en-tête d'un déploiement peut aussi être modifiée en ligne depuis un menu contextuel.

**Serveurs par déploiement** : Chaque bloc de déploiement affiche un tableau des serveurs assignés :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **Serveur** | Nom de l'actif (cliquable) |
| **Rôle** | ex. : Web, Base de données, Application (depuis la liste des rôles serveur dans les Paramètres) |
| **Hébergement** | Dérivé du site de l'actif |
| **Depuis** | Date à laquelle le serveur a été assigné à ce déploiement |

Cliquez sur **Ajouter un serveur** dans l'en-tête du déploiement pour rattacher un actif. Les actifs cluster sont exclus -- assignez plutôt les hôtes membres du cluster.

**Conseil** : Documentez les serveurs dans **Cartographie SI > Actifs** d'abord, puis liez-les ici. L'onglet Vue d'ensemble de l'actif affichera les mêmes assignations dans le sens inverse.

---

### Interfaces

L'onglet Interfaces affiche toutes les intégrations auxquelles cette application participe -- en tant que source, cible ou middleware. Le badge de l'onglet affiche le total.

Les interfaces sont **regroupées par environnement** (PROD, PRE_PROD, QA, ...). Au sein de chaque environnement, elles sont divisées en :

- **Entrantes** -- cette application reçoit des données
- **Sortantes** -- cette application envoie des données
- **Routées** -- cette application est le middleware/ETL pour un flux entre deux autres apps

Chaque ligne affiche le nom de l'interface, l'application contrepartie et un indicateur **Via middleware**. Cliquez sur la ligne pour ouvrir l'espace de travail de l'interface ; cliquez sur la contrepartie pour ouvrir l'autre application.

**Conseil** : Les interfaces sont gérées depuis la page Interfaces. Cet onglet est une vue pratique en lecture seule, mais c'est le moyen le plus rapide de naviguer entre les applications connectées.

---

### Exploitation

L'onglet Exploitation capture comment les utilisateurs accèdent à l'application et qui la supporte.

**Technique** :
- **Méthodes d'accès** (multi-sélection) : comment les utilisateurs accèdent à cette application. Les options sont configurables dans les [Paramètres de la Cartographie SI](it-ops-settings.md). Les options par défaut incluent Web, Application installée localement, Application mobile, IHM propriétaire (interface industrielle), Terminal / CLI, VDI / Bureau distant, Borne.
- **Exposition externe** : si l'application est accessible depuis Internet
- **Intégration de données / ETL** : si l'application participe à des pipelines d'intégration de données (bascule également cette app en mode « middleware » pour les vues Interfaces et Connexions)
- **Peut avoir des apps enfants** : transformer cette application en Suite qui regroupe d'autres applications

**Support** :
- Un tableau de contacts de support tirés de vos données de référence Contacts. Chaque ligne affiche le nom du contact, l'e-mail, le téléphone et un rôle en texte libre (ex. : Responsable commercial, Support N1).
- **Ajouter un contact** ouvre une boîte de dialogue pour choisir un contact et définir un rôle.
- **Notes de support** : texte libre pour les arrangements de support (SLA, voies d'escalade, infos d'astreinte).

---

### Conformité

L'onglet Conformité capture les informations de protection des données et de réglementation.

**Ce que vous pouvez modifier** :
- **Classification données** : niveau de confidentialité (Public, Interne, Confidentiel, Restreint, ou tout code personnalisé défini dans les Paramètres)
- **Dernier test PRA** : date du test de reprise d'activité le plus récent
- **Contient des PII** : si l'application stocke des données personnelles identifiables
- **Résidence des données** : pays où les données sont stockées (multi-sélection, codes ISO + noms)

**Conseil** : Les classifications de données sont configurables dans **Cartographie SI > Paramètres**. Personnalisez-les pour correspondre à la politique de classification des données de votre organisation.

---

### Classification et continuité

La zone Conformité enregistre également les décisions de continuité et de classification de l'application. Les valeurs absentes apparaissent comme **Non défini** ; KANAP ne remplace pas une valeur manquante par un niveau par défaut.

L'onglet est organisé en quatre blocs, dans l'ordre d'une analyse d'impact métier.

**Criticité** :
- La **Criticité business** se choisit parmi les niveaux définis par votre organisation. Chaque option affiche la définition du niveau, en général l'interruption que l'activité peut tolérer. Le niveau est une référence stable : renommer un niveau, modifier sa définition ou réordonner le catalogue dans les Paramètres ne déplace jamais une application vers un autre niveau.
- La **Criticité cyber** est choisie indépendamment. Le menu affiche la description de chaque niveau ; retenez le niveau correspondant aux conséquences plausibles les plus élevées. Attention à ne pas confondre la criticité cyber avec le niveau de risque !

**Données** :
- La **Confidentialité des données** utilise le catalogue des classes de données de l'organisation.
- **Contient des données personnelles** et **Résidence des données** complètent le volet données.

**Continuité et reprise** :
- La **Vague de reprise** indique l'ordre de restauration et ne représente ni une durée ni une gravité.
- Le **RTO** est l'objectif de délai de reprise. Le **RPO** est la perte de données acceptable et peut être égal à zéro. Si le RTO atteint la durée maximale tolérable d'interruption définie sur le niveau de criticité business choisi, KANAP affiche un avertissement mais conserve les deux valeurs.
- Sous la vague, KANAP liste les interfaces qui relient cette application à une application prévue dans une vague **ultérieure** (« Échange avec CRM, prévue en V3 »), avec un lien vers chaque interface. Les deux applications doivent être opérationnelles pour que le flux fonctionne ; le responsable du plan de reprise décide. Les interfaces retirées sont ignorées, et les utilisateurs disposant d'un périmètre restreint de Contributeur métier ne voient pas cette liste.
- Le **Dernier test de reprise** contient la date du test le plus récent. Un lien ouvert depuis cette zone utilise l'unique section **Base de connaissances** de la Vue d'ensemble et ne crée pas de doublon. Les anciennes URL restent accessibles dans Relations.

Deux indications discrètes peuvent apparaître : des données au niveau de confidentialité le plus élevé combinées à la criticité cyber la plus faible, et une application au niveau business le plus critique sans test de reprise depuis douze mois. Elles ne bloquent jamais rien.

**Revue** :
- La **Justification** décrit le raisonnement derrière les niveaux choisis et ce sur quoi repose le plan de reprise.
- La revue est un horodatage : **Marquer comme revu** enregistre qui a revu la classification et quand. L'action est disponible dès que la criticité business, la criticité cyber, la confidentialité des données, la vague de reprise et la justification sont renseignées.
- La date de revue et le relecteur restent visibles ensuite. Lorsqu'une valeur de classification, une référence de reprise ou la résidence des données change après la revue, l'onglet affiche **Modifiée depuis la revue** et la liste affiche **À revoir**. Un changement de nom ou d'éditeur n'a aucun effet. Modifier le catalogue dans les Paramètres n'invalide jamais une revue.

### Relations

L'onglet Relations lie cette application à vos enregistrements financiers, contractuels, projet et tâches. Le badge de l'onglet compte tous les éléments liés. Les modifications sont enregistrées automatiquement.

**Composants** (uniquement lorsque « Peut avoir des apps enfants » est activé) : un tableau listant les applications enfants de cette Suite, avec leur cycle de vie et criticité. Cliquez sur une ligne pour ouvrir l'espace de travail enfant.

**Relations** :
- **Postes OPEX** : coûts récurrents associés à cette application
- **Postes CAPEX** : projets de dépenses d'investissement
- **Contrats** : contrats fournisseurs
- **Projets** : projets du portefeuille liés à cette application
- **Tâches** : tâches liées à cette application. Cette liste est en lecture seule ici -- les tâches gagnent ou perdent ce lien lorsque vous définissez le champ **App / Service** sur une tâche dans la page Tâches.

**Sites web pertinents** : ajoutez des URL avec des noms optionnels -- utile pour les portails fournisseurs, tableaux de bord de monitoring ou liens de documentation. **Ajouter une URL** ouvre une boîte de dialogue ; les entrées existantes peuvent être modifiées ou supprimées.

**Pièces jointes** : Glissez-déposez des fichiers ou cliquez sur **Sélectionner des fichiers** pour téléverser. Cliquez sur la pastille d'une pièce jointe pour la télécharger. La suppression est disponible pour les managers.

---

## Gestion des versions

KANAP propose **deux approches pour gérer les versions d'applications**, selon la manière dont votre organisation gère les mises à niveau :

| Approche | Idéale pour | Ce qui se passe |
|----------|-------------|-----------------|
| **Simple** | La plupart des applications | Mettez à jour les champs de version dans le tiroir des propriétés ou le formulaire de création -- même enregistrement, nouveau numéro de version |
| **Avancée** | Migrations majeures | Utilisez **Créer une nouvelle version** pour créer un nouvel enregistrement d'application avec suivi de lignée -- exécutez ancienne et nouvelle versions côte à côte |

### Suivi de version simple (mise à jour en place)

Pour la plupart des applications -- où vous mettez à niveau et l'ancienne version disparaît simplement -- mettez à jour **Version**, **Mise en production**, **Fin de support** et **Date de retrait** dans le formulaire de création ou le tiroir des propriétés. La pastille de version dans l'en-tête et les métadonnées **Mise en production** reflètent ce que vous avez défini.

Cette approche garde tout dans un seul enregistrement. Lors d'une mise à niveau, mettez à jour les champs de version et c'est fait. L'historique est suivi dans le journal d'audit.

**À utiliser quand** : les mises à niveau se font en place sans chevauchement -- une version remplace l'autre.

### Créer une nouvelle version (migrations parallèles)

Pour les mises à niveau majeures d'applications où vous devez exécuter les anciennes et nouvelles versions en parallèle dans différents environnements (ex. : SAP S/4HANA 1909 en Prod alors que 2023 est en QA), utilisez **Créer une nouvelle version** dans l'en-tête de l'espace de travail.

L'assistant comporte trois étapes :

1. **Détails de la version** -- nouveau nom d'application, libellé de version, dates de **Mise en production** et **Fin de support**.
2. **Options de copie** -- choisissez ce qui doit être copié depuis la source. Valeurs par défaut indiquées ci-dessous.
3. **Interfaces** -- sélectionnez les interfaces à migrer vers la nouvelle version.

La nouvelle version est créée comme une application séparée avec :
- Un cycle de vie **Proposé** (prête à être configurée avant la mise en production)
- Un lien vers son prédécesseur (utilisé par la chronologie des versions)
- Des données copiées selon vos sélections
- Des interfaces dupliquées pointant vers la nouvelle version

Les valeurs de classification et de continuité sont copiées, mais la nouvelle version démarre avec une revue réinitialisée et sans copie du dernier test de reprise.

### Ce qui est copié

| Option | Par défaut |
|--------|------------|
| Responsables (métier et IT) | Activé |
| Sociétés (audience) | Activé |
| Départements | Activé |
| Résidence des données | Activé |
| Liens | Activé |
| Contacts de support | Activé |
| Postes budgétaires (OPEX + CAPEX, appariés) | Activé |
| Contrats | Activé |
| Déploiements | Désactivé |
| Liaisons de déploiement | Désactivé (disponible uniquement lorsque Déploiements est sélectionné) |

**Non copié** (à configurer de zéro) : appartenance à une suite, pièces jointes, assignations d'actifs.

### Migration d'interfaces

Pendant la création de version, l'assistant affiche toutes les interfaces où cette application est source, cible ou middleware (lorsque ETL est activé). Les interfaces sélectionnées sont dupliquées avec leurs références mises à jour vers la nouvelle version. Chaque interface migrée inclut ses legs, responsables, sociétés, identifiants clés, liens et résidence des données. Les interfaces migrées démarrent avec un cycle de vie **Proposé**. Les interfaces originales restent liées à l'ancienne version.

**Copie des liaisons** : Si vous sélectionnez à la fois **Déploiements** et **Liaisons de déploiement**, les liaisons d'interfaces sont également copiées. Les liaisons sont mappées vers les déploiements de la nouvelle application (associées par environnement) ; les détails spécifiques à l'environnement (endpoints, authentification, noms de jobs) sont effacés, et le statut de liaison est réinitialisé à **Proposé**.

**Applications ETL/Middleware** : Si l'application a **Intégration de données / ETL** activé, l'assistant affiche également les interfaces qui *transitent par* cette application en tant que middleware. Ce sont des interfaces où une autre source envoie des données vers une autre cible via votre ETL. Les copier crée de nouvelles définitions d'interfaces pour l'ETL mis à niveau, avec les références middleware correctement mises à jour.

**Conseil** : Utilisez cela lors de la mise à niveau de votre ERP ou ETL : migrez les interfaces critiques et copiez optionnellement les liaisons pour prendre de l'avance sur la configuration des environnements.

---

## Copier des applications

Il existe deux façons de copier une application dans KANAP :

### Copier l'élément (depuis la grille Applications)

Utilisez cela lorsque vous souhaitez créer un duplicata indépendant d'une application -- typiquement pour créer une entrée d'application similaire sans lignée de version.

1. Sélectionnez une application dans la grille
2. Cliquez sur **Copier l'élément**
3. Le système crée une copie avec « (copie) » ajouté au nom
4. Vous êtes redirigé vers la nouvelle application pour effectuer des modifications

**Ce qui est copié** : Tous les champs principaux (sauf la date du dernier test PRA), y compris les valeurs de classification et de continuité, responsables, sociétés, départements, suites, postes OPEX/CAPEX, contrats, liens, résidence des données et contacts de support. La revue de la copie est réinitialisée.

**Ce qui N'est PAS copié** : Déploiements, interfaces, assignations d'actifs, pièces jointes, champs de version (version, date de mise en production, fin de support).

### Comparaison : Copier l'élément vs Créer une nouvelle version

| Aspect | Copier l'élément | Créer une nouvelle version |
|--------|------------------|---------------------------|
| **Objectif** | Duplicata indépendant | Successeur versionné avec lignée |
| **Options utilisateur** | Aucune (automatique) | Assistant en 3 étapes |
| **Lignée** | Pas de lien prédécesseur | Définit le prédécesseur |
| **Cycle de vie** | Préservé | Réinitialisé à Proposé |
| **Nom** | Suffixe « (copie) » | Spécifié par l'utilisateur |

**Relations** :

| Relation | Copier l'élément | Créer une nouvelle version |
|----------|------------------|---------------------------|
| Responsables (métier et IT) | Oui | Optionnel (par défaut : oui) |
| Sociétés (audience) | Oui | Optionnel (par défaut : oui) |
| Départements | Oui | Optionnel (par défaut : oui) |
| Résidence des données | Oui | Optionnel (par défaut : oui) |
| Liens | Oui | Optionnel (par défaut : oui) |
| Contacts de support | Oui | Optionnel (par défaut : oui) |
| Suites (appartenance) | Oui | Non |
| Postes OPEX | Oui | Optionnel (par défaut : oui) |
| Postes CAPEX | Oui | Optionnel (par défaut : oui) |
| Contrats | Oui | Optionnel (par défaut : oui) |
| Déploiements | Non | Optionnel (par défaut : non) |
| Liaisons | Non | Optionnel (par défaut : non) |
| Interfaces | Non | Sélectionné par l'utilisateur |
| Assignations d'actifs | Non | Non |
| Pièces jointes | Non | Non |

**Champs principaux** :

| Champ | Copier l'élément | Créer une nouvelle version |
|-------|------------------|---------------------------|
| Description | Oui | Oui |
| ETL activé | Oui | Oui |
| Notes de support | Oui | Oui |
| Dernier test PRA | Non | Non |
| Champs de version | Non | Spécifié par l'utilisateur |
| Saisie manuelle utilisateurs | Oui | Réinitialisé à null |
| Année utilisateurs | Oui | Réinitialisé à l'année en cours |

---

## Import/export CSV

Maintenez votre inventaire applicatif à grande échelle grâce à l'import et l'export CSV. Cette fonctionnalité prend en charge les opérations en masse pour le chargement initial de données, les mises à jour périodiques depuis des systèmes externes et l'extraction de données pour le reporting.

### Accéder aux fonctionnalités CSV

Depuis la liste des Applications :
- **Export CSV** : Télécharger les applications dans un fichier CSV
- **Import CSV** : Téléverser un fichier CSV pour créer ou mettre à jour des applications
- **Télécharger le modèle** (depuis la boîte de dialogue d'import) : Obtenir un CSV vierge avec les en-têtes corrects

**Autorisations requises** : `applications:admin` pour les opérations d'import/export.

### Options d'export

**Préréglages** :

| Préréglage | Description |
|------------|-------------|
| **Export complet** | Tous les champs exportables incluant les données calculées/lecture seule (horodatages, résidence des données, métriques utilisateurs) |
| **Enrichissement de données** | Uniquement les champs importables -- idéal pour les flux d'édition aller-retour |

**Export modèle** : Télécharge uniquement les en-têtes -- utile pour préparer des fichiers d'import avec la bonne structure. Le modèle inclut tous les champs importables.

**Sélection personnalisée** : Choisissez les champs spécifiques à inclure dans votre export.

### Processus d'import

1. **Préparez votre fichier** : Utilisez l'encodage UTF-8 avec des séparateurs point-virgule (`;`). Téléchargez un modèle pour vous assurer des bons en-têtes.

2. **Choisissez les paramètres d'import** :
   - **Mode** :
     - `Enrichir` (par défaut) : Les cellules vides conservent les valeurs existantes -- ne mettez à jour que ce que vous spécifiez
     - `Remplacer` : Les champs fournis sont mis à jour ; les cellules de classification vides conservent la valeur existante et `__CLEAR__` l'efface explicitement
   - **Opération** :
     - `Upsert` (par défaut) : Créer de nouvelles applications ou mettre à jour les existantes
     - `Mise à jour uniquement` : Ne modifier que les applications existantes, ignorer les nouvelles
     - `Insertion uniquement` : Ne créer que de nouvelles applications, ignorer les existantes

3. **Validez d'abord** : Cliquez sur **Vérification préalable** pour valider votre fichier sans apporter de modifications. Examinez les erreurs et avertissements.

4. **Appliquez les modifications** : Si la validation réussit, cliquez sur **Importer** pour valider les changements.

### Référence des champs

**Champs Vue d'ensemble** :

| Colonne CSV | Description | Obligatoire | Notes |
|-------------|-------------|-------------|-------|
| `id` | UUID de l'application | Non | Pour les mises à jour ; laisser vide pour les nouvelles applications |
| `name` | Nom de l'application | Oui | Utilisé comme identifiant unique pour la correspondance |
| `description` | Ce que fait l'application | Non | |
| `category` | Objectif principal | Non | Accepte un code ou un libellé depuis les Paramètres |
| `supplier_name` | Nom du fournisseur | Non | Doit correspondre à un fournisseur existant |
| `editor` | Éditeur du logiciel | Non | Texte libre (ex. : Microsoft, SAP) |
| `criticality` | Criticité business | Non | Accepte un code ou un libellé depuis les Paramètres ; `__CLEAR__` l'efface |
| `lifecycle` | Statut actuel | Non | Accepte un code ou un libellé depuis les Paramètres |
| `is_suite` | Peut avoir des apps enfants | Non | `true` ou `false` |
| `status` | Activé/désactivé | Non | `enabled` ou `disabled` |

**Champs de version** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `version` | Version actuelle | Texte libre |
| `go_live_date` | Quand la version a été mise en production | Format de date : YYYY-MM-DD |
| `end_of_support_date` | Date de fin du support éditeur | Format de date : YYYY-MM-DD |
| `retired_date` | Date de mise hors service | Format de date : YYYY-MM-DD |

**Champs techniques** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `access_methods` | Comment les utilisateurs accèdent | Codes ou libellés séparés par virgules depuis les Paramètres (ex. : `web,mobile,vdi`) |
| `external_facing` | Accessible depuis Internet | `true` ou `false` |
| `etl_enabled` | Intégration de données | `true` ou `false` |
| `support_notes` | Informations de support | Texte libre |
| `licensing` | Conditions de licence | Texte libre |
| `notes` | Notes internes | Texte libre |

**Champs de conformité** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `data_class` | Classification des données | Accepte un code ou un libellé depuis les Paramètres |
| `last_dr_test` | Date du dernier test PRA | Format de date : YYYY-MM-DD |
| `contains_pii` | Stocke des données personnelles | `true` ou `false` |
| `data_residency` | Pays de stockage des données | Export uniquement (codes ISO) |

**Champs de classification** :

| Colonne CSV | Description | Notes |
|------------|-------------|-------|
| `criticality` | Niveau de criticité business | Code ou libellé non ambigu du catalogue |
| `cyber_criticality` | Niveau de conséquence cyber | Code ou libellé non ambigu du catalogue |
| `recovery_wave` | Ordre de reprise | Code ou libellé non ambigu du catalogue |
| `rto_minutes` / `rpo_minutes` | Objectifs de reprise | Minutes entières ; le RPO peut être zéro |
| `classification_justification` | Justification | Texte libre |

Une cellule de classification vide conserve la valeur existante dans les modes Enrichir et Remplacer ; utilisez `__CLEAR__` pour effacer une classification.

**Champs Responsables** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `business_owner_email_1` à `_4` | E-mails des responsables métier | Doivent correspondre à des utilisateurs existants par e-mail |
| `it_owner_email_1` à `_4` | E-mails des responsables IT | Doivent correspondre à des utilisateurs existants par e-mail |

**Champs en export uniquement** (inclus dans Export complet mais non importables) :

| Colonne CSV | Description |
|-------------|-------------|
| `data_residency` | Pays de stockage des données (codes ISO, séparés par virgules) |
| `users_mode` | Méthode de comptage des utilisateurs (`manual`, `it_users`, `headcount`) |
| `users_year` | Année de référence pour les calculs d'utilisateurs |
| `users_override` | Saisie manuelle du nombre d'utilisateurs |
| `created_at` | Horodatage de création de l'enregistrement |
| `updated_at` | Horodatage de la dernière modification |

### Acceptation des libellés et codes

Pour les champs configurés dans **Cartographie SI > Paramètres**, vous pouvez utiliser soit le code interne, soit le libellé d'affichage :

| Champ | Exemples de codes | Exemples de libellés |
|-------|-------------------|----------------------|
| Catégorie | `lob`, `productivity`, `security` | `Métier`, `Productivité`, `Sécurité` |
| Cycle de vie | `active`, `proposed`, `deprecated` | `Actif`, `Proposé`, `Obsolète` |
| Classification données | `public`, `internal`, `confidential` | `Public`, `Interne`, `Confidentiel` |

Le système normalise automatiquement les valeurs lors de l'import, donc `Métier`, `metier` et `lob` se résolvent tous vers la même catégorie.

### Correspondance et mises à jour

Les applications sont identifiées par **nom** (insensible à la casse). Lorsqu'une correspondance est trouvée :
- En mode `Enrichir` : Seules les valeurs CSV non vides mettent à jour l'application
- En mode `Remplacer` : les champs fournis sont mis à jour ; les cellules de classification vides conservent la valeur existante et `__CLEAR__` l'efface explicitement

Si vous incluez la colonne `id` avec un UUID valide, la correspondance utilise d'abord l'ID, puis se rabat sur le nom.

### Limitations

- **Déploiements non inclus** : Les déploiements d'environnement (Prod, QA, Dev) nécessitent une configuration dans l'espace de travail
- **Assignations de serveurs exclues** : Les liaisons serveur doivent être configurées dans l'onglet Déploiements
- **Interfaces exclues** : Les définitions d'intégration ne font pas partie de l'import/export CSV
- **Maximum 4 responsables par type** : Jusqu'à 4 responsables métier et 4 responsables IT peuvent être importés/exportés
- **Métriques utilisateurs en export uniquement** : Les champs d'audience et de comptage d'utilisateurs (`users_mode`, `users_year`, `users_override`) sont gérés dans l'espace de travail
- **Résidence des données en export uniquement** : Les sélections de pays doivent être gérées dans l'onglet Conformité

### Résolution de problèmes

**Erreur « Le fichier n'est pas correctement formaté »** : Cela indique généralement un problème d'encodage. Assurez-vous que votre CSV est enregistré en **UTF-8** :

- **Dans LibreOffice** : Lors de l'ouverture d'un CSV, sélectionnez `UTF-8` dans le menu déroulant Jeu de caractères (pas « Japanese (Macintosh) » ni d'autres encodages). Lors de l'enregistrement, cochez « Modifier les paramètres de filtre » et choisissez UTF-8.
- **Dans Excel** : Enregistrer sous > CSV UTF-8 (délimité par des virgules), puis ouvrez dans un éditeur de texte pour remplacer les virgules par des points-virgules.
- **Conseil général** : Si vous voyez des caractères illisibles (`?¿`, `ï»¿`) au début de votre fichier, l'encodage est incorrect.

### Exemple CSV

```csv
name;category;supplier_name;criticality;lifecycle;go_live_date;external_facing
Salesforce CRM;Line-of-business;Salesforce Inc;Critical;Active;2020-01-15;true
Microsoft 365;Productivity;Microsoft;high;active;2019-06-01;false
Custom ERP;lob;;Moderate;Active;2018-03-20;false
```

---

## Conseils

- **Commencez par les apps critiques** : Documentez d'abord vos applications critiques pour le métier, puis descendez dans les niveaux de criticité.
- **Utilisez les suites pour regrouper** : Activez « Peut avoir des apps enfants » dans l'onglet Exploitation pour marquer une application comme une Suite qui regroupe les composants liés (ex. : modules SAP sous une Suite SAP).
- **Liez aux dépenses tôt** : Connectez les postes OPEX, CAPEX et contrats dans l'onglet Relations pour voir l'image complète des coûts pour chaque application.
- **Maintenez les déploiements à jour** : L'onglet Déploiements alimente les pastilles d'environnement dans la liste -- maintenez-le à jour pour une visibilité précise.
- **Documentez l'audience** : Définissez les audiences société et département dans le tiroir des propriétés ; le nombre d'utilisateurs est alors dérivé automatiquement et utilisé dans les rapports.
- **Exploitez le filtrage par catégorie** : Utilisez le filtre de la colonne Catégorie pour vous concentrer sur des types d'applications spécifiques (ex. : afficher uniquement les apps Métier, ou exclure les outils de Productivité).
- **Attachez les connaissances tôt** : Liez les runbooks et les documents d'architecture depuis l'onglet Vue d'ensemble pour que l'équipe sache où chercher lors des incidents.
- **Les tâches viennent de la page Tâches** : Pour rattacher une tâche à une application, définissez le champ App / Service sur la tâche elle-même ; elle apparaîtra alors sous Relations > Tâches.
