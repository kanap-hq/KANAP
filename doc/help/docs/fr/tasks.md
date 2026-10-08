# Tâches

Les Tâches vous aident à suivre les actions, les livrables et les lots de travail à travers vos entités KANAP. Elles servent pour les rappels de renouvellement, les relances, les contrôles de conformité, les livrables de projet et tout autre travail nécessitant un suivi.

## Premiers pas

Rendez-vous dans **Portefeuille > Tâches** pour voir toutes les tâches de votre organisation. Cliquez sur **Nouvelle** pour créer une tâche.

### Créer une nouvelle tâche

Lorsque vous cliquez sur **Nouvelle**, l'espace de travail complet de la tâche s'ouvre. Pour créer une tâche :

1. **Saisissez le titre** (obligatoire) :
   - Tapez le titre de la tâche dans le champ texte en haut

2. **Choisissez le contexte** :
   - **Tâche autonome** (par défaut) : Gardez « Lié à » sur **Autonome**
   - **Tâche liée** : Sélectionnez **Projet**, **OPEX**, **Contrat** ou **CAPEX**, puis choisissez l'élément spécifique

3. **Remplissez les détails optionnels** :
   - **Type de tâche** : Sélectionnez une catégorie pour le travail (ex. : Tâche, Bug, Problème, Incident). Par défaut « Tâche » lorsque disponible
   - **Description** : Ajoutez des informations détaillées avec l'éditeur markdown (prend en charge formatage, listes, liens, images)
   - **Phase** : Pour les tâches de projet, sélectionnez une phase ou laissez sur « Niveau projet »
   - **Classification** (tâches autonomes et de projet) : Définissez **Source**, **Catégorie**, **Stream** et **Société**. Pour les tâches de projet, ces valeurs proviennent par défaut du projet parent. Pour les tâches autonomes, les valeurs de classification par défaut de votre organisation sont pré-remplies lorsque disponibles
   - **Statut** : Par défaut sur **Ouverte**
   - **Priorité** : Par défaut sur **Normale**
   - **Dates** : Définir les dates de début et d'échéance
   - **Assignée à** : Par défaut sur vous ; modifier si nécessaire

4. Cliquez sur **Créer** lorsque vous êtes prêt (activé une fois le titre défini). Vous pouvez également appuyer sur **Ctrl+S** (ou **Cmd+S** sur Mac)

**Conseil** : Vous pouvez coller des images directement dans la description. Elles sont téléversées vers le stockage automatiquement lorsque vous créez la tâche.

**Note** : Les tâches peuvent également être créées depuis d'autres espaces de travail (postes OPEX, Contrats, postes CAPEX, Projets du portefeuille) où la relation est pré-sélectionnée.

**Champs obligatoires** :
  - **Titre** : Une courte description de ce qui doit être fait

**Fortement recommandé** :
  - **Description** : Description détaillée de la tâche
  - **Assignée à** : Qui est responsable
  - **Date d'échéance** : Quand cela doit être terminé

---

## Où la trouver

- Chemin : **Portefeuille > Tâches**
- Autorisations :
  - Vous avez besoin d'au moins `tasks:reader` pour consulter les tâches
  - Vous avez besoin de `tasks:member` pour créer des tâches et modifier des tâches dans les contextes autonome/OPEX/Contrat/CAPEX
  - Vous avez besoin de `portfolio_projects:contributor` pour enregistrer une tâche lorsque le contexte cible est un projet
  - Vous avez besoin de `tasks:admin` pour la suppression en masse, l'import CSV et l'export CSV

Si vous ne voyez pas Tâches dans le menu, demandez à votre administrateur de vous accorder les autorisations appropriées.

---

## Travailler avec la liste

La grille Tâches affiche toutes les tâches de votre organisation.

**Filtre de périmètre en haut** :
  - **Mes tâches** : tâches qui vous sont assignées ou que vous avez créées
  - **Tâches de mon équipe** : tâches assignées à tout membre de votre équipe Portefeuille (y compris les vôtres)
  - **Toutes les tâches** (par défaut) : la grille complète des tâches
  - Si vous n'êtes pas assigné à une équipe Portefeuille, **Tâches de mon équipe** est désactivé
  - La page s'ouvre sur **Toutes les tâches**. Votre sélection est mémorisée entre les sessions ; revenir sur la page restaure votre dernier choix

**Colonnes par défaut** (visibles par défaut) :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **#** | Référence de l'élément (ex. : T-42). Cliquez pour ouvrir l'espace de travail |
| **Titre de la tâche** | Le nom de la tâche. Cliquez pour ouvrir l'espace de travail |
| **Type de tâche** | Le type de travail (ex. : Tâche, Bug, Problème, Incident) |
| **Contexte** | Le type d'entité (Projet, OPEX, Contrat, CAPEX ou « Autonome ») |
| **Statut** | État actuel avec un point coloré |
| **Score** | Score de priorité calculé |
| **Assignée à** | Personne assignée |
| **Classification** | Catégorie du portefeuille |
| **Stream** | Stream du portefeuille |

**Colonnes supplémentaires** (masquées par défaut ; activez via le menu de colonnes) :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **Entrée liée** | Le nom de l'entité liée (vide pour les tâches autonomes) |
| **Phase** | Phase du projet (pour les tâches de projet) |
| **Priorité** | Niveau de priorité |
| **Date d'échéance** | Quand la tâche est due |
| **Créée** | Quand la tâche a été créée |
| **Dernière modification** | Quand la tâche a été mise à jour pour la dernière fois |
| **Description** | Texte de description de la tâche |
| **Source** | Classification source du portefeuille |
| **Société** | Classification société |

**Couleurs de statut** :
  - **Ouverte** : Gris
  - **En cours** : Bleu
  - **En attente** : Orange
  - **En test** : Violet
  - **Terminée** : Vert
  - **Annulée** : Rouge

**Couleurs de priorité** :
  - **Bloquant** : Rouge
  - **Haute** : Orange
  - **Normale** : Gris
  - **Basse** : Bleu
  - **Optionnelle** : Vert

**Filtre par défaut** : Les tâches actives sont affichées par défaut (`Ouverte`, `En cours`, `En attente`, `En test`). Incluez `Terminée` et `Annulée` dans le filtre Statut pour voir les tâches fermées.

**Actions** :
  - **Nouvelle** : Créer une tâche autonome (nécessite `tasks:member`)
  - **Import CSV** : Téléverser un fichier CSV pour créer ou mettre à jour des tâches (nécessite `tasks:admin`)
  - **Export CSV** : Télécharger les tâches dans un fichier CSV (nécessite `tasks:admin`)
  - **Supprimer la sélection** : Supprimer les tâches sélectionnées (nécessite `tasks:admin`)

---

## L'espace de travail Tâche

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail de la tâche. L'espace de travail place le contenu de la tâche (description, pièces jointes, activité) au centre et expose un tiroir **Propriétés** sur le bord droit que vous pouvez afficher ou masquer.

### Barre d'outils de l'en-tête

L'en-tête contient :
  - Fil d'Ariane **Retour** vers **Tâches** (ou vers l'espace de travail du projet d'origine, si vous venez de l'un d'eux)
  - **Indicateur de position** : Votre position dans la liste filtrée (ex. : « 3 sur 12 ») avec flèches **Précédent** / **Suivant**
  - **Envoyer le lien** : Envoyer un lien vers la tâche par e-mail
  - **Convertir en demande** : Promouvoir la tâche en demande de portefeuille
  - **Supprimer** : Supprimer la tâche, avec ses commentaires et son historique (nécessite `tasks:admin`). Vous confirmez d'abord, et la suppression est définitive
  - **Fermer** : Retourner à la liste des tâches

Sous la barre d'outils, le bloc de titre affiche :
  - **Pastille de référence d'élément** (ex. : T-42) : Cliquez pour copier la référence dans votre presse-papiers
  - **Titre** : Cliquez pour modifier en ligne (nécessite `tasks:member`)
  - **Statut / Priorité / Score / Assignée à / Date d'échéance** sous forme de pastilles compactes et cliquables de métadonnées
  - **Pastille Projet** pour les tâches de projet (lien vers l'espace de travail du projet)

### Zone de contenu principale

**Description** : Un éditeur markdown qui prend en charge le formatage, les listes, les liens, les blocs de code et les images. Vous pouvez coller des images directement ; elles se téléversent automatiquement. Appuyer sur **Tab** depuis le champ titre saute dans l'éditeur de description. La description s'enregistre automatiquement quelques secondes après que vous arrêtez de taper ; l'en-tête affiche brièvement **Enregistré** à chaque persistance.

**Pièces jointes** : Glissez-déposez des fichiers sur la description, ou utilisez la zone de téléversement lorsqu'elle apparaît. Les fichiers téléversés apparaissent comme des pastilles sous la description. Cliquez sur une pastille pour télécharger ; cliquez sur le bouton **x** pour supprimer (nécessite l'autorisation de modification). Maximum 20 Mo par fichier.

**Section Activité** : Basculez entre trois vues :
  - **Commentaires** : Un formulaire d'activité unifié (commentaire + changement de statut optionnel + saisie de temps optionnelle en une seule soumission) plus le fil de commentaires
  - **Historique** : Tous les changements de champs et de statut pour la tâche, avec horodatages et auteurs
  - **Journal de temps** : Entrées de temps (disponible pour les tâches autonomes et de projet uniquement)

### Tiroir des propriétés

Le tiroir est rétractable (cliquez sur l'onglet vertical **Propriétés** sur le bord droit pour ouvrir ou fermer ; appuyez sur **P** comme raccourci). Sa largeur et son état d'ouverture sont mémorisés localement. Le tiroir contient quatre groupes, séparés par des séparateurs :

**Contexte** :
  - **Lié à** : Autonome, Projet, OPEX, Contrat ou CAPEX. Vous pouvez changer le type et choisir un nouvel élément ; à l'enregistrement, KANAP applique tous les effets secondaires associés (voir [Changer le contexte d'une tâche](#changer-le-contexte-dune-tache))
  - **Phase** (tâches de projet uniquement) : Par défaut sur **Niveau projet** sauf si vous choisissez une phase de projet
  - **Type de tâche** : Tâche, Bug, Problème, Incident, ou tout type personnalisé configuré par votre administrateur

**Classification** (tâches autonomes et de projet uniquement) :
  - **Source** : Où le travail provient
  - **Catégorie** : La catégorie du portefeuille pour le travail
  - **Stream** : Le stream spécifique au sein de la catégorie (filtré par catégorie sélectionnée ; désactivé tant qu'une catégorie n'est pas sélectionnée)
  - **Société** : La société à laquelle ce travail se rapporte
  - Pour les tâches OPEX/Contrat/CAPEX, cette section est masquée sauf si des valeurs de classification ont été précédemment définies

**Personnes** :
  - **Demandeur** : Qui a demandé le travail (par défaut sur le créateur)
  - **Observateurs** : Personnes supplémentaires qui devraient voir la tâche

**Suivi** :
  - **Date de début**
  - **Temps passé** : Temps total enregistré, avec un raccourci **+ Enregistrer du temps**
  - **Applications** : Apps et services auxquels cette tâche se rapporte
  - **Actifs** : Actifs matériels/cloud auxquels cette tâche se rapporte
  - **Connaissances** : Documents de connaissances liés et un raccourci pour en créer de nouveaux (nécessite `knowledge:member` pour la création)

**Note** : Modifier les champs dans le tiroir enregistre immédiatement. Il n'y a pas de bouton Enregistrer sur le tiroir.

### Changer le contexte d'une tâche

Lorsque vous changez le contexte d'une tâche et enregistrez, KANAP applique le changement en une seule opération (contexte plus toutes les autres modifications éditées ensemble).

- **Projet vers Autonome** : La phase est effacée, la classification est conservée
- **Projet vers OPEX/Contrat/CAPEX** : La phase et la classification sont effacées
- **Toute vers Projet** :
  - L'autorisation projet est requise (`portfolio_projects:contributor`)
  - La phase est réinitialisée à niveau projet sauf si vous choisissez une phase valide pour ce projet
  - La classification existante est conservée ; les valeurs manquantes sont remplies automatiquement à partir des valeurs par défaut du projet

---

## Statuts de tâche

| Statut | Signification | Quand l'utiliser |
|--------|---------------|------------------|
| **Ouverte** | Pas encore commencée | Par défaut pour les nouvelles tâches |
| **En cours** | Le travail a commencé | Quand quelqu'un commence à travailler dessus |
| **En attente** | En attente de quelqu'un d'autre | Quand l'assigné est bloqué et a besoin d'une entrée/décision |
| **En test** | Prête pour validation | Quand l'implémentation est terminée et en attente de revue/test |
| **Terminée** | Complétée avec succès | Quand le travail est terminé (nécessite du temps enregistré pour les tâches de projet) |
| **Annulée** | Plus nécessaire | Quand la tâche devient hors de propos |

**Important** : Pour les tâches de projet, vous ne pouvez pas marquer une tâche comme **Terminée** tant que vous n'avez pas enregistré au moins un peu de temps. Cela garantit un suivi précis de la charge.

---

## Niveaux de priorité

| Priorité | Cas d'utilisation |
|----------|-------------------|
| **Bloquant** | Bloque d'autres travaux ; attention immédiate requise |
| **Haute** | Important et sensible au temps |
| **Normale** | Priorité standard (par défaut) |
| **Basse** | Peut être différée si nécessaire |
| **Optionnelle** | Bon à avoir, à traiter quand la capacité le permet |

---

## Suivi du temps

Les tâches autonomes et les tâches de projet prennent en charge un suivi détaillé du temps via le Journal de temps. Le suivi du temps n'est pas disponible pour les tâches OPEX, Contrat ou CAPEX.

### Enregistrer du temps

1. Cliquez sur **+ Enregistrer du temps** dans le tiroir Propriétés (groupe Suivi), ou ouvrez l'onglet **Journal de temps** dans la section activité
2. Sélectionnez la **Catégorie** : IT ou Métier (détermine comment le temps contribue à la charge du projet)
3. Saisissez la date à laquelle le travail a été effectué
4. Saisissez le temps en jours et/ou heures
5. Ajoutez des notes optionnelles décrivant le travail
6. Cliquez sur **Enregistrer le temps**

**Catégorie** : Pour les tâches de projet, la catégorie détermine si le temps compte pour la charge IT ou la charge Métier du projet. Cela correspond au système d'enregistrement du temps du projet lui-même.

### Consulter les entrées de temps

L'onglet **Journal de temps** dans la section activité affiche toutes les entrées de temps pour la tâche :
  - Date à laquelle le travail a été effectué
  - Catégorie (IT ou Métier)
  - Personne qui a enregistré le temps
  - Heures enregistrées
  - Notes

### Modifier ou supprimer des entrées

Vous pouvez modifier ou supprimer vos propres entrées de temps depuis le tableau Journal de temps.

---

## Pièces jointes

Les tâches prennent en charge les pièces jointes pour documents, captures d'écran et autres fichiers de support.

### Ajouter des pièces jointes

- Glissez-déposez des fichiers sur la zone de description, ou
- Cliquez sur **Parcourir les fichiers** dans la zone de téléversement lorsqu'elle est visible
- Les fichiers apparaissent comme des pastilles sous la description une fois téléversés

**Limite de taille de fichier** : Maximum 20 Mo par fichier.

### Gérer les pièces jointes

- **Télécharger** : Cliquez sur une pastille de pièce jointe pour télécharger le fichier
- **Supprimer** : Cliquez sur le bouton **x** sur la pastille pour supprimer la pièce jointe (nécessite l'autorisation de modification)

Les pièces jointes sont visibles à toute personne pouvant consulter la tâche.

---

## Import et export de description

Le champ description prend en charge l'import et l'export de documents afin que vous puissiez travailler avec du contenu en dehors de KANAP.

### Importer un document

1. Ouvrez un espace de travail de tâche existant (l'import n'est pas disponible pendant la création de la tâche)
2. Cliquez sur le bouton **Importer** à côté du titre **Description**
3. Sélectionnez un fichier `.docx` depuis votre ordinateur
4. Si la description a déjà du contenu, confirmez que vous voulez le remplacer
5. Le document est converti en markdown et chargé dans l'éditeur
6. Examinez le résultat. La description importée est enregistrée immédiatement, et les modifications que vous faites ensuite s'enregistrent automatiquement

Les images intégrées dans le document sont téléversées vers le stockage automatiquement. Si du contenu ne peut pas être converti proprement, un avertissement apparaît en bas de l'écran.

### Exporter la description

1. Cliquez sur le bouton **Exporter** à côté du titre **Description**
2. Choisissez un format : **PDF**, **DOCX** ou **ODT**
3. Le fichier se télécharge automatiquement

Le bouton d'export n'est activé que lorsque la description a du contenu.

---

## Commentaires et historique

### Ajouter des commentaires

1. Sélectionnez l'onglet **Commentaires** dans la section activité
2. Tapez votre commentaire dans l'éditeur de texte
3. Optionnellement, choisissez un nouveau statut depuis le menu déroulant de statut
4. Optionnellement, enregistrez du temps avec le curseur (`0` signifie pas d'entrée de temps)
5. Cliquez sur **Soumettre** (le libellé du bouton se met à jour pour refléter vos actions sélectionnées)

### Comportement du formulaire d'activité unifié

- Vous pouvez soumettre n'importe quelle combinaison de :
  - Commentaire seul
  - Changement de statut seul
  - Enregistrement de temps seul
  - Commentaire + statut + temps ensemble
- Pour les tâches de projet, définir le statut sur **Terminée** nécessite du temps enregistré (existant + nouvellement ajouté)
- Le menu déroulant de statut dans le tiroir Propriétés fonctionne toujours indépendamment si vous préférez ce flux

### Consulter l'historique

L'onglet **Historique** affiche tous les changements de la tâche :
  - Changements de statut
  - Modifications de champs
  - Qui a effectué chaque changement et quand
  - L'entrée de création, avec la date, l'heure et le créateur, affichée en dernière position

Le champ **Demandeur** est une information de travail qui peut être réassignée à tout moment ; la ligne de création indique toujours qui a réellement créé la tâche.

### Notifications par e-mail et actions rapides

Lorsque les notifications de tâches sont activées, les mises à jour de statut et de commentaires peuvent déclencher des notifications par e-mail.

- Si un changement de statut et un commentaire sont soumis ensemble, les destinataires peuvent recevoir un e-mail fusionné (selon leurs préférences de notification)
- Les e-mails de statut peuvent inclure des boutons d'action rapide :
  - **En attente** : `Répondre et passer en cours`, `Marquer terminée`
  - **En test** : `Approuver` (passe à `Terminée`), `Passer en cours`
  - **Terminée** : `Rouvrir` (passe à `Ouverte`)
- Cliquer sur un bouton d'action ouvre la page de la tâche avec le statut pré-sélectionné dans le formulaire d'activité unifié

---

## Lier des applications et des actifs

Les tâches peuvent être liées à une ou plusieurs **Applications** (Apps et services) et **Actifs** (ressources matérielles ou cloud). Les liens vivent dans le groupe **Suivi** du tiroir Propriétés.

- Utilisez **Applications** pour signaler le travail qui touche des apps spécifiques de votre cartographie SI (ex. : un déploiement, un changement de configuration, un incident limité à cette app)
- Utilisez **Actifs** pour le travail limité à des serveurs, équipements ou actifs cloud spécifiques

Les liens sont bidirectionnels : depuis l'espace de travail de l'Application ou de l'Actif lié, la tâche apparaît dans la relation **Tâches** dans le tiroir Propriétés de cet espace de travail. Cela facilite le pivotement de « que se passe-t-il avec cette app/cet actif ? » au travail réellement en cours.

**Conseil** : Réservez ces liens aux tâches qui concernent opérationnellement l'app ou l'actif, pas à chaque tâche qui mentionne l'un d'eux en passant. Sinon la relation devient du bruit au lieu d'un signal.

---

## Créer des tâches depuis d'autres espaces de travail

Les tâches sont communément créées depuis d'autres espaces de travail. La relation est pré-sélectionnée pour que vous n'ayez pas à la configurer à la main.

### Depuis Projets du portefeuille
Dans l'espace de travail du Projet, utilisez l'onglet **Tâches** pour gérer les livrables du projet :
- Créer des tâches pour des lots de travail spécifiques
- Assigner des tâches à des phases du projet
- Suivre le temps sur chaque tâche

**Conseil** : Dans l'onglet Planning, cliquez sur le bouton **[+]** à côté d'une phase pour créer une tâche pré-liée à cette phase.

### Depuis les postes OPEX
Dans l'espace de travail OPEX, utilisez le panneau **Tâches** de l'onglet **Vue d'ensemble** pour créer des tâches comme :
- « Revoir la tarification fournisseur pour 2026 »
- « Négocier une remise sur volume »

### Depuis les Contrats
Dans l'espace de travail Contrat, utilisez l'onglet **Tâches** pour :
- « Revoir le contrat avant la date limite de renouvellement »
- « Demander des conditions mises à jour au fournisseur »

### Depuis les postes CAPEX
Dans l'espace de travail CAPEX, les tâches suivent les jalons du projet :
- « Compléter la collecte des exigences »
- « Obtenir l'approbation du budget »

Ces tâches se lient automatiquement à l'entité parente et apparaissent à la fois dans la liste des tâches et l'espace de travail parent.

---

## Tâches autonomes

Les tâches autonomes sont des éléments de travail indépendants non liés à un projet, contrat ou poste budgétaire spécifique. Elles sont utiles pour :
- Travail général d'exploitation IT
- Demandes ad hoc
- Initiatives transversales
- Suivi de tâches personnelles

### Créer des tâches autonomes

1. Cliquez sur **Nouvelle** dans la page Tâches
2. Laissez le menu déroulant **Lié à** sur **Autonome**
3. Le tiroir Propriétés affiche « Tâche autonome » dans le groupe Contexte
4. Remplissez le titre, la description et autres détails
5. Cliquez sur **Créer**

### Champs de classification

Les tâches autonomes et les tâches de projet ont des champs de classification modifiables qui aident à organiser le travail par dimensions du portefeuille :

- **Source** : Où le travail provient (ex. : Demande métier, Initiative IT)
- **Catégorie** : La catégorie du portefeuille pour le travail
- **Stream** : Le stream spécifique au sein de la catégorie (filtré par catégorie sélectionnée)
- **Société** : La société à laquelle ce travail se rapporte

Ces champs apparaissent dans le groupe **Classification** du tiroir Propriétés et peuvent être modifiés à tout moment. Lors de la création d'une nouvelle tâche autonome, les valeurs de classification par défaut de votre organisation sont pré-remplies automatiquement si configurées.

Pour les **tâches de projet**, la classification provient par défaut du projet parent lorsque la tâche est créée mais peut être changée indépendamment. Cela permet, par exemple, à une tâche d'infrastructure d'exister au sein d'un projet métier, ou à une tâche de conformité au sein d'un projet IT. Si la classification d'une tâche n'est pas explicitement définie, elle hérite et affiche la classification du projet.

### Score de priorité

Les tâches autonomes (et toutes les tâches non-projet) utilisent un score de priorité fixe basé sur leur niveau de priorité :

| Niveau de priorité | Score |
|--------------------|-------|
| Bloquant | 110 |
| Haute | 90 |
| Normale | 70 |
| Basse | 50 |
| Optionnelle | 30 |

Les tâches Bloquantes obtiennent 110 pour s'assurer qu'elles soient toujours classées au-dessus même des tâches de projet à priorité maximale (max 100).

---

## Tâches de projet

Les tâches de projet ont des fonctionnalités supplémentaires par rapport aux tâches standard :

**Classification indépendante** : Les tâches de projet ont leurs propres champs Source, Catégorie, Stream et Société. Lorsqu'une tâche est créée au sein d'un projet, ces valeurs proviennent par défaut de la classification du projet pour la commodité. Cependant, la classification de chaque tâche peut être modifiée indépendamment. Si un champ de classification d'une tâche n'est pas explicitement défini, il hérite et affiche la valeur du projet.

**Score de priorité** : Les tâches de projet affichent un score de priorité calculé qui combine :
- Le score de priorité du projet parent
- Un ajustement basé sur le niveau de priorité de la tâche (+10 pour Bloquant, +5 pour Haute, 0 pour Normale, -5 pour Basse, -10 pour Optionnelle)

Le score apparaît dans la barre de métadonnées en haut de l'espace de travail et comme colonne **Score** dans la liste des tâches.

**Assignation de phase** : Les tâches peuvent être assignées à des phases de projet spécifiques ou marquées comme « Niveau projet » pour le travail transversal.

**Contribution au temps** : Le temps enregistré sur les tâches de projet contribue aux calculs de charge réelle du projet :
- Le temps de catégorie IT s'ajoute à **Charge réelle (IT)**
- Le temps de catégorie Métier s'ajoute à **Charge réelle (Métier)**
- L'onglet Avancement du projet affiche une répartition entre Gestion de projet et Temps des tâches
- Le Journal de temps unifié affiche toutes les entrées de temps de la gestion de projet et du travail sur les tâches

**Validation du statut** : Les tâches de projet ne peuvent pas être marquées comme **Terminées** sans enregistrer du temps d'abord. Cela garantit un suivi précis de la charge du projet.

**Filtrage** : L'onglet Tâches du projet inclut des filtres pour :
- Statut (Tous, Actif, statut spécifique)
- Phase (Toutes les phases, Niveau projet, phase spécifique)

---

## Import/export CSV

Gérez les tâches à grande échelle grâce à l'import et l'export CSV. Cette fonctionnalité prend en charge les opérations en masse pour le chargement initial de données, les migrations de tâches et l'extraction de données pour le reporting.

### Accéder aux fonctionnalités CSV

Depuis la liste des Tâches :
  - **Export CSV** : Télécharger les tâches dans un fichier CSV
  - **Import CSV** : Téléverser un fichier CSV pour créer ou mettre à jour des tâches
  - **Télécharger le modèle** : Obtenir un CSV vierge avec les en-têtes corrects (depuis la boîte de dialogue d'import)

**Autorisations requises** : `tasks:admin` pour les opérations d'import/export.

### Options d'export

Trois modes d'export sont disponibles :

| Option | Description |
|--------|-------------|
| **Export complet** | Tous les champs exportables -- à utiliser pour le reporting et l'extraction complète de données |
| **Enrichissement de données** | Tous les champs importables -- correspond au format du modèle d'import, idéal pour l'édition aller-retour (export, modification, ré-import) |
| **Sélection personnalisée** | Choisir les champs spécifiques à inclure dans votre export |

**Téléchargement du modèle** (depuis la boîte de dialogue d'import) : Télécharge un CSV vierge avec tous les en-têtes de champs importables -- utilisez-le pour préparer des fichiers d'import avec la bonne structure.

### Processus d'import

1. **Préparez votre fichier** : Utilisez l'encodage UTF-8 avec des séparateurs point-virgule (`;`). Téléchargez un modèle pour vous assurer des bons en-têtes.

2. **Choisissez les paramètres d'import** :
   - **Mode** :
     - `Enrichir` (par défaut) : Les cellules vides conservent les valeurs existantes -- ne mettez à jour que ce que vous spécifiez
     - `Remplacer` : Les cellules vides effacent les valeurs existantes -- remplacement complet de tous les champs
   - **Opération** :
     - `Upsert` (par défaut) : Créer de nouvelles tâches ou mettre à jour les existantes
     - `Mise à jour uniquement` : Ne modifier que les tâches existantes, ignorer les nouvelles
     - `Insertion uniquement` : Ne créer que de nouvelles tâches, ignorer les existantes

3. **Validez d'abord** : Cliquez sur **Vérification préalable** pour valider votre fichier sans apporter de modifications. Examinez les erreurs et avertissements.

4. **Appliquez les modifications** : Si la validation réussit, cliquez sur **Importer** pour valider les changements.

### Référence des champs

**Champs de base** :

| Colonne CSV | Description | Obligatoire | Notes |
|-------------|-------------|-------------|-------|
| `id` | UUID de la tâche | Non | Pour les mises à jour ; laisser vide pour les nouvelles tâches |
| `title` | Titre de la tâche | Oui | Partie de l'identifiant unique |
| `description` | Détails de la tâche | Non | Prend en charge le texte brut |

**Champs de contexte** :

| Colonne CSV | Description | Obligatoire | Notes |
|-------------|-------------|-------------|-------|
| `related_object_type` | Type d'entité | Non | Vide pour les tâches autonomes ; accepte un code ou un libellé |
| `related_object_id` | UUID de l'entité | Conditionnel | Requis si tâche liée et `related_object_name` non fourni |
| `related_object_name` | Nom de l'entité | Conditionnel | Requis si tâche liée et `related_object_id` non fourni |
| `phase_name` | Phase du projet | Non | Doit correspondre au nom d'une phase existante (tâches de projet uniquement) |
| `priority_level` | Priorité de la tâche | Non | Accepte un code ou un libellé |
| `source_name` | Source | Non | Source du portefeuille (tâches autonomes et de projet) |
| `category_name` | Catégorie | Non | Catégorie du portefeuille (tâches autonomes et de projet) |
| `stream_name` | Stream | Non | Stream du portefeuille (tâches autonomes et de projet) |
| `company_name` | Société | Non | Société (tâches autonomes et de projet) |

**Tâches autonomes** : Laissez `related_object_type`, `related_object_id` et `related_object_name` vides. Vous pouvez définir les champs de classification (`source_name`, `category_name`, `stream_name`, `company_name`) pour les tâches autonomes et de projet. Pour les tâches de projet, les champs de classification omis viennent par défaut du projet parent.

**Conseil** : Pour les imports de nouvelles tâches liées, utilisez `related_object_name` au lieu de `related_object_id` -- c'est beaucoup plus facile à utiliser. Le système résout le nom vers l'ID correct en fonction de `related_object_type`. Pour les imports aller-retour (export, modification, ré-import), les deux champs sont inclus afin que la correspondance fonctionne correctement.

**Statut et dates** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `status` | Statut de la tâche | Accepte un code ou un libellé |
| `start_date` | Date de début | Format de date : YYYY-MM-DD |
| `due_date` | Date d'échéance | Format de date : YYYY-MM-DD |

**Champs de personnes** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `assignee_email` | Personne responsable | Doit correspondre à l'e-mail d'un utilisateur existant |
| `creator_email` | E-mail du demandeur | Export uniquement (affiché comme **Requestor Email** dans les métadonnées de champ) |
| `viewer_email_1` à `_4` | Observateurs | Doivent correspondre à des e-mails d'utilisateurs existants |
| `owner_email_1` à `_4` | Responsables | Doivent correspondre à des e-mails d'utilisateurs existants |

**Autres champs** :

| Colonne CSV | Description | Notes |
|-------------|-------------|-------|
| `labels` | Étiquettes de tâche | Liste séparée par virgules |

### Acceptation des libellés et codes

Pour **status**, **priority_level** et **related_object_type**, vous pouvez utiliser soit le code interne, soit un libellé courant :

**Valeurs de statut** :

| Code | Libellés acceptés |
|------|-------------------|
| `open` | `Open` |
| `in_progress` | `In Progress`, `Active`, `Working` |
| `pending` | `Pending` |
| `in_testing` | `In Testing`, `Testing` |
| `done` | `Done`, `Completed`, `Complete`, `Finished`, `Closed` |
| `cancelled` | `Cancelled`, `Canceled` |

**Valeurs de niveau de priorité** :

| Code | Libellés acceptés |
|------|-------------------|
| `blocker` | `Blocker`, `Critical`, `Urgent` |
| `high` | `High` |
| `normal` | `Normal`, `Medium`, `Default` |
| `low` | `Low` |
| `optional` | `Optional`, `Nice to have` |

**Valeurs de type d'objet lié** :

| Code | Libellés acceptés |
|------|-------------------|
| `project` | `Project` |
| `spend_item` | `Spend Item`, `Spend` |
| `contract` | `Contract` |
| `capex_item` | `CAPEX Item`, `CAPEX` |

Le système normalise les valeurs automatiquement lors de l'import.

### Correspondance et mises à jour

Les tâches sont identifiées par **titre + related_object_id** (insensible à la casse). Lorsqu'une correspondance est trouvée :
  - En mode `Enrichir` : Seules les valeurs CSV non vides mettent à jour la tâche
  - En mode `Remplacer` : Tous les champs sont mis à jour, les valeurs vides effacent les données existantes

Si vous incluez la colonne `id` avec un UUID valide, la correspondance utilise d'abord l'ID, puis se rabat sur titre + objet lié.

**Note** : Si vous fournissez `related_object_name` au lieu de `related_object_id`, le système résout le nom vers l'ID avant la correspondance. Cela signifie que vous pouvez utiliser des noms lisibles tout au long de votre fichier d'import.

### Champs en export uniquement

Certains champs apparaissent dans les exports mais ne peuvent pas être importés. Ce sont des champs gérés par le système qui maintiennent l'intégrité des données :

| Champ | Pourquoi il est en export uniquement |
|-------|--------------------------------------|
| `creator_email` (Demandeur) | Défini automatiquement à l'utilisateur qui crée la tâche. Permettre l'import compromettrait l'intégrité du journal d'audit. Pour les nouvelles tâches, le système définit cela à l'utilisateur qui importe ; pour les tâches existantes, le demandeur d'origine est préservé. |

Ces champs sont inclus dans **Export complet** à des fins de reporting mais exclus des exports **Modèle** et **Enrichissement de données** car ils ne peuvent pas être modifiés lors de l'import.

### Limitations

  - **Maximum 4 observateurs/responsables** : Les tâches prennent en charge jusqu'à 4 e-mails d'observateurs et 4 e-mails de responsables via CSV
  - **Classification pour tâches autonomes et de projet uniquement** : Source, Catégorie, Stream et Société peuvent être définis sur les tâches autonomes et de projet (pas sur les tâches OPEX, Contrat ou CAPEX)
  - **Phase nécessite un projet** : L'assignation de phase ne fonctionne que pour les tâches de projet
  - **Liens Application/Actif non dans CSV** : Utilisez le tiroir Propriétés de l'espace de travail pour lier les tâches aux applications et actifs
  - **Commentaires non inclus** : Les commentaires et l'historique des tâches doivent être gérés dans l'espace de travail
  - **Journal de temps non inclus** : Les entrées de temps doivent être enregistrées dans l'espace de travail
  - **Pièces jointes non incluses** : Les pièces jointes nécessitent une gestion dans l'espace de travail

### Résolution de problèmes

**Erreur « Le fichier n'est pas correctement formaté »** : Cela indique généralement un problème d'encodage. Assurez-vous que votre CSV est enregistré en **UTF-8** :

  - **Dans LibreOffice** : Lors de l'ouverture d'un CSV, sélectionnez `UTF-8` dans le menu déroulant Jeu de caractères (pas « Japanese (Macintosh) » ni d'autres encodages). Lors de l'enregistrement, cochez « Modifier les paramètres de filtre » et choisissez UTF-8.
  - **Dans Excel** : Enregistrer sous > CSV UTF-8 (délimité par des virgules), puis ouvrez dans un éditeur de texte pour remplacer les virgules par des points-virgules.
  - **Conseil général** : Si vous voyez des caractères illisibles au début de votre fichier, l'encodage est incorrect.

### Exemple CSV

En utilisant des noms lisibles (recommandé pour les nouveaux imports) :

```csv
title;related_object_type;related_object_name;status;priority_level;due_date;assignee_email;source_name;category_name
Review contract terms;Contract;Acme Software License;Open;High;2026-02-28;john.doe@example.com;;
Update documentation;project;Website Redesign;In Progress;Normal;2026-03-15;jane.smith@example.com;;
Schedule kickoff;spend_item;Cloud Hosting 2026;open;low;2026-04-01;bob.wilson@example.com;;
Audit IT security;;;open;high;2026-03-01;security@example.com;IT Initiative;Security
```

La dernière ligne est une **tâche autonome** (sans objet lié) avec des champs de classification définis.

En utilisant des UUID (typiquement depuis des exports aller-retour) :

```csv
title;related_object_type;related_object_id;status;priority_level;due_date;assignee_email
Review contract terms;Contract;550e8400-e29b-41d4-a716-446655440000;Open;High;2026-02-28;john.doe@example.com
Update documentation;project;660e8400-e29b-41d4-a716-446655440001;In Progress;Normal;2026-03-15;jane.smith@example.com
Schedule kickoff;spend_item;770e8400-e29b-41d4-a716-446655440002;open;low;2026-04-01;bob.wilson@example.com
```

---

## Convertir une tâche en demande

Vous pouvez promouvoir une tâche en demande de portefeuille lorsque le travail mérite une évaluation formelle, une priorisation ou éventuellement son propre projet. La conversion est disponible depuis l'en-tête de l'espace de travail de la tâche.

### Comment convertir

1. Ouvrez l'espace de travail de la tâche
2. Cliquez sur **Convertir en demande** dans la barre d'outils de l'en-tête (à côté de **Envoyer le lien**)
3. Dans la boîte de dialogue :
   - **Nom de la demande** : Par défaut sur le titre de la tâche -- modifier si nécessaire
   - **Aperçu de l'objectif** : Affiche la description de la tâche, qui devient l'objectif de la demande
   - **Fermer la tâche d'origine après conversion** : Cochez cette option si vous voulez que le statut de la tâche soit défini sur **Terminée** automatiquement
4. Cliquez sur **Convertir en demande**

Après conversion, KANAP vous redirige vers l'espace de travail de la demande nouvellement créée.

### Ce qui est reporté

La nouvelle demande hérite des éléments suivants de la tâche d'origine :

| Champ de la tâche | Champ de la demande |
|-------------------|---------------------|
| Titre | Nom |
| Description | Objectif |
| Date d'échéance | Date de livraison cible |
| Source, Catégorie, Stream, Société | Source, Catégorie, Stream, Société |
| Pièces jointes | Pièces jointes (copiées) |

La demande est créée avec un statut de **En attente de revue** et est liée en retour à la tâche d'origine. Une entrée d'historique est enregistrée à la fois sur la tâche (« Convertie en demande ») et sur la demande (« Créée à partir d'une tâche » avec un lien vers la tâche d'origine).

### Conditions

- **Autorisations** : Vous avez besoin à la fois de `tasks:member` et de `portfolio_requests:member`
- **Conversion unique** : Chaque tâche ne peut être convertie qu'une seule fois. Après conversion, le bouton **Convertir en demande** est désactivé et affiche la référence de la demande liée (ex. : « Déjà convertie en REQ-42 »)
- **La tâche reste** : La tâche d'origine n'est pas supprimée. Sauf si vous cochez l'option de fermeture, elle reste dans son statut courant et peut toujours être mise à jour indépendamment

**Conseil** : Utilisez cela lorsqu'une tâche révèle une initiative plus grande qui a besoin de son propre cycle de vie de demande -- évaluation par critères, workflow d'approbation et conversion éventuelle en projet.

---

## Envoyer un lien

Vous pouvez envoyer par e-mail un lien vers n'importe quelle tâche à des collègues ou contacts externes.

1. Ouvrez l'espace de travail de la tâche
2. Cliquez sur **Envoyer le lien** dans la barre d'outils de l'en-tête
3. Dans la boîte de dialogue :
   - **Sélectionner les destinataires** : Recherchez des utilisateurs de la plateforme existants par nom ou e-mail, et/ou tapez n'importe quelle adresse e-mail et appuyez sur Entrée
   - **Ajouter un message** (optionnel) : Inclure une note personnelle
   - **Copier le lien** : Cliquez sur l'icône de copie pour récupérer l'URL directe
4. Cliquez sur **Envoyer**

Les destinataires reçoivent un e-mail avec votre nom, le titre de la tâche, un lien direct et votre message (le cas échéant). Cela ne change aucune autorisation -- cela notifie simplement les destinataires.

**Conseil** : Vous pouvez mélanger des utilisateurs de la plateforme et des adresses e-mail externes dans le même envoi.

---

## Raccourcis clavier

Lorsque le focus n'est pas sur un champ de saisie, vous pouvez utiliser :

- **J** ou **←** : Tâche précédente dans la liste actuelle
- **K** ou **→** : Tâche suivante dans la liste actuelle
- **P** : Basculer le tiroir Propriétés
- **Échap** : Fermer et retourner à la liste
- **Ctrl+S** / **Cmd+S** : Enregistrer (ou créer, en mode création)
- **Tab** depuis le champ titre : Sauter directement dans l'éditeur de description

---

## Conseils

  - **Utilisez les dates d'échéance** : Définissez des dates d'échéance réalistes pour suivre les délais efficacement.
  - **Assignez des responsables** : Chaque tâche devrait avoir un assigné pour la responsabilité.
  - **Enregistrez le temps régulièrement** : Le suivi du temps aide pour l'estimation future des projets.
  - **Filtrez par statut** : Le filtre par défaut affiche uniquement les statuts actifs (`Ouverte`, `En cours`, `En attente`, `En test`) -- incluez `Terminée` et `Annulée` lors de la revue des tâches historiques.
  - **Créez depuis le contexte** : Créer des tâches depuis d'autres espaces de travail (projet, OPEX, contrat, CAPEX) les lie automatiquement.
  - **Liez apps et actifs** : Utilisez les champs **Applications** et **Actifs** dans le tiroir Propriétés lorsqu'une tâche concerne opérationnellement une app ou un actif spécifique. Le lien apparaît également dans l'espace de travail de l'entité liée.
  - **Utilisez la priorité judicieusement** : Réservez **Bloquant** aux problèmes véritablement bloquants.
  - **Utilisez des mises à jour en une seule soumission** : Dans l'onglet Commentaires, combinez commentaire + statut + temps en une seule action pour garder l'historique et les notifications alignés.
  - **Importez des documents** : Utilisez le bouton **Importer** pour importer des fichiers `.docx` comme contenu de description au lieu de copier-coller.
  - **Raccourci clavier** : Appuyez sur **Ctrl+S** (ou **Cmd+S** sur Mac) pour enregistrer rapidement sans atteindre le bouton Enregistrer.
  - **Liez des articles de connaissances** : Utilisez le groupe Connaissances dans le tiroir Propriétés pour connecter de la documentation pertinente à vos tâches.
