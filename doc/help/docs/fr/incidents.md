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
- Réouverture, annulation et levée d'une restriction : `incidents:admin`

Ces autorisations couvrent aussi la revue d'incident et l'export PDF : celui qui traite les incidents n'a besoin d'aucune autorisation sur la base de connaissances pour rédiger la revue. Voir [Vue d'ensemble](#vue-densemble).

Un incident restreint est masqué pour tout le monde sauf les administrateurs du registre, le déclarant et le responsable. Sur un tenant standard, cela veut dire Administrateur et Administrateur cartographie SI, plus la personne qui a consigné l'incident ou qui en est responsable. Un lecteur ou un contributeur qui n'est ni le déclarant ni le responsable ne le voit pas dans la liste, la recherche, le chat ou l'export CSV. L'ouvrir par sa référence renvoie la même page « introuvable » qu'un numéro inexistant. Les tâches liées gardent la référence `INC-N` mais sans le titre. La revue d'incident est soumise à la même restriction, quel que soit le chemin emprunté : base de connaissances, recherche, assistant, exports et images collées dans le texte.

**Restreindre aux administrateurs du registre** se trouve dans le tiroir des propriétés, sous Classification. Un contributeur peut l'activer tant qu'il voit encore la fiche ; seul un administrateur peut la désactiver, y compris après clôture. Le changement est écrit dans le journal. Le journal d'audit, les pastilles de relation documentaire et « récemment consultés » continuent d'afficher le titre pour ceux qui ont déjà ces écrans.

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

**Colonnes supplémentaires** (masquées par défaut, disponibles via le sélecteur de colonnes) : **Clôturé**, **Applications**, **Créé**.

**Filtrage** : Catégorie, Gravité, Statut et Responsable proposent des filtres à cases à cocher dont les options sont calculées à partir des incidents affichés, vous ne voyez donc que les valeurs présentes dans le jeu de résultats. Les colonnes de dates proposent des filtres de date, y compris par plage : filtrez **Détecté** entre deux dates pour produire un extrait trimestriel ou annuel. La recherche porte sur le titre, la description, la référence (`INC-14`), ainsi que sur les noms et références des actifs et applications liés : une recherche sur un nom d'hôte tel que `PAR-ESX-01` liste les incidents de cet actif. Les mots qui n'apparaissent que dans la revue d'incident se retrouvent par la recherche globale et par l'assistant, pas par ce champ.

**Conseil** : combinez Gravité = Critique, Majeur avec une plage **Détecté** pour construire la liste courte que réclament la plupart des comités de pilotage et des audits.

Les filtres appliqués sont conservés dans l'incident que vous ouvrez : **Précédent / Suivant** dans l'espace de travail parcourt cette même liste courte.

---

## L'espace de travail de l'incident

Cliquez sur n'importe quelle ligne pour ouvrir l'incident. L'espace de travail comporte un **en-tête** avec la référence et des métadonnées rapides, un **tiroir des propriétés** sur la droite et une **zone de contenu** au centre qui change selon l'onglet.

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

La vue d'ensemble raconte l'incident en deux temps : une description courte, puis la revue d'incident. Les deux enregistrent automatiquement au fur et à mesure que vous tapez.

La **Description** tient en une ou deux phrases : ce qui s'est passé, tel qu'observé. C'est le résumé qui apparaît dans la liste, dans les résultats de recherche et en tête du rapport PDF.

La **Revue d'incident** est le constat complet, rédigé dans un document plutôt que dans des champs de texte brut. Elle accepte des titres, des listes, des tableaux, des liens et des images collées directement dans le texte.

Un nouvel incident démarre à partir du modèle **Revue d'incident**, qui propose les cinq parties dans l'ordre où se lit habituellement un rapport d'incident :

- **Description détaillée** : ce qui s'est passé, en détail
- **Impact** : services, sites et utilisateurs touchés
- **Cause racine** : pourquoi c'est arrivé
- **Actions correctives** : ce qui a été fait pour corriger et pour prévenir. Suivez le travail de fond sous forme de tâches liées
- **Retour d'expérience** : ce qu'il faut retenir de cet incident

Réécrivez-les, retirez celles dont vous n'avez pas besoin, ajoutez les vôtres. Pour un incident mineur, la description courte suffit. Pour un incident majeur, la revue constitue le post-mortem.

Le modèle est un document ordinaire de la base de connaissances, rangé dans la bibliothèque **Modèles** sous le type de document **Incident review** : un administrateur de la base de connaissances peut le réécrire pour coller à votre propre format de post-mortem. Un nouveau modèle s'applique aux incidents enregistrés ensuite et ne réécrit jamais une revue déjà existante.

Chaque enregistrement qui modifie la revue conserve une version : le texte peut donc être relu tel qu'il était à n'importe quel moment, y compris à la clôture de l'incident. Voir [Journal](#journal).

La revue est elle-même un document de la base de connaissances, avec sa propre référence `DOC-N`, rangé dans le dossier **Incidents** de la bibliothèque **Documents managés**. La rédiger depuis l'incident et exporter le PDF n'utilisent que les autorisations incidents. Ouvrir ce même document directement dans la base de connaissances demande en plus les autorisations documentaires de cette bibliothèque. Dans les deux cas, la revue reste liée à l'incident : elle est gelée dès que l'incident est clôturé ou annulé, et masquée à quiconque ne peut pas voir un incident restreint.

---

### Journal

Le journal est ce qui fait de cet outil un registre plutôt qu'un formulaire. Il liste tout ce qui est arrivé à l'incident, du plus récent au plus ancien, et **rien de ce qu'il contient ne peut être modifié ni supprimé**, par personne, à aucun moment.

**Ajouter une note** : saisissez-la dans le composeur en haut et cliquez sur **Ajouter** (ou appuyez sur Ctrl+Entrée). La date et l'heure à côté du bouton définissent le moment auquel la note se rapporte. L'heure se saisit sur 24 heures (23:40). Par défaut maintenant, vous pouvez la placer dans le passé : une note ajoutée le mardi peut être enregistrée comme étant survenue à 23h40 le samedi, et elle se classera à cet endroit de la chronologie. KANAP conserve séparément le moment où la note a réellement été enregistrée, et cet horodatage n'est jamais modifiable : l'antidatage reste honnête.

**Les entrées automatiques** apparaissent aux côtés de vos notes :

| Entrée | Quand elle est écrite |
|--------|-----------------------|
| **Système** | À la création : « Incident enregistré » |
| **Changement de statut** | À chaque changement de statut, affiché « Statut : En cours → Résolu » |
| **Changement de gravité** | À chaque changement de gravité, même format |
| **Réouverture** | À la réouverture, avec le motif que vous avez saisi |
| **Liens mis à jour** | Quand des actifs ou des applications sont liés ou déliés, en les nommant |

Chaque ligne affiche l'auteur, l'heure à laquelle elle se rapporte (survolez pour « il y a 3 jours ») et le type d'entrée pour tout ce qui n'est pas une simple note.

Le composeur disparaît dès que l'incident est clôturé ou annulé. Les modifications de champs faites hors du journal, comme la correction de la description, sont consignées dans le journal d'audit de la plateforme plutôt que dans le journal de l'incident.

La revue d'incident conserve son propre historique. Chaque enregistrement qui la modifie produit une version, et les versions sont conservées définitivement. La rédaction courante ne crée pas d'entrée de journal : écrire la revue n'est pas un événement de l'incident, et le journal d'audit garde la trace de qui a modifié quoi. En revanche, la clôture, l'annulation et les imports CSV écrivent une entrée de journal, et cette entrée nomme la version de la revue à laquelle elle se rapporte, affichée « Version 4 de la revue d'incident (DOC-12) ».

La réouverture ne change rien à cela. Les versions restent, l'entrée de clôture continue de pointer vers la version qui était courante au moment de la clôture, et ce texte reste lisible plus tard avec les images qu'il contenait, selon les droits dont l'incident dispose à ce moment-là.

---

### Relations

- **Actifs** : les serveurs, VM ou équipements concernés. Recherchez et sélectionnez ; les liaisons et déliaisons sont consignées au journal
- **Applications** : les applications et services touchés, même comportement
- **Tâches** : le travail de suivi. Créez une tâche directement depuis l'incident, elle y reste rattachée. La tâche affiche « Incident · INC-14 » dans sa propre barre latérale, et la colonne Tâches de l'incident la compte

La liaison se fait uniquement depuis l'incident. Un actif ou une application liés affichent l'incident dans une section **Incidents** en lecture seule de leur propre onglet Relations : celui qui consulte un serveur voit son historique d'incidents.

---

### Documents

Les documents de la base de connaissances liés à cet incident : le rapport du fournisseur, la procédure suivie, la note rédigée par l'équipe réseau. Avec `knowledge:member`, vous pouvez créer un document directement depuis cet onglet.

La revue d'incident n'apparaît pas ici. Elle appartient à l'incident lui-même et se rédige dans l'onglet Vue d'ensemble.

---

### Pièces jointes

Glissez-déposez des fichiers ou cliquez pour les sélectionner : captures d'écran, extraits de logs, exports de mails, rapport d'incident du fournisseur. Cliquez sur une pièce jointe pour la télécharger. Les téléversements et suppressions s'arrêtent dès que l'incident est clôturé.

---

## Clôture, réouverture et annulation

**Résolu** signifie que le service est rétabli. **Clôturé** signifie que l'enregistrement est définitif.

La clôture verrouille l'incident. Champs, revue d'incident, notes de journal, liens, pièces jointes et création de tâches sont tous refusés, dans l'interface, dans la base de connaissances, dans l'assistant comme via l'API. La Vue d'ensemble affiche un bandeau d'une ligne : « Clôturé le 12 mars 2026. Rouvrez-le pour le modifier. » La revue est gelée sur la version nommée par l'entrée de journal, que la clôture vienne de l'incident ou d'un import CSV.

**Rouvrir** (`incidents:admin`) ramène un incident résolu, clôturé ou annulé à En cours et efface les dates de résolution et de clôture. Un motif est obligatoire et il est écrit dans le journal : l'enregistrement montre donc pourquoi on y est revenu.

**Annuler l'incident** (`incidents:admin`) s'utilise pour un enregistrement qui n'aurait jamais dû exister : un doublon, ou un événement saisi par erreur. Un motif est obligatoire, le statut devient Annulé et l'incident est verrouillé comme s'il était clôturé. Rien n'est supprimé et le numéro reste en place : `INC-13` ne disparaît jamais entre `INC-12` et `INC-14`. Un trou dans la numérotation serait la première chose sur laquelle un auditeur reviendrait.

Il n'y a pas de suppression.

---

## Conformité et éléments de preuve

Deux interrupteurs du tiroir portent la partie réglementaire de l'enregistrement :

- **Données personnelles concernées** : activez-le dès que des données personnelles ont été exposées, altérées ou perdues. C'est l'indicateur sur lequel filtre votre délégué à la protection des données
- **Notification à l'autorité requise** : activez-le quand l'événement doit être signalé, par exemple à une autorité de protection des données, à une agence nationale de cybersécurité ou à un régulateur sectoriel. **Notifié le** enregistre alors la date de dépôt, et **Parties informées** liste qui a été prévenu : régulateur, assureur, clients touchés, sécurité groupe

Les délais et les seuils dépendent de votre juridiction et de votre secteur. KANAP enregistre les faits et les dates ; il ne décide pas si vous devez notifier.

**Ce que le registre apporte à un auditeur** :

- Une séquence numérotée continue, sans suppression ni trou
- Pour chaque incident : quand il a commencé, quand il a été remarqué, quand il a été résolu et clôturé, et qui en était responsable
- Un journal impossible à réécrire, avec chaque changement de statut et de gravité daté et attribué
- Les preuves elles-mêmes, sous forme de pièces jointes et de documents liés
- La revue d'incident, avec la cause racine, les actions correctives et le retour d'expérience, conservée version par version, et les tâches de suivi qui prouvent que les actions ont été menées
- Des vues filtrées par période, gravité, catégorie ou indicateur de conformité, directement depuis la liste
- Un export CSV du registre (**Exporter CSV** dans la liste), pour les auditeurs et pour vos propres archives. Les incidents restreints sont omis sauf si vous avez le droit de les voir ; le fichier comporte une colonne **Restreindre aux administrateurs du registre**, importable
- Un rapport PDF d'un incident (**Exporter en PDF** dans l'espace de travail), pour l'auditeur qui veut une fiche plutôt que tout le registre

**Importer un registre existant** : **Importer CSV** dans la liste accepte un fichier CSV. Laissez la colonne référence vide pour créer des incidents (KANAP attribue les numéros INC suivants), ou conservez la référence INC-N pour mettre à jour les enregistrements correspondants. Chaque incident importé reçoit une entrée de journal indiquant qu'il provient d'un fichier. Exportez d'abord si vous voulez la disposition exacte des colonnes.

Le fichier porte la **Description** courte dans une colonne et toute la **Revue d'incident** dans une autre, sous forme de texte mis en forme. Cette unique colonne de revue remplace les anciennes colonnes Impact, Cause racine, Actions correctives et Enseignements. Titres, listes et liens survivent à l'aller-retour ; les images collées, non, puisqu'elles vivent dans le document. Une cellule de revue vide laisse le texte existant intact.

L'import est la seule opération qui écrit encore dans un incident clôturé ou annulé : une correction qui arrive des mois plus tard peut donc être déposée sans rouvrir l'enregistrement. Elle crée une nouvelle version de la revue et une entrée de journal qui la référence, et elle ne réécrit jamais la version à laquelle la clôture se rapporte. Rien d'autre n'est assoupli : les autorisations du registre s'appliquent, et un incident restreint que vous n'avez pas le droit de voir est refusé.

---

## Exporter un rapport PDF pour un auditeur

Ouvrez un incident et cliquez sur **Exporter en PDF** dans les actions de l'en-tête. KANAP télécharge un PDF de cet enregistrement : `INC-12-incident-report.pdf`. Le téléchargement utilise votre session connectée ; ce n'est pas un lien public.

Le rapport suit la langue de l'interface (anglais, français, allemand ou espagnol). Il est assemblé dans cet ordre :

1. En-tête et propriétés de l'incident
2. La description courte
3. La revue d'incident telle qu'elle se lit aujourd'hui, avec sa mise en forme et ses images
4. Le journal dans l'ordre chronologique, avec les versions de revue auxquelles les entrées se rapportent
5. Les actifs, applications, tâches et documents liés
6. Les champs de conformité
7. Les pièces jointes (nom du fichier, taille et date)

Les sections vides sont omises, et une revue qui ne contient encore que les titres du modèle intacts compte comme vide.

L'export est une lecture. Il fonctionne sur un incident clôturé ou annulé ; l'enregistrement reste verrouillé. Le bouton n'apparaît pas sur **Nouvel incident**.

---

## Catégories

Les catégories d'incident vous appartiennent : définissez-les dans **Cartographie SI > Paramètres**, sous **Incidents > Catégories d'incident**. KANAP fournit par défaut infrastructure, sécurité, application, données, fournisseur et autre.

Gardez la liste courte. Les catégories sont ce qui vous servira à regrouper une année d'incidents, et une liste de trente est une liste que personne n'utilise de façon cohérente. Plutôt que de supprimer une catégorie déjà utilisée, marquez-la comme obsolète : elle disparaît du sélecteur pour les nouveaux incidents tandis que les existants conservent leur historique.

---

## Demander à l'assistant

Plaid peut interroger le registre dans le chat, avec les mêmes droits que dans le reste de l'application. Demandez-lui un décompte (« Combien d'incidents critiques ce trimestre ? »), une liste filtrée (« Liste des incidents ouverts sur PAR-ESX-01 ») ou une fiche complète (« Résumé de INC-2 »). Cette dernière inclut le journal et la revue d'incident : une question peut donc trouver sa réponse dans la cause racine ou le retour d'expérience. Un incident restreint reste hors des réponses, des décomptes et des sources, revue comprise.

---

## Conseils

- **Enregistrez tôt, complétez ensuite** : créez l'incident pendant qu'il se produit, avec un titre et une gravité. Le journal est fait pour ajouter les faits au fil de l'eau
- **Écrivez des notes factuelles, avec des heures** : « 13h05 bascule sur le site secondaire, messagerie rétablie pour 40 utilisateurs ». Réglez la date et l'heure pour que la chronologie reflète l'incident, pas votre vitesse de frappe
- **Antidatez honnêtement** : Début et Détecté sont faits pour porter les heures réelles. L'heure d'enregistrement de chaque entrée de journal est conservée à part et ne peut pas être modifiée
- **Un incident, pas un par ticket** : une panne unique qui a généré quarante tickets est un seul incident, lié aux actifs concernés
- **Transformez les actions en tâches** : la section Actions correctives de la revue décrit l'intention ; une tâche avec un assigné et une échéance est ce qui se fait réellement
- **Clôturez délibérément** : la clôture est le moment où l'enregistrement devient une preuve. Terminez la revue avant de clôturer, car la version conservée à cet instant est celle que lira un auditeur, et il faudra ensuite un administrateur pour rouvrir l'incident
- **Revoyez le registre chaque trimestre** : filtrez par période et par gravité, regardez les catégories récurrentes et les actifs qui apparaissent plus d'une fois. C'est de là que vient la prochaine demande de budget
