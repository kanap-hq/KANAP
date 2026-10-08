# Projets du portefeuille

Les Projets du portefeuille sont les espaces de travail d'exécution pour les initiatives approuvées. C'est là que la livraison est planifiée, l'avancement est suivi, la charge est mesurée, les tâches sont coordonnées et les connaissances spécifiques au projet sont reliées au reste de KANAP.

Les projets proviennent généralement de demandes approuvées, mais ils peuvent également être créés directement comme projets **Fast-track** ou **Legacy** lorsque l'étape de demande ne fait pas partie du processus.

Pour le séquencement à l'échelle du portefeuille et le travail de roadmap, utilisez la [Planification du portefeuille](portfolio-planning.md). La zone Projets sert à exécuter le travail une fois qu'un projet existe.

## Où la trouver

- Espace de travail : **Portefeuille**
- Chemin : **Portefeuille > Projets**

## Autorisations

- `portfolio_projects:reader` : ouvrir la liste et consulter les espaces de travail des projets
- `portfolio_projects:contributor` : mettre à jour le document **Objectif** managé et maintenir les saisies de temps de gestion de projet
- `portfolio_projects:manager` : créer des projets et gérer les données du projet, statut, équipe, relations, planning, avancement, tâches, évaluation, commentaires et décisions
- `portfolio_projects:admin` : inclut les capacités du manager et peut également importer/exporter en CSV et maintenir les saisies de temps de gestion de projet d'autres utilisateurs
- La consultation des connaissances nécessite également un accès Connaissances
- Créer ou lier des connaissances autonomes nécessite également un rôle de création de connaissances

Si Projets n'apparaît pas dans la navigation, demandez l'accès à un administrateur.

## Travailler avec la liste

La liste des projets est conçue pour répondre rapidement à deux questions : « de quoi devrais-je me soucier ? » et « qu'est-ce qui bouge ? »

**Sélecteur de périmètre**

- **Mes projets** affiche les projets où vous êtes explicitement impliqué comme sponsor, responsable ou contributeur
- **Projets de mon équipe** étend cette vue aux projets impliquant des membres de votre équipe portefeuille
- **Tous les projets** supprime le filtre d'implication
- Si vous n'êtes pas assigné à une équipe portefeuille, le périmètre équipe est indisponible
- La liste s'ouvre sur **Tous les projets**. Votre préférence de périmètre est mémorisée, donc la liste revient comme vous l'avez laissée

**Colonnes par défaut**

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **#** | Numéro de référence (ex. : PRJ-42). Cliquez pour ouvrir l'espace de travail |
| **Nom du projet** | Le nom du projet |
| **Priorité** | Score de priorité calculé |
| **Statut** | État d'exécution actuel avec un point coloré |
| **Origine** | Demande, Fast-track ou Legacy |
| **Avancement** | Avancement d'exécution sous forme de barre |
| **Source** | Classification source du portefeuille |
| **Catégorie** | Catégorie du portefeuille |
| **Stream** | Stream du portefeuille |
| **Société** | Classification société |
| **Début** | Date de début planifiée |
| **Fin** | Date de fin planifiée |
| **Créé** | Date de création |

**Colonnes supplémentaires** (masquées par défaut) :

- **Dernière modification** : Quand le projet a été mis à jour pour la dernière fois

**Comportement par défaut**

- Les projets sont triés par score de priorité sauf si vous changez le tri
- Les projets au statut **Terminé** sont masqués par défaut
- La recherche fonctionne sur le contenu textuel
- Les filtres sur statut, origine, source, catégorie, stream et société sont disponibles directement dans la grille

**Administration en masse**

- **Nouveau projet** est disponible pour les managers
- **Import CSV** et **Export CSV** sont disponibles pour les administrateurs

Ouvrir un projet depuis la liste préserve le contexte de liste actuel. L'espace de travail du projet utilise le même contexte pour la navigation **Précédent** et **Suivant**, vous pouvez donc parcourir un ensemble filtré sans perdre votre place.

## Créer un projet

La création directe de projet est destinée au travail qui doit entrer en exécution sans enregistrement de demande séparé.

- Les nouveaux projets s'ouvrent uniquement sur **Synthèse**
- Tant que le projet n'est pas enregistré pour la première fois, les autres onglets sont indisponibles
- Les projets créés directement utilisent une origine de **Fast-track** ou **Legacy**
- Les projets d'origine demande conservent leur origine demande et le lien source

Utilisez **Fast-track** pour le travail qui est réellement introduit directement en livraison. Utilisez **Legacy** pour le travail qui existe déjà en dehors de l'historique d'intake normal. Cette distinction affecte le reporting et rend l'analyse de portefeuille ultérieure beaucoup moins déroutante.

## Modèle mental de l'espace de travail

L'espace de travail du projet a deux couches :

- La **zone de contenu principale** pour les onglets opérationnels : **Synthèse**, **Tâches**, **Planning**, **Avancement**, **Évaluation**, **Relations** et **Connaissances**
- Un tiroir **Propriétés** persistant sur le bord droit pour les propriétés principales, l'assignation d'équipe et les demandes sources

Ouvrez ou fermez le tiroir Propriétés à l'aide de l'onglet vertical sur le bord droit.

Pour les projets existants, le tiroir Propriétés se comporte comme un panneau de propriétés en direct : les modifications y sont enregistrées immédiatement. Le contenu de l'onglet principal suit le flux habituel **Enregistrer** / **Réinitialiser** lorsque cet onglet contient des modifications en brouillon. Si vous changez d'onglet ou passez au projet précédent ou suivant avec des modifications non enregistrées dans l'espace de travail, KANAP demande s'il faut enregistrer d'abord.

## En-tête et métadonnées

L'en-tête de l'espace de travail est une bande de contrôle, pas de la décoration.

- Une pastille de référence **PRJ-...** copiable
- Le titre du projet (cliquez pour modifier lorsque vous avez les droits manage)
- Une rangée de métadonnées compacte : **Statut**, **Score**, **Avancement**, **Responsable IT**, **Fin planifiée** et **Origine** (ou la référence de la demande source pour les projets d'origine demande)
- **Précédent** et **Suivant** parcourent l'ensemble de résultats de la liste actuelle, pas tous les projets du système
- **Envoyer le lien** envoie l'URL du projet courant par e-mail avec un message optionnel

Envoyer un lien n'accorde pas l'accès. Cela ne fait que partager l'emplacement. Les autorisations restent exactement comme elles étaient avant l'envoi de l'e-mail.

Changer le statut depuis la bande de métadonnées ouvre une boîte de dialogue de changement de statut afin que la transition puisse être enregistrée correctement. C'est là que vous pouvez consigner le changement comme une décision formelle, capturer le contexte et stocker la justification avec la transition au lieu de la laisser disparaître dans la mémoire de couloir.

Le workflow est intentionnellement contrôlé :

- **Liste d'attente** peut passer à **Planifié**, **En pause** ou **Annulé**
- **Planifié** peut passer à **En cours**, **En pause** ou **Annulé**
- **En cours** peut passer à **En test**, **Terminé**, **En pause** ou **Annulé**
- **En test** peut revenir à **En cours**, ou avancer à **Terminé**, **En pause** ou **Annulé**
- **En pause** peut revenir à **Liste d'attente**, **Planifié** ou **En cours**, ou être **Annulé**
- **Terminé** et **Annulé** sont des états terminaux

## Tiroir des propriétés

Traitez le tiroir Propriétés comme la carte d'identité persistante du projet. Il est regroupé en trois sections.

### Propriétés principales

- Nom du projet
- Statut
- Origine (uniquement pendant la création initiale ; verrouillée ensuite)
- Source, Catégorie, Stream
- Société, Département
- Début planifié, Fin planifiée

Ces champs pilotent le reporting, la planification, le filtrage et le contexte par défaut du portefeuille. Les choix de classification sont particulièrement importants car ils affectent où le projet apparaît dans l'analyse multi-portefeuille.

### Équipe

L'assignation d'équipe vit dans le tiroir afin de rester disponible pendant que vous travaillez sur le planning, la charge ou les tâches.

- **Sponsor métier** / **Sponsor IT** capturent la responsabilité exécutive
- **Responsable métier** / **Responsable IT** identifient le leadership au quotidien
- **Contributeurs métier** / **Contributeurs IT** définissent l'équipe de travail élargie

Ces assignations font plus que remplir des cases :

- elles déterminent ce qui apparaît dans **Mes projets** et **Projets de mon équipe**
- elles alimentent le contexte du projet dans la synthèse et le reporting
- elles définissent qui est disponible pour la ventilation des charges dans l'onglet **Avancement**

Si les responsables et contributeurs sont incorrects, votre planification de charge le sera aussi.

### Demandes sources

Une liste en lecture seule des enregistrements de demande qui ont produit le projet. Cliquez sur une entrée pour naviguer vers l'espace de travail de la demande source.

Pour les dépendances, projets liés et autres objets métier/techniques liés, voir l'onglet **Relations**.

## Synthèse

L'onglet **Synthèse** est le cockpit du projet. Il est destiné à répondre à l'état actuel du projet en un seul coup d'œil, pas à dupliquer chaque champ du tiroir.

### Objectif

La section **Objectif** est un document projet managé, pas un champ de note jetable.

- utilisez-le pour le brief narratif du projet : intention, résultat attendu, frontières du périmètre, et tout cadrage qui doit voyager avec le projet
- les modifications de l'Objectif suivent le flux **Enregistrer** / **Réinitialiser** de l'espace de travail
- les contributeurs peuvent mettre à jour l'Objectif même lorsqu'ils ne peuvent pas gérer le reste du projet

Cette séparation est délibérée. Elle permet à la responsabilité narrative d'être plus large que l'administration structurelle du projet.

L'éditeur d'Objectif inclut l'import et l'export de documents :

- **Importer** accepte un fichier `.docx` et le convertit au format markdown interne. Si l'Objectif a déjà du contenu, KANAP demande confirmation avant de le remplacer.
- **Exporter** vous permet de télécharger l'Objectif courant en PDF, DOCX ou ODT.

Ces outils sont utiles lorsqu'un brief de projet provient de Word ou que les parties prenantes ont besoin d'une copie formatée en dehors de KANAP.

Le document Objectif managé est différent de l'onglet **Connaissances** :

- **Objectif** est le brief intégré, possédé par le projet
- **Connaissances** sert pour les documents autonomes qui peuvent avoir besoin de leur propre cycle de vie, réutilisation ou relations

### Activité

Sous Objectif, l'onglet Synthèse inclut le flux d'activité du projet :

- **Commentaires** pour la discussion, les notes contextuelles et les décisions formelles
- **Historique** pour le journal d'audit des changements de champs et de statut

**Historique** liste les changements enregistrés — changements de statut, modifications de champs, changements d'équipe et de relations, modifications du document Objectif — et se termine par l'entrée de création : qui a créé le projet et quand.

Les managers peuvent ajouter et modifier les commentaires de projet. Les commentaires peuvent également être enregistrés comme décisions formelles, avec un résultat et un changement de statut optionnel. Utilisez cela lorsque la discussion elle-même change le cours du projet.

Des images peuvent être incluses dans les commentaires d'activité lorsque l'évidence visuelle est utile -- esquisses d'architecture, captures d'écran ou preuves de revue.

Utilisez **Historique** quand vous avez besoin de savoir ce qui a changé. Utilisez **Commentaires** quand vous avez besoin de savoir pourquoi.

## Tâches

L'onglet **Tâches** est la file d'exécution du projet. Le badge de l'onglet affiche le nombre de tâches du projet.

- les tâches créées ici sont liées automatiquement au projet
- les tâches peuvent également être créées depuis une phase du planning, ce qui les lie à la fois au projet et à la phase sélectionnée
- l'onglet prend en charge le filtrage par statut et par phase
- la vue par défaut des tâches se concentre sur le travail actif en masquant les éléments terminés et annulés

Cet onglet sert à gérer les tâches liées au projet en contexte, pas à remplacer l'espace de travail complet des tâches. Ouvrir une tâche vous emmène vers son propre espace de travail, où le détail spécifique à la tâche et l'enregistrement du temps continuent.

D'un point de vue projet, la conséquence importante est celle-ci : le statut des tâches et le temps des tâches ne sont pas isolés. Ils alimentent en retour Synthèse et Avancement, donc des tâches négligées rendent l'image globale du projet moins fiable.

## Planning

L'onglet **Planning** est l'endroit où la structure de livraison devient explicite.

### Dates du projet

Le bas de l'onglet affiche trois lignes :

- **Réel** : dates capturées par les événements d'exécution (quand le projet est passé à En cours et quand il a atteint Terminé). Lecture seule dans l'espace de travail.
- **Planifié** : la fenêtre de livraison prévue. Modifiez-les dans le tiroir Propriétés.
- **Référence** : un instantané des dates planifiées capturé lorsque le projet est passé à **En cours**. La variance par rapport à la référence est affichée comme `Nj de retard` ou `Nj d'avance`.

### Phases

Les projets peuvent démarrer avec un modèle de phases ou un plan de phases entièrement personnalisé.

- si aucune phase n'existe encore, choisissez un modèle et cliquez sur **Appliquer le modèle** pour créer la structure initiale
- une fois les phases créées, elles peuvent être réordonnées (faites glisser la poignée), renommées, datées et leur statut géré
- chaque ligne de phase inclut une case à cocher de jalon ; la cocher crée un jalon de complétion de phase pour cette phase
- chaque phase a un raccourci pour créer une tâche déjà liée à cette phase et au projet
- **Ajouter une phase** ajoute une nouvelle phase vide
- **Remplacer par un modèle** reconstruit la structure de phases à partir d'un modèle -- utilisez-le seulement quand vous voulez vraiment dire « repartir de zéro sur le modèle de phases »

Le modèle de phases affecte plus que le planning :

- la phase active réapparaît dans Synthèse et la barre de métadonnées
- les tâches liées à une phase héritent immédiatement du contexte de livraison
- les jalons de phase fournissent des marqueurs de complétion sans créer un schéma de suivi séparé

### Jalons

Les jalons autonomes vivent dans leur propre section sous les phases. Utilisez **+ Ajouter un jalon** pour les créer. Chaque jalon a un nom, une date cible, un statut et (lorsque déclenché depuis une phase) un lien vers la phase qu'il représente.

Les jalons de complétion de phase suivent la phase à laquelle ils sont attachés. Les jalons autonomes servent pour les points de contrôle qui doivent exister en dehors de la structure des phases.

### Vues Tableau et Gantt

Au-dessus de la liste des phases, basculez entre les vues **Tableau** et **Gantt** :

- utilisez la vue **Tableau** quand vous façonnez la structure
- utilisez la vue **Gantt** quand vous avez besoin de voir le chevauchement, le séquencement et l'étalement des dates

Seules les phases avec des dates de début et fin utilisables apparaissent de manière significative sur le Gantt. Si les dates sont vagues, le diagramme sera tout aussi vague. En vue Gantt, vous pouvez faire glisser les barres de phase pour ajuster les dates de début/fin (avec l'autorisation manage).

## Avancement

L'onglet **Avancement** combine l'avancement d'exécution, la planification de la charge et la consommation réelle de temps. Cette combinaison est importante car un projet qui rapporte 80 % d'avancement avec 20 % de la charge consommée n'est pas nécessairement efficace ; il peut simplement être mal estimé.

### Avancement et charge

- **Avancement d'exécution** est le signal global de complétion du projet
- **Consommation de charge** compare la charge réelle avec la charge planifiée

Gardez ces deux nombres alignés avec la réalité. Si l'avancement progresse sans charge correspondante, ou si la charge s'accumule sans mouvement de livraison, le décalage vous dit généralement quelque chose d'important sur le périmètre, l'estimation ou la discipline de reporting.

### Charge estimée et ventilations

L'avancement sépare la charge estimée en :

- **Charge IT**
- **Charge métier**

Chaque côté peut être ventilé entre le responsable concerné et les contributeurs. Les ventilations dépendent de l'équipe configurée dans le tiroir Propriétés, donc les changements d'équipe ont également des conséquences sur la planification ici.

### Charge réelle et journal de temps

La charge réelle est calculée à partir de deux sources :

- **Gestion de projet** : temps enregistré directement sur le projet
- **Temps des tâches** : temps enregistré depuis les tâches du projet

Le journal de temps fusionne les deux en une seule vue et identifie la source de chaque entrée. C'est intentionnel : la charge du projet doit être comprise comme l'empreinte complète de livraison, pas comme un combat entre « travail projet » et « travail tâche ».

Conséquences importantes :

- le temps des tâches contribue automatiquement à la charge réelle du projet
- le temps des tâches est visible ici mais doit être corrigé dans l'espace de travail des tâches
- les entrées de gestion de projet sont maintenues depuis l'onglet Avancement
- les contributeurs peuvent maintenir leurs propres entrées de gestion de projet
- les administrateurs peuvent maintenir les entrées de gestion de projet pour tous les utilisateurs

### Charge de référence

Lorsque le projet passe à **En cours**, KANAP capture les valeurs de charge de référence. Les changements ultérieurs sont affichés comme variance par rapport à cette référence, ce qui est utile pour distinguer les mises à jour normales de livraison du glissement silencieux du périmètre.

## Évaluation

L'onglet **Évaluation** garde la livraison liée à la priorisation.

- pour les projets d'origine demande, la demande source reste visible comme référence d'évaluation
- pour les projets fast-track et legacy, l'évaluation est maintenue directement sur le projet
- les managers peuvent revoir ou mettre à jour l'évaluation, y compris les remplacements de priorité lorsque les règles du portefeuille le permettent

Le score de priorité résultant compte au-delà de cet onglet :

- il apparaît dans l'en-tête du projet
- il est visible dans la liste
- il affecte le rang des projets lorsque la liste est triée par priorité

Si l'évaluation s'éloigne de la réalité de livraison, les discussions de portefeuille deviennent plus difficiles qu'elles ne devraient l'être.

## Relations

L'onglet **Relations** rassemble les liens qui expliquent comment le projet s'intègre au reste du portefeuille. Le badge de l'onglet affiche le nombre d'éléments liés.

### Dépendances

Suivez les dépendances de livraison sur d'autres demandes ou projets. Utilisez le champ de recherche pour trouver et ajouter un élément lié ; supprimez les liens dont vous ne voulez plus avec l'icône de suppression de la pastille.

Les dépendances sont opérationnelles, pas cosmétiques. Elles façonnent la manière dont les retards et le séquencement doivent être interprétés.

### Autres relations

Sous les dépendances, l'onglet Relations vous permet également de maintenir des liens vers le contexte métier et technique connexe (par exemple, applications liées, processus métier ou autres éléments de portefeuille). Chaque relation est sauvegardée automatiquement.

## Connaissances

L'onglet **Connaissances** connecte le projet à des documents de connaissances autonomes. Le badge de l'onglet affiche le nombre de documents de connaissances liés.

Il distingue entre :

- **documents liés** : documents directement attachés au projet
- **documents associés** : documents découverts via d'autres entités liées telles que les demandes sources, dépendances ou éléments connectés

Cette distinction est importante :

- les liens directs représentent la documentation que le projet possède ou utilise explicitement
- les liens associés fournissent du contexte sans prétendre que tout appartient directement au projet

Selon vos autorisations Connaissances, vous pouvez :

- créer un nouveau document vierge déjà lié au projet
- créer un document lié à partir d'un modèle
- lier un document existant
- délier les documents liés directement
- ouvrir n'importe quel document lié ou associé dans la base de connaissances

Si vous pouvez ouvrir le projet mais n'avez pas les droits de consultation des connaissances, KANAP vous indiquera que des connaissances existent sans exposer le contenu du document. C'est un comportement attendu, pas un onglet cassé.

## Import et export CSV

Les outils CSV de projet sont disponibles depuis la page liste pour les administrateurs.

### Export

Les exports prennent en charge :

- **Export complet**
- **Enrichissement de données**
- **Sélection personnalisée**

Utilisez **Enrichissement de données** lorsque vous voulez exporter, ajuster des champs sélectionnés en externe et réimporter le résultat dans KANAP avec un minimum de complications.

### Import

Les imports sont conçus pour des changements en masse contrôlés :

- téléchargez d'abord un modèle quand vous avez besoin de la structure correcte
- validez avant d'importer
- utilisez les options avancées pour choisir le comportement enrichissement vs remplacement et les règles d'insertion/mise à jour

L'import en masse est utile pour la maintenance à grande échelle du portefeuille, mais ce n'est pas un raccourci pour contourner la gouvernance projet. La planification des phases, les tâches, les connaissances et le contrôle continu de la livraison restent dans l'espace de travail.

## Envoyer un lien

Utilisez **Envoyer le lien** depuis l'en-tête de l'espace de travail pour envoyer par e-mail un lien direct vers le projet à des destinataires internes ou externes.

- vous pouvez l'envoyer aux utilisateurs de la plateforme ou à toute adresse e-mail
- vous pouvez inclure un message optionnel
- le lien copié ou envoyé pointe directement vers l'espace de travail du projet

Encore une fois, envoyer un lien n'accorde pas l'accès. Cela évite simplement aux gens de chasser le projet eux-mêmes.

## Conseils pratiques

- Utilisez le tiroir Propriétés pour les données structurelles qui doivent rester visibles pendant que vous travaillez.
- Utilisez **Synthèse** pour le récit du projet, l'activité récente et l'image opérationnelle de haut niveau.
- Utilisez **Planning** pour définir la structure de livraison avant que le volume de tâches ne grandisse.
- Utilisez **Avancement** régulièrement, sinon la variance de charge arrive comme une surprise même si les données vous avertissaient déjà.
- Utilisez **Connaissances** pour la documentation réutilisable ou gouvernée, pas comme une seconde copie du brief Objectif.
- Utilisez **Importer** sur l'éditeur d'Objectif lorsqu'un brief de projet existe déjà sous forme de document Word, plutôt que de le reformater à la main.
