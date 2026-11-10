# Processus métier

Les processus métier vous permettent de construire et maintenir un catalogue centralisé des processus de bout en bout de votre organisation, comme Order-to-Cash, Procure-to-Pay ou Hire-to-Retire. En centralisant les noms de processus, leurs types, leurs responsables et leur hiérarchie, vous créez un point de référence unique que le reste de Kadratis peut exploiter pour la responsabilité, le reporting et les audits.

## Premiers pas

Naviguez vers **Données de référence > Processus métier** pour ouvrir la liste.

**Champs obligatoires** :

- **Nom** : le nom du processus, idéalement incluant un code court (par ex. « Order-to-Cash (O2C) »).

**Autorisations** :

- Consultation : `business_processes:reader`
- Création / modification : `business_processes:member`
- Suppression, import et export : `business_processes:admin`

Si la page est manquante ou les champs sont en lecture seule, demandez à votre administrateur d'ajuster vos autorisations de rôle.

---

## Travailler avec la liste

La liste affiche tous les processus métier de votre tenant.

**Colonnes par défaut** :

- **Nom** : le nom du processus. Cliquez pour ouvrir l'espace de travail. Décalé selon le niveau quand la liste est dans l'ordre de l'arborescence.
- **Type** : **Pilotage**, **Réalisation** ou **Support**, ou vide.
- **Processus parent** : le processus sous lequel il se trouve, ou vide pour un processus de premier niveau.
- **Responsable du processus** : l'utilisateur responsable du processus.

**Colonnes supplémentaires** (masquées par défaut ; activez-les avec le sélecteur de colonnes) :

- **Statut** : `activé` ou `désactivé`.
- **Mis à jour** : date de dernière modification du processus.

**Filtrage et tri** :

- La recherche rapide filtre sur toutes les colonnes visibles.
- Utilisez le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste pour choisir les processus affichés. Par défaut, la liste affiche les processus activés.
- **Type** et **Processus parent** utilisent des filtres à cases à cocher. Le filtre du type propose Pilotage, Réalisation, Support et Sans type (processus dont le type est vide). Le filtre du parent liste les processus qui ont des sous-processus.
- La liste s'ouvre dans l'ordre de l'arborescence : chaque processus est suivi de ses sous-processus. Cliquez sur un en-tête de colonne pour trier par cette colonne. Le décalage ne s'affiche que dans l'ordre de l'arborescence.

**Actions** (barre d'outils en haut à droite) :

- **Nouveau** (`business_processes:member`) : créer un nouveau processus métier. Voir [Créer un processus métier](#creating-a-business-process).
- **Importer** (Admin) : import en masse de processus depuis un fichier CSV ou un classeur Excel.
- **Exporter** (Admin) : exporter les processus que la liste affiche, ou tous les processus, dans un fichier CSV ou un classeur Excel.
- **Supprimer la sélection** (Admin) : supprimer une ou plusieurs lignes sélectionnées. Les sous-processus sont supprimés avant leur parent, donc sélectionner un processus avec tous ses sous-processus supprime toute la branche. Un processus utilisé par des applications ou des interfaces ne peut pas être supprimé : désactivez-le plutôt. Ce processus conserve son parent lorsque les deux étaient sélectionnés. Un processus qui a encore un sous-processus hors de la sélection ne peut pas être supprimé : déplacez-le ou supprimez-le d'abord. Avant toute suppression, la confirmation liste les processus conservés, avec la raison. Les demandes liées à un processus supprimé sont conservées, sans ce lien.

---

## Créer un processus métier { #creating-a-business-process }

1. Cliquez sur **Nouveau** dans la liste. La page du processus s'ouvre avec un titre vide dans l'en-tête. Le reste de la page est grisé.
2. Saisissez le nom du processus, idéalement avec son code court (par ex. « Order-to-Cash (O2C) »).
3. Appuyez sur Entrée, ou cliquez hors du titre. Kadratis crée le processus aussitôt, activé, et tous les onglets s'ouvrent.

Appuyez sur Échap dans le titre vide pour partir sans rien créer. Deux processus ne peuvent pas porter le même nom, quelle que soit la casse : un nom déjà utilisé est refusé, avec un message sous le titre.

Tant que le processus est en cours de création, son en-tête affiche **Créer** et **Annuler**. Ils restent jusqu'à ce que vous quittiez le processus.

- **Créer** conserve le processus et le ferme. Vous revenez à votre point de départ : la liste ou l'écran précédent. Avec un titre vide, rien ne se ferme et le titre en demande un.
- **Annuler** ferme sans rien conserver. Sur un processus déjà créé, il le supprime, avec les liens vers les applications que vous avez ajoutés. Si vous avez saisi plus que le nom, une confirmation liste ce qui sera supprimé. Vous pouvez annuler votre propre création sans le droit de supprimer des processus.

Si vous quittez le processus autrement, il est conservé.

---

## L'espace de travail Processus métier

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail. Chaque modification s'enregistre d'elle-même : une liste ou un sélecteur quand vous choisissez une valeur, un texte quand vous le quittez. **Enregistré** s'affiche brièvement dans l'en-tête.

L'en-tête contient :

- **Processus métier** (flèche de retour) : revenir à la liste en conservant vos filtres et votre tri.
- Le **nom** : cliquez dessus pour renommer le processus.
- Les flèches **précédent / suivant** : parcourir les processus dans l'ordre de la liste actuelle.
- **Statut** : **Activé** ou **Désactivé**. Les processus activés apparaissent dans les sélecteurs de l'application. Désactivez un processus pour le retirer sans le supprimer, afin que les références historiques restent intactes.
- **Supprimer** (icône corbeille, Admin) : supprimer le processus et revenir à la liste. Un processus utilisé par des applications ou des interfaces ne peut pas être supprimé : le message les compte. Désactivez-le plutôt. Un processus qui a des sous-processus ne peut pas non plus être supprimé : le message les compte. Déplacez-les ou supprimez-les d'abord.

Sans `business_processes:member`, la page s'ouvre en lecture seule.

### Propriétés

Le tiroir des propriétés, à droite, contient :

- **Type** : le type de processus ISO 9001, facultatif. Les processus de **Pilotage** orientent et dirigent l'organisation. Les processus de **Réalisation** apportent de la valeur aux clients. Les processus **Support** fournissent des ressources aux autres. Un sous-processus n'hérite pas du type de son parent.
- **Processus parent** : le processus sous lequel celui-ci se trouve. Les processus forment une arborescence sans limite de profondeur. Le sélecteur affiche l'arborescence avec un décalage par niveau et cherche sur le chemin complet. Le processus lui-même et ses sous-processus n'y figurent pas. Laissez vide pour le premier niveau. Un processus ne peut pas être son propre parent, ni passer sous l'un de ses propres sous-processus.
- **Responsable du processus** : l'utilisateur ultimement responsable du processus. Affiché dans la liste.
- **Responsable IT** : l'utilisateur responsable des systèmes et outils IT qui soutiennent le processus.
- **Cycle de vie** : l'interrupteur de statut et la date de fin de validité. Un processus dont la fin de validité est passée est désactivé.

### Vue d'ensemble

- **Description** : ce que couvre le processus, idéalement de son point de départ à son point d'arrivée (par ex. « De la commande client jusqu'à la livraison, la facturation et la réception du paiement »).
- **Notes** : informations internes telles que des liens vers des cartographies de processus, des procédures, des notes de périmètre ou des plans d'amélioration.

### Relations

La section **Applications** liste les applications qui soutiennent le processus, avec leur référence, leur criticité et leur responsable IT. **Ajouter** ouvre une recherche ; un lien s'enregistre aussitôt. Survolez une ligne et cliquez sur sa croix pour retirer le lien. L'application affiche le même lien dans la section **Processus métier** de son onglet Relations.

Il faut `business_processes:member` pour modifier les liens. L'onglet n'apparaît que si vous pouvez lire les applications. Un Business Contributor ne voit et ne lie que les applications de son périmètre.

### Historique

Les modifications apportées au processus, comme son type ou son parent, et à ses liens vers les applications. Voir [Historique des fiches](record-history.md).

---

## Import/export CSV

L'export écrit un fichier CSV ou un classeur Excel (`.xlsx`) : choisissez sous **Format** dans la fenêtre. L'import lit l'un ou l'autre. Voir [Fichiers CSV et Excel](csv-files.md).

Utilisez l'import et l'export pour l'intégration en masse ou la modification hors ligne de votre catalogue de processus. Les deux nécessitent un accès **Admin**.

### Export

Cliquez sur **Exporter** sur la page de la liste. Le fichier contient les processus que la liste affiche, avec sa recherche, ses filtres et son tri, ou tous les processus si vous choisissez **Tout le référentiel** dans la fenêtre. Pour un fichier vide avec les seuls en-têtes, utilisez **Télécharger le modèle** dans la fenêtre d'import.

Le séparateur suit la langue de votre écran. Voir [Fichiers CSV et Excel](csv-files.md) pour l'encodage, le séparateur et les deux étapes d'import.

**Colonnes** : `name`, `process_type`, `parent_name`, `description`, `notes`, `status`.

- `process_type` : `management`, `core` ou `support`, ou vide.
- `parent_name` : le nom du processus parent, ou vide pour le premier niveau.

### Import

Cliquez sur **Importer** sur la page de la liste, puis :

1. Téléversez votre fichier CSV ou votre classeur Excel avec les titres de colonnes du modèle. Dans un fichier CSV, les virgules comme les points-virgules conviennent.
2. Lancez le **Contrôle préalable** : cela valide les en-têtes et les données, et montre combien de lignes seront créées vs mises à jour.
3. Si le contrôle réussit, cliquez sur **Charger** pour appliquer les modifications.

**Règles de correspondance** :

- Les lignes sont mises en correspondance par **Nom**, quelle que soit la casse. Un nom correspondant met à jour le processus existant et garde le nom enregistré (la vérification préalable indique le processus rapproché) ; un nouveau nom crée un nouveau processus.
- `parent_name` est mis en correspondance par nom, quelle que soit la casse : un processus du même fichier ou un processus déjà présent dans Kadratis. Quand les deux existent, le fichier l'emporte. Les lignes peuvent venir dans n'importe quel ordre : les parents sont créés avant leurs enfants.
- Un nom de parent inconnu, un processus placé sous lui-même ou une boucle sont refusés, avec le numéro de la ligne.
- Le fichier n'a pas de colonne de fin de validité. Lors d'une mise à jour, un `status` vide, ou égal au statut actuel du processus, garde sa fin de validité. Un statut différent s'applique : `enabled` efface la fin de validité, et `disabled` termine le processus aujourd'hui, sauf si sa fin de validité est déjà passée. Un nouveau processus est activé, sauf si la ligne indique `disabled`.

**Conseil** : exportez d'abord vos données actuelles, modifiez le fichier et réimportez. Cela évite les doublons accidentels et garantit que vous travaillez à partir de l'état le plus récent.

---

## Conseils

- **Convention de nommage** : adoptez le format « Nom clair (CODE) » (par ex. « Order-to-Cash (O2C) ») pour que les processus soient faciles à chercher et reconnaissables en un coup d'œil.
- **Retirez, ne supprimez pas** : désactivez les processus que vous n'utilisez plus au lieu de les supprimer. Cela préserve les références historiques et les pistes d'audit.
- **Responsable du processus tôt** : assigner un responsable du processus maintenant signifie que les données de responsabilité sont déjà en place lorsque de futures fonctionnalités comme les notifications et le routage de tâches seront disponibles.
