---
title: "Votre portefeuille dans KANAP en dix minutes : commencer avec vos données"
description: Cinq pas pour mettre vos propres projets et demandes dans KANAP, du premier projet au planning, puis l'ouvrir à un chef de projet, en dix minutes.
---

<!--
Brouillon du 31 octobre 2026, à relire avant publication.
Dépend encore d'une décision :
- Langue des données d'exemple : sans effet sur ce texte, qui ne cite aucune donnée d'exemple ; les captures attendent cette décision et la livraison des écrans d'onboarding de la 26.11, et se prendront sur un espace rempli de données vraisemblables.
- Prise de rendez-vous avec le fondateur. La fin de page renvoie aux deux autres parcours ; si le rendez-vous est retenu, y ajouter son lien.
Écrit pour la 26.11 :
- Pas 1 : le dépôt d'un fichier à Plaid suppose l'import par Plaid de la 26.11.
Écart avec la liste « Vos cinq premiers pas » prévue :
- Pas 3 : la fiche projet n'affiche pas d'écart ; elle donne le montant de la colonne par défaut des lignes liées. L'écart se lit sur la ligne budgétaire, onglet « Budget ».
À signaler : les critères d'évaluation créés par défaut portent des noms anglais (« Business value »…) dans un espace en français.
-->

# Votre portefeuille dans KANAP en dix minutes

[Découvrir avec l'exemple](portfolio-example.md) · **Commencer avec mes données**

En dix minutes, vous aurez vos projets dans KANAP, une demande notée puis convertie en projet, le budget d'un projet, votre planning, et un chef de projet pour le tenir à jour. Votre espace de travail est vide : tout ce que vous voyez à la fin vient de vous.

## 1. Vos projets

:material-clock-outline: 2 minutes

Un projet porte un statut, des dates, une charge estimée et une équipe, avec un responsable IT et un responsable métier.

**Le geste.** Le plus court : ouvrez « Plaid », glissez votre liste de projets, en Excel ou en CSV, sur la zone de saisie et écrivez « Importe ces projets ». Plaid montre comment il a lu chaque colonne ; corrigez ce qui doit l'être, puis approuvez. Sans fichier : « Portefeuille » › « Projets » › « Nouveau projet ». Saisissez le « Nom du projet », le « Début prévu » et la « Fin prévue », choisissez le « Responsable IT » dans la section « Équipe », puis « Créer ».

**Ce que vous lisez.** Avec Plaid : ce qu'il a placé, ce qu'il a supposé et ce qu'il n'a pas su placer, puis la vérification de KANAP ; rien n'est chargé tant qu'une erreur reste. Dans « Projets », une ligne par projet, avec son « Statut », sa « Priorité » et sa « Charge ».

<!-- capture : Portefeuille › Projets, liste après import de quelques projets ; cadrer les colonnes Statut, Priorité, Charge, Début et Fin -->

## 2. Une demande

:material-clock-outline: 2 minutes

Une demande est un projet qui n'a pas encore été décidé : KANAP la note sur des critères communs, pour que l'arbitrage compare des choses comparables.

**Le geste.** Ouvrez « Portefeuille » › « Demandes » › « Nouvelle demande », saisissez le « Nom de la demande », puis « Créer ». Dans l'onglet « Évaluation », répondez à chaque critère. Passez le « Statut » à « Approuvé », puis « Convertir en projet » et « Créer le projet ».

**Ce que vous lisez.** Le « Score de priorité », sur 100, recalculé à chaque réponse. Les critères et leurs poids se règlent dans « Portefeuille » › « Paramètres », onglet « Critères d'évaluation » : adaptez-les une fois, ils valent pour toutes les demandes. Après la conversion, le projet apparaît dans « Projets » et la demande passe à « Converti ».

<!-- capture : Portefeuille › Demandes, fiche d'une demande, onglet « Évaluation » ; cadrer les critères et le score de priorité -->

## 3. Le budget d'un projet

:material-clock-outline: 2 minutes

Un projet consomme des lignes budgétaires, OPEX ou CAPEX ; les lier fait voir le budget du projet depuis sa fiche.

**Le geste.** Ouvrez un projet, onglet « Relations », section « Lignes budgétaires », et cliquez sur « Ajouter ». Choisissez la ligne qui finance le projet ; si elle n'existe pas encore, créez-la dans « Gestion budgétaire » › « Lignes budgétaires » › « Nouvelle ligne ». Ouvrez ensuite la ligne par sa référence.

**Ce que vous lisez.** Dans « Relations », chaque ligne liée avec son type, son fournisseur et son montant de l'année dans la colonne « Budget », et leur total dès deux lignes. Sur la ligne budgétaire, l'onglet « Budget » compare les colonnes : le « Résultat par mois » donne l'« Écart avec » le réalisé, mois par mois.

<!-- capture : Portefeuille › Projets, fiche d'un projet, onglet « Relations », section « Lignes budgétaires » avec deux lignes et leur total ; cadrer la section -->

## 4. Votre planning

:material-clock-outline: 2 minutes

Le planning place tous les projets sur une même frise ; une dépendance dit qu'un projet attend la fin d'un autre.

**Le geste.** Ouvrez « Portefeuille » › « Planification » et choisissez la « Période » « 1 an ». Puis ouvrez un projet, onglet « Relations », section « Dépendances » : dans « Ajouter une dépendance », choisissez le projet dont il dépend.

**Ce que vous lisez.** La « Chronologie du portefeuille » montre une barre par projet, de son début à sa fin prévus ; glisser une barre change ses dates. La dépendance apparaît sous « Dépendances actuelles ». Quand vos équipes sont saisies, « Portefeuille » › « Rapports » › « Planning de capacité » compare la charge prévue à leur capacité.

<!-- capture : Portefeuille › Planification, « Chronologie du portefeuille » sur un an avec quelques projets ; cadrer les barres -->

## 5. Un collègue

:material-clock-outline: 2 minutes

Un portefeuille reste juste quand les chefs de projet tiennent eux-mêmes leurs dates et leur avancement.

**Le geste.** Ouvrez « Administration » › « Utilisateurs » › « Nouveau ». Saisissez l'« E-mail » d'un chef de projet, choisissez dans « Rôles » « Membre portefeuille » et, pour qu'il voie le budget de ses projets, « Lecteur budget ». Puis « Enregistrer et inviter ».

**Ce que vous lisez.** Votre collègue apparaît avec le statut « Invité » et reçoit l'e-mail « Vous êtes invité sur KANAP », avec un lien pour choisir son mot de passe. Une fois entré, il crée et met à jour demandes, projets et planning ; les rôles se cumulent, et « Lecteur budget » lui ouvre la section « Lignes budgétaires » de ses projets, en lecture.

<!-- capture : Administration › Utilisateurs, fenêtre « Nouvel utilisateur » avec les rôles « Membre portefeuille » et « Lecteur budget » ; cadrer l'e-mail, les rôles et le bouton « Enregistrer et inviter » -->

## Et ensuite

Votre portefeuille est dans KANAP. Les deux autres parcours prennent aussi dix minutes, sur vos données :

- [Votre budget IT dans KANAP en dix minutes](budget-own-data.md)
- [Votre système d'information dans KANAP en dix minutes](landscape-own-data.md)

Pour aller plus loin sur ce parcours : [Projets](../portfolio-projects.md), [Demandes](../portfolio-requests.md), [Planification](../portfolio-planning.md), [Paramètres](../portfolio-settings.md).
