# Données d'exemple

Utilisez la page Données d'exemple pour découvrir KANAP avec un jeu de données prêt à l'emploi. Elle remplit un espace de travail vide avec Fromage & Co, une fromagerie fictive, afin de voir fonctionner ensemble les budgets, les applications, les contrats et les projets avant de saisir les vôtres. Quand vous avez fini d'explorer, une seule action efface tout et remet l'espace de travail dans son état initial.

## Où la trouver

- Espace de travail : **Administration** › **Données d'exemple**
- Route : `/admin/sample-data`
- Qui peut l'utiliser : les utilisateurs ayant le rôle **Administrateur**. Un niveau d'autorisation de module, même `admin`, ne donne pas accès à la page.
- Disponible uniquement dans les espaces de travail cloud. Les installations sur vos propres serveurs n'ont pas cette page.

La page n'est pas disponible sur l'hôte de la plateforme. Elle agit toujours sur l'espace de travail dans lequel vous êtes connecté.

## Contenu du jeu d'exemple

Le jeu décrit Fromage & Co, une fromagerie fictive :

- **4 sociétés** en France, aux Pays-Bas, en Italie et aux États-Unis
- **18 utilisateurs fictifs**, qui ne peuvent pas se connecter et ne reçoivent aucun e-mail
- **Des applications et leur cartographie** : instances, interfaces et connexions
- **Des contrats, le budget de l'année en cours, des projets et des tâches**

Les dates suivent l'année en cours, si bien que le budget paraît toujours à jour. Le chargement prend moins d'une minute.

Les utilisateurs fictifs n'ont ni mot de passe ni accès. Ils servent à donner un aspect réaliste aux responsables, aux personnes assignées et aux équipes projet. KANAP ne leur envoie aucun e-mail, et l'effacement les supprime.

## Charger les données d'exemple

Les données d'exemple se chargent uniquement dans un espace de travail vide. Un espace de travail est considéré comme vide quand il ne contient rien de ce qui suit :

- des données métier comme des applications, des actifs, des contrats, des lignes budgétaires, des projets, des demandes ou des tâches
- des données de référence au-delà de ce qu'un nouvel espace de travail contient au départ : sociétés supplémentaires, fournisseurs, contacts, départements, centres de coûts ou sites
- une configuration que vous avez ajoutée : un plan comptable à vous, des catégories analytiques, une classification du portefeuille, des calendriers de jours ouvrés supplémentaires, des intégrations ou des agents IA
- des documents en dehors de la bibliothèque de modèles

Ce qu'un nouvel espace de travail crée pour vous (sa première société, le plan comptable par défaut et le calendrier de son pays) n'entre pas en compte.

**Pour charger le jeu** :

1. Ouvrez **Administration** › **Données d'exemple**.
2. Cliquez sur **Charger les données d'exemple**.
3. Lisez le résumé dans la fenêtre et confirmez avec **Charger les données d'exemple**.

La page suit le chargement étape par étape (par exemple « Étape 4 sur 19 : plans comptables ») et le statut passe à **Chargées** à la fin. La bande de statut indique alors quand les données ont été chargées et par qui. Tout ce que vous voyez dans KANAP se rafraîchit avec les nouvelles données.

**Si un chargement n'est pas possible**, la page n'affiche pas le bouton **Charger les données d'exemple**. Une ligne en explique la raison :

- l'espace de travail contient déjà des données
- l'abonnement est gelé
- la période d'essai est terminée

Le bandeau de la page d'accueil reste alors masqué. L'effacement reste possible sur un espace de travail gelé (voir ci-dessous).

**Si le chargement échoue**, KANAP remet lui-même l'espace de travail dans son état initial. Le statut affiche **Échec du chargement** avec la date, et la page en donne la raison. Cliquez sur **Réessayer** pour lancer un nouveau chargement.

!!! warning "Attendez la fin du chargement"
    Pendant un chargement, tout ce qui est créé dans l'espace de travail est effacé si le chargement échoue. Attendez que le statut affiche **Chargées** avant de commencer un travail réel.

## Le bandeau de la page d'accueil

Tant que l'espace de travail est vide et que les données d'exemple n'ont jamais été chargées, les administrateurs voient une ligne en haut de la page d'accueil : « Découvrez KANAP avec des données d'exemple. »

- **Charger** ouvre la même fenêtre que la page.
- **Masquer** supprime la ligne définitivement, pour tous les administrateurs de l'espace de travail. La page sous **Administration** › **Données d'exemple** reste disponible.
- Pendant un chargement, la ligne indique l'étape en cours.
- Si un chargement échoue, la ligne en donne la raison et propose **Réessayer**.

La ligne disparaît dès que l'espace de travail contient des données. Elle ne revient pas après un effacement. Pour recharger le jeu, utilisez **Administration** › **Données d'exemple**.

## Tout effacer et repartir de zéro

Une fois les données d'exemple chargées, la page propose **Tout effacer et repartir de zéro**. Elle est aussi proposée après un chargement qui a échoué et n'a pas pu rétablir l'état initial. Elle fonctionne quand l'abonnement est gelé ou la période d'essai expirée.

**Cette action est irréversible.** Tout le contenu de l'espace de travail est effacé, qu'il vienne du jeu d'exemple ou de votre propre travail, et l'espace de travail revient à son état initial.

**Ce qui est effacé** :

- tous les enregistrements : applications, contrats, budget, projets, demandes, tâches, documents, données de référence, etc.
- les fichiers téléversés et les pièces jointes
- les utilisateurs d'exemple

**Ce qui est conservé** :

- les comptes utilisateurs réels et leurs rôles
- l'abonnement
- le nom, l'adresse et le logo de l'espace de travail
- la connexion Microsoft
- les réglages d'IA
- le journal d'audit

**Ce qui revient aux valeurs par défaut** : les réglages enregistrés sur l'espace de travail, à savoir les devises, les colonnes budgétaires et le catalogue de classification.

**Pour effacer** :

1. Cliquez sur **Tout effacer et repartir de zéro**.
2. La fenêtre liste ce qui est conservé. Si vous avez créé des éléments depuis le chargement des données d'exemple, elle en donne aussi le nombre (par exemple « 12 éléments créés depuis le chargement des données d'exemple seront aussi effacés »). Ces éléments sont effacés avec le reste.
3. Saisissez le nom de l'espace de travail, tel qu'il apparaît dans la fenêtre, dans le champ **Nom de l'espace de travail**. Les majuscules et les espaces autour du nom n'ont pas d'importance.
4. Cliquez sur **Tout effacer**. Le bouton reste désactivé tant que le nom ne correspond pas.

L'effacement prend quelques secondes. Le statut affiche **Effacement**, puis **Non chargées**. Pendant ces secondes, KANAP refuse les modifications de tous les utilisateurs de l'espace de travail, et une erreur invite à réessayer dans un instant. La lecture continue de fonctionner.

Si l'effacement échoue, la page affiche « Le contenu de l'espace de travail n'a pas pu être effacé. Rien n'a été modifié. » Rien n'est perdu, et vous pouvez réessayer.

Quand l'espace de travail est effacé, chaque administrateur reçoit un e-mail qui indique qui l'a effacé et quand. Le journal d'audit conserve une trace de l'opération.

Après l'effacement, l'espace de travail est comme neuf : vous pouvez recharger les données d'exemple depuis la page ou commencer à saisir vos propres données. Le bandeau de la page d'accueil ne revient pas.

## Conseils

- **Explorer, puis nettoyer** : chargez les données d'exemple pour découvrir le produit ou préparer une démonstration, puis effacez-les avant de saisir des données réelles. Mélanger les deux fait que l'effacement supprime aussi vos propres saisies.
- **Vérifier le nombre avant d'effacer** : le nombre d'éléments créés depuis le chargement indique si quelqu'un a commencé un travail réel dans l'espace de travail.
- **Une personne à la fois** : un seul chargement ou effacement peut s'exécuter sur un espace de travail. Si un autre administrateur en a lancé un, la page en montre la progression.
- **Les vrais utilisateurs sont protégés** : l'effacement conserve tous les comptes réels, personne ne perd donc l'accès à l'espace de travail.
