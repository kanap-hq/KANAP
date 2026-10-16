# Rapports du portefeuille

Les rapports du portefeuille fournissent des analyses centrées sur la charge de travail, la capacité et les signaux de livraison.

## Premiers pas

Naviguez vers **Portefeuille > Rapports** pour ouvrir le hub de reporting.

**Autorisations** :
- Vous avez besoin au minimum de `portfolio_reports:reader` pour accéder aux rapports du portefeuille.

Si vous ne voyez pas Rapports dans le menu, demandez à votre administrateur de vous accorder l'accès.

---

## Page d'accueil des rapports

La page d'accueil des rapports du portefeuille liste les rapports disponibles sous forme de cartes, sur trois rangées qui se lisent par horizon. Cliquez sur une carte pour ouvrir le rapport.

**Ce qui s'est passé**
- **Bilan de la période** : demandes, projets et tâches créés, modifiés et clôturés sur une période.
- **Activité par personne** : la même page, ouverte sur sa lecture des tâches par personne.
- **Temps saisi** : où partent les jours saisis, mois après mois : projets ou autre travail, équipe par équipe.

**Ce qui est en cours**
- **Flux et ancienneté** : ce qui entre et ce qui sort semaine après semaine, l'âge du travail ouvert et le temps qu'il faut pour clôturer.
- **Points d'attention par contributeur** : les tâches ouvertes, en retard et sans mouvement, équipe par équipe et personne par personne.

**Ce qui vient**
- **À venir** : les tâches qui arrivent à échéance, les fins et démarrages de projet prévus, les demandes en attente depuis trop longtemps et les livraisons demandées.
- **Planning de capacité** : la charge attendue par rapport à la capacité, pour les contributeurs et les équipes.

---

## Pilotage

Le premier bandeau au-dessus des cartes de rapports est la vue de pilotage quotidienne. Il répond à deux questions : qu'est-ce qui a bougé récemment, et qu'est-ce qui attend quelqu'un.

### La période

L'en-tête affiche la période utilisée et permet de basculer entre les 7, 30 et 90 derniers jours. La période se termine toujours aujourd'hui et se lit dans votre propre fuseau horaire. Votre choix est mémorisé sur ce navigateur.

### Flux

Une ligne par entité se lit ainsi : **14 créés · 9 clôturés · 52 ouverts (+5)**.

- **Créés** : éléments créés pendant la période et toujours présents aujourd'hui.
- **Clôturés** : éléments que le dernier changement de statut de la période a laissés clos. La création compte comme un changement de statut : un élément créé déjà terminé compte comme clôturé. Clos signifie Terminé ou Annulé pour les tâches et les projets, Rejeté ou Converti pour les demandes.
- **Ouverts** : éléments ouverts en ce moment, quoi qu'il se soit passé pendant la période. Ce chiffre est un lien vers la liste correspondante.
- **(+5)** : la variation nette, affichée seulement quand elle n'est pas nulle. C'est créés, plus rouverts, moins clôturés. Les éléments rouverts sont ceux passés d'un statut clos à un statut ouvert. Survolez le chiffre pour voir la formule.

Créés et clôturés proviennent de l'historique des modifications. Ils couvrent donc toutes les façons d'écrire un élément : l'application, un import CSV et les agents. Aucun filtre de liste ne reproduit cet historique : ces deux chiffres ouvrent donc le **Bilan de la période** sur les mêmes jours. Ses listes des créations et des clôtures montrent exactement les éléments comptés ici. Un zéro n'est pas un lien.

### Quelles tâches sont comptées

Chaque chiffre de tâche ne compte que les tâches autonomes et les tâches de projet. Les tâches rattachées à un contrat, à une ligne de dépense, à une ligne CAPEX ou à un incident relèvent de ces processus et sont exclues partout dans ce bandeau.

### À traiter

La dernière ligne n'apparaît que si quelque chose demande une décision :
- **Tâches en retard** : tâches ouvertes dont l'échéance est antérieure à aujourd'hui. Le chiffre ouvre la liste des tâches filtrée sur les mêmes éléments.
- **Tâches sans responsable** : tâches ouvertes que personne ne porte. La liste des tâches n'a pas de filtre sur un responsable vide, ce chiffre n'est donc pas un lien.
- **Projets sans activité depuis 30 jours** : projets en cours ou en test où rien ne s'est passé depuis un mois. Un clic ouvre une courte liste de ces projets avec la date de leur dernière activité, et chaque nom ouvre le projet.

L'activité est lue au sens large. Un projet est actif dès que quelque chose a changé sur lui ou sur l'une de ses tâches, dès que quelqu'un a écrit dans son journal, ou dès que du temps a été saisi sur le projet ou sur l'une de ses tâches. Un projet n'apparaît ici que si tout cela date de plus de 30 jours.

---

## À classer

Au-dessus des cartes de rapports, un bandeau compact indique la part de votre travail ouvert à laquelle il manque encore une valeur de classification. Utilisez-le comme aide au pilotage quotidien : voyez l'écart, cliquez, corrigez.

### Ce qui est compté

Une ligne par entité, pour les éléments ouverts uniquement :
- **Tâches** : statut autre que Terminé et Annulé.
- **Demandes** : statut autre que Rejeté et Converti.
- **Projets** : statut autre que Terminé et Annulé.

Chaque ligne indique combien de ces éléments n'ont ni Source, ni Catégorie, ni Filière. Les tâches indiquent en plus combien n'ont pas de Type de tâche.

### Quelles tâches sont exclues

Seules les tâches autonomes et les tâches de projet sont comptées. Les tâches rattachées à un contrat, à une ligne de dépense, à une ligne CAPEX ou à un incident ne portent jamais de classification. Les compter signalerait un écart que personne ne peut combler.

Une tâche de projet sans classification propre hérite de celle de son projet, et la liste des tâches affiche cette valeur héritée. Les compteurs suivent la même règle : un chiffre ne vous envoie donc jamais vers une liste où la colonne est déjà remplie.

### Filières

Une Filière manquante n'est comptée que si l'élément a déjà une Catégorie et que cette Catégorie propose au moins une filière active. Beaucoup de catégories n'offrent aucune filière. Un élément sans catégorie est déjà compté sous Catégorie.

### Ouvrir la liste

Chaque chiffre supérieur à zéro est un lien. Un clic ouvre la liste correspondante, déjà filtrée sur exactement les éléments derrière le chiffre, pour tout le tenant. Le total de la liste correspond au chiffre cliqué. Les zéros sont affichés pour le contexte mais ne sont pas cliquables.

Quand rien ne manque, le bandeau affiche une seule ligne confirmant que tout ce qui est ouvert est classé.

---

## À venir

Utilisez ce rapport pour voir ce qui arrive bientôt à échéance et ce qui attend depuis trop longtemps. C'est le seul rapport tourné vers l'avenir : le bilan de la période lit le passé, le rapport de flux et les blocs d'attention lisent le présent.

### Ce qu'il affiche

La page comporte cinq sections. Chacune indique le nombre d'éléments qu'elle contient, un tableau trié par date et un horizon que vous pouvez modifier à droite de son titre.

- **Fins de projet prévues** : projets ouverts dont la fin prévue tombe entre aujourd'hui et la fin de l'horizon. Horizon : 30 (par défaut), 60 ou 90 jours. Les projets qui ont déjà dépassé leur fin prévue restent dans le rapport de flux ; une ligne donne leur nombre et l'ouvre.
- **Démarrages de projet prévus** : projets encore en Liste d'attente ou Planifié dont le début prévu tombe dans le même horizon.
- **Demandes en attente** : demandes encore En attente de revue, créées il y a au moins 14, 30 (par défaut) ou 60 jours. Les demandes Candidat, Approuvé et Suspendu ont déjà fait l'objet d'une décision : elles ne figurent pas ici.
- **Livraisons demandées** : demandes ouvertes (En attente de revue, Candidat, Approuvé, Suspendu) dont la date de livraison demandée tombe dans l'horizon des projets.
- **Tâches à échéance** : tâches ouvertes (Ouvert, En cours, En attente, En test) dont l'échéance tombe entre aujourd'hui et la fin de l'horizon, bornes incluses. Horizon : 7, 14 (par défaut) ou 30 jours. Seules les tâches autonomes et les tâches de projet comptent, comme dans les autres rapports. Une ligne sous le titre donne le nombre de tâches déjà en retard, avec un lien vers elles.

L'horizon des projets est partagé : le modifier dans l'une des trois sections qui l'utilisent le modifie dans les trois. La page mémorise vos horizons et les sections que vous avez repliées.

### Filtres

- **Projet** : les tâches de ces projets, ces projets eux-mêmes et les demandes qui leur sont liées.
- **Équipe** : les tâches assignées à un membre de l'équipe, et les projets et demandes qui en impliquent un.

### Ouvrir la liste

Chaque chiffre supérieur à zéro est un lien. Il ouvre la liste des tâches, des projets ou des demandes filtrée exactement sur les éléments de la section, avec les mêmes filtres de projet et d'équipe : le total de la liste correspond donc au chiffre. Le rapport n'a pas d'export : les listes s'exportent déjà.

---

## Rapport Planning de capacité

Utilisez ce rapport pour comprendre la charge de travail actuelle, la pression sur la capacité et le travail non assigné.

### Ce qu'il affiche
- **Charge restante** (IT + Métier), ajustée par l'avancement d'exécution.
- **Capacité** par contributeur (historique ou théorique).
- **Mois de travail** (jours restants / jours de capacité par mois).
- **Travail non assigné** lorsque la charge n'est pas entièrement allouée.
- **Les personnes sans fiche contributeur** affectées à un projet. Elles apparaissent en fin de liste avec leurs jours restants et sans capacité, pour que leur charge reste visible. Créez leur fiche contributeur pour leur donner une capacité.

### Filtres
- **Équipes** (multi-sélection, inclut **Aucune équipe**)
- **Statut** (par défaut : En attente, Planifié, En cours, En test, Suspendu)
- **Mode de capacité** : Historique (par défaut) ou Théorique
- **Grouper par** : Contributeurs (par défaut) ou Équipes

### Échelle de couleurs
Les cellules de la colonne **Mois de travail** sont colorées :

| Plage | Couleur |
|-------|---------|
| <= 1 mois | Vert |
| 1-3 mois | Jaune |
| 3-6 mois | Orange |
| 6-12 mois | Rouge |
| > 12 mois | Violet |
| Pas de données | Gris (N/D) |

### Cartes récapitulatives
La ligne récapitulative inclut :
- **Total des contributeurs**
- **Moyenne de mois de travail** (contributeurs avec capacité uniquement)
- **Travail non assigné** (total des jours non alloués et nombre de projets)

Cliquez sur **Travail non assigné** pour développer les détails.

### Exploration détaillée
Cliquez sur une ligne de contributeur pour ouvrir un détail par projet :
- Chaque ligne affiche la charge restante, le % d'allocation et vos jours.
- Les noms de projets sont cliquables et ouvrent l'onglet **Avancement** du projet.

### Exports
- **CSV** : Exporter le tableau du planning de capacité
- **PNG** : Capture du rapport
- **Imprimer** : Imprimer ou enregistrer en PDF

---

## Bilan de la période

Utilisez ce rapport pour voir ce qui est arrivé aux demandes, aux projets et aux tâches sur une période. Le rapport suit l'entonnoir du portefeuille : les demandes d'abord, puis les projets, puis les tâches.

### Ce qu'il affiche

Chacune des trois sections contient les trois mêmes listes.

- **Créations** : les éléments créés pendant la période.
- **Modifications** : les éléments modifiés pendant la période sans y avoir été créés ni clôturés.
- **Clôtures** : les éléments dont le dernier changement de statut de la période les laisse dans un statut de clôture.

Un élément créé et clôturé dans la même période apparaît dans les deux listes, avec sa propre date dans chacune. Il n'apparaît jamais sous Modifications : Modifications correspond à ce qui reste une fois les créations et les clôtures prises en compte.

La création compte comme un changement de statut. Un import CSV ou un agent peut créer une tâche déjà terminée, ou une demande déjà rejetée. Un tel élément figure en création et en clôture le même jour, même si personne n'a jamais changé son statut ensuite.

La clôture repose sur des statuts différents selon le type :

- **Demandes** : convertie ou rejetée. Une demande n'a pas de statut annulé.
- **Projets** : terminé ou annulé.
- **Tâches** : terminée ou annulée.

Chaque liste indique son nombre dans son titre. Une liste vide tient sur une seule ligne, ce qui garde le rapport court quand l'activité est faible.

### Quelles tâches sont comptées

La section Tâches ne couvre que les tâches du portefeuille : les tâches autonomes et les tâches rattachées à un projet. Les tâches rattachées à un contrat, à une ligne de dépense, à une ligne CAPEX ou à un incident sont exclues. C'est plus restreint que dans les versions précédentes du rapport, qui comptaient toutes les tâches.

### D'où vient un projet

La liste des projets créés comporte une colonne **Origine**.

- Un projet issu de la conversion d'une demande affiche cette demande, par exemple `REQ-12 Cave climate digital twin`. Cliquez dessus pour ouvrir la demande.
- Un projet créé sans demande affiche la façon dont il est entré dans le portefeuille, dans les mots employés partout ailleurs dans KANAP : **Fast-track**, **Historique** ou **Demande**.

### Replier une section

Chaque titre de section porte un chevron. Cliquez sur la ligne du titre pour replier la section, cliquez à nouveau pour la rouvrir. Une section repliée garde ses compteurs à côté de son titre : vous voyez toujours ce qu'elle contient.

Votre choix est mémorisé sur ce navigateur, section par section. L'impression n'est pas affectée : un rapport imprimé porte toujours les trois sections en entier.

### Ce qui a changé

Les listes Modifications comportent une colonne **Modifications**. Elle lit la piste d'audit de la période et affiche :

- le changement de statut, lorsque le statut a changé, sous la forme `En cours -> En test` ;
- puis les champs modifiés, en langage clair, séparés par des virgules.

La formulation reprend celle du fil d'historique de l'élément. Les champs réécrits à chaque enregistrement, comme l'horodatage technique de mise à jour, sont exclus.

### Filtres

- **Date de début** et **Date de fin** (7 derniers jours par défaut)
- **Source** (sélection multiple)
- **Catégorie** (sélection multiple)
- **Filière** (sélection multiple ; limitée aux catégories sélectionnées)
- **Types de tâche** (sélection multiple ; s'applique à la section Tâches)
- **Statut d'arrivée** (sélection multiple, groupée par demandes, projets et tâches)

Les filtres s'appliquent aux neuf listes, ainsi qu'à la lecture par personne.

**Statut d'arrivée** conserve les éléments que le dernier changement de statut de la période a laissés dans l'un des statuts sélectionnés. La création compte comme un changement de statut : un élément créé pendant la période et jamais déplacé ensuite a atteint le statut avec lequel il a été créé. Un élément dont le statut n'a pas changé pendant la période ne correspond à aucun statut : il disparaît dès qu'un statut est sélectionné. Le statut affiché dans la colonne Statut est celui que l'élément porte aujourd'hui, et il peut être différent : une tâche clôturée pendant la période puis rouverte depuis a atteint **Terminé**, et affiche **Ouvert**.

Un statut commun à plusieurs types, comme Terminé ou Suspendu, est un seul choix : le cocher sous Tâches le coche aussi sous Projets.

### Colonnes du tableau

Chaque liste commence par la référence métier (`REQ-12`, `PRJ-3`, `T-4`) et le nom. Un clic sur le nom ouvre l'élément.

**Demandes** : Référence, Nom de la demande, Source, Catégorie, Filière, Société, Statut, date de l'événement.

**Projets** : Référence, Nom du projet, Origine (liste des créations), Priorité, Source, Catégorie, Filière, Société, Charge, Statut, date de l'événement.

**Tâches** : Référence, Nom de la tâche, Type de tâche, Priorité, Source, Catégorie, Filière, Société, Statut, date de l'événement.

Une tâche sans société propre affiche la société de son projet, comme le fait la liste des tâches.

La colonne de date porte le jour de création sur les listes de créations, le jour de la dernière modification sur les listes de modifications et le jour de clôture sur les listes de clôtures. Les jours sont lus dans votre propre fuseau horaire.

Les listes de clôtures portent deux dates : **Créé le**, puis **Clôturé le**. Le jour de création est toujours affiché, même lorsque l'élément a été créé bien avant la période. Il indique d'un coup d'œil le temps qu'a pris l'élément.

Les listes de modifications ajoutent la colonne **Modifications** à la fin.

### Exports

- **CSV** : neuf blocs dans l'ordre de la page, chacun avec son propre titre et sa ligne d'en-tête.
- **XLSX** : trois feuilles, Demandes, Projets et Tâches. Les lignes vont des créations aux modifications puis aux clôtures, avec une colonne **Événement** en tête qui indique de quelle liste vient la ligne. La cellule du nom renvoie vers l'élément.

Les deux exports portent la référence, la société, l'origine d'un projet, les modifications d'une ligne modifiée et la date de l'événement. Les lignes de clôture portent aussi le jour de création.

Les deux fichiers sont écrits dans la langue de l'écran : titres, noms de colonnes, statuts, modifications, oui ou non et jours. Le CSV prend aussi le séparateur et la marque décimale de cette langue, comme décrit dans [Fichiers CSV](csv-files.md).

## Temps saisi

Les jours saisis mois après mois, sur des projets ou sur un autre travail, équipe par équipe et personne par personne. Le rapport montre comment la charge se répartit, pas qui saisit le plus : les équipes gardent leur ordre configuré et les personnes sont classées par ordre alphabétique.

### D'où viennent les jours

Le rapport lit toutes les saisies de temps : le temps saisi sur les tâches et le temps saisi directement sur un projet. Un jour vaut 8 heures, et les chiffres ont une décimale. Chaque saisie tombe dans le mois de sa date, dans votre propre fuseau horaire.

- **Jours projet** : temps saisi sur une tâche qui appartient à un projet, ou directement sur un projet.
- **Jours autre** : tout le reste du temps, par exemple les tâches autonomes.

Choisissez **6 mois** ou **12 mois**. Le mois en cours est toujours le dernier. La page mémorise votre choix.

### Ce qu'il affiche

- **Tuiles** : jours projet, jours autre, le total, la part projet et le nombre de contributeurs qui n'ont rien saisi sur la période. Le travail hors projet est souvent moins saisi que le travail projet, et cette dernière tuile le rappelle.
- **Graphique** : jours projet et jours autre empilés, mois par mois.
- **Tableau** : une ligne par équipe, une colonne par mois. Chaque cellule affiche les jours saisis, avec jours projet / jours autre en dessous. Dépliez une équipe pour voir ses membres. Un contributeur qui n'a rien saisi apparaît quand même, avec des cellules vides. Les personnes sans équipe sont regroupées sous **Sans équipe**. Le temps saisi sans personne y apparaît sous **Utilisateur inconnu**.

Le rapport n'affiche que des jours. Il n'affiche jamais les notes d'une saisie.

### Filtres

- **Équipe** : les personnes des équipes sélectionnées.
- **Projet** : uniquement le temps saisi sur les projets sélectionnés, sur leurs tâches ou directement. Les jours autre valent alors zéro.

### Exports

- **CSV** : une ligne par personne et par mois, avec l'équipe, la personne, le mois, les jours projet, les jours autre et le total.
- **PNG** : le graphique.

## Conseils
- **Gardez les profils de contributeurs à jour** : La capacité est basée sur la disponibilité des contributeurs et les statistiques de temps historiques.
- **Utilisez les filtres par équipe** : Limitez le rapport à un département ou une fonction.
- **Vérifiez le travail non assigné** : Aide à repérer les projets avec des allocations manquantes ou des responsables manquants.
- **Bilan de la période pour les stand-ups** : Exportez le bilan de la période en XLSX et partagez-le avec les parties prenantes pour les réunions de statut.
