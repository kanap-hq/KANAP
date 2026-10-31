# Contrats

Les contrats décrivent vos accords avec les fournisseurs : licences logicielles, contrats de maintenance, abonnements SaaS et contrats de service. KANAP date chaque terme d'un contrat, vous signale quand une décision de renouvellement est attendue, compare ce que le contrat engage avec les lignes budgétaires qui lui sont liées, et liste les clauses que ses applications rendent nécessaires.

## Premiers pas

Rendez-vous dans **Gestion budgétaire > Contrats** pour voir la liste. Cliquez sur **Nouveau** pour créer un contrat (`contracts:member`).

La page s'ouvre sur un formulaire unique. Remplissez-le, puis cliquez sur **Créer**.

**Champs obligatoires** :

- **Nom du contrat** : un nom facile à reconnaître
- **Fournisseur** et **Société contractante** : qui fournit le service et laquelle de vos sociétés a signé
- **Début** : le premier jour du contrat
- **Durée (mois)** : la durée d'un terme, au moins un mois
- **Devise** : l'une des devises de votre espace de travail, la devise par défaut pour commencer

**Champs facultatifs** :

- **Responsable** : la personne qui gère le contrat. Le responsable reçoit les tâches de décision de renouvellement : renseignez-le
- **Reconduction tacite** : **Oui** par défaut
- **Préavis (mois)** : vide signifie sans préavis
- **Montant annuel** : la valeur annuelle à la signature, avec deux décimales au plus. Vide signifie 0
- **Facturation** : **Annuelle** par défaut, ou **Trimestrielle**, **Mensuelle**, **Autre**

Une fois le contrat créé, chaque modification s'enregistre d'elle-même. Il n'y a pas de bouton **Enregistrer**.

---

## Termes et échéances

KANAP calcule les dates d'un contrat à partir de quatre champs : **Début**, **Durée (mois)**, **Préavis (mois)** et **Reconduction tacite**, plus la **Fin de validité** quand elle est renseignée. Rien n'est stocké : modifiez un champ et toutes les dates suivent.

- **Termes** : un contrat court par termes de la durée choisie, comptés depuis la date de début. Un contrat qui commence le 1er juillet 2024 pour 12 mois court du 1er juillet au 30 juin chaque année.
- **Date limite de résiliation** : la fin d'un terme moins le préavis. Avec 6 mois de préavis, le contrat ci-dessus peut être résilié jusqu'au 30 décembre chaque année.
- **Reconduction tacite** : avec **Oui**, les termes se suivent jusqu'à ce qu'une fin de validité les arrête. Avec **Non**, le contrat s'arrête après son premier terme. S'il a une fin de validité, il court alors terme après terme jusqu'à ce jour, de sorte qu'un contrat dont la reconduction a été désactivée garde les termes déjà courus.
- **Fin de validité** : le jour où le contrat s'arrête. Aucun terme ne commence après. Quand elle tombe au milieu d'un terme, le contrat s'arrête ce jour-là.
- **Mois en fin de mois** : quand le même jour n'existe pas dans le mois visé, le dernier jour de ce mois est retenu. Le 31 mars moins un mois donne le 28 février (le 29 une année bissextile).

Toutes les dates sont des jours calendaires en UTC.

---

## Travailler avec la liste

Chaque ligne ouvre le contrat. Votre recherche, vos filtres et votre tri sont conservés au retour, et **Précédent** / **Suivant** sur la fiche parcourent le même ensemble.

**Colonnes par défaut** :

- **Contrat**, **Fournisseur**, **Société**
- **Prochaine échéance** : « Résiliation possible jusqu'au {date} » lorsque cette date est la date limite de résiliation et qu'elle précède la fin du terme, ou « Fin le {date} » lorsque la date est la fin du contrat. La ligne se termine par « dans n j ». Un contrat échu affiche le jour de sa fin, en grisé
- **État** : voir plus bas
- **Montant annuel** : le montant à la signature, suivi de sa devise
- **Engagé**, **Budget** et **Écart** pour l'année budgétaire choisie. Voir [Colonnes budgétaires](#colonnes-budgetaires)
- **Conformité** : le résumé de l'onglet [Conformité](#conformite) : « 2 manquantes · 1 à vérifier » en orange, **Complet** ou **Aucune attente**
- **Lignes liées** : le nombre de lignes budgétaires liées, OPEX et CAPEX ensemble
- **Statut** : **Activé** ou **Désactivé**, déduit de la fin de validité

**Autres colonnes** (sélecteur de colonnes) : **Dev.**, **Couverture du budget**, **Début**, **Durée (m)**, **Renouvellement auto.**, **Préavis (m)**, **Fin du terme** (fin du terme en cours), **Résiliation avant** (prochaine date limite de résiliation), **Facturation** et **Tâche** (la dernière tâche du contrat).

**Tri par défaut** : par **Prochaine échéance**, la plus proche en premier. Les contrats échus restent en bas dans les deux sens.

### État

Chaque contrat a un état, le premier qui s'applique :

- **À décider** (orange) : une décision est attendue. Pour un contrat à reconduction tacite, sa prochaine date limite de résiliation tombe dans le délai de décision et son renouvellement n'a pas été confirmé pour ce terme. Pour un contrat sans reconduction, sa fin tombe dans le délai et personne n'a confirmé qu'il devait finir. Voir [Décisions de renouvellement](#decisions-de-renouvellement)
- **Fin sans reconduction** : le contrat est dans son dernier terme et s'arrêtera à sa fin
- **Reconduit au** une date : la date limite de résiliation du terme en cours est passée, le contrat se poursuit donc dans le terme suivant, qui commence à cette date
- **En cours** : le contrat court et rien n'est encore attendu
- **Échu** : le contrat a pris fin

### Filtres rapides

Les liens au-dessus de la grille filtrent la liste en un clic. Cliquez à nouveau pour retirer le filtre.

- **À décider sous n jours (n)** : les contrats à l'état **À décider**. Le nombre de jours est le délai de décision de votre espace de travail
- **Sans ligne budgétaire (n)** et **Sous-budgétés (n)** : les contrats dont la couverture budgétaire de l'année choisie est dans cet état
- **Sans centre de coûts** : les contrats sans **Centre de coûts ou groupe**. La colonne **Centre de coûts** (sélecteur de colonnes) montre ce champ

Un point orange signale un lien dont le compteur n'est pas nul.

### Colonnes budgétaires

Avec l'accès en lecture aux lignes budgétaires (`budget:reader`), la droite de la barre d'outils affiche **Budget** avec une année et une colonne budgétaire (les noms de colonnes de votre espace de travail). Ce choix vous est propre. Il est partagé avec l'onglet **Budget** de chaque contrat et conservé pour votre prochaine visite. Il commence sur l'année prochaine et la colonne par défaut de votre espace de travail.

- **Engagé** (année) : ce que le contrat engage pour cette année, dans votre devise de reporting. Voir [Engagement](#engagement-et-couverture)
- **Budget** (année) : la somme des montants des lignes liées pour cette année et cette colonne
- **Écart** : budget moins engagement. Un manque s'affiche en orange. **Sans ligne** signifie que rien n'est budgété sur une ligne liée, et **Contrat échu** qu'il reste du budget sur un contrat terminé
- **Couverture du budget** (masquée par défaut) : l'un des six états de couverture

Un contrat dans une devise sans taux de change pour l'année affiche « Pas de taux USD » à la place d'un montant.

Quand une ligne budgétaire liée n'a pas de taux de change pour l'année, le montant **Budget** l'exclut et affiche une petite marque orange. **Écart** et **Couverture du budget** restent vides, car la couverture est inconnue. Un avertissement d'une ligne sous la liste indique les lignes exclues, par exemple « 1 ligne sans taux de change exclue : USD 2026. » Voir [Taux manuels](currencies.md#taux-manuels). Sans le droit budget, ces colonnes, le sélecteur et les deux filtres rapides budgétaires sont masqués.

### Ligne de total

La ligne épinglée en bas indique **Total (n contrats)**. Elle additionne les montants annuels des contrats affichés, convertis dans votre devise de reporting avec les derniers taux de l'année, ainsi que les trois colonnes budgétaires. Une devise sans taux reste hors de la somme et elle est nommée, par exemple « hors 2 contrats en GBP sans taux ».

### Recherche, filtres et périmètre

- **Recherche rapide** : nom du contrat, fournisseur et société
- **Filtres de colonnes** : sur chaque en-tête de colonne. **État**, **Conformité** et **Couverture du budget** proposent leurs valeurs en cases à cocher. Le filtre **Statut** reprend le choix de **Afficher** (**Tous**, **Activés** ou **Désactivés**) : changer l'un change l'autre
- **Afficher : Tous / Activés / Désactivés** : le bouton bascule au-dessus de la liste. Par défaut, la liste affiche les contrats activés. Choisissez **Tous** ou **Désactivés** pour retrouver les contrats dont la fin de validité est passée

### Actions

- **Nouveau** : créer un contrat (`contracts:member`)
- **Importer** et **Exporter** : voir [Import/export CSV](#importexport-csv) (`contracts:admin`)
- **Exporter le registre** : le registre de conformité des contrats affichés par la liste (`contracts:admin`). Voir [Conformité](#conformite)
- **Réglages** : le délai de décision de l'espace de travail (`contracts:admin`). Voir [Délai de décision](#delai-de-decision)
- **Supprimer** : supprimer les contrats cochés (`contracts:admin`). Voir [Supprimer un contrat](#supprimer-un-contrat)

---

## La fiche contrat

### En-tête et propriétés

L'en-tête affiche le nom du contrat (cliquez dessus pour le renommer), **Précédent** / **Suivant** avec la position dans la liste, et une barre avec **Fournisseur**, **Société contractante**, **Responsable** et **Statut**. Le responsable et le statut se modifient sur place. Le fournisseur et la société ouvrent le panneau **Propriétés**.

Le panneau **Propriétés**, à droite, contient tous les champs du contrat : les parties, **Début**, **Durée (mois)**, **Préavis (mois)**, **Reconduction tacite**, **Montant annuel**, **Devise**, **Facturation**, puis **Cycle de vie** (**Statut** et **Fin de validité**), **Créé** et **Mis à jour**. Ouvrez-le ou fermez-le avec son bouton ; KANAP retient votre choix.

**Centre de coûts ou groupe** est facultatif. Il place le contrat sous un centre de coûts ou un groupe pour l'[accès aux données](data-access.md) : les personnes limitées à ce nœud, ou à un groupe au-dessus, voient le contrat, comme celles qui sont limitées à sa société.

Chaque modification s'enregistre d'elle-même : listes et dates aussitôt, valeurs saisies et notes après une courte pause, le nom quand vous quittez le champ. « Enregistrement... » puis « Enregistré » s'affiche dans l'en-tête. Deux personnes qui modifient le même contrat ne sont pas averties : la dernière modification l'emporte.

**Cycle de vie** :

- Passer à **Désactivé** fixe la fin de validité à maintenant : la désactivation est immédiate. Tant qu'une date future est fixée, l'interrupteur affiche **Actif jusqu'au** et cette date. Le repasser à **Activé** retire la fin de validité
- **Fin de validité** : saisissez une date (jj/mm/aaaa) ou utilisez le calendrier. Laissez vide pour garder le contrat actif
- **Reconduction tacite** a ses propres règles quand le contrat a déjà été reconduit ou attend une décision. Voir [Désactiver ou réactiver la reconduction tacite](#desactiver-ou-reactiver-la-reconduction-tacite)

Il faut `contracts:member` pour modifier. Les lecteurs voient la même page, tous les champs verrouillés.

**Partager**, dans l'en-tête, envoie par e-mail un lien vers le contrat à des collègues de votre espace de travail.

La fiche a cinq onglets : **Vue d'ensemble**, **Budget**, **Conformité**, **Relations** et **Historique** (les modifications du contrat, voir [Historique des fiches](record-history.md)). Les adresses des anciens onglets **Détails** et **Tâches** ouvrent la vue d'ensemble.

### Vue d'ensemble

**Échéances** résume où en est le contrat :

- Une phrase sur ce qui vient : « Résiliation possible jusqu'au 30 déc. 2026 · dans 78 jours », « Préavis dépassé, reconduit jusqu'au 30 juin 2027 », « Fin le 31 mars 2027 sans reconduction » ou « Échu le 31 déc. 2025 ». Quand une décision est attendue sur la fin d'un contrat sans reconduction, la phrase ajoute « décision attendue » avec un point orange
- Une frise des termes : termes passés, terme en cours, aujourd'hui, prochaine date limite de résiliation et délai de décision qui la précède. Le terme suivant est en pointillé tant qu'il peut encore être résilié, en trait plein une fois le préavis dépassé
- Une ligne de faits : le terme en cours et ses dates, le nombre de reconductions et depuis quand, et le préavis

Une fois un renouvellement confirmé, la phrase indique « Reconduction confirmée · prochain terme du 1er juil. 2027 au 30 juin 2028 » et la frise n'affiche plus cette date limite.

La fiche recalcule ces dates pendant que vous modifiez le début, la durée, le préavis ou la reconduction.

**Décision de renouvellement** : quand une décision est attendue, un encart bordé d'orange apparaît sous les échéances. Voir [Décisions de renouvellement](#decisions-de-renouvellement).

**Tâches** : les tâches ouvertes du contrat, avec leur référence, leur assigné, leur échéance et leur statut. **Afficher les tâches terminées (n)** ajoute les tâches terminées. **Nouvelle tâche** crée une tâche liée au contrat. Ouvrez une tâche pour la modifier ou la supprimer.

**Notes** : texte libre avec mise en forme Markdown. La barre d'outils apparaît quand vous cliquez dans l'éditeur.

### Budget

L'onglet liste les lignes budgétaires liées, OPEX et CAPEX ensemble, avec leur référence (`BL-12`), leur nom, leur type et leur société. Utilisez le sélecteur sous le tableau pour lier ou retirer des lignes. Une ligne dont la société payeuse, le centre de coûts, le fournisseur ou la devise diffère du contrat affiche une petite marque orange. Survolez la marque pour voir chaque écart, avec la valeur sur la ligne et la valeur sur le contrat. Le sélecteur montre la même marque sur une ligne avant de la lier. Le lien reste possible. La marque apparaît pour une ligne que vous pouvez lire.

Avec l'accès en lecture aux lignes budgétaires (`budget:reader`), l'onglet affiche aussi des chiffres :

- Des onglets d'année et un sélecteur **Colonne**, le même choix que les colonnes budgétaires de la liste
- Le montant de chaque ligne pour cette année et cette colonne, avec une ligne **Total (n lignes)**
- **Engagement et couverture** : une ligne par année proposée, l'année choisie surlignée. Cliquez sur une ligne pour choisir son année

Les années proposées sont l'année en cours et les deux suivantes, plus l'année précédente quand le budget contient des lignes pour elle.

#### Engagement et couverture

**Engagé par le contrat** est le montant annuel à la signature réparti sur les mois de l'année couverts par un terme. Un mois couvert en partie compte au prorata de ses jours. Les années suivantes supposent que la reconduction continue jusqu'à ce qu'on l'arrête, et rien n'est engagé après la fin de validité ou la fin du contrat. Le montant à la signature vaut pour chaque terme. L'engagement est converti dans votre devise de reporting avec les taux de l'année.

Par exemple, un contrat de 350 000 par an reconduit chaque 1er juillet engage 350 000 chaque année. S'il prend fin le 30 juin 2027, il engage 175 000 en 2027 et rien en 2028.

**Lignes liées** additionne les montants des lignes liées pour cette année et cette colonne. **Écart** est la différence. L'état est le premier qui s'applique :

- **Aucun engagement** : le contrat n'engage rien cette année et aucune ligne liée n'a de montant
- **Budget pas encore commencé** : aucune ligne budgétaire de votre espace de travail n'a de montant pour cette année et cette colonne
- **Aucune ligne budgétée** : aucune ligne liée n'a de montant
- **Sous-budgété** : les lignes liées portent moins que l'engagement
- **Budget supérieur au contrat** : les lignes liées portent plus que l'engagement plus 10 %
- **Couvert** : tous les autres cas

Pour une personne dont l'accès aux données est limité, l'onglet liste les lignes liées qu'elle voit, puis le nombre des autres. La couverture compte toujours toutes les lignes liées, pour que le responsable du contrat voie la vraie couverture. Dans la liste, chaque rangée montre aussi cette couverture complète, tandis que la ligne de totaux compte les contrats visibles et **Lignes liées** compte les lignes visibles. Voir [Accès aux données](data-access.md#what-a-limited-person-sees).

Quand une ligne liée n'a pas de taux de change pour une année, son montant s'affiche dans sa propre devise avec une petite marque orange, et le total et **Lignes liées** l'excluent. L'état de cette année indique **Inconnu : une ligne liée n'a pas de taux de change**. Un avertissement d'une ligne sous le tableau de couverture indique les lignes exclues, par exemple « 1 ligne sans taux de change exclue : USD 2026. » Voir [Taux manquant](currencies.md#mecanismes-de-conversion-reference-rapide) et [Taux manuels](currencies.md#taux-manuels).

### Conformité

L'onglet liste les clauses qu'un contrat doit contenir, compte tenu des applications qu'il couvre, et vous permet de noter si le contrat les contient. Il vous aide à tenir un registre. Il ne certifie la conformité à aucune réglementation.

**Exigences** : **Accord de sous-traitance RGPD (art. 28)**, **Localisation des données**, **Clause de réversibilité**, **Plan de sortie**, **Droit d'audit et clauses de sécurité**.

**Pourquoi une exigence est attendue** : le contrat couvre les applications qui lui sont liées, et les applications dont une instance tourne sur un actif qui lui est lié ou dont il est le contrat de support. Une application dont la fin de validité est passée ne compte plus.

- Une application qui contient des données personnelles rend attendus l'accord de sous-traitance et la localisation des données
- Une criticité métier ou cyber élevée rend attendus la clause de réversibilité, le plan de sortie et le droit d'audit. Élevée signifie les deux niveaux les plus sévères de votre catalogue (le plus sévère seul quand le catalogue a moins de trois niveaux)
- Une instance hébergée dans le cloud rend attendue la localisation des données. La catégorie du type d'hébergement, dans **Cartographie SI > Paramètres**, décide de ce qui compte comme cloud

La colonne **Attendue car** donne la première raison, par exemple « SAP S/4HANA contient des données personnelles », puis « et n autres ». Survolez-la pour toutes les lire. Une raison qui passe par un actif le nomme si vous pouvez lire l'infrastructure. Une application que vous ne pouvez pas lire (ou, pour un Contributeur métier, une application à laquelle vous ne participez pas) s'affiche « Une application que vous ne voyez pas » : l'exigence reste attendue.

**Saisie** : choisissez un état pour chaque exigence : **Présente**, **Absente** ou **Sans objet**. Il s'enregistre aussitôt. Une exigence attendue sans état indique **À vérifier**. Saisissez une **Référence** (par exemple « article 18.3 ») ; elle s'enregistre quand vous quittez le champ ou appuyez sur Entrée. Survolez une ligne pour voir la date de la dernière mise à jour et son auteur.

**Afficher les autres exigences (n)** ajoute les exigences que rien ne rend nécessaires, pour les renseigner aussi. Quand rien n'est attendu, l'onglet le dit en une ligne.

La pastille de l'onglet compte les exigences attendues notées absentes. Dans la liste, la colonne **Conformité** indique :

- **n manquantes** (et « · n à vérifier »), en orange
- **n à vérifier**
- **Complet** : chaque exigence attendue est présente ou sans objet
- **Aucune attente**

Lier ou retirer une application ou un actif dans **Relations** met l'onglet à jour aussitôt. Il faut `contracts:member` pour saisir ; les lecteurs voient l'onglet en lecture seule.

**Exporter le registre** (liste, `contracts:admin`) télécharge un fichier CSV ou Excel des contrats affichés par la liste, avec sa recherche, ses filtres, son périmètre et son ordre : une ligne par contrat et par exigence, avec le fait qu'elle soit attendue ou non, la raison, l'état, la référence et la dernière mise à jour. Les en-têtes et les mots suivent la langue de votre écran.

### Relations

L'onglet Relations montre ce que couvre ce contrat : ses applications, actifs et technologies, chacun dans son propre tableau, puis des suggestions, les contacts, et les liens et fichiers. Cliquez sur une ligne pour ouvrir l'enregistrement. Les lignes budgétaires se lient dans l'onglet [Budget](#budget).

**Enregistrements liés**, un tableau chacun :

| Section | Colonnes |
|---|---|
| **Applications** | Référence (`APP-3`), nom, cycle de vie, criticité business. Visible seulement si vous pouvez lire les applications. Un Business Contributor voit les applications auxquelles il participe |
| **Actifs** | Référence (`AST-12`), nom, type, environnement, statut. Visible seulement si vous pouvez lire l'infrastructure |
| **Technologies** | Référence (`TEC-5`), nom, famille, éditeur. Visible seulement si vous pouvez lire l'infrastructure |

Une application ou un actif désactivé ou retiré reste affiché, son nom grisé. Les applications et les actifs alimentent l'onglet [Conformité](#conformite). Un actif dont le contrat de support est celui-ci, renseigné sur la fiche de l'actif, n'apparaît pas ici. Il compte quand même pour la conformité.

**Ajouter et retirer des liens** (`contracts:member`) : **Ajouter**, à droite d'une section, ouvre une recherche. Tapez un nom ou une référence et choisissez un résultat : le lien est enregistré aussitôt. La recherche propose les applications et les actifs que vous pouvez voir. Les technologies retirées ne sont pas proposées. Pour retirer un lien, survolez la ligne et cliquez sur la croix en fin de ligne. Retirer un lien ne supprime rien d'autre. Lier une application demande aussi de pouvoir lire les applications, et lier un actif ou une technologie de pouvoir lire l'infrastructure. Un Business Contributor lie et retire seulement les applications auxquelles il participe ; les autres applications du contrat restent liées. Les lecteurs voient les tableaux en lecture seule.

**Apparentés** : les applications et les actifs du fournisseur du contrat qui ne sont pas encore liés, avec la raison « même fournisseur ». Un actif appartient au fournisseur par son fournisseur de support. Cliquez sur **Lier** pour ajouter la suggestion à sa section. Les suggestions montrent :

- les applications en service, si vous pouvez lire les applications. Un Contributeur métier ne voit que les applications auxquelles il participe ;
- les actifs qui ne sont pas retirés, si vous pouvez lire l'infrastructure ;
- 20 au plus de chaque type.

La section est absente quand il n'y a rien à suggérer.

**Contacts** : les personnes liées à ce contrat, chacune avec un rôle (Commercial, Technique, Support ou Autre). **Reprendre les contacts du fournisseur** copie les contacts du fournisseur en un clic.

**Liens et fichiers** : les liens web du contrat (le PDF signé en ligne, le portail du fournisseur) et ses fichiers, une ligne chacun avec son nom, le domaine du lien ou la taille du fichier, et sa date d'ajout. Cliquez sur un lien pour l'ouvrir dans un nouvel onglet, ou sur un fichier pour le télécharger. Avec `contracts:member` :

- **Ajouter un lien** ouvre une boîte de dialogue pour une URL et un nom optionnel ; le lien est enregistré aussitôt. Pour modifier un lien, survolez sa ligne et cliquez sur le crayon.
- **Joindre un fichier** ouvre le sélecteur de fichiers. Vous pouvez aussi déposer des fichiers sur la section.
- Pour retirer un lien ou un fichier, survolez la ligne et cliquez sur la croix. Retirer un lien affiche un message et propose **Annuler**, qui recrée le lien. La suppression d'un fichier demande d'abord une confirmation.

### Supprimer un contrat

**Supprimer** (icône corbeille), dans l'en-tête de la page du contrat ou dans la liste pour les contrats cochés, supprime des contrats (`contracts:admin`). Cette action est irréversible.

- Les liens disparaissent et les éléments liés sont conservés : les lignes budgétaires, applications, actifs (y compris ceux dont c'est le contrat de support) et contacts perdent leur lien avec le contrat
- Ce qui appartient au contrat est supprimé avec lui : ses tâches (y compris la tâche de décision de renouvellement), ses sites web pertinents et ses pièces jointes
- Un contrat avec des exigences de conformité renseignées (un état, y compris **Sans objet**, ou une référence) ne peut pas être supprimé : KANAP indique combien sont renseignées et propose de le désactiver plutôt. Dans la liste, la confirmation nomme les contrats conservés, avec leur nombre, avant toute suppression ; les autres sont supprimés
- Une confirmation vient toujours d'abord. Elle compte ce qui perd son lien et ce qui est supprimé aussi, ou indique que le contrat n'est lié à rien

Pour ne plus utiliser un contrat tout en gardant son historique, désactivez-le plutôt.

---

## Décisions de renouvellement

KANAP demande au responsable de décider de chaque renouvellement avant qu'il n'ait lieu, et enregistre la décision.

### Délai de décision

Un contrat à reconduction tacite attend une décision quand sa prochaine date limite de résiliation tombe dans le délai de décision. Un contrat sans reconduction en attend une quand sa fin tombe dans ce délai. Le délai est de 90 jours par défaut. Les administrateurs des contrats le changent avec **Réglages** dans la liste, de 0 à 365 jours.

Le délai pilote l'état **À décider**, le filtre rapide, l'encart de décision, la frise et les tâches de décision.

### La tâche de décision

Chaque jour à 07:30 UTC, KANAP crée une tâche pour chaque contrat qui attend une décision :

- **Décider du renouvellement de** le contrat, à échéance de la date limite de résiliation, pour un contrat à reconduction tacite
- **Décider de renouveler ou de laisser finir** le contrat, à échéance de sa fin, pour un contrat sans reconduction

La tâche est assignée au responsable du contrat, avec l'e-mail d'assignation habituel. Son texte est dans la langue du responsable, ou dans la langue de l'espace de travail lorsque le responsable n'en a pas choisi. Il y a une tâche par contrat et par terme. Une tâche supprimée n'est pas recréée pour ce terme. Un contrat sans responsable ne reçoit pas de tâche tant qu'aucun n'est renseigné.

L'encart de décision et la tâche restent alignés : une décision prise dans l'encart ferme la tâche, avec la justification en commentaire.

### Décider

L'encart affiche la date limite, les jours restants, la tâche et son assigné, et ce qui se passe sans décision (« Sans décision, le contrat sera reconduit pour 12 mois le 1er juil. 2027. »). Saisissez une **Justification** facultative, puis choisissez :

- **Renouveler** : le renouvellement est confirmé pour ce terme. La tâche est fermée, le contrat quitte **À décider** et revient dans le délai à la date limite du terme suivant
- **Renégocier** : l'encart indique **Renégociation en cours** et la tâche reste ouverte jusqu'à la décision finale. Le contrat reste **À décider**
- **Résilier** : l'encart affiche la date de fin à confirmer. KANAP propose la première fin que permet le préavis (« Préavis de 6 mois : la première fin possible est le 30 juin 2027. »). Vous pouvez choisir un autre jour, à partir d'aujourd'hui et du début du contrat. Un jour antérieur à la date proposée affiche un avertissement orange : le fournisseur doit l'accepter. L'encart liste les conséquences pour ce jour : l'engagement de l'année et de la suivante, les applications qui perdent ce contrat et les actifs qui perdent leur contrat de support, chacun si vous pouvez lire son module. **Confirmer la résiliation** désactive la reconduction tacite, fixe la fin de validité à ce jour et ferme la tâche. Le contrat indique alors **Fin sans reconduction** et son engagement s'arrête ce jour-là

Pour un contrat sans reconduction, l'encart indique « Fin prévue le 31 mars 2027 · décision attendue » et propose deux actions :

- **Renouveler** : réactive la reconduction tacite et retire la fin de validité
- **Laisser finir** : confirme la fin. Rien d'autre ne change

Une fois la décision prise, l'encart se réduit à une ligne, par exemple « Renouvellement confirmé le 2 oct. 2026 par Sophie Laurent. Le contrat repart pour un terme le 1er juil. 2027. », avec la tâche et la justification. Après une résiliation, il rappelle d'envoyer la lettre de résiliation avant la date limite et de la joindre dans **Relations**.

**Annuler la décision** remet le contrat et la tâche dans leur état précédent : avant la date limite de résiliation, ou avant la fin pour un contrat sans reconduction.

Il faut `contracts:member` pour décider. Les lecteurs voient l'encart sans ses actions.

### Désactiver ou réactiver la reconduction tacite

**Reconduction tacite**, dans le panneau **Propriétés**, suit les mêmes règles.

**Non** sur un contrat déjà reconduit, ou sur un contrat qui attend une décision de renouvellement, ouvre **Désactiver la reconduction tacite**. La fenêtre propose une date de fin comme une résiliation (première fin permise par le préavis, tout jour à partir d'aujourd'hui, avertissement orange avant la date proposée, conséquences pour le jour choisi) et indique « Le contrat prendra fin le 30 juin 2027, sauf renouvellement. ». Pour un contrat déjà reconduit, elle précise que ses termes passés sont conservés. **Désactiver la reconduction** fixe cette fin de validité et le champ indique **Non**. **Annuler** ne change rien.

Aucune décision n'est enregistrée. Le contrat attend maintenant une décision sur sa fin : une tâche de décision ouverte devient « Décider de renouveler ou de laisser finir » le contrat, à échéance de la nouvelle fin, avec un commentaire qui explique pourquoi. Sans tâche ouverte, une tâche est créée quand la fin tombe dans le délai.

Sur un contrat dans son premier terme sans décision attendue, **Non** s'applique aussitôt : le contrat s'arrête à la fin de son premier terme.

**Oui** sur un contrat sans reconduction qui a une fin de validité ouvre **Réactiver la reconduction tacite** : « Le contrat sera reconduit tacitement et la fin du 31 mars 2027 sera retirée. ». **Réactiver la reconduction** l'applique, quelle que soit l'origine de cette fin. Quand une décision était attendue sur la fin, cela vaut **Renouveler** et peut être annulé. Sinon, la tâche ouverte sur la fin devient la tâche de décision de renouvellement quand cette décision est attendue, ou elle est fermée. Sans fin de validité, **Oui** s'applique aussitôt.

---

## Import/export CSV

L'export écrit un fichier CSV ou un classeur Excel (`.xlsx`) : choisissez sous **Format** dans la fenêtre. L'import lit l'un ou l'autre. Voir [Fichiers CSV et Excel](csv-files.md).

Gardez votre liste de contrats synchronisée avec d'autres outils grâce aux fichiers CSV ou aux classeurs Excel (`contracts:admin`).

**Export** : télécharge les contrats que la liste affiche (ou, sur demande dans la fenêtre, tous les contrats) avec ces colonnes : `name`, `company_name`, `supplier_name`, `start_date`, `duration_months`, `auto_renewal`, `notice_period_months`, `yearly_amount_at_signature`, `currency`, `billing_frequency`, `status`, `owner_email`, `notes`. Les dates calculées (fin du terme, dates limites, état) ne sont pas exportées.

**Import** :

- Utilisez le **Contrôle préalable** pour vérifier le fichier avant de l'appliquer
- Une ligne correspond à un contrat par son nom et son fournisseur
- Création et mises à jour sont prises en charge
- Le fichier n'a pas de colonne de fin de validité. Lors d'une mise à jour, un `status` vide, ou égal au statut actuel du contrat, conserve sa fin de validité. Un statut différent l'applique : `enabled` efface la fin de validité, et `disabled` termine le contrat aujourd'hui, sauf si sa fin de validité est déjà passée
- Un nouveau contrat est activé sauf si la ligne indique `disabled`
- Une ligne qui passe `auto_renewal` à false sur un contrat déjà reconduit et sans fin de validité est refusée, contrôle préalable compris : elle effacerait les termes que le contrat a courus. Désactivez la reconduction depuis la fiche du contrat, qui fixe la fin

**Remarques** :

- Voir [Fichiers CSV et Excel](csv-files.md) pour l'encodage, le séparateur, les formes de dates et de montants, et les deux étapes d'import
- Les dates sont calculées à partir du début, de la durée, du préavis et de la reconduction ; elles ne sont jamais importées

---

## Astuces

- **Renseignez un responsable sur chaque contrat** : les tâches de décision de renouvellement vont au responsable. Un contrat sans responsable ne reçoit aucune tâche.
- **Commencez la semaine par À décider** : le filtre rapide liste les contrats dont la décision est attendue, et l'encart de décision de chacun montre ce qui se passe sans décision.
- **Liez les lignes budgétaires tôt** : l'**Écart** et le filtre **Sous-budgétés** ne servent que si le contrat est lié aux lignes qui le paient.
- **Renseignez le montant annuel** : même avec une facturation mensuelle, le montant annuel alimente l'engagement et les totaux.
- **Liez applications et actifs** : ils décident des clauses que le contrat doit contenir.
- **Partagez un contrat** : utilisez **Partager**, ou copiez l'adresse de la page. Elle ouvre le même onglet et garde le contexte de votre liste.
