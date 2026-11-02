# Agents IA : Contexte partagé

Le contexte partagé est une petite bibliothèque de guidance de fond réutilisable que vous rédigez une fois et confiez à vos agents. Un profil est un ensemble nommé de quelques lignes en langage clair au sujet de votre environnement IT : comment votre parc est géré, ce que vos agents doivent dire et ne pas dire, les conventions que suit votre centre de services. Le même profil peut être attaché à n'importe quel agent, où il façonne la manière dont cet agent interprète les tickets entrants et formule ses réponses.

L'objectif est la cohérence sans répétition. Au lieu de réapprendre à chaque agent les mêmes règles internes, vous les conservez dans un seul profil et pointez chaque agent vers celui-ci. Modifiez le profil une fois et chaque agent qui l'utilise récupère la nouvelle guidance.

Un point à clarifier dès le départ, car il conditionne tout bon usage de cette fonctionnalité : le contexte partagé n'est **ni une autorisation ni une source citable**. Il oriente le ton et l'interprétation, mais ses lignes ne sont jamais citées à un demandeur et n'accordent aucun nouvel accès aux données. Les faits que vous attendez qu'un agent cite ont leur place dans une [bibliothèque de connaissances](knowledge.md), pas ici.

---

## Où le trouver

- Espace de travail : **Agents IA > Contexte partagé**
- Route : `/agents/shared-context`
- Autorisations :
  - `ai_agents:reader` vous permet d'ouvrir la page et de consulter la liste des profils
  - `ai_agents:admin` (ou `ai_settings:admin`) est requis pour créer, modifier, archiver et restaurer des profils
- Disponibilité : toute la section Agents IA n'apparaît que lorsque l'IA est activée sur l'instance et que vous disposez de `ai_agents:reader`

Sans niveau administrateur, vous voyez toujours la liste complète des profils, mais le bouton **Nouveau profil** ainsi que les contrôles Modifier, Archiver et Restaurer de chaque ligne sont masqués. La page est en lecture seule pour vous.

---

## Ce qu'est un profil

Un profil regroupe trois éléments :

- Un **Nom** qui l'identifie, par exemple `Default IT environment`.
- Une **Description** facultative, pour votre propre référence, par exemple « Contexte IT à l'échelle de l'entreprise pour les agents du support ».
- Un ensemble de **Lignes de contexte** : une courte ligne de guidance de fond par ligne. Chaque ligne est une seule instruction ou un seul fait au sujet de votre environnement. Les lignes typiques ressemblent à « La plupart des utilisateurs ont des postes gérés. » ou « Ne jamais demander les mots de passe aux utilisateurs. »

Considérez ces lignes comme une guidance permanente plutôt qu'une base de connaissances. De bonnes lignes sont le genre de choses que vous diriez à un nouveau technicien dès le premier jour : comment l'environnement est configuré, quel ton adopter, et les règles strictes du type « à ne jamais faire ». Elles influencent les étapes où l'agent décide quoi faire et où il rédige la réponse, sans que vous ayez à les répéter pour chaque agent.

---

## La liste des profils

La section **Profils** répertorie tous les profils de l'instance. Chaque ligne affiche :

- Le **nom** du profil, accompagné d'une étiquette **Archivé** lorsque le profil n'est plus actif (les lignes archivées sont estompées).
- La **Description**, lorsqu'elle a été renseignée.
- Une ligne de synthèse : **{n} lignes** et, lorsque disponible, **Mis à jour le {time}**, pour voir combien de lignes de guidance le profil comporte et quand il a changé pour la dernière fois.

Les administrateurs disposent d'un bouton **Nouveau profil** dans l'en-tête de la page, des contrôles Modifier et Archiver sur chaque ligne active, et d'un contrôle Restaurer sur chaque ligne archivée. Un profil archivé reste en lecture seule tant que vous ne le restaurez pas : il ne comporte aucun contrôle Modifier.

---

## Créer et modifier un profil

**Nouveau profil** (administrateurs uniquement) ouvre la boîte de dialogue d'édition. Modifier un profil actif ouvre la même boîte de dialogue pré-remplie.

Vous renseignez :

- **Nom** : requis.
- **Description** : facultative, pour votre propre référence.
- **Lignes de contexte** : une ligne de guidance de fond par ligne. Les lignes vides sont ignorées.

**Enregistrer** reste désactivé tant qu'il n'y a pas de nom et au moins une ligne de contexte. Lorsque vous modifiez un profil existant, l'enregistrement le met à jour en place : chaque agent déjà pointé vers ce profil fonctionne immédiatement sur les nouvelles lignes ; considérez donc les modifications d'un profil largement utilisé comme un changement qui se répercute sur l'ensemble de votre parc.

---

## Archiver un profil

L'archivage sert à retirer un profil que vous ne voulez plus voir utilisé par les agents. Avant qu'il ne prenne effet, KANAP vous avertit clairement :

> « {name} » ne sera plus disponible pour les agents. Tout agent qui l'utilise actuellement fonctionnera sans contexte partagé jusqu'à ce que vous le pointiez vers un autre profil.

C'est la conséquence importante à retenir : l'archivage ne déplace pas automatiquement les agents concernés vers un remplaçant. Tout agent qui était pointé vers le profil archivé continue de fonctionner, mais **sans aucun** contexte partagé, jusqu'à ce que vous entriez dans les paramètres de cet agent et sélectionniez un autre profil. Si plusieurs agents partagent le profil que vous archivez, planifiez d'abord le remplacement.

Les profils archivés restent dans la liste, estompés et étiquetés **Archivé**. Ils ne peuvent plus être modifiés ni attachés à un agent tant que vous ne les restaurez pas.

---

## Restaurer un profil

**Restaurer** se trouve sur chaque ligne archivée, à la même place qu'Archiver sur une ligne active. Il remet le profil en activité et enregistre le changement. Les agents qui pointent encore vers ce profil retrouvent ses lignes, et vous pouvez de nouveau le modifier ou l'attacher. Le profil conserve sa clé pendant tout le temps où il est archivé, donc un nouveau profil avec la même clé est refusé. Restaurez le profil existant pour réutiliser cette clé.

---

## Comment un profil se relie à un agent

Les profils résident ici, mais ils s'activent agent par agent depuis l'onglet **Paramètres** de l'agent concerné, dans la section **Objectif** (voir [Espace de l'agent](agents-workspace.md)). Tant que vous n'avez pas activé **Utiliser le contexte partagé**, c'est la seule chose que vous y voyez : l'interrupteur et une description d'une ligne. L'activer fait apparaître le sélecteur de profil, un raccourci **+ Nouveau profil** pour en créer un sur-le-champ, et un aperçu des lignes du profil sélectionné. Choisissez un profil et l'agent fonctionne avec ; laissez-le sur **Aucun profil sélectionné** et l'agent fonctionne sans aucun contexte partagé.

Comme le lien est une référence, un même profil peut alimenter plusieurs agents à la fois, et mettre à jour le profil les met tous à jour. Détacher un agent (ou archiver son profil) retire simplement la guidance pour cet agent ; cela ne change rien pour les autres utilisateurs du profil.

---

## La réserve essentielle : de la guidance, pas une source

Le contexte partagé et les [bibliothèques de connaissances](knowledge.md) alimentent tous deux un agent, mais ils remplissent des rôles fondamentalement différents, et les confondre est l'erreur la plus courante ici.

- **Le contexte partagé** façonne *la façon dont* un agent se comporte : son ton, ses hypothèses sur votre environnement, ses règles strictes du type « à ne jamais faire ». Ses lignes ne sont **jamais citées** dans une réponse et n'accordent à l'agent **aucun nouvel accès aux données**. Elles orientent, elles ne font pas preuve.
- **Les bibliothèques de connaissances** sont *ce qu'*un agent peut citer. Leurs résultats SONT cités dans la réponse rédigée, afin que le demandeur puisse voir la source derrière une réponse.

La règle pratique : si vous voulez que l'agent énonce un fait et l'assume (une politique, une procédure, une configuration précise), placez ce fait dans une bibliothèque de connaissances pour qu'il puisse être cité. Réservez le contexte partagé à la guidance permanente et aux garde-fous qui ne doivent pas apparaître comme une source citée. Et comme une ligne de contexte n'est pas une autorisation, écrire « l'agent peut clôturer les tickets de facturation » dans un profil n'accorde rien : les autorisations et l'automatisation réelles sont régies par type d'action dans les paramètres propres à l'agent et par le flux d'approbation.

---

## Conseils

- Gardez des lignes courtes, à l'impératif, avec une seule idée chacune. « Ne jamais demander les mots de passe aux utilisateurs. » se lit et s'applique plus fiablement qu'un paragraphe combinant plusieurs règles.
- Commencez par vos règles strictes du type « ne jamais » : les garde-fous que vous tenez le plus à voir respectés méritent d'être énoncés clairement et tôt.
- Préférez un petit nombre de profils largement utiles (par exemple, une base commune à toute l'entreprise) plutôt que de nombreux quasi-doublons. Moins de profils sont plus faciles à tenir à jour, et les modifications atteignent d'un coup chaque agent attaché.
- N'introduisez pas ici en douce des faits citables. Tout ce que vous voudriez qu'un demandeur voie cité avec une source a sa place dans une [bibliothèque de connaissances](knowledge.md).
- Avant d'archiver un profil partagé, notez quels agents l'utilisent et repointez-les d'abord. L'archivage les laisse fonctionner sans contexte partagé tant que vous ne l'avez pas fait.
- **Restaurer** remet un profil archivé en activité. Les agents qui pointent encore vers lui retrouvent ses lignes.
- La **Description** n'est que pour vous et n'atteint jamais l'agent ; utilisez-la pour consigner qui est responsable du profil ou à quoi il sert, afin qu'un collègue n'ait pas à deviner plus tard.
