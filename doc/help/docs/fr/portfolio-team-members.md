# Contributeurs

Les contributeurs vous permettent de définir les compétences, les affectations d'équipe, la disponibilité projet et les valeurs de classification par défaut pour les personnes qui travaillent sur les projets du portefeuille. Ces informations aident à la planification des ressources et garantissent que vous disposez de l'expertise adéquate pour le travail à venir.

## Premiers pas

Rendez-vous dans **Portefeuille > Contributeurs** pour voir les contributeurs configurés, regroupés par équipe. Cliquez sur **Ajouter un contributeur** pour ajouter quelqu'un depuis votre liste d'utilisateurs.

**Pour ajouter un contributeur** :
1. Cliquez sur **Ajouter un contributeur**
2. Recherchez et sélectionnez un utilisateur depuis le menu déroulant
3. Cliquez sur **Ajouter** pour créer son profil
4. Configurez son équipe, sa disponibilité, ses compétences et ses valeurs par défaut dans l'espace de travail

**Conseil** : Les contributeurs sont distincts des comptes utilisateurs. Ajouter quelqu'un comme contributeur ne modifie pas ses droits d'accès : cela permet simplement de suivre son appartenance à une équipe, ses compétences, sa disponibilité et ses valeurs de classification par défaut pour la planification de projet.

---

## Où trouver cette page

- Espace de travail : **Portefeuille**
- Chemin : **Portefeuille > Contributeurs**
- Chemin en libre-service : **Paramètres > Profil > Paramètres contributeur** (ouvre votre propre profil contributeur)
- Autorisations :
  - Consultation : `portfolio_settings:reader`
  - Ajouter ou modifier des contributeurs : `portfolio_settings:member`
  - Supprimer des contributeurs : `portfolio_settings:admin`
  - Modifier votre propre profil : toute autorisation de niveau reader du portefeuille (ex. : `tasks:reader`, `portfolio_projects:reader`, `portfolio_settings:reader`)

Si vous ne voyez pas Contributeurs dans le menu, demandez à votre administrateur de vous accorder les autorisations appropriées.

---

## Travailler avec la liste

Les contributeurs sont affichés sous forme de cartes regroupées par équipe.

**Chaque carte de contributeur affiche** :
- **Nom** (ou e-mail si aucun nom d'affichage n'est défini)
- **Nombre de compétences** : Nombre de compétences configurées (ex. : « 3 compétences »)
- **Disponibilité** : Jours par mois disponibles pour les projets (ex. : « 5j/mois »)
- **Charge projet moyenne** : Temps projet mensuel moyen calculé à partir des entrées saisies sur les 6 derniers mois, lorsque des données sont disponibles

**Filtrage** :
- Utilisez le menu déroulant **Filtrer par équipe** pour n'afficher que les contributeurs d'une équipe spécifique
- Sélectionnez **Non assigné** pour voir les contributeurs qui n'ont pas encore été assignés à une équipe
- Sélectionnez **Toutes les équipes** pour voir tout le monde
- Utilisez le menu déroulant **Filtrer par type de contrat** à côté pour n'afficher que les internes, que les externes, etc. Les deux filtres se combinent et s'appliquent aussi bien à la liste qu'à la matrice de compétences. L'organigramme dispose de ses propres réglages, car une ligne hiérarchique traverse les équipes.

**Groupes d'équipes** :
- Chaque équipe est affichée comme une carte repliable avec un badge de nombre de membres
- Cliquez sur l'en-tête de l'équipe pour développer ou réduire ses membres
- Les équipes sont triées par ordre alphabétique ; **Non assigné** apparaît toujours en dernier

Cliquez sur n'importe quelle carte de contributeur pour ouvrir son espace de travail.

**Changer de vue** :
Au-dessus du filtre par équipe, **Liste**, **Matrice de compétences** et **Organigramme** basculent entre trois lectures des mêmes personnes. Le filtre par équipe s'applique aux deux premières. L'adresse devient `?view=matrix` ou `?view=org`, ce qui permet de mettre un lien en favori ou de le partager, et la dernière vue utilisée est mémorisée dans votre navigateur.

---

## La matrice de compétences

La matrice de compétences répond à deux questions sur un seul écran : ce que chacun sait faire, et quelles compétences ne sont couvertes par personne. C'est une vue en lecture seule : les niveaux se saisissent dans l'onglet Compétences de chaque contributeur.

**Lire la grille** :
- Les **lignes** sont les compétences de votre catalogue, groupées par catégorie. Les compétences désactivées dans les paramètres du portefeuille n'apparaissent jamais, et celles que personne n'a déclarées sont masquées au départ
- Les **colonnes** sont les contributeurs, groupés par équipe. Leurs noms se lisent de bas en haut ; cliquez sur l'un d'eux pour ouvrir son onglet Compétences
- Les **cellules** portent le niveau, de 1 à 4. Les niveaux 3 et 4 (autonome et expert) s'affichent en couleur de texte pleine, les niveaux 1 et 2 restent estompés, et une cellule vide signifie que la compétence n'a jamais été déclarée pour cette personne. Survolez une cellule pour lire le nom du niveau
- La colonne **Autonome ou expert** à droite compte, pour chaque compétence, combien de personnes affichées sont au niveau 3 ou 4. **Le compte passe en orange lorsqu'il vaut zéro** : personne ne couvre actuellement cette compétence seul
- La ligne **Compétences** en bas résume chaque personne sous la forme « autonome / déclarées », par exemple `2/5`

**Retourner la grille** :
Les catalogues sont en général plus longs que les équipes, c'est pourquoi les contributeurs occupent les colonnes par défaut et les noms de compétences restent lisibles le long des lignes. Utilisez le contrôle **Colonnes** au-dessus de la grille pour y placer les compétences à la place, ce qui convient à un catalogue court ou à une grande équipe. Tout suit : les deux résumés changent de côté, et un contributeur s'ouvre alors depuis sa ligne plutôt que depuis son en-tête de colonne. Le choix est mémorisé dans votre navigateur.

**Réduire la grille** :
- La grille démarre sur les compétences que les personnes possèdent réellement. **Afficher les compétences non utilisées** ramène le reste du catalogue, utile quand vous préparez un plan de formation plutôt que vous ne lisez l'existant
- Chaque catégorie de compétences dispose d'une pastille au-dessus de la grille. Désactivez une catégorie pour la retirer
- Le filtre par équipe restreint les personnes, et les comptes de couverture suivent : filtrez sur une équipe et vous lisez la couverture de cette équipe
- Les pastilles de catégorie comme l'interrupteur des compétences non utilisées sont mémorisés dans votre navigateur

**Agir sur ce que vous voyez** :
- Cliquez sur un contributeur pour ouvrir son onglet **Compétences**, où les niveaux se modifient
- **Exporter**, à côté d'**Ajouter un contributeur** en haut de la page, télécharge ce qui est affiché dans un fichier `.xlsx`, disposé dans le même sens, les niveaux en chiffres. Utile pour les revues de compétences et les plans de formation

---

## L'organigramme

L'organigramme dessine la ligne hiérarchique de vos contributeurs, à partir du **Responsable** défini sur chaque profil. Toutes les personnes dont le responsable n'est pas contributeur se placent en haut, côte à côte, ce qui permet de lire plusieurs branches indépendantes en même temps.

**Lire une carte** :
- Initiales, nom, intitulé de poste, type de contrat et nombre de compétences du profil
- Cliquez sur une carte pour ouvrir ce contributeur
- Une carte qui a des personnes en dessous porte un petit chevron sur son bord inférieur. Cliquez dessus pour replier la branche, cliquez à nouveau pour la déplier
- Survolez une carte qui a été remontée dans l'organigramme pour savoir quel responsable a été sauté, par exemple « Rattaché via Claire Meunier »

**Qui apparaît** :
- Seuls les contributeurs sont dessinés. Si le responsable d'une personne n'est pas contributeur, cette personne se retrouve en haut de l'organigramme plutôt que de disparaître
- Les comptes désactivés sont exclus. **Inclure les comptes désactivés** les fait revenir, ce qui est utile pendant la passation d'un départ
- Chaque type de contrat dispose d'une pastille au-dessus de l'organigramme. Désactivez-en une et ces personnes quittent l'organigramme, **mais leurs propres subordonnés restent** : ils remontent au responsable visible le plus proche. Masquer les externes conserve donc vos équipes internes dans un arbre lisible au lieu de couper des branches entières

**Cadrer l'organigramme** :
- **Commencer par** réduit l'organigramme à une personne et à tout ce qui se trouve en dessous d'elle : c'est ainsi que l'on produit l'organigramme d'un seul service
- **Niveaux** limite la profondeur affichée, par exemple les deux premiers niveaux pour une vue de direction
- Les commandes de zoom à droite mettent le dessin à l'échelle ; l'organigramme défile dans les deux directions à l'intérieur de son cadre
- Chacun de ces choix est inscrit dans l'adresse : l'organigramme d'une branche peut donc être envoyé par lien, cadré exactement comme vous l'avez laissé

**Exporter et imprimer** :
- **Exporter en PNG**, à côté d'**Ajouter un contributeur** en haut de la page, enregistre l'organigramme entier sous forme d'image, toujours sur fond blanc quel que soit le thème dans lequel vous le consultez. La date d'export est inscrite en bas à gauche. Les branches repliées restent repliées, et une carte repliée porte le nombre de personnes masquées en dessous. Le zoom à l'écran ne change pas l'image
- La commande d'impression de votre navigateur imprime l'organigramme seul, en paysage et sans l'interface autour

---

## L'espace de travail du contributeur

Cliquez sur une ligne de contributeur pour ouvrir son espace de travail. L'en-tête affiche la référence du contributeur (`CTR-1`, `CTR-2`…, cliquez dessus pour la copier), son nom, son équipe, sa disponibilité et le nombre de compétences. C'est aussi cette référence qu'utilise l'adresse de la page. Utilisez les flèches à côté du lien de retour (ou les touches fléchées gauche et droite) pour passer au contributeur précédent ou suivant dans l'ordre de la liste. Appuyez sur **Échap** pour revenir à la liste.

L'espace de travail comporte trois onglets, **Général**, **Compétences** et **Temps saisi**, ainsi qu'un panneau **Propriétés** à droite qui regroupe l'intitulé de poste, l'équipe, la disponibilité et les valeurs de classification par défaut. Ouvrez ou fermez le panneau avec l'onglet situé sur son bord, ou appuyez sur **P**.

Chaque modification est enregistrée automatiquement. Une courte mention « Enregistrement… / Enregistré » apparaît à côté des métadonnées de l'en-tête pendant l'écriture d'une modification.

### Panneau Propriétés

**Intitulé de poste**
L'intitulé de poste de la personne, le même que celui qui apparaît partout où elle figure dans KANAP (l'organigramme, sa fiche utilisateur, son profil). Ce n'est pas une étiquette propre au portefeuille : le modifier ici le modifie partout. Saisissez-le puis cliquez ailleurs pour enregistrer.

Vous pouvez toujours définir le vôtre. Définir celui d'une autre personne demande le niveau **Administrateur** sur les utilisateurs ; sans ce droit, vous voyez toujours la valeur, mais le champ est en lecture seule.

Lorsque le compte vient de Microsoft Entra, le champ est en lecture seule et affiche **Depuis Microsoft Entra** en dessous. Modifiez-le dans votre annuaire, pas ici : la synchronisation nocturne comme la prochaine connexion ramènent la valeur de l'annuaire, et tout ce qui serait saisi ici serait écrasé.

**Équipe**
Assignez ce contributeur à une équipe. Les équipes sont des groupes organisationnels configurés dans les Paramètres du portefeuille. Cette affectation détermine comment les contributeurs sont regroupés sur la page Contributeurs. L'équipe peut aussi être changée depuis l'élément **Équipe** de l'en-tête. Ce champ n'est visible que lors de la modification du profil d'un autre contributeur (pas le vôtre).

**Responsable**
La personne dont dépend ce contributeur. Cliquez sur le champ, cherchez par nom et choisissez n'importe qui dans votre organisation : le responsable n'a pas besoin d'être lui-même contributeur. Utilisez **Effacer** pour retirer le lien. Un contributeur ne peut pas être son propre responsable, et vous ne pouvez pas désigner une personne qui dépend déjà de lui, directement ou via une chaîne de responsables.

Lorsque le responsable vient de Microsoft Entra, le champ est en lecture seule et affiche **Depuis Microsoft Entra** en dessous. Modifiez-le dans votre annuaire, pas ici : la synchronisation nocturne reporte le changement. Un responsable qui n'a pas encore de compte KANAP est ignoré jusqu'à ce qu'il en ait un, et le champ conserve sa valeur actuelle en attendant.

Une fois défini, le nom du responsable apparaît aussi dans l'en-tête de l'espace de travail, et un clic ouvre sa fiche contributeur lorsqu'il en a une. Ce champ n'est visible que lors de la modification du profil d'un autre contributeur (pas le vôtre).

**Type de contrat**
La façon dont cette personne travaille avec vous. Chaque contributeur démarre en **Interne** ; passez en **Externe**, **Apprenti** ou **Autre** lorsque ce n'est pas le cas. La liste vous appartient et s'adapte dans **Portefeuille > Paramètres > Types de contrat**. Le type de contrat n'est jamais importé depuis Microsoft Entra. Ce champ n'est visible que lors de la modification du profil d'un autre contributeur (pas le vôtre).

**Disponibilité projet**
Utilisez le curseur pour définir combien de jours par mois cette personne peut travailler sur des projets du portefeuille. La plage va de 0 à 20 jours, par incréments de 0,5 jour. La valeur par défaut est de 5 jours. La valeur est enregistrée lorsque vous relâchez le curseur.

**Valeurs de classification par défaut**
Définissez les valeurs de classification qui pré-remplissent les nouvelles tâches, demandes et projets lorsque les champs de classification sont encore vides. Cela fait gagner du temps aux contributeurs qui travaillent régulièrement dans le même domaine.

- **Source** : La classification source par défaut
- **Catégorie** : La classification de catégorie par défaut
- **Flux** : La classification de flux par défaut (disponible uniquement une fois une **Catégorie** sélectionnée ; filtré aux flux appartenant à cette catégorie)
- **Société** : La société par défaut

Lorsqu'un contributeur crée une nouvelle tâche, demande ou projet, ces valeurs par défaut sont utilisées pour pré-remplir automatiquement les champs de classification. Changer la **Catégorie** efface le **Flux** si le flux actuel n'appartient pas à la catégorie nouvellement sélectionnée.

**Conseil** : Vous pouvez également accéder à vos propres valeurs par défaut depuis **Paramètres > Profil**, qui ouvre votre profil contributeur avec le panneau Propriétés visible.

### Général

Consultez les statistiques de temps et ajoutez des notes.

**Statistiques de temps**
Résumé en lecture seule du temps saisi pour ce contributeur. Nécessite `portfolio_settings:reader` pour être visible.

- **Charge projet mensuelle moyenne (6 derniers mois)** : Affichée en jours-homme (heures / 8)
- **Charge mensuelle (12 mois)** : Graphique en courbe montrant le temps **Total**, **Projet** et **Autre**
  - **Projet** = temps d'overhead projet + temps saisi sur les tâches projet
  - **Autre** = temps saisi sur les tâches hors projet
  - Les mois sans données apparaissent comme des espaces dans le graphique

**Notes**
Champ de texte libre pour toute information complémentaire sur ce contributeur : certifications, préférences, contraintes ou autres détails pertinents. Les notes sont enregistrées peu après que vous avez cessé de taper.

---

### Compétences

Suivez ce que ce contributeur connaît et son niveau de maîtrise.

**Ajouter des compétences** :
1. Cliquez sur **Ajouter une compétence** dans l'en-tête de l'espace de travail (disponible depuis tous les onglets)
2. Recherchez la compétence ; la liste est regroupée par catégorie
3. Choisissez son niveau dans la même fenêtre (par défaut : 2, « Peut exécuter avec accompagnement »)
4. Cliquez sur **Ajouter** : la compétence arrive dans sa section avec ce niveau déjà défini, plus besoin de la retrouver dans une longue liste pour l'ajuster

**Niveaux de maîtrise** :
Chaque compétence a un niveau de maîtrise de 1 à 4 :

| Niveau | Libellé | Description |
|--------|---------|-------------|
| 1 | Base / Théorique | Comprend les concepts mais ne les a pas appliqués |
| 2 | Peut exécuter avec support | Peut faire le travail avec un accompagnement |
| 3 | Autonome | Peut travailler de manière indépendante |
| 4 | Expert | Expertise approfondie, peut former les autres |

Chaque compétence affiche quatre repères de niveau suivis du nom du niveau actuel. Cliquez sur un repère pour définir le niveau, ou placez le focus sur les repères et utilisez les touches fléchées. Survolez un repère pour voir ce que signifie ce niveau.

**Supprimer des compétences** :
Survolez une compétence et cliquez sur le **×** qui apparaît en fin de ligne pour la retirer du profil du contributeur.

**Catégories de compétences** :
Les compétences sont regroupées sous l'en-tête de leur catégorie, avec le nombre de compétences à côté. Utilisez **Regrouper par** au-dessus de la liste pour passer à un regroupement par niveau, de l'expert vers le débutant : on voit d'un coup d'œil ce que la personne maîtrise. Le choix est mémorisé. Sur un écran large, la liste s'affiche sur deux colonnes.

---

### Temps saisi

Consultez et gérez toutes les entrées de temps pour ce contributeur en un seul endroit. Cet onglet n'est visible que si vous avez `portfolio_settings:reader` ou supérieur.

Le tableau consolide le temps saisi provenant à la fois des entrées d'overhead projet et des entrées de temps des tâches, vous donnant une image complète de la manière dont le contributeur utilise son temps.

**Colonnes** :
- **Date** : Quand le temps a été saisi
- **Source** : Où le temps a été saisi, soit un nom de tâche soit un nom de projet
- **Catégorie** : Si l'entrée est classée **IT** ou **Métier**, affichée sous forme de libellé coloré
- **Temps** : Durée en heures ou jours (ex. : « 4h », « 1j 2h »)
- **Notes** : Notes éventuelles attachées à l'entrée

**Modifier des entrées** :
Cliquez sur l'**icône de modification** à côté d'une entrée de temps pour ouvrir la boîte de dialogue de modification. La boîte de dialogue dépend du type d'entrée :
- Les **entrées de tâche** ouvrent la boîte de dialogue de saisie de temps de la tâche, où vous pouvez ajuster les heures, la date, la catégorie et les notes
- Les **entrées de projet** ouvrent la boîte de dialogue de saisie de temps du projet, où vous pouvez ajuster les heures, la catégorie, l'utilisateur et les notes

**Supprimer des entrées** :
Cliquez sur l'**icône de suppression** à côté d'une entrée de temps pour la retirer. Une confirmation vous est demandée avant la suppression. La suppression d'une entrée met également à jour les statistiques de temps du contributeur dans l'onglet **Général**.

**Autorisations pour les actions sur les entrées de temps** :
- Pour voir la colonne **Actions**, vous avez besoin au minimum de `tasks:member` ou `portfolio_projects:contributor`
- Les utilisateurs non-administrateurs ne peuvent modifier ou supprimer que les entrées qu'ils ont créées ou auxquelles ils sont assignés
- Les utilisateurs avec `tasks:admin` peuvent modifier ou supprimer toute entrée de tâche autonome
- Les utilisateurs avec `portfolio_projects:admin` peuvent modifier ou supprimer toute entrée de tâche projet ou d'overhead projet

---

## Actions

Depuis l'en-tête de l'espace de travail :
- **Supprimer** : Retirer cette configuration de contributeur (n'affecte pas le compte utilisateur). Disponible uniquement lors de la modification du profil d'un autre contributeur avec `portfolio_settings:admin`.
- **Lien retour** : Retourner à la liste des contributeurs, ou aux **Paramètres** si vous avez ouvert votre propre profil

Il n'y a pas de bouton Enregistrer : chaque modification est enregistrée automatiquement.

---

## Votre propre profil contributeur

Tout utilisateur disposant d'au moins une autorisation reader au niveau portefeuille peut accéder à son propre profil contributeur dans **Portefeuille > Contributeurs > moi** ou depuis **Paramètres > Profil > Paramètres contributeur**.

Lors de la modification de votre propre profil :
- Vous pouvez mettre à jour votre **disponibilité**, vos **compétences**, vos **notes** et vos **valeurs de classification par défaut**
- Vous ne pouvez pas changer votre propre **affectation d'équipe** (seul un membre des paramètres du portefeuille peut le faire)
- Vous ne pouvez pas supprimer votre propre profil contributeur

Si vous n'avez pas encore de profil contributeur, ouvrir la page en libre-service en crée un automatiquement.

---

## Équipes

Les contributeurs peuvent être assignés à des équipes organisationnelles pour une meilleure organisation. Les équipes sont configurées dans **Portefeuille > Paramètres > Équipes**.

**Équipes par défaut** (personnalisables) :
- Infrastructure
- Applications métier
- Applications d'ingénierie
- Service Desk
- Master Data
- Cybersécurité

**Gérer les équipes** :
- Rendez-vous dans **Portefeuille > Paramètres** et cliquez sur l'onglet **Équipes**
- Ajoutez, modifiez ou désactivez des équipes
- Utilisez **Initialiser les valeurs par défaut** pour remplir avec les équipes standard
- Une équipe qui a des membres ou des sous-équipes ne peut pas être supprimée : déplacez-les d'abord vers une autre équipe, ou désactivez l'équipe. Les équipes intégrées ne peuvent pas être supprimées

---

## Types de contrat

Les types de contrat indiquent comment chaque personne travaille avec vous : salarié, intervenant d'un prestataire, apprenti, et tout ce dont votre organisation a besoin. Ils se configurent dans **Portefeuille > Paramètres > Types de contrat**. Chaque contributeur démarre en Interne.

**Types par défaut** (renommables) :
- Interne
- Externe
- Apprenti
- Autre

**Gérer les types de contrat** :
- Allez dans **Portefeuille > Paramètres** et ouvrez l'onglet **Types de contrat**
- Ajoutez vos propres types, renommez-les, ou désactivez-en un pour l'écarter des nouvelles affectations sans perdre les contributeurs qui le portent déjà
- Les quatre types intégrés peuvent être renommés mais pas supprimés
- Un type affecté à au moins un contributeur ne peut pas être supprimé ; l'onglet indique combien de contributeurs utilisent chacun

---

## Conseils

- **Assignez les contributeurs à des équipes** : Cela aide à organiser la page Contributeurs et facilite la recherche de personnes spécifiques.
- **Définissez une disponibilité réaliste** : Tenez compte des réunions, du travail courant et des congés lors de la définition des jours par mois. La plupart des gens ont moins de temps projet que prévu.
- **Utilisez la maîtrise honnêtement** : Une équipe pleine d'« experts » n'est pas utile pour la planification. Soyez réaliste sur les niveaux de compétences pour prendre de meilleures décisions de ressources.
- **Maintenez les compétences à jour** : Revoyez les compétences des contributeurs périodiquement, surtout après des formations ou de nouvelles expériences projet.
- **Configurez vos valeurs de classification par défaut tôt** : Si vous travaillez toujours sur la même catégorie et le même flux, configurer les valeurs par défaut vous évite de les sélectionner à chaque création de tâche ou de demande.
