# Départements

Les départements représentent les unités organisationnelles au sein de vos sociétés. Utilisez-les pour suivre l'effectif par année, ventiler les coûts et définir les audiences pour les applications. Chaque département appartient à une société et porte des données d'effectif annuelles qui alimentent les calculs de refacturation et de ventilation.

Pour indiquer qui porte chaque ligne budgétaire, utilisez les [Centres de coûts](cost-centers.md) : contrairement aux départements, ils peuvent être regroupés entre plusieurs sociétés.

## Premiers pas

Naviguez vers **Données de référence > Départements** pour voir votre liste de départements. Cliquez sur **Nouveau** pour créer votre première entrée.

**Champs obligatoires** :
- **Nom** : Le nom du département
- **Société** : À quelle société ce département appartient

**Optionnel mais utile** :
- **Description** : Description libre de l'objet ou du périmètre du département
- **Effectif** : Nombre d'employés, suivi par année (défini dans l'onglet Détails après création)

**Conseil** : Importez les départements depuis votre système RH pour maintenir votre structure organisationnelle alignée.

---

## Travailler avec la liste

La grille des départements vous offre une vue d'ensemble de tous les départements avec leur effectif pour une année donnée.

**Colonnes par défaut** :
- **Nom** : Nom du département — cliquez pour ouvrir l'onglet Vue d'ensemble de l'espace de travail
- **Société** : Société parente — cliquez pour ouvrir l'onglet Vue d'ensemble de l'espace de travail
- **Effectif (Année)** : Nombre d'employés pour l'année sélectionnée — cliquez pour accéder directement à l'onglet Détails pour modification

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **Statut** : Activé ou Désactivé
- **Créé** : Date de création du département

**Sélecteur d'année** : Utilisez le champ **Année** dans la barre d'outils pour changer l'année d'effectif affichée. La grille se rafraîchit automatiquement lorsque vous changez d'année.

**Filtre de statut** : Utilisez le bouton bascule **Afficher : Tous / Activés / Désactivés** pour filtrer par statut de département. La liste affiche par défaut uniquement les départements activés.

**Recherche rapide** : La barre de recherche filtre les noms de départements.

**Liens profonds** : Chaque cellule de la grille est un lien cliquable. Nom et Société ouvrent l'onglet Vue d'ensemble ; Effectif ouvre l'onglet Détails. Lorsque vous naviguez vers un espace de travail puis revenez, votre ordre de tri, requête de recherche et filtres sont préservés.

**Actions** :
- **Nouveau** : Créer un nouveau département (nécessite `departments:manager`)
- **Importer CSV** : Import en masse de départements (nécessite `departments:admin`)
- **Exporter CSV** : Exporter en CSV (nécessite `departments:admin`)
- **Supprimer la sélection** : Supprimer les départements sélectionnés (nécessite `departments:admin`)

---

## L'espace de travail Départements

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. Il comporte deux onglets : **Vue d'ensemble** et **Détails**.

- **En-tête** : le nom du département. Cliquez dessus pour renommer le département. **Préc** / **Suiv** parcourent les départements dans l'ordre et les filtres de la liste sans revenir à la liste, et le bouton de fermeture ramène à la liste
- **Panneau Propriétés** à droite : **Société** et **Cycle de vie**

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même. Il n'y a pas de bouton Enregistrer. Le nom et la description s'enregistrent quand vous quittez le champ ; la société et le cycle de vie s'enregistrent dès que vous les changez. Vous pouvez continuer à travailler pendant l'enregistrement. Lorsqu'une modification est refusée, la raison s'affiche sous le champ concerné, sauf pour le nom, dont le refus s'affiche en haut de la page.

### Vue d'ensemble

L'onglet Vue d'ensemble contient la description. Les autres champs se trouvent dans l'en-tête et le panneau **Propriétés**.

**Ce que vous pouvez modifier** :
- **Nom** : Nom du département (obligatoire), dans l'en-tête
- **Société** : Société parente, liée aux données de référence Sociétés (obligatoire). Une société qui a déjà un département du même nom est refusée : « A department with this name already exists in the selected company. »
- **Description** : Description libre
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Laissez la date vide pour que le département reste actif indéfiniment, ou fixez une date future pour programmer sa fin. Passer le département à **Désactivé** sans date fixe la fin de validité à aujourd'hui

**Créer un département** : **Nouveau** ouvre un formulaire avec **Nom**, **Société** et **Description**. Cliquez sur **Créer** pour l'enregistrer. L'onglet Détails devient disponible après la création du département.

---

### Détails

L'onglet Détails gère les métriques d'effectif année par année.

**Sélecteur d'année** : Choisissez l'année à consulter ou modifier en utilisant les onglets d'année en haut du panneau. Cinq années sont disponibles : de deux ans avant l'année en cours à deux ans après.

**Métriques par année** :
- **Effectif** : Nombre total d'employés dans ce département pour l'année sélectionnée

**Comment ça fonctionne** :
- L'effectif est enregistré pour l'année sélectionnée quand vous quittez le champ (ou appuyez sur Entrée). Toute valeur autre qu'un nombre entier de zéro ou plus affiche « Saisissez un nombre entier, 0 ou plus. » sous le champ
- L'effectif alimente les calculs d'audience pour les applications
- Chaque année est enregistrée séparément : changer d'année charge la valeur de cette année
- Si les métriques pour l'année sélectionnée ont été **gelées** (par un administrateur), le champ est verrouillé et un avis indique qu'un administrateur budgétaire peut les dégeler (**Gestion budgétaire > Administration > Geler les données de référence**)

**Conseil** : Mettez à jour l'effectif annuellement lors de votre cycle de planification budgétaire. Utilisez les onglets d'année pour consulter ou pré-remplir les années futures.

---

## Import/export CSV

**Exporter CSV** télécharge tous les départements avec leur société, leur nom, leur description, leur statut et leur fin de validité. **Importer CSV** relit un fichier. La fenêtre d'import propose aussi **Télécharger le modèle** : un fichier avec les seuls en-têtes.

Les colonnes :

| Colonne | Contenu |
|---|---|
| `company_name` | Obligatoire. La société à laquelle appartient le département, par son nom |
| `name` | Obligatoire. Le nom du département |
| `description` | Texte libre |
| `status` | `enabled` ou `disabled` |
| `disabled_at` | La fin de validité : une date (`2026-12-31`) ou une date et une heure complètes |

**Import** :

- Utilisez la **Vérification préalable** pour valider le fichier avant de l'appliquer, puis **Charger**
- Correspondance par nom de département et nom de société : une ligne met à jour le département qu'elle nomme, toute autre ligne en crée un

**Cellules obligatoires** : `name` et `company_name`, une société existante

**Cellules facultatives** : `description`, `status`, `disabled_at`

**Colonnes de cycle de vie** :
- `status` vaut `enabled` ou `disabled`, et `disabled_at` est la fin de validité, une date (`2026-12-31`) ou une date et une heure complètes. L'export écrit le statut déduit de la fin de validité. Un nouveau département est activé sauf si la ligne indique `disabled`. Lors d'une mise à jour, un `status` vide et un `disabled_at` vide conservent les valeurs enregistrées. `enabled` avec une date vide efface la fin de validité. `disabled` avec une date vide conserve une date déjà passée, et sinon termine le département aujourd'hui
- Une ligne dont le statut contredit sa date est refusée avec une erreur de ligne : « Status is enabled but the end of validity has passed. Clear the date or set the status to disabled. If the file comes from an older export, export the data again. » ou « Status is disabled but the end of validity is still to come. Set the status to enabled or set a date that has passed. »

**Notes** :
- Voir [Fichiers CSV](master-data-operations.md#fichiers-csv) pour l'encodage, le séparateur, les formes de dates et les deux étapes d'import
- L'effectif n'est pas dans le fichier. Saisissez-le par année dans l'onglet **Détails** du département

## Conseils

- **Reproduisez votre structure organisationnelle** : Reflétez la hiérarchie des départements de votre système RH pour plus de cohérence.
- **Mettez à jour l'effectif annuellement** : Programmez un rappel pour rafraîchir les métriques des départements lors de la planification budgétaire.
- **Utilisez pour les ventilations** : L'effectif des départements alimente les calculs de ventilation des coûts — gardez-le précis.
- **Désactivez plutôt que supprimer** : Lorsque les départements sont réorganisés, désactivez les anciens plutôt que de les supprimer pour préserver les données historiques.
- **Exploitez les liens profonds** : Cliquez directement sur le chiffre d'effectif depuis la liste pour accéder à l'onglet Détails et modifier les métriques sans clic supplémentaire.
