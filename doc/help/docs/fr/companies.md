# Sociétés

Les sociétés sont le socle de vos données de référence. Elles représentent les entités juridiques auxquelles vous imputez les dépenses IT et pour lesquelles vous établissez les refacturations. Chaque ventilation, poste de dépense et de nombreux rapports font référence à une société, il est donc important de maintenir ces données à jour.

Lorsque votre espace de travail est créé, il démarre avec une société portant le nom de votre organisation. Son pays est celui que vous avez sélectionné lors de l'inscription à l'essai, et elle sera automatiquement assignée au plan comptable par défaut pour ce pays lorsqu'il est disponible. Vous pouvez la renommer ou en ajouter d'autres.

## Premiers pas

Rendez-vous dans **Données de référence > Sociétés** pour ouvrir la liste.

**Champs obligatoires** :

- **Nom** : un libellé unique que vos équipes reconnaissent
- **Pays** : code pays ISO (recherche par nom ou code)
- **Ville** : ville où la société est basée
- **Devise de base** : code devise ISO (recherche par nom ou code)

**Conseil** : Gardez des noms uniques pour éviter la confusion dans les imports et les listes de sélection.

## Travailler avec la liste

La liste affiche toutes les sociétés de votre espace de travail. Utilisez-la pour revoir les informations clés en un coup d'oeil, trouver rapidement des sociétés et ouvrir les espaces de travail pour les modifier.

**Colonnes par défaut** :

| Colonne | Ce qu'elle affiche |
|---------|-------------------|
| **Nom** | Nom de la société (cliquez pour ouvrir l'espace de travail) |
| **Pays** | Code pays ISO |
| **Devise** | Code de devise de base |
| **Effectif (année)** | Effectif pour l'année sélectionnée (cliquez pour ouvrir l'onglet Détails) |
| **Utilisateurs IT (année)** | Utilisateurs IT pour l'année sélectionnée (cliquez pour ouvrir l'onglet Détails) |
| **Chiffre d'affaires (année)** | Chiffre d'affaires pour l'année sélectionnée (cliquez pour ouvrir l'onglet Détails) |
| **Statut** | Activé ou Désactivé |

**Colonnes supplémentaires** (masquées par défaut, ajoutez-les via le sélecteur de colonnes) :

| Colonne | Ce qu'elle affiche |
|---------|-------------------|
| **Ville** | Ville |
| **Code postal** | Code postal |
| **Adresse 1** | Ligne d'adresse principale |
| **Adresse 2** | Ligne d'adresse secondaire |
| **État** | État ou province |
| **Notes** | Notes en texte libre |
| **Créé** | Date et heure de création de l'enregistrement |

**Filtrage** :

- **Recherche rapide** : recherche en texte libre dans toutes les colonnes visibles
- **Filtres de colonnes** : cliquez sur n'importe quel en-tête de colonne pour filtrer par valeur ; les colonnes numériques (Effectif, Utilisateurs IT, Chiffre d'affaires) supportent les filtres numériques
- **Périmètre par statut** : le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste contrôle quelles sociétés apparaissent. Par défaut, la liste affiche les sociétés activées

**Sélecteur d'année** : utilisez le champ **Année** dans la barre d'outils pour changer quelle année de métriques est affichée. La ligne du bas affiche les **totaux** pour Effectif, Utilisateurs IT et Chiffre d'affaires pour toutes les sociétés visibles (filtrées).

**Actions** :

- **Nouveau** : créer une société (nécessite `companies:manager`)
- **Import CSV** : import en masse de sociétés depuis un fichier CSV (nécessite `companies:admin`)
- **Export CSV** : exporter les sociétés et leurs métriques en CSV (nécessite `companies:admin`)
- **Supprimer la sélection** : supprimer une ou plusieurs sociétés sélectionnées (nécessite `companies:admin` ; possible uniquement si rien ne référence la société)

**Contexte de recherche** : lorsque vous ouvrez l'espace de travail d'une société depuis la liste, votre recherche, vos filtres, votre tri et votre année sont préservés. Revenir à la liste restaure votre vue précédente.

## Autorisations

| Action | Niveau requis |
|--------|---------------|
| Consulter la liste et les espaces de travail | `companies:reader` |
| Créer ou modifier des sociétés | `companies:manager` |
| Importer, exporter ou supprimer | `companies:admin` |

## L'espace de travail de la société

Cliquez sur un nom de société dans la liste pour ouvrir son espace de travail. Il comporte deux onglets : **Vue d'ensemble** et **Détails**.

- **En-tête** : le nom de la société. Cliquez dessus pour renommer la société. Les flèches avec « N sur M » permettent de passer d'une société à l'autre dans l'ordre et avec les filtres de la liste, sans revenir à la liste. Le lien de retour, **Sociétés**, ramène à la liste avec votre contexte de recherche intact
- **Panneau Propriétés** à droite : **Pays**, **Devise de base**, **Plan comptable** et **Cycle de vie**. Utilisez le bouton situé à côté pour replier le panneau ou le rouvrir

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même quand vous quittez le champ. Il n'y a ni bouton Enregistrer, ni bouton Réinitialiser, ni bouton Fermer. Vous pouvez continuer à travailler pendant l'enregistrement. Lorsqu'une modification est refusée, la raison s'affiche sous le champ concerné, sauf pour le nom, dont le refus s'affiche en haut de la page.

---

### Panneau Propriétés

- **Pays** (obligatoire) : code pays ISO, recherche par nom ou code. Changer le pays fait aussi passer le **Plan comptable** à celui par défaut du nouveau pays, mais seulement si le plan actuel appartient à un autre pays. Un plan comptable global reste en place
- **Devise de base** (obligatoire) : code devise ISO, recherche par nom ou code
- **Plan comptable** : le plan comptable lié à cette société (voir [Plan comptable](#plan-comptable)). Sur une société existante, vous pouvez choisir un autre plan, mais vous ne pouvez pas vider le champ, car le plan par défaut du pays reviendrait
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie)

---

### Vue d'ensemble

L'onglet Vue d'ensemble contient l'adresse, les informations d'immatriculation et les notes. Le nom, le pays, la devise, le plan comptable et le cycle de vie se trouvent dans l'en-tête et le panneau **Propriétés**.

**Ce que vous pouvez modifier** :

- Section **Adresse** :
    - **Adresse ligne 1**, **Adresse ligne 2** : lignes d'adresse
    - **Code postal** : code postal
    - **Ville** (obligatoire) : nom de la ville. Une ville vide est refusée avec « Saisissez une ville. »
    - **Région ou État** : état, province ou région
- Section **Immatriculation** :
    - **Numéro d'immatriculation** : numéro d'immatriculation de la société
    - **Numéro de TVA** : numéro d'identification TVA
- **Notes** : notes en texte libre

**Créer une société** : **Nouveau** ouvre un formulaire unique avec le nom, **Pays**, **Devise de base**, **Plan comptable**, **Ville**, les autres champs d'adresse, les champs d'immatriculation et **Notes**. Le choix d'un pays renseigne le **Plan comptable** à votre place : le plan par défaut du pays s'il en existe un, sinon un plan global. Vous pouvez le modifier avant d'enregistrer. Cliquez sur **Créer** pour enregistrer la société. L'onglet **Détails** devient disponible après la création de la société.

---

### Détails

L'onglet Détails gère les **métriques annuelles**. Utilisez les onglets d'année en haut pour basculer entre les années (année en cours plus deux ans avant et après).

**Ce que vous pouvez modifier** :

- **Effectif** (obligatoire) : nombre total d'employés pour l'année, doit être un nombre entier de zéro ou plus
- **Utilisateurs IT** (optionnel) : nombre d'utilisateurs IT, doit être un nombre entier de zéro ou plus
- **Chiffre d'affaires (M€)** (optionnel) : chiffre d'affaires en millions de la devise de base de la société, jusqu'à 3 décimales

**Comment ça fonctionne** :

- Chaque valeur est enregistrée pour l'année sélectionnée quand vous quittez le champ (ou appuyez sur Entrée). Une valeur non valide affiche un message sous le champ, par exemple « Saisissez un nombre entier, 0 ou plus. »
- Chaque année est enregistrée séparément : changer d'année charge les valeurs de cette année
- Si les chiffres de la société pour l'année sont **gelés**, les champs sont verrouillés et un avis explique qu'un administrateur peut les dégeler depuis l'**Administration des données de référence**
- Vous avez besoin de `companies:manager` pour modifier les métriques

## Plan comptable

Chaque société peut être liée à un **Plan comptable** (CoA), qui définit l'ensemble des comptes disponibles lors de l'enregistrement de postes OPEX ou CAPEX pour cette société.

**Comment ça fonctionne** :

- Lorsque vous créez une société, elle est automatiquement assignée au CoA par défaut pour son pays (si un tel CoA existe). S'il n'y a pas de CoA par défaut pour le pays, le CoA par défaut global est utilisé.
- Vous pouvez changer l'assignation du CoA dans le panneau **Propriétés** en utilisant le sélecteur **Plan comptable**. Le sélecteur affiche les CoA correspondant au pays de la société plus les CoA de portée globale.
- Lorsque vous changez le pays de la société, le CoA suit si l'actuel appartient à un autre pays : il passe à celui par défaut du nouveau pays. Un CoA global reste en place.
- Sur une société existante, le CoA ne peut pas être vidé. Vous pouvez seulement le remplacer par un autre.
- Le CoA que vous sélectionnez détermine quels comptes apparaissent dans le menu déroulant des comptes lors de la création ou modification de postes de dépenses pour cette société.

**Ce que cela signifie pour votre flux de travail** :

- **Sociétés avec un CoA** : lors de l'enregistrement d'OPEX/CAPEX, vous ne pouvez sélectionner que des comptes appartenant au plan comptable de cette société. Cela garantit la cohérence comptable.
- **Sociétés sans CoA** (historique) : peuvent utiliser des comptes qui n'appartiennent à aucun plan comptable. Cela supporte la migration progressive vers le système de CoA.
- **Changer de CoA** : si vous basculez une société vers un autre CoA, les postes de dépenses existants conservent leurs comptes actuels (avec un avertissement s'ils ne correspondent pas au nouveau CoA), mais les nouveaux postes utiliseront les comptes du nouveau CoA.

**Configurer les plans comptables** : rendez-vous dans **Données de référence > Plans comptables** pour consulter, créer ou gérer vos ensembles de CoA. Vous pouvez créer des CoA de zéro ou les charger depuis des modèles de la plateforme (ensembles de comptes standard par pays). Chaque pays peut avoir un CoA par défaut qui est automatiquement assigné aux nouvelles sociétés de ce pays.

**Conseil** : Si vous voyez un avertissement « compte obsolète » lors de la modification de postes OPEX/CAPEX, cela signifie que le compte n'appartient pas au plan comptable actuel de la société. Mettez à jour le compte vers un compte du bon CoA pour résoudre cet avertissement.

## Statut et cycle de vie

Utilisez la **Fin de validité** pour contrôler quand une société cesse d'être active.

- Les sociétés sont **Activées** par défaut. Laissez la **Fin de validité** vide pour que la société reste active indéfiniment, ou programmez une date future.
- Passer la société à **Désactivé** sans date fixe sa fin de validité à aujourd'hui.
- Une fois la fin de validité passée, le statut passe à **Désactivé** de lui-même dans l'heure.
- Après la fin de validité :
    - La société n'apparaît plus dans les listes de sélection pour les nouvelles ventilations et est exclue des rapports pour les années strictement postérieures.
    - Les données historiques restent intactes ; la société apparaît toujours dans les rapports couvrant les années où elle était active.
- **Préférez la désactivation à la suppression.** La suppression n'est possible que si rien ne référence la société (pas de ventilations, de dépenses ni de centres de coûts). Une société à laquelle appartiennent des centres de coûts est refusée avec un message tel que « Company A is used by 3 cost centers. Change their company or disable it instead. »

## Métriques annuelles

De nombreuses parties de l'application sont sensibles à l'année. Les sociétés ont des métriques par année :

- **Effectif** (obligatoire pour l'année)
- **Utilisateurs IT** (optionnel)
- **Chiffre d'affaires** (optionnel, en millions de la devise de base de la société)

**Où c'est important** :

- Les ventilations peuvent utiliser l'Effectif, les Utilisateurs IT ou le Chiffre d'affaires pour répartir les coûts entre les sociétés pour une année donnée.
- Les rapports utilisent ces métriques pour les KPI et les ratios.
- Seules les sociétés actives pour une année sont prises en compte pour la ventilation et le reporting de cette année.

**Gel et copie** :

- Vous pouvez **geler** une année une fois finalisée pour empêcher les modifications.
- Utilisez l'**Administration des données de référence** pour copier les métriques d'une année à l'autre (choisissez quelles métriques copier). Les années gelées ne peuvent pas être écrasées.

## Import/export CSV

Maintenez de grands ensembles synchronisés avec vos systèmes sources en utilisant le CSV (séparateur point-virgule `;`).

**Export** :

- **Modèle** : fichier d'en-têtes uniquement que vous pouvez remplir (inclut des colonnes dynamiques pour A-1, A, A+1 basées sur l'année sélectionnée)
- **Données** : sociétés actuelles plus leurs métriques pour A-1 / A / A+1

**Import** :

- Commencez par la **Vérification préalable** (valide les en-têtes, l'encodage, les champs obligatoires, les doublons et les métriques)
- Si la vérification est OK, **Charger** applique les insertions et mises à jour
- La correspondance se fait par **nom** de société (dans votre espace de travail). Les doublons dans le fichier sont dédupliqués par nom (la première occurrence l'emporte)
- **Champs obligatoires** : Nom, Pays (2 lettres) et Devise de base (3 lettres). La ville est facultative dans le fichier
- **Champ optionnel** : `coa_code` (référence un plan comptable ; si omis, le CoA par défaut pour le pays est utilisé)
- **Statut et fin de validité** : `status` vaut `enabled` ou `disabled`, et `disabled_at` est la fin de validité, une date (`2026-12-31`) ou une date et une heure complètes. L'export écrit le statut déduit de la fin de validité. Une nouvelle société est activée sauf si la ligne indique `disabled`. Lors d'une mise à jour, un `status` vide et un `disabled_at` vide conservent les valeurs enregistrées. `enabled` avec une date vide efface la fin de validité. `disabled` avec une date vide conserve une date déjà passée, et sinon termine la société aujourd'hui
- Une ligne dont le statut contredit sa date est refusée avec une erreur de ligne : « Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again. » ou « Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed. »
- **Métriques** : si vous fournissez des métriques pour une année, l'Effectif est obligatoire pour cette année ; Utilisateurs IT et Chiffre d'affaires sont optionnels. Le Chiffre d'affaires accepte jusqu'à 3 décimales et doit être exprimé en millions de la devise de base de la société

**Notes** :

- Utilisez l'**encodage UTF-8** et des **points-virgules** comme séparateurs
- La liste se rafraîchit automatiquement après un chargement réussi
- Si vous importez avec `coa_code`, assurez-vous que le plan comptable existe d'abord dans votre espace de travail

## Conseils

- **Désactivez plutôt que supprimer** : gardez l'historique cohérent et les rapports significatifs.
- **Plan comptable** : assignez des CoA aux sociétés pour garantir une utilisation cohérente des comptes dans les postes OPEX/CAPEX.
- **Chiffre d'affaires** : saisissez les valeurs en millions de la devise de base de la société (ex. : 2,5 = 2,5 millions dans cette devise).
- **Effectif** est le driver de ventilation le plus courant ; maintenez-le à jour pour l'année en cours.
- **Métriques gelées** : vous pouvez toujours les consulter, mais les modifications sont bloquées tant que vous ne dégélez pas depuis l'Administration.
- **Sélecteur de colonnes** : utilisez-le pour afficher ou masquer les colonnes comme Ville, Adresse, État ou Créé selon votre flux de travail.
- **Les colonnes de métriques renvoient aux Détails** : cliquer sur une valeur d'Effectif, d'Utilisateurs IT ou de Chiffre d'affaires ouvre directement l'onglet Détails pour cette société.
