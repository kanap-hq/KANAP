# Modèle de données du budget

Cette page décrit comment KANAP organise les données budgétaires : les objets, leurs relations, les champs qui identifient un enregistrement et les fichiers qui font entrer et sortir chaque objet. Elle s'adresse aux contrôleurs de gestion et aux administrateurs du budget qui préparent un passage depuis des tableurs ou un autre outil, et à l'équipe technique qui branche un outil de BI sur une installation on-premise.

Les fichiers décrits ici sont le contrat sur lequel s'appuyer. Leurs colonnes sont documentées dans ce manuel et vérifiées à l'import, et quand une disposition change, un import refuse un fichier à l'ancienne disposition et en donne la raison. Les tables de la base de données derrière eux sont internes : elles changent quand KANAP évolue. Appuyez un passage depuis un autre outil, et toute intégration, sur les fichiers.

## Les objets en un coup d'œil

| Objet | Ce qu'il contient | Où le gérer |
|---|---|---|
| **Poste OPEX** | Un coût récurrent, reporté d'une année sur l'autre | **Gestion budgétaire > OPEX** |
| **Poste CAPEX** | Un investissement, reporté d'une année sur l'autre | **Gestion budgétaire > CAPEX** |
| **Colonnes budgétaires** | Les cinq colonnes de montants que chaque poste a pour chaque année | **Gestion budgétaire > Administration > Colonnes budgétaires** |
| **Lignes Quantité et prix** | Les lignes à partir desquelles une colonne peut être calculée | L'onglet **Budget** d'un poste |
| **Ventilation** | La répartition du coût d'une année d'un poste entre sociétés ou départements | L'onglet **Ventilations** d'un poste |
| **Société** | Une entité juridique qui paie, avec ses indicateurs annuels | **Données de référence > Sociétés** |
| **Département** | Une unité d'une société, avec son effectif annuel | **Données de référence > Départements** |
| **Plan comptable** et **compte** | Les comptes sur lesquels une société impute ses postes | **Données de référence > Plans comptables** |
| **Centre de coûts** | Qui porte la dépense, dans une arborescence de groupes | **Données de référence > Centres de coûts** |
| **Fournisseur** | Qui est payé | **Données de référence > Fournisseurs** |
| **Dimension analytique** et **valeur** | Des classifications libres pour le reporting | **Données de référence > Dimensions analytiques** |
| **Calendrier de jours ouvrés** | Les jours ouvrés par mois et par année, pour les prix par jour | **Données de référence > Calendriers de jours ouvrés** |
| **Utilisateur** | Responsables IT et métier, responsables budgétaires | **Administration > Utilisateurs** |
| **Devises** | Devises autorisées, devise de reporting, taux de change | **Gestion budgétaire > Administration > Devises** |

## Les relations entre les objets

| Objet | Fait référence à | Combien |
|---|---|---|
| Poste OPEX ou CAPEX | Société payeuse | Une |
| | Compte, dans le plan comptable de la société payeuse | Un |
| | Devise, parmi les devises autorisées | Une |
| | Centre de coûts | Zéro ou un. Un groupe ne peut pas être utilisé |
| | Fournisseur | Zéro ou un |
| | Valeur de chaque dimension analytique active | Zéro ou une par dimension |
| | Responsable IT et responsable métier (utilisateurs) | Zéro ou un chacun |
| | Années budgétaires | Une par année |
| Année budgétaire d'un poste | Colonnes budgétaires | Cinq, chacune avec douze montants mensuels |
| | Lignes Quantité et prix | Jusqu'à 50 par colonne |
| | Ventilation | Une méthode, avec ses sociétés ou ses départements |
| Ligne Quantité et prix avec un prix par jour | Calendrier de jours ouvrés | Un |
| Centre de coûts | Société | Une |
| | Responsable budgétaire (utilisateur) | Zéro ou un |
| | Groupe parent | Zéro ou un |
| Groupe de centres de coûts | Groupe parent | Zéro ou un. Un groupe n'a pas de société |
| Société | Plan comptable | Un. Une société sans plan propre utilise le plan global par défaut |
| | Pays et devise de base | Un de chaque |
| | Indicateurs : effectif, utilisateurs IT, chiffre d'affaires | Un jeu par année |
| Département | Société | Une |
| Compte | Plan comptable | Un |
| Valeur analytique | Dimension analytique | Une |

Un poste se lie aussi à des projets, des demandes, des applications, des actifs, des contrats, des contacts, des tâches, des sites web et des pièces jointes. Voir [Liens vers d'autres objets](#liens-vers-dautres-objets).

## Les postes budgétaires

### Postes OPEX et CAPEX

Un poste vit sur plusieurs années : une licence sur trois ans est un poste avec trois années budgétaires. KANAP donne un numéro à chaque poste à sa création : `OPX-12` pour l'OPEX, `CPX-3` pour le CAPEX. Le numéro identifie le poste dans le fichier budgétaire.

| Champ | Colonne du fichier budgétaire | Obligatoire | Remarques |
|---|---|---|---|
| Numéro | `item_number` | Attribué par KANAP | Vide dans le fichier : crée un poste |
| Nom du produit (OPEX), titre (CAPEX) | `name` | Oui | |
| Description (OPEX) | `description` | Non | |
| Type d'immobilisation (CAPEX) | `ppe_type` | Oui | `hardware` ou `software` |
| Type d'investissement (CAPEX) | `investment_type` | Oui | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` ou `other` |
| Priorité (CAPEX) | `priority` | Oui | `mandatory`, `high`, `medium` ou `low` |
| Société payeuse | `company_name` | Oui | Reprise du centre de coûts quand seul le centre de coûts est donné |
| Fournisseur | `supplier_name`, `supplier_erp_id` | Non | |
| Compte | `account_number` | Oui | Dans le plan comptable de la société payeuse |
| Centre de coûts | `cost_center_code` | Non | Un groupe est refusé |
| Run ou build | `run_build` | Non | `run` ou `build` |
| Valeurs analytiques | `analytics:<code>` | Non | Une colonne par dimension active |
| Responsable IT, responsable métier | `owner_it_email`, `owner_business_email` | Non | Utilisateurs actifs |
| Projet | `project` | Non | Un numéro de projet, par exemple `PRJ-3` |
| Devise | `currency` | Oui | Code ISO à trois lettres |
| Début d'effet | `effective_start` | Oui | Dans un fichier, le 1er janvier de la première année portant un montant dans la ligne, sinon de l'année en cours |
| Fin de validité | `end_of_validity` | Non | La seule date de fin d'un poste |
| Notes | `notes` | Non | |

Un poste n'a pas de statut à charger. Il est actif jusqu'à sa fin de validité, puis désactivé dans l'heure. Le responsable budgétaire affiché sur un poste vient de son centre de coûts et n'est pas enregistré sur le poste.

### Années budgétaires

Chaque poste porte un budget par année. L'onglet **Budget** affiche l'année en cours, les deux années précédentes et les deux suivantes. Un fichier budgétaire peut exporter jusqu'à douze années à la fois.

Une année budgétaire contient les cinq colonnes budgétaires avec leurs montants mensuels, les lignes Quantité et prix de chaque colonne et la ventilation de l'année.

### Colonnes budgétaires

Chaque poste a les mêmes cinq colonnes pour chaque année. Elles sont définies une fois pour toute l'organisation, pour l'OPEX comme pour le CAPEX.

| Position | Nom standard | Nom dans les fichiers |
|---|---|---|
| 1 | Budget | `budget` |
| 2 | Révision | `revision` |
| 3 | Prévision (masquée par défaut) | `forecast` |
| 4 | Réalisé | `actual` |
| 5 | Atterrissage prévu | `landing` |

- Un administrateur du budget peut renommer une colonne (jusqu'à 40 caractères), la masquer et choisir la colonne par défaut. Le nom dans les fichiers reste le même : un fichier continue de fonctionner après un renommage. Voir [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires).
- Une colonne masquée garde ses montants et accepte toujours les imports.
- Les colonnes sont gelées par année, par colonne et par périmètre (OPEX ou CAPEX). Une colonne gelée refuse les modifications, les imports, les copies et les réinitialisations. Voir [Geler / Dégeler les données](budget-operations.md#geler-degeler-les-donnees).

Il n'y a pas de sixième colonne. Pour conserver plusieurs tours budgétaires, utilisez une colonne par tour, ou copiez une colonne vers une autre année ou une autre colonne avec [Copier les colonnes budgétaires](budget-operations.md#copier-les-colonnes-budgetaires).

### Montants mensuels

Chaque colonne d'une année budgétaire contient douze montants mensuels, à deux décimales, dans la devise du poste. Le total annuel est la somme des mois. Un fichier peut porter le total annuel ou les douze mois d'une colonne : un total annuel est réparti sur la période de la colonne, comme dans l'onglet **Budget**.

Chaque colonne enregistre aussi sa période dans l'année et l'origine de ses montants : une répartition, une copie, une saisie à la main ou ses lignes Quantité et prix. Les rapports convertissent les montants dans la devise de reporting avec les taux de change de l'année. Voir [Paramètres de devises](currencies.md).

### Lignes Quantité et prix

Une colonne peut être calculée à partir de lignes, chacune une quantité multipliée par un prix unitaire. Chaque ligne a une description (jusqu'à 200 caractères), une quantité (jusqu'à 3 décimales), une unité (**personnes**, **jours** ou **pièces**), un prix unitaire (jusqu'à 4 décimales), une fréquence, une période ou une date, et un calendrier de jours ouvrés quand le prix est par jour. L'ETP de la colonne est déduit des lignes. Voir [Quantité et prix](opex.md#quantite-et-prix).

Ces lignes se saisissent dans l'onglet **Budget**. Aucun fichier ne les porte. Un fichier budgétaire écrit les montants mensuels d'une colonne, et les lignes restent avec elle comme référence.

### Ventilations

Chaque année budgétaire d'un poste a une méthode de ventilation :

| Méthode | Répartition selon |
|---|---|
| Par défaut | La méthode par défaut de l'organisation pour l'année, définie dans [Méthode de ventilation par défaut](budget-operations.md#methode-de-ventilation-par-defaut) |
| Effectif, Utilisateurs IT, Chiffre d'affaires | Les indicateurs des sociétés pour l'année |
| Manuel par société | Un indicateur, entre les sociétés que vous choisissez |
| Manuel par département | L'effectif des départements que vous choisissez |
| Pourcentages manuels | Les pourcentages que vous saisissez, dont la somme fait 100 % |

Les ventilations alimentent les rapports de refacturation. Aucun fichier ne les importe. [Copier les ventilations](budget-operations.md#copier-les-ventilations) les reporte d'une année sur la suivante, et les rapports de refacturation exportent leurs tableaux en CSV. Voir [Rapports](reports.md).

### Liens vers d'autres objets

| Lien | Où il se crée | Dans un fichier |
|---|---|---|
| Projets | L'onglet **Relations** du poste, ou du projet | Le fichier budgétaire porte un projet par poste dans `project`. Les liens de l'onglet **Relations** ne sont pas dans le fichier. Les listes affichent les deux |
| Demandes | L'onglet **Relations** de la demande | Non |
| Applications | L'onglet **Relations** du poste, ou de l'application | Non |
| Actifs | L'onglet **Relations** de l'actif | Non |
| Contrats | L'onglet **Relations** du poste, ou du contrat | Non |
| Contacts, sites web, pièces jointes | L'onglet **Relations** du poste | Non |
| Tâches | L'onglet **Vue d'ensemble** du poste | Non |

## Données de référence

Le fichier budgétaire retrouve les données de référence par des identifiants métier. Chargez d'abord les données de référence. Le fichier budgétaire crée les fournisseurs manquants quand **Créer les fournisseurs manquants** est cochée, ainsi que les valeurs analytiques manquantes. Il ne crée rien d'autre.

| Objet | Identifié dans les fichiers par | Obligatoire | Sur un poste budgétaire |
|---|---|---|---|
| Société | `name` | Nom, pays, devise de base. L'écran demande aussi une ville | `company_name` |
| Département | `company_name` et `name` | Société, nom | Utilisé par les ventilations |
| Plan comptable | Son code (`coa_code` dans le fichier des comptes) | Code, nom, portée | Par la société payeuse |
| Compte | `account_number` dans son plan (`coa_code` dans le fichier global) | Numéro, nom | `account_number` |
| Centre de coûts | `code`, sans tenir compte de la casse | Code, nom, type, et la société d'un centre de coûts | `cost_center_code` |
| Fournisseur | `name` | Nom | `supplier_erp_id`, puis `supplier_name` |
| Dimension analytique | Son code | Code | L'en-tête de colonne `analytics:<code>` |
| Valeur analytique | `axis_code` et `name` | Nom | La cellule de la colonne de sa dimension |
| Calendrier de jours ouvrés | `code`, sans tenir compte de la casse | Code, nom | Utilisé par les lignes Quantité et prix |
| Utilisateur | `email` | E-mail | `owner_it_email`, `owner_business_email` |

Les points qui comptent quand vous faites correspondre un autre outil à KANAP :

- **Les sociétés** portent leur effectif, leurs utilisateurs IT et leur chiffre d'affaires par année. Le chiffre d'affaires est en millions de la devise de base de la société. Les ventilations par effectif, utilisateurs IT ou chiffre d'affaires ont besoin des indicateurs de l'année.
- **Les comptes** appartiennent à un plan comptable, et une société utilise un plan. Un numéro de compte est un nombre entier, unique dans son plan. Le compte d'un poste budgétaire doit exister dans le plan de sa société payeuse. Voir [Plans comptables et gestion des comptes](chart-of-accounts.md).
- **Les centres de coûts** forment une arborescence. Un groupe rassemble des centres de coûts et d'autres groupes, et peut couvrir plusieurs sociétés. Un centre de coûts appartient à une société, n'a pas d'enfants et est le seul nœud qu'un poste peut utiliser. Son responsable budgétaire s'affiche sur chaque poste qu'il porte. Voir [Centres de coûts](cost-centers.md).
- **Les fournisseurs** sont mis en correspondance par leur nom dans leur propre fichier. Le fichier budgétaire les retrouve d'abord par l'ID ERP, puis par le nom : renseignez l'ID ERP quand votre ERP en a un.
- **Les dimensions analytiques** se créent sur leur page, chacune avec un code. Un poste porte au plus une valeur par dimension. Voir [Dimensions analytiques](analytics.md).
- **Les calendriers de jours ouvrés** sont standard (ils suivent les jours fériés d'un pays) ou personnalisés. Ils contiennent les jours ouvrés de chaque mois, année par année. Voir [Calendriers de jours ouvrés](working-day-calendars.md).
- **Les devises** sont des codes ISO à trois lettres. Les devises autorisées, la devise de reporting et les taux de change se règlent à l'écran et n'ont pas de fichier.

## Formats d'échange

Chaque fichier ci-dessous s'exporte et s'importe depuis la page qui gère l'objet. Les imports se font en deux étapes : une vérification qui n'écrit rien, puis un chargement. À l'exception du fichier des contrats, ils partagent les règles d'encodage, de séparateur, de dates et de montants et la limite de taille décrites dans [Fichiers CSV](csv-files.md).

| Objet | Export | Import | Correspondance par | Détails |
|---|---|---|---|---|
| Postes OPEX et leurs montants | Oui | Oui | `item_number` | [Charger un budget depuis un tableur](budget-file.md) |
| Postes CAPEX et leurs montants | Oui | Oui | `item_number` | [Charger un budget depuis un tableur](budget-file.md) |
| Sociétés et leurs indicateurs | Oui | Oui | `name` | [Sociétés](companies.md) |
| Départements | Oui | Oui | `company_name` et `name` | [Départements](departments.md) |
| Comptes | Oui | Oui | `account_number` dans le plan | [Plans comptables et gestion des comptes](chart-of-accounts.md) |
| Plans comptables | Non | Non | | Créés sur la page ou depuis un modèle. Voir [Plans comptables et gestion des comptes](chart-of-accounts.md) |
| Centres de coûts | Oui | Oui | `code` | [Centres de coûts](cost-centers.md) |
| Fournisseurs | Oui | Oui | `name` | [Fournisseurs](suppliers.md) |
| Valeurs analytiques | Oui | Oui | `axis_code` et `name` | [Dimensions analytiques](analytics.md) |
| Calendriers de jours ouvrés | Oui | Oui | `code`, une ligne par calendrier et par année | [Calendriers de jours ouvrés](working-day-calendars.md) |
| Utilisateurs | Oui | Oui | `email` | [Fichier CSV des utilisateurs](admin.md#fichier-csv-des-utilisateurs) |
| Contrats | Oui | Oui | `name` et `supplier_name` | [Contrats](contracts.md). Le fichier ne porte pas les liens vers les postes budgétaires |
| Ventilations | Depuis les rapports de refacturation | Non | | [Rapports](reports.md) |
| Lignes Quantité et prix, paramètres des colonnes budgétaires, gels, devises | Non | Non | | Réglés à l'écran |

Le fichier budgétaire lit et écrit les montants de n'importe quelle colonne et année, en totaux annuels ou en mois, avec le détail du poste sur la même ligne. C'est la porte d'entrée d'un budget préparé ailleurs et la porte de sortie vers un tableur ou un outil de BI. Chaque liste budgétaire exporte et importe son propre fichier : le fichier OPEX depuis **Gestion budgétaire > OPEX**, le fichier CAPEX depuis **Gestion budgétaire > CAPEX**.

### Faire entrer un budget dans KANAP

1. Faites correspondre chaque objet de votre outil actuel aux tableaux ci-dessus, et ses identifiants à la colonne **Correspondance par**.
2. Chargez les données de référence dans l'ordre donné dans [Charger un budget complet](budget-file.md#charger-un-budget-complet).
3. Exportez le fichier OPEX et le fichier CAPEX pour obtenir la ligne d'en-tête de votre organisation, avec une colonne par dimension analytique. Une liste sans poste exporte la ligne d'en-tête seule.
4. Remplissez une ligne par poste, en laissant `item_number` vide, avec une colonne de montant par colonne budgétaire et par année (`budget_2027`), ou par mois (`budget_2027_03`).
5. Importez les fichiers. La vérification signale les erreurs par ligne du fichier, et rien n'est écrit avant le chargement.

Un jeu cohérent de fichiers d'exemple, avec une société fictive et ses données de référence, se trouve dans le [dépôt KANAP](https://github.com/kanap-it/KANAP/tree/main/doc/samples).

## Lire les données directement

Sur une installation on-premise, la base PostgreSQL vous appartient : KANAP tourne sur la base que vous fournissez. Vous pouvez la lire, la sauvegarder et y brancher des outils.

Avant de le faire, gardez trois points en tête.

**La sécurité au niveau des lignes filtre chaque lecture.** KANAP se connecte avec un rôle applicatif dédié qui ne peut pas contourner la sécurité au niveau des lignes. Il refuse de démarrer avec un rôle superutilisateur ou un rôle qui la contourne. Chaque table qui contient vos données ne montre ses lignes qu'à une session qui a indiqué l'espace de travail qu'elle lit. Une session qui ne l'a pas indiqué obtient des résultats vides, sans erreur.

**Les tables sont internes.** Leurs noms, leurs colonnes et leur stockage changent d'une version à l'autre, par les migrations qui s'exécutent à chaque mise à jour. Les noms de colonnes en base sont des clés de stockage et diffèrent des noms affichés à l'écran et dans les fichiers. Une requête écrite sur les tables d'aujourd'hui peut renvoyer des résultats faux ou vides après une mise à jour.

**Vos objets peuvent bloquer une mise à jour.** PostgreSQL refuse de modifier ou de supprimer une colonne dont dépend une vue. Une vue créée sur les tables de KANAP peut faire échouer une mise à jour. Gardez vos requêtes dans l'outil de BI ou dans une base de reporting séparée.

Pour un outil de BI, utilisez d'abord les exports. Le fichier budgétaire et les fichiers des données de référence portent des noms et des identifiants métier, documentés dans ce manuel.

Quand un outil doit lire la base, donnez-lui son propre rôle en lecture seule. Ne réutilisez jamais le rôle applicatif. Par exemple, en tant qu'administrateur PostgreSQL, avec `kanap` comme rôle applicatif et comme base :

```sql
-- The workspace of this installation
SELECT id FROM tenants;

CREATE ROLE kanap_bi LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE kanap TO kanap_bi;
GRANT USAGE ON SCHEMA public TO kanap_bi;
GRANT SELECT ON spend_items, capex_items, companies, accounts TO kanap_bi;
ALTER ROLE kanap_bi IN DATABASE kanap SET app.current_tenant = '<id from the first query>';
```

N'accordez `SELECT` que sur les tables dont vos rapports ont besoin. La base contient aussi des comptes utilisateurs, des données de connexion et des paramètres dont un outil de reporting n'a pas l'usage. Vérifiez les droits et les requêtes après chaque mise à jour.
