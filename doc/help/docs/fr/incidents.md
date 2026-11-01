# Registre des incidents

Le registre des incidents est le journal de bord des événements notables qui ont touché votre SI : la panne qui a bloqué la facturation pendant trois heures, la tentative de rançongiciel arrêtée par le filtre de messagerie, la défaillance de stockage qui a fait perdre une journée de sauvegardes. Chaque incident reçoit un numéro permanent, un journal horodaté que personne ne peut réécrire, et des liens vers les actifs, applications, tâches et documents concernés.

Ce n'est pas un centre de services. Les tickets du quotidien restent dans votre outil de ticketing ; le registre conserve les événements sur lesquels votre direction, vos auditeurs et votre assureur reviendront dans un an.

## Ce qui a sa place dans le registre

Enregistrez un incident lorsque l'événement mérite d'être conservé :

- Interruptions de service ayant touché des utilisateurs, des clients ou un processus métier
- Événements de sécurité : tentatives d'intrusion, logiciels malveillants, fuites de données, équipements perdus
- Pertes ou corruptions de données, restaurations échouées, trous dans les sauvegardes
- Défaillances sérieuses d'un fournisseur ou d'un hébergeur, niveaux de service non respectés
- Tout ce que vous devrez expliquer plus tard, ou signaler à une autorité

N'enregistrez pas le travail courant : réinitialisations de mot de passe, problèmes touchant un seul utilisateur, demandes de changement standard, ou un ticket résolu en dix minutes sans impact. Un bon registre contient quelques entrées par mois, pas des milliers.

**Conseil** : conservez le numéro de ticket dans le champ **Référence externe** pour que chacun puisse retrouver la trace opérationnelle dans votre outil de ticketing.

---

## Premiers pas

Rendez-vous dans **Cartographie SI > Incidents** pour voir le registre. Cliquez sur **Nouvel incident** pour en enregistrer un.

**Champs obligatoires** :

- **Titre** : un résumé court et factuel, ex. : « Messagerie indisponible sur le site de Lyon »
- **Gravité** : Critique, Majeur, Mineur ou Faible
- **Détecté** : quand l'incident a été remarqué (par défaut maintenant)

**Recommandés sur le même écran** :

- **Description** : ce qui s'est passé, tel qu'observé
- **Catégorie** : infrastructure, sécurité, application, données, fournisseur, autre (configurable, voir [Catégories](#categories))
- **Début** : quand l'incident a réellement commencé, si c'est différent du moment où vous l'avez remarqué
- **Responsable** : qui prend l'incident en charge

Le **Déclarant** est vous par défaut. Les deux dates acceptent des valeurs passées : un incident découvert le lundi matin peut être enregistré comme ayant commencé le samedi soir.

**Autorisations** :

- Consultation : `incidents:reader`
- Création, modification, journal, liens, pièces jointes : `incidents:contributor`
- Réouverture, annulation, suppression et levée d'une restriction : `incidents:admin`

Ces autorisations couvrent aussi la revue d'incident et l'export PDF : celui qui traite les incidents n'a besoin d'aucune autorisation sur la base de connaissances pour rédiger la revue. Voir [Vue d'ensemble](#vue-densemble).

Un incident restreint est masqué pour tout le monde sauf les administrateurs du registre, le déclarant et le responsable. Sur un tenant standard, cela veut dire Administrateur et Administrateur cartographie SI, plus la personne qui a consigné l'incident ou qui en est responsable. Un lecteur ou un contributeur qui n'est ni le déclarant ni le responsable ne le voit pas dans la liste, la recherche, le chat ou un export. L'ouvrir par sa référence renvoie la même page « introuvable » qu'un numéro inexistant. Ses tâches liées leur sont aussi masquées : dans la liste des tâches, la recherche, le tableau de bord, Plaid et les objets liés. La revue d'incident est soumise à la même restriction, quel que soit le chemin emprunté : base de connaissances, recherche, assistant, exports et images collées dans le texte.

**Restreindre aux administrateurs du registre** se trouve dans le tiroir des propriétés, sous Classification. Un contributeur peut l'activer tant qu'il voit encore la fiche ; seul un administrateur peut la désactiver, y compris après clôture. Le changement est écrit dans le journal. Le journal d'audit ne montre les lignes d'un incident restreint, de sa revue et de ses tâches qu'aux personnes qui voient l'incident, et les pastilles de relation documentaire n'affichent pas son titre. Seule la liste « récemment consultés », conservée dans le navigateur de chacun, peut encore afficher le titre à une personne qui a ouvert l'incident avant sa restriction.

---

## Travailler avec la liste

La liste, c'est le registre lui-même : tous les incidents, détection la plus récente en premier.

**Colonnes par défaut** :

| Colonne | Ce qu'elle affiche |
|---------|--------------------|
| **Réf** | Référence de l'incident (ex. : `INC-14`), monospace |
| **Titre** | Résumé court (cliquez pour ouvrir l'incident) |
| **Catégorie** | Classification issue des paramètres Cartographie SI |
| **Gravité** | Critique, Majeur, Mineur, Faible, avec un point coloré |
| **Statut** | Ouvert, En cours, Résolu, Clôturé, Annulé, avec un point coloré |
| **Détecté** | Quand l'incident a été remarqué |
| **Résolu** | Quand le service a été rétabli |
| **Responsable** | Personne en charge |
| **Actifs** | Nombre d'actifs liés |
| **Tâches** | Nombre de tâches de suivi |

**Tri par défaut** : **Détecté** décroissant (le plus récent en premier).

**Colonnes supplémentaires** (masquées par défaut, disponibles via le sélecteur de colonnes) : **Clôturé**, **Applications**, **Créé**, **Données personnelles**, **Notification requise** et **Notifié le**. **Données personnelles** et **Notification requise** proposent un filtre oui/non.

**Filtrage** : Catégorie, Gravité, Statut et Responsable proposent des filtres à cases à cocher dont les options sont calculées à partir des incidents affichés, vous ne voyez donc que les valeurs présentes dans le jeu de résultats. Les colonnes de dates proposent des filtres de date, y compris par plage : filtrez **Détecté** entre deux dates pour produire un extrait trimestriel ou annuel. La recherche porte sur le titre, la description, la référence (`INC-14`), ainsi que sur les noms et références des actifs, applications et technologies liés : une recherche sur un nom d'hôte tel que `PAR-ESX-01` liste les incidents de cet actif. Les mots qui n'apparaissent que dans la revue d'incident se retrouvent par la recherche globale et par l'assistant, pas par ce champ. La recherche globale, le sélecteur `@` de Plaid et le serveur MCP retrouvent aussi un incident par le nom et la référence d'un actif lié (`AST-N`, nom d'hôte ou FQDN), d'une application liée (`APP-N`) ou d'une technologie liée (`TEC-N`). Le résultat est l'incident, avec son titre et sa référence (`INC-N`).

**Conseil** : combinez Gravité = Critique, Majeur avec une plage **Détecté** pour construire la liste courte que réclament la plupart des comités de pilotage et des audits.

Les filtres appliqués sont conservés dans l'incident que vous ouvrez : **Précédent / Suivant** dans l'espace de travail parcourt cette même liste courte.

---

## L'espace de travail de l'incident

Cliquez sur n'importe quelle ligne pour ouvrir l'incident. L'espace de travail comporte un **en-tête** avec la référence et des métadonnées rapides, un **tiroir des propriétés** sur la droite et une **zone de contenu** au centre qui change selon l'onglet.

Les onglets sont **Vue d'ensemble**, **Journal**, **Relations**, **Documents** et **Historique** (les modifications de l'incident, voir [Historique des fiches](record-history.md)).

### En-tête et métadonnées

L'en-tête affiche le titre (modifiable sur place), la référence `INC-N` (cliquez pour la copier), les actions de cycle de vie et **Précédent / Suivant** pour parcourir la liste filtrée.

La ligne de métadonnées en dessous affiche **Statut**, **Gravité**, **Responsable**, **Détecté** et, une fois l'incident résolu, la **Durée** entre la détection et la résolution. Gravité, Responsable et Détecté se modifient directement depuis cette ligne.

### Tiroir des propriétés

Le tiroir reste visible sur chaque onglet et enregistre au fur et à mesure.

**Classification** :

- **Catégorie** : depuis la liste configurée dans les paramètres Cartographie SI
- **Gravité** : Critique, Majeur, Mineur, Faible. Choisissez le niveau qui reflète l'impact métier du moment ; chaque changement est consigné au journal, la revoir à la hausse ou à la baisse ensuite est donc normal et traçable
- **Statut** : Ouvert, En cours, Résolu, Clôturé. Le statut n'avance que vers l'avant. Le retour en arrière passe par **Rouvrir**, pour que le registre ne puisse pas être discrètement rembobiné
- **Restreindre aux administrateurs du registre** : masquer l'incident aux autres lecteurs et contributeurs. Le déclarant et le responsable le voient toujours. Seul un administrateur peut lever la restriction, y compris après clôture. Quand elle est active, la ligne de métadonnées affiche **Restreint**

**Dates** :

- **Début** : quand l'incident a réellement commencé
- **Détecté** : quand il a été remarqué (obligatoire)
- **Résolu** : renseigné automatiquement quand vous passez le statut à Résolu, et modifiable tant que l'incident est ouvert, pour le corriger à l'heure réelle du rétablissement
- **Clôturé** : en lecture seule, horodaté à la clôture de l'incident

**Personnes** : **Déclarant** (qui l'a enregistré) et **Responsable** (qui le traite).

**Source** : **Référence externe** pour le numéro de ticket, l'identifiant d'alerte ou la référence de mail par lesquels l'incident a été signalé la première fois.

**Conformité** : **Données personnelles concernées**, **Notification à l'autorité requise**, **Notifié le** (apparaît dès que la notification est requise) et **Parties informées**.

**Enregistrement** : dates de **Création** et de **Mise à jour**, en lecture seule.

---

### Vue d'ensemble

La vue d'ensemble raconte l'incident en deux temps : une description courte, puis la revue d'incident. Les deux enregistrent automatiquement au fur et à mesure que vous tapez. Les pièces jointes ferment la page.

La **Description** tient en une ou deux phrases : ce qui s'est passé, tel qu'observé. C'est le résumé qui apparaît dans la liste, dans les résultats de recherche et en tête du rapport PDF.

La **Revue d'incident** est le constat complet, rédigé dans un document plutôt que dans des champs de texte brut. Elle accepte des titres, des listes, des tableaux, des liens et des images collées directement dans le texte.

Un nouvel incident démarre à partir du modèle **Revue d'incident**, qui propose les cinq parties dans l'ordre où se lit habituellement un rapport d'incident :

- **Description détaillée** : ce qui s'est passé, en détail
- **Impact** : services, sites et utilisateurs touchés
- **Cause racine** : pourquoi c'est arrivé
- **Actions correctives** : ce qui a été fait pour corriger et pour prévenir. Suivez le travail de fond sous forme de tâches liées
- **Retour d'expérience** : ce qu'il faut retenir de cet incident

Réécrivez-les, retirez celles dont vous n'avez pas besoin, ajoutez les vôtres. Pour un incident mineur, la description courte suffit. Pour un incident majeur, la revue constitue le post-mortem.

Les titres sont dans la langue de la personne qui enregistre l'incident (anglais, français, allemand ou espagnol). Un modèle réécrit par vos administrateurs garde ses propres termes.

Le modèle est un document ordinaire de la base de connaissances, rangé dans la bibliothèque **Modèles** sous le type de document **Incident review**. Toute personne disposant de `knowledge:admin` le modifie comme n'importe quel document de cette bibliothèque, pour coller à votre propre format de post-mortem. Un nouveau modèle s'applique aux incidents enregistrés ensuite et ne réécrit jamais une revue déjà existante.

Chaque enregistrement qui modifie la revue conserve une version : le texte peut donc être relu tel qu'il était à n'importe quel moment, y compris à la clôture de l'incident. Voir [Journal](#journal).

La revue est elle-même un document de la base de connaissances, avec sa propre référence `DOC-N`, rangé dans le dossier **Incidents** de la bibliothèque **Documents managés**. La rédiger depuis l'incident et exporter le PDF n'utilisent que les autorisations incidents. Ouvrir ce même document directement dans la base de connaissances demande en plus les autorisations documentaires de cette bibliothèque. Dans les deux cas, la revue reste liée à l'incident : elle est gelée dès que l'incident est clôturé ou annulé, et masquée à quiconque ne peut pas voir un incident restreint.

**Pièces jointes** : les fichiers qui étayent le dossier, comme les captures d'écran, les extraits de logs, les exports de mails ou le rapport d'incident du fournisseur. Avec `incidents:contributor`, glissez-déposez des fichiers ou cliquez pour les sélectionner. Cliquez sur une pièce jointe pour la télécharger. La section apparaît dès que l'incident a un fichier, ou quand vous pouvez le modifier. Sur un incident clôturé ou annulé, les fichiers restent consultables ; l'ajout et la suppression reprennent après la réouverture.

---

### Journal

Le journal est ce qui fait de cet outil un registre plutôt qu'un formulaire. Il liste tout ce qui est arrivé à l'incident, du plus récent au plus ancien, et **rien de ce qu'il contient ne peut être modifié ni supprimé**, par personne, à aucun moment.

**Ajouter une note** : saisissez-la dans le composeur en haut et cliquez sur **Ajouter** (ou appuyez sur Ctrl+Entrée). La date et l'heure à côté du bouton définissent le moment auquel la note se rapporte. L'heure se saisit sur 24 heures (23:40). Par défaut maintenant, vous pouvez la placer dans le passé : une note ajoutée le mardi peut être enregistrée comme étant survenue à 23h40 le samedi, et elle se classera à cet endroit de la chronologie. KANAP conserve séparément le moment où la note a réellement été enregistrée, et personne ne peut le modifier : l'antidatage reste honnête. Quand une note se rapporte à un moment antérieur à sa saisie, sa ligne affiche aussi l'heure d'enregistrement, par exemple « enregistrée le 27 oct., 10:12 ». Le rapport PDF donne les deux heures dans deux colonnes.

**Les entrées automatiques** apparaissent aux côtés de vos notes :

| Entrée | Quand elle est écrite |
|--------|-----------------------|
| **Système** | À la création : « Incident enregistré » |
| **Changement de statut** | À chaque changement de statut, affiché « Statut : En cours → Résolu » |
| **Changement de gravité** | À chaque changement de gravité, même format |
| **Réouverture** | À la réouverture, avec le motif que vous avez saisi |
| **Liens mis à jour** | Quand des actifs ou des applications sont liés ou déliés, en les nommant |

Chaque ligne affiche l'auteur, l'heure à laquelle elle se rapporte (survolez pour « il y a 3 jours ») et le type d'entrée pour tout ce qui n'est pas une simple note.

Une entrée **Liens mis à jour** n'apparaît qu'aux personnes qui peuvent lire le module qu'elle nomme : les actifs et les technologies demandent l'infrastructure, les applications les applications. Les notes gardent leur texte, quoi qu'elles mentionnent.

Le composeur disparaît dès que l'incident est clôturé ou annulé. Les modifications de champs faites hors du journal, comme la correction de la description, apparaissent dans l'onglet **Historique**.

La revue d'incident conserve son propre historique. Chaque enregistrement qui la modifie produit une version, et les versions sont conservées définitivement. La rédaction courante ne crée pas d'entrée de journal : écrire la revue n'est pas un événement de l'incident, et le journal d'audit garde la trace de qui a modifié quoi. En revanche, la clôture, l'annulation et les imports écrivent une entrée de journal, et cette entrée nomme la version de la revue à laquelle elle se rapporte, affichée « Version 4 de la revue d'incident (DOC-12) ».

La réouverture ne change rien à cela. Les versions restent, l'entrée de clôture continue de pointer vers la version qui était courante au moment de la clôture, et ce texte reste lisible plus tard avec les images qu'il contenait, selon les droits dont l'incident dispose à ce moment-là.

---

### Relations

L'onglet Relations montre ce que touche l'incident : ses actifs, applications et technologies, chacun dans son propre tableau, puis des suggestions et les tâches. Cliquez sur une ligne du tableau pour ouvrir l'enregistrement. Le badge de l'onglet compte les actifs, applications et technologies liés que vous pouvez voir, ainsi que les tâches.

**Enregistrements liés**, un tableau chacun :

| Section | Colonnes |
|---|---|
| **Actifs** | Référence (`AST-12`), nom, type, environnement, statut |
| **Applications** | Référence (`APP-3`), nom, cycle de vie, criticité business |
| **Technologies** | Référence (`TEC-5`), nom, famille, éditeur |

Vous ne voyez que les sections des modules que vous pouvez lire. Les actifs et les technologies demandent de pouvoir lire l'infrastructure. Un Contributeur métier ne voit que les applications auxquelles il participe.

**Ajouter et retirer des liens** (`incidents:contributor`) : **Ajouter**, à droite d'une section, ouvre une recherche. Tapez un nom ou une référence et choisissez un résultat : le lien est enregistré aussitôt et le journal le consigne. Lier demande aussi de pouvoir lire le module visé : **Ajouter** est absent d'une section que vous ne pouvez pas lire. Pour retirer un lien, survolez la ligne et cliquez sur la croix en fin de ligne. Retirer un lien ne supprime rien d'autre et figure aussi au journal. Un incident clôturé ou annulé est en lecture seule : rouvrez-le pour modifier ses liens.

**Apparentés** : les technologies portées par les actifs et les applications liés que l'incident ne liste pas encore. La raison indique la source, par exemple « technologie de l'actif AST-12 » ou « technologie de l'application APP-3 ». Cliquez sur **Lier** pour ajouter la suggestion à la section Technologies. Les suggestions demandent de pouvoir lire l'infrastructure, montrent au plus 20 technologies et sont absentes d'un incident clôturé ou annulé.

**Tâches** : le travail de suivi. Créez une tâche directement depuis l'incident, elle y reste rattachée. La tâche affiche « Incident · INC-14 » dans sa propre barre latérale, et la colonne Tâches de l'incident la compte.

Un actif, une application ou une technologie liés affichent l'incident dans une section **Incidents** de leur propre onglet Relations : celui qui consulte un serveur voit son historique d'incidents. Avec `incidents:contributor`, vous pouvez aussi y lier un incident. Les documents ont leur propre onglet.

---

### Documents

Les documents de la base de connaissances liés à cet incident : le rapport du fournisseur, la procédure suivie, la note rédigée par l'équipe réseau. Avec `knowledge:member`, vous pouvez créer un document directement depuis cet onglet.

La revue d'incident n'apparaît pas ici. Elle appartient à l'incident lui-même et se rédige dans l'onglet Vue d'ensemble.

---

## Clôture, réouverture et annulation

**Résolu** signifie que le service est rétabli. **Clôturé** signifie que l'enregistrement est définitif.

La clôture verrouille l'incident. Champs, revue d'incident, notes de journal, liens, pièces jointes et création de tâches sont tous refusés, dans l'interface, dans la base de connaissances, dans l'assistant comme via l'API. La Vue d'ensemble affiche un bandeau d'une ligne : « Clôturé le 12 mars 2026. Rouvrez-le pour le modifier. » La revue est gelée sur la version nommée par l'entrée de journal, que la clôture vienne de l'incident ou d'un import.

**Rouvrir** (`incidents:admin`) ramène un incident résolu, clôturé ou annulé à En cours et efface les dates de résolution et de clôture. Un motif est obligatoire et il est écrit dans le journal : l'enregistrement montre donc pourquoi on y est revenu.

**Annuler l'incident** (`incidents:admin`) s'utilise pour un enregistrement qui n'aurait jamais dû exister : un doublon, ou un événement saisi par erreur. Un motif est obligatoire, le statut devient Annulé et l'incident est verrouillé comme s'il était clôturé. Rien n'est supprimé et le numéro reste en place : `INC-13` ne disparaît jamais entre `INC-12` et `INC-14`. Un trou dans la numérotation serait la première chose sur laquelle un auditeur reviendrait.

### Supprimer un incident

**Supprimer** (`incidents:admin`) est une icône corbeille sur la fiche de l'incident, et sur la liste une fois des lignes sélectionnées. Il retire un incident saisi par erreur, comme un doublon ou une saisie de test. Seul un incident ouvert, en cours ou résolu peut être supprimé. Un incident clôturé ou annulé reste au registre et garde son numéro `INC-N`. Les autres utilisateurs ne voient ni le bouton ni la sélection.

Avant toute suppression, une confirmation liste ce qui part avec l'incident : sa revue d'incident, ses tâches, ses entrées du journal et ses pièces jointes (fichiers compris). Elle liste aussi les liens retirés : les applications, les actifs et les documents Knowledge restent, seul leur lien avec l'incident disparaît. La suppression est inscrite dans la piste d'audit.

Un incident qui porte des données de déclaration réglementaire ne peut pas être supprimé : **Données personnelles concernées** ou **Notification aux autorités requise** cochée, **Notifié le** ou **Parties informées** renseigné. Un tel enregistrement est une preuve d'audit (notification à l'autorité NIS2, et article 33(5) du RGPD, qui impose de documenter toute violation de données personnelles). La confirmation le dit avant toute action : annulez ou clôturez l'incident à la place. Dans une sélection, les incidents qui ne peuvent pas être supprimés sont conservés et les autres sont supprimés.

---

## Conformité et éléments de preuve

Deux interrupteurs du tiroir portent la partie réglementaire de l'enregistrement :

- **Données personnelles concernées** : activez-le dès que des données personnelles ont été exposées, altérées ou perdues. C'est l'indicateur sur lequel filtre votre délégué à la protection des données
- **Notification à l'autorité requise** : activez-le quand l'événement doit être signalé, par exemple à une autorité de protection des données, à une agence nationale de cybersécurité ou à un régulateur sectoriel. **Notifié le** enregistre alors la date de dépôt, et **Parties informées** liste qui a été prévenu : régulateur, assureur, clients touchés, sécurité groupe

Les délais et les seuils dépendent de votre juridiction et de votre secteur. KANAP enregistre les faits et les dates ; il ne décide pas si vous devez notifier.

**Ce que le registre apporte à un auditeur** :

- Une séquence numérotée dont les incidents clôturés et annulés ne sont jamais supprimés
- Pour chaque incident : quand il a commencé, quand il a été remarqué, quand il a été résolu et clôturé, et qui en était responsable
- Un journal impossible à réécrire, avec chaque changement de statut et de gravité daté et attribué
- Les preuves elles-mêmes, sous forme de pièces jointes et de documents liés
- La revue d'incident, avec la cause racine, les actions correctives et le retour d'expérience, conservée version par version, et les tâches de suivi qui prouvent que les actions ont été menées
- Des vues filtrées par période, gravité, catégorie ou indicateur de conformité, directement depuis la liste
- Un export du registre en CSV ou Excel (**Exporter** dans la liste), pour les auditeurs et pour vos propres archives. Le fichier commence par la référence INC. Il suit les filtres, la recherche et le tri de la liste, et quand un filtre est actif, le dialogue indique combien d'incidents partent dans le fichier. Les incidents restreints sont omis sauf si vous avez le droit de les voir ; le fichier comporte une colonne **Restreindre aux administrateurs du registre**, importable
- Un rapport PDF d'un incident (**Exporter en PDF** dans l'espace de travail), pour l'auditeur qui veut une fiche plutôt que tout le registre

**Importer un registre existant** : **Importer** dans la liste accepte un fichier CSV ou un classeur Excel (`.xlsx`). Laissez la colonne référence vide pour créer des incidents (KANAP attribue les numéros INC suivants), ou conservez la référence INC-N pour mettre à jour les enregistrements correspondants. Chaque incident importé reçoit une entrée de journal indiquant qu'il provient d'un fichier. Exportez d'abord, ou téléchargez le modèle vide, si vous voulez la disposition exacte des colonnes. Le modèle ignore les filtres de la liste.

Les en-têtes, la gravité et le statut sont écrits dans la langue de l'export. L'import accepte les en-têtes et les valeurs dans chacune des quatre langues, ainsi que les codes techniques (`major`, `in_progress`).

Un statut peut avancer par fichier. Le faire reculer, ou annuler un incident, demande `incidents:admin` : le journal enregistre alors une réouverture ou une annulation avec le motif « Imported from CSV ». Pour un contributeur, une telle ligne est refusée avec un message.

Le fichier porte la **Description** courte dans une colonne et toute la **Revue d'incident** dans une autre, sous forme de texte mis en forme. Cette unique colonne de revue remplace les anciennes colonnes Impact, Cause racine, Actions correctives et Enseignements. Titres, listes et liens survivent à l'aller-retour ; les images collées, non, puisqu'elles vivent dans le document. Une cellule de revue vide laisse le texte existant intact.

Les dates et heures s'écrivent à l'heure locale de votre navigateur, comme la langue de l'export écrit les dates : un incident détecté à 10:38 à Paris s'écrit `16/10/2026 10:38` en français. L'en-tête de chaque colonne de date et heure indique ce fuseau horaire après le nom de la colonne, par exemple `detected_at (Europe/Paris)`, et le modèle l'indique aussi. L'import lit chaque colonne dans le fuseau horaire que son en-tête indique : un fichier exporté se recharge sans changement, où qu'il soit importé. Un en-tête sans fuseau horaire, comme dans les fichiers plus anciens ou faits à la main, se lit en UTC (temps universel coordonné). Un fuseau horaire que KANAP ne reconnaît pas arrête l'import. L'import accepte aussi `2026-10-16T08:38:00Z`, qui porte son propre fuseau horaire.

L'import est la seule opération qui écrit encore dans un incident clôturé ou annulé : une correction qui arrive des mois plus tard peut donc être déposée sans rouvrir l'enregistrement. Elle crée une nouvelle version de la revue et une entrée de journal qui la référence, et elle ne réécrit jamais la version à laquelle la clôture se rapporte. Rien d'autre n'est assoupli : les autorisations du registre s'appliquent, et un incident restreint que vous n'avez pas le droit de voir est refusé.

---

## Exporter un rapport PDF pour un auditeur

Ouvrez un incident et cliquez sur **Exporter en PDF** dans les actions de l'en-tête. KANAP télécharge un PDF de cet enregistrement : `INC-12-incident-report.pdf`. Le téléchargement utilise votre session connectée ; ce n'est pas un lien public.

Le rapport suit la langue de l'interface (anglais, français, allemand ou espagnol). Il est assemblé dans cet ordre :

1. En-tête et propriétés de l'incident
2. La description courte
3. La revue d'incident telle qu'elle se lit aujourd'hui, avec sa mise en forme et ses images
4. Le journal dans l'ordre chronologique, avec les versions de revue auxquelles les entrées se rapportent
5. Les actifs, applications, technologies, tâches (avec leur assigné et leur échéance) et documents liés
6. Les champs de conformité
7. Les pièces jointes (nom du fichier, taille et date)

Les sections vides sont omises, et une revue qui ne contient encore que les titres du modèle intacts compte comme vide. Chaque section liée suit les droits du lecteur : les actifs et les technologies demandent de pouvoir lire l'infrastructure, les applications de pouvoir lire les applications (un Contributeur métier voit celles auxquelles il participe), et les tâches de pouvoir lire les tâches. Une section que vous ne pouvez pas lire est absente.

L'export est une lecture. Il fonctionne sur un incident clôturé ou annulé ; l'enregistrement reste verrouillé. Le bouton n'apparaît pas sur **Nouvel incident**.

---

## Catégories

Les catégories d'incident vous appartiennent : définissez-les dans **Cartographie SI > Paramètres**, sous **Incidents > Catégories d'incident**. KANAP fournit par défaut infrastructure, sécurité, application, données, fournisseur et autre.

Gardez la liste courte. Les catégories sont ce qui vous servira à regrouper une année d'incidents, et une liste de trente est une liste que personne n'utilise de façon cohérente. Plutôt que de supprimer une catégorie déjà utilisée, marquez-la comme obsolète : elle disparaît du sélecteur pour les nouveaux incidents tandis que les existants conservent leur historique.

---

## Demander à l'assistant

Plaid lit et écrit le registre dans le chat, avec les mêmes droits que dans le reste de l'application. Chaque modification arrive sous forme d'aperçu que vous approuvez.

**Lecture** : demandez à Plaid un décompte (« Combien d'incidents critiques ce trimestre ? »), une liste filtrée (« Liste des incidents ouverts sur PAR-ESX-01 ») ou une fiche complète (« Résumé de INC-2 »). La fiche complète inclut le journal et la revue d'incident : une question peut donc trouver sa réponse dans la cause racine ou le retour d'expérience. Les heures sont données dans votre propre fuseau horaire. Quand Plaid lit un incident, les objets liés suivent les mêmes droits que le rapport PDF. Un incident restreint que vous ne pouvez pas voir reste hors des réponses, des décomptes, des regroupements, des moyennes et des sources, revue comprise.

Plaid filtre les incidents par actif, application ou technologie, désignés par leur référence ou leur nom exact : `APP-1` n'amène pas les incidents de `APP-12`. Regroupé par actif, application ou technologie, un incident compte dans chacune de ses fiches liées, si bien que la somme des groupes peut dépasser le total. Un incident sans lien n'apparaît dans aucun groupe. Plaid regroupe aussi les incidents par mois de détection ou de résolution. Les mois suivent l'UTC (temps universel coordonné) : un incident détecté à 00:30 le 1er novembre à Paris compte en octobre. Plaid lit le délai de résolution, de la détection à la résolution en heures, pour chaque incident ou en moyenne, en minimum ou en maximum. Les incidents annulés et non résolus en sont exclus. Demandez par exemple : « Délai de résolution moyen des incidents majeurs par mois cette année ».

**Écriture** (niveau Contributeur sur Incidents) : Plaid enregistre un incident, modifie ses champs et fait avancer son statut jusqu'à Clôturé. Il enregistre un incident Ouvert ou En cours. Un incident déjà résolu est enregistré ouvert, puis avancé dans un second aperçu, pour que l'étape apparaisse dans le journal. Plaid peut activer **Restreindre aux administrateurs du registre**. L'aperçu vous avertit quand cela vous masquerait l'incident. Plaid ajoute aussi des notes au journal, avec l'heure à laquelle la note se rapporte si vous la donnez, et lie ou délie des actifs, des applications et des technologies, désignés par leur référence ou leur nom exact, ou par le nom d'hôte ou le FQDN pour un actif. Avec le niveau Membre sur Tâches, il crée une tâche de suivi sur l'incident. Demandez par exemple : « Enregistre un incident majeur : messagerie indisponible au bureau de Lyon depuis 08:40, lié à PAR-MAIL-01 ».

La clôture fige la fiche, et l'aperçu de clôture le signale. Seul un administrateur peut rouvrir l'incident.

**Actions d'administrateur** (niveau Administrateur sur Incidents) : Plaid rouvre un incident résolu, clôturé ou annulé, annule un incident, et active ou désactive **Restreindre aux administrateurs du registre**, y compris sur un incident clôturé ou annulé. Rouvrir et annuler demandent une raison, inscrite au journal, par exemple : « Rouvre INC-14 : le problème est revenu après le correctif ».

La suppression d'un incident et l'ajout de pièces jointes restent sur la page de l'incident (voir [Supprimer un incident](#supprimer-un-incident)). Les assistants connectés par MCP ne font que lire.

---

## Conseils

- **Enregistrez tôt, complétez ensuite** : créez l'incident pendant qu'il se produit, avec un titre et une gravité. Le journal est fait pour ajouter les faits au fil de l'eau
- **Écrivez des notes factuelles, avec des heures** : « 13h05 bascule sur le site secondaire, messagerie rétablie pour 40 utilisateurs ». Réglez la date et l'heure pour que la chronologie reflète l'incident, pas votre vitesse de frappe
- **Antidatez honnêtement** : Début et Détecté sont faits pour porter les heures réelles. L'heure d'enregistrement de chaque entrée de journal est conservée à part et ne peut pas être modifiée
- **Un incident, pas un par ticket** : une panne unique qui a généré quarante tickets est un seul incident, lié aux actifs concernés
- **Transformez les actions en tâches** : la section Actions correctives de la revue décrit l'intention ; une tâche avec un assigné et une échéance est ce qui se fait réellement
- **Clôturez délibérément** : la clôture est le moment où l'enregistrement devient une preuve. Terminez la revue avant de clôturer, car la version conservée à cet instant est celle que lira un auditeur, et il faudra ensuite un administrateur pour rouvrir l'incident
- **Revoyez le registre chaque trimestre** : filtrez par période et par gravité, regardez les catégories récurrentes et les actifs qui apparaissent plus d'une fois. C'est de là que vient la prochaine demande de budget
