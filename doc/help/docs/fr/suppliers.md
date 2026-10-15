# Fournisseurs

Les fournisseurs (également appelés vendeurs) représentent les entreprises auprès desquelles vous achetez des logiciels, des services et du support. Liez les fournisseurs aux applications, contrats et lignes OPEX pour suivre les relations fournisseurs et les dépenses dans votre portefeuille IT.

## Premiers pas

Naviguez vers **Données de référence > Fournisseurs** pour ouvrir le répertoire des fournisseurs. Cliquez sur **Nouveau** pour créer votre première entrée.

**Champs obligatoires** :
- **Nom** : Le nom du fournisseur ou du vendeur

**Optionnel mais utile** :
- **ID fournisseur ERP** : Identifiant de référence de votre ERP ou système d'approvisionnement
- **Notes** : Notes libres sur la relation fournisseur

**Conseil** : Créez les fournisseurs avant d'ajouter des applications ou des contrats — vous pourrez les lier lors de la création.

---

## Travailler avec la liste

La liste des fournisseurs vous offre un répertoire consultable et triable de tous vos vendeurs.

**Colonnes par défaut** :
- **Nom** : Nom du fournisseur (cliquez pour ouvrir la fiche du fournisseur)
- **ID fournisseur ERP** : Identifiant de référence des systèmes externes

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **Statut** : Activé ou Désactivé
- **Notes** : Informations complémentaires
- **Créé** : Date de création de l'enregistrement

Chaque cellule d'une ligne est cliquable et ouvre la fiche du fournisseur.

**Tri par défaut** : Par nom, alphabétique. Le tri d'une colonne de texte ignore la casse et les accents.

**Filtrage** :
- Recherche rapide : Recherche dans les champs du fournisseur
- Filtre de statut : Utilisez le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la grille pour filtrer par statut. Par défaut, la liste affiche les fournisseurs activés

**Actions** :
- **Nouveau** : Créer un nouveau fournisseur (nécessite `suppliers:manager`)
- **Importer CSV** : Import en masse de fournisseurs (nécessite `suppliers:admin`)
- **Exporter CSV** : Exporter la liste en CSV (nécessite `suppliers:admin`)
- **Supprimer la sélection** : Supprimer les fournisseurs sélectionnés (nécessite `suppliers:admin`)

---

## La fiche fournisseur

Cliquez sur une ligne pour ouvrir la fiche du fournisseur. Utilisez les flèches en haut, ou les touches fléchées gauche et droite, pour passer d'un fournisseur à l'autre sans revenir à la liste. Chaque modification s'enregistre d'elle-même : il n'y a pas de bouton d'enregistrement.

La fiche comporte deux onglets : **Vue d'ensemble** et **Contacts**.

**Titre** : le nom du fournisseur. Cliquez dessus pour le modifier ; la modification s'enregistre quand vous quittez le champ ou appuyez sur Entrée, et Échap l'annule. Le nom est obligatoire et doit différer de celui de tous les autres fournisseurs, quelle que soit la casse (`SAP` et `sap` sont le même nom) : KANAP affiche le message sous le nom et garde le nom enregistré.

**Référence** : l'ID fournisseur ERP, quand le fournisseur en a un, s'affiche avant le nom. Cliquez dessus pour le copier.

**En-tête**, sous le nom :
- **Statut** : **Activé** ou **Désactivé**. Cliquez dessus pour le changer. Choisir **Désactivé** désactive le fournisseur aussitôt : la fin de validité devient l'heure actuelle.
- **Contacts** : le nombre de contacts liés au fournisseur. Cliquez dessus pour ouvrir l'onglet **Contacts**.
- **Lié à** : le nombre de lignes budgétaires, contrats, applications et actifs liés au fournisseur. Cliquez dessus pour aller à la section **Lié à** de l'onglet **Vue d'ensemble**.

**Propriétés** (le panneau de droite, ouvert par son onglet ou la touche `P`) :
- **ID fournisseur ERP** : l'identifiant du fournisseur dans votre ERP ou votre système d'achats. Il s'enregistre quand vous quittez le champ ou appuyez sur Entrée.
- **Cycle de vie** : l'interrupteur de statut et la date de **Fin de validité**. Laissez la date vide pour que le fournisseur reste actif sans limite, ou saisissez une date future pour programmer sa fin.

**Notes** : des notes libres sur le fournisseur, dans l'onglet **Vue d'ensemble**. Elles s'enregistrent un instant après la fin de la saisie, et quand vous quittez le champ.

La modification requiert la permission `suppliers:manager`. Les utilisateurs en lecture seule voient la même fiche sans pouvoir la modifier.

Appuyez sur **Échap** ou cliquez sur le bouton de fermeture pour revenir à la liste.

### Contacts

L'onglet **Contacts** liste les contacts liés à ce fournisseur par type de contact :

| Type de contact | Usage |
|------|---------|
| **Commercial** | Contacts commerciaux et gestion de compte |
| **Technique** | Contacts d'ingénierie et de support technique |
| **Support** | Contacts du helpdesk et du support client |
| **Autre** | Tout contact qui n'entre pas dans les types ci-dessus |

**Fonctionnement** :
- Chaque section liste ses contacts par nom. Cliquez sur un nom pour ouvrir la fiche du contact.
- **Ajouter un existant** : recherchez un contact par son nom et choisissez-le. Le lien s'enregistre aussitôt.
- **Nouveau contact** : ouvre le formulaire de contact avec le fournisseur et le type de contact déjà remplis. KANAP vous ramène à cet onglet une fois le contact créé.
- Le bouton corbeille retire le lien. Le contact lui-même reste dans vos contacts.

**Conseil** : gardez au moins un contact par fournisseur pour que la communication avec lui soit toujours à portée de clic.

### Lié à

La section **Lié à**, sous les notes de l'onglet **Vue d'ensemble**, liste ce qui fait référence à ce fournisseur, une liste par type, chacune avec son nombre :

- **Lignes budgétaires** : les lignes OPEX et CAPEX dont il est le fournisseur, avec leur référence (`BL-12`) et leur type.
- **Contrats** : les contrats passés avec ce fournisseur.
- **Applications** : les applications dont il est l'éditeur.
- **Actifs** : les actifs dont il assure le support (le fournisseur de support de l'actif).

Cliquez sur une ligne pour ouvrir sa fiche. Les éléments désactivés portent la mention **Désactivé** et viennent après les autres. Une liste montre jusqu'à 50 éléments et indique leur nombre total. Au-delà de 50, les lignes budgétaires, les contrats et les applications ont un lien comme **Voir les 57** qui ouvre leur liste filtrée sur ce fournisseur. Vous ne voyez que les listes que vous avez le droit de lire : un utilisateur sans accès aux contrats ne voit pas la liste des contrats. Un fournisseur que rien n'utilise affiche une ligne qui le dit.

Consultez cette section avant de désactiver ou de supprimer un fournisseur.

### Créer un fournisseur

Cliquez sur **Nouveau** dans la liste. Renseignez le nom (obligatoire), l'ID fournisseur ERP et les notes, puis cliquez sur **Créer**. Le fournisseur est créé activé et sa fiche s'ouvre, avec l'onglet **Contacts** disponible.

---

## Import/export CSV

**Exporter CSV** télécharge tous les fournisseurs avec leurs informations actuelles. **Importer CSV** relit un fichier. La fenêtre d'import propose aussi **Télécharger le modèle** : un fichier avec les seuls en-têtes.

Les colonnes :

| Colonne | Contenu |
|---|---|
| `name` | Obligatoire. Le nom du fournisseur. Les lignes sont rapprochées par ce nom |
| `erp_supplier_id` | L'ID du fournisseur dans votre ERP |
| `commercial_contact` | L'e-mail d'un contact. Le chargement rattache le fournisseur au contact portant cet e-mail, et le crée lorsque l'espace de travail n'en a aucun |
| `technical_contact` | L'e-mail d'un contact, comme ci-dessus |
| `support_contact` | L'e-mail d'un contact, comme ci-dessus |
| `notes` | Texte libre |
| `status` | `enabled` ou `disabled` |

**Import** :

- Utilisez la **Vérification préalable** pour valider le fichier avant de l'appliquer, puis **Charger**
- Les lignes sont rapprochées par `name`, quelle que soit la casse : une ligne met à jour le fournisseur qu'elle nomme, toute autre ligne en crée un
- `name` est obligatoire. Toute autre cellule est facultative

**Notes** :
- Voir [Fichiers CSV](csv-files.md) pour l'encodage, le séparateur et les deux étapes d'import
- Importez les fournisseurs avant les applications ou les contrats qui les référencent. Le fichier budgétaire crée aussi un fournisseur manquant lorsque **Créer les fournisseurs manquants** est cochée. Voir [Charger un budget depuis un tableur](budget-file.md)

---

## Conseils

- **Soyez cohérent dans les noms** : Utilisez les noms officiels des vendeurs (par ex., « Microsoft Corporation » plutôt que « MS » ou « MSFT ») pour éviter les doublons.
- **Ajoutez les ID ERP tôt** : Si vous utilisez un ERP, enregistrer l'identifiant fournisseur facilite les recoupements.
- **Désactivez plutôt que supprimer** : Lorsque vous cessez de travailler avec un vendeur, désactivez-le au lieu de le supprimer pour préserver les données historiques dans les contrats et applications.
- **Organisez les contacts par rôle** : Utilisez les quatre catégories de rôle pour permettre aux collègues de trouver facilement la bonne personne chez chaque vendeur.
- **Créez avant de lier** : Ajoutez les fournisseurs aux données de référence avant de créer les applications ou contrats qui les référencent.
