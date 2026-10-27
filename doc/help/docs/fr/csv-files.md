# Fichiers CSV et Excel

Chaque page de données de référence dispose de **Exporter** et **Importer** dans sa barre d'outils, et documente ses propres colonnes. Cette page décrit ce que ces fichiers ont en commun. Elle s'applique aussi à la liste des utilisateurs dans l'**Administration**.

## Export

**Format.** La fenêtre d'export propose **CSV** ou **Excel (.xlsx)**. Le choix est mémorisé par votre navigateur et vaut pour chaque fenêtre et chaque menu d'export. Le fichier contient les lignes que la liste affiche, avec ses filtres et sa recherche, sauf si vous demandez tout le référentiel dans la fenêtre.

**Construit par KANAP.** KANAP écrit chaque fichier d'export, CSV ou Excel, et l'enregistre dans le [journal d'audit](admin.md#journal-daudit) : qui a exporté quoi, avec quels filtres, dans quel format, et combien de lignes.

**Un fichier Excel** contient une feuille nommée d'après la liste, avec les mêmes colonnes que le CSV. La ligne d'en-tête est en gras et reste en place au défilement, avec un filtre sur chaque colonne. Les nombres sont des nombres, les montants sont exacts au centime, et les dates sont des dates qu'Excel et LibreOffice affichent dans l'ordre jour-mois de votre langue. Toute autre cellule est du texte. Un texte qui commence comme une formule reste du texte.

## Import

**Vérifier, puis charger.** Un import se fait en deux étapes. **Vérification préalable** lit le fichier et indique ce qu'un chargement changerait : les lignes à créer, les lignes à mettre à jour et les lignes qui ne changent rien. **Charger** l'écrit, puis la fenêtre compte les lignes créées, mises à jour et inchangées, par exemple « 2 créées, 5 mises à jour, 30 inchangées ». Un compte à zéro est omis. Rien n'est écrit avant le chargement, et un fichier avec une seule erreur ne charge rien. Les erreurs nomment la ligne du fichier telle qu'un éditeur de texte l'affiche, lignes vides et cellules sur plusieurs lignes comprises.

**Les colonnes sont rapprochées par leur nom**, dans n'importe quel ordre, quelles que soient la casse, les espaces et les tirets bas. Ces fichiers sont stricts : une colonne que KANAP ne connaît pas refuse tout le fichier, et le message, sur une ligne **En-tête**, nomme les colonnes inconnues et les colonnes manquantes. Le fichier budgétaire est celui qui ignore les colonnes qu'il ne connaît pas. Voir [Charger un budget depuis un tableur](budget-file.md).

**Classeurs Excel.** Un import lit un fichier CSV ou un classeur Excel (`.xlsx`), avec les mêmes colonnes et les mêmes règles. KANAP lit seulement la première feuille. Quand le classeur a d'autres feuilles, la vérification indique la feuille lue. Un nombre ou une date saisi dans une cellule est lu tel quel, sans question de séparateur ni d'ordre du jour et du mois, et une date avec une heure garde son heure. Une date ou un montant saisi en texte suit les règles d'un fichier CSV ci-dessous. Un ancien fichier Excel (`.xls`) est refusé avec un message : enregistrez-le en `.xlsx` ou en CSV. Les modèles d'import sont des fichiers CSV, qu'Excel ouvre.

**Encodage et séparateur d'un fichier CSV.** Enregistrez le fichier en UTF-8 (« CSV UTF-8 » dans Excel). Un fichier qu'Excel a enregistré en CSV simple, en Windows-1252, s'importe aussi, accents compris. Le séparateur est lu sur la ligne d'en-tête : `,`, `;` ou une tabulation. L'export écrit le séparateur de la langue d'affichage de l'écran.

**Autres fichiers.** Une feuille de calcul OpenDocument (`.ods`) est refusée avant la lecture de toute colonne, avec un message qui explique comment l'enregistrer en CSV. Dans LibreOffice Calc : **Fichier › Enregistrer sous › Texte CSV**, ou **Excel 2007-365 (.xlsx)**. Tout autre fichier qui n'est pas du texte est refusé de la même façon.

## Montants, dates et oui ou non

**Dans un fichier CSV, les montants, les dates et les oui ou non suivent la langue de l'écran** à l'export, et un import lit toutes les formes :

| Langue | Séparateur | Montants | Dates | Oui, non |
|---|---|---|---|---|
| Anglais | `,` | `12280.50` | `2027-03-01` | `yes`, `no` |
| Français | `;` | `12280,50` | `01/03/2027` | `oui`, `non` |
| Espagnol | `;` | `12280,50` | `01/03/2027` | `sí`, `no` |
| Allemand | `;` | `12280,50` | `01.03.2027` | `ja`, `nein` |

**Les dates** s'écrivent année en premier (`2027-03-01`, `2027/03/01` ou `2027.03.01`), ou avec le jour et le mois avant l'année (`01/03/2027`, `01.03.2027`). Une date écrite en toutes lettres, comme `Mar 1 2027`, est refusée, de même qu'un jour qui n'existe pas au calendrier, comme `31/02/2027`.

Sur les pages de données de référence, une date que le fichier ne peut pas trancher seul, comme `01/03/2027`, est lue dans l'ordre de la langue d'affichage de l'écran : le jour en premier en français, en allemand et en espagnol, le mois en premier en anglais. La vérification indique comment elle a lu le fichier, avec un bouton pour changer la lecture. Une date dont le jour dépasse 12 tranche la question d'elle-même, et le fichier ne garde aucune trace de la langue dans laquelle il a été exporté. Les fichiers des applications, des actifs, des incidents, des projets, des demandes et des tâches lisent toujours une telle date jour en premier.

Un import lit oui ou non dans chacune de ces langues, ainsi que les `true`, `false`, `1` et `0` des fichiers plus anciens. Les fichiers des applications, des actifs, des incidents, des projets, des demandes et des tâches suivent le même tableau, de même que les fichiers de liens de la liste des technologies. Voir [Technologies](technologies.md#importer-et-exporter-les-liens).

**Taille.** Un fichier contient au plus 20 000 lignes.

Sur une installation sur site, l'administrateur peut désactiver les classeurs Excel dans les imports. Les boutons d'import affichent alors **Importer CSV** et n'acceptent que les fichiers CSV. Voir [Configuration](on-premise/configuration.md#optional-excel-imports).
