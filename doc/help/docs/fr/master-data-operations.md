# Geler les données de référence et copier les indicateurs annuels

Deux outils de l'[administration budgétaire](budget-operations.md) gèrent les indicateurs des sociétés et des départements sur les exercices fiscaux : **Geler les données de référence** et **Copier les indicateurs annuels**. Utilisez-les pour verrouiller des chiffres finalisés, pour reporter une base vers la planification de l'année suivante, ou pour vérifier ce qui est gelé et ce qui ne l'est pas.

Les indicateurs annuels sont l'effectif, les utilisateurs IT et le chiffre d'affaires des sociétés, et l'effectif des départements. Ce sont des données de référence, et le cycle budgétaire les gèle et les reporte d'une année à l'autre. Les deux outils se trouvent donc avec les autres opérations budgétaires.

## Où la trouver

- Espace de travail : **Gestion budgétaire**
- Chemin : **Gestion budgétaire > Administration**, section **Opérations**, cartes **Geler les données de référence** et **Copier les indicateurs annuels**
- Autorisations :
  - Ouvrir les pages et voir le statut de gel : le même accès que le reste de l'administration budgétaire (un accès lecteur à l'OPEX, par exemple)
  - Geler / dégeler : `companies:admin`, `departments:admin`, ou `budget_ops:admin`
  - Copier les données : `companies:admin`, `departments:admin`, ou `budget_ops:admin`

Les données de référence n'ont pas d'entrée Administration propre.

Cette page décrit aussi les [fichiers CSV](#fichiers-csv) communs aux pages de données de référence.

---

## Geler les données de référence

Utilisez cet outil pour verrouiller ou déverrouiller les métriques des sociétés et départements pour une année spécifique. Le gel empêche les modifications accidentelles après que les données ont été finalisées — utile lors de la clôture de fin d'année, pendant les audits, ou avant de lancer le cycle budgétaire de l'année suivante.

### Comment ça fonctionne

1. Sélectionnez l'**Année** que vous souhaitez gérer (la plage couvre l'année précédente jusqu'à cinq ans à venir)
2. Cochez les périmètres sur lesquels vous souhaitez agir : **Sociétés**, **Départements**, ou les deux
3. Cliquez sur **Geler les données** pour verrouiller, ou **Dégeler les données** pour déverrouiller

La page affiche une carte de statut pour chaque périmètre :

- **Gelé** (rouge) — les données sont en lecture seule pour cette année ; la carte indique qui a gelé et quand
- **Modifiable** — les données peuvent encore être modifiées

### Ce que le gel affecte

Le gel verrouille les métriques annuelles de l'onglet **Détails** des Sociétés (effectif, utilisateurs IT, chiffre d'affaires) ou des Départements (effectif). Il n'affecte pas :

- L'onglet Vue d'ensemble (nom, description et autres champs généraux)
- Les postes OPEX ou CAPEX

### Autorisations

Vous avez besoin d'un accès admin sur le périmètre concerné pour geler ou dégeler :

| Périmètre | Autorisation requise |
|---|---|
| Sociétés | `companies:admin` ou `budget_ops:admin` |
| Départements | `departments:admin` ou `budget_ops:admin` |

Si vous n'avez pas les autorisations requises, la page vous permet toujours de consulter le statut de gel actuel — vous ne pouvez simplement pas le modifier.

---

## Copier les indicateurs annuels

Copiez les métriques des sociétés et départements d'un exercice fiscal à un autre. Un essai à blanc intégré vous permet de prévisualiser chaque ligne avant de valider, pour que vous sachiez toujours ce qui sera écrasé.

### Comment ça fonctionne

1. Sélectionnez une **Année source** (d'où lire les valeurs)
2. Sélectionnez les **Sources de données** : Sociétés, Départements, ou les deux
3. Sélectionnez une **Année de destination** (où écrire les valeurs)
4. Si Sociétés est sélectionné, choisissez quelles **Métriques de société** copier — toute combinaison d'Effectif, Utilisateurs IT et Chiffre d'affaires
5. Cliquez sur **Essai à blanc** pour générer un aperçu
6. Examinez le tableau d'aperçu
7. Cliquez sur **Copier les données** pour appliquer les modifications

### Colonnes du tableau d'aperçu

| Colonne | Ce qu'elle affiche |
|---|---|
| **Type** | Société ou Département |
| **Nom** | Nom de l'entité |
| **Métrique** | Effectif, Utilisateurs IT ou Chiffre d'affaires |
| **Valeur source** | La valeur de l'année source |
| **Destination actuelle** | La valeur existante dans l'année de destination (le cas échéant) |
| **Nouvelle valeur** | La valeur qui sera écrite — affichée en gras |
| **Statut** | « Prêt à copier » ou la raison du saut |

Les lignes sautées apparaissent dans une couleur d'avertissement. Raisons de saut courantes :

- La valeur source est nulle ou vide
- L'année de destination est gelée pour ce périmètre
- L'entité n'est pas active pour l'année de destination

### Cartes récapitulatives

Sous la grille, quatre cartes récapitulatives vous donnent un comptage rapide :

- **Total des lignes** — tout ce que l'opération a évalué
- **Prêtes à copier** — lignes qui seront écrites
- **Sautées** — lignes exclues (avec raisons visibles dans le tableau)
- **Erreurs** — lignes qui ont échoué pendant la copie effective

### Protection des données gelées

Vous ne pouvez pas copier de données dans une année gelée. Si l'année de destination est gelée pour les Sociétés ou Départements, une bannière d'erreur apparaît et les boutons d'action sont désactivés. Dégelez d'abord l'année de destination avec **Geler les données de référence**.

### Export CSV

Vous pouvez exporter le tableau d'aperçu en CSV en utilisant le bouton d'export dans la barre d'outils. C'est pratique pour une revue hors ligne ou un partage avec des collègues avant de valider. Cet export écrit le tableau tel qu'il est affiché. Les fichiers que les pages de données de référence importent sont décrits dans [Fichiers CSV](#fichiers-csv).

### Autorisations

Les mêmes règles s'appliquent que pour le gel :

| Périmètre | Autorisation requise |
|---|---|
| Sociétés | `companies:admin` ou `budget_ops:admin` |
| Départements | `departments:admin` ou `budget_ops:admin` |

Si vous n'avez accès qu'à un seul périmètre, l'autre est grisé dans le sélecteur Sources de données.

---

## Fichiers CSV

Chaque page de données de référence dispose de **Exporter CSV** et **Importer CSV** dans sa barre d'outils, et documente ses propres colonnes. Cette section décrit ce que ces fichiers ont en commun.

**Vérifier, puis charger.** Un import se fait en deux étapes. La **Vérification préalable** lit le fichier et indique ce qu'un chargement modifierait : les lignes à créer, les lignes à mettre à jour et les lignes qui ne changent rien. **Charger** écrit le fichier. Rien n'est écrit avant, et un fichier avec une seule erreur ne charge rien. Les erreurs nomment la ligne du fichier telle qu'un éditeur de texte l'affiche, lignes vides et cellules sur plusieurs lignes comprises.

**Les colonnes sont rapprochées par leur nom**, dans n'importe quel ordre, sans tenir compte de la casse, des espaces ni des traits de soulignement. Ces fichiers sont stricts : une colonne que KANAP ne connaît pas refuse le fichier entier, et le message nomme les colonnes inconnues et manquantes. Le fichier budgétaire est celui qui ignore les colonnes qu'il ne connaît pas. Voir [Charger un budget depuis un tableur](budget-file.md).

**Encodage et séparateur.** Enregistrez le fichier en UTF-8 (« CSV UTF-8 » dans Excel). Un fichier enregistré par Excel au format CSV simple, en Windows-1252, s'importe aussi, accents compris. Le séparateur est lu sur la ligne d'en-tête : `,`, `;` ou une tabulation. L'export écrit le séparateur de la langue d'affichage de l'écran.

**Les montants et les dates suivent la langue de l'écran** à l'export, et un import lit les deux formes :

| Langue | Séparateur | Montants | Dates |
|---|---|---|---|
| Anglais | `,` | `12280.50` | `2027-03-01` |
| Français, espagnol | `;` | `12280,50` | `01/03/2027` |
| Allemand | `;` | `12280,50` | `01.03.2027` |

Une date que le fichier ne peut pas trancher seul, comme `01/03/2027`, est lue dans l'ordre de la langue d'affichage de l'écran : jour d'abord en français, en allemand et en espagnol, mois d'abord en anglais. La vérification indique comment elle a lu le fichier, avec un bouton pour changer la lecture. Une date dont le jour est supérieur à 12 tranche la question seule, et le fichier ne porte aucune trace de la langue dans laquelle il a été exporté.

**Taille.** Un fichier contient jusqu'à 20 000 lignes.

---

## Scénarios courants

### Protéger les données de fin d'année finalisées

Votre budget 2025 est approuvé. Verrouillez-le pour que personne ne modifie accidentellement les chiffres.

1. Ouvrez **Gestion budgétaire > Administration > Geler les données de référence**
2. Sélectionnez l'année **2025**
3. Cochez **Sociétés** et **Départements**
4. Cliquez sur **Geler les données**

Toutes les métriques des sociétés et départements pour 2025 sont maintenant en lecture seule jusqu'à ce que vous les dégeliez.

### Démarrer le budget de l'année suivante

Vous souhaitez commencer la planification 2026 en utilisant l'effectif et le chiffre d'affaires 2025 comme base.

1. Ouvrez **Gestion budgétaire > Administration > Copier les indicateurs annuels**
2. Définissez **Année source** sur **2025** et **Année de destination** sur **2026**
3. Sous **Sources de données**, sélectionnez **Sociétés**
4. Sous **Métriques de société**, sélectionnez **Effectif** et **Chiffre d'affaires** (désélectionnez Utilisateurs IT si vous n'en avez pas besoin)
5. Cliquez sur **Essai à blanc** et examinez l'aperçu
6. Cliquez sur **Copier les données**

Toutes les sociétés portent maintenant l'effectif et le chiffre d'affaires 2025 en 2026. Ajustez les valeurs individuelles selon les besoins.

### Corriger des données gelées

Vous avez gelé 2025 mais repéré une erreur dans l'effectif d'une société.

1. Ouvrez **Gestion budgétaire > Administration > Geler les données de référence**
2. Sélectionnez l'année **2025**, cochez **Sociétés**, et cliquez sur **Dégeler les données**
3. Modifiez l'effectif de la société dans **Données de référence > Sociétés > Détails**
4. Revenez à **Geler les données de référence** et regelez les Sociétés 2025

---

## Questions fréquentes

**Que se passe-t-il si j'essaie de modifier une année gelée ?**
L'onglet Détails pour les Sociétés ou Départements passe en lecture seule pour cette année. Vous verrez un message indiquant que les données sont gelées. Dégelez pour effectuer des modifications.

**Le gel affecte-t-il les postes OPEX ou CAPEX ?**
Non. Le gel ne verrouille que les métriques annuelles (effectif, utilisateurs IT, chiffre d'affaires) des Sociétés et Départements. Les postes OPEX et CAPEX ne sont pas affectés.

**Puis-je copier des données vers une année gelée ?**
Non. L'outil de copie affichera une erreur et désactivera les boutons d'action. Dégelez d'abord l'année de destination.

**Que se passe-t-il si la destination a déjà des valeurs ?**
L'opération de copie les écrase. Exécutez toujours un essai à blanc d'abord pour voir la colonne « Destination actuelle » et comprendre ce qui sera remplacé.

**Puis-je annuler une copie ?**
Non. Les opérations de copie ne sont pas réversibles. Si vous avez besoin d'un filet de sécurité, exportez les données de l'année de destination en CSV avant de copier.

**Pourquoi certaines lignes sont-elles sautées ?**
Les lignes sont sautées lorsque la valeur source est nulle, l'entité est inactive pour l'année de destination, ou la destination est gelée. La colonne Statut dans l'aperçu vous indique la raison applicable.

**Puis-je copier uniquement certaines sociétés ou départements ?**
Non. L'outil copie toutes les entités pour les périmètres et métriques sélectionnés. Pour des mises à jour sélectives, utilisez l'export/import CSV sur les pages individuelles Sociétés ou Départements.

**La copie crée-t-elle de nouvelles sociétés ou départements ?**
Non. Elle n'écrit des métriques que pour les entités qui existent déjà dans les deux années. Si une société existe dans l'année source mais pas dans la destination, cette ligne est sautée.

**Qui peut voir le statut de gel ?**
Toute personne qui peut ouvrir l'administration budgétaire. Seuls les administrateurs du périmètre concerné peuvent effectivement geler ou dégeler.

**Puis-je geler des années futures ?**
Oui. Le sélecteur d'année couvre une plage de l'année dernière à cinq ans à venir. Geler une année future est utile pour verrouiller des budgets approuvés avant le début de l'exercice.

---

## Conseils

- **Toujours faire un essai à blanc d'abord** — examinez le tableau d'aperçu avant de valider pour éviter les écrasements accidentels
- **Gelez après approbation** — verrouillez les données dès que les budgets sont signés pour éviter la dérive
- **Dégelez temporairement** — faites votre correction, puis regelez immédiatement
- **Copiez tôt** — commencez le prochain cycle de planification en copiant les métriques de l'année en cours vers l'avant, puis ajustez pour les changements attendus
- **Vérifiez vos autorisations** — si un périmètre est grisé, demandez à un administrateur de vous accorder le bon niveau d'accès
