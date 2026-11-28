# Intégrations

Utilisez la page Intégrations pour connecter Kadratis à des outils tiers qui complètent les données que vous gérez déjà dans la plateforme. La connexion principale est votre centre de services **GLPI**. Cette connexion remplit deux fonctions à la fois : elle permet à **Kad** (le chat interactif) de trouver et d'importer des tickets dans Kadratis sous forme de tâches, et elle alimente les **Agents IA** qui surveillent votre centre de services et proposent ou réalisent le travail sur les tickets. La page héberge également la connexion **Inventaire Netbox**, qui n'a rien à voir avec l'IA. De nouvelles intégrations viendront s'ajouter ici au fil du temps.

## Où la trouver

- Espace de travail : **Administration**
- Chemin : **Administration → Intégrations**
- Route : `/admin/integrations`
- Autorisation : `ai_settings:admin` ou `infrastructure:admin`. Chaque carte a son exigence propre : les connexions GLPI et supervision demandent `ai_settings:admin`, la connexion Netbox demande `infrastructure:admin`. Vous ne voyez que les cartes que vous avez le droit de configurer.
- Indicateur de fonctionnalité : les cartes GLPI et supervision partagent la même surface `ai_settings` que la page de paramètres Kad. Lorsque cette surface est désactivée, elles sont masquées. La carte Netbox n'a pas d'indicateur de fonctionnalité et reste disponible dans l'édition cloud comme dans l'édition on-premise.

Les identifiants que vous saisissez ici sont ceux que Kad comme n'importe quel Agent IA utilisent pour atteindre GLPI : vous configurez la connexion une seule fois, à un seul endroit.

---

## Intégration GLPI

[GLPI](https://glpi-project.org/) est un outil populaire et open source de gestion des services informatiques. Cette page stocke les identifiants que Kadratis utilise pour atteindre votre instance GLPI. Ce que Kadratis fait de cette connexion dépend de la fonctionnalité que vous y raccordez.

### Comment ça fonctionne

La connexion alimente deux workflows que vous activez et pilotez séparément.

**1. Import via le chat Kad (aperçu et approbation).** Un utilisateur final demande à Kad quelque chose comme « importe les tickets GLPI ouverts assignés à mon équipe ». Kad interroge GLPI à l'aide des identifiants que vous configurez ici, renvoie les tickets candidats sous forme d'aperçu dans le chat, et ne crée une tâche par ticket qu'après que l'utilisateur a examiné l'aperçu et cliqué sur **Approuver**. Rien n'est écrit dans Kadratis sans cette approbation explicite ; les administrateurs peuvent donc confier cette fonction aux utilisateurs finaux sans craindre une modification silencieuse des données.

**2. Des Agents IA qui surveillent le centre de services.** Une fois GLPI connecté ici, un administrateur peut y raccorder un agent **Helpdesk** et le laisser surveiller les tickets nouveaux et mis à jour, puis proposer le travail : réponses au demandeur, notes internes et mises à jour de la classification, du statut, de l'affectation, des observateurs et de la clôture/résolution. L'ajout d'un observateur laisse le demandeur inchangé. Chaque modification de l'agent est toujours proposée à votre approbation avant d'être envoyée à GLPI, et des limites de sécurité strictes, des budgets et des contrôles de fraîcheur s'appliquent en permanence. Cette page ne configure aucun comportement d'agent ; elle fournit uniquement la connexion utilisée par les agents.

### Utilisé par les Agents IA

Après avoir enregistré ici une connexion fonctionnelle, un administrateur configure les agents dans la section Agents IA (voir [Agents IA : Vue d'ensemble](agents-overview.md)). Depuis **Nouvel agent** ou les **Paramètres** d'un agent existant, il choisit cette connexion GLPI comme centre de services surveillé par l'agent. L'agent la consulte et rédige à partir d'elle, mais par défaut il n'envoie jamais rien de lui-même : chaque réponse, note ou changement de statut proposé passe d'abord par la file d'approbation.

### Prérequis

- **Le chat Kad doit être activé** sur votre tenant pour le workflow d'import via le chat. La page affiche une infobulle d'information à côté du titre de la section pour vous rappeler cette dépendance.
- **Les Agents IA doivent être activés** sur l'instance pour le workflow d'agent, et l'agent doit être configuré par une personne disposant du niveau Administrateur des Agents IA (`ai_agents:admin`).
- Une instance GLPI joignable depuis Kadratis en HTTPS.
- Un **Jeton utilisateur** pour un compte utilisateur GLPI disposant d'un accès en lecture aux tickets que vous souhaitez exposer.
- Un **Jeton d'application** facultatif si votre instance GLPI exige une authentification au niveau applicatif.
- **Droits du profil pour les fonctions d'agent** : le profil GLPI de ce compte a besoin d'un accès en lecture aux catégories ITIL et aux entités, que les agents utilisent pour leurs filtres de ciblage et pour la classification, ainsi que d'un accès en lecture aux groupes et aux utilisateurs pour qu'un agent puisse acheminer un ticket vers un groupe de techniciens ou vers un technicien nommé. L'acheminement exige également le droit d'attribuer les tickets. Enfin, accordez les droits de mise à jour sur les tickets pour les actions que vous laissez l'agent effectuer : suivis, classification, statut et attribution.

L'intégration se configure tenant par tenant ; les identifiants ci-dessous sont limités à votre tenant et n'en sortent jamais.

### Champs

- **Activer l'import de tickets GLPI** : interrupteur principal de la connexion. Lorsqu'il est désactivé, Kadratis n'essaiera pas d'interroger GLPI même si des identifiants sont renseignés : ni les imports Kad ni les contrôles d'agent n'atteindront votre centre de services.
- **URL GLPI** : l'adresse avec laquelle vous ouvrez GLPI, par exemple `https://glpi.example.com`. L'API de GLPI doit être active : dans GLPI, **Configuration > Générale > API**, **Activer l'API Rest**.
- **Jeton utilisateur** : le jeton d'API personnel du compte GLPI que Kadratis utilisera. Dans GLPI, ouvrez vos préférences (votre nom en haut à droite), puis **Clefs d'accès distant**, et copiez le **Jeton d'API**. S'il est vide, cochez **Regénérer** et enregistrez.
- **Jeton d'application** : facultatif. Dans GLPI, **Configuration > Générale > API**, ouvrez le **Client de l'API** par lequel Kadratis se connecte et copiez son jeton d'application. Laissez le champ vide si le client n'en a pas.

L'icône d'information à côté de chaque champ indique où trouver sa valeur. Un jeton enregistré n'est jamais réaffiché : le champ affiche des points, avec **Remplacer** à côté pour en saisir un nouveau. Une nouvelle URL vide les jetons enregistrés : le champ du jeton utilisateur le redemande, et le champ du jeton d'application indique que le jeton enregistré n'est pas envoyé à la nouvelle adresse. Saisissez de nouveau le jeton d'application pour le conserver.

### Actions

- **Tester** : effectue un aller-retour authentifié vers GLPI avec les valeurs de la carte, enregistrées ou non. Disponible dès que l'URL et le jeton utilisateur sont renseignés. La ligne d'état en haut à droite de la carte donne le résultat : « Dernier test réussi le … » avec le temps de réponse, ou la raison de l'échec.
- **Enregistrer** : disponible dès que quelque chose a changé. Les jetons saisis remplacent ceux qui sont enregistrés ; un jeton laissé en points est conservé.

La ligne d'état garde le dernier test des valeurs enregistrées : il s'affiche de nouveau quand vous revenez sur la page, avec le temps de réponse ou la raison de l'échec. Le test de valeurs non enregistrées reste affiché jusqu'à ce que vous quittiez la page. Sans test, la ligne d'état indique **Enregistré, pas encore testé** ou **Jamais testé**, et **Modifications non enregistrées** tant que la carte contient des changements. Quitter la page avec des changements sur une carte demande d'abord une confirmation.

### Stockage des secrets

Si votre instance Kadratis ne dispose pas d'un coffre à secrets configuré, une ligne sous les champs indique que les jetons ne peuvent pas être enregistrés. Configurez le stockage des secrets au niveau de l'instance avant de vous appuyer sur cette intégration en production.

---

## Supervision : PRTG

[PRTG](https://www.paessler.com/prtg) est un outil de supervision du réseau et de l'infrastructure. La carte **Supervision : PRTG** stocke l'adresse et la clé API que les agents de supervision utilisent pour lire les alertes et l'état des capteurs. Comme la carte GLPI, elle demande `ai_settings:admin` et la surface `ai_settings`.

### Champs

- **Activer la supervision PRTG** : interrupteur principal de la connexion. Lorsqu'il est désactivé, les agents n'atteignent pas PRTG.
- **Adresse du serveur** : l'adresse avec laquelle vous ouvrez PRTG dans votre navigateur, par exemple `https://prtg.example.com`.
- **Clé API** : créez-en une dans PRTG sous **Setup | Account Settings | API Keys**. Un accès en lecture seule suffit. Une clé enregistrée s'affiche en points, avec **Remplacer** à côté. Une nouvelle adresse vide la clé enregistrée : le champ la redemande.
- **Fuseau horaire du serveur** : le fuseau horaire du serveur central PRTG, tel que défini dans son système d'exploitation. Kadratis lit l'heure des alertes dans ce fuseau.
- **Délai d'attente des requêtes (secondes)** : le temps d'attente de PRTG, entre 5 et 120. Laissez vide pour utiliser 30.

### Actions

**Tester** et **Enregistrer** fonctionnent comme sur la carte GLPI : **Tester** est disponible dès que l'adresse et la clé sont renseignées. Un test réussi indique la version de PRTG et le nombre de capteurs visibles avec la clé. Une fois une connexion fonctionnelle enregistrée et activée, la carte propose un lien vers la page Agents, où vous pouvez créer un agent de supervision.

---

## Inventaire Netbox

[Netbox](https://netboxlabs.com/docs/netbox/) fait référence dans beaucoup d'équipes d'infrastructure : équipements, machines virtuelles, baies, sites, adresses. La carte **Inventaire Netbox** stocke l'adresse et le jeton d'API que Kadratis utilise pour lire cet inventaire et maintenir ses actifs en phase avec lui. Netbox reste la référence pour les équipements qu'il décrit ; Kadratis conserve la couche métier autour.

Cette connexion est indépendante des fonctionnalités d'IA. Elle demande `infrastructure:admin`, fonctionne dans l'édition cloud comme dans l'édition on-premise, et reste disponible quand l'IA est désactivée.

Configurez la connexion ici, puis ouvrez l'onglet **Netbox** de **Cartographie SI > Paramètres** pour choisir ce qui est importé et lancer la synchronisation. La procédure complète, les règles de rapprochement et le tableau de résolution des problèmes figurent sur [Synchronisation Netbox](netbox.md).

---

## Retirer une connexion

Les trois cartes retirent une connexion de la même façon : videz son adresse, enregistrez, puis confirmez. Kadratis supprime l'adresse et les secrets enregistrés, coupe la connexion et écrit une entrée au journal d'audit. La confirmation indique ce qui change pour chaque système :

- **GLPI** : les tickets ne peuvent plus être importés. Les tickets déjà importés restent.
- **PRTG** : les agents de supervision ne peuvent plus lire PRTG et le signalent comme indisponible à leur exécution suivante.
- **Netbox** : la synchronisation automatique s'arrête. Ce qui a déjà été synchronisé reste.

Le journal d'audit indique si un secret est défini, et signale un secret remplacé : l'entrée d'un enregistrement qui change une clé ou un jeton à la même adresse affiche **Secret remplacé**, et pour GLPI **Jeton utilisateur GLPI remplacé** ou **Jeton d'application GLPI remplacé**. Le secret lui-même n'est jamais écrit dans le journal.

---

## Conseils

- **Utilisez un compte GLPI dédié** : créez un compte de service dans GLPI avec juste assez d'autorisations pour lire les catégories de tickets que vous souhaitez exposer. Cela garde le journal d'audit propre et vous permet de révoquer l'accès sans affecter un utilisateur réel. Si les agents doivent envoyer des réponses et des changements de statut, accordez à ce même compte l'accès en écriture requis par ces actions.
- **Testez avant d'annoncer** : lancez **Tester** après chaque modification de l'URL ou des jetons. Le message d'erreur est bien plus exploitable qu'un échec qui apparaît au sein de la conversation de chat d'un utilisateur ou dans un contrôle d'agent bloqué.
- **Associez les bonnes autorisations** : seuls les utilisateurs disposant de `ai_chat:reader` peuvent demander à Kad d'importer des tickets. Raccorder un agent à cette connexion nécessite le rôle Agents IA (`ai_agents:reader` pour consulter un agent, `ai_agents:admin` pour en configurer un), avec les Agents IA activés sur l'instance. Combinez cela avec un accès basé sur les rôles aux tâches si vous souhaitez limiter qui crée réellement des enregistrements de tâches à partir des imports.
- **Prévoyez la rotation des jetons** : les jetons personnels GLPI peuvent être régénérés. Lorsque vous le faites, enregistrez la nouvelle valeur ici et lancez le test de connexion avant que les utilisateurs (ou les agents) ne sollicitent à nouveau l'intégration.
