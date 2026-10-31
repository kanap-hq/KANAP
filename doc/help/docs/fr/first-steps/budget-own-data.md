---
title: "Votre budget IT dans KANAP en dix minutes : commencer avec vos données"
description: Cinq pas pour mettre votre propre budget IT dans KANAP, de votre société à votre premier rapport, puis l'ouvrir à un collègue, en dix minutes.
---

<!--
Brouillon du 31 octobre 2026, à relire avant publication.
Dépend encore d'une décision :
- Langue des données d'exemple : sans effet sur ce texte, qui ne cite aucune donnée d'exemple ; les captures attendent cette décision et la livraison des écrans d'onboarding de la 26.11, et se prendront sur un espace rempli de données vraisemblables.
- Prise de rendez-vous avec le fondateur. La fin de page renvoie aux deux autres parcours ; si le rendez-vous est retenu, y ajouter son lien.
Écrit pour la 26.11 :
- Pas 2 : le dépôt d'un fichier à Plaid suppose l'import par Plaid de la 26.11.
- Pas 4 : les tuiles budgétaires sont sur l'accueil (fusion prévue en 26.11) ; sinon « Gestion budgétaire › Vue d'ensemble ».
Écarts avec la liste « Vos cinq premiers pas » prévue :
- Pas 3 : KANAP n'a pas de contrat « principal » ni d'alerte de préavis en tant que telle ; une ligne peut porter plusieurs contrats, et l'approche de la date de résiliation crée une tâche de décision pour le responsable du contrat.
-->

# Votre budget IT dans KANAP en dix minutes

[Découvrir avec l'exemple](budget-example.md) · **Commencer avec mes données**

En dix minutes, vous aurez votre société, vos lignes budgétaires et un contrat dans KANAP, votre premier rapport sur vos chiffres, et un collègue qui peut les lire. Votre espace de travail est vide, à une exception près : la société créée à votre inscription.

## 1. Votre société

:material-clock-outline: 2 minutes

La société est l'entité juridique qui paie ; elle fixe la devise de ses lignes et le plan comptable où l'on choisit leurs comptes.

**Le geste.** Ouvrez « Données de référence » › « Sociétés », puis votre société, créée à l'inscription avec votre pays et sa devise. Complétez la « Ville ». Vérifiez le « Plan comptable » proposé. Ouvrez l'onglet « Détails » et saisissez l'« Effectif » de l'année.

**Ce que vous lisez.** Le « Nom », le « Pays » et la « Devise de base », déjà remplis. Le plan comptable proposé par KANAP ; un autre plan, par exemple celui de votre pays, se crée depuis un modèle dans « Données de référence » › « Plans comptables ». L'effectif, avec les « Utilisateurs IT » et le « Chiffre d'affaires », sert à répartir les coûts et nourrit les rapports. Une autre filiale se crée avec « Nouveau ».

<!-- capture : Données de référence › Sociétés, fiche d'une société, onglet « Détails » de l'année en cours ; cadrer les champs Effectif, Utilisateurs IT et Chiffre d'affaires -->

## 2. Vos lignes

:material-clock-outline: 3 minutes

Une ligne budgétaire est un poste OPEX ou CAPEX : un nom, une société qui paie, un compte, une devise, une date de début, puis des montants par année.

**Le geste.** Le plus court : ouvrez « Plaid », glissez votre fichier budget, Excel ou CSV, sur la zone de saisie et écrivez « Charge ce budget ». Plaid montre comment il a lu chaque colonne ; corrigez ce qui doit l'être, puis approuvez. Sans fichier : « Gestion budgétaire » › « Lignes budgétaires » › « Nouvelle ligne ». Saisissez le nom du produit, la « Société payeuse », le « Compte », la « Devise » et le « Début d'effet », puis « Créer ». Dans l'onglet « Budget », cliquez sur la carte « Budget », saisissez le « Montant annuel » et, sous « Quand », choisissez « Toute l'année » ou « Une période ».

**Ce que vous lisez.** Avec Plaid : ce qu'il a placé, ce qu'il a supposé, ce qu'il n'a pas su placer, puis la vérification de KANAP, « Erreurs », « Modifications » et « Avertissements » ; rien n'est chargé tant qu'une erreur reste. À la main : la phrase qui résume la répartition, par exemple « 120 000 répartis linéairement d'avril à décembre (9 mois) ». Un mois compte si la période couvre son 15.

<!-- capture : Gestion budgétaire › Lignes budgétaires, une ligne OPEX, onglet « Budget », éditeur de la colonne Budget en mode « Montant » ; cadrer le montant, la période et la phrase de résultat -->

## 3. Un contrat lié

:material-clock-outline: 2 minutes

Un contrat porte ce que le budget ne dit pas : sa durée, sa reconduction et le préavis qui fixe la date limite pour le résilier.

**Le geste.** Ouvrez « Gestion budgétaire » › « Contrats » › « Nouveau ». Saisissez le « Nom du contrat », le « Fournisseur », la « Société contractante », le « Début », la « Durée (mois) », la « Devise » et le « Préavis (mois) », choisissez-vous comme « Responsable », puis « Créer ». Dans l'onglet « Budget » du contrat, liez la ligne qu'il finance avec « Lier ou retirer des lignes budgétaires ».

**Ce que vous lisez.** Dans la liste des contrats : la « Prochaine échéance », la date « Résiliation avant » et l'« État » (« À décider », « En cours », « Reconduit au… »). Quand la date limite de résiliation entre dans le délai de décision, 90 jours par défaut, KANAP crée une tâche « Décider du renouvellement » pour le responsable et la lui envoie par e-mail.

<!-- capture : Gestion budgétaire › Contrats, liste avec les colonnes Prochaine échéance, Résiliation avant et État ; cadrer un contrat « À décider » -->

## 4. Votre premier rapport

:material-clock-outline: 1 minute

Dès que vos lignes portent des montants, les tuiles et les rapports se calculent sur vos chiffres.

**Le geste.** Ouvrez l'accueil, en cliquant sur le logo KANAP, puis « Gestion budgétaire » › « Rapports » › « Top lignes ».

**Ce que vous lisez.** Sur l'accueil, la tuile « Budget » : votre OPEX, votre CAPEX et leur total, dans chaque colonne affichée. « Top lignes » classe vos dix plus gros postes de l'année, avec leur part du total ; chaque nom ouvre sa ligne.

<!-- capture : Gestion budgétaire › Rapports › « Top lignes » sur un budget saisi ; cadrer le tableau et le graphique -->

## 5. Un collègue

:material-clock-outline: 2 minutes

Le budget se travaille à plusieurs : le contrôle de gestion lit les mêmes chiffres que vous, sans pouvoir les modifier.

**Le geste.** Ouvrez « Administration » › « Utilisateurs » › « Nouveau ». Saisissez l'« E-mail » de votre collègue, choisissez le rôle « Lecteur budget » dans « Rôles », puis « Enregistrer et inviter ».

**Ce que vous lisez.** Votre collègue apparaît avec le statut « Invité » et reçoit l'e-mail « Vous êtes invité sur KANAP », avec un lien pour choisir son mot de passe. Une fois entré, il lit les lignes, les contrats et les rapports, sans rien modifier, ni importer, ni exporter.

<!-- capture : Administration › Utilisateurs, fenêtre « Nouvel utilisateur » avec le rôle « Lecteur budget » ; cadrer l'e-mail, les rôles et le bouton « Enregistrer et inviter » -->

## Et ensuite

Votre budget IT est dans KANAP. Les deux autres parcours prennent aussi dix minutes, sur vos données :

- [Votre système d'information dans KANAP en dix minutes](landscape-own-data.md)
- [Votre portefeuille dans KANAP en dix minutes](portfolio-own-data.md)

Pour aller plus loin sur ce parcours : [Sociétés](../companies.md), [Lignes budgétaires](../budget-lines.md), [Contrats](../contracts.md), [Charger un budget depuis un tableur](../budget-file.md).
