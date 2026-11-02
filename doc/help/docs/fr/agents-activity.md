# Agents IA : Activité

L'Activité est l'historique en lecture seule de tout ce que vos agents ont fait et de toutes les décisions que vous avez prises concernant leur travail : les contrôles qu'ils ont lancés, les propositions qu'ils ont rédigées, vos approbations et rejets, les modifications réellement envoyées à un ticket, les limites de sécurité déclenchées, les pauses, les changements de configuration et les erreurs. Rien sur cette page ne modifie un ticket ni un agent. Elle existe pour vous permettre de répondre à la question « que s'est-il passé, quand et pourquoi » après coup, et pour vous fournir une trace écrite lorsqu'un demandeur ou un technicien vous interroge. La même chronologie apparaît, déjà filtrée sur un agent, au bas de l'[onglet Suivi](agents-workspace.md) de cet agent ; cette page en est la version complète, couvrant tous les agents.

## Où la trouver

- Espace de travail : **Agents IA**
- Chemin : **Agents IA → Activité**
- Route : `/agents/activity`
- Autorisation : `ai_agents:reader` (consultation uniquement : toute personne pouvant ouvrir Agents IA peut lire la chronologie)
- Nécessite que l'IA soit activée sur l'instance. Cette page est en lecture seule : rien ici n'approuve, ne rejette ni n'envoie quoi que ce soit. Pour agir sur une proposition, utilisez les [Approbations](agents-approvals.md).

---

## Filtres

La chronologie affiche les événements les plus récents en premier. Deux contrôles permettent de l'affiner :

- **Numéro de ticket** : saisissez un numéro de ticket et appuyez sur **Rechercher** (ou Entrée) pour ne voir que les événements liés à ce ticket précis. C'est le moyen le plus rapide de reconstituer l'histoire complète d'un même ticket : chaque contrôle, brouillon, décision et modification, dans l'ordre. Videz le champ et relancez la recherche pour revenir au flux complet.
- **Puces de type** : sept bascules en haut (**Proposition**, **Décision**, **Exécution**, **Configuration**, **Vérifications**, **Pause** et **Erreur**). Chacune est un interrupteur, et non un choix unique : une puce pleine est incluse, une puce en contour est exclue, et vous pouvez en combiner autant que vous le souhaitez.

**Par défaut, toutes les catégories sont activées sauf Vérifications.** Ce choix est délibéré. Un agent en surveillance écrit une entrée de vérification toutes les quelques minutes, qu'il ait trouvé quelque chose ou non, et si on les laisse actives, ces lignes enfouissent les entrées que vous lisez vraiment. Activez **Vérifications** lorsque vous voulez confirmer qu'un agent est bien vivant, ou lorsque vous cherchez pourquoi il a (ou n'a pas) pris en charge quelque chose.

Désactiver toutes les puces ne laisse rien à afficher, et la chronologie le dit : *Choisissez au moins un type d'activité pour afficher le journal.*

La recherche par ticket et les puces de type se combinent, ce qui vous permet de consulter, par exemple, uniquement les erreurs du ticket #482. Votre sélection est inscrite dans l'adresse de la page : une vue filtrée est donc un lien que vous pouvez envoyer à un collègue.

---

## Lire une entrée de la chronologie

Chaque entrée correspond à un événement, et elle contient suffisamment de contexte pour être comprise d'un coup d'œil :

- Une **puce de type** : à laquelle des sept catégories ci-dessus l'événement appartient.
- Une **puce de type d'action** (lorsque l'événement porte sur un type de travail précis sur le ticket) : **Note interne**, **Réponse demandeur**, **Mise à jour classification**, **Mise à jour statut**, **Affectation** ou **Observateurs**.
- Une **pastille de statut** avec un libellé en langage clair (par exemple « En attente de validation », « Terminé », « Rejeté », « Écarté », « Attention requise ») décrivant où en est cet élément.
- Le **nom de l'agent** et le **ticket** concerné (affiché sous la forme `#N`).
- Un **titre d'événement**, par exemple « Proposition créée » ou « Vérification des tickets : 3 nouveaux tickets ».
- Un **aperçu sur une ligne** de l'essentiel (la première ligne d'un message rédigé, une modification de champ ou le motif), de sorte que vous n'avez souvent rien à développer.
- Un **horodatage**, ainsi que **Afficher les détails** et, lorsqu'un contrôle est à l'origine de l'événement, **Trace**.

Les titres s'adaptent au type d'agent : ce qui se lit **Vérification des tickets** sur un agent helpdesk se lit **Vérification des alertes** sur un agent de supervision, de sorte qu'un parc mixte reste lisible.

### Ce que signifient les événements

Le catalogue couvre l'ensemble du cycle de vie du travail des agents. Regroupés selon la puce de type dont ils relèvent :

- **Proposition** : l'agent a rédigé quelque chose à examiner. Une réponse, une note ou une mise à jour de ticket a été créée et attend une décision.
- **Décision** : une proposition a été **approuvée**, **rejetée** ou **écartée** (mise de côté sans pénaliser l'agent), ou un élément d'attention a été **pris en compte**. Les approbations et les rejets peuvent aussi être automatiques une fois que ce type d'action fonctionne de manière autonome ; un écartement et une prise en compte sont toujours le choix délibéré d'une personne.
- **Exécution** : une modification a été réellement envoyée au ticket, ou une exécution a **échoué**. Les exécutions automatiques et leurs échecs apparaissent également ici.
- **Configuration** : quelqu'un a modifié le fonctionnement d'un agent. Ses **paramètres de surveillance** ou sa **configuration** générale ont été mis à jour, un type d'action a été basculé en **automatique** ou **désactivé** (ou **rétrogradé** en mode demander d'abord), ou un **agent a été supprimé**. Les limites de sécurité qui se déclenchent (**Limite quotidienne atteinte** et **Limite de sécurité par exécution atteinte**) sont classées ici aussi plutôt que sous Erreur, car un plafond qui fait son travail est un arrêt délibéré, pas un dysfonctionnement.
- **Vérifications** : l'agent a cherché du travail. Une entrée par vérification, qu'il ait trouvé quelque chose ou non. Voir ci-dessous.
- **Pause** : une **pause d'urgence a été activée** ou **levée**, ou la **surveillance des tickets a été suspendue** parce qu'une pause était en vigueur.
- **Erreur** : un incident est survenu que vous devez connaître. Un **ticket n'a pas pu être traité**, une **exécution a échoué**, la **surveillance des tickets est en échec**, ou une exécution automatique a échoué.

Nul besoin de les mémoriser : les titres d'événements sont rédigés en langage clair, et les puces de type vous permettent de filtrer ceux qui vous intéressent.

### Les entrées de vérification

Une entrée de vérification vous dit dans son titre ce que l'agent a trouvé, sans que vous ayez à développer quoi que ce soit :

- **Vérification des tickets : aucun nouveau ticket** : il a regardé et il n'y avait rien à faire. C'est à cela que ressemble un agent sain et tranquille.
- **Vérification des tickets : 3 nouveaux tickets** : trois tickets ont été pris en charge.
- **Vérification des tickets : 3 nouveaux tickets, 2 déjà vus, 1 erreur** : la même chose, plus des tickets qu'il avait déjà traités et un problème rencontré.
- **Vérification des tickets : Surveillance désactivée** / **En pause** / **Ignorée** / **Échec** : la vérification n'a pas fait son travail habituel, et le motif suit lorsqu'il y en a un.

**Afficher les détails** décompose cette même vérification en quatre chiffres (**Vus**, **Mis en file**, **Déjà vus**, **Traités**), plus le motif et les éventuels messages d'erreur. C'est la manière honnête de répondre à « pourquoi l'agent n'a-t-il pas pris le ticket #482 ? » : si **Vus** est élevé mais que **Mis en file** est à zéro, le ticket a bien été examiné puis écarté par votre ciblage ; si **Vus** est à zéro, l'agent ne l'a jamais vu du tout.

---

## Afficher les détails

**Afficher les détails** développe une entrée pour révéler l'ensemble des éléments qui la sous-tendent. Selon l'événement, vous pouvez voir :

- Le **décompte de la vérification** décrit ci-dessus.
- Le **Message proposé** complet : le texte intégral rédigé par l'agent, pas seulement l'aperçu sur une ligne.
- Les **modifications de champ**, écrites sous la forme « Champ : ancien → nouveau » (par exemple « Statut : Assigné → En attente »), de sorte qu'une modification de classification, de statut, d'affectation ou d'observateur est lisible sans ouvrir le ticket.
- Le **Motif** : la courte justification de la proposition par l'agent.
- La **Note du relecteur** : la note saisie au moment où la proposition a été tranchée.
- Une ligne **« {n} sources citées »** : combien de résultats de votre [bibliothèque de connaissances](knowledge.md) ont étayé la réponse rédigée. C'est le signal honnête indiquant si la réponse s'appuie sur vos propres sources ; une réponse avec des sources citées est une réponse que l'agent peut assumer. Son absence sur une réponse administrative ou procédurale est normale et ne signifie pas qu'un problème est survenu. Pour savoir comment cela se traduit lors de l'examen, voir les [Approbations](agents-approvals.md).

---

## Afficher plus

La chronologie charge les 50 entrées correspondantes les plus récentes et vous indique où vous en êtes : **{n} sur {total} affichées**. **Afficher plus** ajoute les 50 suivantes sans perturber ce que vous avez déjà lu ni les filtres que vous avez posés. Il n'y a pas de numéro de page où perdre votre place : continuez d'appuyer jusqu'à atteindre ce que vous cherchez.

Le compteur mérite d'être lu pour lui-même. « 50 sur 1 284 affichées » est un signal qu'il vaut mieux resserrer les filtres que de continuer à cliquer.

Les entrées ne restent pas indéfiniment. Chaque agent conserve son propre historique aussi longtemps que l'indique son réglage **Conserver l'historique d'activité (jours)** : 30 jours par défaut, et tout ce qui est plus ancien est supprimé automatiquement pendant la nuit. Si vous devez garder une trace au-delà, capturez-la tant qu'elle est là. Le travail qu'il vous reste à décider n'est jamais purgé.

---

## Trace technique

Le bouton **Trace** ouvre la boîte de dialogue **Trace technique** par-dessus la page. Rien ne change de page, de sorte qu'en la fermant vous vous retrouvez exactement où vous étiez. Il s'agit d'une vue de diagnostic facultative destinée aux administrateurs qui investiguent un contrôle précis ; vous n'en avez jamais besoin pour l'examen quotidien, et tout ce qu'un demandeur ou un technicien pourrait vouloir figure déjà dans **Afficher les détails**.

Elle reconstitue le déroulement d'un même contrôle :

- Quand l'exécution a **démarré** et **terminé**, et combien de temps elle a **duré** au total.
- Les **étapes** numérotées suivies par l'agent, chacune avec son propre statut et sa durée.
- Les **appels d'outils** qu'il a effectués, avec leur durée, utiles lorsqu'un contrôle a été lent ou a expiré.
- Les **sources** qu'il a rassemblées, présentées sous forme d'un bref résumé accompagné du type de source dont elles proviennent.

Ces durées font tout l'intérêt de la boîte de dialogue : un contrôle qui a pris quatre minutes contient une étape lente, et c'est ici que vous la trouvez.

Une bascule **Afficher la trace brute** révèle l'enregistrement sous-jacent lisible par machine pour les rares cas où vous avez besoin du détail exact ; laissez-la repliée sinon.

Le même bouton **Trace** figure dans les [Approbations](agents-approvals.md) et dans l'onglet **Suivi** d'un agent, et ouvre cette même boîte de dialogue sur place. C'est la façon habituelle d'arriver ici pendant l'examen.

---

## Conseils

- La recherche par **numéro de ticket** est le moyen le plus rapide de transmettre à quelqu'un l'histoire complète et ordonnée d'un ticket (contrôle, proposition, décision et ce qui a été envoyé) sans naviguer dans le ticket lui-même.
- **Activez Vérifications lorsqu'un agent semble inactif, puis désactivez-les.** C'est ce qui fait la différence entre « l'agent est cassé » et « l'agent surveille et il n'y a rien à faire ». Mais c'est bruyant, d'où sa désactivation par défaut.
- Utilisez le filtre **Exécution** pour ne voir que ce qui est réellement sorti. Les propositions et les décisions sont des intentions ; les exécutions sont les modifications qu'un demandeur ou un technicien peut voir.
- Une entrée **Limite quotidienne atteinte** correspond au système fonctionnant comme prévu, pas à un bug. Si un agent est resté silencieux le reste de la journée, c'est généralement pour cette raison : relevez ses limites quotidiennes dans les [Paramètres](agents-workspace.md) de l'agent si le plafond est trop serré pour votre volume, et consultez-y les chiffres **Aujourd'hui** avant de choisir une nouvelle valeur.
- N'utilisez **Trace** que lorsque vous enquêtez sur un contrôle lent ou en échec ; pour « qu'a-t-il dit et pourquoi l'avons-nous approuvé », **Afficher les détails** contient déjà la réponse.
- Cette page ne modifie jamais rien ; il est donc sûr d'accorder un accès en lecture seule (`ai_agents:reader`) à toute personne devant auditer le comportement des agents sans pouvoir agir dessus.
