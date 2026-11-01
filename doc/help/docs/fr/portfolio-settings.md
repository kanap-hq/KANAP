# Paramètres du portefeuille

Les paramètres du portefeuille vous permettent de configurer le système d'évaluation, les compétences d'équipe, les modèles de phases de projet, la structure de classification et les types de contrat utilisés dans toutes les demandes et projets du portefeuille. Ces paramètres déterminent comment les demandes sont évaluées, comment les projets sont structurés et comment les éléments sont catégorisés.

## Où les trouver

- Espace de travail : **Portefeuille**
- Chemin : **Portefeuille > Paramètres**
- Autorisations :
  - Vous avez besoin de `portfolio_settings:admin` pour modifier les paramètres
  - Les niveaux d'autorisation inférieurs peuvent voir mais pas modifier

Si vous ne voyez pas Paramètres dans le menu, demandez à votre administrateur de vous accorder les autorisations appropriées.

## Critères d'évaluation

Définissez les critères d'évaluation utilisés pour calculer les scores de priorité des demandes et projets.

### Paramètre de contournement obligatoire

En haut de l'onglet Critères d'évaluation :
- **Les demandes obligatoires obtiennent automatiquement 100 points** : Lorsque activé, toute demande avec une valeur de critère marquée « obligatoire » reçoit un score de priorité de 100 indépendamment des autres critères

### Gérer les critères

Chaque critère possède :
  - **Nom** : Ce que vous évaluez (par ex., « Alignement stratégique », « Niveau de risque »)
  - **Poids** : Importance relative (poids plus élevé = plus d'impact sur le score)
  - **Inversé** : Si coché, la première valeur = score le plus élevé au lieu du plus bas
  - **Activé/Désactivé** : Basculer pour inclure dans l'évaluation ou non
  - **Valeurs** : Les options de l'échelle dans l'ordre

**Pour ajouter un critère** :
1. Cliquez sur **Ajouter un critère**
2. Saisissez le nom
3. Définissez le poids (1 par défaut)
4. Cochez « Inversé » si une position plus haute devrait signifier un score plus bas
5. Définissez les valeurs dans l'ordre (minimum 2)
6. Marquez éventuellement une valeur comme « Obligatoire » (déclenche le contournement)
7. Cliquez sur **Enregistrer**

**Pour modifier un critère** :
- Cliquez sur l'icône de modification
- Modifiez le nom, le poids, l'inversion ou les valeurs
- Cliquez sur **Enregistrer**

**Pour supprimer un critère** :
- Cliquez sur l'icône de suppression
- Confirmez la suppression
- Remarque : Les évaluations existantes utilisant ce critère seront supprimées

**Exemples de critères** :
- Alignement stratégique : Faible, Moyen, Élevé (poids 2)
- Valeur métier : Faible, Moyen, Élevé, Très élevé (poids 1,5)
- Niveau de risque : Faible, Moyen, Élevé, Critique (poids 1, inversé)
- Conformité : Optionnel, Recommandé, Obligatoire (poids 1, « Obligatoire » déclenche le contournement)

---

## Compétences

Définissez les domaines d'expertise des membres d'équipe pour la composition de projets.

### Gérer les compétences

Les compétences sont groupées par catégorie :
- Activez/désactivez les compétences pour les rendre disponibles aux affectations d'équipe
- Ajoutez, modifiez ou supprimez des compétences selon les besoins

**Pour charger les valeurs par défaut** :
- Si aucune compétence n'existe, cliquez sur **Charger les valeurs par défaut** pour remplir avec les compétences IT et métier standard
- Les catégories incluent : Développement, Infrastructure, Analyse métier, Gestion de projet, etc.

**Pour ajouter une compétence** :
1. Cliquez sur **Ajouter une compétence**
2. Sélectionnez ou saisissez un nom de catégorie
3. Saisissez le nom de la compétence
4. Cliquez sur **Enregistrer**

**Pour désactiver une compétence** :
- Basculez l'interrupteur à côté du nom de la compétence
- Les compétences désactivées n'apparaîtront pas dans les sélecteurs de compétences d'équipe

---

## Modèles de phases

Définissez des structures de phases standard à appliquer aux projets.

### Comprendre les modèles

Les modèles de phases fournissent :
- Des structures de projet cohérentes dans l'organisation
- Une mise en place rapide lors de la création ou planification de projets
- Des jalons optionnels liés à chaque phase

**Modèles système** :
- Modèles prédéfinis fournis par KANAP
- Marqués d'une pastille « Système »
- Peuvent être modifiés mais fournissent des valeurs par défaut sensées

**Modèles personnalisés** :
- Modèles que vous créez pour la méthodologie de votre organisation
- Utiles pour différents types de projets (par ex., Agile, Cascade, Quick Win)

### Gérer les modèles

**Pour créer un modèle** :
1. Cliquez sur **Ajouter un modèle**
2. Saisissez le nom du modèle
3. Ajoutez les phases dans l'ordre :
   - Saisissez le nom de la phase
   - Cochez « Jalon » si un jalon d'achèvement doit être créé
   - Personnalisez éventuellement le nom du jalon
4. Ajoutez d'autres phases selon les besoins
5. Cliquez sur **Enregistrer**

**Pour modifier un modèle** :
- Cliquez sur l'icône de modification
- Modifiez le nom, les phases ou les paramètres de jalons
- Cliquez sur **Enregistrer**

**Pour supprimer un modèle** :
- Cliquez sur l'icône de suppression
- Confirmez la suppression
- Remarque : Les projets existants utilisant ce modèle ne sont pas affectés

**Exemples de modèles** :
- Cascade : Analyse, Conception, Développement, Test, Déploiement (tous avec jalons)
- Agile : Découverte, MVP, Itération 1, Itération 2, Livraison
- Quick Win : Planification, Exécution, Clôture

---

## Classification

Configurez les types, catégories et flux pour organiser les demandes et projets.

Un nouvel espace de travail commence avec trois sources (Informatique, Métier, Conformité) et trois catégories (Applications, Cybersécurité, Infrastructure), sans filière. Leurs noms suivent la langue de l'espace de travail. Vous pouvez les renommer, les désactiver ou les supprimer comme toute autre valeur.

### Types

Les types décrivent la nature du travail :
- **Amélioration** : Améliorations des capacités existantes
- **Nouveau développement** : Construction de nouvelles capacités
- **Maintenance** : Maintien des systèmes opérationnels
- **Infrastructure** : Plateforme et fondation technique

**Pour ajouter un type** :
1. Cliquez sur **Ajouter un type**
2. Saisissez le nom et une description optionnelle
3. Cliquez sur **Enregistrer**

**Pour basculer un type** :
- Utilisez l'interrupteur pour activer/désactiver
- Les types désactivés n'apparaîtront pas dans les listes déroulantes de sélection

### Catégories & Flux

Les catégories fournissent un regroupement de haut niveau, et les flux offrent une sous-catégorisation au sein de chaque catégorie.

**Structure** :
```
Catégorie (par ex., "Transformation numérique")
  ├── Flux (par ex., "Expérience client")
  ├── Flux (par ex., "Efficacité opérationnelle")
  └── Flux (par ex., "Analyse de données")
```

**Pour ajouter une catégorie** :
1. Cliquez sur **Ajouter une catégorie**
2. Saisissez le nom et une description optionnelle
3. Cliquez sur **Enregistrer**

**Pour ajouter un flux** :
1. Développez la catégorie
2. Cliquez sur **Ajouter un flux**
3. Saisissez le nom et une description optionnelle
4. Cliquez sur **Enregistrer**

**Pour basculer les éléments** :
- Utilisez les interrupteurs pour activer/désactiver les catégories ou flux
- Les éléments désactivés n'apparaîtront pas dans les listes déroulantes de sélection
- Désactiver une catégorie masque tous ses flux

**Éléments système** :
- Catégories et types prédéfinis marqués d'une pastille « Système »
- Peuvent être modifiés ou désactivés mais pas supprimés
- Un élément encore utilisé par des demandes ou des projets, ou un type de tâche utilisé par des tâches, ne peut pas être supprimé. KANAP l'indique avant de vous demander de confirmer et compte ce qui l'utilise. Désactivez-le plutôt

### Bonnes pratiques

- Gardez la liste de types courte (3 à 6 éléments)
- Utilisez les catégories pour les grands domaines métier ou thèmes stratégiques
- Utilisez les flux pour des regroupements plus spécifiques au sein des catégories
- Révisez et nettoyez les éléments de classification inutilisés périodiquement

---

## Types de contrat

Les types de contrat indiquent comment chaque contributeur travaille avec vous. Ils apparaissent sous forme de liste déroulante dans le panneau Propriétés de chaque contributeur, et comme filtre sur la page Contributeurs. Chaque contributeur démarre en Interne.

Quatre types sont créés avec chaque espace de travail :

- **Interne** : la valeur par défaut de tout nouveau contributeur
- **Externe**
- **Apprenti**
- **Autre**

### Gérer les types de contrat

**Pour ajouter un type** :
1. Ouvrez l'onglet **Types de contrat**
2. Cliquez sur **Ajouter un type de contrat**
3. Saisissez un nom et cliquez sur **Enregistrer**

**Pour renommer un type** : cliquez sur l'icône de modification, changez le nom et enregistrez. Les contributeurs déjà sur ce type le conservent.

**Pour désactiver un type** : utilisez l'interrupteur. Un type inactif disparaît de la liste déroulante pour les nouvelles affectations, mais les contributeurs qui le portent déjà le conservent et continuent de l'afficher.

**Pour supprimer un type** : cliquez sur l'icône de suppression. Un type intégré, ou un type que des contributeurs portent, est refusé avant la confirmation, avec la raison. Le compteur à côté de chaque type indique combien de contributeurs le portent. Les quatre types intégrés peuvent être renommés mais jamais supprimés. Pour retirer un type que des contributeurs portent, désactivez-le avec l'interrupteur.

**Initialiser les valeurs par défaut** : si la liste est vide, **Initialiser les valeurs par défaut** recrée Interne, Externe, Apprenti et Autre.

Les types de contrat ne sont jamais importés depuis Microsoft Entra : ils vous appartiennent.

---

## Conseils

  - **Commencez par l'évaluation** : Définissez vos critères d'évaluation en premier pour que les demandes puissent être correctement priorisées
  - **Utilisez les modèles** : Créez des modèles qui correspondent à la méthodologie de livraison de votre organisation
  - **Gardez la classification simple** : Trop d'options créent de la confusion ; commencez petit et élargissez au besoin
  - **Révisez régulièrement** : Au fur et à mesure que votre organisation évolue, revisitez ces paramètres pour vous assurer qu'ils restent pertinents
  - **Gardez peu de types de contrat** : quatre ou cinq types suffisent généralement à répondre à la question « qui est interne et qui ne l'est pas »

