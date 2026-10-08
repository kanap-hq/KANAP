# Demandes du portefeuille

Les Demandes du portefeuille sont la couche d'intake pour les travaux proposés. Une demande vous permet de capturer le besoin métier, d'évaluer la faisabilité, de noter la priorité, de rassembler les connaissances de support et de décider si l'initiative doit avancer en tant que projet. En pratique, c'est là que les idées deviennent du travail gouverné plutôt que du folklore de couloir.

## Où la trouver

- Espace de travail : **Portefeuille**
- Chemin : **Portefeuille > Demandes**

### Autorisations

| Autorisation | Ce qu'elle permet |
| --- | --- |
| `portfolio_requests:reader` | Ouvrir la liste des demandes et consulter les espaces de travail des demandes |
| `portfolio_requests:member` | Modifier les documents managés intégrés dans l'espace de travail de la demande, même sans droits plus larges de gestion des demandes |
| `portfolio_requests:manager` | Créer des demandes, mettre à jour les données de demande, maintenir l'équipe et les relations, ajouter commentaires et décisions, changer le statut, soumettre des recommandations d'analyse et modifier l'évaluation |
| `portfolio_requests:admin` | Supprimer des demandes et utiliser l'import/export CSV |

L'onglet **Connaissances** suit les autorisations Connaissances pour les actions de création et de liaison. Un utilisateur peut être autorisé à travailler sur le contenu de la demande sans être autorisé à créer ou re-lier des documents de connaissances autonomes.

## Travailler avec la liste

La liste est conçue pour le tri plutôt que pour la navigation d'archives. Par défaut, elle trie les demandes par priorité afin que le travail le plus urgent ou le plus stratégiquement important remonte en premier.

### Filtres de périmètre

Utilisez le sélecteur de périmètre au-dessus de la grille pour contrôler le pipeline que vous regardez :

- **Mes demandes** affiche les demandes où vous êtes explicitement impliqué, comme demandeur, sponsor, responsable ou contributeur.
- **Demandes de mon équipe** étend cette vue aux demandes impliquant des membres de votre équipe Portefeuille. Cette option est indisponible si vous n'êtes pas assigné à une équipe.
- **Toutes les demandes** supprime le filtre d'implication et affiche le pipeline complet des demandes.

La liste s'ouvre sur **Toutes les demandes** et mémorise votre choix de périmètre. Si vous ouvrez une demande depuis la liste et revenez plus tard, KANAP conserve le contexte de liste afin que vous n'ayez pas à reconstruire votre pile de filtres à chaque fois.

### Colonnes par défaut

La grille standard met en évidence les champs qui comptent pendant l'intake et la revue :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **#** | Numéro de référence (ex. : REQ-42). Cliquez pour ouvrir l'espace de travail |
| **Nom de la demande** | Le nom de la demande |
| **Priorité** | Score de priorité calculé |
| **Statut** | État d'intake actuel |
| **Source** | Classification source du portefeuille |
| **Catégorie** | Catégorie du portefeuille |
| **Stream** | Stream du portefeuille |
| **Société** | Classification société |
| **Demandeur** | Personne ayant soulevé la demande |
| **Date cible** | Date de livraison cible demandée |
| **Créée** | Quand la demande a été créée |

**Colonnes supplémentaires** (masquées par défaut) :

- **Dernière modification** : Quand la demande a été mise à jour pour la dernière fois

### Comportement de filtrage

- La recherche globale fonctionne sur le contenu de la demande et les métadonnées métier visibles.
- Des filtres de colonne sont disponibles pour les principaux champs de classification et de responsabilité.
- Les demandes au statut **Convertie** sont masquées par défaut afin que la liste reste focalisée sur l'intake actif. Si vous devez revoir des décisions historiques d'intake, incluez **Convertie** dans le filtre Statut.

### Actions de la liste

- **Nouvelle demande** est disponible pour les managers de demandes.
- **Import CSV** et **Export CSV** sont disponibles pour les administrateurs de demandes.

## L'espace de travail Demande

L'espace de travail utilise un modèle divisé :

- La zone principale contient les onglets opérationnels : **Synthèse**, **Analyse**, **Évaluation**, **Relations** et **Connaissances**.
- Un tiroir **Propriétés** persistant sur le bord droit contient les métadonnées stables de la demande, l'assignation d'équipe et les projets résultants. Ouvrez ou fermez-le à l'aide de l'onglet vertical sur le bord droit.

Cela compte parce que tout n'est pas enregistré de la même manière :

- Les modifications dans le **tiroir Propriétés** sont appliquées immédiatement.
- Les modifications dans **Synthèse**, **Analyse** et **Évaluation** sont des modifications d'espace de travail et utilisent **Enregistrer** / **Réinitialiser**.
- Les documents managés **Objectif** et **Risques et atténuations** utilisent également le flux d'enregistrement de l'espace de travail.

Si vous créez une nouvelle demande, KANAP démarre sur **Synthèse**. Les autres onglets deviennent utiles après que la demande existe comme un véritable enregistrement plutôt que comme une idée très sincère.

L'en-tête de l'espace de travail vous donne le contexte opérationnel sans quitter la page :

- une référence de demande copiable telle que `REQ-42`
- une bande de métadonnées avec **Statut**, **Score**, **Demandeur**, **Responsable IT**, **Date de livraison cible** et (lorsque applicable) la **Tâche source** depuis laquelle la demande a été créée
- **Envoyer le lien** pour le partage
- **Convertir en projet** lorsque la demande est **Approuvée** ou **Convertie**
- **Supprimer** pour les administrateurs (lorsque la demande n'est pas encore convertie)
- navigation précédent/suivant basée sur le contexte exact de la liste d'où vous venez

### Tiroir des propriétés

Traitez le tiroir comme la colonne vertébrale structurelle de la demande. Il contient trois groupes.

#### Propriétés principales

- Nom de la demande
- Statut
- Source, Catégorie, Stream
- Demandeur
- Société, Département
- Date de livraison cible

Ces champs façonnent la manière dont la demande est routée, filtrée et revue ailleurs dans l'espace de travail. Par exemple :

- changer le **Statut** affecte les décisions qui peuvent suivre et si la conversion est disponible
- changer la **Catégorie** ou le **Stream** change le contexte analytique pour la faisabilité et l'évaluation
- changer la **Société** ou le **Demandeur** change le reporting et la visibilité de la responsabilité dans tout le portefeuille

#### Équipe

L'assignation d'équipe nomme la responsabilité plutôt que de simplement maintenir une liste de contacts :

- **Sponsor métier**
- **Responsable métier**
- **Sponsor IT**
- **Responsable IT**
- **Contributeurs métier**
- **Contributeurs IT**

Ces assignations pilotent la visibilité partagée et clarifient qui est censé sponsoriser, façonner et livrer la demande. La Synthèse utilise ces données pour afficher si la demande a une responsabilité nommée suffisante pour avancer raisonnablement.

#### Projets résultants

Une liste en lecture seule des projets produits depuis cette demande après conversion. Cliquez sur une entrée pour naviguer vers l'espace de travail du projet.

Pour les dépendances et autres types de relations, voir l'onglet **Relations**.

D'anciens favoris peuvent encore pointer vers `overview`, `team` ou `relations`. L'espace de travail actuel place ce contenu sous **Synthèse**, le tiroir Propriétés et l'onglet **Relations**.

## Synthèse

**Synthèse** est le cockpit de la demande. Ce n'est pas un simple onglet de vue d'ensemble ; c'est là où KANAP compresse l'état de la demande en un instantané opérationnel.

### Objectif comme document managé

La section **Objectif** est un document markdown managé intégré directement dans la demande. C'est plus qu'un long champ de description :

- il donne aux relecteurs une déclaration stable d'intention
- il est disponible pendant la conversion demande-en-projet
- il peut être modifié par les utilisateurs disposant de `portfolio_requests:member`, même s'ils ne gèrent pas le reste de la demande
- il prend en charge **l'import DOCX** afin que vous puissiez importer directement des documents Word existants, et **l'export** pour télécharger le contenu courant en PDF, DOCX ou ODT

Cette séparation est délibérée. Elle permet aux contributeurs experts du sujet d'améliorer le récit de la demande sans ouvrir le contrôle complet sur le statut, l'évaluation et la structure du portefeuille.

### Activité

Sous Objectif, l'onglet Synthèse inclut le flux d'activité de la demande :

- **Commentaires** pour la discussion, les notes contextuelles et les décisions formelles
- **Historique** pour le journal d'audit des changements de champs et de statut

Cela place l'activité la plus récente directement devant les relecteurs sans les obliger à naviguer vers un onglet séparé.

#### Commentaires

Les commentaires prennent en charge la discussion normale, mais ils prennent également en charge les **décisions formelles**. Une décision formelle peut capturer :

- la réunion ou le contexte de décision
- le résultat de la décision
- la justification
- un changement de statut optionnel dans la même action

Cette combinaison garde la gouvernance traçable : l'enregistrement du *pourquoi* quelque chose a changé reste attaché au changement au lieu d'être reconstruit plus tard depuis la mémoire et l'optimisme.

Les commentaires prennent en charge le markdown et les images en ligne, ce qui est utile pour les notes de conception, les preuves, les captures d'écran et le matériel de revue.

#### Historique

L'historique est la vue d'audit. Utilisez-la lorsque vous devez répondre à des questions telles que :

- qui a changé le statut
- quand les assignations d'équipe ont changé
- si un changement d'évaluation ou d'analyse s'est produit avant ou après une décision

La liste se termine par l'entrée de création — qui a créé la demande et quand — sous les changements enregistrés, qui incluent les modifications des documents Objectif et Risques.

Si vous avez besoin de récit, utilisez Commentaires. Si vous avez besoin de preuve, utilisez Historique.

## Analyse

**Analyse** est l'endroit où la demande passe de « semble raisonnable » à « assez bien comprise pour décider ».

Elle rassemble quatre éléments distincts :

- les processus métier impactés
- la revue de faisabilité structurée
- le document managé **Risques et atténuations**
- la **Recommandation d'analyse** formelle

### Processus métier impactés

Liez les processus métier touchés par la demande. Cela change la signification de la demande en termes de portefeuille : une demande affectant des processus opérationnels de base ne devrait pas être évaluée de la même manière qu'une amélioration de confort local.

### Revue de faisabilité

La revue de faisabilité est une évaluation structurée sur sept dimensions :

- Faisabilité technique
- Compatibilité d'intégration
- Besoins en infrastructure
- Sécurité et conformité
- Compétences en ressources
- Contraintes de livraison
- Conduite du changement

Chaque dimension peut être évaluée avec un niveau de préoccupation (**Non évalué**, **Aucune préoccupation**, **Préoccupations mineures**, **Préoccupations majeures**, **Bloquant**) et des notes justificatives.

Utilisez cette section pour exposer tôt les frictions de livraison :

- toutes les demandes n'échouent pas parce que l'idée est mauvaise
- beaucoup échouent parce que les contraintes d'intégration, d'infrastructure, de sécurité, de calendrier ou de conduite du changement ont été ignorées jusqu'à ce qu'il soit trop tard

L'onglet Synthèse fait remonter le niveau de préoccupation le plus fort de cette revue afin que les problèmes majeurs restent visibles même quand personne n'ouvre Analyse.

### Risques et atténuations

**Risques et atténuations** est un autre document markdown managé. Utilisez-le pour documenter les risques résiduels, les actions d'atténuation et la responsabilité. Comme Objectif, il peut être modifié par les utilisateurs disposant de `portfolio_requests:member` et prend en charge **l'import DOCX** pour importer des documents Word existants ainsi que l'export.

C'est utile lorsque les personnes les mieux placées pour décrire les risques ne sont pas les mêmes que celles qui devraient changer le statut de la demande ou la structure du portefeuille.

### Recommandation d'analyse

Le flux de recommandation publie une décision formelle dans Activité avec le contexte fixe **Recommandation d'analyse**. Il peut également changer le statut de la demande en même temps.

Cela signifie qu'Analyse n'est pas une zone de prise de notes isolée. Elle fait partie de la trace de gouvernance :

- les relecteurs peuvent voir la dernière recommandation directement dans Analyse
- la même recommandation apparaît dans Activité comme un enregistrement de décision
- les changements de statut optionnels restent liés à la recommandation qui les a justifiés
- un raccourci **Voir dans Activité** saute directement à la recommandation dans le flux d'activité de la Synthèse

Les anciennes demandes peuvent également afficher une section **Analyse précédente (Legacy)**. Ce contenu est conservé pour la continuité, mais le modèle actuel de demande s'appuie sur la revue de faisabilité, les risques managés et les recommandations formelles.

## Évaluation

**Évaluation** évalue la demande par rapport au modèle d'évaluation du portefeuille configuré pour votre tenant.

En pratique :

- chaque critère actif contribue à la priorité calculée
- le score résultant alimente la comparaison du portefeuille et l'ordre de la liste
- un remplacement peut être utilisé lorsque le score calculé est correct mathématiquement mais incorrect opérationnellement

Si le remplacement de priorité est utilisé, il devrait être traité comme une exception, pas comme un mode de vie.

Lorsque les paramètres du portefeuille le permettent, des règles de contournement obligatoire peuvent forcer la priorité maximale pour les demandes qualifiées. Ceci est typiquement utilisé pour le travail qui ne peut pas raisonnablement entrer en compétition avec la demande discrétionnaire.

Une fois qu'une demande est **Convertie**, l'évaluation devient en lecture seule. À ce stade, la demande a déjà fait son travail en tant qu'enregistrement d'intake et de priorisation.

## Relations

L'onglet **Relations** rassemble les liens qui expliquent comment la demande se connecte au reste du portefeuille. Le badge de l'onglet affiche le nombre d'éléments liés.

### Dépendances

Les dépendances identifient le travail qui doit exister, se terminer ou rester aligné avant que cette demande puisse réussir. Utilisez le champ de recherche pour trouver et ajouter un élément lié ; supprimez les liens dont vous ne voulez plus avec l'icône de suppression de la pastille.

Une demande avec des données de dépendance faibles peut sembler inoffensive jusqu'à ce qu'elle entre en collision avec le travail existant.

### Autres relations

Sous les dépendances, l'onglet Relations vous permet également de maintenir d'autres liens de portefeuille -- par exemple, demandes liées, projets liés, ou autres objets métier et techniques connectés. Chaque relation est sauvegardée automatiquement.

Pour les projets produits depuis cette demande après conversion, voir le groupe **Projets résultants** dans le tiroir Propriétés.

## Connaissances

L'onglet **Connaissances** connecte la demande à des documents de connaissances autonomes. Le badge de l'onglet affiche le nombre de documents de connaissances liés.

L'onglet distingue deux types de connaissances :

- Les **Documents liés** sont directement attachés à la demande.
- Les **Documents associés** sont découverts via le contexte plus large de la demande, tels que les dépendances, demandes liées, projets résultants et autres objets liés.

Cette distinction est importante :

- les documents directs font partie de l'ensemble de documentation explicite de la demande
- les documents associés ajoutent du contexte sans prétendre que la demande les possède

### Ce que vous pouvez faire

Avec des autorisations Connaissances suffisantes, vous pouvez :

- créer un nouveau document de connaissances vierge déjà lié à la demande
- créer un document lié à partir d'un modèle
- lier un document de connaissances existant
- délier un document lié directement
- ouvrir n'importe quel document lié ou associé dans l'espace de travail Base de connaissances

Sans ces autorisations, l'onglet fonctionne toujours comme une vue de référence tant que vous êtes autorisé à voir les connaissances sous-jacentes.

### Documents managés versus documents de connaissances

Les documents managés **Objectif** et **Risques et atténuations** font partie de la demande elle-même. Ils ne sont pas la même chose que les documents de connaissances.

Utilisez les documents managés pour le récit de demande de base qui doit toujours voyager avec la demande. Utilisez la base de connaissances pour les documents autonomes qui peuvent avoir besoin de leur propre cycle de vie, relations, exports, modèles et réutilisation au-delà d'une seule demande.

## Convertir une demande en projet

Une fois qu'une demande atteint **Approuvée**, l'espace de travail propose **Convertir en projet** dans l'en-tête.

Le flux de conversion vous permet de :

- confirmer ou ajuster le nom du projet
- définir les dates de début et de fin planifiées
- examiner le texte d'Objectif courant
- reporter la charge IT et métier estimée dérivée des entrées d'évaluation de la demande

Après conversion :

- la demande devient un enregistrement durable d'intake et de décision
- le projet résultant apparaît dans le groupe **Projets résultants** de la demande
- l'évaluation est gelée sur la demande
- la demande peut toujours être ouverte pour audit, contexte et traçabilité des connaissances

En d'autres termes, la conversion n'efface pas la demande. Elle la promeut.

## Import et export CSV

L'import et l'export CSV sont disponibles pour `portfolio_requests:admin`.

Utilisez l'export quand vous avez besoin de reporting de portefeuille ou d'enrichissement hors ligne. Utilisez l'import quand vous avez besoin de créer ou mettre à jour des demandes en masse. Parce que l'import peut altérer les enregistrements d'intake à grande échelle, il est intentionnellement réservé aux administrateurs.

## Conseils

- **Utilisez l'import DOCX pour le contenu existant** : Si vous avez déjà une déclaration d'objectif ou un registre des risques dans un document Word, utilisez le bouton **Importer** sur l'éditeur Objectif ou Risques et atténuations au lieu de copier-coller. L'import convertit le document en markdown et vous avertit si du contenu n'a pas pu être reporté.
- **Les filtres de périmètre persistent** : La liste s'ouvre sur **Toutes les demandes**. KANAP mémorise votre dernier choix de périmètre, vous n'avez donc pas besoin de le re-sélectionner à chaque session.
- **Les demandes converties sont masquées par défaut** : Si vous cherchez une demande qui a déjà été convertie en projet, ajoutez **Convertie** au filtre Statut sur la liste.
- **Autorisation membre pour les contributeurs** : Donnez aux experts du sujet `portfolio_requests:member` afin qu'ils puissent modifier Objectif et Risques et atténuations sans pouvoir changer le statut, l'évaluation ou la structure du portefeuille.
- **De la tâche à la demande** : Lorsqu'une tâche révèle une initiative plus grande, utilisez **Convertir en demande** depuis l'espace de travail de la tâche. La nouvelle demande hérite du titre de la tâche, de la description (comme Objectif), de la classification et des pièces jointes, et affiche la **Tâche source** dans son en-tête.
