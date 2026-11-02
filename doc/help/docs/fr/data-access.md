# Accès aux données

Les rôles disent ce qu'une personne peut faire dans chaque module. L'accès aux données dit sur quelle partie du budget elle peut le faire. Avec lui, le responsable IT d'une filiale gère le budget de sa filiale sans voir celui des autres, et un directeur lit les lignes de ses propres centres de coûts.

L'accès aux données s'applique aux lignes budgétaires (OPEX et CAPEX) et aux contrats, ainsi qu'à tout ce qui les montre : listes, totaux, rapports, recherche, Plaid, exports. Les autres modules fonctionnent comme avant pour tout le monde.

Chaque personne commence avec **Toutes les données**. Rien ne change tant qu'un administrateur ne limite personne.

## Où le trouver

- **La fenêtre de l'utilisateur** : ouvrez un utilisateur depuis **Administration > Utilisateurs** et choisissez l'onglet **Accès aux données**, à côté de **Identité**. L'entrée **Accès aux données** du menu d'une ligne ouvre la fenêtre sur cet onglet.
- **Administration > Accès aux données** : la liste des personnes dont l'accès est limité, avec l'import et l'export.
- **L'onglet Accès** d'une société et d'un centre de coûts ou d'un groupe : qui le voit, et par quel nœud.

Autorisations : ces écrans demandent le niveau Admin sur les utilisateurs (`users:admin`), et toutes les données pour vous-même. Vous ne pouvez pas modifier votre propre accès.

## Toutes les données ou limité à

Une personne est dans l'un de ces deux modes :

- **Toutes les données** : la personne voit tout le budget et tous les contrats, selon ce que ses rôles permettent. C'est le mode par défaut.
- **Limité à** : la personne voit ce que couvre une liste de nœuds. Chaque nœud a un accès, **Lecture** ou **Saisie**.

Un nœud est l'un de ceux-ci :

| Nœud | Ce qu'il couvre |
|---|---|
| Une société | Les lignes que la société paie, les lignes imputées à ses centres de coûts, et ses contrats |
| Un groupe de centres | Ses sous-groupes et leurs centres de coûts, quelle que soit leur société |
| Un centre de coûts | Les lignes qui lui sont imputées |
| **Tout** | Toutes les lignes et tous les contrats |

Une ligne est visible quand une société de la liste la paie, ou quand elle est imputée à un centre de coûts situé sous un nœud de la liste. Un contrat est visible quand sa société est dans la liste, ou quand son champ **Centre de coûts ou groupe** pointe sous un nœud de la liste. Ce champ est facultatif, et la liste des contrats a une colonne et un filtre **Sans centre de coûts** pour le compléter.

Un exemple. L'espace de travail a deux sociétés, Alpha France et Alpha Spain, et un groupe Infrastructure qui contient INF-FR (France) et INF-ES (Espagne).

- Marta, limitée à **Alpha Spain (Saisie)**, voit et modifie les lignes payées par Alpha Spain.
- Paul, limité à **Infrastructure (Lecture)**, lit les lignes imputées à INF-FR et INF-ES. Une ligne espagnole sans centre de coûts lui reste cachée.
- Claire, en **Toutes les données**, voit tout.

**Tout** sert aux personnes qui lisent tout le budget et en modifient une partie : donnez-leur **Tout (Lecture)** plus les nœuds qu'elles modifient.

Les nœuds s'additionnent. Quand deux nœuds couvrent la même ligne, l'accès le plus large l'emporte : avec Réseaux en Lecture et RES-01 en Saisie, les lignes de RES-01 sont modifiables et le reste de Réseaux est en lecture seule. Un nœud ne peut pas exclure l'un de ses sous-nœuds.

### Créer et déplacer une ligne ou un contrat

Pour créer une ligne, ou changer sa société ou son centre de coûts, la société doit correspondre à un nœud en Saisie :

- la société qui paie est une société en Saisie, ou
- le centre de coûts de la ligne est couvert en Saisie et la ligne est payée par la société de ce centre.

Un nœud centre de coûts permet donc de créer les lignes de ce centre, payées par sa société. Il ne permet pas de faire payer une autre société. Une ligne payée par une autre société que celle de son centre de coûts se lit par le centre de coûts et ne se modifie que par sa société qui paie.

Les contrats suivent la même règle avec leur société et leur **Centre de coûts ou groupe**. Les sélecteurs de société et de centre de coûts ne proposent que les valeurs que la personne peut utiliser. Une autre valeur est refusée avec « Cette société ou ce centre de coûts ne fait pas partie de votre accès. »

### Lignes sans société

D'anciennes lignes peuvent n'avoir aucune société. Elles ne sont visibles que des personnes qui ont toutes les données, des personnes qui ont un nœud **Tout** et des personnes nommées dessus. **Administration > Accès aux données** les compte, avec un lien vers la liste.

## Le rôle dit quoi, les nœuds disent où

Les deux fonctionnent ensemble :

- **Saisie** donne ce que permettent les rôles de la personne. Un Lecteur budget avec un nœud en Saisie ne fait toujours que lire.
- **Lecture** plafonne l'accès à la lecture, quels que soient les rôles.
- L'accès aux données appartient à la personne. Il s'applique au budget et aux contrats avec le niveau que chaque rôle donne dans chaque module.

Par exemple, un Membre budget limité à **Alpha Spain (Saisie)** crée et modifie des lignes espagnoles. Un Lecteur budget avec le même nœud les lit.

## Ce qu'une personne voit toujours

Une personne limitée voit toujours ce sur quoi elle est nommée, même hors de ses nœuds :

| Nommée comme | Accès, dans la limite du rôle |
|---|---|
| Responsable IT ou responsable métier d'une ligne | Saisie |
| Responsable d'un contrat | Saisie |
| Assignée ou responsable d'une tâche | Saisie |
| Personne qui suit une tâche | Lecture |

Créer une tâche ne compte pas. Être nommé ouvre l'élément. Cela ne permet pas de le placer sur une société ou un centre de coûts hors des nœuds en Saisie de la personne, ni de le supprimer. Un changement qui sortirait une ligne de l'accès de la personne est refusé avec « Ce changement sortirait la ligne de votre accès. Restez l'un de ses responsables, ou demandez à une personne qui a accès à sa société. »

Une personne limitée sans nœud ne voit que ce sur quoi elle est nommée. Une liste vide ne redevient jamais toutes les données.

Le responsable budgétaire d'un centre de coûts n'est pas nommé sur ses lignes. Pour donner leurs centres aux responsables budgétaires, utilisez **Ajouter ses centres** dans la fenêtre de l'utilisateur (voir plus bas).

## Administrateurs

Le rôle Administrateur voit toujours toutes les données. Son onglet **Accès aux données** affiche « Les administrateurs voient toutes les données. » et n'a pas de commande.

Quand une personne limitée reçoit le rôle Administrateur, son accès enregistré reste en place et n'a pas d'effet. Si on lui retire le rôle plus tard, l'accès enregistré s'applique de nouveau.

## Régler l'accès d'une personne

L'onglet **Accès aux données** de la fenêtre de l'utilisateur contient :

- **Toutes les données** et **Limité à**.
- Sous **Limité à**, les nœuds, chacun avec son type, un sélecteur **Lecture** ou **Saisie** et un bouton pour le retirer.
- **Ajouter**, qui ouvre un sélecteur en trois sections : **Sociétés**, **Centres de coûts** (groupes et centres, en arbre) et **Tout**. Sans centres de coûts dans l'espace de travail, le sélecteur propose les sociétés et **Tout**.
- **Ajouter ses centres (3)**, quand la personne est responsable budgétaire de centres de coûts. Ce bouton ajoute ces centres en Saisie.
- Deux rappels : « Cette personne voit aussi, toujours, ce sur quoi elle est nommée. » et « S'applique au budget et aux contrats. »
- L'aperçu, par exemple « Avec cet accès : 312 lignes budgétaires, dont 280 en saisie ; 45 contrats. »
- Qui a modifié l'accès en dernier, et quand.

L'aperçu suit chaque changement, avant l'enregistrement. Il mesure les nœuds, pas les rôles : **en saisie** compte les lignes ouvertes en Saisie, même quand les rôles de la personne ne lui permettent pas de les modifier.

Revenir à **Toutes les données** demande une confirmation, par exemple « Marta Ruiz verra toutes les données du budget et des contrats. »

Un seul **Enregistrer** écrit toute la fenêtre : l'onglet d'identité, puis l'accès. Quand quelque chose est refusé, le message s'affiche sur son onglet et la fenêtre reste ouverte.

## La page Accès aux données

**Administration > Accès aux données** liste toutes les personnes limitées, y compris celles qui n'ont aucun nœud :

| Colonne | Contenu |
|---|---|
| **Personne** | Le nom. Cliquez dessus pour ouvrir la fenêtre de l'utilisateur sur son onglet **Accès aux données** |
| **Rôles** | Les rôles de la personne |
| **Nœuds** | Chaque nœud avec son accès, ou **Aucun** |
| **Dernière modification** | Qui a modifié l'accès en dernier, et quand |

- **Rechercher un nom** filtre par nom.
- **Qui a accès à…** filtre sur une société ou un centre de coûts : la liste garde les personnes dont les nœuds le couvrent.
- Au-dessus de la liste, deux compteurs : les personnes limitées, et les lignes budgétaires sans société, avec un lien vers ces lignes.

Les personnes en **Toutes les données** n'y figurent pas.

Dans **Administration > Utilisateurs**, une colonne **Accès** apparaît dès qu'une personne est limitée. Elle affiche **Toutes les données**, les noms des nœuds de la personne (**Tout** pour ce nœud), ou **Aucun** pour une personne limitée sans nœud.

## L'onglet Accès des sociétés et des centres de coûts { #the-access-tab-of-companies-and-cost-centers }

Les sociétés et les centres de coûts ont un onglet **Accès**, pour les mêmes personnes qui gèrent l'accès aux données.

Sur une société :

- **Voient toute la société** : les personnes qui ont un nœud sur la société, ou **Tout**. **Ajouter** donne cette société à une personne en Lecture ou en Saisie.
- **En voient une partie** : les personnes qui atteignent certaines de ses lignes par un groupe ou un centre de coûts de la société, avec le nœud qui donne l'accès. Par exemple, sur Alpha Spain : Paul, par Infrastructure.

Sur un centre de coûts ou un groupe :

- **Accès direct** : les personnes qui ont un nœud sur ce centre ou ce groupe. **Ajouter** donne ce nœud à une personne en Lecture ou en Saisie.
- **Accès hérité** : les personnes qui l'atteignent par un groupe parent, la société du centre, ou **Tout**. La colonne **Par** renvoie au nœud qui donne l'accès. Modifiez un accès hérité sur ce nœud.

Les changements de ces onglets s'enregistrent aussitôt. Quand la personne ajoutée a toutes les données, une confirmation indique que son accès passera à ce seul nœud. **Annuler** le laisse tel quel.

## Import et export

**Importer** et **Exporter**, sur **Administration > Accès aux données**, déplacent l'accès de nombreuses personnes à la fois, dans un fichier CSV ou un classeur Excel (`.xlsx`). Voir [Fichiers CSV et Excel](csv-files.md). Un fichier contient une ligne par personne et par nœud :

| Colonne | Contenu |
|---|---|
| `email` | L'adresse e-mail de la personne |
| `type` | `company`, `cost_center` ou `all` |
| `node` | Une société par son nom, un centre de coûts ou un groupe par son code. Vide pour `all` |
| `access` | `read` ou `edit` |

Par exemple :

```text
email;type;node;access
marta.ruiz@example.com;company;Alpha Spain;edit
paul.martin@example.com;cost_center;INF;read
claire.dubois@example.com;all;;read
```

- Une personne présente dans le fichier reçoit exactement les nœuds listés pour elle, en **Limité à**. Une personne absente du fichier ne change pas.
- Un import limite toujours. Pour redonner toutes les données à quelqu'un, passez par la fenêtre de l'utilisateur.
- La vérification vient d'abord et n'écrit rien. Elle signale chaque ligne refusée : personne inconnue, société ou centre de coûts inconnu, type ou accès invalide, nœud listé deux fois pour une même personne, Administrateur, votre propre compte. Un fichier avec une erreur ne charge rien.
- L'export écrit le même format, pour les personnes limitées. Une personne limitée sans nœud n'a pas de ligne : réimporter le fichier la laisse telle quelle.

Le séparateur, l'encodage et les deux étapes de l'import sont ceux de tous les fichiers CSV : voir [Fichiers CSV et Excel](csv-files.md).

## Journal d'audit { #audit-log }

Chaque changement de l'accès d'une personne est enregistré dans le [Journal d'audit](admin.md#journal-daudit), dans la table **Accès aux données**. L'entrée nomme la personne et montre le mode, les nœuds et leur accès avant et après. Sa source est **Écran** ou **Import**. Un enregistrement sans effet n'est pas journalisé.

## Demander à l'assistant

[Plaid](ai-assistant.md#tool-calls) lit cette page et l'onglet Accès des sociétés pour un administrateur des utilisateurs qui a accès à toutes les données. Demandez par exemple : « Qui est limité à Alpha Spain ? », « Quelles personnes limitées n'ont aucun nœud ? » ou « Que peut voir Marta Ruiz ? » Les changements d'accès d'une personne restent sur les écrans décrits ici.

## Ce que voit une personne limitée { #what-a-limited-person-sees }

Pour une personne limitée, le budget et les contrats ne contiennent que ce que couvre son accès.

**Listes, totaux et rapports** ne comptent que les lignes visibles. Une ligne est entière ou absente. Il n'y a pas de total du groupe.

**Lecture seule.** Une ligne ou un contrat visible en Lecture affiche « Lecture seule dans votre accès » en haut, sans commandes de modification.

**Liens vers des éléments cachés.**

- Une ligne cachée apparaît par sa seule référence, comme `BL-12`, sans lien.
- Un contrat caché apparaît comme « Contrat hors de votre accès », sans lien.
- Les listes de liens (les lignes d'un contrat, d'une application, d'un serveur, d'une technologie, d'un projet ou d'une demande) montrent les liens visibles, puis un nombre comme « et 3 lignes hors de votre accès ». Ni nom, ni montant.
- Le contrat d'une ligne visible s'ouvre en lecture seule. Ses pièces jointes et liens documentaires restent fermés, avec un nombre comme « 2 pièces jointes, réservées aux personnes qui voient ce contrat ».
- La recherche, Plaid, MCP et les exports ne montrent aucune trace d'un élément caché.

Ces nombres apparaissent pour les personnes qui lisent le budget mais pas ces lignes. Une personne sans le droit sur le budget ne voit aucune ligne budgétaire dans les panneaux des applications, des serveurs et des projets, ni aucun nombre.

**Les chiffres d'un élément visible** portent sur toutes ses données. La couverture d'un contrat compte toutes ses lignes liées, y compris les lignes cachées, pour que son responsable voie la vraie couverture. Voir [Contrats](contracts.md#engagement-et-couverture).

**Supprimer un élément qui porte des liens cachés** (une application, un serveur, une technologie, un projet, une demande) est refusé, par exemple « Cette application est liée à 3 lignes hors de votre accès. » Une personne qui voit ces lignes peut le supprimer.

**Les tâches** d'une ligne ou d'un contrat le suivent : la personne les voit quand elle voit la ligne ou le contrat, ou quand elle est nommée sur la tâche.

**Le fichier budget**, pour une personne dont le rôle le permet, suit les mêmes règles ligne par ligne. Voir [Charger un budget depuis un tableur](budget-file.md#limited-data-access).

**Dimensions à valeurs ouvertes.** Sur une dimension marquée **Valeurs ouvertes**, toute personne qui peut modifier une ligne ajoute une valeur depuis la ligne ou le fichier budget. Sur les autres dimensions, les valeurs se créent sur la page Dimensions analytiques, par des personnes qui ont toutes les données. Voir [Dimensions analytiques](analytics.md#open-values).

**Refacturation.** La refacturation par société s'ouvre sur les sociétés des nœuds société de la personne (toutes avec **Tout**). Elle montre la part refacturée à ces sociétés, ligne par ligne : référence, libellé, société qui paie, méthode, pourcentage, montant, et les départements quand la ventilation y descend. Une ligne que la personne ne voit pas autrement affiche sa référence et son libellé sans lien. Les chiffres des autres sociétés et les totaux du groupe sont retirés. La refacturation globale montre les lignes visibles. Un nœud centre de coûts n'ouvre pas la refacturation d'une société. Voir [Rapports](reports.md#refacturation-par-societe).

### Réservé aux personnes qui ont toutes les données

Même si ses rôles le permettent, une personne limitée ne peut pas :

- modifier les réglages de l'espace de travail : geler et dégeler, la règle de ventilation par défaut, les colonnes du budget, les devises, la copie annuelle des données de référence, les effectifs et indicateurs des sociétés et des départements ;
- lancer des opérations sur de nombreuses lignes : copier et remettre à zéro des colonnes budgétaires, copier les ventilations, supprimer en masse ;
- supprimer une ligne ou un contrat ;
- gérer les personnes : utilisateurs, rôles, accès aux données, journal d'audit ;
- modifier les données d'organisation : sociétés, départements, centres de coûts, comptes et plans de comptes, processus métier, les dimensions elles-mêmes et les valeurs des dimensions sans valeurs ouvertes ;
- modifier ou supprimer un fournisseur ou un contact partagé (elle peut en créer, selon son rôle) ;
- importer des fournisseurs, des contacts, des contrats ou des tâches ;
- utiliser les écrans des agents IA ;
- modifier les réglages des contrats, la personnalisation et les tâches planifiées.

Les contrôles qui accompagnent ces opérations (les aperçus d'impact, le contrôle avant suppression) sont réservés eux aussi. Ces commandes sont masquées. Une demande qui atteint quand même le serveur est refusée avec « Cette action est réservée aux personnes qui ont accès à toutes les données. » Une personne qui a un rôle d'administration du budget garde le fichier budget dans son accès.

## Quand l'accès aux données est indisponible

Limiter l'accès aux données demande une étape unique sur le serveur de base de données. Tant qu'elle n'est pas faite, **Limité à** est grisé dans la fenêtre de l'utilisateur, avec « Limiter l'accès aux données demande une étape unique sur la base de données, à faire par la personne qui exploite KANAP. » et un lien vers cette page. **Administration > Accès aux données** affiche le même message, avec ce qui manque.

Sur site, l'étape figure dans le guide d'installation : [Accès aux données par périmètre](on-premise/installation.md#optional-data-scoped-access).

Si l'étape est défaite plus tard, par exemple après la restauration d'une base sur un autre serveur, les personnes limitées sont refusées avec « L'accès aux données est momentanément indisponible. Contactez la personne qui exploite KANAP. » Les personnes qui ont toutes les données continuent de travailler. Refaire l'étape puis redémarrer l'API rétablit les personnes limitées. Voir [Sauvegarde et restauration](on-premise/operations.md#restauration).
