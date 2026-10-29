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
- **Nom** : Un nom reconnaissable pour l'application ou le service, de 200 caractères au plus. Voir [Noms uniques](#unique-names)
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

La **Fin de support** et la **Date de retrait** ne peuvent pas précéder la **Mise en production**.

Une fois enregistré, l'espace de travail déverrouille tous les onglets pour une documentation détaillée.

### Noms uniques { #unique-names }

Deux applications ne peuvent pas porter le même nom. La comparaison ignore les majuscules et les minuscules, ainsi que les espaces au début et à la fin du nom : `CRM` et ` crm ` sont le même nom. Quand le nom est déjà pris, le message nomme l'application qui le porte, avec sa référence (`APP-12`). La règle s'applique quand vous créez, renommez, copiez ou importez une application, et quand vous créez une nouvelle version.

Les applications qui portaient déjà le même nom avant cette règle restent modifiables. Leur nom n'est vérifié que lorsqu'il change.

**Conseil** : Commencez par documenter vos applications les plus critiques. Utilisez l'onglet **Déploiements** pour capturer les environnements existants (Prod, QA, Dev) et les serveurs qui les exécutent, puis liez les interfaces, contrats et lignes budgétaires au fur et à mesure.

**Autorisations** :
- Consultation : `applications:reader`
- Création / modification : `applications:member`
- Import / Export / Suppression : `applications:admin`

---

## Travailler avec la liste { #working-with-the-list }

La grille Applications offre une vue complète de votre portefeuille applicatif.

**Filtre de périmètre en haut (Afficher)** :
- **Mes applications** : affiche les apps où vous êtes listé dans le tiroir des propriétés comme **Responsable métier** ou **Responsable IT**. Les entrées multi-responsables sont supportées.
- **Applications de mon équipe** : affiche les apps où tout membre de votre équipe Portefeuille est listé comme Responsable métier ou Responsable IT. Votre propre responsabilité est aussi incluse dans ce périmètre. Désactivé si vous n'êtes pas assigné à une équipe Portefeuille.
- **Toutes les applications** (par défaut) : affiche la grille complète des Applications avec le comportement de filtre par défaut du cycle de vie.
- Votre sélection est mémorisée entre les sessions : revenir sur la page restaure votre dernier choix.

**Colonnes par défaut** :
- **Nom** : Nom de l'application, avec en dessous une ligne « Incluse dans : {suite} » pour une application incluse dans une suite
- **Vulnérabilités à traiter** : les vulnérabilités encore à traiter sur les technologies que l'application déclare ou que ses serveurs de déploiement ont renseignées, puis, en orange, le nombre de critiques ou élevées (`5 · 2`). Vide pour une application désactivée ou quand il n'en reste aucune. Cliquez pour ouvrir la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'application. Présente quand les vulnérabilités sont suivies. Voir [Ce que KANAP compte](vulnerabilities.md#what-kanap-counts)
- **Catégorie** : L'objectif principal de l'application
- **Environnements** : Pastilles colorées montrant les environnements actifs (Prod, Pré-prod, QA, Test, Dev, Sandbox). Survolez pour voir l'URL de base et le cycle de vie.
- **Cycle de vie** : Statut actuel
- **Criticité business** : Niveau d'importance pour le métier
- **Éditeur** : Éditeur du logiciel
- **Utilisateurs dérivés {année}** : les utilisateurs comptés pour les sociétés et départements de l'audience sur l'année en cours, ou sur l'année la plus proche qui a des données. Un nombre d'utilisateurs saisi à la main le remplace. L'infobulle de l'en-tête l'explique
- **Créé** : Quand l'enregistrement a été créé

Une cellule sans valeur affiche un tiret.

**Tri par défaut** : **Nom** croissant (A à Z).

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **Suites** : Suites parentes auxquelles cette application appartient
- **Fournisseur** : Nom du fournisseur lié
- **Responsables métier** / **Responsables IT** : Responsables assignés (tronqués, survolez ou cliquez pour tout voir)
- **Hébergement** : Dérivé des sites des serveurs affectés aux déploiements de l'app. Une application sur un cluster prend aussi les sites de ses membres
- **Exposition externe** : Si l'app est accessible depuis Internet
- **SSO activé** / **MFA activé** : Fonctionnalités d'authentification
- **Intégration de données / ETL** : Si l'app participe à des intégrations de données
- **Lignes OPEX** / **Lignes CAPEX** / **Contrats** : Dépenses et contrats liés
- **Composants** : Applications enfants (si c'est une suite)
- **Classification données** / **Contient des PII** / **Résidence des données** : Informations de conformité
- **Criticité cyber**, **Vague de reprise**, **RTO**, **RPO**, **État/date de revue** : Champs de classification et de continuité

**Avancement de la classification** : la tuile Conformité de votre tableau de bord indique combien d'applications visibles sont revues, à revoir ou ont encore des champs de classification à compléter, ainsi que les points qui appellent une action. Chaque chiffre ouvre la liste des applications filtrée en conséquence. Voir [Mon tableau de bord](my-dashboard.md).

**Filtrage** :
- Recherche rapide : correspond au nom et à l'éditeur
- Les filtres de criticité, de criticité cyber, de classe de données et de vague de reprise listent leurs valeurs dans l'ordre du catalogue (la plus critique en premier, les vagues dans l'ordre de restauration).
- La plupart des colonnes utilisent des filtres par jeu de cases à cocher affichant uniquement les valeurs présentes dans le jeu de résultats actuel. **Tous** coche toutes les valeurs et **Aucun** les décoche toutes. Le filtre flottant affiche `Tous`, `Aucun` ou `N sélectionnés` avec un **x** pour effacer.
- Les applications retirées sont masquées par défaut ; utilisez le filtre **Cycle de vie** pour inclure les applications retirées.
- **Vulnérabilités à traiter** filtre sur **Avec des vulnérabilités graves**, **Avec des vulnérabilités** ou **Sans**, et trie par les vulnérabilités critiques ou élevées, puis par le total. Les applications désactivées viennent en dernier et n'entrent dans aucune valeur du filtre.

**Actions** :
- **Nouvelle app / Service** : Créer une nouvelle entrée (`applications:member`)
- **Importer** : Import en masse depuis un fichier CSV ou un classeur Excel (`applications:admin`)
- **Exporter** : Exporter les applications que la liste affiche dans un fichier CSV ou un classeur Excel (`applications:admin`). Voir [Options d'export](#export-options).
- **Copier l'élément** : Dupliquer une application sélectionnée avec toutes ses relations principales (`applications:member`). Voir [Copier des applications](#copier-des-applications) pour ce qui est et n'est pas copié.
- **Supprimer la sélection** : Supprimer les applications sélectionnées (`applications:admin`). Une application source ou cible d’une interface ne peut pas être supprimée : désactivez-la plutôt, ou supprimez d’abord ses interfaces. Avant la confirmation, la fenêtre liste ces applications comme conservées, avec leur nombre d’interfaces. Les autres sont supprimées avec leurs déploiements et leurs liens vers d’autres éléments ; la confirmation compte les déploiements

---

## L'espace de travail des applications

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. L'espace de travail comporte un **en-tête** avec des métadonnées rapides, un **tiroir des propriétés** sur la droite (la carte d'identité de l'application, toujours visible) et une **zone de contenu** au centre qui change selon l'onglet.

Les onglets sont **Vue d'ensemble**, **Déploiements**, **Interfaces**, **Exploitation**, **Conformité**, **Relations** et **Historique** (les modifications de l'application, voir [Historique des fiches](record-history.md)).

### En-tête

L'en-tête affiche :
- **Nom de l'application** (modifiable sur place)
- **Référence** : court identifiant copiable
- Pastille **Cycle de vie** : cliquez pour modifier
- Pastille **Criticité business** : affiche le niveau et ouvre un menu des niveaux définis par l'organisation
- **Vulnérabilités graves**, par exemple « 3 graves » : les vulnérabilités critiques ou élevées encore à traiter sur l'application, avec la couleur de la plus haute. Une icône d'alerte suit quand certaines sont connues comme exploitées. Cliquez pour ouvrir la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'application. Affiché seulement quand l'application en a
- Pastille **Version** (si une version est définie) : cliquez pour copier
- Date de **Mise en production**
- **Partager** : copier un lien partageable vers cet espace de travail
- **Nouvelle version** : lancer l'assistant de migration de version (voir [Gestion des versions](#gestion-des-versions))
- **Convertir en technologie** (`applications:admin` et `infrastructure:member`) : voir [Convertir une application en technologie](#convertir-une-application-en-technologie)
- **Supprimer**, une icône corbeille avec son nom en infobulle (`applications:admin`) : une application qui a des interfaces reçoit le refus et sa raison, avec seulement Fermer. Sinon, la confirmation nomme l’application et compte les déploiements supprimés avec elle, ainsi que ses liens vers d’autres éléments
- **Précédent / Suivant** : parcourir la liste filtrée sans revenir à la grille

### Tiroir des propriétés (panneau de droite)

Le tiroir est la carte d'identité de l'application. Il est affiché sur chaque onglet et modifié en ligne. Les changements sont enregistrés automatiquement.

**Identité** :
- **Catégorie**, **Fournisseur**, **Éditeur**
- **Incluse dans** : les suites auxquelles appartient cette application. Choisissez-en une dans **Ajouter une suite** : la liste propose les applications où **Peut contenir des applications enfants** est coché. Chaque nom ouvre la suite. Pour en retirer une, survolez son nom et cliquez sur la croix en fin de ligne. Une suite peut appartenir à une autre suite, mais un lien qui créerait une boucle est refusé (une suite placée dans l'un de ses propres composants, par exemple)

**Version et dates du cycle de vie** :
- **Version**. En dessous, **Version précédente** ouvre l'application à partir de laquelle celle-ci a été créée avec **Nouvelle version**, et **Version suivante** ouvre les applications créées à partir d'elle. Ces liens n'apparaissent que si de telles applications existent
- **Mise en production**, **Fin de support**, **Date de retrait**. La **Fin de support** et la **Date de retrait** ne peuvent pas précéder la **Mise en production**

**Processus métier et responsables** :
- **Processus métier** : les processus que l'application soutient. Chaque nom ouvre le processus. Tapez dans le champ pour rechercher et ajouter un processus ; survolez un nom et cliquez sur la croix pour le retirer. Chaque changement est enregistré aussitôt. Le processus affiche le même lien dans sa propre section **Applications**. Un processus désactivé reste affiché, grisé. Modifier la liste demande aussi `business_processes:member` ; sans droit de lecture des processus métier, le champ est masqué.
- **Responsables métier** : parties prenantes métier redevables de cette application (multi-sélection)
- **Responsables IT** : membres de l'équipe IT responsables du support technique (multi-sélection)

Pour retirer un responsable, survolez son nom et cliquez sur la croix en fin de ligne.

Le retrait d'un responsable, d'un processus métier, d'une suite ou d'un contact de support affiche un message avec **Annuler**, qui le rétablit.

**Audience** :
- Ajoutez des lignes **Société / Départements** pour enregistrer qui utilise cette application. Choisissez une société et limitez optionnellement à des départements spécifiques.
- Une ligne sous l'audience indique ce qu'elle couvre. Sans département choisi, l'audience est toute la société. Avec des départements choisis, elle se limite à ces départements : retirez-les pour inclure de nouveau toute la société.
- Un nombre d'**Utilisateurs** en direct est affiché.
- **Méthode de calcul** : **Dérivé** (calculé à partir de l'audience basé sur les métriques Utilisateurs IT / Effectif des données de référence) ou **Manuel** (un seul nombre de remplacement que vous saisissez).

---

### Vue d'ensemble

L'onglet Vue d'ensemble est le récit de l'application. Il contient :

**Description** : Une description en texte enrichi de l'application. L'éditeur sauvegarde automatiquement au fur et à mesure que vous tapez. Toute personne qui peut modifier l'application peut modifier sa description, sans droit sur la base de connaissances. La description est conservée comme document managé dans la base de connaissances. Son titre reprend la référence et le nom de l'application, dans la langue de la personne qui l'a créée. Renommer l'application, dans l'espace de travail ou par un import, met ce titre à jour.

**Connexions** : Un résumé en lecture seule construit à partir des interfaces de l'application. Pour les apps non-middleware, il affiche deux lignes : **Reçoit de** et **Envoie vers**. Pour les apps ETL/middleware, il affiche une seule ligne **Connecté à**. Chaque entrée est une pastille cliquable qui ouvre l'application liée ; « + N de plus dans Interfaces » saute à l'onglet Interfaces.

**Connaissances** : Articles de connaissances liés. Si vous avez `knowledge:member`, vous pouvez créer de nouveaux articles directement depuis cette section.

**Support** :
- Un tableau de contacts de support tirés de vos données de référence Contacts. Chaque ligne affiche le nom du contact, l'e-mail, le téléphone et un rôle en texte libre (ex. : Responsable commercial, Support N1).
- **Ajouter un contact** ouvre une boîte de dialogue pour choisir un contact et définir un rôle.
- **Notes de support** : texte libre pour les arrangements de support (SLA, voies d'escalade, infos d'astreinte).

---

### Déploiements

L'onglet Déploiements documente où l'application s'exécute réellement : un bloc par environnement, avec les serveurs attachés à chacun.

**Environnements** : Production, Pré-prod, QA, Test, Dev, Sandbox.

**Pour chaque déploiement, vous pouvez capturer** :
- **Cycle de vie** : statut spécifique à l'environnement (Actif, Proposé, Obsolète, Retiré, etc.)
- **URL de base** : l'URL d'accès pour cet environnement
- **SSO activé** / **MFA supporté**
- **Notes**

**Ajouter un déploiement** ouvre une boîte de dialogue où vous définissez l'environnement, le cycle de vie, l'URL de base, les indicateurs SSO/MFA et les notes. Chaque environnement ne peut être ajouté qu'une seule fois. La pastille de cycle de vie sur l'en-tête d'un déploiement peut aussi être modifiée en ligne depuis un menu contextuel. Un déploiement qui a encore des serveurs ou des liaisons d'interface ne peut pas être supprimé : retirez-les d'abord.

**Serveurs par déploiement** : Chaque bloc de déploiement affiche un tableau des serveurs affectés :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **Serveur** | Nom de l'actif (cliquable) |
| **Rôle** | ex. : Web, Base de données, Application (depuis la liste des rôles serveur dans les Paramètres) |
| **Hébergement** | Dérivé du site de l'actif |
| **Depuis** | Date à laquelle le serveur a été affecté à ce déploiement |

Cliquez sur **Ajouter un serveur** dans l'en-tête du déploiement pour rattacher un actif. Le sélecteur liste les clusters avec leurs membres sous leur nom. L'affectation d'un cluster s'étend à ses membres en service : ils s'affichent sous la ligne du cluster, sans actions. Modifiez l'affectation sur le cluster. Quand vous choisissez un membre d'un cluster, KANAP demande s'il faut affecter le cluster ou ce serveur seulement. Voir [Applications sur un cluster](assets.md#applications-on-a-cluster). Ajouter, modifier ou retirer un serveur demande `applications:member` et `infrastructure:member`.

Quand l'application est affectée directement à chaque membre en service d'un cluster, une ligne sous le tableau les nomme, avec un bouton pour affecter l'application au cluster (**Affecter à** et son nom). Après une confirmation, le cluster prend l'affectation et les affectations propres des membres sont retirées. L'application reste alors disponible tant qu'un membre tient.

**Conseil** : Documentez les serveurs dans **Cartographie SI > Actifs** d'abord, puis liez-les ici. L'onglet Exploitation de l'actif affiche les mêmes affectations dans le sens inverse, sous **Applications hébergées**.

---

### Interfaces

L'onglet Interfaces affiche toutes les intégrations auxquelles cette application participe, en tant que source, cible ou middleware. Le badge de l'onglet affiche le total.

Les interfaces sont **regroupées par environnement** (PROD, PRE_PROD, QA, ...). Au sein de chaque environnement, elles sont divisées en :

- **Entrantes** : cette application reçoit des données
- **Sortantes** : cette application envoie des données
- **Routées** : cette application est le middleware/ETL pour un flux entre deux autres apps

Chaque ligne affiche le nom de l'interface, l'application contrepartie et un indicateur **Via middleware**. Cliquez sur la ligne pour ouvrir l'espace de travail de l'interface ; cliquez sur la contrepartie pour ouvrir l'autre application.

**Conseil** : Les interfaces sont gérées depuis la page Interfaces. Cet onglet est une vue pratique en lecture seule, mais c'est le moyen le plus rapide de naviguer entre les applications connectées.

---

### Exploitation { #operations }

L'onglet Exploitation regroupe, dans cet ordre, la façon dont les utilisateurs accèdent à l'application (**Technique**), les technologies dont elle dépend et leurs vulnérabilités.

**Technique** :
- **Méthodes d'accès** (multi-sélection) : comment les utilisateurs accèdent à cette application. Les options sont configurables dans les [Paramètres de la Cartographie SI](it-ops-settings.md). Les options par défaut incluent Web, Application installée localement, Application mobile, IHM propriétaire (interface industrielle), Terminal / CLI, VDI / Bureau distant, Borne.
- **Exposition externe** : si l'application est accessible depuis Internet
- **Intégration de données / ETL** : si l'application participe à des pipelines d'intégration de données (bascule également cette app en mode « middleware » pour les vues Interfaces et Connexions)
- **Peut avoir des apps enfants** : transformer cette application en Suite qui regroupe d'autres applications. Vous ne pouvez pas décocher la case tant que des applications sont incluses dans la suite : retirez-les d'abord de la suite

**Technologies** liste ce dont l'application dépend, selon deux sources indiquées dans la colonne **Lien**. Colonnes : référence (`TEC-4`), nom, famille, versions, lien, serveurs par lesquels elle arrive (**Via**), fin du support standard.

- **Déclarée** : quelqu'un a lié la technologie à l'application, par exemple Entra ID pour une application qui connecte ses utilisateurs par ce service.
- **Hébergée** : un serveur de l'un de ses déploiements porte la technologie, y compris un membre d'un cluster auquel elle est affectée. **Via** nomme le serveur, et l'hôte quand la technologie tourne sur l'hôte d'une machine virtuelle. Les déploiements désactivés ne comptent pas.

Une technologie peut être les deux. Un tiret dans la colonne des versions signifie que la version n'est pas connue. La fin du support standard passe en orange une fois dépassée. La section demande `infrastructure:reader`.

**Ajouter une technologie** : cliquez sur **Ajouter**, choisissez la technologie, puis sa version : une version existante, une nouvelle version que vous saisissez, ou **Version inconnue**. Quand l'application a des serveurs de déploiement en service, une dernière étape propose de renseigner la technologie à la même version sur ces serveurs, par exemple « Renseigner aussi PHP 8.2 sur ». Chaque serveur indique ses environnements et ses rôles. Rien n'est coché : cochez les serveurs qui l'exécutent, puis cliquez sur **Ajouter**. Un serveur qui porte déjà la technologie affiche **Déjà renseignée** et garde sa propre version. Un système d'exploitation n'est pas proposé ici : renseignez-le sur la fiche du serveur. Fermer la liste n'ajoute rien.

**Modifier une technologie déclarée** : cliquez sur sa version pour en choisir une autre. Quand aucun serveur de l'application ne porte une technologie déclarée, l'icône de serveur en fin de ligne (**Renseigner sur un serveur**) propose la même liste de serveurs. Une technologie hébergée se modifie sur le serveur : cliquez sur le serveur dans **Via** pour ouvrir sa fiche.

Pour ajouter, modifier ou retirer une technologie déclarée, et pour la renseigner sur des serveurs, il faut `applications:member` et `infrastructure:member`. Une technologie hébergée n'a pas de croix : retirez-la du serveur.

**Vulnérabilités** (quand les vulnérabilités sont suivies) liste les vulnérabilités encore à traiter sur l'application, dans les alertes. Le nombre à côté du titre est celui des vulnérabilités distinctes à traiter : cliquez dessus pour ouvrir la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'application. Une ligne par technologie et version :

| Colonne | Ce qu'elle affiche |
|---|---|
| **Technologie**, **Version** | La technologie et sa version. **Version non renseignée (potentiellement concernée)** quand aucune version n'est nommée |
| **Serveurs** | Les serveurs de déploiement qui ont cette technologie et cette version renseignées sur eux-mêmes. **Déclarée** quand l'application la déclare et qu'aucun serveur ne l'a. **Renseigner sur un serveur** propose alors ses serveurs de déploiement, comme dans **Technologies** |
| **Crit.**, **Élev.**, **Moy.**, **Faible**, **N. éval.** | Une colonne par sévérité (Critique, Élevée, Moyenne, Faible, Non évaluée, le nom complet en infobulle sur l'en-tête) : les vulnérabilités encore à traiter. Une vulnérabilité notée **Aucune** compte avec **Faible** |
| **Total** | Les vulnérabilités distinctes encore à traiter sur cette ligne |

**Voir** ouvre la page [Vulnérabilités](vulnerabilities.md) filtrée sur l'application et la technologie. Quand il ne reste rien à traiter, la section le dit en une ligne. Tant que la première lecture d'un produit dans la NVD, ou le rapprochement d'une technologie qui vient d'être renseignée sur cette application ou sur un de ses serveurs de déploiement, est en cours, la section affiche « Recherche des vulnérabilités en cours… » et se complète d'elle-même. Quand la recherche ne peut pas aboutir, la section le dit. Une application désactivée n'a pas de section.

La section ne compte que les liens directs. Une technologie que la section **Technologies** montre par l'hôte d'une machine virtuelle ne compte pas ici : elle compte sur l'hôte. Voir [Ce que KANAP compte](vulnerabilities.md#what-kanap-counts).

Un utilisateur qui lit les applications sans lire l'infrastructure voit quand même cette section, le badge de l'en-tête et la colonne de la liste, pour les applications qu'il peut lire.

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
- Les données personnelles, la criticité métier et cyber, et l'hébergement des instances décident aussi des clauses attendues dans les contrats liés à l'application. Voir l'onglet **Conformité** dans [Contrats](contracts.md#conformite).

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

L'onglet Relations montre ce à quoi cette application est liée : ses lignes budgétaires, contrats, projets, demandes, tâches et incidents, chacun dans son propre tableau, puis ses liens et fichiers. Les technologies sont dans l'onglet [Exploitation](#operations), les processus métier dans le [tiroir des propriétés](#tiroir-des-proprietes-panneau-de-droite). Cliquez sur une ligne pour ouvrir l'enregistrement. Le badge de l'onglet compte les lignes budgétaires, contrats, projets, demandes et incidents liés, ainsi que les liens et fichiers. Les tâches ne sont pas comptées.

**Composants** (uniquement lorsque « Peut avoir des apps enfants » est activé) : un tableau listant les applications enfants de cette Suite, avec leur cycle de vie et criticité. Cliquez sur une ligne pour ouvrir l'espace de travail enfant.

**Enregistrements liés**, un tableau chacun :

| Section | Colonnes |
|---|---|
| **Lignes budgétaires** | Référence (`BL-12`), nom, type (OPEX ou CAPEX), fournisseur, et le montant de l'année en cours dans votre colonne budgétaire par défaut, dans la devise de reporting. Un tiret signifie que la ligne n'a pas de budget pour l'année |
| **Contrats** | Nom, fournisseur, fin de la période en cours, montant annuel dans la devise du contrat, renouvellement (tacite ou manuel) |
| **Projets** | Référence (`PRJ-7`), nom, statut, fin prévue |
| **Demandes** | Référence (`REQ-23`), nom, statut, livraison souhaitée |
| **Tâches** | Référence (`T-118`), titre, statut, assigné, échéance. Seules les tâches liées à cette application elle-même apparaissent, pas les tâches de ses projets |
| **Incidents** | Référence (`INC-14`), titre, sévérité, statut, date de détection |

Un incident confidentiel n'apparaît qu'aux personnes qui peuvent le voir dans le registre des incidents, sans son titre.

Les dates en orange demandent votre attention : un contrat dont la décision de renouvellement tombe dans votre fenêtre de décision des contrats, ou une tâche ouverte dont l'échéance est passée. Une ligne budgétaire ou un contrat désactivé reste affiché, son nom grisé. Vous ne voyez que les sections des modules que vous pouvez lire.

À partir de deux lignes, les lignes budgétaires et les contrats se terminent par une ligne de total. Le total des lignes budgétaires est dans la devise de reporting. Une ligne dont la devise n'a pas de taux de change pour l'année affiche son montant dans sa propre devise avec une petite marque orange, et le total l'exclut. Un avertissement d'une ligne sous le tableau l'indique, par exemple « 1 ligne sans taux de change exclue : USD 2026. » Voir [Taux manuels](currencies.md#taux-manuels). Les contrats ont un total par devise, sans les contrats désactivés.

**Ajouter et retirer des liens** (`applications:member`) : **Ajouter**, à droite d'une section, ouvre une recherche. Tapez un nom ou une référence et choisissez un résultat : le lien est enregistré aussitôt. Pour retirer un lien, survolez la ligne et cliquez sur la croix en fin de ligne. Retirer un lien ne supprime rien d'autre. Lier ou délier un incident demande aussi `incidents:contributor` et s'inscrit dans le journal de l'incident. Un incident clos ou annulé ne peut être ni lié ni délié : rouvrez-le d'abord.

**Apparentés** : des suggestions d'enregistrements que vous pourriez lier, chacune avec la raison de la suggestion :

- contrats et lignes budgétaires du fournisseur de l'application ;
- lignes budgétaires d'un contrat lié ou d'un projet lié ;
- projets qui portent une tâche liée à l'application.

Cliquez sur **Lier** pour ajouter la suggestion à sa section. La section est absente quand il n'y a rien à suggérer.

**Aussi relié** : une ligne sous les suggestions compte les actifs des déploiements de l'application, ses interfaces et ses documents de connaissance. Chaque nombre ouvre l'onglet ou la section correspondante.

**Liens et fichiers** : les liens web de l'application (portails fournisseurs, tableaux de bord de monitoring, documentation) et ses fichiers, une ligne chacun avec son nom, le domaine du lien ou la taille du fichier, et sa date d'ajout. Cliquez sur un lien pour l'ouvrir dans un nouvel onglet, ou sur un fichier pour le télécharger. Avec `applications:member` :

- **Ajouter un lien** ouvre une boîte de dialogue pour une URL et un nom optionnel ; le lien est enregistré aussitôt. Pour modifier un lien, survolez sa ligne et cliquez sur le crayon.
- **Joindre un fichier** ouvre le sélecteur de fichiers. Vous pouvez aussi déposer des fichiers sur la section : elle est surlignée pendant le glisser.
- Pour retirer un lien ou un fichier, survolez la ligne et cliquez sur la croix. Retirer un lien affiche un message et propose **Annuler**, qui recrée le lien. La suppression d'un fichier demande d'abord une confirmation.

---

## Convertir une application en technologie

Certaines fiches ont été créées comme applications alors que ce sont des technologies : un moteur de base de données, un annuaire, un serveur d'applications. **Convertir en technologie**, dans l'en-tête, transforme une telle fiche en [technologie](technologies.md). Convertissez quand une autre application peut tomber ou devenir vulnérable à cause d'elle.

Il faut `applications:admin` et `infrastructure:member`.

La fenêtre vérifie d'abord ce que la conversion change. Choisissez une **Famille**, puis lisez les trois listes :

- **Passe à la technologie** : responsables, contacts de support, contrats, lignes budgétaires, projets, liens web, documents, incidents, et les serveurs de ses déploiements actifs. Chaque serveur devient un serveur qui porte la technologie, avec une version inconnue. Un cluster donne ses membres en service. Les liens des modules que vous ne pouvez pas lire passent aussi.
- **Conservé, sans son lien avec l’application** : les documents managés restent dans leur bibliothèque, parmi les documents non classés.
- **Perdu avec l’application** : déploiements et environnements, appartenance à une suite, prédécesseur et successeurs, résidence des données, sociétés et départements utilisateurs, liens de connaissance, tâches et demandes liées, processus métier, technologies dont elle dépend, et les champs propres aux applications (utilisateurs, modes d'accès, SSO, MFA, données personnelles). Sa référence `APP` disparaît aussi.

La technologie garde le nom, l'éditeur, la description, les notes, les notes de support, le cycle de vie, la criticité cyber et les champs de reprise. Chaque contact de support n'est listé qu'une fois, avec le premier rôle qu'il avait. La fenêtre nomme le type d'hébergement que prend la technologie. Avec des serveurs, c'est le type d'hébergement de leurs sites (celui qui a le plus de serveurs), sinon **Sur site**. Sans serveur, c'est l'**Hébergement** de l'application, sinon **SaaS**. Vous pourrez le changer ensuite sur la technologie. **Convertir** crée la technologie, supprime l'application et ouvre la nouvelle fiche. Le journal d'audit garde l'ancienne référence.

**En cas de refus** : la fenêtre liste les raisons et **Convertir** reste indisponible. Une application ne peut pas être convertie tant qu'elle est source, cible ou middleware d'interfaces, outil d'intégration de liaisons d'interface, suite avec des composants, ou qu'elle porte des liaisons d'interface sur ses déploiements. Une technologie du même nom, des valeurs qu'une technologie ne peut pas prendre (y compris une liste **Types d'hébergement** sans aucun type en service) ou des fichiers absents du stockage la bloquent aussi. Retirez d'abord ces liens, ou gardez la fiche comme application.

---

## Gestion des versions

KANAP propose **deux approches pour gérer les versions d'applications**, selon la manière dont votre organisation gère les mises à niveau :

| Approche | Idéale pour | Ce qui se passe |
|----------|-------------|-----------------|
| **Simple** | La plupart des applications | Mettez à jour les champs de version dans le tiroir des propriétés ou le formulaire de création : même enregistrement, nouveau numéro de version |
| **Avancée** | Migrations majeures | Utilisez **Nouvelle version** pour créer un nouvel enregistrement d'application avec suivi de lignée : exécutez ancienne et nouvelle versions côte à côte |

### Suivi de version simple (mise à jour en place)

Pour la plupart des applications (où vous mettez à niveau et l'ancienne version disparaît simplement), mettez à jour **Version**, **Mise en production**, **Fin de support** et **Date de retrait** dans le formulaire de création ou le tiroir des propriétés. La pastille de version dans l'en-tête et les métadonnées **Mise en production** reflètent ce que vous avez défini.

Cette approche garde tout dans un seul enregistrement. Lors d'une mise à niveau, mettez à jour les champs de version et c'est fait. L'onglet **Historique** garde les valeurs précédentes.

**À utiliser quand** : les mises à niveau se font en place sans chevauchement : une version remplace l'autre.

### Créer une nouvelle version (migrations parallèles)

Pour les mises à niveau majeures d'applications où vous devez exécuter les anciennes et nouvelles versions en parallèle dans différents environnements (ex. : SAP S/4HANA 1909 en Prod alors que 2023 est en QA), utilisez **Nouvelle version** dans l'en-tête de l'espace de travail.

L'assistant comporte trois étapes :

1. **Détails de la version** : nouveau nom d'application, libellé de version, dates de **Mise en production** et **Fin de support**. Le nom doit être libre (voir [Noms uniques](#unique-names)), et la **Fin de support** ne peut pas précéder la **Mise en production**.
2. **Options de copie** : choisissez ce qui doit être copié depuis la source. Valeurs par défaut indiquées ci-dessous.
3. **Interfaces** : sélectionnez les interfaces à migrer vers la nouvelle version.

La nouvelle version est créée comme une application séparée avec :
- Un cycle de vie **Proposé** (prête à être configurée avant la mise en production)
- Un lien vers son prédécesseur (utilisé par la chronologie des versions)
- Des données copiées selon vos sélections
- Des interfaces dupliquées pointant vers la nouvelle version

Une fois la version créée, un message donne sa référence. Les deux applications sont alors reliées par **Version précédente** et **Version suivante** dans le tiroir des propriétés.

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
| Lignes budgétaires (OPEX + CAPEX, appariées) | Activé |
| Contrats | Activé |
| Déploiements | Désactivé |
| Liaisons de déploiement | Désactivé (disponible uniquement lorsque Déploiements est sélectionné) |

**Toujours copiés** : la description, les processus métier, les méthodes d'accès, les cases **Exposition externe**, **Intégration de données / ETL** et **Peut contenir des applications enfants**, et le nombre d'utilisateurs saisi à la main.

**Non copié** (à configurer de zéro) : appartenance à une suite, pièces jointes, dates de la source, dernier test de reprise, revue de classification et affectations d'actifs. L'assistant les liste.

### Migration d'interfaces

Pendant la création de version, l'assistant affiche toutes les interfaces où cette application est source, cible ou middleware (lorsque ETL est activé). Les interfaces sélectionnées sont dupliquées avec leurs références mises à jour vers la nouvelle version. Chaque interface migrée inclut ses legs, responsables, sociétés, identifiants clés, liens, sa résidence des données et sa spécification (le texte de la source et ses images). Un identifiant d'interface vide le reste. Les interfaces migrées démarrent avec un cycle de vie **Proposé**. Les interfaces originales restent liées à l'ancienne version.

**Copie des liaisons** : Si vous sélectionnez à la fois **Déploiements** et **Liaisons de déploiement**, les liaisons d'interfaces sont également copiées. Les liaisons sont mappées vers les déploiements de la nouvelle application (associées par environnement) ; les détails spécifiques à l'environnement (endpoints, authentification, noms de jobs) sont effacés, et le statut de liaison est réinitialisé à **Proposé**.

**Applications ETL/Middleware** : Si l'application a **Intégration de données / ETL** activé, l'assistant affiche également les interfaces qui *transitent par* cette application en tant que middleware. Ce sont des interfaces où une autre source envoie des données vers une autre cible via votre ETL. Les copier crée de nouvelles définitions d'interfaces pour l'ETL mis à niveau, avec les références middleware correctement mises à jour.

**Conseil** : Utilisez cela lors de la mise à niveau de votre ERP ou ETL : migrez les interfaces critiques et copiez optionnellement les liaisons pour prendre de l'avance sur la configuration des environnements.

---

## Copier des applications

Il existe deux façons de copier une application dans KANAP :

### Copier l'élément (depuis la grille Applications)

Utilisez cela lorsque vous souhaitez créer un duplicata indépendant d'une application, typiquement pour créer une entrée d'application similaire sans lignée de version.

1. Sélectionnez une application dans la grille
2. Cliquez sur **Copier l'élément**
3. Le système crée une copie nommée d'après la source, avec un suffixe dans la langue de votre écran : « CRM (copie) », ou « CRM (copy) » en anglais. Si ce nom est déjà pris, la copie est numérotée : « CRM (copie 2) », puis « CRM (copie 3) »
4. Vous êtes redirigé vers la nouvelle application pour effectuer des modifications

**Ce qui est copié** : Tous les champs principaux (sauf la date du dernier test PRA), y compris les valeurs de classification et de continuité, responsables, sociétés, départements, suites, lignes OPEX/CAPEX, contrats, liens, résidence des données et contacts de support. La revue de la copie est réinitialisée.

**Ce qui N'est PAS copié** : Déploiements, interfaces, affectations d'actifs, pièces jointes, champs de version (version, date de mise en production, fin de support).

### Comparaison : Copier l'élément vs Nouvelle version

| Aspect | Copier l'élément | Nouvelle version |
|--------|------------------|---------------------------|
| **Objectif** | Duplicata indépendant | Successeur versionné avec lignée |
| **Options utilisateur** | Aucune (automatique) | Assistant en 3 étapes |
| **Lignée** | Pas de lien prédécesseur | Définit le prédécesseur |
| **Cycle de vie** | Préservé | Réinitialisé à Proposé |
| **Nom** | Suffixe « (copie) », numéroté si le nom est pris | Spécifié par l'utilisateur, doit être libre |

**Relations** :

| Relation | Copier l'élément | Nouvelle version |
|----------|------------------|---------------------------|
| Responsables (métier et IT) | Oui | Optionnel (par défaut : oui) |
| Sociétés (audience) | Oui | Optionnel (par défaut : oui) |
| Départements | Oui | Optionnel (par défaut : oui) |
| Résidence des données | Oui | Optionnel (par défaut : oui) |
| Liens | Oui | Optionnel (par défaut : oui) |
| Contacts de support | Oui | Optionnel (par défaut : oui) |
| Processus métier | Non | Oui |
| Suites (appartenance) | Oui | Non |
| Lignes OPEX | Oui | Optionnel (par défaut : oui) |
| Lignes CAPEX | Oui | Optionnel (par défaut : oui) |
| Contrats | Oui | Optionnel (par défaut : oui) |
| Déploiements | Non | Optionnel (par défaut : non) |
| Liaisons | Non | Optionnel (par défaut : non) |
| Interfaces | Non | Sélectionné par l'utilisateur |
| Affectations d'actifs | Non | Non |
| Pièces jointes | Non | Non |

**Champs principaux** :

| Champ | Copier l'élément | Nouvelle version |
|-------|------------------|---------------------------|
| Description | Oui | Oui |
| Méthodes d'accès | Oui | Oui |
| ETL activé | Oui | Oui |
| Notes de support | Oui | Oui |
| Dernier test PRA | Non | Non |
| Champs de version | Non | Spécifié par l'utilisateur |
| Saisie manuelle utilisateurs | Oui | Oui |
| Année utilisateurs | Oui | Réinitialisé à l'année en cours |

---

## Import/export CSV

Maintenez votre inventaire applicatif à grande échelle grâce à l'import et l'export. Cette fonctionnalité prend en charge les opérations en masse pour le chargement initial de données, les mises à jour périodiques depuis des systèmes externes et l'extraction de données pour le reporting.

### Accéder aux fonctionnalités CSV

Depuis la liste des Applications :
- **Exporter** : Télécharger les applications dans un fichier CSV ou un classeur Excel
- **Importer** : Téléverser un fichier CSV ou un classeur Excel pour créer ou mettre à jour des applications
- **Télécharger le modèle** (depuis la boîte de dialogue d'import) : Obtenir un CSV vierge avec les en-têtes corrects

**Autorisations requises** : `applications:admin` pour les opérations d'import/export.

### Options d'export { #export-options }

**Contenu du fichier** : les applications que la liste affiche. L'export suit les filtres de colonnes, la recherche rapide et le choix **Afficher** (**Mes applications**, **Applications de mon équipe** ou **Toutes les applications**). Le dialogue indique combien d'applications le fichier contiendra. Sans filtre **Cycle de vie**, les applications retirées sont exclues, comme dans la liste. Les lignes gardent l'ordre de la liste.

**Format** : **CSV** ou **Excel (.xlsx)**, choisi dans la fenêtre et mémorisé par votre navigateur. Le classeur contient les mêmes colonnes que le CSV sur une feuille, avec les nombres et les dates en valeurs qu'Excel sait trier et filtrer. L'import lit l'un ou l'autre ; dans un classeur, il lit la première feuille. Voir [Fichiers CSV et Excel](csv-files.md).

**Colonnes** : le fichier commence par `id` et `reference` (`APP-12`), puis les colonnes suivent l'espace de travail, onglet par onglet. L'import ignore `reference`.

**Langue des valeurs** : les valeurs de catalogue (catégorie, cycle de vie, criticité, criticité cyber, vague de reprise, classification des données, méthodes d'accès) et le statut sont écrits comme l'écran les affiche, dans la langue de votre écran : `Active` en anglais, `Actif` en français. Un nom que votre organisation a donné à une valeur dans **Cartographie SI > Paramètres** reste tel quel.

**Préréglages** :

| Préréglage | Description |
|------------|-------------|
| **Export complet** | Tous les champs exportables incluant les données calculées/lecture seule (horodatages, résidence des données, métriques utilisateurs) |
| **Enrichissement de données** | Uniquement les champs importables : idéal pour les flux d'édition aller-retour |

**Export modèle** : Télécharge uniquement les en-têtes, utile pour préparer des fichiers d'import avec la bonne structure. Le modèle inclut tous les champs importables.

**Sélection personnalisée** : Choisissez les champs spécifiques à inclure dans votre export.

### Processus d'import

1. **Préparez votre fichier** : un fichier CSV ou un classeur Excel (`.xlsx`). Enregistrez un fichier CSV en UTF-8. Les virgules et les points-virgules conviennent tous les deux, de même qu'un fichier enregistré par Excel en CSV simple (Windows-1252). Téléchargez un modèle pour vous assurer des bons en-têtes. Le séparateur, les montants, les dates et les oui ou non de chaque langue sont dans [Fichiers CSV et Excel](csv-files.md).

2. **Choisissez les paramètres d'import** :
   - **Mode** :
     - `Enrichir` (par défaut) : Les cellules vides conservent les valeurs existantes : ne mettez à jour que ce que vous spécifiez
     - `Remplacer` : Remplace les valeurs des colonnes du fichier. Une cellule vide efface la valeur enregistrée, sauf dans les colonnes de classification (utilisez `__CLEAR__`). Une colonne absente du fichier garde ses valeurs. Certains champs ne peuvent pas être vidés : la **Vérification préalable** les signale.
   - **Opération** :
     - `Upsert` (par défaut) : Créer de nouvelles applications ou mettre à jour les existantes
     - `Mise à jour uniquement` : Ne modifier que les applications existantes, ignorer les nouvelles
     - `Insertion uniquement` : Ne créer que de nouvelles applications, ignorer les existantes

     L'opération s'applique aussi aux responsables et à la résidence des données : une ligne que l'opération ignore les laisse tels quels.

3. **Validez d'abord** : Cliquez sur **Vérification préalable** pour valider votre fichier sans apporter de modifications. Examinez les erreurs et avertissements.

4. **Appliquez les modifications** : Si la validation réussit, cliquez sur **Importer** pour valider les changements.

### Contrôles des lignes

La vérification préalable applique les mêmes règles que l'espace de travail. Une ligne est refusée quand :

- son nom dépasse 200 caractères, ou une autre application le porte déjà (voir [Noms uniques](#unique-names)) ;
- son nom correspond à deux applications existantes : ajoutez la colonne `id` pour choisir laquelle ;
- sa catégorie ou son cycle de vie ne correspond à aucun code ni à aucun nom du catalogue ;
- un e-mail de responsable ne correspond à aucun utilisateur ;
- sa **Fin de support** ou sa **Date de retrait** précède sa **Mise en production** ;
- `is_suite` vaut `no` pour une suite qui contient encore des applications.

Un fichier avec une seule ligne refusée ne charge rien. Voir [Fichiers CSV et Excel](csv-files.md).

### Référence des champs

**Champs Vue d'ensemble** :

| Colonne CSV | Description | Obligatoire | Notes |
|-------------|-------------|-------------|-------|
| `id` | UUID de l'application | Non | Pour les mises à jour ; laisser vide pour les nouvelles applications |
| `name` | Nom de l'application | Oui | 200 caractères au plus. Sert à retrouver les applications existantes |
| `description` | Ce que fait l'application | Non | |
| `category` | Objectif principal | Non | Accepte un code ou un libellé depuis les Paramètres. Une valeur inconnue fait refuser la ligne |
| `supplier_name` | Nom du fournisseur | Non | Doit correspondre à un fournisseur existant |
| `editor` | Éditeur du logiciel | Non | Texte libre (ex. : Microsoft, SAP) |
| `criticality` | Criticité business | Non | Accepte un code ou un libellé depuis les Paramètres ; `__CLEAR__` l'efface |
| `lifecycle` | Statut actuel | Non | Accepte un code ou un libellé depuis les Paramètres. Une valeur inconnue fait refuser la ligne |
| `is_suite` | Peut avoir des apps enfants | Non | `oui` ou `non` |

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
| `external_facing` | Accessible depuis Internet | `oui` ou `non` |
| `etl_enabled` | Intégration de données | `oui` ou `non` |
| `support_notes` | Informations de support | Texte libre |
| `licensing` | Conditions de licence | Texte libre |
| `notes` | Notes internes | Texte libre |

**Champs de conformité** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `data_class` | Classification des données | Accepte un code ou un libellé depuis les Paramètres |
| `last_dr_test` | Date du dernier test PRA | Format de date : YYYY-MM-DD |
| `contains_pii` | Stocke des données personnelles | `oui` ou `non` |
| `data_residency` | Pays de stockage des données | Codes pays ISO séparés par des virgules (ex. `FR,DE`). En mode `Enrichir`, une cellule vide conserve les pays |

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
| `business_owner_email_1` à `_4` | E-mails des responsables métier | Doivent correspondre à l'e-mail d'un utilisateur existant. Un e-mail inconnu fait refuser la ligne |
| `it_owner_email_1` à `_4` | E-mails des responsables IT | Doivent correspondre à l'e-mail d'un utilisateur existant. Un e-mail inconnu fait refuser la ligne |

En mode `Enrichir`, quand toutes les cellules de responsables d'un type sont vides, l'application conserve ses responsables de ce type.

**Champs en export uniquement** (inclus dans Export complet mais non importables) :

| Colonne CSV | Description |
|-------------|-------------|
| `status` | Activé ou désactivé, dans la langue de votre écran. Se modifie sur l'application elle-même |
| `users_mode` | Méthode de comptage des utilisateurs (`manual`, `it_users`, `headcount`) |
| `users_year` | Année de référence pour les calculs d'utilisateurs |
| `users_override` | Saisie manuelle du nombre d'utilisateurs |
| `created_at` | Horodatage de création de l'enregistrement |
| `updated_at` | Horodatage de la dernière modification |
| `vulnerabilities_to_review` | Vulnérabilités encore à traiter, comptées comme dans la colonne de la liste. Vide pour une application désactivée |
| `severe_vulnerabilities` | Parmi elles, les critiques ou élevées. Vide pour une application désactivée |

Les deux colonnes de vulnérabilités sont absentes quand les vulnérabilités ne sont pas suivies. L'import les ignore.

### Acceptation des libellés et codes

Pour les champs configurés dans **Cartographie SI > Paramètres**, vous pouvez utiliser soit le code interne, soit le libellé d'affichage :

| Champ | Exemples de codes | Exemples de libellés |
|-------|-------------------|----------------------|
| Catégorie | `lob`, `productivity`, `security` | `Métier`, `Productivité`, `Sécurité` |
| Cycle de vie | `active`, `proposed`, `deprecated` | `Actif`, `Proposé`, `Obsolète` |
| Classification données | `public`, `internal`, `confidential` | `Public`, `Interne`, `Confidentiel` |

Le système normalise automatiquement les valeurs lors de l'import, donc `Métier`, `metier` et `lob` se résolvent tous vers la même catégorie. Les libellés affichés à l'écran sont acceptés en anglais, en français, en allemand et en espagnol : `Active`, `Actif`, `Aktiv` et `Activo` désignent le même cycle de vie. Un fichier exporté dans une langue s'importe donc dans une autre.

### Correspondance et mises à jour

Les applications sont identifiées par **nom**, sans tenir compte des majuscules et des minuscules ni des espaces au début et à la fin. Lorsqu'une correspondance est trouvée :
- En mode `Enrichir` : Seules les valeurs CSV non vides mettent à jour l'application
- En mode `Remplacer` : Les colonnes du fichier sont mises à jour, et une cellule vide efface la valeur enregistrée. Les colonnes absentes du fichier gardent leurs valeurs. Une cellule de classification vide garde sa valeur, et `__CLEAR__` l'efface. Le nom, l'`id`, le cycle de vie et les champs obligatoires ne peuvent pas être vidés : la **Vérification préalable** signale une erreur sur la ligne. Une nouvelle application reçoit les valeurs par défaut.

Si vous incluez la colonne `id` avec un UUID valide, la correspondance utilise d'abord l'ID, puis se rabat sur le nom. Quand deux applications existantes portent le nom d'une ligne, la ligne est refusée : ajoutez la colonne `id` pour choisir laquelle.

Une ligne retrouvée par son `id` avec un autre nom renomme l'application. Le nouveau nom doit être libre. Le titre du document de description de l'application suit le nouveau nom.

### Limitations

- **Déploiements non inclus** : Les déploiements d'environnement (Prod, QA, Dev) nécessitent une configuration dans l'espace de travail
- **Affectations de serveurs exclues** : Les liaisons serveur doivent être configurées dans l'onglet Déploiements
- **Interfaces exclues** : Les définitions d'intégration ne font pas partie de l'import et de l'export
- **Maximum 4 responsables par type** : Jusqu'à 4 responsables métier et 4 responsables IT peuvent être importés/exportés
- **Métriques utilisateurs en export uniquement** : Les champs d'audience et de comptage d'utilisateurs (`users_mode`, `users_year`, `users_override`) sont gérés dans l'espace de travail
- **Statut en export uniquement** : Activez ou désactivez une application dans son espace de travail

### Résolution de problèmes

**Erreur « Le fichier n'est pas correctement formaté »** : Cela indique généralement un problème d'encodage. Assurez-vous que votre CSV est enregistré en **UTF-8** :

- **Dans LibreOffice** : Lors de l'ouverture d'un CSV, sélectionnez `UTF-8` dans le menu déroulant Jeu de caractères (pas « Japanese (Macintosh) » ni d'autres encodages). Lors de l'enregistrement, cochez « Modifier les paramètres de filtre » et choisissez UTF-8.
- **Dans Excel** : Enregistrer sous > CSV UTF-8 (délimité par des virgules).
- **Conseil général** : Si vous voyez des caractères illisibles (`?¿`, `ï»¿`) au début de votre fichier, l'encodage est incorrect.

### Exemple CSV

```csv
name;category;supplier_name;criticality;lifecycle;go_live_date;external_facing
Salesforce CRM;Line-of-business;Salesforce Inc;Critical;Active;2020-01-15;true
Microsoft 365;Productivity;Microsoft;high;active;2019-06-01;false
Custom ERP;lob;;Moderate;Active;2018-03-20;false
```

---

## Demander à l'assistant

[Plaid](ai-assistant.md) lit la version, la date de mise en service, la date de fin de support et la date de retrait de chaque application. Il filtre, trie et regroupe les applications selon ces dates. Sa liste garde les applications retirées, alors que le rapport [Fins de support](end-of-support.md) ne garde que celles en service.

Plaid déclare aussi une technologie sur une application, ou la retire, avec sa version et, si vous le demandez, sur les serveurs de déploiement de l'application. Il faut pour cela le droit de lire les applications et le niveau Membre sur l'infrastructure. Un Business Contributor ne le fait que sur les applications auxquelles il participe. Plaid ne lie pas un système d'exploitation : renseignez-le sur la page du serveur. Chaque modification arrive sous forme d'aperçu que vous approuvez. Quand vous demandez à Plaid de l'annuler, il remet exactement ce qu'il a changé. Une version créée au passage reste sur la technologie.

Demandez par exemple : « Ajoute PostgreSQL 16 à CheeseTrack et à ses serveurs », « Retire PostgreSQL 14 de CheeseTrack », « Quelles applications arrivent en fin de support dans les six mois ? » ou « Quelles applications déclarent PostgreSQL 14 ? »

---

## Conseils

- **Commencez par les apps critiques** : Documentez d'abord vos applications critiques pour le métier, puis descendez dans les niveaux de criticité.
- **Utilisez les suites pour regrouper** : Activez « Peut avoir des apps enfants » dans l'onglet Exploitation pour marquer une application comme une Suite qui regroupe les composants liés (ex. : modules SAP sous une Suite SAP).
- **Liez aux dépenses tôt** : Connectez les lignes OPEX, CAPEX et contrats dans l'onglet Relations pour voir l'image complète des coûts pour chaque application.
- **Maintenez les déploiements à jour** : L'onglet Déploiements alimente les pastilles d'environnement dans la liste : maintenez-le à jour pour une visibilité précise.
- **Documentez l'audience** : Définissez les audiences société et département dans le tiroir des propriétés ; le nombre d'utilisateurs est alors dérivé automatiquement et utilisé dans les rapports.
- **Exploitez le filtrage par catégorie** : Utilisez le filtre de la colonne Catégorie pour vous concentrer sur des types d'applications spécifiques (ex. : afficher uniquement les apps Métier, ou exclure les outils de Productivité).
- **Attachez les connaissances tôt** : Liez les runbooks et les documents d'architecture depuis l'onglet Vue d'ensemble pour que l'équipe sache où chercher lors des incidents.
- **Liez les tâches depuis l'un ou l'autre côté** : Ajoutez une tâche depuis Relations > Tâches, ou définissez le champ App / Service sur la tâche elle-même ; les deux affichent le même lien.
