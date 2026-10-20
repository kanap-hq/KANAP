---
title: "Gérer les devises dans le budget IT"
description: "Chacun saisit dans sa devise, KANAP consolide dans celle du groupe : des taux automatiques, alignables sur vos taux budgétaires, et des totaux toujours justes."
date: 2026-10-20
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: managing-currencies-it-budget
series:
  key: opex-budget
  part: 7
  title: "Construire le budget de la DSI"
---

Une filiale américaine paie ses licences en dollars. Le siège signe un abonnement SaaS facturé en dollars, un support éditeur en francs suisses. Et le budget IT du groupe, lui, se présente en euros.

Dans un tableur, cela veut dire une feuille de taux dans un coin du classeur, des formules de conversion recopiées ligne après ligne, et une question qui revient à chaque présentation : quel taux a-t-on utilisé ?

Dans KANAP, chacun saisit le budget dans la devise de sa facture. Tout se consolide, automatiquement et proprement, dans la devise de référence du groupe. Les taux se gèrent tout seuls et s'alignent sur ceux du contrôle de gestion quand vous le souhaitez.

## Tous les réglages sur une page

Tout se passe dans **Gestion budgétaire › Administration › Devises**.

- **La devise de reporting** : celle de la consolidation du groupe. Listes, totaux et rapports s'affichent dans cette devise.
- **Les devises par défaut**, une pour l'OPEX et une pour le CAPEX : elles sont proposées à la création d'une ligne, sans limiter le choix.
- **Les devises autorisées**, si vous voulez restreindre la liste. Laissez-la vide sauf raison précise : tout code ISO valide est alors accepté.

La devise de reporting se choisit une fois. Elle peut changer plus tard : une fenêtre dit alors ce que le changement entraîne avant de l'appliquer, et les montants saisis ne bougent pas.

![La page Devises de Fromage & Co : devise de reporting, devises par défaut et devises autorisées, puis le tableau des taux par année avec leur source](/screenshots/blog/currency-settings-2026-10-20.png)

## Chacun saisit dans sa devise

Celui qui prépare une ligne budgétaire la saisit dans la devise de la facture qu'il recevra. Pas de conversion à faire, pas de taux à chercher : il choisit la devise dans le formulaire, et c'est tout.

Cela vaut pour toute la gestion budgétaire :

- **Les lignes de budget** : chacune a sa devise. Chez Fromage & Co, notre société d'exemple, la filiale américaine budgète en dollars son infogérance, sa plateforme e-commerce et ses prestataires, à côté des lignes en euros du siège.
- **Les contrats** : un contrat signé en devise étrangère garde sa devise. Un abonnement SaaS facturé en dollars à la société française, un support facturé en francs suisses : le montant du contrat reste celui de la signature, et son engagement se compare au budget en devise de reporting.
- **Les sociétés** : chacune a sa devise de base, et son chiffre d'affaires se saisit en millions de cette devise, par exemple 35 M USD pour Fromage & Co Inc.

Les montants sont enregistrés tels qu'ils ont été saisis. Les exports CSV gardent la devise de chaque ligne : le fichier se réimporte ou s'analyse sans conversion à défaire.

![Les lignes télécoms du siège et de la filiale américaine de Fromage & Co : des lignes saisies en euros et en dollars, montants et total affichés en euros](/screenshots/blog/currency-us-lines-2026-10-20.png)

## Tout se consolide dans la devise du groupe

KANAP convertit à l'affichage, chaque année au taux de cette année. Personne n'a de formule à écrire ni de colonne « contre-valeur » à tenir.

- **La liste des lignes budgétaires** : la colonne Devise garde la devise de chaque ligne, les montants et la ligne de totaux s'affichent en devise de reporting, et les totaux se recalculent sur chaque filtre.
- **La vue d'ensemble et les dix rapports budgétaires** s'affichent dans la devise de reporting.
- **Les contrats** : engagement, budget lié et écart sont comparés dans la même devise.
- **La refacturation** : le chiffre d'affaires de chaque société est converti avant de servir de clé. Une répartition entre la France et les États-Unis compare enfin des euros avec des euros. Voir [l'article sur la refacturation](/fr/blog/la-refacturation-des-couts-it-cest-facile).

Et si le groupe change un jour de devise de consolidation, il suffit de changer la devise de reporting : tout est reconverti, sans toucher à une seule ligne.

## Des taux rafraîchis automatiquement

Par défaut, vous n'avez rien à faire. KANAP récupère un taux par devise et par année pour toutes les devises utilisées, et les met à jour tous les 30 jours.

- **Années passées** : les moyennes annuelles de la Banque mondiale. En attendant leur publication, l'année publiée la plus proche, marquée comme estimation.
- **Année en cours** : le taux du jour.
- **Années futures** : le taux de l'année en cours, repris comme estimation pour préparer le budget.

Le tableau des taux, sous les réglages, montre chaque taux et sa source. Avant un comité, le bouton **Forcer la synchronisation des taux de change** les met à jour tout de suite et dit ce qu'il a récupéré.

## Vos taux budgétaires, si vous en avez

Beaucoup de groupes fixent leurs propres taux pour l'exercice : les taux budgétaires du contrôle de gestion ou de la trésorerie. Le budget IT doit alors parler le même langage que le reste du groupe.

**Saisir un taux à la main.** Dans le tableau des taux, un clic sur une cellule ouvre la fenêtre **Taux de change manuel** : vous saisissez le taux de votre contrôle de gestion pour cette devise et cette année. Il remplace le taux automatique jusqu'à ce que vous le retiriez, il est marqué d'un astérisque dans le tableau, et chaque saisie est tracée dans le journal d'audit.

**Figer les taux avec le budget.** Une fois le budget approuvé, geler sa colonne par défaut fige aussi les taux de l'année. Les montants restent convertis au jeu de taux du gel, même quand des taux plus récents arrivent. Un budget validé avec un dollar à 0,92 € ne change pas en juin parce que le dollar a bougé. Voir [l'article sur le reporting](/fr/blog/opex-budget-reporting).

![La fenêtre Taux de change manuel : le taux en euros pour un dollar, avec le taux automatique de l'année voisine comme repère](/screenshots/blog/currency-manual-rate-2026-10-20.png)

## Les erreurs ou manques sont signalés

Il arrive qu'un taux manque : une devise peu courante, ou une année passée que les sources n'ont pas encore publiée. Un tableur compte alors souvent le montant pour 1, et 100 000 dollars deviennent 100 000 euros sans que personne ne le voie.

KANAP ne fait jamais cela. Le montant est exclu des totaux de l'année, et l'écran le dit : « 3 lignes sans taux de change exclues : USD 2026 », sous les totaux de la liste, sur la vue d'ensemble, en haut des rapports, dans les contrats. Sur la ligne, le montant s'affiche alors dans sa propre devise, avec une marque orange.

KANAP va chercher le taux en arrière-plan, et l'affichage suivant l'utilise dès qu'une source le publie. Si aucune ne le publie ou que votre installation n'a pas accès à Internet, la page Devises liste les taux manquants, et un taux manuel règle la question tout de suite.

![La liste des lignes budgétaires avec une ligne sans taux de change : l'avertissement sous les totaux et la marque orange sur la ligne](/screenshots/blog/currency-missing-rate-2026-10-20.png)

## Par où commencer

1. **Choisissez la devise de reporting** : celle de la consolidation du groupe.
2. **Donnez sa devise à chaque société**, puis saisissez lignes et contrats dans la devise de leur facture.
3. **Si votre contrôle de gestion a des taux budgétaires**, saisissez-les pour l'année que vous préparez.
4. **Gelez la colonne budget** une fois le budget approuvé : ses taux sont figés avec elle.

Pour voir tout cela sur un budget déjà saisi, un essai gratuit de 14 jours de notre version hébergée donne accès aux données d'exemple du groupe fictif Fromage & Co, chargées en une minute. KANAP est entièrement open source : il s'installe aussi gratuitement sur vos propres serveurs.
