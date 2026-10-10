---
title: "Refacturation informatique : qui paie quoi ?"
description: "Répartir les coûts IT entre sociétés et départements avec des règles claires et vérifiables, et en tirer des rapports de refacturation."
date: 2026-09-12
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
updated: 2026-10-10
translationKey: it-cost-chargeback-made-simple
---

« Combien nous coûte l'IT ? » La question est facile. « Combien coûte l'IT du département X ? » l'est beaucoup moins. Et quand la direction demande qui doit porter la facture, le tableur du DSI montre vite ses limites.

La refacturation IT répond à cette question. Chaque coût informatique est réparti entre les entités qui en bénéficient, selon une règle explicite et vérifiable. Ces entités peuvent être des sociétés, des départements, le chiffre d'affaires, l'effectif, ou encore une entrée manuelle. Et des combinaisons de ces critères !

Les coûts peuvent même ensuite être ramenés à l'utilisateur pour des comparaisons instructives entre pays, départements et sociétés.

## Pourquoi refacturer, même sans facture interne

Refacturer ne veut pas forcément dire émettre une facture. L'objectif premier est de rendre le coût visible. Un DSI qui peut montrer que les coûts IT d'une filiale sont deux ou trois fois supérieurs à ceux d'une autre sera mieux armé au moment de justifier un changement de stratégie.

Trois usages reviennent :

- **Responsabiliser** : chaque entité voit ce que ses choix coûtent.
- **Justifier** : un budget défendu par des chiffres par entité offre beaucoup plus de visibilité qu'un montant global.
- **Arbitrer** : comparer le coût IT par utilisateur entre sociétés fait ressortir les écarts.

## Définition des règles de ventilation

### La règle par défaut

Par défaut, KANAP utilise l'effectif des sociétés définies dans les données de référence : tous les coûts seront répartis entre toutes les sociétés en fonction de l'effectif.

Vous pouvez modifier cette règle par défaut dans Administration, Méthode de ventilation par défaut. La règle définie s'appliquera année par année sur les entrées qui n'auront pas encore été personnalisées (vous ne perdez pas le travail déjà effectué).

![La méthode de ventilation par défaut : exercice, sociétés ciblées, critère et répartition calculée](/screenshots/blog/chargeback-default-method-2026-10.png)

### Gestion au niveau du poste

Chaque poste de dépense porte sa propre règle de ventilation, pour chaque année. Lorsque le réglage par défaut doit être affiné, il peut être ajusté pour chaque entrée d'OPEX et de CAPEX. C'est cela qui permet de reporter correctement le coût des applications spécifiques (ex. : un logiciel de comptabilité imputé au département finance).

L'onglet **Ventilations** d'un poste affiche le résultat en temps réel. Ici, la maintenance SAP de 280 000 EUR se répartit à l'effectif : 58,54 % pour Fromage & Co SA, 19,51 % pour Kaasmeester BV, et ainsi de suite jusqu'à 100 %.

![L'onglet Ventilations : méthode, critère, pourcentage et montant par société](/screenshots/blog/chargeback-allocations-2026-10.png)

Toutes les clés de répartition sont possibles :

- **Effectif** (par défaut) : la clé la plus courante, alimentée par les effectifs annuels des sociétés.
- **Utilisateurs IT** : pour les coûts qui suivent le nombre de postes équipés par société (utile pour les groupes où de nombreux collaborateurs ne sont pas, ou peu, utilisateurs du SI).
- **Chiffre d'affaires** : quand la contribution suit la taille économique de l'entité.
- **Manuel par société** : pour allouer des coûts à une ou plusieurs sociétés en particulier (et toujours : par effectif, par nombre d'utilisateurs IT, par CA).
- **Manuel par département** : pour allouer des coûts à un ou plusieurs départements en particulier, par effectif uniquement.
- **Pourcentages manuels** : pour une liberté d'allocation totale ; vous saisissez les pourcentages, qui doivent totaliser 100 %, ou vous les répartissez équitablement d'un clic.

Pour éviter de tout reparamétrer chaque année, l'outil « Copier les ventilations » reporte ces règles d'un exercice à l'autre, pour l'OPEX comme pour le CAPEX, simulation comprise. La ventilation suit donc le budget sans ressaisie.

### Ne pas confondre avec les centres de coûts

Les centres de coûts disent qui porte une ligne et en répond : chaque centre a son responsable budgétaire, et leurs groupes permettent de lire le budget d'une direction entière. Ils n'ont aucun effet sur la refacturation. Une licence portée par le centre de coûts « Infrastructure » peut très bien être refacturée à toutes les sociétés à l'effectif.

## Les rapports de refacturation

Une fois les règles en place, deux rapports permettent d'explorer toutes les facettes de la refacturation.

### Refacturation globale

Le premier répond à « comment se répartit la dépense IT entre nos sociétés ? ». Il affiche le total consolidé, la part de chaque société, les montants payés et consommés, puis les flux intersociétés.

![La refacturation globale : total, parts par société et flux intersociétés](/screenshots/blog/chargeback-global-2026-10.png)

Les KPI y ajoutent deux métriques clés de tout budget IT :

- Les coûts IT vs. le CA, global pour le groupe et par société. Vous pourrez dire de façon étayée : notre IT coûte 2,45 % du CA par an.
- Les coûts IT par personne et par utilisateur IT en valeur absolue.

### Refacturation par société

Ce rapport permet de descendre d'un niveau et d'analyser le détail au niveau d'une société. On y retrouve les coûts IT par département, les postes de refacturation (pour répondre à une filiale : voilà précisément les services pour lesquels on vous facture), le détail des flux entrants et sortants, et un rappel des KPI. C'est le rapport à transmettre aux filiales avec leur facture annuelle.

![La refacturation par société : totaux par département, postes détaillés et KPI](/screenshots/blog/chargeback-company-2026-10.png)

Les deux rapports sont entièrement paramétrables (année, société, rubriques) et s'exportent en CSV, en PNG ou en PDF. Ils peuvent aussi être présentés directement en revue budgétaire.

<aside class="tip">
  <b>Astuce</b>
  <p>Les rapports s'expriment dans la devise de reporting définie dans les paramètres de devise. Chaque filiale gère son budget dans sa devise, mais la consolidation standardise sur une seule devise, ce qui facilite la lecture.</p>
</aside>

## Les coûts cachés

Ces rapports font souvent émerger des lignes ou des situations que les gros « top 10 » budgétaires masquent. L'outil à 15 k€ utilisé par trois personnes qui fait exploser le coût par utilisateur d'un département. L'application refacturée à une filiale qui paie déjà pour un logiciel équivalent. Les écarts de coût par utilisateur entre sociétés ou départements.

C'est souvent là que se trouvent des pistes sérieuses d'économie, et c'est comme ça que le DSI peut marquer des points auprès des directions générales et financières.

## Et le CAPEX ?

Les investissements utilisent le même onglet Ventilations et la même mécanique. Un projet financé pour une seule filiale se répartit vers cette filiale, le reste suit la méthode choisie. Les deux rapports de refacturation, eux, portent sur l'OPEX : c'est la dépense récurrente qu'on refacture d'une année sur l'autre.

## Par où commencer

- Vérifiez les métriques des sociétés pour l'année en cours : effectif, utilisateurs IT, chiffre d'affaires. C'est la donnée de référence de la refacturation !
- Définissez la méthode par défaut qui convient à votre environnement, puis ne traitez que les cas particuliers.
- Choisissez le niveau de granularité voulu dans la revue des cas particuliers, puis restez cohérent tout au long du traitement.
