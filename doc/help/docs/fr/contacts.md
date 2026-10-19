# Contacts

Les contacts documentent les personnes avec lesquelles vous travaillez : responsables de compte fournisseur, ingénieurs support, consultants et autres parties prenantes externes. Liez les contacts aux fournisseurs pour constituer un répertoire de contacts fournisseurs, et référencez-les depuis les applications et les sites pour les informations de support.

## Premiers pas

Naviguez vers **Données de référence > Contacts** pour voir votre répertoire de contacts. Cliquez sur **Nouveau** pour créer votre première entrée.

**Champs obligatoires** :
- **Email** : L'adresse email du contact (utilisée comme identifiant unique)

**Fortement recommandé** :
- **Prénom** / **Nom** : Le nom du contact
- **Fournisseur** : Chez quel vendeur travaille ce contact
- **Type de contact** : Le rôle du contact chez le fournisseur (Commercial, Technique, Support ou Autre). Choisir un fournisseur le règle sur Commercial ; changez-le si besoin.

**Optionnel mais utile** :
- **Intitulé de poste** : Son rôle ou sa fonction
- **Téléphone** / **Mobile** : Numéros de téléphone, saisis avec un indicatif pays
- **Pays** : Localisation (code pays ISO)

**Conseil** : Liez d'abord les contacts aux fournisseurs, puis référencez-les depuis les applications et les sites pour des informations de support cohérentes.

---

## Travailler avec la liste

La grille Contacts fournit un répertoire consultable de tous les contacts externes. Chaque cellule d'une ligne est un lien cliquable qui ouvre la fiche du contact.

**Colonnes par défaut** :
- **Nom** / **Prénom** : Nom du contact
- **Fournisseur** : Le vendeur pour lequel il travaille
- **Email** : Adresse email
- **Actif** : Si le contact est actuellement actif (Oui / Non)

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **Intitulé de poste** : Son rôle
- **Téléphone** / **Mobile** : Numéros de téléphone
- **Pays** : Localisation
- **Créé** : Date de création de l'enregistrement

**Tri par défaut** : Par nom, alphabétique.

**Actions** :
- **Nouveau** : Créer un nouveau contact (nécessite `contacts:member`)
- **Importer CSV** : Import en masse de contacts (nécessite `contacts:admin`)
- **Exporter CSV** : Exporter en CSV (nécessite `contacts:admin`)
- **Supprimer la sélection** : Supprimer les contacts sélectionnés (nécessite `contacts:admin`). Ils sont retirés des fournisseurs, lignes budgétaires, contrats, applications, actifs, sites, projets et demandes qui les citent ; ces éléments restent

---

## La fiche contact

Cliquez sur une ligne pour ouvrir la fiche du contact. Chaque modification s'enregistre d'elle-même : il n'y a pas de bouton d'enregistrement.

**Titre** : le nom du contact. Cliquez dessus pour modifier le prénom et le nom côte à côte ; la modification s'enregistre quand vous quittez les deux champs ou appuyez sur Entrée, et Échap l'annule. Un contact sans nom affiche son e-mail à la place.

**En-tête**, sous le nom :
- **Fournisseur** : le fournisseur pour lequel travaille ce contact, sous forme de lien vers sa fiche. Un contact sans fournisseur affiche **Aucun fournisseur** : cliquez dessus pour ouvrir les propriétés et en choisir un.
- **Type de contact** : le rôle du contact chez le fournisseur : Commercial, Technique, Support ou Autre. Cliquez dessus pour en choisir un autre. Il apparaît dès que le contact a un fournisseur.
- **Statut** : **Actif** ou **Inactif**. Cliquez dessus pour le changer.
- **Lié à** : le nombre de fournisseurs, lignes budgétaires, contrats et autres éléments liés au contact. Cliquez dessus pour aller à la section **Lié à**.

**Propriétés** (le panneau de droite, ouvert par son onglet ou la touche `P`) :
- **Fournisseur** : choisissez le fournisseur dans la liste. Un contact qui a un fournisseur a toujours un type de contact : choisir un fournisseur pour un contact sans type lui donne **Commercial**, que vous pouvez changer aussitôt. Retirer le fournisseur retire aussi le type de contact.
- **Type de contact** : le même choix que dans l'en-tête.
- **E-mail** : obligatoire, et unique parmi vos contacts.
- **Fonction** : son rôle ou son poste.
- **Téléphone** / **Mobile** : un indicatif et un numéro. Choisissez l'indicatif dans la liste ou saisissez-le. Quand le contact n'a pas encore de pays, l'indicatif le renseigne.
- **Pays** : liste de pays avec recherche.

Les champs de texte s'enregistrent quand vous les quittez ou appuyez sur Entrée, les listes dès que vous choisissez. Une valeur que KANAP ne peut pas accepter (un e-mail invalide ou déjà utilisé par un autre contact, un téléphone qui n'est pas un indicatif suivi d'un numéro de 7 à 15 chiffres au total) affiche son message sous le champ et n'est pas enregistrée.

**Notes** : notes libres (jusqu'à 2 000 caractères), sous l'en-tête. Elles s'enregistrent un instant après la fin de la saisie, et quand vous quittez le champ.

Appuyez sur **Échap** ou cliquez sur le bouton de fermeture pour revenir à la liste.

### Lié à

La section **Lié à**, sous les notes, liste tout ce à quoi le contact est lié, une liste par type, chacune avec son nombre : fournisseurs, lignes budgétaires (OPEX et CAPEX, avec leur référence `BL-`), contrats, applications, actifs, sites, projets (`PRJ-`) et demandes (`REQ-`). Chaque ligne indique le rôle du contact : le type de contact pour les fournisseurs, les lignes budgétaires et les contrats, le rôle saisi sur l'application, l'actif ou le site.

Cliquez sur une ligne pour ouvrir sa fiche. Une liste montre jusqu'à 50 éléments et indique leur nombre total. Vous ne voyez que les listes que vous avez le droit de lire. Un contact lié à rien affiche une ligne qui le dit.

### Créer un contact

Cliquez sur **Nouveau** dans la liste. Renseignez l'e-mail (obligatoire) et les autres champs, puis cliquez sur **Créer**. Choisir un fournisseur règle le type de contact sur **Commercial**, que vous pouvez changer avant de créer. Vous revenez à la liste une fois le contact créé.

---

## Où les contacts sont utilisés

Les contacts apparaissent à plusieurs endroits dans KANAP. La section **Lié à** de la fiche contact les liste tous.

### Contacts fournisseur

Chaque fournisseur dispose d'un onglet **Contacts** affichant tous les contacts liés à ce vendeur. Vous pouvez créer un nouveau contact directement depuis l'espace de travail du fournisseur :

1. Ouvrez l'espace de travail du fournisseur et allez dans l'onglet **Contacts**.
2. Cliquez sur **Nouveau contact** à côté d'un type de contact.
3. Remplissez les détails du contact : le fournisseur et le type de contact sont pré-remplis.
4. Cliquez sur **Créer** : vous revenez à l'onglet **Contacts** du fournisseur.

### Support applicatif

Dans l'espace de travail Applications, l'onglet **Technique & Support** référence les contacts pour l'escalade du support.

### Support des technologies

Dans l'espace de travail Technologies, l'onglet **Exploitation** liste les contacts de support d'une technologie. Voir [Technologies](technologies.md#exploitation). Dans la section **Lié à** du contact, une technologie retirée vient en dernier, marquée **Désactivé**.

### Contacts de site

Les sites peuvent avoir des contacts de support (responsables d'installations, contacts NOC, etc.).

---

## Import/export CSV

Gérez les contacts en masse via CSV.

**Export** : Télécharge les contacts que la liste affiche avec leurs détails. Choisissez **Tout le référentiel** dans la fenêtre pour tous les contacts.

**Import** :
- Utilisez le **Contrôle préalable** pour valider avant d'appliquer
- Correspondance par adresse email
- Peut créer de nouveaux contacts ou mettre à jour les existants

**Champs obligatoires** : Email

**Champs optionnels** : `first_name`, `last_name`, `job_title`, `phone`, `mobile`, `country`, `notes`, `active`

**Notes** :
- Voir [Fichiers CSV](csv-files.md) pour l'encodage, le séparateur et les deux étapes d'import

---

## Conseils

- **Définissez toujours un fournisseur** : Lier les contacts aux fournisseurs les rend plus faciles à trouver et à gérer.
- **Définissez le type de contact** : Une fois qu'un fournisseur est lié, choisissez si le contact est Commercial, Technique, Support ou Autre. Cela aide lors de la navigation des contacts depuis l'espace de travail du fournisseur.
- **Utilisez des noms cohérents** : Saisissez les noms dans un format cohérent (par ex., toujours « Prénom Nom »).
- **Marquez les contacts inactifs** : Lorsqu'une personne quitte un vendeur, marquez-la comme inactive plutôt que de la supprimer. Cela préserve la piste d'audit.
- **Incluez les intitulés de poste** : Les intitulés de poste aident à identifier le bon contact selon les besoins (vente vs. support vs. gestion de compte).
