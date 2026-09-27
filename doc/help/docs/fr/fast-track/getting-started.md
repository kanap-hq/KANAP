---
title: "Premiers pas : vos 10 premières minutes dans KANAP"
description: Un guide d'intégration rapide pour tous les utilisateurs. Tableau de bord, profil, tâches, notifications et concepts clés pour être à l'aise rapidement.
---

# Premiers pas : vos 10 premières minutes dans KANAP

Bienvenue dans KANAP. Ce guide vous accompagne dans tout ce dont vous avez besoin pour être productif dès le premier jour -- quel que soit votre rôle. Aucune connaissance d'administration requise, aucune plongée spécifique dans un module. Juste l'essentiel pour vous sentir à l'aise.

!!! tip "Conseil : Vous préférez un résumé sur une page ? :material-file-pdf-box:"
    Toutes les étapes clés sur une seule page A4 -- imprimez-la, épinglez-la, partagez-la avec votre équipe.

    [:material-download: Télécharger l'aide-mémoire (PDF)](downloads/kanap-getting-started.pdf){ .md-button .md-button--primary }

Pour les flux de travail spécifiques à un rôle, consultez le [Fast Track Portefeuille](index.md) et le [Fast Track Cartographie SI](apps-and-assets.md).

---

## La vue d'ensemble

KANAP est organisé autour d'une structure simple. La barre supérieure affiche les sections auxquelles vous avez accès :

| Zone | Ce qu'elle contient |
|------|---------------------|
| **Tableau de bord** | Votre hub personnel -- cliquez sur le logo KANAP ou naviguez vers `/` |
| **Portefeuille** | Tâches, Demandes, Projets, Planification, Rapports, Contributeurs |
| **Cartographie SI** | Applications, Interfaces, Carte des interfaces, Actifs, Connexions, Carte des connexions, Sites |
| **Base de connaissances** | Documents et modèles avec workflows de revue |
| **Gestion budgétaire** | OPEX, CAPEX, Contrats, Rapports, Administration |
| **Données de référence** | Sociétés, Départements, Centres de coûts, Fournisseurs, Contacts, Plans comptables, Devise, Processus métier, Dimensions analytiques |
| **Administration** | Utilisateurs, Rôles, Journal d'audit, Facturation, Authentification, Personnalisation (admin uniquement) |

Vous n'avez pas besoin d'accéder à tout. Votre rôle détermine quelles sections et actions sont disponibles. Si quelque chose manque dans votre menu, demandez à votre administrateur.

---

## Étape 1 : Explorez votre tableau de bord

Après la connexion, vous arrivez sur le **Tableau de bord**. C'est votre centre de commande personnel.

### Ce que vous verrez

Une grille de tuiles, chacune montrant un aspect différent de votre travail. Voici les plus courantes :

| Tuile | Ce qu'elle affiche |
|-------|-------------------|
| **Mes tâches** | Vos tâches assignées, regroupées par urgence (En retard, Cette semaine, Plus tard) |
| **Projets que je pilote** | Projets où vous êtes Responsable IT, Responsable métier ou Sponsor |
| **Projets auxquels je contribue** | Projets où vous êtes membre de l'équipe |
| **Mon temps la semaine dernière** | Heures saisies, ventilation par catégorie, principaux projets |
| **Consultés récemment** | Éléments récemment ouverts dans l'application |
| **Nouvelles demandes** | Demandes du portefeuille créées récemment |
| **Base de connaissances** | Documents en attente de votre revue, plus vos documents récemment consultés |
| **Activité de l'équipe** | Activité récente sur les projets auxquels vous participez |
| **Changements de statut projet** | Derniers changements de statut de projets |
| **Tâches en retard** | Tâches qui n'ont pas été mises à jour depuis un moment |

### Actions rapides

En haut du tableau de bord, vous trouverez des boutons raccourcis pour les actions courantes :

- **Créer une tâche** -- ouvrir un formulaire rapide pour créer une tâche sans quitter le tableau de bord
- **Saisir du temps** -- saisir des heures sur un projet en quelques secondes
- **Nouveau document** -- créer un document vierge de la base de connaissances ou en créer un à partir d'un modèle

### Personnalisez-le

Cliquez sur l'icône **Paramètres** (engrenage) pour choisir quelles tuiles apparaissent. Seules les tuiles que vous avez l'autorisation de voir sont affichées. Commencez avec les valeurs par défaut pendant quelques jours, puis ajustez selon vos besoins.

!!! tip "Conseil : Faites-en le vôtre"
    Le tableau de bord est conçu pour répondre à « sur quoi devrais-je me concentrer aujourd'hui ? » en un coup d'oeil. Si une tuile ne vous est pas utile, masquez-la. Si quelque chose vous manque, vérifiez l'icône engrenage -- elle est peut-être simplement désactivée.

---

## Étape 2 : Configurez votre profil

Cliquez sur votre **avatar** (en haut à droite) > **Mon profil**, ou naviguez vers `/settings/profile`.

### Onglet Profil

Mettez à jour vos informations personnelles :

- **Prénom** / **Nom**
- **Intitulé de poste**
- **Téléphone professionnel** / **Téléphone mobile**

!!! info "Information : Utilisateurs SSO"
    Si votre organisation utilise Microsoft Entra ID (SSO), certains champs sont synchronisés automatiquement et ne peuvent pas être modifiés dans KANAP.

### Onglet Notifications

Contrôlez quelles notifications par e-mail vous recevez. La bascule principale en haut active ou désactive toutes les notifications.

Vous pouvez affiner les notifications par espace de travail :

| Espace de travail | Ce que vous pouvez basculer |
|-------------------|-----------------------------|
| **Portefeuille** | Changements de statut, ajouts à une équipe, changements d'équipe sur les éléments que vous pilotez, commentaires |
| **Tâches** | Notifications d'assignation (comme responsable, demandeur ou observateur), changements de statut, commentaires |
| **Budget** | Alertes d'expiration, changements de statut, commentaires |

### L'e-mail de revue hebdomadaire

C'est un résumé périodique de votre activité et des éléments à venir -- comme un digest personnel.

Configurez-le dans l'onglet Notifications :

| Paramètre | Quoi définir |
|-----------|-------------|
| **Jour** | Quel jour de la semaine (ex. : lundi) |
| **Heure** | À quelle heure (dans votre fuseau horaire) |
| **Fuseau horaire** | Votre fuseau horaire local |

Cliquez sur **Aperçu de l'e-mail** pour vous envoyer un test et voir à quoi il ressemble.

!!! tip "Conseil : Ne sautez pas cette étape"
    L'e-mail hebdomadaire est étonnamment utile. Il fait remonter les tâches que vous auriez pu oublier, les échéances à venir et l'activité récente. Configurez-le une fois et laissez-le travailler pour vous.

### Onglet Apparence

Choisissez votre mode de thème préféré :

- **Clair** -- interface lumineuse
- **Sombre** -- éblouissement réduit pour les environnements peu éclairés
- **Système** -- suit la préférence de votre système d'exploitation

Vous pouvez aussi basculer le thème rapidement depuis la barre supérieure en utilisant l'icône de thème (soleil/lune) à côté du bouton d'aide.

---

## Étape 3 : Comprenez les filtres de périmètre

C'est le concept le plus important pour les nouveaux utilisateurs. Chaque liste majeure dans KANAP (Tâches, Applications, Projets, Demandes) a un **filtre de périmètre** en haut :

| Périmètre | Ce qu'il affiche |
|-----------|-----------------|
| **Mes [éléments]** | Les éléments où vous êtes directement assigné (responsable, assigné, pilote...) |
| **[Éléments] de mon équipe** | Les éléments possédés ou assignés à n'importe qui dans votre équipe Portefeuille |
| **Tous les [éléments]** | Tout dans l'organisation |

### Pourquoi c'est important

Si vous ouvrez la page Tâches et ne voyez rien -- pas de panique. Vous consultez probablement « Mes tâches » et rien ne vous est encore assigné. Passez à « Toutes les tâches » pour voir l'ensemble.

Le filtre de périmètre **mémorise votre dernière sélection** entre les sessions. Donc si vous passez à « Toutes », il reste sur « Toutes » la prochaine fois que vous visitez.

!!! warning "Avertissement : Pas d'équipe = pas de filtre « Mon équipe »"
    L'option « Mon équipe » ne fonctionne que si vous avez été assigné à une équipe Portefeuille via la page Contributeurs. Si elle est grisée, demandez à votre admin ou chef de projet de configurer votre profil Contributeur.

### Où les filtres de périmètre apparaissent

- **Portefeuille > Tâches** -- Mes tâches / Tâches de mon équipe / Toutes les tâches
- **Cartographie SI > Applications** -- Mes apps / Apps de mon équipe / Toutes les apps
- **Portefeuille > Projets** -- Mes projets / Projets de mon équipe / Tous les projets
- **Portefeuille > Demandes** -- Mes demandes / Demandes de mon équipe / Toutes les demandes

La logique est toujours la même : la propriété et l'affectation d'équipe déterminent ce que vous voyez.

---

## Étape 4 : Travaillez avec les tâches

Les tâches sont votre outil quotidien. Elles suivent les actions, les livrables, les relances et tout ce qui doit être fait.

### Trouvez vos tâches

Rendez-vous dans **Portefeuille > Tâches**. La vue par défaut affiche **Mes tâches** -- les éléments qui vous sont assignés, triés par score de priorité.

### Créez une tâche

Deux façons :

1. **Depuis le tableau de bord** -- cliquez sur **Créer une tâche** (formulaire rapide, champs minimaux)
2. **Depuis la page Tâches** -- cliquez sur **Nouveau** (espace de travail complet avec toutes les options)

Le minimum nécessaire :

| Champ | Quoi saisir |
|-------|------------|
| **Titre** | Ce qui doit être fait |
| **Responsable** | Qui est en charge (par défaut vous) |
| **Date d'échéance** | Pour quand c'est nécessaire |

### Liez les tâches à des projets, contrats ou budgets

Lors de la création d'une tâche, vous pouvez la lier à un **Projet**, un **poste OPEX**, un **Contrat** ou un **poste CAPEX**. Cela fait apparaître la tâche à la fois dans la liste des tâches et dans l'espace de travail parent.

!!! tip "Conseil : Créez depuis le contexte"
    La manière la plus rapide de créer une tâche liée est depuis l'espace de travail parent. Ouvrez un projet > onglet Tâches > Nouveau. Le lien est pré-rempli.

### Suivez l'avancement

Faites évoluer les tâches à travers les statuts au fur et à mesure que le travail progresse :

| Statut | Quand l'utiliser |
|--------|-----------------|
| **Ouvert** | Pas encore commencé (par défaut) |
| **En cours** | Le travail a commencé |
| **Terminé** | Achevé (nécessite du temps saisi pour les tâches projet) |
| **Annulé** | N'est plus nécessaire |

### Saisissez du temps

Pour les tâches projet, la saisie de temps est essentielle -- elle alimente le générateur de roadmap et la planification de capacité.

1. Ouvrez la tâche > cliquez sur **Saisir du temps** dans la barre latérale
2. Choisissez la catégorie : **IT** ou **Métier**
3. Saisissez la date, les heures et des notes optionnelles

### Partagez une tâche

Besoin d'impliquer quelqu'un ? Cliquez sur **Envoyer un lien** dans l'en-tête de la tâche pour envoyer par e-mail un lien direct à n'importe quel collègue -- même des personnes en dehors de KANAP. Ajoutez un message personnel si nécessaire.

!!! info "Information : Envoyer un lien fonctionne partout"
    Ce n'est pas réservé aux tâches. Vous pouvez envoyer des liens vers des projets, demandes, contrats, applications -- tout objet d'espace de travail. C'est la manière la plus rapide d'orienter quelqu'un vers le bon endroit.

---

## Étape 5 : Configurez votre profil contributeur

Votre profil Contributeur indique à KANAP qui vous êtes en termes de planification de projet. Il est séparé de votre compte utilisateur -- il concerne **l'équipe, la disponibilité et les compétences**.

Rendez-vous dans **Portefeuille > Contributeurs** et trouvez votre nom (ou demandez à votre admin de vous ajouter).

### Quoi configurer

| Paramètre | Ce qu'il fait | Exemple |
|-----------|--------------|---------|
| **Équipe** | Votre équipe organisationnelle | Infrastructure, Service Desk... |
| **Disponibilité** | Jours par mois pour le travail projet (0-20) | 8 jours/mois |
| **Compétences** | Ce que vous savez et à quel niveau | « Docker -- Autonome » |

### Pourquoi c'est important

- **Équipe** > active les filtres de périmètre « Mon équipe » dans toute l'application
- **Disponibilité** > alimente le générateur de roadmap et les cartes de chaleur de capacité
- **Compétences** > aide les chefs de projet à trouver les bonnes personnes pour le travail à venir

!!! tip "Conseil : Soyez réaliste avec la disponibilité"
    Tenez compte des réunions, du travail courant et des congés. La plupart des gens ont moins de temps projet qu'ils ne pensent. Définir 20 jours/mois signifie zéro temps hors projet -- c'est presque jamais vrai.

### Maîtrise des compétences

Chaque compétence a un niveau de maîtrise :

| Niveau | Signification |
|--------|--------------|
| 0 | Aucune connaissance |
| 1 | Base / Théorique |
| 2 | Peut exécuter avec support |
| 3 | Autonome |
| 4 | Expert -- peut former les autres |

Soyez honnête. Une carte de compétences réaliste est bien plus utile qu'une carte où tout le monde est « expert ».

---

## Comment tout s'interconnecte

Tout ce que vous configurez dans ces 10 premières minutes alimente un ensemble plus large :

### Votre tableau de bord
Les tuiles exploitent vos assignations de tâches, rôles de projet et saisies de temps pour vous donner une vue d'ensemble personnalisée chaque matin.

### Filtres de périmètre
Vos assignations de propriété et votre appartenance à une équipe déterminent ce qui remonte dans chaque liste -- rendant l'application personnelle, pas écrasante.

### Planification de capacité
Votre disponibilité et vos saisies de temps alimentent le générateur de roadmap et les cartes de chaleur de capacité du module Portefeuille. Des données précises ici signifient une meilleure planification pour tout le monde.

### Notifications
L'e-mail hebdomadaire et les notifications en temps réel vous tiennent informé sans vérifier l'application constamment.

### Envie d'aller plus loin ?

| Si vous travaillez avec... | Lisez le... |
|-----------------------------|-------------|
| Applications, serveurs, infrastructure | [Fast Track Cartographie SI](apps-and-assets.md) |
| Demandes, projets, planification de portefeuille | [Fast Track Portefeuille](index.md) |

---

## Référence rapide

| Je veux... | Aller à... |
|------------|-----------|
| Voir ma vue d'ensemble | Tableau de bord (cliquez sur le logo KANAP) |
| Créer une tâche rapidement | Tableau de bord > bouton Créer une tâche |
| Saisir du temps rapidement | Tableau de bord > bouton Saisir du temps |
| Créer un nouveau document | Tableau de bord > bouton Nouveau document |
| Voir toutes mes tâches | Portefeuille > Tâches (périmètre : Mes tâches) |
| Voir tout dans l'organisation | N'importe quelle liste > filtre de périmètre > « Tous » |
| Mettre à jour mon profil | Avatar > Mon profil > onglet Profil |
| Configurer les notifications | Avatar > Mon profil > onglet Notifications |
| Configurer l'e-mail hebdomadaire | Avatar > Mon profil > onglet Notifications > Revue hebdomadaire |
| Changer de thème (clair/sombre) | Avatar > Mon profil > onglet Apparence |
| Définir ma disponibilité | Portefeuille > Contributeurs > votre nom |
| Ajouter mes compétences | Portefeuille > Contributeurs > votre nom > onglet Compétences |
| Partager un lien vers n'importe quoi | Ouvrez n'importe quel espace de travail > Envoyer un lien |
| Personnaliser mon tableau de bord | Tableau de bord > Paramètres (icône engrenage) |

---

!!! success "Vous êtes prêt"
    Vous savez maintenant comment naviguer dans KANAP, gérer vos tâches, configurer votre profil et vos notifications, et paramétrer votre profil contributeur. Commencez par votre tableau de bord chaque matin, gardez vos tâches à jour et saisissez du temps régulièrement -- le reste suivra naturellement.
