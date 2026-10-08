# Plaid

Plaid est l'assistant conversationnel intégré de KANAP. Il est connecté aux mêmes données que celles que vous manipulez déjà — applications, actifs, incidents, projets, demandes, tâches, contrats, documents de la base de connaissances et master data — afin que vous puissiez poser des questions en langage naturel au lieu de naviguer entre plusieurs écrans pour trouver une réponse.

Plaid ne remplace pas le reste de l'application. C'est un moyen plus rapide de synthétiser le contexte, de localiser des enregistrements, de rédiger du texte ou de préparer des modifications. Les opérations sensibles sont toujours présentées sous forme d'aperçus que vous devez approuver avant que quoi que ce soit ne soit écrit dans KANAP.

!!! note "Plaid ou les Agents IA"
    Plaid est l'assistant interactif que **vous** pilotez : vous demandez, il répond et vous approuvez une modification à la fois. Les **Agents IA** sont différents — ce sont des assistants autonomes qui surveillent votre centre de services et proposent ou traitent eux-mêmes le travail sur les tickets, dans les limites d'approbation que vous définissez. Voir [Agents IA — Vue d'ensemble](agents-overview.md).

## Où le trouver

- Espace de travail : **Plaid** (barre de navigation supérieure)
- Route : `/ai`
- Autorisation : `ai_chat:reader` permet d'ouvrir l'espace de chat et de démarrer des conversations
- Indicateur de fonctionnalité : nécessite que l'interface de chat soit activée sur votre instance. Si elle est désactivée, l'espace de travail affiche un avis à la place de l'interface de chat.

L'espace de travail est également accessible aux administrateurs disposant de `ai_chat:admin`, qui peuvent voir et modérer tout ce que font les utilisateurs standard.

!!! note "En attente d'un administrateur"
    Sur le service hébergé, Plaid peut s'exécuter sur le modèle inclus KANAP. Avant cela, un administrateur confirme le fournisseur et le lieu où il traite les données. Jusque-là, l'espace de travail affiche *Un administrateur doit confirmer le fournisseur d'IA dans Administration > Plaid.* à la place du chat. Un administrateur le fait sur la page [Paramètres Plaid](ai-settings.md#confirmer-le-modele-inclus-kanap). Les organisations qui utilisent un modèle propre ne voient jamais cet avis.

## Démarrer une conversation

Lorsque vous ouvrez Plaid pour la première fois, vous arrivez sur un écran d'accueil comportant :

- Une courte accroche (« Plaid est prêt ») et une description de ce que vous pouvez demander
- Une section **Pour démarrer** avec des exemples de requêtes sur lesquels cliquer pour les envoyer
- Le composeur en bas, prêt à recevoir votre premier message

Cliquez sur une suggestion pour l'envoyer directement ou — pour les requêtes contenant un espace réservé `@` — l'insérer dans le composeur afin de la compléter.

Saisissez un message et appuyez sur **Entrée** pour l'envoyer. **Maj+Entrée** insère un retour à la ligne. Le bouton d'envoi est désactivé lorsqu'il n'y a rien à envoyer et se transforme en bouton rouge **Arrêter** pendant que Plaid répond.

## La liste des conversations

La barre latérale de gauche répertorie vos conversations passées. Utilisez l'icône de menu en haut à gauche de la zone de chat pour la réduire ou la développer.

La liste contient :

- Un bouton **Nouvelle conversation** en haut
- Un champ de recherche qui apparaît dès que vous avez au moins une conversation
- Les conversations regroupées par date : **Aujourd'hui**, **Hier**, **7 derniers jours**, **Plus ancien**

Chaque ligne affiche le titre de la conversation (ou **Sans titre** si aucun n'a encore été défini). Survolez une ligne ou placez-y le focus pour faire apparaître :

- Une icône crayon — **Renommer** la conversation. Double-cliquez sur le titre pour faire de même.
- Une icône corbeille — **Archiver** la conversation. Les conversations archivées disparaissent de la liste. Si vous archivez la conversation actuellement ouverte, Plaid bascule vers un nouveau chat vide.

La recherche filtre la liste par titre au fur et à mesure de votre saisie. Le renommage et l'archivage sont enregistrés immédiatement.

## Rédiger un message

Le composeur est le point de contrôle principal de l'espace de travail. Il prend en charge :

- Le texte multiligne jusqu'à 10 lignes visibles avant défilement
- Les pièces jointes image inline (PNG, JPG, GIF, WEBP)
- Les mentions `@` d'enregistrements KANAP
- Un rappel de raccourci clavier (« Entrée pour envoyer · Maj+Entrée retour à la ligne »)

### Joindre des images

Vous pouvez ajouter des images de trois manières :

- Cliquez sur l'icône trombone et sélectionnez des fichiers sur votre ordinateur
- Glissez-déposez des fichiers image sur le composeur (une superposition indicative confirme la zone de dépôt)
- Collez une image directement depuis le presse-papiers

Chaque image en attente apparaît sous forme de miniature au-dessus du texte. Cliquez sur le petit **X** d'une miniature pour la retirer. Le nombre de pièces jointes par message est limité ; une fois cette limite atteinte, le trombone est désactivé jusqu'à ce que vous retiriez ou envoyiez les pièces jointes en cours.

Les images sont importées avec votre message afin que Plaid puisse les décrire, les comparer ou en extraire des détails.

### Mentionner des enregistrements avec `@`

La saisie de `@` ouvre le **sélecteur de mentions** au-dessus du composeur. Il vous permet de référencer n'importe quel enregistrement KANAP auquel vous avez accès, selon deux modes complémentaires :

- **Préfixe de type** : des codes courts qui correspondent à une seule famille d'entités. Exemples :
  - `@T-5` — la tâche portant la référence T-5
  - `@DOC` — les documents récents de la base de connaissances
  - `@APP backup` — les applications correspondant à « backup »
  - `@PRJ`, `@REQ`, `@INC`, `@AST`, `@CONN`, `@INT`, `@LOC`, `@CTR`, `@CPX`, `@COMP`, `@CONT`, `@DEPT`, `@SUP`, `@BP`
- **Texte libre** : tout le reste (`@payroll`, `@server-2`) lance une recherche multi-types classée par pertinence.

Utilisez les touches fléchées pour parcourir les suggestions, **Entrée** ou **Tab** pour confirmer, **Échap** pour fermer le sélecteur. Les résultats sont regroupés par type d'entité (Base de connaissances, Tâches, Projets, Applications, Actifs, Contrats, etc.) afin que vous sachiez d'un coup d'œil quel type d'enregistrement vous vous apprêtez à insérer.

Lorsque vous confirmez une suggestion, le composeur continue d'afficher un libellé lisible (`@DOC-152`, `@SAP S/4HANA`). À l'envoi du message, chaque mention est transformée en un véritable lien que Plaid peut suivre jusqu'à l'enregistrement source.

### Modifier ou régénérer un message

Survolez n'importe lequel de vos messages précédents pour accéder aux actions au niveau du message :

- **Copier** — copie le texte du message dans le presse-papiers
- **Modifier** — rouvre le message dans un éditeur inline ; l'enregistrement envoie la nouvelle version et supprime tout ce qui suivait (la conversation est relancée à partir de ce point)
- **Régénérer** (sur les réponses de l'assistant) — demande à Plaid de produire une autre réponse à la même requête

La modification est l'outil adapté lorsque vous constatez que votre question précédente manquait de clarté. La régénération est l'outil adapté lorsque la question était bonne mais pas la réponse.

## Comment Plaid répond

Plaid diffuse sa réponse caractère par caractère. Pendant la diffusion :

- Le composeur reste utilisable afin que vous puissiez préparer une relance
- Le bouton d'envoi affiche une icône rouge **Arrêter** — cliquer dessus annule la réponse en cours
- Un petit indicateur « Utilisation des outils… » apparaît lorsque Plaid effectue une recherche dans KANAP, récupère un document ou exécute un autre appel d'outil
- Le nombre et le type d'outils utilisés sont récapitulés sous la réponse une fois celle-ci terminée

Lorsque la diffusion se termine, le focus revient automatiquement sur le composeur afin que vous puissiez poursuivre la conversation sans avoir à utiliser la souris.

### Appels d'outils

Plaid utilise un petit ensemble d'outils internes pour répondre aux questions : `Search all`, `Search knowledge`, `Get document`, `Get entity context` et quelques autres. Chaque appel d'outil apparaît sous forme de ligne compacte sous le message (« a utilisé Search all · 8 résultats »). Vous n'avez généralement pas besoin de lire les détails de l'outil, mais ils sont là si vous voulez voir exactement sur quels enregistrements la réponse s'est appuyée.

## Artefacts et aperçus

Certaines réponses s'accompagnent de contenu supplémentaire qui ne trouve pas naturellement sa place dans le fil de discussion. KANAP les appelle des **artefacts**.

Cas courants :

- Un long bloc de texte ou de markdown que Plaid a préparé pour vous
- Une comparaison côte à côte **Avant / Après** d'un enregistrement que Plaid souhaite mettre à jour
- Un brouillon d'import ou un ensemble de modifications nécessitant votre validation

Les artefacts s'ouvrent dans un panneau latéral à droite de l'espace de travail. Le panneau peut être ouvert ou fermé en cliquant sur le bouton d'onglet **Artefacts** sur le bord droit de l'écran.

Le panneau s'ouvre automatiquement lorsque :

- Un long aperçu arrive pendant une réponse en cours de diffusion
- Un aperçu en attente nécessite votre décision (ceux-ci ouvrent toujours le panneau, car vous devez agir dessus)

Pour les aperçus de modification en attente, le panneau propose deux boutons :

- **Approuver** — confirme la modification et permet à Plaid de l'appliquer
- **Rejeter** — annule la modification. Plaid prend acte du rejet et poursuit la conversation.

Rien de ce qui modifie les données de KANAP n'est appliqué en silence. L'aperçu est le point de contrôle.

## Indicateurs d'utilisation

Au-dessus du composeur, deux petits indicateurs vous aident à garder à l'esprit les coûts et les limites :

- **Utilisation intégrée** : lorsque Plaid s'exécute sur le modèle inclus KANAP plutôt que sur l'un des modèles propres à votre organisation, cet indicateur montre combien de messages restent pour le mois en cours ainsi que la date de réinitialisation du quota. Un administrateur a confirmé ce modèle au préalable (voir [Paramètres Plaid](ai-settings.md#confirmer-le-modele-inclus-kanap)). Lorsque la limite est atteinte, le composeur est désactivé et un texte d'aide invite les administrateurs à basculer vers un modèle qui leur est propre ; voir [Modèles IA](ai-models.md).
- **Utilisation des tokens** : une fine barre avec des compteurs de tokens en entrée/sortie pour la conversation en cours, ainsi que la taille de la dernière requête. Les longues conversations deviennent plus coûteuses avec le temps ; la barre rend ce coût visible afin que vous puissiez décider quand démarrer un nouveau fil.

La barre d'utilisation des tokens n'apparaît qu'une fois que la conversation compte au moins un échange.

## Conseils

- **Utilisez les préfixes pour plus de précision** : `@T-`, `@DOC-`, `@PRJ-`, `@REQ-`, `@INC-` correspondent directement aux références natives de KANAP. C'est le moyen le plus rapide de diriger Plaid vers un enregistrement précis et ils résistent au copier-coller car ils sont identiques à ce que vous voyez ailleurs dans l'application.
- **Démarrez une nouvelle conversation par sujet** : garder des questions sans rapport dans des conversations distinctes réduit la fenêtre de contexte, accélère les réponses et allège la facture de tokens. La liste des conversations est regroupée par date, ce qui vous permet de les retrouver facilement.
- **Approuvez et rejetez en connaissance de cause** : les aperçus sont la seule barrière entre Plaid et vos données en production. Prenez la seconde nécessaire pour lire la comparaison avant de cliquer sur **Approuver**.
- **Arrêtez plutôt que d'attendre** : si Plaid s'engage sur une mauvaise voie en cours de diffusion, cliquez sur le bouton **Arrêter** plutôt que d'attendre la fin. Vous économiserez des tokens et votre message suivant pourra corriger le tir.
- **Déposez les images directement** : glisser une capture d'écran sur le composeur est plus rapide que le sélecteur de fichiers, et le collage depuis le presse-papiers fonctionne également. Utilisez cette méthode pour décrire un problème d'interface ou demander à Plaid de lire un graphique.
