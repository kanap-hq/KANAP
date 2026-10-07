# Mon tableau de bord

Le Tableau de bord est votre page d'accueil personnelle dans KANAP. Il vous donne un aperçu rapide de vos tâches, projets, temps enregistré et activité récente -- le tout en un seul endroit. Vous pouvez personnaliser les tuiles affichées, et le tableau de bord masque toute tuile que vous n'avez pas l'autorisation de voir.

## Où le trouver

- Cliquez sur le logo **KANAP** ou rendez-vous sur `/`
- C'est la page par défaut après connexion pour les utilisateurs non administrateurs.
- Aucune autorisation spéciale n'est requise pour consulter le tableau de bord lui-même, mais les tuiles individuelles dépendent de vos droits d'accès.

## Actions rapides

La bande d'en-tête en haut du tableau de bord fournit des boutons de raccourci pour le travail courant du quotidien. Chaque bouton n'est affiché que si vous avez l'autorisation correspondante.

- **Créer une tâche** -- ouvre le flux de création de tâche autonome. Nécessite `tasks:member` ou supérieur.
- **Enregistrer du temps** -- ouvre la boîte de dialogue **Enregistrement rapide du temps** (voir ci-dessous). Nécessite `portfolio_projects:member` ou `tasks:member`.
- **Nouvelle demande** -- ouvre le flux de création de demande. Nécessite `portfolio_requests:member` ou supérieur.
- **Nouvelle application** -- ouvre le flux de création d'application. Nécessite `applications:member` ou supérieur.
- **Nouvel actif** -- ouvre le flux de création d'actif. Nécessite `infrastructure:member` ou supérieur.
- **Nouveau document** (bouton à options) -- crée un document de connaissances vierge, ou ouvre le sélecteur de modèles pour démarrer à partir d'un modèle publié. Nécessite `knowledge:member` ou supérieur.
- **Paramètres** (icône engrenage) -- ouvre la boîte de dialogue des paramètres du tableau de bord pour choisir les tuiles à afficher.

### Enregistrement rapide du temps

L'action **Enregistrer du temps** ouvre une boîte de dialogue ciblée pour enregistrer des heures sans quitter le tableau de bord.

- Choisissez la cible -- **Projet** ou **Tâche**.
  - Les entrées Projet enregistrent du temps directement sur un projet du portefeuille.
  - Les entrées Tâche enregistrent du temps sur l'une de vos tâches actives (tâches de projet ou tâches autonomes). Les tâches OPEX, CAPEX et contrat sont intentionnellement exclues du sélecteur.
- Choisissez le projet ou la tâche dans le menu déroulant.
- Saisissez les **Heures** (par incréments de 0,25).
- Choisissez une **Catégorie** : **IT** ou **Métier**.
- Ajoutez des **Notes** si vous voulez du contexte sur ce sur quoi vous avez travaillé.

Après l'enregistrement, la tuile de synthèse du temps du tableau de bord se rafraîchit automatiquement.

## Ligne des données d'exemple

Dans un espace de travail cloud encore vide, les administrateurs voient une ligne au-dessus des tuiles : « Découvrez KANAP avec des données d'exemple. » **Charger** ouvre la fenêtre des données d'exemple et **Masquer** supprime la ligne définitivement. La ligne disparaît dès que l'espace de travail contient des données. Voir [Données d'exemple](sample-data.md).

## Tuiles du tableau de bord

Le tableau de bord affiche une grille de tuiles, chacune montrant un aspect différent de votre travail. Les tuiles sont disposées dans une grille responsive (trois colonnes sur les grands écrans, deux sur les moyens, une sur les petits). Les tuiles que vous n'avez pas l'autorisation de voir ne sont pas chargées du tout.

### Mes tâches

Affiche vos tâches actives regroupées par urgence :

- **En retard** -- tâches dont la date d'échéance est passée (mises en évidence en rouge)
- **Dues cette semaine** -- tâches dues dans les 7 prochains jours
- **Plus tard** -- tout le reste

Chaque tâche affiche son titre, le projet lié (le cas échéant), la date d'échéance et un badge de priorité lorsque la priorité est au-dessus de la normale. Cliquez sur une tâche pour ouvrir son espace de travail.

Affiche jusqu'à 5 éléments au total, répartis entre les trois groupes.

**Paramètres** : nombre maximum d'éléments, masquer la section En retard.

**Nécessite** : `tasks:reader`

---

### Projets que je dirige

Liste les projets où vous avez un rôle de leadership (Responsable IT, Responsable métier, Sponsor IT ou Sponsor métier). Chaque projet affiche :

- Votre rôle
- Statut actuel du projet (pastille colorée)
- Prochain jalon et sa date cible, le cas échéant

Cliquer sur un projet ouvre l'espace de travail du projet.

Affiche jusqu'à 5 éléments.

**Nécessite** : `portfolio_projects:reader`

---

### Projets auxquels je contribue

Liste les projets où vous êtes membre d'équipe. Chaque projet affiche :

- Votre équipe (Équipe IT ou Équipe métier)
- Statut actuel du projet
- Nombre de tâches qui vous sont assignées dans ce projet

Cliquer sur un projet ouvre l'espace de travail du projet.

Affiche jusqu'à 5 éléments.

**Nécessite** : `portfolio_projects:reader` et `tasks:reader`

---

### Récemment consultés

Affiche les éléments que vous avez récemment ouverts dans l'application -- projets, demandes, applications, actifs, interfaces, connexions, contrats, tâches, postes OPEX et CAPEX, et documents de connaissances. Chaque entrée affiche le nom de l'élément, son type, et quand vous l'avez consulté pour la dernière fois.

Les éléments récemment consultés sont stockés localement dans votre navigateur et limités au tenant et à l'utilisateur courants. Cliquez sur **Effacer** pour réinitialiser la liste. Les éléments auxquels vous n'avez plus l'autorisation d'accéder sont filtrés automatiquement.

Affiche jusqu'à 5 éléments.

**Nécessite** : Aucune autorisation spéciale.

---

### Mon temps la semaine dernière

Affiche un résumé du temps que vous avez enregistré sur une période récente :

- **Heures totales** enregistrées (affichées de manière proéminente)
- **Répartition par catégorie** -- IT, Métier et Autres tâches (hors projet)
- **Top projets** -- un petit graphique en barres des projets sur lesquels vous avez passé le plus de temps

**Paramètres** : période en jours (7-30).

**Nécessite** : `portfolio_projects:reader`

---

### Nouvelles demandes

Affiche les demandes du portefeuille créées dans une période récente. Chaque demande affiche le nom, le demandeur, la date de création et un badge **Élevée** lorsque le score de priorité est au-dessus de 80.

Cliquer sur une demande ouvre l'espace de travail de la demande.

Affiche jusqu'à 5 éléments.

**Paramètres** : nombre maximum d'éléments, jours à remonter.

**Nécessite** : `portfolio_requests:reader`

---

### Connaissances

Affiche deux sections axées sur les connaissances dans la même tuile :

- **À relire** -- documents où vous êtes le relecteur ou approbateur actif, incluant depuis combien de temps la revue a été demandée et par qui. La couleur du badge indique si vous êtes à l'étape de revue ou d'approbation.
- **5 derniers consultés** -- les cinq derniers documents de connaissances que vous avez ouverts dans ce navigateur pour le tenant courant.

Les bibliothèques restreintes respectent leurs règles d'accès : vous ne voyez que les éléments à relire et les documents récents des bibliothèques que vous pouvez lire. Si vous avez perdu l'accès à un document précédemment consulté, il cesse d'apparaître ici.

**Nécessite** : `knowledge:reader`

---

### Conformité

Indique où en est la campagne de classification pour les applications que vous pouvez voir (applications retirées exclues) :

- **Avancement** -- une barre et trois compteurs : revues, à revoir (la classification a changé depuis la dernière revue ou n'a jamais été revue) et à compléter (un champ de classification est encore vide). Chaque compteur ouvre la liste des applications filtrée sur cet état.
- **Points d'attention** -- applications au niveau de criticité métier le plus élevé sans test de reprise depuis douze mois, applications au niveau le plus critique sans vague de reprise, et applications détenant les données les plus confidentielles avec la criticité cyber la plus faible. Seuls les points comptant au moins une application sont listés ; chacun ouvre la liste filtrée correspondante. Quand rien n'appelle d'action, la tuile l'indique.

Les niveaux sont ceux définis dans les paramètres de la cartographie SI ; un niveau qui n'est plus proposé n'est jamais compté comme le plus élevé ou le plus faible.

**Nécessite** : `applications:reader`

---

### Activité de l'équipe

Affiche l'activité projet récente sur les projets où vous êtes impliqué (modifications, commentaires, décisions). Chaque ligne indique le projet, le type d'activité, l'auteur et un court résumé. Cliquez sur un élément pour sauter à l'onglet d'activité du projet.

**Paramètres** : nombre maximum d'éléments.

**Nécessite** : `portfolio_projects:reader`

---

### Changements de statut des projets

Affiche les transitions de statut récentes des projets (de → vers) à travers les projets, afin que vous puissiez voir quelles initiatives ont avancé, ont été mises en pause ou ont été clôturées au cours des derniers jours.

**Paramètres** : jours à remonter (1-14).

**Nécessite** : `portfolio_projects:reader`

---

### Tâches en attente

Affiche les tâches qui n'ont pas été mises à jour depuis longtemps. Chaque élément affiche la pastille jours-en-attente (avertissement, puis erreur passée le double du seuil) et l'objet lié, le cas échéant.

**Paramètres** : périmètre (`mes`, `équipe`, `tous`) et seuil en jours (30-365).

**Nécessite** : `tasks:reader`

## Personnaliser votre tableau de bord

Cliquez sur l'icône **Paramètres** (engrenage) dans l'en-tête du tableau de bord pour ouvrir la boîte de dialogue des paramètres du tableau de bord.

Depuis là, vous pouvez :

- **Activer ou désactiver des tuiles** -- cochez ou décochez chaque tuile pour contrôler ce qui apparaît sur votre tableau de bord.
- **Réinitialiser par défaut** -- restaurer la sélection de tuiles d'origine.

Seules les tuiles que vous avez l'autorisation de voir apparaissent dans la liste des paramètres. Les modifications sont enregistrées sur votre compte et persistent entre sessions et appareils.

Si toutes les tuiles sont désactivées, le tableau de bord affiche un message vous invitant à en activer.

## Conseils

- **Commencez avec les valeurs par défaut** : le tableau de bord est livré avec un ensemble utile de tuiles déjà activées. Essayez-le pendant quelques jours avant de personnaliser.
- **Utilisez les actions rapides** : créer une tâche, demande ou document -- ou enregistrer du temps -- directement depuis le tableau de bord vous évite de naviguer.
- **Vérifiez les tâches en retard quotidiennement** : la tuile Mes tâches met en évidence les éléments en retard en rouge afin que rien ne passe entre les mailles du filet.
- **Utilisez Tâches en attente au périmètre équipe** : avec `tasks:admin`, basculez la tuile Tâches en attente sur le périmètre `équipe` ou `tous` pour trouver le travail que personne ne met à jour à travers l'organisation.
