# Agents IA : Approbations

Les Approbations constituent la file de revue quotidienne de tout ce que vos agents IA veulent faire. Avant qu'un agent ne publie une réponse, n'ajoute une note, ne reclasse un ticket, ne change son statut, ne le réaffecte ou ne le clôture, il vous soumet ce travail ici sous forme de **proposition**. Rien sur cette page ne s'est encore produit du côté du demandeur : une proposition est la suggestion de l'agent, et elle n'atteint votre système de tickets connecté qu'une fois que vous l'avez approuvée. C'est là qu'un opérateur passe le plus clair de son temps à superviser un agent helpdesk : lire chaque brouillon et décider quoi en faire : appliquer les bons, rejeter ceux qui sont erronés et écarter ceux qui sont justes mais ne doivent pas être envoyés.

## Où la trouver

- Espace de travail : **Agents IA**
- Chemin : **Agents IA → Approbations**
- Route : `/agents/approvals`
- Autorisation : nécessite que l'IA soit activée sur l'instance et le rôle Lecteur des Agents IA (`ai_agents:reader`) pour lire la file. Décider d'une proposition, prendre acte d'une ligne d'attention et relancer une analyse nécessitent le niveau contributeur (`ai_agents:contributor`).
- La même file apparaît, limitée à un seul agent, dans l'onglet **Approbations** de l'[espace de l'agent](agents-workspace.md). La page `/agents/approvals` est la vue combinée de tous les agents ; l'onglet de l'espace n'affiche que les propositions de l'agent que vous consultez. La disposition et les commandes sont identiques.

---

## Ce qu'est une proposition

Chaque proposition correspond à une action concrète qu'un agent souhaite effectuer sur un ticket. Il existe huit types d'actions, chacun avec son propre libellé et sa propre icône :

| Action | Effet |
| --- | --- |
| **Réponse demandeur** | Un message que l'agent souhaite envoyer à la personne qui a ouvert le ticket. |
| **Note interne** | Une note que l'agent souhaite ajouter pour votre équipe, non visible par le demandeur. |
| **Classification** | Modifie la catégorie, le type, la priorité ou l’urgence du ticket selon les instructions. Une proposition peut contenir plusieurs champs ; elle affiche les valeurs actuelles et proposées, avec les noms des catégories. |
| **Statut** | Un passage à un autre statut de ticket (par exemple, de **Nouveau** à **En attente**). |
| **Clôturer le ticket** | Clôture le ticket. Voir [Clôturer et résoudre les tickets](#cloturer-et-resoudre-les-tickets). |
| **Résoudre le ticket** | Marque le ticket comme résolu. Voir [Clôturer et résoudre les tickets](#cloturer-et-resoudre-les-tickets). |
| **Affectation** | Ajoute un groupe de techniciens **ou** un technicien nommé au ticket, selon la règle de routage écrite dans les instructions de l'agent. Personne déjà présent sur le ticket n'est retiré. La proposition indique qui est ajouté et qui est actuellement affecté. |
| **Observateurs** | Ajoute un technicien ou un groupe affectable comme observateur. Le demandeur reste inchangé, et les personnes qui suivent déjà le ticket restent. |

Pour une **Réponse demandeur** ou une **Note interne**, le corps que vous voyez est le message rédigé complet, exactement tel qu'il serait publié. Lisez-le comme le ferait le demandeur (ou votre équipe). Pour les cinq autres types, le corps est un bref résumé du changement plutôt qu'un texte libre, par exemple `Status: New -> Pending`, `Assignee: Unassigned -> Jane`, ou un différentiel de classification champ par champ, souvent suivi d'une ligne **Motif** expliquant pourquoi l'agent le propose.

Les propositions sont regroupées par ticket. Chaque groupe a pour en-tête le ticket (**Ticket #N**), son statut actuel, un décompte tel que **3 propositions** et sa date de dernière mise à jour. Un ticket peut contenir plusieurs propositions à la fois (par exemple une réponse, une reclassification et un changement de statut), et vous pouvez les décider individuellement ou toutes ensemble.

---

## Les quatre sections

La file est organisée en quatre sections selon la position de chaque élément dans son cycle de vie.

### Nécessite votre décision

Les propositions qui vous attendent, regroupées par ticket. C'est la section où se déroule l'essentiel de votre travail ; **En cours** et **Récemment terminés** sont purement informatives. Lorsqu'elle est vide, elle affiche *Rien ne nécessite votre décision.* Une fois que vous avez décidé d'une proposition, elle se réduit à une seule ligne de statut au sein de son groupe de ticket, tandis que les propositions restantes du ticket demeurent ouvertes pour vous.

### En cours

Le travail déjà en mouvement et qui ne requiert rien de votre part : les propositions que vous avez approuvées et qui sont en cours d'application sur le système de tickets connecté, ainsi que les tickets qu'un agent est en train de contrôler. Les lignes affichent ici un statut en direct tel que **En attente de démarrage**, **En cours**, **Exécution…** ou **Agent au travail…**. Lorsque rien n'avance, la section n'est pas affichée du tout : une liste « en cours » vide ne vous apprend rien que l'état de l'agent ne vous dise déjà.

### Attention requise

Tout ce qui a échoué ou est bloqué : une proposition qui n'a pas pu être envoyée au système de tickets connecté, ou un contrôle qui a échoué. Chaque ligne porte une légende rouge expliquant ce qui n'a pas fonctionné, ainsi qu'un bouton **Trace** qui ouvre toute l'histoire sans quitter la page. Lorsqu'elle est vide, elle affiche *Aucun travail agent ne nécessite d'attention.*

C'est la section à surveiller, et ce n'est plus une impasse : voir [Traiter une ligne d'attention requise](#traiter-une-ligne-dattention-requise) ci-dessous.

### Récemment terminés

Un historique repliable des éléments les plus récemment terminés : appliqués, rejetés, écartés, ignorés ou effectués. Il reste replié jusqu'à ce que vous l'ouvriez, mémorise ce choix, et affiche jusqu'à 30 lignes avec une ligne **+N autres** indiquant combien d'éléments plus anciens existent. Utilisez-le pour confirmer qu'une approbation a bien abouti, ou pour vérifier ce qu'un agent a fait pendant votre absence. Les lignes dont vous avez pris acte dans **Attention requise** aboutissent également ici.

---

## Prendre une décision : Approuver, Rejeter et Écarter

Chaque proposition en attente propose trois actions.

- **Approuver** affiche **Approuver** sur une proposition que vous n'avez pas encore décidée, et **Exécuter** sur une proposition que vous avez déjà approuvée mais qui n'a pas encore été exécutée. Dans les deux cas, il fait la même chose : il envoie l'action à votre système de tickets connecté, où l'agent publie la réponse ou la note, ou applique le changement. L'approbation est le moment où le demandeur (ou votre équipe) peut être affecté. Jusque-là, rien n'a quitté KANAP.
- **Rejeter** n'applique pas l'action. La proposition est abandonnée mais reste dans le journal d'audit, de sorte qu'il existe toujours une trace de ce que l'agent a suggéré et du fait que vous l'avez refusé. Le rejet d'une seule proposition prend effet immédiatement. Le rejet est un signal de qualité : il pénalise l'évaluation de l'agent et son taux d'acceptation, car il indique à l'agent que la proposition était erronée.
- **Écarter** met également la proposition de côté sans rien envoyer. Mais, contrairement au rejet, cela ne pénalise **pas** l'agent. Le taux d'acceptation et le suivi d'autonomie de l'agent ne sont pas affectés. Utilisez cette action lorsque la proposition est juste mais ne doit tout simplement pas partir : un ticket sensible, un collègue qui a déjà répondu, un doublon. Il s'agit d'un seul clic, sans demande de motif, et son infobulle indique *Écarter sans pénaliser l'évaluation de l'agent*. Une proposition écartée ne peut plus être approuvée.

Si une proposition est actuellement **bloquée** (par exemple parce qu'un contrôle de fraîcheur ou de sécurité n'est plus valide, ou parce que le système de tickets n'accepte pas le changement pour le moment), son bouton principal est désactivé et la raison apparaît dans l'infobulle du bouton. La proposition reste visible pour que vous puissiez voir pourquoi elle ne peut pas aboutir.

**Tout approuver**, **Tout rejeter** et **Tout écarter** apparaissent sur un groupe de ticket lorsqu'il y a plus d'un élément à traiter, ce qui vous permet de vider un ticket entier en une seule étape. **Tout approuver** est le bouton principal coloré du groupe : vider un ticket en une seule décision est le rythme voulu de cette page, et les boutons de chaque proposition sont volontairement plus discrets pour que l'œil se pose d'abord sur le groupe. **Tout rejeter** ouvre une courte boîte de dialogue qui confirme le nombre de propositions qui seront rejetées et propose une note facultative pour le journal d'audit ; **Tout écarter** ouvre une courte boîte de dialogue de confirmation indiquant que rien ne sera envoyé et que l'évaluation de l'agent n'est pas affectée.

Chaque proposition passe par cette file tant qu'assez de vos décisions n'ont pas été recueillies pour promouvoir ce type d'action de **Demander d'abord** à **Automatique** dans l'onglet [Performance et autonomie](agents-workspace.md) de l'agent. Pour les types d'action qu'un demandeur peut voir, la promotion exige en outre une confirmation explicite de la part d'un administrateur.

### Écarter ou rejeter

Le rejet et l'écartement empêchent tous deux une proposition d'atteindre le ticket, mais ils transmettent à l'agent des messages très différents : le choix a donc son importance.

- **Rejetez** lorsque la proposition est erronée ou de mauvaise qualité : un brouillon incorrect, une classification fausse, un changement de statut inapproprié. Le rejet est un signal négatif d'apprentissage et d'évaluation : il fait baisser le taux d'acceptation de l'agent et ralentit son accès à l'autonomie, ce qui est exactement souhaitable lorsqu'il se trompe.
- **Écartez** lorsque la proposition est *juste* mais ne doit pas être envoyée : le ticket est sensible, un collègue a déjà répondu, elle fait doublon avec quelque chose déjà en cours. L'écartement étant neutre, il ne récompense ni ne pénalise l'agent : son taux d'acceptation et son suivi d'autonomie restent intacts.

Recourir à l'écartement alors que vous voulez en réalité dire « c'était faux » masque un véritable problème de qualité, et rejeter une proposition juste mais non envoyable pénalise injustement un agent qui n'a rien fait de mal. Une proposition écartée affiche un statut **Écarté** en gris et vient s'ajouter à **Récemment terminés** ; l'agent peut toujours proposer à nouveau sur le même ticket lors d'un cycle ultérieur, tout comme après un rejet. **Écarté** n'est pas la même chose qu'**Expiré** : une proposition expirée est une proposition que personne n'a décidée avant l'échéance de sa fenêtre d'approbation, tandis qu'une proposition écartée résulte d'une décision délibérée de votre part.

---

## Clôturer et résoudre les tickets

Les titres **Clôturer le ticket** et **Résoudre le ticket** s'affichent en rouge, car ils mettent fin au ticket et le demandeur voit le changement immédiatement. Ce titre rouge est le seul signal supplémentaire : il n'y a pas de badge « terminal » à part.

Approuver l'une de ces actions (seule ou dans le cadre d'un **Tout approuver** où un élément clôture ou résout le ticket) ouvre une confirmation nommée d'après l'action (**Appliquer Résoudre le ticket ?**). Elle nomme le ticket, avertit que le demandeur verra le changement immédiatement, liste chaque élément de clôture d'une approbation groupée, et vous fournit un champ de motif pour la trace. Vous confirmez avec le nom de l'action elle-même (**Résoudre le ticket** ou **Clôturer le ticket**). Il s'agit d'une friction délibérée : les réponses et notes de routine s'appliquent en un clic, mais la clôture ou la résolution d'un ticket vous demande toujours de marquer une pause et de confirmer.

---

## Lire les réponses rédigées : la note de secours

Lorsqu'un agent rédige une **Réponse demandeur** ou une **Note interne**, il ancre normalement ce brouillon dans vos bibliothèques de la [Base de connaissances](knowledge.md) et cite les sources qu'il a utilisées. Il arrive que vous voyiez la mention **Cette réponse n'est pas étayée par votre base de connaissances.** sur une telle proposition. Cela signifie que l'agent n'a pas pu étayer ce brouillon particulier avec des sources citées : traitez-le donc comme une simple suggestion et lisez-le attentivement avant de l'approuver, plutôt que de lui faire confiance comme s'il était vérifié par rapport aux sources.

**Détails** ouvre la raison technique (pour le support), par exemple une erreur de synthèse ou une fuite de consignes internes bloquée. Vous n'avez pas besoin de ces codes pour décider.

L'essentiel à retenir est que **l'absence de cette note est le cas normal et sain.** La plupart des brouillons sont étayés et ne portent aucune légende. Et une réponse peut légitimement n'avoir aucune source citée (un accusé de réception administratif ou une escalade purement interne n'est pas censé être rédigé à partir de votre base de connaissances) sans déclencher cet avertissement. Ne voyez donc pas l'absence de note de secours comme un problème ; cela signifie que le brouillon est soit correctement étayé, soit qu'il n'était pas censé l'être. La note n'apparaît que lorsque l'agent a tenté d'étayer une réponse et n'y est pas parvenu.

---

## Traiter une ligne d'attention requise

Les lignes d'**Attention requise** étaient auparavant en lecture seule : vous pouviez constater qu'une proposition avait expiré ou qu'un contrôle avait échoué, mais il n'y avait rien à faire d'autre que de la regarder stagner. Chaque ligne porte désormais deux commandes.

- **Relancer l'analyse** demande à l'agent de réexaminer ce ticket (ou cette alerte), tout de suite. Elle exécute exactement la même passe que **Tester sur un ticket** dans l'[onglet Suivi](agents-workspace.md) de l'agent : ce qu'il en tire revient donc dans **Nécessite votre décision** sous forme de nouvelles propositions à examiner. Son infobulle indique *Demander à l'agent de le réexaminer.*, et pendant son travail, *L'agent le réexamine…* C'est le bon premier réflexe lorsque l'échec était passager : une coupure de connexion, un ticket qui a changé en cours de route, une proposition qui a expiré avant que quelqu'un s'en occupe.
- **Prendre acte** fait disparaître la ligne définitivement. Son infobulle indique *Marquer comme vu et retirer définitivement de la liste.* Utilisez-la lorsque vous avez compris l'échec et l'avez traité (ou décidé qu'il n'appelait aucune action) : la ligne disparaît immédiatement, ne revient ni sur un autre appareil ni après un rafraîchissement, et la prise en compte est consignée dans la chronologie de l'[Activité](agents-activity.md) sous forme de **Décision**, avec qui l'a traitée et quand. Elle vient ensuite s'ajouter à **Récemment terminés** comme tout autre élément clos.

**Relancer l'analyse** n'apparaît que là où une relance est réellement possible : la ligne doit désigner un ticket (ou une alerte) que l'agent peut encore atteindre, et l'agent lui-même doit encore exister. Là où ce n'est pas le cas, **Prendre acte** est proposé seul, ce qui est l'issue honnête : il n'y a rien à réessayer, seulement quelque chose à clore. Les lignes laissées par un agent supprimé depuis l'indiquent à la place du bouton : *L'agent n'existe plus*.

Lorsque l'arriéré est important (une série de propositions expirées avant que quiconque les examine, par exemple), traiter les lignes une à une n'est pas la solution. Utilisez plutôt **Tout prendre en compte** dans l'en-tête de la section. Il vous demande de confirmer avec le nombre réel, qui couvre tout l'arriéré et pas seulement les lignes affichées (la section indique *Affichage des N plus récents sur M* lorsqu'il y en a davantage), puis efface d'un coup tous les éléments expirés ou en échec, définitif ou non. Les propositions encore en cours d'exécution ne sont pas touchées, et le lot est consigné une seule fois dans la chronologie de l'[Activité](agents-activity.md) sous forme de **Décision**. La suppression d'un agent fait de même automatiquement pour ses propres reliquats : un agent que vous retirez ne laisse pas de pile derrière lui.

L'association est délibérée. **Relancer** signifie « essaie encore » ; **Prendre acte** signifie « j'ai vu, c'est traité ». Entre les deux, **Attention requise** devrait revenir à zéro plutôt que de gonfler en une liste que plus personne ne lit.

---

## Remonter d'une proposition à son contrôle

Chaque groupe de ticket et chaque ligne d'attention porte un bouton **Trace**. Il ouvre la boîte de dialogue **Trace technique** par-dessus la file. La page en dessous ne bouge pas, de sorte qu'en fermant la boîte de dialogue vous vous retrouvez exactement où vous étiez, avec votre position de défilement et, dans l'espace d'un agent, votre onglet en cours intacts. À l'intérieur, vous pouvez suivre le contrôle complet qui a produit la proposition : ce que l'agent a consulté, les étapes qu'il a suivies et le temps que chacune a pris, ainsi que les éléments qu'il a rassemblés. Utilisez-la chaque fois qu'un brouillon ou une mise à jour vous surprend et que vous voulez en connaître le raisonnement. C'est la même boîte de dialogue que celle décrite sur la page [Activité](agents-activity.md).

---

## Conseils

- Travaillez de haut en bas : videz **Nécessite votre décision**, puis videz **Attention requise** avec **Relancer l'analyse** ou **Prendre acte**. **En cours** et **Récemment terminés** ne requièrent rien de votre part.
- Rien ici n'a atteint le demandeur tant que vous ne l'avez pas approuvé. Lire un brouillon, le tracer ou le laisser dans la file ne change rien au ticket.
- Rejetez plutôt que d'ignorer. Une proposition rejetée reste dans le journal d'audit avec votre note facultative, ce qui est bien plus utile par la suite qu'une proposition qui a simplement expiré sans avoir été traitée.
- Écartez, plutôt que de rejeter, une proposition que vous ne comptez tout simplement pas envoyer. Si un brouillon est juste mais ne doit pas partir (un ticket sensible, un collègue qui a déjà répondu), **Écarter** le met de côté sans pénaliser l'agent. Réservez **Rejeter** aux propositions réellement erronées.
- L'absence de note de secours est une bonne nouvelle, pas une information manquante. Réservez votre lecture la plus attentive aux brouillons qui *en* portent une.
- Si un changement approuvé se retrouve dans **Attention requise**, la légende rouge et le bouton **Trace** vous indiquent si c'est l'agent, un contrôle de sécurité ou le système de tickets connecté qui l'a bloqué : corrigez la cause sous-jacente, puis utilisez **Relancer l'analyse**, plutôt que de réapprouver à l'aveugle.
- Ne prenez pas acte pour faire disparaître un chiffre. **Prendre acte** atteste qu'une personne a examiné l'échec ; une file que vous videz sans la lire vaut moins qu'une file que vous laissez telle quelle.
- La file combinée `/agents/approvals` est la plus rapide lorsque vous exécutez plusieurs agents ; passez à l'onglet **Approbations** propre à un agent lorsque vous voulez vous concentrer sur celui-là uniquement.
