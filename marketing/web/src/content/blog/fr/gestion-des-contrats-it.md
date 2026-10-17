---
title: "Gestion des contrats IT dans KANAP"
description: "Échéances calculées, décisions de renouvellement tracées, engagement comparé au budget : les contrats de la DSI sous contrôle dans KANAP."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: it-contract-management
series:
  key: opex-budget
  part: 6
  title: "Construire le budget de la DSI"
---

Qui n'a pas laissé glisser un contrat au-delà de sa date de résiliation ? La négociation qui s'ensuit est rarement agréable. Et en effet, il n'est pas simple de suivre des dizaines d'échéances contractuelles, de contrats en tacite reconduction ou simplement de souscriptions. Ces dates vivent souvent dans des PDF signés, dans un tableur ou du côté des achats.

Dans KANAP, chaque date se calcule à partir du contrat. Chaque échéance arrive au bon responsable, avec le temps de décider. Et chaque contrat se compare aisément au budget, ce qui permet de détecter facilement les anomalies.

## La saisie : quelques champs uniquement

Un contrat se crée en un seul formulaire. Cinq champs sont obligatoires : le fournisseur, la société qui a signé, la date de début, la durée d'un terme et la devise. On ajoute ensuite le responsable, la reconduction tacite, le préavis, le montant annuel et la fréquence de facturation.

KANAP calcule le reste : les termes successifs, la date limite de résiliation de chacun et l'état du contrat. On change la durée ou le préavis, et toutes les dates suivent.

Chez Fromage & Co, notre société d'exemple, la maintenance SAP coûte 350 000 € par an. Elle court du 1er juillet au 30 juin, avec six mois de préavis et reconduction tacite. KANAP en déduit qu'on peut la résilier jusqu'au 30 décembre 2026. Passé ce jour, elle repart jusqu'en juin 2028.

La vue d'ensemble de la fiche le dit en une phrase : « Résiliation possible jusqu'au 30 déc. 2026 · dans 74 jours ». Une frise montre les termes passés, le terme en cours et la prochaine date limite. Le terme suivant reste en pointillé tant qu'on peut encore l'éviter. Une ligne de faits rappelle depuis quand le contrat est reconduit.

![La fiche du contrat de maintenance SAP de Fromage & Co : la prochaine date limite de résiliation, la frise des termes et l'encart de décision](/screenshots/blog/contracts-sap-overview-2026-10-17.png)

Un registre tenu dans un tableur se charge ou s'exporte par fichier CSV. Le contrôle préalable vérifie le fichier avant tout enregistrement.

## La liste : ce qui arrive, dans l'ordre

La liste des contrats se trie par **Prochaine échéance**, la plus proche en premier. Pour un contrat à reconduction tacite, c'est sa prochaine date limite de résiliation ; pour les autres, sa fin. Chaque date est suivie de « dans n jours ».

La colonne **État** dit où en est chaque contrat :

- **À décider** : une décision est attendue avant la date limite ;
- **Fin sans reconduction** : le contrat est dans son dernier terme ;
- **Reconduit au** une date : le préavis est passé, le terme suivant est acquis ;
- **En cours** : rien n'est attendu pour l'instant ;
- **Échu** : le contrat a pris fin.

Le filtre rapide **À décider sous 90 jours** isole les contrats qui demandent une décision. Chez Fromage & Co, ils sont quatre aujourd'hui : les services IT managés aux États-Unis (date limite le 31 octobre), Salesforce (28 novembre), SAP (30 décembre) et Okta (31 décembre). Le délai de 90 jours se règle de 0 à 365 jours.

« Reconduit au » montre ce qui est déjà joué. L'accord Microsoft, la licence VMware et le réseau Orange ont passé leur préavis : ils repartent au 1er janvier pour un nouveau terme. Mieux vaut le savoir en préparant le budget.

![La liste des contrats de Fromage & Co, filtrée sur les contrats à décider sous 90 jours](/screenshots/blog/contracts-to-decide-2026-10-17.png)

## La décision : renouveler, renégocier, résilier

Au-delà de la liste, KANAP demande au responsable de trancher et garde la trace de sa décision.

Ainsi, 90 jours avant la date limite de résiliation (un délai réglable), KANAP crée une tâche pour chaque contrat qui attend une décision. Elle est assignée au responsable du contrat, avec une échéance à la date limite de résiliation. Il est donc important d'avoir un responsable sur chaque contrat.

Sur la fiche, un encart dit ce qui se passe si personne ne bouge : « Sans décision, le contrat sera reconduit pour 12 mois le 1er juil. 2027. » Le responsable choisit alors :

- **Renouveler** : le renouvellement est confirmé pour ce terme, la tâche se ferme.
- **Renégocier** : la tâche reste ouverte jusqu'à la décision finale, et l'encart affiche « Renégociation en cours ».
- **Résilier** : KANAP propose la première fin permise par le préavis. Pour la maintenance SAP, c'est le 30 juin 2027. Une date plus proche reste possible, avec un avertissement : le fournisseur doit l'accepter.

Avant de confirmer une résiliation, l'encart liste ses conséquences : l'engagement de l'année et de la suivante, les applications qui perdent ce contrat, les actifs qui perdent leur contrat de support. Sur l'exemple SAP, l'engagement 2027 passe de 350 000 € à 175 000 €, et celui de 2028 tombe à zéro.

![L'encart Résilier du contrat SAP : la première fin permise par le préavis et les conséquences de la résiliation](/screenshots/blog/contracts-cancel-2026-10-17.png)

Chaque décision est tracée : qui, quand, avec quelle justification. « Renouvellement confirmé le 2 oct. 2026 par Sophie Laurent », par exemple. Une décision prise trop vite s'annule tant que la date limite n'est pas passée. Après une résiliation, KANAP rappelle d'envoyer la lettre avant la date limite et de la joindre au contrat.

## Le contrat face au budget

Le contrat dit ce que la DSI s'est engagée à payer. Le budget dit ce qu'elle a prévu. KANAP compare les deux, année par année.

**Engagé** est le montant annuel du contrat réparti sur les mois couverts par un terme, au prorata des jours. Les années suivantes supposent que la reconduction continue tant qu'on ne l'arrête pas. Rien n'est engagé après la fin du contrat.

**Budget** additionne les lignes budgétaires liées au contrat, pour l'année et la colonne choisies : le budget, l'atterrissage prévu, ou le budget de l'an prochain en pleine préparation. **Écart** est la différence, en orange quand il manque du budget.

Chaque contrat reçoit un état de couverture : couvert, sous-budgété, budget supérieur au contrat, aucune ligne budgétée, aucun engagement, ou budget pas encore commencé. Deux filtres rapides isolent ce qui demande une action : **Sans ligne budgétaire** et **Sous-budgétés**.

Sur le budget 2026 de Fromage & Co, les contrats engagent 3,73 M€. Trois d'entre eux ne sont reliés à aucune ligne : l'équipe nearshore de Lisbonne, l'équipe e-commerce de Fromatech et le réseau Orange, soit 1,58 M€ d'engagements à rattacher au budget. À l'atterrissage, quatre contrats sont sous-budgétés, dont la maintenance SAP. À l'inverse, le contrat OVHcloud a pris fin en mai et sa ligne porte encore du budget.

![La liste des contrats de Fromage & Co avec les colonnes Engagé, Budget et Écart du budget 2026](/screenshots/blog/contracts-budget-coverage-2026-10-17.png)

Le lien vaut dans les deux sens. L'onglet Budget du contrat montre ses lignes et leur couverture sur trois ans. Une ligne budgétaire mène à son contrat. Une façon simple de limiter les oublis !

## Les clauses que le contrat doit contenir

Un contrat couvre des applications, et ces applications pointent vers des clauses qu'il doit contenir. Des données personnelles demandent un accord de sous-traitance RGPD et la localisation des données. Une application critique demande une clause de réversibilité, un plan de sortie et un droit d'audit. L'onglet Conformité du contrat liste ces points en fonction de ce qui a été catégorisé dans l'application. On note chacune présente, absente ou sans objet, et le registre de conformité s'exporte en CSV. Nous y reviendrons de façon plus détaillée dans un prochain article.

## Ce que KANAP ne fait pas

KANAP ne rédige ni ne signe les contrats, et ne mène pas la négociation : c'est le rôle des achats et du juridique. Le montant à la signature vaut pour chaque terme : une indexation ou une hausse de prix se budgète sur les lignes liées. KANAP tient le registre, les échéances, les décisions et le lien avec le budget.

## Par où commencer

1. **Chargez le registre existant** par fichier CSV, après le contrôle préalable, ou créez vos contrats à la main.
2. **Nommez un responsable sur chaque contrat** : c'est lui qui recevra les tâches de décision.
3. **Liez les lignes budgétaires**, en commençant par les plus gros contrats. Regardez ensuite Sans ligne budgétaire et Sous-budgétés sur l'année que vous préparez.
4. **Commencez la semaine par À décider** : aucune échéance ne passe sans décision.

Pour voir tout cela sur des contrats déjà saisis, un essai gratuit de 14 jours de notre version hébergée donne accès aux données d'exemple du groupe fictif Fromage & Co, chargées en une minute. KANAP est entièrement open source : il s'installe aussi gratuitement sur vos propres serveurs.
