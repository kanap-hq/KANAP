# Charger un budget depuis un tableur

La plupart des équipes préparent leur budget dans un tableur : une ligne par ligne budgétaire, une colonne par année ou par mois. KANAP conserve les mêmes lignes budgétaires dans sa liste des lignes budgétaires, où elles alimentent les ventilations, les rapports et la vue d'ensemble.

Le fichier budgétaire fait le lien entre les deux. Exportez les lignes budgétaires, modifiez les cellules qui vous intéressent dans Excel ou LibreOffice, puis importez le fichier. KANAP compare chaque cellule avec ce qu'il contient et n'écrit que ce qui a changé.

Un seul fichier contient les deux types de ligne. Sa colonne `nature` indique si une ligne du fichier est une ligne OPEX ou CAPEX, et chaque ligne du fichier est vérifiée selon les règles de son propre type. La liste exporte les lignes budgétaires qu'elle affiche, OPEX et CAPEX ensemble. Filtrez la colonne **Type** pour n'exporter qu'un seul type.

## Où la trouver

- Chemin : **Gestion budgétaire > Lignes budgétaires**
- Export : **Exporter** dans la barre d'outils de la liste
- Import : **Importer** dans la même barre d'outils
- Autorisations : les deux boutons demandent le niveau Admin sur Budget (`budget:admin`), qui couvre les lignes OPEX et CAPEX de la même façon

## Export

1. Cliquez sur **Exporter** dans la liste.
2. Choisissez ce que le fichier contient :

| Réglage | Effet |
|---|---|
| **Lignes** | Les lignes budgétaires affichées par la liste, avec sa recherche, ses filtres et sa portée de statut. **Toutes les lignes** exporte toutes les lignes à la place, y compris les lignes budgétaires terminées, sans les filtres de la liste |
| **Années** | **Première année** et **Dernière année**, jusqu'à douze années. Par défaut : l'année en cours, la précédente et la suivante. Cochez **Année en cours** pour n'exporter que l'année en cours |
| **Colonnes** | Les colonnes budgétaires à écrire. Les colonnes que votre organisation affiche sont cochées, et une colonne masquée est marquée **masquée**. Son en-tête est indiqué sous le nom, par exemple `budget_2027` |
| **Détail** | **Totaux annuels** : une colonne par colonne budgétaire et par année. **Mois** : une colonne par colonne budgétaire, année et mois |
| **Format** | **CSV** ou **Excel (.xlsx)**. Votre navigateur mémorise ce choix pour l'export suivant |

3. Cliquez sur le bouton en bas de la fenêtre. Il nomme ce que le fichier contiendra : **Exporter 120 lignes filtrées**, **Exporter toutes les lignes**, **Exporter 3 412 lignes**, etc.

Le fichier est enregistré sous le nom `budget.csv` ou `budget.xlsx`. Un fichier CSV est écrit dans la langue d'affichage de l'écran :

| Langue | Séparateur | Montants | Dates |
|---|---|---|---|
| Anglais | `,` | `12280.50` | `2027-03-01` |
| Français, espagnol | `;` | `12280,50` | `01/03/2027` |
| Allemand | `;` | `12280,50` | `01.03.2027` |

Le fichier Excel a les mêmes colonnes sur une feuille nommée `budget`. Les montants sont des nombres exacts au centime, et les dates sont des dates, affichées dans l'ordre jour-mois de votre langue. La ligne d'en-tête reste en place au défilement, avec un filtre sur chaque colonne.

Exporter une liste sans ligne budgétaire donne la seule ligne d'en-tête. C'est votre modèle.

Chaque export est enregistré dans le [journal d'audit](admin.md#journal-daudit), avec ses réglages, son format et son nombre de lignes.

## Les colonnes

Un fichier contient une ligne par ligne budgétaire : les colonnes de détail, puis les colonnes de montants, puis `kanap_token`.

### Colonnes de détail

Les colonnes de détail sont les mêmes pour les deux types de ligne.

| Colonne | Contenu | Sur une nouvelle ligne |
|---|---|---|
| `nature` | `opex` ou `capex`, le type de ligne | Obligatoire. Un fichier sans cette colonne est lu comme des lignes OPEX, ou comme des lignes CAPEX quand le filtre **Type** de la liste ne garde que CAPEX |
| `item_number` | La référence de la ligne budgétaire : `BL-12`, ou `12`. Les numéros `OPX-12` et `CPX-3` des fichiers antérieurs sont lus aussi | Vide : la ligne du fichier crée une ligne budgétaire |
| `name` | Le titre de la ligne, affiché dans la colonne **Nom du produit** de la liste | Obligatoire |
| `description` | La description longue | Facultative |
| `company_name` | Société payeuse. Vide sur une nouvelle ligne : la société du centre de coûts. Une société autre que celle du centre de coûts est acceptée, avec un avertissement | Obligatoire sauf si la ligne a un centre de coûts |
| `supplier_name` | Nom du fournisseur | Facultatif |
| `supplier_erp_id` | L'ID du fournisseur dans votre ERP | Facultatif |
| `account_number` | Numéro de compte, dans le plan comptable de la société payeuse | Obligatoire |
| `cost_center_code` | Code du centre de coûts. Un groupe est refusé | Facultatif |
| `cost_center_path` | La place du centre de coûts dans l'arbre, de son groupe racine jusqu'au centre, noms séparés par ` / `, par exemple `DSI / Direction Infrastructures / Réseau`. Vide pour un centre à la racine de l'arbre ou une ligne budgétaire sans centre. Servez-vous-en pour filtrer ou regrouper les lignes par direction dans votre tableur | Export seulement, ignorée à l'import |
| `run_build` | `run` ou `build` | Facultatif |
| `analytics:<code>` | Le nom de la valeur dans la dimension dont c'est le code, sans tenir compte de la casse. Une colonne par dimension activée, dimension par défaut incluse. Une dimension utilisée pour un seul type de ligne ne prend une valeur que sur les lignes de ce type et reste vide sur les autres. Dans un nouvel espace de travail, les dimensions recommandées sont dans `analytics:default` (la nature de coût), `analytics:it_tower`, `analytics:purpose` et `analytics:priority`, par exemple `Logiciel`, `Application`, `Remplacement` ou `Haute` | Facultatif, sauf pour une dimension obligatoire du type de la ligne, comme le type d'immobilisation d'une ligne CAPEX dans un espace de travail créé avant les dimensions recommandées. Une valeur inexistante est créée par le chargement |
| `owner_it_email` | E-mail d'un utilisateur actif | Facultatif |
| `owner_business_email` | E-mail d'un utilisateur actif | Facultatif |
| `project` | Numéro de projet, par exemple `PRJ-3` | Facultatif |
| `currency` | Code ISO à trois lettres, parmi les devises autorisées dans votre espace de travail | Obligatoire |
| `effective_start` | Le jour où la ligne commence | Le 1er janvier de la première année portant un montant sur la ligne, sinon de l'année en cours |
| `end_of_validity` | Le jour où la ligne s'arrête | Aucune fin |
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

`kanap_token` est écrit par KANAP. Laissez-le tel quel. KANAP s'en sert pour vous dire qu'une ligne budgétaire a changé après votre export. Laissez-le vide sur une ligne que vous ajoutez.

## Ce que signifie une cellule

- Une cellule vide conserve la valeur enregistrée. Une cellule `nature` vide conserve le type d'une ligne existante.
- `-` efface un détail de la ligne : description, notes, nom et ID ERP du fournisseur, centre de coûts, run ou build, une valeur de dimension, un responsable, le projet, la fin de validité. Sur une colonne qu'une nouvelle ligne doit remplir, et sur `nature`, `-` est une erreur de ligne. Sur une dimension obligatoire, `-` est une erreur de ligne lorsque la ligne porte une valeur.
- `0` écrit zéro.
- Un total annuel égal au total enregistré n'écrit rien. Un total différent est réparti sur la période de la colonne, exactement comme lorsque vous saisissez le total dans l'onglet **Budget**.
- Une cellule de mois écrit ce mois, et marque la colonne comme modifiée à la main, comme un mois saisi dans l'onglet **Budget**.
- Un montant a au plus deux décimales. Une cellule de montant ne s'efface pas avec `-` : écrivez `0`, ou laissez la cellule vide.
- Un fichier peut contenir le total annuel d'une colonne et d'une année, ou ses douze mois, jamais les deux.

Une colonne absente conserve toutes les valeurs enregistrées de cette colonne. Un fichier qui ne contient que `item_number` et quelques colonnes de montants est un fichier valide.

## Ajouter et faire correspondre les lignes

- `item_number` rempli : cette ligne budgétaire est mise à jour. Vide : une nouvelle ligne budgétaire est créée, du type qu'indique sa cellule `nature`.
- `item_number` contient la référence de la ligne budgétaire, `BL-12`. Dans un fichier avec une colonne `nature`, un nombre seul est la même référence. Les numéros `OPX-12` et `CPX-3` des fichiers antérieurs désignent toujours leur ligne budgétaire. Nommer deux fois la même ligne budgétaire dans un fichier est une erreur de ligne.
- Une ligne budgétaire garde son type. Une ligne du fichier qui désigne une ligne budgétaire existante avec l'autre `nature` est refusée, par exemple « BL-125 is a CAPEX line, not an OPEX line. A file does not change the type of a line. »
- Chaque ligne est vérifiée selon son propre type : les dimensions et les valeurs qu'elle peut porter, son compte, les colonnes gelées et l'avertissement de doublon. Une colonne gelée pour CAPEX refuse une modification sur une ligne CAPEX uniquement.
- Il n'y a pas d'autre clé. Une nouvelle ligne qui ressemble à une ligne budgétaire existante de son type, ou à une autre nouvelle ligne du même type dans le fichier, est un avertissement que vous pouvez ignorer.
- Les fournisseurs sont mis en correspondance par `supplier_erp_id` lorsqu'il est rempli, sinon par `supplier_name`. Un fournisseur nommé par le fichier et absent de KANAP est créé par le chargement lorsque **Créer les fournisseurs manquants** est cochée. Sans cette option, la vérification les liste et vous demande de les créer dans **Données de référence > Fournisseurs**.
- Une valeur de dimension inexistante est créée par le chargement, et listée dans la vérification. Les comptes, les centres de coûts, les sociétés et les utilisateurs ne sont jamais créés : un élément inconnu est une erreur de ligne qui indique où l'ajouter. Pour une personne dont l'accès aux données est limité, seulement sur une dimension à valeurs ouvertes : voir [Accès aux données limité](#limited-data-access).
- Une valeur, ou `-`, sur une dimension réservée à l'autre type de ligne est une erreur de ligne sur sa cellule `analytics:<code>`, par exemple « The Recurrence dimension is for CAPEX lines only. Leave it out. » L'export laisse une telle cellule vide : une valeur masquée sur une ligne n'est donc pas exportée, et un chargement la laisse en place. Le réglage se trouve dans [Dimensions analytiques](analytics.md#dimensions-opex-ou-capex).
- Une valeur utilisée pour l'autre type de ligne uniquement est une erreur de ligne sur sa cellule `analytics:<code>`, par exemple « Main-d'œuvre interne is for OPEX lines only. Pick a value for CAPEX lines. » Une ligne garde la valeur qu'elle porte déjà. Les valeurs que crée l'import sont utilisées pour OPEX et CAPEX. Le réglage se trouve dans [Dimensions analytiques](analytics.md#valeurs-opex-ou-capex).
- Une nouvelle ligne doit avoir une valeur sur chaque dimension obligatoire de son propre type, avec le message « The Nature de coût dimension is required. Choose a value. » sur la cellule `analytics:<code>`. Cela vaut lorsque la colonne manque dans le fichier, lorsque la cellule est vide et lorsqu'elle contient `-`. Une valeur que crée le chargement compte. Une ligne existante n'est refusée que pour un `-` qui effacerait la valeur qu'elle porte : une cellule vide ou une colonne absente la laisse telle quelle. Le réglage se trouve dans [Dimensions analytiques](analytics.md#dimensions-obligatoires).
- Une ligne du fichier qui crée une ligne budgétaire, ou qui change son compte, est refusée lorsque le compte est réservé à l'autre type de ligne, avec le message « Account 6061 is for CAPEX lines only. » (ou OPEX). Une ligne budgétaire garde son compte actuel. Le réglage des comptes se trouve dans [Plans comptables et gestion des comptes](chart-of-accounts.md#comptes-opex-ou-capex).
- Les projets sont mis en correspondance par leur numéro, par exemple `PRJ-3`.
- Une ligne budgétaire terminée est une ligne budgétaire dont la `end_of_validity` est passée. Indiquez la date pour terminer une ligne budgétaire, ou écrivez `-` dans la cellule pour l'effacer et laisser la ligne budgétaire en cours. Il n'y a pas de colonne de statut.

## Vérifier, puis charger

1. Cliquez sur **Importer** et choisissez le fichier, un fichier CSV ou un classeur Excel (`.xlsx`), ou déposez-le sur la fenêtre. Le fichier est vérifié aussitôt. Rien n'est écrit.
2. Lisez le rapport :

| Section | Contenu |
|---|---|
| **Erreurs** | Les lignes que le chargement refuse, par ligne du fichier avec la colonne lorsqu'elle est connue. Un fichier avec une seule erreur ne charge rien |
| **Modifications** | Les lignes budgétaires à créer, les lignes budgétaires à mettre à jour et les lignes budgétaires que le fichier laisse telles quelles |
| **Modifiés dans KANAP depuis l'export** | Les lignes budgétaires modifiées par quelqu'un après votre export, avec qui et quand. Charger le fichier écrit vos valeurs à la place de ces modifications |
| **Avertissements** | Une ligne du fichier qui ressemble à une autre ligne budgétaire, un `company_name` différent de la société du centre de coûts de la ligne, un montant qui fait cesser une colonne de suivre ses lignes de calcul, des colonnes et des cellules que le fichier ignore |
| **Créés par le chargement** | Les fournisseurs et les valeurs de dimension que le chargement ajouterait |

3. Cliquez sur **Charger**. Le chargement écrit tout ou rien.

Si une ligne budgétaire change entre la vérification et le chargement, le chargement s'arrête et vous demande de vérifier le fichier de nouveau. La vérification indique aussi comment elle a lu le fichier lorsqu'une date ou un montant pouvait se lire de deux façons, avec un bouton pour changer la lecture.

### Colonnes calculées par quantité et prix

Une ligne budgétaire peut calculer une colonne à partir de lignes de calcul, quantité × prix : voir [Quantité et prix](budget-lines.md#quantite-et-prix). Le fichier budgétaire ne porte que les totaux et les mois d'une colonne. Les lignes de calcul se modifient dans l'onglet **Budget** de la ligne budgétaire.

Lorsque le fichier change le total annuel ou un mois d'une telle colonne, la vérification affiche un avertissement pour chaque ligne budgétaire, colonne et année, par exemple :

> BL-83 · Révision 2026 : 3 lignes de calcul (281 280,00) ne piloteront plus ces montants.

Le chargement est autorisé. Après lui, les lignes de calcul restent sur la ligne budgétaire comme référence, avec leur total, et la colonne suit les montants du fichier. Un total annuel égal à ce que donnent les lignes n'écrit rien : la colonne continue de suivre ses lignes.

## Accès aux données limité { #limited-data-access }

Une personne limitée à une partie du budget utilise le fichier dans son accès, quand son rôle le permet. Voir [Accès aux données](data-access.md).

- L'export contient les lignes qu'elle voit.
- Une ligne du fichier qui désigne une ligne qu'elle ne voit pas est traitée comme une ligne qui n'existe pas. Dans un fichier issu d'un export, le message est « BL-12 n'est plus disponible depuis l'export. », le même que pour une ligne supprimée depuis.
- Une ligne qu'elle voit en Lecture passe quand sa ligne du fichier est inchangée. Une modification est refusée avec « BL-12 est en lecture seule dans votre accès. »
- Une nouvelle ligne, ou une nouvelle société ou un nouveau centre de coûts sur une ligne, doit correspondre à l'un de ses nœuds en Saisie. Sinon la ligne du fichier est refusée avec « Cette société ou ce centre de coûts ne fait pas partie de votre accès. »
- Une valeur inconnue n'est créée que sur une dimension à valeurs ouvertes. Sur les autres dimensions, c'est une erreur de ligne.

Ces lignes apparaissent parmi les **Erreurs** de la vérification, comme toute autre ligne refusée.

## Excel et LibreOffice

Ouvrir le fichier et l'enregistrer le laisse chargeable, en CSV comme en `.xlsx`. Les deux programmes conservent les colonnes, le séparateur et les valeurs.

Dans un classeur, KANAP lit la première feuille. Quand le classeur a d'autres feuilles, la vérification indique la feuille lue. Un montant ou une date saisi dans une cellule est lu exactement tel quel, sans question de séparateur décimal ni d'ordre du jour et du mois. Un ancien fichier Excel (`.xls`) est refusé : enregistrez-le en `.xlsx` ou en CSV.

Une date ou un montant écrit en texte, que le fichier ne peut pas trancher seul, est lu comme l'export l'a écrit, puis dans la langue d'affichage de l'écran. Toute date dont le jour est inférieur ou égal à 12 est ambiguë (`01/03/2027` est le 1er mars en français et le 3 janvier en anglais), et un montant écrit comme `12,280` l'est aussi. La vérification indique comment elle les a lus et propose un bouton pour changer la lecture.

Une colonne que KANAP ne connaît pas est ignorée, avec un avertissement. Une colonne qui ressemble à une colonne de montants mal orthographiée, comme `budjet_2027`, refuse le fichier entier. Une colonne `analytics:<code>` qui ne désigne aucune dimension activée refuse elle aussi le fichier entier, avec « Unknown dimension 'x'. »

## Fichiers d'anciennes versions

Un fichier dans un ancien format est refusé en entier : les fichiers de lignes budgétaires avec des colonnes de type `y_budget`, et le fichier des lignes budgétaires avec les colonnes `measure` et `jan` … `dec`. L'écran affiche ce message :

> Ce fichier provient d'une version antérieure de KANAP. Exportez un nouveau fichier depuis cette liste, reportez-y vos modifications, puis importez-le de nouveau.

Un fichier CAPEX exporté avant que le type d'immobilisation, le type d'investissement et la priorité deviennent des dimensions, reconnu à ses trois colonnes `ppe_type`, `investment_type` et `priority` présentes ensemble, est lui aussi refusé en entier. Ces valeurs passent désormais par des colonnes de dimension. Une ou deux de ces colonnes seules sont des colonnes inconnues, ignorées avec un avertissement. L'écran affiche ce message :

> The ppe_type, investment_type and priority columns are now dimension columns (analytics:ppe_type, analytics:investment_type, analytics:priority). Export a fresh file from this list, copy your changes into it, and import it again.

Exportez un nouveau fichier et reportez-y vos lignes.

Un fichier OPEX ou CAPEX exporté avant l'ajout de la colonne `nature` est accepté. Ses lignes sont lues comme des lignes OPEX, ou comme des lignes CAPEX quand le filtre **Type** de la liste ne garde que CAPEX, et ses numéros `OPX-12` et `CPX-3` désignent toujours leurs lignes budgétaires : importez un ancien fichier OPEX avec la liste sur OPEX ou sur les deux types, et un ancien fichier CAPEX avec la liste filtrée sur CAPEX. Ses cellules `kanap_token` restent valides. Dans un tel fichier, un nombre seul garde son sens antérieur : avec la liste filtrée sur CAPEX, `3` est `CPX-3` ; sinon, c'est le numéro de la ligne OPEX.

KANAP reconnaît la colonne `nature` à son nom, quelle que soit la casse. Dans un ancien fichier qui contient une colonne à vous nommée Nature, renommez-la avant l'import : KANAP lirait cette colonne comme le type de chaque ligne budgétaire et refuserait ses valeurs.

## Charger un budget complet

Le fichier budgétaire contient des lignes budgétaires. La société payeuse, le compte, le centre de coûts, le fournisseur et les utilisateurs nommés par une ligne budgétaire doivent exister d'abord. Une petite équipe les charge dans cet ordre :

1. Un plan comptable et ses comptes, dans [Plans comptables](chart-of-accounts.md)
2. Les sociétés, dans [Sociétés](companies.md)
3. Le fichier budgétaire, avec **Créer les fournisseurs manquants** cochée. Il contient les lignes OPEX et CAPEX ensemble, ou vous chargez un fichier par type

Une organisation plus grande ajoute le reste des données de référence entre les deux :

1. Le plan comptable et ses comptes
2. Les sociétés
3. Les utilisateurs, dans [Utilisateurs](admin.md)
4. Les centres de coûts, dans [Centres de coûts](cost-centers.md)
5. Les fournisseurs, dans [Fournisseurs](suppliers.md)
6. Les valeurs de dimension, dans [Dimensions analytiques](analytics.md). Les dimensions elles-mêmes sont créées sur cette page
7. Les calendriers de jours ouvrés, dans [Calendriers de jours ouvrés](working-day-calendars.md), une fois que des lignes budgétaires portent des quantités et des prix
8. Le fichier budgétaire, lignes OPEX et CAPEX

**Le plan comptable vient en premier.** Sur la page Plans comptables, cliquez sur **Nouveau**, donnez un code et un nom au plan, et choisissez **Tous les pays** sous **Utilisé pour**. Cliquez ensuite sur **Gérer les plans**, ouvrez le menu **⋯** du plan et cliquez sur **Définir par défaut pour les autres pays**. Une société sans plan comptable prend celui-ci, et c'est ainsi que les numéros de compte d'un fichier budgétaire sont résolus. Sélectionnez le plan sur la page, puis cliquez sur **Importer** pour charger ses comptes.

Chacune de ces pages a sa propre section d'import avec les colonnes de son fichier. Toutes lisent un fichier CSV ou un classeur Excel. Voir [Fichiers CSV et Excel](csv-files.md).
