---
title: "Le registre des incidents"
description: "Un an après une panne, l'auditeur ou l'assureur demande des détails. Quand elle a commencé, qui a décidé quoi, qui a fait quoi, si les bons interlocuteurs ont été notifiés. Un registre des incidents doit pouvoir répondre à ces questions, et vous prépare en même temps pour NIS2."
date: 2026-10-26
topic: compliance
features: [it-landscape, incidents]
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: incident-register-facts-dates-evidence
---

En mars, la facturation s'arrête pendant trois heures. Une première restauration échoue, la journée se termine tard, puis la vie reprend.

En octobre, l'auditeur demande le dossier. Quand l'incident a-t-il commencé, quand a-t-il été remarqué, qui l'a pris en charge ? Mais le ticket a été fermé, les échanges sont perdus dans les boîtes mail, et la personne qui a traité l'incident a changé de poste.

Voici comment KANAP répond au besoin.

## Ce qui a sa place dans le registre

Le registre garde les événements sur lesquels la direction, les auditeurs ou l'assureur reviendront :

- les interruptions qui ont touché des utilisateurs, des clients ou un processus métier ;
- les événements de sécurité : tentative d'intrusion, logiciel malveillant, fuite de données, équipement perdu ;
- les pertes de données, les restaurations échouées, les trous dans les sauvegardes ;
- les défaillances sérieuses d'un fournisseur ou d'un hébergeur ;
- tout ce qu'il faudra expliquer plus tard, ou signaler à une autorité.

Le ticket du quotidien reste dans l'outil de ticketing : le registre des incidents de KANAP ne remplace pas un centre de services. Son numéro se reporte dans la référence externe de l'incident, pour retrouver la trace opérationnelle. Un bon registre compte quelques entrées par mois, et une panne qui a produit quarante tickets est un seul incident.

Pour démarrer, trois champs suffisent : un titre, une gravité et l'heure de détection. Le reste se complète au fil de l'eau. Un registre tenu jusqu'ici dans un tableur s'importe par fichier CSV.

## Une chronologie solide

![Le journal d'un incident majeur, avec des notes datées et des changements de statut et de gravité.](/screenshots/incidents-journal-1600-2026-10-25.png)

Le journal fait d'un formulaire un registre. Il garde tout ce qui arrive à l'incident : les notes de l'équipe, chaque changement de statut et de gravité, chaque actif ou application lié ou délié, chaque réouverture avec son motif. Rien de ce qu'il contient ne peut être modifié ni supprimé, par personne.

Les notes portent l'heure des faits. Une note saisie le mardi peut être datée du samedi à 23 h 40 et se range à cet endroit de la chronologie. KANAP garde à côté l'heure réelle de la saisie, que personne ne peut changer : l'antidatage reste honnête.

Deux dates ouvrent la chronologie : le début de l'incident et le moment où il a été remarqué. L'écart entre les deux est souvent la première question de l'auditeur. Une fois l'incident résolu, sa durée s'affiche d'elle-même.

Le statut n'avance que vers l'avant : ouvert, en cours, résolu, clôturé. Revenir en arrière demande un administrateur du registre et un motif, lui aussi écrit dans le journal.

La numérotation reste continue. Un doublon s'annule avec un motif, et INC-13 ne disparaît jamais entre INC-12 et INC-14 : un trou dans la numérotation serait la première chose sur laquelle un auditeur reviendrait. Un incident qui porte des données de notification ne peut pas être supprimé.

## Relier l'incident à ce qu'il a touché

![L'onglet Relations d'un incident : ses actifs, ses applications, ses technologies et une suggestion.](/screenshots/incidents-relations-1600-2026-10-25.png)

Un incident isolé dans un registre est faible. Dans KANAP, il se relie à la cartographie : les serveurs touchés, les applications métier avec leur criticité, les technologies en cause. KANAP suggère les technologies portées par les serveurs et les applications déjà liés, avec leur origine, par exemple « technologie de l'actif AST-12 ». Un clic suffit pour les ajouter.

Le lien vaut dans les deux sens. La fiche d'un serveur, d'une application ou d'une technologie liste ses incidents : celui qui ouvre un serveur voit son historique. Et une recherche sur un nom d'hôte comme PAR-ESX-01 retrouve tous les incidents qui l'ont touché.

Les actions correctives deviennent des tâches, avec un responsable et une échéance, rattachées à l'incident. La revue décrit l'intention ; la tâche prouve que le travail a été fait.

## La revue d'incident figée à la clôture

![La vue d'ensemble d'un incident, avec sa description et sa revue d'incident.](/screenshots/incidents-review-2026-10-25.png)

Chaque incident a deux textes. La description tient en une ou deux phrases : ce qui s'est passé, tel qu'observé. La revue d'incident est le constat complet, rédigé dans un vrai document, avec des titres, des tableaux et des images collées.

Elle part d'un modèle en cinq parties : description détaillée, impact, cause racine, actions correctives, retour d'expérience. Pour un incident mineur, la description suffit ; pour un incident majeur, la revue est le post-mortem. Le modèle vous appartient et vous pouvez l'adapter à vos besoins.

Chaque enregistrement de la revue crée une version, conservée définitivement. À la clôture, l'incident est verrouillé et la revue figée sur la version que le journal nomme. C'est celle que lira l'auditeur. Terminez donc la revue avant de clôturer : il faudra ensuite un administrateur pour rouvrir.

## Le volet réglementaire

Quatre champs portent la partie réglementaire de l'incident :

- **Données personnelles concernées**, à cocher dès que des données personnelles ont été exposées, altérées ou perdues. C'est le filtre de votre délégué à la protection des données.
- **Notification aux autorités requise**, quand l'événement doit être signalé à une autorité de protection des données, à une agence de cybersécurité ou à un régulateur sectoriel.
- **Notifié le**, la date de dépôt.
- **Parties informées** : régulateur, assureur, clients touchés, sécurité du groupe.

L'article 33 du RGPD impose de documenter toute violation de données personnelles, notifiée ou non. Le registre en est la trace, et un incident qui porte ces informations ne peut pas être supprimé. Les délais et les seuils de notification dépendent de votre juridiction et de votre secteur : KANAP enregistre les faits et les dates, il ne décide pas s'il faut notifier.

Un incident de sécurité sensible peut être restreint. Seuls les administrateurs du registre, le déclarant et le responsable le voient alors ; pour les autres, il n'existe ni dans la liste, ni dans la recherche, ni dans les réponses de Plaid, ni dans l'export.

## Ce que l'auditeur reçoit

![Le registre filtré sur les incidents critiques et majeurs.](/screenshots/incidents-register-2026-10-25.png)

Le registre se filtre par période, gravité, catégorie ou indicateur de conformité. Les gravités Critique et Majeure sur l'année écoulée donnent la liste courte que demandent la plupart des comités et des audits, et l'export CSV la remet telle quelle.

Pour un incident précis, l'export PDF assemble une fiche complète : propriétés, description, revue d'incident, journal dans l'ordre chronologique avec les versions de la revue, actifs, applications et tâches liés, champs de conformité et pièces jointes.

Plaid, l'assistant intégré à KANAP, répond aussi : « Combien d'incidents critiques ce trimestre ? », « Liste des incidents ouverts sur PAR-ESX-01 », « Résumé de INC-2 ». Il lit le journal et la revue, et peut donc répondre jusque dans la cause racine.

## Par où commencer

1. **Importez le registre existant**, ou reprenez les incidents majeurs de l'année.
2. **Gardez une liste de catégories courte** : ce sont elles qui regrouperont une année d'incidents.
3. **Enregistrez tôt, complétez au fil de l'eau, clôturez après rédaction de la revue.**
4. **Revoyez le registre chaque trimestre** : les catégories qui reviennent et les serveurs qui apparaissent plus d'une fois alimentent peut-être la prochaine demande de budget ou le prochain projet.

Pour voir tout cela en action, un essai gratuit de 14 jours de notre version hébergée donne accès aux données d'exemple du groupe fictif Fromage & Co, registre d'incidents compris, chargées en une minute. KANAP est entièrement open source : il s'installe aussi gratuitement sur vos propres serveurs.
