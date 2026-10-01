# Contrats

Les contrats documentent vos accords fournisseurs — licences logicielles, contrats de maintenance, abonnements SaaS et accords de service. Suivez les dates clés, les coûts, les conditions de renouvellement et liez les contrats à vos postes OPEX et CAPEX pour une visibilité complète des coûts.

## Premiers pas

Naviguez vers **Gestion budgétaire > Contrats** pour voir votre registre de contrats. Cliquez sur **Nouveau** pour créer votre première entrée.

**Champs obligatoires** :

- **Nom** : Un nom de contrat reconnaissable
- **Fournisseur** : Le vendeur fournissant le service
- **Société** : Quelle société a signé le contrat

**Fortement recommandé** (à définir dans l'onglet Détails juste après la création) :

- **Date de début** : Quand le contrat commence
- **Durée** : Durée du contrat en mois
- **Montant annuel** : La valeur annuelle du contrat
- **Devise** : Devise du contrat
- **Renouvellement automatique** : Si le contrat se renouvelle automatiquement
- **Préavis** : Combien de mois de préavis sont nécessaires pour résilier

**Conseil** : Le système calcule automatiquement la date de fin et la date limite de résiliation à partir de la date de début, de la durée et du préavis.

---

## Travailler avec la liste

La grille Contrats fournit une vue d'ensemble de tous vos accords fournisseurs. Chaque ligne est un lien cliquable qui ouvre l'espace de travail du contrat, et votre contexte de recherche et de filtrage est préservé lorsque vous revenez.

**Colonnes par défaut** :

- **Contrat** : Nom du contrat (cliquez pour ouvrir l'espace de travail)
- **Fournisseur** : Le vendeur
- **Société** : L'entité contractante
- **Début** : Date de début du contrat
- **Durée (m)** : Durée en mois
- **Renouvellement auto.** : Si le contrat se renouvelle automatiquement (oui/non)
- **Préavis (m)** : Période de préavis en mois
- **Fin** : Date de fin calculée
- **Résilier avant** : Date limite de résiliation (date de fin moins préavis)
- **Montant annuel** : Valeur annuelle du contrat (formatée avec des séparateurs d'espaces)
- **Dev.** : Code devise
- **Facturation** : Fréquence de facturation (Mensuelle, Trimestrielle, Annuelle, Autre)
- **OPEX liés** : Nombre de postes OPEX liés (cliquez pour ouvrir l'espace de travail)
- **Statut** : **Activé** ou **Désactivé**, lu dans la fin de validité

**Colonnes supplémentaires** (via le sélecteur de colonnes) :

- **Tâche** : Dernière tâche pour ce contrat (statut et aperçu de la description)

**Tri par défaut** : Par date limite de résiliation croissante, pour que les contrats nécessitant une action rapide apparaissent en premier.

**Filtrage** :

- Recherche rapide : Recherche dans le nom du contrat, le fournisseur et la société
- Filtres de colonnes : Disponibles sur chaque en-tête de colonne. Le filtre **Statut** propose **Activé** et **Désactivé**. Cliquer sur **Effacer** dans ce filtre, ou décocher les deux valeurs, n'affiche plus rien, quel que soit le choix de **Afficher**
- **Périmètre par statut** : le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste. Par défaut, la liste affiche les contrats activés. Choisissez **Tous** ou **Désactivés** pour retrouver les contrats dont la fin de validité est passée

**Actions** :

- **Nouveau** : Créer un nouveau contrat (nécessite `contracts:manager`)
- **Importer CSV** : Import en masse de contrats (nécessite `contracts:admin`)
- **Exporter CSV** : Exporter en CSV (nécessite `contracts:admin`)

---

## L'espace de travail Contrats

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. L'en-tête affiche le nom du contrat, votre position dans la liste (par ex., « Contrat 3 sur 42 ») et les contrôles de navigation :

- **Préc / Suiv** : Naviguer entre les contrats sans revenir à la liste
- **Réinitialiser** : Annuler les modifications non enregistrées de l'onglet actuel
- **Enregistrer** : Persister vos modifications
- **Fermer** (icône X) : Revenir à la liste en préservant votre contexte de recherche et de filtre

L'espace de travail comporte quatre onglets verticaux : **Vue d'ensemble**, **Détails**, **Relations** et **Tâches**.

### Vue d'ensemble

L'onglet Vue d'ensemble capture l'identité et le statut du cycle de vie du contrat.

**Ce que vous pouvez modifier** :

- **Nom du contrat** : Le nom d'affichage utilisé dans les listes et rapports
- **Fournisseur** : Lien vers un fournisseur des données de référence
- **Société contractante** : Quelle société est partie au contrat
- **Responsable** : La personne chargée de gérer ce contrat
- **Notes** : Notes libres
- **Interrupteur de statut** : son libellé indique l'état actuel (**Activé** ou **Désactivé**). Passer le contrat à **Désactivé** sans date fixe sa fin de validité à aujourd'hui
- **Fin de validité** : la date à laquelle le contrat s'arrête. Saisissez une date au format jj/mm/aaaa ou utilisez le bouton calendrier. Laissez-la vide pour que le contrat reste actif indéfiniment

**Comment ça fonctionne** :

- Lors de la création d'un nouveau contrat, seul l'onglet Vue d'ensemble est disponible. Une fois enregistré, les onglets restants deviennent accessibles et vous êtes dirigé directement vers l'onglet Détails pour remplir les conditions financières.
- Nom, Fournisseur et Société sont obligatoires pour créer un contrat.

---

### Détails

L'onglet Détails capture les dates, conditions et informations financières.

**Ce que vous pouvez modifier** :

- **Date de début** : Quand le contrat commence (jj/mm/aaaa)
- **Durée (mois)** : Durée du contrat
- **Préavis (mois)** : Préavis de résiliation requis
- **Montant annuel** : La valeur annuelle du contrat à la signature
- **Devise** : Code devise à trois lettres (par ex., EUR, USD)
- **Fréquence de facturation** : Mensuelle, Trimestrielle, Annuelle ou Autre
- **Renouvellement automatique** : Si le contrat se renouvelle automatiquement

**Champs calculés** (lecture seule) :

- **Date de fin** : Date de début plus durée
- **Date limite de résiliation** : Date de fin moins période de préavis

---

### Relations

L'onglet Relations lie les contrats à d'autres entités de votre registre.

**Liens disponibles** :

- **Postes OPEX** : Coûts récurrents associés à ce contrat — utilisez la multi-sélection avec recherche pour trouver et lier des éléments par nom de produit
- **Postes CAPEX** : Postes de dépenses d'investissement liés à ce contrat — même interface de multi-sélection avec recherche
- **Contacts** : Personnes associées à ce contrat, chacune avec un rôle (Commercial, Technique, Support ou Autre). Les contacts hérités du fournisseur sont affichés avec un badge plein ; ceux ajoutés manuellement apparaissent avec un badge contour. Cliquez sur une ligne de contact pour ouvrir son profil.
- **Sites web pertinents** : Liens vers des documents externes comme les PDF de contrats ou les portails fournisseurs. Chaque lien a une description et une URL.
- **Pièces jointes** : Téléchargez des fichiers par glisser-déposer ou en utilisant le sélecteur de fichiers. Cliquez sur une pastille de pièce jointe pour la télécharger ; cliquez sur l'icône de suppression pour la retirer.

**Conseil** : Lier des postes OPEX et CAPEX aux contrats vous donne une traçabilité complète des coûts — des lignes budgétaires aux accords fournisseurs.

---

### Tâches

L'onglet Tâches gère les actions liées à ce contrat (par ex., revues de renouvellement, négociations de prix, vérifications de conformité).

**Liste des tâches** :

- Affiche toutes les tâches liées à ce contrat
- Colonnes : Titre, Statut, Priorité, Date d'échéance, Actions
- Cliquez sur un titre de tâche pour ouvrir l'espace de travail complet de la tâche

**Filtrage** :

- Cliquez sur l'icône de filtre pour afficher ou masquer les contrôles de filtre
- **Filtre de statut** : Tous, Actifs (masque terminées/annulées), ou un statut spécifique (Ouverte, En cours, En attente, En test, Terminée, Annulée)
- Cliquez sur le bouton d'effacement pour réinitialiser les filtres
- Le filtre par défaut affiche uniquement les tâches actives

**Créer une tâche** :

- Cliquez sur **Ajouter une tâche** pour ouvrir l'espace de travail de création de tâche
- La tâche est automatiquement liée à ce contrat
- Remplissez le titre, la description, la priorité, l'assigné et la date d'échéance dans l'espace de travail de la tâche

**Supprimer une tâche** :

- Cliquez sur l'icône de suppression dans la colonne Actions
- Confirmez la suppression dans le dialogue

**Remarque** : L'onglet Tâches n'est disponible qu'après le premier enregistrement du contrat. Si vous n'avez pas l'autorisation `contracts:manager`, les boutons Ajouter une tâche et Supprimer sont masqués.

---

## Import/export CSV

Maintenez votre registre de contrats synchronisé avec les systèmes externes via CSV.

**Export** : Télécharge tous les contrats avec les champs principaux et les dates calculées. La colonne `status` contient le statut lu dans la fin de validité.

**Import** :

- Utilisez le **Contrôle préalable** pour valider avant d'appliquer
- Une ligne correspond à un contrat par son nom et son fournisseur
- Supporte la création et les mises à jour
- Le fichier n'a pas de colonne de fin de validité. Lors d'une mise à jour, un `status` vide, ou égal au statut actuel du contrat, conserve sa fin de validité. Un statut différent l'applique : `enabled` efface la fin de validité, et `disabled` termine le contrat aujourd'hui, sauf si sa fin de validité est déjà passée
- Un nouveau contrat est activé sauf si la ligne indique `disabled`

**Notes** :

- Utilisez l'**encodage UTF-8** et les **points-virgules** comme séparateurs
- Les champs calculés (Date de fin, Date limite de résiliation) ne sont pas importés — ils sont calculés à partir de la Durée et de la Période de préavis

---

## Conseils

- **Surveillez la colonne Résilier avant** : La liste trie par défaut par date limite de résiliation, donc les contrats nécessitant une attention apparaissent en premier.
- **Liez aux OPEX et CAPEX tôt** : Connectez les contrats aux postes de coûts lors de leur création pour un suivi complet des coûts.
- **Utilisez les tâches pour les renouvellements** : Créez une tâche 3 à 6 mois avant la date limite de résiliation pour la revue de renouvellement.
- **Suivez les montants annuels** : Même si la facturation est mensuelle, enregistrez le montant annuel pour une comparaison plus facile d'année en année.
- **Liens profonds depuis la liste** : Vous pouvez partager un lien direct vers n'importe quel contrat — l'URL de l'espace de travail inclut l'ID du contrat et préserve votre contexte de liste (recherche, tri, filtres) pour que le bouton retour vous ramène exactement là où vous étiez.
