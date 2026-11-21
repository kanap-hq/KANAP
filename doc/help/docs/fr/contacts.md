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
- **Référence** : La référence attribuée par Kadratis (`CTCT-3`)
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

**Recherche rapide** : tapez une référence, comme `CTCT-3`, pour trouver ce contact. Des chiffres seuls cherchent dans le texte.

**Filtres de colonnes** : le filtre **Référence** accepte `CTCT-3` ou `3`.

**Actions** :
- **Nouveau** : Créer un nouveau contact (nécessite `contacts:member`)
- **Importer** : Import en masse de contacts (nécessite `contacts:admin`)
- **Exporter** : Exporter dans un fichier CSV ou un classeur Excel (nécessite `contacts:admin`)
- **Supprimer la sélection** : Supprimer les contacts sélectionnés (nécessite `contacts:admin`). Ils sont retirés des fournisseurs, lignes budgétaires, contrats, applications, actifs, sites, projets et demandes qui les citent ; ces éléments restent

---

## La fiche contact

Cliquez sur une ligne pour ouvrir la fiche du contact. Chaque modification s'enregistre d'elle-même : il n'y a pas de bouton d'enregistrement. Le bouton **Historique** de l'en-tête ouvre l'historique du contact dans un panneau latéral. Voir [Historique des fiches](record-history.md).

**Titre** : le nom du contact. Cliquez dessus pour modifier le prénom et le nom côte à côte ; la modification s'enregistre quand vous quittez les deux champs ou appuyez sur Entrée, et Échap l'annule. Un contact sans nom affiche son e-mail à la place.

**Référence** : la référence du contact (`CTCT-4`) s'affiche avant le nom. Cliquez dessus pour la copier.

**Adresse de la page** : l'adresse de la page utilise la référence, par exemple `/master-data/contacts/CTCT-4/overview`. L'ancienne adresse de la page d'un contact l'ouvre toujours, et laisse place à la nouvelle.

**En-tête**, sous le nom :
- **Fournisseur** : le fournisseur pour lequel travaille ce contact, sous forme de lien vers sa fiche. Un contact sans fournisseur affiche **Aucun fournisseur** : cliquez dessus pour ouvrir les propriétés et en choisir un.
- **Type de contact** : le rôle du contact chez le fournisseur : Commercial, Technique, Support ou Autre. Cliquez dessus pour en choisir un autre. Il apparaît dès que le contact a un fournisseur.
- **Statut** : **Actif** ou **Inactif**. Cliquez dessus pour le changer.
- **Lié à** : le nombre de fournisseurs, lignes budgétaires, contrats et autres éléments liés au contact. Cliquez dessus pour aller à la section **Lié à**.

**Propriétés** (le panneau de droite, ouvert par son onglet ou la touche `P`) :
- **Fournisseur** : choisissez le fournisseur dans la liste, ou tapez son nom ou sa référence (`SUP-12`). Un contact qui a un fournisseur a toujours un type de contact : choisir un fournisseur pour un contact sans type lui donne **Commercial**, que vous pouvez changer aussitôt. Retirer le fournisseur retire aussi le type de contact.
- **Type de contact** : le même choix que dans l'en-tête.
- **E-mail** : obligatoire, et unique parmi vos contacts.
- **Fonction** : son rôle ou son poste.
- **Téléphone** / **Mobile** : un indicatif et un numéro. Choisissez l'indicatif dans la liste ou saisissez-le. Quand le contact n'a pas encore de pays, l'indicatif le renseigne.
- **Pays** : liste de pays avec recherche.

Les champs de texte s'enregistrent quand vous les quittez ou appuyez sur Entrée, les listes dès que vous choisissez. Une valeur que Kadratis ne peut pas accepter (un e-mail invalide ou déjà utilisé par un autre contact, un téléphone qui n'est pas un indicatif suivi d'un numéro de 7 à 15 chiffres au total) affiche son message sous le champ et n'est pas enregistrée.

**Notes** : notes libres (jusqu'à 2 000 caractères), sous l'en-tête. Elles s'enregistrent un instant après la fin de la saisie, et quand vous quittez le champ.

Appuyez sur **Échap** ou cliquez sur le bouton de fermeture pour revenir à la liste.

**Supprimer**, une icône corbeille en haut à droite, est proposé aux administrateurs des contacts (`contacts:admin`). Après une confirmation, le contact est supprimé et retiré des fournisseurs, lignes budgétaires, contrats, applications, actifs, sites, projets et demandes qui le citent ; ces éléments restent. Vous revenez à la liste.

### Lié à

La section **Lié à**, sous les notes, liste tout ce à quoi le contact est lié, une liste par type, chacune avec son nombre : fournisseurs, lignes budgétaires (OPEX et CAPEX, avec leur référence `BL-`), contrats (`CTR-`), applications, actifs, sites, projets (`PRJ-`) et demandes (`REQ-`). Chaque ligne indique le rôle du contact : le type de contact pour les fournisseurs, les lignes budgétaires et les contrats, le rôle saisi sur l'application, l'actif ou le site.

Cliquez sur une ligne pour ouvrir sa fiche. Une liste montre jusqu'à 50 éléments et indique leur nombre total. Vous ne voyez que les listes que vous avez le droit de lire. Un contact lié à rien affiche une ligne qui le dit.

### Créer un contact

Cliquez sur **Nouveau** dans la liste. La page du nouveau contact s'ouvre. Saisissez le prénom et le nom côte à côte dans l'en-tête, puis l'e-mail. Le contact est créé quand vous quittez le champ e-mail avec un e-mail valide. Les numéros de téléphone doivent aussi être valides. Choisir un fournisseur règle le type de contact sur **Commercial**, que vous pouvez changer. Un contact lié à un fournisseur a besoin d'un type. Tous ses onglets deviennent alors disponibles, et les autres champs s'enregistrent automatiquement. Appuyez sur Échap dans le nom pour partir sans rien créer, même avec un nom saisi.

Tant que le contact est en cours de création, l'en-tête affiche **Créer** et **Annuler** jusqu'à ce que vous quittiez la page. **Ctrl+S** agit comme le bouton affiché. **Créer** enregistre le contact quand ses champs obligatoires sont renseignés et le laisse ouvert. S'il en manque un, son libellé passe en rouge et le curseur y va. Une fois le contact créé, **Créer** devient **Terminé** : il enregistre ce que vous êtes en train de saisir et vous ramène à votre point de départ, la liste, l'écran précédent ou le fournisseur depuis lequel vous l'avez commencé. **Annuler** part sans rien conserver. Sur un contact déjà créé, il le supprime. Si vous avez saisi plus que le nécessaire à la création, une confirmation liste ce qui sera supprimé. Vous pouvez annuler votre propre création sans le droit de supprimer des contacts. Si vous quittez la page autrement, le contact est conservé.

---

## Où les contacts sont utilisés

Les contacts apparaissent à plusieurs endroits dans Kadratis. La section **Lié à** de la fiche contact les liste tous.

### Contacts fournisseur

Chaque fournisseur dispose d'un onglet **Contacts** affichant tous les contacts liés à ce vendeur. Vous pouvez créer un nouveau contact directement depuis l'espace de travail du fournisseur :

1. Ouvrez l'espace de travail du fournisseur et allez dans l'onglet **Contacts**.
2. Cliquez sur **Nouveau contact** à côté d'un type de contact.
3. Remplissez les détails du contact : le fournisseur et le type de contact sont pré-remplis.
4. Cliquez sur **Créer**, puis sur **Terminé** : vous revenez à l'onglet **Contacts** du fournisseur.

### Support applicatif

Dans l'espace de travail Applications, l'onglet **Technique & Support** référence les contacts pour l'escalade du support.

### Support des technologies

Dans l'espace de travail Technologies, l'onglet **Exploitation** liste les contacts de support d'une technologie. Voir [Technologies](technologies.md#exploitation). Dans la section **Lié à** du contact, une technologie retirée vient en dernier, marquée **Désactivé**.

### Contacts de site

Les sites peuvent avoir des contacts de support (responsables d'installations, contacts NOC, etc.).

---

## Import/export CSV

L'export écrit un fichier CSV ou un classeur Excel (`.xlsx`) : choisissez sous **Format** dans la fenêtre. L'import lit l'un ou l'autre. Voir [Fichiers CSV et Excel](csv-files.md).

Gérez les contacts en masse avec des fichiers CSV ou des classeurs Excel.

**Export** : Télécharge les contacts que la liste affiche avec leur référence et leurs détails. Choisissez **Tout le référentiel** dans la fenêtre pour tous les contacts.

**Import** :
- Utilisez la **Vérification préalable** pour valider avant d'appliquer
- Peut créer de nouveaux contacts ou mettre à jour les existants
- **Correspondance par référence** : une `reference` remplie (`CTCT-4` ou `4`) désigne le contact que la ligne met à jour, même si son e-mail a changé. Le contact prend le nom et l'e-mail que donne la ligne. La vérification préalable signale chaque contact qui sera renommé ou changera d'adresse e-mail
- **Correspondance par e-mail** : quand `reference` est vide, ou que le fichier n'a pas cette colonne, la ligne est rapprochée par l'adresse e-mail
- **Référence inconnue** : une référence que votre espace de travail ne connaît pas refuse la ligne : « « CTCT-999 » n'est pas une référence de cet espace de travail. Laissez la cellule vide pour importer la ligne sans elle. » C'est le cas d'un fichier exporté d'un autre espace de travail
- **Changement d'e-mail** : un e-mail qu'un autre contact a déjà est refusé, et le message donne la référence de ce contact : « « ana@acme.example » appartient déjà à CTCT-7. »
- **Une ligne par contact** : deux lignes qui mettent à jour le même contact sont refusées : « Cette ligne met à jour CTCT-7, comme la ligne 3. Gardez une seule ligne par fiche. » Deux lignes qui créent le même contact (même e-mail, quelle que soit la casse) sont refusées aussi : « Mêmes valeurs dans email qu'à la ligne 3. »

- **Cellules vides et `-`** : sur un contact que le fichier met à jour, une cellule vide garde la valeur enregistrée et `-` l'efface. `-` efface les noms, `job_title`, `phone`, `mobile`, `country` et `notes`. Il ne peut pas effacer `reference`, `email` ni `active` : la ligne est refusée. Voir [Cellules vides et `-`](csv-files.md#empty-cells-and-clearing)

**Colonnes du fournisseur** :
- `supplier_name` définit le fournisseur du contact, par sa référence (`SUP-12`) ou son nom. Les noms sont retrouvés comme le décrit [Noms des fiches](csv-files.md#names-of-records) : un nom retrouvé avec d'autres accents est listé à la vérification, et vous pouvez défaire le rapprochement. Un nom qui ne correspond à aucun fournisseur, ou à plusieurs, refuse la ligne. L'import ne crée jamais de fournisseur
- `supplier_role` est le type de contact pour ce fournisseur : `commercial`, `technical`, `support` ou `other`, ou le mot qu'affiche la page du contact, dans l'une des quatre langues. Vide, le contact garde son type, et un contact qui n'en a pas reçoit **Commercial**, comme sur la page du contact
- Un `supplier_name` vide garde le fournisseur. `-` retire le fournisseur et son type de contact. `-` dans `supplier_role` seul est refusé, de même qu'un type sur un contact sans fournisseur
- Un changement de fournisseur fait ce que fait le choix du fournisseur sur la page du contact
- L'export et le modèle contiennent les deux colonnes

**Champs obligatoires** : `email`, pour un nouveau contact

**Champs optionnels** : `reference`, `first_name`, `last_name`, `job_title`, `phone`, `mobile`, `country`, `supplier_name`, `supplier_role`, `notes`, `active`

**Notes** :
- Voir [Fichiers CSV et Excel](csv-files.md) pour l'encodage, le séparateur et les deux étapes d'import

---

## Conseils

- **Définissez toujours un fournisseur** : Lier les contacts aux fournisseurs les rend plus faciles à trouver et à gérer.
- **Définissez le type de contact** : Une fois qu'un fournisseur est lié, choisissez si le contact est Commercial, Technique, Support ou Autre. Cela aide lors de la navigation des contacts depuis l'espace de travail du fournisseur.
- **Utilisez des noms cohérents** : Saisissez les noms dans un format cohérent (par ex., toujours « Prénom Nom »).
- **Marquez les contacts inactifs** : Lorsqu'une personne quitte un vendeur, marquez-la comme inactive plutôt que de la supprimer. Cela préserve la piste d'audit.
- **Incluez les intitulés de poste** : Les intitulés de poste aident à identifier le bon contact selon les besoins (vente vs. support vs. gestion de compte).
