# Agents IA — Vue d'ensemble

Les agents IA sont des assistants automatisés qui surveillent votre centre de services connecté et effectuent le premier passage sur les tickets à votre place : rédiger une réponse au demandeur, ajouter une note interne, ou proposer une mise à jour de la classification, du statut, de l'affectation, des participants d'un ticket, ou une clôture/résolution. Cette page est le tableau de bord du parc — l'endroit unique pour voir tous les agents d'un coup d'œil, savoir combien de travail attend votre décision, comment le parc se comporte, ce qu'il vous coûte, et où actionner le frein d'urgence si quelque chose ne va pas.

L'idée essentielle à retenir : l'agent propose, vous disposez. Tout ce qu'un agent veut envoyer à un demandeur ou écrire dans un ticket est d'abord proposé à votre approbation, et des limites de sécurité strictes, des budgets, des contrôles de fraîcheur et des pauses s'appliquent toujours — même après avoir laissé un agent agir de lui-même. La configuration quotidienne d'un agent se trouve sur son [Espace de l'agent](agents-workspace.md) ; cette page est celle où vous supervisez l'ensemble du parc.

## Où la trouver

- Espace de travail : **Agents IA**
- Chemin : **Agents IA → Vue d'ensemble**
- Route : `/agents`
- Autorisation : `ai_agents:reader` pour consulter la section, `ai_agents:contributor` pour agir sur le travail d'un agent. Les commandes de création, de pause d'urgence et de suppression décrites ci-dessous nécessitent le niveau administrateur des Agents IA (`ai_agents:admin`) ; l'administrateur des paramètres IA (`ai_settings:admin`) les débloque également.
- Indicateur de fonctionnalité : toute la section Agents IA nécessite que l'IA soit activée sur l'instance. Si l'IA est désactivée, la section n'est pas disponible.

---

## Concepts, en une minute

Quelques notions reviennent sur chaque page de cette section. Apprenez-les une bonne fois ici.

- **Ce qu'un agent surveille.** Chaque agent est dirigé vers votre système de tickets connecté (aujourd'hui GLPI, configuré sous **Administration → Intégrations** — voir [la connexion GLPI](integrations.md)). Dans les écrans des agents, il est désigné de manière générique comme le système de tickets connecté ou la connexion. Un agent de supervision surveille, lui, un outil de supervision connecté et ses alertes.
- **Ce sur quoi un agent agit.** Les tickets. Le travail qu'un agent peut proposer : une réponse au demandeur, une note interne, un changement de classification, un changement de statut (y compris clôture/résolution), un changement d'affectation, ainsi que l'ajout ou le retrait de participants.
- **Demander d'abord ou automatique.** Chaque type d'action commence en **Demander d'abord** — l'agent rédige le changement, qui reste dans votre file d'approbations jusqu'à ce que vous l'approuviez, le rejetiez ou l'écartiez. Une fois qu'un agent a accumulé un historique suffisant sur un type d'action donné, un administrateur peut promouvoir uniquement ce type d'action en **Automatique** afin qu'il s'applique sans attendre. La promotion se fait par type d'action, et les limites de sécurité ci-dessous ne cessent jamais de s'appliquer.
- **Modes de fonctionnement.** Chaque agent se trouve dans l'un des trois modes, définis depuis la barre d'actions de son [espace](agents-workspace.md) : **Arrêté** (rien ne s'exécute du tout), **Manuel uniquement** (il ne s'exécute que lorsque quelqu'un le demande — un contrôle que vous déclenchez, ou un test sur un ticket unique) et **Surveillance** (il contrôle de lui-même à la fréquence que vous définissez, en plus de tout ce que fait le mode manuel). Les nouveaux agents commencent toujours en non démarré, et **Manuel uniquement** est le mode dans lequel rester tant que vous ajustez un agent.
- **La sécurité s'applique toujours.** Les plafonds par contrôle, les budgets par exécution et quotidiens, les contrôles de fraîcheur (que faire si le ticket a changé après que l'agent a rédigé son travail) et les pauses s'appliquent, que le type d'action soit en demander d'abord ou automatique. Vous pouvez toujours tout arrêter — voir [Pause d'urgence](#pause-durgence) ci-dessous.

Deux types d'agent fonctionnent aujourd'hui de bout en bout : l'agent **Helpdesk**, qui est celui que décrit le reste de cette section, et l'agent **Supervision d'infrastructure (SRE)**, qui lit les alertes d'un outil de supervision connecté et prépare des notes de diagnostic à relire. D'autres types peuvent apparaître dans la liste des types d'agent, mais ils ne sont pas prêts à fonctionner.

Deux autres surfaces IA se confondent facilement avec les agents, mais sont des choses distinctes : [Plaid](ai-assistant.md) est l'assistant de chat interactif que vous pilotez vous-même, et [Paramètres Plaid](ai-settings.md) configure cet assistant. Les modèles eux-mêmes se gèrent sur la page [Modèles IA](ai-models.md), où se définissent le modèle de chaque agent — et le modèle par défaut de l'organisation sur lequel il se rabat.

---

## Le tableau de bord du parc

!!! note "Agents en attente d'une confirmation"
    Sur le service hébergé, un agent sans modèle propre s'exécute sur le modèle inclus KANAP une fois qu'un administrateur en a confirmé le fournisseur. Jusque-là, un bandeau en haut de la page indique *Les agents qui utilisent le modèle inclus KANAP sont en pause jusqu'à ce qu'un administrateur le confirme dans Administration > Plaid.* Les administrateurs y trouvent un bouton **Ouvrir les réglages Plaid**. Les agents rattachés à un modèle que vous avez ajouté continuent de fonctionner. Voir [Confirmer le modèle inclus KANAP](ai-settings.md#confirmer-le-modele-inclus-kanap).

Cinq indicateurs mutualisés figurent en haut. Ils décrivent l'ensemble du parc, et non les chiffres d'un agent en particulier :

- **Approbations en attente** — combien de propositions, sur l'ensemble du parc, attendent une décision humaine en ce moment. C'est le même nombre qui alimente le badge de la barre latérale.
- **Actions du jour** — combien de propositions ont réellement été exécutées aujourd'hui (approuvées et appliquées, ou appliquées automatiquement).
- **Acceptation** — la part des propositions décidées qui ont été approuvées plutôt que rejetées. Affiche **Données insuffisantes** tant qu'il n'y a pas assez d'historique de décisions pour être significatif.
- **Écartées** — la part des propositions examinées par un humain qui ont été mises de côté plutôt qu'approuvées ou rejetées. Un écartement ne pénalise pas l'agent ; une valeur durablement élevée traduit donc généralement un problème de ciblage — l'agent prend en charge des tickets qu'il ne devrait pas traiter — plutôt qu'un problème de qualité des réponses ; corrigez-le dans le ciblage de l'agent. Affiche également **Données insuffisantes** tant qu'il n'y a pas assez d'historique d'examen.
- **Coût — aujourd'hui / 7 jours** — ce que vos agents coûtent réellement en dépense IA, en EUR : le total du jour et celui des sept derniers jours (aujourd'hui inclus). Cet indicateur couvre **tous** les agents du tenant, agents de support comme agents de supervision ; c'est donc le chiffre à consulter lorsque vous voulez savoir, sans détour, ce que vous coûte le parc. L'économie agent par agent — coût par ticket, plafonds par exécution et quotidiens — se trouve dans les onglets **Performance et autonomie** et **Paramètres** de chaque agent.

Considérez ces indicateurs comme la santé du parc, non comme une comptabilité par agent. Pour les chiffres d'un agent en particulier, ouvrez son espace et utilisez l'onglet **Performance et autonomie**.

---

## Les cartes du parc

Sous le tableau de bord, la section **Parc d'agents** affiche une carte par agent. Chaque carte porte le **nom** et la **description** de l'agent (ou **Aucune description.** si aucune n'a été renseignée), son état, une rangée de puces et — pour un agent de support — une bande de chiffres en temps réel.

**L'état** (en haut à droite de la carte) vous indique ce que l'agent fait en ce moment, sous forme d'une pastille de couleur et d'un libellé. La couleur donne la lecture rapide : le vert signifie que l'agent travaille, le bleu qu'il ne s'exécute que sur demande, le rouge qu'il est retenu, le gris qu'il ne s'exécute pas du tout.

| État | Couleur | Signification |
| --- | --- | --- |
| **Surveillance — avec validation** | Vert | Surveille de lui-même, mais chaque type d'action vous est toujours soumis pour approbation. |
| **Surveillance — partiellement automatique** | Vert | Surveille, avec au moins un type d'action promu pour s'exécuter sans approbation. Les autres demandent encore d'abord. |
| **Test** | Bleu | Activé, mais pas en surveillance — le mode **Manuel uniquement**. Il s'exécute lorsque vous le contrôlez ou le testez manuellement, jamais de lui-même. |
| **En pause** | Rouge | Retenu par une pause d'urgence (à l'échelle du tenant ou pour ce seul agent). Les contrôles et les écritures en attente sont gelés jusqu'à la levée de la pause. |
| **Non démarré** | Gris | Créé mais jamais exécuté. C'est là que commence chaque nouvel agent. |
| **Désactivé** | Gris | Rien ne s'exécute, pas même un contrôle manuel. |
| **Archivé** | Gris | Retiré de l'usage actif, configuration et historique conservés. |

**Les puces** résument l'agent d'un coup d'œil :

- **Type** — le type d'agent, par exemple **Helpdesk** ou **SRE**.
- **Environnement** — l'environnement de connexion vers lequel il pointe : **Production**, **Pré-production**, **Bac à sable**, **Labo** ou **Simulation**. C'est votre repère pour savoir si l'agent touche à de vrais tickets.
- **N en attente** — propositions de cet agent en attente de votre décision (mises en évidence lorsqu'elles dépassent zéro).
- **N en échec** — travail de cet agent qui est bloqué et nécessite un examen (mis en évidence lorsqu'il dépasse zéro). Il apparaît comme **Attention requise** dans la file quotidienne.
- **N automatique(s)** ou **Demander d'abord** — soit le nombre de types d'action promus en automatique, soit **Demander d'abord** lorsque rien n'a été promu.

**Sur un agent de support**, quatre chiffres apparaissent sur la carte :

- **Dernier contrôle** — le résultat du contrôle le plus récent.
- **Périmètre** — **Tous les tickets** ou **Tickets filtrés**, selon que le ciblage de l'agent restreint ou non ce qu'il examine.
- **Exécutions du jour** — combien de fois il s'est exécuté aujourd'hui.
- **Mis à jour** — l'heure de son dernier contrôle.

Cliquer n'importe où sur une carte ouvre l'[espace](agents-workspace.md) de cet agent, où vous le pilotez, le suivez, examinez ses approbations, consultez ses performances et modifiez ses paramètres.

Les administrateurs voient également une petite icône de corbeille sur chaque carte — elle supprime l'agent ainsi que sa file et son historique de surveillance (les tickets de votre système de tickets ne sont jamais touchés, et l'action est irréversible).

---

## Créer un agent

Les administrateurs disposent d'un bouton **Nouvel agent** en haut à droite de la page. Il ouvre une boîte de dialogue :

- **Type d'agent** — **Helpdesk** ou **Supervision d'infrastructure (SRE)**. Le nom et la description sont pré-remplis avec des valeurs raisonnables, remplacées si vous changez de type sans les avoir modifiées vous-même.
- **Nom** et **Description**.
- **Connexion** — le système de tickets (**GLPI**) pour un agent helpdesk, ou l'**Outil de supervision** pour un agent SRE. **Gérer les intégrations** mène à **Administration → Intégrations** si la connexion n'est pas encore configurée. Si aucun outil de supervision n'est connecté, l'agent est tout de même créé — il reste simplement inactif jusqu'à ce qu'il y en ait un.

La surveillance, le ciblage et les limites ne sont pas demandés ici. **Créer** ouvre l'onglet **Paramètres** du nouvel agent dans son [espace](agents-workspace.md), où vous terminez cette configuration. L'agent est toujours créé en **Non démarré** : rien ne s'exécute tant que vous n'avez pas défini son mode d'exécution. La démarche recommandée est de terminer les Paramètres, de placer l'agent en **Manuel uniquement** et de le tester sur de vrais tickets (ou alertes), puis de le passer en **Surveillance** une fois que vous avez confiance en sa production.

---

## Pause d'urgence

Si quelque chose semble anormal à tous les niveaux — réponses inattendues envoyées, mauvaise configuration, incident — les administrateurs peuvent tout geler d'un coup avec **Mettre tous les agents en pause**, dans l'en-tête de la section **Parc d'agents**. Un motif vous est demandé (il rejoint le journal d'audit), puis une bannière persistante affiche **Pause d'urgence active : {motif}** dans toute la section. Tant qu'elle est active, les contrôles de chaque agent et toute écriture en attente sont suspendus pour l'ensemble du tenant. Cliquez sur **Lever la pause** dans la bannière pour reprendre.

Ce frein à l'échelle du tenant est volontairement radical. Pour geler un seul agent au comportement problématique sans toucher au reste du parc, utilisez plutôt **Mettre l'agent en pause** dans la barre d'actions de l'espace de cet agent — voir l'[Espace de l'agent](agents-workspace.md). Et n'oubliez pas la différence entre mettre en pause et arrêter : **Arrêté** met simplement l'agent au repos, tandis qu'une pause gèle en plus le travail déjà en cours et consigne le motif.

---

## Gérer le parc au quotidien

La vue d'ensemble est l'endroit où vous supervisez ; deux pages dédiées sont là où se déroule le travail quotidien concret :

- [Approbations](agents-approvals.md) est la file de revue — réponses, notes et mises à jour de tickets proposées, en attente de votre décision, regroupées par ticket.
- [Activité](agents-activity.md) est la chronologie d'audit en lecture seule de chaque contrôle, proposition, décision, exécution, pause et erreur.

La guidance de fond réutilisable que vous souhaitez partager entre plusieurs agents se trouve sur la page [Contexte partagé](agents-shared-context.md). Notez que le contexte partagé façonne la manière dont les agents interprètent les tickets, mais n'est jamais cité dans une réponse — les sources qu'un agent cite réellement proviennent de vos [Bibliothèques de connaissances](knowledge.md).

---

## Conseils

- **Lisez la puce d'environnement avant de vous fier à un chiffre.** Un agent **Production** touche à de vrais tickets et à de vrais demandeurs ; **Bac à sable**, **Labo** et **Simulation** sont sûrs pour expérimenter. Lorsque vous créez un nouvel agent, tenez-le à l'écart des tickets de production jusqu'à ce que sa production soit correcte.
- **La tuile de coût est la facture honnête du parc.** Elle couvre tous les agents que vous faites tourner. Si elle grimpe plus vite que prévu, la cause habituelle est un agent qui contrôle bien plus souvent que sa file ne le justifie — regardez **Contrôler toutes les (minutes)** avant toute autre chose.
- **Un nombre d'échecs qui augmente est votre signal d'alerte précoce.** La puce **N en échec** fait remonter le travail bloqué. Ouvrez l'agent et traitez les éléments **Attention requise** avant qu'ils ne s'accumulent — ils pointent généralement vers un problème de connexion ou un ticket qui a changé sous l'agent.
- **Manuel uniquement avant Surveillance.** Un agent créé depuis **Nouvel agent** est intentionnellement en **Non démarré**. Exécutez-le d'abord manuellement sur une poignée de tickets représentatifs depuis son espace ; ne le passez en **Surveillance** qu'une fois satisfait de ce qu'il rédige.
- **L'automatique se mérite et se révoque.** Promouvoir un type d'action en automatique ne supprime aucun garde-fou : les budgets quotidiens et par exécution, les contrôles de fraîcheur et les pauses s'appliquent toujours, un type d'action qui connaît une mauvaise heure attend votre approbation, et un type dont l'acceptation tombe sous la moitié repasse en demander d'abord (voir [L'échelle d'autonomie](agents-workspace.md#lechelle-dautonomie)). Les types d'action que le demandeur peut voir exigent en outre une confirmation explicite.
- **Préférez la pause propre à l'agent.** Ne recourez à **Mettre tous les agents en pause** que pour un véritable problème à l'échelle du parc. Pour un seul agent bruyant, la pause de son propre espace laisse le reste de votre parc fonctionner.
