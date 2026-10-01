# Calendriers de jours ouvrés

Un calendrier de jours ouvrés indique le nombre de jours ouvrés de chaque mois, année par année. Les lignes budgétaires au prix par jour l'utilisent : une personne à temps plein travaille chaque jour ouvré du mois, et les jours et les jours par mois se convertissent en ETP sur cette base. Par exemple, un consultant à temps plein à 400 par jour sur un calendrier qui compte 20 jours ouvrés en mars coûte 8 000 en mars.

Un calendrier est de l'un de deux types :

- **Standard** : créé à partir d'un pays, et d'une région lorsque le pays en a. Les jours ouvrés de chaque année sont les jours de semaine de chaque mois, moins les jours fériés du pays. Il n'y a rien à saisir, et vous pouvez tout de même modifier n'importe quel mois de n'importe quelle année
- **Personnalisé** : vous saisissez vous-même les jours ouvrés de chaque année, par exemple pour un accord sur le temps de travail qui a ses propres jours de repos

Dans l'onglet Budget d'un poste OPEX ou CAPEX, chaque ligne au prix par jour utilise un calendrier. Les lignes au prix par mois ou par pièce n'en ont pas besoin. Voir [Quantité et prix](opex.md#quantite-et-prix).

---

## Premiers pas

Naviguez vers **Données de référence > Calendriers de jours ouvrés** (dans la section **Finance**) pour ouvrir la liste.

Le plus rapide est de commencer par un calendrier standard pour chaque pays où se trouvent vos sociétés :

- **Lorsque vous créez une société** avec un pays, KANAP crée pour vous le calendrier standard de ce pays, sauf si l'espace de travail en a déjà un pour tout le pays
- **Pour les sociétés que vous avez déjà**, la page de liste affiche une ligne au-dessus de la grille, par exemple « Pays de vos sociétés : France, Pays-Bas et Italie. Créez leurs calendriers standard. » Cliquez sur **Créer 3 calendriers** pour les créer en une fois

Pour créer vous-même un calendrier, cliquez sur **Nouveau**.

**Champs obligatoires** :

- **Code** : un code court que votre équipe reconnaît. Les fichiers d'import l'utilisent pour trouver le calendrier
- **Nom** : le nom que l'on choisit dans l'onglet Budget, par exemple « Personnel du siège »

**Facultatifs mais utiles** :

- **Pays** et **Région** : font du calendrier un calendrier standard. Sans pays, le calendrier est personnalisé
- **Description** : à qui s'applique le calendrier, par exemple « Jours ouvrés des salariés, jours fériés exclus »

**Astuce** : si votre équipe finance tient déjà les jours ouvrés dans un tableur, importez-les depuis un fichier CSV. Une ligne correspond à un calendrier et une année.

---

## Utiliser la liste

Tant que l'espace de travail n'a aucun calendrier, une ligne sous le titre l'indique : « Un calendrier indique les jours ouvrés de chaque mois, pour les lignes au prix par jour. Créez-en un ou importez un fichier. »

**Colonnes** :

- **Code** : le code du calendrier
- **Nom** : le nom du calendrier
- **Pays** : le pays d'un calendrier standard, avec la région entre parenthèses, par exemple « France (Département Moselle) ». Vide pour un calendrier personnalisé
- **Années** : « Toutes les années » pour un calendrier standard, suivi des années que vous avez modifiées, par exemple « Toutes les années, 2026 modifiée(s) ». Pour un calendrier personnalisé, les années qu'il contient, par exemple « 2026, 2027 »
- **Statut** : **Activé** ou **Désactivé** (masquée par défaut, ajoutez-la via le sélecteur de colonnes)
- **Mis à jour** : la date et l'heure de la dernière modification

Cliquez sur n'importe quelle cellule pour ouvrir l'espace de travail.

**Tri** : la liste s'ouvre triée par nom. Cliquez sur un en-tête de colonne pour trier sur cette colonne.

**Filtres** :

- **Recherche rapide** : recherche dans le code, le nom, la description, ainsi que le pays et la région d'un calendrier standard
- **Statut** : le filtre de colonne propose **Activé** et **Désactivé**. Cliquer sur **Effacer** dans ce filtre, ou décocher les deux valeurs, n'affiche plus rien, quel que soit le choix de **Afficher**
- **Filtre de statut** : le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la liste. Par défaut, la liste affiche les calendriers activés

**Calendriers suggérés** : pour les personnes qui peuvent créer des calendriers, une ligne au-dessus de la grille liste les pays de vos sociétés activées qui n'ont pas encore de calendrier standard, avec un bouton qui les crée. Chaque calendrier prend le code du pays comme code et le nom du pays, dans votre langue, comme nom. La ligne disparaît dès que chaque pays a son calendrier.

**Actions** :

- **Nouveau** : créer un calendrier (nécessite `working_day_profiles:member`)
- **Importer CSV** : charger des calendriers et leurs jours ouvrés depuis un fichier (nécessite `working_day_profiles:admin`)
- **Exporter CSV** : télécharger tous les calendriers (nécessite `working_day_profiles:admin`)
- **Supprimer la sélection** : supprimer les calendriers sélectionnés (nécessite `working_day_profiles:admin`). Les calendriers qui ne peuvent pas être supprimés sont conservés et listés avec la raison

---

## Créer un calendrier

Cliquez sur **Nouveau**, puis :

1. **Pays** (facultatif) : tapez pour rechercher, par nom ou par code à deux lettres. Avec un pays, le calendrier est standard
2. **Région** : affichée lorsque le pays a des régions, par exemple les Länder allemands ou les départements français qui ont leurs propres jours fériés. Gardez **Tout le pays**, ou choisissez une région
3. **Code** et **Nom** : le choix d'un pays les remplit, par exemple `FR-57` et « France (Département Moselle) ». Modifiez-les si vous le souhaitez
4. **Description** : facultative
5. Cliquez sur **Créer**

Un nouveau calendrier est activé, et son espace de travail s'ouvre. Un calendrier standard contient déjà les jours ouvrés de chaque année. Pour un calendrier personnalisé, saisissez-les année par année.

Le pays et la région se définissent une seule fois, à la création. Pour suivre un autre pays, créez un autre calendrier.

---

## L'espace de travail du calendrier

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail.

- **En-tête** : le code comme référence, avec un bouton de copie, et le nom. Cliquez sur le nom pour le renommer. **Précédent** / **Suivant** parcourent la liste dans son ordre et ses filtres actuels, et le bouton de fermeture ramène à la liste
- **Zone principale** : une ligne comme « Utilisé par 3 lignes OPEX et 1 ligne CAPEX. » lorsque des lignes budgétaires utilisent le calendrier, la **Description**, puis la section **Jours ouvrés**
- **Panneau Propriétés** à droite : **Code**, **Source** (calendriers standard uniquement, par exemple « France (Département Moselle) », en lecture seule) et **Cycle de vie**

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même. Il n'y a pas de bouton Enregistrer. Les champs texte et les mois s'enregistrent quand vous les quittez (appuyez sur Entrée dans **Code** ou dans un mois pour enregistrer aussitôt) ; le cycle de vie s'enregistre dès que vous le modifiez. Lorsqu'une modification est refusée, la raison s'affiche sous le champ concerné, par exemple un code en double sous **Code**.

### Champs

| Champ | Ce qu'il faut saisir | Où trouver cette valeur |
|---|---|---|
| **Code** | Jusqu'à 50 caractères. Les codes sont uniques sans tenir compte de la casse : `CAL-01` et `cal-01` sont le même code | Le code utilisé par votre équipe finance pour cet ensemble de jours ouvrés, par exemple dans son classeur budgétaire. Pour un calendrier standard, le code du pays est un bon choix |
| **Nom** | Jusqu'à 200 caractères. Les noms sont uniques sans tenir compte de la casse | Le nom sous lequel votre équipe connaît le calendrier. C'est le nom affiché dans l'onglet Budget |
| **Description** | Texte libre | À qui s'applique le calendrier et ce qu'il exclut |
| **Pays** / **Région** | À la création uniquement. La liste des régions suit le pays | Le pays, et la région lorsque ses jours fériés diffèrent, où travaillent les personnes ou les services couverts par le calendrier |
| **Cycle de vie** | L'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité** | Fixez une date future pour programmer la fin, ou désactivez l'interrupteur pour le désactiver dès aujourd'hui |

### Jours ouvrés d'un calendrier standard

La section **Jours ouvrés** affiche une année à la fois, avec les mêmes onglets d'année que l'onglet Budget : cinq années autour de l'année en cours, et des flèches pour avancer ou reculer d'une année, de 2000 à 2100. Toutes les années sont là : il n'y a rien à ajouter.

- **Douze mois** : chaque mois affiche ses jours ouvrés, c'est-à-dire les jours de semaine (du lundi au vendredi) qui ne sont pas fériés
- **Total annuel** : la ligne sous les mois, par exemple « 252 jours en 2026 »
- **Jours fériés** : une ligne liste les jours fériés de l'année avec leurs dates, par exemple « Jours fériés : 1 janv. Jour de l'an, 6 avr. Lundi de Pâques, … ». Un jour férié qui tombe un samedi ou un dimanche est suivi de « (week-end) » : il ne retire aucun jour ouvré, ce qui explique le décompte

**Modifier un mois** : saisissez la valeur voulue, par exemple pour retirer un jour de fermeture de l'entreprise. L'année devient une année modifiée : ses douze mois sont conservés tels qu'ils sont, et les autres années continuent de suivre les jours fériés.

- Sous le total d'une année modifiée, une ligne donne les valeurs standard, par exemple « Valeurs standard : 252 jours »
- **Revenir aux valeurs standard** ramène aussitôt l'année aux jours fériés. Il n'y a pas de confirmation : les valeurs que vous avez saisies sont remplacées par les valeurs standard

**D'où viennent les valeurs standard** : les règles des jours fériés proviennent de [`date-holidays`](https://github.com/commenthol/date-holidays), une bibliothèque open source intégrée à KANAP. Les règles sont livrées avec l'application, si bien que les calendriers standard fonctionnent sans aucun accès à Internet. Les données des jours fériés sont publiées sous la licence Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0), et KANAP les utilise sans modification. Seuls les jours fériés officiels comptent : les jours de fermeture bancaire, les vacances scolaires et les fêtes non chômées n'entrent pas en compte. Un jour férié qui commence le soir (à 18 h ou plus tard), comme la veille de Noël dans le Territoire du Nord en Australie, ne retire pas la journée ; un jour férié qui commence plus tôt dans la journée retire la journée entière.

### Jours ouvrés d'un calendrier personnalisé

La section **Jours ouvrés** affiche une année à la fois.

- **Onglets d'année** : chaque année que contient le calendrier, les années autour de l'année en cours, et une année vide avant et après celles enregistrées, pour que l'année suivante puisse toujours être ajoutée
- **Douze mois** : un champ par mois. Saisissez les jours ouvrés de ce mois
- **Total annuel** : la ligne sous les mois, par exemple « 218 jours en 2026 ». Elle additionne les mois pendant la saisie, avec 2 décimales au plus, par exemple « 229 jours en 2026 » pour douze mois de 19.083333
- **Copier depuis 2025** : affiché lorsque l'année est vide et que l'année précédente a des jours ouvrés. Il remplit les douze mois avec les valeurs de l'année précédente et les enregistre. Ajustez ensuite les mois qui diffèrent
- **Retirer 2026** : affiché sur une année que contient le calendrier. Lorsqu'aucune ligne budgétaire n'utilise le calendrier, il retire cette année immédiatement. Lorsque des lignes l'utilisent, une boîte de dialogue demande d'abord : « Retirer les jours ouvrés de 2026 ? » Elle donne le nombre de lignes et explique l'effet. Les lignes gardent leurs montants, mais les lignes au prix par jour sur ce calendrier ne peuvent pas être enregistrées pour cette année tant que les jours ne sont pas saisis à nouveau. Cliquez sur **Retirer quand même** pour confirmer

**Une nouvelle année** est enregistrée une fois les douze mois renseignés. Jusque-là, une indication affiche « Renseignez les douze mois pour enregistrer 2027. » Ensuite, chaque modification s'enregistre dès que vous quittez le mois.

### Règles pour les mois

Ces règles s'appliquent aux deux types de calendrier :

- **Au plus le nombre de jours calendaires du mois** : 31 pour mars, 30 pour avril, 28 pour février, 29 pour février d'une année bissextile. Une valeur supérieure est refusée : « Mars 2027 compte 31 jours : saisissez 31 ou moins. »
- **Zéro ou plus** : une valeur négative est refusée.
- **Jusqu'à 6 décimales** : les jours ouvrés peuvent être fractionnaires, par exemple `19.083333` pour un total annuel réparti sur douze mois. Au-delà, la valeur est refusée : « Utilisez 6 décimales au plus. »
- **Les douze mois** : une année contient douze valeurs. Laisser vide un mois d'une année enregistrée est refusé : « Saisissez les jours ouvrés des douze mois de 2027. » Saisissez `0` pour un mois sans jour ouvré.

### Quand les jours ouvrés changent

**Modifier les jours ouvrés ne change jamais une ligne budgétaire d'elle-même.** Les montants déjà enregistrés sur une ligne budgétaire restent tels quels. Lorsque vous ouvrez l'onglet Budget de la ligne, l'onglet **Quantité et prix** le signale, par exemple « Jours ouvrés modifiés depuis le dernier calcul : mars : 20 jours, maintenant 19. » Cliquez alors sur **Utiliser à nouveau les lignes** pour appliquer les nouveaux jours.

---

## Calendriers désactivés

Désactivez un calendrier lorsqu'il ne doit plus être utilisé, par exemple après un changement d'accord sur le temps de travail.

- Un calendrier désactivé reste sur les lignes budgétaires qui l'utilisent déjà. Leurs montants ne changent pas.
- Il ne peut pas être choisi pour une autre ligne. L'onglet Budget ne propose que les calendriers activés, plus le calendrier qu'une ligne utilise déjà, marqué « (désactivé) ».
- Les lignes qui l'utilisent déjà peuvent toujours être enregistrées. Le panneau avertit alors, par exemple : « Personnel du siège est désactivé. Les lignes l'utilisent encore. »

---

## Supprimer

Le bouton **Supprimer** de l'en-tête supprime le calendrier immédiatement (nécessite `working_day_profiles:admin`). Il est désactivé, avec la raison sur une ligne, tant que des lignes budgétaires utilisent le calendrier, par exemple « Utilisé par 3 lignes OPEX et 1 ligne CAPEX. Désactivez-le plutôt. »

La même règle s'applique à **Supprimer la sélection** dans la liste : un calendrier utilisé par des lignes budgétaires est conservé, avec une raison comme « Personnel du siège is used by 3 OPEX lines and 1 CAPEX line. Disable it instead. »

Une ligne budgétaire utilise un calendrier lorsque l'une de ses colonnes, pour n'importe quelle année, contient une ligne au prix par jour sur ce calendrier. Supprimer cette ligne dans l'onglet Budget, ou **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire, retire le lien. Voir [Réinitialiser une colonne budgétaire](budget-operations.md#reinitialiser-une-colonne-budgetaire).

---

## Import/export CSV

Chargez ou mettez à jour des calendriers et leurs jours ouvrés depuis un fichier.

**Export** : cliquez sur **Exporter CSV**, puis sur **Exporter les données**. Le fichier liste tous les calendriers, activés ou désactivés, triés par code. Pour un fichier vide avec les seuls en-têtes, utilisez **Télécharger le modèle** dans la boîte de dialogue d'import.

**Structure du CSV** :

- Séparateur : point-virgule `;`
- Encodage : UTF-8 (enregistrez au format « CSV UTF-8 » dans Excel)
- En-têtes : `code;name;description;country;region;status;disabled_at;year;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec`
- Une ligne par calendrier et par année. Un calendrier avec trois années occupe trois lignes. Un calendrier sans aucune année est exporté sur une ligne, avec l'année et les mois vides
- Un calendrier standard n'exporte que les années que vous avez modifiées. Les autres années suivent les jours fériés et n'ont besoin d'aucune ligne
- Les colonnes `country`, `region` et `disabled_at` sont facultatives à l'import. Un fichier sans `country` ni `region` crée des calendriers personnalisés

| Colonne | Contenu |
|---|---|
| `code` | Obligatoire. Le code du calendrier. Les lignes sont rapprochées des calendriers existants par code, sans tenir compte de la casse |
| `name` | Obligatoire |
| `description` | Texte libre |
| `country` | Facultative. Le code pays à deux lettres d'un calendrier standard, par exemple `FR`. Vide pour un calendrier personnalisé |
| `region` | Facultative. Le code de la région, par exemple `57` pour la Moselle ou `BY` pour la Bavière. Nécessite un pays. Vide pour tout le pays |
| `status` | `enabled` ou `disabled`. Vide signifie `enabled` |
| `disabled_at` | Colonne facultative. La fin de validité : une date (`2026-12-31`) ou une date et une heure complètes. Vide s'il n'y a pas de fin |
| `year` | Quatre chiffres, de 2000 à 2100. Vide sur une ligne qui ne définit que les champs du calendrier |
| `jan` à `dec` | Les jours ouvrés de chaque mois, avec un point comme séparateur décimal (la virgule est aussi acceptée). Obligatoires sur une ligne qui a une année |

**Import** :

1. Cliquez sur **Importer CSV** dans la liste
2. Choisissez votre fichier
3. Cliquez sur **Vérification préalable**. Le rapport donne le nombre de lignes, les créations et les mises à jour, et les lignes qui ne changent rien
4. Si la vérification préalable est sans erreur, cliquez sur **Charger**

**Fonctionnement de l'import** :

- **Le fichier entier est vérifié avant toute écriture.** Un fichier comportant une erreur ne charge rien : corrigez les lignes et relancez la vérification préalable.
- **Les lignes d'un même code décrivent un seul calendrier.** Elles doivent concorder sur le nom, la description, le pays, la région, le statut et la fin de validité.
- **Le pays et la région s'appliquent lorsque le fichier crée un calendrier.** Sur un calendrier existant, laissez-les vides ou donnez les valeurs du calendrier. Une valeur différente est refusée.
- **Les années d'un calendrier standard deviennent des années modifiées.** Les autres années continuent de suivre les jours fériés.
- **Les mois suivent les règles de l'espace de travail** : les douze mois, chacun au plus le nombre de jours calendaires du mois, avec 6 décimales au plus.
- **Les années absentes du fichier sont conservées.** Un import ajoute ou remplace des années. Il n'en retire jamais. Pour retirer une année, utilisez son lien **Retirer** dans l'espace de travail, ou **Revenir aux valeurs standard** sur un calendrier standard.
- **Décompte** : un nouveau calendrier ou une nouvelle année compte comme une création. Une année modifiée, ou un changement de nom, de description ou de cycle de vie, compte comme une mise à jour. Une ligne identique à ce qui est enregistré compte comme inchangée. Exporter puis importer le même fichier signale toutes les lignes comme inchangées.
- **Les calendriers absents du fichier** restent tels quels. L'import ne supprime jamais rien.

**Erreurs courantes** :

- **« Rows of CAL-01 disagree on the name. »** (ou la description, le pays, la région, le statut, la fin de validité) : rendez identiques sur ces champs les lignes de ce code.
- **« CAL-01 has 2027 twice (rows 3 and 5). »** : gardez une ligne par calendrier et par année.
- **« Enter the working days of all twelve months of 2027. »** : remplissez chaque mois de la ligne. Saisissez `0` pour un mois sans jour ouvré.
- **« March 2027 has 31 days: enter 31 or less. »** : corrigez le mois.
- **« Use at most 6 decimals. »** : arrondissez la valeur.
- **« Give the year of these working days. »** : la ligne a des mois mais pas d'année.
- **« Country XX is not in the list. »** : utilisez un code pays à deux lettres, par exemple `FR` ou `DE`.
- **« BY is not a region of France. »** : la région n'appartient pas au pays. Corrigez la région, ou laissez-la vide pour tout le pays.
- **« Give the country of region BY. »** : une région a besoin de son pays.
- **« The country of a calendar cannot be changed. Create another calendar. »** : la ligne donne un autre pays ou une autre région que le calendrier enregistré. Laissez les deux cellules vides, ou donnez les valeurs du calendrier.
- **« A calendar named ... already exists. »** : un autre calendrier utilise déjà ce nom. Les noms sont uniques sans tenir compte de la casse.
- **« Header mismatch »** : téléchargez un nouveau modèle.

---

## Permissions

| Niveau | Ce qu'il permet |
|---|---|
| `working_day_profiles:reader` | Consulter la liste et ouvrir les calendriers |
| `working_day_profiles:member` | Créer des calendriers, les modifier ainsi que leurs jours ouvrés |
| `working_day_profiles:admin` | Tout ce qui précède, plus l'import et l'export CSV, et la suppression |

Les administrateurs budgétaires sont administrateurs des calendriers : le rôle intégré Administrateur budget reçoit admin. Chaque autre rôle reçoit au départ le niveau qu'il a sur les départements. Ainsi, Administrateur données de référence est admin, Membre budget et Membre données de référence sont membres, et les rôles lecteurs peuvent consulter.

Toute personne qui peut consulter les OPEX ou les CAPEX peut choisir un calendrier dans l'onglet Budget sans accès à cette page.

---

## Astuces

- **Partez des calendriers standard** : un par pays couvre la plupart des budgets. N'ajoutez une région que lorsque ses jours fériés diffèrent, par exemple la Moselle en France ou la Bavière en Allemagne.
- **Un calendrier par accord sur le temps de travail** : lorsque des personnes ont leurs propres jours de repos, créez un calendrier personnalisé pour leur accord, plutôt qu'un calendrier par personne.
- **Nommez-le d'après les personnes qu'il couvre** : l'onglet Budget affiche le nom, donc « Personnel du siège » en dit plus qu'un code.
- **Préparez tôt l'année suivante sur un calendrier personnalisé** : utilisez **Copier depuis** sur la nouvelle année, puis ajustez les mois qui diffèrent. Une ligne au prix par jour ne peut pas être enregistrée pour une année que son calendrier ne contient pas. Les calendriers standard n'ont besoin de rien : chaque année y est déjà.
- **Désactivez plutôt que supprimer** : lorsqu'un calendrier ne sert plus pour de nouvelles lignes, désactivez-le. Les lignes qui l'utilisent gardent leurs montants et peuvent toujours être enregistrées.
