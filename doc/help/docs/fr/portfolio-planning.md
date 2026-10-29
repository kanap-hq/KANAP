# Planification du portefeuille

La planification du portefeuille vous aide à planifier et mettre à jour les dates des projets au niveau du portefeuille. Elle combine une vue chronologique manuelle avec un générateur de roadmap automatique qui planifie les projets en fonction de la charge restante, des dépendances et de la capacité des contributeurs.

## Premiers pas

Naviguez vers **Portefeuille > Planification**.

**Autorisations** :
- Vous avez besoin de `portfolio_projects:reader` pour accéder à la page Planification et aux données chronologiques.
- Vous avez besoin de `portfolio_reports:reader` pour générer des scénarios de roadmap.
- Vous avez besoin de `portfolio_projects:contributor` pour glisser les dates des projets, changer le mode de planification d'un projet et appliquer les dates générées.

Si vous ne voyez pas Planification dans le menu, demandez à votre administrateur de vous accorder l'accès requis.

---

## Modes de planification

Utilisez le bouton bascule de mode en haut de la page :
- **Chronologie** : Édition manuelle des dates dans le diagramme de Gantt
- **Générateur de roadmap** : Simulation automatique de calendrier et application sélective

---

## Mode Chronologie

Utilisez le mode Chronologie pour les modifications directes de planification.

### Ce que vous pouvez faire
- Visualiser les projets, dépendances et jalons optionnels
- Filtrer par catégorie et statut
- Choisir la fenêtre temporelle : 1 mois, 3 mois, 6 mois ou 1 an
- Avancer/reculer dans le temps ou revenir à **Aujourd'hui**
- Glisser les barres de projet pour mettre à jour les dates de début et de fin planifiées. Cela nécessite `portfolio_projects:contributor`. Avec `portfolio_projects:reader`, les barres restent en place et un double-clic ouvre le projet.

### Comportement d'affichage
- Le graphique est centré autour d'aujourd'hui avec environ **25% passé / 75% futur** lorsqu'il est réinitialisé à la période actuelle.
- Les jalons sont affichés mais ne peuvent pas être déplacés.

---

## Mode Générateur de roadmap

Le générateur de roadmap calcule les dates proposées des projets à partir du périmètre sélectionné et des paramètres de planification.

### Contrôles du scénario
- **Date de début**
- **Statuts** (par défaut : En attente, Planifié, En cours, En test)
- **Mode de capacité** : Théorique ou Historique
- **Limite de parallélisme** : nombre maximum de projets simultanés par contributeur
- **Mode d'optimisation** : Orienté priorité ou Orienté achèvement
- **Recalculer les projets déjà planifiés** (activé par défaut)
- **Planification collaborative** (désactivée par défaut)
- **Pénalité de changement de contexte** et **seuil de changement de contexte**

**Important** : lorsque **Recalculer les projets déjà planifiés** est activé, les projets qui ont déjà des dates planifiées peuvent être déplacés dans le scénario généré.

### Onglet Calendrier

Après la génération, l'onglet Calendrier affiche les dates proposées des projets.

- Les titres de projet sont cliquables et ouvrent l'onglet **Avancement** du projet.
- Les cases à cocher définissent le périmètre du scénario.
- Un filtre **Catégorie (Aperçu)** vous permet de filtrer l'affichage du Gantt de la roadmap sans modifier le calendrier généré lui-même.
- Désélectionner un projet régénère immédiatement le scénario :
  - le projet désélectionné est exclu entièrement,
  - il ne consomme plus aucune capacité dans les goulots d'étranglement/occupation/calendrier.
- **Sélectionner les visibles** / **Effacer la sélection visible** agissent uniquement sur les projets actuellement visibles dans l'aperçu Gantt filtré.
- Les projets non planifiables sont listés avec une raison.

### Onglet Goulots d'étranglement

Affiche les contributeurs classés par impact sur la date de fin de la roadmap (`impactDays`) en utilisant des simulations de sensibilité.
- Chaque ligne de contributeur a une flèche d'expansion pour ouvrir un tableau de détail par projet.
- Le détail inclut uniquement les projets du scénario actuel où le contributeur a une allocation.
- Le détail est trié par date de début du projet et affiche :
  - Nom du projet
  - Date de début du projet
  - Date de fin du projet
  - Contribution totale (jours)
  - Temps déjà passé (jours)
- `Contribution totale` et `Temps déjà passé` sont dérivés de la charge du contributeur plus l'avancement de l'exécution du projet.

### Onglet Occupation

Affiche des cartes thermiques d'occupation hebdomadaire :
- Vue contributeur : une ligne par contributeur, groupé par équipe, avec des colonnes par semaine ISO
- Vue équipe : une ligne par équipe, avec des colonnes par semaine ISO
- Les libellés d'équipe sont affichés comme des cellules fusionnées multi-lignes en vue contributeur pour éviter la répétition
- Chaque cellule affiche l'occupation hebdomadaire arrondie (%) avec une intensité de couleur d'accent basée sur la charge
- **Exporter le tableau** propose **CSV** et **Excel (.xlsx)** pour le scénario à l'écran. Le CSV contient la vue à l'écran, contributeurs ou équipes. Le fichier Excel contient les deux, une feuille chacune, avec l'occupation en pourcentages, plus une feuille **Paramètres**. **Exporter l'occupation en PNG** enregistre la carte de chaleur en image

### Comportement de l'aperçu Gantt

Le Gantt de la roadmap est en lecture seule et :
- conserve la même logique d'affichage 25/75 centrée sur aujourd'hui que le mode Chronologie,
- s'étend automatiquement suffisamment loin dans le futur pour atteindre la dernière date d'achèvement planifiée,
- affiche chaque barre de projet avec son avancement d'exécution actuel,
- s'ajuste automatiquement verticalement en fonction des lignes visibles pour que les scénarios plus importants puissent afficher de nombreux projets sans défilement vertical interne.

---

## Appliquer les dates générées

Cliquez sur **Appliquer les dates** pour écrire les dates planifiées générées sur les projets sélectionnés.

### Règles d'application
- Seuls les projets sélectionnés qui sont actuellement visibles dans l'aperçu Gantt de la roadmap sont appliqués.
- L'application est **transactionnelle** (tout ou rien) :
  - si un projet échoue à la validation, aucune date de projet n'est mise à jour.

---

## Comportement des projets démarrés

Pour les projets déjà démarrés dans le passé :
- la date de début historique est préservée (`Début réel`, ou `Début planifié` éligible comme solution de repli),
- la planification utilise le travail restant à partir d'aujourd'hui pour calculer la date de fin projetée.

Cela préserve le contexte chronologique historique tout en recalculant un achèvement réaliste.

---

## Raisons courantes de non-planification

- **Pas de charge restante**
- **Pas de contributeurs**
- **Capacité de contributeur manquante**
- **Date de blocage manquante**
- **Dépendance cyclique**
- **Capacité insuffisante**

Si des projets ne sont pas planifiables, vérifiez les affectations de contributeurs, la disponibilité des contributeurs, les données de dépendance et le périmètre de statuts.

---

## Comment fonctionne le planificateur

Le générateur de roadmap simule l'exécution des projets semaine par semaine. Chaque semaine, il décide quels projets reçoivent du travail et combien de charge chaque contributeur utilise. La simulation s'exécute depuis la **date de début** jusqu'à ce que tous les projets soient terminés ou que la limite d'horizon soit atteinte.

### Capacité

Chaque contributeur a une capacité mensuelle (configurée dans **Contributeurs**). Le planificateur la convertit en valeur hebdomadaire : `mensuelle * 12 / 52`.

- Le **mode théorique** utilise la capacité configurée directement.
- Le **mode historique** utilise les données réelles de suivi de temps des mois récents comme base de capacité.

### Réservations

Les projets qui ne sont **pas recalculés** (lorsque **Recalculer les projets déjà planifiés** est désactivé, ou projets avec des blocages externes) conservent leurs dates planifiées existantes. Leurs charges de contributeurs sont pré-engagées dans le registre de capacité avant que la planification des candidats ne commence. Cela signifie que les projets réservés consomment du temps contributeur dans les semaines qu'ils couvrent, réduisant la disponibilité pour les autres projets.

### Dépendances

Un projet ne peut pas démarrer tant que tous ses prédécesseurs de dépendance ne sont pas terminés. Si un prédécesseur est un candidat dans l'exécution actuelle, le projet dépendant attend que la date de fin calculée du prédécesseur soit passée. Si un prédécesseur est en dehors de l'ensemble des candidats (par ex. exclu ou dans un statut différent), sa date de fin planifiée/réelle connue est utilisée.

### Classement des projets

Chaque semaine, les projets prêts (non bloqués, non terminés) sont triés pour déterminer la priorité de planification. Le classement dépend du **mode d'optimisation**.

Le mode **Orienté priorité** classe par **priorité effective** (la plus haute en premier) :

- **Projets démarrés** (ayant déjà reçu du travail une semaine précédente) : priorité effective = `min(100, scorePriorité + 5 * semainesDepuisDémarrage)`. Un projet démarré gagne 5 points de priorité par semaine de travail actif, jusqu'à un maximum de 100. Cela garantit que les projets en cours montent régulièrement en priorité pour être terminés.
- **Projets en attente** (prêts mais pas encore démarrés) : priorité effective = `min(90, scorePriorité + semainesAttente)`. Chaque semaine qu'un projet prêt attend sans recevoir de travail, il gagne 1 point de priorité, jusqu'à 90. Cela empêche la famine indéfinie mais un projet en attente ne peut jamais dépasser un projet démarré modérément prioritaire.
- **Autres projets** (pas encore prêts) : utilisent leur `scorePriorité` brut tel quel.

Le mode **Orienté achèvement** classe par **semaines goulot** (le plus bas en premier), puis `scorePriorité` brut (le plus haut en premier). Les semaines goulot estiment combien de semaines un projet prendrait s'il était le seul projet planifié, en se basant sur son contributeur le plus contraint. Ce mode donne la priorité aux projets rapides à terminer.

**Départage** (les deux modes) : profondeur de dépendance décroissante (les projets qui bloquent le plus de travail en aval passent en premier), puis ID de projet lexicographique pour le déterminisme.

### Règle de continuité

Avant de considérer de nouveaux démarrages de projets chaque semaine, le planificateur pré-affecte les contributeurs à leurs **projets en cours**. Un contributeur « continue » un projet si :

- Le projet a déjà démarré (a reçu du travail une semaine précédente).
- Le projet est prêt (non bloqué par une dépendance).
- Le contributeur a de la charge restante dessus.
- Le contributeur y a déjà travaillé précédemment.

Les projets en cours sont traités dans l'ordre de classement (priorité la plus haute en premier). Chaque pré-affectation de continuation consomme un slot de parallélisation pour ce contributeur.

**Effet** : avec **Limite de parallélisme = 1**, un contributeur travaillant sur un projet doit le terminer (ou attendre qu'il soit débloqué) avant d'en commencer un nouveau. Avec des limites plus élevées, le travail en cours remplit d'abord les slots et les slots restants deviennent disponibles pour de nouveaux projets.

La règle de continuité s'applique dans les modes collaboratif et non collaboratif, mais la vérification de faisabilité diffère :

- **Collaboratif** : tous les contributeurs qui continuent sur un projet doivent avoir des slots libres pour que le projet soit pré-sélectionné dans son ensemble.
- **Non collaboratif** : chaque contributeur qui continue est individuellement pré-sélectionné s'il a un slot libre.

### Planification collaborative

L'option **Planification collaborative** contrôle comment le planificateur sélectionne les projets et distribue le travail chaque semaine.

#### Collaboratif (option ACTIVÉE)

Tous les contributeurs assignés à un projet doivent avoir un slot de parallélisation libre **et** de la capacité disponible pour que le projet soit sélectionné. Si même un seul contributeur est pleinement occupé, le projet entier attend.

Le travail est réparti **proportionnellement** : tous les contributeurs progressent au rythme du contributeur le plus contraint. Si le contributeur A a 4 jours disponibles et le contributeur B a 1 jour, le projet progresse au rythme contraint par la disponibilité du contributeur B. Cela garde tous les contributeurs synchronisés mais signifie que la capacité disponible des contributeurs plus rapides est inutilisée sur ce projet.

Utilisez la planification collaborative lorsque les projets nécessitent véritablement que tous les membres de l'équipe travaillent en synchrone (par ex. phases de développement fortement couplées, ateliers ou livrables conjoints).

#### Non collaboratif (option DÉSACTIVÉE, par défaut)

Un projet est sélectionné si **n'importe quel** contributeur a un slot de parallélisation libre et de la capacité disponible. Les contributeurs travaillent **indépendamment** : chacun consomme de la charge à son propre rythme, jusqu'à sa capacité hebdomadaire disponible. Un projet peut progresser même si certains de ses contributeurs sont occupés avec d'autres travaux.

Ce mode inclut une **garde de démarrage minimum** pour les nouveaux projets : un projet ne commence que si la consommation totale attendue de tous les contributeurs faisables est d'au moins 0,5 jour cette semaine. Cela empêche des dates de début trop optimistes dues à de petites consommations minimales. La garde ne s'applique pas aux continuations (les projets déjà démarrés continuent via la règle de continuité quelle que soit la capacité hebdomadaire).

Utilisez la planification non collaborative (par défaut) lorsque les contributeurs peuvent travailler sur leurs portions indépendamment, ce qui est typique pour la plupart des projets IT où les différents membres de l'équipe gèrent des tâches séparées.

### Limite de parallélisation

La **limite de parallélisme** contrôle combien de projets candidats un seul contributeur peut travailler simultanément au cours d'une semaine donnée. Les réservations (projets pré-engagés) consomment aussi des slots.

Avec une limite de 1, chaque contributeur travaille sur au plus un projet candidat par semaine. Avec une limite de 2 ou 3, les contributeurs peuvent répartir leur temps sur plusieurs projets.

### Pénalité de changement de contexte

Lorsqu'un contributeur travaille sur plus d'un projet candidat dans la même semaine (concurrence > seuil de grâce), sa capacité effective est réduite du pourcentage de **pénalité de changement de contexte** pour chaque projet supplémentaire au-delà du nombre de grâce.

- **Pénalité de changement de contexte** : le pourcentage de capacité perdue par projet concurrent supplémentaire (par défaut 10%).
- **Seuil de changement de contexte** : le nombre de projets concurrents avant que la pénalité ne s'applique (par défaut 1).

Par exemple, avec 10% de pénalité et un seuil de 1 : travailler sur 2 projets coûte 10% de capacité, 3 projets coûte 20%.

### Analyse de sensibilité (goulots d'étranglement)

Après l'exécution principale de planification, le planificateur relance la simulation plusieurs fois, en donnant à chaque fois à un contributeur +20% de capacité mensuelle supplémentaire. La différence entre la date de fin de la roadmap originale et la date de fin de chaque variante mesure l'**impact de ce contributeur sur le calendrier**. Les contributeurs sont classés par cet impact dans l'onglet **Goulots d'étranglement**.

Cela aide à identifier quels contributeurs sont les plus grandes contraintes de planification. Ajouter de la capacité aux contributeurs à fort impact (par le recrutement, la réallocation ou la réduction de charge) améliorerait le plus le calendrier global du portefeuille.
