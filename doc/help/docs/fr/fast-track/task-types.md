---
title: "Fast Track Types de tâches : Run, Build & Tâches"
description: Comprendre les différents types d'éléments de travail dans KANAP -- incidents, problèmes, demandes, projets, bugs et tâches -- et comment travailler avec les tâches au quotidien.
---

# Fast Track Types de tâches : Run, Build & Tâches

Ce guide explique les différents types d'éléments de travail suivis dans KANAP et comment les distinguer. Il couvre le Run (faire tourner les systèmes), le Build (les améliorer) et la tâche transversale qui relie les deux. La seconde moitié est un aide-mémoire pratique pour travailler avec les tâches au quotidien.

!!! tip "Conseil : Vous préférez un résumé sur une page ? :material-file-pdf-box:"
    Toutes les définitions clés sur une seule page A4 -- imprimez-la, épinglez-la, partagez-la avec votre équipe.

    [:material-download: Télécharger l'aide-mémoire (PDF)](downloads/kanap-task-types-fast-track.pdf){ .md-button .md-button--primary }

---

## La vue d'ensemble

Tout ce que votre département IT fait se range dans l'une de deux catégories -- plus une unité de travail universelle qui traverse les deux :

| Catégorie | Objectif | Éléments de travail |
|-----------|---------|---------------------|
| **Run** | Maintenir les systèmes existants en fonctionnement et sécurisés | Incident, Problème |
| **Build** | Faire évoluer et construire le paysage IT | Demande, Projet, Bug |
| **Transversal** | Unité atomique de travail à travers Run et Build | Tâche |

---

## Run -- Garder les lumières allumées

Tout le monde participe au Run. Il assure le **maintien en conditions opérationnelles** (MCO) et le **maintien en conditions de sécurité** (MCS) des systèmes existants.

### Incident

Une **interruption ou dégradation non planifiée** d'un service en production.

- A un impact significatif sur le fonctionnement du système d'information
- L'objectif est la **restauration du service** -- remettre les choses en état de marche, rapidement
- Réactif par nature : quelque chose est tombé en panne et les utilisateurs sont impactés

!!! example "Exemples"
    - Panne du système MES
    - Redémarrage inattendu d'une VM
    - Défaillance de l'accès VPN à l'échelle de l'entreprise

### Problème

Une **investigation de cause racine** déclenchée par des incidents récurrents.

- Typiquement identifié par l'IT après avoir détecté un **schéma d'incidents similaires**
- L'objectif est une **résolution permanente** -- corriger la cause sous-jacente, pas juste les symptômes
- Proactif : l'IT ouvre un Problème pour prévenir les futurs incidents

!!! example "Exemples"
    - Dégradation récurrente des performances d'accès Internet
    - Erreurs répétées sur une interface de données

---

## Build -- Faire évoluer le paysage

Le Build couvre toutes les **évolutions et constructions** du système d'information. Tout le monde participe.

### Demande (Demande de changement)

Une **sollicitation planifiée pour modifier** le système d'information.

- Peut être technique, fonctionnelle, provenant du métier ou de l'IT
- Rarement urgente
- Déclenche un **workflow de validation** et, si approuvée, devient une Tâche ou un Projet
- Répond à au moins l'un de ces critères :
    - Charge de travail significative (>3 jours)
    - Implique plusieurs équipes IT ou métier
    - Nécessite un effort significatif de gestion du changement

!!! example "Exemples"
    - Nouveau champ à synchroniser entre SAP et PLM
    - Nouvelle application métier
    - Intégration d'un site distant

### Projet

Un **ensemble coordonné de tâches** organisé autour d'un objectif défini, avec un périmètre, une chronologie, un budget et des livrables identifiés.

- Mêmes critères qu'une Demande -- provient normalement d'une Demande approuvée
- **Fast-track** : certains projets sont imposés sans passer par l'étape Demande (décision de direction, changement réglementaire urgent...). Ils entrent directement comme Projet.

!!! example "Exemples"
    - Mise à niveau S4/HANA
    - Migration de pare-feu

### Bug

Un **défaut trouvé dans un système en cours de développement**.

- Trop complexe pour être traité dans un simple ticket -- nécessite une analyse approfondie
- Strictement un concept Build : le système n'est pas encore en production (ou le défaut concerne un composant encore en construction)

!!! example "Exemples"
    - Droits d'accès insuffisants sur une nouvelle tuile SAP
    - Règle de pare-feu incorrecte dans un nouveau déploiement de serveur

!!! warning "Avertissement : Incident vs Bug"
    C'est la confusion la plus courante. La règle est simple :

    - **C'est en production et ça casse ?** > **Incident** (Run)
    - **C'est en construction et ça ne marche pas ?** > **Bug** (Build)

    La distinction est importante car les Incidents priorisent la **restauration du service** tandis que les Bugs priorisent la **correction de la cause racine dans le cycle de développement**.

---

## Transversal -- La Tâche

Les tâches sont l'**unité atomique de travail** dans KANAP. Elles traversent la frontière Run/Build.

### Tâche

Une **action clairement périmètrée** avec un responsable défini, un statut et une échéance.

- Peut être **autonome** ou liée à un **Projet**, une **ligne OPEX**, un **Contrat** ou une **ligne CAPEX**
- Porte un effort concret
- L'impact sur les utilisateurs ou les services est contenu et bien compris
- Ne nécessite pas de coordination entre plusieurs équipes -- même si elle prend longtemps, elle reste portée par une seule personne sans nécessiter d'analyse transversale

!!! example "Exemples"
    - Installer un nouveau contrôleur de domaine
    - Documenter la nouvelle interface Notilus vers S4/HANA
    - Renouveler le certificat SSL sur le portail intranet

!!! info "Information : Tâche vs Demande/Projet"
    Si le travail remplit **l'un** de ces critères, c'est une Demande (et potentiellement un Projet), pas une Tâche :

    - Charge de travail significative (>3 jours) **ET** nécessite une analyse transversale
    - Nécessite une coordination entre plusieurs équipes
    - Nécessite une gestion du changement significative

    Une Tâche peut durer 10 jours si elle est portée par une seule personne sans complexité transversale particulière.

---

## Tableau récapitulatif

| Type | Catégorie | Critère clé | Exemple |
|------|-----------|-------------|---------|
| **Incident** | Run | Interruption/dégradation non planifiée en production | Panne MES |
| **Problème** | Run | Cause racine d'incidents récurrents | Problèmes récurrents de performance Internet |
| **Demande** | Build | Modification planifiée du SI (>3j / multi-équipe / gestion du changement) | Nouveau champ SAP vers PLM |
| **Projet** | Build | Ensemble coordonné de tâches avec périmètre, chronologie, budget | Mise à niveau S4/HANA |
| **Bug** | Build | Défaut dans un système en développement | Règle de pare-feu incorrecte sur nouveau serveur |
| **Tâche** | Transversal | Action périmètrée, un responsable, pas de coordination multi-équipe | Renouveler un certificat SSL |

---

## Travailler avec les tâches -- Aide-mémoire

Le reste de ce guide couvre l'essentiel pratique. Pour tous les détails, consultez [Tâches](../tasks.md).

### Où vivent les tâches

| Contexte | Ce que cela signifie | Où créer |
|----------|---------------------|----------|
| **Autonome** | Travail indépendant, non lié à quoi que ce soit | **Portefeuille > Tâches > Nouveau** |
| **Projet** | Livrable au sein d'un projet | Espace de travail Projet onglet **Tâches**, ou raccourci phase **Chronologie** |
| **OPEX** | Action liée à une ligne OPEX | Espace de travail de la ligne budgétaire, panneau **Tâches** de l'onglet **Vue d'ensemble** |
| **Contrat** | Action liée à un contrat | Espace de travail Contrat onglet **Tâches** |
| **CAPEX** | Action liée à une ligne CAPEX | Espace de travail de la ligne budgétaire, panneau **Tâches** de l'onglet **Vue d'ensemble** |

Toutes les tâches apparaissent dans la liste centrale **Portefeuille > Tâches** quel que soit le contexte, vous avez donc toujours un endroit unique pour tout voir.

### Statuts en un coup d'oeil

| Statut | Couleur | Signification |
|--------|---------|--------------|
| **Ouvert** | Gris | Pas encore commencé |
| **En cours** | Orange | Quelqu'un travaille dessus |
| **En attente** | Bleu | Bloqué -- en attente d'un avis ou d'une décision |
| **En test** | Violet | Implémentation terminée, en attente de validation |
| **Terminé** | Vert | Achevé (nécessite du temps saisi pour les tâches projet) |
| **Annulé** | Rouge | N'est plus nécessaire |

### Niveaux de priorité

| Priorité | Quand l'utiliser |
|----------|-----------------|
| **Bloquant** | Bloque d'autres travaux -- attention immédiate |
| **Haute** | Important et urgent |
| **Normale** | Priorité standard (par défaut) |
| **Basse** | Peut être reporté |
| **Optionnelle** | Souhaitable |

### L'espace de travail de la tâche -- zones clés

Lorsque vous ouvrez une tâche, vous obtenez une barre latérale à gauche et une zone de contenu principale à droite.

**Sections de la barre latérale** :

- **Contexte** -- à quoi la tâche est liée (ou Autonome)
- **Détails de la tâche** -- type, priorité, statut
- **Classification** -- Source, Catégorie, Flux, Société (tâches autonomes et projet uniquement ; valeurs par défaut depuis les paramètres de l'organisation ou le projet parent)
- **Temps** -- temps total passé et bouton Saisir du temps (tâches autonomes et projet uniquement)
- **Personnes** -- demandeur, responsable, observateurs
- **Dates** -- dates de début et d'échéance
- **Base de connaissances** -- lier des articles de la base de connaissances à la tâche

**Contenu principal** :

- **Description** -- un éditeur markdown avec support de la mise en forme, listes, blocs de code, liens et images collées
- **Import / Export** -- importer un fichier `.docx` dans la description, ou l'exporter en PDF, DOCX ou ODT
- **Pièces jointes** -- téléversement de fichiers par glisser-déposer (max. 20 Mo par fichier)
- **Activité** -- onglets Commentaires, Historique et Journal de temps

### Actions rapides à connaître

| Action | Comment |
|--------|---------|
| **Enregistrer** | Cliquez sur **Enregistrer** ou appuyez sur **Ctrl+S** (Cmd+S sur Mac) |
| **Convertir en demande** | Barre d'outils de l'en-tête -- promeut une tâche en demande formelle de portefeuille lorsque le périmètre grandit |
| **Envoyer un lien** | Barre d'outils de l'en-tête -- envoyer un lien par e-mail à des collègues ou contacts externes |
| **Saisir du temps en ligne** | Dans l'onglet Commentaires, combinez un commentaire + changement de statut + saisie de temps en une seule soumission |
| **Copier la référence** | Cliquez sur la pastille de référence (ex. : T-42) pour la copier dans votre presse-papiers |

### Ce qui varie selon le contexte

Toutes les fonctionnalités ne sont pas disponibles dans chaque contexte. Voici ce qui change :

| Fonctionnalité | Autonome | Projet | OPEX / Contrat / CAPEX |
|----------------|:--------:|:------:|:----------------------:|
| Champs de classification | Oui | Oui (par défaut depuis le projet) | Non |
| Suivi du temps | Oui | Oui (alimente le réalisé projet) | Non |
| Affectation de phase | Non | Oui | Non |
| Badge score de priorité | Fixe par priorité | Calculé depuis projet + priorité | Fixe par priorité |
| Terminé nécessite du temps saisi | Non | Oui | Non |

### Valeurs de classification par défaut

Lorsque vous créez une **tâche autonome**, KANAP pré-remplit les champs de classification (Source, Catégorie, Flux, Société) depuis les paramètres par défaut de votre organisation -- vous épargnant quelques clics. Pour les **tâches projet**, les valeurs de classification par défaut proviennent du projet parent mais peuvent être modifiées indépendamment sur chaque tâche.

---

## Personnaliser les types de tâches

Tous les types d'éléments de travail sont **configurables** dans **Portefeuille > Paramètres**. Vous pouvez :

- **Ajouter** de nouveaux types pour correspondre aux processus de votre organisation
- **Désactiver** des types existants dont vous n'avez pas besoin
- **Renommer** des types pour s'adapter à votre terminologie

La liste de ce guide est un point de départ. Adaptez-la à la façon dont votre département IT fonctionne réellement.

---

## Pour aller plus loin

- [Tâches](../tasks.md) -- référence complète pour les statuts, import/export CSV, suivi du temps et chaque fonctionnalité de l'espace de travail
- [Lignes budgétaires](../budget-lines.md) : gestion des lignes OPEX et CAPEX et de leurs tâches
- [Contrats](../contracts.md) -- gestion des contrats et de leurs tâches
- [Projets du portefeuille](../portfolio-projects.md) -- livraison de projet, phases, suivi de charge et tâches au niveau projet
- [Premiers pas](getting-started.md) -- si vous êtes nouveau dans KANAP

!!! success "Vous êtes prêt"
    Vous comprenez maintenant comment KANAP catégorise le travail et comment utiliser les tâches au quotidien. En cas de doute sur le bon type d'élément de travail, demandez-vous : **est-ce que ça maintient les choses en fonctionnement (Run), ou est-ce que ça les améliore (Build) ?** Puis choisissez le type correspondant. Pour tout le reste, il y a la Tâche.
