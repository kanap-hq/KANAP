# Processus métier

Les processus métier vous permettent de construire et maintenir un catalogue centralisé des processus de bout en bout de votre organisation — comme Order-to-Cash, Procure-to-Pay ou Hire-to-Retire. En centralisant les noms de processus, les catégories et les responsables, vous créez un point de référence unique que le reste de KANAP peut exploiter pour la responsabilité, le reporting et les audits.

## Premiers pas

Naviguez vers **Données de référence > Processus métier** pour ouvrir la liste.

**Champs obligatoires** :

- **Nom** : le nom du processus, idéalement incluant un code court (par ex. « Order-to-Cash (O2C) »).

**Autorisations** :

- Consultation : `business_processes:reader`
- Création / modification : `business_processes:manager`
- Suppression, import/export CSV : `business_processes:admin`

Si la page est manquante ou les champs sont en lecture seule, demandez à votre administrateur d'ajuster vos autorisations de rôle.

---

## Travailler avec la liste

La liste affiche tous les processus métier de votre tenant.

**Colonnes par défaut** :

- **Nom** — le nom du processus. Cliquez pour ouvrir l'espace de travail.
- **Catégories** — une ou plusieurs catégories auxquelles le processus appartient (par ex. « Client & Ventes », « Finance & Contrôle de gestion »). Les catégories multiples sont affichées comme une liste séparée par des virgules.
- **Responsable du processus** — l'utilisateur responsable du processus.

**Colonnes supplémentaires** (masquées par défaut ; activez-les avec le sélecteur de colonnes) :

- **Statut** — `activé` ou `désactivé`.
- **Mis à jour** — date de dernière modification du processus.

**Filtrage et tri** :

- La recherche rapide filtre sur toutes les colonnes visibles.
- Utilisez le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste pour choisir les processus affichés. Par défaut, la liste affiche les processus activés.
- Le tri par défaut groupe les lignes par **Catégories**, puis par **Nom**.

**Actions** (barre d'outils en haut à droite) :

- **Nouveau** (Manager+) — créer un nouveau processus métier.
- **Gérer les catégories** (Manager+) — ouvrir le dialogue de gestion des catégories.
- **Importer CSV** (Admin) — import en masse de processus depuis un fichier CSV.
- **Exporter CSV** (Admin) — exporter tous les processus en CSV.
- **Supprimer la sélection** (Admin) — supprimer une ou plusieurs lignes sélectionnées.

---

## L'espace de travail Processus métier

Cliquez sur n'importe quelle ligne de la liste — ou le bouton **Nouveau** — pour ouvrir l'espace de travail.

L'espace de travail comporte un seul onglet **Vue d'ensemble** à gauche, et une barre d'outils en haut :

- **Préc / Suiv** — naviguer entre les processus dans l'ordre de la liste actuelle.
- **Réinitialiser** — annuler les modifications non enregistrées.
- **Enregistrer** — persister les modifications.
- **Fermer** (icône X) — revenir à la liste en conservant vos filtres et tri intacts.

Si vous quittez la page avec des modifications non enregistrées, vous serez invité à enregistrer ou annuler.

### Vue d'ensemble

L'onglet Vue d'ensemble est organisé en trois sections.

**Informations de base**

- **Nom** (obligatoire) — utilisez un nom clair incluant le code court, par ex. « Order-to-Cash (O2C) » ou « Hire-to-Retire (H2R) ».
- **Description** — un bref résumé de ce que couvre le processus. Une bonne description capture les points de départ et d'arrivée (par ex. « De la commande client jusqu'à la livraison, la facturation et la réception du paiement. »).
- **Interrupteur de statut** : son libellé indique l'état actuel (**Activé** ou **Désactivé**). Les processus activés apparaissent dans les sélecteurs de l'application. Désactivez un processus pour le retirer sans le supprimer, afin que les références historiques restent intactes.

**Classification**

- **Catégories** (sélection multiple) — assignez une ou plusieurs catégories. Vous pouvez choisir parmi les catégories existantes, en créer une nouvelle en ligne avec **Nouvelle catégorie**, ou cliquer sur **Modifier les catégories** pour ouvrir le dialogue complet de gestion des catégories.
- **Responsable du processus** — l'utilisateur ultimement responsable du processus. Affiché dans la grille de la liste et disponible pour les futures notifications et approbations.
- **Responsable IT** — l'utilisateur responsable des systèmes et outils IT qui supportent ce processus.

**Détails**

- **Notes** — champ libre pour des informations internes telles que des liens vers des cartographies de processus, des procédures, des notes de périmètre ou des plans d'amélioration.

---

## Gérer les catégories

Les catégories sont partagées entre tous les processus métier. Vous pouvez les gérer depuis deux endroits :

1. Sur la page de la liste, cliquez sur **Gérer les catégories**.
2. Dans l'espace de travail, sous le champ **Catégories**, cliquez sur **Modifier les catégories**.

Les deux ouvrent le dialogue **Gérer les catégories de processus métier**.

**Ce que vous pouvez faire** :

- **Renommer** — modifiez le nom directement dans le champ texte.
- **Activer / Désactiver** — basculez si une catégorie apparaît dans les sélecteurs. Les catégories inactives sont masquées des nouvelles affectations mais préservées sur les processus existants.
- **Supprimer** — supprimez une catégorie. La suppression ne fonctionne que si aucun processus ne l'utilise ; sinon, vous verrez une erreur.
- **Nouvelle catégorie** — ajoutez une nouvelle ligne en haut du dialogue.

**Comportement d'enregistrement et d'annulation** :

- Rien n'est enregistré tant que vous ne cliquez pas sur **Enregistrer**. Tant que le dialogue est ouvert, toutes les modifications sont suivies localement.
- **Annuler** ferme le dialogue et annule tout ce que vous avez changé.
- Si une erreur survient à l'enregistrement (par ex. un nom en double ou une catégorie encore utilisée), le dialogue reste ouvert pour que vous puissiez corriger le problème.

---

## Import/export CSV

Utilisez l'import et l'export CSV pour l'intégration en masse ou la modification hors ligne de votre catalogue de processus. Les deux nécessitent un accès **Admin**.

### Export

Cliquez sur **Exporter CSV** sur la page de la liste. Vous pouvez exporter :

- Un **modèle** (ligne d'en-tête uniquement) à utiliser comme point de départ.
- Les **données** (tous les processus du tenant actuel).

Le fichier utilise des points-virgules (`;`) comme séparateurs et est encodé en UTF-8 avec BOM pour la compatibilité Excel.

**Colonnes** : `name`, `categories`, `description`, `notes`, `status`.

La colonne `categories` peut contenir plusieurs noms de catégories séparés par des points-virgules dans la cellule (par ex. `Client & Ventes; Finance & Contrôle de gestion`).

### Import

Cliquez sur **Importer CSV** sur la page de la liste, puis :

1. Téléchargez votre fichier CSV (doit correspondre aux en-têtes du modèle et utiliser `;` comme séparateur).
2. Lancez le **Contrôle préalable** — cela valide les en-têtes et les données, et montre combien de lignes seront créées vs mises à jour.
3. Si le contrôle réussit, cliquez sur **Charger** pour appliquer les modifications.

**Règles de correspondance** :

- Les lignes sont mises en correspondance par **Nom** (insensible à la casse). Un nom correspondant met à jour le processus existant ; un nouveau nom crée un nouveau processus.
- Chaque catégorie dans la cellule `categories` est nettoyée et mise en correspondance par nom. Si une catégorie n'existe pas encore, elle est créée automatiquement comme catégorie active.
- La colonne `status` définit l'état activé/désactivé. Les dates de cycle de vie ne sont pas importées — ajustez-les dans l'espace de travail si nécessaire.

**Conseil** : exportez d'abord vos données actuelles, modifiez le CSV et réimportez. Cela évite les doublons accidentels et garantit que vous travaillez à partir de l'état le plus récent.

---

## Conseils

- **Convention de nommage** — adoptez le format « Nom clair (CODE) » (par ex. « Order-to-Cash (O2C) ») pour que les processus soient faciles à chercher et reconnaissables en un coup d'œil.
- **Retirez, ne supprimez pas** — désactivez les processus que vous n'utilisez plus au lieu de les supprimer. Cela préserve les références historiques et les pistes d'audit.
- **Catégories d'abord** — mettez en place votre structure de catégories avant d'importer des processus en masse. L'import créera automatiquement les catégories manquantes, mais planifier à l'avance garde les choses ordonnées.
- **Responsable du processus tôt** — assigner un responsable du processus maintenant signifie que les données de responsabilité sont déjà en place lorsque de futures fonctionnalités comme les notifications et le routage de tâches seront disponibles.
