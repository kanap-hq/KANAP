---
title: "KANAP devient Kadratis"
description: "KANAP s'appelle désormais Kadratis™. Le logiciel, sa licence open source et l'offre d'hébergement et de support ne changent pas."
date: 2026-11-09
topic: release
author: Friedrich
authorRole: Fondateur, DSI
draft: false
translationKey: kanap-devient-kadratis
---

## Pourquoi un nouveau nom

On attend du sérieux et de la rigueur d'un outil de gouvernance ; or en français, on entend surtout « canap' », et si l'analogie peut faire sourire, elle peut aussi être contreproductive.

Il fallait aussi un nom que l'on puisse protéger. « Kanap » est déjà utilisé, dans l'ameublement ou ailleurs. Kadratis est un nom inventé, propre au produit, déposé comme marque. Pour un logiciel open source, la marque ne restreint pas le code : elle permet simplement de savoir quelle est la distribution officielle.

La [politique d'usage de la marque](https://github.com/kanap-hq/KANAP/blob/main/TRADEMARKS.md) dit ce que chacun peut en faire, c'est-à-dire presque tout : en parler, l'intégrer, l'héberger, vendre des services autour…

## Ce qui change pour vous

**Pour tous** : l'assistant IA s'appelle désormais Kad. C'est le même agent, avec ses réglages et vos conversations.

**Sur Kadratis Cloud** (le nouveau nom de l'offre hébergée) :

- votre espace répond désormais à `<votre-espace>.kadratis.com`. L'ancienne adresse en `kanap.net` continue de fonctionner, comme les liens déjà envoyés et les connexions MCP ;
- à votre première visite sur la nouvelle adresse, vous vous reconnectez une fois. Votre navigateur ne propose pas toujours de lui-même le mot de passe enregistré pour l'ancienne adresse : il suffit de le saisir. Avec la connexion Microsoft, un clic suffit, comme avant ;
- les mails de l'application portent le nouveau nom et partent toujours de la même adresse.

**Si vous hébergez Kadratis**, la mise à jour se fait comme d'habitude, sans étape supplémentaire. À partir de la [version], les images s'appellent `kadratis-*` au lieu de `kanap-*` ; le fichier `compose.onprem.yml` de la version les nomme déjà, et la procédure de mise à jour les télécharge. Les variables `KANAP_*`, les rôles de la base et les jetons MCP gardent leur nom. Les versions précédentes restent publiées sous leurs anciens noms.

**Le site et la documentation** passent sur [kadratis.com](https://kadratis.com) et [doc.kadratis.com](https://doc.kadratis.com). Les anciennes adresses redirigent page par page.

## Ce qui ne change pas

- **Le logiciel** : mêmes fonctions, mêmes données, même feuille de route.
- **La licence** : AGPL v3, le code reste public, l'auto-hébergement reste gratuit et sans fonction bridée.
- **L'éditeur** : la société KANAP, en France. Vos contrats, vos factures et le support restent à son nom.
- **L'hébergement** : Kadratis Cloud tourne sur les mêmes serveurs dédiés chez Hetzner, en Allemagne.
- **Le dépôt GitHub** : le même dépôt ; il changera de nom dans les prochaines semaines, et GitHub redirigera l'ancienne adresse.

Une question sur ce changement : écrivez à [contact@kadratis.com](mailto:contact@kadratis.com).
