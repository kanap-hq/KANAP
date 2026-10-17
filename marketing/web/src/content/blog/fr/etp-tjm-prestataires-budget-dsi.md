---
title: "ETP, TJM : les prestataires externes dans le budget de la DSI"
description: "Budgétez une prestation comme vous l'achetez, en personnes, en jours et en prix : KANAP en tire les ETP, le coût par ETP et le TJM, prêts pour le comité."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: it-contractors-fte-daily-rate
series:
  key: opex-budget
  part: 5
  title: "Construire le budget de la DSI"
---

En période budgétaire, la question finit toujours par arriver : combien de prestataires la DSI paie-t-elle, à quel coût, et qu'est-ce qui change l'an prochain ? Souvent, la réponse vit dans un tableur, parfois juste dans les contrats signés, ou bien dans un suivi parallèle aux achats. Et ça ne colle jamais tout à fait au budget.

Dans KANAP, une seule saisie suffit. Vous budgétez une prestation comme vous l'achetez : des personnes ou des jours, un prix, une période. KANAP en tire le montant de chaque mois, les ETP, le coût par ETP et le TJM.

## ETP, coût par ETP, TJM

- **L'ETP** (équivalent temps plein) dit pour combien de personnes le budget paie. Un consultant à temps plein toute l'année vaut 1 ETP. De février à octobre, il vaut 0,75 sur l'année.
- **Le coût par ETP** est le coût annuel moyen d'une personne à temps plein.
- **Le TJM** (taux journalier moyen) est le coût des prestations au prix par jour divisé par les jours achetés.

KANAP donne deux lectures de l'ETP. La **moyenne sur l'année** sert aux rapports et aux comparaisons d'une année à l'autre. L'**ETP sur la période** dit combien de personnes travaillent pendant la mission : notre consultant de février à octobre y compte pour 1.

Cet article porte sur les ressources externes : régie, assistance technique, forfaits de jours. C'est là que le budget de la DSI se construit en personnes et en jours, et que les questions du comité se concentrent.

## La saisie : chaque ligne se lit comme une phrase

Dans l'onglet Budget d'une ligne budgétaire, chaque colonne (Budget, Atterrissage prévu, Révision…) peut se construire en **Quantité et prix**. Une ligne y tient en une phrase : une quantité, une unité (personnes, jours ou pièces), un prix, une fréquence, une période et un calendrier. Les montants de chaque mois sont la somme des lignes. Quelques cas courants :

**La régie à temps plein.** Deux développeurs SAP à 480 € par jour, à temps plein toute l'année. Chaque mois compte ses jours ouvrés : sur un calendrier de 218 jours, la ligne coûte 209 280 € et vaut 2 ETP.

**Le temps partiel.** Un chef de projet 5 jours par mois à 1 200 € par jour, de février à juillet : 6 000 € par mois. KANAP rapporte ces 5 jours aux jours ouvrés de chaque mois, soit un peu plus d'un quart de temps pendant la mission, et deux fois moins sur l'année.

**Le forfait de jours.** 30 jours d'expertise achetés pour la même période, à 1 200 € par jour : 36 000 €, répartis sur les mois de la période et convertis en ETP de la même façon.

**Les arrivées et les départs.** Chaque ligne a sa période. Chez Fromage & Co, notre société d'exemple, l'architecte d'intégration à 950 € par jour était prévu en février au budget. Il arrive en avril : on décale la date de début dans l'atterrissage prévu, et KANAP recalcule le montant et l'ETP de l'année, 0,92 au budget et 0,75 à l'atterrissage.

Le résultat s'affiche pendant la saisie : le montant de chaque mois, et l'ETP sous les lignes. Dans l'exemple ci-dessous, les deux développeurs, le chef de projet et le forfait de jours font 281 280 € et 2,28 ETP, et la carte de la colonne le résume : « Quantité et prix · 3 lignes · 2,28 ETP ». **Utiliser aussi pour d'autres colonnes** reporte les mêmes lignes sur l'atterrissage ou la révision, qu'il ne reste plus qu'à ajuster.

![L'onglet Quantité et prix d'une ligne budgétaire : une régie à temps plein, un temps partiel en jours par mois et un forfait de jours, avec l'ETP sous les lignes](/screenshots/blog/fte-quantity-price-2026-10-18.png)

## Les calendriers : juste au jour près

Une prestation au prix par jour coûte le nombre de jours réellement payés. C'est le calendrier de jours ouvrés qui le dit, mois par mois.

Le calendrier standard d'un pays se crée avec la société : les jours de semaine, moins les jours fériés. Il n'y a rien à saisir. Une nouvelle ligne prend celui du pays de la société payeuse.

Un calendrier personnalisé couvre les cas particuliers. Fromage & Co en a deux. **218 jours** reprend le rythme d'un consultant en forfait jours, congés répartis sur l'année. **Sans congés** compte tous les jours ouvrés, pour une prestation facturée au jour réellement travaillé. Et bien sûr, vous pouvez créer vos propres calendriers, y placer les congés, etc.

![Les calendriers de jours ouvrés de Fromage & Co : les calendriers standards de quatre pays et deux calendriers personnalisés](/screenshots/blog/fte-calendars-2026-10-18.png)

## Le budget en ETP dans la liste

La liste des lignes budgétaires affiche une colonne ETP pour chaque colonne budgétaire et chaque année, juste après les montants. Elle se trie et se filtre comme les autres. Le pied de colonne donne le total, et signale les lignes sans ETP : « 3,50 · 12 inconnues ».

La colonne **ETP déclarés** isole en un clic les lignes de prestation. On voit alors, côte à côte, ce que chaque prestation coûte et pour combien de personnes, au budget et à l'atterrissage.

Pour l'année suivante, la copie des colonnes budgétaires fait le travail : les quantités restent, les prix augmentent du pourcentage choisi, les périodes glissent d'un an et chaque mois se recalcule avec les jours ouvrés de la nouvelle année. Les ETP suivent (le détail est dans [Construire le budget DSI de l'année suivante](/fr/blog/opex-copy-budget-columns)).

![La liste des lignes budgétaires de Fromage & Co, filtrée sur les lignes avec ETP, avec les colonnes ETP du budget et de l'atterrissage 2026](/screenshots/blog/fte-budget-lines-2026-10-18.png)

## Les rapports : combien de personnes, à quel coût

Tout ce qui précède alimente directement les rapports. Rien à préparer.

**Effectifs par mois** montre les ETP mois par mois, regroupés par centre de coûts, fournisseur, ligne ou dimension analytique. Le tableau donne la moyenne de l'année et le pic. On y lit la montée en charge d'un projet, le mois où l'équipe externe est la plus nombreuse, et le poids de chaque fournisseur.

![Le rapport Effectifs par mois sur le budget 2026 de Fromage & Co, regroupé par fournisseur](/screenshots/blog/fte-staffing-by-month-2026-10-18.png)

Chez Fromage & Co, l'équipe externe compte 46 ETP en moyenne au budget 2026, avec un pic à 48 en mai et juin.

**Coût par ETP** met jusqu'à quatre colonnes côte à côte, par exemple le budget et l'atterrissage prévu, ou l'atterrissage de cette année et le budget de la suivante. Pour chaque groupe : les ETP, le coût et le coût par ETP. **Afficher > TJM** passe au taux journalier moyen d'un clic, pondéré par les jours achetés. Un fournisseur dont le TJM monte, une équipe qui grossit sans que le coût par ETP bouge : la lecture est immédiate.

![Le rapport Coût par ETP de Fromage & Co, budget et atterrissage prévu 2026 côte à côte, par fournisseur](/screenshots/blog/fte-cost-per-fte-2026-10-18.png)

Le budget 2026 de Fromage & Co paie ainsi 46,17 ETP de prestataires pour 6,68 M€, soit 144 670 € par ETP, et 145 197 € à l'atterrissage. Les écarts entre fournisseurs sautent aux yeux : 100 716 € par ETP pour l'équipe nearshore de Lisbonne, près de 180 000 € pour l'expertise infrastructure d'Alpine Data Experts.

Les autres rapports budgétaires ont un sélecteur **Mesure** : Montant ou ETP. Les plus fortes hausses, la comparaison budgétaire ou les dimensions analytiques se lisent alors en personnes. Le filtre **Lignes avec ETP** compare aussi les montants du budget et du réalisé des seules lignes de prestation.

Les onglets **Tous**, **OPEX** et **CAPEX** et les filtres par dimension s'appliquent ici aussi : le coût par ETP du développement capitalisé, ou celui d'un programme (voir [OPEX et CAPEX : le budget de la DSI, prêt pour le contrôle de gestion](/fr/blog/opex-capex-budget-dsi)).

Chaque chiffre se justifie. Le nom d'un groupe ouvre la liste de ses lignes. Un avertissement signale quand le montant d'une colonne ne suit plus ses lignes de quantité et prix. Le lien de la page garde tous les réglages, et le tableau s'exporte en CSV, le graphique en PNG, la page en PDF.

## Et le temps des équipes internes ?

Aujourd'hui, KANAP suit les ETP externes. Une prochaine version intégrera de façon distincte le temps des ressources internes, pour lire côte à côte internes et prestataires.

En attendant, le temps interne peut déjà se valoriser simplement : une ligne par profil, avec son TJM, sur la ligne budgétaire du projet ou du service concerné. Un coût moyen par profil suffit au pilotage, et évite d'exposer des rémunérations individuelles à tous les lecteurs du budget.

## Ce que KANAP ne fait pas

KANAP n'est ni un SIRH ni un outil de paie, et ne suit pas les temps passés. Les ETP de KANAP sont ceux que le budget prévoit et paie, ligne par ligne.

## Par où commencer

1. **Vérifiez les calendriers** : les standards de vos pays sont déjà là. Ajoutez un calendrier personnalisé quand un contrat de prestation compte les jours autrement.
2. **Commencez par les plus grosses prestations** : la régie et l'assistance technique, là où l'enjeu est le plus visible. Une ligne par profil, avec sa quantité, son TJM et sa période.
3. **Reportez les lignes sur l'atterrissage** avec Utiliser aussi pour d'autres colonnes, puis ajustez les dates d'arrivée et de départ au fil de l'année.
4. **Lisez Effectifs par mois, puis Coût par ETP**, exportez le tableau en CSV pour Excel, la page en PDF ou juste les graphiques pour préparer votre présentation.

Pour voir tout cela sur un budget déjà saisi, un essai gratuit de 14 jours de notre version hébergée donne accès aux données d'exemple du groupe fictif Fromage & Co, chargées en une minute. KANAP est entièrement open source : il s'installe aussi gratuitement sur vos propres serveurs.
