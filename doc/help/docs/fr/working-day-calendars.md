# Calendriers de jours ouvrés

Un calendrier de jours ouvrés indique le nombre de jours ouvrés de chaque mois, année par année. C'est ce qui multiplie le prix d'une ligne budgétaire au prix par jour. Par exemple, un consultant à 400 par jour sur un calendrier qui compte 20 jours ouvrés en mars coûte 8 000 en mars.

Chaque colonne OPEX et CAPEX calculée avec un prix par jour utilise un calendrier. Les autres façons de calculer une ligne (par mois, ou pour toute la période) n'ont besoin d'aucun calendrier. Voir [Calculer à partir de la quantité et du prix](opex.md#calculer-a-partir-de-la-quantite-et-du-prix).

---

## Premiers pas

Naviguez vers **Données de référence > Calendriers de jours ouvrés** (dans la section **Finance**) pour ouvrir la liste. Cliquez sur **Nouveau** pour créer votre premier calendrier.

**Champs obligatoires** :

- **Code** : un code court que votre équipe reconnaît. Les fichiers d'import l'utilisent pour trouver le calendrier
- **Nom** : le nom que l'on choisit dans l'onglet Budget, par exemple « Personnel du siège »

**Facultatifs mais utiles** :

- **Description** : à qui s'applique le calendrier, par exemple « Jours ouvrés des salariés, jours fériés exclus »

Une fois le calendrier créé, saisissez les jours ouvrés de chaque année dans son espace de travail.

**Astuce** : si votre équipe finance tient déjà les jours ouvrés dans un tableur, importez-les depuis un fichier CSV. Une ligne correspond à un calendrier et une année.

---

## Utiliser la liste

Tant que l'espace de travail n'a aucun calendrier, une ligne sous le titre l'indique : « Un calendrier indique les jours ouvrés de chaque mois, pour les lignes au prix par jour. Créez-en un ou importez un fichier. »

**Colonnes** :

- **Code** : le code du calendrier
- **Nom** : le nom du calendrier
- **Années** : les années que contient le calendrier, par exemple « 2026, 2027 »
- **Statut** : **Activé** ou **Désactivé** (masquée par défaut, ajoutez-la via le sélecteur de colonnes)
- **Mis à jour** : la date et l'heure de la dernière modification

Cliquez sur n'importe quelle cellule pour ouvrir l'espace de travail.

**Tri** : la liste s'ouvre triée par nom. Cliquez sur un en-tête de colonne pour trier sur cette colonne.

**Filtres** :

- **Recherche rapide** : recherche dans le code, le nom et la description
- **Statut** : le filtre de colonne propose **Activé** et **Désactivé**
- **Filtre de statut** : le bouton bascule **Tous / Activés / Désactivés** au-dessus de la liste. Par défaut, la liste affiche les calendriers activés

**Actions** :

- **Nouveau** : créer un calendrier (nécessite `working_day_profiles:member`)
- **Importer CSV** : charger des calendriers et leurs jours ouvrés depuis un fichier (nécessite `working_day_profiles:admin`)
- **Exporter CSV** : télécharger tous les calendriers (nécessite `working_day_profiles:admin`)
- **Supprimer la sélection** : supprimer les calendriers sélectionnés (nécessite `working_day_profiles:admin`). Les calendriers qui ne peuvent pas être supprimés sont conservés et listés avec la raison

---

## Créer un calendrier

Cliquez sur **Nouveau**. Remplissez **Code**, **Nom** et, si vous le souhaitez, **Description**, puis cliquez sur **Créer**. Un nouveau calendrier est activé.

Après **Créer**, l'espace de travail du nouveau calendrier s'ouvre, prêt à recevoir ses jours ouvrés.

---

## L'espace de travail du calendrier

Cliquez sur n'importe quelle ligne de la liste pour ouvrir l'espace de travail.

- **En-tête** : le code comme référence, avec un bouton de copie, et le nom. Cliquez sur le nom pour le renommer. **Précédent** / **Suivant** parcourent la liste dans son ordre et ses filtres actuels, et le bouton de fermeture ramène à la liste
- **Zone principale** : une ligne comme « Utilisé par 3 lignes OPEX et 1 ligne CAPEX. » lorsque des lignes budgétaires utilisent le calendrier, la **Description**, puis la section **Jours ouvrés**
- **Panneau Propriétés** à droite : **Code** et **Cycle de vie**

**Enregistrement automatique** : chaque modification s'enregistre d'elle-même. Il n'y a pas de bouton Enregistrer. Les champs texte et les mois s'enregistrent quand vous les quittez (appuyez sur Entrée dans **Code** ou dans un mois pour enregistrer aussitôt) ; le cycle de vie s'enregistre dès que vous le modifiez. Lorsqu'une modification est refusée, la raison s'affiche sous le champ concerné, par exemple un code en double sous **Code**.

### Champs

| Champ | Ce qu'il faut saisir | Où trouver cette valeur |
|---|---|---|
| **Code** | Jusqu'à 50 caractères. Les codes sont uniques sans tenir compte de la casse : `CAL-01` et `cal-01` sont le même code | Le code utilisé par votre équipe finance pour cet ensemble de jours ouvrés, par exemple dans son classeur budgétaire |
| **Nom** | Jusqu'à 200 caractères. Les noms sont uniques sans tenir compte de la casse | Le nom sous lequel votre équipe connaît le calendrier. C'est le nom affiché dans l'onglet Budget |
| **Description** | Texte libre | À qui s'applique le calendrier et ce qu'il exclut |
| **Cycle de vie** | L'interrupteur **Activé** et la date de **Fin de validité** | Fixez une date future pour programmer la fin, ou désactivez l'interrupteur pour le désactiver dès aujourd'hui |

### Jours ouvrés

La section **Jours ouvrés** affiche une année à la fois.

- **Onglets d'année** : chaque année que contient le calendrier, les années autour de l'année en cours, et une année vide avant et après celles enregistrées, pour que l'année suivante puisse toujours être ajoutée
- **Douze mois** : un champ par mois. Saisissez les jours ouvrés de ce mois
- **Total annuel** : la ligne sous les mois, par exemple « 218 jours en 2026 ». Elle additionne les mois pendant la saisie, avec 2 décimales au plus, par exemple « 229 jours en 2026 » pour douze mois de 19.083333
- **Copier depuis 2025** : affiché lorsque l'année est vide et que l'année précédente a des jours ouvrés. Il remplit les douze mois avec les valeurs de l'année précédente et les enregistre. Ajustez ensuite les mois qui diffèrent
- **Retirer 2026** : affiché sur une année que contient le calendrier. Lorsqu'aucune ligne budgétaire n'utilise le calendrier, il retire cette année immédiatement. Lorsque des lignes l'utilisent, une boîte de dialogue demande d'abord : « Retirer les jours ouvrés de 2026 ? » Elle donne le nombre de lignes et explique l'effet. Les lignes gardent leurs montants et leurs explications, mais aucune ne peut être recalculée pour cette année, et le fichier des lignes budgétaires ne peut pas les calculer, tant que les jours ne sont pas saisis à nouveau. Cliquez sur **Retirer quand même** pour confirmer

**Une nouvelle année** est enregistrée une fois les douze mois renseignés. Jusque-là, une indication affiche « Renseignez les douze mois pour enregistrer 2027. » Ensuite, chaque modification s'enregistre dès que vous quittez le mois.

**Règles pour les mois** :

- **Au plus le nombre de jours calendaires du mois** : 31 pour mars, 30 pour avril, 28 pour février, 29 pour février d'une année bissextile. Une valeur supérieure est refusée : « Mars 2027 compte 31 jours : saisissez 31 ou moins. »
- **Zéro ou plus** : une valeur négative est refusée.
- **Jusqu'à 6 décimales** : les jours ouvrés peuvent être fractionnaires, par exemple `19.083333` pour un total annuel réparti sur douze mois. Au-delà, la valeur est refusée : « Utilisez 6 décimales au plus. »
- **Les douze mois** : une année contient douze valeurs. Laisser vide un mois d'une année enregistrée est refusé : « Saisissez les jours ouvrés des douze mois de 2027. » Saisissez `0` pour un mois sans jour ouvré.

**Modifier les jours ouvrés ne change jamais une ligne budgétaire d'elle-même.** Les montants des lignes déjà calculées restent tels quels, tout comme l'explication de leur calcul. Ouvrez l'onglet Budget d'une ligne et cliquez sur **Recalculer** pour appliquer les nouveaux jours. Le panneau liste alors les mois dont les jours ont changé, par exemple « Mars : 20 jours, maintenant 19 ».

---

## Calendriers désactivés

Désactivez un calendrier lorsqu'il ne doit plus être utilisé, par exemple après un changement d'accord sur le temps de travail.

- Un calendrier désactivé reste sur les lignes budgétaires qui l'utilisent déjà. Leurs montants ne changent pas.
- Il ne peut pas être choisi pour une autre ligne. L'onglet Budget ne propose que les calendriers activés, plus le calendrier propre à la ligne.
- Une ligne qui l'utilise déjà peut toujours être recalculée. Le panneau avertit alors : « This calendar is disabled. The computation still uses it. »
- Dans un fichier des lignes budgétaires, une ligne qui attribue un calendrier désactivé à une ligne budgétaire qui ne l'utilise pas encore est refusée : « Personnel du siège is disabled. Pick an enabled calendar. »

---

## Supprimer

Le bouton **Supprimer** de l'en-tête supprime le calendrier immédiatement (nécessite `working_day_profiles:admin`). Il est désactivé, avec la raison sur une ligne, tant que des lignes budgétaires utilisent le calendrier, par exemple « Utilisé par 3 lignes OPEX et 1 ligne CAPEX. Désactivez-le plutôt. »

La même règle s'applique à **Supprimer la sélection** dans la liste : un calendrier utilisé par des lignes budgétaires est conservé, avec une raison comme « Personnel du siège is used by 3 OPEX lines and 1 CAPEX line. Disable it instead. »

Une ligne utilise un calendrier lorsque l'une de ses colonnes, pour n'importe quelle année, est calculée avec un prix par jour sur ce calendrier. **Réinitialiser une colonne budgétaire** dans l'Administration budgétaire retire ce lien pour la colonne réinitialisée. Voir [Réinitialiser une colonne budgétaire](budget-operations.md#reinitialiser-une-colonne-budgetaire).

---

## Import/export CSV

Chargez ou mettez à jour des calendriers et leurs jours ouvrés depuis un fichier.

**Export** : cliquez sur **Exporter CSV**, puis sur **Exporter les données**. Le fichier liste tous les calendriers, activés ou désactivés, triés par code. Pour un fichier vide avec les seuls en-têtes, utilisez **Télécharger le modèle** dans la boîte de dialogue d'import.

**Structure du CSV** :

- Séparateur : point-virgule `;`
- Encodage : UTF-8 (enregistrez au format « CSV UTF-8 » dans Excel)
- En-têtes : `code;name;description;status;disabled_at;year;jan;feb;mar;apr;may;jun;jul;aug;sep;oct;nov;dec`
- Une ligne par calendrier et par année. Un calendrier avec trois années occupe trois lignes. Un calendrier sans aucune année est exporté sur une ligne, avec l'année et les mois vides

| Colonne | Contenu |
|---|---|
| `code` | Obligatoire. Le code du calendrier. Les lignes sont rapprochées des calendriers existants par code, sans tenir compte de la casse |
| `name` | Obligatoire |
| `description` | Texte libre |
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
- **Les lignes d'un même code décrivent un seul calendrier.** Elles doivent concorder sur le nom, la description, le statut et la fin de validité.
- **Les mois suivent les règles de l'espace de travail** : les douze mois, chacun au plus le nombre de jours calendaires du mois, avec 6 décimales au plus.
- **Les années absentes du fichier sont conservées.** Un import ajoute ou remplace des années. Il n'en retire jamais. Pour retirer une année, utilisez son lien **Retirer** dans l'espace de travail.
- **Décompte** : un nouveau calendrier ou une nouvelle année compte comme une création. Une année modifiée, ou un changement de nom, de description ou de cycle de vie, compte comme une mise à jour. Une ligne identique à ce qui est enregistré compte comme inchangée. Exporter puis importer le même fichier signale toutes les lignes comme inchangées.
- **Les calendriers absents du fichier** restent tels quels. L'import ne supprime jamais rien.

**Erreurs courantes** :

- **« Rows of CAL-01 disagree on the name. »** (ou la description, le statut, la fin de validité) : rendez identiques sur ces champs les lignes de ce code.
- **« CAL-01 has 2027 twice (rows 3 and 5). »** : gardez une ligne par calendrier et par année.
- **« Enter the working days of all twelve months of 2027. »** : remplissez chaque mois de la ligne. Saisissez `0` pour un mois sans jour ouvré.
- **« March 2027 has 31 days: enter 31 or less. »** : corrigez le mois.
- **« Use at most 6 decimals. »** : arrondissez la valeur.
- **« Give the year of these working days. »** : la ligne a des mois mais pas d'année.
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

- **Un calendrier par accord sur le temps de travail** : les personnes soumises au même accord partagent les mêmes jours ouvrés. Créez un calendrier pour chaque accord, et non un par personne.
- **Nommez-le d'après les personnes qu'il couvre** : l'onglet Budget affiche le nom, donc « Personnel du siège » en dit plus qu'un code.
- **Préparez tôt l'année suivante** : utilisez **Copier depuis** sur la nouvelle année, puis ajustez les mois qui diffèrent. Une ligne calculée par jour ne peut pas être recalculée pour une année que son calendrier ne contient pas.
- **Désactivez plutôt que supprimer** : lorsqu'un calendrier ne sert plus pour de nouvelles lignes, désactivez-le. Les lignes qui l'utilisent gardent leurs montants et peuvent toujours être recalculées.
