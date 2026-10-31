---
title: "Votre portefeuille dans KANAP en dix minutes : découvrir avec l'exemple"
description: Cinq pas sur l'exemple Fromage & Co pour voir ce que KANAP fait de vos projets et de vos demandes, du score d'une demande au planning, en dix minutes.
---

<!--
Brouillon du 31 octobre 2026, à relire avant publication.
Dépend encore d'une décision :
- Langue des données d'exemple. Les noms cités (projets, demandes, critères d'évaluation) sont ceux du jeu Fromage & Co actuel, en anglais. Si le jeu est traduit, reprendre les noms. Les captures attendent cette décision et la livraison des écrans d'onboarding de la 26.11.
- Prise de rendez-vous avec le fondateur. La fin de page renvoie aux deux autres parcours ; si le rendez-vous est retenu, y ajouter son lien.
Écarts avec la liste « Vos cinq premiers pas » prévue :
- Pas 1 : KANAP n'a pas de « météo » de projet ; le pas montre statut, priorité, charge et responsables. L'exemple ne lie aucun projet au budget : le pas fait poser le lien.
- Pas 4 : « Quels projets dépassent leur budget ? » n'a pas de réponse sur l'exemple (aucun lien projet-budget, et Plaid ne lit pas de budget par projet) ; remplacée par « Quelles demandes attendent un arbitrage ? », l'autre suggestion de Plaid pour ce parcours.
-->

# Votre portefeuille dans KANAP en dix minutes

**Découvrir avec l'exemple** · [Commencer avec mes données](portfolio-own-data.md)

En dix minutes, sur les projets de Fromage & Co, vous saurez lire un portefeuille, faire passer une demande de son score à un projet, placer les projets dans le temps et interroger Plaid, l'assistant. Fromage & Co est un groupe fromager fictif dont l'exemple est chargé dans votre espace de travail.

## 1. Le portefeuille

:material-clock-outline: 2 minutes

Un projet porte un statut, une priorité, une charge estimée et une équipe ; relié à des lignes budgétaires, il porte aussi son budget.

**Le geste.** Ouvrez « Portefeuille » › « Projets ». La liste montre tous les projets, sauf les terminés, triés par « Priorité ». Ouvrez « SAP Cheddar Migration ». Dans l'onglet « Relations », section « Lignes budgétaires », cliquez sur « Ajouter » et choisissez la ligne « SAP Cheddar Migration — S/4HANA upgrade ».

**Ce que vous lisez.** Dans la liste, le « Statut » (« Planifié », « En cours », « En test »…), l'« Origine » (le projet vient d'une demande ou non) et la « Charge », en pourcentage d'avancement. Sur la fiche, le panneau « Propriétés » donne l'équipe : Sophie Laurent en « Responsable IT », Maria Casanova en « Responsable métier ». Une fois la ligne liée, l'onglet « Relations » affiche son montant de l'année dans la colonne « Budget » : 350 000 €.

<!-- capture : Portefeuille › Projets, fiche « SAP Cheddar Migration » onglet « Relations » avec la ligne budgétaire liée ; cadrer la section « Lignes budgétaires » et le panneau « Propriétés » -->

## 2. Une demande et son scoring

:material-clock-outline: 2 minutes

Une demande est un projet qui n'a pas encore été décidé : KANAP la note sur des critères communs à toutes les demandes, pour que l'arbitrage compare des choses comparables.

**Le geste.** Ouvrez « Portefeuille » › « Demandes », puis « Cave Climate Digital Twin ». Ouvrez l'onglet « Évaluation ». La demande est « Approuvé » : cliquez sur « Convertir en projet », gardez le nom proposé, puis « Créer le projet ».

**Ce que vous lisez.** L'onglet « Évaluation » donne une réponse par critère (valeur métier, alignement stratégique, coût, retour sur investissement, risque, urgence, charge IT et métier) et le « Score de priorité » qui en découle : 64 sur 100. Les critères et leurs poids se règlent une fois pour toutes dans « Portefeuille » › « Paramètres ». Le nouveau projet apparaît dans « Projets » avec la charge estimée de la demande ; la demande passe à « Converti » et son évaluation est figée.

<!-- capture : Portefeuille › Demandes, fiche « Cave Climate Digital Twin » onglet « Évaluation » ; cadrer les critères et le score de priorité -->

## 3. Le planning

:material-clock-outline: 2 minutes

Le planning place tous les projets sur une même frise ; une dépendance dit qu'un projet attend la fin d'un autre.

**Le geste.** Ouvrez « Portefeuille » › « Planification » et choisissez la « Période » « 1 an ». Puis ouvrez le projet « Digital Cheese Passport », onglet « Relations », section « Dépendances » : dans « Ajouter une dépendance », choisissez « SAP Cheddar Migration ».

**Ce que vous lisez.** La « Chronologie du portefeuille » montre une barre par projet, de son début à sa fin prévus ; glisser une barre change ses dates. La dépendance apparaît sous « Dépendances actuelles ». Pour savoir si les équipes suivent, « Portefeuille » › « Rapports » › « Planning de capacité » compare la charge prévue à la capacité de chaque équipe.

<!-- capture : Portefeuille › Planification, « Chronologie du portefeuille » sur un an ; cadrer les barres des projets planifiés et en cours -->

## 4. Une question à Plaid

:material-clock-outline: 2 minutes

Plaid lit vos projets et vos demandes avec vos droits et répond en citant les fiches, que vous ouvrez d'un clic.

**Le geste.** Ouvrez « Plaid » dans la barre du haut et demandez : « Quelles demandes attendent un arbitrage ? »

**Ce que vous lisez.** Plaid liste les demandes qui ne sont ni approuvées, ni rejetées, ni converties, avec leur statut et leur score : « AI Cheese Grading », candidate, 44 ; « Smart Packaging Automation », en attente de revue, 26 ; « Automated Warehouse Inventory », suspendue. Vérifiez dans « Portefeuille » › « Demandes » : ce sont les mêmes.

<!-- capture : Plaid, réponse à « Quelles demandes attendent un arbitrage ? » ; cadrer la question et la liste des demandes citées -->

## 5. Vos données

:material-clock-outline: 2 minutes

Le plus court chemin vers votre propre portefeuille est le fichier que vous tenez déjà : Plaid le met au format de KANAP.

**Le geste.** Ouvrez « Plaid », glissez votre liste de projets, en Excel ou en CSV, sur la zone de saisie et écrivez : « Importe ces projets ». Plaid montre comment il a lu chaque colonne ; corrigez ce qui doit l'être, puis approuvez.

**Ce que vous lisez.** Ce que Plaid a placé, ce qu'il a supposé (une date, un statut) et ce qu'il n'a pas su placer. KANAP vérifie ensuite le fichier avant de charger quoi que ce soit, et dit ce qui bloque. Vos projets rejoignent ceux de l'exemple dans « Portefeuille » › « Projets ».

<!-- capture : Plaid, aperçu de la correspondance des colonnes d'une liste de projets avant import ; cadrer le tableau de correspondance et les boutons d'approbation -->

## Et ensuite

Vous avez vu l'essentiel de KANAP pour les projets et les demandes. Les deux autres parcours prennent aussi dix minutes :

- [Votre budget IT dans KANAP en dix minutes](budget-example.md)
- [Votre système d'information dans KANAP en dix minutes](landscape-example.md)

Pour aller plus loin sur ce parcours : [Projets](../portfolio-projects.md), [Demandes](../portfolio-requests.md), [Planification](../portfolio-planning.md).
