---
title: "OPEX et CAPEX : un seul budget DSI, lisible par le contrôle de gestion"
description: "Fonctionnement et investissement dans une seule liste, classés avec les dimensions du contrôle de gestion : motif, priorité, programme. Les rapports suivent."
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

Le budget de fonctionnement d'un côté, le plan d'investissement de l'autre. Deux fichiers, deux calendriers, deux personnes qui les tiennent. Et un contrôle de gestion qui pose chaque année les mêmes questions : combien de fonctionnement, combien d'investissement, pour quoi faire, et que coûte vraiment ce programme, tout compris ?

Chaque réponse passe par une consolidation à la main. KANAP part d'un principe simple : un seul budget, deux natures de dépense, et un classement que la DSI et le contrôle de gestion partagent.

## OPEX ou CAPEX, la règle en clair

L'**OPEX** fait fonctionner le système d'information pendant l'année : abonnements, maintenance, prestations récurrentes. Le **CAPEX** crée ou améliore un actif utilisé sur plusieurs années : serveurs, postes de travail, développement capitalisé. Ce qui se capitalise relève des règles comptables de l'entreprise, que le contrôle de gestion fixe avec la DSI.

Une seconde question vient souvent se mêler à la première : run ou build ? Le run maintient les services existants, le build les crée ou les fait évoluer. Un projet de build porte souvent des deux natures : le développement capitalisé en CAPEX, la formation et la conduite du changement en OPEX. KANAP garde les deux réponses sur chaque ligne, dans deux champs distincts.

## Une seule liste, un seul espace de travail

Dans KANAP, le type est un champ de la ligne budgétaire. Les lignes OPEX et CAPEX sont dans la même liste, sous **Gestion budgétaire > Lignes budgétaires**, avec une seule série de références (`BL-12`). Elles ont les mêmes cinq colonnes budgétaires par année, les mêmes ventilations entre sociétés et départements, les mêmes liens vers les applications, projets, contrats et fournisseurs. Le filtre de la colonne **Type** isole l'une ou l'autre nature en un clic.

![La liste des lignes budgétaires de Fromage & Co : lignes OPEX et CAPEX ensemble, avec la colonne Type](/screenshots/blog/opex-capex-list-2026-10-17.png)

Le type règle ce qui doit l'être, et seulement cela :

- **Les comptes** : chaque compte du plan comptable sert à l'OPEX, au CAPEX ou aux deux. Une ligne CAPEX ne propose que les comptes d'investissement.
- **Les dimensions analytiques** : une dimension ou une valeur peut être réservée à une nature (voir plus bas).
- **La refacturation** : les rapports de refacturation proposent l'OPEX, le CAPEX ou les deux.
- **Les gels** : une colonne budgétaire se gèle par année et par nature. Le budget d'investissement voté peut être figé pendant que le fonctionnement se prépare encore.

Un seul fichier budgétaire fait entrer et sortir les deux natures, avec une colonne `nature`. Le budget préparé dans un tableur se charge en une fois.

## Les dimensions, le langage commun de la DSI et du contrôle de gestion

Les dimensions analytiques classent les lignes pour le reporting, à côté de la structure comptable (le détail est dans [Axe analytique du budget IT : ce que coûte la cyber](/fr/blog/la-dimension-analytique-du-budget-it)). Chaque dimension répond à une question. Voici celles que le contrôle de gestion pose sur l'investissement, et le réglage qui y répond.

**« À quoi sert cet investissement ? »** Une dimension **Motif** : remplacement, capacité, productivité, sécurité, conformité, croissance. Réservez-la aux lignes CAPEX et rendez-la obligatoire : chaque nouvel investissement arrive classé, qu'il soit créé à l'écran, chargé par fichier, préparé par Plaid ou envoyé par l'API. Plus de relance pour compléter une colonne oubliée.

**« Qu'est-ce qui est incompressible ? »** Une dimension **Priorité** : obligatoire, haute, moyenne, basse. C'est elle qui structure l'arbitrage en comité. Chez Fromage & Co, notre société d'exemple, les investissements obligatoires pèsent 1,13 M€ sur 2,35 M€ en 2026 : la migration S/4HANA, le renouvellement du data center et la segmentation réseau des usines.

**« Que coûte ce programme, tout compris ? »** Une dimension **Référence budgétaire**, utilisée par l'OPEX comme par le CAPEX, avec une valeur par programme. Le programme S/4HANA de Fromage & Co réunit ainsi 704 k€ de prestataires et de support en fonctionnement et 757 k€ d'investissement (intégration, développement capitalisé, serveurs HANA) : 1,46 M€ sur l'année, dans un seul rapport. En fin de programme, la valeur se désactive : elle reste sur les lignes et dans les rapports passés, et ne se propose plus.

**« De quelle nature est la dépense ? »** La **Nature de coût** et le **Domaine IT**, deux dimensions recommandées issues du modèle TBM (Technology Business Management), communes aux deux natures. Une valeur peut être réservée à une nature : la main-d'œuvre interne, par exemple, à l'OPEX seulement.

![Le panneau Propriétés d'une ligne CAPEX : compte d'investissement, Motif, Priorité et Référence budgétaire renseignés](/screenshots/blog/opex-capex-line-properties-2026-10-17.png)

Le lien avec la comptabilité passe par les comptes, réglés par nature, et par les comptes de consolidation du groupe. Les dimensions restent un outil de lecture : elles ne touchent ni aux comptes ni aux ventilations.

Le contrôle de gestion y gagne des règles qui s'appliquent d'elles-mêmes. Une dimension se renomme, se réordonne ou s'arrête à une date de fin de validité sans perdre l'historique, et le journal d'audit garde la trace des changements.

## Les rapports : Tous, OPEX ou CAPEX

Huit rapports s'ouvrent sur trois onglets, **Tous**, **OPEX** et **CAPEX** : top lignes, hausses et baisses, comparaison budgétaire, comparaison de colonnes, comptes de consolidation, dimensions analytiques, effectifs par mois et coût par ETP.

Les filtres se combinent : centre de coûts, run ou build, et une valeur par dimension. Le CAPEX 2026 regroupé par motif, le coût d'un programme sur l'onglet **Tous**, les seuls investissements obligatoires d'une filiale : chaque vue se construit en quelques clics.

![Le rapport Dimensions analytiques sur le CAPEX 2026 de Fromage & Co, regroupé par Motif](/screenshots/blog/opex-capex-report-purpose-2026-10-17.png)

Sur l'exemple, le remplacement représente 59 % de l'investissement 2026, la croissance 36 % et la sécurité 5 %. C'est le genre de chiffre qu'un comité de direction demande, et qu'il obtient ici sans retraitement.

L'adresse de la page garde la nature et les filtres choisis. Le lien envoyé au contrôleur de gestion ouvre exactement la même vue, et l'export PDF se présente tel quel. Les rapports de refacturation proposent aussi l'OPEX, le CAPEX ou les deux ; le CAPEX y compte pour son montant de l'année.

## Quand une dépense change de nature

Une prestation s'avère capitalisable, un investissement redevient du fonctionnement. Sur la ligne, **Changer le type** fait le changement proprement :

- **À partir de la première année de la ligne**, la ligne elle-même change de nature. Elle garde sa référence, ses budgets, ses ventilations et ses liens.
- **À partir d'une année ultérieure**, la ligne s'arrête au 31 décembre de l'année précédente et garde son historique. Une nouvelle ligne de l'autre nature prend la suite, avec les liens vers les applications, contrats et projets. Les deux lignes restent reliées : « Remplacée par » d'un côté, « Succède à » de l'autre.

![La fenêtre Changer le type d'une ligne budgétaire : année de départ, compte, dimensions et motif](/screenshots/blog/opex-capex-change-type-2026-10-17.png)

La fenêtre demande un compte adapté à la nouvelle nature et les dimensions obligatoires qui s'y appliquent. Le motif du changement va au journal d'audit. Un budget gelé reste intact : le changement est refusé tant qu'une colonne gelée porte des montants sur les années concernées.

## Ce que KANAP ne fait pas

KANAP ne calcule pas les amortissements et ne tient pas le registre des immobilisations : c'est le rôle de la comptabilité et de l'ERP. KANAP prépare et suit le budget de la DSI, OPEX et CAPEX, classé comme le contrôle de gestion le demande. Le fichier budgétaire en sort les montants vers un ERP ou un outil de BI.

## Par où commencer

1. Listez avec le contrôle de gestion les questions auxquelles le budget doit répondre.
2. Réglez les comptes par nature, puis les dimensions : lesquelles pour le CAPEX, lesquelles pour les deux, lesquelles obligatoires.
3. Chargez le budget existant par le fichier budgétaire, OPEX et CAPEX dans le même fichier.
4. Gardez en favori les vues utiles des rapports et partagez leurs liens.

Les données d'exemple d'un essai, le groupe fictif Fromage & Co, contiennent un budget OPEX et CAPEX déjà classé sur ces dimensions : de quoi voir tout cela avant de charger le vôtre. KANAP s'installe aussi gratuitement sur vos propres serveurs ([voir l'offre](/fr/offer)).
