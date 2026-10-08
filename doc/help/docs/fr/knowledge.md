# Base de connaissances

La base de connaissances est l'espace de travail documentaire de KANAP pour les politiques, procédures, notes techniques, documents de référence et toute documentation qui doit rester connectée au travail réel. Elle combine la rédaction libre avec des fonctionnalités de gouvernance telles que les modèles, la responsabilité, la revue, l'historique des versions et les relations avec les applications, actifs, projets, demandes et tâches.

Contrairement à un partage de fichiers, la base de connaissances n'est pas seulement un endroit où stocker des documents. Le choix de conception important est que chaque article peut être classé, relu, versionné, exporté et lié à des objets opérationnels à travers la plateforme. Cela rend l'article plus facile à trouver et lui donne du contexte lorsque les gens l'ouvrent depuis un autre espace de travail.

## Où la trouver

- Espace de travail : **Base de connaissances**
- Autorisations :
  - `knowledge:reader` vous permet d'ouvrir et de lire des documents
  - `knowledge:member` vous permet de créer, modifier, commenter, organiser des dossiers et gérer les métadonnées des documents
  - `knowledge:admin` ajoute l'administration des bibliothèques et les déplacements entre bibliothèques

Si vous pouvez lire un document mais ne pouvez pas le modifier, l'espace de travail reste disponible en mode lecture seule.

## Comment la base de connaissances est organisée

La base de connaissances est construite autour de quatre couches d'organisation : bibliothèques, dossiers, types de documents et relations.

### Bibliothèques

Les bibliothèques sont les conteneurs de plus haut niveau. Elles séparent les populations de documents qui doivent être gérées différemment.

Schémas typiques :
- Utilisez une bibliothèque standard pour la base de connaissances opérationnelle de votre équipe.
- Utilisez la bibliothèque **Modèles** pour les amorces de documents réutilisables.
- Utilisez la bibliothèque **Documents managés** pour les documents qui proviennent d'un autre espace de travail et restent en partie contrôlés depuis là.

Conséquences du choix de bibliothèque :
- La bibliothèque active détermine quelle arborescence de dossiers vous voyez et où les nouveaux documents vierges sont créés.
- Dans une bibliothèque normale, les documents se comportent comme des articles de connaissances standard.
- Dans **Modèles**, les documents publiés deviennent des points de départ réutilisables pour de nouveaux articles et sont regroupés par type de document dans le sélecteur de modèles.
- Dans **Documents managés**, les articles peuvent rester lisibles et modifiables, mais certaines métadonnées sont contrôlées par l'espace de travail source plutôt que depuis la base de connaissances elle-même.

L'administration des bibliothèques est intentionnellement plus stricte que l'édition des documents. La création, le renommage, la suppression ou la réorganisation des bibliothèques est une responsabilité d'administrateur car ces changements affectent la navigation et la responsabilité pour tout le monde.

### Bibliothèques restreintes

Par défaut, chaque bibliothèque est ouverte à toute personne disposant de l'autorisation `knowledge`. Un administrateur de bibliothèque peut basculer une bibliothèque en accès **Restreint** depuis la boîte de dialogue des paramètres de la bibliothèque. Les bibliothèques restreintes sont marquées d'une petite icône cadenas sur l'onglet de la bibliothèque.

Dans une bibliothèque restreinte :

- Seuls le responsable de la bibliothèque, les personnes listées comme **Lecteurs** et les personnes listées comme **Rédacteurs** peuvent voir la bibliothèque et ses documents.
- Les Lecteurs peuvent ouvrir et lire les articles dans la bibliothèque mais ne peuvent pas les modifier.
- Les Rédacteurs peuvent lire et modifier les articles. Les Rédacteurs ont également besoin de l'autorisation standard `knowledge:member` pour réellement créer ou modifier des documents.
- Le responsable peut toujours lire et gérer la bibliothèque.
- Repasser de **Restreint** à **Standard** efface les listes de lecteurs et rédacteurs. La boîte de dialogue demande confirmation avant de supprimer l'appartenance.

Utilisez les bibliothèques restreintes pour le contenu sensible (procédures de sécurité, documents RH, matériel exécutif) où vous voulez un contrôle d'accès fin au sein de la base de connaissances plutôt que de vous appuyer uniquement sur les rôles globaux.

Les bibliothèques restreintes limitent également ce qu'un agent IA peut consulter. Lorsqu'un administrateur restreint un agent à un ensemble de bibliothèques choisi dans ses paramètres **Sources de connaissances et web**, ce choix est combiné avec les bibliothèques que l'administrateur configurant peut déjà consulter -- un agent ne voit jamais plus que la personne qui l'a configuré. Une bibliothèque restreinte à laquelle l'administrateur n'a pas accès reste également invisible pour l'agent.

### Dossiers

Les dossiers organisent les documents au sein d'une bibliothèque. Ils ne sont pas cosmétiques : ils façonnent la manière dont les utilisateurs parcourent la bibliothèque et comment les équipes maintiennent une structure partagée dans le temps.

Comportement important :
- Les dossiers existent à l'intérieur d'une bibliothèque. Ils ne sont pas partagés entre bibliothèques.
- Dans une vue de bibliothèque unique, les documents peuvent être glissés-déposés dans des dossiers pour une réorganisation rapide.
- Les dossiers peuvent être imbriqués pour créer une structure de navigation.
- Supprimer un dossier ne supprime pas ses documents. Les documents reviennent à **Non classés** à la place.
- Un dossier avec des sous-dossiers ne peut pas être supprimé tant que la hiérarchie n'est pas nettoyée.

Utilisez les dossiers pour des thématiques stables, pas pour des états de workflow temporaires. Le statut et le workflow existent déjà pour cela.

### Filtres de périmètre

Le filtre de périmètre de premier niveau change quels documents sont listés :

- **Mes docs** se concentre sur les documents dont vous êtes responsable.
- **Docs de mon équipe** se concentre sur les documents dont votre équipe est responsable.
- **Tous les docs** supprime le périmètre de responsabilité et affiche la population complète que vous êtes autorisé à voir.

Si vous n'êtes pas assigné à une équipe, le périmètre équipe est indisponible. La page s'ouvre sur **Tous les docs**, et votre dernier choix de périmètre est mémorisé, ce qui est pratique lorsqu'il correspond à votre mode de travail normal et légèrement déroutant lorsque vous oubliez l'avoir changé hier.

### Modèles et types de documents

Les modèles sont des documents de connaissances ordinaires stockés dans la bibliothèque **Modèles** et publiés pour réutilisation. Créer un document à partir d'un modèle copie le contenu du modèle dans un nouvel article et préserve la référence au modèle.

Les types de documents sont importants car ils :
- classent l'article pour le filtrage et le reporting
- regroupent les modèles dans le sélecteur de création
- aident les lecteurs à comprendre quel type de document ils ouvrent

Un comportement subtil mais important : si un document a été créé à partir d'un modèle et que vous changez ensuite son type de document pour un type différent, le lien vers le modèle est effacé. Cela empêche l'article de prétendre suivre encore un modèle qu'il ne respecte plus.

Lors de la navigation dans la bibliothèque **Modèles**, les administrateurs peuvent ouvrir le panneau **Gérer les types** pour créer, renommer, désactiver ou réorganiser les types de documents.

### Documents managés

Certains articles de la base de connaissances sont créés depuis des Demandes, Projets, Applications, Actifs, Tâches ou Incidents. Ils apparaissent comme des documents **Intégrés**, regroupés dans la bibliothèque **Documents managés** par espace de travail d'origine.

Les documents managés conservent l'expérience d'écriture au sein de la base de connaissances, mais l'espace de travail source continue de contrôler une partie de leurs métadonnées. En pratique, cela signifie que :
- le statut peut être contrôlé par l'objet source
- l'emplacement du dossier peut être fixé par l'espace de travail source
- le type de document ou modèle peut être fixé
- les relations directes peuvent être en lecture seule dans la base de connaissances
- le workflow de revue de la base de connaissances n'est pas disponible pour ces documents
- les documents managés ne peuvent pas être déplacés hors de la base de connaissances ni supprimés depuis la liste de la base de connaissances

Cela protège le lien entre le document et l'enregistrement opérationnel qui le possède.

L'accès suit lui aussi l'objet source. Le cas le plus net est le dossier **Incidents** : une revue d'incident ne peut être ouverte que par une personne autorisée à voir cet incident, quelles que soient ses autorisations sur la base de connaissances ; elle passe en lecture seule dès que l'incident est clôturé ou annulé ; et elle disparaît des listes, de la recherche, des exports et de l'assistant pour toute personne écartée d'un incident restreint. Voir [Incidents](incidents.md).

## Travailler avec la liste de la base de connaissances

La page principale de la base de connaissances est un registre de documents avec des outils de navigation et d'organisation autour.

### Ce que la liste affiche

La grille par défaut se concentre sur l'identité et la gouvernance des documents :

- **Réf** : la référence permanente `DOC-{numéro}`
- **Titre**
- **Statut**
- **Type**
- **Version**
- **Responsable**
- **Dossier**
- **Mis à jour**

**Colonnes supplémentaires** (masquées par défaut, disponibles via le sélecteur de colonnes) :
- **Modèle** : affiche le modèle à partir duquel le document a été créé, le cas échéant
- **Bibliothèque** : apparaît automatiquement lorsque **Toutes les bibliothèques** est activé, et peut être affichée manuellement sinon

### Recherche, filtres et navigation

La base de connaissances prend en charge deux styles de navigation :

- Parcourir une bibliothèque avec son arborescence de dossiers lorsque vous connaissez déjà la thématique.
- Rechercher dans toutes les bibliothèques lorsque vous vous souciez plus de l'article que de son emplacement de stockage.

Le commutateur **Toutes les bibliothèques** change l'expérience de manière significative :
- l'arborescence de dossiers n'est plus le moteur principal
- la recherche devient plus large
- la liste peut comparer le contenu entre bibliothèques
- la colonne Bibliothèque devient partie intégrante du contexte du résultat

La navigation par bibliothèque unique est meilleure pour la curation. La recherche multi-bibliothèques est meilleure pour la récupération.

**Filtrage** :
- Barre de recherche rapide en haut de la grille
- Filtres de colonne sur **Statut**, **Type**, **Responsable**, **Dossier**, **Modèle** et **Bibliothèque** utilisant des sélecteurs par jeu de cases à cocher

### Déplacer des documents et des dossiers

Dans une vue de bibliothèque unique, les documents peuvent être glissés-déposés dans des dossiers. Une poignée de glissement apparaît sur chaque ligne lorsque le glissement est disponible. C'est le moyen le plus rapide de ranger une bibliothèque sans ouvrir chaque article.

Les déplacements entre bibliothèques sont plus contrôlés :
- ils nécessitent une autorisation supérieure (`knowledge:admin`)
- ils ne sont pas disponibles pour les documents managés
- les documents modèles sont intentionnellement restreints car les modèles doivent rester dans le système de modèles, pas s'égarer dans la nature
- ils ne fonctionneront pas vers ou depuis une bibliothèque restreinte si le rédacteur n'a pas accès

Les dossiers peuvent également être glissés entre bibliothèques en les déposant sur l'onglet de la bibliothèque cible. Une boîte de dialogue de confirmation s'ouvre pour vous permettre de choisir un dossier de destination avant l'exécution du déplacement.

Les déplacements de dossiers suivent la même idée que les déplacements de documents. Réorganiser un dossier change la structure de navigation pour tous ceux qui utilisent cette bibliothèque, alors traitez cela comme un changement d'architecture de l'information, pas comme un simple rangement personnel.

### Actions de la liste

- **Nouveau** (bouton à options) : crée un document vierge dans la bibliothèque active, ou ouvre le sélecteur de modèles pour créer à partir d'un modèle publié
- **Déplacer** : déplace les documents sélectionnés vers un autre dossier ou bibliothèque
- **Supprimer** : supprime définitivement les documents sélectionnés (admin uniquement ; indisponible pour les documents managés)
- **Gérer les types** : visible uniquement à l'intérieur de la bibliothèque **Modèles** pour les administrateurs ; ouvre l'éditeur de types de documents

## Créer et façonner un document

Les nouveaux articles peuvent démarrer de deux manières :

- **Document vierge** : idéal lorsque vous connaissez déjà la structure dont vous avez besoin
- **À partir d'un modèle** : idéal lorsque l'équipe veut des sections, un langage ou des attentes de revue cohérents

Lorsque vous créez à partir d'un modèle, le contenu du modèle est copié dans le nouveau document. À partir de ce moment, le nouvel article est indépendant. Mettre à jour le modèle plus tard ne réécrit pas les documents existants.

L'espace de travail document garde l'écriture au centre et la gouvernance dans la barre latérale.

Les propriétés principales incluent :
- **Titre** : le libellé principal que les lecteurs rechercheront et citeront
- **Statut** : le cycle de vie de l'article
- **Dossier** : où l'article vit dans sa bibliothèque
- **Type** : quel type de document c'est
- **Basé sur le modèle** : la lignée de modèle, lorsque pertinente
- **Résumé** : une courte description pour le contexte

Après le premier enregistrement, le modèle complet de gouvernance du document devient disponible. C'est à ce moment que vous pouvez gérer les contributeurs, classifications, relations, commentaires et historique des versions par rapport à une référence de document stable.

### Statut et ce qu'il signifie

Le statut n'est pas décoratif. Il indique aux lecteurs avec quel sérieux ils doivent traiter l'article.

| Statut | Signification | Conséquence pratique |
|--------|---------------|----------------------|
| **Brouillon** | Travail en cours | Convient à la rédaction et à l'itération interne |
| **En revue** | Sous revue formelle | L'édition est bloquée pendant que le workflow est actif |
| **Publié** | Approuvé pour usage normal | Meilleur choix pour le contenu sur lequel les gens doivent s'appuyer |
| **Archivé** | Conservé pour archive | Souvent encore utile pour l'historique, pas pour les recommandations actives |
| **Obsolète** | Remplacé ou plus valide | Les lecteurs ne devraient pas le suivre comme pratique actuelle |

La base de connaissances permet la publication directe même sans workflow de revue formel. C'est utile pour le matériel à faible risque, mais cela signifie aussi que les équipes ont besoin de discipline sur le moment où la revue est optionnelle et celui où elle devrait être attendue.

## Écriture, verrous et sauvegarde automatique

La base de connaissances utilise un verrou d'édition pour qu'une seule personne édite activement un document à la fois.

Comment ça fonctionne :
- entrer en mode édition acquiert le verrou
- les autres utilisateurs peuvent toujours ouvrir et lire l'article
- ils ne peuvent pas modifier pendant que le verrou est détenu par quelqu'un d'autre
- si le verrou expire ou est perdu, le mode édition s'arrête et doit être ré-entré

Cela évite les écrasements silencieux, ce qui est excellent pour l'intégrité du document et moins excellent si deux personnes pensent toutes les deux avoir « juste un petit ajustement à faire ».

Pendant que vous éditez :
- les modifications sont enregistrées manuellement avec **Enregistrer**
- le contenu non sauvegardé est aussi sauvegardé automatiquement périodiquement pendant que votre verrou est actif
- **Annuler** revient au dernier état enregistré

L'espace de travail prend également en charge le téléversement d'images en ligne dans la zone de contenu markdown, afin que les captures d'écran et diagrammes puissent vivre avec l'article plutôt que dans un dossier mystérieux sur le bureau de quelqu'un. Lorsque vous collez ou référencez une image depuis une URL externe, l'image est automatiquement importée et stockée dans le document afin qu'elle reste disponible même si l'URL d'origine devient hors ligne.

## Importer un document Word

Vous pouvez importer un document Word (`.docx`) dans un article de connaissances existant. Le bouton **Importer** apparaît dans la barre d'outils de l'espace de travail une fois que le document a été enregistré au moins une fois et que vous êtes en mode édition.

Comment ça fonctionne :

- Cliquez sur **Importer** et sélectionnez un fichier `.docx` depuis votre ordinateur.
- Si l'article a déjà du contenu, une boîte de dialogue de confirmation demande si vous souhaitez le remplacer. Choisir **Continuer** écrase le markdown actuel avec le contenu importé.
- Le contenu Word est converti en markdown et chargé dans l'éditeur. Les images intégrées dans le fichier Word sont extraites et stockées comme pièces jointes en ligne, vous n'avez donc pas à les téléverser à nouveau manuellement.
- Après l'import, vos modifications sont non sauvegardées. Utilisez **Enregistrer** pour persister le contenu importé.

Si l'import rencontre un conflit de verrou (quelqu'un d'autre a acquis le verrou) ou un verrou expiré, le mode édition se termine et un message approprié est affiché. Ré-entrez en mode édition et réessayez.

Les avertissements d'import -- par exemple, un formatage non pris en charge qui a été simplifié pendant la conversion -- apparaissent brièvement comme une notification en bas de l'écran.

Utilisez la fonctionnalité d'import lors de la migration de documents Word existants vers la base de connaissances. C'est plus rapide et plus sûr que copier-coller, et cela préserve automatiquement les images intégrées.

## Formats d'export

Les articles de la base de connaissances peuvent être exportés au format :

- **PDF**
- **DOCX**
- **ODT**

L'export est disponible lorsque l'article a du contenu. C'est utile lorsque :
- un document doit circuler en dehors de KANAP
- un relecteur préfère le balisage au format Word
- un instantané PDF stable est nécessaire pour le partage ou l'archivage

L'export ne remplace pas l'article en direct. La version dans la base de connaissances reste la source gouvernée, tandis que les fichiers exportés sont des formats de distribution.

## Générer des documents depuis le chat

Si l'Assistant IA est activé dans votre KANAP, vous pouvez lui demander de rédiger un article de connaissances pour vous depuis le chat. L'assistant prépare un aperçu que vous examinez avant que quoi que ce soit ne soit enregistré. Confirmer l'aperçu crée un véritable document de connaissances avec le contenu, le type, la lignée de modèle et toutes les relations que vous avez spécifiées -- exactement comme si vous l'aviez écrit vous-même.

Les documents générés suivent les mêmes règles de gouvernance que ceux écrits à la main : responsabilité, statut, historique des versions, verrous et workflow de revue s'appliquent tous.

## Contributeurs et workflow de revue

Chaque document peut avoir un modèle de contributeur structuré :

- **Responsable** : la personne redevable pour l'article
- **Auteurs** : les personnes qui aident à maintenir le contenu
- **Relecteurs** : relecteurs de l'étape 1
- **Approbateurs** : approbateurs de l'étape 2

Le responsable est important opérationnellement. Le filtrage par périmètre est basé sur la responsabilité, et un document sans responsable clair a beaucoup plus de chances de devenir « du matériel de fond important » que personne ne met à jour.

### Workflow de revue

Le workflow de revue est optionnel mais délibéré :

- les relecteurs travaillent en premier
- les approbateurs agissent après que l'étape de revue est terminée
- les approbateurs et relecteurs peuvent enregistrer des notes de décision
- demander des modifications renvoie le document pour révision
- le workflow conserve la trace de la dernière révision approuvée

Conséquences importantes :
- vous ne pouvez pas demander de revue tant qu'il y a des modifications non sauvegardées
- vous avez besoin de relecteurs ou approbateurs assignés avant qu'une revue puisse être demandée
- les documents archivés et obsolètes ne sont pas candidats à une nouvelle demande de revue
- les documents managés (intégrés) n'utilisent pas le workflow de revue de la base de connaissances
- une fois que la revue commence, l'édition normale est désactivée jusqu'à ce que la revue soit approuvée, que des modifications soient demandées, ou que la revue soit annulée

Cela rend la revue significative. Si les auteurs pouvaient continuer à modifier le contenu pendant l'approbation, le document approuvé serait une cible mouvante, ce qui est une excellente façon de créer des disputes et une mauvaise façon de créer de la documentation.

## La barre latérale de l'espace de travail document

La barre latérale comporte deux onglets : **Propriétés** et **Commentaires**.

### Onglet Propriétés

L'onglet Propriétés organise les données de gouvernance en sections rétractables :

- **Statut, Dossier, Type, Modèle et Résumé** sont toujours visibles en haut.
- **Contributeurs** : assigner responsable, auteurs, relecteurs et approbateurs. Chaque rôle est enregistré indépendamment de l'enregistrement principal du document.
- **Workflow de revue** : affiche l'état actuel du workflow lorsqu'une revue est active, incluant la progression d'étape, les décisions des participants et l'activité récente du workflow. Lorsqu'aucun workflow n'est actif, vous pouvez demander une revue depuis ici.
- **Classification** : taguer le document avec des catégories et flux de votre schéma de classification organisationnel. Plusieurs lignes de classification peuvent être ajoutées.
- **Relations** : lier le document aux applications, actifs, projets, demandes ou tâches. Chaque type de relation a son propre champ recherche-et-sélection.
- **Versions** : liste les révisions enregistrées avec horodatages. **Restaurer** est disponible uniquement pendant que vous détenez un verrou d'édition actif.

### Onglet Commentaires

L'onglet Commentaires affiche l'activité autour du document : commentaires, événements de workflow et historique des modifications. Utilisez les commentaires pour le contexte de revue, la clarification éditoriale ou la justification de changement qui devrait rester attachée à l'article.

## Relations et contexte multi-espaces de travail

Les documents de la base de connaissances peuvent être directement liés à :

- Applications
- Actifs
- Projets
- Demandes
- Tâches

Les relations ne sont pas seulement des étiquettes. Elles contrôlent où le document apparaît ailleurs dans KANAP et comment les utilisateurs le découvrent depuis les espaces de travail opérationnels.

Conséquences de l'ajout de relations :
- le document devient plus facile à trouver depuis l'objet lié
- les lecteurs ouvrant l'objet obtiennent une documentation contextuelle sans avoir à chercher manuellement
- le reporting et la gouvernance autour de l'objet deviennent plus complets

Conséquences de mauvaises relations :
- les documents utiles restent invisibles en dehors de la base de connaissances
- les utilisateurs créent des doublons parce qu'ils ne trouvent pas l'article existant
- le même sujet commence à dériver à travers plusieurs documents

Dans les espaces de travail liés, les panneaux de la base de connaissances distinguent entre :
- **Documents liés** : directement attachés à l'objet
- **Documents associés** : remontés via le contexte et la provenance du travail connecté

Cette distinction est importante. Les liens directs expriment une relation intentionnelle. Les documents associés expriment un contexte utile, mais pas le même niveau de responsabilité.

## Bonnes habitudes opérationnelles

- Utilisez les bibliothèques pour les frontières de gouvernance, les dossiers pour la navigation, et les relations pour le contexte métier.
- Gardez la responsabilité à jour. Un bon article avec le mauvais responsable vit généralement sur du temps emprunté.
- Utilisez les modèles lorsque la cohérence est importante entre équipes.
- Utilisez la revue pour les documents qui guident des décisions, des contrôles ou des processus reproductibles.
- Marquez le contenu obsolète comme archivé ou obsolète au lieu de laisser les lecteurs deviner.
- Importez les documents Word lors de la migration de contenu existant vers la base de connaissances plutôt que de copier-coller, afin que les images intégrées soient préservées automatiquement.
- Utilisez les bibliothèques restreintes lorsque l'accès importe au niveau de la bibliothèque -- ne vous appuyez pas sur la disposition des dossiers pour cacher du contenu sensible.
