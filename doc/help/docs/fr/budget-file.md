# Charger un budget depuis un tableur

La plupart des équipes préparent leur budget dans un tableur : une ligne par poste, une colonne par année ou par mois. KANAP conserve les mêmes postes dans ses listes OPEX et CAPEX, où ils alimentent les ventilations, les rapports et la vue d'ensemble.

Le fichier budgétaire fait le lien entre les deux. Exportez les postes, modifiez les cellules qui vous intéressent dans Excel ou LibreOffice, puis importez le fichier. KANAP compare chaque cellule avec ce qu'il contient et n'écrit que ce qui a changé.

Il y a un fichier par liste. La liste OPEX exporte et importe le fichier OPEX, la liste CAPEX le fichier CAPEX. Les deux fichiers portent les mêmes colonnes et suivent les mêmes règles.

## Où la trouver

- Chemin : **Gestion budgétaire > OPEX**, ou **Gestion budgétaire > CAPEX**
- Export : **Exporter CSV** dans la barre d'outils de la liste
- Import : **Importer CSV** dans la même barre d'outils
- Autorisations : les deux boutons demandent des droits d'administration sur cette liste (`opex:admin` ou `capex:admin`)

## Export

1. Cliquez sur **Exporter CSV** dans la liste OPEX ou CAPEX.
2. Choisissez ce que le fichier contient :

| Réglage | Effet |
|---|---|
| **Postes** | Les postes affichés par la liste, avec sa recherche, ses filtres et sa portée de statut. **Tous les postes** exporte tous les postes à la place, y compris les postes terminés, sans les filtres de la liste |
| **Années** | **Première année** et **Dernière année**, jusqu'à douze années. Par défaut : l'année en cours, la précédente et la suivante |
| **Colonnes** | Les colonnes budgétaires à écrire. Les colonnes que votre organisation affiche sont cochées, et une colonne masquée est marquée **masquée**. Son en-tête est indiqué sous le nom, par exemple `budget_2027` |
| **Détail** | **Totaux annuels** : une colonne par colonne budgétaire et par année. **Mois** : une colonne par colonne budgétaire, année et mois |

3. Cliquez sur le bouton en bas de la fenêtre. Il nomme ce que le fichier contiendra : **Exporter 120 postes filtrés**, **Exporter tous les postes**, **Exporter 3 412 postes**, etc.

Le fichier est écrit dans la langue d'affichage de l'écran.

| Langue | Séparateur | Montants | Dates |
|---|---|---|---|
| Anglais | `,` | `12280.50` | `2027-03-01` |
| Français, espagnol | `;` | `12280,50` | `01/03/2027` |
| Allemand | `;` | `12280,50` | `01.03.2027` |

Exporter une liste sans poste donne la seule ligne d'en-tête. C'est votre modèle.

## Les colonnes

Un fichier contient une ligne par poste : les colonnes de détail, puis les colonnes de montants, puis `kanap_token`.

### Colonnes de détail

Elles sont identiques dans les deux fichiers, sauf les colonnes propres au type en début de ligne.

**OPEX**

| Colonne | Contenu | Sur un nouveau poste |
|---|---|---|
| `item_number` | Le numéro du poste : `OPX-12` ou `12` | Vide : la ligne ajoute un poste |
| `name` | Nom du produit | Obligatoire |
| `description` | La description longue | Facultative |
| `company_name` | Société payeuse | Obligatoire sauf si le poste a un centre de coûts |
| `supplier_name` | Nom du fournisseur | Facultatif |
| `supplier_erp_id` | L'ID du fournisseur dans votre ERP | Facultatif |
| `account_number` | Numéro de compte, dans le plan comptable de la société payeuse | Obligatoire |
| `cost_center_code` | Code du centre de coûts. Un groupe est refusé | Facultatif |
| `run_build` | `run` ou `build` | Facultatif |
| `analytics:<code>` | Le nom de la valeur dans la dimension dont c'est le code. Une colonne par dimension, dimension par défaut incluse | Facultatif. Une valeur inexistante est créée par le chargement |
| `owner_it_email` | E-mail d'un utilisateur actif | Facultatif |
| `owner_business_email` | E-mail d'un utilisateur actif | Facultatif |
| `project` | Numéro de projet, par exemple `PRJ-3` | Facultatif |
| `currency` | Code ISO à trois lettres, parmi les devises autorisées dans votre espace de travail | Obligatoire |
| `effective_start` | Le jour où le poste commence | Le 1er janvier de la première année portant un montant sur la ligne, sinon de l'année en cours |
| `end_of_validity` | Le jour où le poste s'arrête | Aucune fin |
| `notes` | Texte libre | Facultatif |

**CAPEX**

| Colonne | Contenu | Sur un nouveau poste |
|---|---|---|
| `item_number` | Le numéro du poste : `CPX-3` ou `3` | Vide : la ligne ajoute un poste |
| `name` | Le titre de l'investissement | Obligatoire |
| `ppe_type` | `hardware` ou `software` | Obligatoire |
| `investment_type` | `replacement`, `capacity`, `productivity`, `security`, `conformity`, `business_growth` ou `other` | Obligatoire |
| `priority` | `mandatory`, `high`, `medium` ou `low` | Obligatoire |
| `company_name` | Société payeuse | Obligatoire sauf si le poste a un centre de coûts |
| `supplier_name` | Nom du fournisseur | Facultatif |
| `supplier_erp_id` | L'ID du fournisseur dans votre ERP | Facultatif |
| `account_number` | Numéro de compte, dans le plan comptable de la société payeuse | Obligatoire |
| `cost_center_code` | Code du centre de coûts. Un groupe est refusé | Facultatif |
| `run_build` | `run` ou `build` | Facultatif |
| `analytics:<code>` | Le nom de la valeur dans la dimension dont c'est le code. Une colonne par dimension, dimension par défaut incluse | Facultatif. Une valeur inexistante est créée par le chargement |
| `owner_it_email` | E-mail d'un utilisateur actif | Facultatif |
| `owner_business_email` | E-mail d'un utilisateur actif | Facultatif |
| `project` | Numéro de projet, par exemple `PRJ-3` | Facultatif |
| `currency` | Code ISO à trois lettres, parmi les devises autorisées dans votre espace de travail | Obligatoire |
| `effective_start` | Le jour où le poste commence | Le 1er janvier de la première année portant un montant sur la ligne, sinon de l'année en cours |
| `end_of_validity` | Le jour où le poste s'arrête | Aucune fin |
| `notes` | Texte libre | Facultatif |

### Colonnes de montants

Une colonne de montant porte le nom de la colonne budgétaire et l'année : `budget_2027`. Avec le détail **Mois**, le mois s'ajoute : `budget_2027_03`.

| Nom dans le fichier | La colonne dans l'application |
|---|---|
| `budget` | La première colonne, nommée Budget par défaut |
| `revision` | La deuxième colonne, nommée Révision par défaut |
| `forecast` | La troisième colonne, nommée Prévision par défaut |
| `actual` | La quatrième colonne, nommée Réalisé par défaut |
| `landing` | La cinquième colonne, nommée Atterrissage prévu par défaut |

Ce sont les noms standard. Votre organisation peut renommer les cinq colonnes dans [Colonnes budgétaires](budget-operations.md#colonnes-budgetaires), en masquer certaines et choisir une colonne par défaut. Le fichier écrit toujours le nom technique ci-dessus, quels que soient les noms affichés à l'écran.

### La dernière colonne

`kanap_token` est écrit par KANAP. Laissez-le tel quel. KANAP s'en sert pour vous dire qu'un poste a changé après votre export. Laissez-le vide sur une ligne que vous ajoutez.

## Ce que signifie une cellule

- Une cellule vide conserve la valeur enregistrée.
- `-` efface un détail du poste : description, notes, nom et ID ERP du fournisseur, centre de coûts, run ou build, une valeur de dimension, un responsable, le projet, la fin de validité. Sur une colonne qu'un nouveau poste doit remplir, `-` est une erreur de ligne.
- `0` écrit zéro.
- Un total annuel égal au total enregistré n'écrit rien. Un total différent est réparti sur la période de la colonne, exactement comme lorsque vous saisissez le total dans l'onglet **Budget**.
- Une cellule de mois écrit ce mois, et marque la colonne comme modifiée à la main, comme un mois saisi dans l'onglet **Budget**.
- Un montant a au plus deux décimales. Une cellule de montant ne s'efface pas avec `-` : écrivez `0`, ou laissez la cellule vide.
- Un fichier peut contenir le total annuel d'une colonne et d'une année, ou ses douze mois, jamais les deux.

Une colonne absente conserve toutes les valeurs enregistrées de cette colonne. Un fichier qui ne contient que `item_number` et quelques colonnes de montants est un fichier valide.

## Ajouter et faire correspondre les postes

- `item_number` rempli : ce poste est mis à jour. Vide : un nouveau poste est créé.
- Il n'y a pas d'autre clé. Une nouvelle ligne qui ressemble à un poste existant, ou à une autre nouvelle ligne du même fichier, est un avertissement que vous pouvez ignorer.
- Les fournisseurs sont mis en correspondance par `supplier_erp_id` lorsqu'il est rempli, sinon par `supplier_name`. Un fournisseur nommé par le fichier et absent de KANAP est créé par le chargement lorsque **Créer les fournisseurs manquants** est cochée. Sans cette option, la vérification les liste et vous demande de les créer dans **Données de référence > Fournisseurs**.
- Une valeur de dimension inexistante est créée par le chargement, et listée dans la vérification. Les comptes, les centres de coûts, les sociétés et les utilisateurs ne sont jamais créés : un élément inconnu est une erreur de ligne qui indique où l'ajouter.
- Les projets sont mis en correspondance par leur numéro, par exemple `PRJ-3`.
- Un poste terminé est un poste dont la `end_of_validity` est passée. Indiquez la date pour terminer un poste, ou écrivez `-` dans la cellule pour l'effacer et laisser le poste en cours. Il n'y a pas de colonne de statut.

## Vérifier, puis charger

1. Cliquez sur **Importer CSV** et choisissez le fichier, ou déposez-le sur la fenêtre. Le fichier est vérifié aussitôt. Rien n'est écrit.
2. Lisez le rapport :

| Section | Contenu |
|---|---|
| **Erreurs** | Les lignes que le chargement refuse, par ligne du fichier avec la colonne lorsqu'elle est connue. Un fichier avec une seule erreur ne charge rien |
| **Modifications** | Les postes à créer, les postes à mettre à jour et les postes que le fichier laisse tels quels |
| **Modifiés dans KANAP depuis l'export** | Les postes modifiés par quelqu'un après votre export, avec qui et quand. Charger le fichier écrit vos valeurs à la place de ces modifications |
| **Avertissements** | Une ligne qui ressemble à un autre poste, des colonnes que le fichier ignore |
| **Créés par le chargement** | Les fournisseurs et les valeurs de dimension que le chargement ajouterait |

3. Cliquez sur **Charger**. Le chargement écrit tout ou rien.

Si un poste change entre la vérification et le chargement, le chargement s'arrête et vous demande de vérifier le fichier de nouveau. La vérification indique aussi comment elle a lu le fichier lorsqu'une date ou un montant pouvait se lire de deux façons, avec un bouton pour changer la lecture.

## Excel et LibreOffice

Ouvrir le fichier et l'enregistrer le laisse chargeable. Les deux programmes conservent les colonnes, le séparateur et les valeurs.

Une date ou un montant que le fichier ne peut pas trancher seul est lu comme l'export l'a écrit, puis dans la langue d'affichage de l'écran. Toute date dont le jour est inférieur ou égal à 12 est ambiguë (`01/03/2027` est le 1er mars en français et le 3 janvier en anglais), et un montant écrit comme `12,280` l'est aussi. La vérification indique comment elle les a lus et propose un bouton pour changer la lecture.

Une colonne que KANAP ne connaît pas est ignorée, avec un avertissement. Une colonne qui ressemble à une colonne de montants mal orthographiée, comme `budjet_2027`, refuse le fichier entier.

## Fichiers d'anciennes versions

Un fichier dans un ancien format est refusé en entier : les fichiers de postes avec des colonnes de type `y_budget`, et le fichier des lignes budgétaires avec les colonnes `measure` et `jan` … `dec`. L'écran affiche ce message :

> Ce fichier provient d'une version antérieure de KANAP. Exportez un nouveau fichier depuis cette liste, reportez-y vos modifications, puis importez-le de nouveau.

Exportez un nouveau fichier et reportez-y vos lignes.

## Charger un budget complet

Le fichier budgétaire contient des postes budgétaires. La société payeuse, le compte, le centre de coûts, le fournisseur et les utilisateurs nommés par un poste doivent exister d'abord. Une petite équipe les charge dans cet ordre :

1. Un plan comptable et ses comptes, dans [Plans comptables](chart-of-accounts.md)
2. Les sociétés, dans [Sociétés](companies.md)
3. Le fichier OPEX, avec **Créer les fournisseurs manquants** cochée
4. Le fichier CAPEX, avec **Créer les fournisseurs manquants** cochée

Une organisation plus grande ajoute le reste des données de référence entre les deux :

1. Le plan comptable et ses comptes
2. Les sociétés
3. Les utilisateurs, dans [Utilisateurs](admin.md)
4. Les centres de coûts, dans [Centres de coûts](cost-centers.md)
5. Les fournisseurs, dans [Fournisseurs](suppliers.md)
6. Les valeurs de dimension, dans [Dimensions analytiques](analytics.md). Les dimensions elles-mêmes sont créées sur cette page
7. Les calendriers de jours ouvrés, dans [Calendriers de jours ouvrés](working-day-calendars.md), une fois que des postes portent des quantités et des prix
8. Le fichier OPEX
9. Le fichier CAPEX

**Le plan comptable vient en premier.** Sur la page Plans comptables, cliquez sur **Nouveau**, donnez un code et un nom au plan, et choisissez la portée **Global**. Ouvrez ensuite **Gérer** et cliquez sur **Définir comme défaut global**. Une société sans plan comptable prend celui-ci, et c'est ainsi que les numéros de compte d'un fichier budgétaire sont résolus. Sélectionnez le plan sur la page, puis cliquez sur **Importer CSV** pour charger ses comptes.

Chacune de ces pages a sa propre section **Importer CSV** avec les colonnes de son fichier.
