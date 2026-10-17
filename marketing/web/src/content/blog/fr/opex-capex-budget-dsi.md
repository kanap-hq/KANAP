---
title: "OPEX et CAPEX : le budget de la DSI, prêt pour le contrôle de gestion"
description: "Fonctionnement et investissement au même endroit : la DSI construit son budget simplement, et arrive prête pour la revue avec le contrôle de gestion."
date: 2026-10-17
topic: cost
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: opex-capex-it-budget
series:
  key: opex-budget
  part: 4
  title: "Construire le budget de la DSI"
---

Le budget de la DSI tient en deux enveloppes : le fonctionnement et l'investissement. Souvent, chacune vit dans son fichier, avec son calendrier et la personne qui la tient. Puis vient la revue avec le contrôle de gestion et ses questions : combien de fonctionnement, combien d'investissement, pour quoi faire, que coûte vraiment ce programme ?

Chaque réponse demande alors une consolidation à la main. KANAP est l'endroit où la DSI prépare son budget, OPEX et CAPEX ensemble, simplement. Et parce que chaque ligne y est classée au fil de l'eau, la DSI arrive en revue avec des chiffres propres, cohérents et faciles à justifier.

## OPEX ou CAPEX, la règle en clair

L'**OPEX** fait fonctionner le système d'information pendant l'année : abonnements, maintenance, prestations récurrentes. Le **CAPEX** crée ou améliore un actif utilisé sur plusieurs années : serveurs, postes de travail, développement capitalisé. Ce qui se capitalise relève des règles comptables de l'entreprise, que la finance fixe avec la DSI.

Une seconde question vient souvent se mêler à la première : run ou build ? Le run maintient les services existants, le build les crée ou les fait évoluer. Un projet de build porte souvent des deux natures : le développement capitalisé en CAPEX, la formation et la conduite du changement en OPEX. KANAP garde les deux réponses sur chaque ligne, dans deux champs distincts, mais permet leur consolidation.

## Une seule liste, un seul espace de travail

Dans KANAP, OPEX et CAPEX sont un simple champ de la ligne budgétaire. Les lignes des deux natures partagent les mêmes colonnes budgétaires (scénarii) par année, les mêmes ventilations entre sociétés et départements, les mêmes liens vers les applications, projets, contrats et fournisseurs. Le filtre de la colonne **Type** isole l'une ou l'autre en un clic.

![La liste des lignes budgétaires de Fromage & Co : lignes OPEX et CAPEX ensemble, avec la colonne Type](/screenshots/blog/opex-capex-list-2026-10-17.png)

Le type OPEX ou CAPEX pilote certains champs de la fiche :

- **Les comptes** : chaque compte du plan comptable sert à l'OPEX, au CAPEX ou aux deux. Une ligne CAPEX ne verra que les comptes d'investissement.
- **Les dimensions analytiques** : une dimension ou une valeur peut être réservée à une nature (voir plus bas).
- **La refacturation** : les rapports de refacturation et d'analyse proposent l'OPEX, le CAPEX ou les deux.
- **Les gels** : une colonne budgétaire se gèle par année et par nature. Un budget d'investissement validé peut être figé pendant que le fonctionnement se prépare encore.

## Les dimensions, le langage commun de la DSI et du contrôle de gestion

Les dimensions analytiques classent les lignes pour le reporting, à côté de la structure comptable (le détail est dans [Axe analytique du budget IT : ce que coûte la cyber](/fr/blog/la-dimension-analytique-du-budget-it)). Chaque dimension répond à une question. Le bon jeu de dimensions dépend de chaque organisation ; voici un exemple tiré des bonnes pratiques, dont chacun peut s'inspirer.

Pas besoin de partir de zéro ! Un nouvel espace KANAP démarre avec quatre dimensions recommandées et leurs valeurs (Nature de coût, Domaine IT, Motif et Priorité). Chacune se renomme, se complète et se règle ensuite comme vous l'entendez.

**« À quoi sert cet investissement ? »** La dimension **Motif** : remplacement, capacité, productivité, sécurité, conformité, croissance. Réservée aux lignes CAPEX et rendue obligatoire, elle garantit que chaque nouvel investissement arrive classé, qu'il soit créé à l'écran, chargé par fichier, préparé par Plaid ou envoyé par l'API. Plus de relance pour compléter une colonne oubliée.

**« Qu'est-ce qui est incompressible ? »** La dimension **Priorité** : obligatoire, haute, moyenne, basse. C'est elle qui structure l'arbitrage en comité. Chez Fromage & Co, notre société d'exemple, les investissements obligatoires pèsent 1,13 M€ sur 2,34 M€ en 2026 : la migration S/4HANA, le renouvellement du data center et la segmentation réseau des usines.

**« Que coûte ce programme, tout compris ? »** Une dimension **Programme**, créée en quelques secondes, utilisée par l'OPEX comme par le CAPEX, avec une valeur par programme. Le programme S/4HANA de Fromage & Co réunit ainsi 984 k€ de maintenance, de prestataires et de support en fonctionnement et 757 k€ d'investissement (intégration, développement capitalisé, serveurs HANA) : 1,74 M€ sur l'année, dans un seul rapport. En fin de programme, la valeur se désactive : elle reste sur les lignes et dans les rapports passés, et ne se propose plus.

**« De quelle nature est la dépense ? »** La **Nature de coût** et le **Domaine IT**, issues du modèle TBM (Technology Business Management), communes aux deux natures. Une valeur peut être réservée à une nature : la main-d'œuvre interne, par exemple, à l'OPEX seulement.

![Le panneau Propriétés d'une ligne CAPEX : compte d'investissement, Motif, Priorité et Programme renseignés](/screenshots/blog/opex-capex-line-properties-2026-10-17.png)

Le lien avec la comptabilité passe par les comptes, réglés par nature, et par les comptes de consolidation du groupe. Les dimensions restent un outil de lecture et d'analyse : elles ne touchent ni aux comptes ni aux ventilations.

La DSI y gagne un classement qui se fait en même temps que la saisie, et le contrôle de gestion des règles qui s'appliquent d'elles-mêmes. Une dimension se renomme, se réordonne ou s'arrête à une date de fin de validité sans perdre l'historique, et le journal d'audit garde la trace des changements.

## Les rapports : Tous, OPEX ou CAPEX

Huit rapports s'ouvrent sur trois onglets, **Tous**, **OPEX** et **CAPEX** : top lignes, hausses et baisses, comparaison budgétaire, comparaison de colonnes, comptes de consolidation, dimensions analytiques, effectifs par mois et coût par ETP.

Les filtres se combinent : centre de coûts, run ou build, et une valeur par dimension. Le CAPEX 2026 regroupé par motif, le coût d'un programme sur l'onglet **Tous**, les seuls investissements obligatoires d'une filiale : chaque vue se construit en quelques clics.

![Le rapport Dimensions analytiques sur le CAPEX 2026 de Fromage & Co, regroupé par Motif](/screenshots/blog/opex-capex-report-purpose-2026-10-17.png)

Sur l'exemple, le remplacement représente 59 % de l'investissement 2026, la croissance 35 % et la sécurité 5 %. C'est le genre de chiffre qui apporte une vraie visibilité, d'autant plus quand il peut être comparé d'une année sur l'autre. Et nous l'avons ici sous la main en un clic.

L'adresse de la page contient la nature et les filtres choisis. Le lien envoyé au contrôleur de gestion ouvre exactement la même vue ; l'export PDF présente le même contenu. Les rapports de refacturation proposent aussi l'OPEX, le CAPEX ou les deux ; le CAPEX y compte pour son montant de l'année.

Enfin, toutes ces données peuvent alimenter des rapports sur mesure générés par votre outil d'IA favori, connecté directement à KANAP.

## Quand une dépense change de nature

Une prestation s'avère capitalisable, un investissement redevient du fonctionnement. Sur la ligne, **Changer le type** fait le changement proprement :

- **À partir de la première année de la ligne**, la ligne elle-même change de nature. Elle garde sa référence, ses budgets, ses ventilations et ses liens.
- **À partir d'une année ultérieure**, la ligne s'arrête au 31 décembre de l'année précédente et garde son historique. Une nouvelle ligne de l'autre nature prend la suite, avec les liens vers les applications, contrats et projets. Les deux lignes restent reliées : « Remplacée par » d'un côté, « Succède à » de l'autre.

![La fenêtre Changer le type d'une ligne budgétaire : année de départ, compte et motif](/screenshots/blog/opex-capex-change-type-2026-10-17.png)

La fenêtre propose un compte adapté à la nouvelle nature, et demande les dimensions obligatoires de cette nature quand il y en a. Le motif du changement va au journal d'audit. Un budget gelé reste intact : le changement est refusé tant qu'une colonne gelée porte des montants sur les années concernées.

## Ce que KANAP ne fait pas

KANAP ne calcule pas les amortissements et ne tient pas le registre des immobilisations : c'est le rôle de la comptabilité et de l'ERP. KANAP prépare et suit le budget de la DSI, OPEX et CAPEX, classé comme le contrôle de gestion le demande.

## Par où commencer

1. **Partez des questions du contrôle de gestion** : celles qui reviennent à chaque revue budgétaire. Chacune deviendra une dimension, ou un filtre d'un rapport existant.
2. **Ajustez les dimensions recommandées** : renommez ce qui doit l'être, ajoutez celles qui vous manquent (un Programme, par exemple), réservez au CAPEX ce qui ne concerne que l'investissement, et rendez obligatoires les dimensions indispensables.
3. **Faites une passe sur les lignes existantes** pour renseigner les dimensions encore vides. Sous chaque dimension obligatoire, KANAP compte les lignes sans valeur et ouvre leur liste en un clic.
4. **Vérifiez le résultat dans les rapports** avant la revue : ce qui reste en « Non affecté » montre ce qu'il faut encore classer.

Pour voir tout cela sur un budget déjà classé, un essai gratuit de 14 jours de notre version hébergée donne accès aux données d'exemple du groupe fictif Fromage & Co, chargées en une minute. KANAP est entièrement open source : il s'installe aussi gratuitement sur vos propres serveurs.
