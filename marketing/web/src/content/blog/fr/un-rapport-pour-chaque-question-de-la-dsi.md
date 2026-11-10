---
title: Un rapport pour chaque question de la DSI
description: "Le DSI, le chef de projet, le responsable d'équipe et l'ingénieur se posent chacun leurs questions. Les rapports du portefeuille de Kadratis y répondent en un clic."
date: 2026-09-23
topic: portfolio
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: portfolio-reports-for-every-role
---

Lundi, 9 h, point hebdomadaire de la DSI. Le DSI a passé son dimanche soir à consolider trois fichiers pour savoir où en sont les projets. La cheffe de projet arrive avec un planning qu'elle a mis à jour dans le train. Le responsable de l'équipe systèmes annonce que son équipe est « sous l'eau », sans chiffre pour le montrer. L'ingénieur réseau explique qu'il a surtout fait du run cette semaine, et personne ne sait combien.

Chacun a une vraie question. Chacun y répond avec ses propres outils, et la réunion passe une demi-heure à réconcilier des chiffres.

Toutes les réponses existent pourtant déjà dans Kadratis. Chaque demande, chaque projet et chaque tâche y laisse une trace : sa création, ses changements de statut, sa clôture, le temps saisi dessus. Les rapports du portefeuille lisent cet historique et le présentent à chacun sous l'angle qui l'intéresse.

![La page des rapports du portefeuille : le bandeau des 30 derniers jours, les éléments à traiter, le bandeau À classer et les cartes des rapports](/screenshots/blog/portfolio-hub.png)

## Le DSI : qu'est-ce qui a bougé, et qu'est-ce qui coince ?

Le DSI a besoin d'une vue d'ensemble en une minute. Le bandeau en haut de la page des rapports la donne en trois lignes : tâches, demandes, projets. Chaque ligne se lit de la même façon : *14 créés · 9 clôturés · 52 ouverts (+5)*, sur les 7, 30 ou 90 derniers jours. Le dernier chiffre est la variation du stock : les créations et les réouvertures, moins les clôtures.

Juste en dessous, la ligne **À traiter** apparaît quand une décision est attendue : les tâches en retard, les tâches sans responsable, les projets en cours ou en test sans activité depuis 30 jours. Un projet est considéré actif dès que quelque chose bouge sur lui ou sur ses tâches : une modification, une note au journal, du temps saisi. Ceux qui restent dans cette liste sont vraiment à l'arrêt, et un clic les affiche avec la date de leur dernière activité.

Les autres chiffres ouvrent la liste filtrée sur exactement les éléments comptés. Les créations et les clôtures ouvrent le **Bilan de la période** sur les mêmes jours.

Pour le comité de direction, le **Bilan de la période** raconte la semaine ou le mois dans l'ordre du portefeuille : les demandes, puis les projets, puis les tâches, chacun en trois listes (créations, modifications, clôtures). Un projet créé indique son origine, par exemple la demande dont il est issu. Le bilan se filtre par source, catégorie, projet ou équipe. Il s'exporte en CSV ou en XLSX, et s'imprime proprement en PDF, comme tous les rapports.

<aside class="tip">
  <b>Astuce</b>
  <p>Le bandeau <b>À classer</b> compte le travail ouvert sans source, sans catégorie ou sans type. Un clic ouvre la liste à compléter. Des données bien classées donnent des rapports fiables.</p>
</aside>

## La cheffe de projet : qu'est-ce qui arrive, et qu'est-ce qui a changé ?

La cheffe de projet regarde devant elle. Le rapport **À venir** rassemble ce qui tombe bientôt : les fins de projet prévues dans les 30 prochains jours, les démarrages prévus, les tâches à échéance dans les 14 prochains jours, les livraisons demandées par le métier. Les tâches déjà en retard et les fins de projet déjà dépassées sont comptées à part, avec un lien vers elles.

Filtré sur son projet, le même rapport devient sa feuille de route de la quinzaine.

![Le rapport À venir : quatre fins de projet prévues dans les 30 jours, sept déjà dépassées, deux démarrages prévus](/screenshots/blog/portfolio-upcoming.png)

Pour le point avec son sponsor, elle ouvre le **Bilan de la période** filtré sur son projet. La colonne **Modifications** résume ce qui a changé sur chaque élément, en clair : `En cours → En test`, puis les champs modifiés. Les clôtures portent deux dates, **Créé le** et **Clôturé le**, et la durée réelle de chaque tâche se lit d'un coup d'œil.

## Le responsable d'équipe : qui a besoin d'aide ?

« Mon équipe est sous l'eau » devient un constat chiffré. Le rapport **Points d'attention par contributeur** liste, équipe par équipe, les tâches ouvertes de chacun, celles qui sont en retard et celles qui n'ont pas bougé depuis 14 jours. Chaque chiffre ouvre la liste des tâches concernées, et le point d'équipe commence par elles.

![Points d'attention par contributeur : tâches ouvertes, en retard et sans mouvement depuis 14 jours, équipe par équipe](/screenshots/blog/portfolio-attention.png)

Le **Planning de capacité** met la charge restante des projets en regard de la capacité de chacun, en mois de travail : vert jusqu'à un mois, puis jaune, orange, rouge et violet au-delà d'un an. Le **Travail non affecté** apparaît dans son propre total. Le responsable d'équipe arrive à l'arbitrage avec des mois de travail, et la discussion porte sur les priorités.

Le **Flux et ancienneté** montre enfin si le stock grossit : les tâches créées et clôturées semaine après semaine, les demandes et les projets mois après mois. Il donne aussi l'âge du travail ouvert, les éléments bloqués dans le même statut (plus de 30 jours pour une tâche, plus de trois mois pour une demande ou un projet) et le délai médian de clôture.

## L'ingénieur : faire voir le travail du quotidien

L'ingénieur passe une bonne partie de sa semaine sur des mises à jour, des incidents, des demandes d'accès. Ce travail compte, et il se voit rarement dans un portefeuille de projets.

Le rapport **Temps saisi** le fait apparaître. Il répartit les jours saisis, mois après mois, entre les projets et le reste du travail, équipe par équipe. Dans l'exemple ci-dessous, l'équipe Infrastructure consacre 60 % de ses jours au run. Quand la DSI découvre ce chiffre, la conversation sur les priorités change de nature.

![Le temps saisi par l'équipe Infrastructure sur six mois : 40 % de jours projet, 60 % d'autre travail](/screenshots/blog/portfolio-time-logged.png)

Ces rapports servent à répartir la charge. Les équipes gardent l'ordre choisi par la DSI, les personnes sont listées par ordre alphabétique, et le rapport affiche des jours, jamais le contenu des saisies. Une tâche clôturée est attribuée à la personne qui la portait au moment de la clôture. L'**Activité par personne** montre ainsi, équipe par équipe, les tâches que chacun a créées, fait avancer et terminées sur la période, avec ses jours saisis.

## Retour au lundi matin

La semaine suivante, le point commence sur l'écran de la salle. Le DSI ouvre la page des rapports : le bandeau du haut donne l'état du portefeuille, la ligne **À traiter** donne l'ordre du jour. La cheffe de projet montre **À venir** sur son projet. Le responsable systèmes montre ses points d'attention et son planning de capacité. L'ingénieur montre la part du run dans le temps de son équipe.

Tout le monde lit les mêmes chiffres, issus des mêmes tâches. La réunion dure vingt minutes et se termine par des décisions.

## En pratique

Les rapports se trouvent dans **Portefeuille > Rapports**. Ils demandent le droit de lecture sur les rapports du portefeuille, et fonctionnent en cloud comme en on-premise. Ils lisent les données existantes : les tâches, les projets, les demandes et le temps saisi que vos équipes renseignent déjà.

Le reste du portefeuille est décrit sur la page [Portefeuille](https://kadratis.com/fr/features/portfolio).
