---
title: "Classer ses applications : criticité, données, reprise, le socle de NIS2"
description: "Criticité business et cyber, données, plan de reprise : classer chaque application, c'est le travail qui précède toute démarche NIS2. Méthode et outil, sans tableur."
date: 2026-10-10
topic: compliance
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: classifying-applications-nis2
---

La question finit toujours par arriver, en comité de direction ou de la bouche d'un auditeur : quelles sont nos applications critiques, quelles données portent-elles, en combien de temps les redémarre-t-on, et dans quel ordre ?

Dans beaucoup de DSI, la réponse existe, mais en morceaux. L'analyse d'impact métier dort dans un tableur de l'an dernier, le plan de reprise dans un PDF, la liste des applications dans un autre outil, et le reste dans la tête de deux personnes. NIS2 ne crée pas ces questions. Elle les rend obligatoires pour beaucoup d'entreprises qui pouvaient jusqu'ici s'en passer.

## Ce que NIS2 attend du SI

La directive NIS2 (article 21) demande aux entités concernées de prendre des mesures de gestion des risques. Parmi elles : la continuité des activités, avec la gestion des sauvegardes et la reprise après sinistre ; la sécurité de la chaîne d'approvisionnement ; la gestion des incidents. L'ANSSI décline ces objectifs dans un référentiel, le ReCyF, encore publié comme document de travail sur [MesServicesCyber](https://messervices.cyber.gouv.fr/nis2). En France, le projet de loi de transposition est toujours en discussion au Parlement au moment où nous écrivons : son avancement est suivi sur [MonEspaceNIS2](https://aide.monespacenis2.cyber.gouv.fr/fr/article/avancement-de-la-transposition-de-la-directive-nis-2-1b3j1da/).

Quelle que soit la date de la loi, une chose ne changera pas : avant toute analyse de risques, il faut savoir ce que l'on protège. Un inventaire des applications, classé et tenu à jour. C'est la partie la plus longue, et celle que personne n'aime faire.

## Classer une application en quatre blocs

Dans KANAP, l'onglet **Conformité** de chaque application suit l'ordre d'une analyse d'impact métier.

![L'onglet Conformité de SAP S/4HANA : criticité, données, continuité et reprise, avec l'échange vers une application prévue dans une vague ultérieure](/screenshots/blog/compliance-tab-2026-10.png)

**Criticité.** La criticité business se choisit parmi vos niveaux, chacun avec sa définition, en général l'interruption que l'activité peut tolérer. La criticité cyber se choisit à part : elle mesure les conséquences d'une compromission, pas la probabilité qu'elle arrive. Un outil de paie peut supporter deux jours d'arrêt et rester très critique en cas de fuite.

**Données.** Le niveau de confidentialité, selon vos classes de données ; la présence de données personnelles ; la résidence des données, pays par pays.

**Continuité et reprise.** La vague de reprise dit dans quel ordre on redémarre, pas en combien de temps. Le RTO (délai de reprise) et le RPO (perte de données acceptable) se saisissent en minutes, heures ou jours, avec la date du dernier test de reprise. Si le RTO atteint la durée maximale d'interruption tolérée par le niveau de criticité, KANAP le signale.

**Revue.** Une justification écrite explique les niveaux retenus. Puis « Marquer comme revu » enregistre qui a revu la classification, et quand.

Ce qui n'est pas renseigné reste « Non défini ». KANAP ne choisit jamais un niveau par défaut à votre place : une application non classée doit se voir.

## Votre méthode, pas la nôtre

Vous avez sans doute déjà des niveaux, dans votre politique de sécurité ou dans votre dernière analyse d'impact. Gardez-les. Les quatre référentiels (criticité business, criticité cyber, confidentialité des données, vagues de reprise) se paramètrent : nom des niveaux, définition affichée au moment du choix, durée maximale d'interruption pour chaque niveau business, ordre, traductions.

![L'éditeur des référentiels de classification : niveaux, définitions et durée maximale d'interruption](/screenshots/blog/compliance-catalog-2026-10.png)

Modifier un référentiel ne déplace jamais une application et n'invalide aucune revue. Un niveau abandonné passe en « Ne plus proposer » : il reste lisible sur les applications qui le portent, il n'est simplement plus proposé.

## Une campagne de classification qu'on peut piloter

Classer quarante ou deux cents applications prend des semaines. La tuile **Conformité** du tableau de bord dit où en est la campagne : combien d'applications sont revues, à revoir, à compléter. En dessous, trois points d'attention : les applications les plus critiques sans test de reprise depuis douze mois, celles sans vague de reprise, et celles qui portent les données les plus confidentielles avec la criticité cyber la plus faible. Chaque chiffre ouvre la liste des applications concernées.

![La tuile Conformité : avancement de la campagne et points d'attention](/screenshots/blog/compliance-tile-2026-10.png)

La revue n'est pas un tampon annuel. Dès qu'une criticité, une vague, un objectif de reprise ou la résidence des données change après la revue, l'application repasse « À revoir ». La liste des applications affiche les mêmes champs en colonnes, avec des filtres, et s'exporte en CSV pour l'auditeur.

![La liste des applications triée par criticité business, avec la criticité cyber, la vague, le RTO, le RPO et l'état de la revue](/screenshots/blog/compliance-applications-2026-10.png)

## Ce qu'un référentiel apporte de plus qu'un tableur

Un tableur d'analyse d'impact classe des lignes. Dans KANAP, l'application classée est aussi reliée au reste du SI, et c'est là que la classification devient utile.

- **Les dépendances de reprise.** Sous la vague, KANAP liste les interfaces qui relient l'application à une application prévue dans une vague plus tardive. Sur la capture plus haut, SAP S/4HANA redémarre en V1, mais échange avec Salesforce, prévu en V2. Le plan de reprise voit ses incohérences avant le jour J.
- **La criticité des flux.** Les interfaces et les connexions héritent du niveau le plus élevé des applications qu'elles relient.
- **Les serveurs.** Chaque serveur indique son système d'exploitation et ses dates de fin de support.
- **Les fournisseurs et les contrats.** La chaîne d'approvisionnement est déjà là : chaque application mène à son éditeur, à ses contrats et à leurs échéances.
- **La documentation.** Les procédures de reprise et les comptes rendus de test vivent dans la base de connaissances, reliés à l'application.
- **La traçabilité.** Chaque modification est inscrite au journal d'audit.

Et Plaid, l'agent IA intégré, répond sur ces mêmes données : « quelles applications critiques n'ont pas eu de test de reprise depuis un an ? », « où en est la revue des classifications ? ». Il peut aussi préparer des modifications de classification, que vous validez. La revue, elle, reste un geste humain.

## Ce que KANAP ne fait pas

KANAP ne fait pas d'analyse de risques, ne remplace pas un système de management de la sécurité de l'information et ne déclare pas d'incident à l'ANSSI. Il fournit l'inventaire classé, relié et tenu à jour sur lequel ces démarches s'appuient. C'est la matière première de l'analyse de risques, pas l'analyse elle-même.

## Par où commencer

1. Reprenez dans les référentiels les niveaux de votre politique de sécurité ou de votre dernière analyse d'impact.
2. Classez d'abord les applications les plus critiques pour le métier.
3. Renseignez la vague, le RTO, le RPO et la date du dernier test de reprise.
4. Écrivez la justification, puis faites la revue.
5. Suivez la campagne depuis la tuile Conformité et traitez les points d'attention.
6. Reliez serveurs, interfaces et contrats au fil de l'eau.

Les données d'exemple d'un essai, le groupe fictif Fromage & Co, contiennent une campagne de classification en cours : de quoi voir tout cela avant de classer vos propres applications.
