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

La dimension analytique apporte cette seconde lecture. Une étiquette légère, optionnelle, posée sur un poste pour dire sa nature : Infrastructure, Migration Cloud, Licences, Sécurité. Évidemment paramétrable.

## La mécanique dans KANAP

### Créer les dimensions

Direction **Données de référence > Dimensions analytiques**. Chaque dimension porte un nom unique et une description. La description sert surtout aux collègues : « Hébergement, cloud et virtualisation » se comprend mieux que « Infra ».

![La liste des dimensions analytiques : nom, description, statut et date de mise à jour](/screenshots/blog/analytics-dimensions.png)

Une dizaine de catégories larges suffisent généralement. Au-delà de vingt, on décrit son organisation au lieu de l'analyser. Gardez un nommage cohérent.

### Étiqueter un poste

Dans le panneau des propriétés d'un poste OPEX ou CAPEX, le champ **Catégorie analytique** attend une dimension. Choisissez-en une, ou laissez vide pour « Non affecté ». L'étiquette vaut ensuite pour le poste entier, tous exercices confondus.

![Le champ Catégorie analytique d'un poste OPEX, ici AWS Cloud Hosting étiqueté Infrastructure](/screenshots/blog/analytics-opex-item.png)

Un poste porte zéro ou une dimension. L'analyse multidimensionnelle n'existe pas par ce biais : pour croiser deux angles, passez par les départements et leurs clés de ventilation.

Deux points à garder en tête :

- **Aucun impact sur les ventilations** ni sur la comptabilité formelle. La société payeuse, le compte et les clés de répartition ne bougent pas. Les dimensions analytiques servent uniquement au reporting.
- **Départements et dimensions ne jouent pas dans la même cour.** Les départements sont des unités organisationnelles formelles, avec des clés de ventilation précises. Les dimensions analytiques sont des étiquettes informelles et optionnelles, sans surcharge de ventilation.

Pour retirer une dimension, désactivez-la. La date de désactivation est enregistrée, la dimension disparaît des listes de sélection, les postes déjà étiquetés gardent leur étiquette, et les rapports historiques restent exacts. Il n'y a pas de bouton supprimer, et c'est volontaire.

Vous pouvez utiliser l'information collectée dans la liste des OPEX, en ajoutant la colonne optionnelle « Analytique ». Cela permet de balayer en un clin d'œil tous les postes d'une catégorie : « Quelles sont les applications utilisées par la finance ? ».

## Le rapport Budget par dimension analytique

Le rapport se trouve sous **Rapports > Dimensions analytiques**.

- **Année unique** : camembert ou barres horizontales, au choix.
- **Plage pluriannuelle** : une courbe, avec une ligne par dimension.
- **Métrique** : budget, réalisé, atterrissage prévu ou révision.
- **Exclusion de dimensions** : pour se concentrer sur un sous-ensemble.
- **Sorties** : tableau récapitulatif, export CSV du tableau, PNG du graphique, PDF complet.

![Le rapport en 2026 : 3,2 M€ de budget OPEX répartis sur quinze dimensions analytiques](/screenshots/blog/analytics-report.png)

Sur l'exercice 2026, la productivité capte 25 % du budget OPEX. L'infrastructure suit à 13 %, comme les services professionnels.

En vue pluriannuelle, le rapport devient un outil de trajectoire. Une ligne s'envole, une autre s'éteint, et la décision se discute sur des faits.

![Le même rapport sur 2025 à 2027 : une courbe par dimension analytique](/screenshots/blog/analytics-report-range.png)

« Non affecté » est un état valide. Les dimensions sont optionnelles, et un poste sans étiquette apparaît simplement sur cette ligne.

<aside class="tip">
  <b>Astuce</b>
  <p>Le rapport s'exporte en PDF et se présente tel quel en revue budgétaire. Combiné aux rapports de refacturation, vous avez toutes les facettes de votre budget sous la main !</p>
</aside>

## Les coûts cachés

Le camembert fait remonter ce que le « top 10 » des postes masque. La dimension devenue trop grosse pour être honnête. Deux dimensions qui décrivent presque la même chose et gagneraient à fusionner. La courbe qui part de zéro en 2025 sur l'IoT, trace d'un poste apparu en cours de route. Ou la dimension RH qui passe de 80 000 € à 150 000 € en un an, quand le budget global ne progresse que de 13 %.

C'est aussi là que les deux lectures se croisent. La sécurité pèse 7 % du budget. Le rapport de refacturation dit quelle filiale la porte. Le DSI tient alors une phrase courte et vérifiable en revue budgétaire : voilà ce que nous dépensons, pour quoi, et qui paie.

## Et le CAPEX ?

Le champ **Catégorie analytique** existe aussi sur les postes CAPEX, avec la même règle : zéro ou une dimension. Un projet d'investissement se lit donc avec le vocabulaire des dépenses récurrentes, et la comparaison entre les deux enveloppes reste possible.

C'est tout l'intérêt d'une nomenclature commune : la question « combien coûte la sécurité ? » se pose de la même façon sur une licence récurrente et sur un projet d'équipement.

## Par où commencer

1. Créez cinq à dix dimensions larges, avec une description d'une phrase chacune.
2. Étiquetez d'abord les dix postes les plus lourds. Le rapport devient utile dès cette étape.
3. Laissez le reste en « Non affecté », puis étiquetez au fil de l'eau.
4. Croisez le rapport avec les rapports de refacturation : qui paie d'un côté, pour quoi de l'autre.
5. Relancez le rapport à chaque revue budgétaire. Scindez une dimension trop large, fusionnez deux dimensions trop fines.

Cette dimension analytique complète parfaitement la répartition des coûts IT (voir [La refacturation des coûts IT, c'est facile](/fr/blog/la-refacturation-des-couts-it-cest-facile)) et vous donnera toute la visibilité nécessaire pour préparer, analyser et défendre votre budget.