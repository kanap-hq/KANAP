# Agents IA — Espace de l'agent

L'espace de l'agent est l'endroit où vit un agent en particulier : vous le pilotez, observez ce qu'il fait, examinez ses propositions, jugez de sa performance et — si vous êtes administrateur — configurez chaque détail de son fonctionnement. C'est la surface la plus détaillée de l'espace Agents IA. Tout ce qui concerne un agent donné et qui n'est pas un contrôle à l'échelle du parc s'y trouve : une barre d'actions qui vous suit sur chaque onglet, et quatre onglets en dessous. Les administrateurs peuvent cliquer sur le nom de l'agent ou sur la courte description sous ce nom pour le renommer ou mettre à jour ce résumé ; les deux apparaissent toujours sur la carte de l'agent dans le parc.

Ouvrez un agent en cliquant sur sa carte dans [Agents IA — Vue d'ensemble](agents-overview.md). L'espace s'ouvre toujours sur **Suivi** ; vous pouvez créer un lien direct vers n'importe quel onglet, et les liens provenant d'autres parties du produit vous amènent directement au bon onglet.

## Où le trouver

- **Espace de travail :** Agents IA
- **Chemin :** **Agents IA → Vue d'ensemble →** ouvrez la carte d'un agent
- **Route :** `/agents/:agentKey`
- **Autorisation :** la consultation nécessite le rôle Lecteur des Agents IA (`ai_agents:reader`). Lancer un contrôle, tester l'agent et décider des propositions nécessitent le niveau contributeur (`ai_agents:contributor`). Changer le mode de fonctionnement, mettre l'agent en pause et accéder à l'onglet **Paramètres** nécessitent le niveau Administrateur des Agents IA (`ai_agents:admin`) ; l'administrateur des Paramètres IA (`ai_settings:admin`) débloque également l'ensemble.
- **Disponibilité :** l'ensemble de l'espace Agents IA nécessite que l'IA soit activée sur l'instance. Si vous ouvrez un lien vers un agent qui n'existe pas pour votre tenant, vous verrez **Agent introuvable** — « Cet agent n'est pas disponible dans le tenant actuel. » — avec un moyen de revenir au parc.

Les onglets sont **Suivi**, **Approbations**, **Performance et autonomie** et **Paramètres**. Les lecteurs voient les trois premiers ; seuls les administrateurs voient **Paramètres**.

---

## La barre d'actions

Juste sous le nom de l'agent se trouve une fine barre de commandes, alignée à droite, qui reste visible sur **chaque** onglet. Elle ne porte que des actions — les chiffres en lecture seule de l'agent vivent dans la section **État** de l'onglet **Suivi**. L'idée est que vous n'ayez jamais à quitter ce que vous êtes en train de faire pour démarrer, arrêter ou tester l'agent.

### Le contrôle de mode de fonctionnement

La première commande, c'est l'agent lui-même. Fermé, le contrôle affiche l'état réel de l'agent sous forme d'une pastille de couleur et d'un libellé — **Surveillance — avec validation**, **Surveillance — partiellement automatique**, **Test**, **Désactivé**, **En pause**, **Non démarré** ou **Archivé**. Ouvrez-le (administrateurs, sur un agent qui n'est ni en pause ni archivé) et il propose les trois modes de fonctionnement :

| Mode | Signification |
| --- | --- |
| **Arrêté** | Rien ne s'exécute, pas même un contrôle manuel. |
| **Manuel uniquement** | Ne s'exécute que sur demande — **Contrôler maintenant** et les tests fonctionnent, mais l'agent ne regarde jamais de lui-même. |
| **Surveillance** | Contrôle de lui-même à la fréquence que vous définissez, en plus de tout ce que fait **Manuel uniquement**. |

Lisez le libellé fermé comme la vérité et le menu comme l'intention : un agent réglé sur **Surveillance** mais actuellement retenu par une pause affiche **En pause**, et non **Surveillance**, de sorte que le contrôle ne vous dit jamais que l'agent travaille alors que ce n'est pas le cas.

**Manuel uniquement** est le mode qui rend un nouvel agent sans danger à essayer. C'est là qu'il faut rester pendant que vous ajustez un persona et son ciblage : vous pouvez exécuter l'agent aussi souvent que vous le souhaitez sur de vrais tickets, mais rien ne se produit sans que vous le demandiez. Ne passez en **Surveillance** que lorsque ce qu'il rédige vous convient.

### Les autres commandes

- **Contrôler maintenant** (**Vérifier les nouvelles alertes** sur un agent de supervision) lance un contrôle immédiatement au lieu d'attendre le prochain contrôle planifié. La commande est désactivée lorsque l'agent est **Arrêté** (« Activez d'abord l'agent. ») ou en pause (« Levez d'abord la pause. »), avec le motif dans l'infobulle.
- **Tester sur un ticket** (**Tester sur une alerte** sur un agent de supervision) vous amène à la section de test de l'onglet **Suivi**, quel que soit l'onglet où vous étiez.
- **Mettre l'agent en pause** est le frein d'urgence rouge, et ce n'est délibérément pas la même chose qu'**Arrêté**. Il demande un motif, puis suspend les contrôles de cet agent *et toute écriture en attente* jusqu'à ce que vous leviez la pause. Les autres agents continuent de fonctionner. Tant qu'une pause est active, une bannière d'avertissement affiche **Pause d'urgence active : {motif}** et la commande devient **Lever la pause**. Une pause définie pour l'ensemble du tenant affiche à la place **En pause pour tous les agents** et vous renvoie vers la vue d'ensemble du parc — vous ne pouvez pas lever une pause à l'échelle du tenant depuis un seul agent.
- **Archiver l'agent** (administrateurs) met l'agent à la retraite : il cesse de surveiller et de s'exécuter, conserve sa configuration et son historique, et vous demande d'abord de confirmer. Lorsque l'agent est déjà archivé, cette commande devient **Restaurer l'agent** et le ramène à **Arrêté**.

Utilisez **Arrêté** pour mettre un agent au repos pendant un temps ; utilisez **Mettre l'agent en pause** lorsque quelque chose ne va pas et que vous voulez aussi geler le travail en attente ; utilisez **Archiver l'agent** lorsque vous en avez terminé.

---

## Suivi

L'onglet Suivi est le tableau de bord en temps réel de cet agent en particulier. Il se rafraîchit à mesure que le travail avance, c'est donc l'onglet à garder ouvert lorsque vous surveillez l'activité.

### État

La section **État** est en lecture seule : c'est désormais là que se trouve, sur une seule ligne de chiffres, chaque fait concernant l'état actuel de l'agent.

- L'état de l'agent, dans les mêmes termes que la barre d'actions.
- **Surveillance** — **Tous les tickets**, **Filtré** (lorsque votre ciblage restreint le périmètre) ou **Désactivé**. Un agent de supervision affiche **Toutes les alertes**, **Filtré** ou **Désactivé**.
- **Dernier contrôle** — le résultat du contrôle le plus récent.
- **Prochain contrôle** — **Toutes les N minutes**, selon le réglage **Contrôler toutes les (minutes)**, tant que l'agent surveille. Sinon **Non renseigné**, puisque rien n'est planifié.
- **File** — *N en attente · N en cours* : les propositions qui attendent votre décision, et les tickets sur lesquels l'agent travaille en ce moment.
- **N en échec**, en rouge, lorsque quelque chose s'est bloqué et ne réessaiera pas de lui-même. Ce sont les éléments que vous retrouverez sous **Attention requise** dans les [Approbations](agents-approvals.md).
- **Exécutions du jour**, **Tokens du jour** et **Coût du jour**, chacun sous la forme *utilisé / plafond*. Ce sont les limites de sécurité quotidiennes définies dans **Paramètres**, et c'est ici que vous remarquez un agent sur le point de devenir silencieux pour la journée. (Agents de support uniquement — les agents de supervision ne se mesurent pas ainsi, ces chiffres sont donc masqués plutôt qu'affichés comme des zéros trompeurs.)

### Tester sur un ticket

**Tester sur un ticket** exécute l'agent une seule fois sur un ticket que vous désignez — le moyen le plus rapide de voir comment il se comporte avant de le laisser surveiller de lui-même, ou de vérifier son raisonnement sur un cas précis. Saisissez un numéro de ticket (par exemple `64`) et cliquez sur **Lancer le test**. L'agent effectue une passe complète sur ce seul ticket ; tout ce qu'il propose arrive dans l'onglet **Approbations** pour votre examen, comme n'importe quel autre travail. Rien n'est envoyé au demandeur sans approbation.

Un agent de supervision dispose à la place de **Tester sur une alerte** : donnez-lui un identifiant d'alerte et son diagnostic apparaît en dessous, dans la même présentation de dossier qu'un diagnostic enregistré.

Le test fonctionne aussi bien en **Manuel uniquement** qu'en **Surveillance**, et c'est précisément l'intérêt : c'est le compagnon d'un agent auquel on ne fait pas encore confiance.

### Activité récente

Le bas de l'onglet Suivi intègre la chronologie en temps réel des contrôles, propositions, décisions, exécutions, pauses et erreurs de cet agent. C'est le même flux que la page [Activité](agents-activity.md) complète, déjà filtré sur cet agent — mêmes bascules de catégorie, même **Afficher plus**, même boîte de dialogue de trace.

---

## Approbations

L'onglet **Approbations** est la file d'examen — réponses, notes et mises à jour de tickets proposées, en attente de votre décision — limitée à ce seul agent. Il se comporte exactement comme la file autonome, y compris pour l'approbation en masse, la confirmation d'action terminale et les commandes **Prendre acte** et **Relancer l'analyse** des lignes **Attention requise**. Consultez [Approbations](agents-approvals.md) pour l'explication complète ; rien n'y change, si ce n'est que vous ne voyez que les éléments de cet agent.

---

## Performance et autonomie

Cet onglet répond à une seule question : l'agent est-il en train de gagner en indépendance ? Il place les éléments de preuve et le levier côte à côte, pour que vous n'ayez jamais à juger à un endroit et à agir à un autre.

### Les chiffres clés

- **Acceptation** — la part de ses propositions que vous avez approuvées. C'est le chiffre qui influence le plus la possibilité pour un type d'action de passer en automatique.
- **Écartées** — la part des propositions examinées que vous avez mises de côté plutôt qu'approuvées ou rejetées. Un écartement ne pénalise pas l'agent, ce chiffre est donc distinct de l'acceptation. Lisez une valeur durablement élevée comme un problème de ciblage — l'agent prend en charge des tickets qu'il ne devrait pas traiter — et corrigez-le dans **Paramètres → Ciblage**, plutôt que d'y voir un problème de qualité des réponses.
- **Délai d'approbation** — le temps typique, en minutes, entre l'apparition d'une proposition et la décision prise à son sujet. Un chiffre en hausse signifie généralement que la file a besoin de plus d'attention de la part des relecteurs, et non que l'agent est moins performant.
- **Taux de connaissances** — la fréquence à laquelle ses réponses s'appuyaient sur vos sources de connaissances.
- **Coût par ticket** — la dépense moyenne par ticket traité, en EUR. (Le coût à l'échelle du parc se trouve dans la [Vue d'ensemble](agents-overview.md).)
- **Exécutions par ticket** — le nombre de contrôles nécessaires, en moyenne, pour résoudre un ticket.

### Tendances

Deux graphiques couvrent les 14 derniers jours. **Tendances** trace les **Proposées** face aux **Exécutées** par jour, de sorte que vous pouvez voir l'agent monter en puissance, un pic, ou une journée où il est resté silencieux. **Coût par jour** se place en dessous, sous forme d'un graphique plus petit sur le même axe de jours — les décomptes et les euros ne partagent délibérément pas la même échelle. Tant que l'agent n'a rien fait, les deux affichent **Aucune activité enregistrée pour le moment.**

### L'échelle d'autonomie

Par défaut, chaque type d'action **demande d'abord** — l'agent propose et vous attend. Cette section est l'endroit où vous promouvez un type d'action en **Automatique**, un type à la fois, une fois qu'il l'a mérité.

Chaque ligne affiche le type d'action, son mode actuel (**Demander d'abord** ou **Automatique**) et une ligne de progression : décisions capturées par rapport au nombre requis, taux d'acceptation par rapport au taux requis, et jours d'activité par rapport aux jours requis. Lorsqu'une ligne n'est pas encore éligible, elle explique pourquoi en termes simples — *Pas encore assez de propositions examinées.*, *Le taux d'acceptation est sous le seuil.*, *Pas encore assez de jours d'activité.*

**Tous les types d'action ne présentent pas le même risque, et l'échelle le dit désormais.**

- **Note interne**, **Mise à jour classification** et **Mise à jour statut** constituent le palier à faible risque. Rien ne sort de votre équipe et rien ne change de mains. Les seuils de preuve sont ici des recommandations : lorsqu'un type est éligible, **Activer** ouvre une courte confirmation ; lorsqu'il ne l'est pas, **Forcer** vous permet de l'accorder malgré tout avec un motif écrit.
- **Réponse demandeur**, **Affectation** et **Participants** constituent le palier à risque élevé, et leurs lignes sont signalées par une bordure d'avertissement et un rappel d'une ligne de ce à quoi vous consentiriez — *L'agent répondrait au demandeur sans que personne ne relise avant.* Ces types peuvent désormais être automatisés, ce qui n'était pas possible auparavant. Mais l'octroi exige **toujours** une confirmation explicite et un motif écrit, même lorsque tous les seuils sont déjà atteints et que la ligne est éligible. Le motif est conservé dans l'historique de l'agent afin que votre équipe puisse voir qui l'a accepté, et pourquoi.

Dans les deux cas, la confirmation vous rappelle que les actions automatiques respectent toujours les limites quotidiennes et la pause d'urgence, et que KANAP peut de lui-même les ramener en mode demander d'abord (voir ci-dessous). **Désactiver** ramène immédiatement tout type d'action automatique au mode demander d'abord.

**Quand un type d'action automatique recule.** Deux garde-fous agissent sans vous :

- **Une mauvaise heure retient l'action suivante.** Si un type d'action a connu une action en échec, une proposition rejetée, une erreur du système connecté ou un pic de coût inhabituel au cours des 60 dernières minutes, l'action suivante de ce type attend dans la file d'approbations au lieu d'être appliquée. Le type reste sur **Automatique**, et les actions s'appliquent de nouveau une fois l'heure redevenue calme.
- **Une acceptation faible désactive le type.** Si moins de la moitié des propositions tranchées d'un type d'action ont été approuvées, KANAP remet ce type en **Demander d'abord** et inscrit *Mode automatique rétrogradé* dans l'[Activité](agents-activity.md) de l'agent. Vous pouvez le promouvoir de nouveau dès qu'il remplit les conditions.

Deux blocages sont absolus et aucun motif ne les lèvera : un type d'action que vous avez désactivé dans **Capacités** (*Cette action n'est pas activée pour cet agent.*) et un incident ouvert (*Un incident ouvert bloque l'automatisation.*).

Automatique ne signifie jamais sans supervision. Les limites de sécurité strictes, les budgets, les contrôles de fraîcheur et les pauses s'appliquent de la même manière, quel que soit le mode d'un type d'action.

---

## Paramètres

L'onglet **Paramètres** est réservé aux administrateurs et regroupe tous les réglages de configuration de l'agent. Il **s'enregistre automatiquement** : il n'y a pas de boutons d'enregistrement, et chaque section affiche un petit indicateur **Enregistrement…** / **Enregistré** dans son en-tête à mesure que vos modifications sont écrites. Si vous changez d'onglet alors qu'un enregistrement est encore en cours, celui-ci est d'abord mené à son terme — et s'il échoue, le changement d'onglet est annulé pour que l'erreur et votre modification restent à l'écran.

Les sections suivent l'ordre dans lequel on configure réellement un agent : décidez ce qu'il regarde, puis ce qu'il peut faire, puis ce qu'il est, puis ce qu'il sait, puis à quel rythme il peut travailler.

### Ciblage

Le ciblage détermine quels tickets l'agent surveille. (Qu'il surveille ou non relève du mode de fonctionnement, dans la barre d'actions — le ciblage ne décrit que le périmètre.)

Les préréglages rapides — **Nouveaux tickets**, **Tous ouverts**, **Traités par cet agent** — insèrent un jeu de filtres de départ ; si vous avez déjà des filtres, une confirmation vous est demandée avant leur remplacement. Le générateur de filtres vous permet de combiner des conditions : tous les filtres sont combinés, et les valeurs disponibles proviennent directement du système de tickets connecté. Sélectionner une catégorie ou une entité inclut tout ce qui se trouve en dessous, et le générateur le précise.

Une ligne sous les filtres indique combien de tickets correspondent actuellement. Si un autre agent surveille déjà certains de ces tickets, ce nombre est mentionné aussi — c'est le signal que deux agents risquent de se disputer le même travail. Quand la ligne dit **au moins N**, la file réelle est plus grande que l'aperçu (vos plafonds par contrôle limitent le nombre de tickets inspectés).

Les agents de supervision disposent de la même section, avec des filtres portant sur l'état de l'alerte, la gravité, l'acquittement, le groupe, l'équipement et le type de contrôle.

### Capacités

Les capacités viennent en premier, car elles cadrent tout le reste : une rangée de cases à cocher déterminant quels types de modification l'agent peut *un jour* proposer — **Notes internes**, **Réponses demandeur**, **Classification**, **Mises à jour statut**, **Affectation** et **Participants**. En décocher une supprime entièrement ce type d'action : l'agent ne peut pas le proposer, quoi que disent les instructions, et il ne peut pas être promu dans l'échelle d'autonomie. Les agents de supervision n'ont pas cette section.

**L'affectation** mérite un mot, car elle fonctionne par les instructions et non par un réglage. Une fois cochée, l'agent peut proposer d'affecter un ticket à un **groupe de techniciens** de l'outil de ticketing, et la règle qui dit quel groupe s'écrit dans les **Instructions**, en langage courant — par exemple *« Si la question concerne SAP, affecte le ticket au groupe SAP-team. Si elle concerne Teamcenter, affecte-le à PLM-team. Dans tous les autres cas, affecte-le à Tech-desk. »* L'agent ne choisit que parmi les groupes que l'outil de ticketing marque comme affectables, et il **ajoute** un groupe : il ne retire jamais un technicien ni un groupe déjà présent sur le ticket. Comme toute autre action, elle est soumise à votre approbation tant que vous ne l'avez pas promue sur l'échelle d'autonomie. Les instructions peuvent aussi nommer un **technicien**, à condition qu'il appartienne à un groupe affectable — par exemple *« les tickets sur le système de badges vont à Marie Dupont »*. L'agent privilégie un groupe tant qu'aucune personne n'est nommée, et une même série de propositions porte au plus un groupe et un technicien. Nommer un technicien est également additif : personne de déjà présent sur le ticket n'est retiré.

**Classification** suit également les règles des **Instructions**. Activez-la et écrivez, par exemple, *« Pour les tickets SAP, utilisez la catégorie Software > SAP, le type incident et la priorité high. »* L’agent choisit dans le catalogue de l’outil de ticketing et peut modifier plusieurs champs dans une même proposition, y compris des valeurs déjà renseignées. Les champs inchangés sont omis. Sans règle dans les instructions, il ne complète pas la classification par des valeurs par défaut. Vous pouvez aussi préciser l’urgence sur l’échelle des priorités. Les modifications nécessitent une approbation, sauf si vous avez promu la classification sur l’échelle d’autonomie.

### Objectif

L'objectif, c'est qui est l'agent et comment il rédige :

- **Objectif** — ce que l'agent est là pour faire, en une ligne. Il le relit à chaque exécution.
- **Instructions** — les règles internes, rédigées librement en lignes ou en paragraphes. Elles ne peuvent pas élargir ce que l'agent a le droit de faire. Une seule limite : 10 000 caractères au total — au-delà, une partie du texte ne serait plus transmise à l'agent. Un compteur discret apparaît à l'approche de la limite ; au-delà, la section n'est pas enregistrée tant que vous n'avez pas raccourci le brouillon.
- **Langue de réponse** — **Langue du ticket** (répondre dans la langue utilisée par le demandeur), **Français**, **Anglais**, **Allemand** ou **Espagnol**.

À côté des instructions, **Noms utilisables dans les instructions** liste les statuts de ticket et leurs clés, les groupes de techniciens et les techniciens eux-mêmes lorsque **Affectation** est activée, ainsi que les catégories, priorités et types lorsque **Classification** est activée. Utilisez les noms ou les clés affichés. Les statuts, priorités et types sont listés directement ; les groupes de techniciens, les techniciens et les catégories restent repliés sur une seule ligne avec leur nombre et s’ouvrent un à la fois. Le champ de recherche en haut du panneau parcourt toutes ces listes en même temps, et un clic sur un nom l’insère dans les instructions à l’endroit du curseur. La recherche couvre toutes les catégories ; au-delà de 200, l’agent réduit d’abord ses choix aux sous-arbres des catégories de votre ciblage, puis conserve les 200 premiers noms complets par ordre alphabétique. La trace signale toute troncature restante.

Le nom de l'agent et sa courte description vivent dans le titre de l'espace, pas dans cette grille : cliquez dessus pour les modifier. La façon dont l'agent doit sonner, et le moment où il doit passer la main à une personne, appartiennent aux **Instructions** comme des règles ordinaires.

**Utiliser le contexte partagé** superpose à cet agent un contexte réutilisable sur votre environnement. Vous ne voyez que l'interrupteur tant que vous ne l'avez pas activé ; une fois activé, vous obtenez le sélecteur de profil, un raccourci **+ Nouveau profil** et un aperçu des lignes du profil sélectionné. Le contexte partagé oriente la façon dont l'agent interprète les tickets et rédige ses réponses, mais il ne constitue jamais une autorisation d'accès et n'est **pas** une source citable — contrairement aux [bibliothèques de connaissances](knowledge.md), dont les résultats *sont* cités dans les réponses. Gérez les profils sur la page [Contexte partagé](agents-shared-context.md). Si un profil a plus de lignes que l'agent ne peut en envoyer, un avertissement indique combien de lignes de contexte partagé ne sont pas envoyées au modèle — rien n'est écarté en silence.

**Voir le prompt effectif** est replié par défaut. Dépliez-le pour lire exactement ce qui est fourni au runtime de l'agent, compilé à partir de tout ce qui précède plus les règles propres à la plateforme. Utilisez le sélecteur pour inspecter chaque étape — **Planificateur d'actions**, **Planificateur** et **Interpréteur** sont les étapes où l'agent décide *quoi faire* ; **Synthèse** est celle où il rédige la réponse en s'appuyant sur vos sources de connaissances ; un agent de supervision dispose de **Diagnostic** à la place. L'aperçu se met à jour après chaque enregistrement. Comme l'indique l'aide, **la guidance ne peut pas remplacer les règles de sécurité** — rien de ce que vous écrivez dans le persona ne peut assouplir les limites strictes de la plateforme. Le même avertissement sur le contexte partagé apparaît ici si des lignes ont été laissées de côté.

### Sources de connaissances et web

D'où l'agent tire ses informations :

- **Rechercher dans les connaissances KANAP** — activé, l'agent puise dans vos [bibliothèques de connaissances](knowledge.md) et les cite dans ses réponses. Désactivé, l'agent répond à partir des connaissances propres au modèle (et du web, si celui-ci est activé).
- **Rechercher dans toutes les bibliothèques disponibles**, ou désactivez cette option pour choisir des **Bibliothèques** précises — l'agent ne recherche alors que dans celles-ci, dans la limite de ce à quoi il a accès. Les noms des bibliothèques proviennent de la section Base de connaissances.
- **Rechercher sur le web** — permet à l'agent de consulter également le web public ; les connaissances KANAP restent toujours prioritaires et les résultats web sont cités. Cet interrupteur n'est disponible que si la recherche web est activée pour l'ensemble de la plateforme. Dans le cas contraire, l'interrupteur est désactivé et une note vous renvoie vers votre administrateur — voir [Paramètres Plaid](ai-settings.md).

Les agents de supervision disposent ici de **Rechercher dans les données KANAP** à la place, qui permet à l'agent de consulter votre propre inventaire informatique — **Applications**, **Actifs**, **Interfaces**, **Connexions**, **Sites** — pour ajouter du contexte métier à un diagnostic.

### Paramètres d'exploitation

Les commandes de rythme et de budget. Quatre d'entre elles sont visibles d'emblée : **Contrôler toutes les (minutes)**, **Tickets par contrôle**, **Exécutions par jour** et **Coût par jour (EUR)**. Tout le reste, y compris le modèle IA, se trouve sous **Plus d'options**. Chaque champ porte une infobulle d'information qui explique son rôle et ce qui se passe lorsqu'il est atteint.

- **Contrôler toutes les (minutes)** — à quelle fréquence l'agent cherche de nouveaux tickets lorsqu'il surveille, entre **5** minutes et 24 heures (1440). C'est le levier le plus important sur l'activité — et le coût — d'un agent en surveillance. **Contrôler maintenant** s'exécute toujours immédiatement, quelle que soit cette valeur, et c'est ce chiffre que reprend **Prochain contrôle** dans l'onglet Suivi.
- **Tickets par contrôle** — le nombre maximum de tickets pris par l'agent à chaque contrôle (les autres attendent le suivant).
- **Exécutions par jour** et **Coût par jour (EUR)** — les plafonds quotidiens, chacun avec la consommation réelle du jour en dessous (**Aujourd'hui : …**). Une *exécution* est un passage sur un ticket, pas un contrôle planifié.
- **Modèle IA** (sous **Plus d'options**) : le modèle sur lequel cet agent s'exécute. **Modèle par défaut de l'organisation** est la valeur de départ, et le plus souvent la bonne : l'agent suit le modèle que votre organisation a défini par défaut, et évolue avec lui. Choisissez un modèle précis par son nom pour y rattacher cet agent : un modèle qui comprend les images pour une file riche en captures d'écran, un modèle local bon marché pour du tri à gros volume. Seuls les modèles actifs apparaissent ; ils se définissent sur la page [Modèles IA](ai-models.md). Lorsque votre organisation n'a aucun modèle par défaut, l'agent s'exécute sur le modèle inclus KANAP, et seulement après qu'un administrateur en a confirmé le fournisseur sur la page [Paramètres Plaid](ai-settings.md#confirmer-le-modele-inclus-kanap). Jusque-là, l'agent est en pause : les contrôles planifiés attendent, les tickets en file restent en attente, et un contrôle lancé à la main s'arrête avec un message qui en donne la raison. Un agent rattaché à un modèle que vous avez ajouté n'est pas concerné. Un modèle auquel un agent est rattaché ne peut pas être archivé dans son dos : il faut d'abord basculer l'agent sur un autre. À noter : lire la liste des modèles exige l'autorisation d'administration des paramètres IA (`ai_settings:admin`) : avec le seul rôle **Agent Admin**, la liste déroulante ne propose que **Modèle par défaut de l'organisation**, ce qui relève d'un manque d'autorisation et non d'un registre vide.
- **Requêtes fournisseur max** (sous **Plus d'options**) — le nombre maximum d'appels que l'agent adresse au système de tickets à chaque contrôle, pour ne jamais le saturer.
- **Réviser toutes les (heures)** — délai avant que l'agent puisse reprendre le même ticket, une fois qu'il n'y a plus rien en attente (appliqué, rejeté, écarté, ou fenêtre écoulée). Une proposition en attente occupe le ticket : l'agent n'écrit pas une autre paire tant que cette proposition n'est pas close, sauf si le ticket lui-même a changé.
- **Priorité agent** et **Collision ticket** — quel agent l'emporte lorsque plusieurs visent le même ticket (plus le nombre est bas, plus la priorité est haute), et ce que fait celui-ci lorsqu'un autre y travaille déjà : **Différer** (s'effacer) ou **Remplacer à priorité égale** (prendre le relais d'un agent de même priorité).
- **Fenêtre d'approbation (heures)** — combien de temps vous avez pour approuver. Toutes les propositions d'un même contrôle partagent cette fenêtre et expirent ensemble. Une proposition en cours occupe le ticket pendant toute cette fenêtre : **Réviser toutes les (heures)** à 24 heures avec une fenêtre d'approbation de 168 heures est un couple valide — vous avez une semaine pour décider, et l'agent n'écrit pas une autre paire entre-temps, sauf si le ticket change.
- **Si le ticket a changé** — ce qu'il advient d'une proposition en attente lorsque le ticket évolue avant votre décision : **Réviser à nouveau**, **Annuler** ou **Appliquer quand même**.
- **L'agent sur le ticket** — comment l'agent apparaît parmi les acteurs du ticket une fois l'une de ses réponses appliquée. **Prend le ticket (responsable)** est la valeur par défaut : le ticket est attribué à l'utilisateur de l'agent dans l'outil de ticketing, et passe à son statut « en cours » comme pour n'importe quel technicien. **Suit le ticket (observateur)** garde l'agent visible sur le ticket sans le prendre. **N'apparaît pas dans les acteurs** laisse les acteurs intacts : la réponse est publiée et rien d'autre ne change. Les notes internes ne prennent jamais un ticket ; au plus, elles ajoutent l'agent en observateur.
- **Conserver l'historique d'activité (jours)** — combien de temps la chronologie de cet agent est conservée, entre **7** et **90** jours, **30** par défaut. Les entrées, exécutions et propositions terminées plus anciennes sont supprimées automatiquement chaque nuit. Voir l'avertissement ci-dessous.

#### Limites de sécurité

Les cinq plafonds économiques forment leur propre groupe, sous un avertissement sans détour : ce sont des **arrêts fermes, pas des estimations**. Lorsque l'agent atteint l'un d'eux, il s'arrête pour le reste de la journée et vous attend — il repart le lendemain.

- **Tokens par exécution** et **Coût par exécution (EUR)** — le maximum que l'agent peut consacrer à *un seul ticket*. Atteindre l'un des deux arrête ce ticket, et rien n'est proposé pour lui. Une *exécution*, c'est un passage sur un ticket, et non un contrôle : un même contrôle peut dépenser le budget par exécution une fois pour chaque ticket qu'il prend en charge — à lire donc en regard de **Tickets max par contrôle**.
- **Exécutions par jour**, **Tokens par jour** et **Coût par jour (EUR)** — les plafonds quotidiens. Chacun des trois affiche en dessous la consommation réelle du jour (**Aujourd'hui : …**), afin que vous puissiez dimensionner un plafond par rapport à ce que l'agent consomme réellement plutôt qu'au jugé. Ce sont les mêmes chiffres que ceux de la section **État** dans Suivi.

Les deux plafonds de coût sont valorisés selon le **Modèle IA** assigné ci-dessus, à partir des tarifs enregistrés pour lui sur la page [Modèles IA](ai-models.md). Cela a une conséquence qu'il vaut mieux connaître : **un modèle gratuit (0 €) n'atteint jamais un plafond de coût**, puisque tout ce qu'il fait ne coûte rien. Avec le modèle inclus KANAP, avec un modèle local ou avec tout modèle que vous avez enregistré sans tarifs, les plafonds de coût sont inertes et les plafonds de **tokens** et d'**exécutions** sont votre seule véritable protection. Réglez-les en conséquence.

Les agents de supervision disposent de la même section sous une forme plus courte : **Modèle IA**, **Contrôler toutes les (minutes)**, **Alertes traitées par vérification**, **Requêtes vers l'outil de supervision par vérification** et **Conserver l'historique d'activité (jours)**.

!!! warning "Conservez au moins 30 jours d'historique si vous comptez utiliser le mode automatique"
    Le bilan d'un agent est mesuré sur les **28 derniers jours**. Régler **Conserver l'historique d'activité (jours)** en dessous de 30 supprime précisément les éléments que compte l'échelle d'autonomie, si bien qu'un agent peut sembler perdre un terrain qu'il avait déjà gagné. La valeur par défaut de 30 jours est choisie pour rester confortablement au-dessus de cette fenêtre — ne la raccourcissez que sur un agent que vous n'avez aucune intention de promouvoir. Rien de ce qu'il vous reste à décider n'est jamais purgé : les propositions en attente et les traces qui les sous-tendent sont conservées quel que soit le réglage.

---

## Conseils

- **Restez en Manuel uniquement avant de passer en Surveillance.** C'est la manière honnête d'ajuster un agent : exécutez-le à la main sur de vrais tickets, lisez ce qu'il rédige, ajustez, recommencez. Rien ne se produit que vous n'ayez demandé.
- **Arrêté et Pause sont deux outils différents.** **Arrêté** met l'agent au repos. **Mettre l'agent en pause** le gèle *ainsi que* le travail déjà en cours, et demande un motif qui rejoint le journal — recourez-y lorsque quelque chose ne va pas, pas lorsque vous avez terminé votre semaine.
- **La fréquence de contrôle est votre molette de coût.** Avant de relever un plafond quotidien, demandez-vous si l'agent a besoin de regarder toutes les cinq minutes. Sur une file calme, contrôler toutes les 30 ou 60 minutes ne change rien à une réactivité que vos demandeurs remarqueraient, et réduit la facture d'autant.
- **Dimensionnez les plafonds à partir des chiffres « Aujourd'hui ».** Chaque limite quotidienne affiche juste en dessous ce que l'agent a réellement consommé aujourd'hui. C'est une bien meilleure base qu'un chiffre rond.
- **La section État est votre voyant d'alerte précoce.** Un agent qui devient soudainement silencieux a généralement atteint un plafond quotidien — vérifiez *Exécutions / Tokens / Coût du jour* dans Suivi avant de conclure à une panne. Sur un modèle gratuit, seuls les plafonds de tokens et d'exécutions peuvent être en cause.
- **Développez l'autonomie un type d'action à la fois.** Promouvez d'abord les types à faible risque et laissez les réponses au demandeur en mode demander d'abord jusqu'à ce que l'acceptation soit durablement élevée. Les types à risque élevé vous sont désormais accessibles, mais la confirmation explicite n'est pas là par hasard : lisez ce que la ligne annonce que l'agent ferait avant d'y consentir.
- **Lisez le prompt effectif après une modification du persona.** C'est la référence exacte de ce que l'agent reçoit réellement, et cela rend évident le fait qu'une instruction a bien été prise en compte comme vous le souhaitiez.
- **Préférez le contexte partagé pour le contexte de fond, les bibliothèques pour les faits.** Le contexte partagé colore le jugement de l'agent mais n'est jamais cité ; seules les bibliothèques de connaissances (et, si elle est activée, le web) apparaissent comme sources dans une réponse.
- **Surveillez le Chevauchement dans l'aperçu de ciblage.** Un chiffre de chevauchement élevé signifie que deux agents se disputent les mêmes tickets — restreignez les filtres de l'un des agents, ou utilisez **Priorité agent** et **Collision ticket** pour décider qui l'emporte.
