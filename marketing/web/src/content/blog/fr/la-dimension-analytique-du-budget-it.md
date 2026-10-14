---
title: "Axe analytique du budget IT : ce que coûte la cyber"
description: "La refacturation dit qui paie ; la dimension analytique dit à quoi sert la dépense : sécurité, cloud, licences. Mode d'emploi de cet axe du budget DSI."
date: 2026-09-13
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: analytics-dimensions-for-your-it-budget
---

À la question : « Qui paie cette licence ? », les outils de refacturation répondent sans hésiter. Mais à la question : « Combien nous coûte la cyber, tous fournisseurs confondus ? », nous restons souvent sans réponse.

La dimension analytique apporte cette seconde lecture. Chaque dimension est une façon de classer les lignes, avec ses propres valeurs : ce que paie l'argent, la partie de l'IT servie, la raison de la dépense. Un nouvel espace en compte quatre dès le départ, toutes facultatives.

## La mécanique dans KANAP

### Les dimensions et leurs valeurs

Direction **Données de référence > Dimensions analytiques**. Un bandeau en haut liste les dimensions ; un clic sur l'une affiche ses valeurs. Un nouvel espace arrive avec quatre dimensions recommandées, chacune avec ses valeurs et une description d'une phrase :

- **Nature de coût**, la dimension par défaut : ce que paie l'argent (Matériel, Logiciel, Main-d'œuvre externe, Services externes...).
- **Domaine IT** : la partie de l'IT que sert la dépense (Calcul, Réseau, Poste de travail, Application, Sécurité et conformité...).
- **Motif** : pourquoi l'argent est dépensé (Remplacement, Capacité, Productivité, Sécurité, Conformité, Croissance).
- **Priorité** : Obligatoire, Haute, Moyenne ou Basse.

![La page Dimensions analytiques : le bandeau des dimensions avec Cost pool sélectionnée, et ses huit valeurs avec leur description](/screenshots/blog/analytics-dimensions-2026-10-13.png)

Natures de coût et domaines IT suivent le modèle TBM (Technology Business Management). Renommez, réordonnez ou désactivez ce qui ne vous convient pas. Un espace créé avant les ajoute avec **Dimensions recommandées**. **Nouveau** crée une dimension à vous, et **Nouvelle valeur** ajoute une valeur à la dimension sélectionnée.

Cinq à dix valeurs larges par dimension suffisent généralement. Au-delà de vingt, la dimension veut répondre à trop de questions : scindez-la en deux. La description sert surtout aux collègues : « Prestataires et consultants facturés au temps passé » se comprend mieux que « Ext. ».

### Classer une ligne

Dans le panneau **Propriétés** d'une ligne, chaque dimension a son champ, par exemple **Nature de coût** ou **Domaine IT**. Choisissez une valeur, ou laissez vide pour « Non affecté ». La valeur vaut pour la ligne entière, tous exercices confondus.

![Le panneau Propriétés d'une ligne budgétaire : Hardware en Cost pool, Compute en IT tower, Replacement en Purpose et Mandatory en Priority](/screenshots/blog/analytics-line-properties-2026-10-13.png)

Une ligne porte une valeur par dimension : **Logiciel** en Nature de coût et **Application** en Domaine IT en même temps. Chaque dimension répond à une question, et le rapport les croise.

Deux points à garder en tête :

- **Aucun impact sur les ventilations** ni sur la comptabilité formelle. La société payeuse, le compte et les clés de répartition ne bougent pas. Les dimensions analytiques servent uniquement au reporting.
- **Départements et dimensions ne jouent pas dans la même cour.** Les départements sont des unités organisationnelles formelles, avec des clés de ventilation précises. Les dimensions analytiques sont des classements informels et optionnels, sans surcharge de ventilation.

Pour retirer une valeur ou une dimension, désactivez-la : les lignes gardent leur valeur et les rapports passés restent exacts. La suppression existe, après une confirmation qui compte les lignes concernées.

Dans la liste des lignes budgétaires, chaque dimension a sa colonne optionnelle. Cela permet de balayer en un clin d'œil toutes les lignes d'une valeur : « Quelles lignes relèvent de la main-d'œuvre externe ? ».

## Le rapport Budget par dimension analytique

Le rapport se trouve sous **Rapports > Dimensions analytiques**.

- **Type de lignes** : toutes les lignes, OPEX ou CAPEX.
- **Dimension** : la dimension de regroupement, Nature de coût au départ.
- **Année unique** : camembert ou barres horizontales, au choix.
- **Plage pluriannuelle** : une courbe, avec une ligne par valeur.
- **Métrique** : toute colonne affichée (budget, révision, réalisé, atterrissage prévu).
- **Exclure des valeurs** : pour se concentrer sur un sous-ensemble.
- **Sorties** : tableau récapitulatif, export CSV du tableau, PNG du graphique, PDF complet.

![Le rapport en 2026 : 12,1 M€ de budget OPEX répartis entre les valeurs de Cost pool](/screenshots/blog/analytics-report-2026-10-13.png)

Sur l'exercice 2026, la main-d'œuvre externe capte à elle seule 54 % du budget OPEX. Le logiciel suit à 26 %, puis les services externes à 11 %.

En vue pluriannuelle, le rapport devient un outil de trajectoire. Une ligne s'envole, une autre s'éteint, et la décision se discute sur des faits.

![Le même rapport de 2025 à 2026 : une courbe par valeur de Cost pool](/screenshots/blog/analytics-report-range-2026-10-13.png)

« Non affecté » est un état valide. Les valeurs sont optionnelles, et une ligne sans valeur apparaît simplement sur cette ligne du rapport.

<aside class="tip">
  <b>Astuce</b>
  <p>Le rapport s'exporte en PDF et se présente tel quel en revue budgétaire. Combiné aux rapports de refacturation, vous avez toutes les facettes de votre budget sous la main !</p>
</aside>

## Les coûts cachés

Le camembert fait remonter ce que le « top 10 » des lignes masque. La valeur devenue trop grosse pour être honnête. Deux valeurs qui décrivent presque la même chose et gagneraient à fusionner. Le motif Capacité qui part de zéro en 2025, trace d'une ligne apparue en cours de route. Ou les RH, sur la dimension Domaine métier, qui passent de 468 500 € à 574 570 € en un an (+23 %), quand le budget OPEX ne progresse que de 13 %.

C'est aussi là que les deux lectures se croisent. Sécurité et conformité, en Domaine IT, pèse 8 % du budget OPEX. Le rapport de refacturation dit quelle filiale la porte. Le DSI tient alors une phrase courte et vérifiable en revue budgétaire : voilà ce que nous dépensons, pour quoi, et qui paie.

## Et le CAPEX ?

Les dimensions valent pour les lignes OPEX et CAPEX, sauf si vous en réservez une à une seule nature. Un projet d'investissement se lit donc avec le vocabulaire des dépenses récurrentes, et la comparaison entre les deux enveloppes reste possible.

C'est tout l'intérêt d'une nomenclature commune : la question « combien coûte la sécurité ? » se pose de la même façon sur une licence récurrente et sur un projet d'équipement.

## Par où commencer

1. Passez en revue les quatre dimensions recommandées, renommez ou désactivez les valeurs inutiles.
2. Classez d'abord les dix lignes les plus lourdes. Le rapport devient utile dès cette étape.
3. Laissez le reste en « Non affecté », puis classez au fil de l'eau.
4. Croisez le rapport avec les rapports de refacturation : qui paie d'un côté, pour quoi de l'autre.
5. Relancez le rapport à chaque revue budgétaire. Scindez une valeur trop large, fusionnez deux valeurs trop fines.

Cette dimension analytique complète parfaitement la répartition des coûts IT (voir [Refacturation informatique : qui paie quoi ?](/fr/blog/la-refacturation-des-couts-it-cest-facile)) et vous donnera toute la visibilité nécessaire pour préparer, analyser et défendre votre budget.